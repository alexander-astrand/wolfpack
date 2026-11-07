import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activeSkill, decide, markerFor, reasonFor } from './ceiling.mjs'

const typed = (name, args = '') => ({ type: 'user', message: { content: `<command-name>/${name}</command-name>\n<command-args>${args}</command-args>` } })
const skillCall = (skill, args) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill, args } }] } })
const spend = (id, tokens) => ({ type: 'assistant', message: { id, model: 'claude-opus-x', usage: { cache_read_input_tokens: tokens }, content: [{ type: 'text', text: 'x' }] } })
const jsonl = (entries) => `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`

// A session folder: the transcript, and a subagent's file when given. Each
// gets its own id, so one test's marker never silences another's.
let n = 0
function session(entries, subEntries = null) {
  const id = `sess-${++n}`
  const dir = mkdtempSync(join(tmpdir(), 'ceiling-'))
  const transcript_path = join(dir, `${id}.jsonl`)
  writeFileSync(transcript_path, jsonl(entries))
  if (subEntries) {
    mkdirSync(join(dir, id, 'subagents'), { recursive: true })
    writeFileSync(join(dir, id, 'subagents', 'agent-a.jsonl'), jsonl(subEntries))
  }
  return { session_id: id, transcript_path }
}
const env = { logPath: null, markerDir: mkdtempSync(join(tmpdir(), 'ceiling-markers-')) }

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
    expect(decide({ ...input, stop_hook_active: true }, env)).toBeNull()
    expect(decide(input, env)?.decision).toBe('block')
    expect(decide({ ...input, stop_hook_active: true }, env)).toBeNull()
  })

  it('a second stop after a send-back passes: one line a session', () => {
    const input = session([typed('mr-miyagi'), spend('m1', 30_000_000)])
    expect(existsSync(markerFor(input, env))).toBe(false)
    expect(decide(input, env)?.decision).toBe('block')
    expect(existsSync(markerFor(input, env))).toBe(true)
    expect(decide(input, env)).toBeNull()
    expect(decide(input, env)).toBeNull()
    // Another session past its figure still gets its own line.
    expect(decide(session([typed('mr-miyagi'), spend('m1', 30_000_000)]), env)?.decision).toBe('block')
  })

  it('with the marker set, reads no transcript at all (R1 S3)', () => {
    // A transcript path that throws on any read: a folder (readSync gives EISDIR).
    const input = { session_id: `sess-${++n}`, transcript_path: mkdtempSync(join(tmpdir(), 'ceiling-unreadable-')) }
    expect(() => decide(input, env)).toThrow()
    mkdirSync(env.markerDir, { recursive: true })
    writeFileSync(markerFor(input, env), 'sent\n')
    expect(decide(input, env)).toBeNull()
  })

  it('fails open on a missing transcript', () => {
    expect(decide({ session_id: 'x', transcript_path: join(tmpdir(), 'no-such-ceiling.jsonl') }, env)).toBeNull()
    expect(decide(null, env)).toBeNull()
  })
})
