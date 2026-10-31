import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { costLine, editBody, parseArgs, parseBudgetArg, parseExpected, pickRow, run, sessionTotal, stepsFileFor, updatePr } from './step-done.mjs'

// A release session: the navigator (1M) and two spawns, jeff-winger (7M,
// tagged 12M) and c-3po (1.1M, stopped by Hank).
const dir = mkdtempSync(join(tmpdir(), 'step-done-'))
const sub = join(dir, 'dddd4444', 'subagents')
mkdirSync(sub, { recursive: true })
const spend = (id, tokens, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-x', usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content: [] } })
const user = (content) => ({ type: 'user', message: { content } })
const jsonl = (entries) => `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`
writeFileSync(join(dir, 'dddd4444.jsonl'), jsonl([spend('nav', 1_000_000, '2026-10-24T08:00:00Z')]))
const spawn = (id, meta, entries) => {
  writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify(meta))
  writeFileSync(join(sub, `agent-${id}.jsonl`), jsonl(entries))
}
spawn('a1', { agentType: 'release:jeff-winger', description: 'jeff-winger: step 3 hank table [budget 12M]' }, [user('order'), spend('m1', 7_000_000, '2026-10-24T10:00:00Z')])
spawn('a2', { agentType: 'c-3po', description: 'c-3po: README [budget 1M]' }, [
  user('order'),
  spend('m2', 1_100_000, '2026-10-24T09:00:00Z'),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: 'Budget reached: report what you did. (Hank: 110% (1.1M of 1.0M) used.)' }] } },
])
const budgets = { parseBudget: (d) => (/\[budget (\d+)M\]/.exec(d ?? '')?.[1] ?? 0) * 1e6 || null, followUpBudget: () => null, defaultFor: () => 2e6 }
const plan = join(dir, 'V2.3.md')
writeFileSync(plan, '# V2.3\n\nExpected: ≈ 40M (cap 52M)\n')

const BODY = [
  'Plan steps:',
  '- [ ] step 3 hank table',
  '- [ ] step 4 tower',
  '',
  '## Budget',
  '',
  '| Agent | Step | Budget | Used | Stopped by Hank |',
  '|---|---|---|---|---|',
  '| saul-goodman | step 2 | 8.0M | 4.0M (50%) | no |',
  '',
  '## Notes for review',
  '',
  '- an earlier note',
  '',
  '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
].join('\n')

// A fake gh: a body in memory, an optional hook that moves it between reads.
function fakeGh(body, { onView } = {}) {
  const state = { body, views: 0, edits: [] }
  state.gh = (args, input) => {
    if (args[1] === 'view') {
      state.views += 1
      onView?.(state)
      return JSON.stringify({ body: state.body })
    }
    if (args[1] === 'edit') {
      expect(args).toEqual(['pr', 'edit', '12', '--body-file', '-'])
      state.edits.push(input)
      state.body = input
      return ''
    }
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
  return state
}

const opts = (extra) => parseArgs(['jeff-winger', '--session', 'dddd4444', '--dir', dir, '--hank-log', join(dir, 'none.log'), ...extra])

describe('parsers', () => {
  it('reads budgets and the plan headline', () => {
    expect(parseBudgetArg('15M')).toBe(15e6)
    expect(parseBudgetArg('800k')).toBe(8e5)
    expect(parseBudgetArg('x')).toBeNull()
    expect(parseExpected('Cap 52M\nExpected: ≈ 260M\n')).toBe(260e6)
    expect(parseExpected('**Expected:** ~1.2B')).toBe(1.2e9)
    expect(parseExpected('Expected = commits x rate')).toBeNull()
    expect(stepsFileFor('/p/V2.3.md')).toBe('/p/V2.3-steps.tsv')
    expect(costLine(13e6, 40e6)).toBe('Spent: 13.0M of 40.0M expected (33 %)')
  })

  it('wants a tag with a cheaper line, and a known tag', () => {
    expect(() => opts(['--cheaper', 'x'])).toThrow(/--tag/)
    expect(() => opts(['--cheaper', 'x', '--tag', 'maybe'])).toThrow(/one of/)
    expect(() => parseArgs(['jeff-winger'])).toThrow(/--session/)
  })

  it('picks the latest spawn of a name, or one by agent id', () => {
    const rows = [{ agent: 'x', agentId: 'aaa111' }, { agent: 'x', agentId: 'bbb222' }]
    expect(pickRow(rows, 'x').agentId).toBe('bbb222')
    expect(pickRow(rows, 'aaa111').agentId).toBe('aaa111')
    expect(pickRow(rows, 'y')).toBeNull()
  })

  it("totals the whole session, navigator and agents", () => {
    expect(sessionTotal(dir, 'dddd4444')).toBe(9_100_000)
  })
})

describe('editBody', () => {
  const changes = {
    budgetRow: '| jeff-winger | step 3 hank table | 12.0M | 7.0M (58%) | no |',
    cheaper: '- `route` jeff-winger (step 3 hank table): Sonnet would do',
    tick: 'step 3 hank table',
    cost: 'Spent: 9.1M of 40.0M expected (23 %)',
  }

  it('adds the row after the table, the note in its section, ticks one box, puts the cost line on top', () => {
    const { body, notes } = editBody(BODY, changes)
    const lines = body.split('\n')
    expect(lines[0]).toBe(changes.cost)
    expect(lines).toContain('- [x] step 3 hank table')
    expect(lines).toContain('- [ ] step 4 tower')
    expect(lines.indexOf(changes.budgetRow)).toBe(lines.indexOf('| saul-goodman | step 2 | 8.0M | 4.0M (50%) | no |') + 1)
    expect(lines.indexOf(changes.cheaper)).toBe(lines.indexOf('- an earlier note') + 1)
    expect(lines.at(-1)).toMatch(/^🤖 Generated/)
    expect(notes).toEqual([])
  })

  it('refreshes an existing cost line rather than adding a second', () => {
    const once = editBody(BODY, { cost: 'Spent: 1.0M of 40.0M expected (3 %)' }).body
    const twice = editBody(once, { cost: 'Spent: 2.0M of 40.0M expected (5 %)' }).body
    expect(twice.match(/^Spent:/gm)).toHaveLength(1)
    expect(twice).toContain('(5 %)')
  })

  it('makes the sections when the body has none, above the footer', () => {
    const { body } = editBody('- [ ] a\n\n🤖 Generated with x', { budgetRow: changes.budgetRow, cheaper: changes.cheaper })
    expect(body).toMatch(/## Budget\n\n\| Agent .*\n\|---.*\n\| jeff-winger/)
    expect(body.indexOf('## Notes for review')).toBeLessThan(body.indexOf('🤖'))
  })

  it('says so when the box is missing or ambiguous, and ticks nothing', () => {
    expect(editBody(BODY, { tick: 'step 9' }).notes[0]).toMatch(/no box/)
    const r = editBody(BODY, { tick: 'step' })
    expect(r.notes[0]).toMatch(/2 boxes/)
    expect(r.body).not.toContain('[x]')
  })
})

describe('updatePr (the M11 tick race)', () => {
  it('writes once when nobody moved the body', () => {
    const g = fakeGh(BODY)
    const r = updatePr({ gh: g.gh, pr: 12, changes: { tick: 'step 3' } })
    expect(r).toMatchObject({ written: true, retried: false })
    expect(g.edits).toHaveLength(1)
    expect(g.body).toContain('- [x] step 3 hank table')
  })

  it("keeps another lane's tick that landed between our read and write", () => {
    const g = fakeGh(BODY, {
      onView: (s) => {
        if (s.views === 2) s.body = s.body.replace('- [ ] step 4 tower', '- [x] step 4 tower')
      },
    })
    const r = updatePr({ gh: g.gh, pr: 12, changes: { tick: 'step 3' } })
    expect(r.retried).toBe(true)
    expect(g.body).toContain('- [x] step 3 hank table')
    expect(g.body).toContain('- [x] step 4 tower')
  })

  it('gives up without writing when the body keeps moving', () => {
    const g = fakeGh(BODY, { onView: (s) => (s.body += '\nmore') })
    expect(() => updatePr({ gh: g.gh, pr: 12, changes: { tick: 'step 3' } })).toThrow(/changed twice/)
    expect(g.edits).toHaveLength(0)
  })

  it('--dry reads but never writes', () => {
    const g = fakeGh(BODY)
    const r = updatePr({ gh: g.gh, pr: 12, changes: { tick: 'step 3' }, dry: true })
    expect(r.body).toContain('- [x] step 3')
    expect(g.edits).toHaveLength(0)
  })
})

describe('run', () => {
  const quiet = () => {}
  const now = new Date('2026-10-24T12:00:00Z')

  it('appends the steps row and makes one PR edit with row, note, tick and cost', () => {
    const g = fakeGh(BODY)
    run(opts(['--step', 'step 3 hank table', '--budget', '12M', '--pr', '12', '--cheaper', 'Sonnet would do', '--tag', 'route', '--tick', 'step 3 hank', '--plan', plan]), { budgets, gh: g.gh, now, log: quiet })
    const tsv = readFileSync(join(dir, 'V2.3-steps.tsv'), 'utf8').trim().split('\n')
    expect(tsv[0]).toBe('when\tagent\tstep\tbudget\tused\tstopped\ttag\tcheaper')
    expect(tsv[1]).toBe('2026-10-24T12:00Z\tjeff-winger\tstep 3 hank table\t12.0M\t7.0M\tno\troute\tSonnet would do')
    expect(g.edits).toHaveLength(1)
    expect(g.body).toContain('| jeff-winger | step 3 hank table | 12.0M | 7.0M (58%) | no |')
    expect(g.body).toContain('- `route` jeff-winger (step 3 hank table): Sonnet would do')
    expect(g.body).toContain('- [x] step 3 hank table')
    expect(g.body.split('\n')[0]).toBe('Spent: 9.1M of 40.0M expected (23 %)')
  })

  it("reads Hank's stop and the agent's own tag when no --budget is given; no --pr, no gh", () => {
    const r = run(parseArgs(['c-3po', '--session', 'dddd4444', '--dir', dir, '--hank-log', join(dir, 'none.log'), '--plan', plan]), {
      budgets,
      gh: () => {
        throw new Error('gh called')
      },
      now,
      log: quiet,
    })
    expect(r.line).toBe('2026-10-24T12:00Z\tc-3po\tREADME\t1.0M\t1.1M\tyes\t\t')
  })

  it('--dry writes neither the steps file nor the PR', () => {
    const dryPlan = join(dir, 'V9.md')
    writeFileSync(dryPlan, 'Expected: ≈ 10M\n')
    const g = fakeGh(BODY)
    const out = []
    run(opts(['--pr', '12', '--plan', dryPlan, '--dry']), { budgets, gh: g.gh, now, log: (s) => out.push(s) })
    expect(g.edits).toHaveLength(0)
    expect(() => readFileSync(join(dir, 'V9-steps.tsv'))).toThrow()
    expect(out.join('\n')).toContain('Spent: 9.1M of 10.0M expected (91 %)')
  })

  it('names a missing agent', () => {
    expect(() => run(parseArgs(['troy-and-abed', '--session', 'dddd4444', '--dir', dir]), { budgets, log: quiet })).toThrow(/No spawn of "troy-and-abed"/)
  })
})
