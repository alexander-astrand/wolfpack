import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { deniedLine, guardLine, reasonCode, run, sessionEnd, shapeOf, stepAsideOnce, summarize, summaryText, toolCalls } from './denied-log.mjs'
import { GH_PR_READS, GIT_READS, PIPE_FILTERS, TEXT_READS, guardListedHead } from './read-list.mjs'

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

  it("the guard's line is the same seven columns, then decision, reason and reason code", () => {
    const f = guardLine(SAMPLE, { decision: 'ask', reason: 'Ships the release: gh pr merge 1\nmore' }, { mask: (s) => s, now: Date.UTC(2026, 9, 24) }).split('\t')
    expect(f).toHaveLength(10)
    expect(f.slice(0, 3)).toEqual(['2026-10-24T00:00:00.000Z', 'saul-goodman', 'Bash'])
    expect(f.slice(6, 9)).toEqual(['-', 'ask', 'Ships the release: gh pr merge 1'])
    expect(f[9]).toMatch(/^other-[0-9a-f]{6}$/)
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
    row('2026-10-18T13:03:00Z', 'Bash', { command: 'npm run build' }),
    row('2026-10-18T13:04:00Z', 'Bash', { command: 'npm run build' }),
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
    // a guard-listed read gets none (round 3); a named npm script gets its exact line
    expect(by('git show', 'classifier')).toMatchObject({ count: 2, allow: null })
    expect(by('npm run build', 'classifier')).toMatchObject({ count: 2, allow: '"Bash(npm run build)"' })
    // under ~/.claude: no line (kit 1.7 review, round 2)
    expect(by('Write /Users/a/.claude/plans', 'classifier')).toMatchObject({ count: 2, allow: null })
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

  // Round 3: a repeat of a guard-listed read reached the classifier because
  // the guard refused its operands, so no wildcard line for any of them.
  const listed = [
    'git diff /dev/null ~/x', 'git show HEAD:.env', 'git -C /tmp diff a b', 'git log -p', 'git cat-file -p HEAD:x', 'rg -g .env KEY .',
    'grep -r x .', 'wc -l ~/x', 'head -n 5 ~/x', 'tail ~/x', 'gh pr view 3', 'gh pr checks 3', 'gh pr diff 3', 'gh pr list',
    'cat ~/.ssh/id_rsa', 'ls ~/.ssh', 'git blame .env',
  ]
  it.each(listed)('%s repeated gets no allow line', (command) => {
    const twice = [row('2026-10-20T10:00:00Z', 'Bash', { command }), row('2026-10-20T10:01:00Z', 'Bash', { command })].join('\n')
    expect(summarize({ denied: twice })[0].allow).toBeNull()
  })

  it("every head on the guard's read list is covered, from the shared list", () => {
    for (const sub of GIT_READS) expect(guardListedHead(['git', sub]), sub).toBe(true)
    for (const cmd of [...TEXT_READS, ...PIPE_FILTERS]) expect(guardListedHead([cmd]), cmd).toBe(true)
    for (const sub of GH_PR_READS) expect(guardListedHead(['gh', 'pr', sub]), sub).toBe(true)
  })

  it('a named npm script gets its exact command, with no wildcard', () => {
    const twice = [row('2026-10-20T10:00:00Z', 'Bash', { command: 'npm run typecheck' }), row('2026-10-20T10:01:00Z', 'Bash', { command: 'npm run typecheck' })].join('\n')
    expect(summarize({ denied: twice })[0].allow).toBe('"Bash(npm run typecheck)"')
  })

  // Round 2: MCP tools and file edits from an allow-list as well.
  const twiceOf = (tool, input) => [row('2026-10-20T10:00:00Z', tool, input), row('2026-10-20T10:01:00Z', tool, input)].join('\n')
  it.each([
    'mcp__x__execute_sql', 'mcp__x__apply_migration', 'mcp__x__deploy_edge_function', 'mcp__x__delete_branch', 'mcp__x__create_project',
    'mcp__x__merge_branch', 'mcp__x__reset_branch', 'mcp__x__pause_project', 'mcp__x__restore_project', 'mcp__x__frobnicate',
    'mcp__x__list_and_delete', 'Agent', 'SendMessage', 'WebFetch',
  ])('%s repeated gets no allow line', (tool) => {
    expect(summarize({ denied: twiceOf(tool, {}) })[0]).toMatchObject({ count: 2, allow: null })
  })

  it.each(['mcp__x__list_tables', 'mcp__x__get_logs', 'mcp__x__search_docs', 'mcp__plugin_context7_context7__query-docs', 'mcp__c7__resolve-library-id'])(
    '%s repeated gets its line', (tool) => {
      expect(summarize({ denied: twiceOf(tool, {}) })[0].allow).toBe(`"${tool}"`)
    })

  it.each([
    ['Edit', '.claude/settings.json'], ['Edit', '/Users/a/.claude/CLAUDE.md'], ['Write', '.git/hooks/pre-commit'], ['Edit', 'supabase/migrations/0081_x.sql'],
    ['Edit', 'scripts/check.sh'], ['Edit', 'plugins/database/hooks/guard-production.mjs'], ['Write', 'config/.env.d/x'], ['Edit', 'README.md'],
  ])('%s of %s repeated gets no allow line', (tool, file_path) => {
    expect(summarize({ denied: twiceOf(tool, { file_path, old_string: 'a', new_string: 'b' }) })[0].allow).toBeNull()
  })

  it('an edit in an ordinary folder still gets its line', () => {
    expect(summarize({ denied: twiceOf('Edit', { file_path: '/repo/src/app/page.tsx', old_string: 'a', new_string: 'b' }) })[0].allow).toBe('"Edit(//repo/src/app/**)"')
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
    expect(r.stdout).toContain('"Bash(npm run build)"')
    expect(r.stdout).not.toContain('"Bash(git show *)"')
    expect(spawnSync(process.execPath, [HOOK, '--summary', '--since', 'last week', '--dir', project]).status).toBe(1)
  })
})

// Kit 1.8 (M12): a stable reason code, a per-session allow count, a step-aside row.
describe('M12 (kit 1.8): reason codes, allows and the step-aside', () => {
  it.each([
    ['The full-auto marker and its log are written only by scripts/full-auto.sh, which a person runs.', 'marker-write'],
    ['scripts/full-auto.sh arms production, so a call names it only to run it on its own (...)', 'arm-script'],
    ['`$L` is built at run time and may be gh: ...', 'built-at-runtime'],
    ['psql can reach any database. Check where it connects.', 'psql'],
    ['--workdir can point the CLI at another link. Run it from the repo root.', 'workdir'],
    ['--project-ref abcdefghijklmnopqrst isn\'t dev. Production is reached only through /one-ring.', 'prod-ref'],
  ])('%s gets the code %s', (reason, code) => {
    expect(reasonCode(reason)).toBe(code)
  })

  it('an unlisted reason gets one code whatever its paths and numbers', () => {
    const a = reasonCode('Writes `/a/b.txt` at /repo/x, line 12')
    expect(a).toMatch(/^other-[0-9a-f]{6}$/)
    expect(reasonCode('Writes `/c/d.txt` at /repo/y, line 99')).toBe(a)
    expect(reasonCode('Something else entirely')).not.toBe(a)
  })

  const use = (id, name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } })

  it('counts the guarded tool calls in a transcript once each, skipping Read and Grep', () => {
    const text = [use('t1', 'Bash'), use('t1', 'Bash'), use('t2', 'Edit'), use('t3', 'Read'), use('t4', 'mcp__x__list'), 'not json "tool_use"'].join('\n')
    expect(toolCalls(text).size).toBe(3)
  })

  it('at session end writes one allows row: calls, asks, denies and the rest let through, subagents counted', async () => {
    const project = mkdtempSync(join(tmpdir(), 'denied-end-'))
    const transcript = join(project, 's1.jsonl')
    writeFileSync(transcript, [use('a', 'Bash'), use('b', 'Bash'), use('c', 'Write')].join('\n'))
    mkdirSync(join(project, 's1', 'subagents'), { recursive: true })
    writeFileSync(join(project, 's1', 'subagents', 'agent-1.jsonl'), use('d', 'Bash'))
    const file = join(project, '.claude', 'guard-decisions.log')
    mkdirSync(join(project, '.claude'))
    writeFileSync(file, [['t', 'main', 'Bash', '{}', 'auto', 's1', '-', 'deny', 'x', 'psql'], ['t', 'main', 'Bash', '{}', 'auto', 's2', '-', 'ask', 'x', 'psql']].map((r) => r.join('\t')).join('\n') + '\n')
    await sessionEnd(JSON.stringify({ session_id: 's1', transcript_path: transcript, cwd: project, permission_mode: 'auto' }), { logPath: file, owns: false, now: Date.UTC(2026, 9, 31) })
    const last = readFileSync(file, 'utf8').trim().split('\n').pop().split('\t')
    expect(last).toHaveLength(10)
    expect(last.slice(5, 8)).toEqual(['s1', '-', 'allows'])
    expect(JSON.parse(last[3])).toEqual({ calls: 4, asks: 0, denies: 1, through: 3 })
    expect(last[9]).toBe('session-allows')
  })

  it('writes no allows row where the project owns the guard', async () => {
    const file = join(dir, '.claude', 'guard-decisions.log')
    await sessionEnd(JSON.stringify({ session_id: 's1', transcript_path: join(dir, 'none.jsonl') }), { logPath: file, owns: true })
    expect(existsSync(file)).toBe(false)
  })

  it('the step-aside leaves one row per session, not one per call', () => {
    const file = join(dir, '.claude', 'guard-decisions.log')
    const input = (sid) => JSON.stringify({ session_id: sid, tool_name: 'Bash', permission_mode: 'auto', tool_input: { command: 'ls' } })
    stepAsideOnce(input('s1'), { logPath: file })
    stepAsideOnce(input('s1'), { logPath: file })
    stepAsideOnce(input('s2'), { logPath: file })
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => l.split('\t'))
    expect(rows.map((r) => [r[5], r[7], r[9]])).toEqual([['s1', 'step-aside', 'step-aside'], ['s2', 'step-aside', 'step-aside']])
    expect(rows[0]).toHaveLength(10)
  })

  it('hooks.json runs guard-allows.mjs at SessionEnd, which writes the row as a process', () => {
    const hooks = JSON.parse(readFileSync(fileURLToPath(new URL('./hooks.json', import.meta.url)), 'utf8'))
    expect(hooks.hooks.SessionEnd[0].hooks[0].command).toMatch(/hooks\/guard-allows\.mjs"$/)
    const project = mkdtempSync(join(tmpdir(), 'denied-allows-'))
    writeFileSync(join(project, 's9.jsonl'), use('a', 'Bash'))
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./guard-allows.mjs', import.meta.url))], {
      input: JSON.stringify({ session_id: 's9', transcript_path: join(project, 's9.jsonl'), cwd: project }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(readFileSync(join(project, '.claude', 'guard-decisions.log'), 'utf8')).toContain('\tallows\t1 guarded calls: 1 let through')
  })
})
