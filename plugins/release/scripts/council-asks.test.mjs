import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { guardReason, guardReasons, guardTable, questionTally, questionsTable } from './council-asks.mjs'

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const ask = (id, ts) => ({ type: 'assistant', timestamp: ts, message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: {} }] } })
const cmd = (name, ts) => ({ type: 'user', timestamp: ts, message: { content: `<command-name>/${name}</command-name>` } })

describe('guardReason and guardReasons', () => {
  it('takes column 10\'s code when present, else column 9\'s text', () => {
    expect(guardReason(['t', 'a', 'Bash', '', '', '', '', 'ask', 'psql reaches a database', 'psql'])).toBe('psql')
    expect(guardReason(['t', 'a', 'Bash', '', '', '', '', 'ask', 'psql reaches a database'])).toBe('psql reaches a database')
    expect(guardReason(['t', 'a'])).toBe('(no reason)')
  })

  it('counts per agent, decision and reason in the window, most first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-asks-'))
    const log = join(dir, 'guard-decisions.log')
    const row = (ts, agent, decision, reason, code = '') => [ts, agent, 'Bash', '{}', 'auto', 's', '-', decision, reason, code].join('\t')
    writeFileSync(log, [row('2026-09-01T00:00:00Z', 'main', 'ask', 'old'), row('2026-10-20T00:00:00Z', 'the-playbook', 'ask', 'psql reaches a database', 'psql'), row('2026-10-21T00:00:00Z', 'the-playbook', 'ask', 'psql, other words', 'psql'), row('2026-10-21T00:00:00Z', 'main', 'deny', 'prod-db')].join('\n') + '\n')
    const table = guardTable(guardReasons([log, join(dir, 'missing.log')], Date.parse('2026-10-10')))
    expect(table.split('\n').slice(2)).toEqual(['| the-playbook | ask | psql | 2 |', '| main | deny | prod-db | 1 |'])
    expect(guardTable(new Map())).toContain('No guard rows')
  })

  it('counts allows as the calls let through, from the last allows row per session (kit 1.8)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-asks-'))
    const log = join(dir, 'guard-decisions.log')
    const allows = (sid, through) => ['2026-10-20T00:00:00Z', 'main', 'SessionEnd', JSON.stringify({ calls: through + 1, asks: 1, denies: 0, through }), 'auto', sid, '-', 'allows', 'why', 'session-allows'].join('\t')
    // s1 ended twice (resumed): only its last row counts. s2 adds 7. A cut row counts 0.
    const cut = allows('s3', 1).replace(/\{.*\}/, '{"calls":')
    writeFileSync(log, [allows('s1', 10), allows('s1', 40), allows('s2', 7), cut].join('\n') + '\n')
    const tally = guardReasons([log], Date.parse('2026-10-10'))
    expect([...tally]).toEqual([['main\tallows\tsession-allows', 47]])
  })
})

describe('questionTally', () => {
  it('counts every main transcript touched, per skill and session, each call once, and says how many are in the window', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-asks-q-'))
    writeFileSync(join(dir, 'aaaaaaaa-1.jsonl'), jsonl([cmd('captain-call', '2026-09-30T10:00:00Z'), ask('q0', '2026-09-30T10:01:00Z'), ask('q1', '2026-10-20T10:01:00Z'), ask('q1', '2026-10-20T10:01:00Z')]))
    writeFileSync(join(dir, 'bbbbbbbb-2.jsonl'), jsonl([cmd('release:captain-call', '2026-10-21T10:00:00Z'), ask('q2', '2026-10-21T10:01:00Z')]))
    writeFileSync(join(dir, 'cccccccc-3.jsonl'), jsonl([{ type: 'user', timestamp: '2026-10-22T00:00:00Z', message: { content: 'hi' } }, ask('q3', '2026-10-22T00:01:00Z')]))
    const q = questionTally([dir], Date.parse('2026-10-10'))
    expect(q.all).toBe(4)
    expect(q.inWindow).toBe(3)
    expect(Object.fromEntries(q.bySkill)).toEqual({ '/captain-call': 3, '(no command)': 1 })
    const t = questionsTable(q)
    expect(t).toContain('4 AskUserQuestion calls in every main transcript touched since the window\'s start (3 dated inside it); sub-agents left out')
    expect(t).toContain('| aaaaaaaa | /captain-call | 2 |')
  })
})
