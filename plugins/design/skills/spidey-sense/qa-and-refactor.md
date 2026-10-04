Supporting file for the `spidey-sense` skill: the QA seed (for `bengt-johansson`) and the refactor proof.

## QA seed: test data in one call
Driving a creation flow (a new-event wizard, say) by hand uses up a capped QA run's whole budget. When the feature under test isn't that flow itself, seed the data with the app's own client instead (its access rules apply; it acts as whoever is signed in, which must be an admin to add other members' rows). The seed is the project's own, since it calls the project's tables and functions: the project's CLAUDE.md says where it lives. What it must do:

- **One `javascript_tool` call** creates the test data through the same calls the app's own form makes, and returns the ids the pass needs.
- **Private where the app has a choice,** so nothing it creates notifies the whole group (an email or push to everyone).
- **Marked** "TEST QA seed" in a field the clean-up can find, so the clean-up also catches a seed an earlier run left behind.
- **Adjustable:** visibility, limits and sign-ups change when the feature needs it (a full list for a waitlist, public for a public-only flow).
- **One clean-up call** deletes it afterwards (child rows go with it by cascade) and returns how many rows went.

## Proving a refactor changed nothing
Before the change, load each page in a hidden same-origin iframe from `javascript_tool`, and store every element's tag, leaf text and computed styles (colour, background, border, box-shadow, display, font) in `localStorage`. After the change, compare. It catches CSS-order bugs that screenshots miss. It takes about 4 s per page, so run it in the background and poll `window.__report` (calls time out at 45 s). Leave out a page whose rows change on their own (an activity feed): it drifts.

## Interaction checks (tried on dev, 29 Sep)
Nobody scrolled over a map in 2.12 and the two-scrollbar profile passed 2.12.1, so these run on every page with an embedded widget or two columns, at 1024 (and 1440 for layout work). Both are text checks: no screenshot needed.

**Wheel over a widget** (maps, sideways rows, sheets, any `iframe`). The page (or its column) must move; a widget that swallows the wheel is a finding.
1. One `javascript_tool` call puts the widget in view and records where things are:
```js
const w = document.querySelector('iframe[title^="Map"], .leaflet-container') // or the widget's own selector
w.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 300))
const r = w.getBoundingClientRect(), pane = w.closest('aside')
window.__before = { y: scrollY, pane: pane?.scrollTop ?? null }
;({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), before: window.__before,
   maxY: document.documentElement.scrollHeight - innerHeight, paneMax: pane ? pane.scrollHeight - pane.clientHeight : null })
```
2. `computer` `scroll` needs a screenshot first for its coordinate frame: take one at `scale: 0.2` (cheap; not a named shot, don't save it). Hank doesn't count a shot at `scale` ≤ 0.25 toward the QA cap of 5 screenshots; frame shots stop at 12 per agent. It reports the frame (for example 800×609 for a 1024×768 viewport), so multiply the x and y above by frame width / viewport width. Scroll `down`, 3 ticks, there.
3. Read `{ y: scrollY, pane: pane?.scrollTop }` again. Something must have moved unless it was already at its max. **Control:** scroll the same way over plain text in the same column; if that moves and the widget spot didn't, the widget caught the wheel.

On the first run, a page's map (an OpenStreetMap `iframe` in the side column) held the wheel: neither the page (0 of 664) nor the column (251 of 575) moved, while the main column scrolled. Trackpad scroll arrives as the same wheel events, so one check covers both.

**Two scrollbars.** One `javascript_tool` call lists every element that scrolls on its own:
```js
[...document.querySelectorAll('*')].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
  .map((e) => { const s = getComputedStyle(e); return { sel: e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 4).join('.'),
    bar: e.offsetWidth - e.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth), scrollbarWidth: s.scrollbarWidth } })
```
The page scrolls too when `document.documentElement.scrollHeight > innerHeight`. A pane whose bar can show counts as a second scrollbar: `bar > 0`, or `scrollbarWidth` other than `none` (macOS overlay bars have `bar` 0 until you scroll, so `bar` alone misses them). A two-column page passes at 1024 with the page plus `aside.sticky…` with `scrollbarWidth: 'none'`. A sheet or open menu scrolling on its own is fine; two page columns that can both show a bar are the finding.

**Fold and unfold:** click each section's fold button by `find` ref, check with `read_page` that its body is gone and comes back, reload and check it stayed folded.
