#!/usr/bin/env node
// The chain arm (/cattle-drive, 2.12.2; one tap since 2.12.3): one tap from
// a person arms an order of releases, and each release's deploy then arms
// itself when the one-tap conditions hold (oneTapVerdict). Shared by
// scripts/full-auto.sh, which writes .claude/full-auto-chain.json from what
// this prints and previews the verdict, and by the guard, which builds its
// protected paths from FROZEN and asks oneTapVerdict at each arm.
//
// FROZEN is the one set of files that decide what full auto may do: the
// guard and its wiring, the production scripts, CI, and the texts yoda and
// ranjit follow. It has three uses and must stay one list (yoda's must 1):
// the guard asks a person before any change to it (and refuses one while a
// marker exists), the tap records its hash so a chain stops when it changes,
// and a release that changes it never arms on the tap: it taps at its arm.
//
// Everything exported is pure: facts in, a string or an object out, where
// '' means fine. `main` gathers the facts (git, gh, prod-db.sh, the CLI) and
// prints; it never writes a file, so running it by hand arms nothing.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HOOKS_DIR, PROD_REF, pluginMode, projectRoot, armList, backupFirstWhyNot, checksNotGreen, ghFetchFiles, migrationsWhyNot, prFacts, withCompleteFiles } from './production-steps.mjs'

// A folder ends in '/'. Repo-relative, as git ls-files prints them.
export const FROZEN = [
  '.claude/hooks/',
  '.claude/settings.json',
  '.claude/settings.local.json',
  // The project's values (dev ref, deployer, Keychain items): the guard
  // trusts them, so an agent that could edit refs.dev could make production
  // look like dev (the kit, 2.14.7).
  '.claude/kit.json',
  'scripts/full-auto.sh',
  'scripts/prod-db.sh',
  'scripts/check.sh',
  // Runs unprompted (settings.json's allow list), so an edit to it must move
  // the hash like the guard's own files.
  'scripts/chain-cover.mjs',
  '.github/',
  '.claude/agents/yoda.md',
  '.claude/agents/ranjit.md',
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const FROZEN_ALT = FROZEN.map((p) => (p.endsWith('/') ? `${escapeRe(p.slice(0, -1))}(?:\\/|$)` : `${escapeRe(p)}$`)).join('|')
// Any checkout, any depth: a worktree's copy counts as the guard's own too.
// The disk ignores case, so the match does as well.
export const FROZEN_RE = new RegExp(`(?:^|\\/)(?:${FROZEN_ALT})`, 'i')
// The hash reads repo-relative paths only.
const FROZEN_PATH_RE = new RegExp(`^(?:${FROZEN_ALT})`, 'i')
// Ignored, so git never lists it; hashed when it exists.
const LOCAL_SETTINGS = '.claude/settings.local.json'

// The tap names an order, and 48 hours covers a four-release evening and the
// morning after; the guard refuses a marker claiming more than 72.
const MAX_VERSIONS = 4
const CHAIN_HOURS = 48
const MAX_CHAIN_MS = 72 * 3600_000
const VERSION_RE = /^\d+(?:\.\d+)*$/
export const CHAIN_USAGE = 'Usage: scripts/full-auto.sh arm-chain <version> [<version> …] (at most 4, each like 2.13.1)'

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/**
 * The frozen set's hash: sha256 over the sorted `path\0sha256(content)`
 * lines of the files given that are in the set. A file outside the set
 * never changes it; a missing one (content null) counts as missing.
 * `plugin` (pluginLine) adds one line when the hooks run as a plugin, whose
 * files aren't in the project's git; without it the hash is as before.
 * @param {{ path: string, content: string | Buffer | null }[]} files
 * @param {string | null} [plugin]
 */
export function frozenHash(files, plugin = null) {
  const lines = files
    .filter((f) => FROZEN_PATH_RE.test(f.path))
    .map((f) => `${f.path}\0${f.content == null ? 'missing' : sha256(f.content)}`)
  if (plugin !== null) lines.push(`plugin\0${plugin}`)
  lines.sort()
  return sha256(lines.join('\n'))
}

/**
 * The plugin's line for the hash: `<name>@<version>` (database@1.1.0) from
 * the plugin's .claude-plugin/plugin.json beside hooks/, or `missing`; null
 * when the hooks are the project's own .claude/hooks, which git hashes.
 */
export function pluginLine(root = projectRoot(), hooksDir = HOOKS_DIR) {
  if (!pluginMode(root, hooksDir)) return null
  try {
    const { name, version } = JSON.parse(readFileSync(join(hooksDir, '..', '.claude-plugin', 'plugin.json'), 'utf8'))
    return typeof name === 'string' && name && typeof version === 'string' && version ? `${name}@${version}` : 'missing'
  } catch {
    return 'missing'
  }
}

/**
 * The words after `arm-chain`: the versions in order. `{ refuse }` for
 * anything else. (2.12.2's shadow-first and its `all-derived` word are gone:
 * a single release is a chain of one, and every link arms the same way.)
 * @param {string[]} words
 */
export function chainArgs(words) {
  const versions = words.map((v) => String(v).replace(/^V/, ''))
  if (versions.length < 1 || versions.length > MAX_VERSIONS || !versions.every((v) => VERSION_RE.test(v))) return { refuse: CHAIN_USAGE }
  const twice = versions.find((v, i) => versions.indexOf(v) !== i)
  if (twice) return { refuse: `V${twice} is in the chain twice. ${CHAIN_USAGE}` }
  return { versions }
}

/**
 * What arm-chain writes, or why it refuses.
 * @param {string[]} versions  in the order they ship
 * @param {number} now
 * @param {string} mainSha  origin/main when tapped
 * @param {string} hash     frozenHash of the working tree when tapped
 */
export function newChain(versions, now, mainSha, hash) {
  const args = chainArgs(versions)
  if (args.refuse) return { refuse: args.refuse }
  if (!/^[0-9a-f]{40}$/.test(String(mainSha))) return { refuse: "origin/main's SHA couldn't be read." }
  if (!/^[0-9a-f]{64}$/.test(String(hash))) return { refuse: "the guard's files couldn't be hashed." }
  const armedAt = new Date(now).toISOString()
  return {
    chain: {
      chain: `chain-${armedAt}`,
      versions: args.versions,
      done: [],
      armedAt,
      expiresAt: new Date(now + CHAIN_HOURS * 3600_000).toISOString(),
      mainSha,
      frozenHash: hash,
    },
  }
}

/**
 * Why the chain marker covers nothing now, or ''. `hash` is the frozen set's
 * hash as it is on disk now.
 */
export function chainWhyNot(chain, now, hash) {
  if (!chain || typeof chain !== 'object' || !Array.isArray(chain.versions) || chain.versions.length === 0 ||
    !Array.isArray(chain.done) || typeof chain.frozenHash !== 'string') return 'the chain marker is unreadable'
  const armed = Date.parse(chain.armedAt)
  const expires = Date.parse(chain.expiresAt)
  if (!Number.isFinite(armed) || !Number.isFinite(expires)) return 'the chain marker is unreadable'
  if (!(expires > now)) return 'the chain arm has expired'
  // Whatever it says: an expiry far off, or a tap long ago.
  if (expires - now > MAX_CHAIN_MS || expires - armed > MAX_CHAIN_MS || now - armed > MAX_CHAIN_MS) return 'the chain marker claims more than 72 hours'
  // One hash can't say which file moved; the two prefixes say that one did.
  if (hash !== chain.frozenHash) return `the guard's files differ from what was tapped (frozen set ${String(hash).slice(0, 12)}, tapped ${chain.frozenHash.slice(0, 12)})`
  return ''
}

/** The chain's next release: the first not done, or null at the end. */
export function nextVersion(chain) {
  if (!chain || !Array.isArray(chain.versions) || !Array.isArray(chain.done)) return null
  return chain.versions.find((v) => !chain.done.includes(v)) ?? null
}

// How long a finished chain stays for its last wrap-up.
const WRAP_MS = 90 * 60_000

/**
 * The chain after its last release is done (gate audit 3, 2.12.4): kept, not
 * deleted, so the guard still allows the last wrap-up's files, and marked
 * `finished` so nothing reads it as a chain still running. It expires 90
 * minutes on (or sooner, at its own expiry); disarm removes it at once.
 */
export function finishChain(chain, now) {
  const expires = Date.parse(chain.expiresAt)
  const until = Number.isFinite(expires) ? Math.min(expires, now + WRAP_MS) : now + WRAP_MS
  return { ...chain, finished: new Date(now).toISOString(), expiresAt: new Date(until).toISOString() }
}

/**
 * The chain with <version> done: its PR kept in `prs` (2.12.4 review, M5), so
 * the guard still allows ranjit's report comment on it after done deletes the
 * release marker; finished when it was the last. `next` is the release after
 * it, or null.
 */
export function markDone(chain, version, pr, now) {
  const updated = { ...chain, done: [...chain.done, version], prs: { ...(chain.prs ?? {}), [version]: pr } }
  const next = nextVersion(updated)
  return { next, chain: next ? updated : finishChain(updated, now) }
}

// ---------------------------------------------------------------- the one-tap arm

// What the guard and preview read of the open release PR (`gh pr list --json`).
export const RELEASE_PR_FIELDS = 'number,headRefName,headRefOid,body,isDraft,files,changedFiles,statusCheckRollup'

/**
 * Whether ranjit's `arm <version>` may pass without asking, condition by
 * condition (the decided design, 2.12.3). Each row's `why` is '' when it
 * holds. A broken `ask` row means no tap covers this release, so its arm asks
 * a person (the designed fallback: a release that changes the frozen set
 * always taps at its arm). A broken `deny` row is a hard stop.
 *
 * The calls ranjit then makes are exactly the list derived from the PR: the
 * guard refuses anything off it at each call, and refuses any change before
 * the backup has run on a database release (whyNot in the guard).
 * @param {{ version: string, chain: object | null, now: number, hash: string | null,
 *   pr: { number: number, body: string, files?: unknown, changedFiles?: number, isDraft?: boolean, statusCheckRollup?: unknown } | null }} facts
 *   pr is the open PR for V<version> from `gh pr list --json`; hash is the
 *   frozen set's hash on disk now.
 * @returns {{ name: string, why: string, stop: 'ask' | 'deny' }[]}
 */
export function oneTapVerdict({ version, chain, now, hash, pr }) {
  const facts = pr ? prFacts(JSON.stringify(pr)) : null
  const arm = facts ? armList(facts.body, pr.number, facts) : null
  const list = arm && !arm.refuse ? arm.commands : null
  const noPr = `no open PR for V${version} could be read`
  return [
    { name: 'in the arm given at the start', stop: 'ask', why: armedWhy(version, chain, now) },
    { name: 'frozen set unchanged', stop: 'ask', why: frozenWhy(facts, chain, hash) },
    { name: 'CI green by job name', stop: 'deny', why: pr ? checksNotGreen(pr.statusCheckRollup) : noPr },
    { name: "the list derived from the PR", stop: 'deny', why: !pr ? noPr : !facts ? `PR #${pr.number} couldn't be read` : arm.refuse ?? '' },
    { name: 'backup first', stop: 'deny', why: list ? backupFirstWhyNot(list, version) : 'no list to check' },
    { name: "migrations are the PR's files", stop: 'deny', why: list ? migrationsWhyNot(list, facts.files, version) : 'no list to check' },
  ]
}

function armedWhy(version, chain, now) {
  if (chain === null || chain === undefined) return 'no chain is armed (the start\'s tap is `scripts/full-auto.sh arm-chain <version…>`)'
  // Its own hash, so only the expiry and shape are checked here; the frozen
  // row compares the disk.
  const why = chainWhyNot(chain, now, chain?.frozenHash)
  if (why) return why
  if (!chain.versions.includes(version)) return `V${version} isn't in the arm given at the start (${chain.versions.map((v) => `V${v}`).join(', ')})`
  if (chain.done.includes(version)) return `V${version} is already done in this chain`
  const next = nextVersion(chain)
  return next === version ? '' : `V${next} deploys before V${version}`
}

function frozenWhy(facts, chain, hash) {
  if (!facts) return "the PR couldn't be read"
  if (!Array.isArray(facts.files)) return "the PR's changed files couldn't be read"
  const touched = facts.files.filter((f) => FROZEN_PATH_RE.test(f))
  if (touched.length) return `the release changes the guard's frozen files (${touched[0]}${touched.length > 1 ? ` and ${touched.length - 1} more` : ''}), so it taps at its arm`
  if (chain && typeof chain.frozenHash === 'string' && hash !== chain.frozenHash) {
    return `the guard's files on disk differ from what was tapped (frozen set ${String(hash).slice(0, 12)}, tapped ${chain.frozenHash.slice(0, 12)})`
  }
  return ''
}

/** 'allow', 'ask' or 'deny' for a verdict: any hard stop first. */
export function oneTapDecision(rows) {
  if (rows.some((r) => r.why && r.stop === 'deny')) return 'deny'
  return rows.some((r) => r.why) ? 'ask' : 'allow'
}

/** What `scripts/full-auto.sh preview` prints after the list. */
export function oneTapText(rows, version) {
  const decision = oneTapDecision(rows)
  const head = {
    allow: `One-tap arm for V${version}: all six hold, so ranjit's arm passes without asking.`,
    ask: `One-tap arm for V${version}: refused, so ranjit's arm asks a person (a tap at the arm).`,
    deny: `One-tap arm for V${version}: refused, a hard stop; ranjit's arm is denied until it's fixed.`,
  }[decision]
  return [head, ...rows.map((r) => `  ${r.why ? 'no' : 'ok'}  ${r.name}${r.why ? `: ${r.why}` : ''}`)].join('\n') + '\n'
}

// What the release marker says production should now hold.
const PUSH_RE = /^scripts\/prod-db\.sh push \S+((?: \d{4})+)$/
const DEPLOY_RE = /^supabase functions deploy (\S+) --project-ref \S+$/
const pushedMigrations = (marker) => marker.commands.flatMap((c) => PUSH_RE.exec(c)?.[1].trim().split(' ') ?? [])
const deployedFunctions = (marker) => marker.commands.flatMap((c) => DEPLOY_RE.exec(c)?.[1] ?? [])

// The migrations production has applied, from `prod-db.sh migrations`: the
// CLI prints JSON when it isn't on a terminal, a table when it is. null when
// neither could be read.
function appliedMigrations(text) {
  const applied = new Set()
  let read = false
  for (const line of String(text ?? '').split('\n')) {
    const t = line.trim()
    if (t.startsWith('{')) {
      let json
      try { json = JSON.parse(t) } catch { continue }
      if (!Array.isArray(json?.migrations)) continue
      read = true
      for (const m of json.migrations) if (/^\d{4}$/.test(String(m?.remote ?? ''))) applied.add(String(m.remote))
      continue
    }
    const row = /^\s*(\d{4})?\s*[|│]\s*(\d{4})?\s*[|│]/.exec(line)
    if (row) {
      read = true
      if (row[2]) applied.add(row[2])
    }
  }
  return read ? applied : null
}

// The CLI gives updated_at in milliseconds; a string is read as a date.
function updatedMs(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return /^\d+$/.test(v) ? Number(v) : Date.parse(v)
  return NaN
}

/**
 * Why `done <version>` must not close the release, or '' when production
 * shows it done (yoda's must 4). Allow lines are written before a call runs,
 * so a failed deploy looks done in the log; this reads production instead.
 * @param {{ version: string, marker: object | null, chain: object | null, pr: { state?: string } | null,
 *   migrationsText: string | null, functionsJson: string | null, logText: string | null }} facts
 */
export function doneWhyNot({ version, marker, chain, pr, migrationsText, functionsJson, logText }) {
  if (!chain || !Array.isArray(chain.versions) || !Array.isArray(chain.done)) return 'no chain is armed, or its marker is unreadable'
  const next = nextVersion(chain)
  if (!next) return 'the chain is already done'
  if (version !== next) return `V${version} isn't the chain's next release (V${next} is)`
  if (!marker || typeof marker !== 'object' || !Array.isArray(marker.commands) || !Number.isInteger(marker.pr)) return 'the release marker is missing or unreadable'
  if (marker.version !== version) return `the release marker is for V${marker.version}, not V${version}`
  // 1. merged
  if (pr?.state !== 'MERGED') return `PR #${marker.pr} is ${pr?.state ?? 'unreadable'}, not MERGED`
  // 2. each pushed migration applied on production
  const pushed = pushedMigrations(marker)
  if (pushed.length) {
    const applied = appliedMigrations(migrationsText)
    if (!applied) return "production's migration list couldn't be read"
    const missing = pushed.find((n) => !applied.has(n))
    if (missing) return `migration ${missing} isn't applied on production`
  }
  // 3. each listed function deployed after the arm
  const fns = deployedFunctions(marker)
  if (fns.length) {
    let list
    try { list = JSON.parse(String(functionsJson ?? '')) } catch { list = null }
    if (!Array.isArray(list)) return "production's function list couldn't be read"
    const since = Date.parse(marker.armedAt)
    if (!Number.isFinite(since)) return 'the release marker has no arm time'
    const stale = fns.find((name) => {
      const f = list.find((x) => x?.slug === name || x?.name === name)
      return !f || !(updatedMs(f.updated_at) > since)
    })
    if (stale) return `function ${stale} wasn't deployed to production after the arm`
  }
  // 4. no call asked a person since the arm
  if (typeof logText !== 'string') return 'the release log is unreadable'
  const lines = logText.split('\n')
  const at = lines.findLastIndex((l) => l.split('\t')[1] === 'armed')
  if (at < 0) return 'the release log has no armed line'
  const asked = lines.slice(at + 1).find((l) => l.split('\t')[1] === 'ask')
  if (asked) return `a call asked a person during the deploy: ${asked.split('\t')[2] ?? asked}`
  return ''
}

/**
 * done's one line for ranjit's report (his ask in 2.14.4 and 2.14.4.1):
 * `merged <sha>; functions: <name> v<n>, …` for the functions the release
 * deployed, from the reads done already made, so the report needs no more.
 * Always one line: what can't be read says so instead of failing done.
 * @param {{ mergeCommit?: { oid?: string } | null } | null} pr  `gh pr view --json mergeCommit`
 * @param {{ commands: string[] }} marker
 * @param {string | null} functionsJson  `supabase functions list -o json`
 */
export function doneLine(pr, marker, functionsJson) {
  const oid = pr?.mergeCommit?.oid
  const sha = typeof oid === 'string' && /^[0-9a-f]{40}$/.test(oid) ? oid : 'unknown'
  const fns = Array.isArray(marker?.commands) ? deployedFunctions(marker) : []
  if (!fns.length) return `merged ${sha}; functions: none deployed`
  let list
  try { list = JSON.parse(String(functionsJson ?? '')) } catch { list = null }
  const shown = fns.map((name) => {
    const f = Array.isArray(list) ? list.find((x) => x?.slug === name || x?.name === name) : null
    return `${name} ${Number.isInteger(f?.version) ? `v${f.version}` : 'v?'}`
  })
  return `merged ${sha}; functions: ${shown.join(', ')}`
}

// ---------------------------------------------------------------- facts

// The project (projectRoot, production-steps.mjs): CLAUDE_PROJECT_DIR, which
// Claude Code sets for hooks and the production scripts export, else the
// folder two up from the hooks. Re-exported: the guard resolves it here.
export { projectRoot }
const REPO_ROOT = projectRoot()
const CLAUDE_DIR = join(REPO_ROOT, '.claude')

/** The frozen set's hash on disk now, as the tap and the arm compare it. */
export const frozenOnDisk = (root = REPO_ROOT) => frozenHash(readFrozen(root), pluginLine(root))

/** The frozen set as it is on disk: git's tracked files, plus the local settings. */
export function readFrozen(root = REPO_ROOT) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  const out = execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...FROZEN], {
    cwd: root, env, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const paths = out.split('\0').filter(Boolean)
  if (!paths.includes(LOCAL_SETTINGS) && existsSync(join(root, LOCAL_SETTINGS))) paths.push(LOCAL_SETTINGS)
  return paths.map((path) => {
    let content = null
    try { content = readFileSync(join(root, path)) } catch { /* missing counts as missing */ }
    if (path === LOCAL_SETTINGS && content !== null) content = localSettingsForHash(content)
    return { path, content }
  })
}

// The local settings minus permissions.allow: "don't ask again" writes an
// allow line mid-chain (2.13), and an allow can't pass what the guard asks or
// denies. Hooks, deny/ask rules, the mode and env still count. JSON that
// doesn't parse is hashed as it is.
export function localSettingsForHash(buf) {
  let json
  try { json = JSON.parse(buf.toString('utf8')) } catch { return buf }
  if (json?.permissions && typeof json.permissions === 'object') delete json.permissions.allow
  return Buffer.from(JSON.stringify(json))
}

// As the guard reads its markers: absent is null, unreadable is {}.
function readJson(file) {
  let raw
  try { raw = readFileSync(file, 'utf8') } catch (err) { return err?.code === 'ENOENT' ? null : {} }
  try { return JSON.parse(raw) } catch { return {} }
}

// stdout of a read, or null when it fails.
function readOut(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- main

// scripts/full-auto.sh runs these and writes what they print.
//   frozen                               the set, one per line (arm-chain's git diff)
//   new-chain <main sha> <version…>      the chain marker's content
//   done <version>                       "next V<x>" or "last", then the chain with
//                                        <version> done; exit 1 with why, which disarms
//   one-tap <version>                    preview's verdict, one line per condition
function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const fail = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code) }
  if (cmd === 'frozen' && args.length === 0) {
    process.stdout.write(FROZEN.join('\n') + '\n')
    return
  }
  if (cmd === 'one-tap' && args.length === 1 && VERSION_RE.test(args[0].replace(/^V/, ''))) {
    const version = args[0].replace(/^V/, '')
    // The same read as the guard's at the arm.
    let pr = null
    try { pr = JSON.parse(readOut('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', RELEASE_PR_FIELDS]) ?? 'null')?.find((p) => p.headRefName === `V${version}`) ?? null } catch { pr = null }
    // Past 100 files gh's list is short; page it as the guard does at the arm.
    if (pr) pr = withCompleteFiles(pr, (n) => ghFetchFiles(n, REPO_ROOT))
    let hash = null
    try { hash = frozenOnDisk() } catch { /* unread: differs from any tap */ }
    const rows = oneTapVerdict({ version, chain: readJson(join(CLAUDE_DIR, 'full-auto-chain.json')), now: Date.now(), hash, pr })
    process.stdout.write(oneTapText(rows, version))
    return
  }
  if (cmd === 'new-chain' && args.length >= 2) {
    const [mainSha, ...words] = args
    const parsed = chainArgs(words)
    if (parsed.refuse) fail(parsed.refuse)
    const out = newChain(parsed.versions, Date.now(), mainSha, frozenOnDisk())
    if (out.refuse) fail(out.refuse)
    process.stdout.write(JSON.stringify(out.chain, null, 2) + '\n')
    return
  }
  if (cmd === 'done' && args.length === 1 && VERSION_RE.test(args[0].replace(/^V/, ''))) {
    const version = args[0].replace(/^V/, '')
    const marker = readJson(join(CLAUDE_DIR, 'full-auto.json'))
    const chain = readJson(join(CLAUDE_DIR, 'full-auto-chain.json'))
    const commands = Array.isArray(marker?.commands) ? marker.commands : []
    // Production is read only for what the release changed there.
    const prJson = Number.isInteger(marker?.pr) ? readOut('gh', ['pr', 'view', String(marker.pr), '--json', 'number,state,mergeCommit']) : null
    let pr = null
    try { pr = prJson ? JSON.parse(prJson) : null } catch { pr = null }
    const facts = {
      version, marker, chain, pr,
      migrationsText: commands.some((c) => PUSH_RE.test(c)) ? readOut('scripts/prod-db.sh', ['migrations']) : null,
      functionsJson: commands.some((c) => DEPLOY_RE.test(c)) ? readOut('supabase', ['functions', 'list', '--project-ref', PROD_REF, '-o', 'json']) : null,
      logText: (() => { try { return readFileSync(join(CLAUDE_DIR, 'full-auto.log'), 'utf8') } catch { return null } })(),
    }
    const why = doneWhyNot(facts)
    if (why) {
      process.stdout.write(`${why}\n`)
      process.exit(1)
    }
    const { next, chain: out } = markDone(chain, version, marker.pr, Date.now())
    process.stdout.write(`${next ? `next V${next}` : 'last'}\n${doneLine(pr, marker, facts.functionsJson)}\n${JSON.stringify(out, null, 2)}\n`)
    return
  }
  fail('usage: node .claude/hooks/chain-arm.mjs frozen | new-chain <main sha> <version…> | done <version> | one-tap <version>', 2)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
