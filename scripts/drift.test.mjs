// node --test kit/scripts/drift.test.mjs — the drift check on tiny fixture
// trees in a temp dir, so the real guard copies never have to be bent.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { checkDrift, describe } from './drift.mjs'

const SCRIPT = fileURLToPath(new URL('./drift.mjs', import.meta.url))
const roots = []
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'kit-drift-'))
  roots.push(root)
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  return root
}

const PAIRS = {
  files: [
    { hutzup: '.claude/hooks/a.mjs', kit: 'kit/hooks/a.mjs' },
    { hutzup: '.claude/agents/d.md', kit: 'kit/agents/d.md' },
  ],
  replacements: [
    { from: '.claude/hooks/', to: '${CLAUDE_PLUGIN_ROOT}/hooks/' },
    { kit: 'refs.dev', to: 'devref' },
  ],
}

function run(files, options = {}) {
  const root = tree({ 'pairs.json': PAIRS, ...files })
  return checkDrift(root, { pairsFile: join(root, 'pairs.json'), ...options })
}

test('equal copies are the same; files the list does not name are not compared', () => {
  const r = run({
    '.claude/hooks/a.mjs': 'one\ntwo\n',
    '.claude/hooks/a.test.mjs': 'differs by design\n',
    'kit/hooks/a.mjs': 'one\ntwo\n',
    'kit/hooks/a.test.mjs': 'placeholder values\n',
    '.claude/agents/d.md': 'agent\n',
    'kit/agents/d.md': 'agent\n',
  })
  assert.equal(r.drift, false)
  assert.deepEqual(r.pairs.map((p) => p.hutzup), ['.claude/hooks/a.mjs', '.claude/agents/d.md'])
  assert.match(describe(r.pairs[0]), /: same$/)
})

test('a difference counts its lines once and names the first', () => {
  const r = run({
    '.claude/hooks/a.mjs': 'one\ntwo\nthree\n',
    'kit/hooks/a.mjs': 'one\nadded\nadded too\ntwo\nthree\n',
    '.claude/agents/d.md': 'agent\n',
    'kit/agents/d.md': 'agent\n',
  })
  assert.equal(r.drift, true)
  assert.equal(describe(r.pairs[0]), '.claude/hooks/a.mjs ↔ kit/hooks/a.mjs: differs: 2 lines, first at kit/hooks/a.mjs:2')
})

test('replacements (plain and from kit.json) make generic-by-design lines the same', () => {
  const r = run({
    '.claude/kit.json': { refs: { dev: 'realdevref' } },
    '.claude/hooks/a.mjs': 'node .claude/hooks/g.mjs --ref realdevref\n',
    'kit/hooks/a.mjs': 'node ${CLAUDE_PLUGIN_ROOT}/hooks/g.mjs --ref devref\n',
    '.claude/agents/d.md': 'agent\n',
    'kit/agents/d.md': 'agent\n',
  })
  assert.equal(r.drift, false)
})

test('a missing file in a named pair is drift', () => {
  const r = run({ '.claude/hooks/a.mjs': 'x\n', 'kit/hooks/a.mjs': 'x\n', '.claude/agents/d.md': 'agent\n' })
  assert.equal(r.drift, true)
  assert.match(describe(r.pairs[1]), /differs: kit\/agents\/d\.md is missing/)
})

test('--hutzup checks a prototype folder in place of .claude/hooks/', () => {
  const files = {
    'pairs.json': PAIRS,
    '.claude/hooks/a.mjs': 'old\n',
    'proto/hooks/a.mjs': 'new\n',
    'kit/hooks/a.mjs': 'new\n',
    '.claude/agents/d.md': 'agent\n',
    'kit/agents/d.md': 'agent\n',
  }
  const root = tree(files)
  const r = checkDrift(root, { pairsFile: join(root, 'pairs.json'), hooks: 'proto/hooks' })
  assert.equal(r.drift, false)
  assert.equal(r.pairs[0].hutzup, join('proto/hooks', 'a.mjs'))
  assert.equal(checkDrift(root, { pairsFile: join(root, 'pairs.json') }).drift, true)
})

test('with no .claude/hooks/ (the kit on its own) it skips with one line and exits 0', () => {
  const root = tree({ 'kit/hooks/a.mjs': 'x\n' })
  assert.equal(checkDrift(root, { pairsFile: join(root, 'nowhere.json') }).skipped, true)
  const out = execFileSync('node', [SCRIPT, root], { encoding: 'utf8' })
  assert.equal(out.trim().split('\n').length, 1)
  assert.match(out, /skipped/)
})

test('the script exits 1 on drift and --json says so', () => {
  const root = tree({ '.claude/hooks/x': 'x\n' })
  // The real pairs list names files this tree lacks, so every pair drifts.
  assert.throws(() => execFileSync('node', [SCRIPT, '--json', root], { encoding: 'utf8', stdio: 'pipe' }), (err) => {
    assert.equal(err.status, 1)
    assert.equal(JSON.parse(err.stdout).drift, true)
    return true
  })
})
