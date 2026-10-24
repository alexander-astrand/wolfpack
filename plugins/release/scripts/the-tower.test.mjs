import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fit, hankBudget, meterShares, planHeadline, planLine, sessionLine, statusLine, weekLine } from './the-tower.mjs'

const dir = mkdtempSync(join(tmpdir(), 'the-tower-'))
const usage = (n) => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: n, output_tokens: 0 })
const msg = (id, model, n) => JSON.stringify({ type: 'assistant', message: { id, model, usage: usage(n), content: [] } })
const transcript = join(dir, 'sess-1.jsonl')
// Two lines of one message (counted once), then a Fable message.
writeFileSync(transcript, `${[msg('a', 'claude-opus-x', 23e6), msg('a', 'claude-opus-x', 23e6), msg('b', 'claude-fable-x', 4e6)].join('\n')}\n`)
const meterNow = join(dir, 'meter-now.json')
const saved = (at, pct) => writeFileSync(meterNow, JSON.stringify({ at, rate_limits: [{ kind: 'seven_day', percentUsed: pct, resetsAt: '2026-10-24T10:00:00Z' }] }))

describe('the session part', () => {
  it('splits by model, each by the one meter figure', () => {
    const { by, total } = meterShares({ opus: 23e6, fable: 4e6 })
    expect(by.opus).toBe(0.5) // 23M of 46M a point
    expect(by.fable).toBe(0.5) // Fable measured at 8M a point
    expect(total).toBe(1)
    expect(sessionLine({ opus: 23e6, fable: 4e6 })).toBe('session 27.0M ≈1.0% wk (opus 0.5 fable 0.5)')
  })

  it('takes kit.json meter.tokensPerPoint over the default', () => {
    expect(sessionLine({ opus: 23e6 }, { meter: { tokensPerPoint: { opus: 23e6 } } })).toBe('session 23.0M ≈1.0% wk')
  })
})

describe('the week part', () => {
  it('shows the input\'s live week first', () => {
    expect(weekLine({ rate_limits: { seven_day: { used_percentage: 41.6 } } }, false, meterNow)).toBe('week 42%')
  })

  it('falls back to meter-now.json, marked ~ when stale, never a meter log', () => {
    const now = Date.parse('2026-10-17T18:00:00Z')
    saved('2026-10-17T17:59:00Z', 6)
    expect(weekLine({}, false, meterNow, now)).toBe('week 6%')
    saved('2026-10-17T16:00:00Z', 6)
    expect(weekLine({}, false, meterNow, now)).toBe('week ~6%')
    expect(weekLine({}, false, join(dir, 'missing.json'), now)).toBe(null)
  })
})

describe('the line', () => {
  it('carries session and week, under 80 columns', () => {
    saved(new Date().toISOString(), 12)
    const line = statusLine({ transcript_path: transcript, cwd: dir }, { cacheDir: dir, meterNow })
    expect(line).toBe('session 27.0M ≈1.0% wk (opus 0.5 fable 0.5) · week 12%')
    expect(line.length).toBeLessThan(80)
  })

  it('drops the link, Hank and the toast before the week', () => {
    const line = fit({ session: 'session 27.0M ≈1.0% wk (opus 0.5 fable 0.5)', link: 'link 2/2', hank: 'Hank: chris-de-kok 3.1/10M', toast: null, week: 'week 12%' })
    expect(line).toBe('session 27.0M ≈1.0% wk (opus 0.5 fable 0.5) · week 12%')
  })
})

describe('the plan part', () => {
  const plans = mkdtempSync(join(tmpdir(), 'the-tower-plans-'))
  writeFileSync(join(plans, 'V2.3.md'), '# V2.3\n\nSome text.\n\n**Expected: ≈ 90M** (20 commits × 3M + look + deploy)\nExpected: ≈ 500M\n')
  writeFileSync(join(plans, 'kit-1.7.md'), 'Expected: ≈ 190M, cap tag ≈ 250M\n')
  writeFileSync(join(plans, 'V2.4.md'), '≈ 190M expected\n')

  it('reads the first Expected line of V<version>.md, or the kit\'s kit-<version>.md', () => {
    expect(planHeadline('V2.3', { plans })?.tokens).toBe(90e6)
    expect(planHeadline('kit-1.7', { plans })?.tokens).toBe(190e6)
    expect(planHeadline('V2.4', { plans })).toBe(null)
    expect(planHeadline('V9.9', { plans })).toBe(null)
  })

  it('prints spent over the headline, and nothing without one', () => {
    expect(planLine({ opus: 27e6, fable: 0.9e6 }, { tokens: 90e6 })).toBe('plan 0.31×')
    expect(planLine({ opus: 27e6 }, null)).toBe(null)
  })
})

describe('the Hank part', () => {
  it('reads the budget the way Hank does, not the old 25M defaults', () => {
    expect(hankBudget({ agentType: 'release:saul-goodman', description: 'saul-goodman: a step' })).toBe(15e6)
    expect(hankBudget({ agentType: 'c-3po', description: 'c-3po: the PR' })).toBe(4e6)
    expect(hankBudget({ agentType: 'jesse-pinkman', description: 'jesse-pinkman: docs' })).toBe(8e6)
    expect(hankBudget({ agentType: 'jesse-pinkman', description: 'jesse-pinkman: docs [budget 3M]' })).toBe(3e6)
    expect(hankBudget({ agentType: 'c-3po' }, { budget: 2e6 })).toBe(2e6)
  })

  it('takes kit.json budgets over the built-in table', () => {
    const project = mkdtempSync(join(tmpdir(), 'the-tower-kit-'))
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude', 'kit.json'), JSON.stringify({ budgets: { 'c-3po': '6M', '*': '9M' } }))
    expect(hankBudget({ agentType: 'c-3po' }, {}, project)).toBe(6e6)
    expect(hankBudget({ agentType: 'someone-new' }, {}, project)).toBe(9e6)
  })
})
