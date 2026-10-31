#!/usr/bin/env node
// Runs a project's SQL tests the way bro-code writes them, on dev only, and
// prints only what failed. For a project with no test command of its own.
//
// Usage: node scripts/run-tests.mjs [prefix] [--root <project>]
//        node scripts/run-tests.mjs --mutate <suite> [--root <project>]
//   prefix   one suite while writing: a file name or its start (0035 works)
//   prints   FAIL <file> with its failed checks, indented; then one count line
//   exit 0   every suite said PASS
//   exit 1   a suite failed, or the prefix named none
//   exit 2   usage, or it can't tell that the target is dev: nothing ran
//
// --mutate: the proof each check can fail (bro-code's "loosen the rule once
// and see FAIL", kit 1.7.1 council Feature 19). The suite must PASS as it is;
// then it runs once per `expect_ok(` / `expect_error(` call in the suite's
// own text with that one call flipped to the other, and each run must FAIL.
// A run that still says PASS prints `SURVIVED <file>:<line>`: that check
// passes whatever the rule does. It covers only those two helpers (other
// checks, such as expect_count, are counted as not mutated), never the
// pasted helpers, a comment or a line defining a helper, and costs one run
// per call, so it is for the access-rule steps, one suite at a time. A flip
// counts as failed only when its output says FAIL; a run with no verdict
// (nothing printed, a CLI error, a dropped connection) prints
// `ERROR <file>:<line> <detail>`. exit 1 on any survivor or ERROR.
//
// What it does, per bro-code: every supabase/tests/*.sql not starting with _
// (those are pasted, never run alone), sorted; a suite's `-- @helpers` line
// becomes supabase/tests/_helpers.sql in a temp copy, so the suite stays one
// DO block; each runs as one `supabase db query -f`. A suite proves itself in
// one transaction that ends by raising PASS or FAIL, which is what rolls it
// back, so the verdict is the text and not the exit code. A suite with no
// `raise exception 'PASS` (after the paste) would keep its rows on dev: it
// is a FAIL and is never sent.
//
// Dev only. Local (`--local`) when refs.dev in .claude/kit.json is a
// placeholder naming a local stack, or the CLI is unlinked and the project's
// CLAUDE.md says dev is a local Supabase. Hosted (`--linked`) only when
// supabase/.temp/project-ref is refs.dev. When the project's own package.json
// test command names the other flag, or none of this holds, it refuses.
//
// Why it exists: "run them all after every change" over a hundred suites,
// each FAIL bringing its suite's lines, and piping to tail hid the exit code
// (kit 1.6.1 council, M8 and Feature 3). Run one suite while writing, all
// once at the end, and read only the failures.
//
// The root is --root, else CLAUDE_PROJECT_DIR, else the current folder.
// RUN_TESTS_SUPABASE names the CLI binary (the tests point it at a fake).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export function parseArgs(argv) {
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const rest = []
  let mutate = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (!argv[i + 1]) return { error: '--root needs a folder' }
      root = argv[++i]
    } else if (argv[i] === '--mutate') mutate = true
    else rest.push(argv[i])
  }
  if (rest.length > 1 || (rest[0] || '').startsWith('-')) return { error: 'usage: run-tests.mjs [prefix] [--root <project>] | --mutate <suite>' }
  if (mutate && !rest[0]) return { error: '--mutate needs one suite' }
  return { root: resolve(root), prefix: rest[0] ? basename(rest[0]) : null, mutate }
}

/** `{ flag }` for dev, or `{ error }` when it can't tell. Never production. */
export function target(root) {
  let kit
  try {
    kit = JSON.parse(read(join(root, '.claude', 'kit.json')) || 'null')
  } catch {
    return { error: '.claude/kit.json does not parse' }
  }
  const dev = kit?.refs?.dev
  const prod = kit?.refs?.prod
  if (!dev) return { error: 'no refs.dev in .claude/kit.json, so dev is unknown' }
  const linked = read(join(root, 'supabase', '.temp', 'project-ref')).trim()
  const claude = read(join(root, 'CLAUDE.md'))

  let flag
  if (/^local/i.test(dev)) flag = '--local'
  else if (linked) {
    if (prod && linked === prod) return { error: 'the CLI is linked to production; refused' }
    if (linked !== dev) return { error: `the CLI is linked to ${linked}, not refs.dev; relink is a person's call` }
    flag = '--linked'
  } else if (/local (supabase|stack)/i.test(claude)) flag = '--local'
  else return { error: 'the CLI is unlinked and nothing says dev is local' }

  // The project's own test command is the other source of truth: disagree, stop.
  let scripts = {}
  try {
    scripts = JSON.parse(read(join(root, 'package.json')) || '{}').scripts || {}
  } catch {}
  const other = flag === '--local' ? '--linked' : '--local'
  const named = Object.entries(scripts).find(([k, v]) => /test/.test(k) && /db query/.test(v) && v.includes(other))
  if (named) return { error: `package.json "${named[0]}" runs ${other}, this would run ${flag}` }
  return { flag }
}

/** The suites to run: sorted, no _ files, narrowed by the prefix. */
export function suites(root, prefix) {
  const dir = join(root, 'supabase', 'tests')
  const all = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('_')).sort() : []
  return prefix ? all.filter((f) => f === prefix || f.startsWith(prefix)) : all
}

const HELPERS_LINE = /^[ \t]*-- @helpers[ \t]*$/m
const CLOSES = /raise\s+exception\s+E?'PASS/i

/** The suite's text as it is sent: helpers pasted at `-- @helpers`. */
export function withHelpers(src, helpers) {
  return HELPERS_LINE.test(src) ? src.replace(HELPERS_LINE, () => helpers) : src
}

/** A suite's verdict from the CLI's output. */
export function verdict(out) {
  const ok = out.includes('PASS ') && !out.includes('FAIL')
  // E'FAIL %\n%' puts the failed checks on the lines after the FAIL line.
  const all = out.split('\n').map((l) => l.trim()).filter(Boolean)
  const at = all.findIndex((l) => l.includes('FAIL'))
  const lines = at < 0 ? [] : all.slice(at, at + 20)
  // `failed` is the suite's own FAIL, as distinct from no verdict at all (an
  // empty answer, a CLI error, a dropped connection): --mutate needs the two apart.
  return { ok, failed: at >= 0, detail: lines.length ? lines : [`printed no PASS: ${all.slice(-1)[0] || '(nothing)'}`] }
}

/** Sends one suite's text (helpers already pasted) and returns its verdict. */
function send({ root, flag, bin, scratch, name, sent }) {
  if (!CLOSES.test(sent)) return { ok: false, detail: ["no raise exception 'PASS': it would keep its rows, not run"] }
  const copy = join(scratch, name)
  writeFileSync(copy, sent)
  const r = spawnSync(bin, ['db', 'query', flag, '-f', copy], { cwd: root, encoding: 'utf8' })
  return r.error
    ? { ok: false, detail: [`could not start ${bin}: ${r.error.code || r.error.message}`] }
    : verdict((r.stdout || '') + (r.stderr || ''))
}

const CHECK_CALL = /\bexpect_(ok|error)(\s*\()/g
const OTHER_CHECK = /\bexpect_(?!ok\b|error\b)\w+\s*\(/g
// A comment, or a line that defines a helper, is not a check to flip.
const NOT_A_CHECK_LINE = /^\s*--|\bfunction\s+(pg_temp\.)?expect_/i

/** One copy of the suite per flippable check, that check flipped. */
export function mutants(src) {
  const lines = src.split('\n')
  const out = []
  let other = 0
  lines.forEach((line, i) => {
    if (NOT_A_CHECK_LINE.test(line)) return
    other += (line.match(OTHER_CHECK) || []).length
    for (const m of line.matchAll(CHECK_CALL)) {
      const flipped = `expect_${m[1] === 'ok' ? 'error' : 'ok'}${m[2]}`
      const changed = line.slice(0, m.index) + flipped + line.slice(m.index + m[0].length)
      out.push({ line: i + 1, text: line.trim(), src: [...lines.slice(0, i), changed, ...lines.slice(i + 1)].join('\n') })
    }
  })
  return { mutants: out, other }
}

/** --mutate: the suite passes as it is, and fails with any one check flipped. */
export function runMutate({ root, prefix, flag, bin = 'supabase' }) {
  const files = suites(root, prefix)
  if (files.length !== 1) return { code: 1, lines: [`FAIL --mutate needs exactly one suite; ${prefix} matched ${files.length}`] }
  const [f] = files
  const dir = join(root, 'supabase', 'tests')
  const helpers = read(join(dir, '_helpers.sql'))
  const src = readFileSync(join(dir, f), 'utf8')
  const { mutants: list, other } = mutants(src)
  const scratch = mkdtempSync(join(tmpdir(), 'run-tests-'))
  try {
    const base = send({ root, flag, bin, scratch, name: f, sent: withHelpers(src, helpers) })
    if (!base.ok) return { code: 1, lines: [`FAIL ${f} as it is, so nothing to mutate`, ...base.detail.map((d) => `    ${d}`)] }
    if (!list.length) return { code: 1, lines: [`FAIL ${f}: no expect_ok( or expect_error( call to flip (${other} other checks)`] }
    const lines = []
    let survived = 0
    let errors = 0
    for (const m of list) {
      const r = send({ root, flag, bin, scratch, name: f, sent: withHelpers(m.src, helpers) })
      if (r.ok) {
        survived++
        lines.push(`SURVIVED ${f}:${m.line} ${m.text}`)
      } else if (!r.failed) {
        // Killed means the suite said FAIL. No answer is no proof either way:
        // counting it as killed would let a dropped connection pass the check.
        errors++
        lines.push(`ERROR ${f}:${m.line} ${r.detail[0]}`)
      }
    }
    const killed = list.length - survived - errors
    lines.push(`${list.length} flipped: ${killed} failed as they should, ${survived} survived${errors ? `, ${errors} gave no verdict` : ''}; ${other} other checks not mutated`)
    return { code: survived || errors ? 1 : 0, lines }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

export function runAll({ root, prefix, flag, bin = 'supabase' }) {
  const files = suites(root, prefix)
  const lines = []
  if (prefix && !files.length) return { code: 1, lines: [`FAIL no suite named ${prefix} in supabase/tests`] }
  if (!files.length) return { code: 0, lines: ['no SQL tests yet'] }

  const dir = join(root, 'supabase', 'tests')
  const helpers = read(join(dir, '_helpers.sql'))
  const scratch = mkdtempSync(join(tmpdir(), 'run-tests-'))
  let failed = 0
  try {
    for (const f of files) {
      const result = send({ root, flag, bin, scratch, name: f, sent: withHelpers(readFileSync(join(dir, f), 'utf8'), helpers) })
      if (!result.ok) {
        failed++
        lines.push(`FAIL ${f}`, ...result.detail.map((d) => `    ${d}`))
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  lines.push(`${files.length} ${files.length === 1 ? 'suite' : 'suites'}: ${files.length - failed} passed, ${failed} failed`)
  return { code: failed ? 1 : 0, lines }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    process.stderr.write(`run-tests: ${args.error}\n`)
    process.exit(2)
  }
  const t = target(args.root)
  if (t.error) {
    process.stderr.write(`run-tests: refused, nothing ran: ${t.error}\n`)
    process.exit(2)
  }
  const run = args.mutate ? runMutate : runAll
  const { code, lines } = run({ ...args, flag: t.flag, bin: process.env.RUN_TESTS_SUPABASE || 'supabase' })
  console.log(lines.join('\n'))
  process.exit(code)
}
