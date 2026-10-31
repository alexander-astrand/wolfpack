#!/usr/bin/env node
// Every shot in a list, in one call: one headless Chromium, one page, each shot at its own width
// and theme, saved as a JPEG under its name. Kit 1.5 (jedi-council 2.5): mosbius-designs ran one
// process per shot and lost turns to a dropped phone size; the QA agents lost turns to a hidden pane.
//
//   node <design>/scripts/qa/batch-shots.mjs <shots.json> [--only <name,name>] [--scan] [--dry]
//
// <design> is the design plugin's folder (${CLAUDE_PLUGIN_ROOT} inside the plugin).
// shots.json (mock-scaffold.mjs writes one; any page list works the same):
//   {
//     "base": "file:///abs/path/mock.html" or "http://localhost:5174/mock/topic",
//     "out": "/abs/folder/for/the/jpgs",
//     "themeVia": "param:theme" | "storage:<localStorage key>" | "attr:<attribute>" | "class",
//     "shots": [{ "name": "topic-a-375-dark", "query": { "option": "a" }, "width": 375, "theme": "dark",
//                 "height": 812, "full": false, "js": "document.querySelector('[data-sheet]').click()" }]
//   }
// Each shot checks that the page really got its width (innerWidth), so a dropped phone size fails
// loudly instead of saving a desktop shot under a 375 name. --scan also runs page-scan.js on each
// shot and writes <out>/scan.json (geometry and contrast, the same scan QA runs in the pane).
// No sign-in: it shoots mocks and pages that need no login. Signed-in pages go through the pane.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launch, sleep } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// The real viewports spidey-sense names: short, so a shot shows what a person sees first.
export function viewportFor(width, height) {
  if (height) return { width, height }
  const h = width < 768 ? 812 : width <= 1024 ? 768 : width <= 1440 ? 900 : 1080
  return { width, height: h }
}

export function shotUrl(base, shot, themeVia = 'param:theme') {
  const u = new URL(base)
  for (const [k, v] of Object.entries(shot.query ?? {})) u.searchParams.set(k, String(v))
  if (shot.theme && themeVia.startsWith('param:')) u.searchParams.set(themeVia.slice(6), shot.theme)
  return u.href
}

export function loadList(text, file = 'shots.json') {
  const list = JSON.parse(text)
  const errors = []
  if (!list.base) errors.push('no "base" URL')
  if (!list.out) errors.push('no "out" folder')
  if (!Array.isArray(list.shots) || !list.shots.length) errors.push('no "shots"')
  const via = list.themeVia ?? 'param:theme'
  if (!/^(param:\S+|storage:\S+|attr:\S+|class)$/.test(via)) errors.push(`themeVia "${via}" is not param:<name>, storage:<key>, attr:<name> or class`)
  const names = new Set()
  for (const [i, s] of (list.shots ?? []).entries()) {
    if (!s.name) errors.push(`shot ${i} has no name`)
    else if (names.has(s.name)) errors.push(`two shots are named ${s.name}`)
    names.add(s.name)
    if (!Number.isInteger(s.width)) errors.push(`shot ${s.name ?? i} has no whole-number width`)
  }
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`)
  return { ...list, themeVia: via }
}

export function parseArgs(argv) {
  const o = { list: null, only: null, scan: false, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--only') o.only = argv[++i].split(',')
    else if (a === '--scan') o.scan = true
    else if (a === '--dry') o.dry = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (!o.list) o.list = a
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

// Exported for qa-pass.mjs, which scans each width and theme the same way.
export async function applyTheme(cdp, via, theme) {
  if (!theme) return
  if (via.startsWith('attr:')) await cdp.evaluate(`document.documentElement.setAttribute(${JSON.stringify(via.slice(5))}, ${JSON.stringify(theme)}); true`)
  else if (via === 'class') await cdp.evaluate(`document.documentElement.classList.add(${JSON.stringify(theme)}); true`)
  else return
  await sleep(100)
}

async function shoot(cdp, list, shot, scanSrc) {
  const { width, height } = viewportFor(shot.width, shot.height)
  const mobile = width < 768
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  // An app that follows the system theme gets it from here; one with its own switch from themeVia.
  if (shot.theme === 'dark' || shot.theme === 'light') await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: shot.theme }] })
  const url = shotUrl(list.base, shot, list.themeVia)
  if (list.themeVia.startsWith('storage:') && shot.theme) {
    await cdp.goto(url)
    await cdp.evaluate(`localStorage.setItem(${JSON.stringify(list.themeVia.slice(8))}, ${JSON.stringify(shot.theme)}); true`)
  }
  await cdp.goto(url)
  await applyTheme(cdp, list.themeVia, shot.theme)
  if (shot.js) await cdp.evaluate(shot.js)
  await cdp.settle()
  const inner = await cdp.evaluate('innerWidth')
  if (inner !== width) throw new Error(`the page got ${inner}px, not ${width}px`)
  // The same call shape as the pane's: an explicit await, since REPL mode leaves a bare promise unawaited.
  const scan = scanSrc ? JSON.parse(await cdp.evaluate(`window.__scanArgs = {}; await eval(${JSON.stringify(scanSrc)})`)) : null
  const params = { format: 'jpeg', quality: 80 }
  if (shot.full) {
    const h = await cdp.evaluate('document.documentElement.scrollHeight')
    Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } })
  }
  const { data } = await cdp.send('Page.captureScreenshot', params)
  const file = join(list.out, `${shot.name}.jpg`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  return { file, width, height, scan }
}

export async function run(o) {
  const list = loadList(readFileSync(resolve(o.list), 'utf8'), o.list)
  const shots = o.only ? list.shots.filter((s) => o.only.includes(s.name)) : list.shots
  if (!shots.length) throw new Error(`--only matched no shot in ${o.list}`)
  if (o.dry) {
    for (const s of shots) console.log(`${s.name}  ${s.width}  ${s.theme ?? '-'}  ${shotUrl(list.base, s, list.themeVia)}`)
    return 0
  }
  mkdirSync(list.out, { recursive: true })
  const scanSrc = o.scan ? readFileSync(join(here, 'page-scan.js'), 'utf8') : null
  const { cdp, close } = await launch()
  const scans = {}
  let failed = 0
  try {
    for (const s of shots) {
      try {
        const r = await shoot(cdp, list, s, scanSrc)
        const counts = r.scan ? `  scan ${Object.entries(r.scan.views[0].counts).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''
        if (r.scan) scans[s.name] = r.scan.views[0]
        console.log(`ok    ${r.file}  ${r.width}x${r.height} ${s.theme ?? ''}${counts}`)
      } catch (e) {
        failed++
        console.log(`FAIL  ${s.name}: ${e.message}`)
      }
    }
  } finally {
    await close()
  }
  if (o.scan) writeFileSync(join(list.out, 'scan.json'), JSON.stringify(scans, null, 2))
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let o
  try {
    o = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  if (o.help || !o.list) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n'))
    process.exit(o.list || o.help ? 0 : 2)
  }
  run(o).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message)
      process.exit(1)
    },
  )
}
