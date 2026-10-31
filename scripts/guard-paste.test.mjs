import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultPatch, refusal, steps } from './guard-paste.mjs'

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
