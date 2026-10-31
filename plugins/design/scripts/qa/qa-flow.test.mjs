import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compile, pageScript, paneBatches, parseArgs, parseFlow, run, runSteps } from './qa-flow.mjs'
import { findChrome } from './cdp.mjs'

const flow = (o) => JSON.stringify({ base: 'http://localhost:5174', out: '/s/qa-3', ...o })

// Kit 1.8 (council Feature 17): the sample an order copies must stay a valid steps file.
describe('steps.sample.json', () => {
  it('parses, and its --pane form is two batches with one shot', () => {
    const sample = new URL('./steps.sample.json', import.meta.url)
    const f = parseFlow(readFileSync(sample, 'utf8'), 'steps.sample.json')
    expect(f.steps.map((s) => s.kind)).toEqual(['open', 'wait', 'click', 'type', 'click', 'wait', 'read', 'js', 'shot'])
    const { batches } = paneBatches(f)
    expect(batches).toHaveLength(1)
    expect(batches[0].after).toMatch(/save-shot\.mjs \/abs\/scratchpad\/qa-3\/notes-375-dark\.jpg/)
  })
})

describe('parseFlow', () => {
  it('names every problem at once', () => {
    const bad = JSON.stringify({
      themeVia: 'cookie',
      width: '375',
      steps: [{ open: '/notes' }, { click: 'a', type: 'x' }, { click: {} }, { wait: -1 }, { type: 'x', into: '' }, { shot: 'a b' }, { shot: 'n' }, { shot: 'n' }, { read: 'p', nope: 1 }, { wait: 5, timeout: 0 }],
    })
    expect(() => parseFlow(bad)).toThrow(
      /themeVia "cookie".*"width" is not a whole number.*step 1 opens a path but the file has no "base".*step 2 needs exactly one of.*step 3 click is not a selector.*step 4 wait is not ms.*step 5 into is not a selector.*step 6 shot is not a file name.*step 6 takes a shot but the file has no "out".*two shots are named n.*step 9 \(read\) has an unknown key "nope".*step 10 timeout is not a positive/,
    )
  })
  it('says when the file is not JSON or has no steps', () => {
    expect(() => parseFlow('{', 'f.json')).toThrow(/f\.json: not JSON/)
    expect(() => parseFlow('{}')).toThrow(/no "steps"/)
  })
  it('numbers the steps and names each one\'s kind', () => {
    const f = parseFlow(flow({ steps: [{ open: '/a' }, { click: { text: 'Add' }, timeout: 900 }, { type: 'TEST', into: 'textarea' }] }))
    expect(f.themeVia).toBe('param:theme')
    expect(f.steps.map((s) => [s.i, s.kind])).toEqual([[1, 'open'], [2, 'click'], [3, 'type']])
  })
  it('lets a full URL open with no base', () => {
    expect(() => parseFlow(JSON.stringify({ steps: [{ open: 'http://localhost:5174/x' }, { read: true }] }))).not.toThrow()
  })
})

describe('compile', () => {
  it('splits the flow at each open and shot, and keeps page steps together', () => {
    const f = parseFlow(flow({ theme: 'dark', steps: [{ open: '/notes' }, { click: 'button' }, { key: 'Enter' }, { shot: 'notes-375-dark' }, { read: 'main' }] }))
    const ops = compile(f)
    expect(ops.map((o) => o.op)).toEqual(['open', 'page', 'shot', 'page'])
    expect(ops[0].url).toBe('http://localhost:5174/notes?theme=dark')
    expect(ops[1].steps.map((s) => s.kind)).toEqual(['click', 'key'])
    expect(ops[2].file).toBe('/s/qa-3/notes-375-dark.jpg')
  })
})

describe('paneBatches', () => {
  it('gives one browser_batch per shot, each followed by its save-shot line', () => {
    const f = parseFlow(flow({ width: 375, steps: [{ open: '/a' }, { click: 'b' }, { shot: 'one' }, { click: 'c' }, { shot: 'two' }, { read: true }] }))
    const { batches } = paneBatches(f, { tab: 't9', since: '2026-10-24T10:00:00Z' })
    expect(batches).toHaveLength(3)
    expect(batches[0].actions.map((a) => a.name)).toEqual(['resize_window', 'navigate', 'javascript_tool', 'computer'])
    expect(batches[0].actions[0].input).toEqual({ width: 375, height: 812, tabId: 't9' })
    expect(batches[0].actions.every((a) => a.input.tabId === 't9')).toBe(true)
    expect(batches[0].after).toMatch(/save-shot\.mjs \/s\/qa-3\/one\.jpg --since 2026-10-24T10:00:00Z$/)
    expect(batches[1].actions.map((a) => a.name)).toEqual(['javascript_tool', 'computer'])
    expect(batches[2]).toEqual({ actions: [expect.objectContaining({ name: 'javascript_tool' })], after: null })
  })
  it('writes a page script that parses as one expression', () => {
    const src = pageScript([{ i: 1, kind: 'read', read: true }])
    expect(() => new Function(`return (async () => ${src})()`)).not.toThrow()
    expect(src).not.toMatch(/^export/)
  })
})

describe('runSteps', () => {
  it('runs page steps in order and stops at the first failure', async () => {
    const saved = globalThis.document
    globalThis.document = { querySelector: (s) => (s === 'main' ? { innerText: ' Notes\n\n\n\nTEST QA note ' } : null), body: {} }
    try {
      const out = await runSteps([
        { i: 1, kind: 'js', js: '1 + 1' },
        { i: 2, kind: 'read', read: 'main' },
        { i: 3, kind: 'read', read: '#missing' },
        { i: 4, kind: 'wait', wait: 10 },
      ])
      expect(out).toEqual([
        { i: 1, kind: 'js', ok: true, text: '2' },
        { i: 2, kind: 'read', ok: true, text: 'Notes\n\nTEST QA note' },
        { i: 3, kind: 'read', ok: false, error: 'nothing matches #missing' },
      ])
    } finally {
      globalThis.document = saved
    }
  })
})

describe('parseArgs', () => {
  it('reads the pane flags', () => {
    expect(parseArgs(['f.json', '--pane', '--tab', 't1', '--since', '30m'])).toMatchObject({ file: 'f.json', pane: true, tab: 't1', since: '30m' })
    expect(() => parseArgs(['a', 'b'])).toThrow(/unknown argument b/)
  })
})

describe('headless run', () => {
  it.skipIf(!findChrome())('clicks by text, waits, reads and shoots a real page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-flow-'))
    const page = join(dir, 'page.html')
    writeFileSync(page, '<button onclick="document.querySelector(\'p\').textContent = \'Added \' + document.querySelector(\'input\').value">Add note</button><input><p>empty</p>')
    const steps = join(dir, 'steps.json')
    writeFileSync(steps, JSON.stringify({ base: pathToFileURL(page).href, out: dir, width: 375, steps: [{ type: 'TEST', into: 'input' }, { click: { text: 'add note' } }, { wait: { text: 'Added' } }, { read: 'p' }, { shot: 'after' }] }))
    const lines = []
    expect(await run({ file: steps }, (l) => lines.push(l))).toBe(0)
    expect(lines.join('\n')).toMatch(/ok\s+4 read\n\s+Added TEST/)
    expect(existsSync(join(dir, 'after.jpg'))).toBe(true)
  }, 30000)
})
