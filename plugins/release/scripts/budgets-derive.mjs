#!/usr/bin/env node
// Proposes each role's budget from what it really used in the last releases,
// so a project's kit.json `budgets` are measured, not guessed (kit 1.7, council
// Feature 3: the defaults sat at twice the work, 0.5M median c-3po under 25M).
//
// Usage: node <release plugin>/scripts/budgets-derive.mjs [--project <dir>]
//          [--releases N] [--dir <transcripts>] [--json] [--write]
//
// A release is a session whose command is a release one (captain-call,
// cattle-drive, night-watch), read from the project's transcript folders (its
// main checkout's and every worktree's) with
// Skyler's readers (usage.mjs); the last N by start time count (default 5).
// Per role: the runs, the median, the 90th percentile and the proposal,
// p90 × 1.3 rounded up to a whole M, at least 2M (the smallest default
// today), capped at the budgets file's ceiling except the roles allowed above
// it (the audits), and none from fewer than three runs. It may go below a
// role's default: the point is a cap nearer the real work (council H2).
// --write puts the proposals in the project's .claude/kit.json `budgets`,
// keeping the keys it doesn't propose and the "*" row; it rewrites only that
// value, so the rest of the file keeps its bytes.
// A role whose numbers go by model (mosbius-designs) is shown, never written:
// a kit entry would hide its Opus and Fable split from Hank.
//
// Rework per builder (kit 1.8, F11 of the kit 1.7.1 council): Opus against
// Sonnet was picked by the route row while 87% of builder spend went to Opus
// and jesse-pinkman ran 8x cheaper a run. The table under the budgets shows,
// per builder and model, the steps, the fix rounds and the rate, so the pick
// is measured. How it is measured, from the transcripts alone: a fix round is
// a run whose description says fix, rework, sendback, redo, again or round N,
// or a later prompt sent into a run (a SendMessage back to work); a step is
// any other run. Rate = fix rounds per step. PR bodies are not read: their
// send-back notes are free text with no agent column to count by.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ABOVE_CEILING, BUDGET_CEILING, MODEL_DEFAULTS } from '../hooks/budget-cap.mjs'
import { agentName, projectFolderName, readEntries, sessionCommand, tallyEntries, totalTokens, transcriptDirs } from './usage.mjs'

const M = 1_000_000
const RELEASE = /captain-call|cattle-drive|night-watch/
export const HEADROOM = 1.3

const bare = (t) => (typeof t === 'string' ? t.replace(/^[a-z0-9-]+:/i, '') : t)
const firstTime = (entries) => {
  for (const e of entries) {
    const t = Date.parse(e.timestamp)
    if (!Number.isNaN(t)) return t
  }
  return null
}

const shortModel = (m) => (/(haiku|sonnet|opus|fable)/i.exec(m || '') || ['?'])[0].toLowerCase()

// Prompts a run got after its first: a SendMessage that sent it back to work.
// Tool results, the app's injected lines and background notes are not prompts.
export function resumesOf(entries) {
  let prompts = 0
  for (const e of entries) {
    if (e?.type !== 'user' || e.isMeta) continue
    const c = e.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b) => b?.type === 'tool_result') ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : ''
    if (text.trim() && !/^\s*<(system-reminder|task-notification)/.test(text)) prompts += 1
  }
  return Math.max(0, prompts - 1)
}

/**
 * The last `n` release sessions in a project's transcript folders (the given
 * one and its main checkout's and worktrees', usage.mjs transcriptDirs): a
 * release run from a worktree counts too. [{ id, command, start, runs: [{ role, tokens }] }]
 */
export function releaseRuns(dir, n = 5) {
  const files = []
  for (const d of transcriptDirs(dir)) {
    try {
      for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) files.push({ dir: d, f })
    } catch {
      // a folder gone or unreadable: the others still count
    }
  }
  const releases = []
  for (const { dir, f } of files) {
    const entries = readEntries(join(dir, f))
    const command = sessionCommand(entries)
    if (!RELEASE.test(command)) continue
    const id = f.slice(0, -'.jsonl'.length)
    const subDir = join(dir, id, 'subagents')
    const runs = []
    let subs = []
    try {
      subs = readdirSync(subDir).filter((s) => s.endsWith('.jsonl'))
    } catch {
      // a release with no agents still counts as one of the N
    }
    for (const s of subs) {
      let meta = {}
      try {
        meta = JSON.parse(readFileSync(join(subDir, s.replace(/\.jsonl$/, '.meta.json')), 'utf8'))
      } catch {
        // no meta: the description prefix can't name it either
      }
      const role = agentName({ ...meta, agentType: bare(meta.agentType) })
      if (!role) continue
      const entries = readEntries(join(subDir, s))
      let tokens = 0
      let model = '?'
      let most = -1
      for (const [m, b] of tallyEntries(entries)) {
        tokens += totalTokens(b)
        if (totalTokens(b) > most) [most, model] = [totalTokens(b), shortModel(m)]
      }
      runs.push({ role, tokens, model, description: String(meta.description || ''), resumes: resumesOf(entries) })
    }
    releases.push({ id, command, start: firstTime(entries) ?? 0, runs })
  }
  return releases.sort((a, b) => a.start - b.start).slice(-n)
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return 0
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Nearest rank: the smallest run at or above 90% of the runs.
export function p90(xs) {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.ceil(0.9 * s.length) - 1] : 0
}

// The lowest proposal: a single small run must not leave a role too tight to finish a step.
export const FLOOR = 2 * M

export function propose(role, p) {
  const raw = Math.max(FLOOR, Math.ceil((p * HEADROOM) / M) * M)
  return ABOVE_CEILING.has(role) ? raw : Math.min(raw, BUDGET_CEILING)
}

/** Per role, from the releases' runs: { role, runs, median, p90, proposed, byModel }. */
// Fewer runs than this say nothing about a role: one 0.2M run would write 1M
// and Hank would stop the next bigger job of that role there (kit 1.7 review).
export const MIN_RUNS = 3

/**
 * Per role, from the releases' runs: { role, runs, median, p90, proposed, byModel }.
 * `proposed` is null under MIN_RUNS; it may sit below the budgets.json default, never below FLOOR.
 */
export function derive(releases) {
  const by = new Map()
  for (const r of releases) for (const run of r.runs) by.set(run.role, [...(by.get(run.role) ?? []), run.tokens])
  return [...by.entries()]
    .map(([role, xs]) => ({
      role,
      runs: xs.length,
      median: median(xs),
      p90: p90(xs),
      proposed: xs.length < MIN_RUNS ? null : propose(role, p90(xs)),
      byModel: Boolean(MODEL_DEFAULTS[role]),
    }))
    .sort((a, b) => a.role.localeCompare(b.role))
}

// The roles that build a step: the five Opus builders and the Sonnet one.
export const BUILDERS = new Set(['chris-de-kok', 'ahmed-och-ahmed', 'saul-goodman', 'jeff-winger', 'troy-and-abed', 'jesse-pinkman'])
export const FIX_RUN = /\b(fix(es|ed)?|rework|send-?back|redo|again|round [2-9])\b/i

/** Per builder and model: { role, model, steps, fixRuns, resumes, rate, medianTokens }; rate is null with no steps. */
export function rework(releases) {
  const by = new Map()
  for (const r of releases) {
    for (const run of r.runs) {
      if (!BUILDERS.has(run.role)) continue
      const key = `${run.role}\t${run.model || '?'}`
      const row = by.get(key) ?? { role: run.role, model: run.model || '?', steps: 0, fixRuns: 0, resumes: 0, tokens: [] }
      if (FIX_RUN.test(run.description || '')) row.fixRuns += 1
      else row.steps += 1
      row.resumes += run.resumes || 0
      row.tokens.push(run.tokens)
      by.set(key, row)
    }
  }
  return [...by.values()]
    .map(({ tokens, ...row }) => ({ ...row, rate: row.steps ? (row.fixRuns + row.resumes) / row.steps : null, medianTokens: median(tokens) }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.model.localeCompare(b.model))
}

export function reworkTable(rows) {
  if (!rows.length) return 'No builder runs in these releases.'
  const lines = ['| Builder | Model | Steps | Fix runs | Sent back (resumes) | Rework per step | Median a run |', '|---|---|---|---|---|---|---|']
  for (const r of rows) lines.push(`| ${r.role} | ${r.model} | ${r.steps} | ${r.fixRuns} | ${r.resumes} | ${r.rate == null ? '–' : r.rate.toFixed(2)} | ${fmt(r.medianTokens)} |`)
  lines.push('', 'A fix run is one whose description says fix, rework, sendback, redo, again or round N; a resume is a later prompt sent into a run. Rework per step = (fix runs + resumes) / other runs. Transcripts only; PR bodies are not read.')
  return lines.join('\n')
}

const writable = (rows) => rows.filter((r) => !r.byModel && r.proposed != null)

// The index just past the JSON value starting at `i` (an object, array, string or bare word).
function valueEnd(text, i) {
  if (text[i] === '"') {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') j++
      else if (text[j] === '"') return j + 1
    }
    return text.length
  }
  if (text[i] !== '{' && text[i] !== '[') return i + /^[^,}\]\s]*/.exec(text.slice(i))[0].length
  let depth = 0
  for (let j = i; j < text.length; j++) {
    const ch = text[j]
    if (ch === '"') j = valueEnd(text, j) - 1
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') if (--depth === 0) return j + 1
  }
  return text.length
}

// The span of the root object's `budgets` value, or null when it has none.
function budgetsSpan(text) {
  const start = text.indexOf('{')
  let depth = 0
  for (let j = start; j < text.length; j++) {
    const ch = text[j]
    if (ch === '"') {
      const end = valueEnd(text, j)
      const after = /^\s*:\s*/.exec(text.slice(end))
      if (depth === 1 && after && text.slice(j, end) === '"budgets"') {
        const v = end + after[0].length
        return { keyAt: j, from: v, to: valueEnd(text, v) }
      }
      j = end - 1
    } else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
  }
  return null
}

/**
 * The kit.json text with the proposals in `budgets`. Only the `budgets` value
 * is rewritten (its keys kept, "*" included); every other byte of the file
 * stays as it was, so a hand-formatted kit.json keeps its shape.
 */
export function withBudgets(kitText, rows) {
  const kit = JSON.parse(kitText)
  const old = kit.budgets && typeof kit.budgets === 'object' && !Array.isArray(kit.budgets) ? kit.budgets : {}
  const budgets = { ...old }
  for (const r of writable(rows)) budgets[r.role] = `${r.proposed / M}M`
  const indent = /\n([ \t]+)"/.exec(kitText)?.[1] ?? '  '
  const span = budgetsSpan(kitText)
  if (span) {
    const lineStart = kitText.lastIndexOf('\n', span.keyAt) + 1
    const own = /^[ \t]*/.exec(kitText.slice(lineStart))[0]
    const body = JSON.stringify(budgets, null, indent).replace(/\n/g, `\n${own}`)
    return kitText.slice(0, span.from) + body + kitText.slice(span.to)
  }
  // No budgets yet: add the key last in the root object.
  const close = kitText.lastIndexOf('}')
  const before = kitText.slice(0, close).replace(/\s*$/, '')
  const comma = before.endsWith('{') ? '' : ','
  const body = JSON.stringify(budgets, null, indent).replace(/\n/g, `\n${indent}`)
  return `${before}${comma}\n${indent}"budgets": ${body}\n${kitText.slice(close)}`
}

const fmt = (t) => `${(t / M).toFixed(1)}M`

export function table(rows, releases) {
  const lines = [
    `From ${releases.length} release session(s): ${releases.map((r) => r.id.slice(0, 8)).join(', ') || 'none'}`,
    '',
    '| Role | Runs | Median | p90 | Proposed |',
    '|---|---|---|---|---|',
  ]
  for (const r of rows) {
    const proposed = r.proposed == null ? `– (under ${MIN_RUNS} runs, not written)` : `${r.proposed / M}M${r.byModel ? ' (by model, not written)' : ''}`
    lines.push(`| ${r.role} | ${r.runs} | ${fmt(r.median)} | ${fmt(r.p90)} | ${proposed} |`)
  }
  lines.push('', `Proposed: p90 × ${HEADROOM} rounded up, at least ${FLOOR / M}M, at most ${BUDGET_CEILING / M}M but for ${[...ABOVE_CEILING].join(', ')}; it may sit below the budgets.json default. A role needs ${MIN_RUNS} runs.`)
  return lines.join('\n')
}

function parseArgs(argv) {
  const o = { project: process.cwd(), releases: 5, dir: null, json: false, write: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') o.project = resolve(argv[++i])
    else if (argv[i] === '--releases') o.releases = Number(argv[++i])
    else if (argv[i] === '--dir') o.dir = argv[++i]
    else if (argv[i] === '--json') o.json = true
    else if (argv[i] === '--write') o.write = true
    else throw new Error(`Unknown argument ${argv[i]}`)
  }
  if (!(o.releases > 0)) throw new Error('--releases needs a positive number')
  return o
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  const dir = o.dir ?? join(homedir(), '.claude', 'projects', projectFolderName(o.project))
  const releases = releaseRuns(dir, o.releases)
  const rows = derive(releases)
  if (o.write) {
    const kitPath = join(o.project, '.claude', 'kit.json')
    if (!existsSync(kitPath)) throw new Error(`No ${kitPath}; nothing written`)
    if (!writable(rows).length) throw new Error(`No role has ${MIN_RUNS} or more release runs; kit.json left as it was`)
    writeFileSync(kitPath, withBudgets(readFileSync(kitPath, 'utf8'), rows))
  }
  const fixes = rework(releases)
  console.log(o.json ? JSON.stringify({ releases: releases.map((r) => r.id), rows, rework: fixes }, null, 2) : `${table(rows, releases)}\n\n## Rework per builder\n\n${reworkTable(fixes)}`)
  if (o.write && !o.json) console.log(`\nWrote ${writable(rows).length} budgets to ${join(o.project, '.claude', 'kit.json')}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
