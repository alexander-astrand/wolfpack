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
import { LANE_TAG, devTarget, hostOf, pair, parseArgs, run as seedRun, tagFor, targetsOf } from './seed.mjs'

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
    expect(parseArgs(['up', 'soap', '--root', root])).toEqual({ cmd: 'up', name: 'soap', dryRun: false, sheet: false, root })
    expect(parseArgs(['down', 'soap', '--dry-run'])).toMatchObject({ cmd: 'down', name: 'soap', dryRun: true })
    expect(parseArgs(['list'])).toMatchObject({ cmd: 'list', name: null, sheet: false })
    expect(parseArgs(['list', '--sheet'])).toMatchObject({ cmd: 'list', sheet: true })
    expect(parseArgs(['up', 'soap', '--sheet']).error).toMatch(/--sheet goes with list/)
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

// The one dev-only target check, for seed.mjs and the design plugin's qa-seed.mjs alike.
describe('devTarget', () => {
  const never = () => {
    throw new Error('picked the CLI target for a URL')
  }
  it('without a URL is run-tests target(): its flag, or its refusal', () => {
    expect(devTarget(root)).toEqual({ args: ['--local'], label: '--local' })
    expect(devTarget(root, { pick: () => ({ error: 'the CLI is linked to production; refused' }) })).toEqual({ error: 'the CLI is linked to production; refused' })
  })
  it('passes a local URL as --db-url and refuses a hosted one unless allowed', () => {
    expect(devTarget(root, { db: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', pick: never })).toEqual({ args: ['--db-url', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'], label: 'db-url:127.0.0.1' })
    expect(devTarget(root, { db: 'postgresql://u@db.example.co:5432/postgres', pick: never }).error).toMatch(/needs --allow-host db\.example\.co/)
    expect(devTarget(root, { db: 'postgresql://u@db.example.co:5432/postgres', allowHost: 'db.example.co' }).label).toBe('db-url:db.example.co')
    expect(devTarget(root, { db: 'nope' }).error).toMatch(/does not parse/)
    expect(() => hostOf('nope')).toThrow(/does not parse/)
  })
  it('refuses a local URL whose query sends libpq elsewhere (kit 1.8 review MUST 4)', () => {
    const at = (db, allowHost = null) => devTarget(root, { db, allowHost, pick: never })
    expect(at('postgresql://u@localhost:5432/postgres?host=db.example.co').error).toMatch(/db\.example\.co is not a local database; .*--allow-host db\.example\.co/)
    expect(at('postgresql://u@127.0.0.1/postgres?hostaddr=127.0.0.1,10.0.0.9').error).toMatch(/10\.0\.0\.9 is not a local/)
    expect(at('postgresql://u@localhost/postgres?service=prod').error).toMatch(/needs --allow-host service=prod/)
    expect(at('postgresql://u@localhost/postgres?service=devsvc', 'service=devsvc').label).toBe('db-url:localhost')
    expect(at('postgresql://u@localhost/postgres?host=db.example.co', 'db.example.co').label).toBe('db-url:localhost')
    expect(at('postgresql://u@localhost/postgres?host=127.0.0.1&sslmode=disable').label).toBe('db-url:localhost')
    expect(targetsOf('postgresql://u@localhost/db?host=a,b&service=s')).toEqual(['localhost', 'a', 'b', 'service=s'])
  })
  // A Supavisor host serves production too; only the user postgres.<ref> tells them apart (kit 1.9 review R1-6).
  // The fixture kit.json (beforeEach) has refs.dev localstackplaceholder and refs.prod bbbbbbbbbbbbbbbbbbbb.
  const POOLER = 'aws-0-eu-north-1.pooler.supabase.com'
  const PROD = 'bbbbbbbbbbbbbbbbbbbb'
  const at = (db, allowHost = POOLER) => devTarget(root, { db, allowHost, pick: never })
  it('refuses a user or host naming refs.prod, whatever --allow-host says', () => {
    expect(at(`postgresql://postgres.${PROD}:pw@${POOLER}:6543/postgres`).error).toMatch(/names the production project/)
    expect(at(`postgresql://postgres@db.${PROD}.supabase.co/postgres`, `db.${PROD}.supabase.co`).error).toMatch(/db\.b+\.supabase\.co names the production project/)
    expect(at(`postgresql://u@localhost/postgres?host=db.${PROD}.supabase.co`, `db.${PROD}.supabase.co`).error).toMatch(/names the production project/)
    expect(at(`postgresql://postgres.localstackplaceholder@${POOLER}/postgres?user=postgres.${PROD}`).error).toMatch(/names the production project/)
    expect(at(`postgresql://POSTGRES.${PROD.toUpperCase()}@${POOLER}/postgres`).error).toMatch(/names the production project/)
  })
  it('on a pooler host takes only the user postgres.<refs.dev>', () => {
    expect(at(`postgresql://postgres.localstackplaceholder:pw@${POOLER}:6543/postgres`)).toEqual({ args: ['--db-url', `postgresql://postgres.localstackplaceholder:pw@${POOLER}:6543/postgres`], label: `db-url:${POOLER}` })
    expect(at(`postgresql://postgres:pw@${POOLER}:6543/postgres`).error).toMatch(/user must be postgres\.localstackplaceholder .*not postgres$/)
    expect(at(`postgresql://${POOLER}:6543/postgres`).error).toMatch(/not \(none\)/)
    expect(at(`postgresql://postgres.someoneelse@${POOLER}/postgres`).error).toMatch(/not postgres\.someoneelse/)
    // The pooler rule doesn't stand in for --allow-host: the host still has to be allowed.
    expect(at(`postgresql://postgres.localstackplaceholder@${POOLER}/postgres`, null).error).toMatch(/needs --allow-host aws-0/)
  })
  it('refuses a pooler host without refs.dev, and adds no prod refusal without refs.prod', () => {
    writeFileSync(join(root, '.claude', 'kit.json'), JSON.stringify({ project: { name: 'fixture' } }))
    expect(at(`postgresql://postgres.localstackplaceholder@${POOLER}/postgres`).error).toMatch(/no refs\.dev/)
    expect(at(`postgresql://postgres@db.${PROD}.supabase.co/postgres`, `db.${PROD}.supabase.co`).label).toBe(`db-url:db.${PROD}.supabase.co`)
    rmSync(join(root, '.claude', 'kit.json'))
    expect(at(`postgresql://postgres@db.${PROD}.supabase.co/postgres`, `db.${PROD}.supabase.co`).label).toBe(`db-url:db.${PROD}.supabase.co`)
  })
})

describe('a lane seed', () => {
  const LUP = `insert into events (title) values ('${LANE_TAG}');\n`
  const LDOWN = `delete from events where title = '${LANE_TAG}';\n`
  it('accepts the {{LANE}} tag, fills the lane (qa by default) and passes the target args', () => {
    seedFile('night.up.sql', LUP)
    seedFile('night.down.sql', LDOWN)
    process.env.GALE_STATE_DIR = state
    const calls = []
    const exec = (b, a) => (calls.push({ a, sent: readFileSync(a.at(-1), 'utf8') }), { status: 0, stdout: '' })
    const target = { args: ['--db-url', 'postgresql://u@localhost/d'], label: 'db-url:localhost' }
    let r = seedRun({ root, cmd: 'up', name: 'night', target, lane: 'magnus', exec })
    expect(r.code).toBe(0)
    expect(calls[0].a.slice(0, 4)).toEqual(['db', 'query', '--db-url', 'postgresql://u@localhost/d'])
    expect(calls[0].sent).toContain("'TEST QA seed magnus'")
    expect(r.lines.at(-1)).toBe('seed: up night done on dev (db-url:localhost), lane magnus; undo with qa-seed.mjs down night --lane magnus')
    r = seedRun({ root, cmd: 'down', name: 'night', flag: '--local', exec })
    expect(calls[1].sent).toBe("delete from events where title = 'TEST QA seed qa';\n")
    expect(readFileSync(join(state, 'fixture', 'qa.log'), 'utf8')).toMatch(/ up night db-url:localhost ok\n.* down night --local ok\n$/)
    delete process.env.GALE_STATE_DIR
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

describe('list --sheet', () => {
  it('prints each seed with what it makes, its undo file and how to run it', () => {
    seedFile('soap.up.sql', `-- three soaps in the bathroom\n${UP('soap')}`)
    seedFile('soap.down.sql', DOWN('soap'))
    seedFile('trips.up.sql', `insert into public.trips (label) values ('${LANE_TAG}');\ninsert into stops (label) values ('${LANE_TAG}');\n`)
    seedFile('trips.down.sql', `delete from public.trips where label = '${LANE_TAG}';\n`)
    seedFile('half.up.sql', UP('half'))
    const { code, out } = run('list', '--sheet')
    expect(code).toBe(0)
    expect(out.split('\n')).toEqual([
      'Seed sheet (scripts/qa/seeds, dev only):',
      '- half: rows in things; undo no down file (it will not run); run `seed.mjs up half`',
      '- soap: three soaps in the bathroom; undo scripts/qa/seeds/soap.down.sql; run `seed.mjs up soap`',
      '- trips (lane seed): rows in trips, stops; undo scripts/qa/seeds/trips.down.sql; run `qa-seed.mjs up trips --lane <lane>`',
    ])
    expect(calls()).toEqual([])
  })

  it('says so when there are no seeds', () => {
    expect(run('list', '--sheet').out).toBe('Seed sheet (scripts/qa/seeds, dev only):\n- none: no scripts/qa/seeds/*.up.sql')
  })
})
