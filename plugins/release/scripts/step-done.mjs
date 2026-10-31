#!/usr/bin/env node
// The navigator's bookkeeping after a step, in one call (kit 1.8, council H4,
// Features 1 and 3). After each builder returned, `captain-call` ran Skyler's
// timeline, added a budget row to the PR, copied the cheaper line under
// "Notes for review", ticked a box: four or five calls on a 300k+ context,
// 10 to 20 % of a navigator's tokens per release. This does them as one.
//
// Usage: node step-done.mjs <agent> --step "<label>" --budget <N>M --session <transcript id>
//          [--pr <n>] [--cheaper "<line>"] [--tag order|route|rule|drop]
//          [--tick "<checkbox text>"] [--plan <plan file>] [--dir <transcript dir>]
//          [--hank-log <file>] [--dry]
//
// 1. Reads the agent's used tokens and whether Hank stopped it from Skyler
//    (usage.mjs's budgetRows, imported, so the numbers are the ones Hank and
//    the PR's Usage section use). The agent is its name or an agent id
//    prefix; with several spawns of one name, the latest.
// 2. Appends one row (last, once step 3's PR edit went through) to the steps file beside the plan: `<plan>-steps.tsv`
//    (V2.3.md -> V2.3-steps.tsv). Beside the plan because the notes file
//    already lives there and c-3po and future-ted know the folder; TSV because
//    a row is one append with no parsing, and `column -t` or a spreadsheet
//    reads it. c-3po's Budget table and future-ted read this file, not twelve
//    navigator turns.
// 3. With --pr, ONE body edit: the budget table row, the cheaper line under
//    "Notes for review" with its tag, the --tick box ticked, and the cost line
//    `Spent: N of M expected (P %)` refreshed (M from the plan's
//    `Expected: ≈ NM` headline, N the session's total). Two lanes ticking
//    the same body lost a tick (council M11), so the body is re-read right
//    before the write and the edit redone once if it changed under us.
// --dry prints the steps row and the new body instead of writing either.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExpected } from '../../core/scripts/plan-check.mjs'
import { budgetRows, budgetTableMarkdown, hankBudgets, projectDir, readEntries, resolveSession, tallyEntries, totalTokens } from './usage.mjs'

export const TAGS = ['order', 'route', 'rule', 'drop']
export const STEPS_HEADER = ['when', 'agent', 'step', 'budget', 'used', 'stopped', 'tag', 'cheaper']
const BUDGET_HEADER = '| Agent | Step | Budget | Used | Stopped by Hank |'

const fmtM = (t) => `${(t / 1e6).toFixed(1)}M`

// "15M", "15", "800k" -> tokens; null when it doesn't parse.
export function parseBudgetArg(s) {
  const m = /^\s*([\d.]+)\s*([mk])?\s*$/i.exec(String(s ?? ''))
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  return (m[2]?.toLowerCase() === 'k' ? 1e3 : 1e6) * n
}

// The plan's headline `Expected: ≈ 260M` -> tokens: core's plan-check parser, so
// the cost line and /inception's item 2 read the same line the same way.
export { parseExpected }

export function stepsFileFor(plan) {
  return join(dirname(plan), `${basename(plan).replace(/\.md$/, '')}-steps.tsv`)
}

// The latest spawn whose name or agent id matches.
export function pickRow(rows, agent) {
  const hits = rows.filter((r) => r.agent === agent || (agent.length >= 6 && String(r.agentId).startsWith(agent)))
  return hits.length ? hits[hits.length - 1] : null
}

// The session's whole total (navigator plus agents), counted as usage.mjs's
// main does: one seen set across files, so a forked copy counts once.
export function sessionTotal(baseDir, sessionId) {
  const { mainFile, subDir, subFiles } = resolveSession(baseDir, sessionId)
  const seen = new Set()
  let sum = 0
  for (const f of [mainFile, ...subFiles.map((s) => join(subDir, s))]) {
    for (const b of tallyEntries(readEntries(f, seen)).values()) sum += totalTokens(b)
  }
  return sum
}

const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim()

export function stepsLine({ when, agent, step, budget, used, stopped, tag, cheaper }) {
  return [when, agent, step, budget ? fmtM(budget) : '', fmtM(used), stopped ? 'yes' : 'no', tag ?? '', cheaper ?? ''].map(clean).join('\t')
}

export function appendSteps(file, line) {
  const head = existsSync(file) ? '' : `${STEPS_HEADER.join('\t')}\n`
  appendFileSync(file, `${head}${line}\n`)
}

export function costLine(spent, expected) {
  return `Spent: ${fmtM(spent)} of ${fmtM(expected)} expected (${Math.round((spent / expected) * 100)} %)`
}

// Where a new section goes: before the Claude Code footer when there is one.
function insertSection(lines, section) {
  const foot = lines.findIndex((l) => /^🤖 Generated with/.test(l))
  const at = foot === -1 ? lines.length : foot
  const block = ['', ...section, '']
  lines.splice(at, 0, ...block)
}

// The end of the section a heading starts: the next heading of any level, or the end.
function sectionEnd(lines, from) {
  let i = from + 1
  while (i < lines.length && !/^#{1,6}\s/.test(lines[i]) && !/^🤖 Generated with/.test(lines[i])) i++
  // back over trailing blank lines, so the insert sits right after the content
  while (i - 1 > from && lines[i - 1].trim() === '') i--
  return i
}

/**
 * The new PR body. Pure: every change is a no-op when its input is missing.
 * Returns { body, notes } where notes says what didn't land (a box not found).
 */
export function editBody(body, { budgetRow, cheaper, tick, cost }) {
  const lines = String(body ?? '').split('\n')
  const notes = []

  if (cost) {
    const at = lines.findIndex((l) => /^Spent: .* expected \(/.test(l))
    if (at !== -1) lines[at] = cost
    else lines.unshift(cost, '')
  }

  if (budgetRow) {
    const head = lines.findIndex((l) => l.trim() === BUDGET_HEADER)
    if (head === -1) insertSection(lines, ['## Budget', '', BUDGET_HEADER, '|---|---|---|---|---|', budgetRow])
    else {
      let i = head + 1
      while (i < lines.length && lines[i].trim().startsWith('|')) i++
      lines.splice(i, 0, budgetRow)
    }
  }

  if (cheaper) {
    const head = lines.findIndex((l) => /^#{1,6}\s+Notes for review\b/i.test(l))
    if (head === -1) insertSection(lines, ['## Notes for review', '', cheaper])
    else lines.splice(sectionEnd(lines, head), 0, cheaper)
  }

  if (tick) {
    const hits = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*- \[[ xX]\] /.test(l) && l.includes(tick))
    if (hits.length === 0) notes.push(`no box with "${tick}"`)
    else if (hits.length > 1) notes.push(`${hits.length} boxes with "${tick}", none ticked`)
    else {
      const [l, i] = hits[0]
      lines[i] = l.replace(/- \[ \] /, '- [x] ')
    }
  }
  return { body: lines.join('\n'), notes }
}

// The real gh, as a function the tests replace: (args, input) -> stdout.
export function realGh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
}

const readBody = (gh, pr) => JSON.parse(gh(['pr', 'view', String(pr), '--json', 'body'])).body ?? ''

/**
 * One PR body edit with the M11 guard: read, edit, re-read; when the body
 * moved under us, redo the edit on the fresh body once. A second move gives up
 * rather than write over another lane's edit.
 */
export function updatePr({ gh, pr, changes, dry = false }) {
  let before = readBody(gh, pr)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { body, notes } = editBody(before, changes)
    if (dry) return { body, notes, written: false, retried: attempt > 0 }
    const now = readBody(gh, pr)
    if (now === before) {
      if (body !== before) gh(['pr', 'edit', String(pr), '--body-file', '-'], body)
      return { body, notes, written: body !== before, retried: attempt > 0 }
    }
    before = now
  }
  throw new Error(`PR #${pr}'s body changed twice while editing it; nothing written. Run step-done again.`)
}

export function parseArgs(argv) {
  const o = { agent: null, step: '', budget: null, session: null, pr: null, cheaper: null, tag: null, tick: null, plan: null, dir: null, hankLog: null, dry: false }
  const val = { '--step': 'step', '--budget': 'budget', '--session': 'session', '--pr': 'pr', '--cheaper': 'cheaper', '--tag': 'tag', '--tick': 'tick', '--plan': 'plan', '--dir': 'dir', '--hank-log': 'hankLog' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry') o.dry = true
    else if (val[a]) o[val[a]] = argv[++i]
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else if (!o.agent) o.agent = a
    else throw new Error(`Unexpected argument ${a}`)
  }
  if (!o.agent || !o.session) throw new Error('Need <agent> and --session <transcript id>')
  if (o.budget != null) {
    const b = parseBudgetArg(o.budget)
    if (b == null) throw new Error(`--budget ${o.budget}: give it as 12M`)
    o.budget = b
  }
  if (o.tag && !TAGS.includes(o.tag)) throw new Error(`--tag must be one of ${TAGS.join(', ')}`)
  if (o.cheaper && !o.tag) throw new Error('--cheaper needs its --tag (order, route, rule or drop)')
  return o
}

/** The whole run, every outside thing passed in, so a test needs no real ~/.claude or gh. */
export function run(o, { budgets, gh = realGh, now = new Date(), log = console.log } = {}) {
  const baseDir = projectDir(o.dir)
  const row = pickRow(budgetRows(baseDir, [o.session], { budgets, hankLog: o.hankLog }), o.agent)
  if (!row) throw new Error(`No spawn of "${o.agent}" in session ${o.session}`)
  const budget = o.budget ?? row.budget
  const step = o.step || row.step
  const stamp = `${now.toISOString().slice(0, 16)}Z`

  const line = stepsLine({ when: stamp, agent: row.agent, step, budget, used: row.tokens, stopped: row.stopped, tag: o.tag, cheaper: o.cheaper })
  // The steps row lands last, after the PR edit succeeded: a PR edit that
  // throws (the body moved twice) used to leave the row behind, and the rerun
  // the error asks for appended it a second time.
  const writeSteps = () => {
    if (!o.plan) return log('no --plan: no steps file and no cost line')
    const file = stepsFileFor(o.plan)
    if (o.dry) log(`steps file ${file} would get:\n${line}`)
    else appendSteps(file, line)
  }

  if (o.pr == null) {
    writeSteps()
    log(`${row.agent}: ${step}, ${fmtM(row.tokens)} of ${budget ? fmtM(budget) : 'no budget'}${row.stopped ? ', stopped by Hank' : ''}`)
    return { row, line }
  }
  let cost = null
  if (o.plan) {
    const expected = parseExpected(readFileSync(o.plan, 'utf8'))
    if (expected) cost = costLine(sessionTotal(baseDir, o.session), expected)
    else log(`no "Expected: ≈ NM" line in ${o.plan}: cost line left as it was`)
  }
  const budgetRow = budgetTableMarkdown([{ ...row, step, budget, tagged: o.budget != null || row.tagged }]).split('\n')[2]
  const cheaper = o.cheaper ? `- \`${o.tag}\` ${row.agent} (${clean(step)}): ${clean(o.cheaper)}` : null
  const res = updatePr({ gh, pr: o.pr, changes: { budgetRow, cheaper, tick: o.tick, cost }, dry: o.dry })
  writeSteps()
  if (o.dry) log(`PR #${o.pr} body would be:\n${res.body}`)
  else log(`PR #${o.pr}: ${res.written ? 'updated' : 'unchanged'}${res.retried ? ' (body moved under us, redone once)' : ''}${cost ? `; ${cost}` : ''}`)
  for (const n of res.notes) log(`note: ${n}`)
  return { row, line, ...res }
}

// Node runs the real file, so a symlinked path compares as its real URL.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const o = parseArgs(process.argv.slice(2))
    run(o, { budgets: await hankBudgets() })
  } catch (err) {
    console.error(err.message)
    console.error('Usage: node step-done.mjs <agent> --step "<label>" --budget <N>M --session <id> [--pr <n>] [--cheaper "<line>" --tag order|route|rule|drop] [--tick "<box text>"] [--plan <plan file>] [--dry]')
    process.exit(1)
  }
}
