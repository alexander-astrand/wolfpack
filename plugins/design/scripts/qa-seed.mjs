#!/usr/bin/env node
// The QA seed and its clean-up from the project's SQL files, with the lane and seed=shared rules
// built in. Kit 1.8 (kit 1.7.1 council Feature 17, design lens Feature 5): each project wrapped its
// own seed, lanes named their rows by hand, and four Bengan Boys each cleaning deleted each other's
// rows (kit 1.6.1 council M4); spidey-sense said what a seed must do, but no script did it.
//
//   node <design>/scripts/qa-seed.mjs up|down <name> [--lane <lane>] [seed=shared] [--dir <seeds>]
//        [--db <url>] [--allow-host <host>] [--dry]
//
// Runs <dir>/<name>.up.sql (or .down.sql) with psql, quietly, stopping at the first error. <dir> is
// scripts/qa/seeds under the current folder. Every {{LANE}} in the SQL becomes the lane name
// ("qa" by default), so a seed marks its rows "TEST QA seed {{LANE}}" and its clean-up deletes only
// that lane's rows (and anything an earlier run of that lane left).
// seed=shared (the order's flag, lanes side by side): a lane (--lane given) neither seeds nor cleans
// and says so; the navigator (no --lane) runs the one seed before it spawns the lanes, and the one
// clean-up after the last lane reports, as lane "shared".
// Dev only: the database is --db, else QA_SEED_DB_URL, else the local Supabase
// (postgresql://postgres:postgres@127.0.0.1:54322/postgres). A host other than localhost is refused
// unless --allow-host names it (a hosted dev project); production is never a QA seed's target.
// --dry prints the SQL and the host instead of running it.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const o = { action: null, name: null, lane: null, shared: false, dir: join(cwd, 'scripts', 'qa', 'seeds'), db: env.QA_SEED_DB_URL || LOCAL_DB, allowHost: null, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--lane') o.lane = argv[++i]
    else if (a === 'seed=shared' || a === '--shared') o.shared = true
    else if (a === '--dir') o.dir = resolve(cwd, argv[++i])
    else if (a === '--db') o.db = argv[++i]
    else if (a === '--allow-host') o.allowHost = argv[++i]
    else if (a === '--dry') o.dry = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`)
    else if (!o.action) o.action = a
    else if (!o.name) o.name = a
    else throw new Error(`unknown argument ${a}`)
  }
  if (o.help) return o
  if (!['up', 'down'].includes(o.action)) throw new Error('first argument is up or down')
  if (!o.name || !/^[\w-]+$/.test(o.name)) throw new Error('the seed name is letters, digits, _ and -')
  if (o.lane !== null && !/^[\w-]+$/.test(o.lane ?? '')) throw new Error('--lane is letters, digits, _ and -')
  return o
}

export function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    throw new Error('the database URL does not parse')
  }
}

// What to do, decided without touching the database, so the rules are tested on their own.
export function plan(o) {
  if (o.shared && o.lane) return { skip: `seed=shared: the navigator seeds and cleans; lane ${o.lane} does neither. Use the ids in your order.` }
  const host = hostOf(o.db)
  if (!LOCAL_HOSTS.has(host) && host !== o.allowHost) throw new Error(`${host} is not a local database; a hosted dev database needs --allow-host ${host}`)
  const file = join(o.dir, `${o.name}.${o.action}.sql`)
  if (!existsSync(file)) throw new Error(`no ${file} (the project keeps its seeds as <name>.up.sql and <name>.down.sql there)`)
  const lane = o.shared ? 'shared' : o.lane || 'qa'
  return { file, host, lane, sql: readFileSync(file, 'utf8').replaceAll('{{LANE}}', lane) }
}

export function run(o, log = console.log, exec = spawnSync) {
  const p = plan(o)
  if (p.skip) {
    log(p.skip)
    return 0
  }
  if (o.dry) {
    log(`-- ${o.action} ${o.name}, lane ${p.lane}, on ${p.host}\n${p.sql}`)
    return 0
  }
  const r = exec('psql', [o.db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: p.sql, encoding: 'utf8' })
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'psql not found: install the Postgres client' : r.error.message)
  if (r.stdout?.trim()) log(r.stdout.trim())
  if (r.status !== 0) {
    log(`${o.action} ${o.name} failed (lane ${p.lane}): ${(r.stderr ?? '').trim()}`)
    return 1
  }
  log(`${o.action} ${o.name}: done, lane ${p.lane}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL((await import('node:fs')).realpathSync(process.argv[1])).href) {
  try {
    const o = parseArgs(process.argv.slice(2))
    if (o.help) {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 21).join('\n'))
      process.exit(0)
    }
    process.exit(run(o))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
}
