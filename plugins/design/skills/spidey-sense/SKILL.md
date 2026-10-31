---
name: spidey-sense
description: Check a UI change in the built-in browser the way this project requires - 375, 1024 (and 1440) px, every theme the project has - plus the QA pass, its seed and the workarounds for confirm dialogs, screenshots and proving a refactor changed nothing. Loads with web-shooters (the shot counts, the scan, saving a shot). Use after any change the app shows.
---

## Voice
spidey-sense · the browser checker (Spider-Man) · "tingling", friendly neighbourhood, notices what's off by a pixel
- start: "Tingling. Opening the page at the narrow width first."
- commit: (silent)
- refusal: "No web to swing on here. The browser won't open; here's what I saw."
- ping: "Something's off and I can't tell if it's meant. Look?"
- wrap: "Nothing tingling. Pages checked, notes below."

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · spidey-sense <subject>` (norms.md).

**Two skills, one check** (kit 1.7, jedi-council Feature 11): the core (`<design>`, the shot counts, the page scan, headless shots and flows, saving a shot) is the `web-shooters` skill; this one is the Browser pane run and the QA parts. The QA agents preload both; `mosbius-designs` preloads only `web-shooters`. A builder who invokes this skill invokes `web-shooters` too.

## Modes
- **Builder mode** (default, for builders): run the page scan (`web-shooters`) at 375 and 1024, then read the page as text per item (`read_page`, `get_page_text`, `find`, console); screenshots as "Shot counts" says. No matrix.
- **QA mode** (`bengt-johansson` and the Bengan Boys, only on features the plan marks qa; the taste read first, since a pass means Alexander wouldn't send it back; test data from the QA seed in `qa-and-refactor.md`, driven by `read_page`/`find`, `tabId` on every browser call; the screenshot rules are under "QA screenshots"): one pass per feature (one trigger inside a `browser_batch`: navigate, act, check; a flow the order ships as a steps file runs through `qa-flow.mjs --pane`, `web-shooters`). The page scan runs first, over every width and theme in one call; text checks follow; screenshots come last and only prove what the scan and the text found. Pages with a map, a sideways row, a sheet or two columns also get the interaction checks in `qa-and-refactor.md` (wheel over each widget, two scrollbars, fold and unfold). The budget is the `[budget …]` tag in the work order, and Hank holds it (QA's target is ≤10% of a release).
- **Full matrix** (`/darth-vader`, on demand): every width below in every theme the project has.

## Shot counts
In `web-shooters`, "Shot counts (the one rule)": builder one, QA pass 5, a Bengan Boy 3, designer the scaffold's list.

## The run
`<design>` is the design plugin's folder, defined in `web-shooters`.

0. **Front the Browser pane first.** `tabs_context` says whether the pane is displayed; if it's hidden, `tabs_select` your tab (`preview_start` opens it). A hidden pane can't screenshot, stalls clicks and sheets, and draws nothing until woken (stefan lost about a dozen turns to one; seven agents' cheaper lines asked for this). A navigator fronts it before it spawns a QA agent. If it stays hidden, run the scan and the shots headless (`web-shooters`, "Headless", pages that need no sign-in) and read the rest as text.
1. Start the dev server with `preview_start` (`npm run dev` on `project.devPort` from the project's `.claude/kit.json`; configured in `.claude/launch.json`) and use the signed-in dev server's tab in the browser pane: the dev browser tab stays signed in as the test user between checks, so no login step is needed.
   - **The sign-in probe:** ask the app's own auth client for the user with the javascript tool (`tabId` of the dev server's tab); the project's CLAUDE.md says where the client lives (a Supabase app: `const m = await import('<client path>'); (await m.supabase.auth.getUser()).data.user`). If it isn't signed in, stop and tell the navigator; never reach for a login from memory.
   - **One signed-in session serves at most two browser lanes** (`[one-session]`). QA picks controls by aria-label (`find`, `read_page`), never by position, and never clicks in the header blind.
   - **Each browser lane runs its own dev port** (`npm run dev -- --port 51NN --strictPort`), signed in at the start of the lane, so lanes never share a server; restart the lane's server after any `package.json` change. The layout QA group is a fixed one that nobody toggles (the work order names it).
2. For each width: `resize_window` to **375×812** (phone) and **1024×768** (desktop, `lg`), plus **1440×900** for layout work. A width or layout release is also checked at the widest step (a 1920×1080 viewport), judged against the pages the project's CLAUDE.md names for the widest width. Reset with `preset: desktop` at the end.
3. For each theme: every one the project's CLAUDE.md lists (a project with three, such as Light, Amber and Dark, checks all three; the default is named there). **The theme switch:** a per-tab `?theme=<name>` on the URL where the app has one (the project's CLAUDE.md lists the values), else set the app's theme key in `localStorage` (the project's CLAUDE.md names it) through the javascript tool, then reload; the pane's `colorScheme` emulation does not switch the app. Colours must come from the project's theme tokens; a `dark:` pair is a finding.
4. Check with text tools first (`read_page`, `find`, `get_page_text`, `read_console_messages` for errors), then take a screenshot as proof and save it (`web-shooters`, "Saving a Browser pane screenshot").

## The page scan
In `web-shooters`, "The page scan": every width and theme of a page in one call, before any screenshot.

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
- **Test data:** mark test rows "TEST …" and delete them afterwards (CLAUDE.md: clean up what you create on dev), unless the order says `seed=shared` (below).

## More, in `qa-and-refactor.md`
- **QA seed:** what the project's seed must do (one `javascript_tool` call, and its clean-up) and where the project keeps it: its `scripts/qa/README.md` (read by section), which `CLAUDE.md` only indexes. A project with a database keeps seeds as `scripts/qa/seeds/<name>.up.sql` / `.down.sql` pairs, written by the database plugin's `gale` skill (`/gale <topic> qa`; its `scripts/seed.mjs up|down <name>` runs them on dev only, every row tagged `TEST QA seed gale:<name>`). A QA lane runs a seed with `node <design>/scripts/qa-seed.mjs up|down <name> [--lane <lane>] [seed=shared]` (kit 1.8: dev only, a `{{LANE}}` tag filled in, and under `seed=shared` a lane does nothing while the navigator seeds once); its header has the rest. **When the order says `seed=shared`** (lanes side by side), the navigator owns the one seed and the one clean-up and no lane cleans: four Bengan Boys each cleaning deleted each other's rows (kit 1.6.1 council M4).
- **Interaction checks:** wheel and trackpad scroll over a map or other widget, two scrollbars, fold and unfold; both snippets tried on dev.
- **Proving a refactor changed nothing:** the computed-style snapshot diff.

## The Bengan Boys' files
`tomas-svensson`, `magnus-wislander` and `staffan-olsson` are generated from `bengan-boy-template.md` here, so they don't drift apart (the fourth, `stefan-lovgren`, retired in kit 1.8: his interaction lane is `bengt-johansson`'s step 3). Change the template (or a Boy's `## Voice` or `## Your lane`, which are his own), then write all three again with `node <design>/scripts/bengan-boys.mjs` (it keeps each file's `{{NAME}}`, `{{DESCRIPTION}}`, `{{VOICE}}` and `{{LANE}}`, and fills the rest from the template; `--check` fails on drift, and the kit's tests run it). Never hand-edit the shared text in one Boy: kit 1.5 (skills lens S2) found the template behind the Boys while this line said it wasn't.
