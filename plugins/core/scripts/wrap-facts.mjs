#!/usr/bin/env node
// The facts a release's wrap-up needs, in one JSON call (kit 1.7, council
// Feature 6 and core Feature 1): wraps averaged 22.7M, most of it about 30
// reads to rebuild the same tables by hand every time.
//
// Usage: node <core plugin>/scripts/wrap-facts.mjs <version> [--project <dir>]
//          [--usage <path to usage.mjs>]
//
// Returns:
//   prs          the release's PRs (number, title, state, draft, merge sha), from `gh`, read-only
//   sessions     the session ids named in the plan and the PRs' bodies and comments,
//                with the transcript folder each was found in, and the ones not found
//   budgetTable  `usage.mjs --budget-table` for those sessions (markdown and rows)
//   rework       commits on the PRs after the draft whose subject reads as a fix
//   usage        Skyler's totals and lines (models, Week) for those sessions
//   timeline     Skyler's wall-clock lines, one per session
//   missing      what it couldn't find, so the wrap fetches only that by hand
//
// usage.mjs is the release plugin's: beside this plugin in the repo
// (plugins/release), or the newest release version in the marketplace cache.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CORE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const UUID = /\b(?:local_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// A commit that fixes what the draft shipped: the rework a wrap counts.
const FIX = /\b(fix(es|ed)?|rework|review|address(es|ed)?|repair)\b/i

const cmpVersion = (a, b) => {
  const pa = a.split(/[.-]/).map(Number)
  const pb = b.split(/[.-]/).map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

/** The release plugin's usage.mjs, from the repo layout or the marketplace cache; null if neither. */
export function findUsage(coreRoot = CORE_ROOT) {
  const beside = join(dirname(coreRoot), 'release', 'scripts', 'usage.mjs')
  if (existsSync(beside)) return beside
  // cache: <marketplace>/<plugin>/<version>/, so the release plugin's versions sit two up
  const releaseDir = join(dirname(dirname(coreRoot)), 'release')
  let versions = []
  try {
    versions = readdirSync(releaseDir).sort(cmpVersion).reverse()
  } catch {
    return null
  }
  for (const v of versions) {
    const p = join(releaseDir, v, 'scripts', 'usage.mjs')
    if (existsSync(p)) return p
  }
  return null
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** The plans folder (kit.json `plans`, else ~/.claude/plans) and the release's plan and draft-done files in it. */
export function planFiles(project, version) {
  const plans = readJson(join(project, '.claude', 'kit.json'))?.plans
  const dir = typeof plans === 'string' && plans ? plans.replace(/^~(?=\/|$)/, homedir()) : join(homedir(), '.claude', 'plans')
  const v = version.replace(/^v/i, '')
  const names = [`V${v}`, v, `kit-${v}`]
  const find = (ext) => names.map((n) => join(dir, `${n}${ext}`)).find((p) => existsSync(p)) ?? null
  return { dir, plan: find('.md'), draftDone: find('.draft-done') }
}

// "1.7" in a title, but not "1.7.1" or "11.7".
export const titleHas = (title, version) => {
  const v = version.replace(/^v/i, '').replace(/\./g, '\\.')
  return new RegExp(`(^|[^0-9.])v?${v}(?![0-9]|\\.[0-9])`, 'i').test(title ?? '')
}

/** Session ids named in some texts, in order, once each. */
export const sessionIds = (...texts) => [...new Set(texts.join('\n').match(UUID) ?? [])]

/**
 * The transcript folder that holds a session: the project's own folder or one
 * of its worktrees' (Claude Code names them after the path, so they share its prefix).
 */
export function locate(ids, project, projectsDir = join(homedir(), '.claude', 'projects')) {
  const prefix = project.replace(/[^A-Za-z0-9]/g, '-')
  let dirs = []
  try {
    dirs = readdirSync(projectsDir).filter((d) => d === prefix || d.startsWith(`${prefix}-`)).map((d) => join(projectsDir, d))
  } catch {
    // no transcripts at all: every id is missing
  }
  const found = []
  const missing = []
  for (const id of ids) {
    const dir = dirs.find((d) => existsSync(join(d, `${id}.jsonl`)))
    if (dir) found.push({ id, dir })
    else missing.push(id)
  }
  return { found, missing }
}

/** Commits on the PRs after `since` whose subject reads as a fix. */
export function reworkCandidates(prs, since) {
  const out = []
  for (const pr of prs) {
    for (const c of pr.commits ?? []) {
      const at = Date.parse(c.committedDate ?? c.authoredDate ?? '')
      if (since != null && !(at > since)) continue
      if (!FIX.test(c.messageHeadline ?? '')) continue
      out.push({ pr: pr.number, sha: String(c.oid ?? '').slice(0, 7), subject: c.messageHeadline, date: new Date(at).toISOString() })
    }
  }
  return out
}

const defaultGh = (project) => (args) => execFileSync('gh', args, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const defaultNode = (args) => execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * @param {string} version
 * @param {{ project?: string, gh?: (args: string[]) => string, node?: (args: string[]) => string,
 *           usage?: string|null, projectsDir?: string, resolveLocal?: (id: string) => string }} [env]
 */
export async function wrapFacts(version, env = {}) {
  const project = resolve(env.project ?? process.cwd())
  const gh = env.gh ?? defaultGh(project)
  const node = env.node ?? defaultNode
  const missing = []

  // PRs, read-only
  let prs = []
  try {
    const list = JSON.parse(gh(['pr', 'list', '--state', 'all', '--search', `${version.replace(/^v/i, '')} in:title`, '--limit', '30', '--json', 'number,title,state,isDraft,mergeCommit,createdAt,url']))
    prs = list.filter((p) => titleHas(p.title, version))
  } catch (err) {
    missing.push(`PR list (gh pr list failed: ${String(err.message ?? err).split('\n')[0]})`)
  }
  for (const pr of prs) {
    try {
      Object.assign(pr, JSON.parse(gh(['pr', 'view', String(pr.number), '--json', 'body,commits,comments'])))
    } catch {
      missing.push(`PR #${pr.number}'s body and commits`)
    }
  }
  if (!prs.length && !missing.length) missing.push(`a PR whose title names ${version}`)

  // Sessions: the plan's build notes, the PRs' bodies and comments (the deploy's "Deploy usage" comment)
  const { plan, draftDone } = planFiles(project, version)
  if (!plan) missing.push(`the plan file for ${version}`)
  const texts = [plan ? readFileSync(plan, 'utf8') : '', ...prs.flatMap((p) => [p.body ?? '', ...(p.comments ?? []).map((c) => c.body ?? '')])]
  let ids = sessionIds(...texts)
  const usagePath = env.usage === undefined ? findUsage() : env.usage
  if (!usagePath) missing.push("the release plugin's usage.mjs")
  // local_<uuid> (get_session self) to the transcript id, through Skyler's own resolver
  const resolveLocal = env.resolveLocal ?? (usagePath ? (await import(pathToFileURL(usagePath).href)).resolveLocalId : null)
  ids = [...new Set(ids.map((id) => {
    if (!/^local_/.test(id) || !resolveLocal) return id
    try {
      return resolveLocal(id)
    } catch {
      return id
    }
  }))]
  const located = locate(ids, project, env.projectsDir)
  if (!ids.length) missing.push('session ids (none in the plan or the PRs)')
  if (located.missing.length) missing.push(`transcripts for ${located.missing.join(', ')}`)

  // Skyler, once per transcript folder
  const byDir = new Map()
  for (const { id, dir } of located.found) byDir.set(dir, [...(byDir.get(dir) ?? []), id])
  const budgetRows = []
  const usage = { grandTotal: 0, byModel: {}, weekPct: 0, lines: [] }
  const timeline = []
  if (usagePath) {
    for (const [dir, list] of byDir) {
      try {
        budgetRows.push(...JSON.parse(node([usagePath, '--budget-table', '--json', '--dir', dir, ...list])))
        const sum = JSON.parse(node([usagePath, '--json', '--dir', dir, ...list]))
        usage.grandTotal += sum.grandTotal ?? 0
        usage.weekPct += sum.weekPct ?? 0
        for (const [m, t] of Object.entries(sum.byModel ?? {})) usage.byModel[m] = (usage.byModel[m] ?? 0) + t
        const text = node([usagePath, '--timeline', '--dir', dir, ...list]).split('\n')
        usage.lines.push(...text.filter((l) => /^Week:|^Counted once:/.test(l) || /^[\w.-]+ \d+%(, |$)/.test(l)))
        timeline.push(...text.filter((l) => /^Wall-clock /.test(l)))
      } catch (err) {
        missing.push(`Skyler's numbers for ${list.join(', ')} (${String(err.message ?? err).split('\n')[0]})`)
      }
    }
  }
  const markdown = budgetRows.length && usagePath ? (await import(pathToFileURL(usagePath).href)).budgetTableMarkdown(budgetRows) : ''

  // Rework: fixes after the draft was done (its marker), else after the PR opened
  let since = null
  let from = null
  if (draftDone) [since, from] = [statSync(draftDone).mtimeMs, 'draft-done marker']
  else if (prs.length) [since, from] = [Math.min(...prs.map((p) => Date.parse(p.createdAt)).filter((t) => !Number.isNaN(t))), 'PR opened']
  if (!draftDone) missing.push('the draft-done marker (rework counted from the PR opening)')

  return {
    version,
    project,
    plan,
    prs: prs.map((p) => ({ number: p.number, title: p.title, state: p.state, isDraft: Boolean(p.isDraft), mergeSha: p.mergeCommit?.oid ?? null, url: p.url })),
    sessions: located,
    budgetTable: { markdown, rows: budgetRows },
    rework: { since: since != null && Number.isFinite(since) ? new Date(since).toISOString() : null, from, commits: reworkCandidates(prs, since) },
    usage,
    timeline,
    missing,
  }
}

function parseArgs(argv) {
  const o = { version: null, project: process.cwd(), usage: undefined }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') o.project = argv[++i]
    else if (argv[i] === '--usage') o.usage = argv[++i]
    else if (!o.version) o.version = argv[i]
    else throw new Error(`Unknown argument ${argv[i]}`)
  }
  if (!o.version) throw new Error('Usage: node <core plugin>/scripts/wrap-facts.mjs <version> [--project <dir>]')
  return o
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const o = parseArgs(process.argv.slice(2))
    console.log(JSON.stringify(await wrapFacts(o.version, { project: o.project, usage: o.usage }), null, 2))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
