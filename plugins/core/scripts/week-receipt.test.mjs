import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cachedReceipt, cliReceipt, isoWeek, markdown, projectOfCwd, projectOfFolder, receipt, weekRange } from './week-receipt.mjs'

const line = (id, model, ts, cwd, tokens) =>
  JSON.stringify({ type: 'assistant', cwd, timestamp: ts, message: { id, model, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 } } })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'week-receipt-'))
  const projects = join(root, 'projects')
  const app = join(root, 'Desktop', 'App')
  mkdirSync(join(app, '.claude'), { recursive: true })
  writeFileSync(join(app, '.claude', 'kit.json'), JSON.stringify({ project: { name: 'MyApp' } }))
  const write = (folder, name, lines) => {
    mkdirSync(join(projects, folder), { recursive: true })
    writeFileSync(join(projects, folder, name), `${lines.join('\n')}\n`)
  }
  // 2026-W43 runs Mon 19 Oct to Sun 25 Oct.
  write('-x-Desktop-App', 'a.jsonl', [
    line('m1', 'claude-opus-5-5', '2026-10-20T10:00:00', app, 46e6),
    line('m1', 'claude-opus-5-5', '2026-10-20T10:00:00', app, 46e6), // same message, second block
    line('m0', 'claude-opus-5-5', '2026-10-12T10:00:00', app, 99e6), // last week
  ])
  // A worktree of the same project, and a forked copy of a.jsonl's message.
  write('-x-Desktop-App--claude-worktrees-w1', 'b.jsonl', [
    line('m2', 'claude-sonnet-5', '2026-10-21T10:00:00', join(app, '.claude', 'worktrees', 'w1'), 10e6),
    line('m1', 'claude-opus-5-5', '2026-10-20T10:00:00', app, 46e6),
  ])
  // No cwd: named from the folder.
  write('-x-pylos', 'c.jsonl', [line('m3', 'claude-opus-5-5', '2026-10-22T10:00:00', undefined, 23e6)])
  // A subagent's transcript counts to its session's project.
  mkdirSync(join(projects, '-x-Desktop-App', 'a', 'subagents'), { recursive: true })
  writeFileSync(join(projects, '-x-Desktop-App', 'a', 'subagents', 's.jsonl'), `${line('m4', 'claude-opus-5-5', '2026-10-22T11:00:00', app, 23e6)}\n`)
  // An old file the week skips without reading.
  write('-x-old', 'd.jsonl', [line('m5', 'claude-opus-5-5', '2026-10-20T10:00:00', '/old', 1e9)])
  utimesSync(join(projects, '-x-old', 'd.jsonl'), new Date('2026-01-01'), new Date('2026-01-01'))
  return { root, projects }
}

describe('week-receipt', () => {
  it('finds the ISO week and its Monday', () => {
    expect(isoWeek(new Date(2026, 9, 24))).toBe('2026-W43')
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53')
    const { start, end } = weekRange('2026-W43')
    expect(new Date(start)).toEqual(new Date(2026, 9, 19))
    expect(new Date(end)).toEqual(new Date(2026, 9, 26))
    expect(() => weekRange('43')).toThrow(/yyyy-Www/)
  })

  it('names a project by its main checkout', () => {
    expect(projectOfCwd('/u/Desktop/Burrow/.claude/worktrees/x')).toBe('Burrow')
    expect(projectOfCwd('/u/Desktop/Burrow-lanes/e2c')).toBe('Burrow')
    expect(projectOfFolder('-Users-a-Desktop-hejtide--claude-worktrees-x')).toBe('hejtide')
    expect(projectOfFolder('-Users-a-pylos')).toBe('pylos')
  })

  it('tallies every folder once, by project, inside the week', () => {
    const { projects } = fixture()
    const r = receipt({ week: '2026-W43', projectsDir: projects, kit: null })
    const app = r.projects.find((p) => p.name === 'MyApp')
    expect(app.tokens).toBe(46e6 + 10e6 + 23e6)
    expect(app.folders).toHaveLength(2)
    expect(r.projects.find((p) => p.name === 'pylos').tokens).toBe(23e6)
    expect(r.projects.some((p) => p.name === 'old')).toBe(false)
    // Opus at 46M a point, plus the Sonnet slice at its own figure.
    expect(app.meterPct).toBeGreaterThan(1.5)
    expect(r.projects.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1)
    expect(markdown(r)).toMatch(/\| MyApp \| 79\.0M \| \d+% \| 2% \|/)
  })

  it('writes the receipt once and reads it after', () => {
    const { root, projects } = fixture()
    const cacheDir = join(root, 'cache')
    const first = cachedReceipt({ week: '2026-W43', projectsDir: projects, cacheDir, kit: null })
    expect(first.cached).toBeNull()
    const again = cachedReceipt({ week: '2026-W43', projectsDir: join(root, 'missing'), cacheDir, kit: null })
    expect(again.cached).toMatch(/2026-W43\.json$/)
    expect(again.totalTokens).toBe(first.totalTokens)
    expect(() => cachedReceipt({ week: '2026-W43', projectsDir: join(root, 'missing'), cacheDir, fresh: true })).toThrow(/Can't read/)
  })

  // Kit 1.7 review: --projects is another folder's count, so the shared cache stays out of it.
  it('skips the cache on the command line whenever --projects is given', () => {
    const { root, projects } = fixture()
    const cacheDir = join(root, 'cache')
    const r = cliReceipt({ week: '2026-W43', projectsDir: projects, cacheDir, kit: null })
    expect(r.cached).toBeNull()
    expect(existsSync(join(cacheDir, '2026-W43.json'))).toBe(false)
  })
})
