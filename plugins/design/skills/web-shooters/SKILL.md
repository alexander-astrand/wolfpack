---
name: web-shooters
description: The design plugin's core tools for looking at a page - the shot counts, the page scan, headless shots and scripted flows, and saving a Browser pane screenshot. Preloaded by mosbius-designs alone and beside spidey-sense by the QA agents; builders load it with spidey-sense. Use before any screenshot or scan.
---

## Voice
web-shooters · the kit's shot and scan tools (Spider-Man's wrist gear) · "thwip", one shot where one will do
- start: (silent)
- commit: (silent)
- refusal: "Out of web fluid: no Chromium found. Here's the error."
- ping: (silent)
- wrap: (silent)

**Already loaded, do not call:** an agent that lists `web-shooters` under `skills:` has this text in its prompt now; calling it with the Skill tool loads it twice (three svardsvik agents did, kit 1.7.1 council M6).

**Title:** runs inside another session and keeps its title (norms.md).

Kit 1.7 (jedi-council Feature 11, design lens F4): the core of `spidey-sense`, split out so `mosbius-designs` preloads about a third of the old skill instead of the Browser pane, sign-in and QA sections it never used (24 runs carried all 85 lines). `spidey-sense` keeps the pane run and the QA parts and loads beside this.

`<design>` in the commands below is the design plugin's folder: `~/wolfpack-live/plugins/design` (the kit sessions load via `CLAUDE_CODE_PLUGIN_DIRS`; the plugin cache under `~/.claude/plugins` is stale). Defined here once; the agents and `spidey-sense` point at this line.

## Shot counts (the one rule)
Kit 1.5 (skills lens S2): `darth-vader`, `bengt-johansson` and `oceans-eleven` each counted differently; they all cite this. The page scan covers every width and theme for free, so a screenshot is proof, never the search.
- **Builder:** at most one per step, only when text can't tell.
- **QA pass** (`bengt-johansson`): at most 5 per feature (Hank's cap): 375 and 1024 in the default theme, one in each other theme, the rest on scan or text findings. **A Bengan Boy:** at most 3 of those, in his lane.
- **Full matrix** (`/darth-vader`): one per page, width and theme, after that page's scan; no cap beyond its budget, and nothing a builder's or earlier pass's folder already holds.
- **Designer** (`mosbius-designs`): the shot list `mock-scaffold.mjs` writes (6 on an ordinary layout, 10 on Fable), all in one `batch-shots.mjs` call.
- **Not counted:** a frame shot for `scroll` coordinates or to wake the pane (`scale` ≤ 0.25).

## The page scan (before any screenshot)
`<design>/scripts/qa/page-scan.js` scans one page at every width and theme in one browser call, in same-origin iframes that share the tab's sign-in: the page scrolling sideways, text that's cut off, sideways rows a mouse can't drag (no `data-drag-scroll`), tap targets under 44px, text under AA contrast on its real background (text over an image or gradient is counted as `contrastUnknown`: look at those), and floating text (`floatingText`: text with no card, section, border or fill between it and the page ground; the page title, nav, header, footer, tab bars, dialogs, controls and anything under `data-floating-ok` are left out), and non-text contrast (`nonText`: field and toggle edges and focus rings under 3:1 against what is around them, WCAG 1.4.11; the best of a control's border, ring shadow and fill counts, and the focus probe focuses the first eight controls without scrolling and puts focus back). It replaced each project's own `layout-check.js` in kit 1.5 (`[layout-check]`); the plugin's old copy went in kit 1.7.

The project keeps one copy at `public/qa/page-scan.js` (Vite and Next both serve `public/` at the root; it reads the page, except that it focuses and blurs up to 8 controls to read their focus rings; pass `focusRings: false` in the scan's args to skip that). **Who copies it, and when:** the project's setup session (`/farbror-vattenmelon`), and `/life-finds-a-way` in a new project's skeleton; after that the navigator (`captain-call`) at a release's start, as a commit on the release branch, when `cmp <design>/scripts/qa/page-scan.js public/qa/page-scan.js` says it is missing or differs. The copy is `mkdir -p public/qa` then `cp <design>/scripts/qa/page-scan.js public/qa/`. A QA agent has no Write and never copies: with no copy (the `fetch` 404s, as in Burrow, reel-helper and svardsvik at kit 1.7.1), it runs `qa-pass.mjs` (below), which carries the scan itself. On the page's own tab:

```
window.__scanArgs = { widths: [375, 1024], themes: ['dark', 'light'], themeVia: 'param:theme' }
const res = await fetch('/qa/page-scan.js'); if (!res.ok) throw new Error('no /qa/page-scan.js here: run qa-pass.mjs'); JSON.parse(await eval(await res.text())).summary
```

`themeVia` is how the app switches theme (the project's CLAUDE.md says): `param:<name>` (`?theme=`), `storage:<localStorage key>` (put back afterwards), `attr:<attribute>` or `class` on `<html>`. Read `.summary` first (one line per width and theme), then only the lists with a count. Over about 30 s of pages (three widths and three themes), add `background: true` and poll `window.__scan.done`: a call times out at 45 s. Cut-off titles, rows without drag, sideways page scroll, low contrast, non-text contrast and floating text are findings; small targets are worth a look.

**Tells (kit 1.9).** Each view also carries `tells`: advisory counts of the shapes generated pages repeat, each with up to three examples, listed only when found (the summary line ends `; tells <id> <n>`). They are never a finding on their own, since a brief or a project's taste may want one; weigh them against the project's `taste.md`. The stable ids:

| id | what it counts |
|---|---|
| `gradient-text` | text painted with a gradient (`background-clip: text`) |
| `purple-gradient` | a gradient with a violet or purple stop |
| `cyan-on-dark` | cyan text on a near-black ground |
| `glow-shadow` | a coloured shadow blurred 8px or more |
| `side-stripe` | a thick coloured border down one side of a box, the rest bare |
| `nested-cards` | a rounded, painted card inside another card |
| `eyebrow-label` | a tiny tracked-caps label right above a heading |
| `icon-tile` | a square painted icon tile right above a heading |
| `overused-font` | Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans or Space Grotesk on the body, h1, h2 or buttons |
| `bounce-easing` | an easing that overshoots, or a bounce keyframe |
| `flat-type-scale` | an h1 or h2 under 1.25 times the body text size |

A project turns one off with a line in its `.claude/taste.md`: `tells: off gradient-text, glow-shadow`. `qa-pass.mjs` reads those lines (and a pass file's `tellsOff`); with the snippet above, pass them as `tellsOff: [...]` in `window.__scanArgs`.

## The QA pass as one script (kit 1.8)
`node <design>/scripts/qa-pass.mjs <pass.json>` runs the page scan at every width and theme, the two-scrollbar and wheel checks (`spidey-sense/qa-and-refactor.md`) and the console errors for a list of pages, and prints one table: page, check, result, finding (`nonText` is a finding; a `tells` row is advisory and never one). Headless with a real wheel for pages with no sign-in; `--pane --tab <tabId>` prints one `browser_batch` list per signed-in page, whose `javascript_tool` result is that page's table (the scan carried inline, so it works with no `public/qa` copy). A pane "catches the wheel" row is a synthetic probe: confirm that one spot with a real `computer` scroll. QA agents and `daredevil` read this table instead of running the snippets one by one. The script's header has the file format.

## Headless: shots and flows with no pane
For pages that need no sign-in (mocks, public pages), one headless Chromium does the work and the pane is never involved:
- **Shots:** `node <design>/scripts/qa/batch-shots.mjs <shots.json> [--scan]` takes a whole list in one call; `--scan` runs the page scan on each shot and writes `scan.json` beside the shots.
- **Flows:** `node <design>/scripts/qa/qa-flow.mjs <steps.json>` runs a scripted click-through (open, click by selector or text, type, key, wait, read text, shot) and prints each step's result. For a signed-in page add `--pane`: it prints the same flow as `browser_batch` lists for your own tab instead, one list per shot, with the `save-shot.mjs` line to run after each. The script's header has the steps format, and `<design>/scripts/qa/steps.sample.json` beside it is a whole flow to copy (open, wait, click, type, save, read, shot). The order ships the steps file for its flow, or says there is none and you write at most one, in your scratchpad dir.

## Saving a Browser pane screenshot
The screenshot tool returns the image and writes no file, but the image is kept in the transcript. Right after taking one (scale 1, so it's full size), run:

```
node <design>/scripts/qa/save-shot.mjs <scratchpad>/<step>-<width>-<theme>.jpg [--since <ISO time>]
```

QA passes note the time they start (`date -u +%Y-%m-%dT%H:%M:%SZ`) and give it as `--since`: the script then exits 1 and saves nothing when the newest image was taken before it (3.3: three of four Hut shots were the designer's mocks, saved as if fresh). Without the flag it saves the newest image whatever its age; builders may leave it out.

It writes the newest screenshot from this project's transcripts (the session's and its subagents', last 5 minutes) and prints when it was taken. Run it straight after each screenshot: another agent screenshotting in the same seconds could win. List the saved paths in your report; the PR lists them for the reviewer, who opens them with the Read tool.
