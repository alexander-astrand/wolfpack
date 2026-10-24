import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startRows, startsOf, startsTable } from './council-starts.mjs'

const use = (id, initiation) => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'mcp__ccd_session__start_session', input: initiation ? { initiation } : {} }] } })
const result = (id, text, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] } })
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('startsOf', () => {
  it('counts starts by initiation, a repeated line once, and the refusals', () => {
    const entries = [
      { type: 'custom-title', customTitle: 'kit · release · 1.7' },
      use('t1', 'user_asked'),
      use('t1', 'user_asked'), // the same tool_use on a second line
      result('t1', 'Session started'),
      use('t2', 'own_initiative'),
      result('t2', 'This turn runs an automated event; propose the session instead.'),
      use('t3'),
      result('t3', 'boom', true),
    ]
    const row = startsOf(entries, 'abcdef123456')
    expect(row).toMatchObject({ title: 'kit · release · 1.7', calls: 3, refused: 2, byInitiation: { user_asked: 1, own_initiative: 1, '(none)': 1 } })
  })

  it('has no row for a session that started nothing', () => {
    expect(startsOf([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] } }], 's')).toBeNull()
  })
})

describe('startRows and startsTable', () => {
  it('reads every transcript in the window and totals the columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-starts-'))
    writeFileSync(join(dir, 'aaaaaaaa-1.jsonl'), jsonl([use('a', 'user_asked'), result('a', 'ok')]))
    writeFileSync(join(dir, 'bbbbbbbb-2.jsonl'), jsonl([use('b', 'own_initiative'), result('b', 'start sessions only on the user ask')]))
    writeFileSync(join(dir, 'cccccccc-3.jsonl'), jsonl([{ type: 'user', message: { content: 'hi' } }]))
    const rows = startRows([dir, join(dir, 'missing')], 0).sort((x, y) => x.id.localeCompare(y.id))
    expect(rows.map((r) => r.id)).toEqual(['aaaaaaaa-1', 'bbbbbbbb-2'])
    const table = startsTable(rows)
    expect(table).toContain('| Session | Title | own_initiative | user_asked | Refused |')
    expect(table).toContain('| aaaaaaaa | (none) | 0 | 1 | 0 |')
    expect(table).toContain('| **Total** | 2 sessions | 1 | 1 | 1 |')
  })

  it('leaves out transcripts last written before the window', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-starts-'))
    writeFileSync(join(dir, 'old.jsonl'), jsonl([use('a', 'user_asked')]))
    expect(startRows([dir], Date.now() + 60_000)).toEqual([])
  })
})
