#!/usr/bin/env node
// Writes a new SQL test suite skeleton in bro-code's shape, so a new area
// starts from the pattern instead of a copy of the nearest suite.
//
// Usage: node scripts/new-suite.mjs <area> [--root <project>]
//   area     lower-case words, digits, _ or - (`event_visibility`, `0042_rsvp`)
//   writes   supabase/tests/<area>.test.sql and prints its path
//   exit 0   written
//   exit 1   the file is there already (never overwritten)
//   exit 2   usage
//
// The skeleton: the header comment (what it proves, how to run it, the
// fixture uuid suffixes), `begin;` and the temp results table, a helper
// block (pg_temp.expect_ok and pg_temp.expect_error, acting as a fixture
// user inside a subtransaction so a failing statement rolls the role back),
// three fixture users in auth.users with fixed uuids, a place for the
// project's own group rows, one DO block of checks, and the closing block
// that raises PASS or FAIL, which rolls everything back. With no checks yet
// it says FAIL, so an empty skeleton never passes. Its expect_ok and
// expect_error calls are the ones `run-tests.mjs --mutate` flips.
//
// When the project keeps supabase/tests/_helpers.sql (pasted by its runner
// at a `-- @helpers` line), it prints which suite to copy that line's place
// from: the helper block is the project's, not the kit's.
//
// Why it exists: each new suite copied the nearest one, fixtures and all
// (kit 1.7.1 council, Feature 19; database lens Feature 5).
//
// The root is --root, else CLAUDE_PROJECT_DIR, else the current folder.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseArgs(argv) {
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (!argv[i + 1]) return { error: '--root needs a folder' }
      root = argv[++i]
    } else rest.push(argv[i])
  }
  const area = rest[0] || ''
  if (rest.length !== 1 || !/^[a-z0-9][a-z0-9_-]*$/.test(area)) return { error: 'usage: new-suite.mjs <area> [--root <project>] (area: a-z, 0-9, _ or -)' }
  return { root: resolve(root), area }
}

const uid = (suffix) => `00000000-0000-4000-a000-0000000000${suffix}`

/** The suite's text for one area. */
export function skeleton(area) {
  return `-- ${area}: what this suite proves, in one or two plain lines (fill in).
-- Run: the project's database test command with ${area} (such as
--   npm run test:db -- ${area}), or node <database plugin>/scripts/run-tests.mjs ${area}.
-- Proof each check can fail: run-tests.mjs --mutate ${area}.
-- Fixture users, uuid suffix: a1 owner, a2 member, a3 outsider (not in the group).
-- One transaction that always ends in raise exception, so nothing is kept.

begin;
create temp table results (n serial, name text, ok boolean, detail text) on commit drop;

-- Helpers. Call them as postgres; they switch role inside a subtransaction,
-- so a failing statement rolls the role back with it.
create function pg_temp.try_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
    execute p_sql;
    reset role;
    return null;
  exception when others then
    return sqlerrm;
  end;
end $f$;

create function pg_temp.expect_ok(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $f$
declare err text := pg_temp.try_as(p_user, p_sql);
begin
  insert into results (name, ok, detail) values (p_name, err is null, err);
end $f$;

create function pg_temp.expect_error(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $f$
declare err text := pg_temp.try_as(p_user, p_sql);
begin
  insert into results (name, ok, detail) values (p_name, err is not null, coalesce(err, 'no error'));
end $f$;

-- Fixtures: never real members. The new-user trigger makes their profiles.
insert into auth.users (id, email) values
  ('${uid('a1')}', '${area}-owner@test.invalid'),
  ('${uid('a2')}', '${area}-member@test.invalid'),
  ('${uid('a3')}', '${area}-outsider@test.invalid');
-- The project's group rows, owner or group column set explicitly, such as:
-- insert into public.groups (id, owner_id, name) values ('${uid('b1')}', '${uid('a1')}', '${area} group');

-- Checks: one results row per expectation, named in plain words.
do $$
begin
  -- perform pg_temp.expect_ok('a member can read the group''s rows', '${uid('a2')}', 'select 1');
  -- perform pg_temp.expect_error('an outsider can''t insert into the group', '${uid('a3')}', 'insert into ...');
end $$;

-- The verdict: PASS or FAIL as an exception, which rolls everything back.
do $$
declare
  total int := (select count(*) from results);
  failed text := (select string_agg(format('  %s (%s)', name, detail), E'\\n' order by n) from results where not ok);
begin
  if total = 0 then
    raise exception 'FAIL ${area}: no checks yet';
  elsif failed is null then
    raise exception 'PASS ${area} (% checks)', total;
  else
    raise exception E'FAIL ${area}\\n%', failed;
  end if;
end $$;
`
}

/** The first suite that uses the project's `-- @helpers` line, or null. */
export function helpersExample(dir) {
  if (!existsSync(join(dir, '_helpers.sql'))) return null
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('_')).sort()
  return files.find((f) => /^[ \t]*-- @helpers[ \t]*$/m.test(readFileSync(join(dir, f), 'utf8'))) || '_helpers.sql'
}

export function write({ root, area }) {
  const dir = join(root, 'supabase', 'tests')
  const file = join(dir, `${area}.test.sql`)
  if (existsSync(file)) return { code: 1, lines: [`${file} is there already; not overwritten`] }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, skeleton(area))
  const lines = [file]
  const example = helpersExample(dir)
  if (example) lines.push(`this project pastes supabase/tests/_helpers.sql at -- @helpers: swap the helper block for that line, placed as in ${example}`)
  return { code: 0, lines }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    process.stderr.write(`new-suite: ${args.error}\n`)
    process.exit(2)
  }
  const { code, lines } = write(args)
  console.log(lines.join('\n'))
  process.exit(code)
}
