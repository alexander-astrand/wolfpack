import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pick, readOpenLogs } from './leon-pick.mjs'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const ago = (h) => new Date(NOW - h * 3600000).toISOString()
const ROOT = '/work/app'
const base = { sessionId: 's1', title: 'hutzup · release · 2.14.9', cwd: ROOT, lastActivityAt: ago(30) }
const run = (over, extra = {}) =>
  pick({ sessions: [{ ...base, ...over }], now: NOW, self: 'me', worktrees: [ROOT, '/work/wt', `${ROOT}/.claude/worktrees`], openLogs: [], ...extra })
const reason = (r) => r.left[0]?.reason

describe('leon-pick', () => {
  it('archives an old, titled session in the repo, with the idle hours from the clock', () => {
    const r = run({})
    expect(r.archive).toEqual([{ sessionId: 's1', title: base.title, idle: '30.0' }])
    expect(r.left).toEqual([])
  })

  it('leaves 23.9 h and archives exactly 24 h', () => {
    expect(reason(run({ lastActivityAt: ago(23.9) }))).toBe('idle <24 h')
    expect(run({ lastActivityAt: ago(24) }).archive).toHaveLength(1)
  })

  it('leaves a missing or invalid date', () => {
    expect(reason(run({ lastActivityAt: undefined }))).toBe('idle <24 h')
    expect(reason(run({ lastActivityAt: 'soon' }))).toBe('idle <24 h')
  })

  it('wants exactly three non-empty title parts', () => {
    expect(reason(run({ title: 'Hutzup · daily note (groundhog-day)' }))).toBe('untitled')
    expect(reason(run({ title: 'a · b · c · d' }))).toBe('untitled')
    expect(reason(run({ title: 'a ·  · c' }))).toBe('untitled')
    expect(reason(run({ title: undefined }))).toBe('untitled')
  })

  it('accepts the repo, its worktrees and originCwd, and leaves other projects', () => {
    expect(run({ cwd: '/work/wt' }).archive).toHaveLength(1)
    expect(run({ cwd: `${ROOT}/.claude/worktrees/lane-a` }).archive).toHaveLength(1)
    expect(run({ cwd: undefined, originCwd: ROOT }).archive).toHaveLength(1)
    expect(reason(run({ cwd: '/work/other' }))).toBe('other project')
    expect(reason(run({ cwd: '/work/app-two' }))).toBe('other project')
    expect(reason(run({ cwd: undefined }))).toBe('other project')
  })

  it('leaves self, running, pinned, unread and already archived sessions', () => {
    expect(reason(run({ sessionId: 'me' }))).toBe('self')
    expect(reason(run({ isRunning: true }))).toBe('running')
    expect(reason(run({ pinned: true }))).toBe('pinned')
    expect(reason(run({ unread: true }))).toBe('unread')
    expect(reason(run({ isArchived: true }))).toBe('archived')
  })

  it('an open chain log protects by id or title, a closed one does not', () => {
    expect(reason(run({}, { openLogs: ['| s1 | other |'] }))).toBe('open chain')
    expect(reason(run({}, { openLogs: [`| x | ${base.title} |`] }))).toBe('open chain')
    expect(run({}, { openLogs: [] }).archive).toHaveLength(1)
  })
})

describe('leon-pick on the real list shape', () => {
  const sessions = JSON.parse(readFileSync(new URL('./leon-pick.fixture.json', import.meta.url), 'utf8'))
  const now = Date.parse('2026-10-06T12:00:00Z')
  const r = pick({ sessions, now, self: 'none', worktrees: ['/Users/x/hutzup', '/Users/x/hutzup/.claude/worktrees'], openLogs: [] })

  it('archives the old titled ones in the repo and leaves the rest with a reason', () => {
    expect(r.archive.map((a) => a.title)).toEqual(['hutzup · wrap · 2.14.9.2', 'hutzup · review · 2.14.8'])
    expect(r.left.map((l) => [l.title, l.reason])).toEqual([
      ['Claude code mods exploration', 'untitled'],
      ['Meter Log', 'other project'],
      ['hutzup · release · 2.14.9.2.1', 'running'],
      ['hutzup · plan · v3 horizon', 'pinned'],
    ])
  })
})

describe('readOpenLogs', () => {
  it('judges a chain log by its last marker; no marker means open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plans-'))
    const put = (f, s) => writeFileSync(join(dir, f), s)
    put('V1-chain-log.md', 'running\n| s |')
    put('V2-chain-log.md', 'CHAIN STARTED\nCHAIN DONE')
    put('V3-chain-log.md', 'CHAIN STOPPED\n')
    put('V4-chain-log.md', 'CHAIN STOPPED\nCHAIN RESUMED\n')
    put('V5.md', 'no log')
    mkdirSync(join(dir, 'archive'))
    const open = readOpenLogs(dir)
    expect(open).toHaveLength(2)
    expect(open.some((o) => o.startsWith('running'))).toBe(true)
    expect(open.some((o) => o.includes('RESUMED'))).toBe(true)
  })
})
