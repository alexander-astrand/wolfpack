// FROZEN: the one set of files that decide what full auto may do, kept in its
// own small module so the guard and the chain arm read one list (council M8).
// chain-arm.mjs re-exports FROZEN, FROZEN_RE and projectRoot, so no importer
// changes. projectRoot is defined in production-steps.mjs; it is passed
// through here so the three names live together.
//
// The guard asks a person before any change to it (and refuses one while a
// marker exists), the tap records its hash so a chain stops when it changes,
// and a release that changes it never arms on the tap: it taps at its arm.

export { projectRoot } from './production-steps.mjs'

// A folder ends in '/'. Repo-relative, as git ls-files prints them.
export const FROZEN = [
  '.claude/hooks/',
  '.claude/settings.json',
  '.claude/settings.local.json',
  // The project's values (dev ref, deployer, Keychain items): the guard
  // trusts them, so an agent that could edit refs.dev could make production
  // look like dev (the kit, 2.14.7). Hashed by its trusted keys only
  // (kitJsonForHash).
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
export const FROZEN_PATH_RE = new RegExp(`^(?:${FROZEN_ALT})`, 'i')
