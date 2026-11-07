import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WIDGET, fromDiff, pageUrl, paneBatches, parseArgs, parsePass, rowsFor, run, table, tellsOffFrom } from './qa-pass.mjs'
import { findChrome } from './qa/cdp.mjs'
import { layoutPrefix, pagesFor, routeOf } from './qa/diff-pages.mjs'

// A Next app-router project the shape of Burrow's: a route group, a dynamic page, components and a lib.
function nextProject() {
  const root = mkdtempSync(join(tmpdir(), 'qa-diff-'))
  const w = (p, s) => {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), s)
  }
  w('.claude/kit.json', JSON.stringify({ project: { devPort: 3027 }, qa: { themes: ['light', 'dark'], routes: { 'styles/money': ['/money'] } } }))
  w('app/layout.tsx', "import './globals.css'\nexport default function L() {}\n")
  w('app/(home)/page.tsx', "import { Hero } from '@/components/hero'\nexport default function P() {}\n")
  w('app/(home)/money/page.tsx', "import Spend from '@/components/money/spend-import'\nexport default function P() {}\n")
  w('app/(home)/money/layout.tsx', 'export default function L() {}\n')
  w('app/(home)/trips/[id]/page.tsx', "import { Box } from '../../../../components/trips/box'\nexport default function P() {}\n")
  w('app/api/x/route.ts', 'export function GET() {}\n')
  w('components/hero.tsx', 'export const Hero = 1\n')
  w('components/money/spend-import.tsx', "import { parse } from '@/lib/money-import'\nexport default function S() {}\n")
  w('components/trips/box.tsx', "export { parse } from '@/lib/money-import'\nexport const Box = 1\n")
  w('lib/money-import.ts', 'export const parse = 1\n')
  w('lib/unused.ts', 'export const u = 1\n')
  return root
}

describe('diff pages', () => {
  it('maps route files, groups and pages router files to URLs', () => {
    expect(routeOf('app/page.tsx')).toBe('/')
    expect(routeOf('app/(home)/money/page.tsx')).toBe('/money')
    expect(routeOf('src/app/@modal/(x)/notes/page.jsx')).toBe('/notes')
    expect(routeOf('app/api/x/route.ts')).toBeNull()
    expect(routeOf('pages/index.tsx')).toBe('/')
    expect(routeOf('pages/trips/index.tsx')).toBe('/trips')
    expect(routeOf('pages/_app.tsx')).toBeNull()
    expect(routeOf('pages/api/x.ts')).toBeNull()
    expect(layoutPrefix('app/layout.tsx')).toBe('/')
    expect(layoutPrefix('app/(home)/money/layout.tsx')).toBe('/money')
  })

  it('walks a lib change up through its importers to every page, and keeps dynamic and unmapped apart', () => {
    const root = nextProject()
    const r = pagesFor(root, ['lib/money-import.ts', 'lib/unused.ts', 'README.md', 'styles/money.css'], { routes: { 'styles/money': ['/money'] } })
    expect(r.pages).toEqual(['/money'])
    expect(r.needsParams).toEqual(['/trips/[id]'])
    expect(r.unmapped).toEqual(['lib/unused.ts', 'README.md'])
    expect(r.why['/money']).toEqual(['lib/money-import.ts', 'styles/money.css'])
    rmSync(root, { recursive: true, force: true })
  })

  it('gives a layout every page under it', () => {
    const root = nextProject()
    expect(pagesFor(root, ['app/layout.tsx']).pages).toEqual(['/', '/money'])
    expect(pagesFor(root, ['app/(home)/money/layout.tsx']).pages).toEqual(['/money'])
    rmSync(root, { recursive: true, force: true })
  })

  it('writes a pass file qa-pass reads, from a real git diff', () => {
    const root = nextProject()
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' })
    git('init', '-q')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')
    writeFileSync(join(root, 'components/hero.tsx'), 'export const Hero = 2\n')
    const out = join(root, 'pass.json')
    const lines = []
    expect(fromDiff({ fromDiff: 'HEAD', root, out }, (l) => lines.push(l))).toBe(0)
    const p = parsePass(readFileSync(out, 'utf8'), out)
    expect(p).toMatchObject({ base: 'http://localhost:3027', pages: ['/'], widths: [375, 1024], themes: ['light', 'dark'] })
    expect(lines[0]).toMatch(/1 pages from 1 changed files against HEAD/)
    expect(lines[1]).toBe('- /: components/hero.tsx')
    rmSync(root, { recursive: true, force: true })
  })

  it('exits 1 when the diff reaches no page, and parses its flags', () => {
    const root = nextProject()
    expect(fromDiff({ fromDiff: 'x', root }, () => {}, { changed: ['lib/unused.ts'] })).toBe(1)
    expect(parseArgs(['--from-diff', 'main', '--root', '/p', '--out', '/p/pass.json'])).toMatchObject({ fromDiff: 'main', root: '/p', out: '/p/pass.json' })
    expect(() => parseArgs(['--from-diff'])).toThrow(/needs a value/)
    rmSync(root, { recursive: true, force: true })
  })
})

const pass = (o = {}) => parsePass(JSON.stringify({ base: 'http://localhost:5174', pages: ['/notes'], ...o }))

describe('parsePass', () => {
  it('fills the defaults', () => {
    expect(pass()).toEqual({ base: 'http://localhost:5174', pages: ['/notes'], widths: [375, 1024], themes: [], themeVia: 'param:theme', widget: DEFAULT_WIDGET, tellsOff: [] })
  })
  it('takes a list of tells to turn off', () => {
    expect(pass({ tellsOff: ['glow-shadow'] }).tellsOff).toEqual(['glow-shadow'])
    expect(() => pass({ tellsOff: 'glow-shadow' })).toThrow(/"tellsOff" is not a list/)
  })
})

describe('tellsOffFrom', () => {
  it('reads every `tells: off` line in a taste.md, bullets and backticks included', () => {
    expect(tellsOffFrom('## Colour\n- `tells: off gradient-text, glow-shadow`\nWe like warm.\ntells: off nested-cards\n')).toEqual(['gradient-text', 'glow-shadow', 'nested-cards'])
    expect(tellsOffFrom('No tells line here; tells are fine.')).toEqual([])
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
  it('makes nonText a must and gives tells an advisory row of their own', () => {
    const rows = rowsFor('/n', [{ width: 375, theme: null, counts: { nonText: 1, smallTargets: 0 }, tells: { 'glow-shadow': { count: 2, examples: [] }, 'side-stripe': { count: 1, examples: [] } } }], null, null, null)
    expect(rows).toEqual([
      { page: '/n', check: 'scan 375', result: 'nonText 1', finding: 'yes' },
      { page: '/n', check: 'tells 375', result: 'glow-shadow 2, side-stripe 1', finding: '' },
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
  it('carries tellsOff into the scan args', () => {
    const { batches } = paneBatches(pass({ tellsOff: ['icon-tile'] }), { tab: 't1' })
    expect(batches[0].actions[2].input.text).toContain('"tellsOff":["icon-tile"]')
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
