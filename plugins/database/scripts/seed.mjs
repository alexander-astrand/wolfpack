#!/usr/bin/env node
// The gale skill's runner for QA seeds on dev: a pair of SQL files the project
// keeps, up and down, run with the Supabase CLI against dev and nothing else.
//
// Usage: node scripts/seed.mjs up <name> [--dry-run] [--root <project>]
//        node scripts/seed.mjs down <name> [--dry-run] [--root <project>]
//        node scripts/seed.mjs list [--root <project>]
//   up / down   runs scripts/qa/seeds/<name>.up.sql or .down.sql as one
//               `supabase db query <flag> -f`; --dry-run prints the target and
//               the SQL and runs nothing
//   list        every seed pair with its last up or down, and every real-mode
//               receipt (written by the skill) with its row count
//   exit 0      done (or listed)
//   exit 1      the CLI failed, or an up with no PASS-like confirmation
//   exit 2      usage, a missing file, or it can't tell that the target is dev
//
// What it insists on, so a seed can always be taken out again:
// - an up never runs without its down file beside it;
// - every row an up writes carries the tag `TEST QA seed gale:<name>` in its
//   label, and the down file deletes by that same tag: both files must name
//   it, or nothing runs. The down may delete nothing else.
// - dev only, one check for both runners (devTarget below): the flag comes
//   from run-tests.mjs's target(), which refuses a CLI linked to production
//   or an unknown target. A database URL (only the design plugin's
//   qa-seed.mjs passes one, from --db or QA_SEED_DB_URL) goes to the CLI as
//   --db-url, and only when every host it can reach is local or allowed.
// The design plugin's qa-seed.mjs is a thin wrapper over run(): it adds the
// lane ({{LANE}} in the SQL) and seed=shared. Kit 1.9 folded the two runners
// into this one after they drifted (PR #46's notes for review).
// Each up and down is logged to <state>/<project>/qa.log, one line each, so
// `list` can say what is still up. <state> is GALE_STATE_DIR, else
// ~/.local/state/wolfpack/gale. The project is kit.json project.name, else
// the folder's name. The root is --root, else CLAUDE_PROJECT_DIR, else cwd.
// RUN_TESTS_SUPABASE names the CLI binary (the tests point it at a fake).

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { target } from './run-tests.mjs'

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const SEEDS = join('scripts', 'qa', 'seeds')
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

export const tagFor = (name) => `TEST QA seed gale:${name}`
// A lane seed's tag: qa-seed.mjs fills {{LANE}} with the lane's name, so each
// lane's down deletes only that lane's rows (kit 1.6.1 council M4).
export const LANE_TAG = 'TEST QA seed {{LANE}}'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    throw new Error('the database URL does not parse')
  }
}

// Every server the URL can reach. libpq lets the query override the URL's
// host: `?host=`, `?hostaddr=` (each may list several, comma-separated) and
// `?service=` (a pg_service.conf entry, unknown from here), so
// `postgresql://localhost/db?host=prod.example.co` is a remote database that
// reads as local by its hostname alone (kit 1.8 review MUST 4). A service is
// named `service=<name>`, so only `allowHost: 'service=<name>'` lets it through.
export function targetsOf(url) {
  const host = hostOf(url)
  const q = new URL(url).searchParams
  const out = [host]
  for (const key of ['host', 'hostaddr']) for (const v of q.getAll(key)) out.push(...v.split(','))
  for (const v of q.getAll('service')) out.push(`service=${v}`)
  return out.map((h) => h.trim())
}

/**
 * The one dev-only check for both runners: `{ args, label }` for the CLI, or
 * `{ error }`. Without a URL it is run-tests.mjs's target(); with one, every
 * host the URL can reach must be local or the one `allowHost` names (a hosted
 * dev project). `label` is one word with no password in it, for the log.
 */
export function devTarget(root, { db = null, allowHost = null, pick = target } = {}) {
  if (!db) {
    const t = pick(root)
    return t.error ? t : { args: [t.flag], label: t.flag }
  }
  let hosts
  try {
    hosts = targetsOf(db)
  } catch (e) {
    return { error: e.message }
  }
  for (const h of hosts) if (!LOCAL_HOSTS.has(h) && h !== allowHost) return { error: `${h} is not a local database; a hosted dev database needs --allow-host ${h}` }
  return { args: ['--db-url', db], label: `db-url:${hosts[0]}` }
}

export function parseArgs(argv) {
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  let dryRun = false
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (!argv[i + 1]) return { error: '--root needs a folder' }
      root = argv[++i]
    } else if (argv[i] === '--dry-run') dryRun = true
    else rest.push(argv[i])
  }
  const [cmd, name, extra] = rest
  if (extra !== undefined || !['up', 'down', 'list'].includes(cmd)) return { error: 'usage: seed.mjs up|down <name> [--dry-run] | list  [--root <project>]' }
  if (cmd === 'list') {
    if (name !== undefined) return { error: 'list takes no name' }
  } else if (!name || !NAME_RE.test(name)) return { error: 'a seed name is lower-case letters, digits and dashes, e.g. groceries-full' }
  return { cmd, name: name ?? null, dryRun, root: resolve(root) }
}

export function stateDir() {
  return process.env.GALE_STATE_DIR || join(homedir(), '.local', 'state', 'wolfpack', 'gale')
}

export function projectName(root) {
  try {
    const kit = JSON.parse(read(join(root, '.claude', 'kit.json')) || 'null')
    if (kit?.project?.name) return String(kit.project.name)
  } catch {}
  return basename(root)
}

/** Both files, read and checked for the tag; `{ error }` when the pair isn't fit to run. */
export function pair(root, name) {
  const dir = join(root, SEEDS)
  const upPath = join(dir, `${name}.up.sql`)
  const downPath = join(dir, `${name}.down.sql`)
  if (!existsSync(upPath)) return { error: `no ${SEEDS}/${name}.up.sql` }
  if (!existsSync(downPath)) return { error: `no ${SEEDS}/${name}.down.sql: an up never runs without its down` }
  const up = readFileSync(upPath, 'utf8')
  const down = readFileSync(downPath, 'utf8')
  // gale's own tag, or a lane seed's: whichever the up writes, the down must name.
  const tag = [tagFor(name), LANE_TAG].find((t) => up.includes(t)) ?? tagFor(name)
  if (!up.includes(tag)) return { error: `${name}.up.sql never writes the tag "${tag}" (or "${LANE_TAG}"), so the down could not find its rows` }
  if (!down.includes(tag)) return { error: `${name}.down.sql never names the tag "${tag}", so it would not delete this seed's rows` }
  if (/\b(drop|truncate|alter)\b/i.test(down)) return { error: `${name}.down.sql drops, truncates or alters: a down only deletes the tagged rows` }
  if (/\b(delete|drop|truncate|alter)\b/i.test(up)) return { error: `${name}.up.sql deletes, drops, truncates or alters: an up only adds` }
  return { up, down, upPath, downPath, tag }
}

function logLine(root, line) {
  const dir = join(stateDir(), projectName(root))
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'qa.log'), line + '\n')
}

/**
 * Runs one side of the pair; the CLI's text is the result, as run-tests reads it.
 * `target` is devTarget()'s answer (`flag` alone still works for one CLI flag).
 * `lane` fills {{LANE}} (qa-seed.mjs; "qa" when the SQL has one and no lane is
 * given). `exec` is spawnSync, swapped in tests.
 */
export function run({ root, cmd, name, dryRun, flag, target: t = { args: [flag], label: flag }, lane = null, bin = 'supabase', exec = spawnSync }) {
  const p = pair(root, name)
  if (p.error) return { code: 2, lines: [`seed: refused, nothing ran: ${p.error}`] }
  const sql = (cmd === 'up' ? p.up : p.down).replaceAll('{{LANE}}', lane || 'qa')
  const at = `on dev (${t.label})${lane ? `, lane ${lane}` : ''}`
  const undo = lane ? `qa-seed.mjs down ${name} --lane ${lane}` : `seed.mjs down ${name}`
  if (dryRun) return { code: 0, lines: [`seed: ${cmd} ${name} would run ${at} as one supabase db query; the SQL:`, '', sql.trimEnd()] }
  const scratch = mkdtempSync(join(tmpdir(), 'gale-seed-'))
  try {
    const copy = join(scratch, `${name}.${cmd}.sql`)
    writeFileSync(copy, sql)
    const r = exec(bin, ['db', 'query', ...t.args, '-f', copy], { cwd: root, encoding: 'utf8' })
    if (r.error) return { code: 1, lines: [`seed: could not start ${bin}: ${r.error.code || r.error.message}`] }
    const out = ((r.stdout || '') + (r.stderr || '')).trim()
    const failed = r.status !== 0 || /\bERROR\b/.test(out)
    logLine(root, `${new Date().toISOString()} ${cmd} ${name} ${t.label} ${failed ? 'failed' : 'ok'}`)
    const lines = out ? out.split('\n') : []
    lines.push(failed ? `seed: ${cmd} ${name} failed ${at}` : `seed: ${cmd} ${name} done ${at}; undo with ${undo}`)
    return { code: failed ? 1 : 0, lines }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Every pair in the project with its last logged action, and every receipt. */
export function list(root) {
  const dir = join(root, SEEDS)
  const files = existsSync(dir) ? readdirSync(dir) : []
  const names = [...new Set(files.filter((f) => /\.(up|down)\.sql$/.test(f)).map((f) => f.replace(/\.(up|down)\.sql$/, '')))].sort()
  const state = join(stateDir(), projectName(root))
  const log = read(join(state, 'qa.log')).trim().split('\n').filter(Boolean)
  const last = {}
  for (const l of log) {
    const [at, cmd, name, , status] = l.split(' ')
    last[name] = { at, cmd, status }
  }
  const lines = []
  if (!names.length) lines.push(`no seeds in ${SEEDS}`)
  for (const n of names) {
    const whole = files.includes(`${n}.up.sql`) && files.includes(`${n}.down.sql`)
    const l = last[n]
    const was = l ? `last ${l.cmd} ${l.at} (${l.status})` : 'never run'
    lines.push(`${n}: ${whole ? was : 'missing its ' + (files.includes(`${n}.up.sql`) ? 'down' : 'up') + ' file'}`)
  }
  const receipts = existsSync(state) ? readdirSync(state).filter((f) => f.endsWith('.json')).sort() : []
  if (!receipts.length) lines.push('no real-mode receipts')
  for (const f of receipts) {
    let r = null
    try {
      r = JSON.parse(readFileSync(join(state, f), 'utf8'))
    } catch {}
    const n = Array.isArray(r?.rows) ? r.rows.length : '?'
    lines.push(`receipt ${f.replace(/\.json$/, '')}: ${n} rows${r?.undone_at ? `, undone ${r.undone_at}` : ''}`)
  }
  return { code: 0, lines }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    process.stderr.write(`seed: ${args.error}\n`)
    process.exit(2)
  }
  let out
  if (args.cmd === 'list') out = list(args.root)
  else {
    const t = devTarget(args.root)
    if (t.error) {
      process.stderr.write(`seed: refused, nothing ran: ${t.error}\n`)
      process.exit(2)
    }
    out = run({ ...args, target: t, bin: process.env.RUN_TESTS_SUPABASE || 'supabase' })
  }
  console.log(out.lines.join('\n'))
  process.exit(out.code)
}
