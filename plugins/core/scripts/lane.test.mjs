import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pickPort } from './lane.mjs'

const script = fileURLToPath(new URL('./lane.mjs', import.meta.url))
const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
const lane = (cwd, ...args) => spawnSync('node', [script, ...args], { cwd, encoding: 'utf8' })

// A main checkout `App` in a temp folder, with a kit.json, an env file, a
// lock file and an installed node_modules.
function repo({ kit = { project: { devPort: 7300 } }, modules = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lane-'))) // git prints /private/var on macOS
  const main = join(root, 'App')
  mkdirSync(join(main, '.claude'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', main)
  writeFileSync(join(main, '.claude', 'kit.json'), JSON.stringify(kit))
  writeFileSync(join(main, 'package.json'), '{"name":"app"}\n')
  writeFileSync(join(main, 'package-lock.json'), '{"lockfileVersion":3}\n')
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n.env.local\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'init')
  writeFileSync(join(main, '.env.local'), 'X=1\n')
  if (modules) mkdirSync(join(main, 'node_modules', 'dep'), { recursive: true })
  return { root, main }
}

describe('lane', () => {
  it('adds a lane beside the checkout with env, linked deps and its own port', () => {
    const { root, main } = repo()
    const r = lane(main, 'add', 'e2c')
    expect(r.status, r.stderr).toBe(0)
    const path = join(root, 'App-lanes', 'e2c')
    expect(r.stdout.trim()).toBe(`lane e2c: ${path} port 7301 branch e2c (deps linked, env copied, db skipped)`)
    expect(readFileSync(join(path, '.env.local'), 'utf8')).toBe('X=1\n')
    expect(lstatSync(join(path, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(git(path, 'status', '--porcelain')).toBe('')
    expect(git(path, 'branch', '--show-current')).toBe('e2c')
    // A second lane skips the first one's port; --port wins.
    expect(lane(main, 'add', 'two').stdout).toMatch(/port 7302 branch two/)
    expect(lane(main, 'add', 'three', '--port', '9001', '--branch', 'feat').stdout).toMatch(/port 9001 branch feat/)
    expect(lane(main, 'add', 'e2c').stderr).toMatch(/already exists/)
    const listed = lane(path, 'list').stdout.trim().split('\n')
    expect(listed).toHaveLength(3)
    expect(listed[0]).toMatch(/^e2c .* port 7301 branch e2c clean$/)
  })

  it('installs when there is nothing to link', () => {
    const { main } = repo({ kit: { project: { install: 'mkdir node_modules' } }, modules: false })
    const r = lane(main, 'add', 'x', '--base', 'main')
    expect(r.stdout).toMatch(/port 5174 branch x \(deps installed \(mkdir node_modules\)/)
  })

  it('removes a clean lane, keeps the branch, and refuses a dirty one', () => {
    const { root, main } = repo()
    lane(main, 'add', 'a')
    lane(main, 'add', 'b')
    const a = join(root, 'App-lanes', 'a')
    writeFileSync(join(a, 'work.txt'), 'unsaved\n')
    const refused = lane(main, 'remove', 'a')
    expect(refused.status).toBe(1)
    expect(refused.stderr).toMatch(/has changes[\s\S]*work\.txt/)
    expect(existsSync(a)).toBe(true)
    git(a, 'add', 'work.txt')
    git(a, 'commit', '-q', '-m', 'work')
    expect(lane(main, 'remove', 'a').stdout).toMatch(/lane a removed: .* \(branch a kept\)/)
    expect(git(main, 'log', '-1', '--format=%s', 'a')).toBe('work')
    expect(existsSync(join(main, 'node_modules', 'dep'))).toBe(true)
    lane(main, 'remove', 'b')
    expect(existsSync(join(root, 'App-lanes'))).toBe(false)
    expect(lane(main, 'list').stdout.trim()).toBe('No lanes.')
    expect(lane(main, 'remove', 'b').stderr).toMatch(/No lane "b"/)
  })

  it('skips taken and busy ports', async () => {
    const busy = new Set([5175])
    expect(await pickPort(null, new Set([5174]), async (p) => !busy.has(p))).toBe(5176)
  })
})
