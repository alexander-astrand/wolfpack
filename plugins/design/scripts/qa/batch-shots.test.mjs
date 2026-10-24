import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadList, parseArgs, run, shotUrl, viewportFor } from './batch-shots.mjs'
import { findChrome } from './cdp.mjs'
import { parseArgs as scaffoldArgs, scaffold } from '../mock-scaffold.mjs'

describe('viewportFor', () => {
  it('uses the real viewports spidey-sense names', () => {
    expect(viewportFor(375)).toEqual({ width: 375, height: 812 })
    expect(viewportFor(1024)).toEqual({ width: 1024, height: 768 })
    expect(viewportFor(1440)).toEqual({ width: 1440, height: 900 })
    expect(viewportFor(1920)).toEqual({ width: 1920, height: 1080 })
    expect(viewportFor(375, 1700)).toEqual({ width: 375, height: 1700 })
  })
})

describe('shotUrl', () => {
  it('adds the query and, for param themes, the theme', () => {
    expect(shotUrl('http://localhost:5174/mock/t?x=1', { query: { option: 'b' }, theme: 'dark' })).toBe('http://localhost:5174/mock/t?x=1&option=b&theme=dark')
    expect(shotUrl('file:///m/mock.html', { theme: 'amber' }, 'param:look')).toBe('file:///m/mock.html?look=amber')
    expect(shotUrl('http://h/p', { theme: 'dark' }, 'storage:app-theme')).toBe('http://h/p')
  })
})

describe('loadList', () => {
  it('names every problem at once', () => {
    expect(() => loadList('{"shots":[{"width":375},{"name":"a","width":"x"},{"name":"a","width":1}],"themeVia":"cookie"}')).toThrow(
      /no "base".*no "out".*themeVia "cookie".*shot 0 has no name.*shot a has no whole-number width.*two shots are named a/,
    )
  })
  it('defaults themeVia to the ?theme= param', () => {
    expect(loadList('{"base":"http://h/","out":"/o","shots":[{"name":"a","width":375}]}').themeVia).toBe('param:theme')
  })
})

describe('parseArgs', () => {
  it('reads the list and the flags', () => {
    expect(parseArgs(['s.json', '--only', 'a,b', '--scan'])).toEqual({ list: 's.json', only: ['a', 'b'], scan: true, dry: false })
    expect(() => parseArgs(['a', 'b'])).toThrow(/unknown argument b/)
  })
})

// Needs a cached Chromium (Pollux has Playwright's); CI has none and skips it.
describe.skipIf(!findChrome())('a scaffolded mock, shot in one call', () => {
  it('saves every shot at its width, with a scan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shots-'))
    const css = join(dir, 'tokens.css')
    writeFileSync(css, ':root { --bg: #fff; --ink: #222 } [data-theme="dark"] { --bg: #111; --ink: #eee }')
    scaffold(scaffoldArgs([join(dir, 'm'), '--topic', 'tt', '--tokens', css, '--out', join(dir, 'out')]))
    const code = await run({ list: join(dir, 'm/shots.json'), scan: true })
    expect(code).toBe(0)
    for (const n of ['tt-a-375-dark', 'tt-a-1024-dark', 'tt-a-375-light', 'tt-b-375-dark', 'tt-b-1024-dark', 'tt-b-375-light']) {
      expect(existsSync(join(dir, 'out', `${n}.jpg`))).toBe(true)
    }
    const scans = JSON.parse(readFileSync(join(dir, 'out/scan.json'), 'utf8'))
    expect(scans['tt-a-1024-dark'].width).toBe(1024)
    expect(scans['tt-a-375-dark'].counts).toHaveProperty('lowContrast')
  }, 60000)
})
