#!/usr/bin/env node
// Holds every subagent to its token budget. Nickname: Hank (the DEA
// brother-in-law who stops the operation when it goes too far).
//
// Why a hook: an agent can't see its own tokens (self-reports were off by up
// to 70x), and a prompt budget held nowhere: 2.10's qa ran 78.8M against a
// "hard" 15M. Hank runs before every tool call of every subagent (see
// hooks.json beside this file), next to the Slap Bet Commissioner, and counts
// the agent's real tokens from its own transcript with Skyler's parser
// (this plugin's scripts/usage.mjs), so it stops agents on the numbers the PR reports.
//
//   - The budget is the `[budget 20M]` tag at the end of the Agent description
//     maverick spawned it with (the subagent's .meta.json keeps it), else the
//     role's default from `.claude/kit.json` (`budgets`; at most 100M), else
//     the built-in table below. A SendMessage follow-up that carries its own tag
//     sets the agent's new total: the meta file keeps the first one forever,
//     and a builder reused for step 2 would otherwise be stopped on step 1's.
//   - At 80%: the call goes through, with a note telling the agent to finish
//     and report. At 100%: every call is denied except the final report.
//   - Screenshots have their own cap for the roles that take them; tiny frame
//     shots taken only to scroll (scale ≤ 0.25) have a separate one of 12.
//   - The main session (no agent_id) is the navigator: never blocked, since
//     it's the one that finishes the release, but warned once each at 60M and
//     100M and when one call's context passes 250k tokens (2.12.1's navigator
//     was at 240k four minutes in), naming its three biggest reads so it knows
//     what to stop re-reading or hand to an agent. `ranjit` is only
//     logged (a half-finished deploy is worse than an overrun); `the-playbook`
//     is warned at 100% and stopped at 150% (a half-done migration costs more
//     than the tokens).
//
// Like the Commissioner it never approves anything: it either says nothing,
// adds a note, or denies. It fails open: any error of its own allows the call
// and is logged, so a bug here can't stop the team.

import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentName, parseEntries, tallyEntries, totalTokens } from '../scripts/usage.mjs'

// An agent shipped in a plugin runs as `<plugin>:<agent>` (`release:chris-de-kok`),
// while the budget table and kit.json name the agent alone; without this a
// plugin's builder would fall through to the 15M default.
export const bareAgentType = (type) => (typeof type === 'string' ? type.replace(/^[a-z0-9-]+:/i, '') : type)

const M = 1_000_000

// Budgets without a tag, per role (tokens): the fallback when `.claude/kit.json`
// is missing or malformed, which mirrors this table. Seniors and the planner
// answer in a few calls; builders and the-playbook run whole steps.
export const DEFAULT_BUDGETS = {
  'lorenzo-von-matterhorn': 2 * M,
  'romeo-olsson': 2 * M,
  'c-3po': 10 * M,
  'jesse-pinkman': 15 * M,
  // The builder pool (2.10.2): the same prompt and model under five names.
  'chris-de-kok': 25 * M,
  'ahmed-och-ahmed': 25 * M,
  'saul-goodman': 25 * M,
  'jeff-winger': 25 * M,
  'troy-and-abed': 25 * M,
  // mosbius-designs depends on its model: see MODEL_DEFAULTS.
  // 2.10.1's brief and review used 2.7M of 20M; the Fable designer 9.2M of 20M.
  heisenberg: 8 * M,
  // 12M → 14M after 2.10.1 and 2.10.2 both overran it (the `oceans-eleven` skill's table too).
  'bengt-johansson': 14 * M,
  'the-playbook': 45 * M,
  kissochbajslowski: 15 * M,
  'boba-fett': 30 * M,
  yoda: 10 * M,
  'farbror-vattenmelon': 10 * M,
  'admiral-ackbar': 10 * M,
  // The senior planner (2.12 wrap-up): Fable, plans the releases whose mistakes spread.
  'dom-cobb': 20 * M,
  // The QA pool beside bengt-johansson (2.12.2): same job, same budget.
  'tomas-svensson': 14 * M,
  'magnus-wislander': 14 * M,
  'staffan-olsson': 14 * M,
  'stefan-lovgren': 14 * M,
  daredevil: 3 * M,
  'mike-ehrmantraut': 30 * M,
  'three-eyed-raven': 8 * M,
}

// Roles whose numbers depend on the model they run on (the `oceans-eleven`
// skill's table): the Fable designer explores wider and is given more room.
// Before the transcript shows a model, the Opus (smaller) numbers apply.
export const MODEL_DEFAULTS = {
  'mosbius-designs': { opus: { budget: 8 * M, shots: 6 }, fable: { budget: 12 * M, shots: 10 } },
}
const modelFamily = (model) => (/fable/i.test(model || '') ? 'fable' : 'opus')
const OTHER_BUDGET = 15 * M

// Counted screenshots: full-size shots and zooms, the ones a design is judged by.
export const SHOT_CAPS = {
  'bengt-johansson': 5,
  'tomas-svensson': 5,
  'magnus-wislander': 5,
  'staffan-olsson': 5,
  'stefan-lovgren': 5,
}
// `scroll` needs a fresh screenshot for its coordinate frame, so QA takes tiny
// ones (scale 0.2) just to scroll. Counting them left 2.12.2's wheel checks
// undone after three, so they have their own, looser cap that still stops a loop.
export const FRAME_SCALE = 0.25
export const FRAME_CAP = 12

// Screenshots in one call, split into counted shots and frame shots: a
// `computer` screenshot whose `scale` is ≤ 0.25 is a frame shot; a zoom or a
// larger screenshot is counted. Batches are looked into.
export function shotKinds(name, input) {
  const out = { shots: 0, frames: 0 }
  const one = (n, i) => {
    if (!/computer$/.test(n || '') || !i) return
    if (i.action === 'screenshot' && typeof i.scale === 'number' && i.scale <= FRAME_SCALE) out.frames += 1
    else if (i.action === 'screenshot' || i.action === 'zoom') out.shots += 1
  }
  one(name, input)
  for (const a of Array.isArray(input?.actions) ? input.actions : []) one(a?.name, a?.input)
  return out
}

// Only used when the agent's transcript can't be found: typical tokens per
// call from the last week's transcripts (builders ~160k, the-playbook ~185k,
// qa ~140k, the reviewer ~85k, the scout ~40k).
const TYPICAL_PER_CALL = {
  'chris-de-kok': 160_000, 'ahmed-och-ahmed': 160_000, 'saul-goodman': 160_000, 'jeff-winger': 160_000,
  'troy-and-abed': 160_000, 'jesse-pinkman': 160_000, 'the-playbook': 185_000, 'bengt-johansson': 140_000,
  kissochbajslowski: 85_000, 'mosbius-designs': 120_000, 'c-3po': 135_000, 'lorenzo-von-matterhorn': 40_000,
  'romeo-olsson': 10_000, yoda: 90_000, 'farbror-vattenmelon': 90_000, ranjit: 85_000,
}
const OTHER_PER_CALL = 120_000

export const WARN_AT = 0.8
export const WARNING = '80% of your budget used: finish the current piece and report.'
export const STOPPED = "Budget reached: report what you did, what you didn't reach, and why."
// The final report must always get through, or a stopped agent could never hand back.
const ALWAYS_ALLOWED = new Set(['SubagentHandback'])
// Repeat the 80% note every few calls rather than on each, to keep it cheap.
const WARN_EVERY = 5

/** `[budget 20M]`, `[budget 1.5M]` or `[budget 800k]` in a description, in tokens. */
export function parseBudget(description) {
  const m = /\[budget\s+(\d+(?:\.\d+)?)\s*([mk])\]/i.exec(description || '')
  if (!m) return null
  return Math.round(Number(m[1]) * (m[2].toLowerCase() === 'm' ? M : 1000))
}

// Where a subagent's transcript lives: the hook's transcript_path is the main
// session's file; its subagents sit in a folder named after the session.
export function subagentPaths(input) {
  const dir = join(dirname(input.transcript_path), input.session_id, 'subagents')
  return { jsonl: join(dir, `agent-${input.agent_id}.jsonl`), meta: join(dir, `agent-${input.agent_id}.meta.json`) }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- kit.json

// The budget table can live in `.claude/kit.json` (`budgets`, per agent, `"*"`
// for the rest), read on every call so a change holds at once. The file isn't
// frozen like this hook, so a value above the ceiling is ignored: an agent
// can't raise its own budget past it by editing the kit.
export const KIT_CEILING = 100 * M

export function kitPathFor(input) {
  return join(process.env.CLAUDE_PROJECT_DIR || input?.cwd || '.', '.claude', 'kit.json')
}

// `"25M"`, `"800k"` or a plain number of tokens; null for anything else.
function kitValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  const m = /^\s*(\d+(?:\.\d+)?)\s*([mk])\s*$/i.exec(typeof v === 'string' ? v : '')
  const tokens = m ? Math.round(Number(m[1]) * (m[2].toLowerCase() === 'm' ? M : 1000)) : 0
  // "0M" would let a role's first call through (0/0 is NaN) and deny the rest.
  return tokens > 0 ? tokens : null
}

/**
 * The kit's budgets in tokens, or null (missing or malformed: the caller falls
 * back to DEFAULT_BUDGETS). `notes` collects why a file or a value was set aside.
 */
export function kitBudgets(file, notes = []) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    notes.push(`no kit at ${file}; using the built-in budgets`)
    return null
  }
  let budgets
  try {
    budgets = JSON.parse(raw)?.budgets
  } catch {
    budgets = undefined
  }
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
    notes.push(`kit ${file} has no readable budgets; using the built-in budgets`)
    return null
  }
  const out = {}
  for (const [role, v] of Object.entries(budgets)) {
    const tokens = kitValue(v)
    if (tokens == null) notes.push(`kit budget for ${role} unreadable (${JSON.stringify(v)}); ignored`)
    else if (tokens > KIT_CEILING) notes.push(`kit budget for ${role} is ${v}, above the ${KIT_CEILING / M}M ceiling; ignored`)
    else out[role] = tokens
  }
  return out
}

// ---------------------------------------------------------------- counting

// Message ids already counted, per agent (and for the navigator). Claude Code
// writes one line per content block, each with the message's whole usage, and
// a hook run can fall between two of them: tallying each batch with a fresh
// set counted such a message once per batch (Hank read 1.6–1.9× Skyler until
// 2.14.6). The last few thousand are plenty: a message's lines are adjacent.
export const SEEN_KEEP = 2000

// The entries whose usage hasn't been counted yet; remembers their ids.
function uncounted(entries, state) {
  const seen = new Set(state.seen ?? [])
  const fresh = entries.filter((e) => {
    const id = typeof e.message === 'object' && e.message?.usage ? e.message.id : null
    if (!id) return true
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  state.seen = [...seen].slice(-SEEN_KEEP)
  return fresh
}

// Adds the transcript lines written since the last call to the running totals.
// Only whole lines are read; a line still being written waits for next time.
function catchUp(file, state) {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    if (size < state.offset) Object.assign(state, { offset: 0, tokens: 0, shots: 0, seen: [] })
    if (size === state.offset) return
    const buf = Buffer.alloc(size - state.offset)
    readSync(fd, buf, 0, buf.length, state.offset)
    const end = buf.lastIndexOf(0x0a)
    if (end < 0) return
    const entries = parseEntries(buf.subarray(0, end + 1).toString('utf8'))
    for (const b of tallyEntries(uncounted(entries, state)).values()) state.tokens += totalTokens(b)
    for (const e of entries) {
      for (const c of e.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : []) {
        if (c?.type !== 'tool_use') continue
        const k = shotKinds(c.name, c.input)
        state.shots += k.shots
        state.frames = (state.frames ?? 0) + k.frames
      }
      if (e.type === 'assistant' && e.message?.model) state.model = e.message.model
      const tag = e.type === 'user' ? parseBudget(messageText(e.message)) : null
      if (tag) state.budget = tag
    }
    state.offset += end + 1
  } finally {
    closeSync(fd)
  }
}

// The text of a user entry: a plain string, or its text blocks.
function messageText(message) {
  const c = message?.content
  if (typeof c === 'string') return c
  return Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : '')).join('\n') : ''
}

/**
 * @param {object} input  the hook's stdin JSON
 * @param {{ stateDir?: string, log?: (line: string) => void }} [env]
 * @returns {{ decision: 'deny' | 'note', reason: string } | null}  null = say nothing
 */
export function decide(input, env = {}) {
  if (!input?.agent_id) return watchNavigator(input, env) // never a deny
  if (ALWAYS_ALLOWED.has(input.tool_name)) return null
  const log = env.log ?? (() => {})
  const stateDir = env.stateDir ?? defaultStateDir(input)
  mkdirSync(stateDir, { recursive: true })
  const stateFile = join(stateDir, `${input.agent_id}.json`)
  const state = readJson(stateFile, { offset: 0, tokens: 0, shots: 0, calls: 0 })
  state.calls += 1

  const { jsonl, meta: metaFile } = subagentPaths(input)
  const meta = readJson(metaFile, {})
  const role = agentName({ agentType: bareAgentType(input.agent_type), description: meta.description }) || 'unknown'
  let used
  if (existsSync(jsonl)) {
    catchUp(jsonl, state)
    used = state.tokens
  } else {
    // No transcript to read: estimate from calls so far, and say so in the log.
    used = state.calls * (TYPICAL_PER_CALL[role] ?? OTHER_PER_CALL)
    log(`no transcript for ${role} ${input.agent_id}; estimating ${used} from ${state.calls} calls`)
  }
  const byModel = MODEL_DEFAULTS[role]?.[modelFamily(state.model)]
  // A tag wins; then the kit (its own entry, then the model numbers kept in
  // code, then its "*"); without a usable kit, the built-in table.
  const kitNotes = []
  const kit = kitBudgets(env.kitPath ?? kitPathFor(input), kitNotes)
  // The same note on every call would flood hank.log: once per agent until it changes.
  const kitNote = kitNotes.join('; ')
  if (kitNote && kitNote !== state.kitNote) log(kitNote)
  state.kitNote = kitNote
  writeFileSync(stateFile, JSON.stringify(state))
  const fromTable = kit
    ? kit[role] ?? byModel?.budget ?? kit['*'] ?? DEFAULT_BUDGETS[role]
    : byModel?.budget ?? DEFAULT_BUDGETS[role]
  const budget = state.budget ?? parseBudget(meta.description) ?? fromTable ?? OTHER_BUDGET

  const share = used / budget
  const pct = `${Math.round(share * 100)}% (${(used / M).toFixed(1)}M of ${(budget / M).toFixed(1)}M)`
  if (role === 'ranjit') {
    if (share >= 1) log(`ranjit over budget: ${pct}; allowed (deploys are never stopped)`)
    return null
  }

  const stopAt = role === 'the-playbook' ? 1.5 : 1
  if (share >= stopAt) {
    log(`stopped ${role} ${input.agent_id} at ${pct}`)
    return { decision: 'deny', reason: `${STOPPED} (Hank: ${pct} used.)` }
  }

  const cap = byModel?.shots ?? SHOT_CAPS[role]
  const pending = shotKinds(input.tool_name, input.tool_input)
  const still = 'Text and geometry checks still work (read_page, get_page_text, javascript_tool measurements); use them or report.'
  if (cap != null && pending.shots > 0 && state.shots + pending.shots > cap) {
    log(`screenshot cap for ${role} ${input.agent_id}: ${state.shots} of ${cap}`)
    return {
      decision: 'deny',
      reason: `Screenshot cap reached: ${state.shots} of ${cap} full-size screenshots and zooms for ${role}. Frame shots (scale ≤ ${FRAME_SCALE}) for scrolling are counted apart. ${still}`,
    }
  }
  const frames = state.frames ?? 0
  if (cap != null && pending.frames > 0 && frames + pending.frames > FRAME_CAP) {
    log(`frame-shot cap for ${role} ${input.agent_id}: ${frames} of ${FRAME_CAP}`)
    return {
      decision: 'deny',
      reason: `Frame-shot cap reached: ${frames} of ${FRAME_CAP} small screenshots (scale ≤ ${FRAME_SCALE}) taken for scroll coordinates. ${still}`,
    }
  }

  if (share >= WARN_AT) {
    const firstTime = !state.warned
    if (firstTime || state.calls % WARN_EVERY === 0) {
      if (firstTime) {
        state.warned = true
        writeFileSync(stateFile, JSON.stringify(state))
      }
      return { decision: 'note', reason: `${share >= 1 ? 'Over your budget' : WARNING} (Hank: ${pct} used.)` }
    }
  }
  return null
}

// ---------------------------------------------------------------- navigator

export const NAV_MARKS = [60 * M, 100 * M]
export const NAV_CONTEXT = 250_000
const KEEP_BIGGEST = 3
// An image result costs roughly this many tokens whatever its bytes.
const IMAGE_TOKENS = 1_600

/**
 * The main session's note, or null. Never a deny: the navigator finishes the
 * release, and a stopped navigator strands every agent it started. Each mark
 * warns once per session; the state lives beside the agents' state, outside
 * the repo.
 */
export function watchNavigator(input, env = {}) {
  try {
    if (!input?.transcript_path || !existsSync(input.transcript_path)) return null
    const stateDir = env.stateDir ?? defaultStateDir(input)
    mkdirSync(stateDir, { recursive: true })
    const stateFile = join(stateDir, 'navigator.json')
    const state = readJson(stateFile, { offset: 0, tokens: 0, maxContext: 0, pending: {}, biggest: [], warned: [] })
    catchUpNavigator(input.transcript_path, state)

    const notes = []
    for (const mark of NAV_MARKS) {
      const key = `tokens-${mark}`
      if (state.tokens >= mark && !state.warned.includes(key)) {
        state.warned.push(key)
        notes.push(`${mark / M}M used this session (${(state.tokens / M).toFixed(1)}M)`)
      }
    }
    if (state.maxContext > NAV_CONTEXT && !state.warned.includes('context')) {
      state.warned.push('context')
      notes.push(`one call's context reached ${Math.round(state.maxContext / 1000)}k tokens`)
    }
    writeFileSync(stateFile, JSON.stringify(state))
    if (!notes.length) return null
    const reads = state.biggest.map((b) => `${b.tool}${b.target ? ` ${b.target}` : ''} (~${Math.round(b.tokens / 1000)}k)`)
    const tail = reads.length ? ` Biggest reads so far: ${reads.join('; ')}.` : ''
    return {
      decision: 'note',
      reason: `Hank, for the navigator (warning only): ${notes.join('; ')}. Hand reading to agents and keep their reports short.${tail}`,
    }
  } catch (err) {
    env.log?.(`navigator watch error, ignored: ${err?.stack ?? err}`)
    return null
  }
}

// Reads the navigator's new transcript lines: its token total, its largest
// single-call context, and the sizes of tool results matched to their calls.
function catchUpNavigator(file, state) {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    if (size < state.offset) Object.assign(state, { offset: 0, tokens: 0, maxContext: 0, pending: {}, biggest: [], seen: [] })
    if (size === state.offset) return
    const buf = Buffer.alloc(size - state.offset)
    readSync(fd, buf, 0, buf.length, state.offset)
    const end = buf.lastIndexOf(0x0a)
    if (end < 0) return
    const entries = parseEntries(buf.subarray(0, end + 1).toString('utf8'))
    for (const b of tallyEntries(uncounted(entries, state)).values()) state.tokens += totalTokens(b)
    for (const e of entries) {
      const u = e.message?.usage
      if (u) {
        const context = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
        state.maxContext = Math.max(state.maxContext, context)
      }
      const content = Array.isArray(e.message?.content) ? e.message.content : []
      for (const c of content) {
        if (e.type === 'assistant' && c?.type === 'tool_use') state.pending[c.id] = { tool: c.name, target: targetOf(c.name, c.input) }
        if (e.type === 'user' && c?.type === 'tool_result') {
          const call = state.pending[c.tool_use_id] ?? { tool: '?', target: '' }
          delete state.pending[c.tool_use_id]
          noteRead(state, { ...call, tokens: resultTokens(c.content) })
        }
      }
    }
    state.offset += end + 1
  } finally {
    closeSync(fd)
  }
}

function noteRead(state, read) {
  state.biggest.push(read)
  state.biggest.sort((a, b) => b.tokens - a.tokens)
  state.biggest.length = Math.min(state.biggest.length, KEEP_BIGGEST)
}

// What a call read: the file, the agent, or the start of the command.
function targetOf(name, input) {
  if (!input || typeof input !== 'object') return ''
  const t = input.file_path ?? input.path ?? input.subagent_type ?? input.description ?? input.command ?? input.url ?? ''
  const s = String(t).replace(/\s+/g, ' ')
  return s.length > 60 ? `${s.slice(0, 59)}…` : s
}

// About four characters a token for text; a flat cost for images.
function resultTokens(content) {
  if (typeof content === 'string') return Math.ceil(content.length / 4)
  if (!Array.isArray(content)) return 0
  let t = 0
  for (const b of content) t += b?.type === 'image' ? IMAGE_TOKENS : Math.ceil(String(b?.text ?? '').length / 4)
  return t
}

function defaultStateDir(input) {
  return join(input.scratchpad_dir || tmpdir(), '.hank', input.session_id || 'unknown')
}

function logTo(input) {
  const dir = join(input?.scratchpad_dir || tmpdir(), '.hank')
  return (line) => {
    try {
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'hank.log'), `${new Date().toISOString()} ${line}\n`)
    } catch {
      // logging is best effort
    }
  }
}

// ---------------------------------------------------------------- main

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let input = null
  let result = null
  try {
    input = JSON.parse(raw)
    result = decide(input, { log: logTo(input) })
  } catch (err) {
    // Fail open: Hank's own bug must never stop the work.
    logTo(input)(`error, allowed: ${err?.stack ?? err}`)
    return
  }
  if (!result) return
  const out =
    result.decision === 'deny'
      ? { permissionDecision: 'deny', permissionDecisionReason: result.reason }
      : { additionalContext: result.reason }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
