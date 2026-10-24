#!/usr/bin/env node
// /the-tower: Claude Code's status line. Claude Code pipes the session JSON on
// stdin and shows the one line we print, e.g.
//   session 9.6M ≈0.4% wk (fable 0.3 opus 0.1) · plan 0.31× · link 2/2 · Hank: chris-de-kok 3.1/15M · week 86%
// It runs on every redraw, so it stays fast and quiet: no network, no git or
// gh process, only small files, the tail of the logs, and the transcript's
// new bytes since the last run (a cache in the temp folder keeps the count).
// Every part is optional and wrapped; a status line that throws is noise, so
// the worst case is the bare branch name (Alexander, 6 Oct: the version isn't
// worth a place on the line, so the branch shows only when nothing else can).
//
// Kit 1.5 (L1, L2, lens Must 10): Hutzup's scripts/the-tower.mjs, the one
// settings.json ran for every project, folded in here; the meter figure comes
// from usage.mjs's tokensPerPoint, and the week from the input or
// ~/.claude/meter-now.json (daily-budget.mjs --tower writes it), never the
// retired meter logger's files.
//
//   node <release plugin>/scripts/the-tower.mjs --install   # adds the statusLine key to ~/.claude/settings.json (asks first)
//   node <release plugin>/scripts/the-tower.mjs --headline <version>   # the plan's `Expected: ≈ <N>M` in tokens, tab, its file; nothing when none

import { closeSync, copyFileSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { bareAgentType, DEFAULT_BUDGETS, kitBudgets, MODEL_DEFAULTS, OTHER_BUDGET, parseBudget } from '../hooks/budget-cap.mjs'
import { agentName, parseEntries, readKit, tallyEntries, tokensPerPoint, totalTokens } from './usage.mjs'

const MAX = 79 // under 80 columns, so it fits a narrow terminal
const TOAST_MS = 30 * 60 * 1000 // a refusal older than 30 minutes is history, not news
const STALE_MS = 30 * 60 * 1000 // daily-budget's own limit: an older meter-now.json is marked "~"
const RECENT_IDS = 200 // a message's lines sit together, so a short memory dedupes them

const familyOf = (model) => (/(opus|fable|sonnet|haiku)/i.exec(model || '') || ['opus'])[0].toLowerCase()

const safe = (fn, fallback = null) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

const readJson = (path) => safe(() => JSON.parse(readFileSync(path, 'utf8')))

// The last `bytes` of a file: the logs only grow, and only their end matters.
function tail(path, bytes = 16384) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    return size > bytes ? lines.slice(1) : lines // the first line may be cut
  } finally {
    closeSync(fd)
  }
}

const hhmm = (ms) => `${new Date(ms).toISOString().slice(11, 16)}Z`

// The repo root: walk up to the folder holding .git (a folder, or a file in a worktree).
function repoRoot(start) {
  let dir = start
  for (let i = 0; i < 30 && dir; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

function branchOf(root) {
  let gitDir = join(root, '.git')
  if (statSync(gitDir).isFile()) {
    const m = /gitdir:\s*(.+)/.exec(readFileSync(gitDir, 'utf8'))
    if (!m) return null
    gitDir = m[1].trim()
    if (!gitDir.startsWith('/')) gitDir = join(root, gitDir)
  }
  const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
  return ref ? ref[1] : head.slice(0, 7) // detached: the short sha
}

// Which link of an armed chain this release is, e.g. "link 2/2".
function chainLink(projectDir, branch) {
  const chain = readJson(join(projectDir, '.claude', 'full-auto-chain.json'))
  if (!chain || !Array.isArray(chain.versions)) return null
  if (chain.expiresAt && Date.parse(chain.expiresAt) < Date.now()) return null
  const version = branch.replace(/^V/, '')
  const i = chain.versions.indexOf(version)
  return i < 0 ? null : `link ${i + 1}/${chain.versions.length}`
}

// Hank (this plugin's hooks/budget-cap.mjs) keeps one state file per subagent in
// <scratchpad>/.hank/<session>/<agent_id>.json (tokens, and the budget once
// known). The status line isn't told the scratchpad, so try where Claude Code
// puts it: /private/tmp/claude-<uid>/<project slug>/<session>/scratchpad.
function hankLine(input, projectDir) {
  const sid = input.session_id
  if (!sid) return null
  const slug = input.transcript_path ? basename(dirname(input.transcript_path)) : projectDir.replace(/[^A-Za-z0-9-]/g, '-')
  const uid = safe(() => process.getuid(), '')
  const dirs = [
    join('/private/tmp', `claude-${uid}`, slug, sid, 'scratchpad', '.hank', sid),
    join('/tmp', `claude-${uid}`, slug, sid, 'scratchpad', '.hank', sid),
    join(tmpdir(), '.hank', sid),
  ]
  const dir = dirs.find((d) => existsSync(d))
  if (!dir) return null
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'navigator.json')
    .map((f) => ({ f, t: safe(() => statSync(join(dir, f)).mtimeMs, 0) }))
    .sort((a, b) => b.t - a.t)[0]
  if (!newest) return null
  const state = readJson(join(dir, newest.f))
  if (!state || typeof state.tokens !== 'number') return null
  const id = newest.f.replace(/\.json$/, '')
  const meta = input.transcript_path ? readJson(join(dirname(input.transcript_path), sid, 'subagents', `agent-${id}.meta.json`)) : null
  const name = meta?.agentType || (meta?.description || '').split(':')[0].trim() || 'agent'
  const budget = hankBudget(meta, state, projectDir)
  const used = (state.tokens / 1e6).toFixed(1)
  return budget ? `Hank: ${name} ${used}/${+(budget / 1e6).toFixed(1)}M` : `Hank: ${name} ${used}M`
}

// The budget the way Hank reads it (budget-cap.mjs `decide`), so the line's
// denominator is the one that stops the agent: the state file's, the
// description's tag, kit.json `budgets` (the role, the model numbers, "*"),
// then Hank's own table, then the 15M Hank gives a role it doesn't know.
// Kit 1.7 (council L6): this read 25M defaults that Hank no longer used.
export function hankBudget(meta, state = {}, projectDir = null) {
  if (state.budget) return state.budget
  const tagged = parseBudget(meta?.description)
  if (tagged) return tagged
  const role = agentName({ agentType: bareAgentType(meta?.agentType), description: meta?.description })
  const byModel = MODEL_DEFAULTS[role]?.[/fable/i.test(state.model || '') ? 'fable' : 'opus']
  const kit = projectDir ? kitBudgets(join(projectDir, '.claude', 'kit.json')) : null
  const fromTable = kit ? kit[role] ?? byModel?.budget ?? kit['*'] ?? DEFAULT_BUDGETS[role] : byModel?.budget ?? DEFAULT_BUDGETS[role]
  return fromTable ?? OTHER_BUDGET
}

// The plan's headline: the first `Expected: ≈ <N>M` line (inception's form)
// in <plans>V<version>.md, or the kit's <plans>kit-<version>.md, with
// <plans> from kit.json `plans`, else ~/.claude/plans/. Tokens, or null.
// Kit 1.7 (council Feature 3): spent ÷ headline shows a plan's 0.31 or 1.4
// at the first step instead of at the wrap.
export const HEADLINE = /^\W*Expected:\s*≈\s*(\d+(?:\.\d+)?)\s*M\b/m
export function planHeadline(version, kitJson = null) {
  if (!version) return null
  const v = String(version).replace(/^(V|kit-)/, '')
  const set = kitJson?.plans
  const dir = typeof set === 'string' && set ? set.replace(/^~(?=$|\/)/, homedir()) : join(homedir(), '.claude', 'plans')
  for (const name of [`V${v}.md`, `kit-${v}.md`]) {
    const m = HEADLINE.exec(safe(() => readFileSync(join(dir, name), 'utf8'), ''))
    if (m) return { tokens: Number(m[1]) * 1e6, file: join(dir, name) }
  }
  return null
}

// "plan 0.31×": the session's tokens so far over the plan's headline.
export function planLine(models, headline) {
  if (!models || !headline?.tokens) return null
  const spent = Object.values(models).reduce((a, b) => a + b, 0)
  return `plan ${(spent / headline.tokens).toFixed(2)}×`
}

// The session's real tokens so far per model family, its subagents included,
// counted by usage.mjs's own functions (Skyler): each message.id once, all
// four usage fields. Only the bytes added since the last run are read; the
// count lives in <tmp>/the-tower-<session>.json. A file that shrank is recounted.
export function sessionTokens(input, cacheDir = tmpdir()) {
  const main = input.transcript_path
  if (!main || !existsSync(main)) return null
  const sid = basename(main, '.jsonl')
  const subDir = join(dirname(main), sid, 'subagents')
  const files = [main, ...safe(() => readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(subDir, f)), [])]
  const cachePath = join(cacheDir, `the-tower-${sid}.json`)
  const cache = readJson(cachePath) ?? { files: {} }
  const models = {}
  for (const file of files) {
    const size = safe(() => statSync(file).size, 0)
    let entry = cache.files[file]
    // A cache from before the split by model has no `models`: count afresh.
    if (!entry?.models || size < entry.offset) entry = { offset: 0, models: {}, ids: [] }
    if (size > entry.offset) {
      const fd = openSync(file, 'r')
      try {
        const buf = Buffer.alloc(size - entry.offset)
        readSync(fd, buf, 0, buf.length, entry.offset)
        const end = buf.lastIndexOf(0x0a) // only whole lines; a half-written one waits
        if (end >= 0) {
          // tallyEntries dedupes within a chunk; the remembered ids carry it across runs.
          const ids = new Set(entry.ids)
          const fresh = parseEntries(buf.subarray(0, end).toString('utf8')).filter((e) => {
            const id = e?.message?.usage ? e.message.id : null
            if (!id) return true
            if (ids.has(id)) return false
            ids.add(id)
            return true
          })
          for (const [model, b] of tallyEntries(fresh)) {
            const family = familyOf(model)
            entry.models[family] = (entry.models[family] || 0) + totalTokens(b)
          }
          entry.ids = [...ids].slice(-RECENT_IDS)
          entry.offset += end + 1
        }
      } finally {
        closeSync(fd)
      }
    }
    cache.files[file] = entry
    for (const [family, tokens] of Object.entries(entry.models)) models[family] = (models[family] || 0) + tokens
  }
  safe(() => writeFileSync(cachePath, JSON.stringify(cache)))
  return models
}

// Each family's share of the weekly meter, in points, and their sum, by the
// one meter figure (usage.mjs's tokensPerPoint, kit.json first).
export function meterShares(models, kitJson = null) {
  const by = {}
  let total = 0
  for (const [family, tokens] of Object.entries(models)) {
    by[family] = tokens / tokensPerPoint(kitJson, family)
    total += by[family]
  }
  return { by, total }
}

const pctText = (p) => (p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`)

// "session 9.6M ≈0.4% wk": the tokens and their share of the weekly meter;
// with two models that each count, the split too: "(fable 1.0 opus 0.4)".
export function sessionLine(models, kitJson = null) {
  if (!models) return null
  const tokens = Object.values(models).reduce((a, b) => a + b, 0)
  const { by, total } = meterShares(models, kitJson)
  const split = Object.entries(by)
    .filter(([, p]) => p >= 0.1)
    .sort((a, b) => b[1] - a[1])
  const detail = split.length > 1 ? ` (${split.map(([f, p]) => `${f} ${p.toFixed(1)}`).join(' ')})` : ''
  return `session ${(tokens / 1e6).toFixed(1)}M ≈${pctText(total)} wk${detail}`
}

// A weekly window from rate limits: the mod's shape ([{ kind: 'seven_day',
// percentUsed }], also what meter-now.json holds) or the terminal's
// ({ seven_day: { used_percentage } }). `fable` asks for the Fable-only
// window; its name isn't in a sample yet, so any seven-day kind or key naming
// Fable counts, and none means none shown.
function weekFrom(rl, fable = false) {
  if (!rl) return null
  const wanted = (name) => (fable ? /^seven_?day.*fable/i.test(name || '') : name === 'seven_day' || name === 'sevenDay')
  if (Array.isArray(rl)) {
    const w = rl.find((r) => wanted(r?.kind))
    return typeof w?.percentUsed === 'number' ? w.percentUsed : null
  }
  const key = Object.keys(rl).find(wanted)
  const w = key ? rl[key] : null
  const v = w?.used_percentage ?? w?.percentUsed ?? w?.utilization
  return typeof v === 'number' ? v : null
}

// The week's share, always shown when anything knows it (3.0: the session's
// share means little without the week it lands in): the input's live figure,
// else ~/.claude/meter-now.json (daily-budget.mjs --tower writes it every
// 10 s), marked "~" when older than 30 minutes. Fable's own week sits beside
// it while Fable runs in this session.
export function weekLine(input, fableRuns = false, nowPath = join(homedir(), '.claude', 'meter-now.json'), now = Date.now()) {
  let rl = input?.rate_limits ?? input?.rateLimits
  let mark = ''
  if (safe(() => weekFrom(rl)) === null) {
    const saved = readJson(nowPath)
    rl = saved?.rate_limits
    const at = Date.parse(saved?.at)
    if (!Number.isFinite(at) || now - at > STALE_MS) mark = '~'
  }
  const week = safe(() => weekFrom(rl))
  if (week === null) return null
  const fable = fableRuns ? safe(() => weekFrom(rl, true)) : null
  return `week ${mark}${Math.round(week)}%${fable !== null ? ` (Fable ${Math.round(fable)}%)` : ''}`
}

// A short "what" for the toast: a command's first words, or a file's name.
// A script's path shrinks to its name (scripts/stamp.sh -> stamp.sh): the
// line has 80 columns and the folder rarely tells anything.
const firstWords = (command) =>
  String(command)
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((w, i) => (i === 0 ? basename(w) : w))
    .join(' ')

function shortWhat(tool, args) {
  if (args?.command) return firstWords(args.command)
  if (args?.file_path) return basename(String(args.file_path))
  return tool || '?'
}

// The newest refusal of the last 30 minutes: the guard's deny lines in
// .claude/full-auto.log, or auto mode's in .claude/permission-denied.log.
function toast(projectDir) {
  const now = Date.now()
  const found = []
  const guardLog = join(projectDir, '.claude', 'full-auto.log')
  if (existsSync(guardLog)) {
    // <iso> \t <verdict> \t <what> \t <why> \t <agent>
    const row = tail(guardLog)
      .map((l) => l.split('\t'))
      .filter((r) => r[1] === 'deny')
      .at(-1)
    if (row) {
      const what = firstWords(row[2])
      found.push({ t: Date.parse(row[0]), text: (when) => `the Commissioner said no (${what}) ${when}` })
    }
  }
  const deniedLog = join(projectDir, '.claude', 'permission-denied.log')
  if (existsSync(deniedLog)) {
    // <iso> \t <agent> \t <tool> \t <input json> \t <mode> \t <id>
    const row = tail(deniedLog).at(-1)?.split('\t')
    if (row) {
      const what = shortWhat(row[2], safe(() => JSON.parse(row[3])))
      found.push({ t: Date.parse(row[0]), text: (when) => `auto said no (${what}) ${when}` })
    }
  }
  const latest = found.filter((f) => Number.isFinite(f.t) && now - f.t <= TOAST_MS).sort((a, b) => b.t - a.t)[0]
  return latest ? latest.text(hhmm(latest.t)) : null
}

// Fit under 80: shorten the toast's command first, then drop parts, least
// telling first (the chain link, then Hank, then the plan ratio, then the
// toast). The session's count and the week stay: they are what the line is for.
export function fit(parts) {
  const join3 = () => Object.values(parts).filter(Boolean).join(' · ')
  if (join3().length > MAX && parts.toast) parts.toast = parts.toast.replace(/\(([^)]{12})[^)]+\)/, '($1…)')
  for (const key of ['link', 'hank', 'plan', 'toast']) {
    if (join3().length <= MAX) break
    parts[key] = null
  }
  const line = join3()
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line
}

export function statusLine(input, opts = {}) {
  const start = input?.workspace?.current_dir || input?.cwd || process.cwd()
  const root = safe(() => repoRoot(start))
  const projectDir = input?.workspace?.project_dir || root || start
  const branch = (root && safe(() => branchOf(root))) || basename(start)
  const parts = { session: null, plan: null, link: null, hank: null, toast: null, week: null }
  try {
    const models = safe(() => sessionTokens(input ?? {}, opts.cacheDir))
    const kit = safe(() => readKit(projectDir))
    parts.session = safe(() => sessionLine(models, kit))
    parts.plan = safe(() => planLine(models, planHeadline(branch, opts.plansDir ? { plans: opts.plansDir } : kit)))
    parts.link = safe(() => chainLink(projectDir, branch))
    parts.hank = safe(() => hankLine(input ?? {}, projectDir))
    parts.toast = safe(() => toast(projectDir))
    parts.week = safe(() => weekLine(input ?? {}, (models?.fable || 0) > 0, opts.meterNow))
    return fit(parts) || branch
  } catch {
    return branch
  }
}

function readStdin() {
  if (process.stdin.isTTY) return {}
  return safe(() => JSON.parse(readFileSync(0, 'utf8') || '{}'), {}) ?? {}
}

// --install: a human step. Shows the key before and after, asks for y, backs
// the file up, then writes it back with every other key kept.
async function install() {
  const path = join(homedir(), '.claude', 'settings.json')
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '{}'
  let settings
  try {
    settings = JSON.parse(raw)
  } catch {
    console.log(`${path} isn't valid JSON; fix it first. Nothing written.`)
    return
  }
  const after = { type: 'command', command: `node ${fileURLToPath(import.meta.url)}` }
  const show = (v) => (v === undefined ? '(not set)' : JSON.stringify(v, null, 2).split('\n').join('\n  '))
  console.log(`${path}, key "statusLine"`)
  console.log(`- before: ${show(settings.statusLine)}`)
  console.log(`+ after:  ${show(after)}`)
  if (JSON.stringify(settings.statusLine) === JSON.stringify(after)) {
    console.log('Already installed. Nothing written.')
    return
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => rl.question('Write it? (y/N) ', resolve))
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Nothing written.')
    return
  }
  if (existsSync(path)) copyFileSync(path, `${path}.bak-the-tower`)
  settings.statusLine = after
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`Written. Backup: ${path}.bak-the-tower. Restart Claude Code to see it.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--headline')
  if (process.argv.includes('--install')) {
    install().catch((err) => console.log(`Install failed: ${err?.message ?? err}. Nothing written.`))
  } else if (at > 0) {
    // For Skyler: the headline in tokens and its file, or nothing when the plan has none.
    const h = planHeadline(process.argv[at + 1], readKit(process.cwd()))
    if (h) console.log(`${h.tokens}\t${h.file}`)
  } else {
    let line = ''
    try {
      line = statusLine(readStdin())
    } catch {
      line = ''
    }
    process.stdout.write(`${line}\n`)
  }
}
