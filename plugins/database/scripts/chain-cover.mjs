#!/usr/bin/env node
// Kit copy: values from .claude/kit.json (refs, keychain, backupRoot, urls.prod, pluginRoot)
//
// Does the chain's tap still cover a release's deploy? Read-only: it prints
// and exits, it never writes a marker or a setting.
//
// Usage: node scripts/chain-cover.mjs <version>
//   exit 0  covered: the arm order to ranjit and the one-tap arm can pass
//   exit 1  not covered: says why, which frozen files moved since the tap,
//           and what a person does about it
//   exit 2  usage, or no chain-arm.mjs to read
//
// Why it exists: in a chain both deploy+wrap links once stalled at the arm.
// The guard allows the arm-and-go order and the one-tap arm only while the
// chain marker holds, and the marker holds only while the frozen set hashes
// as it did at the tap. The frozen set includes .claude/settings.local.json,
// which changed whenever a prompt was approved with "don't ask again". Once
// it moved, the guard gave no decision, so Auto mode's classifier judged the
// order and refused it. Now its allow lines don't count in the hash; a hook,
// a deny or ask rule, defaultMode or env there still do. A link runs this at
// its first step, so a lost cover is reported before any planning, not found
// at the arm.
//
// The kit ships this file inside a plugin, so neither the project nor the
// hooks sit at a fixed path from it: the root is CLAUDE_PROJECT_DIR, else the
// git checkout it runs in, and chain-arm.mjs is found the way
// scripts/full-auto.sh finds it.

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, statSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function fail(message) {
  process.stderr.write(`chain-cover: ${message}\n`)
  process.exit(2)
}

// As the hooks find the project (projectRoot): CLAUDE_PROJECT_DIR when it
// names a folder, so this reads the markers the guard reads; else the git
// checkout it runs in.
function gitRoot() {
  const dir = process.env.CLAUDE_PROJECT_DIR
  if (dir) {
    try { if (statSync(dir).isDirectory()) return realpathSync(dir) } catch { /* not a folder: git's */ }
  }
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return fail("run this inside the project's git checkout")
  }
}

const REPO_ROOT = gitRoot()
// chain-arm.mjs honours it, so a plugin copy reads this project's files.
process.env.CLAUDE_PROJECT_DIR = REPO_ROOT

const expandHome = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
const hasArm = (dir) => existsSync(join(dir, 'chain-arm.mjs'))

// The folder holding chain-arm.mjs: kit.json's pluginRoot (set but wrong is
// an error, never a quiet fallback), the plugin this file ships in, then the
// database@wolfpack plugin installed for this project or for the user, then
// .claude/hooks/. The
// marketplace's clone is left out: it exists whether or not this project
// installed the plugin, so it would shadow a project's own hooks.
function hooksDir() {
  const kitPath = join(REPO_ROOT, '.claude', 'kit.json')
  let kit = {}
  if (existsSync(kitPath)) {
    try { kit = JSON.parse(readFileSync(kitPath, 'utf8')) } catch { fail(`${kitPath} isn't valid JSON`) }
  }
  if (typeof kit?.pluginRoot === 'string' && kit.pluginRoot !== '') {
    const root = expandHome(kit.pluginRoot)
    const dir = join(isAbsolute(root) ? root : join(REPO_ROOT, root), 'hooks')
    if (!hasArm(dir)) fail(`kit.json's pluginRoot (${root}) has no hooks/chain-arm.mjs`)
    return dir
  }
  // The plugin this file ships in (<plugin>/scripts/), told apart from a
  // project's own scripts/ by the plugin.json beside its hooks.
  const own = join(dirname(fileURLToPath(import.meta.url)), '..')
  if (existsSync(join(own, '.claude-plugin', 'plugin.json')) && hasArm(join(own, 'hooks'))) return realpathSync(join(own, 'hooks'))
  let entries = []
  try {
    const installed = JSON.parse(readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
    entries = installed?.plugins?.['database@wolfpack'] ?? []
  } catch { /* no plugins installed: fall through */ }
  const pick = entries.find((e) => e.projectPath === REPO_ROOT) ?? entries.find((e) => e.scope === 'user')
  if (pick?.installPath && hasArm(join(pick.installPath, 'hooks'))) return join(pick.installPath, 'hooks')
  const local = join(REPO_ROOT, '.claude', 'hooks')
  if (hasArm(local)) return local
  return fail('no chain-arm.mjs: set pluginRoot in .claude/kit.json, install the database plugin, or keep the hooks in .claude/hooks/')
}

// Loaded at import, as the static import was, so coverReport stays pure and
// its test needs no setup. The hash is frozenOnDisk, the one the tap, the
// one-tap arm and the guard compare: as a plugin it adds the plugin's
// name@version line, which frozenHash(readFrozen()) alone leaves out, so a
// plugin run would never match its own tap. readFrozen stays for the mtimes.
const { chainWhyNot, frozenOnDisk, readFrozen } = await import(pathToFileURL(join(hooksDir(), 'chain-arm.mjs')).href)

const CHAIN_MARKER = join(REPO_ROOT, '.claude', 'full-auto-chain.json')
const VERSION_RE = /^V?\d+(?:\.\d+)*$/
const LOCAL_SETTINGS = '.claude/settings.local.json'

/**
 * The verdict, from facts only (pure, so the test needs no disk).
 * @param {{ version: string, chain: object | null, now: number, hash: string | null,
 *           mtimes: { path: string, mtime: number }[] }} facts
 * @returns {{ covered: boolean, lines: string[] }}
 */
export function coverReport({ version, chain, now, hash, mtimes }) {
  const v = version.replace(/^V/, '')
  if (chain === null) return { covered: false, lines: [`V${v}: not covered: no chain marker (nothing is armed).`] }
  if (!Array.isArray(chain?.versions) || !Array.isArray(chain?.done)) return { covered: false, lines: [`V${v}: not covered: the chain marker is unreadable.`] }
  if (!chain.versions.includes(v)) return { covered: false, lines: [`V${v}: not covered: the tap armed ${chain.versions.join(', ')}, not V${v}.`] }
  if (chain.done.includes(v)) return { covered: false, lines: [`V${v}: already deployed in this chain.`] }
  if (chain.finished) return { covered: false, lines: [`V${v}: not covered: the chain is finished.`] }
  const why = chainWhyNot(chain, now, hash)
  if (!why) return { covered: true, lines: [`V${v}: covered by the tap of ${chain.armedAt}.`] }
  const lines = [`V${v}: not covered: ${why}.`]
  const armed = Date.parse(chain.armedAt)
  const moved = mtimes.filter((m) => Number.isFinite(armed) && m.mtime > armed).sort((a, b) => a.mtime - b.mtime)
  if (moved.length > 0) {
    lines.push(`Changed after the tap (${chain.armedAt}):`)
    for (const m of moved) lines.push(`  ${m.path}  ${new Date(m.mtime).toISOString()}`)
  }
  if (moved.some((m) => m.path === LOCAL_SETTINGS)) {
    // Its mtime also moves for an allow line, which the hash ignores, so the
    // line says what would have counted rather than blaming the approval.
    lines.push(`${LOCAL_SETTINGS} moved too, but only a change beside its allow lines moves the hash ("don't ask again" no longer does): a hook, a deny or ask rule, defaultMode or env. Never edit it back by hand: the guard asks about it, and a revert is a change too.`)
  }
  const left = chain.versions.filter((x) => !chain.done.includes(x))
  lines.push('So the arm order to ranjit gets no allow from the guard (Auto mode refuses it) and the arm asks a person.')
  // arm-chain refuses while any marker is on disk (full-auto.sh), so the
  // stale one goes first; arm-chain then keeps one generation of each log.
  lines.push(`To go on without a tap at the deploy, on a person's go: scripts/full-auto.sh disarm, then scripts/full-auto.sh arm-chain ${left.join(' ')} (each as its own call; the tap is the arm-chain).`)
  return { covered: false, lines }
}

// Modification times of the frozen set's files that exist, for the report.
function frozenMtimes(files) {
  return files.flatMap(({ path }) => {
    try { return [{ path, mtime: statSync(join(REPO_ROOT, path)).mtimeMs }] } catch { return [] }
  })
}

function main() {
  const [version, ...rest] = process.argv.slice(2)
  if (!version || rest.length > 0 || !VERSION_RE.test(version)) {
    process.stderr.write('usage: node scripts/chain-cover.mjs <version>\n')
    process.exit(2)
  }
  let chain = null
  try { chain = JSON.parse(readFileSync(CHAIN_MARKER, 'utf8')) } catch (err) { chain = err?.code === 'ENOENT' ? null : {} }
  let files = []
  let hash = null
  try { files = readFrozen(REPO_ROOT) } catch { /* unread: no mtimes to show */ }
  try { hash = frozenOnDisk(REPO_ROOT) } catch { /* unread: differs from any tap */ }
  const { covered, lines } = coverReport({ version, chain, now: Date.now(), hash, mtimes: frozenMtimes(files) })
  process.stdout.write(lines.join('\n') + '\n')
  process.exit(covered ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
