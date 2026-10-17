// node --test scripts/live-sync.test.mjs — live-sync.sh against a throwaway
// origin and clone in a temp dir; the real ~/wolfpack-live is never touched.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'live-sync.sh')
const roots = []
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

const git = (cwd, ...args) =>
  spawnSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', ...args], { cwd, encoding: 'utf8' })

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'live-sync-'))
  roots.push(root)
  const work = join(root, 'work')
  git(root, 'init', '-q', '-b', 'main', work)
  writeFileSync(join(work, 'f'), 'a')
  git(work, 'add', '.')
  git(work, 'commit', '-qm', '1')
  git(root, 'clone', '-q', work, 'live')
  writeFileSync(join(work, 'f'), 'b')
  git(work, 'commit', '-qam', '2')
  return { work, live: join(root, 'live') }
}

const sync = (live) => spawnSync('sh', [SCRIPT, live], { encoding: 'utf8' })

test('a clean checkout moves onto origin/main and says how far behind it was', () => {
  const { live } = setup()
  const r = sync(live)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^live at [0-9a-f]+, was 1 behind/)
})

test('local changes that differ from origin/main stop the move and are printed', () => {
  const { live } = setup()
  writeFileSync(join(live, 'f'), 'mine')
  const r = sync(live)
  assert.equal(r.status, 1)
  assert.match(r.stderr, / M f/)
})

test('local changes equal to origin/main are discarded and the move goes on', () => {
  const { live } = setup()
  writeFileSync(join(live, 'f'), 'b')
  const r = sync(live)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /live at/)
})

test('an untracked file counts as local work', () => {
  const { live } = setup()
  writeFileSync(join(live, 'new'), 'x')
  assert.equal(sync(live).status, 1)
})
