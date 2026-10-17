---
name: one-ring
description: Alexander's merge go for a release. Where nothing deploys it merges here; with a deployer it taps the arm and wakes /special-delivery, which deploys and merges under it. Run in a fresh session; never on your own.
argument-hint: <version>
disable-model-invocation: true
---

Merge: **$ARGUMENTS**

**Title:** the session titles itself `<project.name> · merge · <version>` in its first minute (`set_session_title` on `self`).

## Voice
one-ring · the merge without review (the One Ring, with Gandalf's warning) · heavy, tempting, "one does not simply", only on his word
- start: "One does not simply merge. Waiting on the go I was given."
- commit: (silent)
- refusal: "I will not take it. No go, no merge."
- ping: "The Ring is heavy. Say the word, or I stay where I am."
- wrap: "It is done. Into the fire: merged, and the PR says so."

**A fresh session at the repo root,** never inside a running navigator or its follow-up (lens Must 8: all ten uses ran in an already-running session, 3.8M for a 2-minute merge, `[idle-navigator]`). This skill stays thin: kit.json, the PR's state, the merge or the hand-off, nothing else read. His typed `/one-ring` is the go for this one PR.

First read `.claude/kit.json` and take the first branch that fits:
- `"production": "none"` → "No production" below.
- `"production": "on-merge"` → "Ships on merge" below.
- **No `production` key, with `deployer` and `refs.prod` empty** (hejtide's shape): the guard reads this as production with no deployer, so it refuses the merge to everyone. Say so in one line with the fix: kit.json gets `"production": "on-merge"` when `urls.prod` is set, `"none"` when it's empty (a frozen file: Alexander's edit, or that project's setup session), then `/one-ring <version>` again. Stop there.
- **A `deployer` is named** → "With a deployer" below.

## With a deployer
The merge sits inside the deploy, after the backup and the migrations, so `ranjit` merges under the arm; this session gives the go and hands it on (kit 1.5, his words: "break out the cattle drive deploy part and have as it's own standard automatic deploy skill which should run every deploy as standard").
1. **The checkout:** the repo root (not a worktree), tree clean. `git fetch`, `git switch V<version>`, `git pull --ff-only`, each as its own call; `HEAD` equals the PR's `headRefOid` (`gh pr view <n> --json headRefOid,isDraft,mergeable,statusCheckRollup`). Red CI or conflicts: say which and stop.
2. **The tap:** `scripts/full-auto.sh arm-chain <version>`, as its own call. The guard asks him here: that tap is the one yes for the whole deploy. `arm-chain` refuses a release that changes the guard's frozen files: then send the order with "not armed, frozen set changed" and tell him the tap comes in the deploy session.
3. **Wake the deploy:** the parked session logged as `deploy` under the plan's `## Release sessions` (`<plans>V<version>.md`). `send_message` it the order from the `special-delivery` skill's "Who starts it", with this session's id (`get_session self`). The result must say `delivered`, then check its events within a few minutes (`[send-confirmed]`). **None parked:** start it (`start_session`, `initiation` "user_asked": his `/one-ring` is the ask; `use_worktree` false, title `<project.name> · deploy · <version>`, the order as `prompt`). Refused: give him the one line to type in a new session at the repo root (Opus, medium, Auto): `/special-delivery <version>`.
4. End with one line in the card's voice that the Ring went on to the deploy, and `Next: the deploy runs in <session title> (special-delivery); it reports back here.` No watchdog: this session's work is done.

## No production
The project ships nowhere (job-hunt: Alexander merged its PR #3 by hand because only a deployer could). There is no `ranjit` and nothing deploys, so this session merges. The guard still asks him at the merge itself, so run in Auto mode (in Bypass the guard can't ask and refuses).
1. Find the PR: `gh pr list --head V<version> --state open --json number,isDraft`. None open: say so and stop.
2. A draft: `gh pr ready <n>`.
3. `gh pr view <n> --json state,isDraft,mergeable,statusCheckRollup`: open, out of draft, `MERGEABLE`, every check green. A check still running: wait in the background (`gh pr checks <n> --watch`) and look again. Red or conflicting: say which and stop. Never `--admin` or `--auto`.
4. `gh pr merge <n> --merge --delete-branch`, as its own call (a merge commit, as the project's earlier releases merged). The guard reads the PR again and asks him; his yes merges.
5. `git switch main && git pull --ff-only`, then `gh pr comment <n> --body "Merged on Alexander's go (/one-ring). No production, so nothing deployed."` Wrap with the card's wrap line and the merge commit's hash.

## Ships on merge
A host ships `main` by itself and nothing else reaches production: no database; the no-database `ranjit` is its deployer (`deployer: "ranjit"`) (portfolio: Vercel deploys main to astrand.xyz; V0.1 and V0.3 handed Alexander the merge because only a deployer could). kit.json says `"production": "on-merge"` with `urls.prod` set. This session merges and ships; the guard asks him at the merge itself, naming the live URL, so run in Auto mode.
1. to 3. As "No production" above: find the PR, take it out of draft, then wait until it is open, `MERGEABLE` and every check green (leaving draft is what starts CI where CI skips drafts).
4. `gh pr merge <n> --squash --delete-branch` as its own call, or `--merge` if the project's earlier releases show merge commits on `git log main --first-parent`. The guard reads the PR again and asks him; his yes merges and ships.
5. `git switch main && git pull --ff-only`. Wait in the background for the host's deploy of the merge commit (`gh api "repos/{owner}/{repo}/deployments?sha=<merge sha>"`, then that deployment's latest status) until `success`; on `failure`, or after 10 minutes, say so and stop.
6. A signed-out look at `urls.prod` in the built-in browser at 375 and 1024: the page loads, the release's main change shows, the console has no errors. One screenshot each; nothing clicked past a link.
7. `gh pr comment <n> --body-file <file>`: "Merged on Alexander's go (/one-ring). <host> shipped <merge sha> to <url>; the signed-out look at 375 and 1024 passed (<one line on what showed>)." The release's human steps afterwards (his phone look, `[live-check]`) go in the final message, one at a time (norms.md, "A human step"). Wrap with the card's wrap line and the merge commit's hash, and `Next: /future-ted <version> in a new session (Alexander).`
