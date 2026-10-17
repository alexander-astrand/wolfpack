#!/usr/bin/env node
// scrooge: the cost watch's facts (kit 1.5, 17 Oct 2026; jedi-council kit 1.4 "New skills").
// Read-only, Node only, no dependencies. It reads three kinds of ledger and prints what needs a look:
// - the trials ledger `~/.claude/plans/trials.md` (and a project's own `<plans>trials.md` if it has one):
//   days left per trial, flagged two days before the end and after it;
// - each project's `<plans>free-tiers.md` (written by `life-finds-a-way`): the file's `Checked:` date
//   against its one-month refresh, rows with a refresh date that passed, rows whose recorded usage
//   is at 70% of the limit or more, and rows with no date at all;
// - each project's cost list `<plans>costs.md` when one exists: a bill or renewal date within two days.
// Projects are the folders `<desktop>/*/.claude/kit.json`; `plans` in kit.json, default `~/.claude/plans/`.
// Live usage (gh, vercel, supabase) is the skill's job, not this script's: it never calls the network.
//
// Usage: node scrooge.mjs [--json] [--today yyyy-mm-dd] [--home <dir>] [--desktop <dir>]

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DAY = 86400000
const WARN_DAYS = 2 // the global Costs rule: "a reminder two days before"
const USAGE_FLAG = 0.7 // "say plainly when anything passes 70% of a free limit"
const REFRESH_DAYS = 30 // free-tiers.md: "Refresh when older than about a month"

const DATE = /(\d{4}-\d{2}-\d{2})/

export function dayDiff(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY)
}

function addDays(date, n) {
  return new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10)
}

// First number in a cell; spaces, thin spaces and commas are thousands separators ("about 10 000", "1,000,000").
export function firstNumber(cell) {
  const m = String(cell ?? '').match(/\d[\d,   ]*(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0].replace(/[,   ]/g, '').trim())
  return Number.isFinite(n) ? n : null
}

// Markdown tables with the `## heading` above each, as { section, header: [lowercased], rows: [[cells]] }.
export function tables(text) {
  const out = []
  let section = ''
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).trim()
    if (!line.trim().startsWith('|')) {
      current = null
      continue
    }
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    if (!current) {
      current = { section, header: cells.map((c) => c.toLowerCase()), rows: [] }
      out.push(current)
    } else current.rows.push(cells)
  }
  return out
}

const col = (header, re) => header.findIndex((h) => re.test(h))

export function readTrials(text, today, file) {
  const out = []
  for (const t of tables(text)) {
    const ends = col(t.header, /^ends?\b|end date/)
    if (ends < 0) continue
    const svc = col(t.header, /service/)
    const acct = col(t.header, /account|project/)
    const card = col(t.header, /card/)
    const atEnd = col(t.header, /at the end|what happens/)
    for (const r of t.rows) {
      const date = r[ends]?.match(DATE)?.[1] ?? null
      const left = date ? dayDiff(today, date) : null
      const status = !date ? 'no-date' : left < 0 ? 'ended' : left <= WARN_DAYS ? 'warn' : 'ok'
      out.push({
        file,
        service: r[svc] ?? r[0],
        account: acct >= 0 ? r[acct] : '',
        ends: date,
        approx: /≈|about|circa/i.test(r[ends] ?? ''),
        daysLeft: left,
        warnFrom: date ? addDays(date, -WARN_DAYS) : null,
        card: card >= 0 ? r[card] || 'unknown' : 'unknown',
        atEnd: atEnd >= 0 ? r[atEnd] : '',
        status,
      })
    }
  }
  return out
}

export function readFreeTiers(text, today, file, project) {
  const checked = text.match(/^Checked:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null
  const refreshDue = checked ? addDays(checked, REFRESH_DAYS) : null
  const summary = {
    project,
    file,
    checked,
    refreshDue,
    refreshDaysLeft: refreshDue ? dayDiff(today, refreshDue) : null,
    stale: refreshDue ? dayDiff(today, refreshDue) < 0 : true,
    rows: 0,
    usageRows: 0,
    flags: [],
  }
  for (const t of tables(text)) {
    const value = col(t.header, /^(value|limit value|free limit)$/)
    const used = col(t.header, /^(used|usage|our use)/)
    const read = col(t.header, /^(read|date|checked)/)
    const refresh = col(t.header, /refresh|re-check/)
    for (const r of t.rows) {
      summary.rows++
      const what = `${t.section ? t.section + ': ' : ''}${r[0]}`
      const line = r.join(' ')
      // Usage is either a Used column against Value, or a row that says "<n> % of the limit".
      let pct = null
      if (used >= 0 && r[used]) {
        const u = firstNumber(r[used])
        const v = value >= 0 ? firstNumber(r[value]) : null
        if (/%/.test(r[used]) && u != null) pct = u / 100
        else if (u != null && v) pct = u / v
      }
      const said = line.match(/(\d+(?:[.,]\d+)?)\s*%\s*of the (?:free )?limit/i)
      if (pct == null && said) pct = Number(said[1].replace(',', '.')) / 100
      if (pct != null) {
        summary.usageRows++
        if (pct >= USAGE_FLAG) summary.flags.push({ kind: 'usage', what, pct: Math.round(pct * 1000) / 10 })
      }
      const due = refresh >= 0 ? r[refresh]?.match(DATE)?.[1] : null
      if (due && dayDiff(today, due) < 0) summary.flags.push({ kind: 'refresh-passed', what, date: due })
      const anyDate = (read >= 0 && DATE.test(r[read] ?? '')) || due || DATE.test(line)
      if (!anyDate) summary.flags.push({ kind: 'no-date', what })
    }
  }
  return summary
}

export function readCosts(text, today, file, project) {
  const out = []
  for (const t of tables(text)) {
    const when = col(t.header, /renew|next bill|bills on|ends?\b|due/)
    if (when < 0) continue
    const cost = col(t.header, /cost|price|plan/)
    for (const r of t.rows) {
      const date = r[when]?.match(DATE)?.[1] ?? null
      const left = date ? dayDiff(today, date) : null
      out.push({
        project,
        file,
        service: r[0],
        cost: cost >= 0 ? r[cost] : '',
        date,
        daysLeft: left,
        status: !date ? 'no-date' : left < 0 ? 'passed' : left <= WARN_DAYS ? 'warn' : 'ok',
      })
    }
  }
  return out
}

function expand(p, home) {
  return p.replace(/^~(?=\/|$)/, home).replace(/\/?$/, '/')
}

// Each project's plans folder, once (two projects sharing the default folder read it once).
export function projects(desktop, home) {
  const seen = new Map()
  if (!existsSync(desktop)) return []
  for (const name of readdirSync(desktop).sort()) {
    const kitFile = join(desktop, name, '.claude', 'kit.json')
    if (!existsSync(kitFile)) continue
    let kit = {}
    try {
      kit = JSON.parse(readFileSync(kitFile, 'utf8'))
    } catch {
      continue
    }
    const plans = expand(kit.plans || '~/.claude/plans/', home)
    if (!seen.has(plans)) seen.set(plans, { name: kit.project?.name || kit.name || name, plans })
  }
  return [...seen.values()]
}

export function scan({ home = homedir(), desktop = join(home, 'Desktop'), today }) {
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null)
  const tilde = (f) => (f.startsWith(home) ? '~' + f.slice(home.length) : f)
  const list = projects(desktop, home)
  const trialFiles = [join(home, '.claude', 'plans', 'trials.md'), ...list.map((p) => p.plans + 'trials.md')]
  const trials = [...new Set(trialFiles)].flatMap((f) => {
    const text = read(f)
    return text ? readTrials(text, today, tilde(f)) : []
  })
  const freeTiers = []
  const costs = []
  for (const p of list) {
    const ft = read(p.plans + 'free-tiers.md')
    if (ft) freeTiers.push(readFreeTiers(ft, today, tilde(p.plans + 'free-tiers.md'), p.name))
    const c = read(p.plans + 'costs.md')
    if (c) costs.push(...readCosts(c, today, tilde(p.plans + 'costs.md'), p.name))
  }
  return {
    today,
    trialsLedger: existsSync(trialFiles[0]) ? tilde(trialFiles[0]) : null,
    projects: list.map((p) => ({ name: p.name, plans: tilde(p.plans) })),
    trials,
    freeTiers,
    costs,
  }
}

const days = (n) => `${n} day${n === 1 ? '' : 's'}`
const mark = (s) => (s === 'ended' || s === 'passed' || s === 'warn' ? '!!' : s === 'ok' ? '  ' : ' !')

export function render(r) {
  const out = [`scrooge · ${r.today}`, '']
  out.push(`Trials (${r.trialsLedger ?? 'no ledger at ~/.claude/plans/trials.md'})`)
  if (!r.trials.length) out.push('   none recorded')
  for (const t of r.trials) {
    const when = !t.ends
      ? 'no end date'
      : t.daysLeft < 0
        ? `ended ${t.ends}${t.approx ? ' (approx.)' : ''}, ${days(-t.daysLeft)} ago`
        : `ends ${t.ends}${t.approx ? ' (approx.)' : ''}, ${days(t.daysLeft)} left, warning from ${t.warnFrom}`
    // An unknown card on a live trial is a flag too: it decides whether the end bills.
    const m = t.status === 'ok' && /^(unknown|yes)$/i.test(t.card) ? ' !' : mark(t.status)
    out.push(`${m} ${t.service}${t.account ? ` (${t.account})` : ''}: ${when}; card on file: ${t.card}`)
    if (t.atEnd) out.push(`     at the end: ${t.atEnd}`)
  }
  out.push('', 'Free tiers')
  if (!r.freeTiers.length) out.push('   no free-tiers.md found')
  for (const f of r.freeTiers) {
    const age = !f.checked
      ? 'no Checked: date'
      : f.stale
        ? `checked ${f.checked}, refresh overdue since ${f.refreshDue}`
        : `checked ${f.checked}, refresh due ${f.refreshDue} (${days(f.refreshDaysLeft)})`
    const usage = f.usageRows ? `${f.usageRows} with usage recorded` : 'no usage recorded'
    out.push(`${f.stale || f.flags.length ? ' !' : '  '} ${f.project}: ${age}; ${f.rows} rows, ${usage}`)
    for (const g of f.flags) {
      if (g.kind === 'usage') out.push(` !   ${g.what}: ${g.pct}% of the limit`)
      if (g.kind === 'refresh-passed') out.push(` !   ${g.what}: refresh date ${g.date} passed`)
      if (g.kind === 'no-date') out.push(` !   ${g.what}: no date`)
    }
  }
  out.push('', 'Cost lists')
  if (!r.costs.length) out.push(`   none found (looked for <plans>costs.md in ${r.projects.length} projects)`)
  for (const c of r.costs) {
    const when = c.date ? `${c.status === 'passed' ? 'was due' : 'next'} ${c.date} (${days(Math.abs(c.daysLeft))})` : 'no date'
    out.push(`${mark(c.status)} ${c.project}: ${c.service}${c.cost ? `, ${c.cost}` : ''}: ${when}`)
  }
  return out.join('\n')
}

function stockholmToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const home = opt('--home') ?? homedir()
  const result = scan({ home, desktop: opt('--desktop') ?? join(home, 'Desktop'), today: opt('--today') ?? stockholmToday() })
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : render(result))
}
