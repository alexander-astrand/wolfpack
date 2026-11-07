// db-rerun.mjs on a fixture project in a temp dir (a kit.json, a migrations
// folder, a seed) with the command runner stubbed: no database, no psql, no
// docker, no supabase. Covers the path resolution from kit.json and flags, the
// local-only refusal, the transaction-control refusal, the SQL proof sends,
// and the undo file's shape.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { assertLocal, buildUndo, main, resolveConfig, splitSql } from './db-rerun.mjs'

let root
const put = (rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
// A stub for spawnSync: records each call, answers like psql.
const stub = (answer = { status: 0, stdout: '', stderr: '' }) => {
  const calls = []
  const exec = (bin, args, opts) => {
    calls.push({ bin, args, input: opts.input })
    return answer
  }
  return { calls, exec }
}
const runMain = (argv, exec) => {
  const out = []
  const err = []
  const code = main(argv, { exec, log: (l) => out.push(l), err: (l) => err.push(l), now: new Date('2026-11-07T12:00:00Z') })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const M1 = `create table public.items (id uuid primary key, name text);
alter table public.items enable row level security;
create or replace function public.can_see(p_id uuid, p_flag boolean default false) returns boolean
language sql stable as $$ select true; $$;
create policy "items read" on public.items for select using (public.can_see(id));
grant execute on function public.can_see(uuid, boolean) to anon, authenticated;
`
const M2 = `-- the release's migration
create schema if not exists private;
alter table public.items add column if not exists note text, alter column name set not null;
create or replace function public.can_see(p_id uuid, p_flag boolean default false) returns boolean
language sql stable as $$ select p_flag; $$;
drop policy if exists "items read" on public.items;
create policy "items read" on public.items for select using (auth.uid() is not null);
create index items_note on public.items (note);
insert into public.items (id, name) values (gen_random_uuid(), 'semi;colon');
comment on table public.items is 'it''s; fine';
`

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'db-rerun-')))
  put('db/migs/0001_items.sql', M1)
  put('db/migs/0002_note.sql', M2)
  put('db/fixtures.sql', "insert into public.items values (gen_random_uuid(), 'a');\n")
  put('supabase/config.toml', 'project_id = "fixture"\n\n[db]\nport = 55432\n')
})

describe('paths', () => {
  it('defaults to the Supabase layout, the port from config.toml', () => {
    const cfg = resolveConfig({ root })
    expect(cfg.migrations).toBe(join(root, 'supabase/migrations'))
    expect(cfg.seeds).toEqual([])
    expect(cfg.dbUrl).toBe('postgresql://postgres:postgres@127.0.0.1:55432/postgres')
    expect(cfg.container).toBe('fixture')
    expect(cfg.via).toBe('psql')
  })
  it('reads kit.json database, and flags win over it', () => {
    put('.claude/kit.json', JSON.stringify({ database: { migrations: 'db/migs', seeds: ['db/fixtures.sql'], localUrl: 'postgresql://u:p@localhost:6000/x', via: 'docker' } }))
    const cfg = resolveConfig({ root })
    expect(cfg.migrations).toBe(join(root, 'db/migs'))
    expect(cfg.seeds).toEqual([join(root, 'db/fixtures.sql')])
    expect(cfg.dbUrl).toBe('postgresql://u:p@localhost:6000/x')
    expect(cfg.via).toBe('docker')
    const flagged = resolveConfig({ root, migrations: 'other', dbUrl: 'postgresql://127.0.0.1/y', via: 'psql', seeds: ['s.sql'] })
    expect(flagged.migrations).toBe(join(root, 'other'))
    expect(flagged.dbUrl).toBe('postgresql://127.0.0.1/y')
    expect(flagged.via).toBe('psql')
    expect(flagged.seeds).toEqual([join(root, 's.sql')])
  })
  it('apply finds a migration by name prefix in the kit.json folder', () => {
    put('.claude/kit.json', JSON.stringify({ database: { migrations: 'db/migs' } }))
    const s = stub()
    const r = runMain(['apply', '0002', '--root', root], s.exec)
    expect(r.code).toBe(0)
    expect(s.calls[0].input).toContain('-- db-rerun: 0002_note.sql')
    expect(s.calls[0].args).toEqual(['postgresql://postgres:postgres@127.0.0.1:55432/postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-f', '-'])
  })
  it('--via docker runs psql in the stack container named by config.toml', () => {
    put('.claude/kit.json', JSON.stringify({ database: { migrations: 'db/migs' } }))
    const s = stub()
    expect(runMain(['apply', '0001_items.sql', '--via', 'docker', '--root', root], s.exec).code).toBe(0)
    expect(s.calls[0].bin).toBe('docker')
    expect(s.calls[0].args.slice(0, 5)).toEqual(['exec', '-i', 'supabase_db_fixture', 'psql', '-U'])
  })
})

describe('local only', () => {
  it('passes localhost, 127.0.0.1 and ::1', () => {
    for (const u of ['postgresql://a:b@localhost:54322/postgres', 'postgresql://127.0.0.1/db', 'postgresql://[::1]:5432/db']) expect(() => assertLocal(u)).not.toThrow()
  })
  it('refuses a hosted host, a ?host= override, a service and no host at all', () => {
    for (const u of ['postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres', 'postgresql://localhost/db?host=prod.example.co', 'postgresql://localhost/db?service=prod', 'postgresql:///postgres'])
      expect(() => assertLocal(u), u).toThrow(/not the local stack/)
  })
  it('refuses before running anything, exit 2, for apply and proof', () => {
    put('.claude/kit.json', JSON.stringify({ database: { migrations: 'db/migs', localUrl: 'postgresql://postgres:pw@aws-0-eu-north-1.pooler.supabase.com:6543/postgres' } }))
    for (const argv of [['apply', '0001'], ['proof']]) {
      const s = stub()
      const r = runMain([...argv, '--root', root], s.exec)
      expect(r.code).toBe(2)
      expect(r.err).toMatch(/aws-0-eu-north-1\.pooler\.supabase\.com is not the local stack/)
      expect(s.calls).toHaveLength(0)
    }
  })
  it('the --db-url flag is checked too', () => {
    put('.claude/kit.json', JSON.stringify({ database: { migrations: 'db/migs' } }))
    const s = stub()
    expect(runMain(['proof', '--db-url', 'postgresql://10.0.0.5/db', '--root', root], s.exec).code).toBe(2)
    expect(s.calls).toHaveLength(0)
  })
})

describe('proof', () => {
  beforeEach(() => put('.claude/kit.json', JSON.stringify({ database: { migrations: 'db/migs', seeds: 'db/fixtures.sql' } })))
  it('sends reset, every migration and the seed between begin and rollback', () => {
    const s = stub()
    const r = runMain(['proof', '--root', root], s.exec)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/PROOF OK 2 migrations and 1 seed file/)
    const sql = s.calls[0].input
    expect(s.calls[0].args).not.toContain('-1')
    expect(sql.trimStart().split('\n').slice(0, 2)).toEqual(['-- db-rerun: begin', 'begin;'])
    expect(sql.trimEnd().endsWith('rollback;')).toBe(true)
    const order = ['drop schema if exists "private" cascade;', 'drop schema if exists public cascade;', '-- db-rerun: 0001_items.sql', '-- db-rerun: 0002_note.sql', '-- db-rerun: fixtures.sql', 'rollback;'].map((x) => sql.indexOf(x))
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]))).toBe(true)
  })
  it('--no-seed leaves the seed out; --dry-run sends nothing', () => {
    const s = stub()
    runMain(['proof', '--no-seed', '--root', root], s.exec)
    expect(s.calls[0].input).not.toContain('fixtures.sql')
    const d = stub()
    const r = runMain(['proof', '--dry-run', '--root', root], d.exec)
    expect(r.code).toBe(0)
    expect(d.calls).toHaveLength(0)
    expect(r.out).toMatch(/0001_items\.sql[\s\S]*0002_note\.sql[\s\S]*seed db\/fixtures\.sql/)
  })
  it('names the file and line psql stopped at, exit 1', () => {
    const s = stub({ status: 3, stdout: '', stderr: '' })
    runMain(['proof', '--root', root], s.exec)
    const lines = s.calls[0].input.split('\n')
    const at = lines.indexOf('-- db-rerun: 0002_note.sql') + 1 + 3 // the 0002 file's line 3
    const f = stub({ status: 3, stdout: '', stderr: `psql:<stdin>:${at}: ERROR:  column "note" already exists\n` })
    const r = runMain(['proof', '--root', root], f.exec)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAILED at 0002_note\.sql:3, rolled back/)
  })
  it('refuses a migration with its own COMMIT, before sending anything', () => {
    put('db/migs/0003_tx.sql', 'begin;\ncreate table public.t (id int);\ncommit;\n')
    const s = stub()
    const r = runMain(['proof', '--root', root], s.exec)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/0003_tx\.sql:1 has its own BEGIN/)
    expect(s.calls).toHaveLength(0)
  })
  it('a --reset file replaces the default reset', () => {
    put('db/reset.sql', 'drop schema public cascade; create schema public;')
    const s = stub()
    runMain(['proof', '--reset', 'db/reset.sql', '--root', root], s.exec)
    expect(s.calls[0].input).toContain('-- db-rerun: reset\ndrop schema public cascade; create schema public;')
    expect(s.calls[0].input).not.toContain('"private"')
  })
})

describe('the undo file', () => {
  beforeEach(() => put('.claude/kit.json', JSON.stringify({ database: { migrations: 'db/migs' } })))
  it('splitSql keeps strings and dollar bodies whole', () => {
    const st = splitSql(M2)
    expect(st.map((s) => s.line)).toEqual([2, 3, 4, 6, 7, 8, 9, 10])
    expect(st[2].bare).toMatch(/\$\$ select p_flag; \$\$$/)
    expect(st[7].bare).toBe("comment on table public.items is 'it''s; fine'")
  })
  it('reverses the migration last first, restoring what it replaced, with TODO for data', () => {
    const out = join(root, 'scratch')
    const r = runMain(['undo', '0002', '--out', out, '--root', root], stub().exec)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/undo-0002_note\.sql \(5 undone, 1 TODO by hand/)
    const text = readFileSync(join(out, 'undo-0002_note.sql'), 'utf8')
    expect(text.split('\n').slice(0, 5)).toEqual([
      '-- db-rerun undo for 0002_note.sql',
      expect.stringMatching(/^-- from db\/migs\/0002_note\.sql, sha256 [0-9a-f]{12}, written 2026-11-07T12:00:00\.000Z$/),
      '-- Reverses the migration, last statement first. Run it with:',
      '--   node db-rerun.mjs apply 0002_note.sql --undo <this file>',
      '-- 5 statements undone, 1 TODO by hand.',
    ])
    const order = [
      '-- kept: comment on table',
      '-- TODO by hand (changes data): 0002_note.sql:9',
      'drop index if exists public.items_note;',
      'drop policy if exists "items read" on public.items;',
      'create policy "items read" on public.items for select using (public.can_see(id));',
      '$$ select true; $$;',
      'alter table public.items alter column name drop not null, drop column if exists note;',
      '-- kept: create schema if not exists private',
    ].map((x) => text.indexOf(x))
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), JSON.stringify(order)).toBe(true)
    // the function came back as 0001 wrote it, without a drop (same signature)
    expect(text).not.toMatch(/drop function/)
  })
  it('a new function is dropped by its signature without defaults; a grant becomes a revoke', () => {
    const u = buildUndo('0001_items.sql', M1, [])
    expect(u.todo).toBe(0)
    expect(u.text).toContain('drop function if exists public.can_see(p_id uuid, p_flag boolean);')
    expect(u.text).toContain('revoke execute on function public.can_see(uuid, boolean) from anon, authenticated;')
    expect(u.text).toContain('drop table if exists public.items cascade;')
    expect(u.text).toContain('alter table public.items disable row level security;')
  })
  it('apply refuses an undo file that still has TODO lines, and sends a finished one first', () => {
    const out = join(root, 'scratch', 'u.sql')
    runMain(['undo', '0002', '--out', out, '--root', root], stub().exec)
    const s = stub()
    const r = runMain(['apply', '0002', '--undo', out, '--root', root], s.exec)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/still has 1 TODO line/)
    expect(s.calls).toHaveLength(0)
    writeFileSync(out, readFileSync(out, 'utf8').replace(/^-- TODO by hand.*$/m, "delete from public.items where name = 'semi;colon';"))
    const ok = runMain(['apply', '0002', '--undo', out, '--root', root], s.exec)
    expect(ok.code).toBe(0)
    const sql = s.calls[0].input
    expect(sql.indexOf('-- db-rerun: u.sql')).toBeLessThan(sql.indexOf('-- db-rerun: 0002_note.sql'))
  })
  it('undo writes into the tmp folder by default and never runs a command', () => {
    const s = stub()
    const r = runMain(['undo', '0001_items.sql', '--root', root], s.exec)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/db-rerun[\\/]undo-0001_items\.sql/)
    expect(s.calls).toHaveLength(0)
  })
})

describe('usage', () => {
  it('--help prints usage, exit 0; a bad command prints it, exit 2', () => {
    expect(runMain(['--help'], stub().exec)).toMatchObject({ code: 0, out: expect.stringMatching(/^usage: node db-rerun\.mjs undo/) })
    expect(runMain(['rebuild'], stub().exec)).toMatchObject({ code: 2, err: expect.stringMatching(/unknown command rebuild[\s\S]*usage:/) })
    expect(runMain(['apply'], stub().exec).code).toBe(2)
  })
})
