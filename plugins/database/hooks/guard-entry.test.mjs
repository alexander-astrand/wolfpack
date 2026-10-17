// The front door skips the large guard module in a project with no production
// (kit 1.5, council L7). Runs the real entry file as a hook would.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ENTRY = fileURLToPath(new URL('./guard-entry.mjs', import.meta.url))
const dirs = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

// A hidden merge the guard refuses when it runs.
const call = (cwd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh api repos/x/y/pulls/1/merge -X PUT' }, cwd, permission_mode: 'auto' })

function run(kit) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-entry-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.claude'))
  if (kit !== undefined) writeFileSync(join(dir, '.claude', 'kit.json'), typeof kit === 'string' ? kit : JSON.stringify(kit))
  return spawnSync('node', [ENTRY], { input: call(dir), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
}

describe('guard-entry with no production', () => {
  it('allows at once, with no output, when production is none and refs.prod is empty', () => {
    for (const kit of [{ production: 'none', refs: { dev: 'd', prod: '' } }, { production: 'none' }]) {
      const r = run(kit)
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('')
      expect(r.stderr).toBe('')
    }
  })

  it('still runs the guard when a prod ref is named, production is on, or kit.json is missing or broken', () => {
    for (const kit of [{ production: 'none', refs: { prod: 'abc' } }, { production: 'on-merge', refs: { prod: 'abc' } }, undefined, '{nope']) {
      expect(run(kit).stdout).toContain('"permissionDecision":"deny"')
    }
  })
})
