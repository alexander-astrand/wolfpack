import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { deniedLine, run } from './denied-log.mjs'

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
  it('appends one line with six tab-separated fields, secrets masked', async () => {
    await run(JSON.stringify(SAMPLE), { logPath, now: Date.UTC(2026, 9, 4, 12, 0, 0) })
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const f = lines[0].split('\t')
    expect(f).toHaveLength(6)
    expect(f[0]).toBe('2026-10-04T12:00:00.000Z')
    expect(f.slice(1, 3)).toEqual(['saul-goodman', 'Bash'])
    expect(f[3]).toContain('curl')
    expect(f[3]).not.toContain('abcdefghijklmnop')
    expect(f[3]).not.toContain('sb' + 'p_123456789012')
    expect(f.slice(4)).toEqual(['auto', 'sess-9'])
  })

  it('names the main session `main` and cuts the input to 200 characters', () => {
    const line = deniedLine({ ...SAMPLE, agent_type: undefined, tool_input: { command: 'x'.repeat(500) } }, { mask: (s) => s })
    const f = line.split('\t')
    expect(f[1]).toBe('main')
    expect(f[3]).toHaveLength(200)
  })

  it('masks a 160k-character input well under a second', async () => {
    const { maskSecrets } = await import('./guard-production.mjs')
    const started = Date.now()
    const f = deniedLine({ ...SAMPLE, tool_input: { command: 'aKEY'.repeat(40000) } }, { mask: maskSecrets }).split('\t')
    expect(Date.now() - started).toBeLessThan(500)
    expect(f[3].length).toBeLessThanOrEqual(200)
  })

  it('without the guard, logs only the raw head cut to 80', () => {
    const f = deniedLine({ ...SAMPLE, tool_input: { command: 'y'.repeat(500) } }, { mask: null }).split('\t')
    expect(f[3]).toHaveLength(80)
  })

  it('keeps tabs and newlines in the input from splitting the line', () => {
    const line = deniedLine({ ...SAMPLE, tool_input: 'a\tb\nc' }, { mask: (s) => s })
    expect(line.split('\t')).toHaveLength(6)
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
