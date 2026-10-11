// Does the project run its own copy of this hook? A project that registers
// its own copy in `.claude/settings.json` (Hutzup's frozen `.claude/hooks/`)
// and also loads the kit live would otherwise run both on every call: two
// guards that may disagree, two Hanks, double prompts (Hutzup 3.3.3). Then
// the kit's copy steps aside and the project's own decides.
//
// Fails closed: only a clear yes steps aside. No project dir, a settings file
// that is missing, unreadable or malformed, no registration, a registration
// that leaves out one of the kit's own matchers, or a registered file that
// isn't there all mean "no", and the kit's hook runs as before.
//
// The same file sits in the release and database plugins (a hook may only run
// files inside its own plugin); step-aside.test.mjs keeps the two equal.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A matcher that catches every tool covers any matcher of the kit's.
const CATCH_ALL = new Set(['', '*', '.*'])

/** [event, matcher, command] for every command hook in a `hooks` object. */
function registrations(hooks) {
  const out = []
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return out
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) continue
      const matcher = typeof entry.matcher === 'string' ? entry.matcher : ''
      for (const hook of entry.hooks) {
        if (hook && typeof hook.command === 'string') out.push([event, matcher, hook.command])
      }
    }
  }
  return out
}

/**
 * True when the project registers its own copy of the kit hook `kitName` for
 * every event and matcher the kit's hooks.json registers it for, and that
 * copy exists under the project's `.claude/hooks/`.
 * @param {{ kitName: string, names?: string[], projectDir?: string, kitHooks?: string | URL }} opts
 *   names: the file names the project's copy may go by (the guard: guard-entry.mjs or guard-production.mjs)
 */
export function projectOwns({ kitName, names = [kitName], projectDir = process.env.CLAUDE_PROJECT_DIR, kitHooks = new URL('./hooks.json', import.meta.url) }) {
  try {
    if (!projectDir) return false
    const settings = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8'))
    const kit = JSON.parse(readFileSync(kitHooks, 'utf8'))
    const kitRe = new RegExp(`hooks[\\\\/]${escape(kitName)}(?![\\w.-])`)
    const needs = registrations(kit?.hooks).filter(([, , command]) => kitRe.test(command))
    if (!needs.length) return false
    // The project's copy: a command that is exactly `node "${CLAUDE_PROJECT_DIR}/.claude/hooks/<name>"`
    // (quotes optional, `$CLAUDE_PROJECT_DIR` too), whose file is there. Anchored
    // whole, so a command that only names the file (`echo …`, `# node …`,
    // `exit 0; node …`, another folder's copy) never makes the kit's hook step aside.
    const present = names.filter((name) => existsSync(join(projectDir, '.claude', 'hooks', name)))
    if (!present.length) return false
    const projectRe = new RegExp(`^\\s*node\\s+("?)(?:\\$\\{CLAUDE_PROJECT_DIR\\}|\\$CLAUDE_PROJECT_DIR)/\\.claude/hooks/(?:${present.map(escape).join('|')})\\1\\s*$`)
    const have = registrations(settings?.hooks).filter(([, , command]) => projectRe.test(command))
    return needs.every(([event, matcher]) => have.some(([e, m]) => e === event && (m === matcher || CATCH_ALL.has(m))))
  } catch {
    return false
  }
}
