import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countCalls, hhmm, readEntries, resolveLocalId, sessionCommand, tallyEntries, tokensPerPoint, totalTokens } from './usage.mjs'

const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 }
const line = (id, block) => ({
  type: 'assistant',
  message: { id, model: 'claude-opus-x', usage, content: [block] },
})

describe('tallyEntries', () => {
  it('counts a three-block message once for tokens and calls, and its tool call once', () => {
    const entries = [
      line('msg_1', { type: 'thinking', thinking: '…' }),
      line('msg_1', { type: 'text', text: 'hi' }),
      line('msg_1', { type: 'tool_use', name: 'Read', input: {} }),
    ]
    const b = tallyEntries(entries).get('claude-opus-x')
    expect(b.calls).toBe(1)
    expect(totalTokens(b)).toBe(100)
    expect(countCalls(entries).calls).toBe(1)
  })

  it('counts two different ids twice', () => {
    const b = tallyEntries([line('msg_1', { type: 'text', text: 'a' }), line('msg_2', { type: 'text', text: 'b' })]).get('claude-opus-x')
    expect(b.calls).toBe(2)
    expect(totalTokens(b)).toBe(200)
  })

  it('keeps counting lines that have no id', () => {
    const noId = { message: { model: 'm', usage } }
    expect(tallyEntries([noId, noId]).get('m').calls).toBe(2)
  })
})

describe('resolveLocalId', () => {
  const base = mkdtempSync(join(tmpdir(), 'usage-sessions-'))
  mkdirSync(join(base, 'acct', 'org'), { recursive: true })
  writeFileSync(join(base, 'acct', 'org', 'local_abc.json'), JSON.stringify({ cliSessionId: 'f47d909c-0000' }))

  it('finds the transcript id in the app session file two folders down', () => {
    expect(resolveLocalId('local_abc', base)).toBe('f47d909c-0000')
  })

  it('says so when no file matches', () => {
    expect(() => resolveLocalId('local_nope', base)).toThrow(/No session file for "local_nope"/)
  })
})

describe('forked copies (M2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-forks-'))
  const prompt = { type: 'user', message: { content: '<command-name>/core:inception</command-name>' } }
  const text = `${[prompt, line('msg_a', { type: 'text', text: 'a' }), line('msg_b', { type: 'text', text: 'b' })].map((e) => JSON.stringify(e)).join('\n')}\n`
  writeFileSync(join(dir, 'aaaa1111-copy.jsonl'), text)
  writeFileSync(join(dir, 'bbbb2222-copy.jsonl'), text) // byte-identical, as the app forks them

  it('readEntries with one seen Set counts two byte-identical files once', () => {
    const seen = new Set()
    const first = tallyEntries(readEntries(join(dir, 'aaaa1111-copy.jsonl'), seen))
    const second = tallyEntries(readEntries(join(dir, 'bbbb2222-copy.jsonl'), seen))
    expect(totalTokens(first.get('claude-opus-x'))).toBe(200)
    expect(second.size).toBe(0)
  })

  it('the script sums the pair as one session and names the copy', () => {
    const script = fileURLToPath(new URL('./usage.mjs', import.meta.url))
    const out = JSON.parse(execFileSync(process.execPath, [script, '--json', '--dir', dir, 'aaaa1111', 'bbbb2222'], { encoding: 'utf8' }))
    expect(out.grandTotal).toBe(200)
    expect(out.copies).toEqual(['bbbb2222-copy'])
  })

  it('labels a session by its start command, else the first one it ran, in brackets', () => {
    expect(sessionCommand([prompt])).toBe('/core:inception')
    const later = [{ type: 'user', message: { content: 'plan the horizon' } }, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'core:inception' } }] } }]
    expect(sessionCommand(later)).toBe('(/core:inception)')
    expect(sessionCommand([{ type: 'user', message: { content: 'hi' } }])).toBe('(none)')
  })
})

describe('tokensPerPoint', () => {
  it('is 46M a point without a meter key', () => {
    expect(tokensPerPoint(null)).toBe(46e6)
    expect(tokensPerPoint({ project: {} })).toBe(46e6)
  })

  it('takes kit.json meter.tokensPerPoint, per family or as one number', () => {
    expect(tokensPerPoint({ meter: { tokensPerPoint: { opus: 40e6 } } })).toBe(40e6)
    expect(tokensPerPoint({ meter: { tokensPerPoint: 30e6 } }, 'sonnet')).toBe(30e6)
  })

  it('keeps Fable measured and derives Sonnet and Haiku from the Opus figure', () => {
    expect(tokensPerPoint(null, 'fable')).toBe(8e6)
    expect(tokensPerPoint(null, 'sonnet')).toBeGreaterThan(46e6)
    expect(tokensPerPoint(null, 'haiku')).toBeGreaterThan(tokensPerPoint(null, 'sonnet'))
  })
})

describe('hhmm', () => {
  it('prints UTC with a trailing Z', () => {
    expect(hhmm(Date.parse('2026-10-03T08:05:59Z'))).toBe('08:05Z')
  })
})
