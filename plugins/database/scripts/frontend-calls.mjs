#!/usr/bin/env node
// Prints the "what the frontend will call" paragraph of a the-playbook
// report from the migration itself: each function's RPC name, argument names
// and types, return columns, who may execute it, and security definer.
//
// Usage: node scripts/frontend-calls.mjs <migration.sql> [more.sql ...]
//   prints   one block per file: per function a `supabase.rpc(...)` line,
//            its returns, its execute grants and security definer yes/no;
//            trigger functions and dropped functions on one line each
//   exit 0   printed (also when a file defines no function)
//   exit 2   usage, or a file that can't be read
//
// What it reads: `create [or replace] function`, `drop function`, and
// `grant`/`revoke execute on function` (also `on all functions in schema`),
// in file order, so a revoke after a grant wins. Comments and the bodies
// (dollar quotes, strings) are blanked first, so a body naming another
// function never counts. OUT and INOUT arguments are return columns, as
// PostgREST returns them. An argument with a default is optional (`?`).
// It reads the text only, no database, so a grant made in an earlier
// migration is not seen: the line then says "none in this file".
//
// Why it exists: 41 playbook runs wrote this paragraph by hand from memory,
// and captain-call pastes it into the next builder's order (kit 1.7.1
// council, Feature 7, database lens Feature 2). From the SQL, the shape the
// builder codes against is the shape the database has.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** The SQL with comments removed and string and dollar-quoted text blanked. */
export function blank(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 2
      out += ' '
    } else if (c === "'") {
      // '' inside a string is a quote, not its end.
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      out += "''"
      i = j + 1
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (!m) {
        out += c
        i++
        continue
      }
      const end = sql.indexOf(m[0], i + m[0].length)
      out += '$body$'
      i = end < 0 ? sql.length : end + m[0].length
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Splits on commas that are not inside parentheses. */
function splitTop(text) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const c of text) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** The text between the parenthesis at `open` and its match, and the index after. */
function balanced(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    if (text[i] === ')' && --depth === 0) return { inner: text.slice(open + 1, i), after: i + 1 }
  }
  return { inner: text.slice(open + 1), after: text.length }
}

const unquote = (name) => name.replace(/"/g, '')
const bare = (name) => unquote(name).split('.').pop().toLowerCase()
const tidy = (s) => s.replace(/\s+/g, ' ').trim()

// Words a type can start with, so `timestamp with time zone x` isn't read as
// an argument named timestamp.
const TYPE_START = new Set(['double', 'character', 'timestamp', 'time', 'bit', 'interval', 'national'])

/** One argument: `{ mode, name, type, optional }`. */
export function parseArg(text) {
  let rest = tidy(text)
  let optional = false
  const def = /\s+(default\b|=)\s*[\s\S]*$/i.exec(rest)
  if (def) {
    optional = true
    rest = rest.slice(0, def.index)
  }
  let mode = 'in'
  const m = /^(in|out|inout|variadic)\s+/i.exec(rest)
  if (m) {
    mode = m[1].toLowerCase()
    rest = rest.slice(m[0].length)
  }
  const words = rest.split(' ')
  if (words.length > 1 && !TYPE_START.has(words[0].toLowerCase())) {
    return { mode, name: unquote(words[0]), type: words.slice(1).join(' '), optional }
  }
  return { mode, name: null, type: rest, optional }
}

/** The functions, drops and grants of one migration's text. */
export function readMigration(sql) {
  const text = blank(sql)
  const fns = new Map()
  const dropped = []
  const statements = text.split(';')
  for (const st of statements) {
    const create = /\bcreate\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/i.exec(st)
    if (create) {
      const { inner, after } = balanced(st, create.index + create[0].length - 1)
      const head = st.slice(after)
      const args = splitTop(inner).map(parseArg)
      const fn = {
        name: bare(create[1]),
        args: args.filter((a) => a.mode !== 'out'),
        outs: args.filter((a) => a.mode === 'out' || a.mode === 'inout'),
        returns: null,
        columns: [],
        setof: false,
        trigger: false,
        definer: /\bsecurity\s+definer\b/i.test(head),
        searchPath: /\bset\s+search_path\b/i.test(head),
        grants: new Set(),
      }
      const table = /\breturns\s+table\s*\(/i.exec(head)
      if (table) {
        fn.columns = splitTop(balanced(head, table.index + table[0].length - 1).inner).map(parseArg)
        fn.setof = true
      } else {
        const r = /\breturns\s+(setof\s+)?([\w."]+(?:\s*\[\])?(?:\s+(?:with(?:out)?\s+time\s+zone|precision|varying))?)/i.exec(head)
        if (r) {
          fn.setof = Boolean(r[1])
          fn.returns = tidy(unquote(r[2]))
          fn.trigger = /^(trigger|event_trigger)$/i.test(fn.returns)
        }
      }
      // A function created again later in the file replaces the first.
      fns.set(fn.name, fn)
      continue
    }
    const drop = /\bdrop\s+function\s+(?:if\s+exists\s+)?([\w."]+)/i.exec(st)
    if (drop) {
      const name = bare(drop[1])
      fns.delete(name)
      dropped.push(name)
      continue
    }
    const grant = /\b(grant|revoke)\s+(?:execute|all(?:\s+privileges)?)\s+on\s+(?:(all\s+functions\s+in\s+schema)\s+\S+|function\s+([\s\S]+?))\s+(to|from)\s+([\s\S]+)$/i.exec(st)
    if (grant) {
      const roles = grant[5].replace(/\bwith\s+grant\s+option\b/i, '').replace(/\b(cascade|restrict)\b/i, '')
        .split(',').map((r) => unquote(r.trim()).toLowerCase()).filter(Boolean)
      const targets = grant[2]
        ? [...fns.values()]
        : splitTop(grant[3].replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')).map(bare).map((n) => fns.get(n)).filter(Boolean)
      for (const fn of targets) {
        for (const role of roles) {
          if (grant[1].toLowerCase() === 'grant') fn.grants.add(role)
          else fn.grants.delete(role)
        }
      }
    }
  }
  return { functions: [...fns.values()], dropped }
}

const argText = (a, i) => `${a.name || `$${i + 1}`}${a.optional ? '?' : ''}: ${a.type}`
const cols = (list) => list.map((c) => `${c.name || '?'} ${c.type}`).join(', ')

/** The paragraph for one file, as lines. */
export function render(file, { functions, dropped }) {
  const lines = [`What the frontend will call (from ${file}):`]
  const called = functions.filter((f) => !f.trigger)
  for (const fn of called) {
    lines.push(`- supabase.rpc('${fn.name}'${fn.args.length ? `, { ${fn.args.map(argText).join(', ')} }` : ''})`)
    let returns
    if (fn.columns.length) returns = `rows of (${cols(fn.columns)})`
    else if (fn.outs.length) returns = `${fn.setof ? 'rows' : 'one row'} of (${cols(fn.outs)})`
    else if (fn.returns) returns = fn.setof ? `rows of ${fn.returns}` : fn.returns
    else returns = 'not found in the text'
    lines.push(`  returns: ${returns}`)
    const roles = [...fn.grants].sort()
    lines.push(`  execute: ${roles.length ? roles.join(', ') : 'none in this file (closed unless an earlier migration grants it)'}`)
    lines.push(`  security definer: ${fn.definer ? `yes${fn.searchPath ? ', search_path set' : ', search_path NOT set'}` : 'no'}`)
  }
  for (const fn of functions.filter((f) => f.trigger)) lines.push(`- trigger function ${fn.name}: not called by the frontend`)
  for (const name of dropped) lines.push(`- removed: ${name} (the frontend must not call it)`)
  if (lines.length === 1) lines.push('- no functions: nothing new to call from this file')
  return lines
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const files = process.argv.slice(2)
  if (!files.length || files.some((f) => f.startsWith('-'))) {
    process.stderr.write('usage: frontend-calls.mjs <migration.sql> [more.sql ...]\n')
    process.exit(2)
  }
  const blocks = []
  for (const f of files) {
    if (!existsSync(f)) {
      process.stderr.write(`frontend-calls: no file ${f}\n`)
      process.exit(2)
    }
    blocks.push(render(f, readMigration(readFileSync(f, 'utf8'))).join('\n'))
  }
  console.log(blocks.join('\n\n'))
}
