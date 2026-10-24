#!/usr/bin/env node
// Proposes each role's budget from what it really used in the last releases,
// so a project's kit.json `budgets` are measured, not guessed (kit 1.7, council
// Feature 3: the defaults sat at twice the work, 0.5M median c-3po under 25M).
//
// Usage: node <release plugin>/scripts/budgets-derive.mjs [--project <dir>]
//          [--releases N] [--dir <transcripts>] [--json] [--write]
//
// A release is a session whose command is a release one (captain-call,
// cattle-drive, night-watch), read from the project's transcript folder with
// Skyler's readers (usage.mjs); the last N by start time count (default 5).
// Per role: the runs, the median, the 90th percentile and the proposal,
// p90 × 1.3 rounded up to a whole M (at least 1M), capped at the budgets
// file's ceiling except the roles allowed above it (the audits), never below
// the budgets file's default, and none from fewer than three runs.
// --write puts the proposals in the project's .claude/kit.json `budgets`,
// keeping the keys it doesn't propose and the "*" row; it rewrites only that
// value, so the rest of the file keeps its bytes.
// A role whose numbers go by model (mosbius-designs) is shown, never written:
// a kit entry would hide its Opus and Fable split from Hank.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ABOVE_CEILING, BUDGET_CEILING, DEFAULT_BUDGETS, MODEL_DEFAULTS } from '../hooks/budget-cap.mjs'
import { agentName, projectFolderName, readEntries, sessionCommand, tallyEntries, totalTokens } from './usage.mjs'

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

/** The last `n` release sessions in a transcript folder: [{ id, command, start, runs: [{ role, tokens }] }]. */
export function releaseRuns(dir, n = 5) {
  let files = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const releases = []
  for (const f of files) {
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
      let tokens = 0
      for (const b of tallyEntries(readEntries(join(subDir, s))).values()) tokens += totalTokens(b)
      runs.push({ role, tokens })
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

export function propose(role, p) {
  const raw = Math.max(1, Math.ceil((p * HEADROOM) / M)) * M
  return ABOVE_CEILING.has(role) ? raw : Math.min(raw, BUDGET_CEILING)
}

/** Per role, from the releases' runs: { role, runs, median, p90, proposed, byModel }. */
// Fewer runs than this say nothing about a role: one 0.2M run would write 1M
// and Hank would stop the next bigger job of that role there (kit 1.7 review).
export const MIN_RUNS = 3

/**
 * Per role, from the releases' runs: { role, runs, median, p90, proposed, byModel }.
 * `proposed` is null under MIN_RUNS, and never below the budgets.json default.
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
      proposed: xs.length < MIN_RUNS ? null : Math.max(propose(role, p90(xs)), DEFAULT_BUDGETS[role] ?? 0),
      byModel: Boolean(MODEL_DEFAULTS[role]),
    }))
    .sort((a, b) => a.role.localeCompare(b.role))
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
  console.log(o.json ? JSON.stringify({ releases: releases.map((r) => r.id), rows }, null, 2) : table(rows, releases))
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
