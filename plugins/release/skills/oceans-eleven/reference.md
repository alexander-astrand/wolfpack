# The team: reference (`oceans-eleven`)

Background for a person or a planner, split out of `SKILL.md` in kit 1.5 (H3) so a running navigator doesn't carry it. Read by section (`grep -n '^## '`). The rules a release applies are in `SKILL.md`; session modes are in norms.md, "Which Claude for what".

## Why a table, not pickers

The design had five "pickers" choosing a worker per job, but a subagent has no Agent tool, so a picker can't spawn anyone. A picker layer would also re-read every work order on top of `captain-call`, while the builders are the cost, so `captain-call` applies the routing table itself and passes `model` on each spawn.

## The roster

The main session is the navigator, **`captain-call`**: it talks with Alexander, plans, and hands jobs to the specialists in the kit's `agents/` (the wolfpack plugins), each on its own model and effort. Alexander, 17 Oct 2026: "Lets rename maverick to captain call, that is my favorite name and driver anywyas"; the big releases whose mistakes spread run the same skill on Fable with its arguments. The other sessions are named after their skills (the slash list below); `${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs` is Skyler, the budget hook Hank. Only `captain-call` hands out work.

| Agent | Old name | Model, effort | Gets |
|---|---|---|---|
| `lorenzo-von-matterhorn` | scout | Haiku, low | "where is X"; file:line lists |
| `r2-d2` | sweeper (2.14.6.1) | Haiku, low | `/jedi-council`'s file sweeps: sizes, counts, greps, file:line tables; Read/Grep/Glob only, no shell; 4M a sweep, `maxTurns` 40 |
| `admiral-ackbar` | planner | Opus, high | a plan or design decision when `captain-call` runs Sonnet; the `/inception` planner |
| `dom-cobb` | senior planner | Fable, high | writes or takes apart the plan of a release whose mistakes spread (the kit, full auto, a new project); a star |
| `mace-windu` | head of the Jedi Council (2 Oct) | Fable, high | leads `/jedi-council`: judges the team last, as an auditor, findings only; a star |
| `barney-stinson` | auditor | Fable, high (lanes 2–3 on Opus) | the three lanes of `/black-box`, read and report; lane 1 is a star |
| `heisenberg` | creative director | Fable, high | a creative brief before a taste-heavy release, briefs `mosbius-designs`, reviews the result; a star |
| `chris-de-kok`, `ahmed-och-ahmed`, `saul-goodman`, `jeff-winger`, `troy-and-abed` | builder | Opus, medium | the builder pool: page-sized steps, shared helpers and tricky logic, about one commit each; one name per lane |
| `jesse-pinkman` | builder (Sonnet) | Sonnet, medium | small UI steps with a clear spec, and docs; at most 2–3 steps per agent |
| `mosbius-designs` | designer | Opus, medium | two layout options for one page or component, in a worktree, before it's built |
| `the-playbook` | db-engineer | Opus, high | migrations, RLS, SQL tests, types, Edge Functions, on dev |
| `romeo-olsson` | test-runner | Haiku, low | `/you-shall-not-pass` by hand, and the navigator's probes (autopilot runs `scripts/check.sh` itself) |
| `kissochbajslowski` | release-reviewer | Sonnet, high | the pre-merge review of a release branch |
| `daredevil` | a11y-reviewer | Sonnet, high | the design and accessibility review of a release with UI, beside `kissochbajslowski`; also `/darth-vader`'s a11y lane; read-only |
| `mike-ehrmantraut` | codebase-auditor | Opus, high | `/no-half-measures`, the maintainability audit in a version window's end; read-only, a star |
| `c-3po` | documenter | Sonnet, medium | the README update, the PR description and Usage section, the-trail edits, `/inception`'s roadmap rows |
| `ranjit` (the project's own, not shipped by the kit) | prod-deployer | Opus, high | a chain's production steps (`/cattle-drive`'s deploy leg) and `/skinny-pete`'s manual cases; `/one-ring` needs no agent |
| the project's senior adviser (its own, when it has one) | senior-opus | Opus, max | adviser to an Opus `captain-call` on a decision it doubts, before any ping; never a review, deploy-plan read or verdict; read-only |
| `three-eyed-raven` | senior-decider | Fable, high | chain mode only: decides a chain link's tough calls in Alexander's place, logs them for `/memento`; never taste or production; not a star |
| `doc-brown` | researcher (2.14.6.2) | Opus, medium | `/88-mph` medium and large runs: works from the run's scope, searches wide then deep, writes one findings file (or one lane's notes) under `~/.claude/plans/research/`, and runs the counter pass and the check; 6M a run or lane |
| `bengt-johansson` | qa | Sonnet, medium | features the plan marks qa (new pages, sign-up/waitlist/access/link flows): a fresh one per feature, budget from the order; full matrix via `/darth-vader` |

Old role names appear only in the "Old name" column; everywhere Alexander reads, use the names (global `CLAUDE.md`, "Use the team's names").

## Speaking in character

Alexander, 29 Sep: "I love when you have small easter eggs of speaking a little bit like your character ... especially when starting an agent or wrapping up. Just small bits would make it very cool!" Every agent and every skill that speaks carries a `## Voice` card near the top of its file (since 2.14.6.1; a project's own `ranjit` and senior adviser carry theirs). Each speaks as its own character, never another's: "Kids, …" is `future-ted`'s alone. At most one short in-character line, at the start or the end of a report or ping; never in commits, PR descriptions, code, or anything in the PR; clarity first, and the facts stay plain. Alexander is The Dude and Anton is The Jesus on voice surfaces only (pings such as "Your go, Dude", sign-offs); never in rules, ADRs, the guard hook, commits or PRs. The card's shape and rules are in `.claude/voice-card.md`; the app's own outward voice (briefs, store text, anything a member or stranger reads) is `.claude/house-voice.md`.

## Full auto (`/cattle-drive`, ADR 0009)

**Mode 1, built in 2.12.1:** `/cattle-drive <version>` runs the release as `/captain-call <version> away`, then, in a new session in Auto mode, the deploy under the full-auto marker, and stops for Alexander's `/future-ted` (with `wrap`: runs its numbers part and leaves his notes open). The PR stays a draft until `ranjit` marks it ready under the marker, right before the merge; the arm is Alexander's only yes. Before the arm, `ranjit` (xhigh) plans and the plan-vs-PR script check reads the plan against the PR; a person's one tap on `scripts/full-auto.sh arm <version>` is the go; the guard then lets only `ranjit` run only the PR's listed commands, logged. The `cattle-drive` skill holds the preflight and the hard stops.
**Chain mode, built in 2.12.2:** `/cattle-drive <version> chain` also runs the wrap-up and the next release, a fresh session per link (`the-protagonist` conducts); a chain link's calls go straight to `three-eyed-raven`, and `/memento` reviews the chain afterwards. A chain runs with a tap per release (`arm-chain` authorises the order of versions; each release's arm still asks Alexander); the one-tap arm is built (2.12.4).

**Waiting costs nothing when done right:** the chain conductor's tick is a background `sleep` and one short message, on Sonnet with `chain.md` only (the tick itself is `chain.md` step 6); a Vercel wait is one script call, never a polling loop; a talk session ends its turn instead of polling.

## Slash commands: the one list

The wolfpack plugins' `skills/`; CLAUDE.md and the other skills name only the few they need and point here. The commands only Alexander types are also in the global `CLAUDE.md`, "Commands only I type" (written by `scripts/user-commands.mjs --write`). By plugin, name and argument hint from each skill's frontmatter:

- **release:** `/captain-call <version> [checkpoint] [mode|fable] [away] [slow|normal|quick] [stars=N] [allowance=…] [<role>=<model>…] [planner=dom-cobb] [pick=designer|me|navigator]`, `/cattle-drive <version> [wrap|chain|chain dry]`, `/night-watch <version>`, `/skinny-pete <version> [check|merge]` (manual or broken case only), `/one-ring <version or PR number>` (merge and deploy), `/carousel`, `/its-a-trap [version]`, `/you-shall-not-pass [app|db|local|all]`, `/ill-be-back [reason] [until]`, `/kids-im-home`, `/black-box <version>`, `/jedi-council <version>`, `/no-half-measures <version>`, `/the-tower [install|test|remove]`; `oceans-eleven` is read, not typed.
- **core:** `/inception <version> [chain …] | horizon <from>–<to>`, `/future-ted <version>`, `/memento <first> [<last>]`, `/legendary <topic>`, `/oracle <question>`, `/wilson <question>`, `/farbror-vattenmelon <thing to set up or walk through>`, `/beam-me-up <skill or command>`, `/don-draper <for chat|agent|person> <subject>`, `/88-mph <small|medium|large> <topic>`, `/badger <idea>`, `/watson <adr|doc|deck|team|page> <subject>`, `/war-room [add|plan|show]`, `/skyler [refresh]`, `/leon [quick|deep] [dry]`, `/life-finds-a-way <name> [small|medium|large] | adopt`, `/dependabot-report`, `/cloud-city`. Used by Claude as needed: `the-trail`, `car-wash`, `tesseract`.
- **design:** `/heisenberg <topic>`, `/superlab <topic> [pages…] [in-chain]`, `/darth-vader <version> [preview-url]`; `spidey-sense` as needed.
- **database:** `bro-code` as needed.
- **Run by scheduled tasks (and by hand):** `groundhog-day` (daily about 07:45), `previously-on` (Sunday about 18:30), `leon` (quick daily about 09:00, deep the 1st), `dependabot-report` (Monday about 07:40, so the 08:00 brief can read it; the app jitters minutes). In the dojo: `/mr-miyagi` (`~/dojo/.claude/skills/mr-miyagi`).
