// The wrapper's own rules only: the lane, seed=shared and the arguments. The pair check and the
// dev-only target (the ?host= case included) are seed.mjs's, tested once in seed.test.mjs.
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { laneOf, parseArgs, run } from './qa-seed.mjs'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qa-seed-'))
  mkdirSync(join(root, 'scripts', 'qa', 'seeds'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'qa', 'seeds', 'night.up.sql'), "insert into events (title) values ('TEST QA seed {{LANE}}') returning id;")
  writeFileSync(join(root, 'scripts', 'qa', 'seeds', 'night.down.sql'), "delete from events where title = 'TEST QA seed {{LANE}}';")
  process.env.GALE_STATE_DIR = join(root, 'state')
})
afterEach(() => {
  delete process.env.GALE_STATE_DIR
  rmSync(root, { recursive: true, force: true })
})

const args = (list, env = {}) => ({ ...parseArgs(list, env, '/proj'), root })
const local = () => ({ flag: '--local' })
const never = () => {
  throw new Error('ran the CLI')
}

describe('parseArgs', () => {
  it('reads the action, name, lane and shared flag, with the defaults', () => {
    expect(parseArgs(['up', 'night'], {}, '/proj')).toMatchObject({ action: 'up', name: 'night', lane: null, shared: false, root: '/proj', db: null })
    expect(parseArgs(['down', 'night', '--lane', 'magnus', 'seed=shared', '--root', 'app'], { QA_SEED_DB_URL: 'postgresql://u@localhost:5432/d' }, '/proj')).toMatchObject({ lane: 'magnus', shared: true, root: '/proj/app', db: 'postgresql://u@localhost:5432/d' })
  })
  it('refuses a bad action, name or lane', () => {
    expect(() => args(['seed', 'night'])).toThrow(/up or down/)
    expect(() => args(['up', '../x'])).toThrow(/seed name/)
    expect(() => args(['up', 'x', '--lane', 'a b'])).toThrow(/--lane/)
    expect(() => args(['up', 'x', '--what'])).toThrow(/unknown argument/)
  })
})

describe('the lane', () => {
  it('is "qa" by default, the lane given, or "shared" for the navigator under seed=shared', () => {
    expect(laneOf(args(['up', 'night']))).toEqual({ lane: 'qa' })
    expect(laneOf(args(['up', 'night', '--lane', 'staffan']))).toEqual({ lane: 'staffan' })
    expect(laneOf(args(['up', 'night', 'seed=shared']))).toEqual({ lane: 'shared' })
    expect(laneOf(args(['up', 'night', '--lane', 'tomas', 'seed=shared'])).skip).toMatch(/lane tomas does neither/)
  })
})

describe('run, through seed.mjs', () => {
  it('fills the lane into the SQL and sends it as one supabase db query on dev', () => {
    const calls = []
    const lines = []
    const exec = (bin, a) => (calls.push({ bin, a, sent: readFileSync(a.at(-1), 'utf8') }), { status: 0, stdout: ' 42\n' })
    expect(run(args(['up', 'night', '--lane', 'magnus']), (l) => lines.push(l), { exec, bin: 'supabase', pick: local })).toBe(0)
    expect(calls[0].a.slice(0, 3)).toEqual(['db', 'query', '--local'])
    expect(calls[0].sent).toContain("'TEST QA seed magnus'")
    expect(lines).toEqual(['42', 'seed: up night done on dev (--local), lane magnus; undo with qa-seed.mjs down night --lane magnus'])
  })
  it('passes --db through the shared check: a remote ?host= is refused before anything runs', () => {
    const lines = []
    expect(run(args(['up', 'night', '--db', 'postgresql://u@localhost/postgres?host=db.example.co']), (l) => lines.push(l), { exec: never, pick: never })).toBe(2)
    expect(lines[0]).toMatch(/refused, nothing ran: db\.example\.co is not a local database/)
  })
  it('reports a failure, and runs nothing for a shared lane or a dry run', () => {
    const lines = []
    expect(run(args(['down', 'night']), (l) => lines.push(l), { exec: () => ({ status: 3, stderr: 'ERROR: no table' }), pick: local })).toBe(1)
    expect(lines.at(-1)).toBe('seed: down night failed on dev (--local), lane qa')
    expect(lines).toContain('ERROR: no table')
    expect(run(args(['up', 'night', '--lane', 'x', 'seed=shared']), () => {}, { exec: never, pick: never })).toBe(0)
    expect(run(args(['up', 'night', '--dry']), (l) => lines.push(l), { exec: never, pick: local })).toBe(0)
    expect(lines).toContain("insert into events (title) values ('TEST QA seed qa') returning id;")
  })
})
