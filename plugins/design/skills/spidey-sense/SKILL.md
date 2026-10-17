---
name: spidey-sense
description: Check a UI change in the built-in browser the way this project requires - 375, 1024 (and 1440) px, every theme the project has - plus the workarounds for confirm dialogs, screenshots and proving a refactor changed nothing. Use after any change the app shows.
---

## Voice
spidey-sense · the browser checker (Spider-Man) · "tingling", friendly neighbourhood, notices what's off by a pixel
- start: "Tingling. Opening the page at the narrow width first."
- commit: (silent)
- refusal: "No web to swing on here. The browser won't open; here's what I saw."
- ping: "Something's off and I can't tell if it's meant. Look?"
- wrap: "Nothing tingling. Pages checked, notes below."

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · spidey-sense <subject>` (norms.md).

## Modes
- **Builder mode** (default, for builders): run the page scan (below) at 375 and 1024, then read the page as text per item (`read_page`, `get_page_text`, `find`, console); screenshots as "Shot counts" says. No matrix.
- **QA mode** (`bengt-johansson` and the Bengan Boys, only on features the plan marks qa; the taste read first, since a pass means Alexander wouldn't send it back; test data from the QA seed in `qa-and-refactor.md`, driven by `read_page`/`find`, `tabId` on every browser call; the screenshot rules are under "QA screenshots"): one pass per feature (one trigger inside a `browser_batch`: navigate, act, check). The page scan runs first, over every width and theme in one call; text checks follow; screenshots come last and only prove what the scan and the text found. Pages with a map, a sideways row, a sheet or two columns also get the interaction checks in `qa-and-refactor.md` (wheel over each widget, two scrollbars, fold and unfold). The budget is the `[budget …]` tag in the work order, and Hank holds it (QA's target is ≤10% of a release).
- **Full matrix** (`/darth-vader`, on demand): every width below in every theme the project has.

## Shot counts (the one rule)
Kit 1.5 (skills lens S2): `darth-vader`, `bengt-johansson` and `oceans-eleven` each counted differently; they all cite this. The page scan covers every width and theme for free, so a screenshot is proof, never the search.
- **Builder:** at most one per step, only when text can't tell.
- **QA pass** (`bengt-johansson`): at most 5 per feature (Hank's cap): 375 and 1024 in the default theme, one in each other theme, the rest on scan or text findings. **A Bengan Boy:** at most 3 of those, in his lane.
- **Full matrix** (`/darth-vader`): one per page, width and theme, after that page's scan; no cap beyond its budget, and nothing a builder's or earlier pass's folder already holds.
- **Designer** (`mosbius-designs`): the shot list `mock-scaffold.mjs` writes (6 on an ordinary layout, 10 on Fable), all in one `batch-shots.mjs` call.
- **Not counted:** a frame shot for `scroll` coordinates or to wake the pane (`scale` ≤ 0.25).

## The run
`<design>` in the commands below is the design plugin's folder: `~/.claude/plugins/marketplaces/wolfpack/plugins/design`.

0. **Front the Browser pane first.** `tabs_context` says whether the pane is displayed; if it's hidden, `tabs_select` your tab (`preview_start` opens it). A hidden pane can't screenshot, stalls clicks and sheets, and draws nothing until woken (stefan lost about a dozen turns to one; seven agents' cheaper lines asked for this). A navigator fronts it before it spawns a QA agent. If it stays hidden, run the scan and the shots headless (`batch-shots.mjs`, pages that need no sign-in) and read the rest as text.
1. Start the dev server with `preview_start` (`npm run dev` on `project.devPort` from the project's `.claude/kit.json`; configured in `.claude/launch.json`) and use the signed-in dev server's tab in the browser pane: the dev browser tab stays signed in as the test user between checks, so no login step is needed. **The sign-in probe:** ask the app's own auth client for the user with the javascript tool (`tabId` of the dev server's tab); the project's CLAUDE.md says where the client lives (a Supabase app: `const m = await import('<client path>'); (await m.supabase.auth.getUser()).data.user`). If it isn't signed in, stop and tell the navigator; never reach for a login from memory. **One signed-in session serves at most two browser lanes** (`[one-session]`: a shared session was signed out twice, once by four lanes refreshing the same token, once by a click by position on a hidden desktop Sign out at phone width): QA picks controls by aria-label (`find`, `read_page`), never by position, and never clicks in the header blind. **Each browser lane runs its own dev port** (`npm run dev -- --port 51NN --strictPort`), signed in at the start of the lane, so lanes never share a server; restart the lane's server after any `package.json` change. The layout QA group is a fixed one that nobody toggles (the work order names it).
2. For each width: `resize_window` to **375×812** (phone) and **1024×768** (desktop, `lg`), plus **1440×900** for layout work. A width or layout release is also checked at the widest step (a 1920×1080 viewport), judged against the pages the project's CLAUDE.md names for the widest width. Reset with `preset: desktop` at the end.
3. For each theme: every one the project's CLAUDE.md lists (a project with three, such as Light, Amber and Dark, checks all three; the default is named there). **The theme switch:** a per-tab `?theme=<name>` on the URL where the app has one (the project's CLAUDE.md lists the values), else set the app's theme key in `localStorage` (the project's CLAUDE.md names it) through the javascript tool, then reload; the pane's `colorScheme` emulation does not switch the app. Colours must come from the project's theme tokens; a `dark:` pair is a finding.
4. Check with text tools first (`read_page`, `find`, `get_page_text`, `read_console_messages` for errors), then take a screenshot as proof and save it (below).

## The page scan (before any screenshot)
`<design>/scripts/qa/page-scan.js` scans one page at every width and theme in one browser call, in same-origin iframes that share the tab's sign-in: the page scrolling sideways, text that's cut off, sideways rows a mouse can't drag (no `data-drag-scroll`), tap targets under 44px, and text under AA contrast on its real background (text over an image or gradient is counted as `contrastUnknown`: look at those). Kit 1.5 (jedi-council 2.5): it replaces each project's `scripts/qa/layout-check.js`, a per-project copy that hejtide and portfolio never had and a Next app couldn't serve (`[layout-check]`); its three lists are in the scan unchanged, so a project deletes its old copy.

The project keeps one copy at `public/qa/page-scan.js` (Vite and Next both serve `public/` at the root; it only reads the page); copy it from `<design>` again when `cmp` says it differs. On the page's own tab:

```
window.__scanArgs = { widths: [375, 1024], themes: ['dark', 'light'], themeVia: 'param:theme' }
const src = await (await fetch('/qa/page-scan.js')).text(); JSON.parse(await eval(src)).summary
```

`themeVia` is how the app switches theme (the project's CLAUDE.md says): `param:<name>` (`?theme=`), `storage:<localStorage key>` (put back afterwards), `attr:<attribute>` or `class` on `<html>`. Read `.summary` first (one line per width and theme), then only the lists with a count. Over about 30 s of pages (three widths and three themes), add `background: true` and poll `window.__scan.done`: a call times out at 45 s. Cut-off titles, rows without drag, sideways page scroll and low contrast are findings; small targets are worth a look. Headless, `batch-shots.mjs --scan` runs the same scan on each shot.

## Saving a screenshot
The screenshot tool returns the image and writes no file, but the image is kept in the transcript. Right after taking one (scale 1, so it's full size), run:

```
node ~/.claude/plugins/marketplaces/wolfpack/plugins/design/skills/spidey-sense/save-shot.mjs <scratchpad>/<step>-<width>-<theme>.jpg [--since <ISO time>]
```

QA passes note the time they start (`date -u +%Y-%m-%dT%H:%M:%SZ`) and give it as `--since`: the script then exits 1 and saves nothing when the newest image was taken before it (3.3: three of four Hut shots were the designer's mocks, saved as if fresh). Without the flag it saves the newest image whatever its age; builders may leave it out.

It writes the newest screenshot from this project's transcripts (the session's and its subagents', last 5 minutes) and prints when it was taken. Run it straight after each screenshot: another agent screenshotting in the same seconds could win. List the saved paths in your report; the PR lists them for the reviewer, who opens them with the Read tool.

## QA screenshots
Three QA passes lost their named shots to exploratory ones, and parallel runs in one tab came back misnamed or black (2.12.1: three re-shoots, 15.8M), so:
- **Your own tab:** `tabs_create`, then `navigate` it to `http://localhost:<devPort>` (a new tab on that origin shares the login), and pass its `tabId` on every call.
- **Open every saved shot** with the Read tool before the report and check it shows what its name says (page, width, theme); a wrong or black one is re-shot once, then reported.
- No screenshot until the spot is found with `read_page`/`find` and scrolled into view (`scroll_to`); a shot shows only the top ~1150px, so the spot must be in view.
- **Before a named screenshot, wait until every image has loaded** (`await Promise.all([...document.images].map(i => i.complete || new Promise(r => { i.onload = i.onerror = r })))`), or the shot catches half-drawn pictures.
- Use short real viewports: 375×800, 1024×768, 1440×900. A tall emulated one is for builders' one-off checks.
- Theme through the theme switch (`?theme=` where the app has it) and a reload, as above.
- Page paths come from the project's CLAUDE.md.
- Close your own tab at the end (`tabs_close`); the pane has a tab cap.

## Workarounds
- **The app's own confirm dialog**: where clicking a delete or remove button opens a themed `<div role="alertdialog">`, not `window.confirm`: Click it like any other UI: `find` its confirm button (the wording is in the dialog's `<p>`) and click that, or Escape/click the backdrop to cancel. No `javascript_tool` override needed.
- **Screenshots after scrolling come out black.** Emulate a tall viewport instead (e.g. `resize_window` 390×1700) and screenshot without scrolling. A hidden pane: step 0 of the run.
- **The console log survives navigation.** For a clean one, open a fresh tab (`tabs_create`).
- **Querying as the signed-in user:** importing the app's own client in `javascript_tool` (as in the sign-in probe) gives it to you, with RLS applied and no key handling. Use it for cleaning up test rows too.
- **Test data:** mark test rows "TEST …" and delete them afterwards (CLAUDE.md: clean up what you create on dev).

## More, in `qa-and-refactor.md`
- **QA seed:** what the project's seed must do (one `javascript_tool` call, and its clean-up, for `bengt-johansson`) and where the project keeps it. A project with a database can keep seeds as `<name>.up.sql` / `.down.sql` files and a small wrapper script that runs them quietly against its dev database only.
- **Interaction checks:** wheel and trackpad scroll over a map or other widget, two scrollbars, fold and unfold; both snippets tried on dev.

## The Bengan Boys' files
`tomas-svensson`, `magnus-wislander`, `staffan-olsson` and `stefan-lovgren` are generated from `bengan-boy-template.md` here, so they don't drift apart: change the template, then write all four again, filling `{{NAME}}` (also in the screenshot file name), `{{DESCRIPTION}}` (no `: ` in it, or the frontmatter breaks), `{{VOICE}}` (the voice card's lines under `## Voice`) and `{{LANE}}` from each file's current text. A `diff` of the template and any of the four shows only those four placeholders; anything else is drift, fixed in the template first. Kit 1.5 (skills lens S2): the template had fallen behind the four (no `tools:`/`maxTurns:`, an old taste line) while this line said it hadn't.
- **Proving a refactor changed nothing:** the computed-style snapshot diff.
