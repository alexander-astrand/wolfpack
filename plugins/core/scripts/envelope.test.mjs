import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./envelope.mjs', import.meta.url))

// HOME points at an empty folder, so a write to the old switchboard would show.
function run(args) {
  const home = mkdtempSync(join(tmpdir(), 'envelope-'))
  const res = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } })
  return { ...res, home }
}

describe('envelope.mjs', () => {
  it('prints the envelope and writes no file', () => {
    const res = run(['hutzup', 'release', 'ask', 'about', 'X'])
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe('[hutzup · release] ask about X:')
    expect(readdirSync(res.home)).toEqual([])
  })

  it('exits 2 with a usage line on missing args', () => {
    const res = run(['hutzup', 'release'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/^usage: envelope\.mjs <project> <kind> <subject>/)
  })
})
