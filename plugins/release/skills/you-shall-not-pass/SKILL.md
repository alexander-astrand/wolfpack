---
name: you-shall-not-pass
description: Run the checks - type-check, lint, Vitest, knip, build and the SQL tests on dev - and report failures only, in a cheap Haiku fork. For a person's use; autopilot runs scripts/check.sh directly.
argument-hint: "[app|db|local|all]"
context: fork
agent: romeo-olsson
background: false
---

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · you-shall-not-pass <subject>` (norms.md).

Run `scripts/check.sh $ARGUMENTS` (no argument means `app`; `db` runs the SQL tests on dev; `local` runs them on a fresh migrated local database (needs Docker); `all` runs app + dev).

It prints one ✅/❌ line per check, then only the failing checks' output. Report those lines as they are. If something failed, add the file:line of each error and nothing else. Don't re-run the tools one by one unless a failure's cause isn't clear from what the script printed.
