import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KIT_PARTS_MARK,
  kitNames,
  linkName,
  linksPart,
  noteHook,
  publishedUrl,
  publishesIn,
  pushDelay,
  readingsPart,
  senderFoldsSpool,
  sessionsPart,
  sharesPart,
  teamPart,
  withParts,
} from './dev-hq.mjs'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const ago = (min) => NOW - min * 60_000
const at = (min) => new Date(ago(min)).toISOString()

function tmp() {
  return mkdtempSync(join(tmpdir(), 'dev-hq-'))
}

function project(root, name) {
  const dir = join(root, name)
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'kit.json'), JSON.stringify({ project: { name } }))
  return dir
}

function appSession(app, id, fields) {
  const dir = join(app, 'a', 'b')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: id, ...fields }))
}

const usageLine = (id, model, ts, tokens) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 } } })
const commandLine = (uuid, cmd) => JSON.stringify({ type: 'user', uuid, message: { content: `<command-name>${cmd}</command-name>` } })

describe('the hook', () => {
  it('notes a session state per event, keyed on the session id', () => {
    const spool = tmp()
    expect(noteHook({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/x/burrow' }, spool, ago(10))).toBe(true)
    noteHook({ hook_event_name: 'Stop', session_id: 's1' }, spool, ago(5))
    const all = JSON.parse(readFileSync(join(spool, 'sessions.json'), 'utf8'))
    expect(all.s1).toEqual({ state: 'waiting', at: at(5), cwd: '/x/burrow' })
    noteHook({ hook_event_name: 'SessionEnd', session_id: 's1' }, spool, ago(1))
    expect(JSON.parse(readFileSync(join(spool, 'sessions.json'), 'utf8')).s1.state).toBe('done')
  })

  it('files a publish once, by its url, and ignores other tools and events', () => {
    const spool = tmp()
    const page = join(spool, 'page.html')
    writeFileSync(page, '<html><head><title>Dev HQ picks</title></head></html>')
    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Artifact',
      tool_input: { file_path: page },
      tool_response: [{ type: 'text', text: `Published ${page} at https://claude.ai/artifact/AbC123 (Version 1, version id x)` }],
    }
    expect(noteHook(input, spool, NOW)).toBe(true)
    expect(noteHook(input, spool, NOW)).toBe(false)
    expect(noteHook({ ...input, tool_name: 'Bash' }, spool, NOW)).toBe(false)
    expect(noteHook({ hook_event_name: 'Notification', session_id: 's' }, spool, NOW)).toBe(false)
    expect(linksPart(spool)).toEqual([{ name: 'Dev HQ picks', url: 'https://claude.ai/artifact/AbC123', group: 'claude', mark: null }])
  })

  it('reads the url and the name a publish leaves', () => {
    expect(publishedUrl('Published /a/b.html at https://claude.ai/code/artifact/x-1 (Version 3')).toBe('https://claude.ai/code/artifact/x-1')
    expect(publishedUrl('Quickstart. https://claude.ai/artifact/GZ')).toBe(null)
    expect(linkName('/nowhere/plan-page.html', null)).toBe('plan-page')
    expect(linkName('/nowhere/plan-page.html', 'The plan')).toBe('The plan')
  })
})

describe('sessions', () => {
  it('lists the app\'s sessions with real titles, running or waiting by the hooks, archived as done', () => {
    const root = tmp()
    const app = join(root, 'app')
    const spool = join(root, 'spool')
    const burrow = project(root, 'burrow')
    appSession(app, 'live', { title: 'burrow · wrap · 1.2', cwd: join(burrow, '.claude', 'worktrees', 'w1'), createdAt: ago(120), lastActivityAt: ago(20) })
    appSession(app, 'idle', { title: 'burrow · fix · x', cwd: burrow, createdAt: ago(300), lastActivityAt: ago(60) })
    appSession(app, 'gone', { title: 'old', cwd: burrow, isArchived: true, createdAt: ago(200), lastActivityAt: ago(90) })
    appSession(app, 'stale', { title: 'last week', cwd: burrow, createdAt: ago(9000), lastActivityAt: ago(9000) })
    noteHook({ hook_event_name: 'UserPromptSubmit', session_id: 'live', cwd: burrow }, spool, ago(15))
    noteHook({ hook_event_name: 'SessionStart', session_id: 'term', cwd: burrow }, spool, ago(3))
    // an archived session's hooks don't bring it back as a terminal one
    noteHook({ hook_event_name: 'Stop', session_id: 'stale', cwd: burrow }, spool, ago(2))
    const part = sessionsPart({ app, spool, now: NOW })
    expect(part.full).toBe(true)
    const by = Object.fromEntries(part.list.map((s) => [s.ref, s]))
    expect(Object.keys(by).sort()).toEqual(['gone', 'idle', 'live', 'term'])
    expect(by.live).toMatchObject({ project: 'burrow', title: 'burrow · wrap · 1.2', state: 'running', started_at: at(120), ended_at: null })
    expect(by.idle.state).toBe('waiting')
    expect(by.gone).toMatchObject({ state: 'done', ended_at: at(90) })
    expect(by.term).toMatchObject({ project: 'burrow', state: 'running', title: 'burrow · burrow' })
    expect(part.list[0].ref).toBe('term')
  })

  it('is no full list where the app keeps none (delphi, the terminal)', () => {
    const root = tmp()
    noteHook({ hook_event_name: 'SessionStart', session_id: 's', cwd: '/home/x/kastalia' }, join(root, 'spool'), ago(1))
    const part = sessionsPart({ app: join(root, 'none'), spool: join(root, 'spool'), now: NOW })
    expect(part.full).toBe(false)
    expect(part.list).toHaveLength(1)
  })
})

describe('the team', () => {
  it('counts an agent per transcript and a skill per session it started, once per fork', () => {
    const root = tmp()
    const kit = join(root, 'kit')
    mkdirSync(join(kit, 'plugins', 'release', 'agents'), { recursive: true })
    writeFileSync(join(kit, 'plugins', 'release', 'agents', 'chris-de-kok.md'), '')
    mkdirSync(join(kit, 'plugins', 'release', 'skills', 'captain-call'), { recursive: true })
    writeFileSync(join(kit, 'plugins', 'release', 'skills', 'captain-call', 'SKILL.md'), '')
    expect(kitNames(kit).skills.has('captain-call')).toBe(true)
    const projects = join(root, 'projects')
    const folder = join(projects, '-x-burrow')
    mkdirSync(join(folder, 's1', 'subagents'), { recursive: true })
    writeFileSync(join(folder, 's1.jsonl'), [commandLine('u1', '/release:captain-call'), usageLine('m1', 'claude-opus-5-5', at(60), 10e6)].join('\n'))
    // the app's fork: the same command line and message, nothing new
    writeFileSync(join(folder, 'z1-copy.jsonl'), [commandLine('u1', '/release:captain-call'), usageLine('m1', 'claude-opus-5-5', at(60), 10e6)].join('\n'))
    writeFileSync(join(folder, 's1', 'subagents', 'agent-a.jsonl'), usageLine('m2', 'claude-opus-5-5', at(30), 4e6))
    writeFileSync(join(folder, 's1', 'subagents', 'agent-a.meta.json'), JSON.stringify({ agentType: 'release:chris-de-kok' }))
    writeFileSync(join(folder, 's1', 'subagents', 'agent-b.jsonl'), usageLine('m3', 'claude-sonnet-5-5', at(20), 1e6))
    writeFileSync(join(folder, 's1', 'subagents', 'agent-b.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'chris-de-kok: step 2' }))
    // a session that ran a skill midway (past its first 40 lines) is not that skill's run
    const talk = Array.from({ length: 40 }, (_, i) => JSON.stringify({ type: 'user', uuid: `t${i}`, message: { content: 'hello' } }))
    writeFileSync(join(folder, 's2.jsonl'), [...talk, commandLine('u3', '/captain-call'), usageLine('m4', 'claude-opus-5-5', at(10), 5e6)].join('\n'))
    const team = teamPart({ projects, kit, now: NOW })
    const by = Object.fromEntries(team.map((t) => [t.name, t]))
    expect(Object.keys(by).sort()).toEqual(['/captain-call', 'chris-de-kok'])
    expect(by['/captain-call']).toEqual({ name: '/captain-call', model: 'opus', cost_per_run: 15, runs: 1, last_used_at: at(20) })
    expect(by['chris-de-kok']).toEqual({ name: 'chris-de-kok', model: 'opus', cost_per_run: 2.5, runs: 2, last_used_at: at(20) })
    expect(team[0].last_used_at >= team[1].last_used_at).toBe(true)
  })
})

describe('links', () => {
  it('backfills the last week\'s publishes, newest name per page, and sends each once', () => {
    const root = tmp()
    const folder = join(root, 'projects', '-x-kit')
    mkdirSync(folder, { recursive: true })
    const call = (id, input, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Artifact', input }] } })
    const result = (id, text, ts) => JSON.stringify({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } })
    writeFileSync(
      join(folder, 'a.jsonl'),
      [
        call('t1', { file_path: '/gone/deck.html', title: 'Deck' }, at(300)),
        result('t1', 'Published /gone/deck.html at https://claude.ai/artifact/D1 (Version 1', at(300)),
        call('t2', { file_path: '/gone/deck.html', title: 'Command Deck' }, at(100)),
        result('t2', 'Published /gone/deck.html at https://claude.ai/artifact/D1 (Version 2', at(100)),
        call('t3', { action: 'quickstart', intent: 'other' }, at(90)),
        result('t3', 'Quickstart. https://claude.ai/artifact/TYPE', at(90)),
        call('t4', { file_path: '/gone/old.html' }, at(60 * 24 * 9)),
        result('t4', 'Published /gone/old.html at https://claude.ai/artifact/OLD (Version 1', at(60 * 24 * 9)),
      ].join('\n'),
    )
    const found = publishesIn(join(root, 'projects'), NOW)
    expect(found.map((l) => [l.name, l.url])).toEqual([['Command Deck', 'https://claude.ai/artifact/D1']])
    const spool = join(root, 'spool')
    mkdirSync(spool, { recursive: true })
    writeFileSync(join(spool, 'links.json'), JSON.stringify([{ name: 'Sent', url: 'https://claude.ai/artifact/S', sent: true }, ...found]))
    expect(linksPart(spool)).toEqual([{ name: 'Command Deck', url: 'https://claude.ai/artifact/D1', group: 'claude', mark: null }])
  })
})

describe('the week', () => {
  it('shares are each project\'s slice of the meter, lower-cased', () => {
    expect(sharesPart({ projects: [{ name: 'Burrow', meterPct: 29.24 }, { name: 'tiny', meterPct: 0.01 }] })).toEqual([{ project: 'burrow', pct: 29.2 }])
    expect(sharesPart(null)).toBe(null)
  })

  it('readings are the seven-day ticks since the reset, with the meter now', () => {
    const root = tmp()
    const meterNow = join(root, 'meter-now.json')
    const meterTicks = join(root, 'ticks.log')
    writeFileSync(meterNow, JSON.stringify({ at: at(1), rate_limits: [{ kind: 'seven_day', percentUsed: 42, resetsAt: '2026-10-31T10:00:00.000Z' }] }))
    writeFileSync(
      meterTicks,
      [
        `2026-10-24T09:00:00.000Z\tseven_day\t90\t95\t2026-10-24T10:00:00.000Z`, // last week
        `2026-10-25T09:00:00.000Z\tseven_day\t1\t2\t2026-10-31T10:00:00.000Z`,
        `2026-10-25T09:00:00.000Z\tfive_hour\t1\t50\t2026-10-25T12:00:00.000Z`,
        `2026-10-28T13:00:00.000Z\tseven_day\tstart\t41\t2026-10-31T10:00:00.000Z`,
      ].join('\n'),
    )
    expect(readingsPart({ meterNow, meterTicks, now: NOW })).toEqual([
      { at: '2026-10-25T09:00:00.000Z', pct: 2 },
      { at: '2026-10-28T13:00:00.000Z', pct: 41 },
      { at: at(1), pct: 42 },
    ])
  })
})

describe('the push', () => {
  it('keeps the sender\'s own keys over the kit\'s', () => {
    expect(withParts({ machine: 'pollux', steps: { full: true, list: [] } }, { steps: 'kit', team: [] })).toEqual({ machine: 'pollux', steps: { full: true, list: [] }, team: [] })
  })

  it('waits two minutes after the last push, and only one waits at a time', () => {
    const spool = tmp()
    expect(pushDelay(spool, NOW)).toBe(5_000)
    writeFileSync(join(spool, 'pushed.json'), JSON.stringify({ at: at(1) }))
    expect(pushDelay(spool, NOW)).toBe(60_000)
    writeFileSync(join(spool, 'pending.json'), JSON.stringify({ at: at(1) }))
    expect(pushDelay(spool, NOW)).toBe(null)
  })

  it('leaves the pushing to a sender that reads the spool itself', () => {
    const root = tmp()
    writeFileSync(join(root, 'old.sh'), '#!/bin/bash\necho report\n')
    writeFileSync(join(root, 'new.sh'), `#!/bin/bash\nKIT="$STATE/../${KIT_PARTS_MARK}"\n`)
    expect(senderFoldsSpool(join(root, 'old.sh'))).toBe(false)
    expect(senderFoldsSpool(join(root, 'new.sh'))).toBe(true)
    expect(senderFoldsSpool(join(root, 'none.sh'))).toBe(false)
  })
})
