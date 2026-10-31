# database

The Supabase pack: the production guard (the Slap Bet Commissioner) in `hooks/`, `the-playbook` and `bro-code`. The deployer agent is the project's own (in its `.claude/agents/`, named by `deployer` in `.claude/kit.json`). `database-artifacts.md` lists what a project using it carries. The guard finds the project through `CLAUDE_PROJECT_DIR` and reads its values from `.claude/kit.json`.

## The scope sheet, the test runner and their neighbours (kit 1.7, 1.8)

Read-and-run helpers for database steps, run from the plugin folder (nothing to copy into the project):

- `node scripts/scope.mjs <table|function> [--root <project>]` prints the suites under `supabase/tests/` naming it, the pinned lists in `src/`, `scripts/` and `supabase/functions/` (a quoted name on a line), the migrations defining it as a function, and its foreign-key pairs from `supabase/migrations/`. Files only, no database. The navigator pastes its output into every `the-playbook` order, so the builder starts from the list instead of reading suites one by one.
- `node scripts/run-tests.mjs [prefix] [--root <project>]` runs `supabase/tests/*.sql` the way `bro-code` writes them (no `_` files, `_helpers.sql` pasted at `-- @helpers`, the prefix for one suite) and prints only `FAIL <file>` with its failed checks, then one count line; exit 1 on any FAIL. Dev only: `--local` for a local stack, `--linked` only when the CLI is linked to `refs.dev`; it refuses with exit 2 when it can't tell, or when the project's own test command names the other flag. For a project with no database test command of its own. `--mutate <suite>` (kit 1.8) is the proof each check can fail: the suite must PASS, then it runs once per `expect_ok(`/`expect_error(` call with that call flipped, each run must FAIL, and a check that still passes prints `SURVIVED <file>:<line>` (exit 1). It flips only those two helpers in the suite's own text (comments and helper definitions skipped) and counts other checks as not mutated; one run per check, so for access-rule suites.
- `node scripts/new-suite.mjs <area> [--root <project>]` writes `supabase/tests/<area>.test.sql` in `bro-code`'s shape (kit 1.8): header, one transaction, temp results table, `pg_temp.expect_ok`/`expect_error` helpers, three fixture users with fixed uuids, a checks block, and the closing PASS/FAIL raise; FAIL until it has a check, never over an existing file. When the project keeps `_helpers.sql`, it names the suite to copy the `-- @helpers` placement from.
- `node scripts/frontend-calls.mjs <migration.sql> [more.sql ...]` prints the "what the frontend will call" paragraph from the migration's text (kit 1.8): per function a `supabase.rpc('name', { arg: type, optional?: type })` line, its return columns (OUT arguments count), the roles granted execute in that file after any revoke, and security definer with or without `search_path`; trigger and dropped functions get one line each. No database. `the-playbook` puts its output in the report and the navigator pastes it verbatim into the next builder's order.

## The one-word deploy (kit 1.6)

`/one-ring <version or PR number>`, typed by Alexander in any session of a project, runs this plugin's own `scripts/full-auto.sh deploy <same argument>` (never the project's copy, so `live-sync` keeps it current), and `hooks/deploy.mjs` does the rest: out of draft, the branch up to date, CI green on its head, a throwaway checkout of that head with main's `prod-db.sh` and `kit.json`, the backup (Docker started, three tries), the dry run equal to the PR's new migration files, the push, the PR's `prod-db.sh setting` steps, the functions it touches (`scripts/functions-touched.mjs` when the project has one), the squash merge of exactly the head CI passed, the host's deploy and a smoke. Run again after a stop, it picks up where it stopped. The guard lets that one call through when this session's transcript holds his typed `/one-ring` with the same argument from the last 12 hours (`hooks/one-ring-go.mjs`), and asks him once otherwise. Why, and what a session may fix on production on the way: `docs/decisions/0001-one-word-deploy.md` in the kit.

Only an unticked "Human steps before the deploy can finish" tagged `[secret]`, `[password]` or `[payment]` holds the deploy (kit 1.7; `carousel` writes the tag, and an untagged step naming a secret, a password, a payment, an API key, a token, a credential or a service role key holds too, for PRs from before the tags). Every other open step is listed once in a PR comment and the deploy carries on. `/one-ring check <version or PR>` prints what the deploy would run and what production has, and changes nothing. Under `/one-ring`, `ranjit` is never spawned.

## The deployer, generated (kit 1.7)

A project's `.claude/agents/ranjit.md` is this plugin's `templates/ranjit.md` (or `ranjit-no-database.md` for `"production": "on-merge"`) with its `.claude/kit.json` values filled in, never a hand copy. `node <plugin>/scripts/sync-ranjit.mjs <project dir>` writes it; with `--check` it only compares, prints the diff and exits 1 when the copy differs. The file is frozen, so the write runs where the guard allows it (Alexander, or a setup session); a project's check runs `--check`.

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
