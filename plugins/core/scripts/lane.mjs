#!/usr/bin/env node
// A worktree lane in one call, for `/tesseract`. The skill's steps were a
// `git fetch && git worktree add` compound (the allow lines match single
// commands) with no dependency step, so a lane's build, lint and Vitest broke
// on a missing node_modules (kit 1.6.1 L6, core Feature 8). `[lane-home]`.
//
// Usage: node lane.mjs add <name> [--base <branch>] [--branch <b>] [--port <n>] [--no-install] [--no-link]
//        node lane.mjs remove <name>
//        node lane.mjs list
// Run from the main checkout or any of its worktrees.
//
// add: a worktree at <parent>/<Project>-lanes/<name> (beside the main
//   checkout, never under .claude/), on branch <b> (default <name>; made from
//   --base, default the main checkout's branch, when it doesn't exist yet).
//   Then .env.local copied from the main checkout; node_modules symlinked
//   from the main checkout when the lock files match, else the install
//   command (kit.json project.install, else npm ci / pnpm / yarn / bun by the
//   lock file); a free dev port from project.devPort + 1 up (or --port); and
//   `supabase link --project-ref <refs.dev>` when the project has supabase/.
//   Prints one line: name, path, port, branch and what each step did.
// remove: refuses a lane with changes; else removes the worktree, prunes,
//   and drops the lanes folder once empty. Branches are always left alone.
// list: the lanes, one per line, with port, branch and clean or dirty.
//
// Never fetches or pushes: a lane from a remote branch is `--base origin/<b>`
// after the caller's own `git fetch`. Ports and branches live in
// <git common dir>/wolfpack-lanes.json, outside every working tree, so a
// lane stays clean for the builder's "tree is clean" check.

import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCKS = [
  ['package-lock.json', 'npm ci'],
  ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile'],
  ['yarn.lock', 'yarn install --frozen-lockfile'],
  ['bun.lock', 'bun install --frozen-lockfile'],
  ['bun.lockb', 'bun install --frozen-lockfile'],
]

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

// The main checkout, its git dir, and where its lanes live.
export function where(cwd = process.cwd()) {
  const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (basename(common) !== '.git') throw new Error(`${common} is not a checkout's .git folder (a bare repo has no main checkout to sit beside)`)
  const main = dirname(common)
  return { main, common, home: join(dirname(main), `${basename(main)}-lanes`), registry: join(common, 'wolfpack-lanes.json') }
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const readRegistry = (w) => readJson(w.registry) || {}
const writeRegistry = (w, reg) => writeFileSync(w.registry, `${JSON.stringify(reg, null, 2)}\n`)

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}

// The first port after the main dev port that no lane holds and nothing listens on.
export async function pickPort(kit, taken, free = portFree) {
  const start = (Number(kit?.project?.devPort) || 5173) + 1
  for (let p = start; p < start + 200; p++) {
    if (taken.has(p)) continue
    if (await free(p)) return p
  }
  throw new Error(`No free port from ${start} to ${start + 199}`)
}

// Link the main checkout's node_modules when the lane's lock file is the same,
// else run the install command. 'none' when the project has no package.json.
function deps(w, lane, kit, install) {
  if (!existsSync(join(lane, 'package.json'))) return 'none'
  const lock = LOCKS.find(([f]) => existsSync(join(lane, f)))
  const same = lock && existsSync(join(w.main, lock[0])) && readFileSync(join(w.main, lock[0])).equals(readFileSync(join(lane, lock[0])))
  if (same && existsSync(join(w.main, 'node_modules')) && !existsSync(join(lane, 'node_modules'))) {
    symlinkSync(join(w.main, 'node_modules'), join(lane, 'node_modules'), 'dir')
    // `node_modules/` in .gitignore matches a folder, not a symlink: exclude
    // the link in the repo's own exclude file so the lane stays clean.
    let ignored = true
    try {
      git(lane, 'check-ignore', '-q', 'node_modules')
    } catch {
      ignored = false
    }
    if (!ignored) mkdirSync(join(w.common, 'info'), { recursive: true })
    if (!ignored) appendFileSync(join(w.common, 'info', 'exclude'), '\n# lane.mjs: a lane\'s node_modules is a symlink to the main checkout\'s\n/node_modules\n')
    return 'linked'
  }
  if (!install) return 'skipped'
  const cmd = typeof kit?.project?.install === 'string' ? kit.project.install : lock ? lock[1] : 'npm install'
  execFileSync('sh', ['-c', cmd], { cwd: lane, stdio: ['ignore', 'pipe', 'pipe'] })
  return `installed (${cmd})`
}

function dbLink(w, lane, kit, link) {
  const ref = kit?.refs?.dev
  if (!link || !ref || !existsSync(join(w.main, 'supabase'))) return 'skipped'
  try {
    // stdin closed so a password prompt can't hang the call.
    execFileSync('supabase', ['link', '--project-ref', ref], { cwd: lane, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
    return 'linked'
  } catch (e) {
    return `failed (${String(e.stderr || e.message).trim().split('\n')[0]})`
  }
}

export async function add(name, opts = {}, cwd = process.cwd()) {
  if (!/^[\w.-]+$/.test(name || '')) throw new Error(`A lane name is letters, digits, ".", "_" or "-", got "${name}"`)
  const w = where(cwd)
  const reg = readRegistry(w)
  const path = join(w.home, name)
  if (existsSync(path) || reg[name]) throw new Error(`Lane "${name}" already exists at ${path}`)
  const kit = readJson(join(w.main, '.claude', 'kit.json'))
  const branch = opts.branch || name
  let exists = true
  try {
    git(w.main, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`)
  } catch {
    exists = false
  }
  if (exists) git(w.main, 'worktree', 'add', path, branch)
  else git(w.main, 'worktree', 'add', '-b', branch, path, opts.base || git(w.main, 'rev-parse', '--abbrev-ref', 'HEAD'))
  let env = 'none'
  if (existsSync(join(w.main, '.env.local'))) {
    copyFileSync(join(w.main, '.env.local'), join(path, '.env.local'))
    env = 'copied'
  }
  const taken = new Set(Object.values(reg).map((l) => l.port))
  const port = opts.port ? Number(opts.port) : await pickPort(kit, taken)
  reg[name] = { path, branch, port }
  writeRegistry(w, reg)
  const d = deps(w, path, kit, opts.install !== false)
  const db = dbLink(w, path, kit, opts.link !== false)
  return { name, path, port, branch, deps: d, env, db }
}

const lanesOf = (w) => {
  const home = real(w.home)
  const out = []
  let cur = null
  for (const l of git(w.main, 'worktree', 'list', '--porcelain').split('\n')) {
    if (l.startsWith('worktree ')) {
      cur = { path: l.slice(9) }
      if (dirname(real(cur.path)) === home) out.push(cur)
    } else if (l.startsWith('branch ') && cur) cur.branch = l.slice(7).replace(/^refs\/heads\//, '')
  }
  return out
}

export function list(cwd = process.cwd()) {
  const w = where(cwd)
  const reg = readRegistry(w)
  return lanesOf(w).map((l) => {
    const name = basename(l.path)
    const dirty = existsSync(l.path) && git(l.path, 'status', '--porcelain') !== ''
    return { name, path: l.path, branch: l.branch || '(detached)', port: reg[name]?.port ?? null, state: existsSync(l.path) ? (dirty ? 'dirty' : 'clean') : 'missing' }
  })
}

export function remove(name, cwd = process.cwd()) {
  const w = where(cwd)
  const lane = lanesOf(w).find((l) => basename(l.path) === name)
  if (!lane) throw new Error(`No lane "${name}" under ${w.home}`)
  if (existsSync(lane.path)) {
    const changes = git(lane.path, 'status', '--porcelain')
    if (changes) throw new Error(`Lane "${name}" has changes, left as it is:\n${changes}`)
    // Drop the link first so nothing walks into the main checkout's node_modules.
    const nm = join(lane.path, 'node_modules')
    try {
      if (lstatSync(nm).isSymbolicLink()) unlinkSync(nm)
    } catch {
      // no node_modules
    }
    git(w.main, 'worktree', 'remove', lane.path)
  }
  git(w.main, 'worktree', 'prune')
  const reg = readRegistry(w)
  delete reg[name]
  writeRegistry(w, reg)
  if (existsSync(w.home) && readdirSync(w.home).length === 0) rmdirSync(w.home)
  return { name, path: lane.path, branch: lane.branch }
}

function parseArgs(argv) {
  const [cmd, name, ...rest] = argv
  const o = { cmd, name }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--base') o.base = rest[++i]
    else if (a === '--branch') o.branch = rest[++i]
    else if (a === '--port') o.port = rest[++i]
    else if (a === '--no-install') o.install = false
    else if (a === '--no-link') o.link = false
    else throw new Error(`Unknown argument "${a}"`)
  }
  return o
}

const USAGE = 'Usage: node lane.mjs add <name> [--base <branch>] [--branch <b>] [--port <n>] [--no-install] [--no-link] | remove <name> | list'

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.cmd === 'add' && o.name) {
    const r = await add(o.name, o)
    console.log(`lane ${r.name}: ${r.path} port ${r.port} branch ${r.branch} (deps ${r.deps}, env ${r.env}, db ${r.db})`)
  } else if (o.cmd === 'remove' && o.name) {
    const r = remove(o.name)
    console.log(`lane ${r.name} removed: ${r.path} (branch ${r.branch} kept)`)
  } else if (o.cmd === 'list') {
    const lanes = list()
    console.log(lanes.length ? lanes.map((l) => `${l.name} ${l.path} port ${l.port ?? '?'} branch ${l.branch} ${l.state}`).join('\n') : 'No lanes.')
  } else {
    console.error(USAGE)
    process.exit(1)
  }
}

if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  main().catch((e) => {
    console.error(String(e.stderr || e.message).trim())
    process.exit(1)
  })
}
