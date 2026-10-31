#!/usr/bin/env node
// The facts step of `/jedi-council` as one call: writes `facts.md` whole, and the
// skills lens's cards beside it. The kit 1.6.1 council ran six scripts and some
// greps by hand, and r2-d2 (no shell) waited on each; one script means the
// navigator runs one line and r2-d2 reads one file (Feature 10, kit 1.6.1 council).
// Sections, in order: the git range, the speed table per project, roles with
// runs per model, the cards' closing-lines table, session starts, agent spawns,
// the lessons and taste changes on every branch with the sendback count, the
// permission logs per project by source, and a stale-reference pre-grep.
// Kit 1.8 (the kit 1.7.1 council's "for the next council") added the learning
// diff (F20), a row per spawn, guard reasons per agent and the questions per
// skill and session (F21, council-asks.mjs), the window's /one-ring runs
// with their cost line (council-deploys.mjs), and main passes the real gh call so the cheaper lines include
// the window's PR bodies (H3).
//
// Usage: node council-facts.mjs --since <YYYY-MM-DD> --out <facts.md>
//          [--project <name>=<repo path>]… [--git <repo> --from <commit>]
//          [--retired <name>,<name>] [--transcripts <dir>] [--kit <plugins dir>]
// --project: one per project to read; none means the cwd. --retired: skill or
// agent names that no longer exist, listed wherever a kit file still cites them.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { byBirth, sessionRow, tableOf as speedTable } from './council-speed.mjs'
import { roleTotals, tableOf as rolesTable } from './council-roles.mjs'
import { buildCards, ghPrBodies, projectDirs, renderCards } from './council-skills.mjs'
import { startRows, startsTable } from './council-starts.mjs'
import { spawnRows, spawnRowsTable, spawnTally, spawnsTable } from './council-spawns.mjs'
import { guardReasons, guardTable, questionTally, questionsTable } from './council-asks.mjs'
import { deployRuns, deploysTable } from './council-deploys.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HELP = `Usage: node council-facts.mjs --since <YYYY-MM-DD> --out <facts.md>
         [--project <name>=<repo>]… [--git <repo> --from <commit>] [--retired <a>,<b>]
         [--transcripts <dir>] [--kit <plugins dir>]
Writes facts.md, and skills-cards.md with skills-cards-cheaper.md beside it.`

export function parseArgs(argv) {
  const o = { since: null, out: null, git: null, from: null, retired: [], kit: join(HERE, '..', '..'), transcripts: join(homedir(), '.claude', 'projects'), projects: {}, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--since') o.since = argv[++i]
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--git') o.git = argv[++i]
    else if (a === '--from') o.from = argv[++i]
    else if (a === '--kit') o.kit = argv[++i]
    else if (a === '--transcripts') o.transcripts = argv[++i]
    else if (a === '--retired') o.retired.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean))
    else if (a === '--project') {
      const [name, ...rest] = argv[++i].split('=')
      o.projects[name] = rest.join('=')
    }
  }
  if (!Object.keys(o.projects).length) o.projects[basename(process.cwd())] = process.cwd()
  return o
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ---- the git range

export function gitRange(repo, from, run = git) {
  if (!repo || !from) return 'Not asked (pass `--git <repo> --from <commit>`).'
  try {
    const log = run(['-C', repo, 'log', '--oneline', '--no-merges', `${from}..HEAD`]).trim().split('\n').filter(Boolean)
    const stat = run(['-C', repo, 'diff', '--shortstat', `${from}..HEAD`]).trim()
    return [`${log.length} commits (merges left out) from \`${from}\` to HEAD in \`${repo}\`; ${stat || 'no changes'}.`, '', ...log.map((l) => `- ${l}`)].join('\n')
  } catch (e) {
    return `git failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`
  }
}

// ---- lessons and taste over the window, every branch (F20, kit 1.7.1 council)

// The learning lens started from dates and missed a wrap PR's lessons still on
// its branch; `git log --all` lists each change wherever it sits. A taste line
// with a source in parentheses is a sendback, so added ones are the count.
export const LEARN_FILES = ['.claude/lessons.md', '.claude/taste.md']
export const sendbackLine = (l) => /^\+(?!\+\+)\s*[-*]\s.*\([^)]{2,}\)/.test(l)

export function learningChanges(repo, since, run = git) {
  try {
    const log = run(['-C', repo, 'log', '--all', `--since=${since}`, '--date=short', '--format=@@%h|%ad|%D|%s', '--numstat', '--', ...LEARN_FILES])
    const commits = []
    for (const line of log.split('\n')) {
      if (line.startsWith('@@')) {
        const [sha, date, refs, ...subj] = line.slice(2).split('|')
        commits.push({ sha, date, refs, subject: subj.join('|'), files: [] })
      } else if (line.trim() && commits.length) {
        const [add, del, file] = line.split('\t')
        commits.at(-1).files.push(`${file.replace('.claude/', '')} +${add} -${del}`)
      }
    }
    const patch = run(['-C', repo, 'log', '--all', `--since=${since}`, '--format=', '-p', '--', '.claude/taste.md'])
    const sendbacks = new Set(patch.split('\n').filter(sendbackLine).map((l) => l.slice(1).trim()))
    return { commits, sendbacks: sendbacks.size }
  } catch (e) {
    return { error: String(e.stderr || e.message).trim().split('\n')[0] }
  }
}

export function learningSection(projects, since, run = git) {
  const out = ['Every branch (`git log --all`); a sendback is an added taste line with a source in parentheses, each text once.', '']
  for (const [project, repo] of Object.entries(projects)) {
    const r = learningChanges(repo, since, run)
    if (r.error) {
      out.push(`### ${project}`, '', `git failed: ${r.error}`, '')
      continue
    }
    out.push(`### ${project}: ${r.commits.length} commits, ${r.sendbacks} sendbacks added to taste`, '')
    for (const c of r.commits) out.push(`- ${c.date} \`${c.sha}\`${c.refs ? ` (${c.refs})` : ''} ${c.subject}: ${c.files.join(', ')}`)
    out.push('')
  }
  return out.join('\n').trimEnd()
}

// ---- the speed table, per project

export function speedFor(dirs, from) {
  const seen = new Set()
  const rows = []
  for (const dir of dirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && statSync(join(dir, f)).mtimeMs >= from)
    for (const f of byBirth(dir, files)) rows.push(sessionRow(dir, f.slice(0, -'.jsonl'.length), seen))
  }
  // A copy with nothing of its own left has no row, as in council-speed.mjs.
  return rows.filter((s) => s.tokens > 0 || s.calls > 0).sort((a, b) => a.first - b.first)
}

// ---- the permission logs, by source

// Where each source writes (F5, kit 1.6.1 council): Auto mode's classifier
// through denied-log.mjs, the guard's own decisions, and the session hooks.
export const SOURCES = [
  ['classifier', 'permission-denied.log'],
  ['guard', 'guard-decisions.log'],
  ['hooks', 'session-hooks.log'],
]

// Rows on or after `from` (column 1 is an ISO time), and the top tools (column 3).
export function logRows(file, from) {
  if (!existsSync(file)) return null
  const tools = new Map()
  let rows = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const cols = line.split('\t')
    if (!line.trim() || Date.parse(cols[0]) < from) continue
    rows += 1
    const tool = cols[2] || '?'
    tools.set(tool, (tools.get(tool) || 0) + 1)
  }
  const top = [...tools].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(', ')
  return { rows, top }
}

export function permissionSection(projects, from) {
  const out = []
  for (const [project, repo] of Object.entries(projects)) {
    const found = SOURCES.map(([source, name]) => ({ source, name, r: logRows(join(repo, '.claude', name), from) }))
    const guard = found.find((x) => x.source === 'guard').r
    out.push(`### ${project}${guard ? '' : ' (all classifier: no guard log, so every refusal here is Auto mode\'s)'}`, '')
    out.push('| Source | Log | Rows | Top tools |', '|---|---|---|---|')
    for (const { source, name, r } of found) out.push(`| ${source} | .claude/${name} | ${r ? r.rows : 'no log'} | ${r?.top || '–'} |`)
    out.push('')
  }
  return out.join('\n').trimEnd()
}

// ---- the stale-reference pre-grep

const HISTORY = /^(CHANGELOG|lessons.*)\.md$/i

export function kitFiles(root) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.md')) out.push(p)
    }
  }
  if (existsSync(root)) walk(root)
  return out.sort()
}

const norm = (s) => s.toLowerCase().replace(/[`*_]/g, '').replace(/[\s:.,;]+$/, '').replace(/\s+/g, ' ').trim()

// A file's headings and bold leads, the two places a cited "Section" can live.
export function anchorsOf(text) {
  const a = []
  for (const line of text.split('\n')) {
    const h = /^#{1,6}\s+(.+)$/.exec(line)
    if (h) a.push(norm(h[1]))
    for (const m of line.matchAll(/\*\*([^*]+)\*\*/g)) a.push(norm(m[1]))
  }
  return a
}

// `file.md` "Section" and `file.md`'s "Section", straight or curly quotes.
const CITE = /`([\w./-]+\.md)`(?:'s)?,?\s+(?:section\s+)?["“]([^"”\n]{3,80})["”]/g

export function staleRefs(files, root, retired = []) {
  const byName = new Map()
  for (const f of files) byName.set(basename(f), [...(byName.get(basename(f)) || []), f])
  const anchors = new Map()
  const anchorsFor = (f) => anchors.get(f) ?? anchors.set(f, anchorsOf(readFileSync(f, 'utf8'))).get(f)
  const retiredHits = []
  const missing = []
  let cites = 0
  let outside = 0
  const res = retired.map((n) => [n, new RegExp(`(?<![\\w-])/?${n.replace(/[-]/g, '\\-')}(?![\\w-])`, 'i')])
  for (const f of files) {
    const rel = relative(root, f)
    // An ADR records what was decided then, so an old name there is right.
    if (HISTORY.test(basename(f)) || rel.startsWith('docs/decisions/')) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const [n, re] of res) if (re.test(line)) retiredHits.push(`${rel}:${i + 1} (${n})`)
      for (const m of line.matchAll(CITE)) {
        cites += 1
        const targets = byName.get(basename(m[1]))
        if (!targets) {
          outside += 1
          continue
        }
        const want = norm(m[2])
        if (!targets.some((t) => anchorsFor(t).some((h) => h.includes(want)))) missing.push(`${rel}:${i + 1} \`${m[1]}\` "${m[2]}"`)
      }
    })
  }
  return { retiredHits, missing, cites, outside }
}

export function staleSection(r, retired) {
  const out = []
  out.push(`Greps, not judgements; history files (CHANGELOG, lessons, docs/decisions) are left out. A reader confirms each hit.`, '')
  out.push(`**Retired names** (${retired.length ? retired.join(', ') : 'none asked; pass `--retired`'}): ${r.retiredHits.length} hits`)
  for (const h of r.retiredHits) out.push(`- ${h}`)
  out.push('')
  out.push(`**Cited sections:** ${r.cites} \`file.md\` "Section" cites, ${r.outside} to files outside the kit (not checked), ${r.missing.length} with no heading or bold lead that matches`)
  for (const m of r.missing) out.push(`- ${m}`)
  return out.join('\n')
}

// ---- facts.md

export function closingTable(cards) {
  const start = cards.indexOf('## Closing lines')
  if (start < 0) return '(the cards have no closing-lines table)'
  const end = cards.indexOf('\n## ', start + 3)
  return cards.slice(start, end < 0 ? undefined : end).split('\n').slice(1).join('\n').trim()
}

export function buildFacts(o, { run = git, prBodies } = {}) {
  const from = Date.parse(`${o.since}T00:00:00`)
  const kitRoot = dirname(o.kit)
  const dirsOf = Object.fromEntries(Object.entries(o.projects).map(([p, repo]) => [p, projectDirs(o.transcripts, repo)]))
  const allDirs = Object.values(dirsOf).flat()
  // PR bodies only when a gh call is passed (main passes the real one), so tests stay offline.
  const r = buildCards(prBodies ? { ...o, prBodies } : o)
  const { cards, cheaper } = renderCards(r, o)
  const out = [`# Council facts (window ${o.since} to ${new Date().toISOString().slice(0, 10)})`, '']
  out.push(`Built by \`plugins/release/scripts/council-facts.mjs\`. Transcript folders read: ${allDirs.length ? allDirs.map((d) => `\`${basename(d)}\``).join(', ') : 'none'}. The cards are in \`skills-cards.md\` beside this file, every "Cheaper next time:" line in \`skills-cards-cheaper.md\`.`, '')
  out.push('## Git range', '', gitRange(o.git, o.from, run), '')
  out.push('## Speed, per project', '')
  for (const [p, dirs] of Object.entries(dirsOf)) out.push(`### ${p}`, '', dirs.length ? speedTable(speedFor(dirs, from)) : 'No transcript folder.', '')
  out.push('## Roles (runs per model)', '', rolesTable(roleTotals(allDirs, from)), '')
  out.push('## Closing lines (from the cards)', '', closingTable(cards), '')
  out.push('## Session starts (start_session by initiation)', '', startsTable(startRows(allDirs, from)), '')
  out.push('## Agent spawns (role and the model the call asked for)', '', spawnsTable(spawnTally(allDirs, from)), '')
  out.push('## Agent spawns, one row each', '', spawnRowsTable(spawnRows(allDirs, from)), '')
  out.push('## Guard reasons, per agent', '', guardTable(guardReasons(Object.values(o.projects).map((repo) => join(repo, '.claude', 'guard-decisions.log')), from)), '')
  out.push('## Questions (AskUserQuestion), per skill and session', '', questionsTable(questionTally(allDirs, from)), '')
  out.push('## /one-ring runs', '', deploysTable(deployRuns(allDirs, from)), '')
  out.push('## Lessons and taste changes', '', learningSection(o.projects, o.since, run), '')
  out.push('## Permission logs, by source', '', permissionSection(o.projects, from), '')
  out.push('## Stale references', '', staleSection(staleRefs(kitFiles(kitRoot), kitRoot, o.retired), o.retired), '')
  return { facts: out.join('\n'), cards, cheaper }
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help || !o.since || !o.out || Number.isNaN(Date.parse(o.since))) {
    console.log(HELP)
    process.exit(o.help ? 0 : 1)
  }
  const { facts, cards, cheaper } = buildFacts(o, { prBodies: ghPrBodies })
  writeFileSync(o.out, facts)
  writeFileSync(join(dirname(o.out), 'skills-cards.md'), cards)
  writeFileSync(join(dirname(o.out), 'skills-cards-cheaper.md'), cheaper)
  console.log(`Wrote ${o.out} (${facts.split('\n').length} lines) and skills-cards.md beside it.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
