// The one finder of a release's sessions, shared by wrap-facts (core) and
// budgets-derive (release), so the two never disagree on which sessions a
// release ran (kit 1.10). Two sources:
//   1. ids the plan, build log or PR texts name as sessions: a `local_<uuid>`,
//      or a uuid with the word "session" or "transcript" on the same line. Any
//      uuid at all was read before, and the kit 1.9 wrap listed the Vercel
//      connector's uuid (a test fixture in the plan) as a missing session.
//   2. transcripts whose session title is `<project> · <kind> · <version>`,
//      read from the transcript's own `custom-title` lines (what
//      set_session_title writes; the last one wins). The kit 1.9 plan named
//      no session at all, so its release session 0ee31d09 was found only here.
//      The transcripts are the source, not the desktop app's session store, so
//      a delphi run finds them too.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const UUID = /\b(?:local_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const NAMED_AS_SESSION = /\b(sessions?|transcripts?)\b/i

/** Session ids named as sessions in some texts, in order, once each. */
export function sessionIds(...texts) {
  const out = []
  for (const line of texts.join('\n').split('\n')) {
    const ids = line.match(UUID) ?? []
    const named = NAMED_AS_SESSION.test(line)
    for (const id of ids) if (named || /^local_/i.test(id)) out.push(id)
  }
  return [...new Set(out)]
}

/** "V1.8", "Kit 1.8", "kit-1.8" and "1.8" all mean 1.8. */
export const bareVersion = (version) => String(version).trim().replace(/^(v|kit[ -]?)/i, '')

// "1.7" in a title, but not "1.7.1" or "11.7".
export const titleHas = (title, version) => {
  const v = bareVersion(version).replace(/\./g, '\\.')
  return new RegExp(`(^|[^0-9.])v?${v}(?![0-9]|\\.[0-9])`, 'i').test(title ?? '')
}

/** A session title's parts: `wolfpack · release · kit-1.9 · delphi` is { project, kind, rest: 'kit-1.9' }; null when it isn't that shape. */
export function titleParts(title) {
  const parts = String(title ?? '').split(' · ').map((p) => p.trim())
  if (parts.length < 3 || !parts[0] || !parts[1]) return null
  if (parts.length > 3 && parts.at(-1) === 'delphi') parts.pop()
  return { project: parts[0], kind: parts[1].toLowerCase(), rest: parts.slice(2).join(' · ') }
}

/** True when a title is `<project> · <kind> · <version …>` for this version (any kind). */
export const titleNamesVersion = (title, version) => {
  const p = titleParts(title)
  return Boolean(p) && titleHas(p.rest, version)
}

/** True when a title is a release session's: `<project> · release · <version>`. */
export const isReleaseTitle = (title) => titleParts(title)?.kind === 'release'

/** A transcript's title from its parsed entries: the last `custom-title`, else the first `agent-name`. */
export function titleOfEntries(entries) {
  let title = null
  for (const e of entries) {
    if (e?.type === 'custom-title' && e.customTitle) title = e.customTitle
    else if (e?.type === 'agent-name' && e.agentName && !title) title = e.agentName
  }
  return title
}

/** The same from a transcript's text, parsing only the title lines (a release transcript runs to megabytes). */
export function titleOfText(text) {
  const entries = []
  for (const line of String(text).split('\n')) {
    if (!line.includes('"custom-title"') && !line.includes('"agent-name"')) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // a torn line: the others still say the title
    }
  }
  return titleOfEntries(entries)
}

const defaultGit = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/**
 * The main checkout of the repo `project` sits in, or null. A lane or worktree
 * (`~/wolfpack-lanes/a`) has a transcript folder of its own name, which the
 * main checkout's prefix covers but its own does not (kit 1.10: run from lane
 * A, the kit 1.9 release session in `-Users-…-wolfpack` was not seen).
 */
export function mainCheckout(project, git = defaultGit) {
  try {
    const common = git(['-C', project, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
    return basename(common) === '.git' ? dirname(common) : null
  } catch {
    return null
  }
}

/** Claude Code's folder-name prefix for a path, worktree suffix dropped. */
export const folderPrefix = (path) => path.replace(/[^A-Za-z0-9]/g, '-').replace(/--claude-worktrees-.*$/, '')

/** The project's transcript folders: its own, its main checkout's and every worktree's and lane's (they share the prefix). */
export function projectFolders(project, { projectsDir = join(homedir(), '.claude', 'projects'), git } = {}) {
  const prefixes = [...new Set([project, mainCheckout(project, git)].filter(Boolean).map(folderPrefix))]
  let names = []
  try {
    names = readdirSync(projectsDir)
  } catch {
    return []
  }
  return names.filter((d) => prefixes.some((p) => d === p || d.startsWith(`${p}-`))).sort().map((d) => join(projectsDir, d))
}

/** Every top-level transcript in some folders with its title: [{ id, dir, title }]. */
export function titledTranscripts(dirs) {
  const out = []
  for (const dir of dirs) {
    let files = []
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      let text = ''
      try {
        text = readFileSync(join(dir, f), 'utf8')
      } catch {
        continue
      }
      const title = titleOfText(text)
      if (title) out.push({ id: f.slice(0, -'.jsonl'.length), dir, title })
    }
  }
  return out
}

/**
 * A release's session ids: the ones the texts name as sessions, then the
 * transcripts whose title names the version. { named, titled: [{ id, dir, title }], ids }
 */
export function releaseSessionIds(project, version, { texts = [], projectsDir, git } = {}) {
  const named = sessionIds(...texts)
  const titled = titledTranscripts(projectFolders(project, { projectsDir, git })).filter((t) => titleNamesVersion(t.title, version))
  return { named, titled, ids: [...new Set([...named, ...titled.map((t) => t.id)])] }
}
