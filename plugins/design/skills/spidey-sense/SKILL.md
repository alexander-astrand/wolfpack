---
name: spidey-sense
description: Check a UI change in the built-in browser the way this project requires - 375, 1024 (and 1440) px, dark and light theme - plus the workarounds for confirm dialogs, screenshots and proving a refactor changed nothing. Use after any change the app shows.
---

**Title:** runs inside another session; keeps that session's title.

## Modes
- **Builder mode** (default, for builders): run the layout check (below) at 375 and 1024, then read the page as text per item (`read_page`, `get_page_text`, `find`, console); at most one screenshot for the step, only when a text check can't tell what's on screen. No matrix.
- **QA mode** (`bengt-johansson` and the Bengan Boys, only on features the plan marks qa; `.claude/taste.md` read first, since a pass means Alexander wouldn't send it back; test data from the QA seed in `qa-and-refactor.md`, driven by `read_page`/`find`, `tabId` on every browser call; the screenshot rules are under "QA screenshots"): one pass per feature — one trigger inside a `browser_batch` (navigate, act, check) — at 375 dark and 1024 dark, plus one light screenshot, with text checks between and a saved screenshot each. The layout check runs first, at both widths, before any screenshot. Pages with a map, a sideways row, a sheet or two columns also get the interaction checks in `qa-and-refactor.md` (wheel over each widget, two scrollbars, fold and unfold). The budget is the `[budget …]` tag in the work order, and Hank holds it (5 screenshots per feature, frame shots not counted; QA's target is ≤10% of a release).
- **Full matrix** (`/darth-vader`, on demand): every width below in both themes.

## The run
1. Start the dev server with `preview_start` (`npm run dev` on `project.devPort` from the project's `.claude/kit.json`; configured in `.claude/launch.json`) and use the signed-in dev server's tab in the browser pane: the dev browser tab stays signed in as the test user between checks, so no login step is needed. **The sign-in probe:** ask the app's own auth client for the user with the javascript tool (`tabId` of the dev server's tab); the project's CLAUDE.md says where the client lives (a Supabase app: `const m = await import('<client path>'); (await m.supabase.auth.getUser()).data.user`). If it isn't signed in, stop and tell the navigator; never reach for a login from memory.
2. For each width: `resize_window` to **375×812** (phone) and **1024×768** (desktop, `lg`), plus **1440×900** for layout work. A width or layout release is also checked at the widest step (a 1920×1080 viewport), judged against the pages the project's CLAUDE.md names for the widest width. Reset with `preset: desktop` at the end.
3. For each theme: **dark** and **light** (the project's CLAUDE.md says which is the default). **The theme switch:** set the app's theme key in `localStorage` (the project's CLAUDE.md names it) to `'light'` or `'dark'` through the javascript tool, then reload; the pane's `colorScheme` emulation does not switch the app. Colours must come from the project's theme tokens; a `dark:` pair is a finding.
4. Check with text tools first (`read_page`, `find`, `get_page_text`, `read_console_messages` for errors), then take a screenshot as proof and save it (below).

## The layout check (before any screenshot)
`${CLAUDE_PLUGIN_ROOT}/scripts/qa/layout-check.js` lists text that's cut off, sideways rows a mouse can't drag (no `data-drag-scroll`, the marker the project's drag-scroll row sets) and tap targets under 44px, as JSON with a selector and the text for each. The project keeps a copy at `scripts/qa/layout-check.js` (copied from the plugin once) so the dev server serves it; then one `javascript_tool` call runs it without pasting the file:

```
const src = await (await fetch('/scripts/qa/layout-check.js')).text(); JSON.parse(eval(src))
```

Run it at 375 and 1024. Cut-off section titles and rows without drag are findings; small targets are worth a look (inline links in running text are left out, but header links and icon buttons still show up). It found a member page's truncated shelf title and its undraggable shelf at 375 in one call.

## Saving a screenshot
The screenshot tool returns the image and writes no file, but the image is kept in the transcript. Right after taking one (scale 1, so it's full size), run:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/spidey-sense/save-shot.mjs <scratchpad>/<step>-<width>-<theme>.jpg
```

It writes the newest screenshot from this project's transcripts (the session's and its subagents', last 5 minutes) and prints when it was taken. Run it straight after each screenshot: another agent screenshotting in the same seconds could win. List the saved paths in your report; the PR lists them for the reviewer, who opens them with the Read tool.

## QA screenshots
Three QA passes lost their named shots to exploratory ones, and parallel runs in one tab came back misnamed or black (2.12.1: three re-shoots, 15.8M), so:
- **Your own tab:** `tabs_create`, then `navigate` it to `http://localhost:<devPort>` (a new tab on that origin shares the login), and pass its `tabId` on every call.
- **Open every saved shot** with the Read tool before the report and check it shows what its name says (page, width, theme); a wrong or black one is re-shot once, then reported.
- No screenshot until the spot is found with `read_page`/`find` and scrolled into view (`scroll_to`); a shot shows only the top ~1150px, so the spot must be in view.
- **Before a named screenshot, wait until every image has loaded** (`await Promise.all([...document.images].map(i => i.complete || new Promise(r => { i.onload = i.onerror = r })))`), or the shot catches half-drawn pictures.
- Use short real viewports: 375×800, 1024×768, 1440×900. A tall emulated one is for builders' one-off checks.
- Theme through the theme switch and a reload, as above.
- Page paths come from the project's CLAUDE.md.
- Close your own tab at the end (`tabs_close`); the pane has a tab cap.

## Workarounds
- **The app's own confirm dialog**: where clicking a delete or remove button opens a themed `<div role="alertdialog">`, not `window.confirm`: Click it like any other UI: `find` its confirm button (the wording is in the dialog's `<p>`) and click that, or Escape/click the backdrop to cancel. No `javascript_tool` override needed.
- **Screenshots after scrolling come out black.** Emulate a tall viewport instead (e.g. `resize_window` 390×1700) and screenshot without scrolling. A hidden pane can't screenshot either: use `get_page_text`/`find`.
- **The console log survives navigation.** For a clean one, open a fresh tab (`tabs_create`).
- **Querying as the signed-in user:** importing the app's own client in `javascript_tool` (as in the sign-in probe) gives it to you, with RLS applied and no key handling. Use it for cleaning up test rows too.
- **Test data:** mark test rows "TEST …" and delete them afterwards (CLAUDE.md: clean up what you create on dev).

## More, in `qa-and-refactor.md`
- **QA seed:** what the project's seed must do (one `javascript_tool` call, and its clean-up, for `bengt-johansson`) and where the project keeps it.
- **Interaction checks:** wheel and trackpad scroll over a map or other widget, two scrollbars, fold and unfold; both snippets tried on dev.

## The Bengan Boys' files
`tomas-svensson`, `magnus-wislander`, `staffan-olsson` and `stefan-lovgren` are generated from `bengan-boy-template.md` here, so they don't drift apart: change the template, then write all four again, filling `{{NAME}}`, `{{DESCRIPTION}}` (no `: ` in it, or the frontmatter breaks), `{{VOICE}}` and `{{LANE}}` from each file's current text. A `diff` of any two shows only those four places and the screenshot file name.
- **Proving a refactor changed nothing:** the computed-style snapshot diff.
