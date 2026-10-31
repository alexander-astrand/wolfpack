import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WIDGET, pageUrl, paneBatches, parseArgs, parsePass, rowsFor, run, table } from './qa-pass.mjs'
import { findChrome } from './qa/cdp.mjs'

const pass = (o = {}) => parsePass(JSON.stringify({ base: 'http://localhost:5174', pages: ['/notes'], ...o }))

describe('parsePass', () => {
  it('fills the defaults', () => {
    expect(pass()).toEqual({ base: 'http://localhost:5174', pages: ['/notes'], widths: [375, 1024], themes: [], themeVia: 'param:theme', widget: DEFAULT_WIDGET })
  })
  it('names every problem at once', () => {
    expect(() => parsePass(JSON.stringify({ pages: [], widths: ['x'], themeVia: 'cookie' }), 'p.json')).toThrow(/p\.json: no "base" URL; "pages" is not a list of paths; "widths" is not a list of whole numbers; themeVia "cookie"/)
    expect(() => parsePass('{', 'p.json')).toThrow(/not JSON/)
  })
})

describe('pageUrl', () => {
  it('adds a param theme only', () => {
    expect(pageUrl(pass(), '/notes', 'dark')).toBe('http://localhost:5174/notes?theme=dark')
    expect(pageUrl(pass({ themeVia: 'storage:app-theme' }), '/notes', 'dark')).toBe('http://localhost:5174/notes')
  })
})

describe('rowsFor and table', () => {
  const views = [
    { width: 375, theme: 'dark', counts: { overflow: 1, smallTargets: 0 } },
    { width: 1024, theme: 'dark', counts: { overflow: 0, smallTargets: 2 } },
    { width: 1440, theme: null, counts: { overflow: 0 } },
  ]
  const pr = { pageScrolls: true, bars: [{ sel: 'aside.side', shows: true }, { sel: 'div.sheet', shows: false }], widgets: [{ i: 0, sel: 'iframe', kind: 'iframe', catches: true }, { i: 1, sel: 'div.row', kind: 'row', catches: false }] }
  it('marks musts, looks and clean views, two scrollbars and the console', () => {
    const rows = rowsFor('/n', views, pr, null, ['TypeError: x'])
    expect(rows.map((r) => [r.check, r.finding])).toEqual([
      ['scan 375 dark', 'yes'],
      ['scan 1024 dark', 'look'],
      ['scan 1440', ''],
      ['scrollbars 1024', 'yes'],
      ['wheel iframe iframe', 'yes'],
      ['wheel row div.row', ''],
      ['console', 'yes'],
    ])
    expect(rows[3].result).toBe('2: page, aside.side')
  })
  it('judges a real wheel over a synthetic one, and leaves a widget at the end unjudged', () => {
    const rows = rowsFor('/n', [], pr, { 0: { moved: true }, 1: { moved: false, atEnd: true } }, null)
    expect(rows.slice(1).map((r) => [r.result, r.finding])).toEqual([
      ['the page or its column moved', ''],
      ['already at the end (not judged)', ''],
    ])
  })
  it('prints a markdown table with pipes kept as text', () => {
    expect(table([{ page: '/a', check: 'console', result: 'a | b', finding: 'yes' }])).toBe('| page | check | result | finding |\n|---|---|---|---|\n| /a | console | a \\| b | yes |')
  })
})

describe('paneBatches', () => {
  it('gives one batch per page with the scan inline and the console read', () => {
    const { batches, after } = paneBatches(pass({ pages: ['/a', '/b'], themes: ['dark'] }), { tab: 't1' })
    expect(batches.map((b) => b.page)).toEqual(['/a', '/b'])
    expect(batches[0].actions.map((a) => a.name)).toEqual(['resize_window', 'navigate', 'javascript_tool', 'read_console_messages'])
    const js = batches[0].actions[2].input
    expect(js.tabId).toBe('t1')
    expect(js.text).toContain('window.__scanArgs = {"widths":[375,1024],"themeVia":"param:theme","themes":["dark"]}')
    expect(js.text).toContain('page-scan.js: one page')
    expect(js.text).not.toContain("fetch('/qa/page-scan.js')).text(); JSON.parse(await eval(src))\n")
    expect(after.input).toEqual({ preset: 'desktop', tabId: 't1' })
  })
})

describe('parseArgs', () => {
  it('reads the flags', () => {
    expect(parseArgs(['p.json', '--pane', '--tab', 't'])).toMatchObject({ file: 'p.json', pane: true, tab: 't' })
    expect(() => parseArgs(['a', 'b'])).toThrow(/unknown argument b/)
  })
})

describe('headless run', () => {
  it.skipIf(!findChrome())('scans, finds two scrollbars and a widget that eats the wheel, and reads the console', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-pass-'))
    const page = join(dir, 'page.html')
    writeFileSync(
      page,
      `<style>body{margin:0} main{height:2000px} aside{position:fixed;right:0;top:0;width:200px;height:300px;overflow-y:auto} aside div{height:900px}</style>
<main><div id="map" data-map style="width:300px;height:200px;background:#ccc">map</div></main><aside><div>side</div></aside>
<script>document.getElementById('map').addEventListener('wheel', (e) => e.preventDefault(), { passive: false }); console.error('boom')</script>`,
    )
    const file = join(dir, 'pass.json')
    writeFileSync(file, JSON.stringify({ base: pathToFileURL(page).href, pages: [pathToFileURL(page).href], widths: [1024] }))
    const lines = []
    expect(await run({ file }, (l) => lines.push(l))).toBe(1)
    const out = lines.join('\n')
    expect(out).toMatch(/\| scan 1024 \|/)
    expect(out).toMatch(/\| scrollbars 1024 \| 2: page, aside \| yes \|/)
    expect(out).toMatch(/\| wheel widget div#map \| caught the wheel \| yes \|/)
    expect(out).toMatch(/\| console \| 1: boom \| yes \|/)
  }, 30000)
})
