import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countCalls, hhmm, resolveLocalId, tallyEntries, totalTokens } from './usage.mjs'

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

describe('hhmm', () => {
  it('prints UTC with a trailing Z', () => {
    expect(hhmm(Date.parse('2026-10-03T08:05:59Z'))).toBe('08:05Z')
  })
})
