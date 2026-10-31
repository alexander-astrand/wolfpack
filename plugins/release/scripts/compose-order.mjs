#!/usr/bin/env node
// The order composer: the fixed half of one step's work order, built from the
// plan's step row, the project's kit.json, .claude/standing-facts.md, the
// budgets file and the routing rules, so the navigator writes only the half
// that needs judgment (the why, the taste lines, the shared parts).
//
// Usage: node compose-order.mjs --plan <plan file> --step <id> [--project <dir>] [--json]
//   prints   one block: agent, model, effort, the `[budget NM]` tag (never
//            absent), mode, the step, the files to read (the row's file:line
//            column), the tests that read them, the standing facts that touch
//            the step, the shell-shape line and the closing "Cheaper next
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

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

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
  'tomas-svensson': { model: 'sonnet', effort: 'medium', kind: 'qa' },
  kissochbajslowski: { model: 'sonnet', effort: 'high', kind: 'review' },
  daredevil: { model: 'sonnet', effort: 'high', kind: 'review' },
}

// The designer's stop when an order has no cap, or "lifted"/"unlimited" (H7).
export const DESIGN_STOP = '12M'
// Scripted layout mode has no measured rate yet (mosbius-designs.md); the wrap
// sets it from the first runs. budgets.json byModel.mosbius-designs.sonnet wins.
export const SCRIPTED_DEFAULT = '4M'

export const SHELL_LINE =
  'Shell: zsh, so spell every path out one per line (a `$P` list is not split); one command per Bash call, `git -C <repo>` with absolute paths, no `cd <dir> &&`, no `VAR=value` prefix; edit tracked files with Edit or Write, never a heredoc or `node -e`; scratch files by absolute path; never run a command that does not exit on its own; a refused call is never retried in another spelling. A shell line naming `prod-db.sh`, `full-auto.sh`, a plugin\'s `hooks/` folder, or writing `${...}`, is refused: use Read, Grep or Edit for those. Commit path-scoped: `git -C <repo> commit -F <msg file> -- <paths>`.'

export const CLOSE_ASK = 'End with "Cheaper next time:" as the report\'s last line.'
export const CLOSE_ASK_PLAYBOOK = 'Put "Cheaper next time:" as the report\'s first field, or "Cheaper next time: none".'

// ---------------------------------------------------------------- the plan

const COLS = {
  step: /^(step|#|id)$/,
  what: /^(what|task|step what)$/,
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
      // "Agent · model" fills both.
      continue
    }
    if (!header.length) continue
    const rec = { raw: line }
    header.forEach((k, i) => {
      if (k && rec[k] == null) rec[k] = row[i] ?? ''
    })
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

// ---------------------------------------------------------------- the project

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.vercel', '.turbo', 'out'])

/** Every file under dir, skipping build folders and dot folders (but not .claude). */
export function walk(dir, max = 20000) {
  const out = []
  const go = (d) => {
    if (out.length >= max || !existsSync(d)) return
    for (const name of readdirSync(d).sort()) {
      if (SKIP.has(name) || (name.startsWith('.') && name !== '.claude')) continue
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

// ---------------------------------------------------------------- composing

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** The order for one step, as data. Paths are passed in, so tests never touch the real ~/.claude. */
export function compose({ planText, stepId, root, budgets = readJson(join(HERE, '..', 'budgets.json')) ?? {} }) {
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

  if (agent === 'mosbius-designs') {
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

  const budget = budgetFor(agent, row.budget ?? '', { budgets, kitBudgets, design })
  notes.push(...budget.notes)
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
    shell: SHELL_LINE,
    close: agent === 'the-playbook' ? CLOSE_ASK_PLAYBOOK : CLOSE_ASK,
    notes,
  }
  if (design?.tokenCss) order.tokenCss = design.tokenCss
  if (!factsText) notes.push('no .claude/standing-facts.md yet: the first preflight copies the release plugin\'s templates/standing-facts.md')

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
  L.push('', 'Files to read:', ...(o.files.length ? o.files.map((f) => `- ${f}`) : ['- (none named in the row)']))
  L.push('', 'Tests that read them:', ...(o.tests.length ? o.tests.map((f) => `- ${f}`) : ['- (none found)']))
  if (o.check) L.push('', `Check: ${o.check}`)
  if (o.facts) L.push('', 'Standing facts:', ...(o.facts.length ? o.facts.map((f) => `- ${f}`) : ['- (none touch this step)']))
  if (o.lane_brief) {
    const b = o.lane_brief
    L.push('', `Lane brief (${b.stack}):`, `- Test: ${b.test}`, `- Apply: ${b.apply}`, `- Read the schema: ${b.schema}`)
    if (b.types) L.push(`- Types: ${b.types}`)
    for (const n of b.names) {
      L.push(`- ${n.name}: \`${n.scope}\`${n.docs.length ? `; named in ${n.docs.join(', ')}` : ''}`)
    }
    if (!b.names.length) L.push('- (no table or function named in the row; run scope.mjs per name the step touches)')
  }
  L.push('', o.shell, '', o.close)
  if (o.notes.length) L.push('', 'Composer notes (for the navigator, not the order):', ...o.notes.map((n) => `- ${n}`))
  return L.join('\n')
}

export function parseArgs(argv) {
  const a = { json: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--json') a.json = true
    else if (k === '--plan' || k === '--step' || k === '--project') a[k.slice(2)] = argv[++i]
    else return { error: `unknown argument ${k}` }
  }
  if (!a.plan || !a.step) return { error: 'usage: node compose-order.mjs --plan <plan file> --step <id> [--project <dir>] [--json]' }
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
  const o = compose({ planText: readFileSync(a.plan, 'utf8'), stepId: a.step, root })
  if (o.error) {
    console.error(o.error)
    process.exit(2)
  }
  console.log(a.json ? JSON.stringify(o, null, 2) : render(o))
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main()
