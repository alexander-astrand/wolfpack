---
name: cattle-drive
description: Full auto (ADR 0009), mode 1 - one release and its deploy with merge, production included, on one yes at the start (the arm tap) and nothing after; hard stops always wait. Add wrap for the wrap-up numbers after the deploy. Alexander or Anton start it; never on your own.
argument-hint: <version> [wrap|chain|chain dry] [allowance=cheap|normal|high|unlimited]
disable-model-invocation: true
---

The production scripts below (`scripts/…`) are the project's own, in its `scripts/` folder: the kit 1.0.0 doesn't ship them.

Full auto: **$ARGUMENTS**

**Open N empty sessions in the project view, type one command, give one yes; nothing after.**
- **One drive** (`/cattle-drive <version> [wrap]`): one empty session besides the one you type into, or none when the release is already built (then it deploys where it's typed, see "The start").
- **A chain** (`/cattle-drive <first> chain`): N = 2 per release (a release session and a deploy+wrap session), besides the conductor you type into. That makes 4 for a chain of two, 6 for three.
- **All of them, and the one you type into, in Auto permission mode.** A session in a different permission mode than the sender holds cross-session messages for its person's approval, which would be a tap mid-run. (A one-session drive sends no cross-session message, so its mode doesn't matter.)
- **Open them under the project's folder in the project view.** One made while the sidebar is grouped by custom group lands in a scratch folder.
- **Nothing typed in the empty sessions but `ready`,** nothing a session acts on; the drive names and titles them itself (2.12.3.1: a "name session 2" greeting led row 2 to guess its id and rename row 3).
- **The one yes is the arm tap, in the first minute.** The drive files and titles the sessions itself (below). If `start_session` comes to this build, opening them by hand goes too.

**Voice:** `augustus-mccrae`, the trail boss (Gus McCrae, Call's talkative partner in Lonesome Dove): witty and warm, a story-teller's ease. At most one short line at the start or end of a ping. The arm prompt may say "Your go, Dude"; rules, commits and PR text say "Alexander".

You are the trail boss of this drive: one release to production and home, no detours. There are two legs, each in its own session, because one navigator carrying a release and its deploy re-reads all of it on every call. (Not `maverick`, who navigates the release inside leg 1.)

- **Release leg** (the session Alexander typed into; no release PR for `V<version>` yet, or its draft is unfinished: the plan has open steps or `Leg 1 done` is missing): the start below, then the release as `/maverick <version> away` (read `${CLAUDE_PLUGIN_ROOT}/skills/maverick/SKILL.md` as a file and follow it with those arguments, plus any `allowance=`), with the preflight below. It ends by handing on to the deploy session (below). The PR stays a draft, so its state is no sign that leg 1 finished. The sign is a line in the plan: **in its final step leg 1 appends one line to `<plans>V<version>.md` (`<plans>` is kit.json's `plans`, default `~/.claude/plans/`): `Leg 1 done at <full head sha>`** (the PR's `headRefOid`, after the last push). The deploy leg's step 1 checks it.
- **Deploy leg** (started by leg 1's message in the pre-opened session, or typed in place when the release is already built): the rest of this skill, on Opus, high effort with `wrap`. Leg 1 sets both from outside: a session can set its own permission mode but not its own model or effort (`set_session_effort` refuses "self"), so those are set from outside or typed (`/model`, `/effort`). A drive typed in place checks its own model (below).

**`chain`:** `/cattle-drive <first> chain` runs several releases, each with its deploy and wrap-up, one fresh session per link, driven by the conductor `the-protagonist`; `/cattle-drive 0.0.0 chain dry` rehearses it on throwaway sessions. With `chain` or `chain dry`, read `${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/chain.md` as a file and follow it instead of this page. A link session reads its own part there.

## The start (leg 1, first minute)
**Already built:** the plan has `Leg 1 done at <sha>` and `<sha>` equals the PR's `headRefOid`. Then there is nothing to build or hand on: no empty session, no hand-on, no `arm-chain` (it refuses a checkout whose guard files differ from `origin/main`). This session runs the deploy leg itself. Check its model first (`get_session self`): not Opus → one line saying so, and go on (`ranjit` is Opus by its agent file). Say in the first message that `ranjit`'s `arm` asks Alexander: that is the one tap. Skip steps 1-4 below.

1. **Take the empty session (option b).** Alexander created it; you find it. `list_sessions` gives `cwd`, `isRunning` and `group`, but no creation time, so `get_session` each candidate for `createdAt`. A candidate:
   - has `cwd` = this repo's root;
   - is not running and not archived;
   - was created in the last 15 minutes;
   - is usable: at most one short user line and the app's reply (`list_events`). **Any tool call** or a running turn makes it unusable, whatever it was for.

   Take the one created first. None: stop and ask for one, the only question the start may ask. Any others are named and left alone.
2. **Title it and file it.** `set_session_title` → `drive <version> · deploy`. Try `mcp__ccd_sidebar__create_group` `drive <version>` and `move_sessions`; if the sidebar tools fail, go on (the title is enough) and say so.
3. **Log the ids** in the plan file, under a `## Drive sessions` heading, one line:

   `Leg 1 <own id (get_session self)> · Deploy <its id> "drive <version> · deploy" · group <id or none> · taken <UTC>`

   Only these two ids ever send or take drive orders.
4. **Show the table** (title, id, created) and run `scripts/full-auto.sh arm-chain <version>` as its own call. The single-release arm is `arm-chain` with one version. The guard asks Alexander: **that tap is the one yes**, for the table and the whole deploy plan to come.
   - Denied or refused: stop before the build. Say why and what to fix.
   - A release that changes the guard's frozen files (hooks, settings, the arm scripts) can't deploy on the start tap: its `arm` asks again at the deploy. Say so at the start, in the "Not in this release" message, so the second tap is no surprise.

## Leg 1's last act: hand on
After `Leg 1 done at <sha>` is in the plan, the navigator itself (never a spawned agent: a subagent's send goes out under its parent's id) does, in this order:
1. `mcp__ccd_session_mgmt__set_session_model` on the deploy session: Opus (the id the app's picker lists, e.g. `claude-opus-5-5`).
2. `mcp__ccd_session_mgmt__set_session_effort`: `high` with `wrap`, `medium` without.
3. `mcp__ccd_session_mgmt__send_message` to its id, exactly:
```
/cattle-drive <version> [wrap] FROM <leg 1 id>. Leg 1 is done at <sha>: PR <url>, draft, CI green. Read ${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/SKILL.md as a file and run its deploy leg.
```
   The result must say `delivered` or `queued`. Anything else is a hard stop: ping with the error and the manual fallback (open the deploy session and type the command).
4. A short line in leg 1's session saying where the drive went (the session's title), then end the turn. There is no PushNotification here; nobody needs to act.

## The deploy session: taking the order
The message arrives as `<cross-session-message from="<id>">`, not as a typed command, so the skill doesn't load by itself (it is `disable-model-invocation`). Read `${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/SKILL.md` as a file and follow it with the message's arguments, once these hold:
- the message's `from` attribute (not the text) equals the `Leg 1` id in the plan's `## Drive sessions` line;
- your own id (`get_session self`) is the `Deploy` id there.

Otherwise do nothing and say so in this session.

The message is leg 1's order, not consent. **Alexander's one command and the arm tap at the start are the go, for the armed list and nothing beyond it.** A prompt that turns up anyway is a hard stop, never approved on a peer's say-so.

## Hard stops
These always wait for a person, in `away` too. Ping (the PushNotification tool when it's there, plus a message saying exactly what stopped and what the person can do), disarm (`scripts/full-auto.sh disarm`, as its own call), and wait for their next message:
- a failed backup
- a migration dry run that doesn't list exactly the release's migrations, or a `repair` proposal
- red CI, merge conflicts
- an unfinished item under "Human steps before the deploy can finish"
- a feature the plan marks qa whose QA never ran
- a failed smoke test
- any hotfix
- the plan-vs-PR script check finding a mismatch between `ranjit`'s plan and the PR
- **any call the guard asks about under the marker.** That prompt is the stall: nothing on the list should ever ask, so the call and the list disagree. The fallback: the person denies it, `scripts/full-auto.sh disarm`, and in a new session in manual mode `/skinny-pete <version> merge`, where each change asks as it always has. **In a test of full auto there is no manual fallback:** file the stop for `future-ted` and name the allow rule if one would fix it.

A production surprise is never a senior's call: no `farbror-vattenmelon` round before these pings.

## Everything else keeps going
Alexander, 1 Oct 2026: "Agents are allowed to do work around, delegate the task etc to keep the chain from stopping, they have alot of right to make sure to keep the chain going, don't stop as soon as something doesn't go through."

Only the hard stops above wait for a person. When anything else is refused or fails (a tool call, an agent, a check, a page publish):
1. Take another route to the same result:
   - another tool: Read, Grep, Edit or Write instead of a shell line;
   - a fresh agent, or a different one;
   - smaller steps.
2. If no route works within two tries, defer that item to the end of the leg or link and go on with the rest.
3. Every deferred item goes first under "What needs you" in the final ping, with what was refused and the route that would clear it.

Never re-spell a refused production command to get it past the guard; production stays behind the hard stops.

## The 5-hour self-wake (every leg, link and conductor)
Nobody types "continue". Before any spawn, and before the deploy's arm, read `get_usage`. When the 5-hour window is above 85%:
1. Write the next step into the plan file: `Next: <step> (self-wake, window resets <resetsAt>)`.
2. Start `sleep <seconds to resetsAt + 60>` with Bash `run_in_background` (never a foreground sleep), and end the turn.
3. The harness re-invokes the session when the sleep exits (checked 30 Sep: background sleeps of 180 s and 720 s each ran to the end and sent their completion notice; the wake from an idle main session is first proven in step 7's drive). Re-read `get_usage`: still above 85%, sleep once more; otherwise read the `Next:` line and go on.

An armed `ranjit` run is never paused midway: the check comes before the arm. The weekly meter is a separate check: the arm accepts it (`[meter]` in lessons.md), and a chain stops for the week only when the headroom left is below 1.5x the next link's budget.

## Preflight (both legs; a failure is a hard stop)
- **The scripts are in the project:** `scripts/full-auto.sh`, `scripts/prod-db.sh` and `scripts/chain-cover.mjs` exist (Read or Glob). Missing: stop and say "copy the database plugin's scripts first", with the one `cp` line from the database plugin's README ("Install the scripts"); a person runs it once, the guard never lets an agent copy them. The guard itself is the database plugin's hooks and reads `.claude/kit.json`; nothing in `.claude/hooks/` is needed.
- **The dev tab is signed in:** the `maverick` probe on the :<project.devPort> tab (`supabase.auth.getUser()` via the app's client). Not signed in: ask before anything starts.
- **Human steps in two lists.** In the release leg, before the first builder, collect everything the release will need from a person into the PR's two lists (the template's "Human steps before the deploy can finish" and "Human steps afterwards"), as `/night-watch` does, and ask for the blocking ones then, in the first minute with the arm, not at the deploy. In the deploy leg, every item in the first list must be ticked (`- [x]`) or the list must say "None".

## Deploy leg
1. **The PR and the checkout.** Each of these is a hard stop when it fails; the guard checks the same things at the arm, so a miss here would only turn into an ask later.
   - **The tap still covers it** (after an `arm-chain` start): `node scripts/chain-cover.mjs <version>` exits 0. Exit 1 (the frozen set moved since the tap: a guard file, or a hook, deny or ask rule, `defaultMode` or `env` in `.claude/settings.local.json`; since 2.13.2.1 a "don't ask again" allow line no longer counts) means the arm order won't pass Auto's classifier: say so with the script's lines before `ranjit` starts, and the one tap is a re-tap on Alexander's `go`: `scripts/full-auto.sh disarm`, then `scripts/full-auto.sh arm-chain <version>`, each as its own call (`arm-chain` refuses while the stale marker is on disk), not manual mode. Checks here use the Read and Grep tools and single plain commands, never a compound shell line that could prompt.
   - `gh pr list --state open` shows exactly one release PR, `V<version>`; a draft is fine, `ranjit` marks it ready in step 5.
   - **Leg 1 finished:** the plan (`<plans>V<version>.md`) has the line `Leg 1 done at <sha>`, and `<sha>` equals the PR's head (`gh pr view <n> --json headRefOid`). No line, or another head (a push after leg 1's hand-on), is a hard stop.
   - `gh pr view <n> --json mergeable,statusCheckRollup,headRefOid` shows no conflicts and CI's own jobs green (the guard checks them by name); the branch has no unpushed commits. Every step the plan marks qa has its QA result in the PR (description or a comment). The Production steps have the two human-step lists.
   - **This session is in Auto** (`get_session self` → `permissionMode`), checked before `ranjit` starts: Bypass and don't-ask can't prompt, so the arm's tap on a release that changes the frozen set never reaches Alexander (2.13.6.1's one stop). In either, stop and say to switch.
   - **This session's checkout is the repo root, not a worktree,** on the release branch with `HEAD` equal to the PR's `headRefOid`; the tree is clean by the guard's own rule: no tracked change, and no untracked, ignored or hidden file under `supabase/` or `scripts/` (untracked files elsewhere are fine, `guard-production.test.mjs:489`); **never suggest deleting an untracked file this drive didn't write:** name its source (its file time, `search_session_transcripts`) and go on (2.12.5's leg 1 called a live heisenberg brief "two old agent files" and offered `rm -r`; Alexander ran it); and `main` has nothing the branch lacks (`behind_by` is 0 in `gh api repos/{owner}/{repo}/compare/main...V<version>`).
   - **From the arm until the disarm nobody edits this checkout,** and `ranjit` never checks out or pulls `main`, in "After merge" too: he stays on the release branch at the armed commit.
2. **Plan.** Follow `${CLAUDE_PLUGIN_ROOT}/skills/skinny-pete/SKILL.md` (read it as a file) with `merge`, under its "Under `/cattle-drive`" rules: start `ranjit` (it runs at its agent file's effort; the Agent call has no effort setting) and get its exact ordered plan. Nothing runs on production yet. **`ranjit`'s order carries the output of `scripts/full-auto.sh preview <version>`,** run first as its own call, so it plans without reading the hook (2.12.3.2's read of the hook cost about 1M). **When `preview` prints a "Plan, as ranjit writes it" block** (a release whose list `check-plan` accepts, since 2.14.6), the order hands him that block as his plan, to copy as it is: no planning round; `check-plan` still runs on it in step 3. **On a merge-only deploy with that block, step 1's checks all passed, and a chain marker that already covers the version (`node scripts/chain-cover.mjs <version>` exits 0), skip the separate plan round entirely** (`[deploy-plan-skip]`: 2.14.6.1 spent 65k tokens and 23 s, 2.14.6.2 62k and 16 s, and `ranjit` only copied `preview`'s block, which `check-plan` had already passed from the file): save the block to a file and run `check-plan` on it (step 3) *before* spawning him, then the first spawn of `ranjit` carries the step 4 arm order directly, with the order text's lines below. The guard passes a spawn of `ranjit` whose prompt names **one** version (`orderAllow`, `NAMED_VERSION_RE`), so the prompt names `V<version>` only, no other version (a migration or older release number written as `V…` would make it ask). A `check-plan` mismatch, a deploy with a backup or migration, a `preview` with no block, or no covering marker keeps the plan round, and the arm order goes to him by `SendMessage` after it (`[deploy-order]`: 2.14.7 was already built and changed the frozen set, so no marker stood at the first spawn, `orderAllow`'s `markerCovers` gave no decision and Auto's classifier refused the "arm and go" spawn; 1.2M, and the deploy fell back to `/skinny-pete 2.14.7 merge`). **Every deploy's order text also hands him the production URL (`<urls.prod>` from `.claude/kit.json`), the PR's state fields (`gh pr view <n> --json state,isDraft,mergeable,headRefOid,statusCheckRollup`) and the `preview` output, and names the post-merge reads by tool: `list_migrations`, `list_edge_functions` (when functions ship), `get_advisors` (security) and one `query_logs`, so he loads them in one ToolSearch and skips the PR body** (his own suggestions: about 9-11M and 5 min to `done`). The post-merge checks are signed-out only; signed-in looks are human steps afterwards. It goes in the order text, never in his agent file, which is frozen. Save its plan for step 3 with Write, never a heredoc that names the arm script.
   - **The order text carries these lines every time** (`[deploy-order]`; in chain 2.13.5.1 they lived only in hand-written orders: with them a backup + migration deploy took 5.6 min and 10.5M and nothing asked, without them 17.3M and two plan rounds):
     - **Docker is running** (`docker info`) before the arm on a database release: `prod-db.sh backup` needs it, and a backup failure is a hard stop after the arm.
     - **The smoke is a look, not a bare 200:** with `urls.prod` empty in `.claude/kit.json` there is no deploy wait and no smoke step (the order says so). Otherwise, after the merge `ranjit` opens the production URL signed out through the Chrome read tools (`tabs_create_mcp`, `navigate`, `get_page_text`) and reports what the start page shows. A refusal is reported, not a stop.
     - The plan keeps each command in a code span or on a bare line; a `[tag] command` line is invisible to `check-plan`.
     - No separate `prod-db.sh dry-run`: `push` runs its own, and an extra read off the arm list would ask under the marker.
     - "Hand the report back; the navigator posts it." Without the line `ranjit` posts a report comment of his own.
     - The PR state with `reviewDecision` and `mergeStateStatus` (REVIEW_REQUIRED/BLOCKED means `--admin`), and the PR body cut at `## Usage`.
     - **"You close the run":** `ranjit` runs `scripts/full-auto.sh done`; the guard refuses it from the navigator (2.13.5.4's order said otherwise and cost a round).
     - Function deploys run **before** the merge under the marker, so the PR lists them under "Before merge"; safe only when additive for the live frontend.
     - `ranjit` copies nothing: the navigator reads the run's log with Read, writes the report after the hand-back, and reads a run as stopped only from that hand-back. Every file the run posts is written before `ranjit` starts. The production migration comes from the dry-run, never from `ranjit`'s summary.
   - **The merge comment is written now, with Write,** in the scratchpad, before the arm, in neutral words ("merged by the drive under the tap Alexander gave at the arm; CI green; plan check: <line>", never "without a review"), with @<reviewer> and the backup folder filled in, and the order hands `ranjit` its path. `ranjit` posts it with `gh pr comment --body-file` and writes no text of his own (he has no Edit or Write). **The report is yours, after the hand-back** (step 6). No heredoc and no `printf >>` after the merge (2.12.4 and 2.13.2: a heredoc after the arm was refused; 2.13.1: `ranjit` changed the body with `printf >>`).
3. **The plan-vs-PR script check**: save `ranjit`'s plan, one step per line, to a file in your scratch folder and run `scripts/full-auto.sh check-plan <version> <absolute path>` as its own call. It reads the plan against the PR's Production steps (a script, no agent), checking:
   - every command there, and nothing extra;
   - the backup first whenever the database changes;
   - the right migrations;
   - the right project ref (`<refs.prod>` from `.claude/kit.json`, production's ref);
   - the merge as `gh pr ready <n>` (if the PR is a draft; only after CI is green and there are no conflicts, as the step right before the merge), then `gh pr merge <n> --squash [--admin]`.

   A mismatch is a hard stop; a fix to the plan goes back to `ranjit` and the check runs again.
4. **Arm and go, one order.** `scripts/full-auto.sh preview <version>` prints the arm list, numbered, and what `arm` would refuse and why. Then continue the same `ranjit` with one SendMessage whose text is exactly this, nothing added (`<n>` is the step its plan numbered first):

   `Arm and go, under the marker for V<version>: scripts/full-auto.sh arm <version> as its own call, then the plan as shown, from step <n>.`

   The guard allows that text, and nothing else, past Auto's classifier: from the main session, attended, while a marker lists `<version>` (a spawn of `ranjit` whose prompt names only `<version>` passes the same way). One message covers the arm and the go; there is no second "Go".
   - **Under the start's chain marker** (`.claude/full-auto-chain.json` lists `<version>`), `arm` derives its list from the PR and passes without asking.
   - **Without one** (the start skipped `arm-chain` because the release was already built, the start's arm was refused, or the release changed the frozen files), the guard asks Alexander. That's the one tap the start message announced. Step 6 then ends with `disarm`.

   A refused arm is the fallback, not a retry. (A commit that touches the arm script stages it first: `git add scripts/full-auto.sh`, then `git commit -m …`; naming the script in the commit call is refused.) From here on nothing is pushed to the release branch: the marker holds the armed SHA.
5. **Run.** `ranjit` runs the arm as its own call, then the plan from step `<n>`, with no further message from you. Under a valid marker the guard lets `ranjit`, and only `ranjit`, run the listed commands without asking, and logs each to `.claude/full-auto.log`. Relay any stop as a hard stop.
6. **Afterwards.** Wait for `ranjit`'s hand-back message itself before reading the run as finished or stopped. A task notification after a resume can belong to an earlier turn: in 2.13.2.1 one arrived while the arm waited on a tap, and the navigator pinged a false stop. `ranjit` ends the run and hands back. He copies nothing: a `cp` of the log was refused in 2.13, 2.13.1 and 2.13.2.1. You read `.claude/full-auto.log` with the Read tool, which no hook watches, and write the report body with Write: the run, the backup folder, @<reviewer> and the log in a code block. Post it with `gh pr comment <n> --body-file <file>`, using a plain path in the scratchpad or `/tmp`; never a heredoc and never an inline `--body`. `done` keeps the PR number in the chain marker, so the guard still allows that comment afterwards. Ending the run:
   - with the chain marker: `scripts/full-auto.sh done <version>` (it checks production itself and disarms when it can't confirm);
   - otherwise: `scripts/full-auto.sh disarm`.

   Only without the chain marker, run the disarm yourself too, as its own call, so a marker never outlives the run (it's harmless twice there). With it, don't: `disarm` would delete the finished marker the wrap-up's files need, or the whole chain after a release that isn't the last; the chain's conductor disarms after the last wrap-up. Then `skinny-pete`'s records: the production memory, the "Deploy usage" comment. "Human steps afterwards" don't hold the run: list them in the final ping.
7. **`wrap`, in this same session:** run the numbers part of `/future-ted <version>`, its chain-mode part (read `the `core` plugin's `skills/future-ted/SKILL.md`` as a file): usage, the two timeline text lines (navigator wall-clock and agent-minutes; deploy minutes to `done`; no chart), rework, lessons draft, roadmap. Numbers only, never rules. **Write the roadmap rows only if something changed beyond status** (a status-only change is skipped: the chain's conductor writes those at its start and end). That edit goes to a fresh `c-3po` (≤ 2M, `the-trail`: row writes, no full read), not this navigator. **The kept chain marker (90 min after `done`) makes the guard strict for every session in the repo:** a `sed -i` on a memory file was refused 20 min after 2.12.5's merge ("text built at run time … while full auto is armed"), so use Write or Edit until the marker is gone. Leave Alexander's notes checklist open for him to fill, here or in a new session. Without `wrap` the drive stops after the deploy and Alexander runs `/future-ted <version>` himself.
8. **Final ping:** a step that was refused in an Auto drive goes first under "What needs you", above "What's in it". Then the PR link, what ran, the backup folder, the log comment's link, the human steps afterwards, and then:
   - with `wrap`: the wrap numbers' paths, ending with "your notes checklist is open" and "your notes: `/future-ted <version>` + your notes, in a new session, Opus high, Bypass permissions";
   - without it: `/future-ted <version>`.

**Budgets:** a deploy leg 10M, with `wrap` 25M (to `done` merge-only and backup + migration deploys both came in at 9.3-10.6M; every deploy+wrap link of chain 2.13.5.1 ran 20-27M with the wrap-up and its roadmap edit).

**Sessions beside a drive:** a planning session (`/legendary`, `/inception horizon`, `/badger`, any other) writes only `~/.claude/plans/`, its own scratchpad and the roadmap page, never the checkout and never git. A drive does not touch what such a session leaves (see step 1).

Production safety is never an `allowance=` setting: the guard, the backup and the hard stops are the same in all four.
