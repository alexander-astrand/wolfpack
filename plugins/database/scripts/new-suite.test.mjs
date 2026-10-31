// new-suite.mjs in a temp project: no database.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs, skeleton, write } from './new-suite.mjs'
import { mutants } from './run-tests.mjs'

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'new-suite.mjs')

let root
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'new-suite-')))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the skeleton', () => {
  const text = skeleton('rsvp')

  it('is one transaction that always ends in raise exception, PASS or FAIL', () => {
    expect(text).toMatch(/^begin;$/m)
    expect(text).toContain('create temp table results (n serial, name text, ok boolean, detail text) on commit drop;')
    expect(text).toContain("raise exception 'PASS rsvp (% checks)', total;")
    expect(text).toContain("raise exception E'FAIL rsvp\\n%', failed;")
    expect(text).not.toMatch(/^\s*(commit|rollback);/m)
  })

  it('fails while it has no checks, and its fixtures are fixed uuids', () => {
    expect(text).toContain("raise exception 'FAIL rsvp: no checks yet';")
    expect(text).toContain("'00000000-0000-4000-a000-0000000000a1'")
    expect(text).toContain('a1 owner, a2 member, a3 outsider')
  })

  it('names the run and the mutate commands in its header', () => {
    expect(text).toContain('run-tests.mjs rsvp')
    expect(text).toContain('run-tests.mjs --mutate rsvp')
  })

  it('gives --mutate nothing to flip until a check is uncommented', () => {
    expect(mutants(text).mutants).toEqual([])
    const filled = text.replace("  -- perform pg_temp.expect_ok('a member", "  perform pg_temp.expect_ok('a member")
    expect(mutants(filled).mutants).toHaveLength(1)
  })
})

describe('writing it', () => {
  it('writes supabase/tests/<area>.test.sql once, never over a file', () => {
    const first = write({ root, area: 'rsvp' })
    expect(first.code).toBe(0)
    const file = join(root, 'supabase', 'tests', 'rsvp.test.sql')
    expect(first.lines).toEqual([file])
    expect(readFileSync(file, 'utf8')).toBe(skeleton('rsvp'))
    expect(write({ root, area: 'rsvp' }).code).toBe(1)
  })

  it("points at the project's -- @helpers suite when it keeps _helpers.sql", () => {
    const dir = join(root, 'supabase', 'tests')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '_helpers.sql'), 'select 1;\n')
    writeFileSync(join(dir, '0001_a.sql'), 'no helpers here\n')
    writeFileSync(join(dir, '0002_b.sql'), 'do $$ begin\n  -- @helpers\nend $$;\n')
    expect(write({ root, area: 'rsvp' }).lines[1]).toMatch(/placed as in 0002_b\.sql$/)
  })

  it('takes one plain area name', () => {
    expect(parseArgs(['rsvp', '--root', '/x'])).toEqual({ root: '/x', area: 'rsvp' })
    expect(parseArgs(['0042_event-rsvp']).area).toBe('0042_event-rsvp')
    expect(parseArgs(['../x']).error).toMatch(/usage/)
    expect(parseArgs(['a', 'b']).error).toMatch(/usage/)
    expect(parseArgs([]).error).toMatch(/usage/)
  })

  it('runs as a command', () => {
    const r = spawnSync(process.execPath, [RUN, 'rsvp', '--root', root], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(join(root, 'supabase', 'tests', 'rsvp.test.sql'))
    expect(spawnSync(process.execPath, [RUN], { encoding: 'utf8' }).status).toBe(2)
  })
})
