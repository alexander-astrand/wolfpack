// scope.mjs against a fixture project folder: suites, pinned lists,
// foreign keys and function definitions, read from files only.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { foreignKeys, parseArgs, scope } from './scope.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCOPE = join(HERE, 'scope.mjs')

let root
const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'scope-')))
  put('supabase/migrations/0001_groups.sql', `
create table public.groups (id uuid primary key, name text);
create table public.events (
  id uuid primary key,
  amount numeric(10,2),
  group_id uuid not null references public.groups(id) on delete cascade,
  note text -- references nothing, just prose
);
create or replace function public.is_member(g uuid) returns boolean language sql as $$
  select true; -- references public.events in a body is not a key
$$;
`)
  put('supabase/migrations/0002_tags.sql', `
create table if not exists public.tags (id uuid primary key);
alter table public.tags add column event_id uuid references public.events(id);
alter table only public.tags add constraint tags_owner foreign key (owner_id) references auth.users(id);
`)
  put('supabase/tests/0001_events.sql', 'select * from public.events;\n')
  put('supabase/tests/0002_groups.sql', 'select public.is_member(gen_random_uuid());\n')
  put('supabase/tests/0003_events_more.sql', '-- eventsx is another table\n')
  put('src/lib/mcp.ts', "export const MCP_DENY = ['events', 'tags']\nconst note = 'no events here'\n")
  put('scripts/export.mjs', 'const LEFT_OUT = ["groups"]\n')
  put('supabase/functions/sync/index.ts', "await db.from(`events`).select()\n")
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the sheet', () => {
  it('lists the suites, the pinned lines and the keys for a table', () => {
    const s = scope(root, 'events')
    expect(s.suites).toEqual(['supabase/tests/0001_events.sql'])
    // The bare word in a string ('no events here') is not a pinned name.
    expect(s.pinned).toEqual([
      "src/lib/mcp.ts:1  export const MCP_DENY = ['events', 'tags']",
      'supabase/functions/sync/index.ts:1  await db.from(`events`).select()',
    ])
    expect(s.fks).toEqual(['events.group_id -> groups', 'tags.event_id -> events'])
    expect(s.definedIn).toEqual([])
  })

  it('names the migration that defines a function', () => {
    const s = scope(root, 'is_member')
    expect(s.suites).toEqual(['supabase/tests/0002_groups.sql'])
    expect(s.definedIn).toEqual(['supabase/migrations/0001_groups.sql'])
    expect(s.fks).toEqual([])
  })

  it('reads keys from create table, alter add column and foreign key ()', () => {
    const sql = "create table a (x numeric(10,2), b_id uuid default auth.uid() references public.b(id));\nalter table a add constraint k foreign key (c_id) references c(id);\n"
    expect(foreignKeys(sql)).toEqual([
      { child: 'a', column: 'b_id', parent: 'b' },
      { child: 'a', column: 'c_id', parent: 'c' },
    ])
  })
})

describe('the command', () => {
  const run = (...args) => {
    const r = spawnSync('node', [SCOPE, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } })
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
  }

  it('prints the sheet the navigator pastes', () => {
    const r = run('groups', '--root', root)
    expect(r.code).toBe(0)
    expect(r.out).toBe([
      'scope: groups',
      'suites (0):',
      'pinned lists (1):',
      '  scripts/export.mjs:1  const LEFT_OUT = ["groups"]',
      'foreign keys (1):',
      '  events.group_id -> groups',
    ].join('\n'))
  })

  it('stops on usage and on a folder with no supabase/', () => {
    expect(run().code).toBe(2)
    expect(run('a;drop', '--root', root).err).toMatch(/not a table or function name/)
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'scope-empty-')))
    expect(run('events', '--root', empty).err).toMatch(/no supabase\//)
    rmSync(empty, { recursive: true, force: true })
    expect(parseArgs(['x', '--root']).error).toMatch(/needs a folder/)
  })
})
