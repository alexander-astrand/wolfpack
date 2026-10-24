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
// file's ceiling except the roles allowed above it (the audits).
// --write puts the proposals in the project's .claude/kit.json `budgets`,
// keeping the keys it doesn't propose and the "*" row; it writes nothing else.
// A role whose numbers go by model (mosbius-designs) is shown, never written:
// a kit entry would hide its Opus and Fable split from Hank.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ABOVE_CEILING, BUDGET_CEILING, MODEL_DEFAULTS } from '../hooks/budget-cap.mjs'
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
export function derive(releases) {
  const by = new Map()
  for (const r of releases) for (const run of r.runs) by.set(run.role, [...(by.get(run.role) ?? []), run.tokens])
  return [...by.entries()]
    .map(([role, xs]) => ({ role, runs: xs.length, median: median(xs), p90: p90(xs), proposed: propose(role, p90(xs)), byModel: Boolean(MODEL_DEFAULTS[role]) }))
    .sort((a, b) => a.role.localeCompare(b.role))
}

/** The kit.json text with the proposals in `budgets`; every other key stays. */
export function withBudgets(kitText, rows) {
  const kit = JSON.parse(kitText)
  const budgets = kit.budgets && typeof kit.budgets === 'object' && !Array.isArray(kit.budgets) ? kit.budgets : {}
  for (const r of rows) if (!r.byModel) budgets[r.role] = `${r.proposed / M}M`
  kit.budgets = budgets
  return `${JSON.stringify(kit, null, 2)}\n`
}

const fmt = (t) => `${(t / M).toFixed(1)}M`

export function table(rows, releases) {
  const lines = [
    `From ${releases.length} release session(s): ${releases.map((r) => r.id.slice(0, 8)).join(', ') || 'none'}`,
    '',
    '| Role | Runs | Median | p90 | Proposed |',
    '|---|---|---|---|---|',
  ]
  for (const r of rows) lines.push(`| ${r.role} | ${r.runs} | ${fmt(r.median)} | ${fmt(r.p90)} | ${r.proposed / M}M${r.byModel ? ' (by model, not written)' : ''} |`)
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
    if (!rows.length) throw new Error('No release runs found; kit.json left as it was')
    writeFileSync(kitPath, withBudgets(readFileSync(kitPath, 'utf8'), rows))
  }
  console.log(o.json ? JSON.stringify({ releases: releases.map((r) => r.id), rows }, null, 2) : table(rows, releases))
  if (o.write && !o.json) console.log(`\nWrote ${rows.filter((r) => !r.byModel).length} budgets to ${join(o.project, '.claude', 'kit.json')}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
