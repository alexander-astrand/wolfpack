#!/usr/bin/env node
// One QA pass as one script: the page scan at every width and theme, the wheel and two-scrollbar
// checks, and console errors, returned as one table. Kit 1.8 (kit 1.7.1 council Feature 8, design
// lens Feature 3): bengt-johansson resumed 14 of 18 passes while running qa-and-refactor.md's
// snippets one call at a time, so the Bengan Boys and daredevil now read a table instead.
//
//   node <design>/scripts/qa-pass.mjs <pass.json> [--pane [--tab <tabId>]] [--dry]
//
// Headless (the default): one headless Chromium (qa/cdp.mjs) loads each page at each width and
// theme, runs qa/page-scan.js there, then at 1024 lists every scrolling element and every widget,
// sends a real wheel over each widget and checks the page or its column moved, and collects the
// console errors. No sign-in, so it is for mocks and public pages, like qa/batch-shots.mjs.
// --pane: for a signed-in page, prints one `browser_batch` list per page for your own tab
// (resize to 1024, navigate, one javascript_tool call, read_console_messages): the javascript_tool
// result is the page's table, the page scan carried inline, so no public/qa copy is needed. In the
// pane the wheel is a synthetic event: "catches" means a handler cancels it or the widget is an
// iframe; confirm that one spot with a real `computer` scroll (qa-and-refactor.md) before calling it.
// Keep a pane page to about six views (3 widths x 2 themes): a javascript_tool call stops at 45 s.
// --dry: checks the file and prints what would run.
//
// pass.json:
//   { "base": "http://localhost:5174", "pages": ["/notes", "/trips/1"],
//     "widths": [375, 1024, 1440], "themes": ["dark", "light"], "themeVia": "param:theme",
//     "widget": "iframe, .leaflet-container, [data-map]" }      optional; sideways rows are always found
// The table: page | check | result | finding ("yes", "look" for small targets, blank when clean).
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyTheme, viewportFor } from './qa/batch-shots.mjs'
import { launch, sleep } from './qa/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SCAN_SRC = () => readFileSync(join(here, 'qa', 'page-scan.js'), 'utf8')
export const DEFAULT_WIDGET = 'iframe, .leaflet-container, .maplibregl-map, .mapboxgl-map, [data-map]'
const THEME_VIA = /^(param:\S+|storage:\S+|attr:\S+|class)$/

// Checks the whole file and names every problem at once, as qa-flow.mjs's parseFlow does.
export function parsePass(text, file = 'pass.json') {
  let p
  try {
    p = JSON.parse(text)
  } catch (e) {
    throw new Error(`${file}: not JSON (${e.message})`)
  }
  const errors = []
  if (!p.base) errors.push('no "base" URL')
  if (!Array.isArray(p.pages) || !p.pages.length || p.pages.some((x) => typeof x !== 'string' || !x)) errors.push('"pages" is not a list of paths')
  const widths = p.widths ?? [375, 1024]
  if (!Array.isArray(widths) || !widths.length || widths.some((w) => !Number.isInteger(w))) errors.push('"widths" is not a list of whole numbers')
  const themes = p.themes ?? []
  if (!Array.isArray(themes) || themes.some((t) => typeof t !== 'string')) errors.push('"themes" is not a list of names')
  const themeVia = p.themeVia ?? 'param:theme'
  if (!THEME_VIA.test(themeVia)) errors.push(`themeVia "${themeVia}" is not param:<name>, storage:<key>, attr:<name> or class`)
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`)
  return { base: p.base, pages: p.pages, widths, themes, themeVia, widget: p.widget || DEFAULT_WIDGET }
}

export function pageUrl(pass, path, theme) {
  const u = new URL(path, pass.base)
  if (theme && pass.themeVia.startsWith('param:')) u.searchParams.set(pass.themeVia.slice(6), theme)
  return u.href
}

// Runs in the page, so it stands alone: the scrolling elements (dialogs and menus left out, since a
// sheet scrolling on its own is fine) and the widgets, each marked so the headless wheel can find it.
export function probe(widget) {
  const sel = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].slice(0, 3).map((c) => `.${c}`).join('')
  const visible = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const all = [...document.querySelectorAll('body *')]
  const bars = all
    .filter((e) => !e.closest('[role=dialog],[role=alertdialog],[role=menu],[role=listbox],dialog'))
    .filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
    .map((e) => {
      const s = getComputedStyle(e)
      const bar = e.offsetWidth - e.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth)
      // macOS overlay bars measure 0 until scrolled, so scrollbar-width counts too (qa-and-refactor.md).
      return { sel: sel(e), shows: bar > 0 || s.scrollbarWidth !== 'none' }
    })
  const rows = all.filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1 && visible(e))
  const found = [...new Set([...document.querySelectorAll(widget)].filter(visible).concat(rows))]
  const widgets = found.map((e, i) => {
    e.setAttribute('data-qa-pass-widget', String(i))
    const r = e.getBoundingClientRect()
    const iframe = e.tagName === 'IFRAME'
    let catches = iframe && getComputedStyle(e).pointerEvents !== 'none'
    if (!iframe) {
      const ev = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })
      e.dispatchEvent(ev)
      catches = ev.defaultPrevented
    }
    return { i, sel: sel(e), kind: iframe ? 'iframe' : rows.includes(e) ? 'row' : 'widget', catches }
  })
  return { bars, pageScrolls: document.documentElement.scrollHeight > innerHeight, widgets }
}

// Stands alone too (the pane builds the table in the page): scan views, scrollbars, wheel, console.
export function rowsFor(page, views, pr, wheel, consoleErrors) {
  const rows = []
  const MUST = ['overflow', 'cutOff', 'rowsWithoutDrag', 'lowContrast']
  for (const v of views) {
    const hits = Object.entries(v.counts).filter(([, n]) => n > 0)
    const finding = hits.some(([k]) => MUST.includes(k)) ? 'yes' : hits.length ? 'look' : ''
    rows.push({ page, check: `scan ${v.width}${v.theme ? ` ${v.theme}` : ''}`, result: hits.length ? hits.map(([k, n]) => `${k} ${n}`).join(', ') : 'clean', finding })
  }
  if (pr) {
    const showing = (pr.pageScrolls ? ['page'] : []).concat(pr.bars.filter((b) => b.shows).map((b) => b.sel))
    rows.push({ page, check: 'scrollbars 1024', result: showing.length ? `${showing.length}: ${showing.join(', ')}` : 'none', finding: showing.length > 1 ? 'yes' : '' })
    for (const w of pr.widgets) {
      const real = wheel?.[w.i]
      const result = real ? (real.moved ? 'the page or its column moved' : real.atEnd ? 'already at the end (not judged)' : 'caught the wheel') : w.catches ? 'catches the wheel (synthetic): confirm with a real scroll' : 'passes the wheel on'
      rows.push({ page, check: `wheel ${w.kind} ${w.sel}`, result, finding: real ? (real.moved || real.atEnd ? '' : 'yes') : w.catches ? 'yes' : '' })
    }
  }
  if (consoleErrors) rows.push({ page, check: 'console', result: consoleErrors.length ? `${consoleErrors.length}: ${consoleErrors[0].slice(0, 120)}` : 'no errors', finding: consoleErrors.length ? 'yes' : '' })
  return rows
}

export function table(rows) {
  const cell = (s) => String(s).replace(/\|/g, '\\|')
  return ['| page | check | result | finding |', '|---|---|---|---|', ...rows.map((r) => `| ${cell(r.page)} | ${cell(r.check)} | ${cell(r.result)} | ${r.finding} |`)].join('\n')
}

// The in-page program for the pane: the scan's iframe matrix, the probe, and the table as text.
export function paneScript(pass, path) {
  const args = { widths: pass.widths, themeVia: pass.themeVia, ...(pass.themes.length ? { themes: pass.themes } : {}) }
  return [
    `window.__scanArgs = ${JSON.stringify(args)}`,
    `const scan = JSON.parse(await eval(${JSON.stringify(SCAN_SRC())}))`,
    `const pr = (${probe.toString()})(${JSON.stringify(pass.widget)})`,
    `;(${table.toString()})((${rowsFor.toString()})(${JSON.stringify(path)}, scan.views, pr, null, null))`,
  ].join('\n')
}

export function paneBatches(pass, { tab = '<tabId>' } = {}) {
  return {
    batches: pass.pages.map((path) => ({
      page: path,
      actions: [
        { name: 'resize_window', input: { width: 1024, height: 768, tabId: tab } },
        { name: 'navigate', input: { url: pageUrl(pass, path), tabId: tab } },
        { name: 'javascript_tool', input: { action: 'javascript_exec', text: paneScript(pass, path), tabId: tab } },
        { name: 'read_console_messages', input: { onlyErrors: true, limit: 20, tabId: tab } },
      ],
    })),
    after: { name: 'resize_window', input: { preset: 'desktop', tabId: tab } },
  }
}

export function parseArgs(argv) {
  const o = { file: null, pane: false, tab: undefined, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pane') o.pane = true
    else if (a === '--tab') o.tab = argv[++i]
    else if (a === '--dry') o.dry = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (!o.file) o.file = a
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

async function load(cdp, pass, path, width, theme) {
  const { width: w, height } = viewportFor(width)
  const mobile = w < 768
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  if (theme === 'dark' || theme === 'light') await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  const url = pageUrl(pass, path, theme)
  if (theme && pass.themeVia.startsWith('storage:')) {
    await cdp.goto(url)
    await cdp.evaluate(`localStorage.setItem(${JSON.stringify(pass.themeVia.slice(8))}, ${JSON.stringify(theme)}); true`)
  }
  await cdp.goto(url)
  await applyTheme(cdp, pass.themeVia, theme)
  await cdp.settle()
}

const errorsIn = (events) =>
  events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
    .map((e) => (e.method === 'Runtime.exceptionThrown' ? e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text : e.params.args.map((a) => a.value ?? a.description ?? '').join(' ')))

// A real wheel at the widget's centre: did the page, or the column holding the widget, move?
async function wheelOver(cdp, i) {
  const where = await cdp.evaluate(`(() => {
    const e = document.querySelector('[data-qa-pass-widget="${i}"]'); e.scrollIntoView({ block: 'center' })
    const col = e.parentElement?.closest('aside, [data-column]') ?? null; window.__qaCol = col
    const r = e.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, y0: scrollY, c0: col?.scrollTop ?? null,
      atEnd: scrollY >= document.documentElement.scrollHeight - innerHeight - 1 && (!col || col.scrollTop >= col.scrollHeight - col.clientHeight - 1) }
  })()`)
  await sleep(200)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: where.x, y: where.y, deltaX: 0, deltaY: 300 })
  await sleep(400)
  const after = await cdp.evaluate('({ y: scrollY, c: window.__qaCol?.scrollTop ?? null })')
  return { moved: after.y !== where.y0 || (where.c0 !== null && after.c !== where.c0), atEnd: where.atEnd }
}

async function headless(pass, log) {
  const src = SCAN_SRC()
  const { cdp, close } = await launch()
  const rows = []
  try {
    await cdp.send('Runtime.enable')
    for (const path of pass.pages) {
      const views = []
      const errors = new Set()
      for (const width of pass.widths) {
        for (const theme of pass.themes.length ? pass.themes : [null]) {
          await load(cdp, pass, path, width, theme)
          const scan = JSON.parse(await cdp.evaluate(`window.__scanArgs = {}; await eval(${JSON.stringify(src)})`))
          views.push({ ...scan.views[0], width, theme })
          for (const e of errorsIn(cdp.events)) errors.add(e)
        }
      }
      await load(cdp, pass, path, 1024, pass.themes[0] ?? null)
      const pr = await cdp.evaluate(`(${probe.toString()})(${JSON.stringify(pass.widget)})`)
      const wheel = {}
      for (const w of pr.widgets) wheel[w.i] = await wheelOver(cdp, w.i)
      for (const e of errorsIn(cdp.events)) errors.add(e)
      rows.push(...rowsFor(path, views, pr, wheel, [...errors]))
    }
  } finally {
    await close()
  }
  log(table(rows))
  return rows.some((r) => r.finding === 'yes') ? 1 : 0
}

export async function run(o, log = console.log) {
  const pass = parsePass(readFileSync(resolve(o.file), 'utf8'), o.file)
  if (o.pane) {
    log(JSON.stringify(paneBatches(pass, { tab: o.tab }), null, 2))
    return 0
  }
  if (o.dry) {
    for (const p of pass.pages) log(`${pageUrl(pass, p)}  widths ${pass.widths.join(', ')}  themes ${pass.themes.join(', ') || '-'}`)
    return 0
  }
  return headless(pass, log)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let o
  try {
    o = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  if (o.help || !o.file) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 26).join('\n'))
    process.exit(o.file || o.help ? 0 : 2)
  }
  run(o).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message)
      process.exit(1)
    },
  )
}
