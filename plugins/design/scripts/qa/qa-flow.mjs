#!/usr/bin/env node
// A scripted click-through from a steps file, so a QA pass ships one JSON file instead of writing
// scratch scripts. Kit 1.7 (jedi-council Feature 11, design lens F5): the Boys' cheaper lines asked
// for a ready steps file again and again, and a scratch heredoc into the plans folder was refused.
//
//   node <design>/scripts/qa/qa-flow.mjs <steps.json> [--pane [--tab <tabId>] [--since <ISO time>]] [--dry]
//
// Headless (the default): one headless Chromium (cdp.mjs) runs the flow and prints one line per
// step, with the text a `read` or `js` step returned; `shot` steps save <out>/<name>.jpg. No sign-in,
// so it is for mocks and public pages, like batch-shots.mjs.
// --pane: prints the same flow as Browser pane calls for a signed-in tab instead, as JSON
// `{ "batches": [{ "actions": [...], "after": "<save-shot line>" }] }`: pass each `actions` list to
// one `browser_batch` call, then run its `after` line (one batch per shot, since save-shot.mjs keeps
// only the newest image). The step results come back from the `javascript_tool` items as text.
// --dry: checks the file and prints what would run.
//
// steps.json:
//   { "base": "http://localhost:5174", "out": "/abs/scratchpad/qa-3",
//     "width": 375, "theme": "dark", "themeVia": "param:theme",
//     "steps": [
//       { "open": "/notes" },                          path on base, or a full URL
//       { "click": "button[aria-label='Add note']" },  a CSS selector, or
//       { "click": { "text": "Save" } },               a button, link or tab by its text or aria-label
//       { "type": "TEST QA note", "into": "textarea" },  into: a target as for click; default the focused element
//       { "key": "Enter" },                            to the focused element; Enter submits its form
//       { "wait": 500 }, { "wait": ".toast" }, { "wait": { "text": "Saved" } },  ms, a selector, or page text
//       { "read": "main" },                            the element's text (true: the whole page)
//       { "js": "document.title" },                    any expression; its value is printed
//       { "shot": "notes-375-dark" } ] }               a name for <out>/<name>.jpg
// click, type and wait take "timeout" (ms, default 5000). The first failing step stops the flow.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { viewportFor } from './batch-shots.mjs'
import { launch, sleep } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export const KINDS = ['open', 'click', 'type', 'key', 'wait', 'read', 'js', 'shot']
const EXTRAS = { type: ['into', 'timeout'], click: ['timeout'], wait: ['timeout'] }

const isTarget = (t) => (typeof t === 'string' && t.trim() !== '') || (t && typeof t === 'object' && typeof t.text === 'string' && t.text !== '')

// Checks the whole file and names every problem at once, as batch-shots.mjs's loadList does.
export function parseFlow(text, file = 'steps.json') {
  let flow
  try {
    flow = JSON.parse(text)
  } catch (e) {
    throw new Error(`${file}: not JSON (${e.message})`)
  }
  const errors = []
  const steps = Array.isArray(flow.steps) ? flow.steps : []
  if (!steps.length) errors.push('no "steps"')
  const via = flow.themeVia ?? 'param:theme'
  if (!/^(param:\S+|storage:\S+|attr:\S+|class)$/.test(via)) errors.push(`themeVia "${via}" is not param:<name>, storage:<key>, attr:<name> or class`)
  if (flow.width !== undefined && !Number.isInteger(flow.width)) errors.push('"width" is not a whole number')
  const names = new Set()
  for (const [i, s] of steps.entries()) {
    const at = `step ${i + 1}`
    const kinds = s && typeof s === 'object' ? Object.keys(s).filter((k) => KINDS.includes(k)) : []
    if (kinds.length !== 1) {
      errors.push(`${at} needs exactly one of ${KINDS.join(', ')}`)
      continue
    }
    const kind = kinds[0]
    const v = s[kind]
    for (const k of Object.keys(s)) if (k !== kind && !(EXTRAS[kind] ?? []).includes(k)) errors.push(`${at} (${kind}) has an unknown key "${k}"`)
    if (s.timeout !== undefined && !(Number.isInteger(s.timeout) && s.timeout > 0)) errors.push(`${at} timeout is not a positive whole number`)
    if (kind === 'open' && !(typeof v === 'string' && v)) errors.push(`${at} open is not a path or URL`)
    if (kind === 'open' && typeof v === 'string' && !/^[a-z]+:/.test(v) && !flow.base) errors.push(`${at} opens a path but the file has no "base"`)
    if (kind === 'click' && !isTarget(v)) errors.push(`${at} click is not a selector or { "text": … }`)
    if (kind === 'type' && typeof v !== 'string') errors.push(`${at} type is not text`)
    if (kind === 'type' && s.into !== undefined && !isTarget(s.into)) errors.push(`${at} into is not a selector or { "text": … }`)
    if (kind === 'key' && !(typeof v === 'string' && v)) errors.push(`${at} key is not a key name`)
    if (kind === 'wait' && !(Number.isInteger(v) && v >= 0) && !isTarget(v)) errors.push(`${at} wait is not ms, a selector or { "text": … }`)
    if (kind === 'read' && v !== true && !(typeof v === 'string' && v)) errors.push(`${at} read is not a selector or true`)
    if (kind === 'js' && !(typeof v === 'string' && v)) errors.push(`${at} js is not an expression`)
    if (kind === 'shot') {
      if (!(typeof v === 'string' && /^[\w.-]+$/.test(v))) errors.push(`${at} shot is not a file name (letters, digits, . _ -)`)
      else if (names.has(v)) errors.push(`two shots are named ${v}`)
      names.add(v)
      if (!flow.out) errors.push(`${at} takes a shot but the file has no "out" folder`)
    }
  }
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`)
  return { ...flow, themeVia: via, steps: steps.map((s, i) => ({ ...s, i: i + 1, kind: KINDS.find((k) => k in s) })) }
}

export function openUrl(flow, path) {
  const u = new URL(path, flow.base)
  if (flow.theme && flow.themeVia.startsWith('param:')) u.searchParams.set(flow.themeVia.slice(6), flow.theme)
  return u.href
}

// The flow as the work outside the page: an open, a run of in-page steps, a shot.
export function compile(flow) {
  const ops = []
  for (const s of flow.steps) {
    if (s.kind === 'open') ops.push({ op: 'open', i: s.i, url: openUrl(flow, s.open) })
    else if (s.kind === 'shot') ops.push({ op: 'shot', i: s.i, name: s.shot, file: join(flow.out, `${s.shot}.jpg`) })
    else if (ops.at(-1)?.op === 'page') ops.at(-1).steps.push(s)
    else ops.push({ op: 'page', steps: [s] })
  }
  return ops
}

// Runs in the page (the pane's javascript_tool or Runtime.evaluate), so it has to stand alone: no
// imports, nothing from this module's scope. It returns one result per step and stops at a failure.
export async function runSteps(steps) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  // By text: the controls a person would tap, an exact match before a partial one.
  const find = (t) => {
    if (typeof t === 'string') return [...document.querySelectorAll(t)].find(visible) ?? null
    const want = t.text.trim().toLowerCase()
    const pool = [...document.querySelectorAll('button, a, summary, label, [role=button], [role=tab], [role=menuitem], [role=option], [role=switch], input[type=submit], input[type=button]')].filter(visible)
    return pool.find((el) => name(el) === want) ?? pool.find((el) => name(el).includes(want)) ?? null
  }
  const until = async (fn, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const v = fn()
      if (v) return v
      if (Date.now() > end) return null
      await sleep(100)
    }
  }
  const show = (t) => (typeof t === 'string' ? t : `text "${t.text}"`)
  const out = []
  for (const s of steps) {
    const ms = s.timeout ?? 5000
    try {
      let text
      if (s.kind === 'click') {
        const el = await until(() => find(s.click), ms)
        if (!el) throw new Error(`nothing visible matches ${show(s.click)}`)
        el.scrollIntoView({ block: 'center' })
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true }))
        el.click()
      } else if (s.kind === 'type') {
        const el = s.into ? await until(() => find(s.into), ms) : document.activeElement
        if (!el || el === document.body) throw new Error(s.into ? `nothing visible matches ${show(s.into)}` : 'nothing has focus: give "into"')
        el.focus()
        if (el.isContentEditable) document.execCommand('insertText', false, s.type)
        else {
          // The prototype's setter, so a React-controlled input sees the change.
          const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
          if (set) set.call(el, (el.value ?? '') + s.type)
          else el.value = (el.value ?? '') + s.type
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: s.type, inputType: 'insertText' }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
      } else if (s.kind === 'key') {
        const el = document.activeElement ?? document.body
        const init = { key: s.key, code: s.key.length === 1 ? `Key${s.key.toUpperCase()}` : s.key, bubbles: true, cancelable: true }
        const down = el.dispatchEvent(new KeyboardEvent('keydown', init))
        el.dispatchEvent(new KeyboardEvent('keyup', init))
        // A made-up Enter doesn't submit a form the way a real one does, so do what the browser would.
        if (down && s.key === 'Enter' && el.form && el.tagName === 'INPUT') el.form.requestSubmit()
      } else if (s.kind === 'wait') {
        if (typeof s.wait === 'number') await sleep(s.wait)
        else if (typeof s.wait === 'string') {
          if (!(await until(() => find(s.wait), ms))) throw new Error(`${s.wait} did not show within ${ms} ms`)
        } else if (!(await until(() => document.body.innerText.includes(s.wait.text), ms))) throw new Error(`"${s.wait.text}" did not show within ${ms} ms`)
      } else if (s.kind === 'read') {
        const el = s.read === true ? document.body : document.querySelector(s.read)
        if (!el) throw new Error(`nothing matches ${s.read}`)
        text = el.innerText.trim().replace(/\n{3,}/g, '\n\n').slice(0, 2000)
      } else if (s.kind === 'js') {
        const v = await (0, eval)(s.js)
        text = typeof v === 'string' ? v : JSON.stringify(v)
      }
      out.push({ i: s.i, kind: s.kind, ok: true, ...(text === undefined ? {} : { text }) })
    } catch (e) {
      out.push({ i: s.i, kind: s.kind, ok: false, error: String(e.message ?? e) })
      break
    }
    // A beat for the app to draw what the step changed before the next one looks.
    await sleep(150)
  }
  return out
}

export const pageScript = (steps) => `JSON.stringify(await (${runSteps.toString()})(${JSON.stringify(steps)}))`

// The pane's version: browser_batch lists for the agent's own tab, one per shot.
export function paneBatches(flow, { tab = '<tabId>', since = '<pass start>' } = {}) {
  const batches = []
  let actions = []
  if (flow.width) {
    const { width, height } = viewportFor(flow.width)
    actions.push({ name: 'resize_window', input: { width, height, tabId: tab } })
  }
  for (const o of compile(flow)) {
    if (o.op === 'open') actions.push({ name: 'navigate', input: { url: o.url, tabId: tab } })
    else if (o.op === 'page') actions.push({ name: 'javascript_tool', input: { action: 'javascript_exec', text: pageScript(o.steps), tabId: tab } })
    else {
      actions.push({ name: 'computer', input: { action: 'screenshot', tabId: tab } })
      batches.push({ actions, after: `node ${join(here, 'save-shot.mjs')} ${o.file} --since ${since}` })
      actions = []
    }
  }
  if (actions.length) batches.push({ actions, after: null })
  return { batches }
}

export function parseArgs(argv) {
  const o = { file: null, pane: false, tab: undefined, since: undefined, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pane') o.pane = true
    else if (a === '--tab') o.tab = argv[++i]
    else if (a === '--since') o.since = argv[++i]
    else if (a === '--dry') o.dry = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (!o.file) o.file = a
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

const label = (s) => `${String(s.i).padStart(2)} ${s.kind}`

async function headless(flow, log) {
  const ops = compile(flow)
  if (ops.some((o) => o.op === 'shot')) mkdirSync(flow.out, { recursive: true })
  const { width, height } = viewportFor(flow.width ?? 1024)
  const mobile = width < 768
  const { cdp, close } = await launch()
  let failed = 0
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
    if (flow.theme === 'dark' || flow.theme === 'light') await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: flow.theme }] })
    // A flow that doesn't start with an open starts on base.
    if (ops[0]?.op !== 'open') ops.unshift({ op: 'open', i: 0, url: openUrl(flow, flow.base) })
    for (const o of ops) {
      if (o.op === 'open') {
        await cdp.goto(o.url)
        if (flow.theme && flow.themeVia.startsWith('storage:')) {
          await cdp.evaluate(`localStorage.setItem(${JSON.stringify(flow.themeVia.slice(8))}, ${JSON.stringify(flow.theme)}); true`)
          await cdp.goto(o.url)
        } else if (flow.theme && flow.themeVia.startsWith('attr:')) await cdp.evaluate(`document.documentElement.setAttribute(${JSON.stringify(flow.themeVia.slice(5))}, ${JSON.stringify(flow.theme)}); true`)
        else if (flow.theme && flow.themeVia === 'class') await cdp.evaluate(`document.documentElement.classList.add(${JSON.stringify(flow.theme)}); true`)
        if (o.i) log(`ok    ${String(o.i).padStart(2)} open  ${o.url}`)
      } else if (o.op === 'page') {
        const results = JSON.parse(await cdp.evaluate(pageScript(o.steps)))
        for (const r of results) {
          const s = o.steps.find((x) => x.i === r.i)
          log(`${r.ok ? 'ok  ' : 'FAIL'}  ${label(s)}${r.ok ? '' : `  ${r.error}`}${r.text !== undefined ? `\n${r.text.replace(/^/gm, '      ')}` : ''}`)
        }
        if (results.some((r) => !r.ok)) {
          failed++
          break
        }
      } else {
        await cdp.settle()
        await sleep(100)
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })
        writeFileSync(o.file, Buffer.from(data, 'base64'))
        log(`ok    ${String(o.i).padStart(2)} shot  ${o.file}`)
      }
    }
  } finally {
    await close()
  }
  return failed ? 1 : 0
}

export async function run(o, log = console.log) {
  const flow = parseFlow(readFileSync(resolve(o.file), 'utf8'), o.file)
  if (o.pane) {
    log(JSON.stringify(paneBatches(flow, { tab: o.tab, since: o.since }), null, 2))
    return 0
  }
  if (o.dry) {
    for (const op of compile(flow)) log(op.op === 'page' ? op.steps.map((s) => `   ${label(s)}`).join('\n') : `   ${String(op.i).padStart(2)} ${op.op}  ${op.url ?? op.file}`)
    return 0
  }
  return headless(flow, log)
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
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 33).join('\n'))
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
