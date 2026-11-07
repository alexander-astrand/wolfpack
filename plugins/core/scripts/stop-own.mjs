#!/usr/bin/env node
// Stops this session's own leftovers: its background `sleep` timer, a dev server, a headless Chrome.
// Why it exists (jedi-council 1.9 M13): the classifier refused `pkill` and `kill` of a session's own
// watchdog sleep, dev server and Chromes nine times in a week, each a stop while Alexander was away.
// One kit path means one allow rule: Bash(node */plugins/core/scripts/stop-own.mjs*).
//
//   node <core>/scripts/stop-own.mjs [--port N]... [--name sleep|chrome|vite|next]... [--dry]
//
// Safety, which is what makes a blanket allow fine: it only stops a process that is this session's.
//  1. Preferred: the nearest ancestor of this script whose command is `claude` is the session; only
//     its descendants are candidates. Another session's processes, and yours outside Claude, are not.
//  2. If no claude ancestor is found (a different launcher), --dry lists the processes whose working
//     folder is inside the current folder's tree, but a real stop is refused: run from a main
//     checkout, that tree holds every `.claude/worktrees/*` session's sleeps, servers and Chromes,
//     so the folder is no proof of ownership (R1 S2).
// Never the script itself or its ancestors. --dry lists pid and command and stops nothing.
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const NAMES = {
  sleep: (cmd) => /(^|\/)sleep(\s|$)/.test(cmd),
  chrome: (cmd) => /(chrom(e|ium)|Google Chrome)/i.test(cmd) && /--headless|--remote-debugging|--user-data-dir/.test(cmd),
  vite: (cmd) => /(^|[\s/])vite(\s|$)/.test(cmd),
  next: (cmd) => /next[ -](dev|start|server)|next-server/.test(cmd),
}

export function parseArgs(argv) {
  const o = { ports: [], names: [], dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--port needs a port number, got ${argv[i]}`)
      o.ports.push(n)
    } else if (a === '--name') {
      const n = argv[++i]
      if (!NAMES[n]) throw new Error(`--name is one of ${Object.keys(NAMES).join(', ')}, got ${n}`)
      o.names.push(n)
    } else if (a === '--dry') o.dry = true
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

// procs: [{ pid, ppid, cmd }]. Returns the pid chain from `pid` up to the root (itself first).
export function ancestors(procs, pid) {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const chain = []
  for (let p = byPid.get(pid); p && !chain.includes(p.pid); p = byPid.get(p.ppid)) chain.push(p.pid)
  return chain
}

export function sessionPidOf(procs, selfPid) {
  return ancestors(procs, selfPid).find((pid) => /(^|\/)claude(\s|$)/.test(procs.find((p) => p.pid === pid).cmd)) ?? null
}

// The pure selection: which processes this run may stop. `cwds` maps pid to working folder (only used
// without a session), `portPids` maps port to the pids listening on it.
export function select({ procs, selfPid, sessionPid, cwds = {}, root, ports = [], names = [], portPids = {} }) {
  const protectedPids = new Set(ancestors(procs, selfPid))
  const owned = (p) => {
    if (sessionPid) return ancestors(procs, p.pid).includes(sessionPid)
    const c = cwds[p.pid]
    return Boolean(c && root && (c === root || c.startsWith(root.endsWith('/') ? root : `${root}/`)))
  }
  const wanted = new Set(ports.flatMap((port) => portPids[port] ?? []))
  return procs.filter((p) => {
    if (protectedPids.has(p.pid) || !owned(p)) return false
    return wanted.has(p.pid) || names.some((n) => NAMES[n](p.cmd))
  })
}

// With no claude ancestor only a listing is allowed; a real stop throws before anything is stopped.
export function assertCanStop({ sessionPid, dry, root }) {
  if (sessionPid || dry) return
  throw new Error(`no claude ancestor found, so nothing is stopped: the folder tree of ${root} can hold other sessions' processes (a main checkout holds every worktree's). Run --dry to list them, then stop yours by hand.`)
}

function listProcs() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n')
    .map((l) => l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }))
}

function tryLsof(args) {
  try {
    return execFileSync('lsof', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    return e.stdout?.toString() ?? '' // lsof exits 1 when it finds nothing
  }
}

function cwdsOf(procs) {
  const out = tryLsof(['-a', '-d', 'cwd', '-Fpn', '-p', procs.map((p) => p.pid).join(',')])
  const map = {}
  let pid = null
  for (const l of out.split('\n')) {
    if (l.startsWith('p')) pid = Number(l.slice(1))
    else if (l.startsWith('n') && pid) map[pid] = l.slice(1)
  }
  return map
}

export function main(argv, out = console.log) {
  const o = parseArgs(argv)
  // A real stop must name its target; a bare --dry lists every kind so you can see what is there.
  if (!o.ports.length && !o.names.length) {
    if (!o.dry) throw new Error('give at least one --port N or --name sleep|chrome|vite|next')
    o.names = Object.keys(NAMES)
  }
  const procs = listProcs()
  const sessionPid = sessionPidOf(procs, process.pid)
  const root = realpathSync(process.cwd())
  assertCanStop({ sessionPid, dry: o.dry, root })
  const portPids = Object.fromEntries(o.ports.map((port) => [port, tryLsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).split('\n').filter(Boolean).map(Number)]))
  const hit = select({ procs, selfPid: process.pid, sessionPid, cwds: sessionPid ? {} : cwdsOf(procs), root, ports: o.ports, names: o.names, portPids })
  out(sessionPid ? `scope: descendants of the claude session (pid ${sessionPid})` : `scope: no claude ancestor found, listing only, processes working inside ${root}`)
  for (const p of hit) {
    if (!o.dry) {
      try {
        process.kill(p.pid, 'SIGTERM')
      } catch (e) {
        out(`failed ${p.pid}: ${e.message}`)
        continue
      }
    }
    out(`${o.dry ? 'would stop' : 'stopped'} ${p.pid}  ${p.cmd.slice(0, 120)}`)
  }
  if (!hit.length) out('nothing of this session matched')
  return hit.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
}
