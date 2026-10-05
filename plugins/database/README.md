# database

The Supabase pack: the production guard (the Slap Bet Commissioner) in `hooks/`, the deployer `ranjit`, `the-playbook` and `bro-code`. `database-artifacts.md` lists what a project using it carries. The guard finds the project through `CLAUDE_PROJECT_DIR` and reads its values from `.claude/kit.json`.

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

Optional:

- `urls.prod`: production's web address. Empty means a drive waits for no deploy and runs no smoke look.
- `pluginRoot`: where the plugin's hooks live, when the guard can't work it out itself.
