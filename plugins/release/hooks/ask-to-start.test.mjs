import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REASON, asksToStart, decide } from './ask-to-start.mjs'

describe('ask-to-start', () => {
  it('catches the ways a turn asks him to start a session', () => {
    for (const t of [
      'Done. Want me to start the wrap session?',
      'Shall I start a session for the hotfix?',
      'Should I spin up a follow-up?',
      'Start a new session for the deploy when you are back.',
      'Next: open a new session for 0.6 (you).',
      'Would you like me to open a side session?',
      'Do you want me to kick off the deploy session?',
    ]) expect(asksToStart(t), t).toBe(true)
  })

  it('lets statements and other asks through', () => {
    for (const t of [
      "Started session \"burrow · wrap\". I'll start a new session for the deploy myself.",
      'The app refused the start in this woken turn; card left.',
      'Want me to merge PR #12?',
      'Next: nothing, done.',
    ]) expect(asksToStart(t), t).toBe(false)
  })

  // Kit 1.5 review M1: go-questions with no session named, and steps that name
  // a user-only command, end the turn as they are.
  it('lets his go-questions and user-only command steps through', () => {
    for (const t of [
      'Want me to start the production deploy now?',
      'Shall I start the backup?',
      'Do you want me to open the PR?',
      'Should I kick off the build?',
      'Want me to start /one-ring?',
      'Next: open a new session at the repo root and type /one-ring 1.5 (you).',
      '- **Next:** open a new session in the project folder (its absolute path from the brief) and type `/captain-call 0.1 opus`.',
    ]) expect(asksToStart(t), t).toBe(false)
  })

  it('blocks with the reason, once per stop', () => {
    expect(decide({ last_assistant_message: 'Want me to start the session?' })).toEqual({ decision: 'block', reason: REASON })
    expect(decide({ last_assistant_message: 'Want me to start the session?', stop_hook_active: true })).toBeNull()
  })

  it("reads the transcript's last assistant text when the field is missing", () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ask-to-start-')), 's.jsonl')
    const lines = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Shall I start a session?' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } },
    ]
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    expect(decide({ transcript_path: file })?.decision).toBe('block')
    expect(decide({ transcript_path: join(file, 'missing') })).toBeNull()
  })
})
