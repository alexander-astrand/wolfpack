import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DENY_REASON, NO_CARD_REASON, TOOL, decide, logPathFor, refusalThisTurn, tailEntries } from './start-gate.mjs'

process.env.WOLFPACK_NO_PUSH = '1'

// The app's words when it refuses a start in a woken turn (Burrow, 17 Oct 2026).
const REFUSED =
  "Start sessions only on the user's own words to you here; this turn runs an automated event, another session's message, or the task another session gave you. Propose the session instead (initiation \"own_initiative\"), or start it once the user asks you here."

let dir, pushed, savedProject
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'start-gate-'))
  pushed = []
  // The test setup points CLAUDE_PROJECT_DIR at a temp project; these tests
  // name the project from the call's cwd and log only where they say.
  savedProject = process.env.CLAUDE_PROJECT_DIR
  delete process.env.CLAUDE_PROJECT_DIR
})
afterEach(() => {
  if (savedProject !== undefined) process.env.CLAUDE_PROJECT_DIR = savedProject
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
    // Kit 1.7 (council M2): the line no longer says "card left" before a card exists.
    expect(pushed).toEqual(['burrow · start refused: burrow · wrap (woken turn, a card follows)'])
  })

  it('denies a woken-turn card with a preset, folder or host, and pushes once with the brief', () => {
    const entries = [user('wake'), start('t1', { initiation: 'user_asked', preset: 'homelab' }), result('t1', REFUSED)]
    const logPath = join(dir, 'session-hooks.log')
    const ask = (ti) => decide({ tool_name: TOOL, tool_input: ti, transcript_path: transcript(entries), cwd: '/x/hutzup', session_id: 's1' }, { push: (l) => pushed.push(l), logPath })
    for (const field of ['preset', 'cwd', 'host']) {
      pushed = []
      writeFileSync(logPath, '')
      const r = ask({ initiation: 'own_initiative', title: 'homelab · setup', [field]: 'x', prompt: 'Brief: ~/.claude/plans/homelab/units.md, then go.' })
      expect(r).toEqual({ decision: 'deny', reason: NO_CARD_REASON })
      expect(pushed).toEqual(['hutzup · start refused: homelab · setup, brief at ~/.claude/plans/homelab/units.md (woken turn, no card)'])
      // The same refusal again: no second Telegram line.
      expect(ask({ initiation: 'own_initiative', title: 'homelab · setup', [field]: 'x' })?.decision).toBe('deny')
      expect(pushed).toHaveLength(1)
    }
  })

  it('names no brief when the call names none', () => {
    const entries = [user('wake'), start('t1', { initiation: 'user_asked' }), result('t1', REFUSED)]
    gate({ initiation: 'own_initiative', title: 'x · y', cwd: '/x/other' }, entries)
    expect(pushed).toEqual(['burrow · start refused: x · y (woken turn, no card)'])
  })

  it('both texts carry the woken-turn clause', () => {
    for (const t of [DENY_REASON, NO_CARD_REASON]) {
      expect(t).toMatch(/send_message/)
      expect(t).toMatch(/never re-spell/i)
    }
    expect(DENY_REASON).toMatch(/woken \(a timer, a hand-back, another session's message, or a session's first task from its starter\)/)
    expect(NO_CARD_REASON).toMatch(/send none of your own/)
  })

  it('writes one log line per decision', () => {
    const logPath = join(dir, 'session-hooks.log')
    const run = (ti, entries = [user('go')]) =>
      decide({ tool_name: TOOL, tool_input: ti, transcript_path: transcript(entries), session_id: 's9' }, { push: (l) => pushed.push(l), logPath, now: 0 })
    run({ initiation: 'user_asked' })
    run({ proposal_id: 'task_1' })
    run({ initiation: 'offer' })
    run({ initiation: 'own_initiative', title: 't' }, [user('wake'), start('r1', { initiation: 'user_asked' }), result('r1', REFUSED)])
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => l.split('\t'))
    expect(lines.map((c) => c.length)).toEqual([5, 5, 5, 5])
    expect(lines.map((c) => c[3])).toEqual(['allow', 'allow', 'deny', 'woken-turn card'])
    expect(lines[0].slice(0, 3)).toEqual(['1970-01-01T00:00:00.000Z', 's9', 'start-gate'])
    expect(lines[3][4]).toBe('pushed refusal=r1')
  })

  it("writes no log in a folder with no .claude, and logs into the project's own", () => {
    expect(logPathFor({ cwd: dir })).toBeNull()
    mkdirSync(join(dir, '.claude'))
    expect(logPathFor({ cwd: dir })).toBe(join(dir, '.claude', 'session-hooks.log'))
  })

  it("reads only the transcript's tail, skipping the cut line", () => {
    const file = transcript([user('wake'), start('t1', { initiation: 'user_asked' }), result('t1', REFUSED)])
    expect(tailEntries(file, 10_000)).toHaveLength(3)
    // A 60-byte tail cuts into the refusal entry, so nothing whole is left to count.
    expect(refusalThisTurn(tailEntries(file, 60))).toBeNull()
    expect(tailEntries(join(dir, 'none.jsonl'))).toEqual([])
  })

  it('still denies when the refusal was in an earlier turn', () => {
    const entries = [user('wake'), start('t1', { initiation: 'user_asked' }), result('t1', REFUSED), user('Alexander again')]
    expect(gate({ initiation: 'own_initiative', title: 't' }, entries)).toBe('deny')
    expect(pushed).toEqual([])
  })

  it('ignores refusal-like text from another tool', () => {
    const entries = [user('wake'), { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }] } }, result('b1', REFUSED)]
    expect(refusalThisTurn(tailEntries(transcript(entries)))).toBeNull()
  })

  it('denies without a transcript', () => {
    expect(decide({ tool_name: TOOL, tool_input: { initiation: 'own_initiative' }, transcript_path: join(dir, 'none.jsonl') }).decision).toBe('deny')
  })
})
