import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_DB, hostOf, parseArgs, plan, run } from './qa-seed.mjs'

const seeds = () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-seed-'))
  writeFileSync(join(dir, 'night.up.sql'), "insert into events (title) values ('TEST QA seed {{LANE}}') returning id;")
  writeFileSync(join(dir, 'night.down.sql'), "delete from events where title = 'TEST QA seed {{LANE}}';")
  return dir
}
const args = (list, env = {}) => parseArgs(list, env, '/proj')

describe('parseArgs', () => {
  it('reads the action, name, lane and shared flag, with the defaults', () => {
    expect(args(['up', 'night'])).toMatchObject({ action: 'up', name: 'night', lane: null, shared: false, dir: '/proj/scripts/qa/seeds', db: LOCAL_DB })
    expect(args(['down', 'night', '--lane', 'magnus', 'seed=shared'], { QA_SEED_DB_URL: 'postgresql://u@localhost:5432/d' })).toMatchObject({ lane: 'magnus', shared: true, db: 'postgresql://u@localhost:5432/d' })
  })
  it('refuses a bad action, name or lane', () => {
    expect(() => args(['seed', 'night'])).toThrow(/up or down/)
    expect(() => args(['up', '../x'])).toThrow(/seed name/)
    expect(() => args(['up', 'x', '--lane', 'a b'])).toThrow(/--lane/)
    expect(() => args(['up', 'x', '--what'])).toThrow(/unknown argument/)
  })
})

describe('plan', () => {
  it('fills the lane into the SQL, "qa" by default', () => {
    const dir = seeds()
    expect(plan({ ...args(['up', 'night']), dir }).sql).toContain("'TEST QA seed qa'")
    expect(plan({ ...args(['down', 'night', '--lane', 'staffan']), dir }).sql).toBe("delete from events where title = 'TEST QA seed staffan';")
  })
  it('under seed=shared a lane does nothing and the navigator runs as "shared"', () => {
    const dir = seeds()
    expect(plan({ ...args(['up', 'night', '--lane', 'tomas', 'seed=shared']), dir }).skip).toMatch(/lane tomas does neither/)
    expect(plan({ ...args(['up', 'night', 'seed=shared']), dir }).lane).toBe('shared')
  })
  it('refuses a database that is not local unless its host is allowed', () => {
    const dir = seeds()
    expect(() => plan({ ...args(['up', 'night', '--db', 'postgresql://u@db.example.co:5432/postgres']), dir })).toThrow(/needs --allow-host db\.example\.co/)
    expect(plan({ ...args(['up', 'night', '--db', 'postgresql://u@db.example.co:5432/postgres', '--allow-host', 'db.example.co']), dir }).host).toBe('db.example.co')
    expect(() => hostOf('nope')).toThrow(/does not parse/)
  })
  it('names the missing file and where seeds live', () => {
    expect(() => plan({ ...args(['up', 'gone']), dir: seeds() })).toThrow(/gone\.up\.sql.*<name>\.up\.sql/)
  })
})

describe('run', () => {
  it('pipes the SQL to psql quietly, stopping on the first error', () => {
    const dir = seeds()
    const calls = []
    const lines = []
    const exec = (cmd, a, opts) => (calls.push({ cmd, a, opts }), { status: 0, stdout: ' 42\n' })
    expect(run({ ...args(['up', 'night', '--lane', 'magnus']), dir }, (l) => lines.push(l), exec)).toBe(0)
    expect(calls[0].cmd).toBe('psql')
    expect(calls[0].a).toEqual([LOCAL_DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'])
    expect(calls[0].opts.input).toContain('TEST QA seed magnus')
    expect(lines).toEqual(['42', 'up night: done, lane magnus'])
  })
  it('reports a failure, and runs nothing for a shared lane or a dry run', () => {
    const dir = seeds()
    const lines = []
    expect(run({ ...args(['down', 'night']), dir }, (l) => lines.push(l), () => ({ status: 3, stderr: 'ERROR: no table' }))).toBe(1)
    expect(lines.at(-1)).toMatch(/down night failed \(lane qa\): ERROR: no table/)
    const never = () => {
      throw new Error('ran psql')
    }
    expect(run({ ...args(['up', 'night', '--lane', 'x', 'seed=shared']), dir }, () => {}, never)).toBe(0)
    expect(run({ ...args(['up', 'night', '--dry']), dir }, (l) => lines.push(l), never)).toBe(0)
    expect(lines.at(-1)).toMatch(/^-- up night, lane qa, on 127\.0\.0\.1\ninsert/)
  })
})
