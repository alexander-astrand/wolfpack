#!/usr/bin/env node
// Rewrites `heisenberg.md`'s `## Leans` from the design library's `Score` column, so the
// section says when it was last checked against the record instead of drifting. Kit 1.8
// (jedi-council 1.7.1 L3, Feature 10): Leans was last rewritten on 15 Oct through five
// `/superlab` rounds, because step 8 wrote the new lines into a notes file "for the next setup
// session" and no session ever ran it.
//
//   node <design>/scripts/leans.mjs [--library <library.md>] [--agent <heisenberg.md>]
//                                   [--notes <notes.md> ...] [--today <date>] [--write]
//
// --library  the library `/superlab` writes (default ~/.claude/plans/design/library.md). Its
//            first table with a `Score` header is read: `lean won`, `lean lost` and `no lean`
//            count; `n/a` and blank rows (before kit 1.5) are skipped; any other text (a split
//            round, "lean half") counts as mixed and is listed.
// --agent    the file whose `## Leans` is rewritten (default the kit's agents/heisenberg.md).
// --notes    a round's gallery notes: the bullet lines under `## For the kit's next setup
//            session` replace the Leans bullets (the last file given wins). Without it the
//            bullets stay as they are and only the record block is rewritten.
// --write    write the agent file; without it the new section is printed (what `/superlab`
//            step 8 pastes into its notes from a project session, which never edits the kit).
//
// The record block sits between `<!-- leans.mjs -->` and `<!-- /leans.mjs -->` inside the
// section and is always rewritten whole, never appended.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_LIBRARY = join(homedir(), '.claude', 'plans', 'design', 'library.md')
export const DEFAULT_AGENT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'agents', 'heisenberg.md')
export const OPEN = '<!-- leans.mjs -->'
export const CLOSE = '<!-- /leans.mjs -->'
export const NOTES_HEADING = "## For the kit's next setup session"
// How many rows of each list the record names: enough to read the trend, short enough to ride
// in every brief.
const RECENT = 4
const LOST = 5

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** One kind per Score cell: won, lost, none, mixed, or null for a row that was never scored. */
export function scoreKind(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\*/g, '')
  if (!s || s === 'n/a' || s === '-') return null
  if (/^lean won\b/.test(s)) return 'won'
  if (/^lean lost\b/.test(s) && !/then lean won/.test(s)) return 'lost'
  if (/^no lean\b/.test(s)) return 'none'
  return 'mixed'
}

/** The rows of the library's first table that has a `Score` column. */
export function parseLibrary(text) {
  const lines = String(text ?? '').split('\n')
  const rows = []
  let header = null
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (header && rows.length) break // the table ended
      continue
    }
    const c = cells(line)
    if (!header) {
      if (c.some((h) => h.toLowerCase() === 'score')) header = c.map((h) => h.toLowerCase())
      continue
    }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue // the |---| line
    const at = (name) => c[header.indexOf(name)] ?? ''
    // A cell that quotes a `|` splits the row wider than its header: Score is then the last cell.
    const score = c.length === header.length ? at('score') : c.at(-1)
    rows.push({ date: at('date'), topic: at('topic'), page: at('page'), lean: at("heisenberg's lean"), pick: at('pick'), score, kind: scoreKind(score) })
  }
  if (!header) throw new Error('no table with a Score column in the library')
  return rows
}

const short = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n).trimEnd()} (cut)` : t
}

/** The record block's lines, from the scored rows. */
export function recordLines(rows, today) {
  const scored = rows.filter((r) => r.kind)
  const n = (k) => scored.filter((r) => r.kind === k).length
  const out = [OPEN]
  out.push(
    `**The record** (\`leans.mjs\`, ${today}, from the library's \`Score\` column): ${scored.length} scored rows, lean won ${n('won')}, lean lost ${n('lost')}, no lean ${n('none')}, mixed ${n('mixed')}; ${rows.length - scored.length} rows from before scoring skipped.`,
  )
  const recent = scored.slice(-RECENT)
  if (recent.length) out.push(`- Latest: ${recent.map((r) => `${r.date} ${short(r.page, 30)}: ${short(r.score, 20)}`).join('; ')}.`)
  const lost = scored.filter((r) => r.kind === 'lost' || r.kind === 'mixed').slice(-LOST)
  if (lost.length) out.push(`- Lost or mixed (lean the other way, or say why not): ${lost.map((r) => `${r.date} ${short(r.page, 30)} (lean ${short(r.lean, 25)}; pick ${short(r.pick, 40)})`).join('; ')}.`)
  out.push(CLOSE)
  return out
}

/** The bullet lines under the notes' setup-session heading, or null when there are none. */
export function notesBullets(text) {
  const lines = String(text ?? '').split('\n')
  const start = lines.findIndex((l) => l.trim().startsWith(NOTES_HEADING))
  if (start < 0) return null
  const out = []
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(l)) break
    if (/^- /.test(l)) out.push(l.trimEnd())
  }
  return out.length ? out : null
}

// The section ends at the next heading or bold paragraph (`**Brief mode**`), skipping the record
// block, whose own first line is bold.
function sectionEnd(lines, start) {
  let inBlock = false
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === OPEN) inBlock = true
    else if (t === CLOSE) inBlock = false
    else if (!inBlock && (/^## /.test(lines[i]) || /^\*\*[A-Z]/.test(lines[i]))) return i
  }
  return lines.length
}

/**
 * The agent text with `## Leans` rewritten: its intro kept, the record block replaced (or put in
 * after the intro the first time), and the bullets replaced when `bullets` is given.
 */
export function rewriteLeans(agentText, { record, bullets = null }) {
  const lines = String(agentText).split('\n')
  const start = lines.findIndex((l) => l.trim() === '## Leans')
  if (start < 0) throw new Error('no "## Leans" section in the agent file')
  const end = sectionEnd(lines, start)
  const body = lines.slice(start + 1, end)
  const intro = []
  const oldBullets = []
  let inBlock = false
  for (const l of body) {
    if (l.trim() === OPEN) inBlock = true
    else if (l.trim() === CLOSE) inBlock = false
    else if (inBlock) continue
    else if (/^- /.test(l)) oldBullets.push(l)
    else if (l.trim() && !oldBullets.length) intro.push(l)
  }
  const section = ['## Leans', ...intro, ...record, ...(bullets ?? oldBullets), '']
  return [...lines.slice(0, start), ...section, ...lines.slice(end)].join('\n')
}

function parseArgs(argv) {
  const o = { library: DEFAULT_LIBRARY, agent: DEFAULT_AGENT, notes: [], today: new Date().toISOString().slice(0, 10), write: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') o.write = true
    else if (a === '--notes') o.notes.push(argv[++i])
    else if (['--library', '--agent', '--today'].includes(a)) o[a.slice(2)] = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  return o
}

export function run(argv) {
  const o = parseArgs(argv)
  if (!existsSync(o.library)) throw new Error(`no library at ${o.library}`)
  const rows = parseLibrary(readFileSync(o.library, 'utf8'))
  let bullets = null
  for (const f of o.notes) bullets = notesBullets(readFileSync(f, 'utf8')) ?? bullets
  const next = rewriteLeans(readFileSync(o.agent, 'utf8'), { record: recordLines(rows, o.today), bullets })
  if (!o.write) {
    const s = next.split('\n')
    const from = s.findIndex((l) => l.trim() === '## Leans')
    return s.slice(from, sectionEnd(s, from)).join('\n').trimEnd()
  }
  writeFileSync(o.agent, next)
  return `wrote ## Leans in ${o.agent} (${rows.filter((r) => r.kind).length} scored rows${bullets ? `, ${bullets.length} bullets from the notes` : ''})`
}

// Node runs the real file, so a relative, spaced or symlinked path compares as its real URL.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    console.log(run(process.argv.slice(2)))
  } catch (err) {
    console.error(`leans.mjs: ${err.message}`)
    process.exit(1)
  }
}
