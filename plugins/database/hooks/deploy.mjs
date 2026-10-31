#!/usr/bin/env node
// The one-word deploy (kit 1.6, docs/decisions/0001-one-word-deploy.md):
// `scripts/full-auto.sh deploy <go> [<fix-forward PR>]` runs this, in the
// session where Alexander typed `/one-ring <go>`. The guard lets that one
// call through on his typed go (one-ring-go.mjs) and sees nothing inside it,
// so this file is the deploy: it lives in the frozen set (the plugin's folder,
// or a project's .claude/hooks/) and does only what it says here.
//
// It takes the PR from open to live, in this order, and picks up where it
// stopped when run again:
//   1. the PR, by number or by version (its branch V<v>, or V<v> in its title)
//   2. out of draft, up to date with main, no conflicts, CI green on its head
//   3. no unticked "Human steps before the deploy can finish" tagged [secret],
//      [password] or [payment] (those wait); the rest go in a PR comment
//   4. a throwaway checkout of that head, with main's prod-db.sh and kit.json
//   5. migrations: the backup (Docker started, three tries, never skipped),
//      the dry run equal to the PR's new migration files, the push
//   6. the PR's `prod-db.sh setting` steps, then the functions it touches
//   7. the squash merge of exactly the head CI passed
//   8. the host's deploy of the merge commit, and the site answering
// Production changes happen only in 5 and 6, only after 2 and 3 pass, and the
// database changes only after a fresh, complete backup (prod-db.sh push
// refuses without one). Anything that stops exits with a code below and one
// `STOP` line saying what to fix; the session fixes it and runs this again.
// A finished run prints a `COST` line (minutes, the step it waited on, the
// baseline) just before its `DONE` line (kit 1.8, costLine).
//
// Pure helpers are exported for the tests; `deploy` takes its runner (`io`)
// so a test can play GitHub, git, Docker and the scripts.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appliedMigrations } from './chain-arm.mjs'
import * as kit from './production-steps.mjs'

export const EXIT = {
  DONE: 0, OTHER: 1, SETUP: 2,
  CI_RED: 10, CONFLICT: 11, BACKUP: 12, MIGRATIONS: 13, HOST: 14, SMOKE: 15, WAITS: 16, FUNCTIONS: 17, PUSH: 18,
}
// What the session does for each stop: the skill's "When something stops"
// says it in full; this is the one line the run ends with.
const NEXT = {
  [EXIT.SETUP]: 'fix the setup it names, then run the deploy again',
  [EXIT.CI_RED]: 'read the failing job, fix it on the PR branch, push, run the deploy again',
  [EXIT.CONFLICT]: 'merge main into the PR branch, resolve, check, push, run the deploy again',
  [EXIT.BACKUP]: 'find why the backup failed (Docker, disk, network), fix that, run the deploy again; never skip it',
  [EXIT.MIGRATIONS]: 'work out the difference, fix the PR (a new migration, never an edit to an applied one), push, run the deploy again',
  [EXIT.HOST]: "read the host's build log, fix forward in a new PR, deploy it with this go",
  [EXIT.SMOKE]: 'find why the site fails, fix forward in a new PR, deploy it with this go',
  [EXIT.WAITS]: 'ping Alexander on Telegram for what only he can give, carry on with the rest, run the deploy again once he has',
  [EXIT.FUNCTIONS]: 'read the deploy error, fix the function on the PR branch, push, run the deploy again',
  [EXIT.PUSH]: 'the migration failed on production and nothing of it applied: fix it on the PR branch, push, run the deploy again',
}

const CI_MINUTES = 40
const POLL_MS = 20_000
const DOCKER_SECONDS = 180
const BACKUP_TRIES = 3
const HOST_MINUTES = 12
// No deployment for the merge commit after this long: the host doesn't report
// to GitHub, so the smoke alone says the site is up.
const HOST_SILENT_MINUTES = 3
const SMOKE_SECONDS = 90
const PR_FIELDS = 'number,title,state,isDraft,headRefName,headRefOid,baseRefName,body,comments,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,mergedAt,createdAt,mergeCommit,url'
const FROM_MAIN = ['scripts/prod-db.sh', '.claude/kit.json']
const MIGRATION_RE = /^supabase\/migrations\/(\d{4,})_[^/]*\.sql$/

class Stop extends Error {
  constructor(code, why) { super(why); this.code = code }
}
const stop = (code, why) => { throw new Stop(code, why) }

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `{ pr }` for a PR number, `{ version }` for a version, or null. */
export function parseGo(arg) {
  const a = String(arg ?? '').trim().replace(/^[Vv#]/, '')
  if (/^\d+$/.test(a)) return { pr: Number(a) }
  if (/^\d+(?:\.\d+)+$/.test(a)) return { version: a }
  return null
}

/** Whether a PR is the release <version>: its branch V<version>, or the version as a word of its title. */
export function namesVersion(pr, version) {
  if (pr?.headRefName === `V${version}`) return true
  return new RegExp(`(?<![\\w.])[Vv]?${escapeRe(version)}(?![\\w]|\\.\\d)`).test(String(pr?.title ?? ''))
}

/** The version a PR ships, for the backup's folder name: its branch, its title, or its number. */
export function versionOf(pr) {
  const branch = /^V(\d+(?:\.\d+)*)$/.exec(pr?.headRefName ?? '')
  if (branch) return branch[1]
  const title = /(?<![\w.])V(\d+(?:\.\d+)+)(?![\w]|\.\d)/.exec(pr?.title ?? '')
  return title ? title[1] : String(pr?.number)
}

/**
 * The one PR a version names: an open one first; none open, a merged one
 * (the deploy merged it and stopped after). Two open is a setup stop.
 */
export function pickPr(list, version, { mergedOnly = false } = {}) {
  const hits = (Array.isArray(list) ? list : []).filter((p) => namesVersion(p, version))
  // A fix-forward follows the merged release, whatever else names it.
  const open = mergedOnly ? [] : hits.filter((p) => p.state === 'OPEN')
  if (open.length > 1) return { refuse: `more than one open PR names V${version}: ${open.map((p) => `#${p.number}`).join(', ')}; type /one-ring <PR number>` }
  if (open.length === 1) return { number: open[0].number }
  const merged = hits.filter((p) => p.state === 'MERGED').sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
  if (merged.length) return { number: merged[0].number }
  return { refuse: `no PR names V${version} (by its branch or its title); type /one-ring <PR number>` }
}

/**
 * Where CI stands: green, pending, or red with the first check that failed.
 * CI's own jobs (`ci.jobs`) must each have a success; a skipped run (a draft)
 * beside no success yet is pending, not red, since `gh pr ready` starts them.
 * @returns {{ state: 'green' | 'pending' | 'red', why: string }}
 */
export function ciState(rollup, jobs = kit.CI_JOBS, workflow = kit.CI_WORKFLOW) {
  const checks = Array.isArray(rollup) ? rollup : []
  const BAD = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
  const name = (c) => c?.name ?? c?.context ?? 'a check'
  const succeeded = (n) => checks.some((c) => name(c) === n && (c.conclusion === 'SUCCESS' || c.state === 'SUCCESS'))
  let pending = ''
  for (const c of checks) {
    const status = c?.__typename === 'StatusContext' || ('state' in (c ?? {}) && !('conclusion' in c)) ? c.state : c?.status === 'COMPLETED' ? c.conclusion : 'PENDING'
    if (BAD.has(status) && !succeeded(name(c))) return { state: 'red', why: `${name(c)}: ${status}${c?.detailsUrl || c?.targetUrl ? ` (${c.detailsUrl || c.targetUrl})` : ''}` }
    if (!pending && ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', null, undefined].includes(status)) pending = `${name(c)} is still running`
  }
  for (const job of jobs) {
    const runs = checks.filter((c) => c?.__typename === 'CheckRun' && c.name === job && c.workflowName === workflow)
    if (!runs.some((r) => r.conclusion === 'SUCCESS') && !pending) pending = `CI's "${job}" hasn't passed yet`
  }
  if (pending) return { state: 'pending', why: pending }
  const why = kit.checksNotGreen(checks)
  return why ? { state: 'red', why } : { state: 'green', why: '' }
}

/**
 * The PR's "Human steps before the deploy can finish" that aren't ticked.
 * "None" and ticked items don't count. Only some of them hold the deploy:
 * see holdsDeploy.
 */
export function openHumanSteps(body) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  const start = text.search(/^###\s+Human steps before\b.*$/im)
  if (start < 0) return []
  const rest = text.slice(start).split('\n').slice(1)
  const end = rest.findIndex((l) => /^#{2,3}\s/.test(l))
  return (end < 0 ? rest : rest.slice(0, end))
    .map((l) => l.trim())
    .filter((l) => /^(?:[-*+]|\d+[.)])\s+\[ \]/.test(l) && !/^(?:[-*+]|\d+[.)])\s+\[ \]\s+"?None"?\.?$/i.test(l))
}

// carousel tags a step only Alexander can give (kit 1.7, council H1).
const HOLD_TAG_RE = /\[(?:secret|password|payment)\]/i
// A PR written before the tags existed, or an untagged step: one that names a
// secret, a password or a payment still holds, so a PR never deploys past
// one. A secret is often named by its kind instead ("Set RESEND_API_KEY in
// Vercel", "Add the service role key"), so those words hold too; `[_\s-]?`
// lets an env name like API_KEY or SERVICE_ROLE count.
// Kit 1.8 (L3): a bare "token" no longer holds ("Check the token refresh
// page", "the token count" are no secret); a token still holds as an env
// name (GITHUB_TOKEN), with a kind that makes it a secret (API, access, auth,
// bearer, bot, deploy, personal access token), or after a verb that hands one
// over (set, add, paste, rotate, create, generate, copy). Still errs closed.
const HOLD_WORD_RE = /(?:\b|_)(?:secrets?|passwords?|payments?|api[_\s-]?keys?|credentials?|service[_\s-]?role|secret[_\s-]?keys?)(?:\b|_)|[A-Za-z0-9]_tokens?\b|\btokens?_[A-Za-z0-9]|\b(?:api|access|auth|bearer|bot|deploy|personal[\s-]access)[\s_-]?tokens?\b|\b(?:set|add|paste|rotate|create|generate|copy)\b[^.;]*\btokens?\b/i

/**
 * Whether an unticked human step holds the deploy: only a secret, a password
 * or a payment does (his words, 21 Oct 2026: "Only a password, secret or
 * payment waits for me"). "Check the start page" or "tell Becky" is listed in
 * the PR comment and the deploy carries on.
 */
export const holdsDeploy = (step) => HOLD_TAG_RE.test(step) || HOLD_WORD_RE.test(step)

// The deploy's comment on the PR for the steps left to after it; the marker
// keeps a re-run from writing the same comment twice.
export const LEFT_MARKER = '<!-- one-ring: human steps left -->'

/** The PR comment listing the human steps the deploy didn't wait for. */
export function leftStepsComment(steps) {
  return [
    LEFT_MARKER,
    "The deploy didn't wait for these human steps (none is a secret, a password or a payment); they are left for after it:",
    '',
    ...steps,
  ].join('\n')
}

/** Whether a comment already lists every one of these steps. */
export function alreadyListed(comments, steps) {
  return (Array.isArray(comments) ? comments : []).some((c) => {
    const body = String(c?.body ?? '')
    return body.includes(LEFT_MARKER) && steps.every((s) => body.includes(s))
  })
}

/**
 * The PR's migration files from `git diff --name-status origin/main...<head>`:
 * the new ones to push, in order, and any change to one that already exists
 * (a modified, deleted or renamed migration), which may be on production.
 */
export function migrationChanges(nameStatus) {
  const added = []
  const edited = []
  const inMigrations = (p) => /^supabase\/migrations\//.test(p ?? '')
  for (const line of String(nameStatus ?? '').split('\n')) {
    const [status, ...paths] = line.split('\t')
    if (!status || !paths.length || !paths.some(inMigrations)) continue
    // A rename or copy is "R100 old new": new only when nothing left migrations/.
    const [from, to = from] = paths
    const fresh = status === 'A' || (/^[RC]/.test(status) && !inMigrations(from))
    const m = MIGRATION_RE.exec(to)
    if (fresh && m) added.push(m[1])
    else edited.push(`${paths.filter(inMigrations).join(' → ')} (${status})`)
  }
  return { added: [...new Set(added)].sort(), edited }
}

/**
 * The functions to deploy when the project has no functions-touched script:
 * each function folder the diff changes, or all of them when a shared file
 * changed (a folder starting with _, or a file straight under functions/).
 */
export function touchedFunctions(changed, all) {
  const paths = String(changed ?? '').split('\n').filter((p) => p.startsWith('supabase/functions/'))
  if (paths.some((p) => { const rest = p.slice('supabase/functions/'.length); return !rest.includes('/') || rest.startsWith('_') })) return [...all].sort()
  return [...new Set(paths.map((p) => p.split('/')[2]))].filter((n) => all.includes(n)).sort()
}

/** The `prod-db.sh setting` steps in the PR's Before merge, as prod-db.sh's arguments. */
export function settingSteps(body, pr) {
  return kit.parseProductionSteps(body, pr)
    .filter((c) => c.startsWith('scripts/prod-db.sh setting '))
    .map((c) => c.split(' ').slice(1))
}

// ---------------------------------------------------------------- the cost

// Burrow's [deploy-cost] lesson: a no-migration deploy is about 4.5M tokens
// and 12 minutes. The kit 1.7.1 council (M2, Feature 6) found deploys at 14x
// that inside heavy sessions, unseen until a hand count.
export const DEPLOY_BASELINE = '4.5M tokens / 12 min'

/**
 * The COST line printed just before DONE (kit 1.8, Feature 6): this run's
 * minutes, the step it waited on (each progress line is said when its step
 * ends, so the longest gap ends at the line naming that step), and the
 * baseline beside it. Tokens are the session's, which this script can't see:
 * /car-wash or usage.mjs --timeline adds them. A re-run after a STOP counts
 * only its own run.
 * @param {number} start  ms
 * @param {number} end  ms
 * @param {[number, string][]} said  [time, line] in order
 */
export function costLine(start, end, said) {
  const min = (ms) => (ms / 60_000).toFixed(1)
  let longest = null
  let prev = start
  for (const [t, line] of said) {
    if (!longest || t - prev > longest.ms) longest = { ms: t - prev, line }
    prev = t
  }
  const wait = longest ? `; longest wait ${min(longest.ms)} min, until "${longest.line.slice(0, 60)}"` : ''
  return `COST: ${min(end - start)} min this run${wait}; baseline ${DEPLOY_BASELINE} (no migrations). Tokens: /car-wash or usage.mjs --timeline.`
}

// ---------------------------------------------------------------- the run

/**
 * Runs the deploy. Returns the exit code; prints as it goes.
 * @param {string[]} argv  [<go>, <fix-forward PR>?]
 * @param {object} io  run(cmd, args, { cwd, env, timeout }) → { status, stdout, stderr }, sleep(ms), now(), log(line),
 *   fetchOk(url, seconds) → '' or why, root, tmp
 */
export function deploy(argv, io) {
  const started = io.now()
  const said = []
  const say = (line) => { said.push([io.now(), line]); io.log(line) }
  try {
    const out = run(argv, io, say)
    say(costLine(started, io.now(), said))
    say(`DONE: ${out}`)
    return EXIT.DONE
  } catch (err) {
    if (!(err instanceof Stop)) { say(`STOP other: ${err?.stack ?? err}`); return EXIT.OTHER }
    say(`STOP ${Object.keys(EXIT).find((k) => EXIT[k] === err.code).toLowerCase()}: ${err.message}`)
    if (NEXT[err.code]) say(`NEXT: ${NEXT[err.code]}`)
    return err.code
  }
}

function run(argv, io, say) {
  const [goWord, ffWord, ...extra] = argv
  const go = parseGo(goWord)
  if (!go || extra.length || (ffWord !== undefined && !/^#?\d+$/.test(ffWord))) stop(EXIT.SETUP, 'usage: scripts/full-auto.sh deploy <version or PR number> [<fix-forward PR number>]')
  const sh = (cmd, args, opts = {}) => io.run(cmd, args, { cwd: io.root, ...opts })
  const ok = (cmd, args, opts, code = EXIT.OTHER, what = `${cmd} ${args.join(' ')}`) => {
    const r = sh(cmd, args, opts)
    if (r.status !== 0) stop(code, `${what} failed: ${lastLines(r)}`)
    return r.stdout
  }
  const gh = (...args) => ok('gh', args)
  const view = (n) => JSON.parse(gh('pr', 'view', String(n), '--json', PR_FIELDS))

  ok('git', ['fetch', '--quiet', 'origin'], {}, EXIT.SETUP)
  loadTrustedKit(io, sh)
  const kind = kit.NO_PRODUCTION ? 'none' : kit.SHIPS_ON_MERGE ? 'on-merge' : kit.PROD_REF.startsWith('<') ? null : 'database'
  if (!kind) stop(EXIT.SETUP, `.claude/kit.json on main names no production: set "production": "none" or "on-merge", or refs.prod for a database project`)

  // 1. The PR.
  let number = go.pr
  let version = go.version
  if (!number) {
    const list = JSON.parse(gh('pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,headRefName,state,mergedAt'))
    const pick = pickPr(list, version, { mergedOnly: ffWord !== undefined })
    if (pick.refuse) stop(EXIT.SETUP, pick.refuse)
    number = pick.number
  }
  if (ffWord !== undefined) {
    const first = view(number)
    if (first.state !== 'MERGED') stop(EXIT.SETUP, `a fix-forward follows a merged release, and PR #${number} is ${first.state}`)
    const ff = Number(ffWord.replace('#', ''))
    const pr = view(ff)
    if (!new RegExp(`fix-forward for #${number}\\b`, 'i').test(pr.body ?? '')) stop(EXIT.SETUP, `PR #${ff}'s description doesn't say "Fix-forward for #${number}"`)
    if (!(Date.parse(pr.createdAt) > Date.parse(first.mergedAt))) stop(EXIT.SETUP, `PR #${ff} was opened before #${number} merged, so it isn't its fix-forward`)
    version = version ?? versionOf(first)
    number = ff
    say(`Fix-forward #${number} for #${first.number} (V${version}).`)
  }
  let pr = view(number)
  version = version ?? versionOf(pr)
  say(`PR #${pr.number} "${pr.title}" (${pr.headRefName} at ${pr.headRefOid.slice(0, 7)}), V${version}, production: ${kind}.`)
  if (pr.state === 'CLOSED') stop(EXIT.SETUP, `PR #${pr.number} is closed`)

  let head = pr.headRefOid
  let backupDir = null
  const shipped = []
  if (pr.state === 'OPEN') {
    // 2. Ready, current, green.
    pr = readyAndGreen(pr, io, gh, view, say)
    head = pr.headRefOid
    // 3. What only Alexander gives: a secret, a password or a payment holds
    // the deploy; any other open step goes in a PR comment and never does.
    const open = openHumanSteps(pr.body)
    const holds = open.filter(holdsDeploy)
    const left = open.filter((s) => !holdsDeploy(s))
    if (left.length && !alreadyListed(pr.comments, left)) {
      const posted = sh('gh', ['pr', 'comment', String(pr.number), '--body', leftStepsComment(left)])
      say(posted.status === 0
        ? `Human steps left for after the deploy, listed on the PR: ${left.join(' | ')}`
        : `Human steps left for after the deploy (the PR comment failed: ${lastLines(posted)}): ${left.join(' | ')}`)
    }
    if (holds.length) stop(EXIT.WAITS, `the PR's "Human steps before the deploy can finish" hold a secret, a password or a payment that isn't done: ${holds.join(' | ')}`)

    if (kind === 'database') {
      // 4.-6. Production, from a throwaway checkout of exactly this head.
      const wt = checkout(io, sh, ok, head, pr.number)
      try {
        backupDir = database(io, wt, ok, pr, version, head, say, shipped)
        functions(io, wt, ok, head, say, shipped)
      } finally {
        sh('git', ['worktree', 'remove', '--force', wt])
      }
    }
    // 7. The merge, of exactly the head CI passed.
    pr = view(pr.number)
    if (pr.headRefOid !== head) stop(EXIT.CI_RED, `PR #${pr.number} moved to ${pr.headRefOid.slice(0, 7)} during the deploy, so CI hasn't passed what would merge; run the deploy again`)
    const ci = ciState(pr.statusCheckRollup)
    if (ci.state !== 'green') stop(EXIT.CI_RED, `CI isn't green at the merge: ${ci.why}`)
    if (pr.mergeable !== 'MERGEABLE') stop(EXIT.CONFLICT, `PR #${pr.number} is ${pr.mergeable}, not MERGEABLE`)
    const admin = pr.reviewDecision === 'REVIEW_REQUIRED' || pr.mergeStateStatus === 'BLOCKED' ? ['--admin'] : []
    const merged = sh('gh', ['pr', 'merge', String(pr.number), '--squash', '--match-head-commit', head, ...admin])
    if (merged.status !== 0) stop(EXIT.CONFLICT, `the merge was refused: ${lastLines(merged)}`)
    pr = view(pr.number)
    if (pr.state !== 'MERGED') stop(EXIT.CONFLICT, `PR #${pr.number} is ${pr.state} after the merge`)
    say(`Merged #${pr.number} as ${pr.mergeCommit?.oid?.slice(0, 7) ?? 'unknown'}${admin.length ? ' (--admin: the branch rule wanted a review)' : ''}.`)
  } else {
    say(`PR #${pr.number} is already merged (${pr.mergeCommit?.oid?.slice(0, 7) ?? 'unknown'}): only the host's deploy and the smoke are left.`)
  }

  // 8. Live.
  const sha = pr.mergeCommit?.oid
  const live = kind === 'none' ? 'no production, nothing deploys' : hostAndSmoke(io, gh, sha, say)
  return [
    `PR #${pr.number} merged (${sha?.slice(0, 7) ?? 'unknown'})`,
    backupDir ? `backup ${backupDir}` : null,
    ...shipped,
    live,
  ].filter(Boolean).join('; ')
}

// main's kit.json is the one that counts: a PR can't point the deploy at
// another project or another backup folder.
function loadTrustedKit(io, sh) {
  const shown = sh('git', ['show', 'origin/main:.claude/kit.json'])
  const file = join(io.tmp, 'kit.json')
  if (shown.status === 0) writeFileSync(file, shown.stdout)
  kit.loadKitConfig(shown.status === 0 ? file : join(io.root, '.claude', 'kit.json'))
}

function readyAndGreen(pr, io, gh, view, say) {
  if (pr.isDraft) {
    gh('pr', 'ready', String(pr.number))
    say(`Marked #${pr.number} ready (CI starts on it now).`)
    io.sleep(10_000)
    pr = view(pr.number)
  }
  const until = io.now() + CI_MINUTES * 60_000
  let updated = false
  for (;;) {
    // GitHub works mergeability out lazily: UNKNOWN is read again.
    if (pr.mergeable === 'CONFLICTING') stop(EXIT.CONFLICT, `PR #${pr.number} has conflicts with ${pr.baseRefName}`)
    const behind = Number(gh('api', `repos/{owner}/{repo}/compare/${pr.baseRefName}...${pr.headRefOid}`, '--jq', '.behind_by').trim())
    if (behind > 0) {
      if (updated) stop(EXIT.CONFLICT, `${pr.baseRefName} is still ${behind} commit(s) ahead after updating the branch`)
      const r = io.run('gh', ['pr', 'update-branch', String(pr.number)], { cwd: io.root })
      if (r.status !== 0) stop(EXIT.CONFLICT, `${pr.baseRefName} has ${behind} commit(s) the branch lacks, and GitHub couldn't merge them in: ${lastLines(r)}`)
      say(`Brought #${pr.number} up to date with ${pr.baseRefName} (${behind} commit(s)); CI runs again.`)
      updated = true
      io.sleep(10_000)
      pr = view(pr.number)
      continue
    }
    const ci = ciState(pr.statusCheckRollup)
    if (ci.state === 'red') stop(EXIT.CI_RED, `CI is red on ${pr.headRefOid.slice(0, 7)}: ${ci.why}`)
    if (ci.state === 'green' && pr.mergeable === 'MERGEABLE') {
      say(`CI green on ${pr.headRefOid.slice(0, 7)}.`)
      return pr
    }
    if (io.now() > until) stop(EXIT.CI_RED, `CI didn't finish in ${CI_MINUTES} minutes: ${ci.state === 'pending' ? ci.why : `mergeable ${pr.mergeable}`}`)
    io.sleep(POLL_MS)
    pr = view(pr.number)
  }
}

function checkout(io, sh, ok, head, number) {
  const wt = join(io.tmp, `deploy-pr${number}-${head.slice(0, 7)}`)
  if (existsSync(wt)) sh('git', ['worktree', 'remove', '--force', wt])
  ok('git', ['worktree', 'add', '--detach', wt, head], {}, EXIT.SETUP)
  // The PR's own copy of a frozen file runs only after it merges.
  for (const f of FROM_MAIN) {
    const onMain = sh('git', ['cat-file', '-e', `origin/main:${f}`], { cwd: wt }).status === 0
    const differs = sh('git', ['diff', '--quiet', 'origin/main', head, '--', f], { cwd: wt }).status !== 0
    if (onMain && differs) {
      ok('git', ['checkout', 'origin/main', '--', f], { cwd: wt })
      io.log(`The PR changes ${f}; the deploy runs main's copy (the PR's runs from the next deploy on).`)
    }
  }
  if (!existsSync(join(wt, 'scripts', 'prod-db.sh'))) stop(EXIT.SETUP, "the project has no scripts/prod-db.sh (the database plugin's README, \"Install the scripts\")")
  return wt
}

function database(io, wt, ok, pr, version, head, say, shipped) {
  const env = { ...io.env, CLAUDE_PROJECT_DIR: wt }
  const prodDb = (args, opts = {}) => io.run(join(wt, 'scripts', 'prod-db.sh'), args, { cwd: wt, env, timeout: 30 * 60_000, ...opts })
  const { added, edited } = migrationChanges(ok('git', ['diff', '--name-status', '-M', `origin/main...${head}`], { cwd: wt }))
  if (edited.length) stop(EXIT.MIGRATIONS, `the PR changes a migration that already exists (${edited.join(', ')}); production may have it, so a fix goes in a new migration`)
  const settings = settingSteps(pr.body, pr.number)
  let todo = []
  if (added.length) {
    const listed = prodDb(['migrations'])
    if (listed.status !== 0) waitsOrStop(listed, EXIT.MIGRATIONS, "production's migration list couldn't be read")
    const applied = appliedMigrations(listed.stdout)
    if (!applied) stop(EXIT.MIGRATIONS, "production's migration list couldn't be read")
    todo = added.filter((v) => !applied.has(v))
    if (todo.length < added.length) say(`Already on production: ${added.filter((v) => applied.has(v)).join(' ')}.`)
  }
  if (!todo.length && !settings.length) {
    say(added.length ? 'Every migration of the PR is on production already: no backup, no push.' : 'No migration and no setting: the database stays as it is.')
    return null
  }
  // The backup, before anything changes the database. Never skipped.
  const backupDir = backup(io, prodDb, version, say)
  if (todo.length) {
    const dry = prodDb(['dry-run'])
    if (dry.status !== 0) waitsOrStop(dry, EXIT.MIGRATIONS, 'the dry run failed')
    const pending = (/Parsed versions:([^\n]*)/.exec(dry.stdout)?.[1] ?? '').trim().split(/\s+/).filter(Boolean).sort()
    if (pending.join(' ') !== todo.join(' ')) stop(EXIT.MIGRATIONS, `the dry run lists ${pending.join(' ') || 'nothing'}, the PR adds ${todo.join(' ')}`)
    const push = prodDb(['push', version, ...todo])
    if (push.status === 3) stop(EXIT.MIGRATIONS, `prod-db.sh push: the dry run doesn't match: ${lastLines(push)}`)
    if (push.status !== 0) waitsOrStop(push, EXIT.PUSH, `the push of ${todo.join(' ')} failed`)
    say(`Pushed ${todo.join(' ')} to production.`)
    shipped.push(`migrations ${todo.join(' ')}`)
  }
  for (const args of settings) {
    const r = prodDb(args)
    if (r.status !== 0) waitsOrStop(r, EXIT.PUSH, `prod-db.sh ${args.join(' ')} failed`)
    say(`Set ${args[1]} on production.`)
    shipped.push(`setting ${args[1]}`)
  }
  return backupDir
}

function backup(io, prodDb, version, say) {
  let last = null
  for (let i = 1; i <= BACKUP_TRIES; i++) {
    dockerUp(io, say)
    const r = prodDb(['backup', version])
    const dir = /Backup complete: (.+)/.exec(r.stdout ?? '')?.[1]?.trim()
    if (r.status === 0 && dir) {
      say(`Backup complete: ${dir}`)
      return dir
    }
    if (/no Keychain item/i.test(`${r.stdout}\n${r.stderr}`)) waitsOrStop(r, EXIT.BACKUP, 'the backup')
    last = r
    say(`Backup try ${i} of ${BACKUP_TRIES} failed: ${lastLines(r)}`)
    if (i < BACKUP_TRIES) io.sleep(20_000)
  }
  stop(EXIT.BACKUP, `the backup failed ${BACKUP_TRIES} times: ${lastLines(last)}`)
}

// prod-db.sh's backup runs pg_dump in Docker: start Docker Desktop when it's down.
function dockerUp(io, say) {
  if (io.run('docker', ['info'], { timeout: 20_000 }).status === 0) return
  say('Docker is down; starting Docker Desktop.')
  io.run('open', ['-a', 'Docker'])
  const until = io.now() + DOCKER_SECONDS * 1000
  while (io.now() < until) {
    io.sleep(5000)
    if (io.run('docker', ['info'], { timeout: 20_000 }).status === 0) return
  }
  stop(EXIT.BACKUP, `Docker didn't start within ${DOCKER_SECONDS} seconds`)
}

// A missing Keychain item is the production password, which only Alexander
// stores; anything else is the stop it names.
function waitsOrStop(r, code, what) {
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  if (/no Keychain item|security add-generic-password|User interaction is not allowed/i.test(text)) {
    stop(EXIT.WAITS, `${what}: the production database's password isn't in the Keychain where prod-db.sh looks; only Alexander adds it (security add-generic-password, in his own terminal)`)
  }
  stop(code, `${what}: ${lastLines(r)}`)
}

function functions(io, wt, ok, head, say, shipped) {
  const dir = join(wt, 'supabase', 'functions')
  if (!existsSync(dir)) return
  let names
  if (existsSync(join(wt, 'scripts', 'functions-touched.mjs'))) {
    names = ok('node', ['scripts/functions-touched.mjs', 'origin/main'], { cwd: wt }).split('\n').map((s) => s.trim()).filter(Boolean)
  } else {
    const all = ok('git', ['ls-tree', '-d', '--name-only', `${head}:supabase/functions`], { cwd: wt }).split('\n').filter((n) => n && !n.startsWith('_') && !n.startsWith('.'))
    names = touchedFunctions(ok('git', ['diff', '--name-only', `origin/main...${head}`], { cwd: wt }), all)
  }
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) stop(EXIT.FUNCTIONS, `"${name}" isn't a function name`)
    let r
    for (let i = 0; i < 2; i++) {
      r = io.run('supabase', ['functions', 'deploy', name, '--project-ref', kit.PROD_REF], { cwd: wt, timeout: 10 * 60_000 })
      if (r.status === 0) break
    }
    if (r.status !== 0) stop(EXIT.FUNCTIONS, `supabase functions deploy ${name} failed twice: ${lastLines(r)}`)
    say(`Deployed function ${name}.`)
  }
  if (names.length) shipped.push(`functions ${names.join(' ')}`)
}

function hostAndSmoke(io, gh, sha, say) {
  const url = kit.PROD_URL.startsWith('<') ? null : kit.PROD_URL
  if (!url) return 'no urls.prod: no host wait and no smoke'
  if (/^[0-9a-f]{40}$/.test(sha ?? '')) {
    const start = io.now()
    for (;;) {
      const list = JSON.parse(gh('api', `repos/{owner}/{repo}/deployments?sha=${sha}`, '--jq', '[.[] | {id, environment}]') || '[]')
      const prod = list.find((d) => /prod/i.test(d.environment ?? '')) ?? list[0]
      if (prod) {
        const state = gh('api', `repos/{owner}/{repo}/deployments/${prod.id}/statuses`, '--jq', '.[0].state // ""').trim()
        if (state === 'success') { say(`The host deployed ${sha.slice(0, 7)} (${prod.environment}).`); break }
        if (['failure', 'error'].includes(state)) stop(EXIT.HOST, `the host's ${prod.environment} deploy of ${sha.slice(0, 7)} ended in ${state}`)
      } else if (io.now() - start > HOST_SILENT_MINUTES * 60_000) {
        say(`No host deployment reported for ${sha.slice(0, 7)} in ${HOST_SILENT_MINUTES} minutes; the smoke decides.`)
        break
      }
      if (io.now() - start > HOST_MINUTES * 60_000) stop(EXIT.HOST, `the host hadn't deployed ${sha.slice(0, 7)} after ${HOST_MINUTES} minutes`)
      io.sleep(POLL_MS)
    }
  }
  const why = io.fetchOk(url, SMOKE_SECONDS)
  if (why) stop(EXIT.SMOKE, `${url}: ${why}`)
  say(`Smoke: ${url} answers.`)
  return `live at ${url}`
}

function lastLines(r) {
  const text = `${r?.stderr ?? ''}\n${r?.stdout ?? ''}`.trim().split('\n').filter(Boolean)
  return text.slice(-4).join(' / ').slice(0, 600) || `exit ${r?.status}`
}

// ---------------------------------------------------------------- main

function realIo(root) {
  const tmp = mkdtempSync(join(tmpdir(), 'wolfpack-deploy-'))
  process.once('exit', () => rmSync(tmp, { recursive: true, force: true }))
  return {
    root,
    tmp,
    env: process.env,
    run: (cmd, args, { cwd = root, env = process.env, timeout = 10 * 60_000 } = {}) => {
      const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 << 20 })
      return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') }
    },
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    now: () => Date.now(),
    log: (line) => process.stdout.write(`${new Date().toISOString().slice(11, 19)}Z  ${line}\n`),
    fetchOk: (url, seconds) => {
      const r = spawnSync('curl', ['-fsS', '-o', '/dev/null', '--retry', String(Math.floor(seconds / 10)), '--retry-delay', '10', '--retry-all-errors', '--max-time', String(seconds), url], { encoding: 'utf8' })
      return r.status === 0 ? '' : (r.stderr || `curl exit ${r.status}`).trim()
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = kit.projectRoot()
  if (!existsSync(join(root, '.git'))) {
    process.stderr.write(`deploy: ${root} isn't a git checkout\n`)
    process.exit(EXIT.SETUP)
  }
  process.exit(deploy(process.argv.slice(2), realIo(root)))
}
