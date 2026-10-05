---
name: carousel
description: Open or finish the release's draft PR with the reviewer tagged (`reviewer` in `.claude/kit.json`) (it only notifies), once the README is updated. The last step of /maverick, or run by hand. The description follows the repo's template, with production steps split into Before merge, After merge and Human steps.
---

The production scripts below (`scripts/…`) are the project's own, in its `scripts/` folder: the kit 1.0.0 doesn't ship them.

**Title:** runs inside another session; keeps that session's title.

Open the pull request for the current release branch, or fill in the description of the draft autopilot opened with the plan checklist. This runs in the session that built the release: it already knows what changed and how it was tested, so don't re-read the branch beyond what's listed below. Have `c-3po` (Sonnet, medium) write the README update and the description itself, from the plan file, the commit log and this session's notes; this skill's checklist is what you give it to follow, and what you check its draft against before opening or updating the PR.

## State
- Branch: !`git branch --show-current`
- Open PRs: !`gh pr list --state open --json number,headRefName --jq '.[] | "#\(.number) \(.headRefName)"' || true`
- Commits not on main: !`git log --oneline main..HEAD`
- Files changed: !`git diff --stat main...HEAD | tail -30`

## Checklist
1. **Branch.** A release branch (`V2.x.y`), no other open release PR, tree clean and pushed.
2. **README.** `README.md` must be in the diff (Anton's rule: every PR updates it for what it changes). If it isn't, stop and say what it should cover.
   **Release number.** When `package.json` has a `release` field, it is this release's number (the branch without its `V`). If it isn't, bump it in a commit of its own ("Release number <x.y.z>"). `version` stays semver and only moves at a big version.
3. **Checks pass.** `scripts/check.sh` (plus `db` when the database changed) since the last commit.
4. **Description**, from `.github/pull_request_template.md`, the commits and the plan file:
   - **What changed**: one numbered item per commit, in review order; mark the risky ones.
   - **How it was tested on dev**: SQL tests with counts, functions called, browser widths and themes with the screenshot paths the builders reported, `tsc`/lint/test/knip/build.
   - **Dev cleanup** commands (test rows left on dev) delete by id, never a whole table: `delete from settlements where id = '<uuid>';`, not `delete from settlements;` (2.11's unscoped delete ran on dev).
   - **Production steps**, written so `/skinny-pete` can follow them. Each step is one exact command or a clearly marked human step.
     - **Before merge:** whenever the database changes (migrations, or SQL run by hand), step 1 is always the backup: `scripts/prod-db.sh backup <version>`, which saves roles, schema and data to the folder `prod-db.sh backup` prints and stops if a file is missing or empty. Then the migrations by number (`scripts/prod-db.sh push <version> 0034 0035`), then functions that must be live before the new frontend.
     - `supabase db push` pushes every pending migration in one go, so a migration that must run only after the merge can't be in the same push as one that runs before it: put both after the merge (when the first is backwards compatible) or move the after-merge one to the next release.
     - **After merge** (Vercel ships the frontend when it merges): functions and steps that need the new frontend, then verification.
     - **Human steps:** secrets (`supabase secrets set …` in their own terminal), anything a person types (emails), dashboard settings.
     - **A release that changes the kit** (`kit/`) and publishes it copies the kit README's "Publish the kit" steps into "Human steps afterwards", filled in (release, the tag per bumped plugin, the folders that installed it), one command per line, ending with each `claude plugin update <plugin>@wolfpack --scope …` (`[kit-publish]`). A release that holds the publish for a later one says so there instead ("Kit not published: publishes at <release>").
     - If the release touches Storage: say that uploaded files aren't in the database backup.
     - Facts the deploy plan needs (`ranjit`'s "cheaper next time", 2.13.8): when branch protection requires a review and nobody has approved, say "the merge needs `--admin`". When the release has no mock-up or spike branches, say "no mock-up or spike branches", so the deploy plan skips the branch listing and plan-file search (mock branches `mockup/*` from a `/superlab` are never merged; list them as "clean up after merge" when they exist). The post-merge checks are signed-out only (`ranjit` can't sign in; Vercel previews sit behind Vercel Authentication): any signed-in look goes under "Human steps afterwards", from the plan on.
     - **"How to run this deploy on full auto"** (the template's optional part): a release that changes the guard's frozen set says the plan round stays, because no chain marker covers its first `ranjit` spawn and the arm order goes by `SendMessage` after the plan (`[deploy-order]`, 2.14.7).
     - Nothing for production: write "None: frontend only, ships on merge." (or "None: tooling and docs only").
   - **Usage** (when `/maverick` asks for it): the `car-wash` skill's table.
   - **Notes for review:** decisions taken without a ping, deviations from the plan, skills captured, review findings answered rather than fixed.
   - **Decisions:** each durable "Decided on the way" bullet (one that outlives the release) becomes an ADR in `docs/decisions/` (format in its README), linked from the bullet.
5. **Open or update:** new PR: `gh pr create --draft --base main --title "V2.x.y: <short name>" --reviewer <reviewer> --body-file <scratchpad file>`; existing draft: `gh pr edit <number> --body-file <scratchpad file>`. End the body with the Claude Code line from the system reminder.
6. Report the PR link. Marking it ready is Alexander's call; the reviewer tag only notifies, nothing waits for the reviewer.
