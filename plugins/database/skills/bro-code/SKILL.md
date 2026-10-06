---
name: bro-code
description: Write or extend a database test in supabase/tests/ - fixture users and groups in one transaction that always rolls back and reports PASS or FAIL. Use for any change to RLS, grants, database functions, the waitlist or group rules.
---

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · bro-code <subject>` (norms.md).

Database logic is tested on **dev** with SQL files in `supabase/tests/`, run with `supabase db query --linked -f <file>` (the CLI must be linked to dev). Each file acts as fixture users inside one transaction and always ends by raising an exception, so nothing is kept. The message is `PASS <name> (n checks)` or `FAIL <name>` followed by the failed checks.

## Add to an existing file first
The project's own access rules and test suites (its `CLAUDE.md` lists them) say which file covers what. The general rule: a grants file that says exactly which functions `anon`/`authenticated` may execute (**every new function goes there**), an access-holes file for closed holes, and one file per area (isolation between owners or groups, roles, the domain's own logic).

A new file only for a new area, in the same style: the header comment says what it proves, how to run it, and the fixture uuid suffixes.

## The pattern
- `begin;` then `create temp table results (n serial, name text, ok boolean, detail text) on commit drop;`
- **Helpers:** copy the helper block from the project's closest existing suite (typically `pg_temp.try_as`, `expect_ok`, `expect_error`, `count_as`, `expect_count`). They set `request.jwt.claims` and `set local role authenticated` *inside* a plpgsql block, so a failing statement rolls the role back with its subtransaction.
- **Fixtures:** people are rows inserted into `auth.users` with fixed uuids (`00000000-0000-4000-a000-0000000000a1` …; the project's new-user trigger makes their profiles), plus the project's fixture owner/group rows. Rows need their owner or group column set explicitly. Never use real members.
- **Checks:** one `results` row per expectation, named in plain words ("a member can't see group B's events").
- **End:** the `do $$ … raise exception 'PASS …' / E'FAIL …\n%' … $$` block from the bottom of an existing suite.

## Gotchas
- **Everything in one transaction shares `now()`**, so waitlist order (`created_at`) ties. Move earlier rows back a minute after each sign-up (`pg_temp.tick`).
- **Since 0030, new functions have no PUBLIC execute, `pg_temp` ones included.** Call `pg_temp` helpers as postgres, and switch roles inside them.
- **The deferred "group needs an owner" check:** `set constraints public.group_members_need_owner immediate` inside a `DO` block to test it.
- **SQL-inserted auth users lack `instance_id`/`aud`**, so GoTrue admin calls (deleteUser) say "User not found" for them. To test Edge Functions, make accounts through `invite-user`, accept via SQL (`accept_group_invites()` as that user), and delete them afterwards.
- `supabase db query` returns errors as JSON; the PASS/FAIL text is inside the message.
- **Prove the test can fail:** loosen the rule on purpose once (in the transaction), see FAIL, then put it back.

## Run them all
`for f in supabase/tests/*.sql; do supabase db query --linked -f "$f"; done`, after every database change. Every file must say PASS.
