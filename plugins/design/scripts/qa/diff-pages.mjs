// The pages a diff touches, for the QA order's pass file (kit 1.10, F3: "the QA order ships with a
// pass file built from the diff's routes"; before it, each QA agent listed the pages by hand).
//
// Used by qa-pass.mjs --from-diff <base>. How a changed file becomes a page:
// - a route file (Next's app router `page.*`, or `pages/**` outside `_app`, `_document`, `api/`)
//   is its own page; route groups `(x)` and slots `@x` drop out of the path;
// - a `layout.*` or `template.*` touches every page under its folder;
// - any other source file (a component, a lib) touches the pages whose route file imports it,
//   directly or through other files (relative imports, `@/` and `~/` from the root or `src/`);
// - kit.json `qa.routes` ({ "<path prefix>": ["/page", ...] }) adds pages for files no import
//   reaches (a router config, CSS, a Vite app with a routes table): the project's own map wins.
// Dynamic pages (`[id]`) can't be loaded without a real id, so they come back in `needsParams`.
// Files that reach no page come back in `unmapped`, so the order can say what QA won't see.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const SRC = /\.(tsx?|jsx?|mjs|mdx)$/
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.vercel', 'out', '.claude'])
const posix = (p) => p.split(sep).join('/')

function walk(dir, out = []) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const n of names) {
    if (SKIP.has(n)) continue
    const p = join(dir, n)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (SRC.test(n)) out.push(p)
  }
  return out
}

// An app-router folder as a URL: route groups `(x)` and parallel slots `@x` are not in the URL.
const urlOf = (folder = '') => `/${folder.split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).join('/')}`

/** The URL path of a route file (root-relative, posix), or null when it is not a page. */
export function routeOf(rel) {
  const m = rel.match(/^(?:src\/)?app\/(?:(.*)\/)?page\.(tsx?|jsx?|mdx)$/)
  if (m) return urlOf(m[1])
  const p = rel.match(/^(?:src\/)?pages\/(.+)\.(tsx?|jsx?|mdx)$/)
  if (p && !/^(api\/|_app$|_document$|_error$)/.test(p[1])) return `/${p[1].replace(/(^|\/)index$/, '')}`.replace(/\/$/, '') || '/'
  return null
}

/** A layout's or template's folder as a URL prefix, or null. */
export function layoutPrefix(rel) {
  const m = rel.match(/^(?:src\/)?app\/(?:(.*)\/)?(layout|template)\.(tsx?|jsx?)$/)
  return m ? urlOf(m[1]) : null
}

const under = (url, prefix) => url === prefix || prefix === '/' || url.startsWith(`${prefix}/`)

/** Where an import specifier points, as a root-relative file, or null for a package. */
export function resolveImport(root, fromRel, spec, files) {
  let bases
  if (spec.startsWith('.')) bases = [posix(join(dirname(fromRel), spec))]
  else if (/^[@~]\//.test(spec)) bases = [spec.slice(2), `src/${spec.slice(2)}`]
  else return null
  for (const b of bases) {
    if (files.has(b)) return b
    for (const ext of ['.tsx', '.ts', '.jsx', '.js', '.mjs']) {
      if (files.has(b + ext)) return b + ext
      if (files.has(`${b}/index${ext}`)) return `${b}/index${ext}`
    }
  }
  return null
}

const IMPORTS = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

/** Who imports whom, reversed: file -> the files that import it. */
export function importedBy(root, rels) {
  const files = new Set(rels)
  const by = new Map()
  for (const r of rels) {
    const text = readFileSync(join(root, r), 'utf8')
    for (const m of text.matchAll(IMPORTS)) {
      const to = resolveImport(root, r, m[1] ?? m[2] ?? m[3], files)
      if (!to) continue
      if (!by.has(to)) by.set(to, new Set())
      by.get(to).add(r)
    }
  }
  return by
}

/** The changed files against <base>, committed and not (root-relative). */
export function changedFiles(root, base) {
  const out = execFileSync('git', ['-C', root, 'diff', '--name-only', base, '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return out.split('\n').filter(Boolean)
}

/**
 * The pages a set of changed files touches.
 * Returns { pages, needsParams, unmapped, why } where `why` maps each page to the files that led to it.
 */
export function pagesFor(root, changed, { routes = {} } = {}) {
  const rels = walk(root).map((p) => posix(relative(root, p)))
  const routeFiles = new Map(rels.map((r) => [r, routeOf(r)]).filter(([, u]) => u !== null))
  const by = importedBy(root, rels)
  const why = new Map()
  const unmapped = []
  for (const file of changed) {
    let hit = false
    const add = (page) => {
      if (!why.has(page)) why.set(page, new Set())
      why.get(page).add(file)
      hit = true
    }
    const layoutPages = (prefix) => {
      for (const u of routeFiles.values()) if (under(u, prefix)) add(u)
    }
    for (const [prefix, pages] of Object.entries(routes)) if (file.startsWith(prefix)) [].concat(pages).forEach(add)
    const own = routeOf(file)
    const lp = layoutPrefix(file)
    if (own !== null) add(own)
    if (lp !== null) layoutPages(lp)
    if (own === null && lp === null && SRC.test(file)) {
      // Walk up the importers to the route files and layouts (breadth first, each file once).
      const seen = new Set([file])
      const queue = [file]
      while (queue.length) {
        for (const parent of by.get(queue.shift()) ?? []) {
          if (seen.has(parent)) continue
          seen.add(parent)
          if (routeFiles.has(parent)) add(routeFiles.get(parent))
          const plp = layoutPrefix(parent)
          if (plp !== null) layoutPages(plp)
          queue.push(parent)
        }
      }
    }
    if (!hit) unmapped.push(file)
  }
  const all = [...why.keys()].sort()
  return {
    pages: all.filter((p) => !p.includes('[')),
    needsParams: all.filter((p) => p.includes('[')),
    unmapped,
    why: Object.fromEntries(all.map((p) => [p, [...why.get(p)].sort()])),
  }
}

/** The pass file for a diff: base URL from kit.json project.devPort, widths 375 and 1024, the project's themes. */
export function passFromDiff(root, base, { changed = null } = {}) {
  let kit = {}
  try {
    kit = JSON.parse(readFileSync(join(root, '.claude', 'kit.json'), 'utf8'))
  } catch {}
  const files = changed ?? changedFiles(root, base)
  const found = pagesFor(root, files, { routes: kit.qa?.routes ?? {} })
  const port = Number(kit.project?.devPort) || 3000
  const pass = { base: `http://localhost:${port}`, pages: found.pages, widths: [375, 1024] }
  if (Array.isArray(kit.qa?.themes)) pass.themes = kit.qa.themes
  if (kit.qa?.themeVia) pass.themeVia = kit.qa.themeVia
  return { pass, ...found, diffBase: base, changed: files }
}
