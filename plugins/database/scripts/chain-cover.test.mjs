// chain-cover.mjs run the way the kit ships it: a project whose hooks live
// in a plugin folder outside its git (kit.json's pluginRoot). The tap is
// chain-arm.mjs's own new-chain, as scripts/full-auto.sh arm-chain calls it,
// so chain-cover must hash exactly as the tap does, plugin line included
// (frozenOnDisk). With frozenHash(readFrozen()) alone it was never covered.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const COVER = join(HERE, 'chain-cover.mjs')
// The database plugin: this file's parent once it sits in
// kit/plugins/database/scripts/; the kit's copy while it's still a proto.
const PLUGIN = [join(HERE, '..'), join(HERE, '..', '..', '..', 'kit', 'plugins', 'database')]
  .find((p) => existsSync(join(p, 'hooks', 'chain-arm.mjs')) && existsSync(join(p, '.claude-plugin', 'plugin.json')))

// No GIT_* from a hook or CI leaks into the temp repo's git calls.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_PROJECT_DIR'))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8' }).trim()

let project
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'chain-cover-')))
  git(project, 'init', '-q')
  git(project, 'config', 'user.email', 'test@example.com')
  git(project, 'config', 'user.name', 'test')
  mkdirSync(join(project, '.claude'))
  mkdirSync(join(project, 'scripts'))
  writeFileSync(join(project, '.claude', 'kit.json'), JSON.stringify({
    pluginRoot: PLUGIN,
    refs: { dev: 'aaaaaaaaaaaaaaaaaaaa', prod: 'bbbbbbbbbbbbbbbbbbbb' },
  }))
  writeFileSync(join(project, 'scripts', 'check.sh'), 'echo checks\n')
  git(project, 'add', '-A')
  git(project, 'commit', '-qm', 'start')
  // The tap: what arm-chain writes, from chain-arm.mjs in the plugin.
  const marker = execFileSync('node', [join(PLUGIN, 'hooks', 'chain-arm.mjs'), 'new-chain', git(project, 'rev-parse', 'HEAD'), '9.9.9'], {
    cwd: project, env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: project }, encoding: 'utf8',
  })
  writeFileSync(join(project, '.claude', 'full-auto-chain.json'), marker)
})
afterEach(() => rmSync(project, { recursive: true, force: true }))

const cover = () => spawnSync('node', [COVER, '9.9.9'], { cwd: project, env: cleanEnv(), encoding: 'utf8' })

describe('chain-cover as a plugin', () => {
  it('finds the plugin', () => {
    expect(PLUGIN).toBeTruthy()
  })

  it('is covered right after the tap', () => {
    const r = cover()
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain('V9.9.9: covered by the tap')
    expect(r.status).toBe(0)
  })

  it('is not covered once a frozen file changes', () => {
    writeFileSync(join(project, 'scripts', 'check.sh'), 'echo changed\n')
    const r = cover()
    expect(r.stdout).toContain("the guard's files differ from what was tapped")
    expect(r.stdout).toContain('scripts/check.sh')
    expect(r.status).toBe(1)
  })
})
