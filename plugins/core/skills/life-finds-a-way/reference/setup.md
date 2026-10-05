# Life finds a way: setup reference

Moved out of SKILL.md to keep it small: the bodies of flow steps 4 to 7, then the setup walkthrough. Step numbers are the same as in SKILL.md.

### 4. Research

Spawn `doc-brown` (Agent tool), in parallel where the runs don't depend on each other, each with the decision it serves, the brief's path, today's date and its output path under `<plans><project>/research/`:

- **Stack and hosting** for this brief: what to build it on and where it runs, staying on free tiers. Output `research/stack.md`.
- **Free-tier refresh**, when the "Checked:" date in `${CLAUDE_PLUGIN_ROOT}/skills/life-finds-a-way/free-tiers.md` is older than about a month: re-check the rows for the services the stack uses and write a fresh copy to `<plans><project>/free-tiers.md`. The kit's file is read-only to a project; when it's fresh, copy it as is.
- **Competitor check** (medium and large, unless he switched it off): one page, what they do, what we'd do differently, what to adopt. Output `research/competitors.md`.

On large, then spawn `marty-mcfly` on `research/stack.md` with the decision; it appends its `## Checked` section. Settle the `database` pack from the stack answer, and the **stack** for the templates: `node` (a JavaScript or TypeScript app), `python`, or `other` (anything else, a chat project included). It comes from research, never from a question to him.

Write: the research paths, the stack in one line, `Stack: node | python | other` and the final packs into `brief.md`; tick step 4.

### 5. Roadmap

Spawn `john-hammond` with: the brief path (his words verbatim and the picks are in it), the findings paths, `<plans><project>/free-tiers.md`, the kit.json values so far (name, noun, plans, `roadmap: "file"`), the horizon from the size table, the template `templates/roadmap.md` and the output path `<plans><project>/roadmap.md`. It writes `roadmap.md` and returns V0.1's step table (step · who builds · files · check · budget) and its Free until / When to park it / Where it runs suggestions.

Write: a draft `<plans><project>/V0.1.md` from `templates/V0.1.md`, His words first, with Hammond's step table under `## Steps` (`{{v01.steps}}`) and his suggestions in their sections (park triggers 2–3, each part tagged Code / Cowork / Chat). Tick step 5.

### 6. Critique

Spawn `dr-house` with the roadmap, the V0.1 draft, the brief and, on a UI project, the taste picks and steal / never line as the seed's project-specific lines (it flags a seed with none as a must). Fix the musts yourself where they're wording or placement; scope musts go back to `john-hammond` **once**, with the findings. After that one round, write what you have and note what's still open.

Write: `<plans><project>/critique.md` (the findings, what was fixed, what's open) and the fixes into `roadmap.md` / `V0.1.md`. Tick step 6.

### 7. The first plan and the files

Finish `<plans><project>/V0.1.md`: every section of the template filled (His words, Where it runs, Free until, Money and data, When to park it, If it fires, Rhythm, Human steps before build, Yours / Mine, Steps, First commit), no `{{…}}` left. "When to park it" holds the 2–3 triggers in his words; they also go to the project's War Room row as `park_when`, a line the hand-off prints (`/mr-miyagi rhythm <project>`, run in `~/dojo`).

Then render the skeleton with `fill.mjs`, not by hand: write the values (the brief, the research, the roadmap; shape as `templates/fixtures/node.values.json`, with `stack` from step 4 and `packs`) to `<plans><project>/values.json`, then run

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/life-finds-a-way/templates/fill.mjs <plans><project>/values.json <project folder> --plans <plans><project>/
```

It writes every file to its real target, makes `scripts/check.sh` executable, keeps the lines for the stack, skips the plans files steps 5 and 6 already wrote, and exits 1 naming the file and key of any value missing (fix the values file and rerun; nothing is written until it's clean). The stack decides the checks: Node's `check.sh` runs `check.mjs` over the npm scripts; Python's runs ruff and pytest where installed; Other's is a TODO that says "no checks yet". Packs decide which files apply:

- always: `CLAUDE.md`, `README.md`, `.claude/kit.json`, `.claude/lessons.md`, `docs/decisions/` (README and `0001-start.md`), `scripts/check.sh` (plus `scripts/check.mjs` on Node), `.gitignore`, `.env.example` (names only), `.github/workflows/ci.yml`, `.github/dependabot.yml`;
- release: its allow list (the allow lists, core's too, are merged into `.claude/settings.json` by the walkthrough's Mine row, not here);
- the stack: its allow list (Node's npm lines, Python's python3 / ruff / pytest lines; Other has none);
- design: its allow list, `.claude/launch.json` (Node with a dev server) and `.claude/taste.md`. The taste file opens with "Where this project starts": the three picks, each with his reason, and the steal / never line verbatim. Rules the project can't meet yet (no maps, no columns) fold under "Not yet";
- database: its allow list.

`.claude/kit.json`: `project` (name, noun, a free port near the stack's default), `plans` set to the project's own folder `<plans><project>/` (not the bare root), `roadmap: "file"`, and `kit.version` from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`'s `version`. Refs, prod URL, keychain item names and reviewer stay empty strings until the setup walkthrough fills them; `deployer` is `"ranjit"` (the database plugin's deployer agent) when the database pack is on, else an empty string. `conventions` is an empty string (the skeleton writes no conventions script).

**No dev server** (a chat project, a script): `devPort` is `null` in kit.json, and every template line ending in `<!-- ui-only -->` is removed (`templates/README.md` says which).

**Plans paths in the project's files** use `~/` (`~/.claude/plans/<project>/`), never an expanded home path: `CLAUDE.md` is public.

**A redo** of step 7 always runs `fill.mjs` with `--adopt`: it writes only missing files, never overwriting his edits. Never `--force` on a real project (it's for a scratch folder only); plans files are never overwritten by any flag. Redoing step 6 rewrites only `critique.md` and V0.1.md's draft; it doesn't force step 7's skeleton.

`dependabot.yml` starts with the github-actions entry only; the First commit line in V0.1 reminds him to add the stack's entry once its manifest exists: npm once `package.json` exists (Node), pip once `requirements.txt` or `pyproject.toml` exists (Python). Other has none.

Write: the files above. Tick step 7. The skeleton isn't committed yet; the repo and its first commit are the walkthrough's.

## The setup walkthrough

After step 7. Every folder-bound row (`git init`, the first commit, `gh repo create --source .`, `supabase link`, `vercel link`, the settings merge, kit.json) runs in the brief's project folder (`cd` to it, or `git -C`), never the session's cwd. The feel: a checklist ticking itself; he signs, he doesn't operate. **As few human steps as possible: a step that needs only a login he already has is Claude's, never his.**

### The list

**Rows are listed in the order they must run, dependencies first** (the Supabase project before its Keychain key, the repo before Actions), not grouped by kind. Build it from `V0.1.md`'s "Human steps before build" and the packs, then check what's already true (`gh auth status`, `supabase projects list`, `vercel whoami`, `security find-generic-password -s <name>` without `-w`) so nothing done is asked twice. Typical rows:

- **Mine** (his existing logins): merge the allow lists into `.claude/settings.json` (the one write the guard needs a person for; `node <templates>/fill.mjs --allow <plans><project>/values.json` prints the merged list for the packs and the stack); `git init` and the first commit (the skeleton, subject from "First commit"); `gh repo create <project> --private --source . --push` under his gh login; Actions and Dependabot on (`gh api`); the database pack: `supabase projects create` and `supabase link` under his login, after counting his active free projects against the limit in `free-tiers.md` (two; when full, the pick is pause one or use Pro, and the pick is his); the design pack: `vercel link`; the kit plugins installed at project scope; `.claude/kit.json`'s empty values filled from what the steps returned (refs, Keychain item names, reviewer, prod URL when there is one).
- **Mine, database pack only:** copy the database plugin's production scripts into `scripts/` once (a person runs it; the guard refuses an agent's copy), one exact command from the project folder, then commit the three files:

  ```bash
  cp "$(ls -d ~/.claude/plugins/cache/wolfpack/database/*/ | sort -V | tail -1)"scripts/{prod-db.sh,full-auto.sh,chain-cover.mjs} scripts/
  ```

  `kit.json` carries `refs.prod`, `urls.prod` and `backupRoot` as empty strings until the walkthrough fills them (`backupRoot`: a folder outside the repo for production dumps); an empty `urls.prod` means no deploy wait and no smoke look in a drive.
- **Yours:** a sign-up he doesn't have yet (a gh, Supabase or Vercel account), a key typed into a Keychain prompt, billing, a dashboard toggle no CLI reaches.

Show it first, one message, counted: **"Yours: N · Mine: M"**, each of his rows saying what it unlocks ("The Supabase key: the database pack wakes."), the whole climb before the first step. The counts and rows go into `V0.1.md`'s "Yours / Mine" table.

### The steps

In list order, one at a time. Each finished step is ticked in `brief.md`'s `## Progress` (one line per walkthrough row, added with the list), so a rerun resumes mid-walkthrough.

- **Mine:** one yes, AskUserQuestion with the plain ask ("Shall I create the private repo under your gh login?"): **Run it** (Recommended) / **Skip** (it moves to his list, counted) / **Stop here**. Then one plain line: "Repo made, 2 of 9." **One yes per step that creates or changes anything outside this machine:** repo create, push, Actions and Dependabot, Supabase create and link, Vercel link, plugin install. Only local steps (the settings merge, `git init`, the first local commit) may share one yes ("Settings merged, repo started, first commit, 3 of 9.").
- **Blocked before the yes** (the free-slot limit full, a login missing): the step is never offered as Run it; it becomes a Yours row ("Pause a project or go Pro"), counted, and the steps that need it wait behind it.
- **Yours:** one line on what it does and what it unlocks, then exactly one command or one page in its own fenced block, then **Done** / **Got an error** / **Stop here**; the next step only after Done. "Got an error": read what he pastes, fix it or explain it, and hand the same step again. A key goes in through a prompt that never echoes, in his terminal, under the item name kit.json records:

  ```bash
  security add-generic-password -a "$USER" -s <project>-supabase-dev -w
  ```

  (`-w` last makes `security` ask for the value; the item name is the only thing this session knows.)
- **Stop here** ends the walkthrough: the receipt prints with what's done, and a rerun picks up at the next unticked row.

**Never:** create an account; see, type or echo a key's value; ask him to paste a key into a file, a chat or a command line; run anything against production (the first deploy is V0.1's, through its release); ask him to run what an existing login lets Claude run.
