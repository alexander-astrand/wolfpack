---
name: cloud-city
description: What a Claude Code cloud session (claude.ai/code, the app's Code tab, Cloud in the desktop app, `claude --cloud`) can and can't do on this repo, and how we use them. Read when starting or planning work in the cloud.
---

**Title:** runs inside another session; keeps that session's title.

Cloud sessions run on a fresh clone of the pushed branch in an Anthropic VM. The Claude GitHub App on this repo lets them clone and push. They load `CLAUDE.md`, `.claude/agents/`, `.claude/skills/` and the hooks in `.claude/settings.json` (the production guard, and the project's cloud setup script, which installs dependencies and says what the cloud can't reach), but not anyone's `.claude/settings.local.json`: pick the model in the session (`/model opusplan`); the agents still pin their own.

## Good for
- Frontend-only releases (`/maverick` works there too), docs, `/its-a-trap`, clean-up chunks, spikes, and several independent tasks in parallel, each on its own branch.
- **Auto-fix on every release PR**, so CI failures and review comments are handled while nobody's at the Mac.
- **Spikes alongside the local release:** a prototype on a throwaway branch (`spike/<topic>`) that ends in a short findings note for the next plan, never a PR, so the one-open-release-PR rule holds. Examples: TanStack Query (2.8.2), an OpenStreetMap map (2.8), popups as pages (2.9), ultra-wide layouts (2.14), local Supabase in CI (2.7.1).
- **The refactor check at each release boundary**, read-only on `main` after the merge; findings go on the roadmap for the next clean-up.
- **Not 2.14 (the design makeover):** it needs browser checks, which the cloud can't do.

## Not for
Production, or browser checks at 375/1024px. Migrations and `supabase/tests/*.sql` can now be written in the cloud since CI's `db` job replays every migration onto a fresh local database and runs the SQL tests there (the project's local check does the same, given Docker) - no dev connection needed to know they're right. What still needs the Mac: `npm run types` (reads dev's schema) and deploying anything to dev (Edge Functions, `supabase db push`). Database work in the cloud would need a separate Supabase account holding only a throwaway project, so no token there can reach production; not set up.

## Rules
- **No Supabase keys in a cloud environment**, as variables or API credentials: a Supabase access token reaches every project on the account, production included, and the guard can't see raw Management API calls. The default **Trusted** network (npm, GitHub) is all the setup needs.
- If a task needs something the cloud lacks, finish the rest, push, and say so plainly in the summary.
- Check usage on claude.ai after the first few cloud sessions.
