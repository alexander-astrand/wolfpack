# wolfpack

Our way of working with Claude Code, packaged as plugins. One session is the **navigator**: it talks with you, plans a release step by step and hands each step to a named specialist (a builder, a reviewer, a designer, a deployer), each on its own model and effort. Every job carries a token **budget** that a hook enforces, and a **production guard** stands between every agent and the production database: only the deployer gets through, and only with a person's yes.

The agents have names and voices (`maverick` the navigator, `chris-de-kok` a builder, `ranjit` the deployer, Hank the budget hook). It's how we tell them apart in chat, in PRs and in the usage tables.

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

Six agents run on `model: fable` (`farbror-vattenmelon`, `heisenberg`, `barney-stinson`, `dom-cobb`, `mace-windu`, `three-eyed-raven`) and need a plan that has that model.

Source of truth until Hutzup switches to the installed plugin: Hutzup's `.claude/`; the kit copies are synced by hand (the guard copy differs by the kit.json reads).

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

- Agents: `boba-fett`, `doc-brown`, `dr-house`, `farbror-vattenmelon`, `john-hammond`, `lorenzo-von-matterhorn`, `marty-mcfly`, `romeo-olsson`, `yoda`
- Skills: `88-mph`, `badger`, `beam-me-up`, `car-wash`, `cloud-city`, `dependabot-report`, `don-draper`, `future-ted`, `groundhog-day`, `inception`, `legendary`, `leon`, `life-finds-a-way`, `memento`, `oracle`, `previously-on`, `skyler`, `tesseract`, `the-trail`, `war-room`, `watson`

### release
A release end to end: `/maverick <version>` (or `/captain-call` for the big ones) plans it, spawns the builders, reviews, opens the draft PR and pings you. The deploy skills take it to production, and `/cattle-drive` runs release and deploy on one yes. Hank (`hooks/budget-cap.mjs`) holds every agent to the budget in its task description; Skyler (`scripts/usage.mjs`) counts the tokens.

- Agents: `admiral-ackbar`, `ahmed-och-ahmed`, `barney-stinson`, `c-3po`, `chris-de-kok`, `dom-cobb`, `jeff-winger`, `jesse-pinkman`, `kissochbajslowski`, `mace-windu`, `mike-ehrmantraut`, `r2-d2`, `saul-goodman`, `three-eyed-raven`, `troy-and-abed`
- Skills: `black-box`, `captain-call`, `carousel`, `cattle-drive`, `ill-be-back`, `its-a-trap`, `jedi-council`, `kids-im-home`, `maverick`, `night-watch`, `no-half-measures`, `oceans-eleven`, `one-ring`, `skinny-pete`, `the-tower`, `you-shall-not-pass`

### design
Briefs, mock-ups and QA for anything the app shows: browser checks at phone and desktop widths in both themes, an accessibility review, and a full QA pass. It also carries `voice-card.md` (the shape of every agent's `## Voice` card) and `taste-template.md` (start your project's `.claude/taste.md` from it).

- Agents: `bengt-johansson`, `daredevil`, `heisenberg`, `magnus-wislander`, `mosbius-designs`, `staffan-olsson`, `stefan-lovgren`, `tomas-svensson`
- Skills: `darth-vader`, `heisenberg`, `spidey-sense`, `superlab`

### database
For Supabase projects. The production guard (the Slap Bet Commissioner, `hooks/guard-production.mjs`) refuses any path to production except the deployer's, and asks a person before each change. `the-playbook` writes migrations, policies and functions; `ranjit` deploys; `bro-code` writes SQL tests. `database-artifacts.md` lists what the pack expects a project to carry.

- Agents: `ranjit`, `the-playbook`
- Skills: `bro-code`

## What your project provides: `.claude/kit.json`

The plugins carry placeholders; your values live in your project's `.claude/kit.json`. Every key the plugins read:

```json
{
  "project": { "name": "myapp", "noun": "member", "devPort": 3000 },
  "refs": { "dev": "<dev project ref>", "prod": "<production project ref>" },
  "urls": { "prod": "https://myapp.example.com" },
  "deployer": "ranjit",
  "keychain": { "dev": "<keychain item, dev db url>", "prod": "<keychain item, prod db url>" },
  "reviewer": "<github handle to tag on release PRs>",
  "conventions": "scripts/conventions.sh",
  "names": { "<old skill name>": "<new skill name>" },
  "budgets": { "chris-de-kok": "25M", "*": "15M" },
  "plans": "~/.claude/plans/myapp/",
  "roadmap": "file",
  "kit": { "version": "1.1.0" }
}
```

- `project`: the name (session titles, notes), the word for a member, and the dev server's port.
- `refs`, `urls.prod`, `deployer`, `keychain`: read by the production guard. A missing file or key fails closed (everything counts as production, nobody is the deployer). The guard also treats `kit.json` as frozen: a change to it asks a person.
- `reviewer`: who gets tagged on release PRs (a notification, nothing waits for them).
- `conventions`: your conventions script, which the builders and the review run through `npm run lint`.
- `names`: the project's old command names mapped to the kit's (e.g. a project's own `/check` to `you-shall-not-pass`). A record for people and project tooling; no plugin file in 1.0.0 reads it.
- `budgets`: Hank's default budget per agent, `"*"` for the rest. Without the file Hank falls back to its own table.
- `plans`: the folder for release plans (`<plans>V<version>.md`) and their notes. Default `~/.claude/plans/`; a project made by `/life-finds-a-way` sets `~/.claude/plans/<project>/`, so two projects' `V0.1.md` never collide. In 1.1.0 only `maverick`, `captain-call`, `inception`, `future-ted`, `its-a-trap`, `c-3po` and `badger` read it; the other readers and the guard still assume `~/.claude/plans/` (they follow in the next kit release).
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

The kit is built under `kit/` in its source repo and published to this marketplace with a subtree split, after the release that changed it is merged. One command at a time, from the source repo's root; `<release>` is the source repo's release, `<plugin>--v<x.y.z>` one tag per plugin whose version the release bumped.

1. `git fetch origin main`
2. `git subtree split --prefix kit origin/main -b wolfpack-<release>` (from the merged `main`, never the release branch: the squash merge is what the marketplace carries)
3. `git tag <plugin>--v<x.y.z> wolfpack-<release>`, once per bumped plugin (tags go on the split branch, never on the source repo's own commits)
4. `git push git@github.com:alexander-astrand/wolfpack.git wolfpack-<release>:main` (no force: if it isn't a fast-forward of the last publish, stop and say so)
5. `git push git@github.com:alexander-astrand/wolfpack.git <every tag from step 3>`
6. `claude plugin marketplace update wolfpack`
7. In each folder that installed a bumped plugin: `claude plugin update <plugin>@wolfpack --scope <project|user>`. Step 6 only refreshes the marketplace; an installed plugin stays on its old version until this runs.

A release that changes the kit copies these steps into its PR's "Human steps afterwards", filled in, one command per line (`carousel` does it).

## Full auto from the installed kit (database 1.1.0)

- **The database plugin's scripts are copied, not run in place.** `prod-db.sh`, `full-auto.sh` and `chain-cover.mjs` ship in the plugin and a person copies them into the project's `scripts/` once; the plugin's README ("Install the scripts") has the line and the `kit.json` keys they read. The guard finds the project through `CLAUDE_PROJECT_DIR`, so `/cattle-drive`'s armed run works from an installed plugin.
- **Known gap: the arm's CI job names are fixed.** "CI green by job name" checks a workflow `CI` with the jobs `Type-check, lint, test, knip and build` and `Database: migrations from scratch + SQL tests` (`CI_JOBS` in `hooks/production-steps.mjs`); the starter's CI doesn't name them so. Until the names come from `kit.json` (a guard change with its own tap, next release), a project that wants the one-tap arm names its CI jobs exactly that way.
