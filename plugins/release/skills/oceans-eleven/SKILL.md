---
name: oceans-eleven
description: "Who does what: the routing table `captain-call` applies when handing out work, with model and effort per kind of job, budgets, escalation, the star limit and the speed settings. Read by section when planning a release or choosing an agent."
---

# The team (`oceans-eleven`, was the `team` skill)

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · oceans-eleven <subject>` (norms.md).

**Read it by section, never whole** (kit 1.5, H3: it was 40 KB re-sent on every navigator call). `grep -n '^## '` this file, then read only the ranges you need: **Routing table** and **Budgets** at a release's start; Escalation, Seniors, Stars, Overrides, Speed settings or Allowances when an argument or a step calls for them. The roster table, the slash list, full auto and the reasons behind the table are in `reference.md` beside this file, for a person or a planner, not for a running release. Session modes live in norms.md, "Which Claude for what".

## Routing table

Each row: job → agent, model, effort. `captain-call` applies it itself and passes `model` on each spawn (a subagent has no Agent tool, so no picker layer).

**Never `general-purpose`:** a job with no row goes to `lorenzo-von-matterhorn` (find), `c-3po` (write) or the next free builder; Hank denies a nameless spawn (kit 1.5, M4: 15 nameless runs cost 82M).

**Plan**
- A release plan, or a design decision when `captain-call` runs Sonnet → `admiral-ackbar`, Opus, high.
- The plan of a chain or a release whose mistakes spread (the kit, full auto, a design system, a new project) → `dom-cobb`, Fable, high, inside `/inception` only, before the release starts; never inside a running release. The once-a-window audits have their own: `/jedi-council` is led by `mace-windu`, `/black-box` is `barney-stinson`'s.
- A step marked important design, or a plan `captain-call` doubts → the senior ladder (Seniors, below).

**Design**
- A page or component whose layout is the question → `mosbius-designs`, Opus, medium, 5M, 6 shots: two options, one agent; it reports the screenshot paths and picks itself, and `captain-call` runs `design/scripts/gallery.mjs` on them and publishes the page (under `/superlab`, the studio session does). The tag is 5M (kit 1.5, M7: 72 runs used 3.2 to 4.0M of an 8M tag).
- **Sized to the job:** `designer=fable` applies only to drawn things and steps marked important design. A placement or wording tweak gets no designer (the builder shows two variants in one shot).
- **Drawn things** (icons, badges, illustrations) → `mosbius-designs` with `model: "fable"` (a star), never straight from a text brief to a builder: three directions at real size (16, 20, 48px, both themes) beside what they replace, in a gallery made by `gallery.mjs`; the builder then traces the pick. The gallery goes in the final ping even with `pick=designer`, so Alexander can overturn it (icons built from a text brief alone came out unreadable).
- A whole page's layout marked "important design" → `mosbius-designs` with `model: "fable"`; counts as a star.
- **A `/superlab` designer order** (`[shots]`) carries an exact shot list with one spare, the mock built from `<design>/scripts/mock-scaffold.mjs` and shot with `<design>/scripts/qa/batch-shots.mjs`, what must go, constants checked in code and a typeface as a drawing; `save-shot.mjs` refuses images older than the pass.
- A taste-heavy release (a stats round, a new kind of page) → `heisenberg`, Fable, high, first: a short creative brief from Alexander's notes, briefing `mosbius-designs`, then a review of the built result against it; it sends bolder leaps to `captain-call`, who puts them to Alexander as a pick-one. A star; 8M by default. Not every release. For a vision shaped with Alexander in person, `/heisenberg <topic>` instead.

**Build**
- Small UI steps with a clear spec, or docs → `jesse-pinkman`, Sonnet, medium: one tap or one component a spawn (three taps in one step are three orders), docs at most 2–3 steps per agent. A process first commit of more than five items is split by lane, one `jesse-pinkman` per lane; a worktree lane's order says to use relative paths inside the worktree only: one Sonnet hit its budget alone on a page and again on nine process items.
- Page-sized steps, logic, the waitlist, access rules, anything touching the shared helpers → the builder pool, Opus, medium: `chris-de-kok`, `ahmed-och-ahmed`, `saul-goodman`, `jeff-winger`, `troy-and-abed` (Alexander: "Five different opus builders maybe who can run parallel? Fun with more names too!"). The same prompt under five names, so the timeline says who built what; `captain-call` hands the next free name to the next lane.
- **A sweep of 20+ files** (`[sweep]`) gets 25-30M or two lanes; its order greps for what the page shows, not one code pattern, and a class-name sweep greps its own diff, over the whole tree, for glued tokens.
- **Lanes:** parallel builders only on files no other agent touches (one page or folder each), each in a worktree the navigator makes outside `.claude` (`~/Desktop/<Project>-lanes/<lane>`, the release branch as base; `captain-call`, "Parallel lanes"), its path in the order, set up per the `tesseract` skill; never `isolation: "worktree"` (`[lane-home]`, kit 1.5, H2). `captain-call` merges each worktree before a step that touches its files; `tesseract` cleans them up at the release's end. **When builders run side by side, each order names the owner of any helper they share** (`[parallel]`: 2.13.2 wrote "Playing this now" twice).
- **Browser lanes in one session** (`[one-session]`): each lane runs its own dev port (`npm run dev -- --port 51NN --strictPort`), signed in at the start; a fixed QA layout group nobody toggles, named in the order; restart the lane's server after any `package.json` change.
- **A builder's own check before QA covers the `[builder-checks]` list:** pages under the size cap; no secret in a URL and no private or spoiler text in push or email; typed text escaped in email HTML; tests that reach the Supabase client mock it; every button shows the pointer and matches its type.
- **Every page order carries a "Fixtures" block** (`[fixtures]`): the QA group ids (a club one, a non-club one), seed URLs, the measured stack heights, the existing components and tokens to reuse (the navigator greps them before writing the order), and where each new button leads. It also carries what builders kept asking for (M4, kit 1.7; the order composer under Find gathers it):
  - the tests that read the changed files (`grep -l <file or name>` over the tests), and for a text change the tests that pin the strings;
  - the loader that already has the data, so nobody writes a second query;
  - the gitignored env files the step needs (copied into a lane, never committed);
  - "the shell is zsh, spell paths out" (one path per line; a `$P` list is not split);
  - the service-role requirement, in the first order that needs it;
  - the exact test command with the file name;
  - the trigger selector or fold id the check clicks;
  - for QA: `seed=shared` when QA lanes run side by side (the navigator runs the one seed and its clean-up); a `qa-flow.mjs` steps file for each flow a QA agent walks; and for a simple `mosbius-designs` layout page, `mode: scripted` with `model: "sonnet"`.
  When the order says `seed=shared`, the navigator owns one seed and one clean-up, no lane cleans. A wrap-up page order carries the exact lines or array to change.
- A review finding, a CI failure, or a first try at a bug → `jesse-pinkman`, with the finding and file:line (`chris-de-kok` when it's in the shared helpers or logic); after two failed tries, an Opus builder at xhigh with both earlier reports in its order. No separate fixer agent: it would be the builder with a different prompt.
- **A new library with its tests** (a loader, a forecast, an Edge Function door) is two spawns, the module then its tests and wiring, each tagged ≤ 10M. A fix order over ~6 findings is split by area, and **each fix round is its own order with its own tag**, a second round to a fresh agent (`[fix-rounds]`). The pool's over-budget steps four releases running were these shapes, whichever name took them.
- **A step whose file:line column names more than 6 files is cut at `/inception`**, a shared part first, then its pages (`[turns]`): the pool hit Hank two releases running on 8- and 9-file steps (Burrow 0.12.1, 0.12.2).
- A step needing a file over ~500 lines gets a builder of its own.
- A whole page is one step for `chris-de-kok`, never two.
- An audit (every toast, every confirm) gets its file list from `lorenzo-von-matterhorn` first, and the order names the files.
- A fresh builder every 2–3 steps, or once its calls pass ~150k tokens; reuse one through SendMessage only for follow-ups on the same files. Small edits stay with the navigator.
- **Paths in an order are a literal list** (2.14.6.1, confirmed at `/memento`): one path per line or a zsh array, never a space-separated variable; zsh doesn't split it, and three builders of 2.14.6.1 lost calls on that.
- **A silent lane is stopped** (`[watchdog]`, the `captain-call` skill's Build has the steps): while background work or a parked session runs the navigator never ends a turn without a background `sleep` timer that wakes it (a foreground Agent call needs none); on each wake it runs `run-clock.mjs` once (each lane's last commit and file write, a session's transcript), stops one silent for 20 minutes (on the 20-minute tick, one silent 20 minutes is caught within 40) and hands its files to a fresh agent of the same role, and does a step stuck on a prompt itself. Every work order carries "never run a command that doesn't exit on its own; a refused call is never retried; edit with Edit or Write, scratch files by absolute path".
- **Every order lists what the guard refuses in a shell call** (`[frozen]`, `[guard-noise]`): a shell line naming `prod-db.sh`, `full-auto.sh` or the plugins' `hooks/`, or writing `${…}`, is refused, so use Read, Grep or Edit for those; a nested `claude` is refused in Bypass; hook tests run as `npx vitest run` on the hooks folder, never `node --test`. Under a chain marker it also carries "no `cd` into a folder built at run time" (chain 3.0: seven guard refusals, all one shape).
- **Shell shape** (H5, kit 1.7; `captain-call`'s Build has the same rule): one command per Bash call, `git -C <repo>` with absolute paths, no `cd <dir> &&` and no `VAR=value` prefix, tracked files edited with Edit or Write, and `gh pr checks --watch` once instead of a poll loop. 15 of 26 prompts in the kit 1.6.1 window were these shapes.
- **Commits in an order are path-scoped:** `git commit -- <paths>`, never a bare `git commit` after `git add` (`[parallel]`: three ride-alongs in 3.1, one lane's commit carrying another's staged files). An order for a page that writes data names the query keys it invalidates (3.1's club cache).
- **No skill or agent ships unnamed or unvoiced:** the step that adds one writes its `## Voice` card from the `design` plugin's `voice-card.md` in the same commit (2.14.6.2). A procedure that comes up twice becomes a skill (`.claude/skills/<name>/SKILL.md`), listed in the PR's "Notes for review"; improve an existing skill over a near-duplicate.

**Find**
- "Where is X" → `lorenzo-von-matterhorn`, Haiku, low.
- **The order composer** (Feature 1, kit 1.7) → `lorenzo-von-matterhorn`, Haiku, low, `[budget 2M]`, before each build step: given the step's files, it lists the tests that read them, the loader that holds the data, the lines of the project's `.claude/standing-facts.md` that touch the step, and the step's selectors; `captain-call` appends the list to the order's Fixtures. The standing facts file (starter: `templates/standing-facts.md`) is read there and by the builders; the navigator appends to it at the wrap from `order`-tagged cheaper lines that hold for any step.
- A broad sweep across the tree → `lorenzo-von-matterhorn` (several in parallel for a wide tree, each its own folder). The built-in Explore agent is not used: Hank denies nameless spawns (council M4).
- Web research → `/88-mph <small|medium|large> <topic>` with the decision it serves and the person's questions in their words: small inline (≈ 1M); medium scopes the questions and angles, then one `doc-brown` (6M); large shows the scope first, then 2–4 `doc-brown` lanes (6M each), a counter pass (3M) and a check (4M), run ≤ 35M. Medium and large get their own session when asked from a side session (`mr-miyagi`, `wilson`); never the built-in deep research.

**QA & review**
- Features the plan marks **qa** (new pages or layouts; sign-up, waitlist, access or link flows) → `bengt-johansson`, Sonnet, medium: a fresh one per marked feature (side by side is fine, each in its own tab), one pass each, shots by `web-shooters`' "Shot counts", text checks between, **at most three checks per agent** (more checks go to another fresh `bengt-johansson` beside it: one agent runs out of budget before check 4); its budget is the `[budget …]` tag in the work order. The builder of a qa feature leaves the seeded test row's URL in its report, so `bengt-johansson` opens the page instead of creating its own data. Everything else is checked by its builder as text and by the reviewer.
- The full matrix → only on demand, as `/darth-vader`.
- `bengt-johansson` is the single-feature pass. A release with several UI features or any layout work sends the Bengan Boys instead, one per lane: `magnus-wislander` (1024/1440), `staffan-olsson` (375), `stefan-lovgren` (interactions), then `tomas-svensson` last against `.claude/taste.md`; each in its own tab. QA's share target is ≤10% of the release.
- The pre-merge review of a finished branch → `kissochbajslowski`, Sonnet, high (Alexander's call B, 24 Oct 2026: a plan may name Opus for one wall review only with the reason in that row); give it the screenshot folders and name the release branch, its base and the app's source folder. Every reviewer and QA pass gets the builders' and earlier passes' shot folders in its order, so it shoots only what they lack (portfolio 0.3: four QA passes took 15 shots of the same two pages, none handed the earlier ones).
- A whole-part review splits into a database lane and an app lane, one `kissochbajslowski` each (`[turns]`: one reviewer runs out of turns on a whole part).
- The second reviewer, for design and accessibility → `daredevil`, Sonnet, high, read-only, in every release with UI; its order names the release branch, its base and the app's source folder too.

**Database**
- Migrations, RLS, SQL tests, types, Edge Functions → `the-playbook`, Opus, high; xhigh only for policy rewrites. Fresh per migration (`[playbook]`). The order carries the scope sheet (`scope.mjs` output, one per table or function the step touches).
- **A security brief** (`[security-brief]`) for a throttle names all three caps (per key, per target, global) and where it counts atomically; a security read runs in the same wave as the anon surface it covers; an auth brief names the link types each flow signs in with.
- Beside a builder in its own lane (the Lanes bullet above) when the files don't overlap.

**Debug**
- A bug that survived two attempts → an Opus builder at xhigh with both earlier reports in its order.

**Deploy**
- Merge and deploy → `/one-ring`, his one word, in the session he types it in: the database plugin's deploy script, no agent (kit 1.6). The project's own `ranjit`, Opus, high, runs a chain's deploy leg (`/cattle-drive`) and `/skinny-pete`'s manual cases.

**Docs**
- The README update, the PR description and its Usage section, the-trail edits → `c-3po`, Sonnet, medium, from the plan file, the commit log and `captain-call`'s notes; used by `carousel` and `captain-call`'s step 6.

## Budgets

Every Agent `description` ends with the step's budget, e.g. `[budget 12M]`. **A tag is real tokens, written ×1:** Hank counts what Skyler counts (since 2.14.6), so there is no ×1.8 to scale by. Hank (`${CLAUDE_PLUGIN_ROOT}/hooks/budget-cap.mjs`) reads it from the subagent's meta file and counts the agent's real tokens with Skyler's parser: a note at 80%, every call but the final report denied at 100%. A SendMessage follow-up carries its own tag, the agent's new total. Without a tag the role's default holds. **The defaults have one home, `${CLAUDE_PLUGIN_ROOT}/budgets.json`** (kit 1.7, council Feature 3), which Hank and the-tower read. A project's `.claude/kit.json` `budgets` (per agent, `"*"` for the rest) win over it; Hank ignores a kit value above 100M and logs it. The table below mirrors `budgets.json`, and `budget-cap.test.mjs` fails when the two differ, so change the file and the table in one commit:

| Role | Default | Note |
|---|---|---|
| `lorenzo-von-matterhorn`, `romeo-olsson` | 2M | |
| `c-3po` | 4M | median 0.5M (kit 1.6.1 council) |
| `jesse-pinkman` | 8M | median 2.1M |
| `chris-de-kok`, `ahmed-och-ahmed`, `saul-goodman`, `jeff-winger`, `troy-and-abed` | 15M | the builder pool, at the ceiling; medians 5.9 to 8.1M |
| `the-playbook` | 15M | stopped at 150%; a migration with a cron job is cut in two, not given a bigger tag (`[playbook]`) |
| `kissochbajslowski` | 15M | |
| `heisenberg`, `three-eyed-raven` | 8M | |
| `bengt-johansson`, `tomas-svensson`, `magnus-wislander`, `staffan-olsson`, `stefan-lovgren` | 14M | QA per feature, and the four Bengan Boys |
| `admiral-ackbar` | 10M | |
| `dom-cobb` | 20M | above the ceiling |
| `mike-ehrmantraut` | 30M | above the ceiling |
| `daredevil` | 3M | a whole-app pass (e.g. `/darth-vader`'s a11y lane, one page family per call) is tagged 10M |
| `mosbius-designs` | Opus 5M, Fable 12M | by model; 6 and 10 screenshots |
| any other role | 15M | `ranjit` is logged only, never stopped |

**The ceiling and the target.** 15M is the ceiling for any build or fix order's tag; a step that sizes over it is cut at `/inception`, never given a bigger tag (the audits `mike-ehrmantraut` 30M and `dom-cobb` 20M are the only rows above it). The defaults sit near the measured medians (kit 1.6.1 council: the pool 5.9 to 8.1M, `jesse-pinkman` 2.1M, `c-3po` 0.5M, no cap stop in about 200 runs), so a cap can stop a runaway before the navigator's eye has to. Turn caps are `maxTurns` in the agent files, so an order carries no turn line (`[turns]`: every 20M step in 3.1.1 hit `maxTurns` 90). The target is ≤ 5% of the weekly meter per release, deploy included, unless Alexander sets another; the daily-window rule (14% finish, 7% step down) is in `~/.claude/CLAUDE.md`'s "Usage and budget", not repeated here. A project's `.claude/kit.json` `budgets` are its own measured numbers, written by `future-ted` from `node ${CLAUDE_PLUGIN_ROOT}/scripts/budgets-derive.mjs --write` (per role the 90th percentile of the last releases' runs ×1.3, capped at the ceiling but for the rows above it); a project whose kit.json still has old rows (the 45M `the-playbook`, retired roles) gets them rewritten that way. The PR's budget table (agent, step, budget, used, stopped by Hank) is `node ${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs --budget-table <session id>`.

`the-protagonist` is a session (the chain's conductor), never a spawned agent, so Hank has no budget for it; its usage is read from its session.

Screenshot counts: `web-shooters`' "Shot counts" (one rule for builders, QA, the Bengan Boys, darth-vader and mosbius). Hank enforces the caps from the hook; change them in `web-shooters` and the hook together.

**A role that overruns in two releases gets its route changed** (a cheaper model, smaller steps, or a fresh agent per piece), written into this skill by `future-ted` from the PR's budget rows.
- `jeff-winger` (Burrow V0.12.1 E4, V0.12.2 S3a, V0.14 E1 and R0, each stopped by Hank at its tag): one step per spawn, never a reused agent, and a step that removes a component (its knip chain) sends the removal as its own order first; ticking the PR's boxes stays the navigator's (`gh pr edit` stopped E1). Since Burrow V1.2 (V1.1 8.5M of 5M, V1.2 D7 19.1M of 15M): a page-sized step whose page brings its own data (a Dev HQ page: a table or feed plus the sheet that shows it) goes as two orders, the data first, then the sheet, or a fresh agent per piece.
- `jesse-pinkman` (Burrow V0.14.3 Q0a 7.1M of 7M; V0.14.4 three taps in one order, 6.9M of 4M): one tap or one component a spawn; three taps in one step are three orders (Routing table, Build). Since Burrow V1.1 (60 turns on two small steps with shots): one step an order when the step takes shots.
- `saul-goodman` (Burrow V1.1 12.3M of 12M; V1.2 D8 20.3M of 15M): the same cut as `jeff-winger`'s: a page-sized step with its own data is two orders, the data and the sheet, or a fresh agent per piece; never a reused agent across the two.
- `troy-and-abed` (Burrow V0.16 shell 12.3M of 12M; V1.1 N8b 11.6M of 10M and C8 15.3M of 15M): one step per spawn, never a reused agent, and a scroll or gesture step (a long list that scrolls, a pinch) is cut in two at `/inception`: the render, then the gesture with its frame proof.

**Sizing `the-playbook`** (Burrow V0.14.4): its new-Claude-function steps ran 1.3 to 2× their tags (11a 13.6M of 8M, 18 16.1M of 8M, three functions in one order 10.4M of 5M) while its migration-only steps landed under. A new function with its prompt, fixtures, tests and a live run sizes ≈ 12M, one function an order.

## Escalation

- An agent that fails twice at its step goes one model up (Haiku → Sonnet → Opus → Fable), with the previous attempt's report in the new order so it doesn't start from nothing; after the hard part, back down.
- Opus failing twice goes to an Opus builder at xhigh with both earlier reports in its order for a bug, or up the senior ladder for a decision.
- xhigh or max only where a mistake is expensive (production, stubborn bugs, a senior's decision). Fable only within the star limit.
- `captain-call` notes each escalation in the PR's "Notes for review".

## Seniors

The kit ships no senior adviser. For `captain-call` the ladder is the project's senior adviser, when it has one (Opus, max, adviser only: no reviews, deploy-plan reads or verdicts; Alexander, 30 Sep: "just supposed to be the senior adviser for the navigator"), then Alexander. **With `fable`** (a Fable navigator on a release whose mistakes spread) it goes straight to Alexander with the navigator's own recommendation; he decides (Alexander, 29 Sep, 30 Sep). A senior asked for a decision doesn't count against `stars=` (it stands in for a ping, not a worker), and every ping names the senior it asked. Person-only items (secrets, the Keychain, dashboards, production) skip the seniors and go straight to Alexander.

**In a chain link** nobody is there to ping, so a call goes straight to `three-eyed-raven`, which decides and logs it in the chain log for `/memento` (Alexander, 2 Oct: "raven alone"); its order carries the navigator's question, the options and its recommendation, and what the plan, `CLAUDE.md` and the roadmap say (the raven decides even when one is missing, and names it). Not a star. Taste, drawn things and anything on production never go to it: a taste pick parks as `TASTE WAIT` for `/memento`. Hard stops are the same in every allowance and never a senior's call.

A senior is read-only. The order gives it the question, the options, the relevant files and what the roadmap and `CLAUDE.md` say. Its answer and the choice go in the PR under "Decided on the way".

## Stars

A star is a Fable worker: `heisenberg`, `mosbius-designs` on Fable, or any builder escalated to Fable (a senior asked for a decision is not one; see Seniors). Fable moves the meter far more than its token share, so they're rationed:

- `stars=1` per release session by default; `/captain-call <version> stars=N` overrides it; `quick` sets 0.
- `captain-call` keeps the count in the PR body ("Stars used: 1/1") and never goes over it without a ping.
- A Fable navigator isn't a star; that's the session mode. The big releases are `/captain-call <version> fable allowance=high planner=dom-cobb pick=me stars=3` (the skill's "Arguments for the big release").

## Overrides

`/captain-call <version> <role>=<model>...` targets specific roles for the whole run, on top of the routing table above, e.g. `/captain-call 2.9 opus designer=fable`, `builder=opus`, `qa=quick`, `reviewer=opus`, `db=xhigh`; plain words work too ("fable designer"). `captain-call` applies each override wherever that role is spawned and lists them in the PR's first lines. `designer=fable` reaches only drawn things and steps marked important design (see Design). A Fable override counts against `stars` (raise it to fit if needed, and say so in the PR). The same `role=model` form typed in chat mid-release ("from now on builder=opus") applies for the rest of the run, same rules.

`pick=me|designer|navigator` says who picks between a designer's options. Default is `pick=designer`: it picks itself and says why, whichever model it runs on, except **drawn things and taste picks (icons, logos, a page's look), where the default is `pick=me`** (Alexander: the designer's pick was overturned twice); under away, overnight or in a chain link, `/superlab`'s step 5 is the rule: end the turn on a `Next:` line; a woken turn more than 2 hours after the ping with no answer builds the designer's (or `heisenberg`'s) pick with the runner-up ready as a one-commit swap; the gallery stays open for him. `pick=me` pings Alexander with the gallery; `pick=navigator` has `captain-call` pick from the designer's recommendation instead. `pick=me` under `/ill-be-back` waits until the end and the rest of the run builds around it. Either way, the gallery link and who picked go in the PR's "Decided on the way", so a pick can be overturned.

## Speed settings

An argument to `/captain-call` (default normal); `/night-watch <version>` is slow plus away.

| Speed | What changes |
|---|---|
| **slow** | Overnight and `/night-watch`. One agent at a time. It spends the time on checking, not tokens on a bigger model (as `/night-watch` says): the routing table's models hold; `bengt-johansson` adds 1440 on marked layout work; the second design reviewer runs; the Opus xhigh escalation after one failed attempt instead of two. |
| **normal** | This table as written; how many agents run side by side is lesson `[parallel]`'s rule, not set here. One editing agent per lane, one browser-using agent per tab (each QA agent opens its own with `tabs_create` and closes it), one migration writer at a time, Fable within `stars=`. |
| **quick** | Decide and move on. Agents side by side as normal (`[parallel]`). Sonnet wherever the spec is clear; builders check as text only; `bengt-johansson` only on flows (sign-up, waitlist, access, links); no `mosbius-designs` unless a step is marked important design; `stars=0`. |

**Pace to the 5-hour window** (`[parallel]` in lessons.md): `get_usage` before each batch of spawns; how many at once is the `[parallel]` rule whatever the speed; none started above 85% of the 5-hour window.

Parallel saves wall-clock, not tokens: Hank's per-agent budgets are the same at every speed, and side-by-side agents still keep to separate lanes and tabs.

Speed only sets how many agents run at once; how careful and how costly the run is belongs to `allowance=` (below). Neither changes the safety rules: the backup before a production database change, the guard hook, green checks before a commit.

## Allowances

`allowance=cheap|normal|high|unlimited` (default normal) sets how careful and how costly a run is; `speed=` only sets how many agents run side by side (wall-clock). It is an argument to `/captain-call` and `/night-watch` (the big release passes `high`). Alexander, 29 Sep: "four allowances modes for usage and effort etc … Cheap, normal, High, and no limit".

| | cheap | normal | high | unlimited |
|---|---|---|---|---|
| Budget tags | ×0.6 | ×1 | ×1.5, at or under the 15M ceiling | as normal, with a note that Hank's limits are not enforced by the tag |
| Meter target per release | 3% | 5% | 8% | none, reported |
| Model floor | Sonnet wherever the spec is clear | the routing table | Opus for every build step in code, not docs or the PR writer | a Fable navigator allowed |
| Efforts | medium | as in the table | one step up; `the-playbook` xhigh on policies | as high as fits |
| Stars | 0 | 1 | 2 | no cap |
| Checking | one reviewer; QA on qa-marked features only | the table | `daredevil` runs in every release with UI, whatever the allowance; QA on every feature; `/darth-vader`'s matrix before the PR | as high |
| Seniors | only when stuck | as in Seniors | the project's senior adviser, when it has one, reads every plan | on every doubt |

- Hank can't read this table: the navigator scales every `[budget …]` tag by the multiplier when it writes the tag. Unlimited keeps the tags (with the note) and Hank's role defaults, and the run logs usage without stopping for it.
- The targets are reported, not enforced: the navigator reads the meter at the start and after the draft PR, as in `captain-call`'s plan step.
- `stars=` still overrides the row, as do `<role>=<model>` overrides.
- **Production safety is never an allowance:** the guard, the backup before a database change, green checks and the hard stops are the same in all four.

## Deciding or asking

Every agent, whatever its model: decide it yourself when it is reversible and inside the spec, and say what you decided in the report. Send scope, taste, money and production back to the navigator instead of guessing. An option that adds scope is offered as the next release, never "new scope for this one". At most two review rounds on the same code per release (the rest is the next release's first job), and a prompt forecast to Alexander before any job on locked files. Saving tokens never lowers the quality bar (`kissochbajslowski`'s quality section); a step that can't meet it within budget asks for more budget. `[live-check]` A live run the plan needs from Alexander (a look in the signed-in app, a real device, a send to his phone) is a human step afterwards, before any publish it gates, never a step a link waits on.

## The navigator stays lean

`taste.md` (the kit's and the project's), `library.md` and this skill are read by the sections the order names (`grep -n '^## '`, then those ranges), never whole; a designer brief reads the topic's rows and the Leans section. The navigator never reads a file or page over ~20k characters itself: `lorenzo-von-matterhorn` or `c-3po` reads it and returns the part it needs. The roadmap page is read by `c-3po` and `the-trail`, never in full by the navigator. A QA finding goes to its fixer in one order with file:line, not relayed piecemeal. `c-3po` drafts the PR description before `its-a-trap` runs. The navigator's own budget is ≈ 2.2M a step (`[sizing]`: 33 steps ≈ 73M in 3.1.1); `c-3po` fills the PR body's Budget and Usage tables, not the navigator. The navigator takes no screenshots and runs no probes itself (a headless paint or scroll probe, a Lighthouse median, a re-check after a fix): each goes to `romeo-olsson` with the script, the port and what passes, and comes back as a line of numbers. portfolio 0.3's navigator was 55% of the release at the draft, much of it its own shots and probes. A talk session ends its turn instead of polling, and a wait on Vercel is one script call, never a loop.
