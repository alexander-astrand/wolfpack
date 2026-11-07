// node --test scripts/user-commands.test.mjs — a two-skill fixture: one
// user-only skill is listed, the other is not. (The kit's scripts/ tests use
// node:test, as bump.test.mjs does.)
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { clause, collect, END, firstSentence, renderBlock, replaceBlock, START } from './user-commands.mjs'

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
  assert.equal(renderBlock(skills), '- `/wrap-it <version>`: Wrap a release')
})

test('clause cuts a description to one whole clause', () => {
  // a long lead is the clause
  assert.equal(clause('A short creative session with heisenberg - Alexander shapes a brief, no building.'), 'A short creative session with heisenberg')
  // a title-length lead keeps the next piece, cut at its comma
  assert.equal(clause("The audit conductor - runs a project's audits together in their own sessions, in order (a, b)."), "The audit conductor - runs a project's audits together in their own sessions")
  // a semicolon, a colon and brackets or quotes holding commas
  assert.equal(clause('Weekly read-only report of the open PRs (Monday, 07:40); more.'), 'Weekly read-only report of the open PRs (Monday, 07:40)')
  assert.equal(clause('The quick neighbour over the fence (Sonnet, low effort): answers such as "where, X".'), 'The quick neighbour over the fence (Sonnet, low effort)')
  // a list's commas are not a cut; a long clause is cut only at ", and"
  assert.equal(clause('The big audit of database, security, infrastructure, APIs and plans in three lanes.'), 'The big audit of database, security, infrastructure, APIs and plans in three lanes')
  assert.equal(clause('What a cloud session (a, b) can and can\'t do on this repo, and how we use them.'), "What a cloud session (a, b) can and can't do on this repo")
  // a short one stays whole, comma and all
  assert.equal(clause('Full auto (ADR 0009), mode 1 - one release.'), 'Full auto (ADR 0009), mode 1')
  assert.equal(clause('The cleaner.'), 'The cleaner')
})

test('firstSentence keeps version dots inside a sentence', () => {
  assert.equal(firstSentence('Audit 2.13.6 now. Then more.'), 'Audit 2.13.6 now.')
})

test('replaceBlock swaps only what is between the markers', () => {
  const doc = `lead\n${START}\nold\n${END}\ntail\n`
  assert.equal(replaceBlock(doc, 'new'), `lead\n${START}\nnew\n${END}\ntail\n`)
  assert.throws(() => replaceBlock('no markers', 'x'))
})
