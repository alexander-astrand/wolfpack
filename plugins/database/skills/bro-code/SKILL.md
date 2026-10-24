---
name: bro-code
description: Write or extend a database test in supabase/tests/ - fixture users and groups in one transaction that always rolls back and reports PASS or FAIL. Use for any change to RLS, grants, database functions, or the project's group and ordering rules.
---

## Voice
bro-code · the database tester (Barney Stinson's Bro Code, article by article) · "legendary", "suit up", rules numbered
- start: "Suit up. Fixtures in, one transaction, always rolled back."
- commit: (silent)
- refusal: "Against the code. A test that leaves rows behind never ships."
- ping: "A rule with two readings. Which one is the code?"
- wrap: "PASS on every line. Legen... wait for it... dary."

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · bro-code <subject>` (norms.md).

Database logic is tested on **dev** with SQL files in `supabase/tests/`, run with `supabase db query --linked -f <file>` (the CLI must be linked to dev). **On a local stack** (`refs.dev` in `.claude/kit.json` is a placeholder such as `localstacknotahosted`, or the project's `CLAUDE.md` says dev is local) there is no `--linked`: run the project's own test command (Burrow: `npm run test:db`, or `npm run test:db -- <file>` for one), which runs each file against the local stack (lens Must 4, kit 1.5). Each file acts as fixture users inside one transaction and always ends by raising an exception, so nothing is kept. The message is `PASS <name> (n checks)` or `FAIL <name>` followed by the failed checks.

## Budget, when run inside another session
Inside `the-playbook` its `maxTurns` and tag hold. Typed as `/bro-code` in someone else's session, nothing caps it: one such hour ran 80.9M (kit 1.6.1 council, M8). So in the first message say the expected size: extending a suite about 4M, a new suite for a new function about 12M (the playbook's prices in `oceans-eleven`, "Sizing the-playbook"). That figure is the line, at most 15M. After each suite run, read this session's tokens: `node <the release plugin>/scripts/usage.mjs --timeline <id>` (`--timeline` is a flag, the id from `get_session` `self` is positional), or `get_usage` before and after when the script isn't reachable (1% of the week is about 46M, so it is coarse). At the line, stop: commit what is green and report what is left.

## Scope first
Before writing, find what already covers the name: `node ${CLAUDE_PLUGIN_ROOT}/scripts/scope.mjs <table|function>` prints the suites naming it, the pinned lists in `src/`, `scripts/` and `supabase/functions/`, and its foreign-key pairs (no script reachable: `grep -ln '<name>' supabase/tests src supabase/functions`). Put the count and the list in your first message. When the order already carries the sheet, use it and don't run it again. When a change renames, splits or removes a policy, wall, function or column and the list is over 10 files, ask for the step to be split before editing (kit 1.6.1 council, M8: 26 suites read one by one for one wall).

## Add to an existing file first
The project's own access rules and test suites (its `CLAUDE.md` lists them) say which file covers what. The general rule: a grants file that says exactly which functions `anon`/`authenticated` may execute (**every new function goes there**), an access-holes file for closed holes, and one file per area (isolation between owners or groups, roles, the domain's own logic).

A new file only for a new area, in the same style: the header comment says what it proves, how to run it, and the fixture uuid suffixes.

## The pattern
- `begin;` then `create temp table results (n serial, name text, ok boolean, detail text) on commit drop;`
- **Helpers:** when the project keeps them in `supabase/tests/_helpers.sql` and its runner pastes that file at a `-- @helpers` line (Burrow), write that one line instead of a copy, so each suite stays one `DO` block. Otherwise copy the helper block from the project's closest existing suite (typically `pg_temp.try_as`, `expect_ok`, `expect_error`, `count_as`, `expect_count`). They set `request.jwt.claims` and `set local role authenticated` *inside* a plpgsql block, so a failing statement rolls the role back with its subtransaction.
- **Fixtures:** people are rows inserted into `auth.users` with fixed uuids (`00000000-0000-4000-a000-0000000000a1` …; the project's new-user trigger makes their profiles), plus the project's fixture owner/group rows. Rows need their owner or group column set explicitly. Never use real members.
- **Checks:** one `results` row per expectation, named in plain words ("a member can't see group B's events").
- **End:** the `do $$ … raise exception 'PASS …' / E'FAIL …\n%' … $$` block from the bottom of an existing suite.

## Gotchas
- **Everything in one transaction shares `now()`**, so any order by `created_at` ties. Move earlier rows back a minute after each insert that order depends on (`pg_temp.tick`).
- **New functions have no PUBLIC execute, `pg_temp` ones included** (once the project has revoked it by default). Call `pg_temp` helpers as postgres, and switch roles inside them.
- **The deferred "group needs an owner" check:** `set constraints public.group_members_need_owner immediate` inside a `DO` block to test it.
- **SQL-inserted auth users lack `instance_id`/`aud`**, so GoTrue admin calls (deleteUser) say "User not found" for them. To test Edge Functions, make accounts through `invite-user`, accept via SQL (`accept_group_invites()` as that user), and delete them afterwards.
- `supabase db query` returns errors as JSON; the PASS/FAIL text is inside the message.
- **Prove the test can fail:** loosen the rule on purpose once (in the transaction), see FAIL, then put it back.

## Run one while writing, all once at the end
- **While writing:** only the suite you touched, by its prefix: the project's database test command with the file (such as `npm run test:db -- 0035`), or with none, `node ${CLAUDE_PLUGIN_ROOT}/scripts/run-tests.mjs 0035`.
- **Once, before the report:** every suite, with the same command and no prefix, written to a file in your scratch folder (`> <scratch>/db-tests.txt 2>&1`), then `echo $?` on its own line, then read only the FAIL lines. Never pipe it to `tail`: the pipe hides the exit code and cost a second full run.
- `run-tests.mjs` does what this skill says by hand: skips `_` files, pastes `_helpers.sql` at `-- @helpers`, never sends a suite with no closing `raise exception 'PASS`, prints only `FAIL <file>` with its failed checks and one count line, and exits 1 on any FAIL. It runs only on dev (`--local` or `--linked` to `refs.dev`, as above) and refuses with exit 2 when it can't tell.
- **No green after three tries on one suite: stop and report** the suite, the failing check and what you tried. A fourth try is the caller's call.
- Every file must say PASS.
