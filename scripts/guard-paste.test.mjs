import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AM_STOPPED, defaultPatch, refusal, steps } from './guard-paste.mjs'

// A throwaway checkout at a spaced path, the script copied into its scripts/,
// on a release branch. MUST 1 of the kit 1.8 review: the old guard compared
// `file://` + argv[1] and silently did nothing through a space or a symlink.
function spacedRepo() {
  const tmp = mkdtempSync(join(tmpdir(), 'guard paste '))
  const repo = join(tmp, 'a repo')
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  const script = join(repo, 'scripts', 'guard-paste.mjs')
  copyFileSync(fileURLToPath(new URL('./guard-paste.mjs', import.meta.url)), script)
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' })
  git('init', '-q', '-b', 'V1')
  git('config', 'user.name', 't')
  git('config', 'user.email', 't@t')
  writeFileSync(join(repo, 'note.txt'), 'one\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  return { tmp, repo, script, git }
}

test('runs through a spaced path and a symlink (the main guard sees the real file)', () => {
  const { tmp, script } = spacedRepo()
  const link = join(tmp, 'link.mjs')
  symlinkSync(script, link)
  for (const s of [script, link]) {
    const r = spawnSync(process.execPath, [s], { encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /^guard-paste: no patch in /)
  }
})

test('a git am conflict prints the way out, not a stack', () => {
  const { repo, script, git } = spacedRepo()
  writeFileSync(join(repo, 'note.txt'), 'two\n')
  git('commit', '-q', '-am', 'theirs')
  git('format-patch', '-1', '-o', join(repo, '..'))
  git('reset', '-q', '--hard', 'HEAD~1')
  writeFileSync(join(repo, 'note.txt'), 'three\n')
  git('commit', '-q', '-am', 'ours')
  const patch = join(repo, '..', '0001-theirs.patch')
  const r = spawnSync(process.execPath, [script, patch], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.ok(r.stderr.includes(`guard-paste: ${AM_STOPPED}`))
  assert.doesNotMatch(r.stderr, /\n\s+at /)
})

test('defaultPatch picks the last patch in the paste folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'paste-'))
  assert.equal(defaultPatch(root), undefined)
  const dir = join(root, 'plugins', 'database', 'guard-paste')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'kit-1.8.patch'), '')
  writeFileSync(join(dir, 'README.md'), '')
  assert.equal(defaultPatch(root), join('plugins', 'database', 'guard-paste', 'kit-1.8.patch'))
})

test('refusal stops main, a dirty checkout and a missing patch', () => {
  assert.match(refusal({ branch: 'main', dirty: false, patch: 'p' }), /never main/)
  assert.match(refusal({ branch: 'V1', dirty: true, patch: 'p' }), /uncommitted/)
  assert.match(refusal({ branch: 'V1', dirty: false, patch: undefined }), /no patch/)
  assert.equal(refusal({ branch: 'claude/kit-1-8', dirty: false, patch: 'p' }), undefined)
})

test('steps apply, test, remove the patch, commit, push, and keep an undo', () => {
  const s = steps('plugins/database/guard-paste/kit-1.8.patch', 'abc123')
  assert.deepEqual(s[0], ['git', ['am', '--3way', 'plugins/database/guard-paste/kit-1.8.patch']])
  assert.equal(s[1][0], 'npx')
  assert.deepEqual(s.map(([f]) => f), ['git', 'npx', 'git', 'git', 'git', 'undo'])
  assert.deepEqual(s.at(-1)[1], ['git', 'reset', '--hard', 'abc123'])
})
