import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./envelope.mjs', import.meta.url))

function run(args, board) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SWITCHBOARD: board },
  })
}

describe('envelope.mjs', () => {
  it('prints the envelope and logs one line, creating the folder', () => {
    const board = join(mkdtempSync(join(tmpdir(), 'envelope-')), 'notes', 'switchboard.md')
    const out = execFileSync('node', [SCRIPT, 'hutzup', 'release', 'ask', 'about', 'X'], {
      encoding: 'utf8',
      env: { ...process.env, SWITCHBOARD: board },
    })
    expect(out.trim()).toBe('[hutzup · release] ask about X:')
    const lines = readFileSync(board, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z \[hutzup · release\] ask about X$/)
  })

  it('appends to an existing switchboard', () => {
    const board = join(mkdtempSync(join(tmpdir(), 'envelope-')), 'switchboard.md')
    run(['dojo', 'side', 'one'], board)
    run(['dojo', 'side', 'two'], board)
    expect(readFileSync(board, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('exits 2 with a usage line and writes nothing on missing args', () => {
    const board = join(mkdtempSync(join(tmpdir(), 'envelope-')), 'switchboard.md')
    const res = run(['hutzup', 'release'], board)
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/^usage: envelope\.mjs <project> <kind> <subject>/)
    expect(existsSync(board)).toBe(false)
  })
})
