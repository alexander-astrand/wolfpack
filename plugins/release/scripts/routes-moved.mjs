#!/usr/bin/env node
// Every route file a branch moves, for the README grep (jedi-council 1.9 F8): c-3po greps the README
// for each old route, so a renamed or deleted page cannot leave a dead link behind.
//
//   node <release>/scripts/routes-moved.mjs [--base main] [--repo <dir>] [--routes src/routes,app/]
//
// Reads `git diff --name-status <base>...HEAD` and keeps adds, deletes and renames under the routes
// folders: `src/routes`, `app/`, `pages/`, `src/pages` by default, or `routes` in .claude/kit.json when
// it is a list of folders. Prints one line each: `old -> new` (renamed), `- old` (deleted), `+ new` (added).
// Edits to a route file that stay in place are not moves and are not printed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_ROUTES = ['src/routes', 'app/', 'pages/', 'src/pages']

export function parseArgs(argv) {
  const o = { base: 'main', repo: process.cwd(), routes: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') o.base = argv[++i]
    else if (a === '--repo') o.repo = argv[++i]
    else if (a === '--routes') o.routes = argv[++i].split(',').filter(Boolean)
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

export function routeFolders(repo) {
  const file = join(repo, '.claude', 'kit.json')
  if (existsSync(file)) {
    try {
      const r = JSON.parse(readFileSync(file, 'utf8')).routes
      if (Array.isArray(r) && r.length && r.every((x) => typeof x === 'string')) return r
    } catch {
      // an unreadable kit.json falls back to the defaults
    }
  }
  return DEFAULT_ROUTES
}

const under = (path, folders) => folders.some((f) => (f.endsWith('/') ? path.startsWith(f) : path === f || path.startsWith(`${f}/`)))

// nameStatus: the text of `git diff --name-status` (tab separated). Pure, so the test needs no git.
export function movedRoutes(nameStatus, folders) {
  const out = []
  for (const line of nameStatus.split('\n')) {
    const [code, a, b] = line.split('\t')
    if (!code) continue
    if (code[0] === 'R') {
      // A rename out of or into a routes folder is a move of the route either way.
      if (under(a, folders) || under(b, folders)) out.push(`${a} -> ${b}`)
    } else if (code === 'D' && under(a, folders)) out.push(`- ${a}`)
    else if (code === 'A' && under(a, folders)) out.push(`+ ${a}`)
  }
  return out
}

export function main(argv, out = console.log) {
  const o = parseArgs(argv)
  const text = execFileSync('git', ['-C', o.repo, 'diff', '--name-status', '-M', `${o.base}...HEAD`], { encoding: 'utf8' })
  const lines = movedRoutes(text, o.routes ?? routeFolders(o.repo))
  for (const l of lines) out(l)
  if (!lines.length) out('no route moved')
  return lines.length
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e.stderr?.toString().trim() || e.message)
    process.exit(1)
  }
}
