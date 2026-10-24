# database

The Supabase pack: the production guard (the Slap Bet Commissioner) in `hooks/`, `the-playbook` and `bro-code`. The deployer agent is the project's own (in its `.claude/agents/`, named by `deployer` in `.claude/kit.json`). `database-artifacts.md` lists what a project using it carries. The guard finds the project through `CLAUDE_PROJECT_DIR` and reads its values from `.claude/kit.json`.

## The one-word deploy (kit 1.6)

`/one-ring <version or PR number>`, typed by Alexander in any session of a project, runs this plugin's own `scripts/full-auto.sh deploy <same argument>` (never the project's copy, so `live-sync` keeps it current), and `hooks/deploy.mjs` does the rest: out of draft, the branch up to date, CI green on its head, a throwaway checkout of that head with main's `prod-db.sh` and `kit.json`, the backup (Docker started, three tries), the dry run equal to the PR's new migration files, the push, the PR's `prod-db.sh setting` steps, the functions it touches (`scripts/functions-touched.mjs` when the project has one), the squash merge of exactly the head CI passed, the host's deploy and a smoke. Run again after a stop, it picks up where it stopped. The guard lets that one call through when this session's transcript holds his typed `/one-ring` with the same argument from the last 12 hours (`hooks/one-ring-go.mjs`), and asks him once otherwise. Why, and what a session may fix on production on the way: `docs/decisions/0001-one-word-deploy.md` in the kit.

## What the guard logs and allows (kit 1.7)

Every `ask` and `deny` the guard decides goes to the project's `.claude/guard-decisions.log` with its reason, and every Auto mode refusal to `.claude/permission-denied.log` (`hooks/denied-log.mjs`). Both are tab-separated in the same column order, written in `denied-log.mjs`'s header. `node <plugin>/hooks/denied-log.mjs --summary [--since <YYYY-MM-DD>] [--dir <project>]` groups the repeats from both, marks each `guard` or `classifier`, and prints a `settings.json` allow line for the classifier's dev-only repeats. The guard's read allowlist takes `git show|diff|cat-file|ls-tree|rev-parse|status|log` and `grep`, `rg` and `wc` on the repo's own files (not `.claude/`, `.git/` or `.env*`), so those skip the classifier.

## Install the scripts

The three production scripts ship in this plugin's `scripts/` folder. A person copies them into the project's `scripts/` once; the guard never lets an agent copy them, and a `/cattle-drive` preflight stops until they are there. From the project root:

```bash
cp "$(ls -d ~/.claude/plugins/cache/wolfpack/database/*/ | sort -V | tail -1)"scripts/{prod-db.sh,full-auto.sh,chain-cover.mjs} scripts/
```

That is the newest installed copy (the cache keeps a folder per version). Not installed through the cache, use the marketplace checkout instead: replace `cache/wolfpack/database/*` with `marketplaces/wolfpack/plugins/database`. Run it again after the plugin updates, and commit the three files.

### What the scripts read from `.claude/kit.json`

Required for production work:

- `refs.dev`, `refs.prod`: the dev and production Supabase refs.
- `keychain.dev`, `keychain.prod`: the Keychain items holding the two database URLs (item names, never values).
- `deployer`: the deployer agent's name (`ranjit`).
- `backupRoot`: the folder outside the repo where `prod-db.sh backup` writes dumps.
- `ci.workflow`, `ci.jobs`: the CI workflow file and the names of its jobs. The arm waits for exactly these jobs; without them it refuses ("ci.jobs missing"). The starter sets `ci.jobs: ["Checks"]` to match its `ci.yml`.

Optional:

- `urls.prod`: production's web address. Empty means a drive waits for no deploy and runs no smoke look.
- `pluginRoot`: where the plugin's hooks live, when the guard can't work it out itself.
