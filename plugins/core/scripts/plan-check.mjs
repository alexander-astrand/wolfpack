#!/usr/bin/env node
// `/inception`'s checklist items 1, 2, 10 and 12 run mechanically, so the
// navigator stamps on a clean exit instead of re-reading the planner's table
// (kit 1.8, council F5 and H7: eight inceptions cost 198.8M, most of it the
// navigator reading; stamped plans ran the reviewer on Opus with no reason,
// and V1.5 carried two Opus reviews). Lessons `[grep-first]`, `[intent-trace]`.
//
// Usage: node plan-check.mjs <plan file> [--agents <kit plugins dir>] [--json]
//
// Checks every markdown table whose header names a `Step` (or `Id`) and a
// `Budget` (or `Tag`, `Ceiling`) column (a chain plan has one per link):
//   item 1  every step row has a budget (`7M`, `≈ 10M`); a human row
//           (agent Alexander, or no agent) is exempt;
//   item 2  the plan carries one `Expected: ≈ <N>M` line (or the older
//           `Expected real spend ≈ <N>M`);
//   item 10 every build row names a file:line it grepped (`lib/x.ts:34`);
//           review, QA, docs, deploy and human rows are exempt, and a row
//           whose cell says `none: <why>` (a fix order sized from findings
//           that don't exist yet) passes;
//   item 12 a row whose model is above the agent's route (its agent file's
//           `model:`; haiku < sonnet < opus < fable) gives the reason in its
//           row: words after the model in the Model cell, or "because" or
//           "reason" anywhere in the row;
//   stamp   a reviewer row (`kissochbajslowski`) on Opus or above without a
//           reason, or a second such row even with one, refuses the stamp.
// Prints one line per failure and exits 1, or `plan-check: ok (<n> steps)`.
// Read-only: it never edits the plan.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RANK = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }
// Rows that size nothing in the code: review, QA, docs, deploy, pages, people.
export const NO_FILE_LINE = ['kissochbajslowski', 'daredevil', 'bengt-johansson', 'ranjit', 'jesse-pinkman', 'c-3po', 'r2-d2', 'alexander', 'darth-vader']
export const REVIEWERS = ['kissochbajslowski']
const EFFORT = /\b(low|medium|high|xhigh|max|effort)\b/gi

// Planners have spelled the columns several ways (Burrow V1.4 `Ceiling` and
// `Agent · model`, V1.5 `Id` and `Tag`).
const isStep = (h) => ['step', 'id', '#'].includes(h)
const isBudget = (h) => /^(budget|tag|ceiling|cap)\b/.test(h)

// Split a table row on `|`, but not inside backticks or after a backslash
// (orders write `Enter|Tab` in a cell).
export function cells(line) {
  const out = []
  let cur = ''
  let tick = false
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (c === '`') tick = !tick
    if (c === '|' && !tick) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  out.push(cur.trim())
  return out
}

// Every step table in the plan: { header: [..], rows: [{ line, cells }] }.
export function stepTables(text) {
  const lines = text.split('\n')
  const tables = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue
    const header = cells(lines[i]).map((h) => h.toLowerCase())
    if (!header.some(isStep) || !header.some(isBudget)) continue
    const rows = []
    let j = i + 2
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push({ line: j + 1, cells: cells(lines[j]) })
    tables.push({ header, rows })
    i = j
  }
  return tables
}

// The route model per agent, from each plugin's agents/<name>.md frontmatter.
export function agentModels(pluginsDir) {
  const map = {}
  if (!existsSync(pluginsDir)) return map
  for (const plugin of readdirSync(pluginsDir)) {
    const dir = join(pluginsDir, plugin, 'agents')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const m = readFileSync(join(dir, f), 'utf8').match(/^model:\s*(\w+)/m)
      if (m) map[f.slice(0, -3)] = m[1].toLowerCase()
    }
  }
  return map
}

const modelOf = (cell) => {
  const m = (cell || '').toLowerCase().match(/\b(haiku|sonnet|opus|fable)\b/)
  return m ? m[1] : null
}

// The first known agent named in the cell ("kissochbajslowski + daredevil",
// "ranjit via `/skinny-pete`"), else the cell's first word.
const agentOf = (cell, models) => {
  const low = (cell || '').toLowerCase()
  const names = [...Object.keys(models), ...NO_FILE_LINE].sort((a, b) => b.length - a.length)
  const hit = names.filter((n) => low.includes(n)).sort((a, b) => low.indexOf(a) - low.indexOf(b))[0]
  return hit || low.replace(/[`*]/g, '').trim().split(/\s+/)[0] || ''
}

// The agent name is stripped first: an `Agent · model` cell holds both.
const hasReason = (modelCell, rowText, agent) => {
  const rest = (modelCell || '').toLowerCase().split(agent || '\u0000').join(' ').replace(/\b(haiku|sonnet|opus|fable)\b/gi, '').replace(EFFORT, '').replace(/[^a-z0-9 ]/gi, ' ').trim()
  return rest.split(/\s+/).filter(Boolean).length >= 2 || /\b(because|reason)\b/i.test(rowText)
}

export function check(text, models = {}) {
  const fails = []
  const tables = stepTables(text)
  if (!tables.length) return { steps: 0, fails: ['no step table: a table with a Step and a Budget column'] }
  if (!/\bExpected(?: real spend)?\*{0,2}\s*[:≈]\s*\*{0,2}≈?\s*\d/i.test(text)) fails.push('item 2: no `Expected: ≈ <N>M` line (the headline is the expected real spend)')
  let steps = 0
  let opusReviews = 0
  for (const t of tables) {
    const col = (pred) => t.header.findIndex(pred)
    const cStep = col(isStep)
    const cAgent = col((h) => h.startsWith('agent') || h === 'who')
    const cModel = col((h) => h.startsWith('model') || (h.startsWith('agent') && h.includes('model')))
    const cBudget = col(isBudget)
    for (const r of t.rows) {
      const c = r.cells
      const id = c[cStep] || `line ${r.line}`
      const where = `step ${id} (line ${r.line})`
      const text = c.join(' | ')
      const agentCell = cAgent >= 0 ? c[cAgent] : ''
      const agent = agentOf(agentCell, models)
      const human = !agentCell || /^-*$/.test(agentCell) || agent === 'alexander' || /\bhuman\b/i.test(agentCell)
      if (human) continue
      steps++
      if (!/\d+(\.\d+)?\s*M\b/.test(c[cBudget] || '')) fails.push(`item 1: ${where}: no budget`)
      if (!NO_FILE_LINE.includes(agent) && !/[\w./-]+\.[a-z]{1,5}:\d+/i.test(text) && !/(^|\|)\s*(none|n\/a):\s*\S/i.test(text)) fails.push(`item 10: ${where}: no file:line beside the step`)
      const model = cModel >= 0 ? modelOf(c[cModel]) : null
      const route = models[agent]
      const reason = hasReason(cModel >= 0 ? c[cModel] : '', text, agent)
      if (model && route && RANK[model] > RANK[route] && !reason) fails.push(`item 12: ${where}: ${agent} on ${model} above its ${route} route, no reason in the row`)
      if (REVIEWERS.includes(agent) && model && RANK[model] >= RANK.opus) {
        opusReviews++
        if (!reason) fails.push(`stamp: ${where}: reviewer on ${model} without a reason`)
        else if (opusReviews > 1) fails.push(`stamp: ${where}: a second reviewer row on ${model}; one at most, with its reason`)
      }
    }
  }
  return { steps, fails }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--agents')
  if (!file) {
    console.error('usage: node plan-check.mjs <plan file> [--agents <plugins dir>] [--json]')
    process.exit(2)
  }
  const ai = args.indexOf('--agents')
  const pluginsDir = ai >= 0 ? resolve(args[ai + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const res = check(readFileSync(file, 'utf8'), agentModels(pluginsDir))
  if (args.includes('--json')) console.log(JSON.stringify(res))
  else if (res.fails.length) console.log(res.fails.join('\n'))
  else console.log(`plan-check: ok (${res.steps} steps)`)
  process.exit(res.fails.length ? 1 : 0)
}
