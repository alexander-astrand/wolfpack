// The scripted layout check: run before any screenshot, at 375 and 1024px.
// Paste the whole file as the `text` of the browser's `javascript_tool`
// (javascript_exec); it returns JSON with three lists:
//   - cutOff: headings, labels, buttons and chips whose text doesn't fit
//     (scrollWidth > clientWidth), e.g. 2.10's truncated section titles
//   - rowsWithoutDrag: sideways-scrolling rows (overflow-x auto/scroll) that a
//     mouse can't drag, i.e. without the `data-drag-scroll` marker that
//     useDragScroll puts on its row (2.10's shelf missed the polls row's fix)
//   - smallTargets: buttons and links under 44px tall or wide
// Text beats a screenshot: this finds those three for almost nothing, and a
// screenshot is only needed for what text can't tell.
;(() => {
  const MIN_TARGET = 44
  // Screen-reader-only text and switches (role=switch or a toggle's own
  // input) are meant to be tiny or clipped; they are not findings.
  const exempt = (el) => el.matches('.sr-only, [role="switch"], input.peer, input.sr-only') || !!el.closest('.sr-only')
  const visible = (el) => {
    if (exempt(el)) return false
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  // A short, readable selector: tag, id or the first two classes, plus the parent's tag.
  const describe = (el) => {
    const cls = [...el.classList].filter((c) => !c.includes(':') && !c.includes('[')).slice(0, 2)
    const self = el.id ? `${el.tagName.toLowerCase()}#${el.id}` : [el.tagName.toLowerCase(), ...cls].join('.')
    return el.parentElement ? `${el.parentElement.tagName.toLowerCase()} > ${self}` : self
  }
  const text = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60)

  const cutOff = []
  const textish = 'h1, h2, h3, h4, h5, h6, label, button, [role="button"], a, th, [class*="chip"], [class*="badge"], [class*="truncate"]'
  for (const el of document.querySelectorAll(textish)) {
    if (!visible(el) || !text(el)) continue
    if (el.scrollWidth > el.clientWidth + 1) cutOff.push({ selector: describe(el), text: text(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
  }

  const rowsWithoutDrag = []
  for (const el of document.querySelectorAll('body *')) {
    const ox = getComputedStyle(el).overflowX
    if (ox !== 'auto' && ox !== 'scroll') continue
    if (el.scrollWidth <= el.clientWidth + 1 || !visible(el)) continue
    if (el.closest('[data-drag-scroll]')) continue
    // Tables and code blocks scroll sideways on purpose and are fine with a trackpad.
    if (el.querySelector(':scope > table') || el.tagName === 'PRE') continue
    rowsWithoutDrag.push({ selector: describe(el), text: text(el).slice(0, 40), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
  }

  const smallTargets = []
  for (const el of document.querySelectorAll('button, [role="button"], a[href], input[type="checkbox"], input[type="radio"], select')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    // Links inside running text are exempt: they sit in a line, not alone.
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement?.closest('p')) continue
    if (r.width < MIN_TARGET || r.height < MIN_TARGET) smallTargets.push({ selector: describe(el), text: text(el), width: Math.round(r.width), height: Math.round(r.height) })
  }

  return JSON.stringify({
    url: location.pathname,
    width: innerWidth,
    counts: { cutOff: cutOff.length, rowsWithoutDrag: rowsWithoutDrag.length, smallTargets: smallTargets.length },
    cutOff,
    rowsWithoutDrag,
    smallTargets,
  })
})()
