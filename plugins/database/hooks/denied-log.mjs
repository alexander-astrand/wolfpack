#!/usr/bin/env node
// Logs every automatic refusal in Auto mode (the `PermissionDenied` hook, see
// .claude/settings.json) to `.claude/permission-denied.log`, gitignored by
// `*.log`. Why: the classifier's refusals left no trace, so a chain's review
// couldn't tell which calls were routed around, or how often (2.14.6).
//
// One tab-separated line per refusal, columns in this order (a reader may
// count on it; new columns only ever go at the end):
//   1 time (UTC ISO)   2 agent (or `main`)   3 tool
//   4 head of the tool input as JSON, secrets masked (400 characters for
//     Bash, 200 for the rest)
//   5 permission mode   6 session id
//   7 file_path for Write, Edit, MultiEdit and NotebookEdit, else `-` (kit 1.7)
// The hook's input carries no reason, so none is logged.
//
// The guard's own asks and denies (kit 1.7, Feature 5) go to
// `.claude/guard-decisions.log` from guard-production.mjs, with the same
// seven columns (guardLine, below) and two more:
//   8 decision (`ask` or `deny`)   9 the guard's reason, first line
//   10 a stable reason code (kit 1.8, M12): `arm-script`, `psql`, `workdir`
//      ... from GUARD_REASONS below, or `other-<hash>` of the reason with its
//      paths, refs and numbers taken out, so the same rule groups as one
// So a council can tell a deliberate guard ask from a classifier refusal.
// Two more row kinds (kit 1.8, M12), same ten columns:
//   - `allows` (code `session-allows`), one per session at its end
//     (sessionEnd, run by guard-allows.mjs, the SessionEnd hook): column 4 holds
//     {"calls","asks","denies","through"} counted from the session's
//     transcripts (its subagents' too), so an ask rate can be computed.
//   - `step-aside` (code `step-aside`), once per session, when guard-entry.mjs
//     steps aside for a project's own guard (stepAsideOnce), so a project like
//     HutzUp still shows which guard ran.
//
// `node denied-log.mjs --summary [--since <YYYY-MM-DD>] [--dir <project>]`
// reads both logs and prints the repeats grouped by shape, each marked
// `guard` or `classifier`, with a ready settings.json allow line for the
// classifier's repeats of one named npm script. A guard row gets none: an allow rule
// doesn't skip a hook's ask, and its ask is on purpose. Nothing that reaches
// production, a key, a delete or a push to main ever gets one. Kit 1.8
// (Feature 16): it then lists each repeated guard reason by code with the
// rule in guard-production.mjs that decides it and, for an agent's habit
// (psql, --workdir, heredoc edits), the line the agent should carry; and the
// session totals (calls let through, asked, denied: the ask rate). To ask the
// guard about one command before running it: `guard-production.mjs --explain`.
//
// As a hook it only ever writes the log: it exits 0 and prints nothing, and
// never sends `retry` (a retry is a refusal re-spelled, which the guard's
// rules forbid).

import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { guardListedHead } from './read-list.mjs'
import { projectOwns } from './step-aside.mjs'

const INPUT_HEAD = 200
const BASH_HEAD = 400
const MASK_HEAD = 2000
// Without the guard's maskSecrets a shorter head leaves less room for a secret.
const UNMASKED_HEAD = 80
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
export const DENIED_LOG = 'permission-denied.log'
export const GUARD_LOG = 'guard-decisions.log'

export function logPathFor(input, name = DENIED_LOG) {
  return join(process.env.CLAUDE_PROJECT_DIR || input?.cwd || '.', '.claude', name)
}

// Lazily, so a broken guard file can't stop this hook: the fallback is the
// raw head, cut shorter.
async function loadMask() {
  try {
    const { maskSecrets } = await import('./guard-production.mjs')
    return typeof maskSecrets === 'function' ? maskSecrets : null
  } catch {
    return null
  }
}

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** The log line for one PermissionDenied input: the seven columns above. */
export function deniedLine(input, { mask = null, now = Date.now() } = {}) {
  let tool
  try {
    tool = JSON.stringify(input.tool_input ?? {}) ?? ''
  } catch {
    tool = String(input.tool_input)
  }
  const name = flat(input.tool_name) || '?'
  // A chained Bash call (`cd … && R=…; git show …`) was cut before its tail
  // at 200, so the reader couldn't see what ran last (kit 1.7).
  const cut = name === 'Bash' ? BASH_HEAD : INPUT_HEAD
  // Masked before the cut, so a secret straddling it still matches; but on
  // a generous head only, since maskSecrets on a huge input (160k chars) takes
  // seconds against the hook's 5 s timeout.
  const head = mask ? flat(mask(tool.slice(0, MASK_HEAD))).slice(0, cut) : flat(tool.slice(0, MASK_HEAD)).slice(0, UNMASKED_HEAD)
  const path = FILE_TOOLS.has(name) ? flat(input.tool_input?.file_path ?? input.tool_input?.notebook_path) || '-' : '-'
  return [
    new Date(now).toISOString(),
    flat(input.agent_type) || 'main',
    name,
    head,
    flat(input.permission_mode) || '?',
    flat(input.session_id) || '?',
    mask ? flat(mask(path)) : path,
  ].join('\t')
}

/** The guard's line: deniedLine's seven columns, then decision, reason and reason code. */
export function guardLine(input, result, { mask = null, now = Date.now() } = {}) {
  const why = String(result?.reason ?? '').split('\n')[0]
  return [deniedLine(input, { mask, now }), flat(result?.decision) || '?', flat(mask ? mask(why) : why).slice(0, 300), reasonCode(why)].join('\t')
}

// ------------------------------------------------------------ reason codes

// Kit 1.8 (M12, Feature 16): each repeated guard reason, the rule in
// guard-production.mjs that decides it, and for an agent's habit (not a guard
// error) the line the agent should carry. First match wins, so the narrow
// texts come first. A reason no row matches gets `other-<hash>`.
export const GUARD_REASONS = [
  { code: 'one-ring-spawn', re: /^Under \/one-ring the deploy is/, rule: 'oneRingSpawn' },
  { code: 'arm-script', re: /^scripts\/full-auto\.sh (?:arms production|is never copied)/, rule: 'SCRIPT_DENIED (mentionsScript, scriptGlob, mayBeScripts)', carry: 'A loop or glob passes when the folder before its `*` ends in a literal name (kit 1.8, H5); never `scripts/` or a run-time `$d` as that last part. Check a shape first with `guard-production.mjs --explain`.' },
  { code: 'marker-write', re: /^The full-auto marker and its log are written only by/, rule: 'MARKER_DENIED (the marker-write rules)', carry: 'Edit files with Edit or Write, never a heredoc, `python3 -`, `perl -pi` or a shell loop that writes ([edit-not-heredoc]).' },
  { code: 'built-at-runtime', re: /is built at run time and may be/, rule: 'segmentRules (a command word built at run time)', carry: 'Spell each command out; a `$var` goes in arguments only, never as the command or its subcommand.' },
  { code: 'psql', re: /can reach any database\. Check where it connects/, rule: 'segmentRules (database clients ask)', carry: 'Read the local schema with `supabase db query --local` from the lane root, never `docker exec ... psql` (the-playbook).' },
  { code: 'workdir', re: /^--workdir can point the CLI/, rule: 'checkSupabase (--workdir)', carry: 'Run supabase from the lane\'s own root (one command, no `cd`), never with `--workdir` (the-playbook).' },
  { code: 'prod-db', re: /^scripts\/prod-db\.sh reaches production/, rule: 'checkProdDb' },
  { code: 'prod-ref', re: /isn't dev\b|isn't the dev project|would point the CLI away from dev/, rule: 'segmentRules, checkSupabase, checkProdDb (project refs)' },
  { code: 'merge', re: /^Merging goes through `gh pr merge`|ships a release\. Only the deploy/, rule: 'MERGE_BY_API, checkGh', carry: 'A merge is /one-ring\'s, on Alexander\'s go; never `gh pr merge` or the API from a build session.' },
  { code: 'frozen-file', re: /frozen set/, rule: 'protectedChange (FROZEN in chain-arm.mjs)', carry: 'A frozen file changes in a setup session or as a patch a person pastes ([frozen]).' },
  { code: 'nested-claude', re: /nested claude/i, rule: 'nestedClaude' },
  { code: 'fed-shell', re: /which the guard can't read, so a person decides/, rule: 'fedShell', carry: 'Write the code to a scratch file and run it by name (`node <file>`), never through a pipe, heredoc or `sh -c`.' },
  { code: 'guard-error', re: /^guard-production failed/, rule: 'main (fails closed)' },
]

/** The stable code for one guard reason (its first line). */
export function reasonCode(reason) {
  const why = String(reason ?? '').split('\n')[0]
  const hit = GUARD_REASONS.find((r) => r.re.test(why))
  if (hit) return hit.code
  // The rule's own words only: what is in backticks, paths, refs and numbers
  // change per call, so they are taken out before the hash.
  const core = why.replace(/`[^`]*`/g, '`x`').replace(/\S*\/\S*/g, 'P').replace(/\b[a-z]{20}\b/g, 'R').replace(/\d+/g, '0').slice(0, 80)
  return why ? `other-${createHash('sha1').update(core).digest('hex').slice(0, 6)}` : 'none'
}

// ------------------------------------------------- step-aside and allows

const SESSION_TOOLS = /^(?:Bash|Edit|MultiEdit|Write|NotebookEdit|SendMessage|Agent|Task|mcp__.+)$/

/** The guard-matched tool calls in one transcript's text (hooks.json's matchers), by id. */
export function toolCalls(text, seen = new Set()) {
  for (const line of String(text).split('\n')) {
    if (!line.includes('"tool_use"')) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const content = entry?.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type === 'tool_use' && SESSION_TOOLS.test(String(c.name)) && c.id) seen.add(c.id)
    }
  }
  return seen
}

/** The session's own ask and deny rows in the guard log's text. */
export function sessionDecisions(logText, sessionId) {
  const out = { asks: 0, denies: 0 }
  for (const line of String(logText).split('\n')) {
    const f = line.split('\t')
    if (f[5] !== sessionId) continue
    if (f[7] === 'ask') out.asks++
    else if (f[7] === 'deny') out.denies++
  }
  return out
}

/** The `allows` row for one finished session. */
export function allowsLine({ sessionId, calls, asks, denies, mode = '?', now = Date.now() }) {
  const through = Math.max(0, calls - asks - denies)
  const counts = JSON.stringify({ calls, asks, denies, through })
  const why = `${calls} guarded calls: ${through} let through, ${asks} asked, ${denies} denied`
  return [new Date(now).toISOString(), 'main', 'SessionEnd', counts, flat(mode) || '?', flat(sessionId) || '?', '-', 'allows', why, 'session-allows'].join('\t')
}

function transcriptsOf(transcript, sessionId) {
  const files = [transcript]
  const sub = join(dirname(transcript), String(sessionId), 'subagents')
  try {
    for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(join(sub, f))
  } catch { /* no subagents */ }
  return files
}

/**
 * The SessionEnd hook: one `allows` row for the session. Never throws.
 * A project that owns its guard gets none (the kit's guard decided nothing;
 * its step-aside row says so).
 * @param {string} raw  stdin
 * @param {{ logPath?: string, now?: number, owns?: boolean }} [env]
 */
export async function sessionEnd(raw, env = {}) {
  try {
    const input = JSON.parse(raw)
    if (!input?.session_id || !input?.transcript_path) return
    if (env.owns ?? projectOwns({ kitName: 'guard-entry.mjs', names: ['guard-entry.mjs', 'guard-production.mjs'] })) return
    const seen = new Set()
    for (const f of transcriptsOf(input.transcript_path, input.session_id)) toolCalls(readOr(f), seen)
    const file = env.logPath ?? logPathFor(input, GUARD_LOG)
    const { asks, denies } = sessionDecisions(readOr(file), input.session_id)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, allowsLine({ sessionId: input.session_id, calls: seen.size, asks, denies, mode: input.permission_mode, now: env.now ?? Date.now() }) + '\n')
  } catch {
    // Best effort, as the rest of this file.
  }
}

/**
 * guard-entry.mjs's step-aside: one row per session, the first time the
 * kit's guard gives way to the project's own. Never throws.
 * @param {string} raw  stdin
 * @param {{ logPath?: string, now?: number }} [env]
 */
export function stepAsideOnce(raw, env = {}) {
  try {
    const input = JSON.parse(raw)
    const sid = flat(input?.session_id)
    if (!sid) return
    const file = env.logPath ?? logPathFor(input, GUARD_LOG)
    if (readOr(file).split('\n').some((l) => { const f = l.split('\t'); return f[5] === sid && f[7] === 'step-aside' })) return
    const row = [new Date(env.now ?? Date.now()).toISOString(), flat(input.agent_type) || 'main', flat(input.tool_name) || '?', '-', flat(input.permission_mode) || '?', sid, '-',
      'step-aside', "the kit's guard stepped aside for the project's own (.claude/hooks/)", 'step-aside']
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, row.join('\t') + '\n')
  } catch {
    // Best effort: the project's guard decides the call either way.
  }
}

/**
 * Reads the hook's stdin text and appends its line. Never throws.
 * @param {string} raw  stdin
 * @param {{ logPath?: string, mask?: Function | null, now?: number }} [env]
 */
export async function run(raw, env = {}) {
  try {
    const input = JSON.parse(raw)
    if (!input || typeof input !== 'object') return
    const mask = 'mask' in env ? env.mask : await loadMask()
    const file = env.logPath ?? logPathFor(input)
    const line = deniedLine(input, { mask, now: env.now ?? Date.now() })
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${line}\n`)
  } catch {
    // Best effort: a logger must never get in the way of the work.
  }
}

// ---------------------------------------------------------------- --summary

// Calls whose repeat must never become an allow rule: production, keys and
// secrets, deletes, kills, pushes and merges.
const NEVER_ALLOW_RE = /prod|--project-ref|secret|token|password|passwd|\bkey|keychain|ssh|\.env|\brm\b|delete|\bdrop\b|truncate|\bkill|pkill|git push|\bmerge\b|deploy|vercel|\bsudo\b|security /i
// The words that name a shape: the command, and its subcommand for these.
const SUBCOMMANDS = new Set(['git', 'gh', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'supabase', 'docker', 'python3', 'brew'])

// The Bash command from a logged head (cut heads aren't valid JSON).
function commandOf(head) {
  try {
    const v = JSON.parse(head)
    if (typeof v?.command === 'string') return v.command
  } catch { /* cut */ }
  const m = /^\{"command":"((?:[^"\\]|\\.)*)/.exec(head)
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : head
}

/** The shape a row is grouped by: `git show`, `gh pr view`, `Edit <folder>`, an MCP tool. */
export function shapeOf(tool, head, path) {
  if (tool === 'Bash') {
    // The first command after any `cd … &&` or VAR= prefix.
    const first = commandOf(head).split(/&&|\|\||;|\||\n/).map((s) => s.trim()).find((s) => s && !/^cd\b/.test(s)) ?? ''
    const words = first.split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))
    // `npm run <script>` keeps the script's name, so its allow line names it.
    const take = words[0] === 'gh' || (words[0] === 'npm' && words[1] === 'run') ? 3 : SUBCOMMANDS.has(words[0]) ? 2 : 1
    return words.slice(0, take).filter((w) => !w.startsWith('-')).join(' ')
  }
  if (FILE_TOOLS.has(tool) && path && path !== '-') return `${tool} ${dirname(path)}`
  return tool
}

// The one Bash shape that gets an allow line: a named npm script, as that
// exact command, no trailing `*` (kit 1.7 review must 3 and round 3). A
// shell, an interpreter, curl or psql repeated twice is no reason to allow
// it, and a deny-list of those always missed one. The reads on the guard's
// list (read-list.mjs) get none either: a repeat of one reaches the
// classifier only when the guard refused its operands, and a wildcard rule
// would let those through. cat and ls are no better (`cat ~/.ssh/id_rsa`).
const NPM_SCRIPT = /^npm run [\w:-]+$/

function allowLine(tool, shape) {
  if (!shape || NEVER_ALLOW_RE.test(shape)) return null
  if (tool === 'Bash') return !guardListedHead(shape.split(' ')) && NPM_SCRIPT.test(shape) ? `"Bash(${shape})"` : null
  // In a permission rule `//path` is from the filesystem root; `/path` would
  // be relative to the settings file.
  if (FILE_TOOLS.has(tool)) {
    const dir = shape.slice(tool.length + 1)
    if (protectedDir(dir)) return null
    return `"${tool}(${dir.startsWith('/') ? '/' : ''}${dir}/**)"`
  }
  if (tool.startsWith('mcp__')) {
    const verb = tool.slice(tool.lastIndexOf('__') + 2)
    return /^[\w-]+$/.test(tool) && MCP_READ_VERB.test(verb) && !MCP_WRITE_WORD.test(verb) ? `"${tool}"` : null
  }
  return BUILTIN_READS.has(tool) ? `"${tool}"` : null
}

// Kit 1.7 review, round 2: MCP tools and file edits get a line from an
// allow-list too. An MCP tool only when its verb reads (an unknown verb gets
// none), and never one that writes, even inside a read-shaped name.
const MCP_READ_VERB = /^(?:(?:list|get|search|read)[_-]\w|query-docs$|resolve-library-id$)/
const MCP_WRITE_WORD = /execute|apply|deploy|delete|create|merge|reset|pause|restore|update|insert|drop/i
const BUILTIN_READS = new Set(['Read', 'Grep', 'Glob', 'WebSearch'])
// An edit under the guard's own files, the database, the scripts, a hook or
// a secret gets none, and nor does a folder as wide as the root or ~.
function protectedDir(dir) {
  if (['.', '/', '~', ''].includes(dir)) return true
  return dir.split('/').some((s) => ['.claude', '.git', 'supabase', 'scripts', 'hooks'].includes(s) || /^\.env/i.test(s))
}

/**
 * Groups both logs' rows by source and shape, repeats first.
 * @param {{ denied?: string, guard?: string, since?: string }} texts  the logs' text
 * @returns {{ source: string, tool: string, shape: string, count: number, last: string, why: string, allow: string | null }[]}
 */
export function summarize({ denied = '', guard = '', since } = {}) {
  const from = since ? Date.parse(since) : -Infinity
  const groups = new Map()
  const add = (source, text) => {
    for (const line of text.split('\n')) {
      const f = line.split('\t')
      if (f.length < 6 || !(Date.parse(f[0]) >= from)) continue
      // The session counts and step-asides are totals, not refusals (guardTotals).
      if (source === 'guard' && (f[7] === 'allows' || f[7] === 'step-aside')) continue
      const [time, , tool, head] = f
      const shape = shapeOf(tool, head, f[6])
      const key = `${source}\t${tool}\t${shape}`
      const g = groups.get(key) ?? { source, tool, shape, count: 0, last: time, why: '', allow: null, risky: false }
      g.count++
      // One row of the group that names production or a key keeps the whole shape off.
      if (NEVER_ALLOW_RE.test(`${head} ${f[6] ?? ''}`)) g.risky = true
      if (time > g.last) g.last = time
      if (source === 'guard') g.why = f[8] ?? g.why
      groups.set(key, g)
    }
  }
  add('classifier', denied)
  add('guard', guard)
  return [...groups.values()]
    .map(({ risky, ...g }) => ({ ...g, allow: g.source === 'classifier' && g.count > 1 && !risky ? allowLine(g.tool, g.shape) : null }))
    .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape))
}

/**
 * Kit 1.8 (Feature 16): the guard's asks and denies by reason code, each with
 * the rule that decides it and, for an agent's habit, the line to carry.
 * Rows from before column 10 get their code from the reason text.
 * @returns {{ code: string, count: number, asks: number, denies: number, rule: string | null, carry: string | null, why: string }[]}
 */
export function guardReasons(guard = '', since) {
  const from = since ? Date.parse(since) : -Infinity
  const byCode = new Map()
  for (const line of guard.split('\n')) {
    const f = line.split('\t')
    if (f.length < 9 || !(Date.parse(f[0]) >= from) || (f[7] !== 'ask' && f[7] !== 'deny')) continue
    const code = f[9] || reasonCode(f[8])
    const known = GUARD_REASONS.find((r) => r.code === code)
    const g = byCode.get(code) ?? { code, count: 0, asks: 0, denies: 0, rule: known ? `guard-production.mjs ${known.rule}` : null, carry: known?.carry ?? null, why: f[8] }
    g.count++
    if (f[7] === 'ask') g.asks++
    else g.denies++
    byCode.set(code, g)
  }
  return [...byCode.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

/** The `allows` and `step-aside` rows added up: an ask rate needs both halves. */
export function guardTotals(guard = '', since) {
  const from = since ? Date.parse(since) : -Infinity
  const t = { sessions: 0, calls: 0, asks: 0, denies: 0, through: 0, asides: 0 }
  // A resumed session ends again and writes another row; its transcript and
  // its log rows run on from the first, so the last row holds the whole
  // session and the earlier ones are dropped (review round 1, nit 2).
  const last = new Map()
  for (const line of guard.split('\n')) {
    const f = line.split('\t')
    if (f.length < 8 || !(Date.parse(f[0]) >= from)) continue
    if (f[7] === 'step-aside') t.asides++
    if (f[7] !== 'allows') continue
    try { last.set(f[5], JSON.parse(f[3])) } catch { /* a cut row */ }
  }
  for (const c of last.values()) {
    t.sessions++
    for (const k of ['calls', 'asks', 'denies', 'through']) t[k] += Number(c[k]) || 0
  }
  return t
}

export function summaryText(rows, { reasons = [], totals = null } = {}) {
  if (!rows.length && !reasons.length && !totals?.sessions && !totals?.asides) return 'No refusals or guard asks logged in that window.\n'
  const out = ['count\tsource\ttool\tshape\tallow line or why']
  for (const r of rows) {
    const note = r.allow ?? (r.source === 'guard' ? `guard ${r.why ? `asks on purpose: ${r.why}` : 'asks on purpose'}`
      : r.count > 1 ? 'no allow line: not a dev read, or it names production, a key, a delete or a push' : 'once')
    out.push([r.count, r.source, r.tool, r.shape, note].join('\t'))
  }
  // Repeated reasons only: a reason seen once has no habit to fix.
  const repeats = reasons.filter((r) => r.count > 1)
  if (repeats.length) {
    out.push('', 'Guard reasons that repeat (decided by; the line an agent should carry, if it is a habit)', 'count\tcode\tdecided by\tcarry or reason')
    for (const r of repeats) out.push([r.count, r.code, r.rule ?? 'not in GUARD_REASONS (denied-log.mjs)', r.carry ? `carry: ${r.carry}` : r.why].join('\t'))
  }
  if (totals?.sessions) {
    const rate = totals.calls ? ` (asks ${(100 * totals.asks / totals.calls).toFixed(1)} %, denies ${(100 * totals.denies / totals.calls).toFixed(1)} %)` : ''
    out.push('', `Guard totals: ${totals.sessions} sessions counted at their end, ${totals.calls} guarded calls, ${totals.through} let through, ${totals.asks} asked, ${totals.denies} denied${rate}.`)
  }
  if (totals?.asides) out.push(`${totals.asides} sessions ran the project's own guard (the kit's stepped aside).`)
  return out.join('\n') + '\n'
}

function readOr(file) {
  try { return readFileSync(file, 'utf8') } catch { return '' }
}

function summaryMain(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const since = at('--since')
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(since)) {
    process.stderr.write('--since takes a date: YYYY-MM-DD\n')
    process.exit(1)
  }
  const dir = join(at('--dir') ?? (process.env.CLAUDE_PROJECT_DIR || process.cwd()), '.claude')
  const guard = readOr(join(dir, GUARD_LOG))
  process.stdout.write(summaryText(summarize({ denied: readOr(join(dir, DENIED_LOG)), guard, since }), { reasons: guardReasons(guard, since), totals: guardTotals(guard, since) }))
}

async function main() {
  if (process.argv.includes('--summary')) return summaryMain(process.argv.slice(2))
  // The project's own denied-log writes the line; a second copy would log it twice.
  if (projectOwns({ kitName: 'denied-log.mjs' })) process.exit(0)
  let raw = ''
  try {
    for await (const chunk of process.stdin) raw += chunk
  } catch {
    // nothing to log
  }
  await run(raw)
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
