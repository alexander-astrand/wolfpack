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
