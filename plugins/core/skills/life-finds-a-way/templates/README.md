# Templates for /life-finds-a-way

The skill copies these into a new project, filling the `{{placeholders}}`. Names inside this folder are renamed on purpose (the production guard refuses certain real paths at any depth), so the skill writes each file to its real target:

| Template | Written to |
|---|---|
| `CLAUDE.md` | `CLAUDE.md` |
| `README.skeleton.md` | `README.md` |
| `dotclaude/kit.json` | `.claude/kit.json` |
| `dotclaude/lessons.md` | `.claude/lessons.md` |
| `dotclaude/launch.json` | `.claude/launch.json` (UI projects only) |
| `dotclaude/settings.allow.core.json` | merged into `.claude/settings.json` (`permissions.allow`); always |
| `dotclaude/settings.allow.release.json` | merged the same way, if the release pack is on |
| `dotclaude/settings.allow.design.json` | merged the same way, if the design pack is on |
| `dotclaude/settings.allow.database.json` | merged the same way, if the database pack is on |
| `taste-seed.md` | `.claude/taste.md` (UI projects only) |
| `roadmap.md` | `{{plans}}{{project.name}}/roadmap.md` |
| `V0.1.md` | `{{plans}}{{project.name}}/V0.1.md` |
| `docs/decisions/README.md` | `docs/decisions/README.md` |
| `docs/decisions/0001-start.md` | `docs/decisions/0001-start.md` |
| `check.mjs` | `scripts/check.mjs` |
| `check.sh.txt` | `scripts/check.sh` (make it executable) |
| `gitignore.txt` | `.gitignore` |
| `env.example.txt` | `.env.example` |
| `github/workflows/ci.yml` | `.github/workflows/ci.yml` |
| `github/dependabot.yml` | `.github/dependabot.yml` |
| `fixtures/toy-brief.md` | not copied: a canned brief for a dry run of the skill |

`.json` templates keep their placeholders bare (`"devPort": {{project.devPort}}` is a number once filled). A line ending in `<!-- ui-only -->` is dev-server text: with no dev server the skill removes the whole line, and `kit.json` gets `"devPort": null`. `dependabot.yml` ships with the github-actions entry only; the commented npm entry is added once `package.json` exists. Text in `<!-- … -->` comments is guidance for the skill: replace or delete it when filling.

## Placeholders

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
