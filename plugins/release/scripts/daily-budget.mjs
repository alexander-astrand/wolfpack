#!/usr/bin/env node
// Alexander's daily budget on Max 20x, for every project (user-level
// PreToolUse hook in ~/.claude/settings.json). The kit's copy of
// ~/.claude/hooks/daily-budget.mjs (kit 1.5, L2: the enforcer lives in the
// kit); it behaves the same, and turns points into tokens only through
// usage.mjs's tokensPerPoint (H5 C2). His rule, 8 Oct 2026, memory
// feedback_daily_budget_20x.md:
//
//   1. A week is 7 windows of 24 h starting at the weekly reset (resetsAt − 7 d
//      + n × 24 h), tied to resetsAt and not the clock (summer time ends 25 Oct).
//   2. Window use = weekly meter now − meter at the window's start. At ≥ 14%:
//      finish, start nothing: new Agent spawns, Workflow runs and the heavy
//      skills are denied. Subagents' own calls, ranjit and deploys, and
//      routines are never blocked (a half-finished deploy is worse than an overrun).
//   3. Over 7% before the window's 12 h mark: stepped down for the rest of the
//      window. An Agent call must run one model below its default (Fable → Opus,
//      Opus → Sonnet, Sonnet → Haiku); Fable only on an override. The main
//      session's own model isn't ours to change: it is warned once.
//   4. In the last 2 windows before the reset, with the weekly meter ≤ 60%,
//      rules 2 and 3 are lifted.
//   5. Override: only Alexander's own word in chat. The session then writes
//      ~/.claude/budget-override (`until=<ISO> scope=all|cap|stepdown|fable`).
//
// Data: ~/.claude/meter-now.json (written by the tower mod through this script's
// --tower mode every 10 s) for the meter now, ~/.claude/meter-ticks.log (tail
// only) for the meter at the window's start. A missing or stale meter fails
// OPEN with a one-time warning, and so does any error of this script's own:
// a broken meter must never block work.
//
//   node daily-budget.mjs            the hook (stdin: the hook JSON)
//   node daily-budget.mjs --tower    stdin {rate_limits}; writes meter-now.json, prints "day 5.2/14%"
//   node daily-budget.mjs --status [--active]   dry run: today's numbers and what would be denied

import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readKit, tokensPerPoint } from './usage.mjs'

// The rule switches on here; before it the hook only computes (dry run).
export const ACTIVE_FROM = Date.parse('2026-10-10T10:00:00Z')
export const CAP = 14
export const STEP_AT = 7
export const LIFT_AT = 60
const H = 3_600_000
const DAY = 24 * H
const WEEK = 7 * DAY
export const STALE_MS = 30 * 60_000
const TAIL_BYTES = 256 * 1024
const WEEKLY = 'seven_day'

export const HEAVY_SKILLS = new Set([
  // 'maverick' is captain-call's old name (kit 1.5), kept for a project on an older kit.
  'captain-call', 'maverick', 'cattle-drive', 'superlab', 'inception', 'no-half-measures', 'darth-vader', 'black-box',
])
// Never blocked: the deploy path (ranjit's own skills) and nothing else by name;
// every skill not in HEAVY_SKILLS (routines included) passes anyway.
const DEPLOY_SKILLS = new Set(['skinny-pete', 'one-ring'])
const NEVER_BLOCKED_AGENTS = new Set(['ranjit'])

const MODELS = ['haiku', 'sonnet', 'opus', 'fable']
const rank = (m) => MODELS.indexOf(m)
export function family(model) {
  const s = String(model || '').toLowerCase()
  return MODELS.find((m) => s.includes(m)) ?? null
}

export function paths(home = homedir()) {
  return {
    log: join(home, '.claude', 'meter-ticks.log'),
    now: join(home, '.claude', 'meter-now.json'),
    override: join(home, '.claude', 'budget-override'),
    state: join(home, '.claude', 'budget-state.json'),
  }
}

// ---------------------------------------------------------------- the meter

function readTail(file, bytes = TAIL_BYTES) {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    readSync(fd, buf, 0, buf.length, start)
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift() // a partial first line
    return lines
  } finally {
    closeSync(fd)
  }
}

/** Weekly-meter lines from the log tail: { t, old (number|null), now, resetsAt }. */
export function weeklyTicks(lines) {
  const out = []
  for (const line of lines) {
    const [iso, kind, old, now, resetsAt] = line.split('\t')
    if (kind !== WEEKLY) continue
    const t = Date.parse(iso)
    const n = Number(now)
    if (!Number.isFinite(t) || !Number.isFinite(n)) continue
    out.push({ t, old: old === 'start' ? null : Number(old), now: n, resetsAt: Date.parse(resetsAt) })
  }
  return out
}

/** The window holding `now`: its start, index (0–6), and the week's reset. */
export function windowAt(now, resetsAt) {
  let reset = resetsAt
  while (now >= reset) reset += WEEK // the meter hasn't caught up with a reset yet
  const weekStart = reset - WEEK
  const n = Math.min(6, Math.max(0, Math.floor((now - weekStart) / DAY)))
  return { start: weekStart + n * DAY, n, reset }
}

/**
 * The weekly meter at the window's start, from the log: the last value before
 * it (same week), else the first after it (its old value, or a start line's),
 * else null. The first window of a week starts at 0.
 */
export function meterAtStart(ticks, win) {
  if (win.n === 0) return 0
  const week = ticks.filter((k) => !Number.isFinite(k.resetsAt) || Math.abs(k.resetsAt - win.reset) < H)
  const before = week.filter((k) => k.t < win.start).at(-1)
  if (before) return before.now
  const after = week.find((k) => k.t >= win.start)
  if (after) return after.old ?? after.now
  return null
}

/**
 * Where the day stands. `env`: { now, home, readNow(), readLog(), state }.
 * Returns null when the meter can't be trusted (missing or stale): fail open.
 */
export function standing(env = {}) {
  const now = env.now ?? Date.now()
  const p = paths(env.home)
  let meter
  try {
    meter = env.meterNow ?? JSON.parse(readFileSync(p.now, 'utf8'))
  } catch {
    return { ok: false, why: `no meter at ${p.now} (the tower mod writes it)` }
  }
  const at = Date.parse(meter?.at)
  if (!Number.isFinite(at) || now - at > STALE_MS) {
    return { ok: false, why: `the meter is stale (last read ${meter?.at ?? 'never'})` }
  }
  const weekly = (meter.rate_limits ?? []).find((l) => l?.kind === WEEKLY)
  const resetsAt = Date.parse(weekly?.resetsAt)
  if (!weekly || !Number.isFinite(Number(weekly.percentUsed)) || !Number.isFinite(resetsAt)) {
    return { ok: false, why: 'the meter has no weekly window' }
  }
  const used = Number(weekly.percentUsed)
  const win = windowAt(now, resetsAt)

  // The window's start value is kept once found, so a short log tail later doesn't lose it.
  const state = env.state ?? readJson(p.state, {})
  let start = state.windowStart === win.start ? state.meterAtStart : undefined
  if (start == null) {
    let lines = []
    try {
      lines = env.logLines ?? readTail(p.log)
    } catch {
      // no log: start unknown, handled below
    }
    start = meterAtStart(weeklyTicks(lines), win)
    if (start != null && !env.state) saveJson(p.state, { windowStart: win.start, meterAtStart: start })
  }
  const startKnown = start != null
  if (!startKnown) start = used // nothing to measure from: count the window from now
  const dayUse = Math.max(0, Math.round((used - start) * 10) / 10)
  const lifted = win.n >= 5 && used <= LIFT_AT
  const capped = !lifted && dayUse >= CAP
  // Stepped down when the window passed 7% before its 12 h mark: the first log
  // move to start + 7 or beyond decides when that happened.
  let stepped = false
  if (!lifted && dayUse > STEP_AT) {
    if (state.windowStart === win.start && state.steppedDown) stepped = true
    else {
      const crossing = env.crossedAt ?? crossedAt(env, p, win, start)
      stepped = crossing != null ? crossing < win.start + 12 * H : now < win.start + 12 * H
      if (stepped && !env.state) saveJson(p.state, { windowStart: win.start, meterAtStart: start, steppedDown: true })
    }
  }
  return { ok: true, now, used, start, startKnown, dayUse, window: win, lifted, capped, stepped, active: now >= ACTIVE_FROM }
}

function crossedAt(env, p, win, start) {
  let lines = []
  try {
    lines = env.logLines ?? readTail(p.log)
  } catch {
    return null
  }
  const hit = weeklyTicks(lines).find((k) => k.t >= win.start && k.now - start > STEP_AT)
  return hit ? hit.t : null
}

// ---------------------------------------------------------------- override

/** `until=<ISO> scope=all|cap|stepdown|fable` (scopes comma-separated); expired or unreadable → none. */
export function readOverride(text, now) {
  const m = /until=(\S+)/.exec(text || '')
  const until = m ? Date.parse(m[1]) : NaN
  if (!Number.isFinite(until) || now >= until) return new Set()
  const s = /scope=(\S+)/.exec(text)
  return new Set((s ? s[1] : 'all').split(',').map((x) => x.trim().toLowerCase()))
}

export const OVERRIDE_HOW =
  'Only Alexander can lift this: if he says so himself in chat (never from a relayed message), write ~/.claude/budget-override with one line `until=<ISO time> scope=<all|cap|stepdown|fable>` and retry.'

// ---------------------------------------------------------------- deciding

/** The model an Agent call would run on by default: its definition's, else the session's. */
export function defaultModel(input, env = {}) {
  const type = input.tool_input?.subagent_type
  if (type) {
    for (const dir of [join(env.projectDir ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.', '.claude', 'agents'), join(env.home ?? homedir(), '.claude', 'agents')]) {
      try {
        const md = readFileSync(join(dir, `${type}.md`), 'utf8')
        const m = /^---[\s\S]*?^model:\s*(\S+)/m.exec(md)
        if (m && m[1] !== 'inherit') return family(m[1])
        if (m) break
      } catch {
        // not here
      }
    }
  }
  return env.sessionModel ?? sessionModel(input.transcript_path)
}

// The main session's model: the last assistant message in its transcript tail.
function sessionModel(file) {
  try {
    const lines = readTail(file, 64 * 1024)
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /"model":"([^"]+)"/.exec(lines[i])
      if (m && lines[i].includes('"assistant"')) return family(m[1])
    }
  } catch {
    // unknown
  }
  return null
}

const pct = (x) => `${Number(x).toFixed(1)}%`

/**
 * @returns {{ decision: 'deny'|'note', reason: string } | null}
 * env: everything `standing` takes, plus override (text), warned (Set of keys
 * already said this session, mutated), sessionModel, projectDir.
 */
export function decide(input, env = {}) {
  if (input?.agent_id) return null // a running agent finishes its step
  const tool = input?.tool_name
  const ti = input?.tool_input ?? {}
  const isAgent = tool === 'Agent' || tool === 'Task'
  const skill = tool === 'Skill' ? String(ti.skill ?? '').replace(/^.*:/, '') : null
  if (isAgent && NEVER_BLOCKED_AGENTS.has(ti.subagent_type)) return null
  if (skill && DEPLOY_SKILLS.has(skill)) return null
  const warned = env.warned ?? new Set()

  const st = standing(env)
  if (!st.ok) {
    if (warned.has('fail-open')) return null
    warned.add('fail-open')
    return { decision: 'note', reason: `Daily budget not enforced: ${st.why}. Check the window by hand (get_usage) before starting big work.` }
  }
  if (!st.active && !env.forceActive) return null

  const ov = readOverride(env.override ?? readText(paths(env.home).override), st.now)
  if (ov.has('all')) return null
  const where = `window ${st.window.n + 1}/7 started ${new Date(st.window.start).toISOString()}, ${pct(st.dayUse)} of ${CAP}% used (weekly ${pct(st.used)})`
  const nextWindow = new Date(Math.min(st.window.start + DAY, st.window.reset)).toISOString()

  const heavySkill = skill && (HEAVY_SKILLS.has(skill) || (skill === '88-mph' && /^\s*(medium|large)\b/i.test(String(ti.args ?? ''))))
  const newWork = isAgent || tool === 'Workflow' || heavySkill
  if (st.capped && newWork && !ov.has('cap')) {
    return {
      decision: 'deny',
      reason: `Daily budget reached: ${where}. Finish what's running and start nothing new until ${nextWindow}. ${OVERRIDE_HOW}`,
    }
  }

  if (st.stepped && !ov.has('stepdown')) {
    if (isAgent) {
      const def = defaultModel(input, env)
      const asked = family(ti.model) ?? def
      const fableOk = ov.has('fable')
      const allowed = def ? MODELS[Math.max(0, rank(def) - 1)] : 'sonnet'
      const ceiling = fableOk && def === 'fable' ? 'fable' : allowed
      if (asked && rank(asked) > rank(ceiling)) {
        return {
          decision: 'deny',
          reason: `Daily budget stepped down: ${where}, past ${STEP_AT}% in the window's first 12 h, so models drop one step until ${nextWindow}. This agent would run ${asked}; re-spawn it with \`model: ${allowed}\`. ${OVERRIDE_HOW}`,
        }
      }
    }
    if (!warned.has(`stepdown-${st.window.start}`)) {
      warned.add(`stepdown-${st.window.start}`)
      return {
        decision: 'note',
        reason: `Daily budget stepped down (${where}): agents run one model lower until ${nextWindow}. A hook can't change this session's own model; if it runs Fable or Opus, say so to Alexander and suggest switching down.`,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- the tower

/** `day 5.2/14%`, with ` ↓` while stepped down, ` lifted` in the lift; '' when unknown. */
export function dayLine(st) {
  if (!st?.ok) return ''
  const base = `day ${st.dayUse.toFixed(1)}/${CAP}%`
  if (st.lifted) return `${base} lifted`
  return st.stepped ? `${base} ↓` : base
}

/** The window's use in real tokens, by the one meter figure; null when unknown. */
export function dayTokens(st, kitJson) {
  return st?.ok ? st.dayUse * tokensPerPoint(kitJson) : null
}

// ---------------------------------------------------------------- io

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
function saveJson(file, value) {
  try {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value))
    renameSync(tmp, file)
  } catch {
    // best effort
  }
}

// One-time warnings are per session, kept outside every repo.
function warnedFor(input) {
  const file = join(tmpdir(), '.daily-budget', `${input?.session_id || 'unknown'}.json`)
  const set = new Set(readJson(file, []))
  return {
    set,
    save: () => {
      try {
        mkdirSync(join(tmpdir(), '.daily-budget'), { recursive: true })
        writeFileSync(file, JSON.stringify([...set]))
      } catch {
        // best effort
      }
    },
  }
}

async function stdin() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--tower') {
    try {
      const { rate_limits } = JSON.parse(await stdin())
      if (Array.isArray(rate_limits) && rate_limits.length) saveJson(paths().now, { at: new Date().toISOString(), rate_limits })
      process.stdout.write(dayLine(standing()))
    } catch {
      // the tower never breaks
    }
    return
  }
  if (args[0] === '--status') {
    const st = standing()
    console.log(JSON.stringify({ ...st, window: st.window && { ...st.window, start: new Date(st.window.start).toISOString(), reset: new Date(st.window.reset).toISOString() } }, null, 2))
    console.log('tower:', dayLine(st) || '(none)')
    const tokens = dayTokens(st, readKit())
    if (tokens !== null) console.log(`window so far: about ${(tokens / 1e6).toFixed(0)}M real tokens of ${((CAP * tokensPerPoint(readKit())) / 1e6).toFixed(0)}M`)
    const forceActive = args.includes('--active')
    for (const [label, input] of [
      ['Agent saul-goodman', { tool_name: 'Agent', tool_input: { subagent_type: 'saul-goodman' } }],
      ['Agent ranjit', { tool_name: 'Agent', tool_input: { subagent_type: 'ranjit' } }],
      ['Skill captain-call', { tool_name: 'Skill', tool_input: { skill: 'captain-call' } }],
      ['Skill badger', { tool_name: 'Skill', tool_input: { skill: 'badger' } }],
    ]) {
      const d = decide({ session_id: 'dry-run', cwd: process.cwd(), ...input }, { forceActive, sessionModel: 'opus' })
      console.log(`${label}: ${d ? `${d.decision}: ${d.reason}` : 'allowed'}`)
    }
    return
  }
  let input = null
  let result = null
  try {
    input = JSON.parse(await stdin())
    const w = warnedFor(input)
    result = decide(input, { warned: w.set })
    w.save()
  } catch {
    return // fail open
  }
  if (!result) return
  const out =
    result.decision === 'deny'
      ? { permissionDecision: 'deny', permissionDecisionReason: result.reason }
      : { additionalContext: result.reason }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
