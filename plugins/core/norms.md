# Norms

How every wolfpack project works with Claude. Project values (name, member word, dev port, refs, reviewer) live in the project's `.claude/kit.json`; project rules live in its `CLAUDE.md`.

## Questions as choices
Every question to Alexander is a pick-one of up to four options (AskUserQuestion), the recommended option first and labelled "(Recommended)", each option's description saying what it gives and what it costs. The question text carries the context needed to decide: what, why now, what happens next. Up to four questions per call. He answers faster by tapping a choice, often from his phone, and a bare question makes him dig for the context. Where the tool can't reach him (a phone ping, a PR comment, a subagent), write the same shape as text: numbered options, the recommendation first.

## One step at a time
A human step (terminal commands, a dashboard click, a `cp` line, production steps, setting up a side session) is handed over one at a time: one line on what the step does, exactly one command in its own `bash` block, then wait until he says it ran (or pastes its output) before the next. Never a numbered list of commands to run in a row: he'd have to track where he is and could copy the wrong one. Each step ends with a pick-one: "Done" (hand the next), "Got an error" (he pastes it; fix before moving on), "Stop here". PR descriptions keep their full step lists (that's the record); the chat hands them out one by one.

## Start the next skill yourself
When the next step is a cheap skill or agent (`/badger`, `/88-mph small`, a read-only look), Claude starts it itself and says where it landed, instead of handing over the line to type (Alexander, 6 Oct: "You can start badger yourself"). Anything that starts a release, a chain, a deploy or production, merges, or spends a lot still asks, through its own gate.

## Session names
In its first minute every session titles itself `project · kind · subject` (`set_session_title` on `self`), lowercase project, e.g. `<project> · release · <version> <theme>`. Kinds: release, chain, inception, legendary, memento, deploy, wrap, side, research, oracle, wilson, miyagi. One sidebar group per project. Any skill or prompt that finds this session's title not parsing as `project · kind · subject` titles it first, before its own work: load the tools with ToolSearch (`set_session_title`, `get_session`), read `get_session` with `self`, and set it. A skill that otherwise "keeps that session's title" (it runs inside another session) still does this when typed as a session's first prompt, as `<project> · side · <skill> <subject>`; otherwise the app makes up a name ("Claude code mods exploration" was a `/88-mph`, 2.14.9.2.1). Each such skill's Title line carries that "unless" clause, and the project's conventions check looks for it. A session knows itself only by `get_session` on `self`, never by an id guessed from a list.

## How sessions talk
- Address sessions by their name, never a guessed id. One ask per message.
- A message's first line is the envelope `[project · kind] subject:` followed by the ask, then context and when an answer is needed. `node <core>/scripts/envelope.mjs <project> <kind> <subject>` (`<core>` is the wolfpack `core` plugin's installed folder; this file is read as a plain file, so Claude Code doesn't fill the path in) prints the envelope and logs the message to the switchboard (`~/dojo/notes/switchboard.md`; `SWITCHBOARD` overrides the path).
- Live asks go by message; FYI and async notes go into `~/dojo/inbox/`. Cross-project only through `~/dojo` (the switchboard).
- Never secrets, never production, and never ask another session to do what this one may not.
- A side job in a git repo is handed over as a task chip (`spawn_task`, the full order inside, one click); for `~/dojo` (not a git repo) message an existing dojo session, or give one prompt when none exists.

## Notes file
Alexander's notes live in `~/dojo/notes/<project>.md` (`<project>` is `project.name` in `.claude/kit.json`), written by the notes pane and Miyagi's Telegram "Note:" lines. Seven sections, in this order: `## Bigger features`, `## Smaller features`, `## Bugs`, `## Ideas`, `## Release notes`, `## Questions`, `## Other`. One line per note: `- YYYY-MM-DD HH:MM · <text>` (Stockholm time, a middle dot).
A skill that uses a note appends ` → <where> (<who>, <YYYY-MM-DD>)` to its line, e.g. `- 2026-10-06 14:15 · Fire is out with smoke above it in light mode. → V3.5.3 card (future-ted, 2026-10-07)`. The pane recognises a used note by exactly that pattern (regex ` → ([^→]+ \([^()]*, [^()]*\))$`), so the comma between who and date is required and `<where>` holds no `→` and no parentheses.
A line without the mark is an open note. Notes are never deleted, reordered or reworded: appending the mark is the only edit. A note a skill reads but doesn't place stays open for the next one. No file, or no open notes: say so in one line and carry on.

## Which Claude for what
| Mode | When | Type |
|---|---|---|
| Fable autopilot | big releases whose mistakes spread (the kit, full auto, a design system); the navigator is `captain-call` | `/captain-call <version>` (Fable, high, Auto; sets itself up where it can) |
| Opus autopilot | M–L releases with a clear spec | `/model opus`, `/effort high`, Auto |
| Driver | taste-heavy work Alexander steers | `/model opus`, `/effort medium`, default permissions |
| Planning | before a chain or an important release (required), or triage and roadmap | `/model opus`, `/effort medium`, `/inception <version> [chain …]`; longer range: `/model fable`, `/effort high`, `/inception horizon <from>–<to>` |

## Recommended plugins
- **context7** for library and framework docs: look them up rather than answer from memory.

## Before installing a plugin
Read its hooks and MCP servers first: a hook runs on every matching tool call and an MCP server can reach outside the machine, so know what each does before it's on.

## No skill duplicates a built-in
A new skill or agent idea first checks what Claude already has: built-in skills and tools, GUI features, the plugin catalogue (SearchPlugins) and skills (SearchSkills). Say it in one line: "Built-in / catalog: X; custom adds: Y (or nothing → use X)". Expect custom to win for workflow-shaped work (research, review, orchestration), where the project's context and budget tags matter; built-ins and plugins win where they bring a capability that's costly to make (a real tool or data source: axe scans, context7 docs, connectors). Wrap those; don't rebuild them.
