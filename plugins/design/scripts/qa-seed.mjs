#!/usr/bin/env node
// The QA seed for a lane: a thin wrapper over the database plugin's seed.mjs (the gale runner),
// which adds only the lane and seed=shared. Kit 1.8 built this as a second runner; kit 1.9 folded
// it into seed.mjs after the two drifted (PR #46's notes for review), so the pair check, the
// dev-only target and the log are seed.mjs's, tested there once.
//
//   node <design>/scripts/qa-seed.mjs up|down <name> [--lane <lane>] [seed=shared] [--root <project>]
//        [--db <url>] [--allow-host <host>] [--dry]
//
// Runs <root>/scripts/qa/seeds/<name>.up.sql (or .down.sql) as one `supabase db query`, through
// seed.mjs: an up never runs without its down, and both name the same tag. Every {{LANE}} in the
// SQL becomes the lane name ("qa" by default), so a seed marks its rows "TEST QA seed {{LANE}}"
// and its clean-up deletes only that lane's rows (and anything an earlier run of that lane left).
// seed=shared (the order's flag, lanes side by side): a lane (--lane given) neither seeds nor cleans
// and says so; the navigator (no --lane) runs the one seed before it spawns the lanes, and the one
// clean-up after the last lane reports, as lane "shared".
// Dev only, seed.mjs's devTarget(): without --db (or QA_SEED_DB_URL) dev is picked the way
// run-tests.mjs does (a local stack, or the CLI linked to refs.dev). A URL whose host, or whose
// ?host=, ?hostaddr= or ?service=, is not local is refused unless --allow-host names it; one naming
// refs.prod, or a *.pooler.supabase.com one whose user isn't postgres.<refs.dev>, always is.
// --dry prints the target and the SQL and runs nothing.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NEEDS_DB = 'qa-seed: the database plugin is needed (its scripts/seed.mjs runs every seed); install it beside the design plugin'

// Where the database plugin's seed.mjs sits. A static import of the sibling path broke a marketplace
// install, where each plugin lives in <cache>/<marketplace>/<plugin>/<version>/ and even --help died
// with ERR_MODULE_NOT_FOUND (kit 1.9 review R1-5). So: the sibling first (the repo, and
// ~/wolfpack-live/plugins/* side by side), then the highest version folder beside ours, else null.
export function seedPath(here = HERE) {
  const sibling = join(here, '..', '..', 'database', 'scripts', 'seed.mjs')
  if (existsSync(sibling)) return sibling
  const versions = join(here, '..', '..', '..', 'database')
  if (!existsSync(versions)) return null
  const found = readdirSync(versions)
    .filter((v) => existsSync(join(versions, v, 'scripts', 'seed.mjs')))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  return found.length ? join(versions, found[0], 'scripts', 'seed.mjs') : null
}

const isMain = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
const found = seedPath()
if (!found) {
  if (isMain) {
    console.error(NEEDS_DB)
    process.exit(1)
  }
  throw new Error(NEEDS_DB)
}
const { devTarget, run: seedRun } = await import(pathToFileURL(found).href)

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const o = { action: null, name: null, lane: null, shared: false, root: resolve(cwd, env.CLAUDE_PROJECT_DIR || '.'), db: env.QA_SEED_DB_URL || null, allowHost: null, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--lane') o.lane = argv[++i]
    else if (a === 'seed=shared' || a === '--shared') o.shared = true
    else if (a === '--root') o.root = resolve(cwd, argv[++i] ?? '')
    else if (a === '--db') o.db = argv[++i]
    else if (a === '--allow-host') o.allowHost = argv[++i]
    else if (a === '--dry' || a === '--dry-run') o.dry = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`)
    else if (!o.action) o.action = a
    else if (!o.name) o.name = a
    else throw new Error(`unknown argument ${a}`)
  }
  if (o.help) return o
  if (!['up', 'down'].includes(o.action)) throw new Error('first argument is up or down')
  if (!o.name || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(o.name)) throw new Error('the seed name is lower-case letters, digits and dashes')
  if (o.lane !== null && !/^[\w-]+$/.test(o.lane ?? '')) throw new Error('--lane is letters, digits, _ and -')
  return o
}

// The lane rules alone, decided before anything touches the database.
export function laneOf(o) {
  if (o.shared && o.lane) return { skip: `seed=shared: the navigator seeds and cleans; lane ${o.lane} does neither. Use the ids in your order.` }
  return { lane: o.shared ? 'shared' : o.lane || 'qa' }
}

export function run(o, log = console.log, { exec, bin = process.env.RUN_TESTS_SUPABASE || 'supabase', pick } = {}) {
  const l = laneOf(o)
  if (l.skip) {
    log(l.skip)
    return 0
  }
  const t = devTarget(o.root, { db: o.db, allowHost: o.allowHost, ...(pick ? { pick } : {}) })
  if (t.error) {
    log(`seed: refused, nothing ran: ${t.error}`)
    return 2
  }
  const out = seedRun({ root: o.root, cmd: o.action, name: o.name, dryRun: o.dry, target: t, lane: l.lane, bin, ...(exec ? { exec } : {}) })
  for (const line of out.lines) log(line)
  return out.code
}

if (isMain) {
  try {
    const o = parseArgs(process.argv.slice(2))
    if (o.help) {
      // The header comment, however long it grows.
      const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1)
      console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).join('\n'))
      process.exit(0)
    }
    process.exit(run(o))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
}
