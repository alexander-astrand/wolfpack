#!/usr/bin/env node
// The playbook's proof for an edited migration, as one script (kit 1.10, F9,
// from Burrow's scripts/db-rerun.mjs). Local stack only.
//
// Usage: node db-rerun.mjs <command> [options]
//   undo <migration...> [--out <dir|file>]
//        writes the undo file: each statement of the migration reversed, last
//        first (drop what it created, an earlier migration's text for what it
//        replaced, revoke for grant). What it can't reverse (data changes,
//        alters it doesn't know) is a `-- TODO by hand` line. Into --out, else
//        <tmpdir>/db-rerun/undo-<name>.sql. Nothing runs on any database.
//   apply <migration> [--undo <file>]
//        runs the migration again on the local stack in one transaction, after
//        the undo file when given (so it needs no "if not exists" spelling).
//        The migration history is not touched. Refuses an undo file that
//        still has TODO lines.
//   proof [--no-seed]
//        rebuilds from scratch: in one transaction that always ends in
//        ROLLBACK, drops public (and every schema the migrations create),
//        applies every migration in order, then the seeds. Prints
//        `PROOF OK <n> migrations` or the file and line that broke. Nothing
//        is kept, whichever way it ends.
//   --dry-run   prints what it would run (target, files, the SQL's size) and stops
//   --help
//
// Options (each also read from the project's .claude/kit.json `database`):
//   --root <dir>        the project: --root, else CLAUDE_PROJECT_DIR, else cwd
//   --migrations <dir>  database.migrations, default supabase/migrations
//   --seed <file>       database.seeds (a file or a list), default supabase/seed.sql when it exists
//   --db-url <url>      database.localUrl, default postgresql://postgres:postgres@127.0.0.1:<port>/postgres
//                       (port from supabase/config.toml [db], else 54322)
//   --via psql|docker   psql on this machine (default), or psql inside the local
//                       stack's container supabase_db_<project_id> (supabase/config.toml)
//   --reset <file>      database.reset: the SQL that empties the schema before proof,
//                       for a project whose migrations touch more than public
//
// Local only: every host the URL can reach (its host, any ?host= or
// ?hostaddr=, a ?service= counts as unknown) must be localhost, 127.0.0.1 or
// ::1, or it refuses with exit 2 before running anything. A migration with its
// own BEGIN, COMMIT or ROLLBACK is refused too: inside proof its COMMIT would
// keep the dropped schema. Exit 0 done, 1 the SQL failed (rolled back), 2
// refused or usage.
//
// Why: the playbook proved an edited, unmerged migration by hand ("apply the
// same statements to dev by hand, re-run the release's migrations from scratch
// in a rolled-back transaction"), and a step that applied a migration a later
// step edits left no undo file (lesson #75). The proof's reset drops public
// with CASCADE inside the transaction; a storage or cron object that survives
// it and a migration recreates fails the proof as "already exists": give that
// project a --reset file.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { targetsOf } from './seed.mjs'

const USAGE = `usage: node db-rerun.mjs undo <migration...> [--out <dir|file>]
       node db-rerun.mjs apply <migration> [--undo <file>]
       node db-rerun.mjs proof [--no-seed]
  options: --root <dir> --migrations <dir> --seed <file> --db-url <url>
           --via psql|docker --reset <file> --dry-run --help
  Local stack only (127.0.0.1, localhost or ::1); proof always rolls back.`

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
// Schemas a Supabase stack owns: proof never drops these, even when a migration
// says `create schema if not exists` for one of them.
const STACK_SCHEMAS = new Set(['public', 'auth', 'storage', 'extensions', 'realtime', 'graphql', 'graphql_public', 'vault', 'cron', 'net', 'pgsodium', 'pgsodium_masks', 'supabase_functions', 'supabase_migrations', '_realtime', 'pgbouncer', 'information_schema', 'pg_catalog'])

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export class Refusal extends Error {}

export function parseArgs(argv) {
  const o = { cmd: null, files: [], root: process.env.CLAUDE_PROJECT_DIR || process.cwd(), dryRun: false, seed: true, help: false }
  const need = (i, flag) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new Refusal(`${flag} needs a value`)
    return argv[i]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--no-seed') o.seed = false
    else if (a === '--root') o.root = need(++i, a)
    else if (a === '--migrations') o.migrations = need(++i, a)
    else if (a === '--seed') o.seeds = [need(++i, a)]
    else if (a === '--db-url') o.dbUrl = need(++i, a)
    else if (a === '--via') o.via = need(++i, a)
    else if (a === '--reset') o.reset = need(++i, a)
    else if (a === '--out') o.out = need(++i, a)
    else if (a === '--undo') o.undo = need(++i, a)
    else if (a.startsWith('--')) throw new Refusal(`unknown option ${a}`)
    else if (!o.cmd) o.cmd = a
    else o.files.push(a)
  }
  if (o.help) return o
  if (!['undo', 'apply', 'proof'].includes(o.cmd)) throw new Refusal(o.cmd ? `unknown command ${o.cmd}` : 'no command')
  if (o.cmd === 'undo' && !o.files.length) throw new Refusal('undo needs a migration')
  if (o.cmd === 'apply' && o.files.length !== 1) throw new Refusal('apply takes one migration')
  if (o.cmd === 'proof' && o.files.length) throw new Refusal('proof takes no files: it runs every migration')
  if (o.via && !['psql', 'docker'].includes(o.via)) throw new Refusal('--via is psql or docker')
  return o
}

/** kit.json's `database` block, or {} (a missing or broken kit.json is the default layout). */
export function kitDatabase(root) {
  try {
    const db = JSON.parse(read(join(root, '.claude', 'kit.json')) || 'null')?.database
    return db && typeof db === 'object' ? db : {}
  } catch {
    return {}
  }
}

function tomlValue(text, section, key) {
  let cur = ''
  for (const line of text.split('\n')) {
    const s = /^\s*\[([^\]]+)\]/.exec(line)
    if (s) cur = s[1].trim()
    else if (cur === section) {
      const m = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\s#]+)"?`).exec(line)
      if (m) return m[1]
    }
  }
  return null
}

/** Every path and name the run needs, from flags, then kit.json, then the Supabase layout. */
export function resolveConfig(o) {
  const root = resolve(o.root)
  const db = kitDatabase(root)
  const at = (p) => (isAbsolute(p) ? p : join(root, p))
  const config = read(join(root, 'supabase', 'config.toml'))
  const port = tomlValue(config, 'db', 'port') || '54322'
  const seedList = o.seeds ?? (Array.isArray(db.seeds) ? db.seeds : typeof db.seeds === 'string' ? [db.seeds] : null)
  return {
    root,
    migrations: at(o.migrations || db.migrations || 'supabase/migrations'),
    seeds: (seedList ?? ['supabase/seed.sql']).map(at).filter((p) => seedList || existsSync(p)),
    dbUrl: o.dbUrl || db.localUrl || `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    via: o.via || db.via || 'psql',
    reset: o.reset || db.reset ? at(o.reset || db.reset) : null,
    container: tomlValue(`[top]\n${config}`, 'top', 'project_id'),
  }
}

/** Throws a Refusal unless every host the URL can reach is this machine. */
export function assertLocal(url) {
  let hosts
  try {
    hosts = targetsOf(url)
  } catch {
    throw new Refusal('the database URL does not parse')
  }
  const far = hosts.filter((h) => !LOCAL_HOSTS.has(h))
  if (far.length) throw new Refusal(`refused: ${far.map((h) => h || '(no host)').join(', ')} is not the local stack. db-rerun runs only on 127.0.0.1, localhost or ::1; dev and production are never its target`)
}

/** The migration files in order (name order, as supabase applies them). */
export function migrationFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Refusal(`no migrations folder ${dir}`)
  return readdirSync(dir).filter((n) => n.endsWith('.sql')).sort().map((n) => join(dir, n))
}

/** A path, or a name in the migrations folder. */
export function findMigration(cfg, arg) {
  const hit = [resolve(arg), join(cfg.migrations, arg), join(cfg.migrations, `${arg}.sql`)].find((p) => existsSync(p) && p.endsWith('.sql'))
  if (hit) return hit
  const byPrefix = existsSync(cfg.migrations) ? migrationFiles(cfg.migrations).filter((p) => basename(p).startsWith(arg)) : []
  if (byPrefix.length === 1) return byPrefix[0]
  throw new Refusal(byPrefix.length > 1 ? `"${arg}" names ${byPrefix.length} migrations` : `no migration "${arg}" (a path, or a name in ${cfg.migrations})`)
}

// ---------------------------------------------------------------- SQL reading

/**
 * Splits SQL into statements, honouring -- and block comments, '...' and E'...'
 * strings, "..." names and $tag$ bodies. Each: { text } as written (comments
 * kept), { bare } with comments gone and whitespace collapsed, { line } where it starts,
 * and { meta } the line of the first backslash outside strings, names, bodies and
 * comments (psql reads that as a meta-command such as \c or \!; SQL itself has none).
 */
export function splitSql(sql) {
  const out = []
  let i = 0
  let start = 0
  let bare = ''
  let firstLine = null
  let metaLine = null
  let line = 1
  const push = (end) => {
    const text = sql.slice(start, end).trim()
    const b = bare.replace(/\s+/g, ' ').trim()
    if (b) out.push({ text, bare: b, line: firstLine, ...(metaLine !== null ? { meta: metaLine } : {}) })
    bare = ''
    firstLine = null
    metaLine = null
  }
  const mark = () => {
    if (firstLine === null) firstLine = line
  }
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (c === '\n') {
      line++
      bare += ' '
      i++
    } else if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end < 0 ? sql.length : end + 2
      line += (sql.slice(i, stop).match(/\n/g) || []).length
      bare += ' '
      i = stop
    } else if (c === "'" || c === '"') {
      mark()
      const escapes = c === "'" && /[eE]$/.test(sql.slice(start, i)) && !/[\w$][eE]$/.test(sql.slice(Math.max(start, i - 2), i))
      let j = i + 1
      for (;;) {
        if (j >= sql.length) break
        if (escapes && sql[j] === '\\') j += 2
        else if (sql[j] === c && sql[j + 1] === c) j += 2
        else if (sql[j] === c) break
        else j++
      }
      const piece = sql.slice(i, j + 1)
      line += (piece.match(/\n/g) || []).length
      bare += piece
      i = j + 1
    } else if (c === '$' && /^\$([A-Za-z_]\w*)?\$/.test(sql.slice(i)) && !/[\w$]/.test(sql[i - 1] || '')) {
      mark()
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i))[0]
      const end = sql.indexOf(tag, i + tag.length)
      const stop = end < 0 ? sql.length : end + tag.length
      const piece = sql.slice(i, stop)
      line += (piece.match(/\n/g) || []).length
      bare += piece
      i = stop
    } else if (c === ';') {
      push(i)
      start = i + 1
      i++
    } else {
      if (!/\s/.test(c)) mark()
      if (c === '\\' && metaLine === null) metaLine = line
      bare += c
      i++
    }
  }
  push(sql.length)
  return out
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`

/** `public.x` for x, lower-cased unless quoted. */
export function normName(q) {
  const parts = q.match(new RegExp(IDENT, 'g')).map((p) => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase()))
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.')
}

/** The text between the parenthesis at `open` and its match. */
function inParens(s, open) {
  let depth = 0
  for (let j = open; j < s.length; j++) {
    if (s[j] === '(') depth++
    else if (s[j] === ')' && --depth === 0) return s.slice(open + 1, j)
  }
  return null
}

function topLevelSplit(s, sep = ',') {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** A function's arguments as DROP FUNCTION takes them: defaults cut off. */
export function dropArgs(args) {
  return topLevelSplit(args)
    .map((a) => a.replace(/\s+default\s+[\s\S]*$/i, '').replace(/\s*=\s*[\s\S]*$/, '').trim())
    .join(', ')
}

const TX_CONTROL = /^(begin|commit|rollback|end|abort|start\s+transaction|savepoint|release)\b/i

/**
 * What one statement creates, drops or changes, as { kind, key, ... }:
 * the key names the object across migrations (function by name, policy and
 * trigger by table and name). null for a statement it does not know.
 */
export function classify(bare) {
  const s = bare
  let m
  if ((m = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(function|procedure)\s+(${QNAME})\s*\(`, 'i').exec(s))) {
    const args = inParens(s, m[0].length - 1) ?? ''
    const kind = m[1].toLowerCase()
    return { op: 'create', kind, key: `function:${normName(m[2])}`, name: m[2], args: dropArgs(args), sig: dropArgs(args).toLowerCase().replace(/\s+/g, ' ') }
  }
  if ((m = new RegExp(String.raw`^drop\s+(function|procedure)\s+(?:if\s+exists\s+)?(${QNAME})`, 'i').exec(s))) return { op: 'drop', kind: m[1].toLowerCase(), key: `function:${normName(m[2])}` }
  if ((m = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(materialized\s+view|view)\s+(?:if\s+not\s+exists\s+)?(${QNAME})`, 'i').exec(s))) {
    const kind = m[1].toLowerCase().replace(/\s+/g, ' ')
    return { op: 'create', kind, key: `view:${normName(m[2])}`, name: m[2] }
  }
  if ((m = new RegExp(String.raw`^drop\s+(materialized\s+view|view)\s+(?:if\s+exists\s+)?(${QNAME})`, 'i').exec(s))) return { op: 'drop', kind: 'view', key: `view:${normName(m[2])}` }
  if ((m = new RegExp(String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QNAME})`, 'i').exec(s))) return { op: 'create', kind: 'table', key: `table:${normName(m[1])}`, name: m[1] }
  if ((m = new RegExp(String.raw`^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})\s+on\s+(?:only\s+)?(${QNAME})`, 'i').exec(s))) {
    // An index lives in its table's schema.
    const schema = normName(m[2]).split('.')[0]
    const qualified = m[2].includes('.')
    return { op: 'create', kind: 'index', key: `index:${schema}.${normName(m[1]).split('.')[1]}`, name: `${qualified ? `${m[2].split('.')[0].trim()}.` : ''}${m[1]}` }
  }
  if ((m = new RegExp(String.raw`^create\s+policy\s+(${IDENT})\s+on\s+(${QNAME})`, 'i').exec(s))) return { op: 'create', kind: 'policy', key: `policy:${normName(m[2])}:${normName(m[1])}`, name: m[1], on: m[2] }
  if ((m = new RegExp(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QNAME})`, 'i').exec(s))) return { op: 'drop', kind: 'policy', key: `policy:${normName(m[2])}:${normName(m[1])}` }
  if ((m = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(${IDENT})\s[\s\S]*?\bon\s+(${QNAME})`, 'i').exec(s))) return { op: 'create', kind: 'trigger', key: `trigger:${normName(m[2])}:${normName(m[1])}`, name: m[1], on: m[2] }
  if ((m = new RegExp(String.raw`^drop\s+trigger\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QNAME})`, 'i').exec(s))) return { op: 'drop', kind: 'trigger', key: `trigger:${normName(m[2])}:${normName(m[1])}` }
  if ((m = new RegExp(String.raw`^create\s+(type|domain|sequence)\s+(?:if\s+not\s+exists\s+)?(${QNAME})`, 'i').exec(s))) return { op: 'create', kind: m[1].toLowerCase(), key: `${m[1].toLowerCase()}:${normName(m[2])}`, name: m[2] }
  if ((m = new RegExp(String.raw`^create\s+schema\s+(if\s+not\s+exists\s+)?(${IDENT})`, 'i').exec(s))) return { op: 'create', kind: 'schema', key: `schema:${normName(m[2]).split('.')[1]}`, name: m[2], idempotent: !!m[1] }
  return null
}

/** The inverse of `alter table T <actions>`, or null when one action has none. */
function invertAlterTable(bare) {
  const m = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+([\s\S]+)$`, 'i').exec(bare)
  if (!m) return null
  const back = []
  for (const act of topLevelSplit(m[2])) {
    let a
    if ((a = new RegExp(String.raw`^add\s+constraint\s+(${IDENT})`, 'i').exec(act))) back.push(`drop constraint if exists ${a[1]}`)
    else if (/^add\s+(primary|unique|check|foreign|exclude)\b/i.test(act)) return null
    else if ((a = new RegExp(String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})`, 'i').exec(act))) back.push(`drop column if exists ${a[1]}`)
    else if ((a = new RegExp(String.raw`^alter\s+(?:column\s+)?(${IDENT})\s+(set|drop)\s+not\s+null$`, 'i').exec(act))) back.push(`alter column ${a[1]} ${a[2].toLowerCase() === 'set' ? 'drop' : 'set'} not null`)
    else if (/^enable\s+row\s+level\s+security$/i.test(act)) back.push('disable row level security')
    else if (/^force\s+row\s+level\s+security$/i.test(act)) back.push('no force row level security')
    else return null
  }
  return `alter table ${m[1]} ${back.reverse().join(', ')};`
}

/** grant <-> revoke, for object privileges and role grants alike. */
function invertGrant(bare) {
  if (/^grant\s/i.test(bare)) {
    const body = bare.replace(/^grant\s+/i, '').replace(/\s+with\s+(grant|admin)\s+option\s*$/i, '')
    const at = body.toLowerCase().lastIndexOf(' to ')
    return at < 0 ? null : `revoke ${body.slice(0, at)} from ${body.slice(at + 4)};`
  }
  if (/^revoke\s/i.test(bare)) {
    const body = bare.replace(/^revoke\s+(grant\s+option\s+for\s+)?/i, '').replace(/\s+(cascade|restrict)\s*$/i, '')
    const at = body.toLowerCase().lastIndexOf(' from ')
    return at < 0 ? null : `grant ${body.slice(0, at)} to ${body.slice(at + 6)};`
  }
  return null
}

const KEPT = /^(comment\s+on|set\s|reset\s|notify\s|select\s+pg_notify\s*\(|create\s+extension\s+if\s+not\s+exists|analyze\b)/i
const DATA = /^(insert|update|delete|truncate|copy|merge|with|select)\b/i

function dropFor(c) {
  switch (c.kind) {
    case 'function':
    case 'procedure':
      return `drop ${c.kind} if exists ${c.name}(${c.args});`
    case 'view':
    case 'materialized view':
      return `drop ${c.kind} if exists ${c.name} cascade;`
    case 'table':
    case 'type':
    case 'domain':
    case 'sequence':
      return `drop ${c.kind} if exists ${c.name} cascade;`
    case 'index':
      return `drop index if exists ${c.name};`
    case 'policy':
    case 'trigger':
      return `drop ${c.kind} if exists ${c.name} on ${c.on};`
    case 'schema':
      return `drop schema if exists ${c.name} cascade;`
  }
  return null
}

/**
 * The undo for one migration: `{ text, undone, todo }`. `earlier` is the text
 * of every migration before it, in order, for what it replaces or drops.
 */
export function buildUndo(file, sql, earlier = [], { now = new Date(), rel = basename(file) } = {}) {
  // The latest earlier statement creating each key.
  const before = new Map()
  for (const { sql: text } of earlier) {
    for (const st of splitSql(text)) {
      const c = classify(st.bare)
      if (c?.op === 'create') before.set(c.key, { st, c })
      if (c?.op === 'drop') before.delete(c.key)
    }
  }
  const statements = splitSql(sql)
  const droppedHere = new Set()
  const entries = []
  let undone = 0
  let todo = 0
  for (const st of statements) {
    const where = `${basename(file)}:${st.line}`
    const head = st.bare.length > 70 ? `${st.bare.slice(0, 70)}...` : st.bare
    const c = classify(st.bare)
    let body = null
    let reason = null
    if (c?.op === 'create') {
      const prior = before.get(c.key)
      if (c.kind === 'schema' && c.idempotent) body = `-- kept: ${head}`
      else if (prior && !droppedHere.has(c.key) && ['function', 'procedure', 'view', 'materialized view', 'trigger', 'policy'].includes(c.kind)) {
        // A changed signature leaves the new overload behind, and a plain
        // `create` (policy, trigger, view) collides with the new one: drop it first.
        const sigChanged = (c.kind === 'function' || c.kind === 'procedure') && prior.c.sig !== c.sig
        const needsDrop = sigChanged || !/^create\s+or\s+replace\b/i.test(prior.st.bare)
        body = `${needsDrop ? `${dropFor(c)}\n` : ''}${prior.st.text};`
      } else body = dropFor(c)
    } else if (c?.op === 'drop') {
      droppedHere.add(c.key)
      const prior = before.get(c.key)
      if (prior) body = `${prior.st.text};`
      else reason = 'drops something no earlier migration creates'
    } else if (TX_CONTROL.test(st.bare)) reason = 'transaction control'
    else if (KEPT.test(st.bare)) body = `-- kept: ${head}`
    else if (/^(grant|revoke)\s/i.test(st.bare)) body = invertGrant(st.bare)
    else if (/^alter\s+table\s/i.test(st.bare)) {
      body = invertAlterTable(st.bare)
      if (!body) reason = 'an alter table action with no plain inverse'
    } else if (/^do\b/i.test(st.bare)) reason = 'a DO block'
    else if (DATA.test(st.bare)) reason = 'changes data'
    else reason = 'not a statement db-rerun knows'
    if (!body && !reason) reason = 'no inverse'
    if (body?.startsWith('-- kept')) entries.push(body)
    else if (body) {
      undone++
      entries.push(`-- ${where}  ${head}\n${body}`)
    } else {
      todo++
      entries.push(`-- TODO by hand (${reason}): ${where}  ${head}`)
    }
  }
  const hash = createHash('sha256').update(sql).digest('hex').slice(0, 12)
  const header = [
    `-- db-rerun undo for ${basename(file)}`,
    `-- from ${rel}, sha256 ${hash}, written ${now.toISOString()}`,
    `-- Reverses the migration, last statement first. Run it with:`,
    `--   node db-rerun.mjs apply ${basename(file)} --undo <this file>`,
    `-- ${undone} statements undone, ${todo} TODO by hand.`,
    '',
  ]
  return { text: `${header.join('\n')}\n${entries.reverse().join('\n\n')}\n`, undone, todo }
}

/** Refuses a migration that commits or ends the transaction db-rerun wraps it in. */
export function assertNoTxControl(file, sql) {
  const hit = splitSql(sql).find((st) => TX_CONTROL.test(st.bare))
  if (hit) throw new Refusal(`${basename(file)}:${hit.line} has its own ${hit.bare.split(' ')[0].toUpperCase()}: db-rerun wraps every run in one transaction, so it refuses (inside proof a COMMIT would keep the reset)`)
  assertNoMeta(file, sql)
}

/**
 * Refuses a file with a psql meta-command (`\c <url>`, `\! <shell>`, `\i`): the
 * files go to psql on stdin, so one would leave the local stack (and the guard's
 * psql ask) behind. Checked for every file before anything runs (R1 S1).
 */
export function assertNoMeta(file, sql) {
  const hit = splitSql(sql).find((st) => st.meta !== undefined)
  if (hit) throw new Refusal(`${basename(file)}:${hit.meta} has a psql backslash command: db-rerun sends plain SQL only (a \\c or \\! would leave the local stack), so it refuses`)
}

/** The reset proof starts with: drop public and the schemas the migrations make, then a bare public. */
export function resetSql(cfg, sqls) {
  if (cfg.reset) {
    if (!existsSync(cfg.reset)) throw new Refusal(`no reset file ${cfg.reset}`)
    const sql = read(cfg.reset)
    assertNoMeta(cfg.reset, sql)
    return sql
  }
  const made = new Set()
  for (const sql of sqls) for (const st of splitSql(sql)) {
    const c = classify(st.bare)
    if (c?.kind === 'schema') made.add(normName(c.name).split('.')[1])
  }
  const own = [...made].filter((s) => !STACK_SCHEMAS.has(s)).sort()
  return [
    ...own.map((s) => `drop schema if exists "${s}" cascade;`),
    'drop schema if exists public cascade;',
    'create schema public;',
    'grant usage on schema public to anon, authenticated, service_role;',
    'grant all on schema public to postgres, service_role;',
  ].join('\n')
}

/** Joins the parts into one script, with the line each part starts at (to name the file an error is in). */
export function assemble(parts) {
  let text = ''
  const map = []
  for (const { label, sql } of parts) {
    const head = `-- db-rerun: ${label}\n`
    map.push({ label, from: text.split('\n').length })
    text += `${head}${sql.replace(/\s*$/, '')}\n`
  }
  return { text, map }
}

/** `file:line` for psql's `psql:<stdin>:N: ERROR`, from assemble()'s map. */
export function locate(stderr, map) {
  const m = /psql:[^\n]*?:(\d+):\s*ERROR/.exec(stderr)
  if (!m) return null
  const at = Number(m[1])
  const part = [...map].reverse().find((p) => p.from <= at)
  return part ? `${part.label}:${at - part.from}` : null
}

/** psql's argv for the run (`-1` one transaction, stop at the first error, SQL on stdin). */
export function command(cfg, { single }) {
  const psql = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...(single ? ['-1'] : []), '-f', '-']
  if (cfg.via === 'docker') {
    if (!cfg.container) throw new Refusal('--via docker needs project_id in supabase/config.toml (the container is supabase_db_<project_id>)')
    return { bin: 'docker', args: ['exec', '-i', `supabase_db_${cfg.container}`, 'psql', '-U', 'postgres', ...psql] }
  }
  return { bin: 'psql', args: [cfg.dbUrl, ...psql] }
}

function execSql(cfg, sql, map, { single, exec, log }) {
  const { bin, args } = command(cfg, { single })
  const r = exec(bin, args, { input: sql, encoding: 'utf8' })
  if (r.error) {
    if (r.error.code === 'ENOENT') throw new Refusal(`no ${bin} on this machine${bin === 'psql' ? '; pass --via docker to use the stack container\'s' : ''}`)
    throw new Refusal(`could not run ${bin}: ${r.error.message}`)
  }
  if (r.status !== 0) {
    const where = locate(r.stderr || '', map)
    log(`db-rerun: FAILED${where ? ` at ${where}` : ''}, rolled back:\n${`${r.stderr || ''}${r.stdout || ''}`.trim()}`)
    return 1
  }
  return 0
}

export function run(o, { exec = spawnSync, log = console.log, now = new Date() } = {}) {
  const cfg = resolveConfig(o)
  if (o.cmd === 'undo') {
    const all = existsSync(cfg.migrations) ? migrationFiles(cfg.migrations) : []
    const toFile = o.out?.endsWith('.sql')
    if (toFile && o.files.length > 1) throw new Refusal('--out names one .sql file, so undo takes one migration; give a folder for several')
    for (const arg of o.files) {
      const file = findMigration(cfg, arg)
      const earlier = all.filter((p) => basename(p) < basename(file)).map((p) => ({ file: p, sql: read(p) }))
      const u = buildUndo(file, read(file), earlier, { now, rel: relative(cfg.root, file) })
      const out = toFile ? resolve(o.out) : join(o.out ? resolve(o.out) : join(tmpdir(), 'db-rerun'), `undo-${basename(file)}`)
      if (o.dryRun) log(`db-rerun: would write ${out} (${u.undone} undone, ${u.todo} TODO)`)
      else {
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, u.text)
        log(`db-rerun: wrote ${out} (${u.undone} undone, ${u.todo} TODO by hand${u.todo ? ': fill or delete those lines before apply' : ''})`)
      }
    }
    return 0
  }
  // apply and proof touch a database: local only, checked before anything else.
  assertLocal(cfg.dbUrl)
  const target = cfg.via === 'docker' ? `container supabase_db_${cfg.container}` : cfg.dbUrl.replace(/:[^:@/]*@/, ':***@')
  if (o.cmd === 'apply') {
    const file = findMigration(cfg, o.files[0])
    const sql = read(file)
    assertNoTxControl(file, sql)
    const parts = []
    if (o.undo) {
      const undo = read(resolve(o.undo))
      if (!undo) throw new Refusal(`no undo file ${o.undo}`)
      const left = undo.split('\n').filter((l) => l.startsWith('-- TODO by hand')).length
      if (left) throw new Refusal(`${o.undo} still has ${left} TODO line(s): write their SQL or delete them first`)
      assertNoTxControl(o.undo, undo)
      parts.push({ label: basename(o.undo), sql: undo })
    }
    parts.push({ label: basename(file), sql })
    const { text, map } = assemble(parts)
    log(`db-rerun: ${o.undo ? `${basename(o.undo)}, then ` : ''}${basename(file)} again on the LOCAL stack (${target}), one transaction, migration history untouched`)
    if (o.dryRun) {
      log(`db-rerun: dry run, ${text.split('\n').length} lines not sent`)
      return 0
    }
    const code = execSql(cfg, text, map, { single: true, exec, log })
    if (!code) log(`db-rerun: ${basename(file)} ran.`)
    return code
  }
  // proof
  const files = migrationFiles(cfg.migrations)
  if (!files.length) throw new Refusal(`no migrations in ${cfg.migrations}`)
  const sqls = files.map((f) => read(f))
  files.forEach((f, i) => assertNoTxControl(f, sqls[i]))
  const seeds = o.seed ? cfg.seeds : []
  for (const s of seeds) if (!existsSync(s)) throw new Refusal(`no seed file ${s}`)
  const seedSqls = seeds.map((s) => read(s))
  seeds.forEach((s, i) => assertNoTxControl(s, seedSqls[i]))
  const { text, map } = assemble([
    { label: 'begin', sql: 'begin;' },
    { label: 'reset', sql: resetSql(cfg, sqls) },
    ...files.map((f, i) => ({ label: basename(f), sql: sqls[i] })),
    ...seeds.map((s, i) => ({ label: basename(s), sql: seedSqls[i] })),
    { label: 'rollback', sql: 'rollback;' },
  ])
  log(`db-rerun: proof on the LOCAL stack (${target}): reset, ${files.length} migrations${seeds.length ? `, ${seeds.length} seed file(s)` : ''}, then ROLLBACK`)
  if (o.dryRun) {
    for (const f of files) log(`  ${basename(f)}`)
    for (const s of seeds) log(`  seed ${relative(cfg.root, s)}`)
    log(`db-rerun: dry run, ${text.split('\n').length} lines not sent`)
    return 0
  }
  const code = execSql(cfg, text, map, { single: false, exec, log })
  if (!code) log(`PROOF OK ${files.length} migrations${seeds.length ? ` and ${seeds.length} seed file(s)` : ''} rebuild from scratch (rolled back)`)
  return code
}

export function main(argv, deps = {}) {
  const err = deps.err || console.error
  let o
  try {
    o = parseArgs(argv)
  } catch (e) {
    if (!(e instanceof Refusal)) throw e
    err(`db-rerun: ${e.message}\n${USAGE}`)
    return 2
  }
  if (o.help) {
    ;(deps.log || console.log)(USAGE)
    return 0
  }
  try {
    return run(o, deps)
  } catch (e) {
    if (!(e instanceof Refusal)) throw e
    err(`db-rerun: ${e.message}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)))
}
