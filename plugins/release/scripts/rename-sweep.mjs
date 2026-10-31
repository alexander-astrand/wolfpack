#!/usr/bin/env node
// The rename sweep for `c-3po` (F15, kit 1.7.1 council): the replacement table
// built from the name map, and a hit list of every old name in the files given,
// as a table (file:line, old, new). Both of c-3po's cheaper lines in the window
// asked for it; the kastalia name-map sessions cost about 240M rebuilding the
// table and the grep by hand each time.
//
// Usage: node rename-sweep.mjs [--map <name-map.md>] [--live] [--all] [--table] <path>…
// --map: the name map (default ~/pylos/notes/name-map.md); it is read as data.
// --live: skip history (CHANGELOG, lessons, docs/decisions, archive and
//   history folders) and quoted words, which keep the old names on purpose
//   (the global CLAUDE.md: "history, changelogs and quotes keep the old words").
// --all: keep bare short old names (`air`, `watch`), left out by default
//   because they hit plain English.
// --table: print the replacement table only.
//
// The table comes from the map's "The map" table (Was -> Name) and its "Wrong
// names in the code" table (Today -> Becomes), plus the phrases the global
// rule names that no table row spells ("the Air", "the Dell", "the dojo",
// fantasy-hq). An old name that is also a current name (`/mr-miyagi` was the
// dojo's brief skill and is the kit's skill now) is never swept: it is listed
// as ambiguous for a person to read.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_MAP = join(homedir(), 'pylos', 'notes', 'name-map.md')

// The global rule's own examples that no table row spells out.
export const RULE_PHRASES = [
  ['the Air', 'Pollux'],
  ['the Dell', 'delphi'],
  ['the dojo', 'Pylos'],
  ['~/fantasy-hq', '~/pelion'],
  ['fantasy-hq', 'pelion'],
]

const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/^["“]|["”]$/g, '').trim()

// The rows of the markdown table under the heading that matches `head`.
export function tableUnder(text, head) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^#{2,6}\s/.test(l) && head.test(l))
  if (at < 0) return []
  const rows = []
  for (const l of lines.slice(at + 1)) {
    if (/^#{2,6}\s/.test(l)) break
    if (!l.startsWith('|') || /^\|[-\s|]+\|$/.test(l)) continue
    rows.push(l.slice(1, -1).split('|').map((c) => c.trim()))
  }
  return rows.slice(1) // the header row
}

// The old names in a "Was" cell: comma or semicolon parts, the backticked or
// quoted word when there is one, with notes like "on Heimdall" dropped.
export function oldNames(cell) {
  if (/^\(?(kept|none|unnamed)\b/i.test(cell.trim())) return []
  return cell
    .split(/[,;]\s*/)
    .map((part) => {
      const tick = /`([^`]+)`/.exec(part) || /["“]([^"”]+)["”]/.exec(part)
      return clean(tick ? tick[1] : part.replace(/\s*\(.*$/, ''))
    })
    .filter((n) => n && !/^(kept|none|unnamed)$/i.test(n))
}

const newName = (cell) => clean((/\*\*([^*]+)\*\*/.exec(cell) || [, cell])[1])
const bareShort = (n) => /^[a-z]{1,5}$/.test(n)

/** The replacement table: { pairs: [{ old, new, from }], ambiguous: [...], skipped: [...] }. */
export function replacementTable(mapText, { all = false } = {}) {
  const raw = []
  // Every current name, the bold one and any backticked one (`Chiron (/chiron)`):
  // `/chiron` was the guide's old name and is fantasy's voice now.
  const names = []
  for (const [thing, name, was] of tableUnder(mapText, /The map/i)) {
    if (!name) continue
    names.push(newName(name), ...[...name.matchAll(/`([^`]+)`/g)].map((m) => m[1]))
    if (was) for (const old of oldNames(was)) raw.push({ old, new: newName(name), from: thing })
  }
  for (const [today, becomes, what] of tableUnder(mapText, /Wrong names in the code/i)) {
    const to = /`([^`]+)`/.exec(becomes || '')?.[1]
    if (!to) continue
    for (const m of (today || '').matchAll(/`([^`]+)`/g)) if (!m[1].startsWith('.')) raw.push({ old: m[1], new: to, from: what || today })
  }
  for (const [old, to] of RULE_PHRASES) raw.push({ old, new: to, from: 'the global rule' })
  const current = new Set([...names, ...raw.map((p) => p.new)].map((n) => n.toLowerCase()))
  const pairs = []
  const ambiguous = []
  const skipped = []
  const seen = new Set()
  for (const p of raw) {
    if (seen.has(p.old) || p.old === p.new) continue
    seen.add(p.old)
    if (current.has(p.old.toLowerCase())) ambiguous.push(p)
    else if (!all && bareShort(p.old)) skipped.push(p)
    else pairs.push(p)
  }
  // Longest first, so `~/fantasy-hq` claims its hit before `fantasy-hq`.
  pairs.sort((a, b) => b.old.length - a.old.length)
  return { pairs, ambiguous, skipped }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const matcher = (old) => new RegExp(`(?<![\\w-])${esc(old)}(?![\\w-])`, 'g')

const HISTORY_FILE = /^(CHANGELOG|HISTORY|lessons)[\w.-]*\.md$/i
const HISTORY_DIR = /(^|\/)(docs\/decisions|archive|history|changelog)(\/|$)/i
export const isHistory = (rel) => HISTORY_FILE.test(basename(rel)) || HISTORY_DIR.test(rel)

// The spans of a line inside quotes ("…", “…”), which --live leaves alone.
function quotedSpans(line) {
  return [...line.matchAll(/"[^"\n]*"|“[^”\n]*”/g)].map((m) => [m.index, m.index + m[0].length])
}

/** Hits in one text: [{ line, old, new }], one per old name and line, longest name first. */
export function hitsIn(text, pairs, { live = false } = {}) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    const quoted = live ? quotedSpans(line) : []
    const claimed = []
    for (const p of pairs) {
      for (const m of line.matchAll(matcher(p.old))) {
        const [a, b] = [m.index, m.index + m[0].length]
        if (claimed.some(([x, y]) => a < y && b > x)) continue
        claimed.push([a, b])
        if (quoted.some(([x, y]) => a >= x && b <= y)) continue
        if (!hits.some((h) => h.line === i + 1 && h.old === p.old)) hits.push({ line: i + 1, old: p.old, new: p.new })
      }
    }
  })
  return hits
}

const TEXT = /\.(md|mdx|txt|mjs|cjs|js|jsx|ts|tsx|json|jsonc|ya?ml|toml|sh|zsh|bash|py|service|timer|conf|ini|env|html|css|sql|plist)$|^[^.]+$/i

export function filesUnder(path) {
  if (!existsSync(path)) return []
  if (statSync(path).isFile()) return [path]
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name === '.git' || name === '.venv' || name === 'dist') continue
      const p = join(d, name)
      // lstat, not stat: a link is skipped, not followed, so a broken one (or
      // a loop) can't kill the sweep (review nit 4); a file gone mid-walk too.
      let s
      try {
        s = lstatSync(p)
      } catch {
        continue
      }
      if (s.isDirectory()) walk(p)
      else if (s.isFile() && TEXT.test(name) && s.size < 2_000_000) out.push(p)
    }
  }
  walk(path)
  return out.sort()
}

export function sweep(paths, pairs, { live = false, cwd = process.cwd() } = {}) {
  const rows = []
  let skippedHistory = 0
  for (const root of paths) {
    for (const f of filesUnder(root)) {
      const rel = relative(cwd, f) || f
      if (live && isHistory(rel)) {
        skippedHistory += 1
        continue
      }
      for (const h of hitsIn(readFileSync(f, 'utf8'), pairs, { live })) rows.push({ where: `${rel}:${h.line}`, old: h.old, new: h.new })
    }
  }
  return { rows, skippedHistory }
}

const cell = (s) => String(s).replace(/\|/g, '/')

export function renderTable(t) {
  const out = ['| Old | New | From |', '|---|---|---|', ...t.pairs.map((p) => `| \`${cell(p.old)}\` | \`${cell(p.new)}\` | ${cell(p.from)} |`)]
  if (t.ambiguous.length) out.push('', `Ambiguous (an old name that is also a current one; read by hand): ${t.ambiguous.map((p) => `\`${p.old}\` (was ${p.from})`).join(', ')}`)
  if (t.skipped.length) out.push('', `Left out as bare short words (pass --all): ${t.skipped.map((p) => `\`${p.old}\` -> ${p.new}`).join(', ')}`)
  return out.join('\n')
}

export function renderHits(r, live) {
  if (!r.rows.length) return `No old names found${live ? ` (history and quotes skipped; ${r.skippedHistory} history files)` : ''}.`
  const out = ['| File:line | Old | New |', '|---|---|---|', ...r.rows.map((h) => `| ${h.where} | ${cell(h.old)} | ${cell(h.new)} |`)]
  out.push('', `${r.rows.length} hits${live ? `; history files (${r.skippedHistory}) and quoted words skipped` : ''}.`)
  return out.join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const o = { map: DEFAULT_MAP, live: false, all: false, table: false, paths: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--map') o.map = argv[++i]
    else if (argv[i] === '--live') o.live = true
    else if (argv[i] === '--all') o.all = true
    else if (argv[i] === '--table') o.table = true
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true
    else o.paths.push(argv[i])
  }
  if (o.help || !existsSync(o.map) || (!o.table && !o.paths.length)) {
    console.log('Usage: node rename-sweep.mjs [--map <name-map.md>] [--live] [--all] [--table] <path>…')
    if (!o.help && !existsSync(o.map)) console.log(`No name map at ${o.map}.`)
    process.exit(o.help ? 0 : 1)
  }
  const t = replacementTable(readFileSync(o.map, 'utf8'), o)
  if (o.table) console.log(renderTable(t))
  else console.log(renderHits(sweep(o.paths, t.pairs, o), o.live))
}

if (process.argv[1] && import.meta.url === pathToFileURL((await import('node:fs')).realpathSync(process.argv[1])).href) main()
