// page-scan.js: one page's geometry and contrast at every width and theme, in one browser call.
// Kit 1.5 (jedi-council 2.5, "one QA script per page"): QA spent its screenshot cap finding what a
// scan finds for almost nothing, so the scan runs first and screenshots only prove what it found.
// It replaces each project's scripts/qa/layout-check.js (its three lists are in here, unchanged).
//
// In the Browser pane (web-shooters, "The page scan"): the project keeps a copy at
// public/qa/page-scan.js (Vite and Next both serve public/ at the root), and one javascript_tool
// call on the page's own tab runs it:
//   window.__scanArgs = { widths: [375, 1024], themes: ['dark', 'light'], themeVia: 'param:theme' }
//   const src = await (await fetch('/qa/page-scan.js')).text(); JSON.parse(await eval(src)).summary
// The matrix loads the page (or args.path) in same-origin iframes, one per width and theme, so it
// shares the tab's sign-in. themeVia says how the app switches theme: 'param:<name>' (?theme=),
// 'storage:<localStorage key>' (restored afterwards), 'attr:<attribute>' or 'class' on <html>.
// With no args.widths it scans the page as it is (batch-shots.mjs --scan uses that).
// Over about 30 s (many widths and themes), add background: true and poll window.__scan.done:
// a javascript_tool call times out at 45 s.
//
// Each view returns counts and capped lists (args.max, default 15):
//   overflow       the page scrolls sideways; widest elements past the right edge
//   cutOff         headings, labels, buttons and chips whose text doesn't fit
//   rowsWithoutDrag sideways rows a mouse can't drag (no data-drag-scroll marker)
//   smallTargets   buttons and links under 44px tall or wide (inline links in running text left out)
//   lowContrast    text under WCAG AA (4.5:1, large text 3:1) on its resolved background
//   contrastUnknown text over an image or gradient, which needs a look instead of a number
//   floatingText   text lying bare on the page ground, with no card or section surface under it
//                  (the kit's taste, "No floating text"); the page title (h1), the nav, header,
//                  footer, tab bars, dialogs, controls and anything under [data-floating-ok] are left out
;(async () => {
  const args = (typeof window !== 'undefined' && window.__scanArgs) || {}
  const MIN_TARGET = 44
  const MAX = args.max ?? 15

  // Colour helpers. Computed colours can be oklch() or color(); a 1px canvas turns any of them into sRGB.
  let ctx
  const parseColor = (c) => {
    const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c)
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
      return [+m[1], +m[2], +m[3], a]
    }
    if (c === 'transparent') return [0, 0, 0, 0]
    if (typeof document === 'undefined') return null
    ctx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  // Paints colour `top` over an opaque `bottom`.
  const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1)
  const luminance = ([r, g, b]) => {
    const ch = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const isLarge = (px, weight) => px >= 24 || (px >= 18.66 && weight >= 700)
  if (args.helpers) return { parseColor, over, luminance, ratio, isLarge }

  const scanDoc = (doc, win) => {
    const cs = (el) => win.getComputedStyle(el)
    const exempt = (el) => el.matches('.sr-only, [role="switch"], input.peer, input.sr-only') || !!el.closest('.sr-only')
    const visible = (el) => {
      if (exempt(el)) return false
      const r = el.getBoundingClientRect()
      const s = cs(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }
    const describe = (el) => {
      const cls = [...el.classList].filter((c) => !c.includes(':') && !c.includes('[')).slice(0, 2)
      const self = el.id ? `${el.tagName.toLowerCase()}#${el.id}` : [el.tagName.toLowerCase(), ...cls].join('.')
      return el.parentElement ? `${el.parentElement.tagName.toLowerCase()} > ${self}` : self
    }
    const text = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    const width = win.innerWidth

    const root = doc.documentElement
    const overflow = []
    const pageScrolls = root.scrollWidth > root.clientWidth + 1
    if (pageScrolls) {
      for (const el of doc.querySelectorAll('body *')) {
        if (overflow.length >= MAX) break
        const r = el.getBoundingClientRect()
        if (r.right <= width + 1 || !visible(el)) continue
        // Only the outermost offender, and nothing inside a row that scrolls on purpose.
        if (el.parentElement && el.parentElement.getBoundingClientRect().right > width + 1 && el.parentElement !== doc.body) continue
        if (el.parentElement?.closest('[data-drag-scroll], pre, table')) continue
        overflow.push({ selector: describe(el), text: text(el).slice(0, 40), right: Math.round(r.right) })
      }
    }

    const cutOff = []
    const textish = 'h1, h2, h3, h4, h5, h6, label, button, [role="button"], a, th, [class*="chip"], [class*="badge"], [class*="truncate"]'
    for (const el of doc.querySelectorAll(textish)) {
      if (!visible(el) || !text(el)) continue
      if (el.scrollWidth > el.clientWidth + 1) cutOff.push({ selector: describe(el), text: text(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
    }

    const rowsWithoutDrag = []
    for (const el of doc.querySelectorAll('body *')) {
      const ox = cs(el).overflowX
      if (ox !== 'auto' && ox !== 'scroll') continue
      if (el.scrollWidth <= el.clientWidth + 1 || !visible(el)) continue
      if (el.closest('[data-drag-scroll]')) continue
      // Tables and code blocks scroll sideways on purpose and are fine with a trackpad.
      if (el.querySelector(':scope > table') || el.tagName === 'PRE') continue
      rowsWithoutDrag.push({ selector: describe(el), text: text(el).slice(0, 40), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
    }

    const smallTargets = []
    for (const el of doc.querySelectorAll('button, [role="button"], a[href], input[type="checkbox"], input[type="radio"], select')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (el.tagName === 'A' && cs(el).display === 'inline' && el.parentElement?.closest('p')) continue
      if (r.width < MIN_TARGET || r.height < MIN_TARGET) smallTargets.push({ selector: describe(el), text: text(el), width: Math.round(r.width), height: Math.round(r.height) })
    }

    // Contrast: every element that holds visible text, against the colours painted under it.
    const rootScheme = cs(root).colorScheme || ''
    const canvas = /dark/.test(rootScheme) && !/light/.test(rootScheme) ? [18, 18, 18, 1] : [255, 255, 255, 1]
    const backdrop = (el) => {
      const layers = []
      for (let e = el; e; e = e.parentElement) {
        const s = cs(e)
        if (s.backgroundImage !== 'none') return null
        const c = parseColor(s.backgroundColor)
        if (c && c[3] > 0) layers.push(c)
        if (c && c[3] >= 1) break
      }
      return layers.reverse().reduce((under, layer) => over(layer, under), canvas)
    }
    const lowContrast = []
    let contrastUnknown = 0
    const seen = new Set()
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || seen.has(el) || !n.textContent.trim()) continue
      seen.add(el)
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || !visible(el)) continue
      if (el.closest(':disabled, [aria-disabled="true"]')) continue
      const s = cs(el)
      const bg = backdrop(el)
      if (!bg) {
        contrastUnknown++
        continue
      }
      const fgRaw = parseColor(s.color)
      if (!fgRaw) continue
      const fg = over(fgRaw, bg)
      const r = ratio(fg, bg)
      const px = parseFloat(s.fontSize)
      const need = isLarge(px, parseInt(s.fontWeight, 10) || 400) ? 3 : 4.5
      if (r < need) lowContrast.push({ selector: describe(el), text: n.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), ratio: Math.round(r * 100) / 100, need, size: Math.round(px) })
    }
    lowContrast.sort((a, b) => a.ratio - b.ratio)

    // Floating text: the ground is the first box at or above the main column (main, else body) that
    // paints itself (a fill or the page art). A surface is anything between a text and the ground
    // that paints itself apart from it: its own fill, a border, a shadow or an image.
    let groundEl = doc.querySelector('main') || doc.body
    while (groundEl.parentElement && cs(groundEl).backgroundImage === 'none' && !(parseColor(cs(groundEl).backgroundColor)?.[3] >= 1)) groundEl = groundEl.parentElement
    const ground = parseColor(cs(groundEl).backgroundColor)
    const sameAsGround = (c) => ground && ground[3] > 0 && c.slice(0, 3).every((v, i) => Math.abs(v - ground[i]) < 2)
    const surface = (e) => {
      const s = cs(e)
      if (s.backgroundImage !== 'none' || s.boxShadow !== 'none') return true
      const c = parseColor(s.backgroundColor)
      if (c && c[3] > 0.05 && !sameAsGround(c)) return true
      // A box border on at least two sides; a lone divider line doesn't hold text.
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((d) => parseFloat(s[`border${d}Width`]) > 0 && parseColor(s[`border${d}Color`])?.[3] > 0)
      return sides.length >= 2
    }
    const notText = 'h1, nav, header, footer, [role="navigation"], [role="tablist"], [role="dialog"], dialog, button, [role="button"], a, input, select, textarea, label:has(input), svg, [data-floating-ok]'
    const floatingText = []
    const seenFloat = new Set()
    const floatWalker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */)
    for (let n = floatWalker.nextNode(); n; n = floatWalker.nextNode()) {
      const el = n.parentElement
      if (!el || seenFloat.has(el) || !n.textContent.trim()) continue
      seenFloat.add(el)
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || !visible(el) || el.closest(notText)) continue
      let held = false
      for (let e = el; e && !e.contains(groundEl); e = e.parentElement) {
        if (surface(e) || cs(e).position === 'fixed') {
          held = true
          break
        }
      }
      if (!held) floatingText.push({ selector: describe(el), text: n.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) })
    }

    const lists = { overflow, cutOff, rowsWithoutDrag, smallTargets, lowContrast, floatingText }
    const counts = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length]))
    counts.contrastUnknown = contrastUnknown
    if (pageScrolls && !overflow.length) counts.overflow = 1
    const capped = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.slice(0, MAX)]))
    return { url: win.location.pathname + win.location.search, width, counts, ...capped }
  }

  if (!args.widths) return JSON.stringify({ views: [scanDoc(document, window)] })

  // The matrix: one hidden same-origin iframe per width and theme, one at a time.
  const run = async () => {
    const via = args.themeVia ?? 'param:theme'
    const themes = args.themes?.length ? args.themes : [null]
    const path = args.path ?? location.pathname + location.search
    const storageKey = via.startsWith('storage:') ? via.slice(8) : null
    const saved = storageKey ? localStorage.getItem(storageKey) : null
    const views = []
    try {
      for (const theme of themes) {
        if (storageKey && theme) localStorage.setItem(storageKey, theme)
        for (const width of args.widths) {
          const u = new URL(path, location.origin)
          if (theme && via.startsWith('param:')) u.searchParams.set(via.slice(6), theme)
          const frame = document.createElement('iframe')
          frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${args.height ?? (width < 768 ? 812 : 800)}px;border:0`
          const loaded = new Promise((r) => (frame.onload = r))
          frame.src = u.href
          document.body.appendChild(frame)
          try {
            await loaded
            const doc = frame.contentDocument
            const win = frame.contentWindow
            if (theme && via.startsWith('attr:')) doc.documentElement.setAttribute(via.slice(5), theme)
            if (theme && via === 'class') doc.documentElement.classList.add(theme)
            await doc.fonts?.ready
            await Promise.all([...doc.images].map((i) => i.complete || new Promise((r) => (i.onload = i.onerror = r))))
            // Let the app's own first render and data settle (a client-rendered page fills in after load).
            await new Promise((r) => setTimeout(r, args.settleMs ?? 600))
            views.push({ theme, ...scanDoc(doc, win) })
          } finally {
            frame.remove()
          }
        }
      }
    } finally {
      if (storageKey) saved === null ? localStorage.removeItem(storageKey) : localStorage.setItem(storageKey, saved)
    }
    const summary = views.map((v) => `${v.width} ${v.theme ?? ''}: ${Object.entries(v.counts).map(([k, n]) => `${k} ${n}`).join(', ')}`)
    return JSON.stringify({ path, summary, views })
  }
  if (args.background) {
    window.__scan = { done: false }
    run().then(
      (result) => (window.__scan = { done: true, result }),
      (e) => (window.__scan = { done: true, error: String(e) }),
    )
    return JSON.stringify({ started: true, poll: 'window.__scan.done, then JSON.parse(window.__scan.result).summary' })
  }
  return run()
})()
