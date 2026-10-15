---
name: one-ring
description: Merge a release's PR without a review, on Alexander's go. The same run as /skinny-pete <version> merge; never on your own.
argument-hint: <version>
disable-model-invocation: true
---

Merge: **$ARGUMENTS**

**Title:** as `skinny-pete`'s: the session titles itself `<project.name> · deploy · <version>` in its first minute (`set_session_title` on `self`). Its first and last line use the card below; the work in between is that skill's.

## Voice
one-ring · the merge without review (the One Ring, with Gandalf's warning) · heavy, tempting, "one does not simply", only on his word
- start: "One does not simply merge. Waiting on the go I was given."
- commit: (silent)
- refusal: "I will not take it. No go, no merge."
- ping: "The Ring is heavy. Say the word, or I stay where I am."
- wrap: "It is done. Into the fire: merged, and the PR says so."

First read `.claude/kit.json`. If it says `"production": "none"`, follow "No production" below and stop there.

Otherwise this is `/skinny-pete <version> merge` under a shorter name (Alexander: "Still no /merge skill?"). Read `skinny-pete`'s SKILL.md and follow it exactly, with `merge` set — the deployer, manual permission mode and the guard hook all still apply, because merging ships to production. Don't shortcut any of its steps: the plan, the go, the run, the human steps, the report, and the closing "Deploy usage" PR comment.

## No production
The project ships nowhere (job-hunt: Alexander merged its PR #3 by hand because only a deployer could). There is no `ranjit` and nothing deploys, so this session merges. His `/one-ring` is the go for this one PR; the guard still asks him at the merge itself, so run in Auto mode (in Bypass the guard can't ask and refuses).
1. Find the PR: `gh pr list --head V<version> --state open --json number,isDraft`. None open: say so and stop.
2. A draft: `gh pr ready <n>`.
3. `gh pr view <n> --json state,isDraft,mergeable,statusCheckRollup`: open, out of draft, `MERGEABLE`, every check green. A check still running: wait in the background (`gh pr checks <n> --watch`) and look again. Red or conflicting: say which and stop. Never `--admin` or `--auto`.
4. `gh pr merge <n> --merge --delete-branch`, as its own call (a merge commit, as the project's earlier releases merged). The guard reads the PR again and asks him; his yes merges.
5. `git switch main && git pull --ff-only`, then `gh pr comment <n> --body "Merged on Alexander's go (/one-ring). No production, so nothing deployed."` Wrap with the card's wrap line and the merge commit's hash.
