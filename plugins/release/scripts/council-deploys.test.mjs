import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deployRuns, deploysTable, runsIn } from './council-deploys.mjs'

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const cmd = (arg, ts) => ({ type: 'user', timestamp: ts, message: { content: `<command-name>/release:one-ring</command-name>\n<command-args>${arg}</command-args>` } })
// deploy.mjs's costLine output, as kit-1.8.patch's test pins it.
const COST = 'COST: 15.0 min this run; longest wait 10.0 min, until "CI green on bbbbbbb."; baseline 4.5M tokens / 12 min (no migrations). Tokens: /car-wash or usage.mjs --timeline.'
const out = (text, ts) => ({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', content: [{ type: 'text', text }] }] } })

describe('runsIn', () => {
  it('reads each run\'s argument, its DONE or STOP line and its cost line', () => {
    const runs = runsIn([
      cmd('1.2', '2026-10-20T10:00:00Z'),
      out('backup ok\nSTOP ci: tests red\nNEXT: fix', '2026-10-20T10:05:00Z'),
      { type: 'assistant', timestamp: '2026-10-20T10:29:00Z', message: { content: [{ type: 'text', text: 'Cost: 6.2M against the 5-9M baseline.' }] } },
      out(`${COST}\nDONE: 1.2 live`, '2026-10-20T10:30:00Z'),
      cmd('1.3', '2026-10-21T10:00:00Z'),
    ], 'abcd1234')
    expect(runs).toEqual([
      { session: 'abcd1234', start: '2026-10-20T10:00:00Z', arg: '1.2', ended: 'STOP ci: tests red', cost: COST },
      { session: 'abcd1234', start: '2026-10-21T10:00:00Z', arg: '1.3', ended: null, cost: null },
    ])
  })

  it('skips the injected skill body that follows the command (review MUST 2)', () => {
    const body = 'Base directory for this skill: /x/plugins/release/skills/one-ring\n\nA no-migration deploy costs about 4.5M tokens.\nDONE: <version> live\nCOST: 12.0 min this run; baseline 4.5M tokens / 12 min'
    const runs = runsIn([
      cmd('1.4', '2026-10-22T10:00:00Z'),
      { type: 'user', isMeta: true, timestamp: '2026-10-22T10:00:01Z', message: { content: [{ type: 'text', text: body }] } },
      { type: 'user', timestamp: '2026-10-22T10:00:02Z', message: { content: body } },
      out('STOP ci: red', '2026-10-22T10:05:00Z'),
    ], 'abcd1234')
    expect(runs[0].ended).toBe('STOP ci: red')
    expect(runs[0].cost).toBeNull()
  })
})

describe('deployRuns and deploysTable', () => {
  it('keeps runs in the window and prints a table with a count line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-deploys-'))
    writeFileSync(join(dir, 'aaaa1111.jsonl'), jsonl([cmd('0.9', '2026-09-01T00:00:00Z'), cmd('1.2', '2026-10-20T10:00:00Z'), out('DONE: 1.2 live', '2026-10-20T10:30:00Z')]))
    const t = deploysTable(deployRuns([dir], Date.parse('2026-10-10')))
    expect(t).toContain('| aaaa1111 | 10-20 10:00 | 1.2 | DONE: 1.2 live | – |')
    expect(t).toContain('1 runs, 1 reached DONE, 0 printed a cost line.')
    expect(deploysTable([])).toBe('No `/one-ring` runs in the window.')
  })
})
