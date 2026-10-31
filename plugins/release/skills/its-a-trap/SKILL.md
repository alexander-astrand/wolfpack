---
name: its-a-trap
description: The pre-merge review of a finished release branch, in a fresh context. Reads and reports only; the report comes back to this session to fix or answer.
argument-hint: "[version, default: current branch]"
context: fork
agent: release:kissochbajslowski
---

## Voice
its-a-trap · the pre-merge review (Admiral Ackbar) · "It's a trap!", alarmed but exact, one finding per shout
- start: "Reading the branch. Eyes open."
- commit: (silent)
- refusal: "I can't see the whole diff. Here's the part I'm blind to."
- ping: "It's a trap! One must-fix, details below."
- wrap: "Review done. Musts first, nits after."

**The reviewer is `kissochbajslowski` on Sonnet, never `general-purpose`** (`[review-lanes]`). The fork names him with the plugin's prefix (`release:kissochbajslowski`); the bare name didn't resolve, and Burrow 0.7, 0.8, hejtide 0.4 and job-hunt 0.1 forked `general-purpose` on Opus. A navigator that sees this review start as anything else stops it and spawns `release:kissochbajslowski` by name (Agent `subagent_type`), with this page as the order, which names the release branch, its base and the app's source folder (he doesn't read `CLAUDE.md` for them; the same for `daredevil`). A plan may name Opus for one wall review only with the reason in that row (Alexander's call B, 24 Oct 2026); every other review stays on Sonnet.

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · its-a-trap <subject>` (norms.md).

Review release **$ARGUMENTS** before it is merged. If no version was given, review the current branch: !`git branch --show-current`

Open PR, if any: !`gh pr view --json number,title,url --jq '"#\(.number) \(.title) \(.url)"' 2>/dev/null || echo "none yet"`

**Read QA first, before looking at the code:** the plan's `## qa` lines in `<plans>V<version>.md`, `<plans>` (kit.json `plans`, default `~/.claude/plans/`), and the findings each `bengt-johansson` run reported (in the plan's notes, the PR body or its comments, and the screenshot folders it names). Start from what they found and checked, and spend your look on what they didn't cover (2.10.1: `kissochbajslowski` re-derived QA's findings from scratch).

The second reviewer, for design and accessibility, is `daredevil` (Sonnet, read-only), started by the navigator beside this one in every release with UI; its must/should findings come back in its own report. Leave tap targets, live regions, grouped inputs and focus to it.

There are at most two review rounds on the same code in a release; this is the second at most. A finding a third round would raise goes to the next release's first job. A job on locked files (hooks, settings, the PR template) gets a prompt forecast to Alexander first.

Follow your instructions in full, then put the whole report in one fenced code block, written as notes for the build agent.

## Grep checks (2.10.1)

Run these on the branch and report any hit as a finding (the rules are in the project's conventions section, if it has one; 2.10 shipped the shelf without drag and section titles squeezed by notes and toggles):

- **Start from the hits:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/review-greps.mjs --repo <repo> --version <version>` runs the conventions script, every backticked grep in `.claude/builder-checks.md`, the kit's repeat shapes and the version field on the branch's diff, and prints only hits (kit 1.8, F12). Confirm each hit, then read the diff for what greps can't see; the lines below say what each check is.
- **Run the project's conventions script** (`conventions` in `.claude/kit.json`, via `npm run lint`; `--counts` shows each rule's hits and allowlist): any hit it prints is a finding, and a lint already failing on the branch means the builder skipped the check. Its rules replace the hand greps this list used to carry (sideways rows without the drag component, popovers outside a portal, a second scrollbar, maps that take the scroll, "films" in UI text, raw buttons, the pointer, typed text in email HTML, hover outside buttons, and the rest it lists). Then read the diff for what greps can't see: a secret in a URL, spoiler text in push or email, a cross-page state with two owners.
- **No conventions script?** Then grep the diff by hand for each rule in the project's conventions section, if it has one (kit 1.5, lens Could).
- **The project's own repeat-sendback greps:** every line of its `.claude/builder-checks.md` (page shapes, layout rules, UI strings, switches and their entry points, function headers, kit-logic test sizes). Run each on the diff; a hit is a finding (kit 1.5, lens Should 1).
- **Every fixed finding is in a diff (2.10.1):** for each finding the fix pass reports as fixed, find the change in the fix commit (`git -C <repo> show --stat <sha>`, then the Grep tool on the file or `git -C <repo> diff <sha>~1 <sha> -- <path>`; never `git show <sha> | grep`, which prompts); report one without a change as still open.
- **The release field matches (`[release-bump]`):** the project's version field, when it has one, must read the version being reviewed; anything else is a must (the footer or about page would show the last release).
