// The commands on the guard's read list (kit 1.7, H5), in a file of their own
// so guard-production.mjs and denied-log.mjs read the same list. The guard
// allows these when their operands pass its checks; denied-log --summary
// never suggests an allow line for them, since a repeat of one reaches the
// classifier only when the guard refused its operands, and a wildcard rule
// would let those through (`Bash(git diff *)` passes
// `git diff /dev/null ~/.ssh/id_rsa`; kit 1.7 review, round 3).

/** git subcommands gitRead may list. */
export const GIT_READS = new Set(['status', 'log', 'show', 'diff', 'cat-file', 'ls-tree', 'rev-parse'])
/** Tools textRead judges by their paths. */
export const TEXT_READS = new Set(['grep', 'rg', 'wc'])
/** Filters a pipe may end in. */
export const PIPE_FILTERS = new Set(['head', 'tail'])
/** `gh pr <sub>` reads. */
export const GH_PR_READS = new Set(['view', 'checks'])

/**
 * Whether a command's words start with a read the guard lists (or a gh pr
 * read next to them: diff and list).
 * @param {string[]} words
 */
export function guardListedHead(words) {
  const [cmd, a, b] = words
  if (cmd === 'git') return words.slice(1).some((w) => GIT_READS.has(w))
  if (TEXT_READS.has(cmd) || PIPE_FILTERS.has(cmd)) return true
  return cmd === 'gh' && a === 'pr' && (GH_PR_READS.has(b) || b === 'diff' || b === 'list')
}
