#!/usr/bin/env node
// The review's repeat greps as one call, printing only hits on a branch's diff
// (F12, kit 1.7.1 council). `kissochbajslowski` and `its-a-trap` each ran the
// same shapes by hand at the start of every review (a 7.4M median run); now
// they start from the hits and spend the look on what greps can't see.
//
// Usage: node review-greps.mjs [--repo <dir>] [--base <ref>] [--version <x.y.z>] [--no-conventions]
// --base: what the branch is compared with (default origin/main, else main).
// --version: the release under review; the project's package.json version must match.
//
// What it runs, each on the added lines of `git diff <base>...HEAD` only:
// - the kit's repeat shapes (kissochbajslowski's quality bar): fractional px in
//   a logo, mark or icon; `navigator.share` outside a share component;
//   `outline-none` with no `focus-visible` on the line; a remove, answer or
//   close handler in a file whose added lines move focus nowhere; events listed
//   in the client with no visibility word in the file's added lines.
// - every backticked grep in the project's `.claude/builder-checks.md`, its
//   pipeline of `grep` and `grep -v` applied to the added lines (its path, such
//   as `src`, or `git diff -- <paths>`, kept; after `git diff` the first grep
//   sees the `+`). A line with no grep, or one this can't read the way the
//   shell would (`^-` removed lines, `git log`, `-e`, `-c`, `--include=`), is a
//   read-by-hand check, only counted.
// - the project's conventions script (`conventions` in `.claude/kit.json`),
//   its output printed when it exits non-zero.
// - `[release-bump]`: package.json's version against --version.
// Prints a table of hits and one count line; "No hits." when clean.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const run0 = (cmd, args, opts) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts })

// Added lines of a unified diff (-U0): [{ file, line, text }].
export function addedLines(diff) {
  const out = []
  let file = null
  let line = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) file = l.slice(4).replace(/^b\//, '')
    else if (l.startsWith('@@')) line = Number(/\+(\d+)/.exec(l)?.[1] || 0)
    else if (l.startsWith('+') && file && file !== '/dev/null') out.push({ file, line: line++, text: l.slice(1) })
    else if (!l.startsWith('-') && !l.startsWith('\\')) line += l.startsWith(' ') ? 1 : 0
  }
  return out
}

const byFile = (lines) => lines.reduce((m, l) => m.set(l.file, [...(m.get(l.file) || []), l]), new Map())

// The kit's own repeat shapes.
export const KIT_CHECKS = [
  { name: 'fractional px in a logo, mark or icon', test: (l) => /\d+\.\d+px/.test(l.text) && (/logo|mark|icon|brand/i.test(l.file) || /logo|mark|wordmark/i.test(l.text)) },
  { name: 'navigator.share outside the shared share menu', test: (l) => /navigator\.share\b/.test(l.text) && !/share/i.test(l.file.split('/').pop()) },
  { name: 'outline-none with no focus-visible on the element', test: (l) => /\boutline-none\b/.test(l.text) && !/focus-visible/.test(l.text) },
  { name: 'remove, answer or close handler; focus moves nowhere in the file', test: (l, fileLines) => /\b(onRemove|onAnswer|handleRemove|handleAnswer|handleDelete|setOpen\(false\))/.test(l.text) && !fileLines.some((x) => /\.focus\(|autoFocus|focusRef|restoreFocus/.test(x.text)) },
  { name: 'events listed in the client with no visibility filter (`[private-nights]`)', test: (l, fileLines) => /\b(events|nights|game_nights)\b.*\.(filter|map|forEach)\(|from\(['"](events|game_nights)['"]\)/.test(l.text) && !/Api\.|\/lib\/|supabase\/|\.sql$|test/i.test(l.file) && !fileLines.some((x) => /visib|private|is_public/i.test(x.text)) },
]

// Shell words of one pipeline segment, quotes kept together.
function words(seg) {
  return [...seg.matchAll(/"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g)].map((m) => (m[1] != null ? m[1].replace(/\\(["\\$`])/g, '$1') : m[2] ?? m[3]))
}

// A grep pattern as a JS RegExp source: BRE swaps the escaped and bare
// meaning of ( ) | { } + ?; POSIX classes become JS ones.
export function toRegExp(pat, { ere = false, fixed = false, ignoreCase = false } = {}) {
  let src = pat
  if (fixed) src = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  else if (!ere) {
    let out = ''
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i]
      if (c === '\\' && i + 1 < pat.length && '(){}|+?'.includes(pat[i + 1])) out += pat[++i]
      else if ('(){}|+?'.includes(c)) out += `\\${c}`
      else if (c === '\\') out += c + (pat[++i] ?? '')
      else out += c
    }
    src = out
  }
  src = src.replace(/\[:space:\]/g, '\\s').replace(/\[:digit:\]/g, '\\d').replace(/\[:alpha:\]/g, 'a-zA-Z').replace(/\[:alnum:\]/g, 'a-zA-Z0-9')
  return new RegExp(src, ignoreCase ? 'i' : '')
}

// grep letters that only change how lines are found or printed. Anything else
// (-e and -f take an argument, -c, -l and -L print counts or names, -w and -x
// change the match, any --long option) is a check this script would misread,
// so its line counts as read by hand (review MUST 3).
const PLAIN_FLAGS = /^-[nrRiEFvHhsI]+$/

// `git diff <ref> [-U<n>] [-- <paths>]`: its paths, or null for any other git
// command or option (`git log`, `--name-only`), whose output isn't diff lines.
function diffPaths(w) {
  if (w[1] !== 'diff') return null
  const sep = w.indexOf('--')
  const opts = sep < 0 ? w.slice(2) : w.slice(2, sep)
  if (opts.some((x) => x.startsWith('-') && !/^-U\d*$/.test(x))) return null
  return sep < 0 ? [] : w.slice(sep + 1)
}

// One builder-checks pipeline as filters: [{ re, negate }], the paths it reads
// (its first grep's, or `git diff -- <paths>`) and whether it reads a diff;
// null when the command has no grep this script can apply.
export function parsePipeline(cmd) {
  const filters = []
  let paths = []
  let diff = false
  for (const [n, seg] of cmd.split(/\s\|\s/).entries()) {
    const w = words(seg.trim())
    if (w[0] === 'git' && n === 0) {
      paths = diffPaths(w)
      if (!paths) return null
      diff = true
      continue
    }
    if (w[0] !== 'grep') return null
    const opts = w.slice(1).filter((x) => x.startsWith('-'))
    if (opts.some((x) => !PLAIN_FLAGS.test(x))) return null
    const flags = opts.join('')
    const rest = w.slice(1).filter((x) => !x.startsWith('-'))
    if (!rest.length) return null
    // A diff's removed lines (`^-`) are never among the added lines read here.
    if (diff && !filters.length && /^\^\\?-/.test(rest[0])) return null
    try {
      filters.push({ re: toRegExp(rest[0], { ere: /E/.test(flags), fixed: /F/.test(flags), ignoreCase: /i/.test(flags) }), negate: /v/.test(flags) })
    } catch {
      return null
    }
    if (filters.length === 1 && !diff) paths = rest.slice(1)
  }
  return filters.length ? { filters, paths, diff } : null
}

// A path from a check against a diff file: a folder or file, or a git pathspec
// glob such as `*.css` (its `*` crosses folders, as git's does).
function underPath(file, d) {
  if (d === '.' || file === d || file.startsWith(`${d.replace(/\/$/, '')}/`)) return true
  if (!d.includes('*')) return false
  return new RegExp(`^${d.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(file)
}

// The checks in a builder-checks.md: one per bullet, with each backticked grep.
export function projectChecks(text) {
  const checks = []
  let manual = 0
  for (const line of text.split('\n')) {
    if (!/^\s*[-*]\s/.test(line)) continue
    const name = (/\*\*([^*]+)\*\*/.exec(line)?.[1] || line.replace(/^\s*[-*]\s+/, '')).slice(0, 80)
    const pipes = [...line.matchAll(/`([^`]*\bgrep\b[^`]*)`/g)].map((m) => parsePipeline(m[1])).filter(Boolean)
    if (!pipes.length) {
      manual += 1
      continue
    }
    // The first grep reads the line; a later one in the pipe reads grep's
    // output, `file:line:text`, so `| grep -v Api` drops a file by its name.
    // After `git diff` the first grep sees the line with its `+`, so a
    // `^\+` pattern matches as it does in the shell.
    for (const p of pipes) checks.push({ name, test: (l) => (!p.paths.length || p.paths.some((d) => underPath(l.file, d))) && p.filters.every((f, i) => f.re.test(i ? `${l.file}:${l.line}:${l.text}` : p.diff ? `+${l.text}` : l.text) !== f.negate) })
  }
  return { checks, manual }
}

export function hitsOf(lines, checks) {
  const files = byFile(lines)
  const hits = []
  for (const c of checks) for (const l of lines) if (c.test(l, files.get(l.file))) hits.push({ check: c.name, where: `${l.file}:${l.line}`, text: l.text.trim() })
  return hits
}

function baseRef(repo, run) {
  for (const ref of ['origin/main', 'main']) {
    try {
      run('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', ref])
      return ref
    } catch {
      // try the next
    }
  }
  return 'main'
}

export function review({ repo, base, version, conventions = true }, run = run0) {
  const ref = base || baseRef(repo, run)
  const lines = addedLines(run('git', ['-C', repo, 'diff', '-U0', `${ref}...HEAD`]))
  const bc = join(repo, '.claude', 'builder-checks.md')
  const project = existsSync(bc) ? projectChecks(readFileSync(bc, 'utf8')) : { checks: [], manual: 0 }
  const hits = hitsOf(lines, [...KIT_CHECKS, ...project.checks])
  const notes = []
  if (version) {
    const pkg = join(repo, 'package.json')
    const have = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : null
    if (have && have !== version) hits.push({ check: '`[release-bump]` version field', where: 'package.json', text: `reads ${have}, the release is ${version}` })
  }
  if (conventions) {
    let script = null
    try {
      script = JSON.parse(readFileSync(join(repo, '.claude', 'kit.json'), 'utf8')).conventions || null
    } catch {
      // no kit.json: no conventions script
    }
    if (script) {
      try {
        run(script.endsWith('.sh') ? 'sh' : 'node', [script], { cwd: repo })
      } catch (e) {
        const out = String(e.stdout || e.stderr || e.message).trim().split('\n').filter(Boolean)
        for (const t of out.slice(0, 40)) hits.push({ check: `conventions (${script})`, where: '-', text: t })
        if (out.length > 40) notes.push(`conventions printed ${out.length - 40} more lines`)
      }
    } else notes.push('no conventions script in kit.json')
  }
  return { ref, lines: lines.length, checks: KIT_CHECKS.length + project.checks.length, manual: project.manual, hits, notes }
}

export function render(r) {
  const out = []
  if (r.hits.length) {
    out.push('| Check | Where | Line |', '|---|---|---|')
    for (const h of r.hits) out.push(`| ${h.check.replace(/\|/g, '/')} | ${h.where} | ${h.text.slice(0, 140).replace(/\|/g, '/')} |`)
    out.push('')
  } else out.push('No hits.', '')
  out.push(`${r.hits.length} hits on ${r.lines} added lines (vs ${r.ref}) from ${r.checks} grep checks; ${r.manual} builder-checks lines have no grep and are read by hand${r.notes.length ? `; ${r.notes.join('; ')}` : ''}.`)
  return out.join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const o = { repo: process.cwd(), base: null, version: null, conventions: true }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') o.repo = resolve(argv[++i])
    else if (argv[i] === '--base') o.base = argv[++i]
    else if (argv[i] === '--version') o.version = argv[++i]
    else if (argv[i] === '--no-conventions') o.conventions = false
    else {
      console.log('Usage: node review-greps.mjs [--repo <dir>] [--base <ref>] [--version <x.y.z>] [--no-conventions]')
      process.exit(argv[i] === '--help' || argv[i] === '-h' ? 0 : 1)
    }
  }
  console.log(render(review(o)))
}

if (process.argv[1] && import.meta.url === pathToFileURL((await import('node:fs')).realpathSync(process.argv[1])).href) main()
