// His typed /one-ring as the deploy's go (kit 1.6): only a prompt he typed in
// this session counts, never one another session, a routine or a channel
// sent. The entries are shaped as Claude Code 2.1.304 writes them (Burrow's
// 21 Oct 2026 transcripts: a typed /release:one-ring, a peer message, a
// session's first prompt from its starter, a scheduled task).
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GO_HOURS, TRANSCRIPT_RE, goArg, humanGo, ownTranscript, readHumanGo, readTailOf } from './one-ring-go.mjs'

const SID = '8d4d3aad-e0f3-455f-85f9-a3a579637e6f'
const NOW = Date.parse('2026-10-21T10:00:00Z')
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString()
const command = (name, args) => `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`

// A prompt he typed, as the app writes it.
const typed = (content, extra = {}) => JSON.stringify({
  parentUuid: 'p', isSidechain: false, promptId: 'x', type: 'user', message: { role: 'user', content },
  uuid: `u-${Math.random()}`, timestamp: at(30), origin: { kind: 'human' }, turnOrigin: 'human',
  turnPosition: { promptIndex: 1, turnIndex: 6 }, userType: 'external', entrypoint: 'claude-desktop', sessionId: SID, ...extra,
})
const go = (lines, opts = {}) => humanGo(lines.join('\n'), { sessionId: SID, now: NOW, ...opts })

describe('the go he typed', () => {
  it('reads /release:one-ring and /one-ring with a version or a PR number', () => {
    expect(go([typed(command('release:one-ring', '0.14.3.1'))])).toMatchObject({ arg: '0.14.3.1' })
    expect(go([typed(command('one-ring', 'V0.14.3.1'))])).toMatchObject({ arg: '0.14.3.1' })
    expect(go([typed(command('one-ring', '#34'))])).toMatchObject({ arg: '34' })
  })

  it('no longer reads /special-delivery, deleted in kit 1.7', () => {
    expect(go([typed(command('release:special-delivery', '2.13.6'))])).toBeNull()
    expect(go([typed(command('special-delivery', '34'))])).toBeNull()
  })

  it('reads text blocks as well as a string', () => {
    expect(go([typed([{ type: 'text', text: command('release:one-ring', '34') }])])).toMatchObject({ arg: '34' })
  })

  it('takes the newest, and `/one-ring stop` takes it back', () => {
    const two = [typed(command('one-ring', '0.14'), { timestamp: at(60) }), typed(command('one-ring', '0.14.3.1'), { timestamp: at(5) })]
    expect(go(two)).toMatchObject({ arg: '0.14.3.1' })
    expect(go([...two, typed(command('one-ring', 'stop'), { timestamp: at(1) })])).toBeNull()
    expect(go([...two, typed(command('one-ring', 'hold'), { timestamp: at(1) })])).toBeNull()
  })

  it('is gone after 12 hours', () => {
    expect(GO_HOURS).toBe(12)
    expect(go([typed(command('one-ring', '34'), { timestamp: at(11 * 60) })])).not.toBeNull()
    expect(go([typed(command('one-ring', '34'), { timestamp: at(12 * 60 + 1) })])).toBeNull()
    expect(go([typed(command('one-ring', '34'), { timestamp: 'yesterday' })])).toBeNull()
  })
})

describe('what is never a go', () => {
  it('a message from another session, even one that names the command', () => {
    expect(go([typed(command('release:one-ring', '0.14.3.1'), { origin: { kind: 'peer', from: 'local_x', hostInjected: true }, promptSource: 'system', turnOrigin: 'peer', isMeta: true })])).toBeNull()
    expect(go([typed(command('release:one-ring', '0.14.3.1'), { origin: { kind: 'peer' }, turnOrigin: 'peer' })])).toBeNull()
  })

  it("a session's first prompt from the session that started it", () => {
    const started = JSON.parse(typed(command('release:one-ring', '34')))
    delete started.origin
    expect(go([JSON.stringify({ ...started, promptSource: 'sdk', turnOrigin: 'sdk' })])).toBeNull()
  })

  it('a routine, a Telegram channel, a subagent, a skill body', () => {
    expect(go([typed(command('one-ring', '34'), { origin: { kind: 'task-notification', subkind: 'scheduled-trigger' }, turnOrigin: 'scheduled' })])).toBeNull()
    expect(go([typed(command('one-ring', '34'), { origin: { kind: 'channel', server: 'plugin:telegram:telegram' }, turnOrigin: 'peer' })])).toBeNull()
    expect(go([typed(command('one-ring', '34'), { isSidechain: true })])).toBeNull()
    expect(go([typed(command('one-ring', '34'), { isMeta: true })])).toBeNull()
  })

  it('an entry with no turnOrigin, or another session id', () => {
    const old = JSON.parse(typed(command('one-ring', '34')))
    delete old.turnOrigin
    expect(go([JSON.stringify(old)])).toBeNull()
    expect(go([typed(command('one-ring', '34'), { sessionId: 'another' })])).toBeNull()
  })

  it('prose that mentions the command, another command, or a bad argument', () => {
    expect(go([typed('please run /one-ring 34 for me')])).toBeNull()
    expect(go([typed(command('release:skinny-pete', '34'))])).toBeNull()
    expect(go([typed(command('one-ring', '34; rm -rf /'))])).toBeNull()
    expect(go([typed(command('one-ring', ''))])).toBeNull()
    expect(go([typed(command('one-ring', 'kit'))])).toBeNull()
    // /one-ring check (kit 1.7) is a read-only look, never a go.
    expect(go([typed(command('one-ring', 'check 34'))])).toBeNull()
    expect(go([typed(command('release:one-ring', 'check 0.14.3.1'))])).toBeNull()
  })

  it('an assistant line or a tool result quoting it', () => {
    expect(go([JSON.stringify({ type: 'assistant', message: { content: command('one-ring', '34') }, origin: { kind: 'human' }, turnOrigin: 'human', sessionId: SID, timestamp: at(1) })])).toBeNull()
    expect(go(['not json one-ring', ''])).toBeNull()
  })
})

describe('the transcript it reads', () => {
  const home = '/Users/a'
  const path = `${home}/.claude/projects/-Users-a-Desktop-Burrow/${SID}.jsonl`
  it("is this session's own, under ~/.claude/projects", () => {
    expect(ownTranscript(path, SID, home)).toBe(true)
    expect(ownTranscript(`${home}/.claude/projects/-Users-a-Desktop-Burrow/other.jsonl`, SID, home)).toBe(false)
    expect(ownTranscript(`/tmp/${SID}.jsonl`, SID, home)).toBe(false)
    expect(ownTranscript(`${home}/.claude/projects/x/../../evil/${SID}.jsonl`, SID, home)).toBe(false)
    expect(ownTranscript(path, '../x', home)).toBe(false)
    expect(ownTranscript(undefined, SID, home)).toBe(false)
  })

  it('reads the go, and a file it can\'t read is no go', () => {
    const text = typed(command('one-ring', '34'))
    expect(readHumanGo({ transcriptPath: path, sessionId: SID, now: NOW, home, readFile: () => text })).toMatchObject({ arg: '34' })
    expect(readHumanGo({ transcriptPath: path, sessionId: SID, now: NOW, home, readFile: () => { throw new Error('EACCES') } })).toBeNull()
    expect(readHumanGo({ transcriptPath: '/tmp/x.jsonl', sessionId: SID, now: NOW, home, readFile: () => text })).toBeNull()
  })

  it('reads the tail first and the whole file only when the tail has no go', () => {
    const goLine = typed(command('one-ring', '34'))
    const reads = []
    const readFile = () => { reads.push('whole'); return goLine }
    // The go is in the tail: the whole file is never read.
    expect(readHumanGo({ transcriptPath: path, sessionId: SID, now: NOW, home, readFile, readTail: () => `cut half a line\n${goLine}` })).toMatchObject({ arg: '34' })
    expect(reads).toEqual([])
    // The tail has none (or can't be read): the whole file answers.
    expect(readHumanGo({ transcriptPath: path, sessionId: SID, now: NOW, home, readFile, readTail: () => 'nothing here' })).toMatchObject({ arg: '34' })
    expect(readHumanGo({ transcriptPath: path, sessionId: SID, now: NOW, home, readFile, readTail: () => { throw new Error('EIO') } })).toMatchObject({ arg: '34' })
    expect(reads).toEqual(['whole', 'whole'])
  })

  it('readTailOf returns the last bytes of a real file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'one-ring-go-'))
    const f = join(dir, 't.jsonl')
    writeFileSync(f, 'a'.repeat(100) + '\nlast line')
    expect(readTailOf(f, 9)).toBe('last line')
    expect(readTailOf(f)).toHaveLength(110)
  })

  it('names transcripts and their subagents, not memory files', () => {
    expect(TRANSCRIPT_RE.test(path)).toBe(true)
    expect(TRANSCRIPT_RE.test(`${home}/.claude/projects/p/${SID}/subagents/agent-1.jsonl`)).toBe(true)
    expect(TRANSCRIPT_RE.test(`${home}/.claude/projects/p/memory/MEMORY.md`)).toBe(false)
    expect(TRANSCRIPT_RE.test('/repo/data/rows.jsonl')).toBe(false)
  })

  it('goArg drops a leading V or #', () => {
    expect(goArg(' V0.14 ')).toBe('0.14')
    expect(goArg('#34')).toBe('34')
  })
})
