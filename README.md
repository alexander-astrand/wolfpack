# wolfpack

Our way of working with Claude Code, packaged as plugins. One session is the **navigator**: it talks with you, plans a release step by step and hands each step to a named specialist (a builder, a reviewer, a designer, a deployer), each on its own model and effort. Every job carries a token **budget** that a hook enforces, and a **production guard** stands between every agent and the production database: only the deployer gets through, and only with a person's yes.

The agents have names and voices (`captain-call` the navigator, `chris-de-kok` a builder, `the-playbook` the database engineer, Hank the budget hook). It's how we tell them apart in chat, in PRs and in the usage tables.

Two pages describe the whole kit and are the same for every project, refreshed from the kit's files at each kit release: the [Wolfpack Command Deck](https://claude.ai/artifact/PVFEK3fFPJ2bhYxMDqbgjJ) (every command, its options and when to use it) and the [Wolfpack Agent Team](https://claude.ai/artifact/FYfMpboL4tv4bGYBTdPQEg) (who does what, the hooks, how a release flows).

## Install

```
claude plugin marketplace add alexander-astrand/wolfpack
claude plugin install wolfpack@wolfpack --scope project
```

`wolfpack` is a bundle: it has no components of its own and depends on the four plugins below, which Claude Code installs with it at the same scope. To pick plugins one by one instead:

```
claude plugin install core@wolfpack --scope project
claude plugin install release@wolfpack --scope project
claude plugin install design@wolfpack --scope project
claude plugin install database@wolfpack --scope project
```

`core` is the base the others build on. `database` is for Supabase projects; leave it out otherwise.

Five agents run on `model: fable` (`heisenberg`, `barney-stinson`, `dom-cobb`, `mace-windu`, `three-eyed-raven`) and need a plan that has that model.

**Kit edits:** a kit edit is made in a fresh worktree off the kit's `main`, committed on a branch with the project named in the subject (`... (Hutzup 3.3.3)`) and merged by PR, never in a checkout a session loads; projects see the change on their next session, once `scripts/live-sync.sh` has moved the loaded checkout onto `main`. General lessons live in `core/lessons.md` and Alexander's general taste in `design/taste.md`; each project's `.claude/lessons.md` and `.claude/taste.md` keep only its own, and readers read both.

Source of truth: the kit's `main` on GitHub. Every project loads `<kit>` (`~/wolfpack-live` on Alexander's machines, detached at `origin/main`), so a merged change reaches them all on their next session after `scripts/live-sync.sh` runs.

**Keeping the live checkout level:** `scripts/live-sync.sh` fetches and detaches `~/wolfpack-live` (or `$1`) onto `origin/main`, and stops with the changes printed if the checkout holds work that differs from `main`. On the Air, `scripts/launchd/xyz.astrand.wolfpack-live-sync.plist` runs it every 30 minutes (log: `~/Library/Logs/wolfpack-live-sync.log`); after the merge, load it once with `launchctl bootstrap gui/$(id -u) ~/wolfpack-live/scripts/launchd/xyz.astrand.wolfpack-live-sync.plist`.

`scripts/user-commands.mjs` lists the skills marked `disable-model-invocation: true` and, with `--write`, rewrites the marked block under "Commands only I type" in `~/.claude/CLAUDE.md`; `future-ted` runs it when a skill is added or renamed.

## Start a project

1. In a new, empty folder, install the two base plugins at project scope:

   ```
   claude plugin install core@wolfpack --scope project
   claude plugin install release@wolfpack --scope project
   ```

2. Run `/life-finds-a-way <name>` (add `small`, `medium` or `large` to skip the size pick; `adopt` brings an existing folder in). It asks for the idea in your words and three picks, shows a "Here's what I think you're building" card, then researches, plans V0.1 and writes the skeleton with its `.claude/kit.json`. The setup walkthrough asks one yes per step that touches anything outside your machine.

   The skeleton is rendered by `templates/fill.mjs` from one values file, for a Node, Python or other stack: one `scripts/check.sh` (the npm scripts; `ruff` and `pytest` when installed; or a TODO to fill in), matching CI, Dependabot and allow lines. `adopt` detects the stack (`package.json`, `pyproject.toml` or `requirements.txt`, else other) and writes only the files that are missing.
3. Add `design` (anything with a screen) and `database` (Supabase) after `.claude/kit.json` exists, when the card named them:

   ```
   claude plugin install design@wolfpack --scope project
   claude plugin install database@wolfpack --scope project
   ```

## The plugins

### core
The shared crew and the habits every project follows: planning before a big release, the wrap-up afterwards, web research, docs, the roadmap and the daily routines. `norms.md` (how questions, human steps and session names work) and `lessons.md` (tuning numbers) are read by the skills.

- Agents: `doc-brown`, `dr-house`, `john-hammond`, `lorenzo-von-matterhorn`, `romeo-olsson`
- Skills: `88-mph`, `badger`, `beam-me-up`, `cloud-city`, `dependabot-report`, `don-draper`, `future-ted`, `groundhog-day`, `inception`, `legendary`, `leon`, `life-finds-a-way`, `memento`, `oracle`, `previously-on`, `scrooge`, `tesseract`, `the-trail`, `war-room`, `watson`, `wilson`

### release
A release end to end: `/captain-call <version>` (with `fable allowance=high planner=dom-cobb pick=me stars=3` for the big ones) plans it, spawns the builders, reviews, opens the draft PR and pings you. Your merge go is one word, `/one-ring <version or PR number>`, typed in any session of the project: that session merges and deploys it to the end, from any branch, and fixes what stops it on the way (`docs/decisions/0001-one-word-deploy.md`; `/skinny-pete` only for a manual or broken case), and `/cattle-drive` runs release and deploy on one yes. Hank (`hooks/budget-cap.mjs`) holds every agent to the budget in its task description; Skyler (`scripts/usage.mjs`) counts the tokens.

- Agents: `admiral-ackbar`, `ahmed-och-ahmed`, `barney-stinson`, `c-3po`, `chris-de-kok`, `dom-cobb`, `jeff-winger`, `jesse-pinkman`, `kissochbajslowski`, `mace-windu`, `mike-ehrmantraut`, `r2-d2`, `saul-goodman`, `three-eyed-raven`, `troy-and-abed`
- Skills: `avengers-assemble`, `black-box`, `captain-call`, `car-wash`, `carousel`, `cattle-drive`, `ill-be-back`, `its-a-trap`, `jedi-council`, `kids-im-home`, `night-watch`, `no-half-measures`, `oceans-eleven`, `one-ring`, `skinny-pete`, `skyler`, `special-delivery`, `the-tower`, `you-shall-not-pass`

### design
Briefs, mock-ups and QA for anything the app shows: browser checks at phone and desktop widths in both themes, an accessibility review, and a full QA pass. It also carries `voice-card.md` (the shape of every agent's `## Voice` card) and `taste-template.md` (start your project's `.claude/taste.md` from it).

- Agents: `bengt-johansson`, `daredevil`, `heisenberg`, `magnus-wislander`, `mosbius-designs`, `staffan-olsson`, `stefan-lovgren`, `tomas-svensson`
- Skills: `darth-vader`, `heisenberg`, `spidey-sense`, `superlab`

### database
For Supabase projects. The production guard (the Slap Bet Commissioner, `hooks/guard-production.mjs`) refuses any path to production except the deployer's, and asks a person before each change. `the-playbook` writes migrations, policies and functions; the project's own deployer deploys; `bro-code` writes SQL tests. `database-artifacts.md` lists what the pack expects a project to carry.

- Agents: `the-playbook`
- Skills: `bro-code`

A project that registers its own copy of a hook in `.claude/settings.json` keeps it; the kit's copy steps aside (Hutzup 3.3.3). That holds for the guard, Hank and the denied-call log (`hooks/step-aside.mjs`): only when the project's settings register its copy under `.claude/hooks/` for every matcher the kit uses and the file is there; anything else, including a settings file that won't parse, runs the kit's copy.

### Per project: the deployer and the senior adviser
A deployer (`ranjit`, named by `deployer` in `.claude/kit.json`) and a senior adviser are per project: they carry the project's own people, refs and history, so each project keeps its own in `.claude/agents/` (the guard treats both files as frozen). `/life-finds-a-way` writes `ranjit` from the kit's template (`plugins/database/templates/ranjit.md`, or `ranjit-no-database.md` for `production: "on-merge"`). Every merge and deploy is `/one-ring` in the session he types it in, deployer or not: the database plugin's deploy script runs the backup, migrations, functions and merge itself, no agent. `ranjit` runs a `/cattle-drive` chain's deploy leg and `/skinny-pete`'s manual cases.

## What your project provides: `.claude/kit.json`

The plugins carry placeholders; your values live in your project's `.claude/kit.json`. Every key the plugins read:

```json
{
  "project": { "name": "myapp", "noun": "member", "devPort": 3000 },
  "refs": { "dev": "<dev project ref>", "prod": "<production project ref>" },
  "urls": { "prod": "https://myapp.example.com" },
  "deployer": "ranjit",
  "keychain": { "dev": "<keychain item, dev db url>", "prod": "<keychain item, prod db url>", "vercelBypass": "<keychain item, Vercel protection-bypass secret; optional>" },
  "ci": { "workflow": ".github/workflows/ci.yml", "jobs": ["Checks"] },
  "reviewer": "<github handle to tag on release PRs>",
  "conventions": "scripts/conventions.sh",
  "budgets": { "chris-de-kok": "25M" },
  "plans": "~/.claude/plans/myapp/",
  "roadmap": "file",
  "kit": { "version": "1.1.0" }
}
```

- `project`: the name (session titles, notes), the word for a member, and the dev server's port.
- `refs`, `urls.prod`, `deployer`, `keychain`: read by the production guard. A missing file or key fails closed (everything counts as production, nobody is the deployer). The guard also treats `kit.json` as frozen: a change to it asks a person. A chain's tap hashes only its trusted keys (`refs`, `keychain`, `urls`, `deployer`, `backupRoot`, `ci`, key order ignored), so a `budgets` or `pages` edit mid-chain keeps the chain covered.
- `production`: `"none"` for a project that ships nowhere (job-hunt: no database, no hosting). Merging then deploys nothing, so `/one-ring` only merges, in the session you typed it in, with no deployer, once the PR is out of draft, MERGEABLE and green on `ci.jobs`. It counts only with `refs.prod`, `urls.prod` and `deployer` all empty; any of them set, or the key missing, keeps production and ranjit. Leave it out in a project with production.
- `ci`: the workflow file (named `CI`) and its jobs' `name:`s, which the one-tap arm and the guarded merge wait for, each green by name (Vercel's checks alone don't count). Missing or malformed `jobs` fails closed: the arm refuses. A hook test keeps `jobs` in step with the workflow file.
- `reviewer`: who gets tagged on release PRs (a notification, nothing waits for them).
- `conventions`: your conventions script, which the builders and the review run through `npm run lint`.
- `budgets`: per-agent overrides of Hank's own table (the `oceans-eleven` skill's Budgets); leave it empty to use the table. A `"*"` row caps every untagged role, builders included, so the template ships none.
- `plans`: the folder for release plans (`<plans>V<version>.md`) and their notes. Default `~/.claude/plans/`; a project made by `/life-finds-a-way` sets `~/.claude/plans/<project>/`, so two projects' `V0.1.md` never collide. In 1.1.0 only `captain-call` (then `maverick`), `inception`, `future-ted`, `its-a-trap`, `c-3po` and `badger` read it; the other readers and the guard still assume `~/.claude/plans/` (they follow in the next kit release).
- `roadmap`: `page` (the default) keeps the roadmap on a shared page, edited through `the-trail`; `file` keeps it in `<plans>roadmap.md`, edited in place.
- `kit.version`: the kit release the project was set up with, written by `/life-finds-a-way`; its hand-off shows it next to `claude plugin marketplace update wolfpack`, the line that fetches a newer one.

Never put keys, passwords or tokens in it: `keychain` names Keychain items, it doesn't hold their values.

## Checking the kit

```
node scripts/check.mjs
```

Checks every plugin's manifest, the agents' and skills' frontmatter, the hooks (a hook may only run files inside its own plugin), this marketplace's sources and versions, and that no secret or project value slipped in. The hook tests run on Vitest with `vitest.config.mjs`:

```
npx vitest run --config vitest.config.mjs
```

`claude plugin validate .` is the final word on the manifests.

Eval cases are only for skills the model may invoke (`[evals]`): a skill with `disable-model-invocation: true` gets no trigger case, since nothing but its slash command can start it.

## Publish the kit

The kit is its own repo, so publishing is the merge of its release PR to `main`. The merge go is `/one-ring <PR number>`, typed in any kit session: the kit's own `.claude/kit.json` says `"production": "none"`, so it only merges (CI's `test` job green, squash). After the merge, `scripts/live-sync.sh` moves `~/wolfpack-live` (the checkout every session loads) onto `origin/main`; on the Air the launchd job above does the same every 30 minutes, and `future-ted` runs it at a kit wrap. A kit release bumps the plugin versions it changed (`scripts/bump.mjs`) and puts the one `live-sync.sh` line in its PR's "Human steps afterwards" (`carousel` does it).

## Full auto from the installed kit (database 1.1.0)

- **The database plugin's scripts are copied, not run in place.** `prod-db.sh`, `full-auto.sh` and `chain-cover.mjs` ship in the plugin and a person copies them into the project's `scripts/` once; the plugin's README ("Install the scripts") has the line and the `kit.json` keys they read. The guard finds the project through `CLAUDE_PROJECT_DIR`, so `/cattle-drive`'s armed run works from an installed plugin.
- **The arm's CI job names come from `kit.json`** (`ci.jobs`, since 2.14.9.2): the starter's CI names its one job `Checks` and its `kit.json` says so.
