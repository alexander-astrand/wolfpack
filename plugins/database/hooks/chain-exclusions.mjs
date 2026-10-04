// C9a (2.12.2): which migrations a chained release may carry without a person
// reading them. In a chain, each release's deploy is armed from the tap alone,
// so a new migration may hold only the statement kinds on yoda's list (must 2):
// an allowlist, because the word list it replaces missed `alter table t drop c`,
// `drop/**/table` and `do $$ … execute …`, and false-stopped on `delete from`
// inside function bodies. A wrong stop costs a tap; a wrong pass costs data, so
// anything this file can't read with certainty stops.
// Pure: text in, verdicts out. C9b gathers the facts (git, the grants test).

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)`
const NAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`

// Every statement in a migration starts with one of these; anything else means
// the splitter cut a statement in the wrong place (the 52 test checks it).
export const SQL_VERBS = ['alter', 'analyze', 'begin', 'comment', 'commit', 'create', 'delete', 'do', 'drop', 'grant', 'insert', 'lock', 'notify', 'refresh', 'reindex', 'reset', 'revoke', 'security', 'select', 'set', 'truncate', 'update', 'vacuum', 'with']

// Cuts the text into code, strings, quoted identifiers and dollar bodies, with
// comments (nested /* */ too) turned into a space so `drop/**/table` still reads
// as two words. Throws on an unterminated string, comment or body.
function lex(sql) {
  const out = []
  let code = ''
  let i = 0
  const n = sql.length
  const flush = () => {
    if (code) out.push({ t: 'code', s: code })
    code = ''
  }
  while (i < n) {
    const c = sql[i]
    const d = sql[i + 1]
    if (c === '-' && d === '-') {
      const j = sql.indexOf('\n', i)
      i = j < 0 ? n : j
      code += ' '
    } else if (c === '/' && d === '*') {
      let depth = 1
      i += 2
      while (i < n && depth) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error('an unterminated /* comment')
      code += ' '
    } else if (c === "'") {
      // E'…' takes backslash escapes; the E belongs to the string, not the code.
      const escapes = /[eE]$/.test(code) && !/[A-Za-z0-9_$]/.test(code.at(-2) ?? '')
      if (escapes) code = code.slice(0, -1)
      flush()
      let j = i + 1
      for (;;) {
        if (j >= n) throw new Error('an unterminated string')
        if (escapes && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          break
        }
        j++
      }
      out.push({ t: 'str', s: sql.slice(i + 1, j) })
      i = j + 1
    } else if (c === '"') {
      flush()
      let j = i + 1
      for (;;) {
        if (j >= n) throw new Error('an unterminated quoted name')
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue }
          break
        }
        j++
      }
      out.push({ t: 'ident', s: sql.slice(i, j + 1) })
      i = j + 1
    } else if (c === '$' && !/[A-Za-z0-9_$]/.test(code.at(-1) ?? '') && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i, i + 64))) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)[0]
      const end = sql.indexOf(tag, i + tag.length)
      if (end < 0) throw new Error(`an unterminated ${tag} body`)
      flush()
      out.push({ t: 'dollar', s: sql.slice(i + tag.length, end) })
      i = end + tag.length
    } else {
      code += c
      i++
    }
  }
  flush()
  return out
}

function unlex(chunks) {
  return chunks.map((c) => (c.t === 'code' || c.t === 'ident' ? c.s : c.t === 'str' ? `'${c.s.replaceAll("'", "''")}'` : `$_$${c.s}$_$`)).join('')
}

/** The top-level statements, comments removed, without their `;`. */
export function splitStatements(sql) {
  const statements = []
  let current = []
  let depth = 0
  const push = () => {
    const text = unlex(current).trim()
    if (text) statements.push(text)
    current = []
  }
  for (const chunk of lex(sql)) {
    if (chunk.t !== 'code') { current.push(chunk); continue }
    let piece = ''
    for (const ch of chunk.s) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (ch === ';' && depth <= 0) {
        if (piece) current.push({ t: 'code', s: piece })
        piece = ''
        push()
        depth = 0
      } else piece += ch
    }
    if (piece) current.push({ t: 'code', s: piece })
  }
  push()
  return statements
}

// The statement as the classifier reads it: lower case, one space, strings
// as '' and bodies as $$, so nothing inside a literal can look like a keyword.
// Quoted names keep their case: "A" and "a" are two policies to Postgres.
function shape(stmt) {
  const chunks = lex(stmt)
  const h = chunks.map((c) => (c.t === 'code' ? c.s.toLowerCase() : c.t === 'ident' ? c.s : c.t === 'str' ? "''" : '$$')).join('').replace(/\s+/g, ' ').trim()
  // For the word scan quoted names go too: a policy called "Drop-in guests" is a name.
  const words = chunks.map((c) => (c.t === 'code' ? c.s : c.t === 'ident' ? '""' : c.t === 'str' ? "''" : '$$')).join('').toLowerCase().replace(/\s+/g, ' ').trim()
  return { chunks, h, words }
}

function norm(name) {
  const parts = name.match(new RegExp(IDENT, 'g')).map((p) => (p.startsWith('"') ? p.slice(1, -1).replaceAll('""', '"') : p))
  if (parts.length === 2 && parts[0] === 'public') parts.shift()
  return parts.join('.')
}

// Splits on commas outside parentheses.
function topCommas(text) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

// The text inside the parentheses that open at `from`; null when they don't close.
function parens(text, from) {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return { inner: text.slice(from + 1, i), end: i + 1 }
  }
  return null
}

const TYPE_ALIASES = { timestamptz: 'timestamp with time zone', int: 'integer', int4: 'integer', int8: 'bigint', bool: 'boolean', varchar: 'character varying', float8: 'double precision' }

// A function's argument types without names, modes or defaults, so
// `drop function f(uuid)` and `create function f(p_id uuid default null)` match.
function argTypes(inner) {
  return topCommas(inner).map((arg) => {
    let a = arg.replace(/\s+default\s+.*$/, '').replace(/\s*=\s*.*$/, '').replace(/^(in|out|inout|variadic)\s+/, '').trim()
    const multi = /^(timestamp|time)( with(out)? time zone)?|^double precision|^character varying|^bit varying/
    const words = a.split(' ')
    if (words.length > 1 && !multi.test(a)) a = words.slice(1).join(' ')
    const base = a.replace(/\s*\[\]$/, '')
    return (TYPE_ALIASES[base] ?? base) + (a.endsWith('[]') ? '[]' : '')
  }).filter(Boolean)
}

function signature(h, at) {
  const nameMatch = h.slice(at).match(new RegExp(`^(${NAME})\\s*`))
  if (!nameMatch) return null
  const open = at + nameMatch[0].length
  if (h[open] !== '(') return { name: norm(nameMatch[1]), sig: null, end: open }
  const p = parens(h, open)
  if (!p) return null
  const name = norm(nameMatch[1])
  return { name, sig: `${name}(${argTypes(p.inner).join(',')})`, end: p.end }
}

const FIRST_WORDS = /^(create (?:or replace )?(?:unique )?\S+|alter \S+|drop \S+|grant|revoke|\S+)/

/**
 * What one statement is. `kind` names it for messages; `ok` is false when the
 * kind itself isn't on the chain's list (the release-level rules come later).
 */
export function classify(stmt) {
  const { chunks, h, words } = shape(stmt)
  const other = (kind = h.match(FIRST_WORDS)?.[1] ?? 'an empty statement') => ({ kind, object: null, ok: false, h, words })
  let m

  if ((m = h.match(new RegExp(`^create table (?:if not exists )?(${NAME})`)))) {
    const t = norm(m[1])
    return { kind: 'create table', object: t, table: t, ok: true, h, words }
  }

  if ((m = h.match(new RegExp(`^alter table (?:if exists )?(?:only )?(${NAME}) (.*)$`)))) {
    const t = norm(m[1])
    let kind = null
    let bad = null
    for (const action of topCommas(m[2])) {
      if (/^add (?:column )?(?:if not exists )?/.test(action) && !/^add (constraint|primary|unique|foreign|check|exclude)\b/.test(action)) kind ??= 'add column'
      else if (/^(enable|force) row level security$/.test(action)) kind ??= 'enable row level security'
      else {
        // The column's name stays out of the kind: `alter column … type`, `drop constraint`.
        const col = action.match(/^alter (?:column )?\S+ (\S+)/)
        bad ??= col ? `alter column … ${col[1]}` : action.split(' ').slice(0, 2).join(' ')
      }
    }
    if (bad) return { kind: `alter table … ${bad}`, object: t, table: t, ok: false, h, words }
    const rls = /\benable row level security\b/.test(m[2])
    return { kind: kind ?? 'alter table', object: t, table: t, ok: true, rls, h, words }
  }

  if ((m = h.match(new RegExp(`^create (?:unique )?index (?:concurrently )?(?:if not exists )?(?:(${NAME}) )?on (?:only )?(${NAME})`)))) {
    return { kind: 'create index', object: m[1] ? norm(m[1]) : null, table: norm(m[2]), ok: true, h, words }
  }

  if ((m = h.match(new RegExp(`^create (?:or replace )?(?:constraint )?trigger (${NAME}) .*?\\bon (${NAME})`)))) {
    const t = norm(m[2])
    return { kind: 'create trigger', object: `${norm(m[1])} on ${t}`, table: t, ok: true, h, words }
  }

  if (/^comment on /.test(h)) return { kind: 'comment', object: null, ok: true, h, words }

  if ((m = h.match(new RegExp(`^create policy (${NAME}) on (${NAME})`)))) {
    const t = norm(m[2])
    return { kind: 'create policy', object: `${norm(m[1])} on ${t}`, policy: norm(m[1]), table: t, ok: true, h, words }
  }

  if ((m = h.match(/^create (or replace )?function /))) {
    const s = signature(h, m[0].length)
    if (!s?.sig) return other('create function')
    // Only one $$ body is read: a body in a plain string could be confused with
    // `set search_path = ''`, and a C or internal "body" is a symbol, not SQL.
    const bodies = chunks.filter((c) => c.t === 'dollar')
    if (bodies.length !== 1 || !/\bas \$\$/.test(h) || /\blanguage (?:c|internal)\b/.test(h)) return other('a function without one $$ body')
    return { kind: 'create function', object: s.sig, name: s.name, body: bodies[0].s, securityDefiner: /\bsecurity definer\b/.test(h), ok: true, h, words }
  }

  if ((m = h.match(/^(grant|revoke) (.*?) on (.*) (to|from) (.*)$/))) {
    const [, verb, privs, target, , who] = m
    // On a function, revoke all is revoke execute: it's the only privilege there is.
    const execute = verb === 'grant' ? /^execute$/.test(privs) : /^(execute|all|all privileges)$/.test(privs)
    if (!execute || !/^functions? /.test(target) || /\bgrant option\b/.test(who) || /^functions? in schema|^all /.test(target)) return other(`${verb} ${privs} on ${target.split(' ')[0]}`)
    const fns = []
    let at = target.indexOf(' ') + 1
    for (;;) {
      const s = signature(target, at)
      if (!s) return other(`${verb} ${privs} on function`)
      fns.push(s.name)
      const rest = target.slice(s.end).match(/^\s*,\s*/)
      if (!rest) break
      at = s.end + rest[0].length
    }
    const grantees = topCommas(who).map((g) => g.replace(/^group /, ''))
    return { kind: `${verb} execute`, object: fns.join(', '), functions: fns, grantees, ok: true, h, words }
  }

  if ((m = h.match(new RegExp(`^insert into (${NAME})`)))) return { kind: 'insert', object: norm(m[1]), table: norm(m[1]), ok: true, h, words }
  if ((m = h.match(new RegExp(`^update (?:only )?(${NAME})`)))) return { kind: 'update', object: norm(m[1]), table: norm(m[1]), ok: true, h, words }

  if ((m = h.match(/^drop (policy|function|trigger|index|view) if exists (.*)$/))) {
    const [, type, rest] = m
    // cascade takes whatever depends on the object with it: never unattended.
    if (/\bcascade$/.test(rest)) return other(`drop ${type} … cascade`)
    const targets = []
    if (type === 'policy' || type === 'trigger') {
      const t = rest.match(new RegExp(`^(${NAME}) on (${NAME})(?: restrict)?$`))
      if (!t) return other(`drop ${type}`)
      targets.push(`${norm(t[1])} on ${norm(t[2])}`)
    } else if (type === 'function') {
      let at = 0
      for (;;) {
        const s = signature(rest, at)
        // Without its argument list the drop can't be matched to one create.
        if (!s?.sig) return other('drop function without its argument types')
        targets.push(s.sig)
        const more = rest.slice(s.end).match(/^\s*,\s*/)
        if (!more) {
          if (!/^\s*(restrict)?\s*$/.test(rest.slice(s.end))) return other('drop function')
          break
        }
        at = s.end + more[0].length
      }
    } else {
      for (const part of topCommas(rest.replace(/ restrict$/, ''))) {
        if (!new RegExp(`^${NAME}$`).test(part)) return other(`drop ${type}`)
        targets.push(norm(part))
      }
    }
    return { kind: `drop ${type} if exists`, object: targets.join(', '), type, targets, ok: true, h, words }
  }

  if ((m = h.match(new RegExp(`^create (?:or replace )?view (${NAME})`)))) {
    const invoker = /\bwith \([^)]*\bsecurity_invoker(?:\s*=\s*(?:true|on|1|yes))?\s*[,)]/.test(h)
    return { kind: invoker ? 'create view' : 'a view without security_invoker', object: norm(m[1]), ok: invoker, h, words }
  }

  return other()
}

// Words that stop a migration wherever they stand outside a body, even in a
// statement the classifier passed: a second net under the allowlist.
const WORDS = [
  [/\btruncate\b/, 'truncate'],
  [/\bdelete from\b/, 'delete from'],
  [/^do\b/, 'do'],
  [/\bexecute\b(?! (?:on|function|procedure)\b)/, 'execute'],
  [/\brename\b/, 'rename'],
  [/\balter column \S+ (?:set data )?type\b|\balter type\b/, 'alter … type'],
  [/\bdisable row level security\b/, 'disable row level security'],
  [/\bno force row level security\b/, 'no force row level security'],
  [/\bdefault privileges\b/, 'default privileges'],
  // Anchored for set/reset: `update group_members set role = 'owner'` is a row, not a role.
  [/\b(?:create|alter|drop) role\b|^(?:set|reset) role\b|\bsession authorization\b/, 'role'],
  [/\bextension\b/, 'extension'],
  [/\bcron\b/, 'cron'],
  [/\bsecurity_invoker\s*=\s*(?:false|off|0|no)\b/, 'security_invoker off'],
  [/\bgrant (?:all|select|insert|update|delete|usage|references|trigger|truncate|create|connect|temporary|maintain)\b/, 'grant on a table or schema'],
  [/\bowner to\b/, 'owner to'],
  [/\bpublication\b/, 'publication'],
  [/\bcopy\b/, 'copy'],
  [/\balter policy\b/, 'alter policy'],
]

// A function body may delete rows (functions do), but not change the schema,
// grant, empty a table or run text as SQL.
function bodyWhyNot(body) {
  let text
  try {
    text = lex(body).map((c) => (c.t === 'code' || c.t === 'ident' ? c.s : c.t === 'str' ? "''" : ' $$ ')).join('').toLowerCase()
  } catch {
    return 'a function body that does not read cleanly'
  }
  const hit = text.match(/\b(drop|truncate|alter|grant|execute)\b/)
  return hit ? `a function body that runs ${hit[1]}` : ''
}

const has = (list, x) => (list instanceof Set ? list.has(x) : (list ?? []).includes(x))

/**
 * One new migration's verdict: `stops` (messages; any one ends the chain),
 * `items` (what yoda must name in his verdict) and `stopKinds` (the stops'
 * kinds, for the 52 table). `release` = `{newTables, rlsEnabled, grantsTest,
 * knownFunctions}`: the tables the release creates and enables RLS on (all
 * its migrations), the text of `supabase/tests/function_grants.sql` at its
 * head, and the functions already on main (missing: every function is new).
 */
export function migrationWhyNot(file, sql, release = {}) {
  const { newTables = [], rlsEnabled = [], grantsTest = '', knownFunctions = null } = release
  const stops = []
  const items = []
  const stopKinds = new Set()
  let statements
  try {
    statements = splitStatements(sql)
  } catch (e) {
    return { stops: [`${file}: the file doesn't split into statements (${e.message})`], items, stopKinds: ['unreadable'] }
  }
  const parsed = statements.map((s) => {
    try { return classify(s) } catch { return { kind: 'unreadable', ok: false, h: s, words: '' } }
  })
  const quote = (n) => `(statement ${n}: "${statements[n - 1].replace(/\s+/g, ' ').slice(0, 60)}")`
  const stop = (n, kind, reason = `${kind} isn't on the chain's list`) => {
    stops.push(`${file}: ${reason} ${quote(n)}`)
    stopKinds.add(kind)
  }
  const createdLater = (i, type, target) => parsed.slice(i + 1).some((c) => c.kind === `create ${type}` && c.object === target)

  parsed.forEach((c, i) => {
    const n = i + 1
    if (!c.ok) return stop(n, c.kind, c.kind.startsWith('a ') ? c.kind : undefined)
    switch (c.kind) {
      case 'create table':
        if (!has(rlsEnabled, c.table)) stop(n, 'create table without rls', 'a new table without row level security')
        break
      case 'create policy':
        if (!has(newTables, c.table)) items.push(`P:${file}:${c.table}:${c.policy}`)
        break
      case 'create function': {
        const isNew = !knownFunctions || !has(knownFunctions, c.name)
        const bare = c.name.replace(/^.*\./, '')
        const named = new RegExp(`(?<![a-z0-9_])${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_])`, 'i')
        // Named anywhere counts, comments too: that's where the file lists the internal ones.
        if (isNew && !named.test(grantsTest)) {
          stop(n, 'new function not in function_grants.sql', `a new function, ${bare}(), not named in supabase/tests/function_grants.sql`)
        }
        const why = bodyWhyNot(c.body)
        if (why) stop(n, why, why)
        if (c.securityDefiner) items.push(`SD:${file}:${c.name}`)
        break
      }
      case 'grant execute':
        if (c.grantees.some((g) => g === 'anon' || g === 'public')) for (const fn of c.functions) items.push(`G:${file}:${fn}`)
        break
      case 'insert':
      case 'update':
        items.push(`DML:${file}:${n}`)
        break
      default:
        if (c.kind.startsWith('drop ') && !c.targets.every((t) => createdLater(i, c.type, t))) {
          stop(n, 'drop without re-create', `a drop that isn't followed by re-creating the same ${c.type}`)
        }
    }
    for (const [re, word] of WORDS) if (re.test(c.words)) stop(n, `word "${word}"`, `"${word}" isn't on the chain's list`)
  })
  return { stops, items, stopKinds: [...stopKinds].sort() }
}

/** The release facts `migrationWhyNot` needs, from all of its new migrations. */
export function releaseOf(migrations, grantsTest = '', knownFunctions = null) {
  const newTables = new Set()
  const rlsEnabled = new Set()
  for (const { sql } of migrations) {
    let statements
    try { statements = splitStatements(sql) } catch { continue }
    for (const s of statements) {
      let c
      try { c = classify(s) } catch { continue }
      if (c.kind === 'create table') newTables.add(c.table)
      if (c.ok && c.rls) rlsEnabled.add(c.table)
    }
  }
  return { newTables, rlsEnabled, grantsTest, knownFunctions }
}

/** The functions a migration creates, by name: main's for `knownFunctions`. */
export function functionsDefined(sql) {
  const names = new Set()
  try {
    for (const s of splitStatements(sql)) {
      const c = classify(s)
      if (c.kind === 'create function' && c.name) names.add(c.name)
    }
  } catch { /* an unreadable file defines nothing we can rely on */ }
  return names
}

/**
 * The hard exclusion: a merged migration is never changed or removed in a
 * chain. `changes` is `git diff --name-status` as rows `{status, path, from?}`.
 */
export function changedMigrationStops(changes) {
  const inMigrations = (p) => typeof p === 'string' && /^supabase\/migrations\//.test(p)
  // Only an added file is new; M, D, R, C and T all touch a merged one.
  return changes
    .filter(({ status, path, from }) => !/^A/.test(status) && (inMigrations(path) || inMigrations(from)))
    .map(({ path, from }) => `${inMigrations(from) ? from : path} is a merged migration, changed or removed`)
}
