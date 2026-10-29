import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KIT_PARTS_MARK,
  kitNames,
  linkName,
  linksPart,
  meterWeek,
  noteHook,
  publishedUrl,
  publishesIn,
  pushDelay,
  readingsPart,
  senderFoldsSpool,
  sessionsPart,
  sharesPart,
  teamPart,
  tiersPart,
  withParts,
} from './dev-hq.mjs'
import { readFreeTiers } from './scrooge.mjs'
import { edgeMonth, netlifyReading, vercelReading } from './tier-readers.mjs'
import { receipt } from './week-receipt.mjs'

const NOW = Date.parse('2026-10-28T14:00:00Z')
const RESET = '2026-10-31T10:00:00.000Z'
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
    // idle with nothing asked is done as of its last activity, not waiting
    expect(by.idle).toMatchObject({ state: 'done', ended_at: at(60) })
    expect(by.gone).toMatchObject({ state: 'done', ended_at: at(90) })
    expect(by.term).toMatchObject({ project: 'burrow', state: 'running', title: 'burrow · burrow' })
    expect(part.list[0].ref).toBe('term')
  })

  it('waits on him only when the latest turn asked, the app stopped for him, or the roll call says so', () => {
    const root = tmp()
    const app = join(root, 'app')
    const spool = join(root, 'spool')
    const rollCall = join(root, 'state.json')
    const idle = { createdAt: ago(300), lastActivityAt: ago(40), lastTurnEdgeAt: ago(40) }
    appSession(app, 'asked', { ...idle, title: 'asked', turnWrapUp: { description: 'PR open', needsUser: 'Merge it?' } })
    appSession(app, 'told', { ...idle, title: 'told', turnWrapUp: { description: 'PR open' } })
    // asked, but he typed since: that wrap-up is an older turn's
    appSession(app, 'answered', { ...idle, title: 'answered', turnWrapUp: { needsUser: 'Merge it?' } })
    noteHook({ hook_event_name: 'UserPromptSubmit', session_id: 'answered' }, spool, ago(35))
    appSession(app, 'stopped', { ...idle, title: 'stopped', interruptedAwaitingPerson: true })
    appSession(app, 'rolled', { ...idle, title: 'rolled' })
    appSession(app, 'moved', { ...idle, title: 'moved' })
    // asked three days ago: still listed, still waiting
    appSession(app, 'old', { title: 'old', createdAt: ago(5000), lastActivityAt: ago(4400), lastTurnEdgeAt: ago(4400), turnWrapUp: { needsUser: 'Which one?' } })
    writeFileSync(
      rollCall,
      JSON.stringify({
        local_rolled: { status: 'waiting', lastActivityAt: at(40) },
        // the roll call's word is about older activity than the app's now
        local_moved: { status: 'stalled', lastActivityAt: at(90) },
      }),
    )
    const by = Object.fromEntries(sessionsPart({ app, spool, rollCall, now: NOW }).list.map((s) => [s.ref, s.state]))
    expect(by).toEqual({ asked: 'waiting', told: 'done', answered: 'done', stopped: 'waiting', rolled: 'waiting', moved: 'done', old: 'waiting' })
  })

  it('is no full list where the app keeps none (delphi, the terminal), and a hook six hours quiet is done', () => {
    const root = tmp()
    const spool = join(root, 'spool')
    noteHook({ hook_event_name: 'SessionStart', session_id: 's', cwd: '/home/x/kastalia' }, spool, ago(1))
    noteHook({ hook_event_name: 'Stop', session_id: 'q', cwd: '/home/x/kastalia' }, spool, ago(7 * 60))
    const part = sessionsPart({ app: join(root, 'none'), spool, now: NOW })
    expect(part.full).toBe(false)
    expect(part.list.map((s) => [s.ref, s.state, s.ended_at])).toEqual([
      ['s', 'running', null],
      ['q', 'done', at(7 * 60)],
    ])
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
  it('shares are each project\'s slice of the meter, lower-cased, under the reset they count toward', () => {
    expect(sharesPart({ projects: [{ name: 'Burrow', meterPct: 29.24 }, { name: 'tiny', meterPct: 0.01 }] }, Date.parse(RESET))).toEqual({
      resets_at: RESET,
      list: [{ project: 'burrow', pct: 29.2 }],
    })
    expect(sharesPart(null, Date.parse(RESET))).toBe(null)
  })

  it('shares sum a project\'s old and new folders under one key (the name map)', () => {
    const projects = [
      { name: 'pylos', meterPct: 10 },
      { name: 'dojo', meterPct: 5 },
      { name: 'pelion', meterPct: 3 },
      { name: 'fantasy-hq', meterPct: 2 },
      { name: 'HutzUp', meterPct: 4 },
      { name: 'game-night-planning-app', meterPct: 1 },
      { name: 'homelab', meterPct: 2.5 },
    ]
    expect(sharesPart({ projects }, Date.parse(RESET)).list).toEqual([
      { project: 'pylos', pct: 15 },
      { project: 'pelion', pct: 5 },
      { project: 'hutzup', pct: 5 },
      { project: 'kastalia', pct: 2.5 },
    ])
  })

  it('the meter\'s week runs from Saturday\'s reset, also where meter-now.json is missing (delphi) or old', () => {
    const root = tmp()
    const meterNow = join(root, 'meter-now.json')
    const week = { start: Date.parse('2026-10-24T10:00:00.000Z'), end: Date.parse(RESET) }
    expect(meterWeek(meterNow, NOW)).toEqual(week)
    // the weekend after a reset is the new week's, not Monday's
    expect(meterWeek(meterNow, Date.parse('2026-10-24T10:00:01.000Z'))).toEqual(week)
    expect(meterWeek(meterNow, Date.parse('2026-10-24T09:59:59.000Z')).end).toBe(Date.parse('2026-10-24T10:00:00.000Z'))
    expect(meterWeek(meterNow, Date.parse('2026-12-02T12:00:00.000Z')).end).toBe(Date.parse('2026-12-05T10:00:00.000Z'))
    // the tower's own reset wins, and one that passed moves on a week
    writeFileSync(meterNow, JSON.stringify({ at: at(1), rate_limits: [{ kind: 'seven_day', percentUsed: 42, resetsAt: '2026-10-30T08:00:00.000Z' }] }))
    expect(meterWeek(meterNow, NOW).end).toBe(Date.parse('2026-10-30T08:00:00.000Z'))
    expect(meterWeek(meterNow, Date.parse('2026-10-30T09:00:00.000Z')).end).toBe(Date.parse('2026-11-06T08:00:00.000Z'))
  })

  it('the receipt counts the meter\'s week, Saturday to Saturday, when given its range', () => {
    const root = tmp()
    const folder = join(root, 'projects', '-x-burrow')
    mkdirSync(folder, { recursive: true })
    const line = (id, ts, tokens) => JSON.stringify({ type: 'assistant', cwd: '/x/burrow', timestamp: ts, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 } } })
    writeFileSync(join(folder, 's.jsonl'), [line('m1', '2026-10-24T09:00:00.000Z', 5e6), line('m2', '2026-10-24T12:00:00.000Z', 2e6), line('m3', '2026-10-27T12:00:00.000Z', 1e6)].join('\n'))
    const r = receipt({ week: 'meter', range: meterWeek(join(root, 'none.json'), NOW), projectsDir: join(root, 'projects'), kit: null })
    expect(r.totalTokens).toBe(3e6)
    expect(r.from).toBe('2026-10-24T10:00:00.000Z')
  })

  it('readings are every seven-day tick with its reset, the changes and each week\'s last', () => {
    const root = tmp()
    const meterNow = join(root, 'meter-now.json')
    const meterTicks = join(root, 'ticks.log')
    writeFileSync(meterNow, JSON.stringify({ at: at(1), rate_limits: [{ kind: 'seven_day', percentUsed: 42, resetsAt: RESET }] }))
    const W43 = '2026-10-24T10:00:00.000Z'
    writeFileSync(
      meterTicks,
      [
        `2026-10-23T09:00:00.000Z\tseven_day\t90\t95\t${W43}`,
        `2026-10-23T10:00:00.000Z\tseven_day\t95\t95\t${W43}`, // no change: dropped
        `2026-10-24T09:00:00.000Z\tseven_day\t95\t95\t${W43}`, // no change, but the week's last: kept
        `2026-10-25T09:00:00.000Z\tseven_day\tstart\t2\t${RESET}`, // the weekend after the reset: next week's
        `2026-10-25T09:00:00.000Z\tfive_hour\t1\t50\t2026-10-25T12:00:00.000Z`,
        `2026-10-28T13:00:00.000Z\tseven_day\t2\t41\t${RESET}`,
        `2026-10-10T09:00:00.000Z\tseven_day\t1\t2\t${W43}`, // outside its own week: dropped
      ].join('\n'),
    )
    expect(readingsPart({ meterNow, meterTicks, now: NOW })).toEqual([
      { at: '2026-10-23T09:00:00.000Z', pct: 95, resets_at: W43 },
      { at: '2026-10-24T09:00:00.000Z', pct: 95, resets_at: W43 },
      { at: '2026-10-25T09:00:00.000Z', pct: 2, resets_at: RESET },
      { at: '2026-10-28T13:00:00.000Z', pct: 41, resets_at: RESET },
      { at: at(1), pct: 42, resets_at: RESET },
    ])
  })
})

describe('free tiers and trials', () => {
  const scan = {
    trials: [
      { service: 'Claude Max 20x (renewal)', ends: '2026-11-08', card: 'yes', atEnd: 'renews at Max 20x', status: 'ok' },
      { service: 'Old trial', ends: '2026-10-01', card: 'no', atEnd: '', status: 'ended' },
      { service: 'No date', ends: null, card: 'unknown', atEnd: '', status: 'no-date' },
    ],
    freeTiers: [
      {
        project: 'burrow',
        limits: [
          { service: 'Supabase (Free plan)', limit: 'Database size', value: '500 MB per project', pct: null },
          { service: 'Supabase (Free plan)', limit: 'Monthly active users', value: '50,000', pct: null },
          { service: 'Supabase (Free plan)', limit: 'Edge Function invocations', value: '500,000 / month', pct: 12 },
          { service: 'GitHub Actions (GitHub Free account)', limit: 'Public repos', value: 'Free, no minute cap', pct: null },
          { service: 'GitHub Actions (GitHub Free account)', limit: 'Private repos, minutes', value: '2,000 / month', pct: null },
          { service: 'Resend (Free)', limit: 'Emails per day', value: '100 (sent and received both count)', pct: null },
          { service: 'CoinGecko (Demo API, free; added at the V0.7 wrap)', limit: 'Monthly calls', value: 'about 10 000', pct: null },
          { service: 'CoinGecko (Demo API, free; added at the V0.7 wrap)', limit: "Burrow's use", value: '240 a month ≈ 2.4 % of the limit', pct: 2.4 },
        ],
      },
      {
        project: 'hejtide',
        limits: [{ service: 'Supabase (Free plan)', limit: 'Edge Function invocations', value: '500,000 / month', pct: 30 }],
      },
    ],
  }

  it('sends each open trial and one row per service, with its binding limit and the highest usage recorded', () => {
    expect(tiersPart(scan)).toEqual({
      full: true,
      list: [
        { kind: 'trial', name: 'Claude Max 20x (renewal)', pct: null, detail: 'Card on file. At the end: renews at Max 20x', ends_on: '2026-11-08' },
        { kind: 'usage', name: 'Supabase (Free plan)', pct: 30, detail: 'Edge Function invocations: 500,000 / month', ends_on: null },
        { kind: 'usage', name: 'GitHub Actions (GitHub Free account)', pct: null, detail: 'Private repos, minutes: 2,000 / month', ends_on: null },
        { kind: 'usage', name: 'Resend (Free)', pct: null, detail: 'Emails per day: 100. Not read: needs a Resend API key, which only you hold', ends_on: null },
        { kind: 'usage', name: 'CoinGecko (Demo API, free)', pct: 2.4, detail: 'Monthly calls: about 10 000', ends_on: null },
      ],
    })
    expect(tiersPart(null)).toBe(null)
  })

  it('takes GitHub Actions minutes from gh when it has them', () => {
    const gh = tiersPart(scan, { actionsMinutes: 500 }).list.find((t) => t.name.startsWith('GitHub'))
    expect(gh).toMatchObject({ pct: 25, detail: '500 of 2,000 minutes this month' })
  })

  it('sets live readings against the free-tiers rows, and says what an unread one needs', () => {
    const rows = (service, list) => list.map(([limit, value]) => ({ service, limit, value, pct: null }))
    const live = {
      freeTiers: [
        {
          limits: [
            ...rows('Vercel (Hobby)', [['Fast Data Transfer (bandwidth)', '100 GB / month'], ['Function invocations', '1,000,000 / month'], ['CDN requests', '1,000,000 / month']]),
            ...rows('Supabase (Free plan)', [['Database size', '500 MB per project'], ['Edge Function invocations', '500,000 / month'], ['Active free projects', '2. The pricing page says']]),
            ...rows('Netlify (Free, credit-based)', [['Credits', '300 / month, hard limit']]),
            ...rows('GitHub Actions (GitHub Free account)', [['Private repos, minutes', '2,000 / month']]),
          ],
        },
      ],
    }
    const readings = {
      vercel: vercelReading({ services: [
        { product: 'pro', name: 'Pro', quantity: 1, cost: 12.258, category: 'subscription' },
        { product: 'fastDataTransfer', quantity: 0.163, cost: 0.02, category: 'usage' },
        { product: 'functionInvocation', quantity: 32, category: 'usage' },
        { product: 'edgeRequest', quantity: 90_000, category: 'usage' },
        { product: 'buildCpuMinutes', quantity: 20, category: 'usage' },
      ] }),
      supabase: { edgeInvocations: 100_000, edgeSince: '2026-10-28', dbMb: 40, activeFree: 2 },
      netlify: netlifyReading([{ default: true, plan_credits: 300, usages_exceeded: [] }], []),
      'github actions': { need: "gh's user scope" },
    }
    const by = Object.fromEntries(tiersPart(live, { readings }).list.map((t) => [t.name.split(' ')[0], t]))
    expect(by.Vercel).toMatchObject({ pct: 9, detail: 'Billed this cycle: Pro $12.26, check Vercel billing. CDN requests 90,000 of 1,000,000, Fast Data Transfer 0.16 of 100 GB, Function invocations 32 of 1,000,000, Build CPU 20 min' })
    expect(by.Supabase).toMatchObject({ pct: 20, detail: 'Edge Functions 100,000 of 500,000 this month (counted since 28 Oct), largest database 40 of 500 MB, 2 of 2 active free projects' })
    expect(by.Netlify).toMatchObject({ pct: 0, detail: 'No sites on the account, so none of the 300 credits a month used' })
    expect(by.GitHub).toMatchObject({ pct: null, detail: "Private repos, minutes: 2,000 / month. Not read: needs gh's user scope (gh auth refresh -h github.com -s user)" })
  })

  it('sums the Edge Function hours it kept this month, per free org, and drops last month', () => {
    const now = Date.parse('2026-11-02T10:00:00Z')
    const store = { since: '2026-10-20T00:00:00', hours: { 'a/f/2026-10-31T23:00:00': 50, 'a/f/2026-11-01T00:00:00': 10 } }
    const buckets = [
      { ref: 'a', fn: 'f', t: '2026-11-01T00:00:00', n: 12 },
      { ref: 'a', fn: 'g', t: '2026-11-02T09:00:00', n: 3 },
      { ref: 'b', fn: 'h', t: '2026-11-02T09:00:00', n: 40 },
    ]
    const out = edgeMonth(store, buckets, { a: 'org1', b: 'org2' }, now)
    expect(out.invocations).toBe(40)
    expect(out.since).toBe(null)
    expect(Object.keys(out.store.hours)).toHaveLength(3)
    expect(edgeMonth(null, buckets.slice(1), { a: 'org1', b: 'org1' }, now)).toMatchObject({ invocations: 43, since: '2026-11-02' })
  })

  it('reads every free-tiers row with its service for the part', () => {
    const text = ['## Resend (Free)', '', '| Limit | Value | Used | Read |', '|---|---|---|---|', '| Emails per day | 100 | 40 | 2026-10-05 |'].join('\n')
    expect(readFreeTiers(text, '2026-10-28', 'f.md', 'burrow').limits).toEqual([{ service: 'Resend (Free)', limit: 'Emails per day', value: '100', pct: 40 }])
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
