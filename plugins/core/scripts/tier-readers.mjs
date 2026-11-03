#!/usr/bin/env node
// Live usage for Dev HQ's free tiers, read from what this machine is already
// logged in to: Vercel's billing charges with the CLI's own login, the
// Supabase Management API with the CLI's own token, the Netlify CLI, gh's
// billing report, and Resend and Cloudflare with a key he keeps in the macOS
// Keychain (dev-hq-resend, dev-hq-cloudflare). Each reading is raw
// numbers (or what it needs to be read); dev-hq.mjs's tiersPart sets them
// against the limits a project's free-tiers.md records. Alexander, 29 Oct
// 2026: "Also none here is updated, several of these have limits etc that we
// are working against, github minutes for example".
//
//   node tier-readers.mjs [--spool <dir>]   every reading as JSON
//   node tier-readers.mjs supabase|vercel|resend|cloudflare --spool <dir>
//                                           one reading alone (dev-hq runs these
//                                           as children, so a token stays in
//                                           that process)
//
// No key or token is ever written, printed or passed on a command line: the
// Supabase token is read from ~/.supabase/access-token (or
// SUPABASE_ACCESS_TOKEN), Vercel's from the CLI's auth.json and the Keychain
// keys through `security`, each into memory and sent as a header. Read-only: nothing
// here changes a plan or a project.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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

// One reading per hour at most, kept in the spool. A reading carries the time
// it was read (`readAt`), so Burrow says how old a figure is, not when the
// last push came (Alexander, 3 Nov 2026: "I want all the usage up to date
// with concurrrent information, at least daily, preferrably twice a day").
function cached(spool, name, now, read) {
  const file = join(spool, `tier-${name}.json`)
  const saved = readJson(file, null)
  const stamp = (v, at) => (v && typeof v === 'object' ? { ...v, readAt: at } : v)
  if (saved && now - Date.parse(saved.at) < HOUR) return stamp(saved.value, saved.at)
  let value
  try {
    value = read()
  } catch {
    value = null
  }
  writeJson(file, { at: iso(now), value })
  return stamp(value, iso(now))
}

// A key he stored once with `security add-generic-password -s <service> -a "$USER" -w`
// (the value is typed at its prompt, never on a command line), or null.
function keychain(service) {
  const r = spawnSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', timeout: 10_000 })
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null
}

// --- Vercel ------------------------------------------------------------------------------

// Vercel's billing charges (FOCUS rows, one JSON object a line: CLI 65's
// `vercel usage` parses them as one document and fails, so they are read
// here) as { product: quantity } over the month so far, and what it billed.
// The export prices every line at list rates, Hobby's usage and a $0.645 a
// day "Pro" license included, so a Hobby team's lines are never billed (3 Nov
// 2026: the plan said hobby, no card on file, and the export still priced
// Pro; he asked "Where are you getting this billing info from?"). The
// products keep the names the old `vercel usage` report used.
const VERCEL_SERVICES = {
  'Fast Data Transfer': 'fastDataTransfer',
  'Function Invocations': 'functionInvocation',
  'CDN Requests': 'edgeRequest',
  'Fast Origin Transfer': 'fastOriginTransfer',
  'Image Optimization Transformation': 'imageOptimizationTransformation',
  'Fluid Active CPU': 'fluidCpuDuration',
  'Build CPU Minutes': 'buildCpuMinutes',
}

// A row's day is its start in Los Angeles (07:00 or 08:00 UTC), so it counts
// in the month that day falls in; `from` is that month's first day.
export function vercelCharges(text, from = null, plan = null) {
  const metrics = {}
  const cost = {}
  let rows = 0
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    let c
    try {
      c = JSON.parse(line)
    } catch {
      continue
    }
    rows++
    if (from && iso(Date.parse(c.ChargePeriodStart) - 6 * HOUR).slice(0, 10) < from) continue
    const product = VERCEL_SERVICES[c.ServiceName]
    if (product) metrics[product] = (metrics[product] || 0) + (Number(c.ConsumedQuantity) || 0)
    if (plan !== 'hobby' && Number(c.BilledCost) > 0) cost[c.ServiceName] = (cost[c.ServiceName] || 0) + Number(c.BilledCost)
  }
  if (!rows) return null
  for (const k of Object.keys(metrics)) if (!metrics[k]) delete metrics[k]
  const billed = Object.entries(cost)
    .map(([name, n]) => ({ name, cost: Math.round(n * 100) / 100 }))
    .filter((b) => b.cost >= 0.01)
  return { metrics, billed, from }
}

// The old `vercel usage --json` report, for a CLI that reads it again.
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

const VERCEL_CLI = join(homedir(), 'Library', 'Application Support', 'com.vercel.cli')

async function readVercel(now = Date.now()) {
  // `vercel whoami` refreshes an expired login in auth.json before it is read
  const who = spawnSync('vercel', ['whoami', '--non-interactive'], { cwd: homedir(), encoding: 'utf8', timeout: 60_000 })
  if (who.error) return { need: 'the Vercel CLI' }
  if (who.status !== 0) return { need: 'vercel login' }
  const token = readJson(join(VERCEL_CLI, 'auth.json'), {}).token
  const team = readJson(join(VERCEL_CLI, 'config.json'), {}).currentTeam
  if (!token) return { need: 'vercel login' }
  // a window of a few days answers nothing (3 Nov 2026: 1 Nov on, empty; 20 Oct on, every day),
  // so it asks for three weeks and vercelCharges keeps the month's own days
  const q = new URLSearchParams({ from: iso(now - 21 * 24 * HOUR), to: iso(now), ...(team ? { teamId: team } : {}) })
  const r = await fetch(`https://api.vercel.com/v1/billing/charges?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) })
  if (r.status === 401 || r.status === 403) return { need: 'vercel login' }
  if (!r.ok) return null
  const owner = await fetch(team ? `https://api.vercel.com/v2/teams/${team}` : 'https://api.vercel.com/v2/user', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  const o = owner.ok ? await owner.json() : null
  const plan = (team ? o?.billing?.plan : o?.user?.billing?.plan) ?? null
  return vercelCharges(await r.text(), `${iso(now).slice(0, 7)}-01`, plan)
}

// --- GitHub Actions ----------------------------------------------------------------------

// This month's minutes in private repos, the only ones Free caps (public
// repos run free). The month's report is one line for every repo together,
// so the minutes come day by day, each with its repo; a day before yesterday
// is kept in the spool and never asked again. A repo gh can't find (gone or
// renamed) counts as private. `billed` is what the month's summary says is
// owed so far.
export function actionsMonth(days, visibility) {
  const byRepo = {}
  for (const items of Object.values(days)) for (const [repo, n] of Object.entries(items)) byRepo[repo] = (byRepo[repo] || 0) + n
  let minutes = 0
  let open = 0
  for (const [repo, n] of Object.entries(byRepo)) {
    if (visibility[repo] === 'public') open += n
    else minutes += n
  }
  const top = Object.entries(byRepo)
    .filter(([repo]) => visibility[repo] !== 'public')
    .sort((a, b) => b[1] - a[1])[0]
  return { minutes, public: open, top: top ? { repo: top[0], minutes: top[1] } : null }
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

// --- Resend ------------------------------------------------------------------------------

// Resend says the sending quota used on its answers (x-resend-daily-quota,
// Free plans only, and x-resend-monthly-quota), so one GET /domains reads it.
export function resendReading(headers) {
  const n = (k) => {
    const v = headers?.get ? headers.get(k) : headers?.[k]
    return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  }
  const day = n('x-resend-daily-quota')
  const month = n('x-resend-monthly-quota')
  return day == null && month == null ? null : { day, month }
}

async function readResend() {
  const key = keychain('dev-hq-resend')
  if (!key) return { need: 'resend key' }
  const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) })
  // a sending-only key is refused here, but its answer may still carry the quota
  if (r.status === 401 || r.status === 403) return resendReading(r.headers) ?? { need: 'resend key' }
  return resendReading(r.headers)
}

// --- Cloudflare --------------------------------------------------------------------------

// Workers requests today (the free plan's cap is a day's, reset at 00:00 UTC)
// from the GraphQL Analytics API, the busiest account's.
export function cloudflareReading(data) {
  const accounts = data?.data?.viewer?.accounts
  if (!Array.isArray(accounts)) return null
  const per = accounts.map((a) => (a.workersInvocationsAdaptive || []).reduce((n, g) => n + (Number(g.sum?.requests) || 0), 0))
  return { requestsToday: Math.max(0, ...per), accounts: accounts.length }
}

async function readCloudflare(now = Date.now()) {
  const token = keychain('dev-hq-cloudflare')
  if (!token) return { need: 'cloudflare token' }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const acc = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers, signal: AbortSignal.timeout(20_000) })
  if (acc.status === 401 || acc.status === 403) return { need: 'cloudflare token' }
  const ids = ((await acc.json())?.result || []).map((a) => a.id).filter((id) => /^[0-9a-f]{32}$/.test(id))
  if (!ids.length) return { requestsToday: 0, accounts: 0 }
  const query = `query($ids: [string!], $d: Date!) { viewer { accounts(filter: { accountTag_in: $ids }) {
    workersInvocationsAdaptive(limit: 10000, filter: { date: $d }) { sum { requests } } } } }`
  const body = JSON.stringify({ query, variables: { ids, d: iso(now).slice(0, 10) } })
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers, body, signal: AbortSignal.timeout(30_000) })
  return r.ok ? cloudflareReading(await r.json()) : null
}

// dev-hq.mjs is synchronous, so the readers that fetch run in a child (this
// file); a token never leaves it.
const CHILD = { supabase: (spool) => readSupabase(spool), vercel: () => readVercel(), resend: () => readResend(), cloudflare: () => readCloudflare() }

function readChild(spool, name) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, '--spool', spool], { encoding: 'utf8', timeout: 120_000 })
  return r.status === 0 ? JSON.parse(r.stdout) : null
}

// --- all of them -------------------------------------------------------------------------

// Every reading, each at most hourly. Keyed by the start of a service's
// free-tiers.md heading, lowercased: tiersPart matches them that way.
export function readings(spool, now = Date.now()) {
  return {
    vercel: cached(spool, 'vercel', now, () => readChild(spool, 'vercel')),
    supabase: cached(spool, 'supabase', now, () => readChild(spool, 'supabase')),
    netlify: cached(spool, 'netlify', now, readNetlify),
    'github actions': cached(spool, 'actions', now, () => readActions(spool, now)),
    resend: cached(spool, 'resend', now, () => readChild(spool, 'resend')),
    cloudflare: cached(spool, 'cloudflare', now, () => readChild(spool, 'cloudflare')),
  }
}

async function main(argv) {
  const i = argv.indexOf('--spool')
  const spool = i >= 0 ? argv[i + 1] : join(homedir(), '.local', 'state', 'burrow-dev', 'kit')
  if (CHILD[argv[0]]) {
    console.log(JSON.stringify(await CHILD[argv[0]](spool)))
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
