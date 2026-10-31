// frontend-calls.mjs on fixture SQL: no database.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blank, parseArg, readMigration, render } from './frontend-calls.mjs'

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'frontend-calls.mjs')

const MIGRATION = `
-- list_events(p_group) is the old name; this comment must not count
create or replace function public.list_events(p_group uuid, p_limit integer default 20)
returns table (id uuid, title text, starts_at timestamp with time zone)
language sql stable security definer
set search_path = public
as $$
  select id, title, starts_at from public.events where group_id = p_group
  -- create function fake_inner(x int) returns int
  limit p_limit;
$$;

revoke execute on function public.list_events(uuid, integer) from public;
grant execute on function public.list_events(uuid, integer) to authenticated;

create function public.event_count(p_group uuid, out total bigint, out upcoming bigint)
language plpgsql as $fn$
begin
  select count(*), count(*) filter (where starts_at > now()) into total, upcoming
  from public.events where group_id = p_group and note <> 'it''s; fine';
end $fn$;
grant execute on function public.event_count to anon, authenticated;
revoke execute on function public.event_count(uuid) from anon;

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create function public.is_member(uuid) returns boolean language sql as 'select true';

drop function if exists public.old_events(uuid);
`

describe('blank', () => {
  it('drops comments and empties strings and dollar bodies', () => {
    const out = blank("select 'a;b' -- c;d\n, $x$ e;f $x$, /* g; */ 1")
    expect(out).not.toMatch(/[bdfg];/)
    expect(out).toContain('$body$')
  })
})

describe('parseArg', () => {
  it('reads name, type, mode and default', () => {
    expect(parseArg('p_group uuid')).toEqual({ mode: 'in', name: 'p_group', type: 'uuid', optional: false })
    expect(parseArg('p_limit integer default 20')).toMatchObject({ name: 'p_limit', type: 'integer', optional: true })
    expect(parseArg('out total bigint')).toMatchObject({ mode: 'out', name: 'total', type: 'bigint' })
    expect(parseArg('uuid')).toMatchObject({ name: null, type: 'uuid' })
    expect(parseArg('timestamp with time zone')).toMatchObject({ name: null, type: 'timestamp with time zone' })
    expect(parseArg('p_at timestamptz = now()')).toMatchObject({ name: 'p_at', type: 'timestamptz', optional: true })
  })
})

describe('readMigration', () => {
  const { functions, dropped } = readMigration(MIGRATION)
  const fn = (n) => functions.find((f) => f.name === n)

  it('finds only the functions the file creates, not those in bodies or comments', () => {
    expect(functions.map((f) => f.name).sort()).toEqual(['event_count', 'is_member', 'list_events', 'touch_updated_at'])
    expect(dropped).toEqual(['old_events'])
  })
  it('reads returns table columns, definer and search_path', () => {
    const f = fn('list_events')
    expect(f.columns.map((c) => `${c.name} ${c.type}`)).toEqual(['id uuid', 'title text', 'starts_at timestamp with time zone'])
    expect(f.definer).toBe(true)
    expect(f.searchPath).toBe(true)
    expect([...f.grants]).toEqual(['authenticated'])
  })
  it('turns OUT arguments into columns and applies a later revoke', () => {
    const f = fn('event_count')
    expect(f.args.map((a) => a.name)).toEqual(['p_group'])
    expect(f.outs.map((a) => a.name)).toEqual(['total', 'upcoming'])
    expect([...f.grants]).toEqual(['authenticated'])
    expect(f.definer).toBe(false)
  })
  it('marks trigger functions', () => {
    expect(fn('touch_updated_at').trigger).toBe(true)
  })
  it('grants on all functions in schema reach every function so far', () => {
    const r = readMigration('create function a() returns int as $$ select 1 $$ language sql;\ngrant execute on all functions in schema public to anon;')
    expect([...r.functions[0].grants]).toEqual(['anon'])
  })
})

describe('render', () => {
  it('prints the paragraph the builder codes against', () => {
    const text = render('0042_events.sql', readMigration(MIGRATION)).join('\n')
    expect(text).toContain("- supabase.rpc('list_events', { p_group: uuid, p_limit?: integer })")
    expect(text).toContain('  returns: rows of (id uuid, title text, starts_at timestamp with time zone)')
    expect(text).toContain('  security definer: yes, search_path set')
    expect(text).toContain('  returns: one row of (total bigint, upcoming bigint)')
    expect(text).toContain("- supabase.rpc('is_member', { $1: uuid })")
    expect(text).toContain('  execute: none in this file (closed unless an earlier migration grants it)')
    expect(text).toContain('- trigger function touch_updated_at: not called by the frontend')
    expect(text).toContain('- removed: old_events (the frontend must not call it)')
  })
  it('says so when a file has no function', () => {
    expect(render('x.sql', readMigration('alter table t add column c int;'))).toEqual([
      'What the frontend will call (from x.sql):',
      '- no functions: nothing new to call from this file',
    ])
  })
  it('flags a definer without search_path', () => {
    const text = render('y.sql', readMigration('create function f() returns void security definer language sql as $$ select $$;')).join('\n')
    expect(text).toContain('security definer: yes, search_path NOT set')
  })
})

describe('cli', () => {
  it('prints a file and exits 0; usage exits 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontend-calls-'))
    try {
      const f = join(dir, '0042.sql')
      writeFileSync(f, MIGRATION)
      const ok = spawnSync(process.execPath, [RUN, f], { encoding: 'utf8' })
      expect(ok.status).toBe(0)
      expect(ok.stdout).toContain("supabase.rpc('list_events'")
      expect(spawnSync(process.execPath, [RUN], { encoding: 'utf8' }).status).toBe(2)
      expect(spawnSync(process.execPath, [RUN, join(dir, 'none.sql')], { encoding: 'utf8' }).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
