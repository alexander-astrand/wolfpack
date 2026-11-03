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
//   nonText        field and toggle edges, and focus rings, under 3:1 against what is around them
//                  (WCAG 1.4.11); args.focusRings: false skips the focus probe
// And `tells` (kit 1.9): advisory counts of the shapes generated pages repeat, each with at most
// three examples and only when found. Never a finding on their own: a brief or a project's taste
// may want one, and args.tellsOff (from taste.md's `tells: off <id> ...`) drops them by id:
//   gradient-text purple-gradient cyan-on-dark glow-shadow side-stripe nested-cards eyebrow-label
//   icon-tile overused-font bounce-easing flat-type-scale
// Our own code; the list of shapes draws on impeccable (Apache-2.0) and hallmark (MIT).
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
  // Every colour named inside a computed value (a gradient, a shadow list), as sRGB.
  const colourTokens = (str) => (str && str !== 'none' ? (str.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) || []).map(parseColor).filter(Boolean) : [])
  // Hue in degrees and chroma 0..1: enough to tell violet, cyan and grey apart.
  const hueChroma = ([r, g, b]) => {
    const mx = Math.max(r, g, b)
    const c = mx - Math.min(r, g, b)
    if (!c) return [0, 0]
    const h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4
    return [(h * 60 + 360) % 360, c / 255]
  }
  const vivid = (c) => c[3] > 0.15 && hueChroma(c)[1] > 0.25
  const inHue = (c, lo, hi) => vivid(c) && hueChroma(c)[0] >= lo && hueChroma(c)[0] <= hi
  const violet = (c) => inHue(c, 250, 320)
  const cyan = (c) => inHue(c, 170, 200)
  // An easing that overshoots (a y control point outside 0..1) or a keyframe named for a bounce.
  const bouncy = (timing, name) => /bounce|elastic|wobble|jello|rubber/i.test(name || '') || [...(timing || '').matchAll(/cubic-bezier\(([^)]*)\)/g)].some((m) => {
    const [, y1, , y2] = m[1].split(',').map(parseFloat)
    return y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1
  })
  // The six fonts every generated page reaches for; Next's `__Inter_abc123` and `InterVariable` count.
  const OVERUSED = /^(inter|roboto|fraunces|geist|plus jakarta sans|space grotesk)(\b|variable)/i
  const overusedFont = (family) => {
    const first = (family || '').split(',')[0].replace(/["']/g, '').replace(/_/g, ' ').trim()
    const m = OVERUSED.exec(first)
    return m ? m[1].replace(/\b\w/g, (x) => x.toUpperCase()) : null
  }
  // The tells' stable ids: a project's taste.md turns one off by name (`tells: off gradient-text`).
  const TELLS = ['gradient-text', 'purple-gradient', 'cyan-on-dark', 'glow-shadow', 'side-stripe', 'nested-cards', 'eyebrow-label', 'icon-tile', 'overused-font', 'bounce-easing', 'flat-type-scale']
  if (args.helpers) return { parseColor, over, luminance, ratio, isLarge, colourTokens, hueChroma, violet, cyan, bouncy, overusedFont, TELLS }

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
    // Tells are advisory: a count and at most three examples each, never a finding on their own.
    const off = new Set(args.tellsOff || [])
    const tellLists = {}
    const tell = (id, el, note) => {
      if (off.has(id)) return
      const t = (tellLists[id] ??= { count: 0, examples: [] })
      t.count++
      if (t.examples.length < 3) t.examples.push(note ? `${describe(el)} (${note})` : `${describe(el)}${text(el) ? ` "${text(el).slice(0, 30)}"` : ''}`)
    }

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
      if (cyan(fgRaw) && luminance(bg) < 0.05) tell('cyan-on-dark', el)
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

    // Non-text contrast (WCAG 1.4.11, 3:1): a field's or a toggle's edge against what is around it,
    // and a focus ring against what is under it. The edge is the best of its borders, a ring drawn as
    // a box-shadow (Tailwind's ring-*) and its own fill, since any one of them shows where it is.
    // The visibility test here is its own: `visible` leaves out switches and peer inputs on purpose.
    const shown = (el) => {
      const r = el.getBoundingClientRect()
      const s = cs(el)
      return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && !el.closest('.sr-only')
    }
    const sideColours = (s) => ['Top', 'Right', 'Bottom', 'Left'].filter((d) => parseFloat(s[`border${d}Width`]) > 0 && s[`border${d}Style`] !== 'none').map((d) => parseColor(s[`border${d}Color`])).filter((c) => c && c[3] > 0)
    const around = (el) => (el.parentElement ? backdrop(el.parentElement) : canvas)
    const against = (cols, bg) => Math.max(1, ...cols.map((c) => ratio(over(c, bg), bg)))
    const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || text(el)).slice(0, 40)
    const nonText = []
    const fields = 'input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"], [type="submit"], [type="button"], [type="reset"], [type="image"]), select, textarea, [role="switch"], [role="checkbox"], input[type="checkbox"], input[type="radio"]'
    for (const el of doc.querySelectorAll(fields)) {
      if (!shown(el) || el.closest(':disabled, [aria-disabled="true"]')) continue
      const s = cs(el)
      // A native checkbox or radio paints itself, so its computed border says nothing.
      if (el.matches('input[type="checkbox"], input[type="radio"]') && s.appearance !== 'none') continue
      const bg = around(el)
      if (!bg) continue
      const fill = parseColor(s.backgroundColor)
      const r = against([...sideColours(s), ...colourTokens(s.boxShadow), ...(fill && s.backgroundImage === 'none' ? [fill] : [])], bg)
      if (r < 3) nonText.push({ selector: describe(el), text: label(el), part: 'edge', ratio: Math.round(r * 100) / 100, need: 3 })
    }
    // Focus rings: focus the first few controls without scrolling, read what focus adds (an outline,
    // or a box-shadow that wasn't there at rest), then put focus back. Popup openers are left alone.
    if (args.focusRings !== false) {
      const before = doc.activeElement
      let probed = 0
      for (const el of doc.querySelectorAll('a[href], button, input, select, textarea, [role="switch"], [tabindex="0"]')) {
        if (probed >= 8) break
        if (!shown(el) || el.disabled || el.matches('[aria-haspopup], [role="combobox"], input[type="hidden"]')) continue
        probed++
        const rest = cs(el).boxShadow
        el.focus({ preventScroll: true, focusVisible: true })
        if (doc.activeElement !== el) continue
        const s = cs(el)
        const ring = [...(s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? [parseColor(s.outlineColor)] : []), ...(s.boxShadow !== rest ? colourTokens(s.boxShadow) : [])].filter((c) => c && c[3] > 0)
        el.blur()
        const bg = around(el)
        if (!ring.length || !bg) continue
        const r = against(ring, bg)
        if (r < 3) nonText.push({ selector: describe(el), text: label(el), part: 'focus ring', ratio: Math.round(r * 100) / 100, need: 3 })
      }
      if (before && before !== doc.body && before.focus) before.focus({ preventScroll: true })
    }
    nonText.sort((a, b) => a.ratio - b.ratio)

    // The tells walk: one pass over the page for the element tells, then the headings for the rest.
    const cards = new Set()
    const notCard = 'button, a, input, select, textarea, img, svg, li, td, th, label, [role="button"]'
    for (const el of doc.querySelectorAll('body *')) {
      if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || !visible(el)) continue
      const s = cs(el)
      const img = s.backgroundImage
      if (/gradient/.test(img)) {
        if (s.backgroundClip === 'text' || s.getPropertyValue('-webkit-background-clip') === 'text') tell('gradient-text', el)
        if (colourTokens(img).some(violet)) tell('purple-gradient', el)
      }
      const glow = [s.boxShadow, s.textShadow].filter((v) => v && v !== 'none').flatMap((v) => v.split(/,(?![^(]*\))/)).find((part) => {
        if (/inset/.test(part)) return false
        const c = colourTokens(part)[0]
        const blur = parseFloat((part.replace(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)/gi, '').match(/-?[\d.]+px/g) || [])[2])
        return c && vivid(c) && blur >= 8
      })
      if (glow) tell('glow-shadow', el)
      // A thick coloured stripe down one side, the rest of the box bare: the generated callout card.
      const w = (d) => (s[`border${d}Style`] === 'none' ? 0 : parseFloat(s[`border${d}Width`]) || 0)
      const stripe = ['Left', 'Right'].find((d) => w(d) >= 3 && ['Top', 'Bottom', d === 'Left' ? 'Right' : 'Left'].every((o) => w(o) <= 1))
      if (stripe && vivid(parseColor(s[`border${stripe}Color`]) || [0, 0, 0, 0]) && !el.closest('nav, [role="tablist"]')) tell('side-stripe', el)
      if (bouncy(`${s.transitionTimingFunction},${s.animationTimingFunction}`, s.animationName)) tell('bounce-easing', el)
      // A card: a rounded box of some size that paints itself. querySelectorAll walks in document
      // order, so every outer card is in the set before its inner ones are met.
      const r = el.getBoundingClientRect()
      if (!el.matches(notCard) && r.width >= 100 && r.height >= 48 && parseFloat(s.borderTopLeftRadius) >= 6 && (s.boxShadow !== 'none' || sideColours(s).length === 4 || parseColor(s.backgroundColor)?.[3] > 0.05)) {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (cards.has(p)) {
            tell('nested-cards', el)
            break
          }
        }
        cards.add(el)
      }
    }
    const px = (el) => parseFloat(cs(el).fontSize)
    const sizes = {}
    for (const p of doc.querySelectorAll('p')) if (visible(p) && text(p)) sizes[px(p)] = (sizes[px(p)] || 0) + 1
    const bodyPx = +(Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? px(doc.body))
    for (const h of doc.querySelectorAll('h1, h2, h3, h4')) {
      if (!visible(h)) continue
      if (/^H[12]$/.test(h.tagName) && px(h) < bodyPx * 1.25) tell('flat-type-scale', h, `${px(h)}px over body ${bodyPx}px`)
      const prev = h.previousElementSibling
      if (!prev || !visible(prev)) continue
      const ps = cs(prev)
      const t = text(prev)
      const caps = ps.textTransform === 'uppercase' || (/[A-Z]/.test(t) && t === t.toUpperCase())
      if (t && t.length <= 40 && px(prev) <= 14 && caps && parseFloat(ps.letterSpacing) / px(prev) >= 0.04) tell('eyebrow-label', prev)
      const pr = prev.getBoundingClientRect()
      const painted = (parseColor(ps.backgroundColor)?.[3] > 0.05) || ps.backgroundImage !== 'none' || sideColours(ps).length === 4
      if (painted && pr.width >= 24 && pr.width <= 96 && Math.abs(pr.width - pr.height) <= 4 && (prev.querySelector('svg, img') || (t && [...t].length <= 2))) tell('icon-tile', prev)
    }
    const fontSeen = new Set()
    for (const el of [doc.body, doc.querySelector('h1'), doc.querySelector('h2'), doc.querySelector('button')]) {
      const f = el && overusedFont(cs(el).fontFamily)
      if (f && !fontSeen.has(f)) {
        fontSeen.add(f)
        tell('overused-font', el, f)
      }
    }
    const tells = Object.fromEntries(TELLS.filter((id) => tellLists[id]).map((id) => [id, tellLists[id]]))

    const lists = { overflow, cutOff, rowsWithoutDrag, smallTargets, lowContrast, nonText, floatingText }
    const counts = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length]))
    counts.contrastUnknown = contrastUnknown
    if (pageScrolls && !overflow.length) counts.overflow = 1
    const capped = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.slice(0, MAX)]))
    return { url: win.location.pathname + win.location.search, width, counts, ...capped, tells }
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
    const tellLine = (v) => (Object.keys(v.tells).length ? `; tells ${Object.entries(v.tells).map(([k, t]) => `${k} ${t.count}`).join(', ')}` : '')
    const summary = views.map((v) => `${v.width} ${v.theme ?? ''}: ${Object.entries(v.counts).map(([k, n]) => `${k} ${n}`).join(', ')}${tellLine(v)}`)
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
