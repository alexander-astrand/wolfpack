# The chain deploy leg (ranjit under the chain marker)

`/cattle-drive`'s deploy leg: `ranjit` runs the release's production steps under the chain marker, backup first, the merge in its place. Until kit 1.6 this was `/special-delivery`, the deploy after every merge go. Since kit 1.6 a merge go is `/one-ring`, which deploys in the session Alexander types it in through the database plugin's `scripts/full-auto.sh deploy` (`docs/decisions/0001-one-word-deploy.md` in the kit). A chain still deploys this way: its tap at the start is the go, and `done <version>` moves the chain on to its next release. The `cattle-drive` skill reads this file as a file; nothing else does.

## Preflight (a failure is a hard stop)
- **The scripts are in the project:** `scripts/full-auto.sh`, `scripts/prod-db.sh` and `scripts/chain-cover.mjs` (Read or Glob). Missing: stop and say "copy the database plugin's scripts first", with the one `cp` line from the database plugin's README ("Install the scripts"); a person runs it once, the guard never lets an agent copy them.
- **The deployer exists:** `.claude/agents/<deployer>.md` is there (the kit doesn't ship it, `[kit-agents]`). Missing: a hard stop naming the file.
- **This session is in Auto** (`get_session self` → `permissionMode`). Not Auto: switch with `set_session_permission_mode` on `self` (`auto`) and say so. Bypass and don't-ask can't prompt, so an arm tap would never reach him (2.13.6.1).
- **The checkout is the repo root at the PR head:** not a worktree, on `V<version>` with `HEAD` equal to the PR's `headRefOid`, nothing unpushed, `main` holds nothing the branch lacks (`behind_by` 0 in `gh api repos/{owner}/{repo}/compare/main...V<version>`). Clean by the guard's own rule: no tracked change, and no untracked, ignored or hidden file under `supabase/` or `scripts/` (untracked files elsewhere are fine). **Never suggest deleting an untracked file this run didn't write:** name its source (file time, `search_session_transcripts`) and go on.
- **Access changed since the last deploy** (a new deployer file, a moved key in kit.json, new allow lines): a read-only run-check first, `ranjit` with the order "check, for release <version>", and go on only when it reads production.
- **Human steps before the deploy can finish** are all ticked (`- [x]`) in the PR, or the list says "None". One open: walk it with him (below, "Waiting on Alexander"), then go on.
- **Every time comes from tool output,** never `date` or `scripts/stamp.sh` (`[auto]`). **This session never reads a file through Bash** (`sed`, `cat`, `head`, `awk`): Auto's classifier refuses exactly that as "Merge Without Review"; use Read and Grep, and single plain commands, never a compound shell line.

## Hard stops
These always wait for Alexander. Ping (a Telegram line, `~/dojo/bin/miyagi-push.sh "<line>"`, plus a message here saying exactly what stopped and what he can do), disarm (`scripts/full-auto.sh disarm`, as its own call), and end the turn:
- a failed backup;
- a migration dry run that doesn't list exactly the release's migrations, or a `repair` proposal;
- red CI, merge conflicts;
- an unfinished item under "Human steps before the deploy can finish" that he skips;
- a feature the plan marks qa whose QA never ran;
- a failed smoke test;
- any hotfix (`/skinny-pete`'s "Hotfix", on his go);
- `check-plan` finding a mismatch between `ranjit`'s plan and the PR;
- **any call the guard asks about under the marker.** Nothing on the list should ever ask, so the call and the list disagree. The fallback: he denies it, `scripts/full-auto.sh disarm`, and `/skinny-pete <version> merge` in a new session in manual mode.

A production surprise is never a senior's call. Anything that isn't a hard stop takes another route (the `cattle-drive` skill's "Everything else keeps going"); never re-spell a refused production command.

## Waiting on Alexander
A production password, a secret, a dashboard setting or an open human step is his (norms.md, "A human step": one step at a time, its terminal tab, Done / Skip it). Send the Telegram line, write the step as text, and **end the turn with no watchdog and no timer**: his next message here wakes it (council M1). The ledger link (`<plans>human-steps.md`) goes in that message, never "yours when you're ready".

## The deploy
1. **The cover.** With a chain marker from the arm tap (`.claude/full-auto-chain.json` lists `<version>`), `node scripts/chain-cover.mjs <version>` exits 0. Exit 1 (the frozen set moved since the tap) means the arm order won't pass Auto's classifier: say so with the script's lines and wait for his `go`, then `scripts/full-auto.sh disarm` and `scripts/full-auto.sh arm-chain <version>`, each as its own call. **The arm** without a marker (typed in place, or a release that changes the frozen files, where `arm-chain` refuses): run `scripts/full-auto.sh arm <version>` yourself, as its own call, after step 3's `check-plan` passes; the guard asks him, and that tap is the go. Then one spawn of `ranjit`, naming only `V<version>`, carries the plan and says "armed: no `arm`, run the plan as shown from step 1"; no arm-and-go message, and step 6 ends with `disarm`. `gh pr list --state open` shows exactly one release PR, `V<version>`; a draft is fine, `ranjit` marks it ready right before the merge. `gh pr view <n> --json mergeable,statusCheckRollup,headRefOid` shows no conflicts and CI's own jobs green. Every step the plan marks qa has its QA result in the PR.
   **From the arm until the disarm nobody edits this checkout,** and `ranjit` never checks out or pulls `main`: he stays on the release branch at the armed commit.
2. **Plan.** Run `scripts/full-auto.sh preview <version>` first, as its own call. **When it prints a "Plan, as ranjit writes it" block that passes `check-plan` from the file, and the cover holds, skip the plan round** (`[deploy-plan-skip]`): save the block, run step 3 on it, and the first spawn of `ranjit` carries step 4's order directly. Otherwise start `ranjit` (it runs at its agent file's effort) for the exact ordered plan, nothing run on production yet, and the arm order goes by `SendMessage` after it (`[deploy-order]`). The guard passes a spawn of `ranjit` whose prompt names **one** version (`orderAllow`), so the prompt names `V<version>` only.
   **The order text carries, every time** (`[deploy-order]`; with these lines a backup + migration deploy took 5.6 min and 10.5M and nothing asked, without them 17.3M and two plan rounds), never his agent file, which is frozen:
   - the production URL (`urls.prod`), the PR's state fields (`gh pr view <n> --json state,isDraft,mergeable,headRefOid,statusCheckRollup,reviewDecision,mergeStateStatus`; REVIEW_REQUIRED or BLOCKED means `--admin`), the `preview` output, and "skip the PR body";
   - the post-merge reads by tool, loaded in one ToolSearch: `list_migrations`, `list_edge_functions` (when functions ship), `get_advisors` (security), one `query_logs`;
   - production's migration list and the release's new `security definer` functions from the plan, for the advisor allow-list;
   - **Docker is running** (`docker info`) before the arm on a database release: `prod-db.sh backup` needs it;
   - **the smoke is a look, not a bare 200:** with `urls.prod` empty there is no deploy wait and no smoke. Otherwise, after the merge he opens the production URL signed out in the built-in Browser pane (`mcp__Claude_Browser__*`, or the Chrome read tools when connected; `tabs_close_mcp` in the same ToolSearch so the tab gets closed) at 375 and 1024 px, on every route the release adds (the PR's "What changed"), not only `/` (`[edge-route]`). Signed-in looks are human steps afterwards;
   - the PR's "Human steps afterwards", cut from the body by you and pasted inline;
   - one listed call per message, in the list's order; every wait is single listed reads, one per message, no loops and no `sleep`;
   - each command in a code span or on a bare line (a `[tag] command` line is invisible to `check-plan`); no separate `prod-db.sh dry-run` (`push` runs its own);
   - function deploys run **before** the merge, so the PR lists them under "Before merge"; safe only when additive for the live frontend;
   - "Hand the report back; the navigator posts it" and "You close the run": `ranjit` runs `scripts/full-auto.sh done`; the guard refuses it from you.
   **The merge comment is written now, with Write,** in your scratch folder, before the arm: neutral words ("merged on Alexander's go (/cattle-drive) under the arm tap; CI green; plan check: <line>", never "without a review"), @<reviewer> when kit.json `reviewer` is set, the backup folder. The order hands `ranjit` its path; he posts it with `gh pr comment --body-file` and writes no text of his own (he has no Edit or Write). No heredoc and no `printf >>` from here on. Every file the run posts is written before `ranjit` starts, and the production migration comes from the dry-run, never from his summary.
3. **`check-plan`.** Save `ranjit`'s plan (or the preview's block), one step per line, with Write, and run `scripts/full-auto.sh check-plan <version> <absolute path>` as its own call. It checks every command and nothing extra, the backup first whenever the database changes, the right migrations, the right project ref (`refs.prod`), and the merge as `gh pr ready <n>` (when a draft) right before `gh pr merge <n> --squash [--admin]`. A mismatch goes back to `ranjit` and the check runs again; twice is a hard stop.
4. **Arm and go, one order.** Under the chain marker, continue the same `ranjit` with one SendMessage, exactly this, nothing added (`<n>` is the step his plan numbered first):

   `Arm and go, under the marker for V<version>: scripts/full-auto.sh arm <version> as its own call, then the plan as shown, from step <n>.`

   The guard lets that text, and nothing else, past Auto's classifier, from the main session while a marker lists `<version>`. One message covers the arm and the go; there is no second "Go". A refused arm is the fallback (`/skinny-pete`), not a retry. From here nothing is pushed to the release branch: the marker holds the armed SHA.
5. **Run.** `ranjit` runs the arm, then the plan, with no further message from you. The guard lets him, and only him, run the listed commands without asking and logs each to `.claude/full-auto.log`. Relay any stop as a hard stop.
6. **Afterwards.** Wait for `ranjit`'s hand-back message itself before reading the run as finished or stopped (a late task notification once caused a false stop, 2.13.2.1). He copies nothing. Read `.claude/full-auto.log` with the Read tool, write the report body with Write (the run, the backup folder, @<reviewer> when set, the log in a code block) and post it with `gh pr comment <n> --body-file <file>`. End the run with `scripts/full-auto.sh done <version>` under the chain marker (it checks production and disarms when it can't confirm); otherwise `scripts/full-auto.sh disarm`, as its own call. Never `disarm` after `done`: the wrap-up needs the finished marker, and a `/cattle-drive` chain's conductor disarms after its last wrap-up.

## Records
Right after step 6, or at the first human step when one comes earlier (a "done" that never comes must not hold the records back, 2.10.1):
- **Production memory:** `project_production_migration_pending.md` says what production now has (migrations, functions, date) and the backup folder.
- **Deploy usage:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs --timeline <this session's id>` (`get_session` with `"self"`), posted as the run's last PR comment under a "Deploy usage" heading: the session id, the per-model table, the wall-clock line and the weekly meter. `/future-ted` reads it instead of hunting the transcript. `ranjit`'s report states no token numbers of its own.
- **Human steps afterwards** don't hold the run: tick what ran in the ledger `<plans>human-steps.md` (`[x] (<date>)`), and walk the open ones with him one at a time ("Waiting on Alexander").
