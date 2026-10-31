// run-tests.mjs against a fixture project and a fake `supabase`: no database.
// The fake logs its arguments and the file it was sent, and prints the
// suite's `-- fake:` line, so the tests cover the target choice, the helper
// paste, the prefix and the FAIL-only output.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mutants, parseArgs, target, verdict, withHelpers } from './run-tests.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUN = join(HERE, 'run-tests.mjs')

const FAKE = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const file = args[args.indexOf('-f') + 1]
const src = fs.readFileSync(file, 'utf8')
fs.appendFileSync(path.join(process.cwd(), 'calls.log'), args.join(' ') + '\\n')
fs.writeFileSync(path.join(process.cwd(), 'sent-' + path.basename(file)), src)
// \`-- fake-if <text>: <say>\` wins when <text> is in the rest of the suite
// (the --mutate tests: a flipped check that the suite notices).
const body = src.split('\\n').filter((l) => !l.startsWith('-- fake')).join('\\n')
const cond = [...src.matchAll(/^-- fake-if (.*?): (.*)$/gm)].find((m) => body.includes(m[1]))
const say = cond ? cond[2] : (src.match(/^-- fake: (.*)$/m) || [])[1] || ''
process.stderr.write(say.replace(/\\\\n/g, '\\n') + '\\n')
process.exit(1)
`

const PASSES = "do $$ begin raise exception 'PASS x (1 checks)'; end $$;\n"

let root, bin
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'run-tests-')))
  mkdirSync(join(root, '.claude'))
  mkdirSync(join(root, 'supabase', 'tests'), { recursive: true })
  writeFileSync(join(root, '.claude', 'kit.json'), JSON.stringify({ refs: { dev: 'localstackplaceholder', prod: 'bbbbbbbbbbbbbbbbbbbb' } }))
  bin = join(root, 'fake-supabase')
  // CommonJS on purpose: no package.json with "type" sits above the temp folder.
  writeFileSync(bin, FAKE)
  chmodSync(bin, 0o755)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const suite = (name, text) => writeFileSync(join(root, 'supabase', 'tests', name), text)
const run = (...args) => {
  const r = spawnSync('node', [RUN, ...args, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', RUN_TESTS_SUPABASE: bin },
  })
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}
const calls = () => (existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8').trim().split('\n') : [])

describe('the target', () => {
  it('is local for a placeholder dev ref', () => {
    expect(target(root)).toEqual({ flag: '--local' })
  })

  it('is linked only when the CLI is linked to refs.dev', () => {
    writeFileSync(join(root, '.claude', 'kit.json'), JSON.stringify({ refs: { dev: 'aaaaaaaaaaaaaaaaaaaa', prod: 'bbbbbbbbbbbbbbbbbbbb' } }))
    mkdirSync(join(root, 'supabase', '.temp'))
    writeFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'aaaaaaaaaaaaaaaaaaaa\n')
    expect(target(root)).toEqual({ flag: '--linked' })
    writeFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'bbbbbbbbbbbbbbbbbbbb\n')
    expect(target(root).error).toMatch(/production/)
    writeFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'cccccccccccccccccccc\n')
    expect(target(root).error).toMatch(/not refs.dev/)
  })

  it('is local when unlinked and CLAUDE.md says dev is a local Supabase', () => {
    writeFileSync(join(root, '.claude', 'kit.json'), JSON.stringify({ refs: { dev: 'aaaaaaaaaaaaaaaaaaaa' } }))
    expect(target(root).error).toMatch(/unlinked/)
    writeFileSync(join(root, 'CLAUDE.md'), 'The dev server runs against the local Supabase stack.\n')
    expect(target(root)).toEqual({ flag: '--local' })
  })

  it('refuses with no kit.json, and when the project test command disagrees', () => {
    rmSync(join(root, '.claude', 'kit.json'))
    expect(target(root).error).toMatch(/refs.dev/)
    writeFileSync(join(root, '.claude', 'kit.json'), JSON.stringify({ refs: { dev: 'localstackplaceholder' } }))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'test:db': 'supabase db query --linked -f x.sql' } }))
    expect(target(root).error).toMatch(/test:db/)
  })

  it('runs nothing when it refuses', () => {
    rmSync(join(root, '.claude', 'kit.json'))
    suite('0001_a.sql', PASSES)
    const r = run()
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/refused, nothing ran/)
    expect(calls()).toEqual([])
  })
})

describe('a run', () => {
  it('prints only the count when every suite passes', () => {
    suite('0001_a.sql', `${PASSES}-- fake: PASS a (3 checks)\n`)
    suite('0002_b.sql', `${PASSES}-- fake: PASS b (2 checks)\n`)
    suite('_helpers.sql', 'select 1;\n')
    const r = run()
    expect(r.code).toBe(0)
    expect(r.out).toBe('2 suites: 2 passed, 0 failed')
    expect(calls()).toHaveLength(2)
    expect(calls()[0]).toMatch(/^db query --local -f .*0001_a\.sql$/)
  })

  it('prints FAIL names with their failed checks and exits 1', () => {
    suite('0001_a.sql', `${PASSES}-- fake: PASS a (3 checks)\n`)
    suite('0002_b.sql', `${PASSES}-- fake: ERROR: FAIL b\\n  a member can't see group B's events\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).not.toMatch(/0001_a/)
    expect(r.out).toMatch(/^FAIL 0002_b\.sql\n {4}ERROR: FAIL b\n {4}a member can't see group B's events$/m)
    expect(r.out).toMatch(/1 failed$/)
  })

  it('narrows to a prefix, and fails on a prefix that names none', () => {
    suite('0001_a.sql', `${PASSES}-- fake: PASS a\n`)
    suite('0035_just.sql', `${PASSES}-- fake: PASS just\n`)
    expect(run('0035').out).toBe('1 suite: 1 passed, 0 failed')
    expect(calls()).toHaveLength(1)
    const none = run('0099')
    expect(none.code).toBe(1)
    expect(none.out).toMatch(/no suite named 0099/)
  })

  it('pastes the helpers at -- @helpers, and the closing raise may come from them', () => {
    suite('_helpers.sql', "  raise exception 'PASS % (% checks)', suite, total;\n")
    suite('0001_a.sql', 'do $$ begin\n  -- @helpers\nend $$;\n-- fake: PASS a\n')
    const r = run()
    expect(r.code).toBe(0)
    expect(readFileSync(join(root, 'sent-0001_a.sql'), 'utf8')).toMatch(/raise exception 'PASS %/)
  })

  it('never sends a suite that would keep its rows', () => {
    suite('0001_a.sql', 'insert into public.things values (1);\n-- fake: PASS a\n')
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAIL 0001_a\.sql\n {4}no raise exception 'PASS'/)
    expect(calls()).toEqual([])
  })
})

describe('--mutate', () => {
  const SUITE = [
    'create function pg_temp.expect_ok(n text) returns void language sql as $$ select $$;',
    'do $$ begin',
    "  perform pg_temp.expect_ok('strong');",
    "  -- perform pg_temp.expect_ok('commented');",
    "  perform pg_temp.expect_error('weak'); perform pg_temp.expect_count('n', 1);",
    "  raise exception 'PASS m (2 checks)';",
    'end $$;',
    '-- fake: PASS m (2 checks)',
    "-- fake-if expect_error('strong': FAIL m\\n  strong flipped",
  ].join('\n')

  it('flips each expect_ok and expect_error call once, skipping comments and definitions', () => {
    const { mutants: list, other } = mutants(SUITE)
    expect(list.map((m) => m.line)).toEqual([3, 5])
    expect(list[0].src).toContain("pg_temp.expect_error('strong')")
    expect(list[1].src).toContain("pg_temp.expect_ok('weak')")
    expect(other).toBe(1)
  })

  it('prints the check that survives and exits 1', () => {
    suite('0040_m.sql', SUITE)
    const r = run('--mutate', '0040')
    expect(r.code).toBe(1)
    expect(r.out).toBe("SURVIVED 0040_m.sql:5 perform pg_temp.expect_error('weak'); perform pg_temp.expect_count('n', 1);\n2 flipped: 1 failed as they should, 1 survived; 1 other checks not mutated")
    expect(calls()).toHaveLength(3)
  })

  it('exits 0 when every flip fails, and refuses a suite that fails as it is', () => {
    suite('0041_ok.sql', `do $$ begin perform pg_temp.expect_ok('a'); ${PASSES}end $$;\n-- fake: PASS ok\n-- fake-if expect_error('a': FAIL ok\n`)
    expect(run('--mutate', '0041')).toMatchObject({ code: 0, out: '1 flipped: 1 failed as they should, 0 survived; 0 other checks not mutated' })
    suite('0042_bad.sql', `${PASSES}-- fake: FAIL bad\n`)
    expect(run('--mutate', '0042').out).toMatch(/^FAIL 0042_bad\.sql as it is/)
    expect(run('--mutate', '004').out).toMatch(/exactly one suite; 004 matched 2/)
  })

  it('counts a flip that prints nothing as an ERROR, not as failed, and exits 1', () => {
    suite('0043_mute.sql', `do $$ begin perform pg_temp.expect_ok('a'); ${PASSES}end $$;\n-- fake: PASS mute\n-- fake-if expect_error('a': \n`)
    const r = run('--mutate', '0043')
    expect(r.code).toBe(1)
    expect(r.out).toBe("ERROR 0043_mute.sql:1 printed no PASS: (nothing)\n1 flipped: 0 failed as they should, 0 survived, 1 gave no verdict; 0 other checks not mutated")
  })
})

describe('the parts', () => {
  it('parses the prefix and the root', () => {
    expect(parseArgs(['0035', '--root', '/x'])).toEqual({ root: '/x', prefix: '0035', mutate: false })
    expect(parseArgs(['--mutate', '0035', '--root', '/x']).mutate).toBe(true)
    expect(parseArgs(['--mutate']).error).toMatch(/needs one suite/)
    expect(parseArgs(['supabase/tests/0035_a.sql', '--root', '/x']).prefix).toBe('0035_a.sql')
    expect(parseArgs(['a', 'b']).error).toMatch(/usage/)
    expect(parseArgs(['--root']).error).toMatch(/needs a folder/)
  })

  it('judges by the text: PASS and no FAIL', () => {
    expect(verdict('ERROR: PASS a (2 checks)').ok).toBe(true)
    expect(verdict('ERROR: FAIL a\n x').ok).toBe(false)
    expect(verdict('connection refused').detail[0]).toMatch(/printed no PASS/)
    expect(verdict('connection refused').failed).toBe(false)
    expect(verdict('ERROR: FAIL a\n x').failed).toBe(true)
    expect(withHelpers('a\n-- @helpers\nb', 'H')).toBe('a\nH\nb')
  })
})
