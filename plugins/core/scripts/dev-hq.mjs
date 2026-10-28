#!/usr/bin/env node
// The kit's Dev HQ feed: the parts of Burrow's `dev-in` body only the kit can
// read, sent with the machine's own report (Burrow's /legendary of 27 Oct,
// the kit card: W2 sessions, C8 links, W9 team; W4's shares and readings ride
// along). Burrow's `scripts/dev-hq/README.md` ("The kit's parts (V1.2)") is
// the contract.
//
//   node dev-hq.mjs hook             a Claude Code hook (stdin): notes the
//                                    session's state or a publish's link in the
//                                    spool, then asks for a push; prints nothing
//   node dev-hq.mjs parts [--backfill]  the parts as JSON (no POST)
//   node dev-hq.mjs push [--dry-run] [--backfill] [--wait <s>]
//                                    the sender's own body (its --dry-run) with
//                                    the parts added, POSTed to dev-in
//
// Why the sender's body: `dev-in` wants a device report in every POST and
// writes a reading from it, so the kit never makes one up. Until Burrow's
// sender reads the spool itself (it then names KIT_PARTS_MARK), a hook asks
// for one push, at most one every two minutes.
//
// --backfill also files the last week's publishes from the transcripts (once:
// a link filed is never sent again, so one he deletes stays deleted).
//
// Paths: BURROW_DEV_CONF (~/.config/burrow: dev-token, dev-url), BURROW_DEV_STATE
// (~/.local/state/burrow-dev; the spool is its kit/ folder), DEV_HQ_APP_SESSIONS
// (the desktop app's session files), DEV_HQ_PROJECTS (~/.claude/projects).
// The token is read into memory and sent as a header, never printed or passed
// on a command line.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentName, dropCounted, parseEntries, sessionCommand, tallyEntries, totalTokens } from '../../release/scripts/usage.mjs'
import { cachedReceipt, projectOfCwd } from './week-receipt.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = join(HERE, '..', '..', '..')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// A sender that folds the spool into its own report says so with this word.
export const KIT_PARTS_MARK = 'burrow-dev/kit'

export function paths(env = process.env, home = homedir()) {
  const state = env.BURROW_DEV_STATE || join(home, '.local', 'state', 'burrow-dev')
  return {
    home,
    conf: env.BURROW_DEV_CONF || join(home, '.config', 'burrow'),
    spool: join(state, 'kit'),
    app: env.DEV_HQ_APP_SESSIONS || join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
    projects: env.DEV_HQ_PROJECTS || join(home, '.claude', 'projects'),
    meterNow: join(home, '.claude', 'meter-now.json'),
    meterTicks: join(home, '.claude', 'meter-ticks.log'),
  }
}

// --- the spool ---------------------------------------------------------------------------

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

// Written to a temp file and renamed in, so a reader never sees half a file.
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value)}\n`)
  renameSync(tmp, file)
}

const STATE_OF = { SessionStart: 'running', UserPromptSubmit: 'running', Stop: 'waiting', SessionEnd: 'done' }

// The url a publish answered with ("Published <file> at https://claude.ai/artifact/<id> (Version 2 …").
export function publishedUrl(text) {
  return /Published .*? at (https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+)/.exec(String(text ?? ''))?.[1] ?? null
}

// A page's name: its <title>, else the call's title, else the file's name.
export function linkName(filePath, title) {
  try {
    const t = /<title>([^<]{1,200})<\/title>/i.exec(readFileSync(filePath, 'utf8'))?.[1]?.trim()
    if (t) return t.slice(0, 120)
  } catch {
    // no file here (another machine, or gone): the next best name
  }
  if (title) return String(title).slice(0, 120)
  return filePath ? basename(filePath).replace(/\.[a-z]+$/i, '') : 'Published page'
}

function addLink(spool, link) {
  const file = join(spool, 'links.json')
  const links = readJson(file, [])
  if (links.some((l) => l.url === link.url)) return false
  links.push(link)
  writeJson(file, links.slice(-200))
  return true
}

// One hook event into the spool: a session's state, or a publish's link.
export function noteHook(input, spool, now = Date.now()) {
  const at = new Date(now).toISOString()
  const event = input?.hook_event_name
  if (event === 'PostToolUse') {
    if (input.tool_name !== 'Artifact') return false
    const url = publishedUrl(typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response))
    if (!url) return false
    return addLink(spool, { name: linkName(input.tool_input?.file_path, input.tool_input?.title), url, at, sent: false })
  }
  const state = STATE_OF[event]
  if (!state || !input.session_id) return false
  const file = join(spool, 'sessions.json')
  const all = readJson(file, {})
  all[input.session_id] = { state, at, cwd: input.cwd || all[input.session_id]?.cwd || null }
  // a day of sessions is plenty: dev-in keeps the rest
  for (const [id, s] of Object.entries(all)) if (now - Date.parse(s.at) > DAY) delete all[id]
  writeJson(file, all)
  return true
}

// --- sessions (W2) -----------------------------------------------------------------------

function appSessions(dir) {
  const out = []
  const sub = (p) => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(p, e.name))
    } catch {
      return []
    }
  }
  for (const a of sub(dir)) {
    for (const b of sub(a)) {
      let names = []
      try {
        names = readdirSync(b)
      } catch {
        continue
      }
      for (const n of names) if (/^local_.*\.json$/.test(n)) out.push(readJson(join(b, n), null))
    }
  }
  return out.filter((s) => s && s.cliSessionId)
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)
const projectOf = (cwd) => {
  if (!cwd) return null
  const p = String(projectOfCwd(cwd)).toLowerCase().slice(0, 60)
  return p || null
}

// This machine's sessions: the desktop app's own list (titles, archived) with
// the hooks' word on running or waiting. Open and seen in the last day:
// running while a turn runs, else waiting on him; archived in the last day:
// done. With the app's list read, the list is full, so dev-in ends the rest.
export function sessionsPart({ app, spool, now = Date.now() }) {
  const hooks = readJson(join(spool, 'sessions.json'), {})
  const fromApp = appSessions(app)
  const list = []
  const seen = new Set()
  for (const s of fromApp) {
    const last = Number(s.lastActivityAt) || Number(s.createdAt) || 0
    const hook = hooks[s.cliSessionId]
    seen.add(s.cliSessionId)
    let state
    if (s.isArchived) {
      if (now - last > DAY) continue
      state = 'done'
    } else {
      if (now - last > DAY) continue
      const busy = hook?.state === 'running' && now - Math.max(last, Date.parse(hook.at)) < 30 * MIN
      state = busy || now - last < 2 * MIN ? 'running' : hook?.state === 'done' ? 'done' : 'waiting'
    }
    const started = Number(s.createdAt) || last
    list.push({
      ref: s.cliSessionId,
      project: projectOf(s.originCwd || s.cwd),
      title: String(s.title || basename(s.cwd || '') || 'session').replace(/\s+/g, ' ').trim().slice(0, 120),
      state,
      started_at: iso(started),
      ended_at: state === 'done' ? iso(Math.max(last, started)) : null,
      _last: last,
    })
  }
  // a session the app doesn't list (the terminal, delphi): the hooks alone
  for (const [ref, h] of Object.entries(hooks)) {
    if (seen.has(ref) || !/^[^\s]{1,80}$/.test(ref)) continue
    const project = projectOf(h.cwd)
    list.push({
      ref,
      project,
      title: `${project || 'session'} · ${basename(h.cwd || '') || 'terminal'}`.slice(0, 120),
      state: h.state,
      started_at: null,
      ended_at: h.state === 'done' ? h.at : null,
      _last: Date.parse(h.at),
    })
  }
  list.sort((a, b) => b._last - a._last)
  return { full: fromApp.length > 0, list: list.slice(0, 200).map(({ _last, ...s }) => s) }
}

// --- the team (W9) -----------------------------------------------------------------------

// The kit's agents and skills by their file names (and the agents usage.mjs knows).
export function kitNames(kit = KIT) {
  const agents = new Set()
  const skills = new Set()
  let plugins = []
  try {
    plugins = readdirSync(join(kit, 'plugins'))
  } catch {
    return { agents, skills }
  }
  for (const p of plugins) {
    try {
      for (const f of readdirSync(join(kit, 'plugins', p, 'agents'))) if (f.endsWith('.md')) agents.add(f.slice(0, -3))
    } catch {
      // a plugin without agents
    }
    try {
      for (const d of readdirSync(join(kit, 'plugins', p, 'skills'))) if (existsSync(join(kit, 'plugins', p, 'skills', d, 'SKILL.md'))) skills.add(d)
    } catch {
      // a plugin without skills
    }
  }
  return { agents, skills }
}

const family = (model) => (/(haiku|sonnet|opus|fable)/i.exec(model || '') || [null])[0]?.toLowerCase() ?? null

// Only the lines that count: the usage ones, whose tokens are tallied, and the
// first 40, where sessionCommand looks for the command that started it. The
// rest of a transcript (tool output, mostly) is never parsed, which keeps a
// month of transcripts to seconds.
function readCounted(file, seen) {
  let lines
  try {
    lines = readFileSync(file, 'utf8').split('\n')
  } catch {
    return { entries: [], head: [] }
  }
  const head = parseEntries(lines.slice(0, 40).join('\n'))
  const entries = dropCounted(parseEntries(lines.filter((l) => l.includes('"usage"')).join('\n')), seen)
  return { entries, head }
}

function addRun(by, name, entries) {
  const tally = tallyEntries(entries)
  let tokens = 0
  const models = new Map()
  for (const [model, b] of tally) {
    const t = totalTokens(b)
    tokens += t
    const f = family(model)
    if (f) models.set(f, (models.get(f) || 0) + t)
  }
  if (tokens === 0) return
  const last = Math.max(...entries.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite))
  const r = by.get(name) || { runs: 0, tokens: 0, models: new Map(), last: 0 }
  r.runs += 1
  r.tokens += tokens
  for (const [f, t] of models) r.models.set(f, (r.models.get(f) || 0) + t)
  if (Number.isFinite(last)) r.last = Math.max(r.last, last)
  by.set(name, r)
}

// Every kit agent and skill run in the last `days`: an agent's run is one
// subagent transcript, a skill's is the session it started (with its agents).
// Skills go by their slash ("/captain-call"), so heisenberg the agent and
// /heisenberg the skill stay two rows. Newest first, at most 100.
export function teamPart({ projects, kit = KIT, now = Date.now(), days = 30 }) {
  const { agents, skills } = kitNames(kit)
  const since = now - days * DAY
  const by = new Map()
  const seen = new Set()
  const started = new Set()
  const fresh = (p) => {
    try {
      return statSync(p).mtimeMs >= since
    } catch {
      return false
    }
  }
  let folders = []
  try {
    folders = readdirSync(projects)
  } catch {
    return null
  }
  for (const folder of folders) {
    let names = []
    try {
      names = readdirSync(join(projects, folder))
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      const main = join(projects, folder, n)
      const subDir = join(projects, folder, n.slice(0, -6), 'subagents')
      let subs = []
      try {
        subs = readdirSync(subDir).filter((s) => s.endsWith('.jsonl') && fresh(join(subDir, s)))
      } catch {
        // no agents in this session
      }
      if (!fresh(main) && subs.length === 0) continue
      const own = fresh(main) ? readCounted(main, seen) : { entries: [], head: [] }
      // only a session the command started (a skill run midway, in brackets, is the session's, not the skill's)
      const skill = /^\/(?:[\w-]+:)?([\w-]+)$/.exec(sessionCommand(own.head))?.[1]
      const all = [...own.entries]
      for (const s of subs) {
        const { entries } = readCounted(join(subDir, s), seen)
        all.push(...entries)
        // "release:chris-de-kok" is the plugin's chris-de-kok
        const meta = readJson(join(subDir, s.replace(/\.jsonl$/, '.meta.json')), {})
        const name = agentName({ ...meta, agentType: typeof meta.agentType === 'string' ? meta.agentType.replace(/^[\w-]+:/, '') : meta.agentType })
        if (name && agents.has(name)) addRun(by, name, entries)
      }
      // a forked copy carries the same command line (its uuid), so it's one run
      const start = own.head.find((e) => e.type === 'user')?.uuid
      if (skill && skills.has(skill) && !(start && started.has(start))) {
        if (start) started.add(start)
        addRun(by, '/' + skill, all)
      }
    }
  }
  return [...by.entries()]
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, 100)
    .map(([name, r]) => ({
      name,
      model: [...r.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      cost_per_run: Math.round((r.tokens / r.runs / 1e6) * 10) / 10,
      runs: r.runs,
      last_used_at: iso(r.last),
    }))
}

// The team is a month of transcripts: counted at most once an hour.
function cachedTeam(p, now) {
  const file = join(p.spool, 'team.json')
  const cached = readJson(file, null)
  if (cached && now - Date.parse(cached.at) < HOUR) return cached.team
  const team = teamPart({ projects: p.projects, now })
  if (team) writeJson(file, { at: new Date(now).toISOString(), team })
  return team
}

// --- links (C8) --------------------------------------------------------------------------

// The publishes of the last `days` in the transcripts, oldest first: the
// backfill for the links filed before the hook was there.
export function publishesIn(projects, now = Date.now(), days = 7) {
  const since = now - days * DAY
  const found = new Map()
  let folders = []
  try {
    folders = readdirSync(projects)
  } catch {
    return []
  }
  for (const folder of folders) {
    let names = []
    try {
      names = readdirSync(join(projects, folder)).filter((n) => n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const n of names) {
      const file = join(projects, folder, n)
      try {
        if (statSync(file).mtimeMs < since) continue
      } catch {
        continue
      }
      const calls = new Map()
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        // the call names the tool, its result only the url
        if (!line.includes('Artifact') && !line.includes('claude.ai/')) continue
        let e
        try {
          e = JSON.parse(line)
        } catch {
          continue
        }
        const content = e?.message?.content
        if (!Array.isArray(content)) continue
        for (const part of content) {
          if (part?.type === 'tool_use' && part.name === 'Artifact') calls.set(part.id, part.input || {})
          if (part?.type !== 'tool_result' || !calls.has(part.tool_use_id)) continue
          const text = typeof part.content === 'string' ? part.content : (part.content || []).map((x) => x?.text || '').join('\n')
          const url = publishedUrl(text)
          const at = Date.parse(e.timestamp)
          if (!url || !(at >= since)) continue
          const input = calls.get(part.tool_use_id)
          // the newest publish of a page names it
          if (!found.has(url) || found.get(url)._at < at) found.set(url, { name: linkName(input.file_path, input.title), url, at: iso(at), sent: false, _at: at })
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => a._at - b._at).map(({ _at, ...l }) => l)
}

// The links not sent yet, oldest first, at most 50 a POST.
export function linksPart(spool) {
  const open = readJson(join(spool, 'links.json'), []).filter((l) => !l.sent)
  if (!open.length) return null
  return open.slice(0, 50).map((l) => ({ name: l.name, url: l.url, group: 'claude', mark: null }))
}

function markSent(spool, urls) {
  const file = join(spool, 'links.json')
  const links = readJson(file, [])
  for (const l of links) if (urls.has(l.url)) l.sent = true
  writeJson(file, links)
}

// --- the week (W4): shares and readings --------------------------------------------------

// This week's share of the meter per project, from the week receipt (cached two hours).
export function sharesPart(receipt) {
  const rows = (receipt?.projects || [])
    .map((p) => ({ project: String(p.name).toLowerCase().slice(0, 60), pct: Math.round(Math.min(100, p.meterPct) * 10) / 10 }))
    .filter((s) => s.project && s.pct >= 0.1)
  return rows.length ? rows.slice(0, 50) : null
}

// The weekly meter since its last reset: the tick log's seven_day lines and
// meter-now.json, newest 1000.
export function readingsPart({ meterNow, meterTicks, now = Date.now() }) {
  const out = new Map()
  const saved = readJson(meterNow, null)
  const week = (saved?.rate_limits || []).find((r) => r.kind === 'seven_day')
  const reset = Date.parse(week?.resetsAt)
  const since = Number.isFinite(reset) ? reset - 7 * DAY : now - 7 * DAY
  let lines = []
  try {
    lines = readFileSync(meterTicks, 'utf8').split('\n')
  } catch {
    // no tick log on this machine
  }
  for (const l of lines) {
    const [at, kind, , pct] = l.split('\t')
    const t = Date.parse(at)
    const n = Number(pct)
    if (kind === 'seven_day' && t >= since && t <= now && Number.isFinite(n) && n >= 0 && n <= 100) out.set(iso(t), n)
  }
  if (week && Date.parse(saved.at) >= since && Number.isFinite(Number(week.percentUsed))) out.set(iso(Date.parse(saved.at)), Number(week.percentUsed))
  const list = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([at, pct]) => ({ at, pct }))
  return list.length ? list.slice(-1000) : null
}

// --- the POST ----------------------------------------------------------------------------

export function senderPath(home = homedir(), host = hostname()) {
  const candidates = /delphi/i.test(host) ? [join(home, 'bin', 'delphi-send')] : [join(home, '.local', 'share', 'burrow-dev', 'pollux-send.sh')]
  return candidates.find((p) => existsSync(p)) || null
}

export function senderFoldsSpool(sender) {
  try {
    return readFileSync(sender, 'utf8').includes(KIT_PARTS_MARK)
  } catch {
    return false
  }
}

export function parts(p, { now = Date.now(), backfill = false } = {}) {
  if (backfill) for (const l of publishesIn(p.projects, now)) addLink(p.spool, l)
  let receipt = null
  try {
    // its own cache: the Sunday recap's receipt stays the recap's (week-receipt's cliReceipt)
    receipt = cachedReceipt({ projectsDir: p.projects, cacheDir: join(p.spool, 'receipt') })
  } catch {
    // no transcripts here: no shares
  }
  const out = {
    sessions: sessionsPart({ app: p.app, spool: p.spool, now }),
    team: cachedTeam(p, now),
    links: linksPart(p.spool),
    shares: sharesPart(receipt),
    readings: readingsPart({ meterNow: p.meterNow, meterTicks: p.meterTicks, now }),
  }
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k]
  return out
}

// The sender's report with the parts on it. A key the sender sent wins:
// once it reads the spool itself, its own parts stand.
export function withParts(body, kitParts) {
  return { ...kitParts, ...body }
}

async function push(p, { dryRun = false, backfill = false, now = Date.now() } = {}) {
  const sender = senderPath(p.home)
  if (!sender) throw new Error('no Dev HQ sender on this machine (connect.sh installs it)')
  const run = spawnSync(sender, ['--dry-run'], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`${basename(sender)} --dry-run failed: ${(run.stderr || '').trim().slice(0, 200)}`)
  const body = withParts(JSON.parse(run.stdout), parts(p, { now, backfill }))
  if (dryRun) return { body }
  const token = readFileSync(join(p.conf, 'dev-token'), 'utf8').split('\n')[0].trim()
  const url = readFileSync(join(p.conf, 'dev-url'), 'utf8').split('\n')[0].trim()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-burrow-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const answer = await res.text()
  if (!res.ok) throw new Error(`dev-in answered ${res.status}: ${answer.slice(0, 300)}`)
  if (body.links) markSent(p.spool, new Set(body.links.map((l) => l.url)))
  writeJson(join(p.spool, 'pushed.json'), { at: new Date(now).toISOString() })
  return { body, answer: readJsonText(answer) }
}

const readJsonText = (t) => {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

// After a hook: one push waiting at a time, at most one every two minutes.
export function pushDelay(spool, now = Date.now()) {
  const pending = readJson(join(spool, 'pending.json'), null)
  if (pending && now - Date.parse(pending.at) < 5 * MIN) return null
  const last = Date.parse(readJson(join(spool, 'pushed.json'), {})?.at)
  return Number.isFinite(last) ? Math.max(5_000, last + 2 * MIN - now) : 5_000
}

function askPush(p, now) {
  const sender = senderPath(p.home)
  if (!sender || senderFoldsSpool(sender) || !existsSync(join(p.conf, 'dev-token'))) return
  const delay = pushDelay(p.spool, now)
  if (delay === null) return
  writeJson(join(p.spool, 'pending.json'), { at: new Date(now).toISOString() })
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'push', '--wait', String(Math.ceil(delay / 1000))], { detached: true, stdio: 'ignore' })
  child.unref()
}

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

async function main(argv) {
  const p = paths()
  const [cmd, ...rest] = argv
  const flag = (f) => rest.includes(f)
  if (cmd === 'hook') {
    // a hook never fails a session and never speaks (UserPromptSubmit's output reaches the model)
    try {
      const now = Date.now()
      if (noteHook(JSON.parse(await readStdin()), p.spool, now)) askPush(p, now)
    } catch {
      // nothing to say
    }
    return
  }
  if (cmd === 'parts') {
    console.log(JSON.stringify(parts(p, { backfill: flag('--backfill') }), null, 2))
    return
  }
  if (cmd === 'push') {
    const i = rest.indexOf('--wait')
    if (i >= 0) {
      await new Promise((r) => setTimeout(r, Math.min(600, Number(rest[i + 1]) || 0) * 1000))
    }
    try {
      const { body, answer } = await push(p, { dryRun: flag('--dry-run'), backfill: flag('--backfill') })
      if (flag('--dry-run')) console.log(JSON.stringify(body, null, 2))
      else {
        const n = (k) => (Array.isArray(body[k]) ? body[k].length : Array.isArray(body[k]?.list) ? body[k].list.length : 0)
        console.log(`dev-in took it: sessions ${n('sessions')}, team ${n('team')}, links ${n('links')}, shares ${n('shares')}, readings ${n('readings')}${answer?.notes?.length ? `; notes: ${answer.notes.join('; ')}` : ''}`)
      }
    } finally {
      if (i >= 0) writeJson(join(p.spool, 'pending.json'), { at: new Date(0).toISOString() })
    }
    return
  }
  throw new Error('Usage: node dev-hq.mjs hook | parts [--backfill] | push [--dry-run] [--backfill] [--wait <s>]')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`dev-hq: ${e.message}`)
    process.exit(1)
  })
}
