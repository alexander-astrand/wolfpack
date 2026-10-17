import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { roleTotals, tableOf } from './council-roles.mjs'

const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 }
const msg = (id, block, ts, model = 'claude-opus-x') => ({ type: 'assistant', timestamp: ts, message: { id, model, usage, content: [block] } })
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('roleTotals', () => {
  it('sums the navigator and each named agent, and counts a forked copy once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-roles-'))
    const nav = [msg('n1', { type: 'tool_use', name: 'Agent', input: {} }, '2026-10-17T10:00:00Z')]
    writeFileSync(join(dir, 's1.jsonl'), jsonl(nav))
    writeFileSync(join(dir, 's2.jsonl'), jsonl(nav)) // a byte-identical fork
    mkdirSync(join(dir, 's1', 'subagents'), { recursive: true })
    writeFileSync(join(dir, 's1', 'subagents', 'agent-a.jsonl'), jsonl([msg('a1', { type: 'tool_use', name: 'Read', input: {} }, '2026-10-17T10:01:00Z', 'claude-sonnet-x'), msg('a2', { type: 'text', text: 'done' }, '2026-10-17T10:03:00Z', 'claude-sonnet-x')]))
    writeFileSync(join(dir, 's1', 'subagents', 'agent-a.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'r2-d2: facts' }))
    const rows = roleTotals([dir], Date.parse('2026-10-01'))
    const by = Object.fromEntries(rows.map((r) => [r.role, r]))
    expect(by.navigator).toMatchObject({ runs: 1, tokens: 100, calls: 1 })
    expect(by['r2-d2']).toMatchObject({ runs: 1, tokens: 200, calls: 1, minutes: 2 })
    expect(tableOf(rows)).toContain('| r2-d2 | 1 | 0.0M | 67% | 1 | 2 | sonnet |')
  })
})
