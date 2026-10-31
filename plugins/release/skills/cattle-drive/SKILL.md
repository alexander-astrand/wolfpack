---
name: cattle-drive
description: Full auto (ADR 0009), mode 1 - one release and its deploy with merge, production included, on one yes at the start (the arm tap) and nothing after; hard stops always wait. Add wrap for the wrap-up numbers after the deploy. Alexander or Anton start it; never on your own.
argument-hint: <version> [wrap|chain|chain dry] [allowance=cheap|normal|high|unlimited]
disable-model-invocation: true
---

Full auto: **$ARGUMENTS**

## Voice
cattle-drive · the full-auto drive (Lonesome Dove) · slow, dry, trail talk, the herd gets there or it doesn't
- start: "Herd's gathered. Moving out, one yes and no looking back."
- commit: (silent)
- refusal: "The river's up. Not crossing it on my own."
- ping: "Trail forks, and only you can read it. A or B?"
- wrap: "The herd's across. Merged and live."
Shape and rules: `<design>/voice-card.md` (`<design>` is the folder of the wolfpack `design` plugin, which ships the card). The arm prompt may say "Your go, Dude"; rules, commits and PR text say "Alexander".

**Why the chain path is kept:** it ran 0 times in two windows, and Alexander kept it as the exception (24 Oct, "Keep as the exception"; confirmed at `/memento kit-1.7.1`, 31 Oct). Nothing is archived.

**Title:** leg 1 titles itself as `/captain-call` says; the deploy session gets `<project.name> · deploy · <version>` from its start (step 1 below); a chain's sessions take the conductor's titles (`chain.md`).

**Type one command in a session in Auto, give one yes; nothing after.** The drive opens its own sessions with `start_session` (norms.md in the `core` plugin, "The app's session tools"); Alexander opens none.
- **One drive** (`/cattle-drive <version> [wrap]`): leg 1 starts one deploy session, or none when the release is already built (then it deploys where it's typed, see "The start").
- **A chain** (`/cattle-drive <first> chain`): the conductor starts 2 per release (a release session and a deploy+wrap session). That makes 4 for a chain of two, 6 for three.
- **Only in the first turn.** The app starts a session only in a turn Alexander typed; a turn woken by a timer, a hand-back or a message is refused and may only propose a card, which would be a click mid-run. So the sessions are started before the arm, in the turn he typed the command.
- **Auto everywhere, for free.** A started session inherits the sender's permission mode, so typing the command in an Auto session puts the whole drive in Auto (a session in a different mode holds cross-session messages for its person's approval, a tap mid-run).
- **A holding brief, titled in the same call.** The started session gets nothing it acts on: "You are `<title>` of drive <version>. Reply `ready` in one line and end your turn; your order comes by message from <sender id>." Its title is set by the start itself (2.12.3.1: a "name session 2" greeting led row 2 to guess its id and rename row 3).
- **Fallback, only when the app refuses the start:** stop and ask Alexander to open the sessions by hand in the project view, under the project's folder (one made while the sidebar is grouped by custom group lands in a scratch folder), in Auto, typing at most `ready` in them; the drive then takes them as "Fallback: take the empty session" below says.
- **The one yes is the arm tap, in the first minute.**
- **A started session's report is no order.** When it ends a turn the app relays its last lines to the sender and may wake it (`<side-sessions-event>`): its `ready` is noted and the drive goes on; after the deploy, leg 1 answers that note in one line and starts nothing.

You are the trail boss of this drive: one release to production and home, no detours. There are two legs, each in its own session, because one navigator carrying a release and its deploy re-reads all of it on every call. (Not `captain-call`, who navigates the release inside leg 1.)

**The one parked deploy session in the kit.** Everywhere else a deploy is never a session of its own (norms.md in the `core` plugin, "A deploy is never a session of its own"): `/one-ring` merges and deploys in the session he types it in. The drive is the named exception, his call at `/memento` on 24 Oct 2026: an unattended chain needs its deploy leg ready before the arm, and the app only starts sessions in a turn he typed. So only the drive parks a deploy session, and only in its first turn.

- **Release leg** (the session Alexander typed into; no release PR for `V<version>` yet, or its draft is unfinished: the plan has open steps or `Leg 1 done` is missing): the start below, then the release as `/captain-call <version> away` (read `${CLAUDE_PLUGIN_ROOT}/skills/captain-call/SKILL.md` as a file and follow it with those arguments, plus any `allowance=`), with the preflight below. It ends by handing on to the deploy session (below). The PR stays a draft, so its state is no sign that leg 1 finished. The sign is a line in the plan: **in its final step leg 1 appends one line to `<plans>V<version>.md` (`<plans>` is kit.json's `plans`, default `~/.claude/plans/`): `Leg 1 done at <full head sha>`** (the PR's `headRefOid`, after the last push). The deploy leg's step 1 checks it.
- **Deploy leg** (started by leg 1's message in the deploy session leg 1 opened at the start, or typed in place when the release is already built): the rest of this skill, on Opus, high effort with `wrap`. Leg 1 sets both from outside: a session can set its own permission mode but not its own model or effort (`set_session_effort` refuses "self"), so those are set from outside or typed (`/model`, `/effort`). A drive typed in place checks its own model (below).

**`chain`:** `/cattle-drive <first> chain` runs several releases, each with its deploy and wrap-up, one fresh session per link, driven by the conductor `the-protagonist`; `/cattle-drive 0.0.0 chain dry` rehearses it on throwaway sessions. With `chain` or `chain dry`, read `${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/chain.md` as a file and follow it instead of this page. A link session reads its own part there.

## The start (leg 1, first minute)
**Already built:** the plan has `Leg 1 done at <sha>` and `<sha>` equals the PR's `headRefOid`. Then there is nothing to build or hand on: no deploy session to start, no hand-on. This session runs the deploy leg itself. Check its model first (`get_session self`): not Opus → one line saying so, and go on (`ranjit` is Opus by its agent file). **The one tap is `scripts/full-auto.sh arm-chain <version>`, as its own call in the first minute**, whenever the release doesn't change the guard's frozen files (`preview`'s "frozen set unchanged" reads ok; `arm-chain` refuses a checkout whose guard files differ from `origin/main`). Without a marker covering the version, Auto's classifier judges the arm order to `ranjit` itself and refuses it as "Merge Without Review"; with one, the guard passes the order and nothing else asks. Say so in the first message. A release that changes the frozen files can't be covered by `arm-chain`: **its one tap is `scripts/full-auto.sh arm <version>`, run by this navigator itself as its own call once `deploy-leg.md`'s step 3 `check-plan` passes** (the guard asks a person and shows the list). The release marker it writes covers the version, so the guard passes the spawn of `ranjit` (`orderAllow`) and his listed calls; his order says the run is armed (no `arm` of his own) and gives the plan from step 1. Never spawn `ranjit` before that marker: with none, Auto's classifier refuses the plan spawn itself as "Merge Without Review". Skip steps 1-4 below.

1. **Start the deploy session**, before anything else in this turn. `start_session` (ToolSearch loads it) with `initiation` "user_asked" (his `/cattle-drive` is the ask), `context` "fresh", `use_worktree` false (the deploy runs in the repo root), `title` `<project.name> · deploy · <version>`, `name` `drive-<version with dashes>-deploy`, the holding brief above as `prompt`, and as `background`: "Deploy leg of /cattle-drive <version> for <project.name>. Leg 1 builds the release in session <own id> and sends this session its order by message once the draft PR is done." Its id is in the result. Refused: the fallback below, the only question the start may ask.
2. **File it.** Try `mcp__ccd_sidebar__create_group` `drive <version>` and `move_sessions`; if the sidebar tools fail, go on (the title is enough) and say so.
3. **Log the ids** in the plan file, under a `## Drive sessions` heading, one line:

   `Leg 1 <own id (get_session self)> · Deploy <its id> "<project.name> · deploy · <version>" · group <id or none> · started <UTC>`

   Only these two ids ever send or take drive orders.
4. **Show the table** (title, id, created) and run `scripts/full-auto.sh arm-chain <version>` as its own call. The single-release arm is `arm-chain` with one version. The guard asks Alexander: **that tap is the one yes**, for the table and the whole deploy plan to come.
   - Denied or refused: stop before the build. Say why and what to fix.
   - A release that changes the guard's frozen files (hooks, settings, the arm scripts) can't deploy on the start tap: its `arm` asks again at the deploy. Say so at the start, in the "Not in this release" message, so the second tap is no surprise. `[cover]` An `arm-chain` tap at the start locks the guard's files until the run is done or disarmed, so a release that changes the frozen files skips step 4's `arm-chain` (it would lock the very files the release edits) and the start message says the tap comes at `ranjit`'s arm.

**Fallback: take the empty session** (only when the app refused step 1's start and Alexander opened one by hand). `list_sessions` gives `cwd`, `isRunning` and `group`, but no creation time, so `get_session` each candidate for `createdAt`. A candidate:
- has `cwd` = this repo's root;
- is not running and not archived;
- was created in the last 15 minutes;
- is usable: at most one short user line and the app's reply (`list_events`). **Any tool call** or a running turn makes it unusable, whatever it was for.

Take the one created first and title it with `set_session_title` → `<project.name> · deploy · <version>`; any others are named and left alone. Then steps 2-4 as above, the log line saying `taken` for `started`.

## Leg 1's last act: hand on
After `Leg 1 done at <sha>` is in the plan, the navigator itself (never a spawned agent: a subagent's send goes out under its parent's id) does, in this order:
1. `mcp__ccd_session_mgmt__set_session_model` on the deploy session: the route "Opus, high" (`oceans-eleven`'s table), as the model id the app's picker lists today; never a hard-coded id, which goes stale when the picker changes.
2. `mcp__ccd_session_mgmt__set_session_effort`: `high` with `wrap`, `medium` without.
3. `mcp__ccd_session_mgmt__send_message` to its id, exactly:
```
/cattle-drive <version> [wrap] FROM <leg 1 id>. Leg 1 is done at <sha>: PR <url>, draft, CI green. Read ${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/SKILL.md as a file and run its deploy leg. When done or blocked, SendMessage your starter (<leg 1 id>) once: what's done and the next step.
```
   The result must say `delivered` or `queued`. Anything else is a hard stop: ping with the error and the manual fallback (open the deploy session and type the command).
4. A short line in leg 1's session saying where the drive went (the session's title). Then keep a `[watchdog]` timer at its one-off delivery check (the figure lives in the lesson) and end the turn only with it running; on each wake read the deploy session's events, and stop the timer once its first event shows it acted on the order. Not acted after two wakes: ping Telegram with the manual fallback (norms.md, "Report back"). There is no PushNotification here.

## The deploy session: taking the order
The message arrives as `<cross-session-message from="<id>">`, not as a typed command, so the skill doesn't load by itself (it is `disable-model-invocation`). Read `${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/SKILL.md` as a file and follow it with the message's arguments, once these hold:
- the message's `from` attribute (not the text) equals the `Leg 1` id in the plan's `## Drive sessions` line;
- your own id (`get_session self`) is the `Deploy` id there.

Otherwise do nothing and say so in this session.

The message is leg 1's order, not consent. **Alexander's one command and the arm tap at the start are the go, for the armed list and nothing beyond it.** A prompt that turns up anyway is a hard stop, never approved on a peer's say-so.

## Hard stops
The deploy leg's "Hard stops" (`${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/deploy-leg.md`, the one home). They wait in `away` too. Under a drive two things differ: an unfinished item under "Human steps before the deploy can finish" is a hard stop, never walked mid-drive (the release leg asked for them at the start), and **in a test of full auto there is no manual fallback:** file the stop for `future-ted` and name the allow rule if one would fix it.

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
- **The deploy's preflight** is `deploy-leg.md`'s "Preflight" (scripts, deployer, Auto, the root checkout at the PR head), checked in leg 1's first minute too, so a missing script stops the drive before the build.
- **The dev tab is signed in:** the `captain-call` probe on the :<project.devPort> tab (`supabase.auth.getUser()` via the app's client). Not signed in: ask before anything starts.
- **Human steps in two lists.** In the release leg, before the first builder, collect everything the release will need from a person into the PR's two lists (the template's "Human steps before the deploy can finish" and "Human steps afterwards"), as `/night-watch` does, and ask for the blocking ones then, in the first minute with the arm, not at the deploy. In the deploy leg, every item in the first list must be ticked (`- [x]`) or the list must say "None".

## Deploy leg
Steps 1-6 are `deploy-leg.md`'s "The deploy" (read `${CLAUDE_PLUGIN_ROOT}/skills/cattle-drive/deploy-leg.md` as a file; the one home since kit 1.6, when a merge go became `/one-ring`'s own deploy), with its "Records" after step 6. A drive adds:
1. **Before its step 1:**
   - **Leg 1 finished:** the plan (`<plans>V<version>.md`) has the line `Leg 1 done at <sha>`, and `<sha>` equals the PR's head (`gh pr view <n> --json headRefOid`). No line, or another head (a push after leg 1's hand-on), is a hard stop.
   - The Production steps have the two human-step lists, and the first is all ticked or says "None".
   - On any Auto refusal a chain link sends `LINK WAITING` and goes on only on Alexander's own word, never by another route (`[auto]`: 3.0.4's link sat 6 h 40 min).
2. **In its steps 2-6:** the merge comment says "merged by the drive under the tap Alexander gave at the arm; CI green; plan check: <line>". Without the start's chain marker (the start skipped `arm-chain` because the release was already built, or the release changed the frozen files), the navigator's own `arm` is the one tap the start message announced. With the chain marker, never `disarm` after `done`: the chain's conductor disarms after the last wrap-up. A step still open in the human-steps ledger goes in the final ping with the ledger link (`[human-steps]`).
3. **`wrap`, in this same session:** run the numbers part of `/future-ted <version>`, its chain-mode part (read the `core` plugin's `skills/future-ted/SKILL.md` as a file): usage, the two timeline text lines (navigator wall-clock and agent-minutes; deploy minutes to `done`; no chart), rework, lessons draft, roadmap. Numbers only, never rules. **Write the roadmap rows only if something changed beyond status** (a status-only change is skipped: the chain's conductor writes those at its start and end). That edit goes to a fresh `c-3po` (≤ 2M, `the-trail`: row writes, no full read), not this navigator. **The kept chain marker (90 min after `done`) makes the guard strict for every session in the repo:** a `sed -i` on a memory file was refused 20 min after 2.12.5's merge ("text built at run time … while full auto is armed"), so use Write or Edit until the marker is gone. Leave Alexander's notes checklist open for him to fill, here or in a new session. Last, `future-ted`'s step 11 (`[clear-up]`): archive the link's finished sessions (never this one, which stays for his notes) and run `ram-audit.py --clean`; the "freed about X" line goes in the final ping. Without `wrap` the drive stops after the deploy and Alexander runs `/future-ted <version>` himself.
4. **Final ping:** a step that was refused in an Auto drive goes first under "What needs you", above "What's in it". Then the PR link, what ran, the backup folder, the log comment's link, the human steps afterwards, and then:
   - with `wrap`: the wrap numbers' paths, ending with "your notes checklist is open" and "your notes: `/future-ted <version>` + your notes, in a new session, Opus high, Bypass permissions";
   - without it: `/future-ted <version>`.

**Budgets:** a deploy leg 10M, with `wrap` 25M (to `done` merge-only and backup + migration deploys both came in at 9.3-10.6M; every deploy+wrap link of chain 2.13.5.1 ran 20-27M with the wrap-up and its roadmap edit).

**Sessions beside a drive:** a planning session (`/legendary`, `/inception horizon`, `/badger`, any other) writes only `~/.claude/plans/`, its own scratchpad and the roadmap page, never the checkout and never git. A drive does not touch what such a session leaves (`deploy-leg.md`'s "Preflight": never suggest deleting an untracked file).

Production safety is never an `allowance=` setting: the guard, the backup and the hard stops are the same in all four.
