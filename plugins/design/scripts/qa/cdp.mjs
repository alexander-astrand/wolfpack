// A minimal headless Chromium driver for the design scripts (batch-shots.mjs and the page scan),
// with no npm dependency: it drives the Chromium that Playwright already cached on this Mac over
// the DevTools protocol, in a throwaway profile, so it never touches anyone's browser and never
// needs the Browser pane (a hidden pane stalls shots; kit 1.5, the agents' cheaper lines).
// The shape follows Burrow's scripts/qa/shot.mjs, which ran it first.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The headless shell first (small, fast), then full Chromium; newest build first.
// CHROME_PATH wins, so a machine without the Playwright cache can point at any Chromium.
export function findChrome(env = process.env) {
  if (env.CHROME_PATH) return env.CHROME_PATH
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return null
  for (const prefix of ['chromium_headless_shell-', 'chromium-']) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith(prefix)).sort().reverse()) {
      const stack = [join(cache, dir)]
      while (stack.length) {
        const d = stack.pop()
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name)
          if (e.isDirectory()) stack.push(p)
          else if (e.name === 'chrome-headless-shell' || (prefix === 'chromium-' && e.name === 'Chromium' && d.endsWith('MacOS'))) return p
        }
      }
    }
  }
  return null
}

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) {
        const { ok, fail } = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.error) fail(new Error(m.error.message))
        else ok(m.result)
      } else if (m.method) this.events.push(m)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }))
  }
  async waitEvent(pred, ms) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (this.events.some(pred)) return true
      await sleep(50)
    }
    return false
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true })
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
  // Navigate, then wait for load and a quiet network; a page that streams forever is let go after 10 s.
  async goto(url) {
    this.events = []
    await this.send('Page.navigate', { url })
    await this.waitEvent((e) => e.method === 'Page.loadEventFired', 30000)
    await this.waitEvent((e) => e.method === 'Page.lifecycleEvent' && e.params.name === 'networkIdle', 10000)
  }
  // Fonts and every image loaded, so a shot never catches half-drawn pictures (spidey-sense's rule).
  settle() {
    return this.evaluate(
      `await document.fonts.ready; await Promise.all([...document.images].map(i => i.complete || new Promise(r => { i.onload = i.onerror = r }))); true`,
    )
  }
}

// Starts Chromium and hands back a driver for its one page; close() always removes the profile.
export async function launch(chromePath = findChrome()) {
  if (!chromePath) throw new Error('no Chromium found: set CHROME_PATH, or install one with `npx playwright install chromium`')
  const profile = mkdtempSync(join(tmpdir(), 'kit-shots-'))
  const chrome = spawn(chromePath, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
  const exited = new Promise((r) => chrome.once('exit', r))
  // Chromium still writes to its profile while it shuts down, so the folder goes after it exits.
  const close = async () => {
    chrome.kill()
    await Promise.race([exited, sleep(3000)])
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  try {
    let port
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100)
      try {
        port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
      } catch {}
    }
    if (!port) throw new Error('Chromium did not start')
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = pages.find((p) => p.type === 'page')
    if (!page) throw new Error('Chromium has no page to drive')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok)
      ws.addEventListener('error', () => fail(new Error('could not reach the DevTools socket')))
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true })
    return {
      cdp,
      close: () => {
        ws.close()
        return close()
      },
    }
  } catch (e) {
    await close()
    throw e
  }
}
