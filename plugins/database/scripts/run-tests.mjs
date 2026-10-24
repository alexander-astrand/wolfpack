#!/usr/bin/env node
// Runs a project's SQL tests the way bro-code writes them, on dev only, and
// prints only what failed. For a project with no test command of its own.
//
// Usage: node scripts/run-tests.mjs [prefix] [--root <project>]
//   prefix   one suite while writing: a file name or its start (0035 works)
//   prints   FAIL <file> with its failed checks, indented; then one count line
//   exit 0   every suite said PASS
//   exit 1   a suite failed, or the prefix named none
//   exit 2   usage, or it can't tell that the target is dev: nothing ran
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (!argv[i + 1]) return { error: '--root needs a folder' }
      root = argv[++i]
    } else rest.push(argv[i])
  }
  if (rest.length > 1 || (rest[0] || '').startsWith('-')) return { error: 'usage: run-tests.mjs [prefix] [--root <project>]' }
  return { root: resolve(root), prefix: rest[0] ? basename(rest[0]) : null }
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
  return { ok, detail: lines.length ? lines : [`printed no PASS: ${all.slice(-1)[0] || '(nothing)'}`] }
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
      const sent = withHelpers(readFileSync(join(dir, f), 'utf8'), helpers)
      let result
      if (!CLOSES.test(sent)) {
        result = { ok: false, detail: ["no raise exception 'PASS': it would keep its rows, not run"] }
      } else {
        const copy = join(scratch, f)
        writeFileSync(copy, sent)
        const r = spawnSync(bin, ['db', 'query', flag, '-f', copy], { cwd: root, encoding: 'utf8' })
        result = r.error
          ? { ok: false, detail: [`could not start ${bin}: ${r.error.code || r.error.message}`] }
          : verdict((r.stdout || '') + (r.stderr || ''))
      }
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
  const { code, lines } = runAll({ ...args, flag: t.flag, bin: process.env.RUN_TESTS_SUPABASE || 'supabase' })
  console.log(lines.join('\n'))
  process.exit(code)
}
