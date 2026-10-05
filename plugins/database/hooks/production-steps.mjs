#!/usr/bin/env node
// Reads a release PR's "Production steps" into the exact commands full auto
// (/cattle-drive) may run without a person's yes. Shared by
// scripts/full-auto.sh, which freezes the list in .claude/full-auto.json when
// a person arms a release, and by the guard, which parses the PR again before
// each allow so a command must be on both lists.
//
// Only Before merge and After merge count, and only the command shapes the
// guard would otherwise ask about, and only as a list item that is (or starts
// with, after a short label) one code span. Anything else (SQL, a human step,
// a placeholder left unfilled, a shell operator, a command named inside a
// sentence) is left out and keeps asking. `scripts/full-auto.sh preview`
// prints both lists without arming, and `check-plan` compares ranjit's plan
// with them (2.12.3).
//
// A release with no production command at all (frontend only) arms as
// merge-only, but only when its steps say so in words; see armList.

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The folder these hooks run from: the project's .claude/hooks, or a
// plugin's hooks/ in Claude Code's install folder (2.14.9.1).
export const HOOKS_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * The project the hooks guard: CLAUDE_PROJECT_DIR when it names a folder
 * (Claude Code sets it for every hook, and the production scripts export
 * their git top level before they run chain-arm.mjs), else the folder two up
 * from the hooks, as a project's own .claude/hooks always resolved it. Never
 * the shell's cwd, which an agent can change. Defined here, the module every
 * hook imports first, and re-exported by chain-arm.mjs.
 */
export function projectRoot(env = process.env, hooksDir = HOOKS_DIR) {
  const dir = env.CLAUDE_PROJECT_DIR
  if (typeof dir === 'string' && dir) {
    try { if (statSync(dir).isDirectory()) return resolve(dir) } catch { /* not a folder: the hook's own */ }
  }
  return join(hooksDir, '..', '..')
}

const real = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }
/**
 * Whether the hooks run from outside <root>/.claude/hooks (a plugin): then
 * they aren't in the project's git, so the frozen hash adds the plugin's
 * version, the guard freezes the plugin's own folder, and the deployer also
 * arrives as `<plugin>:<name>`.
 */
export function pluginMode(root = projectRoot(), hooksDir = HOOKS_DIR) {
  return real(hooksDir).toLowerCase() !== real(join(root, '.claude', 'hooks')).toLowerCase()
}

// The project's own values (none are written here: the kit is public, and
// the project's copy is the same code): read from <root>/.claude/kit.json,
// which the guard keeps in its frozen set, since an agent that could edit
// refs.dev could make production look like dev. A missing file or key fails closed: the value
// becomes a text that names the missing key and matches no ref, agent or
// Keychain item, so no project counts as dev, nobody is the deployer and
// every database call is treated as production. `let`, so the guard and the
// tests see the values loadKitConfig sets (ES live bindings).
const missing = (key) => `<${key} missing from .claude/kit.json>`
const REF_SHAPE = /^[a-z]{20}$/
export let DEV_REF = missing('refs.dev')
export let PROD_REF = missing('refs.prod')
export let DEPLOYER = missing('deployer')
export let PROD_URL = missing('urls.prod')
export let DEV_KEYCHAIN_ITEM = missing('keychain.dev')
export let PROD_KEYCHAIN_ITEM = missing('keychain.prod')
// CI's own jobs by name (see checksNotGreen) and the workflow file that
// defines them, which a test reads so the two can't drift. Missing or
// malformed jobs leave one placeholder job that never reports, so the arm
// and the merge refuse instead of passing on Vercel's checks alone.
export let CI_JOBS = [missing('ci.jobs')]
export let CI_WORKFLOW_FILE = missing('ci.workflow')

/** Loads the project's values; a test passes its fixture's path. */
export function loadKitConfig(file = join(projectRoot(), '.claude', 'kit.json')) {
  let kit = {}
  try { kit = JSON.parse(readFileSync(file, 'utf8')) ?? {} } catch { /* missing or unreadable: every key is missing */ }
  const str = (v) => (typeof v === 'string' && v ? v : null)
  const ref = (v) => (typeof v === 'string' && REF_SHAPE.test(v) ? v : null)
  const origin = (v) => {
    try { const u = new URL(str(v)); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin : null } catch { return null }
  }
  DEV_REF = ref(kit.refs?.dev) ?? missing('refs.dev')
  PROD_REF = ref(kit.refs?.prod) ?? missing('refs.prod')
  // The same ref for both would make production pass as dev.
  if (DEV_REF === PROD_REF) DEV_REF = missing('refs.dev')
  DEPLOYER = str(kit.deployer) ?? missing('deployer')
  // An origin or nothing: empty or not a web origin means no smoke allow.
  PROD_URL = origin(kit.urls?.prod) ?? missing('urls.prod')
  DEV_KEYCHAIN_ITEM = str(kit.keychain?.dev) ?? missing('keychain.dev')
  PROD_KEYCHAIN_ITEM = str(kit.keychain?.prod) ?? missing('keychain.prod')
  // Every name a non-empty string and none twice; anything else is malformed.
  const jobs = kit.ci?.jobs
  const jobsOk = Array.isArray(jobs) && jobs.length > 0 && jobs.every((j) => str(j)) && new Set(jobs).size === jobs.length
  CI_JOBS = jobsOk ? [...jobs] : [missing('ci.jobs')]
  CI_WORKFLOW_FILE = str(kit.ci?.workflow) ?? missing('ci.workflow')
}
loadKitConfig()

// One word each, no quotes, no shell operators: an exact match on the whole
// command then can't hide a second command.
const SAFE_RE = /^[A-Za-z0-9_./:=@,+%-]+(?: [A-Za-z0-9_./:=@,+%-]+)*$/
const VERSION_RE = /^\d+(?:\.\d+)*$/
const SECTION_RE = /^##\s+Production steps\s*$/m

// Text hidden in an HTML comment isn't a step anyone reviewed.
const stripComments = (body) => String(body ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, '')

// The first "## Production steps" section, up to the next "## " heading, or
// null when there is none.
function productionSection(body) {
  const start = body.search(SECTION_RE)
  if (start < 0) return null
  const after = body.slice(start).split('\n').slice(1).join('\n')
  const end = after.search(/^##\s/m)
  return end < 0 ? after : after.slice(0, end)
}

/**
 * @param {string} body  the PR description
 * @param {number} pr    the PR's number, for `gh pr merge` and `gh pr ready`
 * @returns {string[]}   the commands, in order, without duplicates
 */
export function parseProductionSteps(body, pr) {
  return explainSteps(body, pr).commands
}

/**
 * The steps, plus every code span in Before merge and After merge that isn't
 * one and why: what `scripts/full-auto.sh preview` prints.
 * @returns {{ commands: string[], left: { text: string, why: string }[] }}
 */
export function explainSteps(body, pr) {
  const commands = []
  const left = []
  const section = productionSection(stripComments(body))
  if (section === null) return { commands, left }

  let part = null
  let humanIndent = -1
  for (const line of section.split('\n')) {
    const heading = /^###\s+(.*)$/.exec(line)
    if (heading) {
      part = /^(before|after) merge\b/i.test(heading[1].trim())
      humanIndent = -1
      continue
    }
    if (!part || !line.trim()) continue
    const spans = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    const indent = line.length - line.trimStart().length
    // A human step, and everything nested under it, stays a person's.
    if (humanIndent >= 0 && indent > humanIndent) {
      for (const text of spans) left.push({ text, why: 'under a human step' })
      continue
    }
    humanIndent = -1
    if (/human step/i.test(line)) {
      humanIndent = indent
      for (const text of spans) left.push({ text, why: 'a human step' })
      continue
    }
    // "One exact command per step" (the PR template): a step is a list item
    // that is, or starts with, one code span, after at most a short label
    // ("Backup: `…`"). A span inside a sentence ("Don't run `…` yet") isn't.
    const step = STEP_RE.exec(line)
    const lead = step && !NEGATED_RE.test(step[1] ?? '') ? step.index + step[0].length : -1
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const { cmd, why } = classify(normalise(m[1]), pr)
      if (m.index + m[0].length !== lead) {
        // Only worth a line when it reads like a command someone meant as a step.
        if (cmd) left.push({ text: m[1], why: 'inside a sentence, not a step of its own' })
        continue
      }
      if (cmd && !commands.includes(cmd)) commands.push(cmd)
      else if (why) left.push({ text: m[1], why })
    }
  }
  return { commands, left }
}

// A list item (-, *, + or 1.), maybe a checkbox, then an optional short
// label ending in a colon, then the code span that is the step.
const STEP_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(?:([^`:]{1,60}):\s*)?`[^`]+`/
// A label that says not to run it ("Not yet: `…`").
const NEGATED_RE = /\b(?:don'?t|do not|never|not|skip|avoid|unless|until)\b/i

const normalise = (span) => span.replaceAll('<prod-ref>', PROD_REF).replaceAll('<prod>', PROD_REF).trim().replace(/\s+/g, ' ')

/** The merge itself, which a PR body needn't spell out. */
export function mergeCommands(pr) {
  return [`gh pr ready ${pr}`, `gh pr merge ${pr} --squash`, `gh pr merge ${pr} --squash --admin`]
}

/** What the guard may allow for this PR: its steps plus the merge. */
export function allowedCommands(body, pr) {
  const list = parseProductionSteps(body, pr)
  for (const cmd of mergeCommands(pr)) if (!list.includes(cmd)) list.push(cmd)
  return list
}

// ---------------------------------------------------------------- merge-only

// The three parts that must each read "None" (the template's word) for a
// merge-only arm. Human steps before the deploy can finish is one of them: a
// secret or a dashboard setting is a person's, and merge-only has no stop for it.
const NONE_PARTS = [
  ['Before merge', /^before merge\b/i],
  ['After merge', /^after merge\b/i],
  ['Human steps before the deploy can finish', /^human steps before\b/i],
]
// "None", "None.", "- None.", "1. None", "- [ ] None", quoted or not, and
// nothing else on the line: "None of the above: `…`" isn't None.
const NONE_RE = /^(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?"?None"?\.?$/
// A change here always needs a production step (a push, a deploy), whatever
// the body says. Case-blind, so a spelling GitHub keeps apart can't slip by.
const SERVER_PATH_RE = /^supabase\/(?:migrations|functions)\//i
const SUPABASE_RE = /^supabase\//i
const SYMLINK_MODE = '120000'

const quoteLine = (line) => (line.length > 80 ? `${line.slice(0, 77)}...` : line)

/**
 * Why the body doesn't say merge-only in words, or null when it does: one
 * "## Production steps" section whose Before merge, After merge and Human
 * steps before the deploy can finish each appear once and hold exactly one
 * line reading None. Anything else (no section, a part missing, doubled or
 * empty, a list item that is neither None nor a command) is a reason: a
 * parse failure must never arm as merge-only.
 * @returns {string | null}
 */
export function mergeOnlyWhyNot(body) {
  const text = stripComments(body)
  const section = productionSection(text)
  if (section === null) return 'the PR has no "## Production steps" section'
  if ((text.match(new RegExp(SECTION_RE.source, 'gm')) ?? []).length > 1) return 'the PR has more than one "## Production steps" section'
  const parts = new Map()
  let current = null
  for (const line of section.split('\n')) {
    const heading = /^###\s+(.*)$/.exec(line)
    if (heading) {
      current = NONE_PARTS.find(([, re]) => re.test(heading[1].trim()))?.[0] ?? null
      if (current && parts.has(current)) return `"${current}" appears twice`
      if (current) parts.set(current, [])
      continue
    }
    if (current && line.trim()) parts.get(current).push(line.trim())
  }
  for (const [name] of NONE_PARTS) {
    const lines = parts.get(name)
    if (!lines) return `it has no "### ${name}" part`
    if (lines.length === 0) return `"${name}" is empty; write None when nothing runs there`
    const other = lines.find((l) => !NONE_RE.test(l))
    if (other) return `"${name}" doesn't read None: "${quoteLine(other)}" is neither None nor a command full auto could run`
    if (lines.length > 1) return `"${name}" says None more than once`
  }
  return null
}

/**
 * What arm writes, or why it refuses. A release with commands arms exactly as
 * before: its steps plus the merge. One with none arms as merge-only (`gh pr
 * ready` if a draft, then `gh pr merge --squash --admin`, nothing else) only
 * when the body says None in words, the changed files were read, none of them
 * is a migration or a function (by gh's list and by git's, old paths too),
 * and nothing under supabase/ is a symlink.
 * @param {string} body
 * @param {number} pr
 * @param {{ files?: string[] | null, isDraft?: boolean | null, git?: { changed: string[], links: string[] } | null }} [facts]
 *   files and isDraft from `gh pr view`, git from gitFacts; null or missing
 *   means unread, which refuses merge-only. git is read only when it's needed
 *   (a getter in the CLI): a release with commands never looks at it, and a
 *   caller that gives no git key gets no git check (see below).
 * @returns {{ commands: string[], mergeOnly: boolean, refuse?: undefined } | { refuse: string }}
 */
export function armList(body, pr, facts = {}) {
  const { files = null, isDraft = null } = facts ?? {}
  if (parseProductionSteps(body, pr).length > 0) return { commands: allowedCommands(body, pr), mergeOnly: false }
  const none = `PR #${pr}'s Production steps list no command full auto could run`
  const why = mergeOnlyWhyNot(body)
  if (why) return { refuse: `${none}, and they don't say merge-only in words: ${why}.` }
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) {
    return { refuse: `${none}; they say None, but the PR's changed files couldn't be read, so a migration or a function can't be ruled out.` }
  }
  const server = files.filter((f) => SERVER_PATH_RE.test(f))
  if (server.length) {
    return { refuse: `${none}; they say None, but the diff changes ${server.join(', ')}: a migration or a function always has a production step.` }
  }
  if (typeof isDraft !== 'boolean') return { refuse: `${none}; they say None, but whether the PR is a draft couldn't be read.` }
  // gh lists a rename by its new path only, so a merged migration moved out
  // of supabase/migrations/ read as a frontend change; git's diff names both
  // paths. A symlink under supabase/ can point a function at a file outside
  // it, which then changes the function without the diff naming one (C1,
  // yoda's review 4; 2.12.4). The arm CLI always gives git (the gate that
  // writes the marker), and git unread refuses there; the one-tap verdict
  // and the guard's ask, inside the hook's time, give none, and the arm they
  // let through still runs this check.
  if (facts && 'git' in facts) {
    const { git } = facts
    if (!Array.isArray(git?.changed) || !Array.isArray(git?.links)) {
      return { refuse: `${none}; they say None, but git's diff against origin/main couldn't be read, so a migration renamed away or a linked function can't be ruled out.` }
    }
    const moved = git.changed.filter((f) => SERVER_PATH_RE.test(f))
    if (moved.length) {
      return { refuse: `${none}; they say None, but the diff changes ${moved.join(', ')} (git's list, a rename's old path too): a migration or a function always has a production step.` }
    }
    if (git.links.length) {
      return { refuse: `${none}; they say None, but ${git.links.join(', ')} under supabase/ is a symlink, which can change a function without the diff naming it.` }
    }
  }
  return { commands: [...(isDraft ? [`gh pr ready ${pr}`] : []), `gh pr merge ${pr} --squash --admin`], mergeOnly: true }
}

/**
 * What git says about the PR's head against origin/main: every path the diff
 * touches (both paths of a rename or a copy) and every symlink under
 * supabase/ (in the head's tree, or on either side of the diff). null when
 * git can't read it (an unknown sha, no origin/main), which refuses merge-only.
 * @param {string | null} sha  the PR's head
 * @param {string} [cwd]
 * @returns {{ changed: string[], links: string[] } | null}
 */
export function gitFacts(sha, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return null
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: 64 << 20 })
  try {
    return parseGitFacts(git('diff', '--raw', '-z', '-M', '--no-abbrev', `origin/main...${sha}`), git('ls-tree', '-r', '-z', '--full-tree', sha))
  } catch {
    return null
  }
}

/** `git diff --raw -z -M` and `git ls-tree -r -z` as gitFacts returns them, or null when either doesn't parse. */
export function parseGitFacts(raw, tree) {
  const changed = new Set()
  const links = new Set()
  const t = String(raw).split('\0')
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '') continue
    const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(t[i])
    if (!m) return null
    const n = m[3] === 'R' || m[3] === 'C' ? 2 : 1
    const paths = t.slice(i + 1, i + 1 + n)
    if (paths.length !== n || paths.includes('')) return null
    for (const p of paths) {
      changed.add(p)
      if ((m[1] === SYMLINK_MODE || m[2] === SYMLINK_MODE) && SUPABASE_RE.test(p)) links.add(p)
    }
    i += n
  }
  for (const entry of String(tree).split('\0')) {
    if (entry === '') continue
    const m = /^(\d{6}) \w+ [0-9a-f]+\t([\s\S]+)$/.exec(entry)
    if (!m) return null
    if (m[1] === SYMLINK_MODE && SUPABASE_RE.test(m[2])) links.add(m[2])
  }
  return { changed: [...changed], links: [...links] }
}

/**
 * The facts arm needs from `gh pr view --json body,isDraft,files,changedFiles`,
 * or null when that isn't readable JSON with a body. `files` is null unless
 * the list is complete (as long as `changedFiles` says), since GitHub can cut
 * a long list short and a hidden migration must not pass as none.
 */
export function prFacts(json) {
  let v
  try { v = JSON.parse(json) } catch { return null }
  if (!v || typeof v !== 'object' || typeof v.body !== 'string') return null
  const complete = Array.isArray(v.files) && Number.isInteger(v.changedFiles) && v.files.length === v.changedFiles &&
    v.files.every((f) => typeof f?.path === 'string')
  return { body: v.body, files: complete ? v.files.map((f) => f.path) : null, isDraft: typeof v.isDraft === 'boolean' ? v.isDraft : null }
}

// The time the paged files read may take; WORST_CASE_MS must stay under the
// 18 s watchdog with it (2.14.6, `[pr-size]`). One call, made only when gh's
// first list is short, so a PR under 100 files never spends it.
export const GH_FILES_MS = 3000

/**
 * The PR's full changed-file list, or null when it can't be had. `pr` is the
 * `gh pr view`/`gh pr list` JSON object (`number`, `files: [{ path }]`,
 * `changedFiles`); `fetchFiles(number)` returns every filename (the paged
 * `gh api …/pulls/<n>/files`) or throws. Pages only when the first list is
 * short, so a PR under 100 files costs nothing extra. A page that fails, or
 * a list that still doesn't add up to `changedFiles`, is null: unread, which
 * refuses merge-only and asks at the one-tap arm, as before 2.14.6.
 * (Signature set by maverick before the wave; the guard's readReleasePr
 * calls it too.)
 */
export function completeFiles(pr, fetchFiles) {
  if (!pr || !Array.isArray(pr.files) || !Number.isInteger(pr.changedFiles)) return null
  const first = pr.files.map((f) => f?.path)
  if (first.every((p) => typeof p === 'string') && first.length === pr.changedFiles) return first
  if (!Number.isInteger(pr.number) || typeof fetchFiles !== 'function') return null
  let all
  try { all = fetchFiles(pr.number) } catch { return null }
  // A file can't be listed twice; a repeat means a page was read twice.
  const ok = Array.isArray(all) && all.length === pr.changedFiles && all.every((p) => typeof p === 'string' && p !== '') && new Set(all).size === all.length
  return ok ? all : null
}

/**
 * Every filename of PR <number>, paged past gh's 100 (`[pr-size]`, 2.13.8's
 * 132 files), inside GH_FILES_MS; throws when gh fails or runs out of time.
 * `{owner}/{repo}` is gh's own placeholder for the checkout's repo.
 */
export function ghFetchFiles(number, cwd = process.cwd()) {
  const out = execFileSync('gh', ['api', `repos/{owner}/{repo}/pulls/${number}/files`, '--paginate', '--jq', '.[].filename'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GH_FILES_MS, maxBuffer: 16 << 20,
  })
  return out.split('\n').filter(Boolean)
}

/** The PR object with its files completed when they can be, else as it was. */
export function withCompleteFiles(pr, fetchFiles) {
  const all = completeFiles(pr, fetchFiles)
  return all && all.length !== pr.files.length ? { ...pr, files: all.map((path) => ({ path })) } : pr
}

// The canonical form of a command full auto may run, or why it isn't one.
function classify(cmd, pr) {
  const no = (why) => ({ cmd: null, why })
  if (!SAFE_RE.test(cmd)) return no('a placeholder, quote, wildcard or shell operator: not one exact command')
  const w = cmd.split(' ')
  if (w[0] === 'scripts/prod-db.sh') {
    if (w[1] === 'dry-run' && w.length === 2) return { cmd }
    if (w[1] === 'backup' && w.length === 3 && VERSION_RE.test(w[2])) return { cmd }
    if (w[1] === 'push' && w.length >= 4 && VERSION_RE.test(w[2]) && w.slice(3).every((v) => /^\d{4}$/.test(v))) return { cmd }
    // Exactly one key and one value: never a wildcard.
    if (w[1] === 'setting' && w.length === 4 && /^[a-z][a-z0-9_]{0,62}$/.test(w[2])) return { cmd }
    return no('not a prod-db.sh shape full auto runs (backup <version>, dry-run, push <version> <nnnn…>, setting <key> <value>)')
  }
  if (w[0] === 'supabase') {
    const ok = w.length === 6 && w[1] === 'functions' && w[2] === 'deploy' && /^[a-z0-9][a-z0-9_-]*$/.test(w[3]) &&
      w[4] === '--project-ref' && w[5] === PROD_REF
    return ok ? { cmd } : no('only `supabase functions deploy <name> --project-ref <prod-ref>` runs on full auto')
  }
  if (w[0] === 'gh' && w[1] === 'pr') {
    // Always numbered, so it can only ever act on the armed PR.
    const n = /^\d+$/.test(w[3] ?? '') ? Number(w[3]) : null
    if (n !== null && n !== pr) return no(`names PR #${n}, not #${pr}`)
    const flags = w.slice(n === null ? 3 : 4).join(' ')
    if (w[2] === 'ready' && flags === '') return { cmd: `gh pr ready ${pr}` }
    if (w[2] === 'merge' && (flags === '--squash' || flags === '--squash --admin')) return { cmd: `gh pr merge ${pr} ${flags}` }
    return no('only `gh pr ready` and `gh pr merge --squash [--admin]` run on full auto')
  }
  return no('not a production command full auto runs')
}

// ---------------------------------------------------------------- the one-tap arm

// CI's own jobs, by name (CI_JOBS, from kit.json's `ci.jobs`, loaded above).
// Vercel and the Supabase preview report on every PR too, so "every check
// green" alone is met by a `[skip ci]` head commit or a ci.yml the release
// broke (must 2, round 2). A test keeps `ci.jobs` in step with the workflow
// file `ci.workflow` names. Here, not in the guard, since the one-tap arm
// (chain-arm.mjs) reads it too.
export const CI_WORKFLOW = 'CI'

/**
 * '' when every check passed (skipped and neutral count) and each CI job
 * succeeded, else the first that didn't.
 * @param {unknown} rollup  `statusCheckRollup` from gh
 */
export function checksNotGreen(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'no checks have run'
  for (const c of rollup) {
    const name = c?.name ?? c?.context ?? 'a check'
    if (c?.__typename === 'StatusContext' || ('state' in (c ?? {}) && !('conclusion' in c))) {
      if (c.state !== 'SUCCESS') return `${name}: ${c.state ?? 'unknown'}`
      continue
    }
    if (c?.status !== 'COMPLETED') return `${name}: ${c?.status ?? 'unknown'}`
    if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(c.conclusion)) return `${name}: ${c.conclusion ?? 'unknown'}`
  }
  for (const job of CI_JOBS) {
    const run = rollup.find((c) => c?.__typename === 'CheckRun' && c.name === job && c.workflowName === CI_WORKFLOW)
    if (!run) return `CI's "${job}" hasn't reported`
    if (run.conclusion !== 'SUCCESS') return `CI's "${job}": ${run.conclusion || 'unknown'}`
  }
  return ''
}

const PUSH_RE = /^scripts\/prod-db\.sh push (\S+)((?: \d{4})+)$/
// What changes production's database, so the backup rule applies.
const DB_CHANGE_RE = /^scripts\/prod-db\.sh (?:push|setting|repair) /
const DRY_RUN = 'scripts/prod-db.sh dry-run'
const MIGRATION_FILE_RE = /^supabase\/migrations\/(\d{4})_[^/]*\.sql$/i

/** Whether a list of commands changes production's database. */
export const changesDatabase = (commands) => commands.some((c) => DB_CHANGE_RE.test(c))

/**
 * On a database release, `scripts/prod-db.sh backup <version>` is the first
 * production call (a dry run before it only reads). '' when it is, or when
 * the list doesn't change the database.
 * @param {string[]} commands  in the order they run
 */
export function backupFirstWhyNot(commands, version) {
  if (!changesDatabase(commands)) return ''
  const backup = `scripts/prod-db.sh backup ${version}`
  const first = commands.find((c) => c !== DRY_RUN)
  if (first === backup) return ''
  return commands.includes(backup)
    ? `\`${backup}\` isn't the first production call (\`${first}\` is)`
    : `the release changes the database but doesn't back it up first (\`${backup}\`)`
}

/**
 * The pushes are exactly the PR's migration files: each once, none missing,
 * none extra, and each push names this release, whose backup prod-db.sh push
 * checks. '' when they are.
 * @param {string[]} commands
 * @param {string[] | null} files  the PR's changed files; null is unread
 */
export function migrationsWhyNot(commands, files, version) {
  const pushes = commands.map((c) => PUSH_RE.exec(c)).filter(Boolean)
  const other = pushes.find((p) => p[1] !== version)
  if (other) return `\`${other[0]}\` pushes as V${other[1]}, not V${version}`
  // prod-db.sh push gates on the whole pending list, so a second push line
  // stops at exit 3 mid-deploy (2.14.5.1's review must, `[deploy-order]`).
  // Said here, before the files, so preview says it even with them unread.
  if (pushes.length > 1) return `a release's migrations go in one push (\`scripts/prod-db.sh push ${version} <nnnn…>\`), and the PR has ${pushes.length}`
  if (!Array.isArray(files)) return "the PR's changed files couldn't be read, so its migrations can't be compared"
  // A file under migrations/ that isn't NNNN_name.sql is named as itself, so
  // it never matches a push.
  const inPr = [...new Set(files.filter((f) => /^supabase\/migrations\//i.test(f)).map((f) => MIGRATION_FILE_RE.exec(f)?.[1] ?? f))]
  const pushed = pushes.flatMap((p) => p[2].trim().split(' '))
  const twice = pushed.find((n, i) => pushed.indexOf(n) !== i)
  if (twice) return `migration ${twice} is pushed twice`
  if (inPr.some((n) => !pushed.includes(n)) || pushed.some((n) => !inPr.includes(n))) {
    return `the pushes (${pushed.join(' ') || 'none'}) aren't the PR's migration files (${inPr.join(' ') || 'none'})`
  }
  return ''
}

// ---------------------------------------------------------------- the plan check

// A line of ranjit's plan that is a production call: the shapes full auto
// runs, plus two it never does, so a plan naming them fails.
const PLAN_CALL_RE = /^(?:scripts\/prod-db\.sh (?:backup|push|setting|repair|dry-run)|supabase (?:functions deploy|secrets set|db push)|gh pr (?:ready|merge))(?:\s|$)/
const LIST_MARK_RE = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
const LABEL_RE = /^[^`:]{1,60}:\s+/

/**
 * The production calls in a plan: one step per line, as a list item or not;
 * the step's first code span when it has one, else the line after an
 * optional short label ("Backup: …"). Reads and prose are left out.
 */
export function planCalls(text) {
  const calls = []
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(LIST_MARK_RE, '')
    if (!line || line.startsWith('#')) continue
    const span = /`([^`]+)`/.exec(line)
    const bare = PLAN_CALL_RE.test(line) ? line : line.replace(LABEL_RE, '')
    const cmd = normalise(span ? span[1] : bare)
    if (PLAN_CALL_RE.test(cmd)) calls.push(cmd)
  }
  return calls
}

/**
 * The plan-vs-PR check (2.12.3; it replaces yoda's chain verdict): ranjit's
 * planned production calls against the list arm derives from the PR. A
 * script, no agent and no SQL judge. Every PR step once, in the PR's order,
 * nothing extra, the production ref as written, the backup first on a
 * database release, the pushes = the PR's migration files, `gh pr ready`
 * right before the merge when it's a draft, and the merge last: in an armed
 * run nothing runs after it, After merge steps included.
 * @returns {{ calls: string[], problems: string[] }}
 */
export function planCheck(planText, body, version, pr, facts = {}) {
  const arm = armList(body, pr, facts)
  if (arm.refuse) return { calls: [], problems: [arm.refuse] }
  const calls = planCalls(planText)
  const problems = []
  const steps = arm.commands.filter((c) => !mergeCommands(pr).includes(c))
  for (const c of calls) if (!arm.commands.includes(c)) problems.push(`\`${c}\` isn't on the list arm derives from the PR`)
  const twice = calls.find((c, i) => calls.indexOf(c) !== i)
  if (twice) problems.push(`\`${twice}\` is in the plan twice`)
  for (const c of steps) if (!calls.includes(c)) problems.push(`the PR's step \`${c}\` isn't in the plan`)
  const planned = calls.filter((c) => steps.includes(c))
  const order = steps.filter((c) => calls.includes(c))
  if (!twice && planned.join('\n') !== order.join('\n')) problems.push(`the steps aren't in the PR's order (${order.join(', ')})`)
  const backup = backupFirstWhyNot(calls, version)
  if (backup) problems.push(backup)
  const mig = migrationsWhyNot(steps, facts.files ?? null, version)
  if (mig) problems.push(mig)
  const merge = calls.filter((c) => c.startsWith('gh pr merge '))
  if (merge.length === 0) problems.push(`the plan has no merge (\`gh pr merge ${pr} --squash [--admin]\`)`)
  else if (merge.length > 1) problems.push('the plan merges more than once')
  else if (calls.at(-1) !== merge[0]) problems.push(`the merge isn't the last production call (\`${calls.at(-1)}\` comes after it)`)
  const ready = `gh pr ready ${pr}`
  if (facts.isDraft === true && !calls.includes(ready)) problems.push(`the PR is a draft, and the plan doesn't mark it ready (\`${ready}\`)`)
  if (facts.isDraft === false && calls.includes(ready)) problems.push(`the PR isn't a draft, so \`${ready}\` is extra`)
  if (calls.includes(ready) && merge.length === 1 && calls.at(-2) !== ready) problems.push(`\`${ready}\` isn't the step right before the merge`)
  return { calls, problems }
}

/** What `scripts/full-auto.sh check-plan` prints. */
export function planCheckText({ calls, problems }, version, pr) {
  if (problems.length) return `Plan check for V${version} (PR #${pr}): the plan doesn't match the PR. A hard stop; fix the plan and check again.\n${problems.map((p) => `  - ${p}`).join('\n')}\n`
  const db = changesDatabase(calls) ? ', the backup first' : ''
  return `Plan check for V${version} (PR #${pr}): the plan matches the PR: ${calls.length} production call${calls.length === 1 ? '' : 's'}${db}, the merge last.\n${calls.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n`
}

// ---------------------------------------------------------------- main

// scripts/full-auto.sh pipes the PR in and writes what this prints: the
// marker's content. It never writes a file itself, so running it by hand
// arms nothing. With --pr-json (last), stdin is `gh pr view --json
// body,isDraft,files,changedFiles`; without it, stdin is the bare body, and
// merge-only refuses since the changed files are unknown.
function main() {
  const args = process.argv.slice(2)
  const json = args.at(-1) === '--pr-json'
  if (json) args.pop()
  if (args[0] === 'preview') return preview(Number(args[1]), args[2] ?? null, json)
  if (args[0] === 'check-plan') return checkPlan(args.slice(1), json)
  const [version, pr, sha, hours] = args
  const n = Number(pr)
  if (args.length !== 4 || !VERSION_RE.test(version ?? '') || !Number.isInteger(n) || !/^[0-9a-f]{40}$/.test(sha ?? '') || !(Number(hours) > 0)) {
    process.stderr.write('usage: node .claude/hooks/production-steps.mjs <version> <pr> <head sha> <hours> [--pr-json] < body\n')
    process.exit(2)
  }
  readPr(n, json, (facts) => {
    const arm = armList(facts.body, n, facts)
    if (arm.refuse) {
      process.stderr.write(`${arm.refuse}\n`)
      process.exit(1)
    }
    const now = Date.now()
    process.stdout.write(JSON.stringify({
      version,
      pr: n,
      headSha: sha,
      armedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Number(hours) * 3600_000).toISOString(),
      ...(arm.mergeOnly ? { mergeOnly: true } : {}),
      commands: arm.commands,
    }, null, 2) + '\n')
  }, sha)
}

// stdin as the facts armList takes; an unreadable --pr-json input refuses.
// git's facts are read on first use, at the head arm is given, or else at the
// PR's head as gh reports it (preview and check-plan aren't given one).
function readPr(n, json, then, sha = null) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => { input += c })
  process.stdin.on('end', () => {
    const facts = json ? prFacts(input) : { body: input, files: null, isDraft: null }
    if (!facts) {
      process.stderr.write(`PR #${n} couldn't be read.\n`)
      process.exit(1)
    }
    // Over 100 files gh's list is short: page the rest (needs `number` in
    // the read, which full-auto.sh asks for). Unread stays null.
    if (json && facts.files === null) facts.files = completeFiles(JSON.parse(input), ghFetchFiles)
    let git
    Object.defineProperty(facts, 'git', { enumerable: true, get: () => (git === undefined ? (git = gitFacts(sha ?? headOf(n))) : git) })
    then(facts)
  })
}

function headOf(n) {
  try {
    return execFileSync('gh', ['pr', 'view', String(n), '--json', 'headRefOid', '--jq', '.headRefOid'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim()
  } catch {
    return null
  }
}

// `scripts/full-auto.sh preview`: the arm list, numbered, and what is left
// out and why; with a version, ranjit's plan too. Prints only; the exit code
// says whether arm would take it.
function preview(n, version, json) {
  if (!Number.isInteger(n) || (version !== null && !VERSION_RE.test(version))) {
    process.stderr.write('usage: node .claude/hooks/production-steps.mjs preview <pr> [<version>] [--pr-json] < body\n')
    process.exit(2)
  }
  readPr(n, json, (facts) => {
    process.stdout.write(previewText(facts.body, n, facts, version))
    if (armList(facts.body, n, facts).refuse) process.exit(1)
  })
}

// `scripts/full-auto.sh check-plan`: ranjit's plan (a file) against the PR
// on stdin. Prints only; exit 1 on any mismatch.
function checkPlan([version, pr, file], json) {
  const n = Number(pr)
  if (!VERSION_RE.test(version ?? '') || !Number.isInteger(n) || !file) {
    process.stderr.write('usage: node .claude/hooks/production-steps.mjs check-plan <version> <pr> <plan file> [--pr-json] < body\n')
    process.exit(2)
  }
  let plan
  try { plan = readFileSync(file, 'utf8') } catch (err) {
    process.stderr.write(`The plan file couldn't be read (${err?.code ?? err}).\n`)
    process.exit(1)
  }
  readPr(n, json, (facts) => {
    const out = planCheck(plan, facts.body, version, n, facts)
    process.stdout.write(planCheckText(out, version, n))
    if (out.problems.length) process.exit(1)
  })
}

export const PLAN_TITLE = 'Plan, as ranjit writes it'

/**
 * ranjit's plan for this PR in check-plan's shape, one "N. `cmd`" line per
 * production call: the PR's steps in its order, `gh pr ready` when it's a
 * draft, one merge last (`--squash --admin`, merge-only's own). null when
 * arm would refuse. ranjit asked twice (2.14.4, 2.14.4.1): planning a clean
 * release is then a copy, not an agent turn.
 */
export function planLines(body, pr, facts = {}) {
  const arm = armList(body, pr, facts)
  if (arm.refuse) return null
  const ready = `gh pr ready ${pr}`
  const steps = arm.commands.filter((c) => !mergeCommands(pr).includes(c))
  const calls = [...steps, ...(facts?.isDraft === true ? [ready] : []), `gh pr merge ${pr} --squash --admin`]
  return calls.map((c, i) => `${i + 1}. \`${c}\``)
}

/** What preview prints for a PR body (and, for merge-only, its files and draft state). */
export function previewText(body, pr, facts = {}, version = null) {
  const { commands, left } = explainSteps(body, pr)
  const arm = armList(body, pr, facts)
  const out = []
  if (arm.refuse) {
    out.push(`arm would refuse: ${arm.refuse}`)
  } else if (arm.mergeOnly) {
    out.push('arm would arm a merge-only release (Before merge, After merge and Human steps before the deploy can finish all say None; no migration or function in the diff) and let ranjit run, without asking, for 4 hours:')
    arm.commands.forEach((c, i) => out.push(`  ${i + 1}. ${c}`))
  } else {
    out.push(`arm would let ranjit run, without asking, for 4 hours:`)
    arm.commands.forEach((c, i) => out.push(`  ${i + 1}. ${c}${i >= commands.length ? '   (the merge, always on the list)' : ''}`))
  }
  if (left.length) {
    out.push('Left off the list (these keep asking a person):')
    for (const { text, why } of left) out.push(`  - \`${text}\`: ${why}`)
  }
  // The plan needs the version (the backup and push name it), so only the
  // script's preview, which knows it, prints one. It is checked here the way
  // check-plan will check it: a list the PR itself gets wrong (two pushes, a
  // late backup) prints the reasons instead of a plan that would fail.
  const lines = version ? planLines(body, pr, facts) : null
  if (lines) {
    const { problems } = planCheck(lines.join('\n'), body, version, pr, facts)
    if (problems.length) {
      out.push(`${PLAN_TITLE}: none; check-plan would stop on the PR's own list:`)
      for (const p of problems) out.push(`  - ${p}`)
    } else {
      out.push(`${PLAN_TITLE} (check-plan passes it; copy it as it is):`, ...lines)
    }
  }
  return out.join('\n') + '\n'
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
