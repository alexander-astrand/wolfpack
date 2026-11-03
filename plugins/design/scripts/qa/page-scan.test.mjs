import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { runInNewContext } from 'node:vm'
import { findChrome, launch } from './cdp.mjs'

const SRC = readFileSync(new URL('./page-scan.js', import.meta.url), 'utf8')

describe('the contrast maths', async () => {
  const h = await runInNewContext(SRC, { window: { __scanArgs: { helpers: true } } })
  it('reads rgb() and rgba() in both syntaxes', () => {
    expect(h.parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1])
    expect(h.parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5])
    expect(h.parseColor('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 0.5])
    expect(h.parseColor('transparent')).toEqual([0, 0, 0, 0])
  })
  it('gives the WCAG ratios', () => {
    expect(h.ratio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(h.ratio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2)
    expect(h.ratio([118, 118, 118], [255, 255, 255])).toBeGreaterThan(4.5)
  })
  it('paints a see-through colour over its backdrop', () => {
    expect(h.over([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([127.5, 127.5, 127.5, 1])
  })
  it('calls 24px, or 18.66px bold, large', () => {
    expect(h.isLarge(24, 400)).toBe(true)
    expect(h.isLarge(19, 700)).toBe(true)
    expect(h.isLarge(19, 400)).toBe(false)
  })
})

describe('the tell helpers', async () => {
  const h = await runInNewContext(SRC, { window: { __scanArgs: { helpers: true } } })
  it('pulls every colour out of a gradient or a shadow list', () => {
    expect(h.colourTokens('linear-gradient(rgb(124, 58, 237), rgba(0, 0, 0, 0.5))')).toEqual([[124, 58, 237, 1], [0, 0, 0, 0.5]])
    expect(h.colourTokens('none')).toEqual([])
  })
  it('tells violet and cyan from grey', () => {
    expect(h.violet([124, 58, 237, 1])).toBe(true)
    expect(h.violet([37, 99, 235, 1])).toBe(false)
    expect(h.cyan([34, 211, 238, 1])).toBe(true)
    expect(h.cyan([120, 130, 135, 1])).toBe(false)
  })
  it('finds an overshooting easing or a bounce keyframe, and leaves ease alone', () => {
    expect(h.bouncy('cubic-bezier(0.68, -0.55, 0.27, 1.55)')).toBe(true)
    expect(h.bouncy('ease, cubic-bezier(0.4, 0, 0.2, 1)', 'fade')).toBe(false)
    expect(h.bouncy('ease', 'bounce-in')).toBe(true)
  })
  it('names the six overused fonts, Next and variable spellings too', () => {
    expect(h.overusedFont('"__Inter_d65c78", "__Inter_Fallback", sans-serif')).toBe('Inter')
    expect(h.overusedFont('InterVariable, sans-serif')).toBe('Inter')
    expect(h.overusedFont('"Plus Jakarta Sans", sans-serif')).toBe('Plus Jakarta Sans')
    expect(h.overusedFont('Georgia, "Inter", serif')).toBe(null)
  })
  it('has eleven stable ids', () => {
    expect(h.TELLS).toHaveLength(11)
    expect(new Set(h.TELLS).size).toBe(11)
  })
})

// A page with one of each finding: grey text that fails only in the light theme, a small button,
// a row wider than a phone, and a cut-off heading.
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  body { margin: 0; background: #111; color: #eee; font: 16px system-ui }
  [data-theme="light"] body { background: #fff }
  [data-theme="light"] .soft { color: #999 }
  .wide { width: 600px; height: 10px }
  @media (min-width: 768px) { .wide { width: 100% } }
  h2 { width: 80px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
</style></head><body>
<p class="soft">Quiet words</p><button style="width:30px;height:30px">x</button>
<div class="wide"></div><h2>A long section title</h2>
<script>const t = new URLSearchParams(location.search).get('theme'); if (t) document.documentElement.dataset.theme = t</script>
</body></html>`

describe.skipIf(!findChrome())('the matrix in one call', () => {
  it('scans every width and theme in same-origin iframes', async () => {
    const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { cdp, close } = await launch()
    try {
      await cdp.goto(`http://127.0.0.1:${server.address().port}/page`)
      const out = JSON.parse(await cdp.evaluate(`window.__scanArgs = { widths: [375, 1024], themes: ['dark', 'light'], settleMs: 50 }; await eval(${JSON.stringify(SRC)})`))
      expect(out.summary).toHaveLength(4)
      const view = (w, t) => out.views.find((v) => v.width === w && v.theme === t)
      expect(view(375, 'dark').counts.lowContrast).toBe(0)
      expect(view(375, 'light').lowContrast.find((c) => c.text === 'Quiet words')).toMatchObject({ need: 4.5, size: 16 })
      expect(view(375, 'light').lowContrast.find((c) => c.text === 'Quiet words').ratio).toBeCloseTo(2.85, 1)
      expect(view(375, 'dark').counts.overflow).toBeGreaterThan(0)
      expect(view(1024, 'dark').counts.overflow).toBe(0)
      expect(view(1024, 'dark').smallTargets[0]).toMatchObject({ width: 30, height: 30 })
      expect(view(1024, 'dark').cutOff[0].text).toBe('A long section title')
    } finally {
      await close()
      server.close()
    }
  }, 60000)
})

// The 31 Oct 2026 shape: an empty-state line on the page ground beside a lone card, under a page
// title and a nav that are allowed there.
const FLOAT = `<!doctype html><html><head><style>
  body { margin: 0; background: #f4efe6; font: 16px system-ui }
  main { background: #f4efe6 }
  .card { background: #fff; border-radius: 12px; padding: 16px }
  .ruled { border: 1px solid #ddd }
</style></head><body>
<nav>Home Money</nav>
<main><h1>Wishlist</h1>
  <div class="card"><h2>Ideas</h2><p>Held by its card</p></div>
  <div class="ruled"><p>Held by its border</p></div>
  <section><p>Nothing yet. What you'd like to buy goes here.</p></section>
  <p data-floating-ok>Allowed on purpose</p>
</main></body></html>`

describe.skipIf(!findChrome())('floating text', () => {
  it('lists text on the page ground and leaves out titles, nav and held text', async () => {
    const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(FLOAT))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { cdp, close } = await launch()
    try {
      await cdp.goto(`http://127.0.0.1:${server.address().port}/page`)
      const out = JSON.parse(await cdp.evaluate(`await eval(${JSON.stringify(SRC)})`))
      expect(out.views[0].floatingText.map((f) => f.text)).toEqual(["Nothing yet. What you'd like to buy goes here."])
      // A plain page with one card and a real type scale carries no tells.
      expect(out.views[0].tells).toEqual({})
    } finally {
      await close()
      server.close()
    }
  }, 60000)
})

// One planted shape per tell, a field border at 2.5:1 (#a4a4a4 on white) beside one at 4.5:1, and a
// focus ring at 1.4:1.
const TELL_PAGE = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #222; font: 16px Georgia, serif }
  h1 { font-size: 32px } h2 { font-size: 24px }
  .gt { background: linear-gradient(90deg, #f00, #00f); -webkit-background-clip: text; background-clip: text; color: transparent }
  .pg { background: linear-gradient(#7c3aed, #4f46e5); color: #fff; padding: 8px }
  .dark { background: #0b0f14; padding: 8px } .dark span { color: #22d3ee }
  .glow { box-shadow: 0 0 24px rgba(124, 58, 237, 0.6); padding: 8px }
  .stripe { border-left: 4px solid #2563eb; padding: 8px }
  .card { border-radius: 12px; background: #f3f4f6; padding: 16px; width: 320px; min-height: 60px }
  .card .card { width: 200px; background: #fff }
  .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em }
  .tile { width: 48px; height: 48px; border-radius: 12px; background: #eef }
  .bounce { transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55) }
  h2.flat { font-size: 17px }
  .inter { font-family: Inter, sans-serif }
  input { border: 1px solid #a4a4a4; background: #fff } input.ok { border-color: #767676 }
  .ring:focus { outline: 2px solid #ddd }
</style></head><body>
<h1 class="gt">Gradient words</h1>
<p>Plain words.</p><p>More plain words.</p>
<div class="pg">On violet</div>
<div class="dark"><span>Cyan on dark</span></div>
<div class="glow">Glowing</div>
<div class="stripe">A callout</div>
<div class="card"><div class="card">Inner card</div></div>
<p class="eyebrow">New</p><h2>Big title</h2>
<div class="tile"><svg width="24" height="24"></svg></div><h3>Fast</h3>
<div class="bounce">Springy</div>
<h2 class="flat">Flat heading</h2>
<button class="inter">Join</button>
<input placeholder="Name"><input class="ok" placeholder="Fine">
<button class="ring">Go</button>
</body></html>`

describe.skipIf(!findChrome())('tells and non-text contrast', () => {
  it('counts every planted tell, measures the 2.5:1 field and the faint ring, and drops a tell by id', async () => {
    const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(TELL_PAGE))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { cdp, close } = await launch()
    const h = await runInNewContext(SRC, { window: { __scanArgs: { helpers: true } } })
    try {
      await cdp.goto(`http://127.0.0.1:${server.address().port}/page`)
      const view = JSON.parse(await cdp.evaluate(`window.__scanArgs = {}; await eval(${JSON.stringify(SRC)})`)).views[0]
      expect(Object.keys(view.tells).sort()).toEqual([...h.TELLS].sort())
      for (const id of h.TELLS) expect(view.tells[id].examples.length, id).toBeGreaterThan(0)
      expect(view.tells['overused-font'].examples[0]).toContain('(Inter)')
      expect(view.tells['flat-type-scale'].examples[0]).toContain('17px over body 16px')
      const edge = view.nonText.find((n) => n.text === 'Name')
      expect(edge).toMatchObject({ part: 'edge', need: 3 })
      expect(edge.ratio).toBeCloseTo(2.5, 1)
      expect(view.nonText.find((n) => n.text === 'Fine')).toBeUndefined()
      expect(view.nonText.find((n) => n.text === 'Go')).toMatchObject({ part: 'focus ring' })
      expect(view.counts.nonText).toBe(view.nonText.length)
      expect(view.counts).not.toHaveProperty('tells')
      const quiet = JSON.parse(await cdp.evaluate(`window.__scanArgs = { tellsOff: ['gradient-text', 'overused-font'] }; await eval(${JSON.stringify(SRC)})`)).views[0]
      expect(quiet.tells).not.toHaveProperty('gradient-text')
      expect(quiet.tells).not.toHaveProperty('overused-font')
      expect(quiet.tells).toHaveProperty('purple-gradient')
    } finally {
      await close()
      server.close()
    }
  }, 60000)
})
