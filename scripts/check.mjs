#!/usr/bin/env node
// The kit's own check: run before a release of the wolfpack marketplace
// (by hand: no CI job runs it). Node only, no dependencies, and it never calls `claude` (a nested claude
// is refused in our sessions); `claude plugin validate` stays a human step.
//
// The layout it checks, from the Claude Code plugin docs (code.claude.com,
// plugins/components, plugins/publish, hooks; looked up 4 Oct 2026):
// - a plugin is a folder with `.claude-plugin/plugin.json`. Claude Code needs
//   only `name`; we also require `version` (the installed release) and
//   `description` (the text `/plugin` shows), and the name must be the folder's.
// - components sit at the plugin root, not inside `.claude-plugin/`:
//   `agents/*.md`, `skills/<name>/SKILL.md`, `commands/*.md`, `hooks/hooks.json`.
//   Each markdown file opens with `---` frontmatter; we require `name` and
//   `description` even where Claude Code would fall back to the file name.
// - `hooks/hooks.json` is `{ "hooks": { "<Event>": [ { "matcher", "hooks": [
//   { "type": "command", "command", "args"?, "timeout"? } ] } ] } }`, and a
//   plugin reaches its own files through `${CLAUDE_PLUGIN_ROOT}`.
// - `.claude-plugin/marketplace.json` at the marketplace root has `name`,
//   `owner` and `plugins: [{ name, source, version? }]`; a relative `source`
//   resolves from the marketplace root. When both versions are set the
//   plugin.json one wins silently, so a mismatch here is a release that
//   doesn't say what it ships.
//
// Usage: node kit/scripts/check.mjs [kitDir] — prints `file:line  reason` per
// problem and exits 1, or a one-line summary and exits 0.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDrift } from './drift.mjs'

// Built from parts so this file doesn't flag itself in the secrets grep.
const SECRET_PATTERNS = [
  [new RegExp('ey' + 'J[A-Za-z0-9_-]{20,}'), 'looks like a JWT'],
  [new RegExp('sk' + '-ant-'), 'looks like an Anthropic key'],
  [new RegExp('sb' + 'p_[A-Za-z0-9]'), 'looks like a Supabase access token'],
  [new RegExp('sb' + '_secret_'), 'looks like a Supabase secret key'],
  [new RegExp('service' + '_role[^\\n]{0,40}?[A-Za-z0-9_.-]{30,}'), 'service role next to a key-looking value'],
]

const TEXT_SKIP = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?)$/i

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

// JSON.parse reports a character position; turn it into a line for the report.
function parseJson(file, problems, rel) {
  const text = readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    const pos = /position (\d+)/.exec(err.message)
    const line = pos ? text.slice(0, Number(pos[1])).split('\n').length : 1
    problems.push(`${rel(file)}:${line}  does not parse: ${err.message}`)
    return undefined
  }
}

function frontmatter(text) {
  const lines = text.split('\n')
  if (lines[0].trim() !== '---') return null
  const keys = {}
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return keys
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (m) keys[m[1]] = m[2].trim()
  }
  return null
}

function checkMarkdown(file, problems, rel) {
  const fm = frontmatter(readFileSync(file, 'utf8'))
  if (!fm) return problems.push(`${rel(file)}:1  no frontmatter (--- … ---)`)
  for (const key of ['name', 'description']) {
    if (!fm[key]) problems.push(`${rel(file)}:1  frontmatter has no ${key}`)
  }
}

// A hook command may only run files inside its own plugin: the kit is
// installed into other people's projects, and a path into their `.claude/`
// (or anywhere outside the plugin) would run whatever happens to live there.
function checkHookCommand(cmd, pluginDir, file, line, problems, rel) {
  if (/\.claude\//.test(cmd)) problems.push(`${rel(file)}:${line}  hook command reaches into a .claude/ folder: ${cmd}`)
  if (/\$\{?CLAUDE_PROJECT_DIR\}?/.test(cmd)) problems.push(`${rel(file)}:${line}  hook command reaches outside its plugin: ${cmd}`)
  if (/(^|\s)\/(?!dev\/null)/.test(cmd)) problems.push(`${rel(file)}:${line}  hook command uses an absolute path: ${cmd}`)
  for (const m of cmd.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"'`;|&)]+)/g)) {
    const target = resolve(pluginDir, m[1])
    if (target !== pluginDir && !target.startsWith(pluginDir + sep)) {
      problems.push(`${rel(file)}:${line}  hook command reaches outside its plugin: ${m[0]}`)
    } else if (!existsSync(target)) {
      problems.push(`${rel(file)}:${line}  hook command points at a missing file: ${m[0]}`)
    }
  }
}

function checkHooks(file, pluginDir, problems, rel) {
  const json = parseJson(file, problems, rel)
  if (json === undefined) return
  const lines = readFileSync(file, 'utf8').split('\n')
  const lineOf = (needle) => Math.max(1, lines.findIndex((l) => l.includes(needle)) + 1)
  if (!json || typeof json.hooks !== 'object') return problems.push(`${rel(file)}:1  no "hooks" object`)
  for (const groups of Object.values(json.hooks)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const parts = [hook?.command, ...(Array.isArray(hook?.args) ? hook.args : [])].filter((p) => typeof p === 'string')
        for (const part of parts) checkHookCommand(part, pluginDir, file, lineOf(JSON.stringify(part).slice(1, -1)), problems, rel)
      }
    }
  }
}

function checkPlugin(pluginDir, problems, rel) {
  const folder = pluginDir.split(sep).pop()
  const manifest = join(pluginDir, '.claude-plugin', 'plugin.json')
  let version
  if (!existsSync(manifest)) {
    problems.push(`${rel(pluginDir)}:1  no .claude-plugin/plugin.json`)
  } else {
    const json = parseJson(manifest, problems, rel)
    if (json !== undefined) {
      for (const key of ['name', 'version', 'description']) {
        if (typeof json?.[key] !== 'string' || !json[key]) problems.push(`${rel(manifest)}:1  plugin.json has no ${key}`)
      }
      if (json?.name && json.name !== folder) problems.push(`${rel(manifest)}:1  name "${json.name}" is not the folder's "${folder}"`)
      version = json?.version
    }
  }
  const agents = join(pluginDir, 'agents')
  const commands = join(pluginDir, 'commands')
  const skills = join(pluginDir, 'skills')
  for (const dir of [agents, commands]) {
    for (const f of walk(dir)) if (f.endsWith('.md') && dirname(f) === dir) checkMarkdown(f, problems, rel)
  }
  if (existsSync(skills)) {
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skill = join(skills, entry.name, 'SKILL.md')
      if (existsSync(skill)) checkMarkdown(skill, problems, rel)
      else problems.push(`${rel(join(skills, entry.name))}:1  skill folder has no SKILL.md`)
    }
  }
  const hooks = join(pluginDir, 'hooks', 'hooks.json')
  if (existsSync(hooks)) checkHooks(hooks, pluginDir, problems, rel)
  return version
}

function checkMarketplace(kitDir, versions, problems, rel) {
  const file = join(kitDir, '.claude-plugin', 'marketplace.json')
  if (!existsSync(file)) return
  const json = parseJson(file, problems, rel)
  if (json === undefined) return
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const entry of Array.isArray(json?.plugins) ? json.plugins : []) {
    const line = Math.max(1, lines.findIndex((l) => l.includes(`"${entry?.name}"`)) + 1)
    // Only relative sources live in this repo; github/url sources aren't ours to check.
    if (typeof entry?.source !== 'string') continue
    const dir = resolve(kitDir, entry.source)
    if (!existsSync(dir)) {
      problems.push(`${rel(file)}:${line}  source ${entry.source} does not exist`)
      continue
    }
    const shipped = versions.get(dir)
    if (entry.version !== undefined && shipped !== undefined && entry.version !== shipped) {
      problems.push(`${rel(file)}:${line}  ${entry.name} is ${entry.version} here but ${shipped} in its plugin.json`)
    }
  }
}

// The kit is public: it carries placeholders, and each project's own values
// sit in its `.claude/kit.json`. Those values are read from there (never
// written here), so this file stays generic too.
//
// Two kinds of value come back. Long strings (refs, keychain names, the
// production URL and its host) are matched as plain substrings: they are
// distinctive enough that any hit is a leak. Short ones (the dev port, the
// member noun) would hit everywhere as substrings, so they come back as
// word-bounded patterns: the port only as a whole number (`:<port>`, not
// inside a longer number or a hash), the noun as a whole word with an optional
// plural, case-insensitive, because a project's noun leaks just as much in a
// lower-case slug or host (`<noun>-dev-db-url`) as in a sentence.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function projectValues(kitJsonPath) {
  let values = []
  const patterns = []
  try {
    const kit = JSON.parse(readFileSync(kitJsonPath, 'utf8'))
    values = [...Object.values(kit.refs ?? {}), ...Object.values(kit.keychain ?? {})]
    const prod = kit.urls?.prod
    if (typeof prod === 'string' && prod) {
      values.push(prod)
      // The bare host leaks too (in prose, with no scheme).
      try {
        values.push(new URL(prod).host)
      } catch {
        // not a full URL: the string itself is enough
      }
    }
    const noun = kit.project?.noun
    if (typeof noun === 'string' && noun.trim().length >= 3) {
      patterns.push(new RegExp(`\\b${escape(noun.trim())}s?\\b`, 'i'))
    }
    const port = kit.project?.devPort
    if (/^\d{2,5}$/.test(String(port ?? ''))) patterns.push(new RegExp(`(?<![\\w.])${port}(?![\\w])`))
  } catch {
    // no kit.json: fall through to the hook's constant
  }
  // Production's ref also lives in the project's own hook (PROD_REF), which
  // the kit.json of an older checkout may not list. Read it as text, never
  // import it: the hook is the project's and must not run from here.
  try {
    const hook = readFileSync(join(dirname(kitJsonPath), 'hooks', 'production-steps.mjs'), 'utf8')
    const m = /PROD_REF\s*=\s*['"]([^'"]+)['"]/.exec(hook)
    if (m) values.push(m[1])
  } catch {
    // the project has no such hook
  }
  return [...[...new Set(values)].filter((v) => typeof v === 'string' && v.length >= 6), ...patterns]
}

// A value is a plain string (substring match) or a RegExp (word-bounded).
const hits = (text, v) => (v instanceof RegExp ? v.test(text) : text.includes(v))

function checkSecrets(kitDir, values, problems, rel) {
  for (const file of walk(kitDir)) {
    if (TEXT_SKIP.test(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      for (const [re, why] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${rel(file)}:${i + 1}  ${why}`)
      for (const v of values) if (hits(text, v)) problems.push(`${rel(file)}:${i + 1}  a project value (from .claude/kit.json): use a placeholder`)
    })
  }
}

export function checkKit(kitDir, { values = [], base = process.cwd() } = {}) {
  const problems = []
  const rel = (p) => relative(base, p) || '.'
  const pluginsDir = join(kitDir, 'plugins')
  // A folder with no files yet is a plugin being started, not a broken one.
  const plugins = existsSync(pluginsDir)
    ? readdirSync(pluginsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && walk(join(pluginsDir, e.name)).length > 0)
        .map((e) => join(pluginsDir, e.name))
    : []
  const versions = new Map()
  for (const dir of plugins) versions.set(dir, checkPlugin(dir, problems, rel))
  checkMarketplace(kitDir, versions, problems, rel)
  checkSecrets(kitDir, values, problems, rel)
  return { problems, plugins: plugins.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kitDir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const values = projectValues(join(process.cwd(), '.claude', 'kit.json'))
  const { problems, plugins } = checkKit(kitDir, { values })
  // The project's guard against the kit's copy (drift.mjs); the repo is the
  // folder above kit/, and a kit checked on its own skips with one line.
  const drift = checkDrift(dirname(kitDir))
  if (drift.skipped) console.log(drift.reason)
  for (const p of drift.pairs) {
    if (p.same) continue
    const where = p.missing ? `${p.kit}:1` : `${p.first.file}:${p.first.line}`
    const what = p.missing ? `${p.missing} is missing` : `${p.lines} lines differ`
    problems.push(`${where}  drifted from ${p.hutzup}: ${what} (node kit/scripts/drift.mjs)`)
  }
  for (const p of problems) console.log(p)
  if (problems.length) process.exit(1)
  console.log(plugins ? `kit ok: ${plugins} plugin${plugins === 1 ? '' : 's'}` : 'no plugins yet')
}
