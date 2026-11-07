#!/usr/bin/env node
// The order composer: the fixed half of one step's work order, built from the
// plan's step row, the project's kit.json, .claude/standing-facts.md, the
// budgets file and the routing rules, so the navigator writes only the half
// that needs judgment (the why, the taste lines, the shared parts).
//
// Usage: node compose-order.mjs --plan <plan file> --step <id> [--project <dir>] [--lane <path>] [--look <direction> --stage <path>] [--json] [--dry]
//   --look   a look order for a mosbius-designs step (kit 1.10, F4): the stage
//            (--stage, built once by the navigator), one direction and its
//            `?dir=` param, the part's pages (the row's files cell), one Read
//            per message, and a tag from the last look's real spend (the last
//            row of `<plan>-steps.tsv` whose step names a look, else the plan's
//            cell, else the Opus designer's default). A row whose What says
//            "a look", "look order", "look round" or "mode: look" is a look
//            without the flag; the composer notes then name what's missing.
//            A look gets no deal: the direction is the navigator's.
//   --lane   adds the lane block (kit 1.10, F3): lane path, the check line
//            (`npm --prefix <lane> run check`, or `test`), dev port, the lane's
//            seed, the shot.mjs flags, the README anchor, the CLAUDE.md
//            conventions section and standing-facts.md by path
//   prints   one block: agent, model, effort, the `[budget NM]` tag (never
//            absent), mode, the step, for a mosbius-designs step the dealt
//            directions (design/scripts/deal.mjs, logged as the deal of record
//            unless --dry), the files to read (the row's file:line
//            column), the tests that read them, the standing facts that touch
//            the step, the plan rules whose surface the step touches (the
//            plan's `## Plan rules`, each with its check; Burrow V1.12 retro,
//            fix 10), the shell-shape line and the closing "Cheaper next
//            time" ask; for a `the-playbook` step also the lane brief (test,
//            apply, read-the-schema and types commands, the non-code files
//            naming each table or function, and one scope.mjs line per name)
//   exit 0   printed
//   exit 2   usage, a missing plan, or no row for the step
//
// Why it exists (kit 1.7.1 council, Feature 2, H3, H7, Feature 7): the orders
// were written by hand, so they dropped the "Cheaper next time" ask (6 lines in
// 261 runs), sent palettes and layouts to Fable at 12M or with no cap at all
// (about 40M over route), never chose `mode: scripted` (0 of 33) because it
// was a judgment call, and left `the-playbook` four calls per run finding how
// its lane runs commands. A script makes the same choice every time.
//
// The project is --project, else CLAUDE_PROJECT_DIR, else the current folder.
// Plan tables vary by project, so columns are found by their header words
// (Step, What, Agent/Who, Model, Lane, Budget/Ceiling, Found/Files/Where,
// Check). kit.json `budgets` win over budgets.json, as for Hank; kit.json
// `database.{test,apply,schema,types}` win over the guessed lane commands.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// The design plugin's dealer (kit 1.9, C2; Alexander 3 Nov: every mosbius-designs order deals).
// It lives in the sibling plugin, so a release plugin installed without design still composes:
// the order then says to run deal.mjs by hand.
let dealDirections = null
try {
  ;({ deal: dealDirections } = await import(new URL('../../design/scripts/deal.mjs', import.meta.url).href))
} catch {
  dealDirections = null
}

export const POOL = ['chris-de-kok', 'ahmed-och-ahmed', 'saul-goodman', 'jeff-winger', 'troy-and-abed']

// The routing table's model and effort per role (oceans-eleven, Routing table).
export const ROUTES = {
  ...Object.fromEntries(POOL.map((n) => [n, { model: 'opus', effort: 'medium', kind: 'build' }])),
  'jesse-pinkman': { model: 'sonnet', effort: 'medium', kind: 'build' },
  'the-playbook': { model: 'opus', effort: 'high', kind: 'database' },
  'mosbius-designs': { model: 'opus', effort: 'medium', kind: 'design' },
  heisenberg: { model: 'fable', effort: 'high', kind: 'design' },
  'lorenzo-von-matterhorn': { model: 'haiku', effort: 'low', kind: 'find' },
  'c-3po': { model: 'sonnet', effort: 'medium', kind: 'docs' },
  'bengt-johansson': { model: 'sonnet', effort: 'medium', kind: 'qa' },
  'magnus-wislander': { model: 'sonnet', effort: 'medium', kind: 'qa' },
  'staffan-olsson': { model: 'sonnet', effort: 'medium', kind: 'qa' },
  kissochbajslowski: { model: 'sonnet', effort: 'high', kind: 'review' },
  daredevil: { model: 'sonnet', effort: 'high', kind: 'review' },
}

// The designer's stop when an order has no cap, or "lifted"/"unlimited" (H7).
export const DESIGN_STOP = '12M'
// Scripted layout mode has no measured rate yet (mosbius-designs.md); the wrap
// sets it from the first runs. budgets.json byModel.mosbius-designs.sonnet wins.
export const SCRIPTED_DEFAULT = '4M'

// The shell shape, the one copy: skills and agents point here instead of carrying their own
// (kit 1.9 council F3 and M3; captain-call's order section names `SHELL_SHAPE`).
export const SHELL_SHAPE =
  'Shell: zsh, so spell every path out one per line (a `$P` list is not split); one command per Bash call, `git -C <repo>` with absolute paths, no `cd <dir> &&`, no `VAR=value` prefix; checks run as `npm --prefix <lane> ...`, never `--workdir`; edit tracked files with Edit or Write, never a heredoc, `sed -i` or `node -e`; scratch files by absolute path; never run a command that does not exit on its own; a refused call is never retried in another spelling. A shell line naming `prod-db.sh`, `full-auto.sh`, a plugin\'s `hooks/` folder, or writing `${...}`, is refused: use Read, Grep or Edit for those. Commit path-scoped: `git -C <repo> commit -F <msg file> -- <paths>`.'

export const CLOSE_ASK = 'End with "Cheaper next time:" as the report\'s last line.'
export const CLOSE_ASK_PLAYBOOK = 'Put "Cheaper next time:" as the report\'s first field, or "Cheaper next time: none".'

// ---------------------------------------------------------------- the plan

const COLS = {
  step: /^(step|#|id)$/,
  // "What (file:line from the grep)" too: kit 1.10's header printed an empty "The step:".
  what: /^(what|task|step what)\b/,
  agent: /^(agent|who|agent\s*·\s*model|agent,? model)/,
  model: /^model/,
  lane: /^lane$/,
  budget: /^(budget|ceiling|cap)/,
  files: /^(found|files?|where|file:line|reads?)/,
  check: /check/,
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim())

/** Every step row in a plan's markdown tables, as { step, what, agent, model, lane, budget, files, check, raw }. */
export function parseSteps(text) {
  const out = []
  let header = null
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) {
      header = null
      continue
    }
    const row = cells(line)
    if (row.every((c) => /^:?-{2,}:?$/.test(c))) continue
    if (!header) {
      const lower = row.map((c) => c.toLowerCase().replace(/\*/g, ''))
      if (!COLS.step.test(lower[0])) {
        header = []
        continue
      }
      header = lower.map((h) => Object.keys(COLS).find((k) => COLS[k].test(h)) ?? null)
      // "Agent · model" fills both. A What column whose header says it holds
      // the file:line (and no Files column) is the files cell as well.
      const at = header.indexOf('what')
      header.filesFromWhat = at >= 0 && !header.includes('files') && /file/.test(lower[at])
      continue
    }
    if (!header.length) continue
    const rec = { raw: line }
    header.forEach((k, i) => {
      if (k && rec[k] == null) rec[k] = row[i] ?? ''
    })
    if (header.filesFromWhat) rec.files = rec.what
    if (rec.step) out.push(rec)
  }
  return out
}

/** The row for one step id (case-insensitive, bold and backticks ignored). */
export function findStep(text, id) {
  const want = String(id).toLowerCase()
  return parseSteps(text).find((r) => r.step.replace(/[*`]/g, '').trim().toLowerCase() === want) ?? null
}

// ---------------------------------------------------------------- reading the row

const KNOWN = Object.keys(ROUTES)

/** The agents a cell names, in order; "builder" or "pool" means the next free pool name. */
export function agentsIn(cell = '') {
  const s = cell.toLowerCase()
  const found = KNOWN.map((n) => [s.indexOf(n), n]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]).map(([, n]) => n)
  if (!found.length && /navigator|captain-call/.test(s)) return ['navigator']
  if (!found.length && /builder|pool/.test(s)) return [POOL[0]]
  return found
}

export function modelIn(cell = '') {
  const m = cell.toLowerCase().match(/\b(fable|opus|sonnet|haiku)\b/)
  return m ? m[1] : null
}

const M = 1_000_000
export function tokens(v) {
  const m = String(v ?? '').match(/(\d+(?:\.\d+)?)\s*M\b/i)
  return m ? Math.round(Number(m[1]) * M) : null
}
const asM = (n) => `${Math.round((n / M) * 10) / 10}M`

/** The files a file:line cell names: backticked paths first, else path-like words. */
export function filesIn(cell = '') {
  const ticked = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  const pathLike = (s) => /[\w-]+\/[\w./-]+|[\w-]+\.(?:m?[jt]sx?|sql|css|md|json|sh|py|html)\b/.test(s)
  let list = ticked.filter(pathLike)
  if (!list.length) {
    list = cell.split(/[;,]\s*/).map((s) => s.trim().split(/\s+/)[0]).filter(pathLike)
  }
  // `:line` suffixes after a closing backtick (`a.sql`:12) stay with the file.
  return [...new Set(list.map((f) => f.replace(/[().]+$/, '')))]
}

/** A path with its `:12,40` or `:12-20` suffix and any `origin/x:` prefix cut off. */
export function barePath(f) {
  return f.replace(/^origin\/[^:]+:/, '').replace(/:[\d,\s-]+$/, '')
}

// Words that mark a designer step. The route (oceans-eleven Design, H7):
// Fable only for drawn things and steps marked important design; palettes,
// type pairs and a first look on Opus; a plain one-page layout scripted.
// Strict on purpose: a false Fable costs about 7M a run, a false Opus nothing
// (H7), so "drawn" alone ("titles drawn outside h1") is not a drawn thing.
const DRAWN = /\b(icons?|badges?|illustrations?|logos?|glyphs?|emblems?|mascots?|drawn[ -]things?)\b|,\s*drawn\b/i
const IMPORTANT = /important design/i
const LOOK = /\b(palettes?|colou?rs?|colou?r schemes?|schemes?|type pairs?|font pairs?|fonts?|typefaces?|first look|tokens?)\b/i

/**
 * The designer's mode, model and budget for a step's text.
 * tokenCss: a token CSS path the order can hand over (scripted mode needs one).
 */
export function designRoute(text, { tokenCss = null, budgets = {} } = {}) {
  const by = budgets.byModel?.['mosbius-designs'] ?? {}
  const fable = by.fable?.budget ?? DESIGN_STOP
  const opus = by.opus?.budget ?? '5M'
  const sonnet = by.sonnet?.budget ?? SCRIPTED_DEFAULT
  if (DRAWN.test(text)) return { model: 'fable', effort: 'high', mode: 'drawn-things', budget: fable, star: true, why: 'a drawn thing' }
  if (IMPORTANT.test(text)) return { model: 'fable', effort: 'high', mode: 'layout', budget: fable, star: true, why: 'marked important design' }
  if (LOOK.test(text)) return { model: 'opus', effort: 'medium', mode: 'layout', budget: opus, why: 'a palette, type pair or first look runs on Opus at 5M (H7)' }
  // Scripted mode is one page with a standalone mock (mosbius-designs.md).
  const many = /\bpages\b/i.test(text) && !/\bone page\b/i.test(text)
  const route = /\broute in the app\b|--base|MockFrame/i.test(text)
  if (!many && !route && tokenCss) {
    return { model: 'sonnet', effort: 'medium', mode: 'scripted', budget: sonnet, why: 'a plain one-page layout (scripted layout mode)', tokenCss }
  }
  const reason = many ? 'more than one page' : route ? 'the mock is a route in the app' : 'no token CSS found for scripted mode'
  return { model: 'opus', effort: 'medium', mode: 'layout', budget: opus, why: `Opus layout mode: ${reason}` }
}

/**
 * The budget tag for a role, never absent. Order: the plan's cell, then
 * kit.json budgets, then budgets.json roles, then `other`. A designer with
 * none, or "lifted"/"unlimited", gets the 12M stop (H7); a build order above
 * the ceiling is held at it unless the role may go above (oceans-eleven).
 */
export function budgetFor(agent, cell, { budgets = {}, kitBudgets = {}, design = null } = {}) {
  const ceiling = tokens(budgets.ceiling) ?? 15 * M
  const above = new Set(budgets.aboveCeiling ?? [])
  const notes = []
  let n = tokens(cell)
  const open = !n && /lifted|unlimited|none|no cap|∞/i.test(cell ?? '')
  if (agent === 'mosbius-designs' || agent === 'heisenberg') {
    const routeCap = tokens(design?.budget) ?? tokens(DESIGN_STOP)
    if (!n) {
      n = agent === 'heisenberg' ? tokens(kitBudgets[agent] ?? budgets.roles?.[agent]) ?? 8 * M : routeCap
      notes.push(open ? `the plan said "${cell.trim()}"; a designer order is never uncapped, so the route's ${asM(n)} stop (H7)` : `no budget in the plan; the route's ${asM(n)}`)
    } else if (agent === 'mosbius-designs' && n > routeCap) {
      notes.push(`the plan said ${asM(n)}; the route for ${design?.mode ?? 'this'} on ${design?.model ?? 'opus'} is ${asM(routeCap)} (H7)`)
      n = routeCap
    }
    return { tag: `[budget ${asM(n)}]`, tokens: n, notes }
  }
  if (!n) {
    const d = kitBudgets[agent] ?? budgets.roles?.[agent] ?? budgets.other ?? '15M'
    n = tokens(d)
    notes.push(open ? `the plan said "${cell.trim()}"; no order runs uncapped, so the role's default ${asM(n)}` : `no budget in the plan; the role's default ${asM(n)}`)
  }
  if (n > ceiling && !above.has(agent)) {
    notes.push(`the plan said ${asM(n)}, above the ${asM(ceiling)} ceiling for a build or fix order; held at it (cut the step at /inception)`)
    n = ceiling
  }
  return { tag: `[budget ${asM(n)}]`, tokens: n, notes }
}

// ---------------------------------------------------------------- a look (kit 1.10, F4)

// A look: one direction drawn on the navigator's stage, a shot and a verdict per page
// (mosbius-designs.md, "A look"). The row says so in words; "first look" is the
// palette route above, and "a look at" is plain English, so neither counts.
export const LOOK_STEP = /\b(look orders?|look rounds?|mode:?\s*look)\b|(?<!first )\ba look\b(?! at)/i

/** The `?dir=` value for a direction name: lower case, words joined by dashes. */
export const dirParam = (d) => `?dir=${encodeURIComponent(slugDir(d))}`
const slugDir = (d) => String(d).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

/**
 * The tag for a look, from the last look's real spend: the last row of the plan's
 * `<plan>-steps.tsv` (step-done.mjs writes it) whose step names a look, rounded up to
 * the whole M; else the Opus designer's route default. Why: the four Burrow looks
 * ran 17 to 27M a designer against a 12M tag (council H3), so the measured number
 * is the honest one.
 */
export function lookBudget(stepsText, budgets = {}) {
  const fallback = budgets.byModel?.['mosbius-designs']?.opus?.budget ?? '5M'
  const lines = String(stepsText ?? '').split('\n').filter((l) => l.trim())
  const head = (lines[0] ?? '').split('\t')
  const at = (name) => head.indexOf(name)
  if (at('step') < 0 || at('used') < 0) return { tag: `[budget ${fallback}]`, tokens: tokens(fallback), from: null }
  const last = lines.slice(1).map((l) => l.split('\t')).filter((c) => /\blook\b/i.test(c[at('step')] ?? '')).pop()
  const used = last ? tokens(last[at('used')]) : null
  if (!used) return { tag: `[budget ${fallback}]`, tokens: tokens(fallback), from: null }
  const n = Math.ceil(used / M) * M
  return { tag: `[budget ${asM(n)}]`, tokens: n, from: `step ${last[at('step')]} used ${asM(used)}` }
}

/** The look block: stage, direction, `?dir=`, the part's pages, the one-Read rule. */
export function lookOrder({ stage = null, direction = null, pages = [] }) {
  const notes = []
  if (!stage) notes.push('a look needs the stage: build it once, then compose again with --stage <path>')
  if (!direction) notes.push('a look draws one direction: compose again with --look <direction>')
  if (!pages.length) notes.push('no pages in the row\'s files cell: name the part\'s pages there')
  return { stage, direction, param: direction ? dirParam(direction) : null, pages, notes }
}

// ---------------------------------------------------------------- the project

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.vercel', '.turbo', 'out'])

/** Every file under dir, skipping build folders and dot folders (but not .claude). */
export function walk(dir, max = 20000) {
  const out = []
  const go = (d) => {
    if (out.length >= max || !existsSync(d)) return
    for (const name of readdirSync(d).sort()) {
      if (SKIP.has(name) || (name.startsWith('.') && name !== '.claude')) continue
      // Stale worktrees in the main checkout's .claude/worktrees/ gave false test hits (kit 1.9).
      if (name === 'worktrees' && basename(d) === '.claude') continue
      const p = join(d, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) go(p)
      else out.push(p)
    }
  }
  go(dir)
  return out
}

const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)supabase\/tests\//.test(p) || /(^|\/)__tests__\//.test(p)

/** Resolve a plan path against the project: as written, else by its basename. */
export function resolveFile(root, f, all) {
  const bare = barePath(f)
  if (existsSync(join(root, bare))) return bare
  const hit = all.find((p) => p.endsWith(`/${bare}`))
  return hit ? relative(root, hit) : null
}

/** The test files that name a file (its root path without extension, or `/<stem>` in an import or a quote). */
export function testsReading(root, files, all = walk(root)) {
  const tests = all.filter((p) => isTest(relative(root, p)))
  const keys = files.map((f) => {
    const rel = f.replace(/\.[cm]?[jt]sx?$/, '')
    const stem = basename(f, extname(f))
    return { rel, stem, sql: extname(f) === '.sql' }
  })
  const out = new Set()
  for (const t of tests) {
    let body
    try {
      body = readFileSync(t, 'utf8')
    } catch {
      continue
    }
    for (const k of keys) {
      const self = relative(root, t).replace(/\.(test|spec)(\.[cm]?[jt]sx?)$/, '$2').replace(/\.[cm]?[jt]sx?$/, '')
      if (self === k.rel) {
        out.add(relative(root, t))
        continue
      }
      const re = new RegExp(`(^|[/'"\`\\s])${k.stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[a-z]+)?['"\`\\s)]`, 'm')
      if (body.includes(k.rel) || (k.stem.length >= 4 && re.test(body))) out.add(relative(root, t))
    }
  }
  return [...out].sort()
}

const STOP = new Set('about after again their there these those which while where would could should every other under first lines order orders being still never always plain makes check build'.split(' '))
const words = (s) => new Set((s.toLowerCase().match(/[a-z][a-z0-9_-]{4,}/g) ?? []).filter((w) => !STOP.has(w)))

/**
 * The standing-facts lines that touch a step: every bullet under a heading
 * named Shell or Every order, and any other bullet that shares a backticked
 * token or path with the step, or two words with its text. Example lines
 * (with `<...>` placeholders) are skipped.
 */
export function factsFor(text, stepText, files = []) {
  const out = []
  let section = ''
  const stepWords = words(stepText + ' ' + files.join(' '))
  const hay = (stepText + ' ' + files.join(' ')).toLowerCase()
  for (const line of text.split('\n')) {
    const h = line.match(/^#{2,}\s+(.*)/)
    if (h) {
      section = h[1].toLowerCase()
      continue
    }
    if (!/^\s*[-*]\s+/.test(line) || /<[^>]+>/.test(line)) continue
    const bullet = line.replace(/^\s*[-*]\s+/, '').trim()
    if (/^(shell|every order|always)/.test(section)) {
      out.push(bullet)
      continue
    }
    const ticks = [...bullet.matchAll(/`([^`]+)`/g)].map((m) => m[1].toLowerCase())
    if (ticks.some((t) => t.length >= 3 && hay.includes(t)) || files.some((f) => bullet.includes(barePath(f)))) {
      out.push(bullet)
      continue
    }
    let shared = 0
    for (const w of words(bullet)) if (stepWords.has(w)) shared++
    if (shared >= 2) out.push(bullet)
  }
  return out
}

/**
 * The plan's rules that hold on this step's surface (Burrow V1.12 retro, fix
 * 10: "never a second row" sat in the plan and reached no order). A rule is a
 * bullet under `## Plan rules`: `<rule> · surface: <words, paths or step ids> ·
 * check: <a grep or a shot>`. It touches the step when a surface word of three
 * letters or more is in the step's id, text or files, or the surface is
 * `all` or `every page`. A rule with no surface touches every step.
 */
export function planRulesFor(planText, row, files = []) {
  const out = []
  let inside = false
  const hay = [row.step, row.what, row.check, row.files, ...files].filter(Boolean).join(' ').toLowerCase()
  for (const line of String(planText ?? '').split('\n')) {
    const h = line.match(/^#{2,}\s+(.*)/)
    if (h) {
      inside = /plan rules/i.test(h[1])
      continue
    }
    if (!inside || !/^\s*[-*]\s+\S/.test(line)) continue
    const rule = line.replace(/^\s*[-*]\s+/, '').trim()
    const surface = rule.match(/surface:\s*([^·|]+)/i)?.[1]?.trim().toLowerCase() ?? ''
    const word = (w) => w.replace(/[`*]/g, '')
    const hit = !surface || /^(all|every page)\b/.test(surface) || surface.split(/[\s,;]+/).some((w) => word(w).length >= 3 && hay.includes(word(w)))
    if (hit) out.push({ rule, check: rule.match(/check:\s*(.+)$/i)?.[1]?.trim() ?? null })
  }
  return out
}

// Never Sonnet on design (oceans-eleven, Build; Burrow V1.12 retro, fix 3).
const DESIGN_WORK = /\b(re-?design\w*|redo(?:es|ne)?|redraw\w*|restyl\w*|design|layouts?|looks?|glass)\b/i

/** A token CSS file the scripted designer can take: the row's own .css, else a usual globals file. */
export function tokenCssFor(root, files, all) {
  const own = files.map(barePath).find((f) => f.endsWith('.css'))
  if (own) return own
  for (const c of ['app/globals.css', 'src/app/globals.css', 'src/styles/tokens.css', 'styles/tokens.css', 'src/index.css', 'styles/globals.css']) {
    if (existsSync(join(root, c))) return c
  }
  const tok = all.find((p) => /tokens?\.css$/.test(p))
  return tok ? relative(root, tok) : null
}

// ---------------------------------------------------------------- the lane brief

/** Tables and functions a playbook step names: snake_case backticked or bold words, `fn()` calls; never a migration name. */
export function dbNames(text) {
  const raw = [...text.matchAll(/`([^`]+)`|\*\*([^*]+)\*\*/g)].map((m) => (m[1] ?? m[2]).trim())
  const out = new Set()
  for (const r of raw) {
    for (const piece of r.split(/[\s,]+/)) {
      // `spend.split_pct` names the table `spend`; the column is not a scope target.
      const dotted = piece.match(/^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/)
      if (dotted && !/^(sql|m?[jt]sx?|css|md|json|sh|html|py)$/.test(dotted[2])) {
        out.add(dotted[1])
        continue
      }
      const w = piece.replace(/\(.*$/, '').replace(/[^\w.]/g, '')
      if (!w || /^\d/.test(w) || /\.(sql|ts|tsx|js|mjs|css|md)$/.test(w) || w.includes('/')) continue
      if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(w) || (/\(\)$/.test(piece) && /^[a-z][a-z0-9_]*$/.test(w))) out.add(w)
    }
  }
  return [...out]
}

/** The lane's commands: kit.json database.* first, else from the stack (local or hosted) and package.json scripts. */
export function laneCommands(root, kit = {}) {
  const db = kit.database ?? {}
  let scripts = {}
  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}
  } catch {}
  const ref = kit.refs?.dev ?? ''
  const local = !ref || /localstack|placeholder|local/i.test(ref)
  const flag = local ? '--local' : '--linked'
  const dbPlugin = existsSync(resolve(HERE, '../../database/scripts/run-tests.mjs')) ? resolve(HERE, '../../database') : '<database plugin>'
  return {
    stack: local ? 'local' : `hosted dev (${ref})`,
    test: db.test ?? (scripts['test:db'] ? 'npm run test:db' : `node ${dbPlugin}/scripts/run-tests.mjs`),
    apply: db.apply ?? (local ? 'supabase migration up --local' : 'supabase db push --linked --dry-run, then the same with --yes'),
    schema: db.schema ?? `supabase db query ${flag} "<sql>"`,
    types: db.types ?? (scripts.types ? 'npm run types' : null),
    scope: `node ${dbPlugin}/scripts/scope.mjs`,
  }
}

/** The non-code files that name a thing: docs, CLAUDE.md, .claude/*.md, README, supabase/queries. */
export function docsNaming(root, name, all) {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  return all
    .map((p) => relative(root, p))
    .filter((p) => /\.(md|txt|sql)$/.test(p) && (/^(docs|\.claude)\//.test(p) || /^(CLAUDE|README)\.md$/.test(p) || /^supabase\/queries\//.test(p)))
    .filter((p) => {
      try {
        return re.test(readFileSync(join(root, p), 'utf8'))
      } catch {
        return false
      }
    })
}

// ---------------------------------------------------------------- the lane block (--lane)
//
// Kit 1.9 council F3 and M3: a builder spent turns finding its lane's port, seeding by hand
// and running check.sh in the wrong tree (≈ 25 of 87 cheaper lines), and with omitClaudeMd
// (call 3) it no longer sees the project's CLAUDE.md, so the order names the conventions
// section and standing-facts.md by path.

/** The lane's check command: `npm --prefix <lane> run check`, else its `test` script; never `--workdir` (M3). */
export function checkCommand(lane) {
  const scripts = readJson(join(lane, 'package.json'))?.scripts ?? {}
  if (scripts.check) return `npm --prefix ${lane} run check`
  if (scripts.test) return `npm --prefix ${lane} test`
  return null
}

/** The lane's own port from lane.mjs's registry (<git common dir>/wolfpack-lanes.json), else kit.json project.devPort. */
export function lanePort(lane, kit = {}) {
  try {
    const common = execFileSync('git', ['-C', lane, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const reg = readJson(join(common, 'wolfpack-lanes.json')) ?? {}
    const mine = Object.values(reg).find((l) => l?.path && resolve(l.path) === resolve(lane))
    if (mine?.port) return { port: Number(mine.port), from: 'lane.mjs registry' }
  } catch {}
  const p = Number(kit?.project?.devPort)
  return p ? { port: p, from: 'kit.json project.devPort' } : null
}

/** Lane seeds: scripts/qa/seeds/<name>.up.sql files whose SQL carries {{LANE}} (qa-seed.mjs fills it with the lane name). */
export function laneSeeds(lane) {
  const dir = join(lane, 'scripts', 'qa', 'seeds')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.up.sql') && readFileSync(join(dir, f), 'utf8').includes('{{LANE}}'))
    .map((f) => f.slice(0, -'.up.sql'.length))
    .sort()
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to dashes. */
export const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')

/** The README section a step updates: the `##`/`###` heading whose section names most of the step's files (by base name). */
export function readmeAnchor(lane, files = []) {
  const file = join(lane, 'README.md')
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').split('\n')
  const sections = []
  for (const l of lines) {
    const m = l.match(/^(#{2,3})\s+(.+?)\s*$/)
    if (m) sections.push({ heading: m[2], text: '' })
    else if (sections.length) sections.at(-1).text += `${l}\n`
  }
  if (!sections.length) return null
  const names = [...new Set(files.map((f) => basename(barePath(f))).filter(Boolean))]
  let best = null
  let score = 0
  for (const s of sections) {
    const n = names.filter((x) => s.text.includes(x)).length
    if (n > score) [best, score] = [s, n]
  }
  return best ? { heading: best.heading, anchor: `README.md#${slug(best.heading)}` } : { heading: null, anchor: 'README.md (no section names the step\'s files: pick the closest)' }
}

/** The project CLAUDE.md's conventions heading, by name and path (the builders run with omitClaudeMd). */
export function conventionsSection(lane) {
  for (const rel of ['CLAUDE.md', join('.claude', 'CLAUDE.md')]) {
    const file = join(lane, rel)
    if (!existsSync(file)) continue
    const h = readFileSync(file, 'utf8').split('\n').find((l) => /^#{1,4}\s+.*conventions?\b/i.test(l))
    if (h) return { path: file, heading: h.trim() }
  }
  return null
}

/** The lane block: everything a builder used to find by hand in its first turns. */
export function laneBlock(laneArg, { root = laneArg, files = [], step = '<step>' } = {}) {
  const lane = resolve(laneArg)
  const kit = readJson(join(lane, '.claude', 'kit.json')) ?? readJson(join(root, '.claude', 'kit.json')) ?? {}
  const port = lanePort(lane, kit)
  const design = resolve(HERE, '../../design')
  const shotScript = join(lane, 'scripts', 'qa', 'shot.mjs')
  let shot
  if (existsSync(shotScript) && port) shot = `node ${shotScript} <page> --base http://localhost:${port.port} --width 375|1024 [--theme dark] --out <scratch>/${step}-<width>-<theme>.png`
  else if (existsSync(shotScript)) shot = `node ${shotScript} <page> --base http://localhost:<port> --width 375|1024 --out <scratch>/${step}-<width>-<theme>.png (no port known: set kit.json project.devPort)`
  else if (port) shot = `no scripts/qa/shot.mjs in the project: one shot in the pane on http://localhost:${port.port}, saved with ${design}/scripts/qa/save-shot.mjs`
  else shot = 'no dev server (no project.devPort): no shots'
  const facts = join(lane, '.claude', 'standing-facts.md')
  return {
    path: lane,
    name: basename(lane),
    check: checkCommand(lane),
    port,
    seeds: laneSeeds(lane).map((s) => ({ name: s, up: `node ${design}/scripts/qa-seed.mjs up ${s} --lane ${basename(lane)} --root ${lane}` })),
    shot,
    readme: readmeAnchor(lane, files),
    conventions: conventionsSection(lane),
    facts: existsSync(facts) ? facts : null,
  }
}

/** The lane block as order lines. */
export function renderLane(b) {
  const L = ['Lane block:', `- Lane: ${b.path} (work, test and commit here only)`]
  L.push(`- Check: ${b.check ?? '(no check or test script in package.json: ask the navigator)'}; report its first failure or "pass"`)
  L.push(`- Dev port: ${b.port ? `${b.port.port} (${b.port.from})` : 'none (no project.devPort)'}`)
  if (b.seeds.length) for (const s of b.seeds) L.push(`- Seed ${s.name}: \`${s.up}\` (down the same with \`down\`)`)
  else L.push('- Seed: none (no scripts/qa/seeds/*.up.sql carries {{LANE}})')
  L.push(`- Shots: ${b.shot}`)
  L.push(`- README: ${b.readme ? (b.readme.heading ? `${b.readme.anchor} ("${b.readme.heading}")` : b.readme.anchor) : 'no README.md'}`)
  L.push(`- Conventions: ${b.conventions ? `${b.conventions.path}, section "${b.conventions.heading}" (read that section only)` : 'no conventions heading in CLAUDE.md'}`)
  L.push(`- Standing facts: ${b.facts ?? 'none yet (.claude/standing-facts.md)'}`)
  return L
}

// ---------------------------------------------------------------- composing

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The dealt directions for a designer order (`design/scripts/deal.mjs`), or a note when it can't.
 * `log` writes the deal to the project's deals.log: the composed order is the deal of record,
 * since every release order passes through here and a dry deal would never rotate.
 */
export function dealFor(root, mode, { log = false, args = [] } = {}) {
  if (!dealDirections) return { error: 'the design plugin is not beside this one: run <design>/scripts/deal.mjs --project <dir> and paste its Brief line' }
  const kind = mode === 'drawn-things' ? 'drawn' : 'layout'
  try {
    const d = dealDirections(['--project', root, '--kind', kind, ...(log ? [] : ['--dry']), ...args])
    return { kind, brief: d.brief, names: d.dealt.map((x) => x.name), starter: d.starter, log: d.log, notes: d.notes }
  } catch (err) {
    return { error: `deal.mjs: ${err.message}` }
  }
}

/**
 * The order for one step, as data. Paths are passed in, so tests never touch the real ~/.claude.
 * `deal` goes to dealFor: `{ log, args }` (args carry deal.mjs's --library and --log-dir in tests).
 */
export function compose({ planText, stepId, root, lane = null, look = null, stage = null, stepsText = null, budgets = readJson(join(HERE, '..', 'budgets.json')) ?? {}, deal = {} }) {
  const row = findStep(planText, stepId)
  if (!row) return { error: `no row for step ${stepId} in the plan's tables` }
  const kit = readJson(join(root, '.claude', 'kit.json')) ?? {}
  const kitBudgets = kit.budgets && typeof kit.budgets === 'object' ? kit.budgets : {}
  const factsText = existsSync(join(root, '.claude', 'standing-facts.md')) ? readFileSync(join(root, '.claude', 'standing-facts.md'), 'utf8') : null
  const agents = agentsIn(row.agent)
  const agent = agents[0] ?? null
  const all = walk(root)
  const planFiles = filesIn(row.files ?? '')
  const resolved = planFiles.map((f) => ({ plan: f, path: resolveFile(root, f, all) }))
  const found = resolved.filter((r) => r.path).map((r) => r.path)
  const stepText = [row.what, row.check].filter(Boolean).join(' ')
  const notes = []

  if (!agent || agent === 'navigator') {
    return { step: row.step, agent: agent ?? 'unknown', what: row.what, notes: [agent ? 'the navigator does this step itself; no order' : `no known agent in "${row.agent}"; route it by oceans-eleven first`] }
  }
  if (agents.length > 1) notes.push(`the row names ${agents.join(' + ')}: one order each; this one is ${agent}`)

  const route = ROUTES[agent]
  let model = route.model
  let effort = route.effort
  let mode = route.kind === 'build' ? 'build' : null
  let design = null
  const asked = modelIn(row.model ?? '') ?? modelIn(row.agent ?? '')

  const isLook = agent === 'mosbius-designs' && (look != null || LOOK_STEP.test(row.what ?? ''))
  if (look != null && agent !== 'mosbius-designs') notes.push(`--look is for a mosbius-designs step; ${agent} gets its usual order`)
  if (isLook) {
    // A look runs on Opus whatever the words say: one direction is drawn, not chosen.
    model = 'opus'
    effort = 'medium'
    mode = 'look'
    notes.push(look != null ? 'a look order (--look)' : 'a look order (the row names a look)')
  } else if (agent === 'mosbius-designs') {
    design = designRoute(`${row.what} ${row.agent} ${row.model ?? ''}`, { tokenCss: tokenCssFor(root, planFiles, all), budgets })
    model = design.model
    effort = design.effort
    mode = design.mode
    if (asked && asked !== model) notes.push(`the plan said ${asked}; the route says ${model}: ${design.why} (H7)`)
    else notes.push(design.why)
  } else if (asked && asked !== model) {
    const reason = (row.model ?? row.agent ?? '').match(/\(([^)]+)\)/)
    if (agent === 'kissochbajslowski' && asked === 'opus' && !reason) notes.push('the plan names Opus for the reviewer with no reason; kept on the Sonnet route (call B)')
    else {
      model = asked
      notes.push(`the plan names ${asked} over the route's ${route.model}${reason ? ` (${reason[1]})` : ''}`)
    }
  }
  if (/\bxhigh\b/i.test(`${row.model ?? ''} ${row.agent ?? ''}`)) effort = 'xhigh'

  if (model === 'sonnet' && route.kind === 'build' && DESIGN_WORK.test(row.what ?? '')) {
    notes.push('design work on Sonnet: give it to the next free Opus builder and the design team, never Sonnet on design (oceans-eleven, Build)')
  }
  let budget
  if (isLook) {
    const spent = lookBudget(stepsText, budgets)
    const cell = tokens(row.budget)
    budget = spent.from || !cell ? spent : { tag: `[budget ${asM(cell)}]`, tokens: cell }
    notes.push(spent.from ? `the tag is the last look's real spend (${spent.from}, the steps file)` : cell ? 'no look in the steps file yet; the plan\'s cell' : 'no look in the steps file yet; the Opus designer\'s default')
  } else {
    budget = budgetFor(agent, row.budget ?? '', { budgets, kitBudgets, design })
    notes.push(...budget.notes)
  }
  const short = (row.what ?? '').replace(/\*\*/g, '').replace(/`/g, '').split(/[:.;(]/)[0].trim().slice(0, 50)

  const order = {
    step: row.step,
    agent,
    model,
    effort,
    budget: budget.tag,
    mode,
    description: `${agent}: step ${row.step} ${short} ${budget.tag}`.replace(/\s+/g, ' '),
    what: row.what ?? '',
    lane: row.lane ?? null,
    check: row.check ?? null,
    files: resolved.map((r) => r.path ?? `${r.plan} (not found in the project)`),
    tests: found.length ? testsReading(root, found.map(barePath), all) : [],
    facts: factsText ? factsFor(factsText, stepText, planFiles) : null,
    rules: planRulesFor(planText, row, planFiles),
    shell: SHELL_SHAPE,
    close: agent === 'the-playbook' ? CLOSE_ASK_PLAYBOOK : CLOSE_ASK,
    notes,
  }
  if (design?.tokenCss) order.tokenCss = design.tokenCss
  if (isLook) {
    // No deal: the direction is the navigator's, from the gallery round it belongs to.
    order.look = lookOrder({ stage, direction: typeof look === 'string' && look.trim() ? look.trim() : null, pages: order.files })
    notes.push(...order.look.notes)
  } else if (agent === 'mosbius-designs') {
    order.deal = dealFor(root, mode, deal)
    if (order.deal.error) notes.push(order.deal.error)
  }
  for (const r of order.rules) if (!r.check) notes.push(`plan rule with no check: "${r.rule}"; add the grep or shot that proves it before the spawn`)
  if (!factsText) notes.push('no .claude/standing-facts.md yet: the first preflight copies the release plugin\'s templates/standing-facts.md')
  if (lane) {
    order.lane_block = laneBlock(lane, { root, files: planFiles, step: row.step })
    if (!order.lane_block.conventions) notes.push('the lane has no CLAUDE.md conventions heading: a builder with omitClaudeMd sees no conventions, so name them in the order')
  }

  if (agent === 'the-playbook') {
    const cmd = laneCommands(root, kit)
    const names = dbNames(`${row.what ?? ''} ${row.files ?? ''}`)
    order.lane_brief = {
      stack: cmd.stack,
      test: cmd.test,
      apply: cmd.apply,
      schema: cmd.schema,
      types: cmd.types,
      names: names.map((n) => ({ name: n, scope: `${cmd.scope} ${n} --root ${root}`, docs: docsNaming(root, n, all) })),
    }
  }
  return order
}

/** The order as the text block the navigator pastes. */
export function render(o) {
  if (o.error) return o.error
  const L = [`Step ${o.step}: ${o.agent}`]
  if (!o.model) {
    for (const n of o.notes) L.push(`- ${n}`)
    return L.join('\n')
  }
  L.push(`Spawn: agent ${o.agent}, model: "${o.model}", effort ${o.effort}${o.mode ? `, mode: ${o.mode}` : ''}`)
  L.push(`Description: ${o.description}`)
  if (o.lane) L.push(`Lane: ${o.lane}`)
  L.push('', `The step: ${o.what}`)
  if (o.tokenCss) L.push(`Token CSS (scripted mode): ${o.tokenCss}`)
  if (o.look) {
    const k = o.look
    L.push('', 'The look:')
    L.push(`- Stage: ${k.stage ?? '(not built yet: the navigator builds it once)'}; never build or edit it`)
    L.push(`- Direction: ${k.direction ?? '(not named)'}, the only one; no second option, no scaffold`)
    L.push(`- Open each page with \`${k.param ?? '?dir=<direction>'}\` on the stage`)
    L.push('- Pages:', ...(k.pages.length ? k.pages.map((p) => `  - ${p}`) : ['  - (none named in the row)']))
    L.push('- One shot and one verdict per page: does the direction hold here, and what breaks')
    L.push('- One Read per message (mosbius-designs.md, kit 1.10)')
  }
  if (o.deal && !o.deal.error) {
    L.push('', 'Dealt directions:', o.deal.brief)
    for (const n of o.deal.notes) L.push(`- ${n}`)
    L.push(o.deal.log ? `- This deal is logged (${o.deal.log}): draw these, never a fresh deal.` : '- A dry deal, not logged: compose again without --dry for the order you spawn.')
  }
  L.push('', 'Files to read:', ...(o.files.length ? o.files.map((f) => `- ${f}`) : ['- (none named in the row)']))
  L.push('', 'Tests that read them:', ...(o.tests.length ? o.tests.map((f) => `- ${f}`) : ['- (none found)']))
  if (o.check) L.push('', `Check: ${o.check}`)
  if (o.facts) L.push('', 'Standing facts:', ...(o.facts.length ? o.facts.map((f) => `- ${f}`) : ['- (none touch this step)']))
  if (o.rules?.length) L.push('', 'Plan rules on this surface (keep each, and run its check before you report):', ...o.rules.map((r) => `- ${r.rule}`))
  if (o.lane_brief) {
    const b = o.lane_brief
    L.push('', `Lane brief (${b.stack}):`, `- Test: ${b.test}`, `- Apply: ${b.apply}`, `- Read the schema: ${b.schema}`)
    if (b.types) L.push(`- Types: ${b.types}`)
    for (const n of b.names) {
      L.push(`- ${n.name}: \`${n.scope}\`${n.docs.length ? `; named in ${n.docs.join(', ')}` : ''}`)
    }
    if (!b.names.length) L.push('- (no table or function named in the row; run scope.mjs per name the step touches)')
  }
  if (o.lane_block) L.push('', ...renderLane(o.lane_block))
  L.push('', o.shell, '', o.close)
  if (o.notes.length) L.push('', 'Composer notes (for the navigator, not the order):', ...o.notes.map((n) => `- ${n}`))
  return L.join('\n')
}

export function parseArgs(argv) {
  const a = { json: false, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--json') a.json = true
    else if (k === '--dry') a.dry = true
    else if (k === '--look' || k === '--stage') a[k.slice(2)] = argv[i + 1]?.startsWith('--') ? '' : argv[++i]
    else if (k === '--plan' || k === '--step' || k === '--project' || k === '--lane') a[k.slice(2)] = argv[++i]
    else return { error: `unknown argument ${k}` }
  }
  if (!a.plan || !a.step) return { error: 'usage: node compose-order.mjs --plan <plan file> --step <id> [--project <dir>] [--lane <path>] [--look <direction> --stage <path>] [--json] [--dry]' }
  if ('lane' in a && !a.lane) return { error: '--lane needs a path' }
  if ('look' in a && !a.look) return { error: '--look needs a direction name' }
  if ('stage' in a && !a.stage) return { error: '--stage needs a path' }
  return a
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (a.error) {
    console.error(a.error)
    process.exit(2)
  }
  if (!existsSync(a.plan)) {
    console.error(`no plan at ${a.plan}`)
    process.exit(2)
  }
  const root = resolve(a.project ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
  if (a.lane && !existsSync(a.lane)) {
    console.error(`no lane at ${a.lane}`)
    process.exit(2)
  }
  // The steps file sits beside the plan, named as step-done.mjs's stepsFileFor names it.
  const stepsFile = join(dirname(a.plan), `${basename(a.plan).replace(/\.md$/, '')}-steps.tsv`)
  const o = compose({
    planText: readFileSync(a.plan, 'utf8'),
    stepId: a.step,
    root,
    lane: a.lane ? resolve(a.lane) : null,
    look: a.look ?? null,
    stage: a.stage ? resolve(a.stage) : null,
    stepsText: existsSync(stepsFile) ? readFileSync(stepsFile, 'utf8') : null,
    deal: { log: !a.dry },
  })
  if (o.error) {
    console.error(o.error)
    process.exit(2)
  }
  console.log(a.json ? JSON.stringify(o, null, 2) : render(o))
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main()
