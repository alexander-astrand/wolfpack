import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activeSkill, decide, reasonFor } from './ceiling.mjs'

const typed = (name, args = '') => ({ type: 'user', message: { content: `<command-name>/${name}</command-name>\n<command-args>${args}</command-args>` } })
const skillCall = (skill, args) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill, args } }] } })
const spend = (id, tokens) => ({ type: 'assistant', message: { id, model: 'claude-opus-x', usage: { cache_read_input_tokens: tokens }, content: [{ type: 'text', text: 'x' }] } })
const jsonl = (entries) => `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`

// A session folder: the transcript, and a subagent's file when given.
function session(entries, subEntries = null) {
  const dir = mkdtempSync(join(tmpdir(), 'ceiling-'))
  const transcript_path = join(dir, 'sess-1.jsonl')
  writeFileSync(transcript_path, jsonl(entries))
  if (subEntries) {
    mkdirSync(join(dir, 'sess-1', 'subagents'), { recursive: true })
    writeFileSync(join(dir, 'sess-1', 'subagents', 'agent-a.jsonl'), jsonl(subEntries))
  }
  return { session_id: 'sess-1', transcript_path }
}
const env = { logPath: null }

describe('ceiling hook', () => {
  it('stays silent under the figure', () => {
    expect(decide(session([typed('core:wilson'), spend('m1', 19_000_000)]), env)).toBeNull()
  })

  it('sends one line back past the figure, the subagents counted', () => {
    const input = session([typed('core:wilson'), spend('m1', 15_000_000)], [spend('m2', 8_400_000)])
    const out = decide(input, env)
    expect(out).toEqual({ decision: 'block', reason: reasonFor('wilson', 23_400_000) })
    expect(out.reason).toBe('Past the 20M ceiling for /wilson (23.4M): finish the answer and end; a new topic is a fresh session.')
  })

  it('reads the wrap and plan figure (25M) from a Skill call', () => {
    const entries = [{ type: 'user', message: { content: 'wrap 1.9 up' } }, skillCall('core:future-ted', '1.9')]
    expect(decide(session([...entries, spend('m1', 24_000_000)]), env)).toBeNull()
    expect(decide(session([...entries, spend('m1', 26_000_000)]), env)?.reason).toMatch(/^Past the 25M ceiling for \/future-ted \(26\.0M\)/)
  })

  it('stays silent with no skill, or one with no figure', () => {
    expect(decide(session([{ type: 'user', message: { content: 'hi' } }, spend('m1', 90_000_000)]), env)).toBeNull()
    expect(decide(session([typed('release:captain-call', '1.10'), spend('m1', 90_000_000)]), env)).toBeNull()
  })

  it('gives 88-mph a figure only when small', () => {
    expect(activeSkill([typed('core:88-mph', 'small is X cheaper')])).toBe('88-mph small')
    expect(activeSkill([typed('core:88-mph', 'medium is X cheaper')])).toBeNull()
    expect(activeSkill([skillCall('core:88-mph', 'small what does Y cost')])).toBe('88-mph small')
  })

  it('never fires twice on one stop (stop_hook_active)', () => {
    const input = session([typed('mr-miyagi'), spend('m1', 30_000_000)])
    expect(decide(input, env)?.decision).toBe('block')
    expect(decide({ ...input, stop_hook_active: true }, env)).toBeNull()
    // The next turn's stop reads it again: once a turn, never a loop.
    expect(decide(input, env)?.decision).toBe('block')
  })

  it('fails open on a missing transcript', () => {
    expect(decide({ session_id: 'x', transcript_path: join(tmpdir(), 'no-such-ceiling.jsonl') }, env)).toBeNull()
    expect(decide(null, env)).toBeNull()
  })
})
