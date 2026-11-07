#!/usr/bin/env node
// The facts step of `/black-box` as one call, shaped like council-facts.mjs: writes
// `black-box-facts.md` into the audit folder, so the navigator runs one line and the
// three `barney-stinson` lanes read one file instead of grepping migrations, routes,
// kit.json and CI by hand (F7, kit 1.9 council: the by-hand step 1 is part of why the
// audit had not run in two windows). Greps, not judgements: a lane confirms each row.
// Sections, in order: the lanes and their budgets, the git range since the last audit,
// database and access (tables, RLS, policies, definer functions, grants, storage,
// cron and pg_net, the SQL tests), security and auth (env files by variable name,
// tracked env files, key shapes in git history, edge functions and CORS, headers,
// Auth settings, the guard hooks), infrastructure and plans (kit.json, runtimes and
// key packages, npm outdated and audit, CI workflows, free-tier and cost files, the
// outside hosts the code calls), code size (the 20 biggest files, knip), advisors.
// Nothing secret is printed: env files and history hits give names and commits only.
//
// Usage: node black-box-facts.mjs --version <v> [--budgets db=25,sec=15,infra=15]
//          [--repo <project>] [--from <commit>] [--out <file>] [--no-npm]
// --from: the last audit's commit; default the last commit touching docs/audits/.
// --out: default `<plans>audits-<version>/black-box-facts.md`, `plans` from kit.json
// (default ~/.claude/plans/). --no-npm: skip npm outdated, npm audit and knip (they
// reach the registry).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const HELP = `Usage: node black-box-facts.mjs --version <v> [--budgets db=25,sec=15,infra=15]
         [--repo <project>] [--from <commit>] [--out <file>] [--no-npm]
Writes <plans>audits-<version>/black-box-facts.md (or --out) and prints its section headers.`

// The lane budgets in millions of tokens; the 2.13.6 numbers are the default.
export const DEFAULT_BUDGETS = { db: 25, sec: 15, infra: 15 }
const LANES = [
  ['db', '1. Database and access'],
  ['sec', '2. Security and auth'],
  ['infra', '3. Infrastructure, APIs and plans'],
]

export function parseBudgets(text) {
  const out = { ...DEFAULT_BUDGETS }
  for (const part of String(text || '').split(',')) {
    const m = /^\s*(db|sec|infra)\s*=\s*([\d.]+)\s*M?\s*$/i.exec(part)
    if (m) out[m[1].toLowerCase()] = Number(m[2])
  }
  return out
}

export function parseArgs(argv) {
  const o = { version: null, budgets: { ...DEFAULT_BUDGETS }, repo: process.cwd(), from: null, out: null, npm: true, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--version') o.version = argv[++i]
    else if (a === '--budgets') o.budgets = parseBudgets(argv[++i])
    else if (a === '--repo') o.repo = argv[++i]
    else if (a === '--from') o.from = argv[++i]
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--no-npm') o.npm = false
  }
  return o
}

// A command's stdout; npm outdated and npm audit exit 1 when they find something,
// so a non-zero exit with output still counts as an answer.
export function sh(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    if (e.stdout) return String(e.stdout)
    throw e
  }
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
const readJson = (p) => {
  try {
    return JSON.parse(read(p) ?? 'null')
  } catch {
    return null
  }
}
const expand = (p) => p.replace(/^~(?=\/|$)/, homedir())
const list = (items, empty = 'none') => (items.length ? items.map((s) => `- ${s}`).join('\n') : empty)

export function plansDir(repo) {
  const kit = readJson(join(repo, '.claude', 'kit.json'))
  const p = expand(kit?.plans || '~/.claude/plans/')
  return p.endsWith('/') ? p : `${p}/`
}

// ---- the lanes

export function lanesSection(version, budgets) {
  const rows = LANES.map(([k, name]) => `| ${name} | ${budgets[k]}M |`)
  const total = LANES.reduce((s, [k]) => s + budgets[k], 0)
  return [`Version ${version}. Each lane's order carries its budget; the navigator's own reads come on top.`, '', '| Lane | Budget |', '|---|---|', ...rows, `| Total | ${total}M |`].join('\n')
}

// ---- the git range

export function lastAuditCommit(repo, run = sh) {
  try {
    return run('git', ['-C', repo, 'log', '-1', '--format=%h', '--', 'docs/audits'], repo).trim() || null
  } catch {
    return null
  }
}

export function gitRange(repo, from, run = sh) {
  if (!from) return 'No earlier audit in docs/audits/ and no `--from`: the whole history is in scope.'
  try {
    const log = run('git', ['-C', repo, 'log', '--oneline', '--no-merges', `${from}..HEAD`], repo).trim().split('\n').filter(Boolean)
    const stat = run('git', ['-C', repo, 'diff', '--shortstat', `${from}..HEAD`], repo).trim()
    const shown = log.slice(0, 60)
    return [`${log.length} commits (merges left out) since \`${from}\`; ${stat || 'no changes'}.`, '', ...shown.map((l) => `- ${l}`), ...(log.length > shown.length ? [`- (${log.length - shown.length} more)`] : [])].join('\n')
  } catch (e) {
    return `git failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`
  }
}

// ---- database and access, from the migrations

// Dollar-quoted bodies are blanked (same length, newlines kept) so a `;` inside a
// function body doesn't split a statement and line numbers still match the file.
export function maskBodies(sql) {
  return sql
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, (m) => m.replace(/[^\n]/g, ' '))
}

const ident = (s) => {
  const n = s.replace(/"/g, '').trim().toLowerCase()
  return n.includes('.') ? n : `public.${n}`
}
const lineAt = (text, idx) => text.slice(0, idx).split('\n').length

export function parseMigrations(files) {
  const tables = new Map() // name -> where
  const rls = new Set()
  const policies = new Map() // `table|name` -> {table, name, cmd, roles, where}
  const functions = new Map() // name -> {definer, searchPath, where}
  const grants = []
  const cron = []
  const net = []
  let appSettings = 0
  for (const f of files) {
    const raw = readFileSync(f.path, 'utf8')
    const sql = maskBodies(raw)
    const at = (i) => `${f.rel}:${lineAt(sql, i)}`
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) tables.set(ident(m[1]), at(m.index))
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([\w."]+)/gi)) tables.delete(ident(m[1]))
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi)) rls.add(ident(m[1]))
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."]+)\s+disable\s+row\s+level\s+security/gi)) rls.delete(ident(m[1]))
    // Statements in file order, so a drop followed by a re-create keeps the new one.
    for (const m of sql.matchAll(/(?:create|drop)\s+(?:policy|(?:or\s+replace\s+)?function)[^;]*;|alter\s+function[^;]*;|\bgrant\s[^;]*;/gi)) {
      const st = m[0]
      let p
      if ((p = /^create\s+policy\s+("[^"]+"|[\w]+)\s+on\s+([\w."]+)/i.exec(st))) {
        const table = ident(p[2])
        const name = p[1].replace(/"/g, '')
        const cmd = (/\bfor\s+(select|insert|update|delete|all)\b/i.exec(st)?.[1] || 'all').toLowerCase()
        const roles = (/\bto\s+([\w, "]+?)(?:\s+using|\s+with|\s*;)/i.exec(st)?.[1] || 'public').replace(/\s+/g, ' ').trim().toLowerCase()
        policies.set(`${table}|${name}`, { table, name, cmd, roles, where: at(m.index) })
      } else if ((p = /^drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[\w]+)\s+on\s+([\w."]+)/i.exec(st))) {
        policies.delete(`${ident(p[2])}|${p[1].replace(/"/g, '')}`)
      } else if ((p = /^create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/i.exec(st))) {
        functions.set(ident(p[1]), { definer: /security\s+definer/i.test(st), searchPath: /set\s+search_path/i.test(st), where: at(m.index) })
      } else if ((p = /^drop\s+function\s+(?:if\s+exists\s+)?([\w."]+)/i.exec(st))) {
        functions.delete(ident(p[1]))
      } else if ((p = /^alter\s+function\s+([\w."]+)/i.exec(st))) {
        const fn = functions.get(ident(p[1]))
        if (fn && /set\s+search_path/i.test(st)) fn.searchPath = true
        if (fn && /security\s+definer/i.test(st)) fn.definer = true
      } else if ((p = /^grant\s+([\s\S]+?)\s+on\s+([\s\S]+?)\s+to\s+([\s\S]+?);/i.exec(st))) {
        grants.push({ what: p[1].replace(/\s+/g, ' ').trim().toLowerCase(), on: p[2].replace(/\s+/g, ' ').trim().toLowerCase(), to: p[3].replace(/\s+/g, ' ').trim().toLowerCase(), where: at(m.index) })
      }
    }
    for (const m of sql.matchAll(/cron\.schedule\s*\(\s*'([^']*)'/gi)) cron.push(`${m[1]} (${at(m.index)})`)
    // pg_net calls usually sit inside a function body, so this one reads the raw text.
    raw.split('\n').forEach((l, i) => {
      if (/\bnet\.http_(get|post|delete)\b/i.test(l)) net.push(`${f.rel}:${i + 1}`)
    })
    if (/\bapp_settings\b/i.test(raw)) appSettings += 1
  }
  return { tables, rls, policies: [...policies.values()], functions, grants, cron, net, appSettings }
}

function sqlFiles(dir, root) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => n.endsWith('.sql')).sort().map((n) => ({ path: join(dir, n), rel: relative(root, join(dir, n)) }))
}

export function databaseSection(repo) {
  const migrations = sqlFiles(join(repo, 'supabase', 'migrations'), repo)
  if (!migrations.length) return 'No `supabase/migrations/`: no database to audit from migrations. Lane 1 has only the advisors, if any.'
  const d = parseMigrations(migrations)
  const out = [`Parsed from ${migrations.length} migrations (\`${migrations[0].rel.split('/').pop()}\` to \`${migrations.at(-1).rel.split('/').pop()}\`), drops applied in file order. The live database can differ; the advisors are the check.`, '']
  const byTable = new Map()
  for (const p of d.policies) byTable.set(p.table, [...(byTable.get(p.table) || []), p])
  const pub = [...d.tables.keys()].filter((t) => t.startsWith('public.')).sort()
  out.push(`### Tables (${d.tables.size}), RLS and policies`, '')
  out.push('| Table | RLS | Policies (command: roles) | Created |', '|---|---|---|---|')
  for (const t of [...d.tables.keys()].sort()) {
    const ps = (byTable.get(t) || []).map((p) => `${p.cmd}: ${p.roles}`).join('; ')
    out.push(`| ${t} | ${d.rls.has(t) ? 'on' : '**off**'} | ${ps || (d.rls.has(t) ? '**none**' : '')} | ${d.tables.get(t)} |`)
  }
  const noRls = pub.filter((t) => !d.rls.has(t))
  const noPolicy = [...d.rls].filter((t) => d.tables.has(t) && !byTable.has(t))
  out.push('', `**Public tables with RLS off:** ${noRls.length ? noRls.join(', ') : 'none'}`)
  out.push(`**RLS on and no policy (closed to everyone but the service role):** ${noPolicy.length ? noPolicy.join(', ') : 'none'}`)
  const anonPolicies = d.policies.filter((p) => /\b(anon|public)\b/.test(p.roles))
  out.push(`**Policies open to anon or public:** ${anonPolicies.length}`, list(anonPolicies.map((p) => `${p.table} "${p.name}" (${p.cmd}) ${p.where}`), ''))
  const storage = d.policies.filter((p) => p.table.startsWith('storage.'))
  out.push('', `### Storage policies (${storage.length})`, '', list(storage.map((p) => `${p.table} "${p.name}" (${p.cmd}: ${p.roles}) ${p.where}`)))
  const fns = [...d.functions.entries()].sort()
  const definers = fns.filter(([, f]) => f.definer)
  out.push('', `### Functions (${fns.length}), security definer (${definers.length})`, '')
  out.push(list(definers.map(([n, f]) => `${n} ${f.searchPath ? 'sets search_path' : '**no search_path**'} (${f.where})`)))
  const toAnon = d.grants.filter((g) => /\b(anon|public)\b/.test(g.to))
  out.push('', `### Grants (${d.grants.length}), to anon or public (${toAnon.length})`, '', list(toAnon.map((g) => `${g.what} on ${g.on} to ${g.to} (${g.where})`)))
  out.push('', `### Jobs`, '', `pg_cron schedules (${d.cron.length}):`, list(d.cron), '', `pg_net calls (${d.net.length}):`, list(d.net), '', `Migrations naming app_settings: ${d.appSettings}`)
  const tests = sqlFiles(join(repo, 'supabase', 'tests'), repo)
  const testText = tests.map((t) => readFileSync(t.path, 'utf8').toLowerCase()).join('\n')
  const untested = pub.filter((t) => !new RegExp(`\\b${t.split('.')[1]}\\b`).test(testText))
  out.push('', `### SQL tests (${tests.length} files in supabase/tests/)`, '', `Public tables no test names: ${untested.length ? untested.join(', ') : 'none'}`)
  return out.join('\n')
}

// ---- security and auth

// Key shapes for the history grep, built from parts so the kit's own secrets
// check doesn't flag this file; basic regex, which `git log -G` reads.
export const KEY_SHAPES = [
  ['Stripe live key', 'sk' + '_live_'],
  ['Anthropic key', 'sk' + '-ant-'],
  ['Supabase access token', 'sb' + 'p_[A-Za-z0-9]'],
  ['Supabase secret key', 'sb' + '_secret_'],
  ['JWT', 'ey' + 'JhbGci'],
  ['AWS access key', 'AK' + 'IA[0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z]'],
  ['private key block', 'BEGIN [A-Z ]*PRIVATE ' + 'KEY'],
]

// Variable names only, never a value.
export function envNames(text) {
  return text.split('\n').map((l) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1]).filter(Boolean)
}

// The [auth] sections of supabase/config.toml, without any key that holds a secret.
export function authSettings(toml) {
  const out = []
  let section = ''
  for (const line of toml.split('\n')) {
    const s = /^\s*\[([^\]]+)\]/.exec(line)
    if (s) section = s[1].trim()
    else if (/^auth(\.|$)/.test(section)) {
      const kv = /^\s*([\w-]+)\s*=\s*(.+?)\s*$/.exec(line)
      if (kv && !/secret|key|token|client_id/i.test(kv[1])) out.push(`[${section}] ${kv[1]} = ${kv[2]}`)
    }
  }
  return out
}

function grepFiles(root, dirs, exts, re) {
  const hits = []
  const walk = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n.startsWith('.')) continue
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (exts.includes(extname(n))) readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        const m = re.exec(l)
        if (m) hits.push({ where: `${relative(root, p)}:${i + 1}`, m })
      })
    }
  }
  for (const d of dirs) walk(join(root, d))
  return hits
}

const CODE = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']
const CODE_DIRS = ['src', 'app', 'lib', 'api', 'pages', 'server', 'supabase/functions']

export function securitySection(repo, run = sh) {
  const out = []
  const envs = readdirSync(repo).filter((n) => /^\.env/.test(n)).sort()
  out.push('### Env files (variable names only)', '')
  for (const e of envs) {
    let ignored = false
    try {
      run('git', ['-C', repo, 'check-ignore', '-q', e], repo)
      ignored = true
    } catch {}
    out.push(`- \`${e}\` (${ignored ? 'git-ignored' : '**not ignored**'}): ${envNames(readFileSync(join(repo, e), 'utf8')).join(', ') || 'no variables'}`)
  }
  if (!envs.length) out.push('none at the root')
  let tracked = []
  try {
    tracked = run('git', ['-C', repo, 'ls-files'], repo).split('\n').filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/example|sample|template/i.test(f))
  } catch {}
  out.push('', `**Env files tracked by git (not examples):** ${tracked.length ? tracked.join(', ') : 'none'}`)
  out.push('', '### Key shapes in git history (commits only; a reader checks each)', '')
  for (const [label, re] of KEY_SHAPES) {
    let commits = []
    try {
      commits = run('git', ['-C', repo, 'log', '--all', '--format=%h', '-G', re], repo).split('\n').filter(Boolean)
    } catch {}
    out.push(`- ${label}: ${commits.length ? `${commits.length} commits (${commits.slice(0, 10).join(', ')}${commits.length > 10 ? ', ...' : ''})` : 'none'}`)
  }
  const fnDir = join(repo, 'supabase', 'functions')
  const fns = existsSync(fnDir) ? readdirSync(fnDir).filter((n) => !n.startsWith('.') && statSync(join(fnDir, n)).isDirectory()) : []
  out.push('', `### Edge functions (${fns.filter((n) => n !== '_shared').length})`, '', fns.length ? fns.join(', ') : 'none')
  if (fns.includes('_shared')) out.push('', `\`_shared/\`: ${readdirSync(join(fnDir, '_shared')).join(', ')}`)
  const cors = grepFiles(repo, CODE_DIRS, CODE, /Access-Control-Allow-Origin['"]?\s*[:,]\s*([^,}\n]+)/i)
  out.push('', `**CORS origins set in code (${cors.length}):**`, list(cors.map((h) => `${h.where} ${h.m[1].trim()}`)))
  const vercel = readJson(join(repo, 'vercel.json'))
  out.push('', '### Response headers (vercel.json)', '')
  if (!vercel) out.push('no vercel.json')
  else {
    const keys = new Set((vercel.headers || []).flatMap((h) => (h.headers || []).map((x) => x.key.toLowerCase())))
    out.push(`Set: ${keys.size ? [...keys].sort().join(', ') : 'none'}`)
    const want = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy']
    out.push(`Missing: ${want.filter((k) => !keys.has(k)).join(', ') || 'none'}`)
  }
  const toml = read(join(repo, 'supabase', 'config.toml'))
  out.push('', '### Auth settings (supabase/config.toml, local; production is read in the dashboard)', '', toml ? list(authSettings(toml)) : 'no supabase/config.toml')
  const settings = readJson(join(repo, '.claude', 'settings.json'))
  const hooks = Object.entries(settings?.hooks || {}).flatMap(([ev, groups]) => groups.flatMap((g) => (g.hooks || []).map((h) => `${ev}${g.matcher ? ` (${g.matcher})` : ''}: ${h.command}`)))
  out.push('', `### Guard and hooks (.claude/settings.json, ${hooks.length})`, '', list(hooks))
  return out.join('\n')
}

// ---- infrastructure, APIs and plans

const KEY_PACKAGES = ['react', 'react-dom', 'next', 'vite', 'tailwindcss', '@supabase/supabase-js', 'typescript', 'vitest', 'vue', 'svelte']

export function npmSection(repo, run = sh) {
  const out = []
  try {
    const outdated = JSON.parse(run('npm', ['outdated', '--json'], repo) || '{}')
    const rows = Object.entries(outdated).map(([n, v]) => {
      // Only a newer major counts: a prerelease installed past `latest` is not behind.
      const major = Number(String(v.latest || '').split('.')[0]) > Number(String(v.current || '0').split('.')[0])
      return { n, line: `${n} ${v.current ?? 'missing'} -> ${v.latest}${major ? ' (major)' : ''}`, major }
    })
    out.push(`**npm outdated:** ${rows.length} packages, ${rows.filter((r) => r.major).length} a major behind`, list(rows.sort((a, b) => b.major - a.major).map((r) => r.line), ''))
  } catch (e) {
    out.push(`**npm outdated:** failed (${String(e.message).split('\n')[0]})`)
  }
  try {
    const audit = JSON.parse(run('npm', ['audit', '--omit=dev', '--json'], repo) || '{}')
    const v = audit.metadata?.vulnerabilities || {}
    const named = Object.entries(audit.vulnerabilities || {}).map(([n, x]) => `${n} (${x.severity})`)
    out.push('', `**npm audit --omit=dev:** critical ${v.critical ?? 0}, high ${v.high ?? 0}, moderate ${v.moderate ?? 0}, low ${v.low ?? 0}`, list(named, ''))
  } catch (e) {
    out.push('', `**npm audit:** failed (${String(e.message).split('\n')[0]})`)
  }
  return out.join('\n')
}

// One workflow file's CI shape, against the budget rules (CLAUDE.md "CI minutes").
export function workflowFacts(text) {
  const on = ['pull_request', 'push', 'schedule', 'workflow_dispatch', 'pull_request_target', 'release'].filter((k) => new RegExp(`^\\s*${k}\\s*:|^on:\\s*\\[?[^\\n]*\\b${k}\\b`, 'm').test(text))
  const jobsAt = text.search(/^jobs:\s*$/m)
  const jobs = jobsAt < 0 ? [] : [...text.slice(jobsAt).matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1])
  return {
    on,
    jobs,
    timeouts: (text.match(/timeout-minutes:/g) || []).length,
    concurrency: /^concurrency:/m.test(text),
    cancel: /cancel-in-progress:\s*true/.test(text),
    draftSkip: /draft\s*==\s*false|!\s*github\.event\.pull_request\.draft/.test(text),
    runners: [...new Set([...text.matchAll(/runs-on:\s*([^\n]+)/g)].map((m) => m[1].trim()))],
  }
}

export function infraSection(repo, o, run = sh) {
  const out = []
  const kit = readJson(join(repo, '.claude', 'kit.json'))
  out.push('### kit.json', '')
  if (!kit) out.push('no .claude/kit.json')
  else {
    // The refs and keychain names stay out: the lanes don't need them to audit.
    const pick = { project: kit.project?.name, stack: kit.stack, production: kit.production, deployer: kit.deployer, plans: kit.plans, kit: kit.kit?.version, ci: kit.ci, meter: kit.meter }
    out.push(...Object.entries(pick).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`))
    out.push(`- keys: ${Object.keys(kit).join(', ')}`)
  }
  const pkg = readJson(join(repo, 'package.json'))
  out.push('', '### Runtimes and key packages', '')
  if (pkg) {
    const deps = { ...pkg.devDependencies, ...pkg.dependencies }
    out.push(`- engines: ${pkg.engines ? JSON.stringify(pkg.engines) : 'none'}`)
    out.push(`- key packages: ${KEY_PACKAGES.filter((k) => deps[k]).map((k) => `${k} ${deps[k]}`).join(', ') || 'none of the usual'}`)
  } else out.push('- no package.json')
  for (const f of ['.nvmrc', '.node-version']) if (existsSync(join(repo, f))) out.push(`- ${f}: ${read(join(repo, f)).trim()}`)
  const pg = /^\s*major_version\s*=\s*(\d+)/m.exec(read(join(repo, 'supabase', 'config.toml')) || '')
  if (pg) out.push(`- Postgres major (supabase/config.toml): ${pg[1]}`)
  out.push('', '### npm', '', o.npm && pkg ? npmSection(repo, run) : `Skipped (${pkg ? '`--no-npm`' : 'no package.json'}); the navigator runs \`npm outdated\` and \`npm audit --omit=dev\` by hand if wanted.`)
  const wfDir = join(repo, '.github', 'workflows')
  const wfs = existsSync(wfDir) ? readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)).sort() : []
  out.push('', `### CI workflows (${wfs.length})`, '')
  if (!wfs.length) out.push('none')
  else {
    out.push('| File | Triggers | Jobs | timeout-minutes | Concurrency, cancel | Skips drafts | Runners |', '|---|---|---|---|---|---|---|')
    for (const n of wfs) {
      const w = workflowFacts(read(join(wfDir, n)))
      out.push(`| ${n} | ${w.on.join(', ') || '?'} | ${w.jobs.length} | ${w.timeouts} of ${w.jobs.length} | ${w.concurrency ? 'yes' : 'no'}, ${w.cancel ? 'yes' : 'no'} | ${w.draftSkip ? 'yes' : 'no'} | ${w.runners.join(', ')} |`)
    }
  }
  const plans = plansDir(repo)
  out.push('', '### Free tiers and costs', '')
  for (const f of ['free-tiers.md', 'costs.md', 'trials.md']) {
    const text = read(join(plans, f))
    const checked = text && /Checked:\s*([^\n]+)/.exec(text)?.[1]
    out.push(`- \`${plans.replace(homedir(), '~')}${f}\`: ${text ? `${text.split('\n').filter((l) => /^\|/.test(l)).length} table rows${checked ? `, checked ${checked.trim()}` : ''}` : 'missing'}`)
  }
  const hosts = new Map()
  for (const h of grepFiles(repo, CODE_DIRS, CODE, /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i)) {
    const host = h.m[1].toLowerCase()
    if (/^(localhost|127\.|example\.)/.test(host)) continue
    hosts.set(host, [...(hosts.get(host) || []), h.where])
  }
  out.push('', `### Outside hosts the code names (${hosts.size}; the lane checks each one's terms and limits)`, '')
  out.push(list([...hosts.entries()].sort((a, b) => b[1].length - a[1].length).map(([h, w]) => `${h}: ${w.length} (${w.slice(0, 3).join(', ')}${w.length > 3 ? ', ...' : ''})`)))
  return out.join('\n')
}

// ---- code size

const SOURCE = [...CODE, '.sql', '.css']

export function biggestFiles(repo, n = 20, run = sh) {
  let files = []
  try {
    files = run('git', ['-C', repo, 'ls-files'], repo).split('\n').filter((f) => SOURCE.includes(extname(f)) && !/(^|\/)(node_modules|dist|build)\//.test(f) && !/\.lock$|lock\.json$/.test(f))
  } catch {}
  return files
    .filter((f) => existsSync(join(repo, f)))
    .map((f) => [f, readFileSync(join(repo, f), 'utf8').split('\n').length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

export function codeSection(repo, o, run = sh) {
  const out = ['| Lines | File |', '|---|---|', ...biggestFiles(repo, 20, run).map(([f, l]) => `| ${l} | ${f} |`)]
  const pkg = readJson(join(repo, 'package.json'))
  const hasKnip = pkg && ({ ...pkg.devDependencies, ...pkg.dependencies }).knip
  out.push('', '**knip:**')
  if (!hasKnip) out.push('not in devDependencies; skipped.')
  else if (!o.npm) out.push('skipped (`--no-npm`).')
  else {
    try {
      const k = run('npx', ['--no-install', 'knip', '--no-progress', '--reporter', 'compact'], repo).trim().split('\n')
      out.push(k.length > 40 ? [...k.slice(0, 40), `(${k.length - 40} more lines)`].join('\n') : k.join('\n') || 'clean')
    } catch (e) {
      out.push(`failed (${String(e.message).split('\n')[0]})`)
    }
  }
  return out.join('\n')
}

// ---- the facts file

export function buildFacts(o, { run = sh } = {}) {
  const repo = o.repo
  const from = o.from || lastAuditCommit(repo, run)
  const out = [`# Black-box facts, ${o.version} (${new Date().toISOString().slice(0, 10)})`, '']
  out.push(`Built by \`plugins/release/scripts/black-box-facts.mjs\` in \`${repo.replace(homedir(), '~')}\`. Greps of the files, not judgements: every lane reads this before its own reads and never re-runs a command in it. Nothing secret is printed (names and commits only).`, '')
  out.push('## Lanes and budgets', '', lanesSection(o.version, o.budgets), '')
  out.push('## Git range since the last audit', '', gitRange(repo, from, run), '')
  out.push('## Database and access (lane 1)', '', databaseSection(repo), '')
  out.push('## Security and auth (lane 2)', '', securitySection(repo, run), '')
  out.push('## Infrastructure, APIs and plans (lane 3)', '', infraSection(repo, o, run), '')
  out.push('## Code size (the 20 biggest source files)', '', codeSection(repo, o, run), '')
  out.push('## Advisors (the navigator adds these)', '', 'The Supabase MCP\'s read-only advisor tool on dev, loaded through ToolSearch, diffed against the baseline; production\'s from `/skinny-pete <version> check` or the last deploy. A script can\'t call the MCP, so the navigator writes this section by hand, or "no database".', '')
  return out.join('\n')
}

export const headers = (facts) => facts.split('\n').filter((l) => /^#{1,3} /.test(l))

function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help || !o.version) {
    console.log(HELP)
    process.exit(o.help ? 0 : 1)
  }
  const out = o.out || join(plansDir(o.repo), `audits-${o.version}`, 'black-box-facts.md')
  const facts = buildFacts(o)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, facts)
  console.log(`Wrote ${out} (${facts.split('\n').length} lines). Sections:`)
  for (const h of headers(facts)) console.log(h)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
