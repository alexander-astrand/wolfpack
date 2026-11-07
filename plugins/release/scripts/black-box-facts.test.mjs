import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authSettings, buildFacts, envNames, headers, maskBodies, parseArgs, parseBudgets, sh, workflowFacts } from './black-box-facts.mjs'

const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), text)
}
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })

describe('arguments', () => {
  it('reads the version and the lane budgets, defaults kept for the lanes not named', () => {
    const o = parseArgs(['--version', '3.0.6', '--budgets', 'db=8,sec=8M', '--no-npm'])
    expect(o.version).toBe('3.0.6')
    expect(o.budgets).toEqual({ db: 8, sec: 8, infra: 15 })
    expect(o.npm).toBe(false)
    expect(parseBudgets('nonsense')).toEqual({ db: 25, sec: 15, infra: 15 })
  })
})

describe('small readers', () => {
  it('blanks function bodies but keeps line numbers', () => {
    const sql = 'create function f() as $$\nbegin; select 1; end\n$$;\n'
    const m = maskBodies(sql)
    expect(m.split('\n').length).toBe(sql.split('\n').length)
    expect(m).not.toContain('select 1')
  })
  it('gives env variable names, never values', () => {
    expect(envNames('A=1\nexport B_KEY="x"\n# C=3\n')).toEqual(['A', 'B_KEY'])
  })
  it('keeps auth settings and drops keys that hold secrets', () => {
    const toml = '[db]\nmajor_version = 15\n[auth]\nminimum_password_length = 8\njwt_secret = "x"\n[auth.email]\nenable_confirmations = true\n'
    expect(authSettings(toml)).toEqual(['[auth] minimum_password_length = 8', '[auth.email] enable_confirmations = true'])
  })
  it('reads a workflow against the CI rules', () => {
    const w = workflowFacts('on:\n  pull_request:\nconcurrency:\n  group: x\n  cancel-in-progress: true\njobs:\n  test:\n    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n  lint:\n    runs-on: ubuntu-latest\n')
    expect(w).toMatchObject({ on: ['pull_request'], jobs: ['test', 'lint'], timeouts: 1, concurrency: true, cancel: true, draftSkip: true, runners: ['ubuntu-latest'] })
  })
})

describe('on a fixture project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'black-box-facts-'))
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, '.gitignore', '.env.local\n')
  put(dir, '.env.local', 'VITE_URL=http://x\nSERVICE_KEY=not-printed-value\n')
  put(dir, '.claude/kit.json', JSON.stringify({ project: { name: 'fixture' }, stack: 'vite', plans: join(dir, 'plans/'), refs: { dev: 'hidden-ref' }, ci: { workflow: '.github/workflows/ci.yml' } }))
  put(dir, 'plans/free-tiers.md', 'Checked: 2026-11-01\n| Service | Limit |\n|---|---|\n| Resend | 100 a day |\n')
  put(dir, 'package.json', JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^7.0.0' } }))
  put(dir, 'supabase/migrations/001_init.sql', [
    'create table public.notes (id int);',
    'create table public.secrets (id int);',
    'create table public.open (id int);',
    'alter table public.notes enable row level security;',
    'alter table public.secrets enable row level security;',
    'create policy "read own" on public.notes for select to authenticated using (true);',
    'create policy "old" on public.notes for delete to anon using (true);',
    'create or replace function public.helper() returns int language plpgsql security definer as $$ begin; return 1; end $$;',
    'create or replace function public.safe() returns int language sql security definer set search_path = \'\' as $$ select 1; $$;',
    "create policy \"avatars\" on storage.objects for insert to authenticated with check (bucket_id = 'a');",
    'grant execute on function public.helper() to anon;',
    "select cron.schedule('nightly', '0 3 * * *', $$ select net.http_post('https://hooks.example.org'); $$);",
  ].join('\n'))
  put(dir, 'supabase/migrations/002_drop.sql', 'drop policy if exists "old" on public.notes;\n')
  put(dir, 'supabase/tests/notes.sql', 'select * from notes;\n')
  put(dir, 'supabase/functions/send/index.ts', "const h = { 'Access-Control-Allow-Origin': '*' }\nfetch('https://api.resend.com/emails')\n")
  put(dir, 'vercel.json', JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'Strict-Transport-Security', value: 'max-age=1' }] }] }))
  put(dir, '.github/workflows/ci.yml', 'on:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n')
  put(dir, 'src/app.tsx', 'export const a = 1\n'.repeat(30))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  put(dir, 'docs/audits/1.0/black-box.md', 'old audit\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'audit')
  put(dir, 'src/more.ts', 'x\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'after the audit')

  const facts = buildFacts({ ...parseArgs(['--version', '2.0', '--budgets', 'db=8,sec=8,infra=8', '--no-npm']), repo: dir })

  it('prints every section in order', () => {
    expect(headers(facts).filter((h) => h.startsWith('## '))).toEqual([
      '## Lanes and budgets',
      '## Git range since the last audit',
      '## Database and access (lane 1)',
      '## Security and auth (lane 2)',
      '## Infrastructure, APIs and plans (lane 3)',
      '## Code size (the 20 biggest source files)',
      '## Advisors (the navigator adds these)',
    ])
    expect(facts).toContain('| Total | 24M |')
  })
  it('starts the git range at the last audit commit', () => {
    expect(facts).toMatch(/1 commits \(merges left out\) since `[0-9a-f]+`/)
    expect(facts).toContain('after the audit')
  })
  it('reads tables, RLS, policies after drops, definer functions, grants and jobs', () => {
    expect(facts).toContain('| public.notes | on | select: authenticated |')
    expect(facts).toContain('**Public tables with RLS off:** public.open')
    expect(facts).toContain('**RLS on and no policy (closed to everyone but the service role):** public.secrets')
    expect(facts).toContain('**Policies open to anon or public:** 0')
    expect(facts).toContain('storage.objects "avatars" (insert: authenticated)')
    expect(facts).toContain('public.helper **no search_path**')
    expect(facts).toContain('public.safe sets search_path')
    expect(facts).toMatch(/execute on function public\.helper\(\) to anon \(supabase\/migrations\/001_init\.sql:11\)/)
    expect(facts).toContain('nightly (supabase/migrations/001_init.sql:12)')
    expect(facts).toContain('pg_net calls (1)')
    expect(facts).toContain('Public tables no test names: public.open, public.secrets')
  })
  it('names env variables and never prints a value, a ref or a hidden key', () => {
    expect(facts).toContain('`.env.local` (git-ignored): VITE_URL, SERVICE_KEY')
    expect(facts).not.toContain('not-printed-value')
    expect(facts).not.toContain('hidden-ref')
    expect(facts).toContain('**Env files tracked by git (not examples):** none')
  })
  it('reads CORS, headers, CI, free tiers and outside hosts', () => {
    expect(facts).toContain("supabase/functions/send/index.ts:1 '*'")
    expect(facts).toContain('Missing: content-security-policy, x-content-type-options, referrer-policy, permissions-policy')
    expect(facts).toContain('| ci.yml | push | 1 | 0 of 1 | no, no | no | ubuntu-latest |')
    expect(facts).toContain('free-tiers.md`: 3 table rows, checked 2026-11-01')
    expect(facts).toContain('api.resend.com: 1')
    expect(facts).toContain('key packages: react ^19.0.0, vite ^7.0.0')
  })
  it('lists the biggest files and skips npm and knip offline', () => {
    expect(facts).toContain('| 31 | src/app.tsx |')
    expect(facts).toContain('Skipped (`--no-npm`)')
  })
  it('summarises npm outdated and audit from an injected run', () => {
    const run = (cmd, args, cwd) => {
      if (cmd === 'npm' && args[0] === 'outdated') return JSON.stringify({ vite: { current: '6.0.0', latest: '7.1.0' } })
      if (cmd === 'npm' && args[0] === 'audit') return JSON.stringify({ metadata: { vulnerabilities: { high: 2 } }, vulnerabilities: { esbuild: { severity: 'high' } } })
      return sh(cmd, args, cwd)
    }
    const f = buildFacts({ ...parseArgs(['--version', '2.0']), repo: dir }, { run })
    expect(f).toContain('**npm outdated:** 1 packages, 1 a major behind')
    expect(f).toContain('critical 0, high 2, moderate 0, low 0')
    expect(f).toContain('- esbuild (high)')
  })
})
