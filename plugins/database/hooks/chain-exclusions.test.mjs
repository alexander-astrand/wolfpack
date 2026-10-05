// First: the tests' project and its kit.json (placeholder values).
import './fixtures/kit-project.mjs'
// C9a (2.12.2): the statement classifier for chained releases' migrations.
// Fixtures are strings here, not files: every file under .claude/hooks asks
// Alexander when it's written.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SQL_VERBS, changedMigrationStops, classify, functionsDefined, migrationWhyNot, releaseOf, splitStatements } from './chain-exclusions.mjs'

const GRANTS = "insert into expected values ('save_thing(uuid)', 'authenticated');\n-- touch_thing() is a trigger: internal.\n"
// One migration as its own release, with save_old() already on main.
const verdict = (sql, over = {}) => migrationWhyNot('0053_x.sql', sql, { ...releaseOf([{ sql }], GRANTS, new Set(['save_old'])), ...over })
const passes = (sql, over) => expect(verdict(sql, over).stops).toEqual([])
const stops = (sql, over) => {
  const r = verdict(sql, over)
  expect(r.stops.length).toBeGreaterThan(0)
  return r
}
const fn = (name, body = 'begin return; end;', extra = '') =>
  `create or replace function public.${name}(p_id uuid) returns void language plpgsql ${extra} set search_path = public as $$ ${body} $$;`

describe('C9a: splitting', () => {
  it('C9a: splits on top-level semicolons only', () => {
    const sql = `
      /* outer /* nested; */ still a comment; */
      insert into t values ('a;b', E'c\\';d', "odd;name"); -- trailing; comment
      create function f() returns void language plpgsql as $fn$ begin perform 1; perform 2; end; $fn$;
      create index i on t ((lower(x || ';')));
    `
    const parts = splitStatements(sql)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatch(/^insert into t values \('a;b', E?'c/)
    expect(parts[1]).toMatch(/perform 1; perform 2; end;/)
    expect(parts[2]).toMatch(/^create index i/)
    expect(parts.join(' ')).not.toMatch(/comment|nested/)
    expect(classify(parts[2])).toMatchObject({ kind: 'create index', object: 'i', table: 't' })
  })

  it('C9a: an unterminated string or body stops the file', () => {
    expect(stops("insert into t values ('open);").stopKinds).toEqual(['unreadable'])
    expect(stops('create function f() returns void as $$ begin').stopKinds).toEqual(['unreadable'])
  })
})

describe('C9a: the allowlist, row by row', () => {
  it('C9a: create table passes with row level security in the same release, stops without', () => {
    passes('create table public.things (id uuid primary key); alter table public.things enable row level security;')
    // RLS enabled in another migration of the same release counts too.
    passes('create table public.things (id uuid);', { rlsEnabled: new Set(['things']) })
    expect(stops('create table public.things (id uuid);').stops[0]).toBe(
      '0053_x.sql: a new table without row level security (statement 1: "create table public.things (id uuid)")',
    )
  })

  it('C9a: add column, create index, create trigger, comment and enable row level security pass', () => {
    passes(`
      alter table public.games add column if not exists shelf text default 'A', add note text;
      create unique index if not exists games_shelf on public.games (group_id, shelf) where shelf is not null;
      create trigger games_touch before update on public.games for each row execute function public.touch_thing();
      comment on column public.games.shelf is 'Where it lives; do not delete from here';
      alter table public.games enable row level security;
    `)
  })

  it('C9a: create policy on a new table passes; on an existing table it is a named item', () => {
    const fresh = verdict('create table things (id uuid); alter table things enable row level security; create policy "read" on things for select using (true);')
    expect(fresh).toMatchObject({ stops: [], items: [] })
    const existing = verdict('create policy "Members read" on public.games for select using (public.is_group_member(group_id));')
    expect(existing).toMatchObject({ stops: [], items: ['P:0053_x.sql:games:Members read'] })
  })

  it('C9a: a new function passes when function_grants.sql names it, in a row or a comment', () => {
    passes(fn('save_thing'))
    passes(fn('touch_thing'))
    // Already on main: no need to be named.
    passes(fn('save_old'))
    expect(stops(fn('mystery')).stops[0]).toMatch(/a new function, mystery\(\), not named in supabase\/tests\/function_grants\.sql/)
  })

  it('C9a: a security definer function is a named item', () => {
    expect(verdict(fn('save_thing', 'begin delete from t where id = p_id; end;', 'security definer'))).toMatchObject({
      stops: [], items: ['SD:0053_x.sql:save_thing'],
    })
  })

  it('C9a: a function body that drops, truncates, alters, grants or runs execute stops', () => {
    for (const body of ['begin drop table t; end;', 'begin truncate t; end;', 'begin alter table t add x int; end;', "begin grant select on t to anon; end;", 'begin execute format($q$select 1$q$); end;']) {
      expect(stops(fn('save_thing', body)).stopKinds[0]).toMatch(/^a function body that runs /)
    }
    // The words in a comment or a message are not statements.
    passes(fn('save_thing', "begin -- we never drop anything here\n raise exception 'Only admins can alter this'; end;"))
  })

  it('C9a: a function without one $$ body stops (C, or a body in a plain string)', () => {
    stops("create function public.save_thing(p_id uuid) returns void language c as 'lib', 'sym';")
    stops("create function public.save_thing(p_id uuid) returns void language sql set search_path = '' as 'drop table public.games';")
  })

  it('C9a: grant and revoke execute on a function pass; a grant to anon or public is a named item', () => {
    expect(verdict('revoke all on function public.save_thing(uuid) from public, anon; grant execute on function public.save_thing(uuid) to authenticated;'))
      .toMatchObject({ stops: [], items: [] })
    expect(verdict('grant execute on function public.save_thing(uuid), public.save_old(text) to anon, authenticated;').items)
      .toEqual(['G:0053_x.sql:save_thing', 'G:0053_x.sql:save_old'])
  })

  it('C9a: other grants stop', () => {
    for (const sql of ['grant select on public.games to anon;', 'grant usage on schema cron to postgres;', 'grant execute on all functions in schema public to anon;', 'grant execute on function f(uuid) to anon with grant option;']) stops(sql)
  })

  it('C9a: a top-level insert or update is a named item', () => {
    expect(verdict("insert into storage.buckets (id) values ('covers') on conflict do nothing; update public.groups set name = 'Members' where name is null;"))
      .toMatchObject({ stops: [], items: ['DML:0053_x.sql:1', 'DML:0053_x.sql:2'] })
  })

  it('C9a: drop if exists followed by the same create passes, for each kind of object', () => {
    passes(`
      drop policy if exists "Members read" on public.games;
      create policy "Members read" on public.games for select using (true);
      drop trigger if exists games_touch on public.games;
      create trigger games_touch before update on public.games for each row execute function public.touch_thing();
      drop index if exists games_shelf;
      create index games_shelf on public.games (shelf);
      drop view if exists public.game_list;
      create view public.game_list with (security_invoker = true) as select id from public.games;
      drop function if exists public.save_thing(uuid, timestamptz);
      create function public.save_thing(p_id uuid, p_at timestamp with time zone default now()) returns void language sql as $$ select 1 $$;
    `)
  })

  it('C9a: a drop of a function with another signature, with cascade or without its arguments stops', () => {
    expect(stops(`drop function if exists public.save_thing(uuid); ${fn('save_thing').replace('p_id uuid', 'p_id uuid, p_x int')}`).stopKinds)
      .toEqual(['drop without re-create'])
    stops(`drop function if exists public.save_thing(uuid) cascade; ${fn('save_thing')}`)
    stops(`drop function if exists public.save_thing; ${fn('save_thing')}`)
    // "A" and "a" are two policies: dropping one and creating the other is a drop.
    stops('drop policy if exists "A" on public.games; create policy "a" on public.games for select using (true);')
  })

  it('C9a: anything else stops', () => {
    for (const sql of [
      'drop table public.games;', 'truncate public.games;', 'delete from public.games;', 'alter table public.games alter column name type varchar(80);',
      'alter table public.games rename to boxes;', 'alter table public.games rename column name to title;', 'alter table public.games disable row level security;',
      'alter table public.games no force row level security;', 'alter table public.games add constraint c check (true);', 'create extension if not exists pg_net;',
      "select cron.schedule('x', '* * * * *', 'select 1');", 'alter default privileges in schema public grant execute on functions to anon;',
      'create role sneaky;', 'create view public.v as select * from public.games;', 'alter function public.save_thing(uuid) security definer;',
      'with d as (delete from public.games returning id) select 1;', 'notify pgrst;',
    ]) stops(sql)
  })
})

describe('C9a: yoda’s cases (must 2)', () => {
  it('C9a: alter table t drop c stops without the word COLUMN', () => {
    expect(stops('alter table public.games drop shelf;').stopKinds).toEqual(['alter table … drop shelf'])
  })

  it('C9a: drop/**/table stops', () => {
    expect(stops('drop/**/table public.games;').stopKinds).toEqual(['drop table'])
  })

  it('C9a: do $$ … execute … $$ stops', () => {
    expect(stops("do $$ begin execute 'drop table public.games'; end $$;").stopKinds).toEqual(['do'])
  })

  it('C9a: bare drop policy stops, drop-and-recreate passes', () => {
    expect(stops('drop policy "Members read" on public.games;').stopKinds).toEqual(['drop policy'])
    expect(stops('drop policy if exists "Members read" on public.games;').stopKinds).toEqual(['drop without re-create'])
    passes('drop policy if exists "Members read" on public.games; create policy "Members read" on public.games for select using (true);')
  })

  it('C9a: alter policy using (true) stops', () => {
    expect(stops('alter policy "Members read" on public.games using (true);').stopKinds).toEqual(['alter policy'])
  })

  it('C9a: delete from inside a function body passes', () => {
    passes(fn('save_thing', 'begin delete from public.attendances where id = p_id; end;'))
  })

  it('C9a: the word scan stops a statement the classifier passed', () => {
    expect(stops('insert into public.log (id) select jobid from cron.job;').stopKinds).toEqual(['word "cron"'])
    // A quoted name is a name, not a word.
    passes('create policy "Drop-in guests" on public.games for select using (true);')
  })
})

describe('C9a: merged migrations', () => {
  it('C9a: a changed, removed or renamed merged migration is a hard stop; a new one is not', () => {
    expect(changedMigrationStops([
      { status: 'A', path: 'supabase/migrations/0053_new.sql' },
      { status: 'M', path: 'supabase/migrations/0052_edit_costs_repeat_on_edit.sql' },
      { status: 'D', path: 'supabase/migrations/0051_scheduler_series_reconfirm.sql' },
      { status: 'R100', from: 'supabase/migrations/0050_notifications.sql', path: 'supabase/old/0050.sql' },
      { status: 'M', path: 'src/App.tsx' },
    ])).toEqual([
      'supabase/migrations/0052_edit_costs_repeat_on_edit.sql is a merged migration, changed or removed',
      'supabase/migrations/0051_scheduler_series_reconfirm.sql is a merged migration, changed or removed',
      'supabase/migrations/0050_notifications.sql is a merged migration, changed or removed',
    ])
  })
})

// yoda's condition (2.12.2): every merged migration run through the classifier
// as if it were a chained release on its own, with the functions of the ones
// before it already on main. Each stop below was read and is a true finding
// about the migration's kind (or, for "new function not in
// function_grants.sql", about the plan's naming rule: those functions are
// internal and named only as a group, or predate the file); none is a false
// stop, and the allowlist wasn't loosened to fit. 16 pass, 36 stop.
const FIFTY_TWO = {
  '0001_init.sql': ['create extension', 'new function not in function_grants.sql'],
  '0002_game_images.sql': 'pass',
  '0003_game_night_duration.sql': 'pass',
  '0004_new_game_night_notifications.sql': ['new function not in function_grants.sql'],
  '0005_member_profiles.sql': 'pass',
  '0006_delete_users.sql': ['alter table … alter column … drop', 'alter table … drop constraint'],
  '0007_event_change_cancel_notifications.sql': ['new function not in function_grants.sql'],
  '0008_game_expansions_owner_location.sql': 'pass',
  '0009_game_links.sql': 'pass',
  '0010_player_profile_extras.sql': 'pass',
  '0011_admin_manage_attendance.sql': 'pass',
  '0012_next_game_night_public.sql': 'pass',
  '0013_fix_capacity_increase_promotion.sql': ['alter trigger', 'new function not in function_grants.sql', 'select'],
  '0014_bgg_integration.sql': 'pass',
  '0015_game_wishlist.sql': 'pass',
  '0016_game_co_owners.sql': 'pass',
  '0017_several_games_per_night.sql': ['alter table … alter column … drop'],
  '0018_movies.sql': 'pass',
  '0019_rewatches.sql': ['alter table … add primary', 'alter table … drop constraint'],
  '0020_next_event_by_kind.sql': ['drop without re-create'],
  '0021_activity_log.sql': ['new function not in function_grants.sql'],
  '0022_auto_swap.sql': ['drop without re-create'],
  '0023_private_events.sql': ['drop without re-create'],
  '0024_game_play_style.sql': 'pass',
  '0025_play_styles_and_player_counts.sql': ['alter table … drop column'],
  '0026_auto_swap_player_gaps.sql': ['new function not in function_grants.sql'],
  '0027_expansion_player_counts.sql': ['new function not in function_grants.sql'],
  '0028_unlimited_seats.sql': ['alter table … alter column … drop'],
  '0029_drop_legacy_columns.sql': ['alter table … drop column'],
  '0030_close_access_holes.sql': ['alter default', 'do', 'drop without re-create', 'new function not in function_grants.sql'],
  '0031_groups.sql': ['alter table … alter column … set', 'do', 'new function not in function_grants.sql'],
  '0032_group_access_rules.sql': ['drop function', 'drop without re-create'],
  '0033_member_management.sql': 'pass',
  '0034_polls.sql': ['new function not in function_grants.sql'],
  '0035_event_comments.sql': ['new function not in function_grants.sql'],
  '0036_lineup_presets.sql': ['new function not in function_grants.sql'],
  '0037_orphaned_events.sql': 'pass',
  '0038_feature_switches.sql': ['alter table … alter column … set', 'alter table … drop constraint'],
  '0039_places.sql': ['drop without re-create', 'new function not in function_grants.sql'],
  '0040_the_night.sql': ['alter table … add constraint', 'alter table … drop constraint', 'new function not in function_grants.sql'],
  '0041_hosts_polls_plus_ones.sql': ['alter table … add constraint', 'alter table … drop constraint', 'drop without re-create', 'new function not in function_grants.sql'],
  '0042_cleanup.sql': ['create extension', 'drop extension'],
  '0043_drop_old_columns.sql': ['alter table … alter column … drop', 'alter table … drop column'],
  '0044_slugs_expansions_bring.sql': ['a function body that runs execute', 'alter table … alter column … set', 'alter table … disable trigger', 'alter table … enable trigger', 'create extension', 'do', 'drop without re-create', 'new function not in function_grants.sql'],
  '0045_play_log_dahan_pages.sql': ['alter table … add constraint', 'alter table … alter column … set', 'alter table … drop constraint', 'do', 'drop without re-create', 'new function not in function_grants.sql'],
  '0046_kits_setup_know_how.sql': ['alter table … add constraint', 'alter table … alter column … type', 'alter table … disable trigger', 'alter table … drop constraint', 'alter table … enable trigger', 'create temp', 'drop table', 'drop without re-create', 'new function not in function_grants.sql'],
  '0047_past_events_uprising.sql': ['alter table … add constraint', 'alter table … drop constraint'],
  '0048_buying_places.sql': ['alter table … alter column … set', 'alter table … drop constraint', 'new function not in function_grants.sql'],
  '0049_shop_links_shared_location.sql': 'pass',
  '0050_notifications.sql': ['new function not in function_grants.sql'],
  '0051_scheduler_series_reconfirm.sql': ['alter table … add constraint', 'alter table … drop constraint', 'create extension', 'drop without re-create', 'grant usage on schema', 'new function not in function_grants.sql', 'select'],
  '0052_edit_costs_repeat_on_edit.sql': ['drop without re-create'],
}

describe('C9a: the merged migrations', () => {
  // Skipped in the kit: it reads the project's own supabase/migrations and tests, which the kit doesn't carry.
  it.skip('C9a: all 52 migrations', () => {
    const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
    const grants = readFileSync(fileURLToPath(new URL('../../supabase/tests/function_grants.sql', import.meta.url)), 'utf8')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(expect.arrayContaining(Object.keys(FIFTY_TWO)))
    const onMain = new Set()
    const got = {}
    for (const file of files) {
      const sql = readFileSync(dir + file, 'utf8')
      // The splitter cut in the right places: every statement starts with a verb.
      for (const s of splitStatements(sql)) expect(SQL_VERBS, `${file}: ${s.slice(0, 60)}`).toContain(s.split(/\s+/)[0].toLowerCase())
      const r = migrationWhyNot(file, sql, releaseOf([{ sql }], grants, new Set(onMain)))
      // Later migrations (2.13 on) are only split here; their verdict is their release's.
      if (file in FIFTY_TWO) got[file] = r.stops.length ? r.stopKinds : 'pass'
      for (const name of functionsDefined(sql)) onMain.add(name)
    }
    expect(got).toEqual(FIFTY_TWO)
    expect(Object.values(got).filter((v) => v === 'pass')).toHaveLength(16)
  })
})
