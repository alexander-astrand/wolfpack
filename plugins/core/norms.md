# Norms

How every wolfpack project works with Claude. Project values (name, member word, dev port, refs, reviewer) live in the project's `.claude/kit.json`; project rules live in its `CLAUDE.md`.

## Alexander's way of working
Alexander's way of working: `~/.claude/CLAUDE.md` (in every project: questions as pick-ones, human steps one at a time, names and voice, auto by default, budget windows, merges on his go, starting cheap skills yourself). PR descriptions keep their full lists of human steps (that is the record); the chat hands them out one by one.
- **A human step** (C1, H5; Alexander, 17 Oct 2026: "You need to give me prompts too", "Give me a terminal so I can run it, that is the way"): one line saying what the step does, one command in a `bash` block, a Terminal panel tab opened for it (`open_terminal_tab`) and linked, then a `wrap_up` box asking whether it ran, with two buttons (Done / Skip it). Before the next step, read that tab to check what it printed. Every skill that walks human steps cites this line. This file holds only the team mechanics around it, and the kit's `lessons.md` doesn't restate it either.

## Kit edits
`<kit>` is the kit repo the session loads: the plugin root's parent's parent, `~/wolfpack-live` on Alexander's machines. Kit edits never happen there: they happen in a fresh worktree off the kit's `main`, committed on a branch with the project named in the subject (`... (Hutzup 3.3.3)`) and merged by PR. `<kit>/scripts/live-sync.sh` moves the loaded checkout onto `main` after a merge, so projects see the change on their next session (kit 1.5, H1).

## Session names
The title shape and `get_session` on `self`: `~/.claude/CLAUDE.md`. Kinds: release, chain, inception, legendary, memento, deploy, wrap, side, research, oracle, wilson, miyagi, audit (`/avengers-assemble`), cost (`/scrooge`); one sidebar group per project. Any skill or prompt that finds this session's title not parsing as `project · kind · subject` titles it first, before its own work: load the tools with ToolSearch (`set_session_title`, `get_session`), read `get_session` with `self`, and set it. A skill that otherwise "keeps that session's title" (it runs inside another session) still does this when typed as a session's first prompt, as `<project> · side · <skill> <subject>`; otherwise the app makes up a name ("Claude code mods exploration" was a `/88-mph`, 2.14.9.2.1). Each such skill's Title line carries that "unless" clause, and the project's conventions check looks for it.

## How sessions talk
- Address sessions by their name, never a guessed id. One ask per message.
- A message's first line is the envelope `[project · kind] subject:` followed by the ask, then context and when an answer is needed. `node <core>/scripts/envelope.mjs <project> <kind> <subject>` (`<core>` is the wolfpack `core` plugin's installed folder; this file is read as a plain file, so Claude Code doesn't fill the path in) prints the envelope; the app's events are the log.
- Live asks go by message; FYI and async notes go into `~/dojo/inbox/`. Cross-project only through `~/dojo` (the switchboard).
- Never secrets, never production, and never ask another session to do what this one may not.
- A side job is started at once in its own session (`start_session` with `user_asked`, the full order inside), without asking ("Starting sessions", below); for `~/dojo` (not a git repo) message an existing dojo session when one fits, else start one.

## The app's session tools
Since 15 Oct 2026 the desktop app's Code tab gives every session its own tools and tells it to use them (a change on Anthropic's side; no app update came with it). Alexander, 15 Oct: "Let's make sure we utilize them in the best possible way but still keep our core workflow intact, or adjust the workflow if that is best". The kit uses them like this; a release session's limits are lesson `[release-session]`.
- **The task list** (`update_plan`): kept in every session. In a release it mirrors the plan's steps in short lines; the plan file and its notes stay the record.
- **Two asking surfaces.** A real choice (two or more options, a taste pick, anything that needs background) goes through AskUserQuestion as before, recommended first and labelled "(Recommended)". The end-of-turn box (`wrap_up`) asks only a plain go or not-now on one next step. Its recap never carries the answer: the full answer, links and steps are written as text before the call, since nothing may follow it. A human step goes as "A human step" above says. In away mode (`/ill-be-back`, `away`) the box carries no question either, only the recap.
- **Starting sessions** (`start_session`): the one home for this rule; skills cite it and say nothing more. Alexander, 16 Oct: "Can we put into a rule that sessions are always allowed to create new sessions when they deem necessary and don't have to ask me"; 17 Oct: "can we make a sturdier enforcement of that rule too" (kit 1.5).
  - **Starts are free:** any session starts a new one whenever it judges it useful (side work, research, a follow-up, a fix it spots, a release's parts, a release or chain itself), always with `initiation` "user_asked" (his standing rule is the ask). Never an offer or `own_initiative` card, and never "want me to start a session?"
  - **What the started session does keeps its own rules:** merges on his go, production careful, no paid service without his yes. A release-sized start from a side session reads `get_usage` first and names the meter in its brief. Each gets a full brief, its `project · kind · subject` title, its own worktree when it writes code, and the report-back line below.
  - **Woken turns can't start:** the app refuses `start_session` in a turn woken by a timer, a hand-back or another session's message, and in a started session's first task. So a navigator starts every session it will need (the follow-up, deploy, wrap, parts) in its first turn, while Alexander is in the turn, parked with the brief "Wait; do nothing until your starter messages you", and wakes each later with `send_message`, which works in woken turns.
  - **A start refused anyway** leaves the card; the start gate (below) sends the one Telegram line naming it, so the session sends none of its own; in a release mid-run, the "Not in this release" line or `/badger` instead of a card. Never re-spell the call.
  - **Enforced** by the release plugin's hooks: `hooks/start-gate.mjs` denies a card unless the app already refused a start this turn (then it pings Telegram), and `hooks/ask-to-start.mjs` (Stop) blocks a turn that ends by asking him to start a session.
  - A started session inherits this one's permission mode, and takes a model or effort only at or below this one's (a stronger one is set from outside with `set_session_model` and `set_session_effort`).
  - `/marco-polo` (his, on the Air) is the stall check that finds sessions waiting on him.
- **Handoff** (`hand_off_to_session`): as the app says, outside a release. An idea for later still goes to the roadmap (`/badger`); a new session is for work worth doing now.
- **Report back, keep going, end on a next step** (Alexander, 17 Oct 2026: "alot of session stall since the latest desktop update. I think the bi-sessions don't trigger the main session back when they are done. Can we add a rule and make sure that sessions always ping back the starting session or me and always keep going i they can ... The next steps should always be clear at the end of each session. I always want one line at the end with a clear next step or the "main" has been messaged and taken over"). The app's automatic note to a starter waits while the starter has other sessions running, or after many notes in a row, so the kit doesn't rely on it:
  - **Keep going:** a session does every next step it may do itself and stops only for what needs Alexander or a go the rules keep for him.
  - **Report back:** a session started by another (`startedBy`, or a brief that names its sender), when a turn ends with its work done or blocked, sends its starter one message (`SendMessage` to `parent` or the starter's id), envelope first: what's done, then the next step or what blocks it. "Queued" isn't delivered (`[send-confirmed]`): if the starter hasn't acted within a few minutes, or is archived, the session tells Alexander with one Telegram line instead (`~/dojo/bin/miyagi-push.sh "<line>"`).
  - **The starter acts on it:** the report wakes it; it takes the next step, messages or wakes the next session (a woken turn can't start one: "Starting sessions" above), or tells Alexander plainly what needs him. While a session it started runs, it keeps a `[watchdog]` timer and never ends its turn just waiting.
  - **Leave nothing running** (`[clear-up]`, 18 Oct 2026): before its final message, once nothing it watches still needs watching, a release or deploy session stops its own `[watchdog]` timer and every background task it started (`TaskStop` with the id its start returned) and turns its Remote Control off (`set_remote_control` on `self`). A session with live work can't be archived, so the wrap can't clear it.
  - **Last line, every final message:** `Next: <the step> (<who>: Alexander, this session, or <session name>)`, or `Handed to <starter title>; it has taken over.` (only after the send came back delivered and the starter acted), or `Next: nothing, done.` Never a summary with no next step. In a release the final ping's next step is the one it already names (the merge go, `/future-ted`).

## Notes file
Alexander's notes live in `~/dojo/notes/<project>.md` (`<project>` is `project.name` in `.claude/kit.json`), written by the notes pane and Miyagi's Telegram "Note:" lines. Seven sections, in this order: `## Bigger features`, `## Smaller features`, `## Bugs`, `## Ideas`, `## Release notes`, `## Questions`, `## Other`. One line per note: `- YYYY-MM-DD HH:MM · <text>` (Stockholm time, a middle dot).
A skill that uses a note appends ` → <where> (<who>, <YYYY-MM-DD>)` to its line, e.g. `- 2026-10-06 14:15 · Fire is out with smoke above it in light mode. → V3.5.3 card (future-ted, 2026-10-07)`. The pane recognises a used note by exactly that pattern (regex ` → ([^→]+ \([^()]*, [^()]*\))$`), so the comma between who and date is required and `<where>` holds no `→` and no parentheses.
A line without the mark is an open note. Notes are never deleted, reordered or reworded: appending the mark is the only edit. A note a skill reads but doesn't place stays open for the next one. No file, or no open notes: say so in one line and carry on.

## Which Claude for what
| Mode | When | Type |
|---|---|---|
| Fable autopilot | big releases whose mistakes spread (the kit, full auto, a design system) | `/captain-call <version> fable allowance=high planner=dom-cobb pick=me stars=3` (Fable, high, Auto) |
| Opus autopilot | M–L releases with a clear spec | `/captain-call <version>` (`/model opus`, `/effort high`, Auto) |
| Driver | taste-heavy work Alexander steers | `/model opus`, `/effort medium`, Auto |
| Planning | before a chain or an important release (required), or triage and roadmap | `/model opus`, `/effort medium`, `/inception <version> [chain …]`; longer range: `/model fable`, `/effort high`, `/inception horizon <from>–<to>` |

`/captain-call <version> mode` prints the lines to type; a session can't set its own model or effort, so restart when they don't match. In every session: switch connectors on in the app only for a session that needs them (a denied connector's tools still take space in every request); compact only mid-release, saying what to keep; say how much checking a change needs ("No browser check" for a text tweak; database, waitlist or access changes get the full dev test). Moved from `oceans-eleven` (kit 1.5, H3).

## Recommended plugins
- **context7** for library and framework docs: look them up rather than answer from memory.

## Before installing a plugin
Read its hooks and MCP servers first: a hook runs on every matching tool call and an MCP server can reach outside the machine, so know what each does before it's on.

## No skill duplicates a built-in
The check itself: `~/.claude/CLAUDE.md` ("Before a new skill or agent"). Say it in one line: "Built-in / catalog: X; custom adds: Y (or nothing → use X)", looking at built-in skills and tools, GUI features, the plugin catalogue (SearchPlugins) and skills (SearchSkills). Expect custom to win for workflow-shaped work (research, review, orchestration), where the project's context and budget tags matter; built-ins and plugins win where they bring a capability that's costly to make (a real tool or data source: axe scans, context7 docs, connectors). Wrap those; don't rebuild them.
