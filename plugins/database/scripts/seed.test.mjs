// seed.mjs against a fixture project and a fake `supabase`: no database. The
// fake logs its arguments and the file it was sent, so the tests cover the
// pair check (no up without a down, the tag in both), the dry run, the dev
// target, the log and `list`.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pair, parseArgs, tagFor } from './seed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUN = join(HERE, 'seed.mjs')

const FAKE = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const file = args[args.indexOf('-f') + 1]
const src = fs.readFileSync(file, 'utf8')
fs.appendFileSync(path.join(process.cwd(), 'calls.log'), args.join(' ') + '\\n')
fs.writeFileSync(path.join(process.cwd(), 'sent-' + path.basename(file)), src)
if (/-- fake: error/.test(src)) { process.stderr.write('ERROR: relation "nope" does not exist\\n'); process.exit(1) }
process.stdout.write('[{"added":3}]\\n')
`

let root, bin, state
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'gale-seed-')))
  state = join(root, 'state')
  mkdirSync(join(root, '.claude'))
  mkdirSync(join(root, 'scripts', 'qa', 'seeds'), { recursive: true })
  writeFileSync(join(root, '.claude', 'kit.json'), JSON.stringify({ project: { name: 'fixture' }, refs: { dev: 'localstackplaceholder', prod: 'bbbbbbbbbbbbbbbbbbbb' } }))
  bin = join(root, 'fake-supabase')
  writeFileSync(bin, FAKE)
  chmodSync(bin, 0o755)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const seedFile = (name, text) => writeFileSync(join(root, 'scripts', 'qa', 'seeds', name), text)
const UP = (n) => `insert into public.things (name) values ('Soap (${tagFor(n)})');\n`
const DOWN = (n) => `delete from public.things where name like '%${tagFor(n)}%';\n`
const run = (...args) => {
  const r = spawnSync('node', [RUN, ...args, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', RUN_TESTS_SUPABASE: bin, GALE_STATE_DIR: state },
  })
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}
const calls = () => (existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8').trim().split('\n') : [])

describe('the arguments', () => {
  it('take up, down and list', () => {
    expect(parseArgs(['up', 'soap', '--root', root])).toEqual({ cmd: 'up', name: 'soap', dryRun: false, root })
    expect(parseArgs(['down', 'soap', '--dry-run'])).toMatchObject({ cmd: 'down', name: 'soap', dryRun: true })
    expect(parseArgs(['list'])).toMatchObject({ cmd: 'list', name: null })
  })

  it('refuse a bad name, a missing name and an unknown command', () => {
    expect(parseArgs(['up', 'Soap!']).error).toMatch(/seed name/)
    expect(parseArgs(['up']).error).toMatch(/seed name/)
    expect(parseArgs(['sideways', 'soap']).error).toMatch(/usage/)
    expect(parseArgs(['list', 'soap']).error).toMatch(/no name/)
  })
})

describe('the pair', () => {
  it('needs both files and the tag in each', () => {
    seedFile('soap.up.sql', UP('soap'))
    expect(pair(root, 'soap').error).toMatch(/no .*soap\.down\.sql/)
    seedFile('soap.down.sql', "delete from public.things where name like '%Soap%';\n")
    expect(pair(root, 'soap').error).toMatch(/never names the tag/)
    seedFile('soap.down.sql', DOWN('soap'))
    expect(pair(root, 'soap')).toMatchObject({ tag: tagFor('soap') })
    seedFile('soap.up.sql', "insert into public.things (name) values ('Soap');\n")
    expect(pair(root, 'soap').error).toMatch(/never writes the tag/)
  })

  it('refuses an up that deletes and a down that drops', () => {
    seedFile('soap.up.sql', UP('soap') + DOWN('soap'))
    seedFile('soap.down.sql', DOWN('soap'))
    expect(pair(root, 'soap').error).toMatch(/up only adds/)
    seedFile('soap.up.sql', UP('soap'))
    seedFile('soap.down.sql', DOWN('soap') + 'drop table public.things;\n')
    expect(pair(root, 'soap').error).toMatch(/only deletes/)
  })
})

describe('running', () => {
  beforeEach(() => {
    seedFile('soap.up.sql', UP('soap'))
    seedFile('soap.down.sql', DOWN('soap'))
  })

  it('dry-run prints the target and the SQL and calls nothing', () => {
    const r = run('up', 'soap', '--dry-run')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/would run on dev \(--local\)/)
    expect(r.out).toContain(UP('soap').trim())
    expect(calls()).toEqual([])
    expect(existsSync(join(state, 'fixture', 'qa.log'))).toBe(false)
  })

  it('up sends the up file to dev as one query and logs it; down the down file', () => {
    let r = run('up', 'soap')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/up soap done on dev \(--local\); undo with seed.mjs down soap/)
    expect(calls()).toHaveLength(1)
    expect(calls()[0]).toMatch(/^db query --local -f .*soap\.up\.sql$/)
    expect(readFileSync(join(root, 'sent-soap.up.sql'), 'utf8')).toBe(UP('soap'))
    r = run('down', 'soap')
    expect(r.code).toBe(0)
    expect(readFileSync(join(root, 'sent-soap.down.sql'), 'utf8')).toBe(DOWN('soap'))
    const log = readFileSync(join(state, 'fixture', 'qa.log'), 'utf8').trim().split('\n')
    expect(log).toHaveLength(2)
    expect(log[0]).toMatch(/ up soap --local ok$/)
    expect(log[1]).toMatch(/ down soap --local ok$/)
  })

  it('reports the CLI error and exits 1', () => {
    seedFile('soap.up.sql', '-- fake: error\n' + UP('soap'))
    const r = run('up', 'soap')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ERROR: relation/)
    expect(r.out).toMatch(/up soap failed on dev/)
  })

  it('refuses without a down file, and when dev is unknown', () => {
    rmSync(join(root, 'scripts', 'qa', 'seeds', 'soap.down.sql'))
    let r = run('up', 'soap')
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/never runs without its down/)
    expect(calls()).toEqual([])
    seedFile('soap.down.sql', DOWN('soap'))
    writeFileSync(join(root, '.claude', 'kit.json'), JSON.stringify({ project: { name: 'fixture' }, refs: { dev: 'aaaaaaaaaaaaaaaaaaaa' } }))
    r = run('up', 'soap')
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/unlinked/)
    expect(calls()).toEqual([])
  })
})

describe('list', () => {
  it('shows each pair with its last action, a half pair, and the receipts', () => {
    seedFile('soap.up.sql', UP('soap'))
    seedFile('soap.down.sql', DOWN('soap'))
    seedFile('half.up.sql', UP('half'))
    expect(run('list').out).toMatch(/^half: missing its down file\nsoap: never run\nno real-mode receipts$/m)
    run('up', 'soap')
    mkdirSync(join(state, 'fixture'), { recursive: true })
    writeFileSync(join(state, 'fixture', '2026-10-31-cleaning.json'), JSON.stringify({ project: 'fixture', mode: 'real', rows: [{ kind: 'supplies', id: '1' }, { kind: 'supplies', id: '2' }] }))
    writeFileSync(join(state, 'fixture', '2026-10-30-pantry.json'), JSON.stringify({ project: 'fixture', mode: 'real', rows: [{ kind: 'pantry_items', id: '3' }], undone_at: '2026-10-31' }))
    const out = run('list').out
    expect(out).toMatch(/soap: last up \S+ \(ok\)/)
    expect(out).toMatch(/receipt 2026-10-30-pantry: 1 rows, undone 2026-10-31/)
    expect(out).toMatch(/receipt 2026-10-31-cleaning: 2 rows$/m)
  })
})
