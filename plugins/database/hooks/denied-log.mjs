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
// So a council can tell a deliberate guard ask from a classifier refusal.
//
// `node denied-log.mjs --summary [--since <YYYY-MM-DD>] [--dir <project>]`
// reads both logs and prints the repeats grouped by shape, each marked
// `guard` or `classifier`, with a ready settings.json allow line for the
// classifier's dev-only repeats. A guard row gets none: an allow rule
// doesn't skip a hook's ask, and its ask is on purpose. Nothing that reaches
// production, a key, a delete or a push to main ever gets one.
//
// As a hook it only ever writes the log: it exits 0 and prints nothing, and
// never sends `retry` (a retry is a refusal re-spelled, which the guard's
// rules forbid).

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

/** The guard's line: deniedLine's seven columns, then decision and reason. */
export function guardLine(input, result, { mask = null, now = Date.now() } = {}) {
  const why = String(result?.reason ?? '').split('\n')[0]
  return [deniedLine(input, { mask, now }), flat(result?.decision) || '?', flat(mask ? mask(why) : why).slice(0, 300)].join('\t')
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
    const take = words[0] === 'gh' ? 3 : SUBCOMMANDS.has(words[0]) ? 2 : 1
    return words.slice(0, take).filter((w) => !w.startsWith('-')).join(' ')
  }
  if (FILE_TOOLS.has(tool) && path && path !== '-') return `${tool} ${dirname(path)}`
  return tool
}

function allowLine(tool, shape) {
  if (!shape || NEVER_ALLOW_RE.test(shape)) return null
  if (tool === 'Bash') return /^[\w./@:-]+(?: [\w./@:-]+)*$/.test(shape) ? `"Bash(${shape} *)"` : null
  // In a permission rule `//path` is from the filesystem root; `/path` would
  // be relative to the settings file.
  if (FILE_TOOLS.has(tool)) {
    const dir = shape.slice(tool.length + 1)
    return `"${tool}(${dir.startsWith('/') ? '/' : ''}${dir}/**)"`
  }
  return /^[\w:-]+$/.test(tool) ? `"${tool}"` : null
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

export function summaryText(rows) {
  if (!rows.length) return 'No refusals or guard asks logged in that window.\n'
  const out = ['count\tsource\ttool\tshape\tallow line or why']
  for (const r of rows) {
    const note = r.allow ?? (r.source === 'guard' ? `guard ${r.why ? `asks on purpose: ${r.why}` : 'asks on purpose'}`
      : r.count > 1 ? 'no allow line: production, a key, a delete or a push' : 'once')
    out.push([r.count, r.source, r.tool, r.shape, note].join('\t'))
  }
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
  process.stdout.write(summaryText(summarize({ denied: readOr(join(dir, DENIED_LOG)), guard: readOr(join(dir, GUARD_LOG)), since })))
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
