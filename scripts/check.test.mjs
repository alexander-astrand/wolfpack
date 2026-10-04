// node --test kit/scripts/check.test.mjs — the kit's checker on tiny fixture
// kits in a temp dir, so the real kit/ never has to hold a broken plugin.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { checkKit, projectValues } from './check.mjs'

const roots = []
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

function kit(files) {
  const root = mkdtempSync(join(tmpdir(), 'kit-check-'))
  roots.push(root)
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  return root
}

const hooks = (script) => ({
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node \${CLAUDE_PLUGIN_ROOT}/${script}` }] }] },
})

const good = {
  'plugins/demo/.claude-plugin/plugin.json': { name: 'demo', version: '0.1.0', description: 'A demo' },
  'plugins/demo/agents/helper.md': '---\nname: helper\ndescription: Helps\n---\nBody\n',
  'plugins/demo/skills/hello/SKILL.md': '---\nname: hello\ndescription: Says hello\n---\nBody\n',
  'plugins/demo/hooks/hooks.json': hooks('hooks/guard.mjs'),
  'plugins/demo/hooks/guard.mjs': 'export {}\n',
  '.claude-plugin/marketplace.json': {
    name: 'demo-market',
    owner: { name: 'Someone' },
    plugins: [{ name: 'demo', source: './plugins/demo', version: '0.1.0' }],
  },
}

test('an empty kit has no plugins yet and passes', () => {
  const { problems, plugins } = checkKit(kit({ 'README.md': '# kit\n' }))
  assert.deepEqual(problems, [])
  assert.equal(plugins, 0)
})

test('a well-formed plugin passes', () => {
  const { problems, plugins } = checkKit(kit(good))
  assert.deepEqual(problems, [])
  assert.equal(plugins, 1)
})

test('a hook pointing at a missing file fails with its line', () => {
  const root = kit({ ...good, 'plugins/demo/hooks/hooks.json': hooks('hooks/gone.mjs') })
  const { problems } = checkKit(root, { base: root })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /^plugins\/demo\/hooks\/hooks\.json:\d+ {2}hook command points at a missing file/)
})

test('a hook reaching outside its plugin or into .claude/ fails', () => {
  const { problems } = checkKit(kit({ ...good, 'plugins/demo/hooks/hooks.json': hooks('../../.claude/hooks/x.mjs') }))
  assert.ok(problems.some((p) => p.includes('reaches into a .claude/ folder')))
  assert.ok(problems.some((p) => p.includes('reaches outside its plugin')))
})

test('a secret or a project value anywhere in the kit fails', () => {
  // Built from parts so this file doesn't trip the grep it tests.
  const jwt = 'ey' + 'J' + 'a'.repeat(30)
  const root = kit({ ...good, 'plugins/demo/skills/hello/SKILL.md': `---\nname: hello\ndescription: x\n---\nkey ${jwt}\nref abcdefprojref\n` })
  const { problems } = checkKit(root, { base: root, values: ['abcdefprojref'] })
  assert.deepEqual(
    problems.map((p) => p.split('  ')[0]),
    ['plugins/demo/skills/hello/SKILL.md:5', 'plugins/demo/skills/hello/SKILL.md:6'],
  )
})

test("production's ref is read from the project's hook as a project value", () => {
  const project = kit({
    '.claude/kit.json': { refs: { dev: 'devref-only-here' } },
    '.claude/hooks/production-steps.mjs': "export const PROD_REF = 'prodref-from-hook'\n",
  })
  const values = projectValues(join(project, '.claude', 'kit.json'))
  assert.deepEqual(values.sort(), ['devref-only-here', 'prodref-from-hook'])
  assert.deepEqual(projectValues(join(project, 'nowhere', 'kit.json')), [])
  const root = kit({ ...good, 'plugins/demo/skills/hello/SKILL.md': '---\nname: hello\ndescription: x\n---\nref prodref-from-hook\n' })
  const { problems } = checkKit(root, { base: root, values })
  assert.equal(problems.length, 1)
})

test('manifest and frontmatter gaps are named', () => {
  const root = kit({
    ...good,
    'plugins/demo/.claude-plugin/plugin.json': { name: 'other', version: '0.2.0' },
    'plugins/demo/agents/helper.md': 'no frontmatter\n',
  })
  const { problems } = checkKit(root, { base: root })
  assert.ok(problems.some((p) => p.includes('has no description')))
  assert.ok(problems.some((p) => p.includes('is not the folder')))
  assert.ok(problems.some((p) => p.includes('no frontmatter')))
  assert.ok(problems.some((p) => p.includes('0.1.0 here but 0.2.0')))
})
