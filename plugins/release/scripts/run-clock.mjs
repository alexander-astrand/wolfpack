#!/usr/bin/env node
// The watchdog's reads in one call (kit 1.8, council H4 and Feature 4). On
// every wake `captain-call` ran three reads per lane (`git log -1`, a `find`
// for the last write, the session's events), each a call on a 300k+ context.
// This prints them per lane in one, and by default only the silent ones.
//
// Usage: node run-clock.mjs --lanes <dir> [<dir>...] [--scratch <dir> [<dir>...]]
//          [--transcript <file> [<file>...]] [--silent-after 20] [--all]
//
// --lanes: the lane worktrees. Per lane: the last commit (`git log -1`), the
//   last file write under it, and the silent minutes since the later of them.
// --scratch: the lanes' scratch folders, in the same order as --lanes (the
//   first scratch belongs to the first lane); a write there counts as the
//   lane's, since a builder writes its scratch before its first commit.
// --transcript: a logged session's transcript file. A script can't read the
//   app's events, so the file's mtime stands in for the last event (the
//   header says so); one row per file. A symlinked transcript (the app's
//   `tasks/<id>.output`) is followed to the file it points at.
// --silent-after: minutes, default 20 (the `[watchdog]` limit).
// --all: every row, not only the silent ones.
//
// An empty print means everything is alive. The last write ignores `.git`,
// `node_modules` (lane.mjs symlinks it, an install writes thousands) and
// `.next` (a dev server rewrites it with no agent at work), and never follows
// a symlink.

import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const IGNORED = new Set(['.git', 'node_modules', '.next'])

// The newest mtime (ms) of any file under dir, or null for none or no dir.
export function lastWrite(dir) {
  let best = null
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        try {
          const t = lstatSync(p).mtimeMs
          if (best == null || t > best) best = t
        } catch {
          // gone between the listing and the stat: skip it
        }
      }
    }
  }
  walk(dir)
  return best
}

// The last commit's time (ms) and short hash, or null outside a repo.
export function lastCommit(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%ct %h'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const [ct, hash] = out.split(' ')
    return ct ? { at: Number(ct) * 1000, hash } : null
  } catch {
    return null
  }
}

const ago = (now, t) => (t == null ? null : Math.max(0, Math.floor((now - t) / 60000)))
const fmt = (m) => (m == null ? '-' : `${m} min`)

export function laneRow(lane, scratch, now) {
  const commit = lastCommit(lane)
  const writes = [lastWrite(lane), scratch ? lastWrite(scratch) : null].filter((t) => t != null)
  const write = writes.length ? Math.max(...writes) : null
  const latest = [commit?.at, write].filter((t) => t != null)
  return {
    kind: 'lane',
    name: basename(lane),
    path: lane,
    commitMin: ago(now, commit?.at),
    hash: commit?.hash ?? null,
    writeMin: ago(now, write),
    silentMin: latest.length ? ago(now, Math.max(...latest)) : null,
  }
}

export function transcriptRow(file, now) {
  let t = null
  // A transcript is named on purpose, and the app's `tasks/<id>.output` is a
  // link to the real file: lstat read the link's own (old) time, so a live
  // agent showed as SILENT. Follow it here; a broken link falls back to lstat.
  // Lanes still never follow links (lastWrite).
  try {
    t = statSync(file).mtimeMs
  } catch {
    try {
      t = lstatSync(file).mtimeMs
    } catch {
      // missing file: no sign of life
    }
  }
  return { kind: 'session', name: basename(file).replace(/\.jsonl$/, ''), path: file, commitMin: null, hash: null, writeMin: ago(now, t), silentMin: ago(now, t) }
}

// Silent: past the limit, or nothing at all to go by.
export const isSilent = (row, limit) => row.silentMin == null || row.silentMin >= limit

export function formatRows(rows, { limit, transcripts }) {
  const head = `run-clock: silent after ${limit} min${transcripts ? '; a session row reads its transcript file mtime, not the app\'s events' : ''}`
  const lines = rows.map((r) => {
    const commit = r.kind === 'lane' ? `last commit ${fmt(r.commitMin)}${r.hash ? ` (${r.hash})` : ''}, ` : ''
    const silent = isSilent(r, limit) ? 'SILENT ' : ''
    return `${silent}${r.kind} ${r.name}: ${commit}last write ${fmt(r.writeMin)}, silent ${fmt(r.silentMin)}  ${r.path}`
  })
  return [head, ...lines].join('\n')
}

export function parseArgs(argv) {
  const o = { lanes: [], scratch: [], transcripts: [], limit: 20, all: false }
  let list = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--lanes') list = o.lanes
    else if (a === '--scratch') list = o.scratch
    else if (a === '--transcript') list = o.transcripts
    else if (a === '--all') {
      o.all = true
      list = null
    } else if (a === '--silent-after') {
      o.limit = Number(argv[++i])
      if (!Number.isFinite(o.limit) || o.limit <= 0) throw new Error('--silent-after wants minutes, e.g. 20')
      list = null
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else if (list) list.push(a)
    else throw new Error(`Unexpected argument ${a}`)
  }
  if (o.lanes.length === 0 && o.transcripts.length === 0) throw new Error('Need --lanes <dir> or --transcript <file>')
  return o
}

/** The print for these options; an empty string when all are alive and --all is off. */
export function report(o, now = Date.now()) {
  const rows = [...o.lanes.map((l, i) => laneRow(l, o.scratch[i], now)), ...o.transcripts.map((t) => transcriptRow(t, now))]
  const shown = o.all ? rows : rows.filter((r) => isSilent(r, o.limit))
  return shown.length ? formatRows(shown, { limit: o.limit, transcripts: o.transcripts.length > 0 }) : ''
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const out = report(parseArgs(process.argv.slice(2)))
    if (out) console.log(out)
  } catch (err) {
    console.error(err.message)
    console.error('Usage: node run-clock.mjs --lanes <dir> [<dir>...] [--scratch <dir>...] [--transcript <file>...] [--silent-after 20] [--all]')
    process.exit(1)
  }
}
