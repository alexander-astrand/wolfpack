#!/usr/bin/env node
// /leon quick's picker. A Haiku run archived 75 sessions against its own rules
// (idle under 24 h, titles that don't parse, other projects) and invented the
// idle hours, so the rules live here and the model only archives what this
// prints. When in doubt a session is left: a missing or odd value never archives.
//
//   node scripts/leon-pick.mjs --list <file> --self <id> --root <repo> [--now <ISO>] [--plans <dir>] [--json]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DAY_MS = 24 * 60 * 60 * 1000

// A title is printed on one line of a note other sessions read.
const clean = (s) => [...s].map((c) => (c < ' ' || c === '\x7f' ? ' ' : c)).join('').trim()

const hours = (ms) => (ms / 3600000).toFixed(1)

const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep)

// `worktrees` includes the repo root itself (git lists it first).
export function pick({ sessions, now, self, worktrees = [], openLogs = [] }) {
  const roots = worktrees.map((w) => resolve(w))
  const archive = []
  const left = []
  for (const s of sessions) {
    const title = typeof s.title === 'string' ? s.title : ''
    const at = Date.parse(s.lastActivityAt)
    const idleMs = Number.isNaN(at) ? null : now - at
    const idle = idleMs === null ? '?' : hours(idleMs)
    const leave = (reason) => left.push({ sessionId: s.sessionId, title, reason, idle })

    if (!s.sessionId) { leave('no id'); continue }
    if (s.sessionId === self) { leave('self'); continue }
    if (s.isArchived) { leave('archived'); continue }
    if (s.isRunning) { leave('running'); continue }
    if (s.pinned) { leave('pinned'); continue }
    if (s.unread) { leave('unread'); continue }
    const cwd = s.cwd || s.originCwd
    if (!cwd || !roots.some((r) => inside(resolve(cwd), r))) { leave('other project'); continue }
    const parts = title.split(' · ').map((p) => p.trim())
    if (parts.length !== 3 || parts.some((p) => !p)) { leave('untitled'); continue }
    if (idleMs === null || idleMs < DAY_MS) { leave('idle <24 h'); continue }
    if (openLogs.some((log) => log.includes(s.sessionId) || log.includes(title))) { leave('open chain'); continue }
    archive.push({ sessionId: s.sessionId, title, idle })
  }
  return { archive, left }
}

function render({ archive, left }) {
  const lines = archive.map((a) => `ARCHIVE ${a.sessionId}\t${clean(a.title)} (idle ${a.idle} h)`)
  for (const l of left) lines.push(`LEFT ${l.reason}\t${clean(l.title)} (idle ${l.idle} h)`)
  const by = {}
  for (const l of left) by[l.reason] = (by[l.reason] || 0) + 1
  const why = Object.entries(by).map(([r, n]) => `${r}=${n}`).join(', ')
  lines.push(`COUNTS total=${archive.length + left.length} archived=${archive.length} left=${left.length}${why ? ` (${why})` : ''}`)
  return lines.join('\n')
}

function gitWorktrees(root) {
  const out = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  const paths = out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))
  return [root, ...paths, join(root, '.claude', 'worktrees')]
}

// A chain log is closed when its last marker line says DONE or STOPPED; a
// RESUMED/STARTED after a stop reopens it, and no marker at all counts as open
// (over-protecting is safe), so its sessions are off limits.
export function readOpenLogs(plans) {
  if (!existsSync(plans)) return []
  return readdirSync(plans)
    .filter((f) => /^V.*-chain-log.*\.md$/.test(f))
    .map((f) => readFileSync(join(plans, f), 'utf8'))
    .filter((t) => {
      const marks = t.match(/CHAIN (DONE|STOPPED|RESUMED|STARTED)/g)
      const last = marks?.[marks.length - 1]
      return !last || last === 'CHAIN RESUMED' || last === 'CHAIN STARTED'
    })
}

function main(argv) {
  const opt = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opt.json = true
    else if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i]
  }
  if (!opt.list || !opt.root || !opt.self) {
    console.error('usage: leon-pick.mjs --list <file> --self <id> --root <repo> [--now <ISO>] [--plans <dir>] [--json]')
    process.exit(2)
  }
  const sessions = JSON.parse(readFileSync(opt.list, 'utf8'))
  if (!Array.isArray(sessions)) throw new Error('the list file is not a JSON array')
  const now = opt.now ? Date.parse(opt.now) : Date.now()
  if (Number.isNaN(now)) throw new Error('--now is not a date')
  const result = pick({
    sessions,
    now,
    self: opt.self,
    worktrees: gitWorktrees(resolve(opt.root)),
    openLogs: readOpenLogs(opt.plans || join(homedir(), '.claude', 'plans')),
  })
  console.log(opt.json ? JSON.stringify(result, null, 2) : render(result))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
