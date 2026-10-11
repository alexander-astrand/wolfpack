// node --test scripts/user-commands.test.mjs — a two-skill fixture: one
// user-only skill is listed, the other is not. (The kit's scripts/ tests use
// node:test, as bump.test.mjs does.)
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { collect, END, firstSentence, renderBlock, replaceBlock, START } from './user-commands.mjs'

const root = mkdtempSync(join(tmpdir(), 'user-commands-'))
after(() => rmSync(root, { recursive: true, force: true }))

function skill(plugin, name, front) {
  const dir = join(root, 'plugins', plugin, 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${front}\n---\nBody.\n`)
}
skill('core', 'wrap-it', 'description: Wrap a release. Then more text.\nargument-hint: <version>\ndisable-model-invocation: true')
skill('core', 'helper', 'description: Used by Claude as needed.')

test('lists only user-only skills, with hint and first sentence', () => {
  const skills = collect(root)
  assert.deepEqual(skills.map((s) => s.name), ['wrap-it'])
  assert.equal(renderBlock(skills), '- `/wrap-it <version>`: Wrap a release.')
})

test('firstSentence keeps version dots inside a sentence', () => {
  assert.equal(firstSentence('Audit 2.13.6 now. Then more.'), 'Audit 2.13.6 now.')
})

test('replaceBlock swaps only what is between the markers', () => {
  const doc = `lead\n${START}\nold\n${END}\ntail\n`
  assert.equal(replaceBlock(doc, 'new'), `lead\n${START}\nnew\n${END}\ntail\n`)
  assert.throws(() => replaceBlock('no markers', 'x'))
})
