---
name: oceans-eleven
description: "Who does what: the routing table `maverick` applies when handing out work, with model and effort per kind of job, escalation, the star limit and the speed settings. Read when planning a release or choosing an agent."
---

# The team (`oceans-eleven`, was the `team` skill)

**Title:** runs inside another session; keeps that session's title.

## Why a table, not pickers

The design had five "pickers" choosing a worker per job, but a subagent has no Agent tool, so a picker can't spawn anyone. A picker layer would also re-read every work order on top of `maverick`, while the builders are the cost, so `maverick` applies this table itself and passes `model` on each spawn.

## Routing table

Each row: job → agent, model, effort.

**Plan**
- A release plan, or a design decision when `maverick` runs Sonnet → `admiral-ackbar`, Opus, high.
- The plan of a chain or a release whose mistakes spread (the kit, full auto, a design system, a new project) → `dom-cobb`, Fable, high, inside `/inception` only, before the release starts; never inside a running release. The once-a-window audits have their own: `/jedi-council` is led by `mace-windu`, `/black-box` is `barney-stinson`'s.
- A step marked important design, or a plan `maverick` doubts → a senior (below).

**Design**
- A page or component whose layout is the question → `mosbius-designs`, Opus, medium, 8M, 6 shots: two options, one agent; it reports the screenshot paths and picks itself, and `maverick` publishes the gallery page from them (under `/superlab`, the studio session does).
- **Sized to the job:** `designer=fable` applies only to drawn things and steps marked important design. A placement or wording tweak gets no designer (the builder shows two variants in one shot); an ordinary layout gets Opus `mosbius-designs` at 8M and 6 shots.
- **Drawn things** (icons, badges, illustrations) → `mosbius-designs` with `model: "fable"` (a star), never straight from a text brief to a builder: three directions at real size (16, 20, 48px, both themes) beside what they replace, in a gallery `maverick` publishes; the builder then traces the pick. The gallery goes in the final ping even with `pick=designer`, so Alexander can overturn it (icons built from a text brief alone came out unreadable).
- A whole page's layout marked "important design" → `mosbius-designs` with `model: "fable"`; counts as a star.
- A taste-heavy release (a stats round, a new kind of page) → `heisenberg`, Fable, high, first: a short creative brief from Alexander's notes, briefing `mosbius-designs`, then a review of the built result against it; it sends bolder leaps to `farbror-vattenmelon`. A star; 8M by default. Not every release. For a vision shaped with Alexander in person, `/heisenberg <topic>` instead.

**Build**
- Small UI steps with a clear spec, or docs → `jesse-pinkman`, Sonnet, medium, at most 2–3 steps per agent. A process first commit of more than five items is split by lane, one `jesse-pinkman` per lane; a worktree lane's order says to use relative paths inside the worktree only: one Sonnet hit its budget alone on a page and again on nine process items.
- Page-sized steps, logic, the waitlist, access rules, anything touching the shared helpers → the builder pool, Opus, medium: `chris-de-kok`, `ahmed-och-ahmed`, `saul-goodman`, `jeff-winger`, `troy-and-abed` (Alexander: "Five different opus builders maybe who can run parallel? Fun with more names too!"). The same prompt under five names, so the timeline says who built what; `maverick` hands the next free name to the next lane.
- **Lanes:** parallel builders only on files no other agent touches (one page or folder each), each beside the main checkout in its own worktree, set up per the `tesseract` skill. `maverick` merges each worktree before a step that touches its files. **When builders run side by side, each order names the owner of any helper they share** (`[parallel]`: 2.13.2 wrote "Playing this now" twice).
- **A builder's own check before QA covers the `[builder-checks]` list:** pages under the size cap; no secret in a URL and no private or spoiler text in push or email; typed text escaped in email HTML; tests that reach the Supabase client mock it; every button shows the pointer and matches its type.
- A review finding, a CI failure, or a first try at a bug → `jesse-pinkman`, with the finding and file:line (`chris-de-kok` when it's in the shared helpers or logic); `boba-fett` after two failed tries. No separate fixer agent — it would be the builder with a different prompt.
- A step needing a file over ~500 lines gets a builder of its own.
- A whole page is one step for `chris-de-kok`, never two.
- An audit (every toast, every confirm) gets its file list from `lorenzo-von-matterhorn` first, and the order names the files.
- A fresh builder every 2–3 steps, or once its calls pass ~150k tokens.
- **Paths in an order are a literal list** (2.14.6.1, confirmed at `/memento`): one path per line or a zsh array, never a space-separated variable; zsh doesn't split it, and three builders of 2.14.6.1 lost calls on that.
- **No skill or agent ships unnamed or unvoiced:** the step that adds one writes its `## Voice` card from the `design` plugin's `voice-card.md` in the same commit (2.14.6.2).

**Find**
- "Where is X" → `lorenzo-von-matterhorn`, Haiku, low.
- A broad sweep across the tree → the built-in Explore agent.
- Web research → `/88-mph <small|medium|large> <topic>` with the decision it serves: small inline (≈ 1M), medium `doc-brown` (6M), large adds `marty-mcfly` (4M, run ≤ 13M); never the built-in deep research.

**QA & review**
- Features the plan marks **qa** (new pages or layouts; sign-up, waitlist, access or link flows) → `bengt-johansson`, Sonnet, medium: a fresh one per marked feature (side by side is fine, each in its own tab), one pass each: 375 dark, 1024 dark and one light screenshot, text checks between, **at most three checks per agent** (more checks go to another fresh `bengt-johansson` beside it: one agent runs out of budget before check 4); its budget is the `[budget …]` tag in the work order. The builder of a qa feature leaves the seeded test row's URL in its report, so `bengt-johansson` opens the page instead of creating its own data. Everything else is checked by its builder as text and by the reviewer.
- The full matrix → only on demand, as `/darth-vader`.
- `bengt-johansson` is the single-feature pass. A release with several UI features or any layout work sends the Bengan Boys instead, one per lane: `magnus-wislander` (1024/1440), `staffan-olsson` (375), `stefan-lovgren` (interactions), then `tomas-svensson` last against `.claude/taste.md`; each in its own tab. QA's share target is ≤10% of the release.
- The pre-merge review of a finished branch → `kissochbajslowski`, Sonnet, high; give it the screenshot folders.
- The second reviewer, for design and accessibility → `daredevil`, Sonnet, high, read-only, in every release with UI.

**Database**
- Migrations, RLS, SQL tests, types, Edge Functions → `the-playbook`, Opus, high; xhigh only for policy rewrites. Fresh per migration (`[playbook]`).
- Beside a builder in a worktree (`isolation: "worktree"`) when the files don't overlap.

**Debug**
- A bug that survived two attempts → `boba-fett`, Opus, xhigh.

**Deploy**
- Production steps → `ranjit`, Opus, high, only through `/skinny-pete` (or `/one-ring`, the same run with `merge` set); one `ranjit` for both phases, relayed by `skinny-pete`, the deploy session's navigator.

**Docs**
- The README update, the PR description and its Usage section, the-trail edits → `c-3po`, Sonnet, medium, from the plan file, the commit log and `maverick`'s notes; used by `carousel` and `maverick`'s step 6.

## Budgets

Every Agent `description` ends with the step's budget, e.g. `[budget 20M]`. **A tag is real tokens, written ×1:** Hank counts what Skyler counts (since 2.14.6), so there is no ×1.8 to scale by. Hank (`${CLAUDE_PLUGIN_ROOT}/hooks/budget-cap.mjs`) reads it from the subagent's meta file and counts the agent's real tokens with Skyler's parser: a note at 80%, every call but the final report denied at 100%. A SendMessage follow-up carries its own tag, the agent's new total. Without a tag the role's default holds. **Since 2.14.6 the defaults live in `.claude/kit.json`** (`budgets`, per agent, `"*"` for the rest; Hank ignores a value above 100M and logs it, and falls back to its own table when the file is missing or malformed); the table below mirrors it, so change both together:

| Role | Default | Role | Default |
|---|---|---|---|
| `lorenzo-von-matterhorn`, `romeo-olsson` | 2M | the builder pool (all five) | 25M each |
| `c-3po` | 10M | `boba-fett` | 30M |
| `yoda`, `farbror-vattenmelon`, `admiral-ackbar` | 10M; `dom-cobb` 20M | `the-playbook` | 45M (stopped at 150%); 35M for a migration with a cron job or an in-place edit (`[playbook]`) |
| `mosbius-designs` (Opus 8M, Fable 12M) | 8M | `heisenberg` | 8M |
| `bengt-johansson` (per feature) | 14M | `ranjit` | logged only |
| `jesse-pinkman`, `kissochbajslowski`, others | 15M | `daredevil` | 3M |
| `mike-ehrmantraut` | 30M | the four Bengan Boys (as `bengt-johansson`) | 14M |
| `three-eyed-raven` | 8M | `daredevil` whole-app (e.g. `/darth-vader`'s a11y lane, one page family per call) | 10M |

`the-protagonist` is a session (the chain's conductor), never a spawned agent, so Hank has no budget for it; its usage is read from its session.

Screenshot caps: the QA roles (`bengt-johansson`, `tomas-svensson`, `magnus-wislander`, `staffan-olsson`, `stefan-lovgren`) 5 per feature, `mosbius-designs` 6 on Opus, 10 on Fable (screenshots and zooms, batches included). A frame shot for `scroll` coordinates (`scale` ≤ 0.25) doesn't count; those stop at 12 per agent. The numbers live in the hook; change them there and here together.

**A role that overruns in two releases gets its route changed** (a cheaper model, smaller steps, or a fresh agent per piece), written into this skill by `future-ted` from the PR's budget rows.

## Escalation

- An agent that fails twice at its step goes one model up (Haiku → Sonnet → Opus → Fable), with the previous attempt's report in the new order so it doesn't start from nothing.
- Opus failing twice goes to `boba-fett` for a bug, or to a senior for a decision.
- Fable only within the star limit.
- `maverick` notes each escalation in the PR's "Notes for review".

## Seniors

Before any ping to Alexander for a decision, an Opus `maverick` may ask `yoda` (Opus, max, adviser only: no reviews, deploy-plan reads or verdicts; Alexander, 30 Sep: he is "just supposed to be the senior adviser for the navigator"), then asks `farbror-vattenmelon` (Fable, high) if `yoda` says the call is Alexander's or it still doubts. Only then the ping. **For `captain-call`** (his own skill) (a Fable navigator on a release whose mistakes spread) the ladder is shorter: `farbror-vattenmelon` alone (never `yoda`), then Alexander with your recommendation and the adviser's side by side; he decides (Alexander, 29 Sep, 30 Sep). A senior asked for a decision doesn't count against `stars=` under either navigator (it stands in for a ping, not a worker), and every ping names the seniors it asked (`farbror-vattenmelon` said …, and `yoda` said … under an Opus `maverick`). Person-only items (secrets, the Keychain, dashboards, production) skip the seniors and go straight to Alexander.

**In a chain link** nobody is there to ping, so a call goes straight to `three-eyed-raven`, which decides and logs it in the chain log for `/memento` (Alexander, 2 Oct: "raven alone"); its order carries the navigator's question, the options and its recommendation, and what the plan, `CLAUDE.md` and the roadmap say (the raven decides even when one is missing, and names it). Not a star. Taste, drawn things and anything on production never go to it: a taste pick parks as `TASTE WAIT` for `/memento`.

Both are read-only. The order gives them the question, the options, the relevant files and what the roadmap and `CLAUDE.md` say. Their answer and the choice go in the PR under "Decided on the way".

## Stars

A star is a Fable worker: `heisenberg`, `mosbius-designs` on Fable, or any builder escalated to Fable (`farbror-vattenmelon` asked for a decision is not one; see Seniors). Fable moves the meter far more than its token share, so they're rationed:

- `stars=1` per release session by default; `/maverick <version> stars=N` overrides it; `quick` sets 0.
- `maverick` keeps the count in the PR body ("Stars used: 1/1") and never goes over it without a ping.
- A Fable navigator isn't a star; that's the session mode. The big Fable releases have their own navigator, `captain-call` (Woodrow F. Call of Lonesome Dove, who leads the drive and says little), started with `/captain-call` and run by its own skill; this skill's routing applies to him wherever his skill doesn't say otherwise.

## Overrides

`/maverick <version> <role>=<model>...` targets specific roles for the whole run, on top of the routing table above, e.g. `/maverick 2.9 opus designer=fable`, `builder=opus`, `qa=quick`, `reviewer=opus`, `db=xhigh`; plain words work too ("fable designer"). `maverick` applies each override wherever that role is spawned and lists them in the PR's first lines. `designer=fable` reaches only drawn things and steps marked important design (see Design). A Fable override counts against `stars` (raise it to fit if needed, and say so in the PR). The same `role=model` form typed in chat mid-release ("from now on builder=opus") applies for the rest of the run, same rules.

`pick=me|designer|navigator` says who picks between a designer's options. Default is `pick=designer`: it picks itself and says why, whichever model it runs on — except **drawn things and taste picks (icons, logos, a page's look), where the default is `pick=me`** (Alexander: the designer's pick was overturned twice); under away, overnight or in a chain link, `/superlab`'s step 5 is the rule: wait up to 2 hours for him, then build the designer's (or `heisenberg`'s) pick with the runner-up ready as a one-commit swap; the gallery stays open for him. `pick=me` pings Alexander with the gallery; `pick=navigator` has `maverick` pick from the designer's recommendation instead. `pick=me` under `/ill-be-back` waits until the end and the rest of the run builds around it. Either way, the gallery link and who picked go in the PR's "Decided on the way", so a pick can be overturned.

## Speed settings

An argument to `/maverick` (default normal); `/night-watch <version>` is slow plus away.

| Speed | What changes |
|---|---|
| **slow** | Overnight and `/night-watch`. One agent at a time. Builders may go one model up when in doubt; `bengt-johansson` adds 1440 on marked layout work; the second design reviewer runs; `boba-fett` after one failed attempt instead of two. |
| **normal** | This table as written; how many agents run side by side is lesson `[parallel]`'s rule, not set here. One editing agent per lane, one browser-using agent per tab (each QA agent opens its own with `tabs_create` and closes it), one migration writer at a time, Fable within `stars=`. |
| **quick** | Decide and move on. Agents side by side as normal (`[parallel]`). Sonnet wherever the spec is clear; builders check as text only; `bengt-johansson` only on flows (sign-up, waitlist, access, links); no `mosbius-designs` unless a step is marked important design; `stars=0`. |

**Pace to the 5-hour window** (`[parallel]` in lessons.md): `get_usage` before each batch of spawns; how many at once is the `[parallel]` rule whatever the speed; none started above 85% of the 5-hour window.

Parallel saves wall-clock, not tokens: Hank's per-agent budgets are the same at every speed, and side-by-side agents still keep to separate lanes and tabs.

Speed only sets how many agents run at once; how careful and how costly the run is belongs to `allowance=` (above). Neither changes the safety rules: the backup before a production database change, the guard hook, green checks before a commit.

## Allowances

`allowance=cheap|normal|high|unlimited` (default normal) sets how careful and how costly a run is; `speed=` only sets how many agents run side by side (wall-clock). It is an argument to `/maverick`, `/night-watch` and `/captain-call` (which passes `high`). Alexander, 29 Sep: "four allowances modes for usage and effort etc … Cheap, normal, High, and no limit".

| | cheap | normal | high | unlimited |
|---|---|---|---|---|
| Budget tags | ×0.6 | ×1 | ×1.5 | as normal, with a note that Hank's limits are not enforced by the tag |
| Meter target per release | 3% | 5% | 8% | none, reported |
| Model floor | Sonnet wherever the spec is clear | the routing table | Opus for every build step | a Fable navigator allowed |
| Efforts | medium | as in the table | one step up; `the-playbook` xhigh on policies | as high as fits |
| Stars | 0 | 1 | 2 | no cap |
| Checking | one reviewer; QA on qa-marked features only | the table | `daredevil` runs in every release with UI, whatever the allowance; QA on every feature; `/darth-vader`'s matrix before the PR | as high |
| Seniors | only when stuck | as in Seniors | a senior reads every plan (`farbror-vattenmelon`; `yoda` only under an Opus `maverick`) | on every doubt |

- Hank can't read this table: the navigator scales every `[budget …]` tag by the multiplier when it writes the tag. Unlimited keeps the tags (with the note) and Hank's role defaults, and the run logs usage without stopping for it.
- The targets are reported, not enforced: the navigator reads the meter at the start and after the draft PR, as in `maverick`'s plan step.
- `stars=` still overrides the row, as do `<role>=<model>` overrides.
- **Production safety is never an allowance:** the guard, the backup before a database change, green checks and the hard stops are the same in all four.

## Deciding or asking

Every agent, whatever its model: decide it yourself when it is reversible and inside the spec, and say what you decided in the report. Send scope, taste, money and production back to the navigator instead of guessing. An option that adds scope is offered as the next release, never "new scope for this one". At most two review rounds on the same code per release (the rest is the next release's first job), and a prompt forecast to Alexander before any job on locked files. Saving tokens never lowers the quality bar (`kissochbajslowski`'s quality section); a step that can't meet it within budget asks for more budget.

## The navigator stays lean

The navigator never reads a file or page over ~20k characters itself: `lorenzo-von-matterhorn` or `c-3po` reads it and returns the part it needs. The roadmap page is read by `c-3po` and `the-trail`, never in full by the navigator. A QA finding goes to its fixer in one order with file:line, not relayed piecemeal. `c-3po` drafts the PR description before `its-a-trap` runs.

## Speaking in character

Alexander, 29 Sep: "I love when you have small easter eggs of speaking a little bit like your character ... especially when starting an agent or wrapping up. Just small bits would make it very cool!" Every agent and every skill that speaks carries a `## Voice` card near the top of its file (since 2.14.6.1; the frozen `ranjit` and `yoda` get theirs at 2.14.7). Each speaks as its own character, never another's: "Kids, …" is `future-ted`'s alone. At most one short in-character line, at the start or the end of a report or ping; never in commits, PR descriptions, code, or anything in the PR; clarity first, and the facts stay plain. Alexander is The Dude and Anton is The Jesus on voice surfaces only (pings such as "Your go, Dude", sign-offs); never in rules, ADRs, the guard hook, commits or PRs. The card's shape and rules are in `.claude/voice-card.md`; the app's own outward voice (briefs, store text, anything a member or stranger reads) is `.claude/house-voice.md`.

## Full auto (`/cattle-drive`, ADR 0009)

**Mode 1, built in 2.12.1:** `/cattle-drive <version>` runs the release as `/maverick <version> away`, then, in a new session in Auto mode (Opus; high with `wrap`), the deploy as `/skinny-pete <version> merge` under the full-auto marker, and stops for Alexander's `/future-ted` (with `wrap`: runs its numbers part and leaves his notes open). The PR stays a draft until `ranjit` marks it ready under the marker, right before the merge; the arm is Alexander's only yes. Before the arm, `ranjit` (xhigh) plans and the plan-vs-PR script check reads the plan against the PR; a person's one tap on `scripts/full-auto.sh arm <version>` is the go; the guard then lets only `ranjit` run only the PR's listed commands, logged. The skill holds the preflight and the hard stops; a stall on any prompt falls back to `/skinny-pete <version> merge` in manual mode.
**Chain mode, built in 2.12.2:** `/cattle-drive <version> chain` also runs the wrap-up and the next release, a fresh session per link (`the-protagonist` conducts); a chain link's calls go straight to `three-eyed-raven`, and `/memento` reviews the chain afterwards. A chain runs with a tap per release (`arm-chain` authorises the order of versions; each release's arm still asks Alexander); the one-tap arm is built (2.12.4).
Hard stops are the same in every allowance and never a senior's call.

## Sessions, modes and handoffs (moved from CLAUDE.md)

- **Sessions:** one per release. `/maverick <version> [mode] [away]` is the go for the whole release, to the draft PR and final ping. After: quick questions can stay here, but a batch of follow-ups starts a **new session, Opus medium**, reading the PR and plan. `/future-ted <version>` runs after the deploy, in its own new session (Opus, high); `/skinny-pete` in manual permission mode. The next release starts a new session. Compact only mid-release, saying what to keep.
- **Autopilot** pings only for a decision the roadmap and CLAUDE.md don't settle, something only a person can do, a blocker `boba-fett` couldn't clear, a must-fix finding with several fixes, and the finished PR. Run it in Auto permission mode; `checkpoint` stops once before the review; marking the PR ready is Alexander's call. `/ill-be-back` (or `/maverick <version> away`) holds pings/questions to the job's end, taking the recommended option instead; `/kids-im-home` ends it.
- **Plans outside a release** use plan mode, and approving one is not a go: finish the planning work, summarise, recommend; build on an explicit "go".
- **Say how much checking a change needs** ("No browser check" for a text tweak); database, waitlist or access-rule changes get the full dev test. Batch feedback; screenshots beat descriptions.
- **Connectors per task:** Supabase and Claude Docs by default; switch the others on in the app only for a session that needs them. A denied connector's tools still take space in every request; only the app's switch removes them.
- **Usage target:** ≤5% of the weekly all-models limit per release, deploy included, paced ~14%/day. `/maverick` reads `.claude/lessons.md` and the meter at the start and after the draft, and budgets each step.

### Session modes

| Mode | When | Type |
|---|---|---|
| Fable autopilot | big releases whose mistakes spread (the kit, full auto, a design system); the navigator is `captain-call` | `/captain-call <version>` (Fable, high, Auto; sets itself up where it can) |
| Opus autopilot | M–L releases with a clear spec | `/model opus`, `/effort high`, Auto |
| Driver | taste-heavy work Alexander steers | `/model opus`, `/effort medium`, default permissions |
| Planning | before a chain or an important release (required), or triage and roadmap | `/model opus`, `/effort medium`, `/inception <version> [chain …]`; longer range: `/model fable`, `/effort high`, `/inception horizon <from>–<to>` |

`/maverick <version> mode` prints the lines; restart if the model/effort don't match (a session can set its own permission mode but not its model or effort; those are typed or set from outside). Speed (`slow|normal|quick`), `stars=N`, `allowance=cheap|normal|high|unlimited` (care and cost; `oceans-eleven` skill), `<role>=<model>` overrides (e.g. `designer=fable`) and `pick=designer|me|navigator` (default `designer`) are `/maverick` arguments too, and the same `role=model` form works mid-release in chat for the rest of the run; `/night-watch` = slow + away; details in the `oceans-eleven` skill. `.claude/lessons.md` holds the newest tuning lessons, rewritten by `/future-ted`.

### Agents and handoffs

The main session is the navigator, **`maverick`**: it talks with you, plans, and hands jobs to the specialists in the kit's `agents/` (the wolfpack plugins), each on its own model and effort (its own mode is above). The big releases whose mistakes spread have their own navigator, **`captain-call`** (Alexander: "Captain Call on this one from Lonesome Dove"; "I want the captain in charge here"), on Fable with his own skill, `/captain-call`. The other sessions are named after their skills (Alexander: "Rename the start release, wrap up and deploy prod skill after their agent names"): `/future-ted` the wrap-up, `/skinny-pete` the deploy, `/badger` the roadmap, `/darth-vader` the full QA, `/heisenberg` a creative session; `${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs` is Skyler, the budget hook Hank.

| Agent | Old name | Model, effort | Gets |
|---|---|---|---|
| `lorenzo-von-matterhorn` | scout | Haiku, low | "where is X"; file:line lists |
| `r2-d2` | sweeper (new, 2.14.6.1) | Haiku, low | `/jedi-council`'s file sweeps: sizes, counts, greps, file:line tables; Read/Grep/Glob only, no shell; 4M a sweep, `maxTurns` 40 (a 29-file sweep, not a scout's 15) |
| `admiral-ackbar` | planner | Opus, high | a plan or design decision when `maverick` runs Sonnet |
| `dom-cobb` | senior planner (new) | Fable, high | writes or takes apart the plan of a release whose mistakes spread (the kit, full auto, a new project); a star |
| `mace-windu` | head of the Jedi Council (new, 2 Oct) | Fable, high | leads `/jedi-council`: judges the team last, as an auditor, findings only; a star |
| `barney-stinson` | auditor (new) | Fable, high (lanes 2–3 on Opus) | the three lanes of `/black-box`, read and report; lane 1 is a star |
| `heisenberg` | creative director (new) | Fable, high | a creative brief before a taste-heavy release, briefs `mosbius-designs`, reviews the result; a star |
| `chris-de-kok`, `ahmed-och-ahmed`, `saul-goodman`, `jeff-winger`, `troy-and-abed` | builder | Opus, medium | the builder pool: page-sized steps, shared helpers and tricky logic, about one commit each; one name per lane |
| `jesse-pinkman` | builder (Sonnet) | Sonnet, medium | small UI steps with a clear spec, and docs; at most 2–3 steps per agent |
| `mosbius-designs` | designer | Opus, medium | two layout options for one page or component, in a worktree, before it's built |
| `the-playbook` | db-engineer | Opus, high | migrations, RLS, SQL tests, types, Edge Functions, on dev |
| `boba-fett` | debugger | Opus, xhigh | a bug that survived two attempts |
| `romeo-olsson` | test-runner | Haiku, low | `/you-shall-not-pass` by hand (autopilot runs `scripts/check.sh` itself) |
| `kissochbajslowski` | release-reviewer | Sonnet, high | the pre-merge review of a release branch |
| `daredevil` | a11y-reviewer (new) | Sonnet, high | the design and accessibility review of a release with UI, beside `kissochbajslowski`; also `/darth-vader`'s a11y lane; read-only |
| `mike-ehrmantraut` | codebase-auditor (new) | Opus, high | `/no-half-measures`, the maintainability audit in V2's end window; read-only, a star |
| `c-3po` | documenter | Sonnet, medium | the README update, the PR description and Usage section, the-trail edits |
| `ranjit` | prod-deployer | Opus, high | production steps, only through `/skinny-pete` (with `merge`: also marks the PR ready and merges it, on the same go) |
| `yoda` | senior-opus | Opus, max | adviser to an Opus `maverick` on a decision it doubts, before any ping; never a review, deploy-plan read or verdict; read-only |
| `farbror-vattenmelon` | senior-fable | Fable, high | the adviser for `captain-call` and, after `yoda`, for an Opus `maverick`; not used in chain links; not a star |
| `three-eyed-raven` | senior-decider (new) | Fable, high | chain mode only: decides a chain link's tough calls in Alexander's place, logs them for `/memento`; never taste or production; not a star |
| `doc-brown` | researcher (new, 2.14.6.2) | Opus, medium | `/88-mph` medium and large runs: searches wide then deep, writes one findings file under `~/.claude/plans/research/`; 6M |
| `marty-mcfly` | research checker (new, 2.14.6.2) | Sonnet, high | `/88-mph` large runs: re-checks only the key claims, appends `## Checked` (held / weakened / wrong); never rewrites the findings; 4M |
| `bengt-johansson` | qa | Sonnet, medium | features the plan marks qa (new pages, sign-up/waitlist/access/link flows): a fresh one per feature, budget from the order; full matrix via `/darth-vader` |

- **Use the names, always** (Alexander: it cheers him up): in chat, pings, PR comments, reports and task descriptions, say "`maverick` here", "`ranjit` is taking the backup", "`farbror-vattenmelon` says…", "handing it to `chris-de-kok`", not "the deployer" or "a builder"; the nicknames too (Slap Bet Commissioner for the guard hook). Old role names only in the table's "Old name" column.
- **Only `maverick` hands out work**, one editing agent per lane (a lane = files no other agent touches: one page or folder), side by side as far as interference allows (`oceans-eleven` skill).
- **Lanes beside the main checkout run in worktrees** (`isolation: worktree` starts from `main`): the order follows the `tesseract` skill (branch tracking, env, ports, the database self-link). `maverick` merges each worktree before a step that touches its files.
- Reuse an agent through SendMessage for follow-ups on the same files, but a builder for at most 2–3 steps: its context grows with every step and is re-read on every call. Screenshots only when a feature is finished, taken once by the `bengt-johansson` agent. Small edits stay with the navigator.
- **Every job carries a budget** (`[budget NM]` at the end of its description); Hank (`${CLAUDE_PLUGIN_ROOT}/hooks/budget-cap.mjs`) enforces it.
- **The work order carries everything** (the step, the 3–5 files to read, shared components to use, how to check it, the branch): specialists don't see the conversation, and stop with questions for the navigator to ask you.
- **Capture skills:** a procedure that comes up twice becomes `.claude/skills/<name>/SKILL.md`, listed in the PR's "Notes for review". Improve an existing skill over a near-duplicate.
- **Effort:** xhigh/max only where a mistake is expensive (production, stubborn bugs, seniors). `the-playbook` runs at high; for policy rewrites and private events it writes the test first (see its prompt). Failing twice goes one model up, per the `oceans-eleven` skill; after the hard part, back down.

**Slash commands** (the wolfpack plugins' `skills/`): `/maverick <version> [checkpoint|mode|away|speed|stars=N|<role>=<model>|pick=designer|me|navigator]`, `/captain-call <version>`, `/cattle-drive <version>`, `/night-watch <version>`, `/darth-vader <version>`, `/heisenberg <topic>`, `/skyler`, `/no-half-measures <version>`, `/legendary`, `/you-shall-not-pass [all|app|db|local]`, `/its-a-trap [version]`, `/carousel`, `/badger <idea>`, `/oracle <question>`, `/beam-me-up <skill or command>`, `/don-draper <for chat|agent|person> <subject>`, `/watson <adr|doc|deck|team|page> <subject>`, `/the-tower [install|test|remove]`, `/88-mph <small|medium|large> <topic>`, `/war-room [add|plan|show]`, `/leon [quick|deep] [dry]`, `/skinny-pete <version> [check|merge]`, `/one-ring <version>`, `/future-ted <version>`, `/ill-be-back`, `/kids-im-home`. Used by Claude as needed: `spidey-sense`, `bro-code`, `the-trail`, `cloud-city`, `car-wash`, `tesseract`. Run by scheduled tasks (and by hand): `groundhog-day` (daily about 07:45), `previously-on` (Sunday about 18:30), `leon` (quick Mon + Thu about 09:00, deep the 1st), `dependabot-report` (Monday about 07:40, so the 08:00 brief can read it; the app jitters minutes). In the dojo, from `dojo-template/`: `/mr-miyagi`.
