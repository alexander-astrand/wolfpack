# Templates for /life-finds-a-way

`fill.mjs` renders these into a project from one values file (`node fill.mjs <values.json> <project dir> --plans <plans><project>/`, or `--adopt` for an existing project: only missing files). Its `MAP` is the authority on targets; this table says the same in words. `fixtures/*.values.json` are complete value sets for a toy Node, Python and Other project. Names inside this folder are renamed on purpose (the production guard refuses certain real paths at any depth), so each file goes to its real target:

| Template | Written to |
|---|---|
| `CLAUDE.md` | `CLAUDE.md` |
| `README.skeleton.md` | `README.md` |
| `dotclaude/kit.json` | `.claude/kit.json` |
| `dotclaude/lessons.md` | `.claude/lessons.md` |
| `dotclaude/launch.json` | `.claude/launch.json` (design pack, Node, with a dev server) |
| `dotclaude/settings.allow.core.json` | merged into `.claude/settings.json` (`permissions.allow`); always |
| `dotclaude/settings.allow.release.json` | merged the same way, if the release pack is on |
| `dotclaude/settings.allow.design.json` | merged the same way, if the design pack is on |
| `dotclaude/settings.allow.database.json` | merged the same way, if the database pack is on |
| `dotclaude/settings.allow.node.json` | merged the same way, on a Node stack (the npm lines) |
| `dotclaude/settings.allow.python.json` | merged the same way, on a Python stack (python3, ruff, pytest, `.venv/bin/`); Other has none |
| `taste-seed.md` | `.claude/taste.md` (UI projects only) |
| `roadmap.md` | `{{plans}}{{project.name}}/roadmap.md` |
| `V0.1.md` | `{{plans}}{{project.name}}/V0.1.md` |
| `docs/decisions/README.md` | `docs/decisions/README.md` |
| `docs/decisions/0001-start.md` | `docs/decisions/0001-start.md` |
| `check.mjs` | `scripts/check.mjs` (Node only) |
| `check.sh.txt` | `scripts/check.sh`, executable: the one check entry on every stack |
| `gitignore.txt` | `.gitignore` |
| `env.example.txt` | `.env.example` |
| `github/workflows/ci.yml` | `.github/workflows/ci.yml` |
| `github/dependabot.yml` | `.github/dependabot.yml` |
| `fixtures/toy-brief.md` | not copied: a canned brief for a dry run of the skill |
| `fixtures/*.values.json`, `fill.mjs`, `fill.test.mjs` | not copied: the renderer, its toy values and its test |

The allow lists are never rendered: `node fill.mjs --allow <values.json>` prints the merged list (core, the packs, the stack) for the walkthrough's settings row.

**Stacks** (`stack`: `node`, `python` or `other`): text that differs per stack carries a marker, one rule everywhere. `<!-- stack:python -->` at a line's end keeps the line only for that stack (several: `stack:node,python`); the same marker alone on a line keeps everything up to `<!-- /stack -->`. Markers are stripped when filled. On Python, `scripts/check.sh` runs ruff and pytest when installed (the `.venv` first), and a missing tool prints one "skipped" line; on Other it is a TODO that prints "no checks yet: fill in scripts/check.sh". `node fill.mjs --detect <dir>` gives adopt's stack: `package.json` → node, `pyproject.toml` or `requirements.txt` → python, neither → other.

`.json` templates keep their placeholders bare (`"devPort": {{project.devPort}}` is a number once filled). A line ending in `<!-- ui-only -->` is dev-server text: with no dev server the skill removes the whole line, and `kit.json` gets `"devPort": null`. `dependabot.yml` ships with the github-actions entry only; the commented npm entry is added once `package.json` exists. Text in `<!-- … -->` comments is guidance for the skill: replace or delete it when filling.

## Placeholders

- `{{stack}}`: `node`, `python` or `other` (research's answer, or detected in adopt; never asked).
- `{{project.name}}`: the project's short lowercase name (folder, session titles, plans folder).
- `{{project.noun}}`: the word for one person who uses it (singular, lowercase).
- `{{project.summary}}`: one or two plain sentences on what it is.
- `{{project.devPort}}`: the dev server's port number, or `null` (bare, in `kit.json`) when there is no dev server.
- `{{plans}}`: the plans folder with a trailing slash (default `~/.claude/plans/`).
- `{{date}}`: today, `YYYY-MM-DD`.
- `{{roadmap}}`: `file` or `page`.
- `{{kit.version}}`: the installed Wolfpack kit's version.
- `{{refs.dev}}`, `{{refs.prod}}`: dev and production project refs; empty string when there's no database.
- `{{urls.prod}}`: the production URL; empty until there is one.
- `{{deployer}}`: the name allowed to deploy to production; empty when nothing deploys.
- `{{keychain.dev}}`, `{{keychain.prod}}`: Keychain item names (never values); empty when unused.
- `{{reviewer}}`: GitHub handle tagged on release PRs; empty for none.
- `{{brief.verbatim}}`: the person's own description from question zero, word for word.
- `{{release.name}}`, `{{release.theme}}`, `{{release.size}}`: the first release's name, its one theme, and S, M or L.
- `{{release.notin}}`: what the release leaves out and where it went.
- `{{part.name}}`, `{{part.tag}}`: one part of the project and its tag (Code, Cowork or Chat); repeat the line per part.
- `{{service.name}}`, `{{service.trigger}}`, `{{service.exit}}`: a service, the point it stops being free, the cheapest way out; repeat per service.
- `{{money.ceiling}}`: the most per month it may cost.
- `{{data.what}}`, `{{data.whose}}`: which personal data is kept, and whose it is.
- `{{park.trigger}}`: one park trigger in his words; repeat per trigger.
- `{{fire.stop}}`, `{{fire.keep}}`: what to stop and what to keep if parked.
- `{{rhythm}}`: how often and how long he works on it.
- `{{human.step}}`: one step only he can do before build; repeat per step.
- `{{count.yours}}`, `{{count.mine}}`: the receipt's counts of steps that are his and Claude's.
- `{{step.name}}`, `{{step.who}}`: one receipt row's step and "Yours" or "Mine".
- `{{v01.steps}}`: John Hammond's V0.1 step table (markdown: step · who builds · files · check · budget).
- `{{first.commit}}`: what the first commit holds and its subject line.
- `{{adr.context}}`, `{{adr.decision}}`, `{{adr.where}}`, `{{adr.consequences}}`: the four parts of `0001-start.md`.
- `{{theme.pick}}`, `{{density.pick}}`, `{{copy.pick}}`: the taste picks (dark-first or light-first; dense or roomy; sober or playful).
- `{{reason}}`: the reason he gave for a pick, in his words (once per pick line).
- `{{look.steal}}`, `{{look.never}}`: the app whose look he'd steal, and the one he'd never.
- `{{notyet.item}}`: one thing the README says isn't there yet; repeat per item.
