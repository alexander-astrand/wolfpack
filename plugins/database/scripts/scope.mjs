#!/usr/bin/env node
// The scope sheet for a database step: what already names a table or a
// function, before anyone edits it. Read-only: it reads files, never a
// database.
//
// Usage: node scripts/scope.mjs <table|function> [--root <project>]
//   prints   the suites under supabase/tests/ naming it, the pinned lists in
//            src/, scripts/ and supabase/functions/ naming it (a quoted name
//            on a line), the migrations that define it as a function, and
//            the foreign-key pairs from supabase/migrations/ it is part of
//   exit 0   printed (an empty sheet is still a sheet)
//   exit 2   usage, or no supabase/ folder under the root
//
// Why it exists: the playbook's cost was never the migration, it was the
// search before it. One step read 26 suites one by one to find who pinned a
// wall, and pinned lists were found by a failing check (kit 1.6.1 council,
// M8 and Feature 4). The navigator runs this and pastes the output into the
// playbook's order, so the builder starts from the list.
//
// The root is --root, else CLAUDE_PROJECT_DIR, else the current folder.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every file under dir (recursive), skipping node_modules and dot folders. */
export function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/** Dollar-quoted bodies hold semicolons and `references` in prose; drop them. */
export function stripBodies(sql) {
  return sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

const ident = String.raw`(?:"?\w+"?\.)?"?(\w+)"?`

/**
 * Foreign keys declared in migrations, as { child, column, parent }.
 * Reads `create table` bodies and `alter table … references`; a rough parse
 * by design: the sheet is a hint for where to look, not a schema.
 */
export function foreignKeys(sql) {
  const pairs = []
  for (const stmt of stripBodies(sql).split(';')) {
    const head = stmt.match(new RegExp(String.raw`\b(?:create\s+(?:unlogged\s+)?table|alter\s+table)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?${ident}`, 'i'))
    if (!head) continue
    const child = head[1]
    const refs = new RegExp(String.raw`(?:foreign\s+key\s*\(\s*"?(\w+)"?[^)]*\)\s*)?references\s+${ident}`, 'gi')
    let m
    while ((m = refs.exec(stmt))) {
      let column = m[1]
      if (!column) {
        // An inline reference: the column is the first word of its segment.
        const before = stmt.slice(0, m.index)
        // Walk back to the comma or open paren at this depth, so a closed
        // `numeric(10,2)` or `default auth.uid()` doesn't cut the segment.
        let cut = -1
        for (let i = before.length - 1, depth = 0; i >= 0; i--) {
          const c = before[i]
          if (c === ')') depth++
          else if (c === '(' && depth > 0) depth--
          else if ((c === '(' || c === ',') && depth === 0) { cut = i; break }
        }
        let seg = before.slice(cut + 1)
        // `alter table t add column c …`: the column follows the last `add`.
        const add = [...seg.matchAll(/\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?/gi)].pop()
        if (add) seg = seg.slice(add.index + add[0].length)
        column = (seg.match(/"?(\w+)"?/) || [])[1] || '?'
      }
      pairs.push({ child, column, parent: m[2] })
    }
  }
  return pairs
}

/** The scope sheet for one name, as data. */
export function scope(root, name) {
  const word = new RegExp(String.raw`\b${escape(name)}\b`, 'i')
  const quoted = new RegExp(String.raw`['"\x60]${escape(name)}['"\x60]`, 'i')
  const rel = (p) => relative(root, p)

  const suites = walk(join(root, 'supabase', 'tests'))
    .filter((p) => p.endsWith('.sql') && word.test(readFileSync(p, 'utf8')))
    .map(rel)

  const pinned = []
  for (const dir of ['src', 'scripts', join('supabase', 'functions')]) {
    for (const p of walk(join(root, dir))) {
      if (!/\.(m?[jt]sx?|json|sql)$/.test(p)) continue
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (quoted.test(line)) pinned.push(`${rel(p)}:${i + 1}  ${line.trim().slice(0, 100)}`)
      })
    }
  }

  const migrations = walk(join(root, 'supabase', 'migrations')).filter((p) => p.endsWith('.sql'))
  const defines = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:"?\w+"?\.)?"?${escape(name)}"?\s*\(`, 'i')
  const definedIn = []
  const seen = new Set()
  const fks = []
  const lower = name.toLowerCase()
  for (const p of migrations) {
    const sql = readFileSync(p, 'utf8')
    if (defines.test(sql)) definedIn.push(rel(p))
    for (const fk of foreignKeys(sql)) {
      if (fk.child.toLowerCase() !== lower && fk.parent.toLowerCase() !== lower) continue
      const line = `${fk.child}.${fk.column} -> ${fk.parent}`
      if (!seen.has(line)) { seen.add(line); fks.push(line) }
    }
  }
  return { suites, pinned, definedIn, fks }
}

export function render(name, sheet) {
  const block = (title, rows) => [`${title} (${rows.length}):`, ...rows.map((r) => `  ${r}`)]
  const lines = [`scope: ${name}`]
  lines.push(...block('suites', sheet.suites))
  lines.push(...block('pinned lists', sheet.pinned))
  if (sheet.definedIn.length) lines.push(...block('defined in', sheet.definedIn))
  lines.push(...block('foreign keys', sheet.fks))
  return lines.join('\n')
}

export function parseArgs(argv) {
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (!argv[i + 1]) return { error: '--root needs a folder' }
      root = argv[++i]
    } else rest.push(argv[i])
  }
  if (rest.length !== 1 || rest[0].startsWith('-')) return { error: 'usage: scope.mjs <table|function> [--root <project>]' }
  if (!/^\w+$/.test(rest[0])) return { error: `not a table or function name: ${rest[0]}` }
  return { root: resolve(root), name: rest[0] }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    process.stderr.write(`scope: ${args.error}\n`)
    process.exit(2)
  }
  if (!existsSync(join(args.root, 'supabase'))) {
    process.stderr.write(`scope: no supabase/ folder in ${args.root}\n`)
    process.exit(2)
  }
  console.log(render(args.name, scope(args.root, args.name)))
}
