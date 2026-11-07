#!/usr/bin/env node
// Live usage for Dev HQ's free tiers, read from what this machine is already
// logged in to: `vercel usage`, the Supabase Management API with the CLI's
// own token, the Netlify CLI, and gh's billing report. Each reading is raw
// numbers (or what it needs to be read); dev-hq.mjs's tiersPart sets them
// against the limits a project's free-tiers.md records. Alexander, 29 Oct
// 2026: "Also none here is updated, several of these have limits etc that we
// are working against, github minutes for example".
//
//   node tier-readers.mjs [--spool <dir>]   every reading as JSON
//   node tier-readers.mjs minutes [--repo <name>] [--spool <dir>]
//                                           the month's CI minutes and their
//                                           flags as one line, for this repo
//                                           (cwd's origin) unless --repo names one
//   node tier-readers.mjs supabase --spool <dir>
//                                           the Supabase reading alone (dev-hq
//                                           runs it as a child, so the token
//                                           stays in that process)
//
// No key or token is ever written, printed or passed on a command line: the
// Supabase token is read from ~/.supabase/access-token (or
// SUPABASE_ACCESS_TOKEN) into memory and sent as a header. Read-only: nothing
// here changes a plan or a project.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOUR = 3_600_000
const iso = (ms) => new Date(ms).toISOString()

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value)}\n`)
  renameSync(tmp, file)
}

// One reading per hour at most, kept in the spool.
function cached(spool, name, now, read) {
  const file = join(spool, `tier-${name}.json`)
  const saved = readJson(file, null)
  if (saved && now - Date.parse(saved.at) < HOUR) return saved.value
  let value
  try {
    value = read()
  } catch {
    value = null
  }
  writeJson(file, { at: iso(now), value })
  return value
}

const jsonIn = (text) => {
  const s = String(text ?? '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  return a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null
}

// --- Vercel ------------------------------------------------------------------------------

// `vercel usage --json`'s services as { product: quantity }, and what the cycle
// billed for a subscription (the Pro license that showed after the 21 Oct
// downgrade to Hobby).
export function vercelReading(report) {
  if (!report || !Array.isArray(report.services)) return null
  const metrics = {}
  const billed = []
  for (const s of report.services) {
    if (Number(s.quantity) > 0) metrics[s.product] = Number(s.quantity)
    if (s.category === 'subscription' && Number(s.cost) >= 0.01) billed.push({ name: s.name, cost: Math.round(s.cost * 100) / 100 })
  }
  return { metrics, billed, from: report.period?.from ?? null }
}

function readVercel() {
  const r = spawnSync('vercel', ['usage', '--json', '--non-interactive'], { cwd: homedir(), encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024 })
  if (r.error) return { need: 'the Vercel CLI' }
  if (r.status !== 0) return { need: 'vercel login' }
  return vercelReading(jsonIn(r.stdout)) ?? { need: 'vercel login' }
}

// --- GitHub Actions ----------------------------------------------------------------------

// This month's minutes in private repos, the only ones Free caps (public
// repos run free). The month's report is one line for every repo together,
// so the minutes come day by day, each with its repo; a day before yesterday
// is kept in the spool and never asked again. A repo gh can't find (gone or
// renamed) counts as private. `billed` is what the month's summary says is
// owed so far.
export function actionsMonth(days, visibility) {
  const all = {}
  for (const items of Object.values(days)) for (const [repo, n] of Object.entries(items)) all[repo] = (all[repo] || 0) + n
  let minutes = 0
  let open = 0
  const byRepo = {}
  for (const [repo, n] of Object.entries(all)) {
    if (visibility[repo] === 'public') open += n
    else {
      minutes += n
      byRepo[repo] = n
    }
  }
  const top = Object.entries(byRepo).sort((a, b) => b[1] - a[1])[0]
  return { minutes, public: open, top: top ? { repo: top[0], minutes: top[1] } : null, byRepo }
}

// --- GitHub Actions: the month's budget flags --------------------------------------------

// Alexander, 4 Nov 2026: "We need to very strictly make sure we don't hit the
// usage limit early like we did last month." October ran 2,246 of the 2,000
// and every private repo's CI stopped until the 1st. The rule and the budgets:
// ~/.claude/global/CLAUDE.md, Costs, "GitHub Actions minutes, a hard budget".
export const FREE_MINUTES = 2000
// Each project's monthly share, by kit.json's project.name; the project's own
// kit.json `ci.minutesBudget` wins, and a repo with neither gets a new
// project's 100 until its plan says more.
export const BUDGETS = { burrow: 700, hejtide: 150, 'job-hunt': 150, svardsvik: 150, kastalia: 100, portfolio: 100, 'reel-helper': 100 }
export const NEW_PROJECT_BUDGET = 100

const whole = (n) => Math.round(n).toLocaleString('en-US')

// The repo's name from a remote URL, as the billing report names it.
export function repoName(url) {
  const m = String(url ?? '').trim().match(/[/:]([^/:]+?)(?:\.git)?\/?$/)
  return m ? m[1].toLowerCase() : null
}

// repo → { project, budget }, from each project's kit.json and its git remote
// (a repo's name isn't always the project's: portfolio's is
// alexander-astrand-portfolio). The first checkout of a repo wins.
export function budgetsByRepo(kits) {
  const out = {}
  for (const { remote, kit } of kits) {
    const repo = repoName(remote)
    if (!repo || out[repo]) continue
    const project = String(kit?.project?.name || repo).toLowerCase()
    out[repo] = { project, budget: Number(kit?.ci?.minutesBudget) || BUDGETS[project] || BUDGETS[repo] || NEW_PROJECT_BUDGET }
  }
  return out
}

// Every project with a kit.json, in ~/Desktop and ~ (Kastalia, Pylos and the
// kit live in ~).
function readKits(home = homedir()) {
  const kits = []
  for (const base of [join(home, 'Desktop'), home]) {
    let names = []
    try {
      names = readdirSync(base).sort()
    } catch {
      continue
    }
    for (const name of names) {
      const dir = join(base, name)
      const file = join(dir, '.claude', 'kit.json')
      if (!existsSync(file)) continue
      const r = spawnSync('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: 5_000 })
      if (r.status === 0) kits.push({ remote: r.stdout, kit: readJson(file, {}) })
    }
  }
  return kits
}

// The flags, most urgent first: 50 %, 70 % and 90 % of the 2,000 (at 70 %
// only merges in flight get CI, at 90 % nothing more is pushed to a ready
// PR), the month ahead of its pace (minutes above the share of the month
// gone), and each project past its budget or ahead of its own pace. A
// project's pace counts once it has used a tenth of its budget, so the 1st's
// first run is no flag. `project` is set on a project's flags.
export function actionsFlags({ minutes, byRepo = {} }, budgets, now, cap = FREE_MINUTES) {
  const d = new Date(now)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  const gone = (now - start) / (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - start)
  const flags = []
  const pct = (minutes / cap) * 100
  const step = [90, 70, 50].find((p) => pct >= p)
  const what = { 90: 'stop pushing to ready PRs', 70: 'CI only for merges in flight', 50: 'half the month gone in minutes' }
  if (step) flags.push({ level: step >= 70 ? 'alert' : 'warn', text: `${Math.floor(pct)} % of the ${whole(cap)}: ${what[step]}` })
  const pace = cap * gone
  if (minutes > pace) flags.push({ level: 'warn', text: `ahead of pace: ${whole(minutes)} by day ${d.getUTCDate()}, the pace is ${whole(pace)}` })
  for (const [repo, n] of Object.entries(byRepo).sort((a, b) => b[1] - a[1])) {
    const { project, budget } = budgets?.[repo] ?? { project: repo, budget: NEW_PROJECT_BUDGET }
    if (n > budget) flags.push({ level: 'alert', project, text: `${project} past its budget: ${whole(n)} of ${whole(budget)}` })
    else if (n > budget * gone && n >= budget / 10) flags.push({ level: 'warn', project, text: `${project} ahead of its pace: ${whole(n)} of ${whole(budget)}, the pace is ${whole(budget * gone)}` })
  }
  return flags
}

// The reading with its flags, worked out on each read (the minutes are
// cached hourly, the clock isn't).
export function withFlags(reading, budgets, now) {
  if (!reading || reading.need || reading.minutes == null) return reading
  return { ...reading, budgets: budgets || {}, flags: actionsFlags(reading, budgets || {}, now) }
}

// One line for a project's daily note (groundhog-day): the month's minutes,
// this repo's against its budget, and the flags for the whole account and for
// this project; another project's flags are its own note's.
export function minutesLine(reading, repo) {
  if (!reading) return 'CI minutes: not read (gh gave no reading)'
  if (reading.need) return `CI minutes: not read (needs ${reading.need})`
  const own = repo ? reading.budgets?.[repo] : null
  const used = repo ? reading.byRepo?.[repo] : null
  const mine = own ? ` · ${own.project} ${whole(used || 0)} of its ${whole(own.budget)}` : used != null ? ` · ${repo} ${whole(used)}` : ''
  const flags = (reading.flags || []).filter((f) => !f.project || f.project === own?.project || f.project === repo)
  const head = `CI minutes: ${whole(reading.minutes)} of ${whole(FREE_MINUTES)} this month (${Math.floor((reading.minutes / FREE_MINUTES) * 100)} %)${mine}`
  return flags.length ? `${head} · ${flags.map((f) => `${f.level === 'alert' ? '!!' : '!'} ${f.text}`).join(' · ')}` : `${head} · on pace`
}

function readActions(spool, now) {
  const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', timeout: 15_000 })
  const json = (args) => {
    const r = gh(args)
    return r.status === 0 ? JSON.parse(r.stdout) : Object.assign(new Error(r.stderr), { failed: true })
  }
  const login = gh(['api', 'user', '--jq', '.login'])
  const user = login.status === 0 ? login.stdout.trim() : ''
  if (!/^[\w-]{1,39}$/.test(user)) return { need: 'gh auth login' }
  const summary = json(['api', `/users/${user}/settings/billing/usage/summary`])
  if (summary.failed) return /"user" scope|user scope/i.test(summary.message) || / 404/.test(summary.message) ? { need: "gh's user scope" } : null
  const file = join(spool, 'tier-actions-days.json')
  const month = iso(now).slice(0, 7)
  const kept = readJson(file, {})
  const store = kept.month === month ? kept : { month, days: {}, visibility: {} }
  const [y, m, today] = iso(now).slice(0, 10).split('-').map(Number)
  for (let d = 1; d <= today; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`
    if (store.days[day] && d < today - 1) continue
    const r = json(['api', `/users/${user}/settings/billing/usage?year=${y}&month=${m}&day=${d}`])
    if (r.failed) continue
    const items = {}
    for (const i of r.usageItems || []) {
      if (i.product !== 'actions' || !/minute/i.test(i.unitType)) continue
      items[i.repositoryName] = (items[i.repositoryName] || 0) + (Number(i.quantity) || 0)
    }
    store.days[day] = items
  }
  for (const repo of new Set(Object.values(store.days).flatMap((i) => Object.keys(i)))) {
    if (store.visibility[repo]) continue
    const r = gh(['api', `repos/${user}/${repo}`, '--jq', '.visibility'])
    store.visibility[repo] = r.status === 0 ? r.stdout.trim() : 'unknown'
  }
  writeJson(file, store)
  const billed = (summary.usageItems || []).filter((i) => /^actions$/i.test(i.product)).reduce((n, i) => n + (Number(i.netAmount) || 0), 0)
  return { ...actionsMonth(store.days, store.visibility), billed: Math.round(billed * 100) / 100 }
}

// --- Netlify -----------------------------------------------------------------------------

// The account's credits and what is over; Netlify's API has no credits-used
// figure, so a reading only counts as zero when the account has no sites.
export function netlifyReading(accounts, sites) {
  const a = (accounts || []).find((x) => x.default) || (accounts || [])[0]
  if (!a) return null
  return {
    plan: a.type_name ?? null,
    credits: a.plan_credits ?? null,
    sites: Array.isArray(sites) ? sites.length : null,
    over: [...(a.usages_exceeded || []), ...(a.configurable_limits_exceeded || [])].map(String),
    card: Boolean(a.has_stripe_payment_method),
  }
}

function readNetlify() {
  const api = (method) => spawnSync('netlify', ['api', method], { cwd: homedir(), encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
  const acc = api('listAccountsForUser')
  if (acc.error) return { need: 'the Netlify CLI' }
  if (acc.status !== 0) return { need: 'netlify login' }
  const sites = api('listSites')
  const parse = (t) => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  }
  return netlifyReading(parse(acc.stdout), sites.status === 0 ? parse(sites.stdout) : null) ?? { need: 'netlify login' }
}

// --- Supabase ----------------------------------------------------------------------------

const ACTIVE = /^(ACTIVE|COMING_UP|RESTORING|UPGRADING)/

function supabaseToken(env = process.env, home = homedir()) {
  if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN.trim()
  const f = join(home, '.supabase', 'access-token')
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : null
}

// Edge Function invocations are only reported for the last day, hour by hour,
// so each run keeps those hours in the spool and the month is their sum
// (counted from the first hour kept: `since`). The free plan's quotas are per
// organization, so the reading is the busiest free org's.
export function edgeMonth(store, buckets, orgOf, now) {
  const month = iso(now).slice(0, 7)
  const hours = { ...(store?.hours || {}) }
  for (const b of buckets) hours[`${b.ref}/${b.fn}/${b.t}`] = b.n
  for (const k of Object.keys(hours)) if (!k.split('/')[2].startsWith(month)) delete hours[k]
  const byOrg = {}
  for (const [k, n] of Object.entries(hours)) {
    const org = orgOf[k.split('/')[0]]
    if (org) byOrg[org] = (byOrg[org] || 0) + n
  }
  const first = Object.keys(hours).map((k) => k.split('/')[2]).sort()[0]
  const kept = store?.since && store.since.startsWith(month) ? store.since : null
  const since = [kept, first].filter(Boolean).sort()[0] || iso(now)
  return { store: { since, hours }, invocations: Math.max(0, ...Object.values(byOrg)), since: since > `${month}-01T01` ? since.slice(0, 10) : null }
}

async function readSupabase(spool, now = Date.now()) {
  const token = supabaseToken()
  if (!token) return { need: 'supabase login' }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const api = async (path, body) => {
    const r = await fetch(`https://api.supabase.com${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
    if (r.status === 401) throw Object.assign(new Error('token'), { need: true })
    return r.ok ? r.json() : null
  }
  let projects
  try {
    projects = await api('/v1/projects')
  } catch (e) {
    if (e.need) return { need: 'supabase login' }
    throw e
  }
  const plans = {}
  for (const org of new Set((projects || []).map((p) => p.organization_id))) plans[org] = (await api(`/v1/organizations/${org}`))?.plan ?? null
  const free = (projects || []).filter((p) => plans[p.organization_id] === 'free' && ACTIVE.test(p.status || ''))
  const orgOf = Object.fromEntries(free.map((p) => [p.id, p.organization_id]))
  const buckets = []
  let dbBytes = 0
  for (const p of free) {
    for (const fn of (await api(`/v1/projects/${p.id}/functions`)) || []) {
      const stats = await api(`/v1/projects/${p.id}/analytics/endpoints/functions.combined-stats?interval=1day&function_id=${fn.id}`)
      for (const h of stats?.result || []) if (h.timestamp) buckets.push({ ref: p.id, fn: fn.id, t: h.timestamp, n: Number(h.request_count) || 0 })
    }
    const size = await api(`/v1/projects/${p.id}/database/query/read-only`, { query: 'select pg_database_size(current_database()) as bytes' })
    dbBytes = Math.max(dbBytes, Number(size?.[0]?.bytes) || 0)
  }
  const file = join(spool, 'tier-supabase-edge.json')
  const edge = edgeMonth(readJson(file, null), buckets, orgOf, now)
  writeJson(file, edge.store)
  return {
    edgeInvocations: edge.invocations,
    edgeSince: edge.since,
    dbMb: Math.round((dbBytes / 1024 / 1024) * 10) / 10,
    activeFree: free.length,
    freeOrgs: new Set(free.map((p) => p.organization_id)).size,
  }
}

// dev-hq.mjs is synchronous, so Supabase runs in a child (this file); the
// token never leaves it.
function readSupabaseChild(spool) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'supabase', '--spool', spool], { encoding: 'utf8', timeout: 120_000 })
  return r.status === 0 ? JSON.parse(r.stdout) : null
}

// --- all of them -------------------------------------------------------------------------

// Every reading, each at most hourly. Keyed by the start of a service's
// free-tiers.md heading, lowercased: tiersPart matches them that way.
export function readings(spool, now = Date.now()) {
  return {
    vercel: cached(spool, 'vercel', now, readVercel),
    supabase: cached(spool, 'supabase', now, () => readSupabaseChild(spool)),
    netlify: cached(spool, 'netlify', now, readNetlify),
    'github actions': actionsReading(spool, now),
  }
}

// The Actions reading with its budget flags; the budgets are read hourly too.
export function actionsReading(spool, now = Date.now()) {
  const reading = cached(spool, 'actions', now, () => readActions(spool, now))
  return withFlags(reading, cached(spool, 'minute-budgets', now, () => budgetsByRepo(readKits())), now)
}

async function main(argv) {
  const i = argv.indexOf('--spool')
  const spool = i >= 0 ? argv[i + 1] : join(homedir(), '.local', 'state', 'burrow-dev', 'kit')
  if (argv[0] === 'supabase') {
    console.log(JSON.stringify(await readSupabase(spool)))
    return
  }
  if (argv[0] === 'minutes') {
    const r = argv.indexOf('--repo')
    const origin = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: 5_000 })
    const repo = r >= 0 ? String(argv[r + 1] ?? '').toLowerCase() : origin.status === 0 ? repoName(origin.stdout) : null
    console.log(minutesLine(actionsReading(spool), repo))
    return
  }
  console.log(JSON.stringify(readings(spool), null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`tier-readers: ${e.message}`)
    process.exit(1)
  })
}
