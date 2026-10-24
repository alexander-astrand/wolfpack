# 0001: One word merges and deploys

Status: accepted, 21 Oct 2026 (kit 1.6). It replaces the deploy path of kit 1.5 (`/one-ring` waking a parked `/special-delivery` session, which spawned `ranjit` under an arm tap). Hutzup's ADR 0009 (full auto) still holds for `/cattle-drive` chains.

## His words (21 Oct 2026)
- "If I say merge, the shit is merged and deployed, no taps, no asks not five session, one go and then it merges and deploy, not hard"
- "Can you fix one ring and special delivery once and for all, I thought we should have fixed the one tap problem a long time ago, but it's just getting worse. ONE tap merge and deploy always, shouldn't be compleicated"
- "If something stops, the session fixes the problem and carries on without stopping or asking me: red CI gets fixed and pushed, conflicts get resolved, a failed backup gets retried (start Docker if it's down) and is never skipped, a migration mismatch gets worked out and the PR fixed, a failed smoke gets a fix-forward. Only a password, secret or payment waits for me, pinged on Telegram, while it carries on with the rest. Put what it may and may not fix on production in the ADR."
- "I mean what I sent should go into the deploy skill and always be how that works"

## Context
Burrow's V0.14.3.1 (a 19-file fix with one migration) didn't deploy. The fix lived on a `claude/` branch, and `/one-ring` and `/special-delivery` only found a PR on a branch named `V<version>`, so it was opened again as `V0.14.3.1`. He typed `/one-ring 0.14.3.1` in the worktree session that built it; `/one-ring` wanted a fresh session at the repo root, so it started a deploy session, which the app put in the same worktree, and that session stopped before anything ran. The navigator's try at a root session was refused (a turn woken by another session can't start one). `/special-delivery` accepted its order only from the session whose events showed him typing `/one-ring`, so nobody could forward it. And the guard kept `gh pr merge` and `prod-db.sh` to `ranjit`, with a person's tap at the arm. Three sessions, a card and a Telegram line, nothing deployed, and in the end a chained command for his own terminal. Every release since kit 1.5 had needed more of these.

## Decision
**`/one-ring <version or PR number>`, typed by him in any session of the project, merges and deploys in that session to the end.** No second session, no hand-off, no forwarded order, no parked deploy session, no `ranjit` spawn, no tap.

1. **One call does the deploy.** The session runs the database plugin's own `scripts/full-auto.sh deploy <argument>` once (in the background), and `hooks/deploy.mjs` does every step in order: the PR found by number, by its branch `V<version>` or by the version in its title (any branch); out of draft; brought up to date with main; CI green on its head; a throwaway checkout of exactly that head; the backup; the dry run equal to the PR's new migration files; the push; the PR's `prod-db.sh setting` lines; the functions the diff touches; the squash merge of exactly the head CI passed (`--match-head-commit`); the host's deploy of the merge commit; a smoke. It works from a worktree or the root, because it never uses the session's checkout for production: the throwaway checkout is made from the repo's own git at the PR's head and removed after.
2. **His typed prompt is the go, read where it can't be faked by a peer.** Claude Code writes each prompt to the session's transcript with its origin: a prompt he typed is `origin.kind: "human"`, `turnOrigin: "human"`; another session's message is "peer", the first prompt of a session another one started is "sdk", a routine is "scheduled", a Telegram line is "channel". The guard, at the deploy call itself, reads this session's own transcript (`hooks/one-ring-go.mjs`) and lets the call through without asking only when it holds his typed `/one-ring` (or its alias `/special-delivery`) naming the same argument, from the last 12 hours, and the call comes from the main session, not a subagent. `/one-ring stop` takes it back. Anything else asks him once at that call; in bypass or don't-ask mode, where nothing can ask, it's refused. Writing a transcript now asks like a frozen file.
3. **A stop is fixed, then the call runs again.** The script ends every stop with a named exit code and a `NEXT` line; it never fixes production by itself. The session fixes the cause (on the PR's branch, or in a fix-forward PR after the merge) and runs the same call again, and the script picks up where it stopped. Only a password, a secret or a payment waits for him: a Telegram line and a human step, while the session carries on with everything that doesn't need it. That is how `/one-ring` always works (the skill's step 5).
4. **The frozen files a PR changes run from main.** The throwaway checkout uses main's `scripts/prod-db.sh` and `.claude/kit.json`, so a PR's own change to them takes effect from the next deploy, after his merge. No extra ask for a release that touches them.
5. **`/special-delivery` folds into `/one-ring`** (an alias, same go). Its `ranjit` steps move to `/cattle-drive`'s `deploy-leg.md`: a chain still deploys under its tap and `done`. `/skinny-pete` stays for the manual case, and a fix PR of any size now ships through `/one-ring`.

## What the session may fix, and what it may not
Production changes only through the deploy script, after CI is green on the exact head, after a fresh and complete backup, and never by hand.

| Stop | The session may | The session may not |
|---|---|---|
| CI red | read the failing job, fix it on the PR's branch, push, run again; rerun a flaky job once and say so | merge past red CI, skip or weaken a test or a CI job, push to main |
| Conflicts, branch behind main | merge main into the branch, resolve by what both sides meant, check, push, run again | force-push main, rewrite main's history |
| Backup failed | start or restart Docker, free disk it filled itself, retry, run again | skip the backup, push or deploy anything without a fresh one, run `prod-db.sh` by hand |
| Dry run isn't the PR's migrations | renumber a PR migration main's number took, move an edit of an old migration into a new one, push, run again | edit a migration production already has, `prod-db.sh repair`, push a migration that isn't the PR's own (production missing one of main's is his call, pinged) |
| Push failed (the migration's SQL) | fix the migration on the branch (it never applied: each runs in a transaction), test it on the local stack, push, run again | run SQL on production, write or delete production data, restore a backup (his call) |
| Function deploy failed | fix the function on the branch, push, run again | change a production secret or a function's settings in the dashboard |
| Host deploy or smoke failed (after the merge) | fix forward: a new PR from main saying `Fix-forward for #<PR>`, shipped by the same go (`deploy <argument> <fix PR>`); when the site is down, the fix-forward may be a revert of the merge commit | push to main, roll the database back, delete or redeploy production by hand, change hosting settings |
| A password, a secret, a payment | ping him on Telegram, hand him the one step, carry on with everything else | read, set or guess a secret; store a password; start a paid plan or trial |

The same stop three times with no progress between them goes to him on Telegram with what was tried; the PR stays as it is.

## Why this shape
- **One script, not a relay of agents.** The deploy's steps never needed judgment, only order and checks; each judgment that sat between them (a plan round, `check-plan`, an arm-and-go message, a classifier deciding about a spawn) was a place to stall. A frozen script behind one guarded call has none, and a stop names what to fix.
- **The transcript, not a marker or a tap.** A `UserPromptSubmit` hook writing a marker was the other candidate. It fires for prompts that arrive without his hands too (a started session's first prompt, a scheduled task), with nothing in its input to tell them apart, and the marker would be one more file to protect. The transcript already carries the origin of every prompt, the guard reads it at the moment the call runs, and nothing new needs writing. A tap at the arm would keep the ask he asked us to remove.
- **His go covers one PR and its fix-forwards for 12 hours.** A fix-forward must say `Fix-forward for #<PR>` and be opened after that PR merged; anything else needs his word again.

## Consequences
- What gets easier: one typed word in any session, a fix PR on any branch, fixes on the way without asking, nothing parked or forwarded, no agent and no plan round, so the deploy costs the session's own turns.
- What it costs: the deploy runs as one long background call, so its steps aren't logged one by one in `.claude/full-auto.log`; the script's output is the record, posted to the PR. The guard can't see inside the script, so the script is frozen (the plugin's folder, or a project's `.claude/hooks/`), like `prod-db.sh`. A transcript forged by code an interpreter writes isn't seen (the same known gap as the guard's other runtime-built paths), so writing one by any plain route asks.
- Projects with their own `.claude/hooks/` copy of the guard (Hutzup) keep the kit 1.5 path until they copy `one-ring-go.mjs` and `deploy.mjs` in and run the plugin's `full-auto.sh`.
- `/cattle-drive` chains still deploy through `ranjit` under the chain marker (`deploy-leg.md`); moving them onto the same script is a later change.

24 Oct 2026, kit 1.7: `/special-delivery` deleted; `/one-ring` is the only name.
