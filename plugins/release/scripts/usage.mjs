#!/usr/bin/env node
// Sums Claude Code token usage per model for one or more sessions, so a
// release's PR can carry a "Usage" section in one command (the Fable-navigator
// trial from 2.7: usage was tallied by hand from a one-off Python script).
//
// Usage: node scripts/usage.mjs [--commits N] [--json] [--timeline]
//          [--chart out.html [--decisions decided.md]] <session-id> [<session-id>…]
// Session IDs may be given as a prefix, resolved against the transcript
// directory (derived from process.cwd(), or --dir <path>). A `local_<uuid>` id
// (what get_session self returns) is resolved to its transcript id first.
//
// --timeline adds one row per agent (who ran when, on which model, how many
// calls and screenshots): 2.8.2 showed wall-clock comes from call counts and
// agents running one after another, which per-model totals can't show.
// --chart writes that timeline as a self-contained swimlane page for wrap-ups.
//
// Nickname: Skyler (she keeps the books). Hank, the budget hook
// (this plugin's hooks/budget-cap.mjs), imports the counting functions below, so an
// agent is stopped on the same numbers the PR's Usage section shows.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

function projectDir(dir) {
  if (dir) return dir
  return join(homedir(), '.claude', 'projects', process.cwd().replace(/\//g, '-'))
}

// The desktop app's `get_session self` gives `local_<uuid>`, not the transcript
// id. The app keeps <base>/<a>/<b>/local_<uuid>.json with the transcript's id in
// "cliSessionId"; USAGE_SESSIONS_DIR points a test at a fixture folder.
export function resolveLocalId(localId, base = process.env.USAGE_SESSIONS_DIR || join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')) {
  const dirs = (p) => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(p, e.name))
    } catch {
      return []
    }
  }
  for (const a of dirs(base)) {
    for (const b of dirs(a)) {
      try {
        const id = JSON.parse(readFileSync(join(b, `${localId}.json`), 'utf8')).cliSessionId
        if (id) return id
      } catch {
        // not in this folder, or not readable: try the next
      }
    }
  }
  throw new Error(`No session file for "${localId}" under ${base}`)
}

// A session-id prefix's transcript file, and its subagents' files if any.
function resolveSession(dir, idPrefix) {
  if (/^local_/.test(idPrefix)) idPrefix = resolveLocalId(idPrefix)
  const match = readdirSync(dir).find((e) => e.startsWith(idPrefix) && e.endsWith('.jsonl'))
  if (!match) throw new Error(`No session transcript matching "${idPrefix}" in ${dir}`)
  const id = match.slice(0, -'.jsonl'.length)
  const subDir = join(dir, id, 'subagents')
  let subFiles = []
  try {
    subFiles = readdirSync(subDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    // no subagents directory: a session can run with none
  }
  return { id, mainFile: join(dir, match), subDir, subFiles }
}

// A subagent's sibling .meta.json ({agentType, description, …}), or {}.
function readMeta(subDir, jsonlName) {
  try {
    return JSON.parse(readFileSync(join(subDir, jsonlName.replace(/\.jsonl$/, '.meta.json')), 'utf8'))
  } catch {
    return {}
  }
}

// The agents were renamed in 2.10; transcripts from earlier releases carry the
// old names, so they're shown under the new ones and timelines compare across releases.
const RENAMED = {
  scout: 'lorenzo-von-matterhorn', 'test-runner': 'romeo-olsson', planner: 'admiral-ackbar',
  builder: 'chris-de-kok', designer: 'mosbius-designs', 'db-engineer': 'the-playbook',
  debugger: 'boba-fett', qa: 'bengt-johansson', 'release-reviewer': 'kissochbajslowski',
  documenter: 'c-3po', 'prod-deployer': 'ranjit', 'senior-opus': 'yoda', 'senior-fable': 'farbror-vattenmelon',
}

// Every agent in .claude/agents/. An agent spawned before its file existed (or
// as a generic one) runs as "claude" or "general-purpose"; maverick starts
// every description with the agent's name ("heisenberg: creative brief …"),
// so that prefix names it instead.
export const AGENTS = new Set([
  'lorenzo-von-matterhorn', 'admiral-ackbar', 'heisenberg', 'chris-de-kok', 'jesse-pinkman',
  'mosbius-designs', 'the-playbook', 'boba-fett', 'romeo-olsson', 'kissochbajslowski', 'c-3po',
  'ranjit', 'yoda', 'farbror-vattenmelon', 'bengt-johansson',
  // The builder pool beside chris-de-kok (2.10.2).
  'ahmed-och-ahmed', 'saul-goodman', 'jeff-winger', 'troy-and-abed',
  // Added since, so a generic spawn named by its description prefix still gets
  // its own Hank budget (2.12.2).
  'dom-cobb', 'tomas-svensson', 'magnus-wislander', 'staffan-olsson', 'stefan-lovgren',
  'daredevil', 'mike-ehrmantraut', 'three-eyed-raven',
])

export function agentName(meta) {
  const raw = meta.agentType || meta.agent_type || meta.subagentType || meta.subagent_type || null
  const name = RENAMED[raw] ?? raw
  if (name && AGENTS.has(name)) return name
  const prefix = /^\s*([a-z0-9-]+)\s*:/.exec(meta.description || '')?.[1]
  return prefix && AGENTS.has(prefix) ? prefix : name
}

// Every parseable entry of a transcript's text; lines that don't parse are skipped.
export function parseEntries(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const e = JSON.parse(line)
      if (e) out.push(e)
    } catch {
      continue
    }
  }
  return out
}

// Every parseable entry of a transcript file.
function readEntries(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  return parseEntries(text)
}

// Tally calls (assistant messages) and token usage per model. Entries without
// message.usage are skipped. Claude Code writes one transcript line per content
// block (thinking, text, each tool_use) and every one carries the message's
// whole usage, so a message.id counts once, from its first line (2.14 counted
// 610.0M for 251.1M real). Lines without an id are counted as before.
export function tallyEntries(entries) {
  const by = new Map()
  const seen = new Set()
  for (const e of entries) {
    const m = typeof e.message === 'object' ? e.message : null
    if (!m || !m.usage) continue
    if (m.id) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
    }
    const u = m.usage
    const b = by.get(m.model) || { calls: 0, inp: 0, cc: 0, cr: 0, out: 0 }
    b.calls += 1
    b.inp += u.input_tokens || 0
    b.cc += u.cache_creation_input_tokens || 0
    b.cr += u.cache_read_input_tokens || 0
    b.out += u.output_tokens || 0
    by.set(m.model || '?', b)
  }
  return by
}

export const totalTokens = (b) => b.inp + b.cc + b.cr + b.out
const fmtM = (t) => `${(t / 1_000_000).toFixed(1)}M`
const fmtPct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%')
const shortModel = (m) => (/(haiku|sonnet|opus|fable)/i.exec(m || '') || ['?'])[0].toLowerCase()
// UTC with a Z, so a timeline reads the same wherever it's printed.
export const hhmm = (ms) => `${new Date(ms).toISOString().slice(11, 16)}Z`
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// A pause longer than this is idle time (waiting on a person, or an agent
// parked between SendMessage follow-ups), not work: it splits a bar and
// doesn't count towards minutes.
const IDLE_MS = 10 * 60_000

// Screenshots in one tool call: a `computer` screenshot or zoom (both return an
// image, which is what makes them dear), directly or inside a browser_batch.
export function shotsIn(name, input) {
  const isShot = (n, i) => /computer$/.test(n || '') && i && (i.action === 'screenshot' || i.action === 'zoom')
  let shots = isShot(name, input) ? 1 : 0
  for (const a of Array.isArray(input?.actions) ? input.actions : []) if (isShot(a.name, a.input)) shots += 1
  return shots
}

// Tool calls, and screenshots among them, across a transcript's assistant entries.
export function countCalls(entries) {
  let calls = 0
  let shots = 0
  for (const e of entries) {
    const content = e.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : []
    for (const c of content) {
      if (c.type !== 'tool_use') continue
      calls += 1
      shots += shotsIn(c.name, c.input)
    }
  }
  return { calls, shots }
}

// Active spans: runs of timestamps with no gap longer than IDLE_MS.
function activeSpans(entries) {
  const times = entries
    .map((e) => Date.parse(e.timestamp))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)
  const spans = []
  for (const t of times) {
    const last = spans[spans.length - 1]
    if (last && t - last[1] <= IDLE_MS) last[1] = t
    else spans.push([t, t])
  }
  return spans
}

// One timeline row for a transcript: when it ran, on which model, how busy.
function timelineRow(entries, label, type, sessionId) {
  const by = tallyEntries(entries)
  let tokens = 0
  let topModel = '?'
  let topTokens = -1
  for (const [model, b] of by) {
    tokens += totalTokens(b)
    if (totalTokens(b) > topTokens) [topModel, topTokens] = [model, totalTokens(b)]
  }
  const spans = activeSpans(entries)
  const minutes = spans.reduce((sum, [a, b]) => sum + (b - a), 0) / 60_000
  return {
    session: sessionId,
    description: label,
    type,
    model: shortModel(topModel),
    start: spans.length ? spans[0][0] : null,
    end: spans.length ? spans[spans.length - 1][1] : null,
    minutes: Math.round(minutes),
    ...countCalls(entries),
    tokens,
    spans,
  }
}

function parseArgs(argv) {
  const opts = { commits: null, json: false, dir: null, timeline: false, chart: null, decisions: null, sessionIds: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--commits') opts.commits = Number(argv[++i])
    else if (argv[i] === '--json') opts.json = true
    else if (argv[i] === '--dir') opts.dir = argv[++i]
    else if (argv[i] === '--timeline') opts.timeline = true
    else if (argv[i] === '--chart') opts.chart = argv[++i]
    else if (argv[i] === '--decisions') opts.decisions = argv[++i]
    else opts.sessionIds.push(argv[i])
  }
  if (opts.chart) opts.timeline = true
  return opts
}

function timelineTable(timeline, sessions) {
  const rows = [
    '| Agent | Type | Model | Start | End | Min | Calls | Shots | Tokens |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const r of timeline) {
    const [s, e] = r.start ? [hhmm(r.start), hhmm(r.end)] : ['–', '–']
    rows.push(
      `| ${truncate(r.description, 40)} | ${r.type} | ${r.model} | ${s} | ${e} | ${r.minutes} | ${r.calls} | ${r.shots} | ${fmtM(r.tokens)} |`,
    )
  }
  return [rows.join('\n'), '', ...sessions.map(wallClockLine)].join('\n')
}

// Wall-clock from a session's first entry to its last, against the summed
// active minutes of everyone in it: above 100% means agents ran side by side.
function wallClockLine(s) {
  const wall = Math.round((s.last - s.first) / 60_000)
  const h = `${Math.floor(wall / 60)}h ${String(wall % 60).padStart(2, '0')}m`
  return `Wall-clock ${s.id.slice(0, 8)}: ${h} (${hhmm(s.first)}–${hhmm(s.last)}); agent-minutes ${s.agentMinutes} = ${fmtPct(s.agentMinutes, wall)} of wall-clock`
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const inlineMd = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

// The chart page: a swimlane per agent over the time axis, bars coloured by
// model, then the timeline table and the release's decisions.
function chartHtml(timeline, sessions, decisionsMd, title) {
  const rows = timeline.filter((r) => r.start)
  const t0 = Math.min(...rows.map((r) => r.start))
  const t1 = Math.max(...rows.map((r) => r.end), t0 + 60_000)
  const W = 960
  const PAD = 12
  const LANE = 40
  const H = rows.length * LANE + 36
  const x = (t) => PAD + ((t - t0) / (t1 - t0)) * (W - 2 * PAD)
  const stepMin = [10, 15, 30, 60, 120, 240].find((m) => (t1 - t0) / (m * 60_000) <= 10) || 480
  const ticks = []
  for (let t = Math.ceil(t0 / (stepMin * 60_000)) * stepMin * 60_000; t <= t1; t += stepMin * 60_000) {
    ticks.push(`<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 20}"/><text class="tick" x="${x(t)}" y="${H - 6}" text-anchor="middle">${hhmm(t)}</text>`)
  }
  const lanes = rows.map((r, i) => {
    const y = i * LANE
    const tip = `${r.description} (${r.type}, ${r.model}): ${r.minutes} min, ${r.calls} calls, ${r.shots} screenshots, ${fmtM(r.tokens)}`
    const bars = r.spans
      .map(([a, b]) => `<rect class="m-${r.model}" x="${x(a)}" y="${y + 18}" width="${Math.max(2, x(b) - x(a))}" height="16" rx="3"><title>${esc(tip)}</title></rect>`)
      .join('')
    const lx = Math.min(x(r.start), W - 300)
    return `<g>${bars}<text class="lbl" x="${lx}" y="${y + 13}">${esc(truncate(r.description, 40))} · ${r.minutes} min<title>${esc(tip)}</title></text></g>`
  })
  const table = rows
    .map((r) => `<tr><td>${esc(truncate(r.description, 40))}</td><td>${esc(r.type)}</td><td><span class="dot m-${r.model}"></span>${r.model}</td><td>${hhmm(r.start)}–${hhmm(r.end)}</td><td>${r.minutes}</td><td>${r.calls}</td><td>${r.shots}</td><td>${fmtM(r.tokens)}</td></tr>`)
    .join('')
  const bullets = (decisionsMd || '')
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => `<li>${inlineMd(l.replace(/^\s*[-*]\s+/, ''))}</li>`)
    .join('')
  const legend = ['haiku', 'sonnet', 'opus', 'fable'].map((m) => `<span><span class="dot m-${m}"></span>${m}</span>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#faf7f0;--ink:#2a2620;--muted:#6f675b;--line:#e2dccf;--haiku:#2f9e8f;--sonnet:#3d6fd6;--opus:#b8562f;--fable:#8a4fc4;--other:#999}
@media (prefers-color-scheme: dark){:root{--bg:#16171b;--ink:#ecebe7;--muted:#9b9a94;--line:#2c2e35;--haiku:#48c2b1;--sonnet:#6b95ee;--opus:#e0794e;--fable:#b07fe6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1000px;margin:0 auto;padding:20px 16px 40px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}
.sub,.tick,td:nth-child(n+4),th{color:var(--muted)}.legend{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.chart{overflow-x:auto}svg{display:block;min-width:640px;width:100%;height:auto}
.grid{stroke:var(--line)}.tick{font-size:11px;fill:var(--muted)}.lbl{font-size:12px;fill:var(--ink)}
.m-haiku{fill:var(--haiku);background:var(--haiku)}.m-sonnet{fill:var(--sonnet);background:var(--sonnet)}
.m-opus{fill:var(--opus);background:var(--opus)}.m-fable{fill:var(--fable);background:var(--fable)}.m-\\?{fill:var(--other);background:var(--other)}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td:first-child{white-space:normal;min-width:160px}code{font-size:12px}li{margin:4px 0}
</style></head><body><main>
<h1>${esc(title)}</h1>
${sessions.map((s) => `<p class="sub">${esc(wallClockLine(s))}</p>`).join('')}
<div class="legend">${legend}</div>
<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Agent timeline">${ticks.join('')}${lanes.join('')}</svg></div>
<h2>Who did what</h2>
<div class="tbl"><table><thead><tr><th>Agent</th><th>Type</th><th>Model</th><th>Time</th><th>Min</th><th>Calls</th><th>Shots</th><th>Tokens</th></tr></thead><tbody>${table}</tbody></table></div>
${bullets ? `<h2>Decisions on the way</h2><ul>${bullets}</ul>` : ''}
</main></body></html>
`
}

function main() {
  const { commits, json, dir, timeline: wantTimeline, chart, decisions, sessionIds } = parseArgs(process.argv.slice(2))
  if (sessionIds.length === 0) {
    console.error(
      'Usage: node <release plugin>/scripts/usage.mjs [--commits N] [--json] [--timeline] [--chart out.html [--decisions file.md]] <session-id> [<session-id>…]',
    )
    process.exit(1)
  }

  const baseDir = projectDir(dir)
  const parts = [] // { label, model, calls, tokens }
  const timeline = []
  const sessions = [] // { id, first, last, agentMinutes }
  for (const prefix of sessionIds) {
    const { id, mainFile, subDir, subFiles } = resolveSession(baseDir, prefix)
    const mainEntries = readEntries(mainFile)
    for (const [model, b] of tallyEntries(mainEntries)) {
      parts.push({ label: 'navigator', model, calls: b.calls, tokens: totalTokens(b) })
    }
    const rows = [timelineRow(mainEntries, 'navigator', 'navigator', id)]
    for (const subFile of subFiles) {
      const meta = readMeta(subDir, subFile)
      const label = agentName(meta) || subFile.replace(/\.jsonl$/, '')
      const entries = readEntries(join(subDir, subFile))
      for (const [model, b] of tallyEntries(entries)) {
        parts.push({ label, model, calls: b.calls, tokens: totalTokens(b) })
      }
      if (wantTimeline) rows.push(timelineRow(entries, meta.description || label, label, id))
    }
    if (wantTimeline) {
      const [nav, ...agents] = rows
      agents.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
      timeline.push(nav, ...agents)
      const all = rows.filter((r) => r.start)
      sessions.push({
        id,
        first: Math.min(...all.map((r) => r.start)),
        last: Math.max(...all.map((r) => r.end)),
        agentMinutes: rows.reduce((sum, r) => sum + r.minutes, 0),
      })
    }
  }

  const grandTotal = parts.reduce((sum, p) => sum + p.tokens, 0)
  const byModel = new Map()
  for (const p of parts) byModel.set(p.model, (byModel.get(p.model) || 0) + p.tokens)

  if (chart) {
    const md = decisions ? readFileSync(decisions, 'utf8') : ''
    writeFileSync(chart, chartHtml(timeline, sessions, md, `Timeline ${sessions.map((s) => s.id.slice(0, 8)).join(', ')}`))
  }

  if (json) {
    const out = {
      parts: parts.map((p) => ({ ...p, share: grandTotal > 0 ? p.tokens / grandTotal : 0 })),
      grandTotal,
      byModel: Object.fromEntries(byModel),
      commits,
      perCommit: commits ? grandTotal / commits : null,
    }
    if (wantTimeline) {
      out.timeline = timeline.map(({ spans, ...r }) => ({
        ...r,
        start: r.start && new Date(r.start).toISOString(),
        end: r.end && new Date(r.end).toISOString(),
        spans: spans.length,
      }))
      out.sessions = sessions
    }
    console.log(JSON.stringify(out, null, 2))
    return
  }

  const rows = ['| Part | Model | Calls | Tokens | Share |', '|---|---|---|---|---|']
  for (const p of parts) {
    rows.push(`| ${p.label} | ${p.model} | ${p.calls} | ${fmtM(p.tokens)} | ${fmtPct(p.tokens, grandTotal)} |`)
  }
  rows.push(`| **Total** | | | **${fmtM(grandTotal)}** | 100% |`)
  if (commits) rows.push(`| Per commit (${commits}) | | | ${fmtM(grandTotal / commits)} | |`)
  console.log(rows.join('\n'))
  console.log('')
  // One line per model, for "navigator Fable 19%, Opus agents 72%, Sonnet 10%".
  console.log(
    [...byModel.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model, tokens]) => `${model} ${fmtPct(tokens, grandTotal)}`)
      .join(', '),
  )
  if (wantTimeline) {
    console.log('')
    console.log(timelineTable(timeline, sessions))
  }
}

// Run only as a script; Hank imports the functions above without running it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
