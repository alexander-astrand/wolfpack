#!/usr/bin/env node
// Keeps Claude sessions on the dev Supabase project. Nickname: the Slap Bet
// Commissioner (it rules on every production call: pass it on, deny it or ask a person;
// the file name stays, since .claude/settings.json wires it by path).
//
// Runs before every Bash command, file edit and MCP tool call (see
// .claude/settings.json). Only the dev project is open to everyone. Any other
// Supabase project counts as production, and only the `ranjit` agent
// (started by /skinny-pete) may reach it. Its reads pass (they can't change
// production, and .claude/settings.json allows them), every change asks a
// human first, and a few paths stay closed even to it, so there is a single
// write path (scripts/prod-db.sh push/repair/setting and `supabase functions deploy`).
// Merging a release PR ships it too (Vercel deploys main), so `gh pr merge`
// and `gh pr ready` are ranjit's alone as well, and a push to main asks.
//
// The hook denies or asks. Returning nothing leaves the call to the normal
// permission rules. It approves ("allow") in one case only: full auto
// (/cattle-drive). A person arms a release with `scripts/full-auto.sh arm`,
// which writes .claude/full-auto.json; while that marker is valid and matches
// the release PR, ranjit's calls that would ask here are allowed instead, if
// the command is exactly one the marker and the PR's Production steps both
// list. While a marker is in place, every production call (whatever the
// verdict, whoever the agent) is logged to .claude/full-auto.log, secrets
// masked. Nothing but that script may write the marker or the log, or an
// agent could arm itself. `scripts/full-auto.sh preview` only prints.
// The allow also needs the repo as it was armed: the call runs from the repo
// root, HEAD is the marker's headSha, and no tracked file (nor an untracked
// or ignored one under supabase/ or scripts/) has changed, with git told to
// look past skip-worktree, assume-unchanged, replace refs and fsmonitor, so
// a listed command can't run a locally edited prod-db.sh, migration or
// function, or a worktree's copy. A merge also needs the PR green (CI's own
// jobs by name, not just any check), MERGEABLE, out of draft, and main no
// further on than the branch, so the squash is the armed tree.
//
// Its own files ask a person (should (c), 2.12.2): any edit or shell write to
// .claude/hooks/**, .claude/settings.json and settings.local.json,
// scripts/full-auto.sh and scripts/prod-db.sh asks, and is refused while full
// auto is armed. So from then on an agent's change to these files stops for
// a person, in every session and worktree. settings.json runs this file
// through guard-entry.mjs, which imports nothing and blocks the call (exit 2)
// if this file fails to load. Not seen: git commands that rewrite the tree
// without naming a path (pull, reset, switch), paths built at run time, and
// code an interpreter reads from a file or stdin.
//
// Known limits of a command-line guard (the arm prompt and the PR re-read
// bound them; a person still arms every release):
//   - The arm script's name is refused anywhere in a call (find -exec,
//     xargs -I, script, caffeinate, arch, env -S, a git alias, a copy by
//     cp/mv/ln/redirect), except: the script run as the whole command (arm
//     asks, preview and disarm pass); a plain reader (cat, less, head, tail,
//     grep, wc, ls, bash -n); and git add/diff/log/show/blame. A commit
//     message or PR text (-m, --body, --title) is text, not a call. A glob
//     counts as the name only in a folder that could be scripts/ (round 3,
//     S1): a bare one in the folder the command runs in, or any bare one
//     given to find, rsync, tar or git as a pattern; `rm -rf dist/*`, `du -sh
//     *` from the repo root and the `*` in a SQL string or a jq filter pass.
//     Interpreter code isn't expanded by a shell, so a glob there counts only
//     with such a folder; code that moves into scripts/ first (os.chdir) and
//     an -execdir shell's bare glob aren't followed.
//   - A name fully built at run time (`a=scripts/full; b=-auto.sh; c=ar;
//     d=m; $a$b $c$d 2.12.2`) can't be caught by parsing, and a copy of the
//     script written under another name by an editor or an interpreter
//     building its text still arms; content can't be followed. The test
//     file's known-gaps tables list these.
//   - A marker path built at run time (`> .claude/$F`) isn't seen; the marker
//     it could write still has to match the open PR and its list. A plain cp
//     out of .claude to a folder outside the checkout only reads it.
//
// Round 3 (2.12.2): a shell fed by a pipe, `<(…)`, stdin or a heredoc, and
// eval, source or `sh -c` of a substitution, run text the guard never reads,
// so they ask and are refused while a marker exists; rm, mv or chmod of a
// glob in a checkout's root (`rm -rf *`) asks like any write to these files;
// a nested `claude` asks in every session (its --version and --help pass);
// three-eyed-raven writes nothing but appends to its chain log
// (~/.claude/plans/V<x>-chain-log.md, by Edit; its shell only reads, though
// a script it runs by name and SQL on dev aren't followed). guard-entry.mjs
// blocks a call the guard hasn't decided within 18s, before the hook's 20s.
//
// A chain (2.12.2, C8): `scripts/full-auto.sh arm-chain <v1> …` asks a person
// once for an order of releases and writes .claude/full-auto-chain.json; a
// single drive is a chain of one. It authorises no command by itself: each
// release still gets its own marker from arm. Since 2.12.3 ranjit's arm
// passes without asking when the one-tap conditions hold (oneTapVerdict in
// chain-arm.mjs: in the tapped order, frozen set unchanged, CI green by job
// name, the list from the PR, backup first, migrations = the PR's files); a
// hard stop is denied, and a release the tap doesn't cover (one that changes
// the frozen set) asks at its arm. Under any marker the backup is the first
// change on a database release and the merge the last call (whyNot). While
// either marker exists, the frozen set (FROZEN in chain-arm.mjs: these files, check.sh, .github/ and
// the texts yoda and ranjit follow) is refused to everyone, a nested
// `claude` is refused (it could run as another agent, or without this
// guard), and every production call is logged to .claude/full-auto-chain.log
// as well, which only the script and this file write. `done <version>` is
// ranjit's alone; the script checks production before it closes a release.
//
// 2.12.3: the drive's reads are allowed in every session (readAllowed), so
// Auto mode's classifier can't stop a drive after its merge as it did in
// 2.12.2: a fixed list, and only when every other rule passed the whole call
// and nothing redirects, feeds a shell or substitutes; logged under a marker.
// Closed from review 4 (musts A–D): git -c values and GIT_* commands, writes
// to the global git config, `gh config set`, and claude by any path. Asks name
// the file and its role (E). Interpreter code is read as code, not shell: a
// `$1` or `**` in awk or node isn't a command built at run time, and awk's
// program is its own words, not the rest of the call.
//
// 2.12.4: the drive's own orders (driveAllow, below). Auto mode's classifier
// is a second gate that only a hook allow skips (the spike, 30 Sep), and it
// refused the deploy link's order to ranjit and the last wrap-up's plan
// writes. So the guard also sees SendMessage and Agent, and allows exactly:
// the arm-and-go template (or a ranjit spawn naming one version) from the
// main session under a marker for that version; the chain's wrap-up files;
// and ranjit's comment on the armed PR. Every other SendMessage or Agent call
// gets no decision, so the classifier judges it as before. `done` on the last
// release keeps the chain marker, marked finished, for the wrap-up.

import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { CI_JOBS, CI_WORKFLOW, DEPLOYER, DEV_KEYCHAIN_ITEM, DEV_REF, GH_FILES_MS, HOOKS_DIR, PROD_KEYCHAIN_ITEM, PROD_URL, allowedCommands, armList, changesDatabase, checksNotGreen, completeFiles, ghFetchFiles, pluginMode, prFacts } from './production-steps.mjs'
import { CHAIN_USAGE, FROZEN, FROZEN_RE, RELEASE_PR_FIELDS, chainArgs, chainWhyNot, frozenOnDisk, oneTapDecision, oneTapVerdict, projectRoot } from './chain-arm.mjs'

// The project's values come from its .claude/kit.json (production-steps.mjs
// reads it; a missing key fails closed): DEV_REF, DEPLOYER, PROD_URL (the one
// origin the deployer's signed-out smoke may read, 2.14.6) and the two
// Keychain items (the dev twin is for testing scripts/prod-db.sh on dev; the
// script itself refuses a URL for any other project under that name).
export { DEPLOYER, DEV_REF, PROD_URL }
// The project: CLAUDE_PROJECT_DIR, else two up from the hooks (projectRoot),
// never the shell's cwd, which an agent can change. Markers, logs and git
// calls all use it. As a plugin the hooks sit in Claude Code's install
// folder, outside the project (2.14.9.1).
const REPO_ROOT = projectRoot()
const AS_PLUGIN = pluginMode(REPO_ROOT)
// A plugin's agent arrives as `<plugin>:<name>` in agent_type and
// subagent_type (Claude Code's plugin docs), so as a plugin the deployer is
// matched both bare and as this plugin's; a project's own hooks match it bare.
const PLUGIN_NAME = 'database'
export const isDeployer = (name) => name === DEPLOYER || (AS_PLUGIN && name === `${PLUGIN_NAME}:${DEPLOYER}`)
// As a plugin, its own folder: its files decide what reaches production, so
// they join the frozen set beside the project's paths (namesProtected). A
// project's own hooks are .claude/hooks/, in FROZEN already.
const PLUGIN_DIRS = (() => {
  if (!AS_PLUGIN) return []
  const dir = normalize(join(HOOKS_DIR, '..'))
  let real = dir
  try { real = realpathSync(dir) } catch { /* the path as given */ }
  return [...new Set([dir, real])]
})()

const REF_RE = /^[a-z]{20}$/
const SUPABASE_HOST_RE = /\b([a-z]{20})\.(?:supabase\.co|supabase\.in|pooler\.supabase\.com)\b/g
const PG_URL_RE = /\bpostgres(?:ql)?:\/\//i

// CLI subcommands that never touch a project.
const SUPABASE_OFFLINE = [
  ['--version'], ['-v'], ['help'], ['--help'], ['-h'], ['login'], ['logout'],
  ['init'], ['completion'], ['projects', 'list'], ['orgs', 'list'],
  ['migration', 'new'], ['functions', 'new'],
]
// What the deployer may run against production with --project-ref: reads
// pass, deploys ask. The database goes through scripts/prod-db.sh, secrets
// are set by a human.
const DEPLOYER_CLI_READ = [['functions', 'list'], ['secrets', 'list']]
const DEPLOYER_CLI_WRITE = [['functions', 'deploy']]
// prod-db.sh subcommands that only read production. `query` runs in a
// read-only transaction; `backup` only dumps. `setting` writes app_settings,
// so it stays out and asks like `push`.
const PROD_DB_READ = new Set(['migrations', 'dry-run', 'query', 'backup'])
// Read-only Supabase connector tools the deployer may call on production.
const DEPLOYER_MCP = new Set([
  'list_migrations', 'list_edge_functions', 'get_edge_function', 'get_advisors',
  'get_logs', 'query_logs', 'list_tables', 'list_extensions', 'get_project',
])

const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'sudo', 'time', 'nice', 'xargs', 'npx', 'bunx', 'pnpx', 'timeout'])
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'in'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])
const TEMP_DIR = 'supabase/.temp'
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

// In the project's .claude folder (REPO_ROOT, above).
const CLAUDE_DIR = join(REPO_ROOT, '.claude')
export const MARKER = join(CLAUDE_DIR, 'full-auto.json')
const LOG = join(CLAUDE_DIR, 'full-auto.log')
export const CHAIN_MARKER = join(CLAUDE_DIR, 'full-auto-chain.json')
const CHAIN_LOG = join(CLAUDE_DIR, 'full-auto-chain.log')
// A word that names a marker or a log: the release's, the chain's, or yoda's
// verdict (a message with spaces never does). The disk is case-insensitive:
// Full-Auto.json is the same file.
const MARKER_WORD_RE = /^\S*full-auto(?:-chain|-verdict)?\.(?:json|log)$/i
const MARKER_FILE_RE = /full-auto(?:-chain|-verdict)?\.(?:json|log)/i
const SCRIPT_WORD_RE = /full-auto\.sh$/i
const MARKER_DENIED = 'The full-auto marker and its log are written only by scripts/full-auto.sh, which a person runs.'
// Commands that only read a file named as an argument.
const MARKER_READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'jq', 'ls', 'stat', 'file', 'wc', 'grep', 'egrep', 'rg', 'diff', 'test', '[', '[[', 'echo', 'printf', 'realpath', 'readlink', 'basename', 'dirname'])
const GIT_PATH_READS = new Set(['ls-files', 'check-ignore'])
// Programs that run code given inline or on stdin, where a path can be built
// from pieces or sit in a heredoc body the parser skips.
const INTERPRETERS = new Set(['node', 'python', 'python3', 'perl', 'ruby', 'osascript', 'deno', 'bun', 'php', 'awk', 'gawk', 'swift'])
// Moving or replacing the whole .claude folder could swap a marker in.
const CLAUDE_DIR_WORD_RE = /^(?:\S*\/)?\.claude\/?\.?$/i
// A marker older than this is refused whatever it says: arm writes 4 hours.
const MAX_ARMED_MS = 6 * 3600_000
// GitHub's merge and ready endpoints, and moving main by hand: `gh api` or
// curl with a token would otherwise skip `gh pr merge`'s check.
const HTTP_CLIENTS = new Set(['curl', 'wget', 'http', 'https', 'xh'])
const MERGE_BY_API = 'Merging goes through `gh pr merge`, which only ranjit runs, through /skinny-pete.'
// The PR number may be a $variable (`pulls/$N/merge`), so any path segment.
const GITHUB_MERGE_RE = /\/pulls\/[^/\s]+\/merge\b|\bmergePullRequest\b|\bmarkPullRequestReadyForReview\b|\benablePullRequestAutoMerge\b|\/git\/refs\/heads\/main\b|\/merges\b/
// The contents API commits a file, to main unless another branch is named.
const GITHUB_CONTENTS_WRITE_RE = /\/contents\//
const WRITE_METHOD_RE = /(?:^|\s)(?:-X\s*|--method[=\s]|--request[=\s])(?:PUT|DELETE)\b/i
// A word the shell rewrites before the command sees it: a variable, a
// substitution or a glob. What it becomes can't be read here.
const DYNAMIC_RE = /[$`*?[]/

/**
 * @param {object} input  the hook's stdin JSON
 * @param {{
 *   linkedRef?: () => string | null,
 *   marker?: () => object | null,
 *   openPr?: (n: number) => { headRefOid: string, headRefName: string, state: string, body: string } | null,
 *   releasePr?: (version: string) => { number: number, headRefOid: string, body: string } | null,
 *   repoState?: () => { root: string, head: string, status: string },  (throws when unreadable)
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   chainMarker?: () => object | null,
 *   chainLog?: (line: string) => void,
 *   frozen?: () => string,
 *   home?: string,  (three-eyed-raven's ~, for its chain log)
 *   readFile?: (path: string) => string,
 * }} [env]
 * @returns {{ decision: 'deny' | 'ask' | 'allow', reason: string } | null}
 */
export function decide(input, env = {}) {
  const tool = input.tool_name ?? ''
  const args = input.tool_input ?? {}
  const ctx = {
    deployer: isDeployer(input.agent_type),
    // In these modes an "ask" would never reach a human.
    unattended: ['bypassPermissions', 'dontAsk'].includes(input.permission_mode),
    linkedRef: env.linkedRef ?? (() => readLinkedRef(input.cwd)),
    marker: env.marker ?? readMarker,
    openPr: env.openPr ?? readPr,
    releasePr: env.releasePr ?? readReleasePr,
    repoState: env.repoState ?? readRepoState,
    compare: env.compare ?? readBehindBy,
    cwd: input.cwd,
    now: env.now ?? Date.now,
    log: env.log ?? ((line) => { try { appendFileSync(LOG, line + '\n') } catch { /* the allow stands; the PR comment says the log is missing */ } }),
    // The release log, read for the backup-first rule only.
    readLog: env.readLog ?? (() => readFileSync(LOG, 'utf8')),
    chainMarker: env.chainMarker ?? readChainMarker,
    chainLog: env.chainLog ?? ((line) => { try { appendFileSync(CHAIN_LOG, line + '\n') } catch { /* as the release log */ } }),
    // The frozen set's hash on disk, read only when asked: the one-tap arm
    // compares it with the tap's.
    frozen: env.frozen ?? (() => frozenOnDisk(REPO_ROOT)),
    // The checkout whose guard files a hard link is compared with.
    root: env.root ?? REPO_ROOT,
    source: tool === 'Bash' ? String(args.command ?? '') : '',
    agent: String(input.agent_type ?? 'main'),
    // Set by the checks when a call reaches production; logged while armed.
    production: false,
    logged: false,
  }
  // What the interpreter check reads: the command without heredoc bodies,
  // since a body is text for its own command only (a plan note that names
  // the marker isn't a write to it). A body is added back for the segment
  // that reads it.
  ctx.visible = withoutHeredocBodies(ctx.source)

  let result
  if (tool === 'Bash') {
    result = checkShell(ctx.source, ctx)
    // Only a call that would ask can become an allow: every deny stands, and
    // the unattended modes have already turned asks into denies.
    if (ctx.deployer && result?.decision === 'ask') result = underMarker(ctx.source, result, ctx)
    // Only a call every rule passed can be a listed read, or ranjit's comment.
    if (result === null) result = prCommentAllow(ctx)
    if (result === null) result = readAllowed(ctx)
  } else if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(tool)) {
    const path = String(args.file_path ?? args.notebook_path ?? '')
    if (ctx.agent === RAVEN) {
      const raven = ravenEdit(tool, args, env)
      if (raven) return raven
    }
    if (path.includes(TEMP_DIR + '/')) return deny('supabase/.temp holds the CLI link. Change it with `supabase link --project-ref ' + DEV_REF + '` only.')
    if (MARKER_WORD_RE.test(path)) return deny(MARKER_DENIED)
    // Through a symlinked folder or a hard link too (must 4). Only a file no
    // rule protects can be a wrap-up file.
    if (!protectedAt(path, { dir: input.cwd, built: false }, ctx)) return wrapFileAllow(tool, path, ctx, env)
    result = protectedChange(ctx, `Edits ${path}`, path)
  } else if (tool.startsWith('mcp__')) {
    result = checkMcp(tool, args, ctx)
    if (result === null) result = mcpReadAllowed(tool, args, ctx)
  } else if (tool === 'SendMessage' || tool === 'Agent') {
    return orderAllow(tool, args, input, ctx)
  } else {
    return null
  }
  if (ctx.production && !ctx.logged) logArmed(ctx, tool === 'Bash' ? ctx.source : `${tool} ${JSON.stringify(args)}`, result)
  return result
}

// ---------------------------------------------------------------- full auto

function underMarker(command, result, ctx) {
  const marker = ctx.marker()
  if (!marker) return result
  const exact = command.trim().replace(/[ \t]+/g, ' ')
  const why = whyNot(exact, marker, ctx)
  const out = why
    ? { decision: 'ask', reason: `${result.reason} (Full auto is armed, but ${why}.)` }
    : { decision: 'allow', reason: `Full auto, V${marker.version} (PR #${marker.pr}): on the release's list, logged.` }
  record(ctx, logLine(ctx, out.decision, exact, why || 'listed'))
  ctx.logged = true
  return out
}

// While a marker is in place, every production call gets a line, not only
// the marker's allows: the backup and dry run pass by allow rule, and a
// refused call is worth seeing in the PR comment too.
// A pass says which allow rule takes it (2.14.6: the 4 Oct deploy's backup
// and connector reads read "left to the permission rules", as if nothing
// covered them): a command on the marker's list, or one of ranjit's
// production reads (the connector's list tools, prod-db.sh's reads), which
// pass every check here and are on ranjit's allow rules.
function logArmed(ctx, what, result) {
  record(ctx, logLine(ctx, result?.decision ?? 'pass', what, result ? result.reason.split('\n')[0] : passLabel(ctx)))
}

function passLabel(ctx) {
  if (!ctx.deployer) return 'left to the permission rules'
  let m = null
  try { m = ctx.marker() } catch { /* unreadable: no list */ }
  const exact = ctx.source.trim().replace(/[ \t]+/g, ' ')
  if (exact && Array.isArray(m?.commands) && m.commands.includes(exact)) return "on the release's list, by allow rule"
  return 'read, by allow rule'
}

// One line to each log whose marker exists: the release's, posted to its PR,
// and the chain's, kept across its releases.
function record(ctx, line) {
  let release = false
  let chain = false
  try { release = ctx.marker() !== null } catch { /* unreadable: nothing to write to */ }
  try { chain = ctx.chainMarker() !== null } catch { /* as above */ }
  if (release) ctx.log(line)
  if (chain) ctx.chainLog(line)
}

// Either marker, or one that can't be read, counts as armed. A finished
// chain (done on its last release) stops counting once it expires: it lingers
// only for the wrap-up, and nothing deletes it on expiry (2.12.4).
function anyMarker(ctx) {
  try {
    const chain = ctx.chainMarker()
    const over = chain !== null && typeof chain?.finished === 'string' && Date.parse(chain.expiresAt) <= ctx.now()
    return ctx.marker() !== null || (chain !== null && !over)
  } catch {
    return true
  }
}

// ---------------------------------------------------------------- the drive's orders (2.12.4)

// Why these are allows at all: Auto mode's classifier refused them in a drive
// no one watches (the deploy link's order to ranjit, the last wrap-up's plan
// writes, ranjit's merge comment), and only a hook allow skips it. Each is as
// narrow as the drive needs; anything near it gets no decision (null), so the
// classifier judges it as before. The order's receiver isn't checked (a hook
// can't learn ranjit's agent id): the text does nothing for anyone else, and
// ranjit's own calls still meet its agent gate and the marker's list.
const ARM_AND_GO_RE = /^Arm and go, under the marker for V(\d+(?:\.\d+)*): scripts\/full-auto\.sh arm (\d+(?:\.\d+)*) as its own call, then the plan as shown, from step ([1-9]\d*)\.$/
// Any version a ranjit prompt names, V or v: a second one could steer it.
const NAMED_VERSION_RE = /(?<!\w)[Vv](\d+(?:\.\d+)+)/g
const WRAP_FILE_RE = /^V(\d+(?:\.\d+)*)(-wrap|-chain-log)?\.md$/

// The frozen set's hash on disk now, or null (which matches no tap). A chain
// marker covers nothing once the guard's files differ from what was tapped,
// as at the one-tap arm; the marker's own hash would always match itself
// (review should 2).
function frozenNow(ctx) {
  try { return ctx.frozen() } catch { return null }
}

// A chain marker whose lists can be read; chainWhyNot then says if it holds.
const chainShaped = (c) => c !== null && typeof c === 'object' && Array.isArray(c.versions) && Array.isArray(c.done)

// A marker covers <version> now: the release's, unexpired and for it, or the
// chain's, valid and with it still to deploy. Unreadable is no cover here.
function markerCovers(version, ctx) {
  const now = ctx.now()
  let m = null
  let c = null
  try { m = ctx.marker() } catch { /* none */ }
  try { c = ctx.chainMarker() } catch { /* none */ }
  const expires = Date.parse(m?.expiresAt)
  if (m?.version === version && Array.isArray(m.commands) && Number.isInteger(m.pr) && expires > now && expires - now <= MAX_ARMED_MS) return true
  // The disk is read last, only when the rest already holds.
  return chainShaped(c) && !c.finished && c.versions.includes(version) && !c.done.includes(version) && !chainWhyNot(c, now, frozenNow(ctx))
}

// New allows go to both logs, whichever marker is left (the spec's rule).
function allowBoth(ctx, what, why, reason) {
  const line = logLine(ctx, 'allow', what, why)
  ctx.log(line)
  ctx.chainLog(line)
  ctx.logged = true
  return { decision: 'allow', reason }
}

// The one order that arms and starts a deploy, from the main session only,
// attended, under a marker for that version (gate audit 1).
function orderAllow(tool, args, input, ctx) {
  // A subagent's call carries its id even when its type is missing (should 1).
  if (input.agent_type != null || input.agent_id != null || ctx.unattended) return null
  let version
  if (tool === 'SendMessage') {
    const hit = ARM_AND_GO_RE.exec(String(args.message ?? '').replace(/\s+/g, ' ').trim())
    if (!hit || hit[1] !== hit[2]) return null
    version = hit[1]
  } else {
    if (!isDeployer(args.subagent_type)) return null
    const named = new Set([...String(args.prompt ?? '').matchAll(NAMED_VERSION_RE)].map((h) => h[1]))
    if (named.size !== 1) return null
    version = [...named][0]
  }
  if (!markerCovers(version, ctx)) return null
  const what = tool === 'SendMessage' ? `SendMessage ${args.message}` : `Agent ${DEPLOYER}: ${args.description ?? ''}`
  return allowBoth(ctx, what, `arm-and-go for V${version}`, `The drive's order to ${DEPLOYER} for V${version}, under its marker; logged.`)
}

// The chain's wrap-up files (answer 3): V<v>-wrap.md, V<first>-chain-log.md
// and V<next>.md in ~/.claude/plans, while a valid chain marker holds them,
// finished included (gate audit 3). The path is taken as given, absolute and
// already normal, and never through a link. Never unattended (gap 10): there
// is no classifier to skip there, and an allow would skip the permission
// rules instead (review M3).
function wrapFileAllow(tool, path, ctx, env) {
  if (ctx.unattended || !['Write', 'Edit', 'MultiEdit'].includes(tool)) return null
  let c = null
  try { c = ctx.chainMarker() } catch { return null }
  if (!chainShaped(c)) return null
  const plans = join(env.home ?? homedir(), '.claude', 'plans')
  if (!isAbsolute(path) || normalize(path) !== path || dirname(path) !== plans) return null
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink() || st.nlink > 1) return null
  } catch (err) {
    if (err?.code !== 'ENOENT') return null
  }
  const hit = WRAP_FILE_RE.exec(basename(path))
  if (!hit) return null
  const [, v, kind] = hit
  // done is a subset of versions, so "in versions or done" is versions. The
  // plan file is only the release right after the last one done: a wrap-up
  // plans the next release, nothing further (review should 3).
  const after = c.versions[c.versions.indexOf(c.done.at(-1)) + 1]
  const ok = kind === '-wrap' ? c.versions.includes(v)
    : kind === '-chain-log' ? v === c.versions[0]
      : c.done.length > 0 && c.versions.includes(c.done.at(-1)) && v === after
  // The disk is read last, only for a file that would be allowed.
  if (!ok || chainWhyNot(c, ctx.now(), frozenNow(ctx))) return null
  return allowBoth(ctx, `${tool} ${path}`, 'wrap-up file under the chain marker', `A wrap-up file of the chain (V${c.versions.join(', V')}), under its marker; logged.`)
}

// Where a comment's body file may be (review M2): the repo, /tmp, or the
// session scratchpad under /private/tmp. Nothing in a dot folder or file
// (.env, .ssh, .git), so no secret can be posted.
const COMMENT_ROOTS = ['/tmp', '/private/tmp']

function bodyFileOk(path, ctx) {
  if (typeof path !== 'string' || !/^[\w./-]+$/.test(path) || path.split('/').some((s) => s.startsWith('.'))) return false
  let real
  try {
    real = realpathSync(resolve(ctx.cwd ?? ctx.root, path))
    if (!statSync(real).isFile()) return false
  } catch {
    return false
  }
  // Through a link too: the file it lands on is what gh would post.
  return [ctx.root, ...COMMENT_ROOTS].some((root) => {
    let r
    try { r = realpathSync(root) } catch { return false }
    return real.startsWith(r + '/') && !real.slice(r.length + 1).split('/').some((s) => s.startsWith('.'))
  })
}

// The PR a comment may go to: the release marker's while it holds, or one a
// chain's done recorded (`prs`) while the chain marker holds, finished
// included: done deletes the release marker before ranjit's report (M5).
function commentPr(n, ctx) {
  if (!/^[1-9]\d*$/.test(n ?? '')) return null
  const now = ctx.now()
  let m = null
  let c = null
  try { m = ctx.marker() } catch { /* none */ }
  try { c = ctx.chainMarker() } catch { /* none */ }
  const expires = Date.parse(m?.expiresAt)
  if (m?.pr === Number(n) && expires > now && expires - now <= MAX_ARMED_MS) return 'the armed PR'
  const prs = chainShaped(c) && c.prs && typeof c.prs === 'object' ? Object.values(c.prs) : []
  if (prs.includes(Number(n)) && !chainWhyNot(c, now, frozenNow(ctx))) return "the chain's PR"
  return null
}

// ranjit's comment on its PR (gate audit 2): the whole call is
// `gh pr comment <n> --body-file <path>` (or --body-file=, -F) and nothing
// else. No inline body: `--body "$TOKEN"` would post a secret, and parseShell
// drops quotes, so no $, backtick, glob, brace, ~, ! or backslash anywhere
// either (review M2). --editor and --web would run a program. Never
// unattended (gap 10, M3).
function prCommentAllow(ctx) {
  if (!ctx.deployer || ctx.unattended || /[$`*?[\]{}~!\\<>]/.test(ctx.source)) return null
  const segs = parseShell(ctx.source)
  if (segs.length !== 1 || segs[0].subshell || 'heredoc' in segs[0] || segs[0].writes.length) return null
  const [gh, pr, sub, n, ...rest] = segs[0].words
  if (gh !== 'gh' || pr !== 'pr' || sub !== 'comment') return null
  const path = rest.length === 1 ? /^--body-file=(.+)$/.exec(rest[0])?.[1]
    : rest.length === 2 && ['--body-file', '-F'].includes(rest[0]) ? rest[1] : undefined
  if (!bodyFileOk(path, ctx)) return null
  const which = commentPr(n, ctx)
  if (!which) return null
  return allowBoth(ctx, ctx.source, `comment on PR #${n}`, `${DEPLOYER}'s comment on ${which} #${n}, from a body file; logged.`)
}

// time, verdict, command, why, agent: one line, tabs only between fields.
function logLine(ctx, verdict, what, why) {
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim()
  return [new Date(ctx.now()).toISOString(), verdict, flat(maskSecrets(what)).slice(0, 500), flat(why), ctx.agent].join('\t')
}

// The log is posted to the PR, so it never holds a secret: the same rule as
// prod-db.sh's redact (a connection string becomes [db-url]), plus the
// values of secret-looking variables, flags and bearer tokens.
export function maskSecrets(text) {
  return String(text)
    .replace(/\bpostgres(?:ql)?:\/\/\S+/gi, '[db-url]')
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PW|PWD|AUTH)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, '$1=***')
    .replace(/(--(?:password|token|api-key|secret)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, '$1***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, '$1 ***')
    .replace(/\b(?:sb[_]secret_|sb[p]_|ghp_|gho_|ghs_|github_pat_|eyJ)[A-Za-z0-9._-]{8,}/g, '***')
}

// Why the marker doesn't cover this call, or '' when it does.
function whyNot(cmd, m, ctx) {
  if (typeof m !== 'object' || !Array.isArray(m.commands) || !Number.isInteger(m.pr) || typeof m.headSha !== 'string') return 'the marker is unreadable'
  const expires = Date.parse(m.expiresAt)
  const now = ctx.now()
  if (!(expires > now)) return 'the marker has expired'
  if (expires - now > MAX_ARMED_MS) return 'the marker claims more than 6 hours'
  if (!m.commands.includes(cmd)) return "this exact command isn't on its list"
  const pr = ctx.openPr(m.pr)
  if (!pr) return `PR #${m.pr} couldn't be read`
  if (pr.headRefName !== `V${m.version}`) return `PR #${m.pr} is ${pr.headRefName}, not V${m.version}`
  if (pr.headRefOid !== m.headSha) return `PR #${m.pr} has moved since it was armed`
  // The merge is the last production call in an armed run (2.12.2's stop):
  // After merge steps run before it, from the armed commit.
  if (pr.state === 'MERGED') return `PR #${m.pr} is MERGED: the merge is the last production call in an armed run, so nothing runs after it`
  if (pr.state !== 'OPEN') return `PR #${m.pr} is ${pr.state}`
  // The PR is read again, so a marker written by anything but arm still
  // can't add a command the release doesn't list.
  if (!allowedCommands(String(pr.body ?? ''), m.pr).includes(cmd)) return "the PR's Production steps don't list it"
  // The listed command runs what's on disk, so the disk must be what was armed.
  const repo = repoWhyNot(m, ctx)
  if (repo) return repo
  const backup = backupRanWhyNot(m, ctx)
  if (backup) return backup
  // The "Peer review" ruleset has no required checks and Alexander's token
  // bypasses it, so GitHub alone won't stop a red or draft merge. `gh pr
  // ready` isn't held to this: it's what takes the PR out of draft first.
  if (/^gh pr merge\b/.test(cmd)) {
    if (pr.state !== 'OPEN') return `PR #${m.pr} is ${pr.state}`
    if (pr.isDraft !== false) return `PR #${m.pr} is ${pr.isDraft ? 'a draft' : 'of unknown draft state'}`
    if (pr.mergeable !== 'MERGEABLE') return `PR #${m.pr} is ${pr.mergeable ?? 'of unknown mergeability'}, not MERGEABLE`
    const red = checksNotGreen(pr.statusCheckRollup)
    if (red) return `PR #${m.pr}'s checks aren't green (${red})`
    // A squash onto a main that gained commits after the branch was cut
    // isn't the tree that was armed (should 8, round 2). Unreadable refuses.
    const behind = ctx.compare(pr.baseRefName, m.headSha)
    if (behind !== 0) {
      if (!Number.isInteger(behind)) return `how far ${pr.baseRefName ?? 'the base'} is ahead of the branch couldn't be read`
      return `${pr.baseRefName} has ${behind} commit${behind === 1 ? '' : 's'} the branch doesn't, so the squash wouldn't be the armed tree`
    }
  }
  return ''
}

// On a database release, `scripts/prod-db.sh backup <version>` is the first
// production call after the arm (the backup rule, decided for the one-tap arm):
// no listed change runs until the release log shows ranjit's backup since
// its armed line. The guard writes that line before the call runs; that it
// succeeded is prod-db.sh's to check (push refuses without a complete,
// fresh backup for the release). The log is written only by the script and
// this file.
function backupRanWhyNot(m, ctx) {
  if (!changesDatabase(m.commands)) return ''
  const backup = `scripts/prod-db.sh backup ${m.version}`
  let text
  try { text = ctx.readLog() } catch { text = null }
  if (typeof text !== 'string') return `the release log couldn't be read, so \`${backup}\` can't be shown to have run first`
  const rows = text.split('\n').map((l) => l.split('\t'))
  const at = rows.findLastIndex((r) => r[1] === 'armed')
  if (at < 0) return 'the release log has no armed line'
  const ran = rows.slice(at + 1).some((r) => (r[1] === 'pass' || r[1] === 'allow') && r[2] === backup && isDeployer(r[4]))
  return ran ? '' : `\`${backup}\` hasn't run since the arm, and on a database release the backup is the first production call`
}

// Untracked or ignored files here are what the listed commands run
// (migrations, functions, the scripts); supabase's own link and branch state
// and Finder's .DS_Store aren't.
const CODE_PATH_RE = /^"?(?:supabase|scripts)\//
const NOT_CODE_RE = /^"?supabase\/\.(?:temp|branches)\/|(?:^|\/)\.DS_Store"?$/

// The call must run in the repo root at the armed commit with nothing
// changed. Any error reading it is a refusal: this is the allow path.
function repoWhyNot(m, ctx) {
  let state
  try {
    state = ctx.repoState()
  } catch (err) {
    return `the repo's state couldn't be read (${String(err?.message ?? err).split('\n')[0]})`
  }
  if (!state || typeof state.head !== 'string' || typeof state.status !== 'string' || typeof state.root !== 'string' || typeof state.flags !== 'string') return "the repo's state couldn't be read"
  if (!ctx.cwd || realPath(ctx.cwd) !== realPath(state.root)) return `the call runs in ${ctx.cwd || 'an unknown folder'}, not the repo root`
  if (state.head.trim() !== m.headSha) return `HEAD is ${state.head.trim().slice(0, 7) || 'unknown'}, not the armed ${m.headSha.slice(0, 7)}`
  const changed = state.status.split('\n').filter((l) => l.trim()).filter((l) => {
    const path = l.slice(3)
    if (l.startsWith('??')) return CODE_PATH_RE.test(path)
    if (l.startsWith('!!')) return CODE_PATH_RE.test(path) && !NOT_CODE_RE.test(path)
    return true
  })
  if (changed.length) return `the working tree has changes (${changed[0].trim()}${changed.length > 1 ? ` and ${changed.length - 1} more` : ''})`
  // git can be told a changed file isn't: skip-worktree (S) and
  // assume-unchanged (a lowercase tag) hide it from status (should 4).
  const hidden = state.flags.split('\n').filter((l) => /^(?:[a-z]|S) /.test(l))
  if (hidden.length) return `git is told not to look at ${hidden[0].slice(2)}${hidden.length > 1 ? ` and ${hidden.length - 1} more` : ''}`
  return ''
}

function realPath(p) {
  try {
    return realpathSync(resolve(p))
  } catch {
    return resolve(p)
  }
}

// CI's own jobs by name and checksNotGreen live in production-steps.mjs since
// 2.12.3, where the one-tap arm reads them too; the test that keeps them in
// step with ci.yml imports them from here.
export { CI_JOBS, CI_WORKFLOW }

// What the hook may spend, worst case, on an allow: gh pr view, the compare
// call and the git calls. settings.json gives the hook 20s, and a hook that
// is killed decides nothing (should 7, round 2); a test keeps this under it.
// The paged files read at the arm (2.14.6) is counted too, so the PR read
// went from 7 s to 5 s to stay under guard-entry's 18 s watchdog.
const GH_PR_MS = 5000
const GH_COMPARE_MS = 5000
const GIT_MS = 1000
const GIT_CALLS = 3
export const WORST_CASE_MS = GH_PR_MS + GH_COMPARE_MS + GIT_MS * GIT_CALLS + GH_FILES_MS

// Throws on any git error; repoWhyNot turns that into a refusal. git is told
// to look at the tree itself: no replace refs (a replaced HEAD can match an
// edited index), no fsmonitor or untracked cache (either can report nothing
// changed), no GIT_* from the environment, and ignored files are listed too,
// since .git/info/exclude or the repo's `*.local` can hide a new file
// (should 4, round 2).
export function readRepoState(dir = REPO_ROOT) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  const git = (...args) => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
    cwd: dir, env, encoding: 'utf8', timeout: GIT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [root = '', head = ''] = git('rev-parse', '--show-toplevel', 'HEAD').split('\n')
  return {
    root: root.trim(),
    head: head.trim(),
    // matching: an ignored folder is one line, so node_modules stays cheap.
    status: git('status', '--porcelain', '--untracked-files=all', '--ignored=matching'),
    flags: git('ls-files', '-v'),
  }
}

// How many commits `base` has that `head` lacks, from GitHub's compare API,
// or null when that can't be read.
function readBehindBy(base, head) {
  if (typeof base !== 'string' || !/^[\w./-]+$/.test(base) || typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head)) return null
  try {
    const out = execFileSync('gh', ['api', `repos/{owner}/{repo}/compare/${base}...${head}`, '--jq', '.behind_by'], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: GH_COMPARE_MS, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return /^\d+$/.test(out) ? Number(out) : null
  } catch {
    return null
  }
}

function readMarker() {
  return readJsonMarker(MARKER)
}

function readChainMarker() {
  return readJsonMarker(CHAIN_MARKER)
}

// null only when the file isn't there; one that exists but can't be read or
// parsed is {}, which counts as armed (a permission error must not unlock).
export function readJsonMarker(file) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    return err?.code === 'ENOENT' ? null : {}
  }
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// About a second, and only for ranjit's calls that would otherwise ask while
// a marker exists: a dozen per deploy.
function readPr(n) {
  try {
    const out = execFileSync('gh', ['pr', 'view', String(n), '--json', 'headRefOid,headRefName,baseRefName,state,body,isDraft,mergeable,statusCheckRollup'], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: GH_PR_MS, stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(out)
  } catch {
    return null
  }
}

// The open PR for V<version>, read once at the arm, with what arm reads for
// merge-only (draft state and changed files) and the one-tap arm for CI.
function readReleasePr(version) {
  try {
    const out = execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', RELEASE_PR_FIELDS], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: GH_PR_MS, stdio: ['ignore', 'pipe', 'ignore'],
    })
    return releasePrFrom(JSON.parse(out), version, (n) => ghFetchFiles(n, REPO_ROOT))
  } catch {
    return null
  }
}

/**
 * V<version>'s PR from the open list, its files completed by `fetchFiles`
 * when gh's list stopped at 100 (2.13.8's 132 files, `[pr-size]`). When the
 * paged read fails the files stay short, so prFacts reads them as unknown
 * and the arm says they "couldn't be read" and asks, as before.
 */
export function releasePrFrom(list, version, fetchFiles) {
  const pr = Array.isArray(list) ? list.find((p) => p?.headRefName === `V${version}`) ?? null : null
  if (!pr) return null
  const all = completeFiles(pr, fetchFiles)
  return all && all.length !== pr.files.length ? { ...pr, files: all.map((path) => ({ path })) } : pr
}

const VERSION_ARG_RE = /^V?\d+(?:\.\d+)*$/
// A plan file for check-plan: a plain path, nothing the shell rewrites.
const PLAN_FILE_RE = /^[\w./~-]+$/
const DONE_DENIED = 'Only ranjit closes a release\'s deploy (scripts/full-auto.sh done <version>).'

// `arm-chain …` always reaches a person: it is the one yes. `arm <version>`
// passes for ranjit under the chain marker when the one-tap conditions hold
// (oneTapVerdict), is denied on a hard stop, and otherwise asks a person as
// before. `disarm` only takes rights away; `done` is ranjit's; `preview` and
// `check-plan` only read and print.
function checkFullAuto(seg, words, ctx) {
  const args = words.slice(1)
  if (seg.words.length !== words.length) return deny('scripts/full-auto.sh runs without VAR=value or wrappers in front, so what a person approves is what runs.')
  if (args.length === 1 && args[0] === 'disarm') return null
  // preview reads the PR and prints the list arm would write; it writes nothing.
  if (args.length === 2 && args[0] === 'preview' && VERSION_ARG_RE.test(args[1])) return null
  if (args.length === 3 && args[0] === 'check-plan' && VERSION_ARG_RE.test(args[1]) && PLAN_FILE_RE.test(args[2])) return null
  if (args.length === 2 && args[0] === 'arm' && VERSION_ARG_RE.test(args[1])) {
    const version = args[1].replace(/^V/, '')
    let chain = null
    try { chain = ctx.chainMarker() } catch { chain = {} }
    const pr = ctx.releasePr(version)
    let note = ''
    if (chain !== null && ctx.deployer) {
      let hash = null
      try { hash = ctx.frozen() } catch { /* unread: differs from the tap */ }
      const rows = oneTapVerdict({ version, chain, now: ctx.now(), hash, pr })
      const decision = oneTapDecision(rows)
      const failed = rows.filter((r) => r.why)
      const what = `scripts/full-auto.sh arm ${version}`
      if (decision === 'allow') {
        record(ctx, logLine(ctx, 'allow', what, 'one-tap arm: all six hold'))
        return { decision: 'allow', reason: `One-tap arm for V${version} (PR #${pr.number}): it's in the arm given at the start, the frozen set is unchanged, CI is green by job name, the list comes from the PR, the backup is first and the migrations are the PR's files. Logged.` }
      }
      if (decision === 'deny') {
        const hard = failed.find((r) => r.stop === 'deny')
        record(ctx, logLine(ctx, 'deny', what, `one-tap arm: ${hard.name}: ${hard.why}`))
        return deny(`The one-tap arm refuses V${version}: ${hard.name}: ${hard.why}. A hard stop: disarm (scripts/full-auto.sh disarm) and report it.`)
      }
      record(ctx, logLine(ctx, 'ask', what, `one-tap arm: ${failed.map((r) => r.why).join('; ')}`))
      note = ` (The one-tap arm doesn't cover it: ${failed.map((r) => r.why).join('; ')}. This tap is the arm.)`
    } else if (chain !== null) {
      note = ' (The chain is armed; only ranjit\'s arm can pass on it.)'
    }
    // The person approving sees exactly what the marker will hold, not just a
    // version: arm's own list, merge-only included.
    if (!pr) return ask(ctx, `Arms full auto for V${version}, but no open PR for V${version} could be read, so arm will refuse.${note}`)
    const at = `PR #${pr.number} at ${String(pr.headRefOid).slice(0, 7)}`
    const arm = armList(String(pr.body ?? ''), pr.number, prFacts(JSON.stringify(pr)) ?? {})
    if (arm.refuse) return ask(ctx, `Arms full auto for V${version}, ${at}, but arm will refuse: ${arm.refuse}${note}`)
    const kind = arm.mergeOnly ? ' merge-only (its steps say None)' : ''
    return ask(ctx, `Arms full auto${kind} for V${version}, ${at}: for 4 hours ranjit may run, without asking:\n${arm.commands.map((c) => '  ' + c).join('\n')}${note}`)
  }
  if (args[0] === 'arm-chain') {
    const parsed = chainArgs(args.slice(1))
    if (parsed.refuse) return deny(CHAIN_USAGE)
    // Asks every caller, ranjit too: the tap is a person's, and the one yes.
    const order = parsed.versions.map((v) => `V${v}`)
    return ask(ctx, `Arms ${order.length === 1 ? 'a drive' : 'a chain'}: ${order.join(' → ')}, in this order, for 48 hours. This is the one yes: each release's deploy then arms without asking you when it's the next in this order, changes none of the guard's frozen files, has CI green by job name, and its PR lists the backup first and exactly its own migrations; ranjit runs only the list derived from its PR, backup first, merge last. Anything else stops the drive, or asks you at that release's arm (a release that changes the guard's files always does). While it's armed, the guard's files, check.sh, CI and yoda's and ranjit's texts are locked, and a nested claude is refused. Each release's done checks production before the next; any stop disarms it.`)
  }
  if (args.length === 2 && args[0] === 'done' && VERSION_ARG_RE.test(args[1])) {
    if (!ctx.deployer) return deny(DONE_DENIED)
    // It reads production and only narrows: it closes the release, or disarms.
    ctx.production = true
    return { decision: 'allow', reason: `ranjit closes V${args[1].replace(/^V/, '')}'s deploy: done checks production first and disarms on anything else; logged.` }
  }
  return deny('Usage: scripts/full-auto.sh arm <version> | arm-chain <version> … | done <version> | disarm | preview <version> | check-plan <version> <plan file>')
}

function checkMcp(tool, args, ctx) {
  const ref = args.project_id ?? args.project_ref
  if (typeof ref !== 'string' || !REF_RE.test(ref) || ref === DEV_REF) return null
  ctx.production = true
  const name = tool.slice(tool.lastIndexOf('__') + 2)
  if (!ctx.deployer) return deny(`${name} targets Supabase project ${ref}, which isn't dev. Production is reached only through /skinny-pete.`)
  if (!DEPLOYER_MCP.has(name)) return deny(`The connector is read-only on production. Migrations go through scripts/prod-db.sh and functions through \`supabase functions deploy\`.`)
  return null
}

// ---------------------------------------------------------------- the read allowlist

// The drive's read-only calls (2.12.3, settled at its inception): allowed in
// every session, marker or not, since an allow skips Auto mode's classifier,
// which stopped 2.12.2's drive after its merge. Fixed on purpose;
// don't widen it. `git log --output` writes a file, so it isn't a read.
const READ_MCP = new Set(['query_logs', 'get_advisors', 'get_deployment', 'list_deployments'])
const SUPABASE_READ_MCP = new Set(['query_logs', 'get_advisors'])
// The Vercel status as the drive reads it through GitHub: a deployment list
// or one deployment's statuses.
const DEPLOYMENTS_RE = /^\/?repos\/[\w.-]+\/[\w.-]+\/deployments(?:\/\d+\/statuses)?(?:\?[\w=&%.,-]*)?$/
const READ_NOTE = 'On the read allowlist'

// A Bash call is allowed only when the whole call is listed reads: every
// segment on the list, run as itself (no VAR=value or wrapper in front), no
// redirect but to /dev/null, and no substitution, process substitution or
// heredoc, so nothing but the listed program runs. Any pipe leads to another
// segment, which must be listed too, so `| sh` never passes.
function readAllowed(ctx) {
  const src = ctx.source
  // `>&file`, `<&file` and `<>file` write a file too (must 1, 2.12.3 review):
  // refused here as well as by the parser, so a parser slip can't allow one.
  if (!src.trim() || /`|\$\(|<\(|>\(|<<|[<>]&\s*(?![\d-])|<>/.test(src)) return null
  const segs = parseShell(src)
  if (!segs.length || !segs.every((seg) => !seg.subshell && seg.writes.every((w) => w === '/dev/null') && listedRead(seg.words, ctx))) return null
  return allowRead(ctx, src)
}

// ranjit's signed-out smoke on production (2.14.6, Alexander's "Narrow guard
// allow"): Auto's classifier refused it in 2.14.3, so on a database deploy
// it was a human step afterwards (`[deploy-order]`). The Chrome connector's
// tools that only look, for ranjit alone, while the release's marker holds
// and its PR is merged (the smoke follows the merge), with any url exactly
// on production's origin. A click, typing, a form, a script or a key never:
// those could sign in or change something. Anything else gets no decision.
const CHROME_PREFIX = 'mcp__claude-in-chrome__'
const CHROME_READS = new Set(['tabs_create_mcp', 'tabs_context_mcp', 'navigate', 'read_page', 'get_page_text', 'find', 'read_console_messages', 'resize_window'])
function smokeAllowed(tool, args, ctx) {
  if (!ctx.deployer || !tool.startsWith(CHROME_PREFIX)) return null
  // No urls.prod in kit.json, no smoke allow at all: a look without a url
  // reads whatever tab is open (fails closed, 2.14.9.1).
  if (!/^https?:\/\//.test(PROD_URL)) return null
  const name = tool.slice(CHROME_PREFIX.length)
  const look = CHROME_READS.has(name) || (name === 'computer' && args.action === 'screenshot')
  if (!look) return null
  if ('url' in args || name === 'navigate') {
    if (typeof args.url !== 'string') return null
    let url
    try { url = new URL(args.url) } catch { return null }
    if (url.origin !== PROD_URL || url.username || url.password) return null
  }
  let m = null
  try { m = ctx.marker() } catch { return null }
  const expires = Date.parse(m?.expiresAt)
  const now = ctx.now()
  if (!m || typeof m.version !== 'string' || !Number.isInteger(m.pr) || !(expires > now) || expires - now > MAX_ARMED_MS) return null
  // The PR is read last, only for a call that would be allowed.
  const pr = ctx.openPr(m.pr)
  if (pr?.state !== 'MERGED' || pr.headRefName !== `V${m.version}`) return null
  record(ctx, logLine(ctx, 'allow', `${tool} ${JSON.stringify(args)}`, `smoke read of ${PROD_URL} after PR #${m.pr}'s merge`))
  ctx.logged = true
  return { decision: 'allow', reason: `ranjit's signed-out smoke of V${m.version}: a read-only look at ${PROD_URL} after PR #${m.pr} merged; logged.` }
}

function mcpReadAllowed(tool, args, ctx) {
  const smoke = smokeAllowed(tool, args, ctx)
  if (smoke) return smoke
  const name = tool.slice(tool.lastIndexOf('__') + 2)
  if (!READ_MCP.has(name)) return null
  const ref = args.project_id ?? args.project_ref
  if (SUPABASE_READ_MCP.has(name) && (typeof ref !== 'string' || !REF_RE.test(ref))) return null
  return allowRead(ctx, `${tool} ${JSON.stringify(args)}`)
}

function allowRead(ctx, what) {
  const out = { decision: 'allow', reason: `${READ_NOTE}: a read-only call the drive makes.` }
  record(ctx, logLine(ctx, 'allow', what, 'read allowlist'))
  ctx.logged = true
  return out
}

function listedRead(words, ctx) {
  if (!words.length || words.some((w) => /[$`]/.test(w))) return false
  const [cmd, a, b] = words
  const rest = words.slice(2)
  if (cmd === 'git') return (a === 'status' || a === 'log') && !rest.some((w) => /^--output\b/.test(w))
  if (cmd === 'gh' && a === 'pr') return b === 'view' || b === 'checks'
  if (cmd === 'gh' && a === 'api') return deploymentsRead(words.slice(2))
  if (cmd === 'supabase') {
    if (a !== 'functions' || b !== 'list') return false
    const more = words.slice(3)
    for (let i = 0; i < more.length; i++) {
      if (['--project-ref', '-o', '--output'].includes(more[i]) && more[i + 1] !== undefined) i++
      else if (!/^--(?:project-ref|output)=\S+$/.test(more[i])) return false
    }
    return true
  }
  // --chart and --decisions write files, so those runs aren't reads.
  if (cmd === 'node') return usageScript(a, ctx) && !rest.some((w) => /^--(?:chart|decisions)/.test(w))
  return false
}

// `gh api` GET of the deployments list: only --jq and --paginate beside it.
function deploymentsRead(args) {
  let endpoint
  for (let i = 0; i < args.length; i++) {
    const w = args[i]
    if (w === '--jq' || w === '-q') { if (args[++i] === undefined) return false; continue }
    if (w.startsWith('--jq=') || w === '--paginate') continue
    if (w.startsWith('-') || endpoint !== undefined) return false
    endpoint = w
  }
  return endpoint !== undefined && DEPLOYMENTS_RE.test(endpoint)
}

// Skyler's books: `node scripts/usage.mjs …`, with no node flags in front, and
// the script exactly this checkout's own: any other usage.mjs inside the repo
// (a scratch folder, a worktree's copy) could hold anything (must 2, 2.12.3
// review).
function usageScript(path, ctx) {
  if (typeof path !== 'string' || path.startsWith('-')) return false
  if (!isAbsolute(path) && !ctx.cwd) return false
  const real = realPath(isAbsolute(path) ? path : resolve(ctx.cwd, path))
  return real === join(realPath(ctx.root), 'scripts', 'usage.mjs')
}

// ---------------------------------------------------------------- shell

// `where` is the folder each segment runs in: the call's cwd, moved by any
// earlier cd in the call, so a relative write is judged where it lands
// (`cd .claude && echo x > settings.json`, yoda's must 4). `dir` stays
// relative when the cwd isn't known; `built` is a cd to a folder built at
// run time, after which a relative write asks.
function checkShell(src, ctx, where = { dir: ctx.cwd, built: false }) {
  // Nothing a person writes nests this deep; text built to exhaust the
  // guard is refused, not read.
  ctx.depth = (ctx.depth ?? 0) + 1
  try {
    if (ctx.depth > MAX_DEPTH) return deny(`The command nests more than ${MAX_DEPTH} levels deep, too deep for the guard to read.`)
    const results = []
    const segs = parseShell(src)
    segs.forEach((seg, k) => {
      // A cd that ran only if what came before it succeeded (`a && cd x`)
      // holds while the call goes on by &&; after a ; a newline or a ||, the
      // call may go on where it was, so the folder is unknown (2.14.9.1, B2).
      if (where.iffy && seg.opBefore && seg.opBefore !== '&&') where = { dir: undefined, built: true }
      // A segment after a plain `cd /x;` may run in /x or, if the cd failed,
      // where the call was: it is judged in each folder it could run in.
      const { others = [], ...here } = where
      for (const at of [here, ...others]) {
        seg.where = { ...here, ...at }
        results.push(checkSegment(seg, ctx))
      }
      seg.where = here
      where = afterCd(seg, where, segs[k - 1] ?? null, segs.slice(k + 1).find((s) => !s.subshell) ?? null)
    })
    return strictest(results)
  } finally {
    ctx.depth--
  }
}
const MAX_DEPTH = 64

function afterCd(seg, where, last = null, next = null) {
  const words = stripPrefix(seg.words)
  if (seg.subshell || !['cd', 'pushd'].includes(words[0])) return where
  // A cd in a pipeline runs in a subshell, and one after || or & may not run
  // (or not before what follows): where the call goes on is unknown, so it
  // counts as built at run time (2.14.6 review round 1, should 2).
  if (['|', '||', '&'].includes(seg.opBefore) || ['|', '&'].includes(seg.opAfter)) return { dir: undefined, built: true }
  // `cd /x || cp …` runs the cp exactly when the cd failed, and `cd /x ||
  // true; cp …` either way (2.14.9.1, B2). Only `cd /x || exit` (or return)
  // stops the call when the cd fails, and with it a failed `a &&` before it.
  const stops = seg.opAfter === '||' && next && ['exit', 'return'].includes(stripPrefix(next.words)[0]) && !['||', '|', '&'].includes(next.opAfter)
  if (seg.opAfter === '||' && !stops) return { dir: undefined, built: true }
  const { others = [], ...here } = where
  const { made, ...landed } = afterCdTo(seg, words, here, last)
  if (landed.built) return landed
  // After `a && cd x` the cd ran only if a succeeded: checkShell drops the
  // folder at the next ; or newline.
  const iffy = seg.opBefore === '&&' && !stops
  // A cd that ran in any folder the call might be in moves from each of them;
  // after a plain `cd /x;` (or a newline) the call goes on even when the cd
  // failed, so the folders it was in stay possible too (2.14.9.2, S4: `cd
  // /nope; cp x .claude/settings.json` was judged as if it ran in /nope).
  const moved = others.map((o) => afterCdTo(seg, words, o, last))
  // A `cd $_` into the folder mkdir just made lands, as it did before: c-3po's
  // scratch copies (2.14.6) shouldn't ask again over a mkdir that failed.
  const failed = !iffy && !made && [';', '\n'].includes(seg.opAfter) ? [here, ...others] : []
  const alts = []
  for (const at of [...moved, ...failed]) {
    if (![landed, ...alts].some((a) => a.dir === at.dir && a.built === at.built)) alts.push({ dir: at.dir, built: at.built })
  }
  // A long run of cds that could each fail leaves too many folders to keep:
  // the folder counts as built at run time.
  if (alts.length > MAX_CD_FOLDERS) return { dir: undefined, built: true }
  return { ...landed, ...(iffy && { iffy }), ...(alts.length && { others: alts }) }
}
const MAX_CD_FOLDERS = 4

function afterCdTo(seg, words, where, last) {
  let to = words.slice(1).find((w) => !w.startsWith('-') || w === '-')
  // `mkdir -p <folder> && cd $_`: $_ is mkdir's last word, so when that word
  // is plain text the cd lands there (2.14.6: c-3po's scratch copies were
  // refused as writes to a folder built at run time). Only right after the
  // mkdir, by `&&`, `;` or a newline, and not with a `||` fallback; anything
  // else in front, or a folder the shell fills in, stays built.
  if (to === '$_' && last && !last.subshell && ['&&', ';', '\n'].includes(seg.opBefore) && seg.opAfter !== '||') {
    const made = stripPrefix(last.words)
    const dir = made.at(-1)
    const plain = (k) => !(last.marks?.[k + last.words.length - made.length] ?? []).length && !/[$`*?[{~]/.test(made[k])
    if (made[0] === 'mkdir' && made.length > 1 && !dir.startsWith('-') && made.every((_, k) => plain(k))) return { ...afterCdTo(seg, [words[0], dir], where, null), made: true }
  }
  if (to === undefined || to === '~' || to.startsWith('~/')) return { dir: join(homedir(), (to ?? '').slice(2)), built: false }
  if (/[$`*?[{~]/.test(to) || to === '-') return { dir: undefined, built: true }
  if (isAbsolute(to)) return { dir: to, built: false }
  return { dir: join(where.dir ?? '', to), built: where.built }
}

// Every segment gets each check, and the strictest answer stands: a write to
// the guard's files asks, but never softens a deny found for the same words.
function checkSegment(seg, ctx) {
  // Each segment is judged in every folder a failed cd leaves possible, and
  // again inside each heredoc shell: text built to multiply that work past
  // the hook's timeout is refused, not read (2.14.9.2 review, must 1).
  ctx.work = (ctx.work ?? 0) + 1
  if (ctx.work > MAX_WORK) return deny(`The command takes more than ${MAX_WORK} checks to read, too much for the guard to read.`)
  // A shell's heredoc script runs in a shell of its own, from this folder.
  const script = seg.where?.code ? null : shellHeredoc(seg)
  const here = seg.where ?? { dir: ctx.cwd, built: false }
  const result = strictest([checkSegmentFor(seg, ctx), protectedWrite(seg, ctx), gitConfigEnv(seg, ctx), ...laterCommands(seg, ctx), ...assignedCommands(seg, ctx),
    ...codeShells(seg, ctx), script === null ? null : heredocShell(script, ctx, here)])
  // An awk or sed script that runs a program or writes a file (2.13.6.1)
  // keeps any answer the other checks give it (`sed '1e gh pr merge …'`
  // asks, as gh pr merge does), and is refused when they have none.
  const tool = seg.where?.code ? null : textTool(seg)
  if (tool?.verdict !== 'runs' || (result && result.decision !== 'allow')) return result
  return deny(`${tool.why}: ${seg.words.join(' ')}. Read with a plain script, and write with a shell redirect the guard can see.`)
}
const MAX_WORK = 20000

// The same heredoc script, in the same folder at the same depth, reads the
// same: a shell judged in several possible folders reads each one once.
function heredocShell(script, ctx, here) {
  const key = `${ctx.depth}|${here.dir}|${here.built}|${script}`
  ctx.heredocs ??= new Map()
  if (!ctx.heredocs.has(key)) ctx.heredocs.set(key, checkShell(script, ctx, { dir: here.dir, built: here.built }))
  return ctx.heredocs.get(key)
}

// perl's and ruby's own shell quotes: backticks, perl's qx{…} and ruby's
// %x{…}. In single quotes the shell never sees them, so parseShell leaves
// them in the word as text, and laterCommands takes a backtick pair for a
// substitution already checked (PR #46's known gap: perl -e '`gh pr merge
// 44`' passed). Each body is judged as a command line here, in every word
// and heredoc of the call: a backtick in a perl string that is only text is
// refused too, which is the safe side. system(…) and exec(…) are read by
// laterCommands already (their string is a word with spaces).
const SHELL_QUOTE_CODE = { perl: /`|\bqx\s*([^\w\s])/g, ruby: /`|%x([^\w\s])/g }
const QUOTE_PAIRS = { '{': '}', '(': ')', '[': ']', '<': '>' }
function codeShells(seg, ctx) {
  if (seg.subshell) return []
  const words = stripPrefix(seg.words)
  const name = commandName(words[0] ?? '')
  const opener = SHELL_QUOTE_CODE[name]
  if (!opener) return []
  // Word by word: each -e script (and the heredoc) starts a statement.
  const parts = [...words.slice(1), seg.heredoc ?? '']
  const code = (name === 'perl' ? parts.map(withoutPerlSubstitutions) : parts).join('\n')
  const bodies = []
  const re = new RegExp(opener.source, 'g')
  for (let m; (m = re.exec(code));) {
    const open = m[1] ?? '`'
    const close = QUOTE_PAIRS[open] ?? open
    let depth = 1
    let j = m.index + m[0].length
    for (; j < code.length; j++) {
      if (code[j] === '\\') { j++; continue }
      if (code[j] === close && --depth === 0) break
      if (open !== close && code[j] === open) depth++
    }
    bodies.push(code.slice(m.index + m[0].length, j))
    re.lastIndex = j + 1
  }
  return bodies.filter((b) => b.trim()).map((b) => checkShell(b, ctx, { ...seg.where, code: false }))
}

// perl's s/// without an e flag: its pattern and replacement are a regex and
// a string, where a backtick is text (2.14.6: saul-goodman's
// `s/…/{`\$\{TAP_HEIGHT\} shrink-0`}/` was refused as a hidden gh). Only the
// backticks of a substitution perl itself would see become spaces; the rest
// of its text stays for every other scan, so a qx{…} in it is still judged.
// It must start a statement or follow =~ or !~, outside a quoted string and
// a comment, with / # | or ! as its delimiter (`$h{s}` isn't one), on one
// line, and hold no block perl runs while it interpolates or matches
// (`@{[ … ]}`, `${\ … }`, `$h{…}`, `$a[…]`, `(?{ … })`: review round 1, must 1).
// Anything else stays as it is, so a backtick there is still judged.
const PERL_RUNS_IN_STRING_RE = /(?<!\\)[$@]#?(?:\w|::)*\s*(?:->\s*)?[{[]|\(\?\??\{/
function withoutPerlSubstitutions(code) {
  let out = ''
  let i = 0
  const STARTS = new Set(['', ';', '{', '}', '(', ','])
  const before = () => {
    const t = out.trimEnd()
    return t.endsWith('=~') || t.endsWith('!~') ? '' : t.at(-1) ?? ''
  }
  while (i < code.length) {
    const c = code[i]
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1
      out += code.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '#') {
      const nl = code.indexOf('\n', i)
      const end = nl < 0 ? code.length : nl
      out += code.slice(i, end)
      i = end
      continue
    }
    const d = code[i + 1]
    if (c === 's' && STARTS.has(before()) && !/[\w$@%&]/.test(out.at(-1) ?? '') && d && '/#|!'.includes(d)) {
      let j = i + 2
      const part = () => {
        while (j < code.length && code[j] !== d) j += code[j] === '\\' ? 2 : 1
        if (j >= code.length) return false
        j++
        return true
      }
      if (part() && part()) {
        const flags = /^[a-z]*/.exec(code.slice(j))[0]
        const text = code.slice(i, j)
        if (!flags.includes('e') && !text.includes('\n') && !PERL_RUNS_IN_STRING_RE.test(text)) {
          out += text.replaceAll('`', ' ') + flags
          i = j + flags.length
          continue
        }
      }
    }
    out += c
    i++
  }
  return out
}

// A variable a program runs as a command (GIT_SSH_COMMAND, GIT_PAGER,
// GIT_EDITOR, GIT_ASKPASS, EDITOR, BROWSER, …; must A, review 4), set in front
// of the command, after env or in export: a value with a space, | or ! is
// judged as a command line, like a word laterCommands rescans. Only these
// names: `DIR="$HOME/Application Support"` is a path, not a command. Commit
// and PR text isn't a value, and a substitution is its own segment already.
const COMMAND_VAR_RE = /^(?:GIT_\w+|\w*(?:COMMAND|EDITOR|PAGER|BROWSER|ASKPASS|HELPER)\w*)=/
function assignedCommands(seg, ctx) {
  if (seg.subshell) return []
  const head = commandName(stripPrefix(seg.words)[0] ?? '')
  return seg.words.filter((w, i) => COMMAND_VAR_RE.test(w) && !isText(head, seg.words, i))
    .map((w) => {
      let v = w.slice(w.indexOf('=') + 1)
      for (let prev; prev !== v;) { prev = v; v = v.replace(/\$\([^()]*\)|`[^`]*`/g, '$S') }
      return v
    })
    .filter((v) => /[\s|!]/.test(v))
    .map((v) => checkShell(v.replace(/^!/, ''), ctx, { ...seg.where, code: false }))
}

// Runners the guard doesn't know (caffeinate, arch, script, stdbuf, watch,
// find -exec, …) run whatever follows them, so after one, each later word
// that is a command the guard judges is judged again from there, and a word
// with spaces in it is read as a command line (yoda's must 1). The heads
// below never run their arguments, or are read in full by their own check.
// sed isn't one: GNU sed's `e` command and s///e flag run a shell
// (`sed -n '1e gh pr merge …'`, 2.12.4), so its script is read like a runner's.
const RESCAN = new Set(['gh', 'git', 'supabase', 'prod-db.sh', 'full-auto.sh', 'psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'claude', 'claude-code', ...HTTP_CLIENTS, ...SHELLS])
const NO_RESCAN = new Set([...RESCAN, 'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'wc', 'jq', 'ls', 'stat',
  'file', 'diff', 'test', '[', '[[', 'realpath', 'readlink', 'basename', 'dirname', 'cd', 'pushd', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'sort',
  'uniq', 'cut', 'tr', 'true', 'false', 'export', 'which', 'type', 'printenv', 'date', 'sleep', 'tee', 'source', '.', 'eval'])
const commandName = (w) => basename(String(w)).replace(/(?<=.)@[^/]*$/, '').toLowerCase()

function laterCommands(seg, ctx) {
  if (seg.subshell) return []
  const words = stripPrefix(seg.words)
  if (!words.length || NO_RESCAN.has(commandName(words[0]))) return []
  // Code read whole that runs no program has no command line in it: a
  // string there is text (2.12.4, proseCode).
  if (proseCode(seg, commandName(words[0]), words.slice(1))) return []
  // Nor does an awk, sed, perl or find call that only reads (2.13.6.1),
  // unless the call also has a shell that may run what it prints
  // (`… | sed 's/x/gh pr merge 1/' | sh`): then its text is read as before.
  if (textTool(seg)?.verdict === 'plain' && !callFeedsShell(ctx)) return []
  // An interpreter's words are its code, where `$1` is awk's field and `**`
  // node's power, not a command built at run time (2.12.3: the 2.12.2
  // wrap-up's awk and node lines were refused as a hidden gh merge). A
  // string in that code that runs a shell (system("gh pr merge …")) is a
  // segment of its own there, judged as shell again.
  const where = { ...seg.where, code: INTERPRETERS.has(commandName(words[0])) }
  const results = []
  words.forEach((w, j) => {
    const name = commandName(w)
    // prod-db.sh as a file to read or edit (`perl -pi … scripts/prod-db.sh`)
    // isn't a call; with a subcommand after it, it is.
    const runs = (RESCAN.has(name) || isClaude(name)) && (name !== 'prod-db.sh' || PROD_DB_SUBS.has(words[j + 1]))
    // A substitution in the word is already checked as its own segment; so
    // is a process substitution, which the parser marks (2.13.6.1).
    let line = withoutSubstitutions(w, seg.marks?.[j + seg.words.length - words.length])
    // In an interpreter's code, a backtick or `$(` the shell left alone (single
    // quotes, `\``) is the language's own text: a JS template, a regex. Read
    // as a shell substitution, its odd backtick swallowed the rest of the code
    // as a subshell (2.14.6: mosbius's `{today:m[1]}`), and a pair became `$S`,
    // which in code hid what it held (`execSync(\`gh pr merge 1\`)` passed).
    // Opened up instead, what it holds is read as words like the rest.
    // perl's and ruby's real shell quotes are codeShells' to judge. Inside a
    // string the code hands on, though, `…` and $(…) are what a shell would
    // run (os.system("echo `gh pr merge 1`"), review round 1, should 3), so
    // each is judged as a command line of its own.
    if (where.code) {
      const opened = openCodeQuotes(line)
      line = opened.line
      for (const body of opened.shells) results.push(checkShell(body, ctx, { ...where, code: false }))
    } else for (let prev; prev !== line;) { prev = line; line = line.replace(/\$\([^()]*\)|`[^`]*`/g, '$S') }
    if (/\s/.test(line)) results.push(checkShell(line, ctx, where))
    else if (j > 0 && runs) results.push(checkSegment({ words: words.slice(j), writes: [], where: seg.where }, ctx))
  })
  // `node <<'EOF'`, `python3 - <<EOF`: with no script named, the heredoc is
  // the program, read like an -e or -c word (2.14.9.1, B2: an execSync of gh
  // pr merge passed in a heredoc and was refused in -e). awk's program is its
  // first word, so its heredoc is data.
  const cmd = commandName(words[0])
  if (where.code && seg.heredoc !== undefined && cmd !== 'awk' && cmd !== 'gawk' && words.slice(1).every((w) => w.startsWith('-'))) {
    const opened = openCodeQuotes(seg.heredoc)
    for (const body of opened.shells) results.push(checkShell(body, ctx, { ...where, code: false }))
    results.push(checkShell(opened.line, ctx, where))
  }
  return results
}

// Interpreter code with its backticks and `$(` opened to spaces, and the
// bodies of the backtick pairs and $(…) found inside its '…' or "…" strings.
// A quote the scan misreads (one in a regex) only turns more text into
// bodies to judge: the safe side.
function openCodeQuotes(code) {
  let line = ''
  const shells = []
  let quote = null
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (quote && c === '\\') { line += code.slice(i, i + 2); i++; continue }
    if (c === "'" || c === '"') {
      if (!quote) quote = c
      else if (quote === c) quote = null
      line += c
      continue
    }
    if (quote && (c === '`' || (c === '$' && code[i + 1] === '('))) {
      // A backtick pair ends inside its string; one left open there runs to
      // the string's end, which is what a shell given that string would see.
      let k = i + 1
      let last
      if (c === '`') {
        while (k < code.length && code[k] !== '`' && code[k] !== quote) k += code[k] === '\\' ? 2 : 1
        k = Math.min(k, code.length)
        last = code[k] === '`' ? k : k - 1
        shells.push(code.slice(i + 1, k))
      } else {
        k = matchParen(code, i + 1)
        last = Math.min(k, code.length - 1)
        shells.push(code.slice(i + 2, k))
      }
      line += ' '.repeat(last + 1 - i)
      i = last
      continue
    }
    line += c === '`' || (c === '$' && code[i + 1] === '(') ? ' ' : c
  }
  return { line, shells: shells.filter((b) => b.trim()) }
}

// Whether any command in the call is a shell, eval or source (after env,
// xargs and the other wrappers): one that may run text another prints.
function callFeedsShell(ctx) {
  if (ctx.feedsShell === undefined) {
    const walk = (src) => parseShell(src).some((s) => (s.subshell ? walk(s.subshell)
      : ['eval', 'source', '.', ...SHELLS].includes(commandName(stripPrefix(s.words)[0] ?? ''))))
    ctx.feedsShell = walk(ctx.source ?? '')
  }
  return ctx.feedsShell
}

// A word with the substitutions the parser saw in it ($(…), `…`, <(…), each
// checked as a segment of its own) put back as `$S`.
function withoutSubstitutions(w, marks = []) {
  let out = w
  for (const m of [...marks].reverse()) {
    if (m.kind === 'dyn' && /^(?:\$\(|`|[<>]\()/.test(w.slice(m.at))) out = out.slice(0, m.at) + '$S' + out.slice(m.end)
  }
  return out
}

// ---------------------------------------------------------------- awk, sed, perl and find that only read (2.13.6.1)

// Chain 2.13.5.4 met eleven false refusals from one gap: an awk or sed
// script's `$1`, `$NF` or `$d`, or perl's `$_`, was rescanned as a shell line,
// where it looked like a command built at run time (`$1` may be gh). A script
// is read here in its own language instead. One that can only print, delete,
// quit or substitute (sed), or compare and print (awk), has no command line in
// it, so it isn't rescanned. One that can run a program or write a file
// (sed's e and w, awk's system, pipes, output redirects and @-directives) is
// refused, whatever it names: the guard doesn't follow what they reach. A
// script the shell fills in ("$x", $(…)) is read as before, since its text
// isn't known until run time; `$(( ))` is a number and doesn't count.
// Returns { tool, verdict: 'plain' | 'runs', why, inPlace } or null (read as before).
const TEXT_TOOLS = new WeakMap()
function textTool(seg) {
  if (seg.subshell || !seg.marks) return null
  if (!TEXT_TOOLS.has(seg)) TEXT_TOOLS.set(seg, readTextTool(seg))
  return TEXT_TOOLS.get(seg)
}

function readTextTool(seg) {
  const words = stripPrefix(seg.words)
  if (!words.length) return null
  const off = seg.words.length - words.length
  const cmd = commandName(words[0])
  // The word at k as the tool gets it, or null when the shell fills it in.
  const text = (k) => {
    const marks = seg.marks[k + off] ?? []
    if (k >= words.length || marks.some((m) => m.kind === 'dyn')) return null
    let w = words[k]
    for (const m of [...marks].reverse()) w = w.slice(0, m.at) + '1' + w.slice(m.end)
    return w
  }
  if (cmd === 'sed' || cmd === 'gsed') return readSed(words, text)
  if (['awk', 'gawk', 'mawk', 'nawk'].includes(cmd)) return readAwk(words, text)
  if (cmd === 'perl') return readPerl(words, text)
  if (cmd === 'find') {
    // find without an action that runs or writes only lists paths.
    return words.some((w) => /^-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/i.test(w)) ? null : { tool: 'find', verdict: 'plain' }
  }
  return null
}

const SED_RUNS = "sed's e and w commands (and s///e, s///w) run a program or write a file the guard doesn't follow"
function readSed(words, text) {
  const scripts = []
  const files = []
  let inPlace = false
  for (let k = 1; k < words.length; k++) {
    const w = words[k]
    if (w === '-e' || w === '--expression' || /^-[nErsuz]+e$/.test(w)) {
      if (w.length > 2 && w.startsWith('-') && !w.startsWith('--') && w !== '-e') { /* -ne: flags, then the script */ }
      scripts.push(text(k + 1))
      k++
      continue
    }
    // Attached: -e'…', -ne'…', --expression='…'.
    const attached = /^(?:-[nErsuz]*e|--expression=)(.+)$/s.exec(w)
    if (attached) {
      const whole = text(k)
      scripts.push(whole === null ? null : whole.slice(w.length - attached[1].length))
      continue
    }
    if (/^--in-place(?:=.*)?$/.test(w)) { inPlace = true; continue }
    // -i alone (GNU) or -i '' / -i .bak (BSD): the suffix is a word of its own.
    if (/^-[nErsuz]*i$/.test(w)) {
      inPlace = true
      if (words[k + 1] === '' || /^\.[\w.-]*$/.test(words[k + 1] ?? '')) k++
      continue
    }
    if (/^-[nErsuz]*i\.[\w.-]*$/.test(w)) { inPlace = true; continue }
    if (/^-[nErsuz]+$/.test(w)) continue
    // -f reads a script file; any other flag isn't one of the plain ones.
    if (w.startsWith('-') && w !== '-') return /^-[nErsuz]*f$|^--file/.test(w) ? { tool: 'sed', verdict: 'runs', why: "sed -f reads a script the guard can't read" } : null
    files.push(k)
  }
  if (!scripts.length && files.length) scripts.push(text(files[0]))
  if (!scripts.length) return null
  const verdicts = scripts.map((s) => (s === null ? null : sedVerdict(s)))
  if (verdicts.includes('runs')) return { tool: 'sed', verdict: 'runs', why: SED_RUNS }
  return verdicts.every((v) => v === 'plain') ? { tool: 'sed', verdict: 'plain', inPlace } : null
}

// 'plain' when every command prints, deletes, quits, substitutes (s///,
// y///) or moves through the input; 'runs' for e, w, W or s///e, s///w; null
// for anything else (a, i, c, r, labels and branches), read as before.
function sedVerdict(s) {
  let i = 0
  const spaces = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++ }
  const digits = () => { while (/\d/.test(s[i] ?? '')) i++ }
  // Past a delimited part (a regex or a replacement), at its closing delimiter.
  const part = (d) => {
    while (i < s.length && s[i] !== d) i += s[i] === '\\' ? 2 : 1
    if (i >= s.length) return false
    i++
    return true
  }
  const address = () => {
    if (/\d/.test(s[i] ?? '')) { digits(); if (s[i] === '~') { i++; digits() } return true }
    if (s[i] === '$') { i++; return true }
    if (s[i] === '/' || s[i] === '\\') {
      if (s[i] === '\\') i++
      const d = s[i++]
      if (!d || d === '\n' || !part(d)) return false
      while (/[IM]/.test(s[i] ?? '')) i++
      return true
    }
    return null
  }
  for (;;) {
    while (i < s.length && /[\s;]/.test(s[i])) i++
    if (i >= s.length) return 'plain'
    if (s[i] === '}') { i++; continue }
    if (s[i] === '#') { while (i < s.length && s[i] !== '\n') i++; continue }
    const a = address()
    if (a === false) return null
    if (a) {
      spaces()
      if (s[i] === ',') {
        i++
        spaces()
        if (s[i] === '+' || s[i] === '~') { i++; digits() } else if (address() !== true) return null
      }
    }
    spaces()
    if (s[i] === '!') { i++; spaces() }
    const c = s[i++]
    if (c === '{') continue
    if (c === 'e' || c === 'w' || c === 'W') return 'runs'
    if (c === 's' || c === 'y') {
      const d = s[i++]
      if (!d || d === '\\' || /\s/.test(d)) return null
      if (!part(d) || !part(d)) return null
      if (c === 's') {
        while (/[gpiImM0-9]/.test(s[i] ?? '')) i++
        if (/[ewW]/.test(s[i] ?? '')) return 'runs'
      }
    } else if (c === 'q' || c === 'Q' || c === 'l' || c === 'L') {
      spaces()
      digits()
    } else if (!c || !'pPdDnNgGhHxz='.includes(c)) {
      return null
    }
    spaces()
    if (i < s.length && !/[;\n}]/.test(s[i])) return null
  }
}

function readAwk(words, text) {
  let k = 1
  for (; k < words.length; k++) {
    const w = words[k]
    if (w === '-F' || w === '-v') { k++; continue }
    if (/^-[Fv]./.test(w)) continue
    if (w === '--') { k++; break }
    // A program from a file or a library: the guard can't read it.
    if (/^(?:-[fEil]|--(?:file|exec|include|load))/.test(w)) return { tool: 'awk', verdict: 'runs', why: "awk -f, -E, -i and -l load a program the guard can't read" }
    if (w.startsWith('-')) return null
    break
  }
  const prog = text(k)
  if (prog === null) return null
  const why = awkRuns(prog)
  if (why === UNSURE) return null
  return why ? { tool: 'awk', verdict: 'runs', why } : { tool: 'awk', verdict: 'plain', code: prog }
}

// Why an awk program may run a program or write a file, or null. Strings and
// regex literals are taken out first: a `|` or `>` in /a|b/ or "x > y" is text.
// A `>` after print or printf, outside parentheses and before the statement
// ends, is a redirect; anywhere else (a pattern, a condition, `print (a > b)`)
// it's a comparison.
function awkRuns(source) {
  // A backslash-newline joins lines (even inside a name: sys\⏎tem); a
  // newline after , && || { else do continues the statement.
  const prog = source.replace(/\\\n/g, '').replace(/(,|&&|\|\||\{|\belse|\bdo)[ \t]*\n/g, '$1 ')
  let s = ''
  let prev = ''
  for (let i = 0; i < prog.length;) {
    const c = prog[i]
    if (c === '"') {
      let j = i + 1
      while (j < prog.length && prog[j] !== '"' && prog[j] !== '\n') j += prog[j] === '\\' ? 2 : 1
      if (prog[j] !== '"') return UNSURE
      s += '""'
      prev = '"'
      i = j + 1
      continue
    }
    // A regex where an operand starts; after a name, a number, `)`, `]`,
    // `++` or `--` a slash divides.
    if (c === '/' && (prev === '' || /[(,~!&|{};:?=<>*%^+-]/.test(prev)) && !/(?:\+\+|--)\s*$/.test(s)) {
      let j = i + 1
      while (j < prog.length && prog[j] !== '/' && prog[j] !== '\n') {
        if (prog[j] === '\\') j++
        else if (prog[j] === '[') { j++; if (prog[j] === ']') j++; while (j < prog.length && prog[j] !== ']' && prog[j] !== '\n') j++ }
        j++
      }
      if (prog[j] !== '/') return UNSURE
      s += '//'
      prev = '/'
      i = j + 1
      continue
    }
    if (c === '#') { while (i < prog.length && prog[i] !== '\n') i++; continue }
    s += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  if (/\bsystem\b/.test(s)) return "awk's system() runs a program the guard doesn't follow"
  if (s.includes('@')) return "awk's @include, @load and @-calls reach code the guard can't read"
  if (/(?<!\|)\|(?!\|)/.test(s)) return "a pipe in awk (print | \"cmd\", \"cmd\" | getline) runs a program the guard doesn't follow"
  const redirect = "awk's print > file writes a file the guard doesn't follow (a > after print or printf is a redirect, not a comparison)"
  if (s.includes('>>')) return redirect
  const re = /\bprintf?\b/g
  for (let m; (m = re.exec(s));) {
    let depth = 0
    for (let j = m.index + m[0].length; j < s.length; j++) {
      const ch = s[j]
      if (ch === '(') depth++
      else if (ch === ')') { if (depth === 0) break; depth-- }
      else if (depth === 0 && /[;}\n]/.test(ch)) break
      else if (depth === 0 && ch === '>' && s[j + 1] !== '=') return redirect
    }
  }
  // Any other > that isn't >= and isn't inside parentheses may be a
  // redirect the reading above missed (a regex read as a division can hide
  // where a print starts): read as before (review round 1, M3).
  let depth = 0
  for (let j = 0; j < s.length; j++) {
    if (s[j] === '(') depth++
    else if (s[j] === ')') depth = Math.max(0, depth - 1)
    else if (s[j] === '>' && s[j + 1] !== '=' && depth === 0) return UNSURE
  }
  return null
}
const UNSURE = Symbol('unsure')

// perl code that only reads and prints: no way to run a program, open,
// write or remove a file, load a module or build code from a string. Only
// then are its strings not rescanned ($_ in `index($_, "a b")` isn't a
// command); any other perl code is read as before.
const PERL_REACH_RE = /\$\^|ARGV|system|exec|`|\bqx|readpipe|open|pipe|fork|eval|\bdo\b|require|\buse\b|\bno\b|syscall|ENV|(?<!&)&(?!&)|->|\bcan\b|CORE|dump|\bsub\b|glob|<|BEGIN|END|kill|unlink|rename|mkdir|rmdir|chmod|chown|link|truncate|utime|socket|connect|dbm|sysopen|syswrite|select|binmode|\{\s*\$|\bwrite\b|::|[^\w\s][msixpodualngcr]*e[msixpodualngcre]*(?!\w)/
function readPerl(words, text) {
  const code = []
  for (let k = 1; k < words.length; k++) {
    const w = words[k]
    if (/^-[nlpa0-9]*[eE]$/.test(w)) { code.push(text(k + 1)); k++; continue }
    if (/^-[nlpa0-9]+$/.test(w) || /^-F./.test(w)) continue
    if (w.startsWith('-')) return null
  }
  if (!code.length || code.includes(null) || code.some((c) => PERL_REACH_RE.test(c))) return null
  return { tool: 'perl', verdict: 'plain' }
}

// Config from the environment (GIT_CONFIG_COUNT/KEY_n/VALUE_n,
// GIT_CONFIG_GLOBAL, …) can point a push at main or alias one, and the
// guard can't read it (yoda's must 3).
function gitConfigEnv(seg, ctx) {
  const w = seg.words.find((x) => /^GIT_CONFIG\w*=/.test(x))
  return w ? prodCall(ctx, ask(ctx, `${w.split('=')[0]} gives git config the guard can't read, which may point a push at main: ${seg.words.join(' ')}`)) : null
}

// The strictest answer wins. An allow (only `done`, run as the whole command)
// survives only when nothing else has a say.
function strictest(results) {
  const deny = results.find((r) => r?.decision === 'deny')
  const ask = results.find((r) => r?.decision === 'ask')
  const allow = results.find((r) => r?.decision === 'allow')
  return deny ?? ask ?? (allow && results.every((r) => r === null || r.decision === 'allow') ? allow : null)
}

// ---------------------------------------------------------------- the guard's own files

// The frozen set (FROZEN in chain-arm.mjs, yoda's must 1): the guard, its
// wiring, the production scripts, check.sh, CI and the texts yoda and ranjit
// follow. An edit to any of them changes what full auto lets through, so a
// person decides, never the permission rules or Auto mode's classifier
// (should (c), 2.12.2). One list, so the paths asked about here, the hash a
// chain is tapped with and a chained release's exclusions can't drift apart.
const PROTECTED_RE = FROZEN_RE
const namesIn = (dir) => FROZEN.filter((p) => p.slice(0, p.replace(/\/$/, '').lastIndexOf('/') + 1) === dir).map((p) => basename(p))
const CLAUDE_NAMES = namesIn('.claude/')
const SCRIPTS_NAMES = namesIn('scripts/')
// Interpreter code naming one: a folder by its path, a file by its name.
const textRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PROTECTED_TEXT_RE = new RegExp([
  ...FROZEN.map((p) => (p.endsWith('/') ? `${textRe(p.slice(0, -1))}\\b` : `\\b${textRe(basename(p))}\\b`)),
  ...PLUGIN_DIRS.map((d) => `${textRe(d)}(?![^/\\s'"\`])`),
].join('|'), 'i')
// The plugin's folder or anything in it, by its absolute path (the disk
// ignores case, so the match does too).
const inPluginDir = (p) => PLUGIN_DIRS.some((d) => p.toLowerCase() === d.toLowerCase() || p.toLowerCase().startsWith(`${d.toLowerCase()}/`))
// Each entry's parts, for a glob anywhere in a path (`.claude/agents/y*.md`).
const FROZEN_PARTS = FROZEN.map((p) => ({ parts: p.replace(/\/$/, '').split('/'), folder: p.endsWith('/') }))

// The repo's git config can send a push to main (remote.origin.push) or
// alias one, so it's written only through a person (yoda's must 3).
// The global config does the same for every repo (must B, review 4).
const GIT_CONFIG_FILE_RE = /(?:^|\/)(?:\.git\/(?:worktrees\/[^/]+\/)?config(?:\.worktree)?|\.gitconfig|\.config\/git\/config)$/i

export function namesProtected(word) {
  const p = normalize(String(word ?? '')).replace(/\/+$/, '')
  if (!p || p === '.') return false
  if (PROTECTED_RE.test(p) || GIT_CONFIG_FILE_RE.test(p)) return true
  if (inPluginDir(p)) return true
  // Globs, like the marker's: a name that could match, in a folder that could
  // be .claude or scripts (or is itself a glob). `rm dist/*.json` still passes.
  const dir = p.slice(0, p.lastIndexOf('/') + 1)
  const globDir = /[*?[{]/.test(dir)
  if ((globDir || /(?:^|\/)\.c[^/]*\/$/i.test(dir)) && globNames(p, CLAUDE_NAMES)) return true
  if ((globDir || /(?:^|\/)s[^/]*\/$/i.test(dir)) && globNames(p, SCRIPTS_NAMES)) return true
  return /[*?[{]/.test(p) && globsFrozen(p.split('/'))
}

// Whether a globbed path could name an entry of the set: some run of its
// parts matches the entry's parts one by one, ending at the path's end (or
// anywhere, for a folder, whose files are inside it). A glob matches a
// dot-name only when it starts with a dot, as in the shell: `rm -rf dist/*`
// can't reach .github.
function globsFrozen(parts) {
  const partMatches = (part, name) => part.toLowerCase() === name.toLowerCase() ||
    (globNames(part, [name]) && (!name.startsWith('.') || part.startsWith('.')))
  return FROZEN_PARTS.some(({ parts: entry, folder }) => {
    for (let start = 0; start + entry.length <= parts.length; start++) {
      if (!folder && start + entry.length !== parts.length) continue
      if (entry.every((name, i) => partMatches(parts[start + i], name))) return true
    }
    return false
  })
}

// Commands whose file arguments are all written (or removed).
const WRITES_EACH = new Set(['mv', 'rm', 'tee', 'touch', 'truncate', 'unlink', 'shred', 'chmod', 'chflags'])
// Commands that write only their last argument, or into it when it's a folder.
const WRITES_LAST = new Set(['cp', 'ln', 'rsync', 'ditto', 'install', 'scp'])
const GIT_WRITES = new Set(['checkout', 'restore', 'apply', 'mv', 'rm', 'am'])

function protectedWrite(seg, ctx) {
  if (seg.subshell) return null
  const where = seg.where ?? { dir: ctx.cwd, built: false }
  const prot = (w) => protectedAt(w, where, ctx)
  let target = seg.writes.find(prot)
  const words = stripPrefix(seg.words)
  if (!target && words.length) {
    const cmd = basename(words[0]).toLowerCase()
    const rest = words.slice(1)
    const args = rest.filter((w) => !w.startsWith('-'))
    // A link to a protected file is a second name for it: `ln -s .claude/hooks h`
    // or a hard link (ln, link, cp -l), then a write through that name (must 4).
    const links = cmd === 'ln' || cmd === 'link' || (cmd === 'cp' && rest.some((w) => /^-[a-zA-Z]*l/.test(w) || w === '--link'))
    const source = links && (args.length === 1 ? args : args.slice(0, -1)).find(prot)
    if (source) {
      target = `a link to ${source}`
    } else if (WRITES_EACH.has(cmd) || (['sed', 'perl'].includes(cmd) && rest.some((w) => /^-[a-z0-9]*i/i.test(w) || w.startsWith('--in-place')))) {
      target = args.find(prot)
      // perl -i runs its code as well (`-0pi` too, 2.12.3), unless the code
      // is plain substitutions, which edit only the files named.
      if (!target && cmd === 'perl' && !perlSubstitutes(rest)) target = interpreterWrites(cmd, rest, seg, prot)
    } else if (WRITES_LAST.has(cmd)) {
      const dest = args.at(-1)
      // `cp x .claude/` writes .claude/x: protected when x has a protected name.
      const into = dest && /^(?:.*\/)?(?:\.claude|scripts)\/?$/i.test(dest) && args.slice(0, -1).some((s) => prot(`${dest.replace(/\/?$/, '/')}${basename(s)}`))
      if (dest && (prot(dest) || into)) target = dest
    } else if (cmd === 'find') {
      target = findWrites(rest, prot)
    } else if (cmd === 'dd') {
      target = args.map((w) => w.replace(/^of=/, '')).find((w, i) => args[i].startsWith('of=') && prot(w))
    } else if (cmd === 'git') {
      let at = 0
      while (at < rest.length && rest[at].startsWith('-')) at += GIT_VALUE_OPTS.has(rest[at]) ? 2 : 1
      if (GIT_WRITES.has(rest[at])) target = rest.slice(at + 1).find(prot)
    } else if (INTERPRETERS.has(cmd) && (textTool(seg)?.verdict !== 'plain' || textTool(seg).tool === 'awk')) {
      // perl code that only reads writes nothing, whatever it names. awk's
      // program word is checked as before (review round 1: the reading of
      // awk is fail-safe twice over); a file it only reads still passes.
      target = interpreterWrites(cmd, rest, seg, prot)
    }
  }
  if (!target) return null
  const named = target.replace(/^a link to /, '')
  const path = where.dir && !isAbsolute(named) ? join(where.dir, named) : named
  return protectedChange(ctx, `Writes ${target}${where.built && !target.startsWith('/') ? ' (after a cd to a folder built at run time)' : ''}`, path)
}

// find with an action that deletes or writes (review round 1, S3): a start
// path or a -fprint file in the frozen set, a start path above it with no
// name filter, or a filter that could match one of its names.
const FIND_FILTERS = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex'])
const FROZEN_NAMES = [...new Set(FROZEN.map((p) => basename(p.replace(/\/$/, ''))))]
function findWrites(rest, prot) {
  const action = rest.findIndex((w) => /^-(?:delete|fprint0?|fprintf|fls)$/i.test(w))
  if (action < 0) return undefined
  const printTo = rest.filter((w, i) => i > 0 && /^-(?:fprint0?|fprintf|fls)$/i.test(rest[i - 1]))
  const hit = printTo.find(prot)
  if (hit) return hit
  if (!/^-delete$/i.test(rest[action]) && !rest.some((w, i) => /^-delete$/i.test(w) && i !== action)) return undefined
  const starts = rest.slice(0, Math.max(0, rest.findIndex((w) => w.startsWith('-') || w === '(' || w === '!'))) || rest
  const filters = rest.filter((w, i) => i > 0 && FIND_FILTERS.has(rest[i - 1].toLowerCase()))
  const above = (w) => { const d = normalize(w).replace(/\/+$/, ''); return d === '.' || FROZEN.some((p) => p.toLowerCase().startsWith(`${d.toLowerCase()}/`)) }
  const named = (v) => FROZEN_NAMES.some((n) => n.toLowerCase() === v.toLowerCase()) || globNames(v, FROZEN_NAMES) || PROTECTED_TEXT_RE.test(v)
  return starts.find((w) => prot(w) || (above(w) && !filters.length)) ?? filters.find(named)
}

// Code given inline or on stdin may write any path it names. A script run by
// name is judged by its other arguments (running the guard to test it is
// fine); awk's first word is its program.
function interpreterWrites(cmd, rest, seg, prot = namesProtected) {
  // Code read whole: the files it writes decide, not every name in it.
  const files = proseCode(seg, cmd, rest)?.files
  if (files) {
    const hit = files.writes.find((p) => targetProtected(p, prot))
    return hit ? `${cmd} code writing ${hit.join('')}` : undefined
  }
  const inline = rest.some((w) => /^-(?:[a-z]*[ecpr]|-eval|-print)$/i.test(w))
  const first = rest.findIndex((w) => !w.startsWith('-'))
  let code
  if (cmd === 'awk' || cmd === 'gawk') code = rest[first] ?? ''
  else if (inline) code = rest.join(' ')
  else code = rest.filter((_, i) => i !== first).join(' ')
  code += '\n' + (seg.heredoc ?? '')
  // Code that runs nothing names a file only outside its prose (2.12.4).
  code = proseCode(seg, cmd, rest)?.bare ?? code
  return PROTECTED_TEXT_RE.test(code) || code.split(/[\s;&|<>()'"=,`]+/).some(namesProtected) ? `${cmd} code naming the guard's files` : undefined
}

// Text in interpreter code (2.12.4). python or node code the guard
// reads whole (-c/-e's word, or a heredoc on stdin) that runs no program and
// copies, moves or links nothing can't run the arm script, so a name in a
// string with a space in it is prose: a skill's or README's line being
// edited, or a check that a doc says it. A name as a string of its own is a
// path and still counts; so does a string something is done to
// (`"a b".split()`) or one that runs code (`{…}` in an f-string or template).
// A marker or log named even in prose passes only in code that writes nothing
// (segmentRules). Code that builds a name in pieces (`'full-' + 'auto.sh'`)
// was never caught by name; this changes nothing there.
const PROSE_INTERPRETERS = new Set(['python', 'python3', 'node'])
// Matched anywhere in the code outside prose, so `posix_spawn`, `execFileSync`
// and a variable called `copy` all count: refusing too much is the safe side.
const RUNS_CODE_RE = /subprocess|system|popen|exec|spawn|fork|eval|__import__|importlib|getattr|setattr|globals|locals|\bvars\b|builtins|__class__|__subclasses__|__dict__|Function|constructor|Reflect|globalThis|child_process|worker_threads|\bcluster\b|\bvm\b|ctypes|cffi|\bpty\b|shutil|copy|\bcp(?:Sync)?\s*\(|rename|symlink|link|chmod|chown|utime|multiprocessing|asyncio|socket|urllib|requests|http|fetch|dlopen|binding|webbrowser|os\s*\.\s*replace|\bimport\s*\(|\brequire\s*\((?!\s*(['"])[\w:/.-]+\1\s*\))/i
const WRITES_CODE_RE = /write|append|unlink|remove|rmdir|mkdir|truncate|open|stream|dump|save|\bfd\b|\brm/i

// The code, prose taken out, when the call is plain enough to read: no
// VAR=value or wrapper in front (PYTHONPATH, NODE_OPTIONS load other code), no
// flag with a value glued on (--require=x), no script file.
function proseCode(seg, cmd, rest) {
  if (seg.subshell || !PROSE_INTERPRETERS.has(cmd) || commandName(seg.words[0] ?? '') !== cmd || rest.some((w) => /^-[^=]*=/.test(w))) return null
  const flag = cmd === 'node' ? /^(?:-e|--eval|-p|--print)$/ : /^-c$/
  const at = rest.findIndex((w) => !w.startsWith('-') || flag.test(w))
  let word = null
  let code
  if (at >= 0 && flag.test(rest[at]) && rest[at + 1] !== undefined) {
    word = rest[at + 1]
    code = `${word}\n${seg.heredoc ?? ''}`
  } else if (at < 0 && seg.heredoc !== undefined) {
    code = seg.heredoc // `python3 - <<'EOF'`: the heredoc is the code
  } else return null
  const bare = withoutProse(code, cmd)
  if (RUNS_CODE_RE.test(bare) || !onlyTextCalls(bare, cmd)) return null
  return {
    word,
    codeBare: word === null ? '' : withoutProse(word, cmd),
    // The call's other words (argv may name a file too) and the code.
    bare: `${seg.words.filter((w) => w !== word).join(' ')}\n${bare}`,
    text: `${seg.words.join(' ')}\n${seg.heredoc ?? ''}`,
    writes: WRITES_CODE_RE.test(bare),
    files: codeFiles(code, cmd),
  }
}

// What code with its prose blanked may call (2.12.4 review, M1). No blocklist
// can name every call that runs a string (pdb.run, cProfile.run, timeit,
// code.InteractiveInterpreter().runsource, pickle.loads, module._compile), so
// every call must be a text or file idiom from here, and python imports only
// re, json and sys. `bare` is a name called on its own, `method` one called
// on anything, `qualified` one called on that module only. Anything else is
// read the strict way, as before 2.12.4.
const PROSE_CALLS = {
  python: {
    // 2.13.6.1: the pure builtins and str/list/dict/re.Match methods a
    // script that edits text uses (m.group(1), sorted(…), d.items()).
    bare: new Set(['open', 'print', 'len', 'sorted', 'set', 'list', 'dict', 'str', 'int', 'float', 'range', 'enumerate', 'zip', 'min', 'max',
      'sum', 'any', 'all', 'abs', 'round', 'reversed', 'tuple', 'bool', 'repr', 'isinstance', 'map', 'filter']),
    method: new Set(['read', 'write', 'replace', 'join', 'split', 'strip', 'startswith', 'endswith', 'format', 'group', 'groups', 'sub', 'findall',
      'finditer', 'lower', 'upper', 'count', 'find', 'rfind', 'index', 'rstrip', 'lstrip', 'splitlines', 'items', 'keys', 'values', 'get',
      'append', 'extend', 'insert', 'pop', 'sort', 'update', 'add', 'setdefault', 'title', 'partition', 'rpartition', 'ljust', 'rjust', 'zfill',
      'isdigit', 'isalpha', 'isspace', 'encode', 'decode']),
    qualified: new Set(['re.sub', 're.match', 're.search', 're.compile', 're.findall', 're.finditer', 're.split', 're.escape', 're.fullmatch',
      'json.load', 'json.loads', 'json.dump', 'json.dumps', 'sys.exit']),
    // Words before a ( that aren't calls.
    keywords: new Set(['if', 'elif', 'while', 'for', 'in', 'not', 'and', 'or', 'is', 'return', 'assert', 'else', 'with', 'except', 'yield', 'lambda']),
  },
  node: {
    bare: new Set(['require', 'Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'Set', 'Map', 'Array', 'RegExp']),
    method: new Set(['readFileSync', 'writeFileSync', 'replace', 'includes', 'indexOf', 'split', 'join', 'trim', 'startsWith', 'endsWith', 'write',
      'filter', 'map', 'forEach', 'some', 'every', 'find', 'findIndex', 'reduce', 'slice', 'substring', 'test', 'match', 'matchAll', 'toLowerCase',
      'toUpperCase', 'padStart', 'padEnd', 'trimStart', 'trimEnd', 'sort', 'reverse', 'concat', 'push', 'entries', 'values', 'keys', 'has', 'get',
      'set', 'add', 'flat', 'flatMap', 'repeat', 'at', 'lastIndexOf', 'localeCompare', 'toFixed', 'toString', 'replaceAll']),
    qualified: new Set(['JSON.parse', 'JSON.stringify', 'console.log', 'console.error', 'process.exit', 'Object.keys', 'Object.entries', 'Object.values',
      'Math.max', 'Math.min', 'Math.round', 'Math.floor', 'Math.ceil', 'Array.isArray', 'Array.from']),
    keywords: new Set(['if', 'while', 'for', 'switch', 'catch', 'return', 'typeof', 'in', 'of', 'function']),
  },
}
// What reaches other code without a call of its own name: a python import
// other than re/json/sys (import pickle as json), a decorator, a dunder
// (__self__, __builtins__), sys.modules; in node, a require of anything but
// fs, module (its _compile), process beyond its streams, a tagged template.
const PY_IMPORT_RE = /(^|[\n;])[ \t]*import[ \t]+(?:re|json|sys)(?:[ \t]*,[ \t]*(?:re|json|sys))*[ \t]*(?=$|[\n;])/g
const PY_REACH_RE = /\bimport\b|\bfrom\b|(?:^|\n)\s*@|__|\bsys\b(?!\s*\.\s*(?:argv|stdin|stdout|stderr|exit)\b)|\b(?:breakpoint|help)\b|(?<!\.)\bcompile\b/
const NODE_REACH_RE = /\bimport\b|__|\bmodule\b|\bprocess\b(?!\s*\.\s*(?:argv|stdin|stdout|stderr|exit)\b)|\brequire\b(?!\s*\(\s*(['"])(?:(?:node:)?fs|[\w./-]+\.json)\1\s*\))|[\w$)\]]\s*(?:`|"")/

function onlyTextCalls(code, cmd) {
  const py = cmd.startsWith('python')
  // python's calls are read with every plain string emptied: a ( or an
  // `import` in a regex or a format string is text (2.13.6.1); f-strings run
  // code in their braces, so they stay. node's are read as before: its regex
  // literals can hide a quote from a string scanner.
  const bare = py ? blankStrings(code) : code
  const calls = PROSE_CALLS[py ? 'python' : 'node']
  // A function the code defines itself is called by name; its body is read
  // here like the rest (2.13.6.1).
  const own = new Set([...bare.matchAll(py ? /\bdef\s+([A-Za-z_]\w*)/g : /\bfunction\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>/g)].map((m) => m[1] ?? m[2]))
  if (py ? PY_REACH_RE.test(bare.replace(PY_IMPORT_RE, '$1')) : NODE_REACH_RE.test(bare)) return false
  const ident = /[\w$]/
  const back = (i) => { while (i >= 0 && /\s/.test(bare[i])) i--; return i }
  const word = (end) => { let s = end; while (s > 0 && ident.test(bare[s - 1])) s--; return [bare.slice(s, end + 1), s - 1] }
  for (let at = bare.indexOf('('); at >= 0; at = bare.indexOf('(', at + 1)) {
    const i = back(at - 1)
    // A call of what a call, index or string gave: nothing to name, so no.
    if (i >= 0 && /[)\]'"`]/.test(bare[i])) return false
    // Grouping, an argument list's own parens, or a tuple.
    if (i < 0 || !ident.test(bare[i])) continue
    const [name, before] = word(i)
    const dot = back(before)
    if (dot < 0 || bare[dot] !== '.') {
      if (!calls.bare.has(name) && !calls.keywords.has(name) && !own.has(name)) return false
      continue
    }
    if (calls.method.has(name)) continue
    // module.name, with nothing in front of the module.
    const r = back(dot - 1)
    if (r < 0 || !ident.test(bare[r])) return false
    const [owner, ownerBefore] = word(r)
    const o = back(ownerBefore)
    if ((o >= 0 && bare[o] === '.') || !calls.qualified.has(`${owner}.${name}`)) return false
  }
  return true
}

// The files python or node code read whole opens (2.13.6.1). Code that only
// names a guard file in a string (a plan's text, a check that a doc says it)
// was refused as a write to it, three times in chain 2.13.5.4. In code
// proseCode can read (text idioms only), every file it writes goes through
// python's open(…, 'w'/'a'/'x'/'+') or node's writeFileSync(…), so those
// targets are what decides: each resolved to the string literals it's built
// from, through plain assignments and for loops. Returns { writes, reads },
// each a list of targets (a target is its string pieces), or null when a
// target can't be resolved or open/writeFileSync is passed around as a value;
// the code is then read the strict way, as before.
function codeFiles(code, cmd) {
  const py = cmd.startsWith('python')
  const toks = codeTokens(code, py)
  if (!toks) return null
  const defs = new Map()
  const define = (name, rhs) => { if (!defs.has(name)) defs.set(name, []); defs.get(name).push(rhs) }
  const isP = (t, v) => t?.t === 'p' && t.v === v
  const closer = { '(': ')', '[': ']', '{': '}' }
  // Tokens from k up to the end of the statement or expression at depth 0.
  const until = (k, stop) => {
    const out = []
    let depth = 0
    for (; k < toks.length; k++) {
      const t = toks[k]
      if (t.t === 'p' && closer[t.v]) depth++
      else if (t.t === 'p' && /^[)\]}]$/.test(t.v)) { if (depth === 0) break; depth-- }
      if (depth === 0 && stop(t)) break
      out.push(t)
    }
    return out
  }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.t === 'p' && ['=', '+=', ':='].includes(t.v)) {
      // The left side since the statement began; one name takes the value,
      // anything else (a, b = …, x[i] = …) leaves its names unknown.
      let s = k - 1
      while (s >= 0 && toks[s].t !== 'nl' && !isP(toks[s], ';') && !isP(toks[s], '{') && !isP(toks[s], '(') && !isP(toks[s], ',')) s--
      const lhs = toks.slice(s + 1, k).filter((x) => !(x.t === 'id' && /^(?:const|let|var)$/.test(x.v)))
      const rhs = until(k + 1, (x) => x.t === 'nl' || isP(x, ';') || (!py && isP(x, ',')))
      if (lhs.length === 1 && lhs[0].t === 'id' && t.v !== ':=') define(lhs[0].v, rhs)
      else for (const x of lhs) if (x.t === 'id') define(x.v, [{ t: '?' }])
      continue
    }
    if (t.t === 'id' && t.v === 'for') {
      // for NAME in ITERABLE (python, comprehensions too) / for (const NAME of|in ITERABLE)
      let j = k + 1
      if (isP(toks[j], '(')) j++
      if (toks[j]?.t === 'id' && /^(?:const|let|var)$/.test(toks[j].v)) j++
      const names = []
      while (j < toks.length && !(toks[j].t === 'id' && (toks[j].v === 'in' || toks[j].v === 'of'))) { if (toks[j].t === 'id') names.push(toks[j].v); j++ }
      const it = until(j + 1, (x) => isP(x, ':') || x.t === 'nl' || (x.t === 'id' && (x.v === 'if' || x.v === 'for')))
      for (const n of names) define(n, names.length === 1 ? it : [{ t: '?' }])
    }
  }
  const resolve = (expr, seen = new Set(), depth = 0) => {
    if (depth > 8 || !expr.length) return null
    const out = []
    for (const t of expr) {
      if (t.t === 'str') {
        if (t.esc) return null
        if (!t.interp) { out.push(t.v); continue }
        // An f-string or template: its literal parts, and plain names inside.
        const parts = t.v.split(py ? /\{([^{}]*)\}/ : /\$\{([^{}]*)\}/)
        for (let n = 0; n < parts.length; n++) {
          if (n % 2 === 0) { out.push(parts[n]); continue }
          if (!/^\s*[A-Za-z_$][\w$]*\s*$/.test(parts[n])) return null
          const r = resolve([{ t: 'id', v: parts[n].trim() }], seen, depth + 1)
          if (!r) return null
          out.push(...r)
        }
        continue
      }
      if (t.t === 'p' && ['+', '(', ')', '[', ']', ','].includes(t.v)) continue
      if (t.t !== 'id' || seen.has(t.v) || !defs.has(t.v)) return null
      for (const d of defs.get(t.v)) {
        const r = resolve(d, new Set([...seen, t.v]), depth + 1)
        if (!r) return null
        out.push(...r)
      }
    }
    return out
  }
  const writes = []
  const reads = []
  let readsUnknown = false
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.t !== 'id') continue
    const open = py && t.v === 'open'
    const node = !py && (t.v === 'writeFileSync' || t.v === 'readFileSync')
    if (!open && !node) continue
    // Passed around as a value (map(open, …), const w = fs.writeFileSync): not followed.
    if (!isP(toks[k + 1], '(') || (open && isP(toks[k - 1], '.'))) return null
    const args = []
    let cur = []
    let depth = 0
    for (let j = k + 2; j < toks.length; j++) {
      const x = toks[j]
      if (x.t === 'p' && closer[x.v]) depth++
      if (x.t === 'p' && /^[)\]}]$/.test(x.v)) { if (depth === 0) break; depth-- }
      if (depth === 0 && isP(x, ',')) { args.push(cur); cur = []; continue }
      if (x.t !== 'nl') cur.push(x)
    }
    args.push(cur)
    const keyword = (a) => a[0]?.t === 'id' && isP(a[1], '=')
    // Unpacked arguments can carry any path and mode (review round 1, M5).
    if (args.some((a) => isP(a[0], '*') || isP(a[0], '**'))) return null
    const positional = args.filter((a) => a.length && !keyword(a))
    const file = args.find((a) => keyword(a) && a[0].v === 'file')?.slice(2)
    if (file && !positional.length) positional.push(file)
    let write = t.v === 'writeFileSync'
    if (open) {
      const mode = args.find((a) => keyword(a) && a[0].v === 'mode')?.slice(2) ?? positional[1]
      write = mode !== undefined && !(mode.length === 1 && mode[0].t === 'str' && !mode[0].interp && !/[wax+]/.test(mode[0].v))
    }
    const target = positional[0] ? resolve(positional[0]) : null
    // A read from somewhere unknown matters only to code that also writes
    // (it could copy the arm script).
    if (!target && write) return null
    if (!target) readsUnknown = true
    else (write ? writes : reads).push(target)
  }
  return writes.length && readsUnknown ? null : { writes, reads }
}

// Tokens of python or node code: names, strings (with their prefix's
// meaning), punctuation and line ends. Comments and node regex literals go.
function codeTokens(code, py) {
  const toks = []
  const last = () => { for (let k = toks.length - 1; k >= 0; k--) if (toks[k].t !== 'nl') return toks[k]; return null }
  for (let i = 0; i < code.length;) {
    const c = code[i]
    if (c === '\n') { toks.push({ t: 'nl' }); i++; continue }
    if (/\s/.test(c)) { i++; continue }
    if ((py && c === '#') || (!py && code.startsWith('//', i))) { while (i < code.length && code[i] !== '\n') i++; continue }
    if (!py && code.startsWith('/*', i)) { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 2; continue }
    const prefix = py ? /^[rRbBuUfF]{1,2}(?=['"])/.exec(code.slice(i))?.[0].toLowerCase() ?? '' : ''
    const q0 = code[i + prefix.length]
    if (q0 === "'" || q0 === '"' || (!py && q0 === '`')) {
      i += prefix.length
      const q = py && code.startsWith(q0.repeat(3), i) ? q0.repeat(3) : q0
      const interp = q0 === '`' || prefix.includes('f')
      const end = stringEnd(code, i, py, interp)
      // A string that never closes: what follows can't be told apart.
      if (end < 0) return null
      const v = code.slice(i + q.length, end - q.length)
      toks.push({ t: 'str', v, interp, esc: v.includes('\\') })
      i = end
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < code.length && /[\w$]/.test(code[j])) j++
      toks.push({ t: 'id', v: code.slice(i, j) })
      i = j
      continue
    }
    if (/\d/.test(c)) {
      let j = i
      while (j < code.length && /[\w.]/.test(code[j])) j++
      toks.push({ t: 'num' })
      i = j
      continue
    }
    if (!py && c === '/') {
      const p = last()
      // After `a++` or `a--` a slash divides.
      const postfix = toks.length >= 2 && toks.at(-1).t === 'p' && toks.at(-2).t === 'p' && /^[+-]$/.test(p?.v) && toks.at(-2).v === p.v
      if (!postfix && (!p || (p.t === 'p' && !/^[)\]}]$/.test(p.v)) || (p.t === 'id' && /^(?:return|typeof|in|of|case|do|else|void|delete|new)$/.test(p.v)))) {
        let j = i + 1
        while (j < code.length && code[j] !== '/' && code[j] !== '\n') {
          if (code[j] === '\\') j++
          else if (code[j] === '[') { j++; while (j < code.length && code[j] !== ']' && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1 }
          j++
        }
        while (/[a-z]/.test(code[j + 1] ?? '')) j++
        toks.push({ t: 're' })
        i = j + 1
        continue
      }
    }
    const two = code.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '=>', '+=', '-=', ':=', '**', '&&', '||', '?.', '//'].includes(two)) { toks.push({ t: 'p', v: two }); i += 2; continue }
    toks.push({ t: 'p', v: c })
    i++
  }
  return toks
}

// Whether a target's pieces, or all of them joined, name a guard file.
function targetProtected(pieces, prot) {
  return [...pieces, pieces.join('')].some((p) => PROTECTED_TEXT_RE.test(p) || p.split(/[\s;&|<>()'"=,`]+/).some((w) => w && prot(w)))
}

// Every string that runs no code of its own, emptied to "" (f-strings and
// templates with ${…} stay as they are).
function blankStrings(code) {
  let out = ''
  for (let i = 0; i < code.length;) {
    if (code[i] === '#') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    const prefix = !/\w/.test(code[i - 1] ?? '') ? /^[rRbBuUfF]{1,2}(?=['"])/.exec(code.slice(i))?.[0] ?? '' : ''
    const c = code[i + prefix.length]
    if (c === "'" || c === '"') {
      const f = /f/i.test(prefix)
      const end = stringEnd(code, i + prefix.length, true, f)
      out += f || end < 0 ? code.slice(i, end < 0 ? code.length : end) : `${prefix}""`
      if (end < 0) break
      i = end
      continue
    }
    out += code[i]
    i++
  }
  return out
}

// The index just past the string literal whose quote is at s, or -1 when it
// never closes. An f-string's or template's {…} / ${…} is code: strings in
// it are skipped whole, so a quote there doesn't end the outer string
// (python 3.12's f"{"'"}", a template's ${'`'}).
function stringEnd(code, s, py, interp) {
  const c = code[s]
  const q = py && code.startsWith(c.repeat(3), s) ? c.repeat(3) : c
  let j = s + q.length
  while (j < code.length && !code.startsWith(q, j)) {
    if (code[j] === '\\') { j += 2; continue }
    const open = interp && (py ? code[j] === '{' && code[j + 1] !== '{' : code[j] === '$' && code[j + 1] === '{')
    if (interp && py && code[j] === '{' && code[j + 1] === '{') { j += 2; continue }
    if (open) {
      j += py ? 1 : 2
      for (let depth = 1; j < code.length && depth;) {
        const d = code[j]
        if (d === "'" || d === '"' || (!py && d === '`')) {
          const e = stringEnd(code, j, py, !py && d === '`')
          if (e < 0) return -1
          j = e
          continue
        }
        if (d === '{') depth++
        else if (d === '}') depth--
        j++
      }
      continue
    }
    j++
  }
  return j >= code.length ? -1 : j + q.length
}

// Comments go, and a string with a space inside it becomes "" when it's
// prose. A string that doesn't close on its line, or at all, stays as code.
function withoutProse(code, cmd) {
  const py = cmd.startsWith('python')
  let out = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]
    if ((py && c === '#') || (!py && code.startsWith('//', i))) {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    if (!py && code.startsWith('/*', i)) {
      const e = code.indexOf('*/', i + 2)
      i = e < 0 ? code.length : e + 2
      continue
    }
    if (c === "'" || c === '"' || (!py && c === '`')) {
      const q = py && code.startsWith(c.repeat(3), i) ? c.repeat(3) : c
      let j = i + q.length
      while (j < code.length && !code.startsWith(q, j)) j += code[j] === '\\' ? 2 : 1
      const body = code.slice(i + q.length, j)
      const closed = j < code.length && (q.length === 3 || c === '`' || !body.includes('\n'))
      const end = Math.min(j + q.length, code.length)
      const prose = closed && /\S\s+\S/.test(body) && !/[{}]/.test(body) && !/^\s*[.[]/.test(code.slice(end))
      out += prose ? '""' : code.slice(i, end)
      i = end
      continue
    }
    out += c
    i++
  }
  return out
}

// Whether every -e of a perl -i call is plain s/…/…/ substitutions with no
// /e (which would run the replacement as code): then the code only rewrites
// the files named, and a frozen path in its text is text (2.12.3: the
// wrap-up's plan edit quoted `.github/pull_request_template.md`).
function perlSubstitutes(rest) {
  const codes = rest.filter((_, i) => i > 0 && /^-[a-z0-9]*e$/i.test(rest[i - 1]))
  if (!codes.length) return false
  const one = /^\s*s([^\w\s{[(<])(?:\\[\s\S]|(?!\1)[\s\S])*\1(?:\\[\s\S]|(?!\1)[\s\S])*\1([a-z]*)\s*(?:;|$)/
  return codes.every((code) => {
    let left = code
    while (left.trim()) {
      const m = one.exec(left)
      if (!m || m[2].includes('e')) return false
      left = left.slice(m[0].length)
    }
    return true
  })
}

// Whether a path the call writes is one of the guard's files, however it's
// reached (yoda's must 4): by its name, from the folder the call has cd'd
// into, through a symlinked folder (the real path of its parent), or as a
// hard link (the same inode). After a cd built at run time, any relative
// path might be one.
function protectedAt(word, where, ctx) {
  const w = String(word ?? '')
  if (namesProtected(w)) return true
  if (!w || w.startsWith('/dev/')) return false
  const relative = !w.startsWith('/')
  if (relative && where?.built) return true
  if (relative && where?.dir && namesProtected(join(where.dir, w))) return true
  if (/[$`*?[{]/.test(w)) return false
  const abs = relative ? (where?.dir?.startsWith('/') ? resolve(where.dir, w) : null) : w
  return abs !== null && onDiskProtected(abs, ctx?.root ?? REPO_ROOT)
}

function onDiskProtected(abs, root) {
  let real
  try {
    real = realpathSync(abs)
  } catch {
    try { real = join(realpathSync(dirname(abs)), basename(abs)) } catch { return false }
  }
  if (real !== abs && namesProtected(real)) return true
  let st
  try { st = statSync(abs) } catch { return false }
  return st.isFile() && st.nlink > 1 && protectedInodes(root).has(`${st.dev}:${st.ino}`)
}

// The inodes of the guard's files in this checkout, read only when a target
// has more than one name, which is rare.
const inodeCache = new Map()
function protectedInodes(root) {
  if (inodeCache.has(root)) return inodeCache.get(root)
  const seen = new Set()
  const add = (path) => {
    try {
      const st = statSync(path)
      if (st.isFile()) seen.add(`${st.dev}:${st.ino}`)
      else if (st.isDirectory()) for (const name of readdirSync(path)) add(join(path, name))
    } catch { /* missing: nothing to link to */ }
  }
  for (const p of FROZEN) add(join(root, p))
  for (const d of PLUGIN_DIRS) add(d)
  add(join(root, '.git', 'config'))
  add(join(homedir(), '.gitconfig'))
  add(join(homedir(), '.config', 'git', 'config'))
  inodeCache.set(root, seen)
  return seen
}

// Asks a person; refused outright while full auto is armed, since nobody is
// watching then and the marker's commands run what's on disk.
// The ask names the file and what it is (yoda's must E, review 4): one
// reason for every file read wrong for yoda.md and invited a quick Yes.
function protectedChange(ctx, what, path) {
  ctx.production = true
  const role = roleOf(path)
  // The release marker or the chain's: a chain's tap covers the frozen set's
  // hash, so it doesn't change under either.
  if (anyMarker(ctx)) return deny(`${what}: ${role ?? "a file in the frozen set (the guard, its settings, the production scripts, CI or ranjit's texts)"}. Nothing there changes while full auto is armed. A person disarms first (scripts/full-auto.sh disarm).`)
  return ask(ctx, `${what}: ${role ?? "this may change a file in the frozen set (the guard, its settings, the production scripts, CI or ranjit's texts)"}. A Yes changes what full auto lets through, so a person decides.`)
}

// What each frozen entry is, for the ask. An entry step 2 adds without a
// line here still gets its path named.
const ROLES = {
  '.claude/hooks/': "the guard's hooks (this guard, Hank, the arm and production-step checks)",
  '.claude/settings.json': 'the hook wiring and the permission rules',
  '.claude/settings.local.json': 'the local permission rules',
  '.claude/kit.json': "the project's values the guard trusts (dev ref, deployer, Keychain items)",
  'scripts/full-auto.sh': 'the script that arms full auto',
  'scripts/prod-db.sh': "production database's only write path",
  'scripts/check.sh': 'the checks CI and the drive trust',
  '.github/': 'CI and the PR template',
  '.claude/agents/yoda.md': "yoda's instructions",
  '.claude/agents/ranjit.md': "ranjit's instructions (the deployer)",
}
const ENTRY_RES = FROZEN.map((p) => [p, new RegExp(`(?:^|/)${textRe(p.replace(/\/$/, ''))}${p.endsWith('/') ? '(?:/|$)' : '$'}`, 'i')])

function roleOf(path) {
  const p = normalize(String(path ?? '')).replace(/\/+$/, '')
  if (!p || p === '.') return null
  if (GIT_CONFIG_FILE_RE.test(p)) return 'git config, which can point a push at main or make git run a command'
  const hit = ENTRY_RES.find(([, re]) => re.test(p))
  if (!hit) return null
  return `\`${hit[0]}\` is ${ROLES[hit[0]] ?? 'a file'} in the frozen set`
}

// The arm script's name anywhere in a call can reach it through a runner the
// guard doesn't follow (find -exec, xargs -I{}, script, caffeinate, arch,
// env -S, a git alias), so a call that names it is refused unless it's one of
// these (must 3, round 2). The list is short on purpose; don't widen it.
const SCRIPT_READERS = new Set(['cat', 'less', 'head', 'tail', 'grep', 'wc', 'ls'])
const SCRIPT_GIT_READS = new Set(['add', 'diff', 'log', 'show', 'blame'])
const SCRIPT_DENIED = 'scripts/full-auto.sh arms production, so a call names it only to run it on its own (scripts/full-auto.sh arm <version> | arm-chain <version> … | done <version> | preview <version> | check-plan <version> <plan file> | disarm, as the whole command), to read it (cat, less, head, tail, grep, wc, ls, bash -n) or in git add/diff/log/show/blame.'

// Backslashes and quotes go first: `full\-auto.sh` is still the name to find
// -name, and to a shell that reads the word again. A glob names the script
// only in a folder that could be scripts/ (S1, round 3): `rm -rf dist/*`,
// `du -sh *` from the repo root or the `*` in a SQL string can't reach it.
// `patterns` is set for a segment whose program matches globs itself
// (find -name 'fu*'), where a bare glob may be matched in any folder.
function mentionsScript(word, where, patterns = true) {
  const w = String(word ?? '').replace(/[\\'"]/g, '')
  if (/full-auto\.sh/i.test(w)) return true
  // A word with spaces is text or a command line another shell reads: its
  // bare globs expand where that shell runs.
  const bare = /\s/.test(w) ? false : patterns
  return w.split(/[\s;&|<>()=!`:,]+/).some((t) => scriptGlob(t, where, bare))
}

// Programs that match a glob they're given against folders of their own.
const PATTERN_TAKERS = new Set(['find', 'fd', 'locate', 'mdfind', 'rsync', 'tar', 'zip', 'unzip', 'git'])
const takesPatterns = (seg) => seg.words.some((w) => PATTERN_TAKERS.has(commandName(w)))

// Whether a glob could match the arm script: its last part could be
// full-auto.sh and its folder could be scripts/. A bare glob expands in the
// folder the command runs in (where.dir), unless it's a pattern for the
// program; interpreter code (where.code) isn't expanded by a shell, so a
// bare glob there is arithmetic or a regex.
function scriptGlob(token, where, pattern) {
  if (!globNames(token, SCRIPT_NAMES)) return false
  const t = String(token).replace(/\/+$/, '')
  const cut = t.lastIndexOf('/')
  if (cut < 0) return where?.code ? false : pattern || mayBeScripts('', where)
  return mayBeScripts(t.slice(0, cut) || '/', where)
}

// A folder is scripts/ when its last part is (or globs to) that name; one
// built at run time, or relative to a folder that isn't known, may be.
function mayBeScripts(folder, where) {
  if (/[$`]/.test(folder)) return true
  let path = folder.replace(/^~(?=\/|$)/, homedir())
  if (!isAbsolute(path)) {
    if (where?.built) return true
    path = where?.dir ? join(where.dir, path) : normalize(path || '.')
  }
  const last = basename(normalize(path))
  if (!last || last === '.' || last === '..') return true
  return /[*?[{]/.test(last) ? globNames(last, ['scripts']) : last.toLowerCase() === 'scripts'
}

// A glob in a checkout's root (`rm -rf *`) can reach a folder that holds the
// guard's files, though it names none of them: read from the disk.
function globsCheckout(word, where) {
  const t = String(word).replace(/\/+$/, '')
  const cut = t.lastIndexOf('/')
  const last = t.slice(cut + 1)
  const folder = cut < 0 ? '' : t.slice(0, cut) || '/'
  if (!/[*?[{]/.test(last) || /[$`*?[{]/.test(folder)) return false
  const dir = isAbsolute(folder) ? folder : where?.dir?.startsWith('/') && !where.built ? resolve(where.dir, folder) : null
  if (!dir) return false
  return FROZEN.some((p) => {
    const top = p.split('/')[0]
    return globNames(last, [top]) && (!top.startsWith('.') || last.startsWith('.')) && existsSync(join(dir, p))
  })
}

// Whether a copy's destination lies outside this checkout, so its sources
// are only read (`cp -R .claude/hooks /tmp/mirror/`, S1). Unknown is inside.
function outsideRepo(dest, where, root) {
  if (!dest || /[$`*?[{~]/.test(dest)) return false
  const abs = isAbsolute(dest) ? dest : where?.dir?.startsWith('/') && !where.built ? resolve(where.dir, dest) : null
  if (!abs) return false
  const real = (p) => {
    try { return realpathSync(p) } catch { try { return join(realpathSync(dirname(p)), basename(p)) } catch { return resolve(p) } }
  }
  const within = (p, base) => p === base || p.startsWith(base.replace(/\/$/, '') + '/')
  return !within(real(abs), real(root)) && !within(resolve(abs), resolve(root))
}

// The interpreter check: the literal name, or a word that globs to a marker
// or, with a folder that could be scripts/, to the script. Code isn't
// expanded by a shell, so a bare `*` in it is arithmetic or a regex.
function codeNamesFullAuto(text, where) {
  return /full-auto/i.test(text) || text.split(/[\s;&|<>()'"=]+/).some((w) => scriptGlob(w, { ...where, code: true }, false) || namesMarker(w))
}

// Whether a segment of the call other than this one names full-auto: what
// another segment reads may reach this code on its stdin.
function othersNameFullAuto(seg, ctx) {
  const own = seg.words.join('\0')
  const walk = (src) => parseShell(src).some((s) => (s.subshell ? walk(s.subshell) : s.words.join('\0') !== own && /full-auto/i.test([...s.words, ...s.writes].join(' '))))
  return walk(ctx.visible) ? 'full-auto' : ''
}

// A shell given its script on stdin (a pipe, `<(…)`, a heredoc), or eval,
// source or `sh -c` of a substitution, runs text the guard never reads
// (round 3): a person decides, and none runs while a marker exists.
const SUBSTITUTION_RE = /\$\(|`|<\(/
// A process substitution is a word of its own (2.13.6.1); as a shell's script
// it feeds the shell text the guard never reads, like a pipe.
const PROCESS_SUB_RE = /^[<>]\(/
function fedShell(seg, ctx) {
  if (seg.subshell) return null
  const words = stripPrefix(seg.words)
  if (!words.length) return null
  const cmd = commandName(words[0])
  const rest = words.slice(1)
  let how = null
  if (SHELLS.has(cmd)) {
    const c = rest.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w))
    if (c >= 0) {
      if (SUBSTITUTION_RE.test(rest[c + 1] ?? '')) how = `${cmd} -c runs a substitution's output`
    } else if (shellHeredoc(seg) === null && !rest.some((w) => /^-[a-z]*n[a-z]*$/.test(w) || w === '--version' || w === '--help') &&
      (rest.every((w) => w.startsWith('-')) || shellOptions(rest, false) || PROCESS_SUB_RE.test(rest.find((w) => !w.startsWith('-')) ?? '') || rest.some((w) => /^-[a-z]*s[a-z]*$/.test(w)))) {
      how = `${cmd} reads its script from a pipe or stdin`
    }
  } else if (cmd === 'eval' || cmd === 'source' || cmd === '.') {
    if (rest.some((w) => SUBSTITUTION_RE.test(w)) || (cmd !== 'eval' && rest.length === 0)) how = `${cmd} runs text built at run time`
  }
  if (!how) return null
  if (anyMarker(ctx)) return prodCall(ctx, deny(`${how}, which the guard can't read, so none runs while full auto is armed.`))
  return ask(ctx, `${how}, which the guard can't read, so a person decides: ${seg.words.join(' ')}`)
}

// A shell whose script is a heredoc the guard reads as the shell will:
// quoted (`bash <<'EOF'`) or holding nothing the shell expands, with no
// script file or -c beside it, and no `exec` that could swap the shell's
// stdin for a file mid-script. checkSegment reads that script as a command
// line, as it reads `bash -c`'s (2.14.9.1, B2); anything else still asks.
function shellHeredoc(seg) {
  if (seg.subshell || seg.heredoc === undefined || seg.heredocExpands) return null
  const words = stripPrefix(seg.words)
  if (!SHELLS.has(commandName(words[0] ?? ''))) return null
  if (!shellOptions(words.slice(1), true)) return null
  return /\bexec\b/.test(seg.heredoc) ? null : seg.heredoc
}

// Whether a shell's words are all options: short flags with neither c (runs
// a string) nor n (only reads), and an -o's one argument (`bash -euo
// pipefail <<'EOF'` asked in 2.14.9.1, S4). `named` keeps that argument to
// the options known to change nothing about what runs; without it, any
// -o or -O argument counts (fedShell: `… | bash -o pipefail` reads stdin).
function shellOptions(rest, named) {
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k]
    if (w === '-') continue
    if (!(named ? /^-[a-z]+$/ : /^-[a-zA-Z]+$/).test(w) || /[cn]/.test(w)) return false
    const takes = (w.match(/[oO]/g) ?? []).length
    if (!takes) continue
    if (takes > 1 || rest[k + 1] === undefined) return false
    if (named && !SAFE_SHELL_OPTIONS.has(rest[k + 1])) return false
    k++
  }
  return true
}
const SAFE_SHELL_OPTIONS = new Set(['pipefail', 'errexit', 'nounset'])

// A nested claude could run as another agent or without this guard, so it
// asks in every session (denied while armed, below); its version and help
// pass.
function nestedClaude(seg, ctx) {
  if (seg.subshell) return null
  const words = stripPrefix(seg.words)
  if (!words.length || !claudeCall(words)) return null
  if (words.length === 2 && CLAUDE_INFO.has(words[1])) return null
  return ask(ctx, `A nested claude could run as another agent or without this guard, so a person decides: ${seg.words.join(' ')}`)
}

// three-eyed-raven decides and logs; it writes nothing but its chain log,
// and that only by appending with Edit (round 3). Its shell reads.
const RAVEN = 'three-eyed-raven'
const RAVEN_DENIED = 'three-eyed-raven writes nothing but its chain log (~/.claude/plans/V<x>-chain-log.md), and only appends to it with Edit.'
const RAVEN_GIT_READS = new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'grep', 'shortlog',
  'describe', 'fetch', 'rev-list', 'merge-base', 'for-each-ref', 'name-rev', 'show-ref', 'version', 'help'])
const RAVEN_GH_READS = new Set(['pr view', 'pr list', 'pr diff', 'pr checks', 'pr status', 'issue view', 'issue list', 'issue status', 'run view',
  'run list', 'run watch', 'repo view', 'release view', 'release list', 'workflow view', 'workflow list', 'auth status', 'status'])

function ravenEdit(tool, args, env) {
  const path = normalize(String(args.file_path ?? args.notebook_path ?? ''))
  const plans = join(env.home ?? homedir(), '.claude', 'plans')
  // A link by that name could point anywhere.
  let link = false
  try { link = lstatSync(path).isSymbolicLink() } catch { /* not there yet */ }
  const log = isAbsolute(path) && dirname(path) === plans && /^V[^/]*-chain-log\.md$/.test(basename(path)) && !link
  if (!log || !['Edit', 'Write'].includes(tool)) return deny(RAVEN_DENIED)
  let current = null
  try {
    current = (env.readFile ?? ((f) => readFileSync(f, 'utf8')))(path)
  } catch (err) {
    if (err?.code !== 'ENOENT') return deny(`${RAVEN_DENIED} (The log couldn't be read.)`)
  }
  // Write starts the log; once it exists, only an append.
  if (tool === 'Write') return current === null ? null : deny(RAVEN_DENIED)
  const old = String(args.old_string ?? '')
  const neu = String(args.new_string ?? '')
  const append = !args.replace_all && neu.startsWith(old) &&
    (old === '' || (current !== null && current.endsWith(old) && current.indexOf(old) === current.length - old.length))
  return append ? null : deny(`${RAVEN_DENIED} (This edit changes what is already there.)`)
}

function ravenWrite(seg, ctx) {
  if (ctx.agent !== RAVEN || seg.subshell) return null
  if (seg.writes.some((w) => !w.startsWith('/dev/')) || fedShell(seg, { ...ctx, unattended: false })) return deny(RAVEN_DENIED)
  const words = stripPrefix(seg.words)
  if (!words.length) return null
  const cmd = commandName(words[0])
  const rest = words.slice(1)
  const flags = (re) => rest.some((w) => re.test(w))
  let writes = WRITES_EACH.has(cmd) || WRITES_LAST.has(cmd) || ['mkdir', 'rmdir', 'dd', 'patch', 'link', 'wget'].includes(cmd) ||
    (['sed', 'perl'].includes(cmd) && flags(/^-[a-z]*i/i)) ||
    // Code inline or on stdin; a script run by name is read by its arguments.
    (INTERPRETERS.has(cmd) && (flags(/^-(?:[a-z]*[ecpr]|-eval|-print)$/i) || !rest.some((w) => !w.startsWith('-')) || cmd.endsWith('awk'))) ||
    (HTTP_CLIENTS.has(cmd) && flags(/^-(?:[oOdFT]|-output|-remote-name|-data.*|-form|-upload-file)$|^-X(?!\s*GET$)|^--request/)) ||
    (['npm', 'pnpm', 'yarn', 'bun'].includes(cmd) && ['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'link', 'publish'].includes(rest[0]))
  if (cmd === 'git') {
    let at = 0
    while (at < rest.length && rest[at].startsWith('-')) at += GIT_VALUE_OPTS.has(rest[at]) ? 2 : 1
    const sub = rest[at]
    const more = rest.slice(at + 1)
    const listing = more.every((w) => /^(?:-[avr]+|-vv|--list|--all|--remotes|--show-current|--verbose)$/.test(w))
    writes = sub !== undefined && !(RAVEN_GIT_READS.has(sub) || (['branch', 'remote', 'tag'].includes(sub) && listing) ||
      (['stash', 'worktree'].includes(sub) && more[0] === 'list') ||
      (sub === 'config' && !more.some((w) => CONFIG_WRITE_FLAGS.has(w) || w === '--edit' || w === '-e') && more.filter((w) => !w.startsWith('-')).length < 2) ||
      (sub === 'reflog' && (more.length === 0 || more[0] === 'show')))
  }
  if (cmd === 'gh') {
    const sub = rest.filter((w, i) => !w.startsWith('-') && !['-R', '--repo'].includes(rest[i - 1])).slice(0, 2)
    const api = sub[0] === 'api' && !rest.some((w) => /^-(?:[fF]|-field|-raw-field|-input)(?:=|$)/.test(w) || /^-[fF]./.test(w)) &&
      !rest.some((w, i) => (/^(?:-X|--method)$/.test(w) && !/^(?:GET|HEAD)$/i.test(rest[i + 1] ?? '')) || /^(?:-X|--method=)(?!GET$|HEAD$)./i.test(w))
    writes = !(api || sub[0] === 'search' || RAVEN_GH_READS.has(sub.join(' ')) || RAVEN_GH_READS.has(sub[0]) || rest.every((w) => ['--version', '--help', '-h'].includes(w)))
  }
  return writes ? deny(`${RAVEN_DENIED} Refused: ${seg.words.join(' ')}`) : null
}

// A commit message or PR text is text for its command, never a call.
function isText(cmd, words, i) {
  const prev = words[i - 1] ?? ''
  if (cmd === 'git') return /^-[a-z]*m$/i.test(prev) || prev === '--message' || /^--message=/.test(words[i])
  if (cmd === 'gh') return ['-b', '--body', '-t', '--title'].includes(prev) || /^--(?:body|title)=/.test(words[i])
  return false
}

// Whether a segment naming the script only reads it. Every mention must be
// among the reader's own arguments, never in a VAR=value, a wrapper's words
// or a redirect in front of it.
function readsScript(seg, words, cmd, names, alone = false) {
  const lead = seg.words.length - words.length
  if (seg.words.slice(0, lead).some(names) || seg.writes.some(names)) return false
  const rest = words.slice(1)
  if (SCRIPT_READERS.has(cmd)) return true
  // echo and printf print the name, when nothing else in the call can take
  // it (2.13.6.1; `echo <the script> | xargs rm` would). A redirect of theirs
  // is a renamed copy, refused below.
  if ((cmd === 'echo' || cmd === 'printf') && alone) return true
  if (SHELLS.has(cmd)) {
    // bash -n only parses: every flag before the script, none of them -c.
    const at = rest.findIndex((w) => !w.startsWith('-'))
    const flags = at < 0 ? rest : rest.slice(0, at)
    return flags.some((w) => /^-[a-z]*n[a-z]*$/.test(w)) && !flags.some((w) => /^-[a-z]*c/.test(w))
  }
  if (cmd === 'git') {
    let at = 0
    while (at < rest.length && rest[at].startsWith('-')) at += GIT_VALUE_OPTS.has(rest[at]) ? 2 : 1
    return SCRIPT_GIT_READS.has(rest[at]) && !rest.slice(0, at).some(names)
  }
  return false
}

// The script run by name, or by a shell or source given its path: the only
// form that runs it, and only as the whole command, so what a person
// approves is all that runs.
function runsScript(cmd, words) {
  if (cmd === 'full-auto.sh') return true
  if (!SHELLS.has(cmd) && cmd !== 'source' && cmd !== '.') return false
  const rest = words.slice(1)
  const at = rest.findIndex((w) => !w.startsWith('-'))
  return at >= 0 && basename(rest[at]).toLowerCase() === 'full-auto.sh' && !rest.slice(0, at).some((w) => /^-[a-z]*c/.test(w))
}

// The round 3 rules sit beside the others, and the strictest answer stands.
// In interpreter code a leading `.` or `claude` is code, not a shell running
// source or a nested claude (2.12.3); a string there that runs a shell is a
// segment of its own, read as shell.
function checkSegmentFor(seg, ctx) {
  const shell = !seg.where?.code
  return strictest([segmentRules(seg, ctx), checkoutGlobWrite(seg, ctx), shell ? fedShell(seg, ctx) : null, shell ? nestedClaude(seg, ctx) : null, ravenWrite(seg, ctx)])
}

// rm, mv, chmod, … of a glob in a checkout's root (`rm -rf *`).
function checkoutGlobWrite(seg, ctx) {
  if (seg.subshell) return null
  const words = stripPrefix(seg.words)
  if (!words.length || !WRITES_EACH.has(commandName(words[0]))) return null
  const hit = words.slice(1).find((w) => !w.startsWith('-') && globsCheckout(w, seg.where ?? { dir: ctx.cwd, built: false }))
  return hit ? protectedChange(ctx, `Writes ${hit}, a glob that reaches the guard's files`) : null
}

function segmentRules(seg, ctx) {
  // A substitution runs a shell, even inside interpreter code (perl's and
  // ruby's backticks).
  if (seg.subshell) return checkShell(seg.subshell, ctx, { ...seg.where, code: false })
  const words = stripPrefix(seg.words)
  const raw = seg.words.join(' ')
  // npx supabase@2 → supabase
  const head = words.length ? basename(words[0]).replace(/(?<=.)@[^/]*$/, '').toLowerCase() : ''
  const where = seg.where ?? { dir: ctx.cwd, built: false }
  const patterns = takesPatterns(seg)
  // Interpreter code read whole that runs nothing: the script's name in its
  // prose is text (2.12.4, proseCode).
  const prose = proseCode(seg, head, words.slice(1))
  // A glob in code that runs nothing is text no shell expands (2.13.6.1:
  // `Bash\(\*` in a node regex read as a glob of the script's name).
  const names = (w) => (prose && w === prose.word ? mentionsScript(prose.codeBare, { ...where, code: true }, false) : mentionsScript(w, where, patterns))
  // Redirects to /dev/null and the like write nothing (S1: `grep … 2>/dev/null`).
  const writes = seg.writes.filter((w) => !w.startsWith('/dev/'))
  if (seg.words.some((w, i) => !isText(head, seg.words, i) && names(w)) || writes.some(names)) {
    if (head === 'full-auto.sh') {
      const top = parseShell(ctx.source)
      if (top.length !== 1 || top[0].subshell) return deny(SCRIPT_DENIED)
      return checkFullAuto(seg, words, ctx)
    }
    // A shell given the script: its branch below checks the script as the command.
    if (!runsScript(head, words) && !readsScript(seg, words, head, names, parseShell(ctx.source).length === 1)) return deny(SCRIPT_DENIED)
  }
  // `arm <version>` runs the arm whatever runs it, with no name at all
  // (`find scripts -type f -exec {} arm 2.12.2 \;`), so outside text it's
  // refused unless the script is run on its own (yoda's must 2).
  const armAt = seg.words.findIndex((w, i) => ARM_WORDS.has(w) && !isText(head, seg.words, i) && isVersionWord(seg.words[i + 1]))
  if (armAt >= 0 && !runsScript(head, words)) return deny(`\`${seg.words.slice(armAt, armAt + 2).join(' ')}\` arms production: ${SCRIPT_DENIED}`)

  for (const target of seg.writes) {
    if (target.includes(TEMP_DIR)) return deny('supabase/.temp holds the CLI link and is never written by hand.')
    if (MARKER_FILE_RE.test(target)) return deny(MARKER_DENIED)
  }
  // The CLI reads SUPABASE_PROJECT_ID before supabase/.temp, and
  // SUPABASE_WORKDIR is --workdir's twin: either would point a "linked"
  // command at production. Seen as a prefix, after env, or in export.
  for (const w of seg.words) {
    const id = /^SUPABASE_PROJECT_ID=(\S*)$/.exec(w)
    if (id && id[1] !== DEV_REF) return prodCall(ctx, deny(`SUPABASE_PROJECT_ID=${id[1]} would point the CLI away from dev. Production is reached only through /skinny-pete.`))
    if (/^SUPABASE_WORKDIR=/.test(w)) return deny('SUPABASE_WORKDIR can point the CLI at another link. Run it from the repo root.')
  }
  if (words.length === 0) return null
  const cmd = head
  const rest = words.slice(1)
  // `$(which prod-db.sh)` leaves `prod-db.sh)` as its last part: still built.
  // In interpreter code nothing is built by a shell (where.code, 2.12.3).
  // `[` and `[[` are the test builtins, not a glob: `[ -n "$PR" ]` hides no
  // gh subcommand (2.12.4).
  const built = !where.code && cmd !== '[' && cmd !== '[[' && (DYNAMIC_RE.test(cmd) || (/\$\(|`/.test(words[0]) && /[)`]/.test(cmd)))

  // A nested claude could run as another agent (`claude -p --agent yoda`)
  // or without the project's hooks (`--setting-sources user`), so none runs
  // while full auto is armed (yoda's must 5), past wrappers, sh -c and npx
  // like every other check, and by any path (must D, review 4). Asking its
  // version or help is fine.
  if (claudeCall(words) && !(rest.length === 1 && CLAUDE_INFO.has(rest[0])) && anyMarker(ctx)) {
    return deny('No nested claude while full auto is armed: it could run as another agent or without this guard.')
  }

  // A name built at run time (`$S arm …`) may be the script; arm is only ever
  // spelled out. (Globs of the name were refused above.)
  if (built && rest.includes('arm')) {
    return deny('scripts/full-auto.sh arms production, so it runs only under its own name, spelled out: scripts/full-auto.sh arm <version>.')
  }
  // Any other command word built at run time (`G=gh; $G pr merge`,
  // `$(which gh) …`) may be gh, git or supabase, or prod-db.sh when a
  // subcommand of its follows, and is judged as each (yoda's must 1 (b)).
  // The reason names the word and the reading that refused it, prod-db.sh
  // first when a subcommand of its follows: `$P push` was refused as
  // "gh push (an alias)" until 2.12.4.
  if (built) {
    const as = [['gh', checkGh(rest, ctx)], ['git', checkGit(rest, ctx)], ['supabase', checkSupabase(rest, ctx)]]
    if (PROD_DB_SUBS.has(rest[0])) as.unshift(['prod-db.sh', checkProdDb(['prod-db.sh', ...rest], ctx)])
    const r = strictest(as.map(([, x]) => x))
    if (r) return { ...r, reason: `\`${words[0]}\` is built at run time and may be ${as.find(([, x]) => x === r)[0]}: ${r.reason}` }
  }
  // cp, mv, rm, ln, tee, sed, find -delete, git checkout, …: anything but a
  // plain read that names the marker or its log.
  // gh may post the log (--body-file); its other flags can download over it.
  // A plain cp to a folder outside this checkout only reads its sources
  // (S1: a copy of .claude/hooks to a scratch mirror); a link isn't a copy.
  const args = rest.filter((w) => !w.startsWith('-'))
  const copyOut = cmd === 'cp' && !rest.some((w) => /^-[a-zA-Z]*[ls]/.test(w) || w === '--link' || w === '--symbolic-link') &&
    args.length >= 2 && outsideRepo(args.at(-1), where, ctx.root)
  const read = (w) => copyOut && w !== args.at(-1)
  const named = seg.words.filter((w, i) => namesMarker(w) && !read(w) && !(cmd === 'gh' && seg.words[i - 1] === '--body-file'))
  // git ls-files and check-ignore only list paths and have no flag that
  // writes one, so naming the log there is a read (maverick, 2.12.3); so
  // are log, diff, show and blame, unless --output sends them to a file
  // (2.12.4). Only as the first word: `git -C x log` isn't read this way.
  const gitRead = cmd === 'git' && (GIT_PATH_READS.has(rest[0]) ||
    (['log', 'diff', 'show', 'blame'].includes(rest[0]) && !rest.some((w) => /^--output(?:=|$)/.test(w))))
  // awk, sed (not -i) and find that only read are readers too (2.13.6.1).
  const tool = textTool(seg)
  const toolReads = tool?.verdict === 'plain' && !tool.inPlace && tool.tool !== 'perl'
  if (!MARKER_READERS.has(cmd) && !gitRead && !toolReads && named.length) return deny(MARKER_DENIED)
  if (seg.writes.some(namesMarker)) return deny(MARKER_DENIED)
  // A renamed copy of the script would arm without the ask below.
  if ((['mv', 'cp', 'ln', 'rsync', 'ditto', 'install'].includes(cmd) || writes.length) && seg.words.some((w) => SCRIPT_WORD_RE.test(w) || scriptGlob(w, where, patterns))) {
    return deny('scripts/full-auto.sh is never copied, moved or linked: it arms production, so it runs only under its own name.')
  }
  // A glob reaches .claude only when it starts with a dot, as in the shell.
  const claudeDir = (w) => CLAUDE_DIR_WORD_RE.test(w) || (globNames(w, ['.claude']) && /(?:^|\/)\.[^/]*\/?$/.test(w))
  if (['mv', 'cp', 'rm', 'ln', 'rsync', 'ditto', 'tar', 'unzip'].includes(cmd) && rest.some((w) => claudeDir(w) && !read(w))) {
    return deny('The .claude folder is never moved, replaced or removed wholesale: it holds the full-auto marker.')
  }
  // A shell reading its script from stdin: no script word, or -s.
  const stdinShell = SHELLS.has(cmd) && (!rest.some((w) => !w.startsWith('-') && !PROCESS_SUB_RE.test(w)) || rest.some((w) => /^-[a-z]*s[a-z]*$/.test(w)))
  // A stdin shell may be fed a globbed script from another segment
  // (`cat scripts/fu*.sh | bash -s arm`); an interpreter by its own words.
  // awk's code is its program word: what reaches it on stdin is data, so a
  // grep for the arm script piped into awk names nothing awk runs (2.12.3).
  // With -f it reads a file, which may have been written earlier in the call.
  const ownCode = (cmd === 'awk' || cmd === 'gawk') && !rest.some((w) => /^(?:-f|--file)/.test(w))
  // Code read whole that runs nothing (2.12.4) is judged without its prose,
  // and what other segments send it is data, unless it writes: then it could
  // write out what it's sent (`cat <the script> | python3 -c '…write…'`).
  // With its files resolved (2.13.6.1), code's own text is only text: what
  // it writes decides, and what other segments of the call name (they may
  // feed it), not this segment's own words.
  const files = prose?.files
  const fromOthers = ownCode || (prose && !prose.writes) ? '' : files ? othersNameFullAuto(seg, ctx) : ctx.visible.match(/full-auto/i)?.[0] ?? ''
  const fed = stdinShell ? ctx.visible : `${fromOthers} ${prose ? '' : seg.words.join(' ')}`
  if (stdinShell && mentionsFullAuto(fed + '\n' + (seg.heredoc ?? ''))) return deny(MARKER_DENIED)
  if (tool?.tool === 'awk' && toolReads && codeNamesFullAuto(tool.code, where)) return deny(MARKER_DENIED)
  if (INTERPRETERS.has(cmd) && !toolReads && codeNamesFullAuto(fed + '\n' + (prose ? (files ? '' : prose.bare) : seg.heredoc ?? ''), where)) return deny(MARKER_DENIED)
  if (files) {
    const names = (p) => [...p, p.join('')].some((x) => /full-auto/i.test(x) || x.split(/[\s;&|<>()'"=,`]+/).some((w) => namesMarker(w) || scriptGlob(w, { ...where, code: true }, false)))
    // A write to the marker, its log or the script; or a copy of the script.
    if (files.writes.some(names)) return deny(MARKER_DENIED)
    if (files.writes.length && files.reads.some((p) => [...p, p.join('')].some((x) => /full-auto\.sh/i.test(x)))) return deny('scripts/full-auto.sh is never copied, moved or linked: it arms production, so it runs only under its own name.')
  } else if (prose?.writes && /full-auto(?!\.sh)/i.test(prose.text)) {
    // A marker or log named even in prose: only code that writes nothing.
    return deny(MARKER_DENIED)
  }

  // Merging a release PR ships it: Vercel deploys main. It isn't a database
  // call, but it's production all the same, so it goes through ranjit too.
  if (HTTP_CLIENTS.has(cmd) && (GITHUB_MERGE_RE.test(raw) || contentsWrite(raw))) return prodCall(ctx, deny(MERGE_BY_API))
  if (cmd === 'gh') return checkGh(rest, ctx)
  if (cmd === 'git') return checkGit(rest, ctx)

  // `source script.sh` and `. script.sh` run a script like `bash script.sh`.
  if (SHELLS.has(cmd) || cmd === 'source' || cmd === '.') {
    const c = rest.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w))
    if (c >= 0 && rest[c + 1] !== undefined) return checkShell(rest[c + 1], ctx, seg.where)
    // `bash script.sh`: check the script as the command, keeping VAR=value.
    const at = rest.findIndex((w) => !w.startsWith('-'))
    // -n only parses the script.
    if (rest.slice(0, at < 0 ? rest.length : at).some((w) => /^-[a-z]*n[a-z]*$/.test(w))) return null
    // A process substitution as the script is fed text (fedShell asks).
    if (at < 0 || PROCESS_SUB_RE.test(rest[at])) return null
    const assignments = seg.words.slice(0, seg.words.length - words.length).filter((w) => ASSIGNMENT_RE.test(w))
    return checkSegment({ words: [...assignments, ...rest.slice(at)], writes: [], where: seg.where }, ctx)
  }
  if (cmd === 'eval') return checkShell(rest.join(' '), ctx, seg.where)

  if (['cp', 'mv', 'rm', 'tee', 'ln', 'touch', 'truncate'].includes(cmd) || (cmd === 'sed' && rest.some((w) => w.startsWith('-i')))) {
    if (rest.some((w) => w.includes(TEMP_DIR))) return deny('supabase/.temp holds the CLI link and is never written by hand.')
  }

  if (cmd === 'security' && (raw.includes(PROD_KEYCHAIN_ITEM) || /password|keychain|export|dump/.test(rest[0] ?? ''))) {
    return deny(`Keychain items are read only by scripts/prod-db.sh, and a human adds them in their own terminal (${PROD_KEYCHAIN_ITEM}).`)
  }
  if (PG_URL_RE.test(raw)) return deny('Connection strings never go on a command line. Production goes through scripts/prod-db.sh; dev through the linked CLI.')

  if (cmd === 'prod-db.sh') return checkProdDb(seg.words, ctx)
  if (cmd === 'supabase') return checkSupabase(rest, ctx)
  if (['npm', 'pnpm', 'yarn'].includes(cmd)) {
    // npm exec supabase …, pnpm dlx supabase …
    const at = rest.findIndex((w) => w.replace(/(?<=.)@[^/]*$/, '') === 'supabase')
    if (at >= 0) return checkSupabase(rest.slice(at + 1), ctx)
    if (rest.includes('types')) return requireLinkedDev(ctx, 'npm run types')
  }
  if (['psql', 'pg_dump', 'pg_dumpall', 'pg_restore'].includes(cmd)) {
    ctx.production = true
    if (ctx.deployer) return deny('The deployer reaches the database only through scripts/prod-db.sh.')
    return ask(ctx, `${cmd} can reach any database. Check where it connects.`)
  }

  // Direct HTTP to a Supabase project, e.g. curl to a function URL.
  for (const [, ref] of raw.matchAll(SUPABASE_HOST_RE)) {
    if (ref === DEV_REF) continue
    ctx.production = true
    if (!ctx.deployer) return deny(`${ref} isn't the dev project. Production is reached only through /skinny-pete.`)
    return ask(ctx, `Production (${ref}): ${raw}`)
  }
  return null
}

// Commit messages and PR bodies may mention anything, so only the subcommand
// is read, never the text after it.
function checkGh(args, ctx) {
  const sub = []
  for (let i = 0; i < args.length && sub.length < 2; i++) {
    if (args[i] === '-R' || args[i] === '--repo') { i++; continue }
    if (!args[i].startsWith('-')) sub.push(args[i])
  }
  // A subcommand that's missing (`xargs gh pr` takes it from stdin) or built
  // at run time (`gh pr $M`) could be merge, so it counts as one.
  const built = (w) => w !== undefined && DYNAMIC_RE.test(w)
  const onlyInfo = args.length > 0 && args.every((w) => ['--version', '--help', '-h'].includes(w))
  // A $-built word in the first two places may be `pr merge` whatever
  // follows (`G="pr merge --body"; gh $G view`), and a first word gh doesn't
  // ship with is an alias or an extension, which may be a merge too (yoda's
  // must 1 (c), (d)). api's second word is its path, read below.
  const alias = sub[0] !== undefined && !built(sub[0]) && !GH_BUILTINS.has(sub[0])
  const shipping = !onlyInfo && (
    sub[0] === undefined || built(sub[0]) || (built(sub[1]) && sub[0] !== 'api') || alias ||
    (sub[0] === 'pr' && (sub[1] === 'merge' || sub[1] === 'ready' || sub[1] === undefined)) ||
    (GH_EXTENSION.has(sub[0]) && sub[1] === 'exec'))
  if (shipping) {
    ctx.production = true
    const what = sub[0] === 'pr' && sub[1] !== undefined && !built(sub[1]) ? `\`gh pr ${sub[1]}\``
      : alias ? `\`gh ${sub[0]}\` (an alias or extension, which may be merge)`
        : `\`gh ${sub.join(' ')}\` (a subcommand that isn't spelled out may be merge)`
    if (!ctx.deployer) return deny(`${what} ships a release. Only ranjit runs it, through /skinny-pete (or /cattle-drive).`)
    return ask(ctx, `Ships the release: gh ${args.join(' ')}`)
  }
  if (sub[0] === 'api') {
    const text = args.join(' ')
    if (GITHUB_MERGE_RE.test(text) || contentsWrite(text) || apiMayMerge(args.slice(args.indexOf('api') + 1))) return prodCall(ctx, deny(MERGE_BY_API))
  }
  // gh runs some of its config as commands (browser, editor, pager), so
  // `gh config set browser 'gh pr merge …' && gh browse` merges (must C,
  // review 4). A value that reads as a command line is judged as one too.
  if (sub[0] === 'config' && sub[1] === 'set') {
    const values = args.slice(args.indexOf('set') + 1).filter((w) => !w.startsWith('-'))
    return strictest([prodCall(ctx, ask(ctx, `gh config set can make gh run a command the guard can't read (browser, editor, pager), so a person decides: gh ${args.join(' ')}`)),
      ...values.slice(1).map((v) => configCommand(v, ctx))])
  }
  // A new alias or extension could be a merge under another name.
  if (sub[0] === 'alias' && ['set', 'import'].includes(sub[1])) return deny('A gh alias could hide a merge from the guard, so none is set or imported here; a person does it by hand.')
  if (GH_EXTENSION.has(sub[0]) && sub[1] === 'install') return deny('A gh extension could hide a merge from the guard, so none is installed here; a person does it by hand.')
  return null
}

const GH_API_VALUE_FLAGS = new Set(['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '--input', '-q', '--jq', '-t', '--template', '-p', '--preview', '--hostname', '--cache'])

// A path built at run time with a write method, or a GraphQL query from a
// file, stdin or a variable, can't be read for a merge, so it counts as one
// (should 6, round 2). gh api writes (POST) whenever fields are given.
function apiMayMerge(rest) {
  let endpoint
  let method
  let input = false
  const fields = []
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]
    let flag = w
    let value
    const eq = w.startsWith('--') ? w.indexOf('=') : -1
    if (eq > 0) { flag = w.slice(0, eq); value = w.slice(eq + 1) }
    else if (/^-[XHfFqtp]./.test(w)) { flag = w.slice(0, 2); value = w.slice(2) }
    else if (GH_API_VALUE_FLAGS.has(w)) value = rest[++i] ?? ''
    else if (w.startsWith('-')) continue
    else { endpoint ??= w; continue }
    if (flag === '-X' || flag === '--method') method = value
    else if (['-f', '--raw-field', '-F', '--field'].includes(flag)) fields.push(value)
    else if (flag === '--input') input = true
  }
  if (endpoint === undefined) return false
  if (endpoint.replace(/^\//, '') === 'graphql') {
    return input || fields.some((f) => f.startsWith('query=') && graphqlUnread(f.slice(6)))
  }
  const write = method !== undefined ? !/^(?:GET|HEAD)$/i.test(method) : fields.length > 0 || input
  return write && DYNAMIC_RE.test(endpoint)
}

// A query from a file (@q.graphql, @- for stdin) or with a shell variable
// in it. `$n` is a GraphQL variable, not the shell's, when the query
// declares it (`query($n: Int!)`).
function graphqlUnread(q) {
  if (q.startsWith('@') || /\$\(|`|\$\{/.test(q)) return true
  return [...q.matchAll(/\$([A-Za-z_]\w*)/g)].some(([, n]) => !new RegExp(`\\$${n}\\s*:`).test(q))
}

// A push to main deploys the frontend without a PR. Only explicit refspecs
// are seen; a bare `git push` while on main isn't (see README).
function checkGit(args, ctx) {
  // The subcommand is the first word that isn't a global option or the value
  // of one: -C <dir>, -c <key=value> and the long forms that take a separate
  // value (`git -C push push origin main` pushes).
  let at = 0
  while (at < args.length && args[at].startsWith('-')) {
    // A config value can point a push at main (remote.origin.push=HEAD:main),
    // make an alias of one (alias.p=push) or name a command git runs
    // (core.sshCommand, core.editor, credential.helper, …), and
    // --config-env's value comes from the environment, so all but a short
    // list of harmless keys ask (should 5, round 2; must A, review 4). A
    // value that reads as a command line is judged as one too, so a merge
    // in it is refused outright.
    const opt = args[at]
    const value = opt === '-c' ? args[at + 1] ?? '' : undefined
    if (opt === '--config-env' || opt.startsWith('--config-env=') || (value !== undefined && !harmlessConfig(value))) {
      const asked = prodCall(ctx, ask(ctx, `A git config value may run a command, point this at main or make an alias of a push: git ${args.join(' ')}`))
      return strictest([asked, value === undefined ? null : configCommand(value.slice(value.indexOf('=') + 1), ctx)])
    }
    at += GIT_VALUE_OPTS.has(opt) ? 2 : 1
  }
  const sub = args[at]
  if (sub === undefined) return null
  const rest = args.slice(at + 1)
  // Config on disk decides where a bare `git push` goes (remote.*.push,
  // branch.*.merge with push.default=upstream, an include, a url rewrite, an
  // alias) and which commands git runs (core.sshCommand, core.pager, …), so
  // setting any key but the harmless ones asks (yoda's must 3; must A,
  // review 4). Reading it is fine.
  if (sub === 'config' && gitConfigWrite(rest)) {
    const values = rest.filter((w) => !w.startsWith('-')).slice(1)
    return strictest([prodCall(ctx, ask(ctx, `git config that may run a command, point a push at main or make an alias of one: git ${args.join(' ')}`)),
      ...values.map((v) => configCommand(v, ctx))])
  }
  const refs = rest.filter((w) => !w.startsWith('-')).slice(1)
  // A branch built at run time (`git push origin $B`) may be main; so may a
  // subcommand built at run time that names a remote and a ref.
  const mayBeMain = (w) => /^\+?(?:.*:)?(?:refs\/heads\/)?main$/.test(w) || DYNAMIC_RE.test(w)
  const toMain = rest.some((w) => w === '--all' || w === '--mirror') || refs.some(mayBeMain)
  if ((sub === 'push' || DYNAMIC_RE.test(sub)) && toMain) return prodCall(ctx, ask(ctx, `Pushes to main, which Vercel deploys to production: git ${args.join(' ')}`))
  return null
}
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix', '--attr-source'])
const CONFIG_VALUE_OPTS = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value'])
const CONFIG_WRITE_FLAGS = new Set(['--unset', '--unset-all', '--add', '--replace-all', '--rename-section', '--remove-section', '-e', '--edit'])

// Keys that neither run a command nor steer a push (must A, review 4). The
// two core keys are harmless only when switched off: a path turns fsmonitor
// into a hook git runs.
function harmlessConfig(kv) {
  const eq = kv.indexOf('=')
  const key = (eq < 0 ? kv : kv.slice(0, eq)).toLowerCase()
  const value = eq < 0 ? 'true' : kv.slice(eq + 1)
  if (DYNAMIC_RE.test(kv)) return false
  if (['core.fsmonitor', 'core.untrackedcache'].includes(key)) return value.toLowerCase() === 'false'
  return ['core.trustctime', 'core.checkstat', 'core.quotepath'].includes(key) || /^(?:color|user)\.[\w.-]+$/.test(key)
}

// A config value git would run (`!gh pr merge …` for a helper or an alias,
// `gh pr merge … #` for sshCommand), judged as a command line when it reads
// as one.
function configCommand(value, ctx) {
  const line = String(value ?? '').replace(/^!/, '')
  return /[\s|;&]/.test(line) || String(value ?? '').startsWith('!') ? checkShell(line, ctx) : null
}

// Whether `git config <rest>` writes a key outside the harmless ones (or
// opens the file in an editor). A key alone, --get and --list only read.
function gitConfigWrite(rest) {
  if (rest.some((w) => w === '-e' || w === '--edit')) return true
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    if (CONFIG_VALUE_OPTS.has(rest[i])) i++
    else if (!rest[i].startsWith('-')) positional.push(rest[i])
  }
  if (rest.some((w) => /^--(?:get|get-all|get-regexp|get-urlmatch|list)$|^-l$/.test(w)) || ['get', 'list'].includes(positional[0])) return false
  const verb = ['set', 'unset', 'rename-section', 'remove-section', 'edit'].includes(positional[0])
  if (!(rest.some((w) => CONFIG_WRITE_FLAGS.has(w)) || verb || positional.length >= 2)) return false
  if (rest.some((w) => /^--(?:rename|remove)-section$/.test(w)) || /-section$/.test(positional[0] ?? '')) return true
  const [key, value] = verb ? positional.slice(1) : positional
  return key === undefined || !harmlessConfig(value === undefined ? key : `${key}=${value}`)
}

// gh's own commands (gh 2.x). Any other first word is an alias or an
// extension, which may run a merge.
const GH_BUILTINS = new Set(['accessibility', 'agent-task', 'alias', 'api', 'attestation', 'auth', 'browse', 'cache', 'codespace', 'completion', 'config',
  'copilot', 'extension', 'ext', 'gist', 'gpg-key', 'help', 'issue', 'label', 'licenses', 'org', 'pr', 'preview', 'project', 'release', 'repo',
  'ruleset', 'run', 'search', 'secret', 'ssh-key', 'status', 'variable', 'version', 'workflow'])
const GH_EXTENSION = new Set(['extension', 'ext', 'extensions'])
// prod-db.sh's subcommands, for a command word built at run time.
const PROD_DB_SUBS = new Set(['push', 'repair', 'setting', 'migrations', 'dry-run', 'query', 'backup'])
// What arms, and what can follow it.
const ARM_WORDS = new Set(['arm', 'arm-chain'])
const isVersionWord = (w) => w !== undefined && (VERSION_ARG_RE.test(w) || /[$`]/.test(w))

// Glob-aware name checks: `scripts/fu*.sh` names the arm script as surely as
// its full name does, since the shell expands it before the command runs.
const SCRIPT_NAMES = ['full-auto.sh']
const MARKER_NAMES = ['full-auto.json', 'full-auto.log', 'full-auto-chain.json', 'full-auto-chain.log', 'full-auto-verdict.json']
// `npx @anthropic-ai/claude-code` is claude too, and so is its binary by its
// real path (`…/claude-code/bin/claude.exe`, which /opt/homebrew/bin/claude
// links to; must D, review 4) or its entry file run by node.
const isClaude = (name) => /^claude(?:-code)?(?:\.(?:exe|js|mjs|cjs))?$/.test(name)
const CLAUDE_INFO = new Set(['--version', '-v', '--help', '-h'])
function claudeCall(words) {
  const cmd = commandName(words[0] ?? '')
  if (isClaude(cmd)) return true
  if (!['node', 'bun', 'deno'].includes(cmd)) return false
  const script = words.slice(1).find((w) => !w.startsWith('-'))
  return script !== undefined && /(?:^|\/)(?:@anthropic-ai\/)?claude-code\//i.test(script)
}
const namesScript = (w) => SCRIPT_WORD_RE.test(w) || globNames(w, SCRIPT_NAMES)
// `*.json` is everywhere, so a marker glob counts only in a folder that could
// be .claude: one named .c…, or itself a glob. A bare `*.json` run from inside
// .claude isn't seen (a forged marker still has to match the PR's list).
const namesMarker = (w) => MARKER_WORD_RE.test(w) ||
  (globNames(w, MARKER_NAMES) && /(?:^|\/)\.c|[*?[{][^/]*\//i.test(String(w).replace(/[^/]*$/, '')))

// Whether a word's last path part is a glob that could match one of `names`.
export function globNames(word, names) {
  const last = String(word ?? '').replace(/\/+$/, '').split('/').pop()
  if (!/[*?[{]/.test(last)) return false
  let re = ''
  for (let i = 0; i < last.length; i++) {
    const c = last[i]
    if (c === '*') re += '.*'
    else if (c === '?') re += '.'
    else if (c === '[') {
      const end = last.indexOf(']', i + 2)
      if (end < 0) { re += '\\['; continue }
      re += bracketClass(last.slice(i + 1, end))
      i = end
    } else if (c === '{') {
      const end = last.indexOf('}', i)
      if (end < 0) { re += '\\{'; continue }
      re += '(?:' + last.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')'
      i = end
    } else re += escapeRe(c)
  }
  try {
    const rx = new RegExp(`^${re}$`, 'i')
    return names.some((n) => rx.test(n))
  } catch {
    return true // a pattern we can't read may match anything
  }
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A glob's [...] as a regex class, each character escaped. A range the
// shell can't match (`"- ` runs backwards) matches nothing, as in bash; it
// used to break the regex, which counted as a match, so a jq filter's
// `[scan("- \\[x\\]")]` read as the marker (2.12.3).
function bracketClass(body) {
  const negate = /^[!^]/.test(body)
  const chars = [...(negate ? body.slice(1) : body)]
  const parts = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i + 1] === '-' && chars[i + 2] !== undefined) {
      if (chars[i] <= chars[i + 2]) parts.push(`${escapeRe(chars[i])}-${escapeRe(chars[i + 2])}`)
      i += 2
    } else parts.push(chars[i] === '-' ? '\\-' : escapeRe(chars[i]))
  }
  if (!parts.length) return negate ? '[^]' : '[]'
  return `[${negate ? '^' : ''}${parts.join('')}]`
}

// The interpreter check: the literal name, or any word that globs to it.
function mentionsFullAuto(text) {
  return /full-auto/i.test(text) || text.split(/[\s;&|<>()'"=]+/).some((w) => namesScript(w) || namesMarker(w))
}

// A PUT or DELETE on the contents API commits straight to a branch.
function contentsWrite(text) {
  return GITHUB_CONTENTS_WRITE_RE.test(text) && WRITE_METHOD_RE.test(text)
}

function checkProdDb(words, ctx) {
  // A dev test run: the script checks the URL is dev's before connecting.
  const item = words.find((w) => w.startsWith('PROD_DB_KEYCHAIN_ITEM='))
  if (item === `PROD_DB_KEYCHAIN_ITEM=${DEV_KEYCHAIN_ITEM}`) return null
  ctx.production = true
  if (item) return deny('prod-db.sh only accepts the dev test item as an override.')
  if (!ctx.deployer) return deny('scripts/prod-db.sh reaches production. Only the ranjit agent (the deployer) runs it, through /skinny-pete.')
  const args = words.slice(words.findIndex((w) => basename(w) === 'prod-db.sh') + 1)
  if (PROD_DB_READ.has(args[0])) return null
  return ask(ctx, `Changes production's database: prod-db.sh ${args.join(' ')}`)
}

function checkSupabase(args, ctx) {
  const flags = parseFlags(args)
  if (flags.has('--db-url')) return deny('--db-url puts a connection string on the command line. Production goes through scripts/prod-db.sh.')
  if (flags.has('--password') || flags.has('-p')) return deny('Database passwords never pass through Claude.')
  if (flags.has('--workdir')) return deny('--workdir can point the CLI at another link. Run it from the repo root.')

  const positional = args.filter((w, i) => !w.startsWith('-') && !takesValue(args[i - 1]))
  const sub = positional.slice(0, 2)
  const ref = flags.get('--project-ref') ?? flags.get('--project-id')

  if (sub[0] === 'link') {
    if (ctx.deployer) return deny('The deployer never relinks the CLI; it passes --project-ref instead.')
    const target = ref ?? positional[1]
    if (target === DEV_REF) return null
    return prodCall(ctx, deny(`The CLI stays linked to dev: supabase link --project-ref ${DEV_REF}`))
  }
  if (sub[0] === 'unlink') return ctx.deployer ? deny('The deployer never changes the CLI link.') : null
  if (sub[0] === 'projects' && sub[1] !== 'list') return deny('Project management (create, delete, API keys) is done by hand in the dashboard.')
  if (SUPABASE_OFFLINE.some((p) => p.every((w, i) => (p[0].startsWith('-') ? args[0] : sub[i]) === w))) return null
  if (flags.has('--local')) return null

  if (ref !== undefined) {
    if (ref === DEV_REF) return null
    ctx.production = true
    if (!ctx.deployer) return deny(`--project-ref ${ref} isn't dev. Production is reached only through /skinny-pete.`)
    const is = (list) => list.some((p) => p.every((w, i) => sub[i] === w))
    if (is(DEPLOYER_CLI_READ)) return null
    if (!is(DEPLOYER_CLI_WRITE)) {
      if (sub[0] === 'secrets') return deny('Secrets on production are set by a human: supabase secrets set … in their own terminal.')
      return deny(`\`supabase ${sub.join(' ')}\` isn't part of the deploy flow. The database goes through scripts/prod-db.sh.`)
    }
    return ask(ctx, `Changes production (${ref}): supabase ${args.join(' ')}`)
  }
  // Everything else uses the linked project.
  return requireLinkedDev(ctx, `supabase ${sub.join(' ')}`)
}

function requireLinkedDev(ctx, what) {
  const linked = ctx.linkedRef()
  if (linked === DEV_REF) return null
  const now = linked ? `is linked to ${linked}` : "isn't linked"
  return deny(`${what} uses the linked project, and the CLI ${now}. Relink to dev first: supabase link --project-ref ${DEV_REF}`)
}

function ask(ctx, reason) {
  if (ctx.unattended) return deny('Production calls need a human to approve them. Switch to Manual or Auto mode; bypass and don\'t-ask modes can\'t prompt.')
  return { decision: 'ask', reason }
}

function deny(reason) {
  return { decision: 'deny', reason }
}

// Marks the call as reaching production (for the armed log) and passes the
// result through.
function prodCall(ctx, result) {
  ctx.production = true
  return result
}

const VALUE_FLAGS = new Set(['--project-ref', '--project-id', '--db-url', '--password', '-p', '--workdir', '--file', '-f', '--status', '--profile', '--output', '-o', '--schema', '-s', '--exclude', '-x', '--import-map', '--output-format', '--log-level'])
function takesValue(word) {
  return word !== undefined && VALUE_FLAGS.has(word)
}

function parseFlags(args) {
  const flags = new Map()
  args.forEach((w, i) => {
    if (!w.startsWith('-')) return
    const eq = w.indexOf('=')
    if (eq > 0) flags.set(w.slice(0, eq), w.slice(eq + 1))
    else flags.set(w, takesValue(w) ? args[i + 1] : true)
  })
  return flags
}

// Drops what runs before the real command: keywords, VAR=value, and
// wrappers such as `env`, `npx -y` or `xargs -n1`.
function stripPrefix(words) {
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (KEYWORDS.has(w) || ASSIGNMENT_RE.test(w)) { i++; continue }
    if (w === 'for' || w === 'case' || w === 'select') return []
    if (WRAPPERS.has(basename(w))) {
      i++
      while (i < words.length && (words[i].startsWith('-') || /^\d+[smhd]?$/.test(words[i]))) i++
      continue
    }
    break
  }
  return words.slice(i)
}

// ---------------------------------------------------------------- parser

/**
 * A small shell tokenizer: enough to find each simple command in a line of
 * bash, with its words, redirect targets, and any $(…) or `…` inside it
 * (returned as separate segments). Heredoc bodies are skipped, so a document
 * written through `cat <<'EOF'` isn't read as commands; each body is kept on
 * the segment that opened it (`heredoc`), for the interpreter check.
 */
export function parseShell(src) {
  const segments = []
  let words = []
  let writes = []
  let word = null
  let redirect = false
  const heredocs = []
  let i = 0

  // Where the shell expands each word (2.13.6.1): `marks` holds, per word,
  // the spans a shell fills in at run time ($x, ${x}, $(…), `…`, <(…)) as
  // 'dyn', and `$(( ))` arithmetic as 'num'. Text in single quotes or after a
  // backslash is never marked, so an awk or sed script can tell its own `$1`
  // from the shell's.
  let marks = []
  let wordMarks = []
  const endWord = () => {
    if (word === null) return
    if (redirect) { writes.push(word); redirect = false } else { words.push(word); marks.push(wordMarks) }
    word = null
    wordMarks = []
  }
  // The operator before and after each segment (`&&`, `;`, `|`, `||`, `&`,
  // a newline, a paren), so a cd can tell whether it surely runs in this
  // shell (2.14.6 review round 1, should 2). '' is the start or the end.
  let opBefore = ''
  const endSegment = (op = '') => {
    endWord()
    const any = words.length > 0 || writes.length > 0
    // A newline right after `||` or `|` continues that operator.
    if (!any && op === '\n' && opBefore) op = ''
    if (any) {
      const seg = { words, writes }
      // Not enumerable: a segment still compares equal to its words and writes.
      Object.defineProperty(seg, 'marks', { value: marks })
      Object.defineProperty(seg, 'opBefore', { value: opBefore })
      Object.defineProperty(seg, 'opAfter', { value: op })
      segments.push(seg)
      for (const h of heredocs) h.seg ??= seg
    }
    if (op) opBefore = op
    words = []
    writes = []
    marks = []
  }
  const add = (s) => { word = (word ?? '') + s }
  const mark = (at, text, kind) => { wordMarks.push({ at, end: at + text.length, kind }) }
  // `$(( … ))` is arithmetic, not a subshell: its value is a number. With a
  // substitution inside it is read as before, a subshell the guard checks.
  const arithmetic = (at) => {
    if (src[at + 2] !== '(') return -1
    const end = matchParen(src, at + 1)
    if (src[end - 1] !== ')' || matchParen(src, at + 2) !== end - 1) return -1
    return /\$\(|`/.test(src.slice(at + 3, end - 1)) ? -1 : end
  }
  // A shell variable: $name, ${…}, or a special one ($1, $@, $?, …).
  const variable = (at) => {
    const m = /^\$(?:\{[^}]*\}?|[A-Za-z_]\w*|[0-9@*#?!$-])/.exec(src.slice(at))
    return m ? m[0] : null
  }

  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue }
      add(src[i + 1] ?? ''); i += 2; continue
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      add(src.slice(i + 1, end < 0 ? src.length : end))
      i = end < 0 ? src.length : end + 1
      continue
    }
    if (c === '"') {
      i++
      let s = ''
      const base = (word ?? '').length
      while (i < src.length && src[i] !== '"') {
        // In double quotes a backslash escapes only $ ` " \ (and joins lines);
        // before anything else it stays (2.14.6: sed's "s/x/'.\/ui'/" lost
        // its \/ here, so the script read as unknown and was rescanned).
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1]
          s += next === '\n' ? '' : '$`"\\'.includes(next) ? next : '\\' + next
          i += 2
          continue
        }
        if (src[i] === '$' && src[i + 1] === '(') {
          const num = arithmetic(i)
          if (num >= 0) { mark(base + s.length, src.slice(i, num + 1), 'num'); s += src.slice(i, num + 1); i = num + 1; continue }
          const end = matchParen(src, i + 1)
          segments.push({ subshell: src.slice(i + 2, end), words: [], writes: [] })
          mark(base + s.length, src.slice(i, end + 1), 'dyn')
          s += src.slice(i, end + 1); i = end + 1; continue
        }
        if (src[i] === '`') {
          const end = src.indexOf('`', i + 1)
          const stop = end < 0 ? src.length : end
          segments.push({ subshell: src.slice(i + 1, stop), words: [], writes: [] })
          mark(base + s.length, src.slice(i, stop + 1), 'dyn')
          s += src.slice(i, stop + 1); i = stop + 1; continue
        }
        const v = src[i] === '$' ? variable(i) : null
        if (v) { mark(base + s.length, v, 'dyn'); s += v; i += v.length; continue }
        s += src[i++]
      }
      add(s); i++
      continue
    }
    if (c === '$' && src[i + 1] === '(') {
      const num = arithmetic(i)
      if (num >= 0) {
        mark((word ?? '').length, src.slice(i, num + 1), 'num')
        add(src.slice(i, num + 1)); i = num + 1
        continue
      }
      const end = matchParen(src, i + 1)
      segments.push({ subshell: src.slice(i + 2, end), words: [], writes: [] })
      mark((word ?? '').length, src.slice(i, end + 1), 'dyn')
      add(src.slice(i, end + 1)); i = end + 1
      continue
    }
    if (c === '$') {
      const v = variable(i)
      if (v) { mark((word ?? '').length, v, 'dyn'); add(v); i += v.length; continue }
    }
    // Process substitution, `<(…)` or `>(…)`: a subshell, and a word (a file
    // name) in the command around it, so what follows its `)` stays part of
    // that command (2.13.6.1: `grep -f <(…) $f.md` left `$f.md` as a command).
    if ((c === '<' || c === '>') && src[i + 1] === '(') {
      const end = matchParen(src, i + 1)
      segments.push({ subshell: src.slice(i + 2, end), words: [], writes: [] })
      mark((word ?? '').length, src.slice(i, end + 1), 'dyn')
      add(src.slice(i, end + 1)); i = end + 1
      continue
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      const stop = end < 0 ? src.length : end
      segments.push({ subshell: src.slice(i + 1, stop), words: [], writes: [] })
      mark((word ?? '').length, src.slice(i, stop + 1), 'dyn')
      add(src.slice(i, stop + 1)); i = stop + 1
      continue
    }
    if (c === '#' && word === null) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      endWord()
      i += 2
      if (src[i] === '-') i++
      while (src[i] === ' ' || src[i] === '\t') i++
      let delim = ''
      let quoted = false
      while (i < src.length && !/[\s;&|<>()]/.test(src[i])) {
        if (src[i] !== "'" && src[i] !== '"' && src[i] !== '\\') delim += src[i]
        else quoted = true
        i++
      }
      heredocs.push({ delim, seg: null, quoted })
      continue
    }
    if (c === '\n') {
      endSegment('\n')
      i++
      // Skip the bodies of heredocs opened on the line just ended.
      while (heredocs.length) {
        const { delim, seg, quoted } = heredocs.shift()
        const start = i
        let end = src.length
        while (i < src.length) {
          const nl = src.indexOf('\n', i)
          const line = src.slice(i, nl < 0 ? src.length : nl)
          if (line.replace(/^\t+/, '') === delim) { end = i; i = nl < 0 ? src.length : nl + 1; break }
          i = nl < 0 ? src.length : nl + 1
        }
        if (seg && end > start) seg.heredoc = (seg.heredoc ?? '') + src.slice(start, end)
        // An unquoted body (`<<EOF`) is expanded by this shell before the
        // command reads it: its $(…) and `…` run here, so each is a subshell
        // like one on the line (2.14.9.1, B2: `cat <<EOF` with $(gh pr merge)
        // passed), and a shell fed the body can't read what it gets.
        if (!quoted) {
          if (seg) Object.defineProperty(seg, 'heredocExpands', { value: !!seg.heredocExpands || /[$`\\]/.test(src.slice(start, end)), configurable: true })
          segments.push(...heredocSubstitutions(src, start, end))
        }
      }
      continue
    }
    if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')') {
      // 2>&1 and >&2 are redirects, not separators.
      if (c === '&' && (src[i - 1] === '>' || src[i + 1] === '>')) { i++; continue }
      const op = (c === '&' || c === '|') && src[i + 1] === c ? c + c : c
      endSegment(op)
      i += op.length
      continue
    }
    if (c === '>' || c === '<') {
      // A leading fd number (2>) belongs to the redirect, not the command.
      if (word !== null && /^\d+$/.test(word)) word = null
      endWord()
      // `<>x` opens x for writing too.
      const readWrite = c === '<' && src[i + 1] === '>'
      if (src[i + 1] === '>' || src[i + 1] === '|') i++
      if (src[i + 1] === '&') {
        i += 2
        // `2>&1` and `>&-` only move a descriptor; `>&file` writes the file
        // (must 1, 2.12.3 review), with or without a space before it.
        if (/[\d-]/.test(src[i] ?? '')) { while (/\d|-/.test(src[i] ?? '')) i++; continue }
        redirect = true
        continue
      }
      if (c === '>' || readWrite) redirect = true
      else if (src[i + 1] === '<') i++ // here-string: its word is plain data
      i++
      continue
    }
    if (c === ' ' || c === '\t') { endWord(); i++; continue }
    add(c); i++
  }
  endSegment()
  return segments
}

function withoutHeredocBodies(src) {
  let out = src
  const walk = (s) => {
    for (const seg of parseShell(s)) {
      if (seg.subshell) walk(seg.subshell)
      if (seg.heredoc) out = out.replace(seg.heredoc, '')
    }
  }
  walk(src)
  return out
}

// The $(…) and `…` in an unquoted heredoc body (src from start to end), as
// the subshell segments parseShell makes of them on a line. A backslash
// escapes what follows, as in double quotes; $(( … )) is a number.
function heredocSubstitutions(src, start, end) {
  const out = []
  for (let i = start; i < end; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] === '$' && src[i + 1] === '(') {
      const close = Math.min(matchParen(src, i + 1), end)
      const body = src.slice(i + 2, close)
      if (!body.startsWith('(') || /\$\(|`/.test(body.slice(1))) out.push({ subshell: body, words: [], writes: [] })
      i = close
    } else if (src[i] === '`') {
      const close = src.indexOf('`', i + 1)
      const stop = close < 0 || close > end ? end : close
      out.push({ subshell: src.slice(i + 1, stop), words: [], writes: [] })
      i = stop
    }
  }
  return out
}

function matchParen(src, open) {
  let depth = 0
  const heredocs = []
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = /^<<-?\s*['"]?([^\s'"();&|<>]+)['"]?/.exec(src.slice(i))
      if (m) { heredocs.push(m[1]); i += m[0].length - 1; continue }
    }
    if (c === '\n' && heredocs.length) {
      // Heredoc bodies may hold unbalanced quotes and parens: skip them.
      const delim = heredocs.shift()
      let j = i + 1
      while (j < src.length) {
        const nl = src.indexOf('\n', j)
        const line = src.slice(j, nl < 0 ? src.length : nl)
        if (line.replace(/^\t+/, '') === delim) { j = nl < 0 ? src.length : nl; break }
        j = nl < 0 ? src.length : nl + 1
      }
      i = j - 1
      continue
    }
    if (c === "'") { const e = src.indexOf("'", i + 1); if (e < 0) return src.length; i = e; continue }
    if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return src.length
}

function readLinkedRef(cwd) {
  const root = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd()
  try {
    return readFileSync(join(root, TEMP_DIR, 'project-ref'), 'utf8').trim() || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- main

// Run through guard-entry.mjs, which blocks the call if this file can't load.
export async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let result
  try {
    result = decide(JSON.parse(raw))
  } catch (err) {
    // Every call fails closed (yoda's must 5): text built to make the guard
    // throw (2,000 nested `$(`) needn't hold any word a filter could look
    // for, so no call passes on an error. A person fixes the guard.
    result = deny(`guard-production failed (${String(err?.message ?? err).split('\n')[0]}); refusing to be safe.`)
  }
  if (!result) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason,
    },
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
