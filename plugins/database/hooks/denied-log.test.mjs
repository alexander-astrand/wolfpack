import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { deniedLine, guardLine, run, shapeOf, summarize, summaryText } from './denied-log.mjs'

const HOOK = fileURLToPath(new URL('./denied-log.mjs', import.meta.url))
let dir, logPath

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'denied-log-'))
  logPath = join(dir, '.claude', 'permission-denied.log')
})

const SAMPLE = {
  session_id: 'sess-9',
  transcript_path: '/x/sess-9.jsonl',
  cwd: '/repo',
  permission_mode: 'auto',
  agent_id: 'a1',
  agent_type: 'saul-goodman',
  tool_name: 'Bash',
  tool_input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnop" SUPABASE_ACCESS_TOKEN=sb' + 'p_123456789012 x' },
  tool_use_id: 'tu-1',
}

describe('denied-log', () => {
  it('appends one line with seven tab-separated fields, secrets masked', async () => {
    await run(JSON.stringify(SAMPLE), { logPath, now: Date.UTC(2026, 9, 4, 12, 0, 0) })
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const f = lines[0].split('\t')
    expect(f).toHaveLength(7)
    expect(f[0]).toBe('2026-10-04T12:00:00.000Z')
    expect(f.slice(1, 3)).toEqual(['saul-goodman', 'Bash'])
    expect(f[3]).toContain('curl')
    expect(f[3]).not.toContain('abcdefghijklmnop')
    expect(f[3]).not.toContain('sb' + 'p_123456789012')
    expect(f.slice(4)).toEqual(['auto', 'sess-9', '-'])
  })

  it('names the main session `main`, cuts Bash at 400 and other tools at 200', () => {
    const line = deniedLine({ ...SAMPLE, agent_type: undefined, tool_input: { command: 'x'.repeat(500) } }, { mask: (s) => s })
    const f = line.split('\t')
    expect(f[1]).toBe('main')
    expect(f[3]).toHaveLength(400)
    expect(deniedLine({ ...SAMPLE, tool_name: 'Agent', tool_input: { prompt: 'x'.repeat(500) } }, { mask: (s) => s }).split('\t')[3]).toHaveLength(200)
  })

  it('puts the target of a Write or Edit in its own column', () => {
    const f = deniedLine({ ...SAMPLE, tool_name: 'Write', tool_input: { file_path: '/Users/a/.claude/plans/V1.md', content: 'x' } }, { mask: (s) => s }).split('\t')
    expect(f[6]).toBe('/Users/a/.claude/plans/V1.md')
    expect(deniedLine({ ...SAMPLE, tool_name: 'NotebookEdit', tool_input: { notebook_path: '/r/n.ipynb' } }, { mask: (s) => s }).split('\t')[6]).toBe('/r/n.ipynb')
  })

  it("the guard's line is the same seven columns, then decision and reason", () => {
    const f = guardLine(SAMPLE, { decision: 'ask', reason: 'Ships the release: gh pr merge 1\nmore' }, { mask: (s) => s, now: Date.UTC(2026, 9, 24) }).split('\t')
    expect(f).toHaveLength(9)
    expect(f.slice(0, 3)).toEqual(['2026-10-24T00:00:00.000Z', 'saul-goodman', 'Bash'])
    expect(f.slice(6)).toEqual(['-', 'ask', 'Ships the release: gh pr merge 1'])
  })

  it('masks a 160k-character input well under a second', async () => {
    const { maskSecrets } = await import('./guard-production.mjs')
    const started = Date.now()
    const f = deniedLine({ ...SAMPLE, tool_input: { command: 'aKEY'.repeat(40000) } }, { mask: maskSecrets }).split('\t')
    expect(Date.now() - started).toBeLessThan(500)
    expect(f[3].length).toBeLessThanOrEqual(400)
  })

  it('without the guard, logs only the raw head cut to 80', () => {
    const f = deniedLine({ ...SAMPLE, tool_input: { command: 'y'.repeat(500) } }, { mask: null }).split('\t')
    expect(f[3]).toHaveLength(80)
  })

  it('keeps tabs and newlines in the input from splitting the line', () => {
    const line = deniedLine({ ...SAMPLE, tool_input: 'a\tb\nc' }, { mask: (s) => s })
    expect(line.split('\t')).toHaveLength(7)
    expect(line).not.toContain('\n')
  })

  it('writes nothing on bad input, and the process exits 0 without printing', async () => {
    await run('{not json', { logPath })
    expect(existsSync(logPath)).toBe(false)
    const r = spawnSync(process.execPath, [HOOK], { input: '{not json', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
    expect(r.status).toBe(0)
    expect(r.stdout.toString()).toBe('')
    expect(existsSync(logPath)).toBe(false)
  })

  it('as a process, logs to CLAUDE_PROJECT_DIR and never prints retry', () => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(SAMPLE), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
    expect(r.status).toBe(0)
    expect(r.stdout.toString()).toBe('')
    expect(readFileSync(logPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(1)
  })
})

describe('denied-log --summary', () => {
  const row = (time, tool, input, extra = []) => [time, 'main', tool, JSON.stringify(input), 'auto', 's1', input.file_path ?? '-', ...extra].join('\t')
  const denied = [
    row('2026-10-18T13:01:00Z', 'Bash', { command: 'git show origin/V0.13:supabase/migrations/0004_jobs.sql | sed -n 1,40p' }),
    row('2026-10-18T13:02:00Z', 'Bash', { command: 'cd /repo && git show origin/V0.13:x.sql' }),
    row('2026-10-19T10:00:00Z', 'Bash', { command: 'vercel env add X production' }),
    row('2026-10-19T10:01:00Z', 'Bash', { command: 'vercel env add Y production' }),
    row('2026-10-20T10:00:00Z', 'Write', { file_path: '/Users/a/.claude/plans/V1.md', content: 'x' }),
    row('2026-10-20T10:05:00Z', 'Write', { file_path: '/Users/a/.claude/plans/V2.md', content: 'y' }),
    row('2026-10-01T10:00:00Z', 'Bash', { command: 'ssh-keygen -t ed25519' }),
    row('2026-10-01T10:01:00Z', 'Bash', { command: 'ssh-keygen -t rsa' }),
    'not a row',
  ].join('\n')
  const guard = [
    row('2026-10-19T17:19:00Z', 'Bash', { command: 'git push origin main' }, ['ask', 'Pushes to main']),
    row('2026-10-19T17:20:00Z', 'Bash', { command: 'git push origin main' }, ['ask', 'Pushes to main']),
  ].join('\n')

  it('groups by shape across both logs, marks the source, and writes an allow line for dev repeats only', () => {
    const rows = summarize({ denied, guard, since: '2026-10-15' })
    const by = (shape, source) => rows.find((r) => r.shape === shape && r.source === source)
    expect(by('git show', 'classifier')).toMatchObject({ count: 2, allow: '"Bash(git show *)"' })
    expect(by('Write /Users/a/.claude/plans', 'classifier')).toMatchObject({ count: 2, allow: '"Write(//Users/a/.claude/plans/**)"' })
    // production and pushes never get one; the guard's asks are on purpose
    expect(by('vercel', 'classifier')).toMatchObject({ count: 2, allow: null })
    expect(by('git push', 'guard')).toMatchObject({ count: 2, allow: null, why: 'Pushes to main' })
    // --since drops the older rows
    expect(rows.some((r) => r.shape === 'ssh-keygen')).toBe(false)
    const text = summaryText(rows)
    expect(text.split('\n')[0]).toBe('count\tsource\ttool\tshape\tallow line or why')
    expect(text).toContain('2\tguard\tBash\tgit push\tguard asks on purpose: Pushes to main')
  })

  // Review must 3: an allow-list of dev reads, not a deny-list of risks.
  it.each([
    ['bash -c "ls"', 'bash'], ['sh run.sh', 'sh'], ['node -e "console.log(1)"', 'node'], ['python3 -c "print(1)"', 'python3'],
    ['eval "ls"', 'eval'], ['env FOO=1 ls', 'env'], ['curl -s https://example.com/x', 'curl'], ['psql postgresql://u@h/db -c "select 1"', 'psql'],
    ['supabase db push --linked', 'supabase db'], ['osascript -e x', 'osascript'], ['open -a Safari', 'open'], ['chmod +x f', 'chmod'],
    ['npx tsx a.ts', 'npx tsx'], ['gh pr create', 'gh pr create'], ['npm install x', 'npm install'],
  ])('%s repeated gets no allow line', (command, shape) => {
    const twice = [row('2026-10-20T10:00:00Z', 'Bash', { command }), row('2026-10-20T10:01:00Z', 'Bash', { command })].join('\n')
    expect(summarize({ denied: twice })).toEqual([expect.objectContaining({ shape, count: 2, allow: null })])
  })

  it.each([
    ['git diff --stat', '"Bash(git diff *)"'], ['gh pr checks 3', '"Bash(gh pr checks *)"'], ['rg -n x src', '"Bash(rg *)"'],
    ['tail -n 5 a.log', '"Bash(tail *)"'], ['npm run typecheck', '"Bash(npm run typecheck *)"'],
  ])('%s repeated gets its dev-read line', (command, allow) => {
    const twice = [row('2026-10-20T10:00:00Z', 'Bash', { command }), row('2026-10-20T10:01:00Z', 'Bash', { command })].join('\n')
    expect(summarize({ denied: twice })[0].allow).toBe(allow)
  })

  it('reads the shape past a cd or VAR= prefix, and from a head cut mid-JSON', () => {
    expect(shapeOf('Bash', JSON.stringify({ command: 'cd /x && R=1 gh pr view 3' }))).toBe('gh pr view')
    expect(shapeOf('Bash', '{"command":"grep -n \\"security definer\\" supabase/migr')).toBe('grep')
    expect(shapeOf('mcp__x__list', '{}')).toBe('mcp__x__list')
  })

  it('as a process, prints the table from the project folder', () => {
    const project = mkdtempSync(join(tmpdir(), 'denied-sum-'))
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude', 'permission-denied.log'), denied)
    writeFileSync(join(project, '.claude', 'guard-decisions.log'), guard)
    const r = spawnSync(process.execPath, [HOOK, '--summary', '--since', '2026-10-15', '--dir', project], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('"Bash(git show *)"')
    expect(spawnSync(process.execPath, [HOOK, '--summary', '--since', 'last week', '--dir', project]).status).toBe(1)
  })
})
