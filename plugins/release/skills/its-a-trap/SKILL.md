---
name: its-a-trap
description: The pre-merge review of a finished release branch, in a fresh context. Reads and reports only; the report comes back to this session to fix or answer.
argument-hint: "[version, default: current branch]"
context: fork
agent: kissochbajslowski
---

**Title:** runs inside another session; keeps that session's title.

Review release **$ARGUMENTS** before it is merged. If no version was given, review the current branch: !`git branch --show-current`

Open PR, if any: !`gh pr view --json number,title,url --jq '"#\(.number) \(.title) \(.url)"' 2>/dev/null || echo "none yet"`

**Read QA first, before looking at the code:** the plan's `## qa` lines in `~/.claude/plans/V<version>.md` and the findings each `bengt-johansson` run reported (in the plan's notes, the PR body or its comments, and the screenshot folders it names). Start from what they found and checked, and spend your look on what they didn't cover (2.10.1: `kissochbajslowski` re-derived QA's findings from scratch).

The second reviewer, for design and accessibility, is `daredevil` (Sonnet, read-only), started by the navigator beside this one in every release with UI; its must/should findings come back in its own report. Leave tap targets, live regions, grouped inputs and focus to it.

There are at most two review rounds on the same code in a release; this is the second at most. A finding a third round would raise goes to the next release's first job. A job on locked files (hooks, settings, the PR template) gets a prompt forecast to Alexander first.

Follow your instructions in full, then put the whole report in one fenced code block, written as notes for the build agent.

## Grep checks (2.10.1)

Run these on the branch and report any hit as a finding (the rules are in CLAUDE.md's "Conventions in the code"; 2.10 shipped the shelf without drag and section titles squeezed by notes and toggles):

- **Sideways rows use `<ScrollRow>`:** `grep -rn "overflow-x-\(auto\|scroll\)" src --include='*.tsx' | grep -v 'src/components/ScrollRow.tsx'` should print nothing. A hit is a row a mouse can't drag.
- **Title rows hold only a title and a count:** `grep -rn -A4 "justify-between" src --include='*.tsx' | grep -B2 "<h[1-3]"` lists headings that share a row; each must share it with nothing but a count (no button, link, toggle or note). Also check new `EventSection`s: `summary` is a count or a few words that fit at 375px, `action` stays off sections of a <project.noun>'s or a stats page.
- **"Movies", not "films", and "Table 2 · <game>" (2.10.1 wrap-up):** `grep -rn "[>\"'\` ]Films\?\b\|Table \${\?[a-zA-Z0-9.]*}\? of" src --include='*.tsx'` should print no UI string (identifiers and comments are fine).
- **Popovers in a portal (2.11 wrap-up):** `grep -rl "absolute z-" src --include='*.tsx' | xargs grep -L createPortal` lists components with a floating box that isn't portalled; any that can open inside a sheet or modal (a date picker, a menu) is a finding.
- **Two-column pages are two stacks (2.11 wrap-up):** `grep -rn "lg:grid-cols-2" src/pages --include='*.tsx'`: a page whose cards alternate across the two columns (rather than two wrapper stacks) is a finding.
- **A switch hides its entry points (2.11 wrap-up):** for each nav item in `src/components/Layout.tsx` behind a feature, the page it opens checks the same switch and every link to it is behind it too.
- **Two stacks are balanced (2.12 wrap-up):** for a page with `stack('left')`/`stack('right')` or two wrapper columns, count the sections per column (`grep -n "column: '" <page>`); a column with more than twice the other's is a finding.
- **One scrollbar per page (2.12.1 wrap-up):** `grep -rn "overflow-y-auto" src/pages --include='*.tsx' | grep -v "scrollbar-width:none\|scrollbar-hidden\|Sheet\|Modal"` lists scrolling boxes with a visible bar; one that is a page column (not a sheet or a list inside a card) is a finding.
- **Maps don't take the scroll (2.12.1 wrap-up):** `grep -rn " L\\.map(" src --include='*.tsx'` must pass `scrollWheelZoom: false`; `grep -rn "openstreetmap.org/export/embed\|<iframe" src --include='*.tsx'` must sit behind a tap-to-use layer. Either missing is a finding.
- **Functions called from the browser allow its headers (2.12 wrap-up):** `grep -n "Allow-Headers" supabase/functions/_shared/cors.ts` must list `apikey` and `x-client-info`; any new function using its own CORS headers is a finding.
- **Every fixed finding is in a diff (2.10.1):** for each finding the fix pass reports as fixed, find the change in the fix commit (`git show <sha> | grep -n <file or word>`); report one without a change as still open ("check Jagged Earth ownership" shipped unfixed).
- **Convention greps (2.13.7), run in the project's conventions script (`conventions` in `.claude/kit.json`) via `npm run lint`:** raw `<button` outside `components/ui`; a button without the pointer; `${` interpolation in email HTML (typed text must be escaped); `hover:` outside the button and tab components. Lint already failing on one means the builder skipped the check; read the diff for what greps can't see (a secret in a URL, spoiler text in push or email, a cross-page state with two owners).
- **Kit logic is tested at table sizes:** a change to the project's kit logic (its CLAUDE.md's Tests line) comes with Vitest cases at the kit's min and max players (Root Smart pick filled 2 of 4 seats).
