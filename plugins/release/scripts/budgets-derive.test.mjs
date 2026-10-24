import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { derive, median, p90, propose, releaseRuns, withBudgets } from './budgets-derive.mjs'

const M = 1_000_000
const script = fileURLToPath(new URL('./budgets-derive.mjs', import.meta.url))

// A transcript folder with release sessions (by their first command) and one
// that isn't a release; each spawn a meta file and one usage line.
function folder(sessions) {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'))
  sessions.forEach(({ id, command, runs }, i) => {
    const ts = `2026-10-${String(10 + i).padStart(2, '0')}T08:00:00Z`
    writeFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify({ type: 'user', timestamp: ts, message: { content: `<command-name>${command}</command-name>` } })}\n`)
    const sub = join(dir, id, 'subagents')
    mkdirSync(sub, { recursive: true })
    runs.forEach(([type, tokens], j) => {
      writeFileSync(join(sub, `agent-${id}${j}.meta.json`), JSON.stringify({ agentType: type, description: `${type.replace(/^release:/, '')}: step` }))
      const e = { type: 'assistant', message: { id: `${id}-${j}`, model: 'claude-opus-x', usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content: [] } }
      writeFileSync(join(sub, `agent-${id}${j}.jsonl`), `${JSON.stringify(e)}\n`)
    })
  })
  return dir
}

const sessions = [
  { id: 'r1', command: '/release:captain-call', runs: [['release:jeff-winger', 6 * M], ['c-3po', 0.4 * M], ['mike-ehrmantraut', 28 * M]] },
  { id: 'r2', command: '/release:captain-call', runs: [['saul-goodman', 8 * M], ['c-3po', 0.6 * M], ['jeff-winger', 14 * M]] },
  { id: 'side', command: '/core:wilson', runs: [['c-3po', 9 * M]] },
  { id: 'r3', command: '/release:cattle-drive', runs: [['jeff-winger', 7 * M], ['mosbius-designs', 4 * M]] },
]

describe('budgets-derive', () => {
  it('takes the median and the nearest-rank 90th percentile', () => {
    expect(median([1, 3, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9)
    expect(p90([5])).toBe(5)
  })

  it('proposes p90 × 1.3 rounded up, capped at the ceiling but for the audits', () => {
    expect(propose('c-3po', 0.6 * M)).toBe(1 * M)
    expect(propose('jeff-winger', 14 * M)).toBe(15 * M)
    expect(propose('mike-ehrmantraut', 28 * M)).toBe(37 * M)
  })

  it('reads only release sessions, the last N', () => {
    const dir = folder(sessions)
    expect(releaseRuns(dir, 5).map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    expect(releaseRuns(dir, 2).map((r) => r.id)).toEqual(['r2', 'r3'])
    const rows = derive(releaseRuns(dir, 5))
    expect(rows.find((r) => r.role === 'jeff-winger')).toMatchObject({ runs: 3, median: 7 * M, p90: 14 * M, proposed: 15 * M })
    expect(rows.find((r) => r.role === 'c-3po').runs).toBe(2) // the wilson session's 9M isn't a release
  })

  it('writes budgets, keeping other keys and "*", and never a by-model role', () => {
    const rows = derive(releaseRuns(folder(sessions), 5))
    const out = JSON.parse(withBudgets(JSON.stringify({ plans: '~/p', budgets: { '*': '15M', 'the-playbook': '15M' } }), rows))
    expect(out.plans).toBe('~/p')
    expect(out.budgets['*']).toBe('15M')
    expect(out.budgets['the-playbook']).toBe('15M')
    expect(out.budgets['jeff-winger']).toBe('15M')
    expect(out.budgets['c-3po']).toBe('1M')
    expect(out.budgets['mosbius-designs']).toBeUndefined()
  })

  it('the script --write changes only the project kit.json, and refuses without one', () => {
    const dir = folder(sessions)
    const project = mkdtempSync(join(tmpdir(), 'derive-project-'))
    expect(() => execFileSync(process.execPath, [script, '--project', project, '--dir', dir, '--write'], { stdio: 'pipe' })).toThrow()
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude', 'kit.json'), JSON.stringify({ name: 'x', budgets: { '*': '15M' } }))
    const out = execFileSync(process.execPath, [script, '--project', project, '--dir', dir, '--write'], { encoding: 'utf8' })
    expect(out).toContain('| jeff-winger | 3 | 7.0M | 14.0M | 15M |')
    const kit = JSON.parse(readFileSync(join(project, '.claude', 'kit.json'), 'utf8'))
    expect(kit.name).toBe('x')
    expect(kit.budgets['saul-goodman']).toBe('11M')
  })
})
