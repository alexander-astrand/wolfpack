#!/usr/bin/env node
// The skills lens's cards for /jedi-council (§2, a standing step since kit 1.5):
// one card per kit skill and agent, built from the window's transcripts, so the
// reader lanes judge each file against what it actually did. Read only.
// First written for the kit 1.4 test run (17 Oct 2026); kit 1.5 added what that
// run asked for: each agent's body against its `tools:` line, each path a file
// names that exists in one project only, preloads from agents' `skills:` lines,
// and resumed runs told apart from cap stops.
//
// Usage: node council-skills.mjs --since <YYYY-MM-DD> --out <cards.md>
//          [--project <name>=<repo path>]… [--transcripts <dir>] [--kit <plugins dir>] [--json <out.json>]
// --project: one per project to read (its transcripts are found from the repo
// path, its lessons and permission log in its .claude/); none means the cwd.
// --transcripts: the folder of per-project transcript folders (~/.claude/projects).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readEntries, tallyEntries, timelineRow } from './usage.mjs'
import { byBirth, dropSeen, startCommand } from './council-speed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// Old agent names, so pre-2.10 transcripts read under today's names.
const RENAMED = {
  scout: 'lorenzo-von-matterhorn', 'test-runner': 'romeo-olsson', planner: 'admiral-ackbar',
  builder: 'chris-de-kok', designer: 'mosbius-designs', 'db-engineer': 'the-playbook',
  qa: 'bengt-johansson', 'release-reviewer': 'kissochbajslowski', documenter: 'c-3po',
}

// Claude Code's transcript folder for a repo: every character that isn't a
// letter, digit or dash becomes a dash.
export const transcriptKey = (repo) => repo.replace(/[^A-Za-z0-9-]/g, '-')

export function parseArgs(argv) {
  const o = { since: null, out: null, json: null, kit: join(HERE, '..', '..'), transcripts: join(homedir(), '.claude', 'projects'), projects: {}, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--since') o.since = argv[++i]
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--json') o.json = argv[++i]
    else if (a === '--kit') o.kit = argv[++i]
    else if (a === '--transcripts') o.transcripts = argv[++i]
    else if (a === '--project') {
      const [name, ...rest] = argv[++i].split('=')
      o.projects[name] = rest.join('=')
    }
  }
  if (!Object.keys(o.projects).length) o.projects[basename(process.cwd())] = process.cwd()
  return o
}

// ---- the kit: every skill and agent

const frontOf = (t) => (t.startsWith('---') ? t.split(/^---\s*$/m)[1] || '' : '')
const front = (t, key) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontOf(t))?.[1]?.trim() ?? null
const bodyOf = (t) => (t.startsWith('---') ? t.split(/^---\s*$/m).slice(2).join('---') : t)
const stripPlugin = (n) => (n || '').replace(/^\//, '').replace(/^[\w-]+:/, '').toLowerCase()

// A frontmatter list: `key: a, b`, `key: [a, b]` or a block of `- a` lines.
export function frontList(t, key) {
  const fm = frontOf(t)
  const inline = new RegExp(`^${key}:[ \\t]*(\\S.*)$`, 'm').exec(fm)?.[1]
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  const block = new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[ \\t]*.+\\n?)+)`, 'm').exec(fm)?.[1] || ''
  return block.split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
}

export function loadKit(kit) {
  const skills = []
  const agents = []
  for (const plugin of readdirSync(kit).sort()) {
    const sdir = join(kit, plugin, 'skills')
    if (existsSync(sdir)) {
      for (const s of readdirSync(sdir).sort()) {
        const file = join(sdir, s, 'SKILL.md')
        if (!existsSync(file)) continue
        const text = readFileSync(file, 'utf8')
        skills.push({ kind: 'skill', plugin, name: s, file, text, lines: text.split('\n').length, description: front(text, 'description'), userOnly: /disable-model-invocation:\s*true/.test(text) })
      }
    }
    const adir = join(kit, plugin, 'agents')
    if (existsSync(adir)) {
      for (const a of readdirSync(adir).filter((x) => x.endsWith('.md')).sort()) {
        const file = join(adir, a)
        const text = readFileSync(file, 'utf8')
        const mt = front(text, 'maxTurns')
        const tools = front(text, 'tools') === null ? null : frontList(text, 'tools')
        agents.push({ kind: 'agent', plugin, name: front(text, 'name') || a.slice(0, -3), file, text, lines: text.split('\n').length, description: front(text, 'description'), model: front(text, 'model'), effort: front(text, 'effort'), maxTurns: mt ? Number(mt) : null, tools, preload: frontList(text, 'skills').map(stripPlugin) })
      }
    }
  }
  return { skills, agents }
}

// ---- addition 1: an agent's body names a tool its `tools:` line doesn't grant
// (kit 1.4 lens: c-3po, lorenzo, r2-d2 and barney had orders their tools
// couldn't follow). A line that says the agent has no such tool is skipped.
const TOOL_HINTS = [
  { need: 'ArtifactData', label: 'ArtifactData', re: /\bArtifactData\b/ },
  { need: 'ToolSearch', label: 'ToolSearch', re: /\bToolSearch\b/ },
  { need: 'WebFetch', label: 'WebFetch', re: /\bWebFetch\b/ },
  { need: 'WebSearch', label: 'WebSearch', re: /\bWebSearch\b/ },
  { need: 'Bash', label: 'Bash', re: /\bBash\b/ },
  { need: 'Bash', label: '`grep`', re: /`grep\b/ },
  { need: 'Bash', label: '`node`', re: /`node\s/ },
]
const NEGATION = /\b(no|not|never|without|cannot|can't|doesn't|don't|isn't)\b/i
const grants = (tools, need) => tools.some((t) => t === need || (t.endsWith('*') && need.startsWith(t.slice(0, -1))))

export function toolMismatches(agent) {
  if (!agent.tools) return [] // no tools: line, so it has every tool
  const offset = agent.text.split('\n').length - bodyOf(agent.text).split('\n').length
  const out = []
  const done = new Set()
  bodyOf(agent.text).split('\n').forEach((line, i) => {
    if (NEGATION.test(line)) return
    for (const h of TOOL_HINTS) {
      if (done.has(h.label) || grants(agent.tools, h.need) || !h.re.test(line)) continue
      done.add(h.label)
      out.push({ line: offset + i + 1, label: h.label, need: h.need })
    }
  })
  return out
}

// ---- addition 2: a repo path the file names that exists in one project only
// (kit 1.4 lens: Hutzup-only paths in shared files sent the other projects'
// reviewers after files they don't have). Backticked relative paths only.
const PATH_RE = /`((?:\.claude|[A-Za-z0-9_][\w.-]*)\/[\w.\/-]*[\w])(?::\d[\d-]*)?`/g
export function oneProjectPaths(item, projects, kit) {
  const out = []
  const seen = new Set()
  for (const m of bodyOf(item.text).matchAll(PATH_RE)) {
    const p = m[1]
    if (seen.has(p) || p.startsWith('plugins/')) continue
    seen.add(p)
    const pluginDir = join(kit, item.plugin)
    if (existsSync(join(pluginDir, p)) || existsSync(join(kit, '..', p)) || existsSync(join(dirname(item.file), p))) continue
    const have = Object.entries(projects).filter(([, repo]) => repo && existsSync(join(repo, p))).map(([n]) => n)
    if (have.length === 1 && Object.keys(projects).length > 1) out.push({ path: p, project: have[0] })
  }
  return out
}

// ---- resumes against cap stops: a run resumed by SendMessage gets a fresh
// maxTurns, so a run's turns are counted per segment (each new prompt starts one).
const isPrompt = (e) => {
  if (e.type !== 'user') return false
  const c = e.message?.content
  if (typeof c === 'string') return true
  return Array.isArray(c) && !c.some((p) => p?.type === 'tool_result') && c.some((p) => p?.type === 'text')
}
// Newer transcripts tag every line with its prompt's promptId, which also
// catches a resume whose prompt line looks like a tool result; older ones
// fall back to the prompt lines.
export function segmentTurns(entries) {
  const byPromptId = entries.some((e) => e.promptId)
  const segs = []
  let ids = null
  let cur = null
  for (const e of entries) {
    const starts = byPromptId ? e.promptId && e.promptId !== cur : isPrompt(e)
    if (byPromptId && e.promptId) cur = e.promptId
    if (starts) {
      ids = new Set()
      segs.push(ids)
      continue
    }
    if (e.type === 'assistant' && e.message?.id) {
      if (!ids) {
        ids = new Set()
        segs.push(ids)
      }
      ids.add(e.message.id)
    }
  }
  return segs.map((s) => s.size)
}

// ---- the window's transcripts

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n') : '')
const firstTime = (entries) => {
  for (const e of entries) {
    const t = Date.parse(e.timestamp)
    if (!Number.isNaN(t)) return t
  }
  return null
}
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
// A "Cheaper next time:" line that quotes the phrase (a report about reports,
// a template's placeholder) is not an idea.
const realCheaper = (s) => s.length >= 15 && !/^[<`"'(]/.test(s) && !/^(one idea|<)/i.test(s)

export function buildCards({ kit, projects, transcripts, since }) {
  const FROM = Date.parse(`${since}T00:00:00`)
  const { skills, agents } = loadKit(kit)
  const AGENT_NAMES = new Set(agents.map((a) => a.name))
  const skillStats = new Map(skills.map((s) => [s.name, { started: [], slash: 0, toolCalls: 0, toolCallsInAgents: 0, projects: new Set() }]))
  const agentStats = new Map(agents.map((a) => [a.name, { runs: [], cheaper: [], denied: [], projects: new Set() }]))
  const otherSkills = new Map()
  const otherAgents = new Map()
  const seen = new Set()
  let sessionsRead = 0
  let subRead = 0

  const agentOf = (meta) => {
    const raw = stripPlugin(meta.agentType || meta.agent_type || meta.subagentType || '')
    const name = RENAMED[raw] ?? raw
    if (AGENT_NAMES.has(name)) return { name, via: 'type' }
    const prefix = /^\s*([a-z0-9-]+)\s*:/.exec(meta.description || '')?.[1]
    if (prefix && AGENT_NAMES.has(RENAMED[prefix] ?? prefix)) return { name: RENAMED[prefix] ?? prefix, via: 'description' }
    return { name: raw || '(no meta)', via: 'none' }
  }
  const skillCalls = (entries, inAgent, project) => {
    const ids = new Set()
    for (const e of entries) {
      const t = Date.parse(e.timestamp)
      if (!Number.isNaN(t) && t < FROM) continue
      const content = e.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : []
      for (const c of content) {
        if (c.type !== 'tool_use' || c.name !== 'Skill' || ids.has(c.id)) continue
        ids.add(c.id)
        const n = stripPlugin(c.input?.skill)
        const st = skillStats.get(n)
        if (!st) {
          bump(otherSkills, n)
          continue
        }
        if (inAgent) st.toolCallsInAgents += 1
        else st.toolCalls += 1
        st.projects.add(project)
      }
    }
  }

  for (const [project, repo] of Object.entries(projects)) {
    const dir = join(transcripts, transcriptKey(repo))
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter((x) => x.endsWith('.jsonl') && statSync(join(dir, x)).mtimeMs >= FROM)
    for (const f of byBirth(dir, files)) {
      const id = f.slice(0, -6)
      const raw = readEntries(join(dir, f))
      const cmd = stripPlugin(startCommand(raw))
      const start = firstTime(raw)
      const main = dropSeen(raw, seen)
      const subDir = join(dir, id, 'subagents')
      const subFiles = existsSync(subDir) ? readdirSync(subDir).filter((x) => x.endsWith('.jsonl')) : []
      sessionsRead += 1
      skillCalls(main, false, project)
      let slashSeen = 0
      for (const e of main) {
        if (e.type !== 'user') continue
        const t = Date.parse(e.timestamp)
        if (!Number.isNaN(t) && t < FROM) continue
        const m = /<command-name>\s*\/?([\w:-]+)\s*<\/command-name>/.exec(textOf(e.message?.content))
        if (!m) continue
        slashSeen += 1
        const n = stripPlugin(m[1])
        if (slashSeen === 1 && n === cmd) continue // counted as the start
        if (skillStats.has(n)) {
          skillStats.get(n).slash += 1
          skillStats.get(n).projects.add(project)
        }
      }
      const navRow = timelineRow(main, 'navigator', 'navigator', id)
      let tokens = navRow.tokens
      let active = navRow.minutes
      for (const sf of subFiles) {
        subRead += 1
        const entries = dropSeen(readEntries(join(subDir, sf)), seen)
        let meta = {}
        try {
          meta = JSON.parse(readFileSync(join(subDir, sf.replace(/\.jsonl$/, '.meta.json')), 'utf8'))
        } catch {
          // no meta file: the run is "(no meta)"
        }
        const row = timelineRow(entries, meta.description || sf, 'x', id)
        tokens += row.tokens
        active += row.minutes
        if (!row.start || row.start < FROM) continue
        skillCalls(entries, true, project)
        const who = agentOf(meta)
        const st = agentStats.get(who.name)
        if (!st) {
          bump(otherAgents, who.name)
          continue
        }
        let turns = 0
        for (const [, b] of tallyEntries(entries)) turns += b.calls
        st.runs.push({ project, session: id.slice(0, 8), model: row.model, minutes: row.minutes, calls: row.calls, turns, segments: segmentTurns(entries), tokens: row.tokens, via: who.via })
        st.projects.add(project)
        for (const e of entries) {
          if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
          for (const c of e.message.content) {
            if (c.type !== 'text') continue
            const m = /Cheaper next time:\s*([^\n]+)/.exec(c.text)
            if (m && realCheaper(m[1].trim())) st.cheaper.push(`${project} ${id.slice(0, 8)}: ${m[1].trim()}`)
          }
        }
      }
      // A copy with nothing of its own (every line seen in an earlier file) didn't start anything.
      if (!main.some((e) => e.type === 'assistant') && !subFiles.length) continue
      if (start && start >= FROM && skillStats.has(cmd)) {
        const st = skillStats.get(cmd)
        st.started.push({ project, session: id.slice(0, 8), tokens, active })
        st.projects.add(project)
      } else if (start && start >= FROM && cmd && cmd !== '(none)') bump(otherSkills, `/${cmd} (start)`)
    }
  }

  // permission refusals (agent in column 2; skills can't be told apart there)
  const denied = { rows: 0, main: 0, other: new Map() }
  for (const [project, repo] of Object.entries(projects)) {
    const f = join(repo, '.claude', 'permission-denied.log')
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const cols = line.split('\t')
      if (cols.length < 3 || Date.parse(cols[0]) < FROM) continue
      denied.rows += 1
      const n = RENAMED[stripPlugin(cols[1])] ?? stripPlugin(cols[1])
      if (n === 'main') denied.main += 1
      else if (agentStats.has(n)) agentStats.get(n).denied.push(`${project} ${cols[0].slice(5, 16)} ${cols[2]}`)
      else bump(denied.other, n)
    }
  }

  // lessons lines citing a name
  const lessonFiles = [join(kit, 'core', 'lessons.md'), ...Object.values(projects).map((r) => join(r, '.claude', 'lessons.md'))].filter(existsSync)
  const lessonLines = lessonFiles.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((text, i) => ({ f, i: i + 1, text })))
  const shortPath = (f) => f.replace(kit, 'kit').replace(homedir() + '/', '~/').replace('/.claude/lessons.md', ' lessons')
  const lessonsFor = (name) => {
    const re = new RegExp(`(?<![\\w-])/?${name.replace(/-/g, '\\-')}(?![\\w-])`, 'i')
    return lessonLines.filter((l) => re.test(l.text)).map((l) => {
      const slug = /\*\*\[([\w-]+)\]\*\*/.exec(l.text)?.[1]
      return `${shortPath(l.f)}:${l.i}${slug ? ` [${slug}]` : ''}`
    })
  }

  return { skills, agents, skillStats, agentStats, otherSkills, otherAgents, denied, sessionsRead, subRead, lessonFiles: lessonFiles.map(shortPath), lessonsFor, mismatches: new Map(agents.map((a) => [a.name, toolMismatches(a)])), onePaths: new Map([...skills, ...agents].map((x) => [`${x.kind} ${x.name}`, oneProjectPaths(x, projects, kit)])) }
}

// ---- the cards

const fmtM = (n) => `${(n / 1e6).toFixed(1)}M`
const sum = (xs, k) => xs.reduce((s, x) => s + (x[k] || 0), 0)
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s)
const list = (xs, n) => `${xs.slice(0, n).join(', ')}${xs.length > n ? `, +${xs.length - n} more` : ''}`

export function renderCards(r, { kit, since }) {
  const rel = (f) => f.replace(kit + '/', 'plugins/')
  const out = [`# Skills lens: the cards (window ${since} to ${new Date().toISOString().slice(0, 10)})`, '']
  out.push(`Built by \`plugins/release/scripts/council-skills.mjs\` from ${r.sessionsRead} session transcripts and ${r.subRead} agent runs; ${r.skills.length} skills, ${r.agents.length} agents. Tokens are real tokens, each message.id once across all files (a fork's copied lines count once). Lessons: ${r.lessonFiles.join(', ')}.`)
  out.push('')
  out.push('What the cards can\'t see:')
  out.push('- A skill\'s runs are sessions started with its slash command, later slash calls and Skill-tool calls. One followed by reading its SKILL.md, or run by a routine on another machine, is not counted.')
  out.push('- A started session\'s tokens and minutes are the whole session (navigator plus agents), so a release command carries everything its release did.')
  out.push('- Cap stops count turns per segment: a run resumed by SendMessage starts a new segment with a fresh maxTurns. A run that finished on its last turn looks like a stop; the list is candidates.')
  out.push('- Tool mismatches and one-project paths are greps (backticked paths only; a line saying the agent lacks the tool is skipped). Readers confirm them.')
  out.push('')
  for (const plugin of [...new Set([...r.skills, ...r.agents].map((x) => x.plugin))]) {
    out.push(`## ${plugin}`, '')
    for (const s of r.skills.filter((x) => x.plugin === plugin)) {
      const st = r.skillStats.get(s.name)
      const ls = r.lessonsFor(s.name)
      const preloaders = r.agents.filter((a) => a.preload.includes(s.name)).map((a) => `${a.name} (${r.agentStats.get(a.name).runs.length} runs)`)
      out.push(`### skill /${s.name}`)
      out.push(`- file: ${rel(s.file)} (${s.lines} lines${s.userOnly ? ', user-only' : ''})`)
      out.push(`- purpose: ${trunc(s.description || '(no description)', 240)}`)
      if (st.started.length + st.slash + st.toolCalls + st.toolCallsInAgents === 0) out.push('- runs: 0 in the window')
      else {
        out.push(`- runs: ${st.started.length} sessions started with it (${fmtM(sum(st.started, 'tokens'))}, ${sum(st.started, 'active')} active min), ${st.slash} later slash calls, ${st.toolCalls} Skill-tool calls by a navigator, ${st.toolCallsInAgents} by agents; projects: ${[...st.projects].sort().join(', ')}`)
        if (st.started.length) out.push(`- sessions: ${list(st.started.map((x) => `${x.project} ${x.session} ${fmtM(x.tokens)} ${x.active}m`), 8)}`)
      }
      if (preloaders.length) out.push(`- preloaded by (agents' \`skills:\` line, loaded on every run, no Skill-tool call): ${preloaders.join(', ')}`)
      const paths = r.onePaths.get(`skill ${s.name}`)
      if (paths.length) out.push(`- paths in one project only: ${paths.map((p) => `\`${p.path}\` (${p.project})`).join(', ')}`)
      out.push(`- lessons citing it: ${ls.length ? `${ls.length}: ${list(ls, 8)}` : 'none'}`)
      out.push('')
    }
    for (const a of r.agents.filter((x) => x.plugin === plugin)) {
      const st = r.agentStats.get(a.name)
      const ls = r.lessonsFor(a.name)
      out.push(`### agent ${a.name}`)
      out.push(`- file: ${rel(a.file)} (${a.lines} lines; ${a.model || '?'} / ${a.effort || '?'}; maxTurns ${a.maxTurns ?? 'none'}; tools ${a.tools ? a.tools.join(', ') : 'all'})`)
      out.push(`- purpose: ${trunc(a.description || '(no description)', 240)}`)
      if (!st.runs.length) out.push('- runs: 0 in the window')
      else {
        const models = [...new Set(st.runs.map((x) => x.model))].join('/')
        const tokens = st.runs.map((x) => x.tokens).sort((x, y) => x - y)
        out.push(`- runs: ${st.runs.length} (${fmtM(sum(st.runs, 'tokens'))}, ${sum(st.runs, 'minutes')} agent-min, ${sum(st.runs, 'calls')} tool calls; on ${models}); median ${fmtM(tokens[Math.floor(tokens.length / 2)])}/run; projects: ${[...st.projects].sort().join(', ')}`)
        const resumed = st.runs.filter((x) => x.segments.length > 1)
        const caps = a.maxTurns ? st.runs.filter((x) => x.segments.some((n) => n >= a.maxTurns)) : []
        out.push(`- cap stops: ${a.maxTurns ? `${caps.length} of ${st.runs.length}${caps.length ? ` (${list(caps.map((x) => `${x.project} ${x.session} ${Math.max(...x.segments)} turns`), 4)})` : ''}` : 'n/a (no maxTurns)'}; resumed runs: ${resumed.length}`)
      }
      const mm = r.mismatches.get(a.name)
      if (mm.length) out.push(`- tools named but not granted: ${mm.map((m) => `${m.label} (line ${m.line}${m.need !== m.label ? `, needs ${m.need}` : ''})`).join(', ')}`)
      const paths = r.onePaths.get(`agent ${a.name}`)
      if (paths.length) out.push(`- paths in one project only: ${paths.map((p) => `\`${p.path}\` (${p.project})`).join(', ')}`)
      out.push(`- permission refusals: ${st.denied.length ? `${st.denied.length}: ${list(st.denied, 4)}` : 'none'}`)
      out.push(`- lessons citing it: ${ls.length ? `${ls.length}: ${list(ls, 8)}` : 'none'}`)
      const uniq = [...new Set(st.cheaper.map((c) => trunc(c, 220)))]
      out.push(`- cheaper next time: ${!st.runs.length ? 'n/a (no runs)' : uniq.length ? `${uniq.length} of ${st.runs.length} runs said one` : `none in ${st.runs.length} runs`}`)
      for (const c of uniq.slice(0, 6)) out.push(`  - ${c}`)
      if (uniq.length > 6) out.push(`  - +${uniq.length - 6} more in the cheaper file`)
      out.push('')
    }
  }
  const top = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ')
  out.push('## Not on any card', '')
  out.push(`- Other agent types (not kit agents, or generic with no name prefix): ${top(r.otherAgents, 25) || 'none'}`)
  out.push(`- Other skill names (Skill tool or start command; old names, project or built-in skills): ${top(r.otherSkills, 30) || 'none'}`)
  out.push(`- Permission refusals in the window: ${r.denied.rows} rows, ${r.denied.main} by a navigator ("main"), others: ${top(r.denied.other, 10) || 'none'}`)
  out.push('')
  const cheaper = ['# Skills lens: every "Cheaper next time:" line, by agent', '']
  for (const a of r.agents) {
    const st = r.agentStats.get(a.name)
    const uniq = [...new Set(st.cheaper)]
    if (uniq.length) cheaper.push(`## ${a.name} (${uniq.length} lines, ${st.runs.length} runs)`, '', ...uniq.map((c) => `- ${c}`), '')
  }
  return { cards: out.join('\n'), cheaper: cheaper.join('\n') }
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help || !o.since || !o.out || Number.isNaN(Date.parse(o.since))) {
    console.log('Usage: node council-skills.mjs --since <YYYY-MM-DD> --out <cards.md> [--project <name>=<repo>]… [--transcripts <dir>] [--kit <plugins dir>] [--json <out.json>]')
    process.exit(o.help ? 0 : 1)
  }
  const r = buildCards(o)
  const { cards, cheaper } = renderCards(r, o)
  writeFileSync(o.out, cards)
  writeFileSync(o.out.replace(/\.md$/, '') + '-cheaper.md', cheaper)
  if (o.json) {
    const plain = (m) => Object.fromEntries([...m].map(([k, v]) => [k, { ...v, projects: [...(v.projects || [])] }]))
    writeFileSync(o.json, JSON.stringify({ skills: r.skills.map(({ text, ...s }) => s), agents: r.agents.map(({ text, ...a }) => a), skillStats: plain(r.skillStats), agentStats: plain(r.agentStats) }, null, 1))
  }
  console.log(`${r.skills.length} skills, ${r.agents.length} agents, ${r.sessionsRead} sessions, ${r.subRead} agent runs -> ${o.out}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
