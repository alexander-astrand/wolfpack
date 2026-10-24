import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NEXT_REASON, REASON, WATCHDOG_REASON, asksToStart, backgroundState, decide, endsWithNext } from './ask-to-start.mjs'

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

  it('carries the woken-turn clause', () => {
    expect(REASON).toMatch(/woken \(a timer, a hand-back, another session's message, or a session's first task from its starter\)/)
    expect(REASON).toMatch(/send_message an existing session or leave the card/)
    expect(REASON).toMatch(/never re-spell/)
  })
})

// A transcript shaped like Claude Code's, one entry per line.
let n = 0
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } })
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const use = (name, input = {}, id = `t${++n}`) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } })
const res = (id, content = 'ok') => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } })
const tool = (name, input, out, id = `t${++n}`) => [use(name, input, id), res(id, out)]
const bgBash = (command, shell) => tool('Bash', { command, run_in_background: true }, `Command running in background with ID: ${shell}. Output is being written to: /tmp/x`)
const bgAgent = (agent) => tool('Agent', { description: 'x', prompt: 'p', run_in_background: true }, [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agent}` }])

function stop(entries, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ask-to-start-'))
  const file = join(dir, 's.jsonl')
  writeFileSync(file, entries.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const r = decide({ transcript_path: file, session_id: 's1', ...extra }, { logPath: extra.logPath ?? null })
  return r ? r.reason : 'pass'
}

describe('the Next: last line (kit 1.7, council Feature 2)', () => {
  const ran = [user('do it'), ...tool('Read', { file_path: '/x' }, 'text')]

  it('passes a plain answer with no tools, whatever its last line', () => {
    expect(stop([user('what is X?'), say('X is the cleaner.')])).toBe('pass')
    expect(stop([user('what is X?')], { last_assistant_message: 'X is the cleaner.' })).toBe('pass')
  })

  it('passes when the tools ran in an earlier turn only', () => {
    expect(stop([...ran, say('Done.\nNext: nothing, done.'), user('and Y?'), say('Y is the planner.')])).toBe('pass')
  })

  it('blocks a turn that ran tools and ends with no Next: line, once', () => {
    expect(stop([...ran, say('Fixed the hook.')])).toBe(NEXT_REASON)
    expect(stop([...ran, say('Fixed the hook.')], { stop_hook_active: true })).toBe('pass')
  })

  it('takes the field over the transcript, and every shape of the last line', () => {
    for (const t of [
      'Fixed.\nNext: nothing, done.',
      'Fixed.\n\n- **Next:** say go and I merge (Alexander)\n',
      '> Next: the deploy (this session)',
      'Sent.\nHanded to kit · release · 1.7; it has taken over.',
    ]) expect(stop([...ran], { last_assistant_message: t }), t).toBe('pass')
    expect(stop([...ran], { last_assistant_message: 'Fixed.\nNext steps are below.\n1. a' })).toBe(NEXT_REASON)
  })

  it('lets a go-question or a slash-command step end the turn', () => {
    expect(stop([...ran, say('Built and green.\nWant me to merge PR #12?')])).toBe('pass')
    expect(stop([...ran, say('Ready.\nType `/one-ring 1.7` when you are.')])).toBe('pass')
  })

  it("passes a turn that ends on the app's wrap_up box", () => {
    expect(stop([...ran, say('All done here.'), use('mcp__ccd_session__wrap_up', { recap: 'r' })])).toBe('pass')
  })

  it('passes when the transcript is missing or unreadable', () => {
    expect(decide({ transcript_path: '/nowhere/s.jsonl', last_assistant_message: 'Fixed.' })).toBeNull()
    expect(stop([{ broken: true }, 'not json'], { last_assistant_message: 'Fixed.' })).toBe('pass')
  })

  it('writes the block to the hook log', () => {
    const logPath = join(mkdtempSync(join(tmpdir(), 'ask-log-')), 'session-hooks.log')
    writeFileSync(logPath, '')
    stop([...ran, say('Fixed.')], { logPath })
    const cols = readFileSync(logPath, 'utf8').trim().split('\t')
    expect(cols.slice(1)).toEqual(['s1', 'ask-to-start', 'block', 'no Next: last line'])
  })

  it('checks the session ask first', () => {
    expect(stop([...ran, say('Want me to start the wrap session?')])).toBe(REASON)
  })
})

describe('the watchdog check (kit 1.7, council Feature 2)', () => {
  const end = say('Started.\nNext: the review (this session)')

  it('blocks a turn that leaves a background agent or Bash running with no timer, once', () => {
    expect(stop([user('go'), ...bgAgent('a1b2c3'), end])).toBe(WATCHDOG_REASON)
    expect(stop([user('go'), ...bgBash('npm test', 'bx41'), end])).toBe(WATCHDOG_REASON)
    expect(stop([user('go'), ...bgAgent('a1b2c3'), end], { stop_hook_active: true })).toBe('pass')
  })

  it('passes with a background sleep started this turn', () => {
    expect(stop([user('go'), ...bgAgent('a1b2c3'), ...bgBash('sleep 1200', 'sl01'), end])).toBe('pass')
  })

  it('passes while an earlier sleep has not been seen to end', () => {
    expect(stop([user('go'), ...bgBash('sleep 1800', 'sl02'), say('Waiting.\nNext: x (this session)'), user('also this'), ...bgAgent('q9q9q9'), end])).toBe('pass')
  })

  it('passes when the task was seen to finish or was stopped', () => {
    expect(stop([user('go'), ...bgBash('npm test', 'bx42'), ...tool('TaskOutput', { task_id: 'bx42' }, 'done'), end])).toBe('pass')
    expect(stop([user('go'), ...bgAgent('a7a7a7'), ...tool('TaskStop', { task_id: 'a7a7a7' }, 'stopped'), end])).toBe('pass')
  })

  it("passes a task whose id it can't read, and foreground work", () => {
    expect(stop([user('go'), ...tool('Bash', { command: 'npm test', run_in_background: true }, 'started'), end])).toBe('pass')
    expect(stop([user('go'), ...tool('Agent', { description: 'x', prompt: 'p' }, 'report'), end])).toBe('pass')
  })

  it('reports the counts', () => {
    const entries = [user('go'), ...bgAgent('a1b2c3'), ...bgBash('npm test', 'bx43')]
    expect(backgroundState(entries)).toEqual({ running: 2, timer: false })
  })
})

describe('endsWithNext', () => {
  it('reads the last non-empty line', () => {
    expect(endsWithNext('a\nNext: b (you)\n\n')).toBe(true)
    expect(endsWithNext('Next: b\nand then some')).toBe(false)
    expect(endsWithNext('')).toBe(true)
  })
})
