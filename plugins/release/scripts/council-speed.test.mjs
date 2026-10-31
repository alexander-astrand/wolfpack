import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropSeen, firstTurnEnd, isArtefact, sessionLabel, sessionRow, skillKey, startCommand, tableOf, typedPrompt } from './council-speed.mjs'

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

describe('sessionLabel and skillKey (one keying for the speed table and the cards)', () => {
  const title = (t) => ({ type: 'custom-title', customTitle: t })
  it('labels a session with no command by its last title', () => {
    const e = [{ type: 'user', message: { content: 'Kit 1.7, lane B2' } }, title('kit · build · b1'), title('kit · build · b2')]
    expect(sessionLabel(e)).toBe('title: kit · build · b2')
    expect(skillKey(sessionLabel(e))).toBe(null)
    expect(sessionLabel([{ type: 'user', message: { content: 'hi' } }])).toBe('(none)')
  })
  it('labels a release that started with /badger by its title, and keeps a real badger session', () => {
    const start = { type: 'user', message: { content: '<command-name>/core:badger</command-name>' } }
    expect(sessionLabel([start, title('hutzup · release · 3.4')])).toBe('title: hutzup · release · 3.4 (started /core:badger)')
    expect(sessionLabel([start, title('hutzup · side · badger dark mode')])).toBe('/core:badger')
  })
  it('keys a plugin prefix and a later command in brackets to the bare skill name', () => {
    expect(skillKey('/release:captain-call')).toBe('captain-call')
    expect(skillKey('(/core:memento)')).toBe('memento')
    expect(skillKey('(none)')).toBe(null)
  })
  it('shows the label and the card key in the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-speed-'))
    writeFileSync(join(dir, 'cccc3333.jsonl'), jsonl([{ type: 'user', timestamp: '2026-10-17T10:00:00Z', message: { content: 'brief' } }, title('kit · build · b2'), msg('m9', { type: 'text', text: 'a' }, '2026-10-17T10:01:00Z')]))
    expect(tableOf([sessionRow(dir, 'cccc')])).toContain('| cccc3333 | title: kit · build · b2 | – |')
  })
})

describe('the card-artefact flag (F22)', () => {
  const typed = (text, ts) => ({ type: 'user', timestamp: ts, message: { content: text } })
  it('ends the first turn at the second typed prompt, skipping tool results, injected bodies and notes', () => {
    const e = [
      typed('<command-name>/scrooge</command-name>', '2026-10-17T10:00:00Z'),
      { type: 'user', isMeta: true, timestamp: '2026-10-17T10:00:01Z', message: { content: 'skill body' } },
      { type: 'user', timestamp: '2026-10-17T10:00:05Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      typed('<task-notification>done</task-notification>', '2026-10-17T10:02:00Z'),
      typed('now run the release', '2026-10-17T10:05:00Z'),
    ]
    expect(typedPrompt(e[0])).toBe(true)
    expect(firstTurnEnd(e)).toBe(Date.parse('2026-10-17T10:05:00Z'))
    expect(firstTurnEnd(e.slice(0, 4))).toBe(Infinity)
  })
  it('flags a small skill whose session became a release, never a whole-session command or a small session', () => {
    expect(isArtefact({ skill: 'scrooge', tokens: 374e6, ownTokens: 11.5e6 })).toBe(true)
    expect(isArtefact({ skill: 'captain-call', tokens: 374e6, ownTokens: 1e6 })).toBe(false)
    expect(isArtefact({ skill: 'scrooge', tokens: 15e6, ownTokens: 1e6 })).toBe(false)
    expect(isArtefact({ skill: 'scrooge', tokens: 374e6, ownTokens: null })).toBe(false)
  })
  it('measures the own turn from a transcript and marks the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-speed-'))
    const big = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 30e6, output_tokens: 0 }
    const m = (id, ts, u = usage) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-x', usage: u, content: [{ type: 'text', text: 'x' }] } })
    writeFileSync(join(dir, 'dddd4444.jsonl'), jsonl([typed('<command-name>/scrooge</command-name>', '2026-10-17T10:00:00Z'), m('o1', '2026-10-17T10:00:10Z'), typed('build 1.2 now', '2026-10-17T10:10:00Z'), m('o2', '2026-10-17T10:10:10Z', big)]))
    const row = sessionRow(dir, 'dddd')
    expect(row.ownTokens).toBe(100)
    expect(tableOf([row])).toContain('| scrooge (session, not the skill; its own turn 0.0M) |')
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
