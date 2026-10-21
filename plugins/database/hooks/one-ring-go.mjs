// Alexander's go for a deploy, read from the session's own transcript (kit
// 1.6, docs/decisions/0001-one-word-deploy.md): his typed `/one-ring <arg>`.
// Claude Code writes every prompt to the transcript with where it came from.
// A prompt he typed (in the app, the terminal or over Remote Control) is a
// user entry with `origin.kind: "human"` and `turnOrigin: "human"`; a message
// from another session is "peer", the first prompt of a session another one
// started is "sdk", a routine "scheduled", a Telegram channel "channel". Only
// the first kind is a go, so no session, routine or relayed message can give
// one, and the guard reads it at the deploy call itself, not from a marker an
// earlier step wrote.
//
// Pure but for readHumanGo, which reads the file: facts in, a go or null out.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, normalize, resolve } from 'node:path'

// Long enough for a deploy whose stops get fixed on the way (red CI fixed and
// pushed, a migration renumbered), short enough that yesterday's go is gone.
export const GO_HOURS = 12
// A clock a little ahead of the file's still reads the entry as now.
const SKEW_MS = 5 * 60_000
// `/special-delivery` is an alias of `/one-ring` since kit 1.6; a plugin skill
// is typed bare or with its plugin's name.
const GO_COMMANDS = new Set(['one-ring', 'release:one-ring', 'special-delivery', 'release:special-delivery'])
// `/one-ring stop` takes the go back.
const STOP_WORDS = new Set(['stop', 'hold', 'cancel'])
// How Claude Code writes a typed slash command into the transcript.
const COMMAND_RE = /^\s*(?:<command-message>[^<]*<\/command-message>\s*)?<command-name>\/([\w:-]+)<\/command-name>\s*<command-args>([^<]*)<\/command-args>\s*$/
// A version (0.14.3.1) or a PR number (34), after a leading V or #.
const ARG_RE = /^\d+(?:\.\d+)*$/

/** The go's argument as the deploy call names it: no leading V or #, no spaces. */
export const goArg = (s) => String(s ?? '').trim().replace(/^[Vv#]/, '')

// A user entry's text, whether Claude Code wrote a string or text blocks.
function entryText(message) {
  const c = message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
  return ''
}

/**
 * The newest `/one-ring <arg>` he typed in this session, or null: none, the
 * newest says stop, its argument isn't a version or a PR number, or it is
 * older than GO_HOURS.
 * @param {string} text  the transcript (JSON lines)
 * @param {{ sessionId?: string, now: number, hours?: number }} opts
 * @returns {{ arg: string, at: number, uuid: string | null } | null}
 */
export function humanGo(text, { sessionId, now, hours = GO_HOURS }) {
  let go = null
  for (const line of String(text ?? '').split('\n')) {
    // Most lines never name the command; JSON.parse only the ones that might.
    if (!line.includes('one-ring') && !line.includes('special-delivery')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e?.type !== 'user' || e.isSidechain || e.isMeta) continue
    if (e.origin?.kind !== 'human' || e.turnOrigin !== 'human') continue
    if (sessionId && e.sessionId !== sessionId) continue
    const m = COMMAND_RE.exec(entryText(e.message))
    if (!m || !GO_COMMANDS.has(m[1])) continue
    const at = Date.parse(e.timestamp)
    if (!Number.isFinite(at)) continue
    // File order is time order: the last one he typed is the one that counts.
    go = { arg: goArg(m[2]), at, uuid: typeof e.uuid === 'string' ? e.uuid : null }
  }
  if (!go || STOP_WORDS.has(go.arg.toLowerCase()) || !ARG_RE.test(go.arg)) return null
  if (now - go.at > hours * 3600_000 || go.at - now > SKEW_MS) return null
  return go
}

/**
 * Whether `path` is this session's own transcript: `<session id>.jsonl` in a
 * folder under ~/.claude/projects/. Claude Code passes the path; this only
 * makes sure the go is never read from another session's file.
 */
export function ownTranscript(path, sessionId, home = homedir()) {
  if (typeof path !== 'string' || typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return false
  const p = normalize(resolve(path))
  return basename(p) === `${sessionId}.jsonl` && dirname(dirname(p)) === join(home, '.claude', 'projects')
}

/** The go in this session's transcript, or null when there is none or it can't be read. */
export function readHumanGo({ transcriptPath, sessionId, now, home, readFile = (f) => readFileSync(f, 'utf8') }) {
  if (!ownTranscript(transcriptPath, sessionId, home)) return null
  let text
  try { text = readFile(transcriptPath) } catch { return null }
  return humanGo(text, { sessionId, now })
}

/** A session transcript (or a subagent's), which only Claude Code writes. */
export const TRANSCRIPT_RE = /(?:^|\/)\.claude\/projects\/[^/]+\/(?:[^/]+\/)*[^/]+\.jsonl$/i
