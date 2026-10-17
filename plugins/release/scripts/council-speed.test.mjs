import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropSeen, sessionRow, startCommand } from './council-speed.mjs'

const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 }
const msg = (id, block, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-x', usage, content: [block] } })
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('dropSeen', () => {
  it('keeps every line of a message in its own file and drops it from a later file', () => {
    const seen = new Set()
    const a = [msg('m1', { type: 'text', text: 'a' }), msg('m1', { type: 'tool_use', name: 'Read', input: {} })]
    expect(dropSeen(a, seen)).toHaveLength(2)
    const b = [msg('m1', { type: 'text', text: 'a' }), msg('m2', { type: 'text', text: 'b' }), { type: 'user', message: { content: 'hi' } }]
    expect(dropSeen(b, seen).map((e) => e.message.id ?? 'user')).toEqual(['m2', 'user'])
  })
})

describe('sessionRow with a forked copy', () => {
  it('counts the copied messages once across two transcripts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-speed-'))
    const start = { type: 'user', timestamp: '2026-10-17T10:00:00Z', message: { content: '<command-name>/jedi-council</command-name>' } }
    const orig = [start, msg('m1', { type: 'text', text: 'a' }, '2026-10-17T10:01:00Z')]
    writeFileSync(join(dir, 'aaaa1111.jsonl'), jsonl(orig))
    writeFileSync(join(dir, 'bbbb2222.jsonl'), jsonl([...orig, msg('m2', { type: 'text', text: 'b' }, '2026-10-17T10:05:00Z')]))
    const seen = new Set()
    const a = sessionRow(dir, 'aaaa', seen)
    const b = sessionRow(dir, 'bbbb', seen)
    expect(a.tokens).toBe(100)
    expect(b.tokens).toBe(100)
    expect(a.command).toBe('/jedi-council')
  })
})

describe('startCommand', () => {
  it('reads a typed slash command', () => {
    expect(startCommand([{ type: 'user', message: { content: '/captain-call 1.5' } }])).toBe('/captain-call')
  })

  it("counts the old name /maverick as /captain-call (kit 1.5's rename)", () => {
    expect(startCommand([{ type: 'user', message: { content: '/maverick 1.4' } }])).toBe('/captain-call')
    expect(startCommand([{ type: 'user', message: { content: '<command-name>/release:maverick</command-name>' } }])).toBe('/release:captain-call')
    expect(startCommand([{ type: 'user', message: { content: '/maverick-ish 1' } }])).toBe('/maverick-ish')
  })

  it("reads a later command in brackets, as usage.mjs's sessionCommand does, and renames it there too", () => {
    const later = [
      { type: 'user', message: { content: 'run the release' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'release:maverick' } }] } },
    ]
    expect(startCommand(later)).toBe('(/release:captain-call)')
  })
})
