import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DENY_REASON, TOOL, decide, refusedThisTurn } from './start-gate.mjs'

process.env.WOLFPACK_NO_PUSH = '1'

// The app's words when it refuses a start in a woken turn (Burrow, 17 Oct 2026).
const REFUSED =
  "Start sessions only on the user's own words to you here; this turn runs an automated event, another session's message, or the task another session gave you. Propose the session instead (initiation \"own_initiative\"), or start it once the user asks you here."

let dir, pushed
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'start-gate-'))
  pushed = []
})

const user = (text) => ({ type: 'user', message: { role: 'user', content: text } })
const start = (id, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: TOOL, input }] } })
const result = (id, text, isError = true) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text }] } })

function transcript(entries) {
  const file = join(dir, 'session.jsonl')
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return file
}

function gate(toolInput, entries = [user('go')]) {
  const r = decide({ tool_name: TOOL, tool_input: toolInput, transcript_path: transcript(entries), cwd: '/x/burrow' }, { push: (l) => pushed.push(l) })
  return r ? r.decision : 'allow'
}

describe('the start gate', () => {
  it('lets user_asked through', () => {
    expect(gate({ initiation: 'user_asked', title: 't' })).toBe('allow')
  })

  it('denies own_initiative and offer with the standing rule', () => {
    expect(gate({ initiation: 'own_initiative', title: 't' })).toBe('deny')
    expect(gate({ initiation: 'offer', title: 't' })).toBe('deny')
    expect(decide({ tool_name: TOOL, tool_input: { initiation: 'offer' } }).reason).toBe(DENY_REASON)
  })

  it('lets a call that starts an existing card (proposal_id only) through', () => {
    expect(gate({ proposal_id: 'task_1', prompt: 'p' })).toBe('allow')
  })

  it('says nothing for any other tool', () => {
    expect(decide({ tool_name: 'Bash', tool_input: { initiation: 'own_initiative' } })).toBeNull()
  })

  it('lets the card through after a woken-turn refusal this turn, and pings once', () => {
    const entries = [user('wake'), start('t1', { initiation: 'user_asked', title: 'burrow · wrap' }), result('t1', [{ type: 'text', text: REFUSED }])]
    const saved = process.env.CLAUDE_PROJECT_DIR
    process.env.CLAUDE_PROJECT_DIR = '/x/burrow'
    try {
      expect(gate({ initiation: 'own_initiative', title: 'burrow · wrap' }, entries)).toBe('allow')
    } finally {
      process.env.CLAUDE_PROJECT_DIR = saved
    }
    expect(pushed).toEqual(['burrow · card left: burrow · wrap (start refused in a woken turn)'])
  })

  it('still denies when the refusal was in an earlier turn', () => {
    const entries = [user('wake'), start('t1', { initiation: 'user_asked' }), result('t1', REFUSED), user('Alexander again')]
    expect(gate({ initiation: 'own_initiative', title: 't' }, entries)).toBe('deny')
    expect(pushed).toEqual([])
  })

  it('ignores refusal-like text from another tool', () => {
    const entries = [user('wake'), { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }] } }, result('b1', REFUSED)]
    expect(refusedThisTurn(transcript(entries))).toBe(false)
  })

  it('denies without a transcript', () => {
    expect(decide({ tool_name: TOOL, tool_input: { initiation: 'own_initiative' }, transcript_path: join(dir, 'none.jsonl') }).decision).toBe('deny')
  })
})
