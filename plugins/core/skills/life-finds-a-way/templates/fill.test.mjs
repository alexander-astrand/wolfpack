import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MAP, renderText, isGuarded, protoMap } from './fill.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILL = join(HERE, 'fill.mjs')
const fixture = (stack) => JSON.parse(readFileSync(join(HERE, 'fixtures', stack + '.values.json'), 'utf8'))

let tmp
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fill-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

// Runs the CLI as a person would; --plans keeps V0.1.md and the roadmap out of ~/.claude.
function run(values, ...extra) {
  const file = join(tmp, 'values.json')
  writeFileSync(file, JSON.stringify(values))
  return spawnSync('node', [FILL, file, join(tmp, 'proj'), '--plans', join(tmp, 'plans'), ...extra], { encoding: 'utf8' })
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

describe('fill.mjs', () => {
  it('renders the Node fixture into the mapped layout with nothing left unfilled', () => {
    const r = run(fixture('node'))
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    for (const m of MAP) {
      const dest = m.to.startsWith('plans:') ? join(tmp, 'plans', m.to.slice(6)) : join(tmp, 'proj', m.to)
      expect(existsSync(dest), dest).toBe(true)
    }
    for (const f of [...walk(join(tmp, 'proj')), ...walk(join(tmp, 'plans'))]) {
      expect(readFileSync(f, 'utf8'), f).not.toContain('{{')
    }
    expect(statSync(join(tmp, 'proj', 'scripts', 'check.sh')).mode & 0o111).not.toBe(0)
    const kit = JSON.parse(readFileSync(join(tmp, 'proj', '.claude', 'kit.json'), 'utf8'))
    expect(kit.project).toEqual({ name: 'toy-node', noun: 'player', devPort: 5180 })
    expect(kit.plans).toBe('~/.claude/plans/toy-node/')
    // A list of objects repeats its line; a list of strings fills occurrences in order.
    const v01 = readFileSync(join(tmp, 'plans', 'V0.1.md'), 'utf8')
    expect(v01).toContain('- the snack list page: Code\n- the weekly reminder text: Chat')
    expect(readFileSync(join(tmp, 'proj', '.claude', 'taste.md'), 'utf8')).toContain('Why: big thumbs')
  })

  it('fails naming the file and key when a value is missing, and writes nothing', () => {
    const values = fixture('node')
    delete values.rhythm
    const r = run(values)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('templates/V0.1.md: {{rhythm}} has no value')
    expect(existsSync(join(tmp, 'proj'))).toBe(false)
  })

  it('counts an empty string as filled', () => {
    const values = fixture('node')
    values.rhythm = ''
    expect(run(values).status).toBe(0)
  })

  it('drops dev-server lines and design files when there is no dev server', () => {
    const r = run(fixture('python'))
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(readFileSync(join(tmp, 'proj', 'CLAUDE.md'), 'utf8')).not.toContain('npm run dev')
    expect(existsSync(join(tmp, 'proj', '.claude', 'launch.json'))).toBe(false)
    expect(existsSync(join(tmp, 'proj', '.claude', 'taste.md'))).toBe(false)
    expect(JSON.parse(readFileSync(join(tmp, 'proj', '.claude', 'kit.json'), 'utf8')).project.devPort).toBe(null)
  })

  const read = (...p) => readFileSync(join(tmp, 'proj', ...p), 'utf8')

  it('Node: check.sh hands over to check.mjs, CI and Dependabot speak npm', () => {
    expect(run(fixture('node')).status).toBe(0)
    expect(read('scripts', 'check.sh')).toContain('exec node "$(dirname "$0")/check.mjs"')
    expect(read('.github', 'workflows', 'ci.yml')).toMatch(/setup-node[\s\S]*npm ci[\s\S]*bash scripts\/check\.sh/)
    expect(read('.github', 'dependabot.yml')).toContain('package-ecosystem: npm')
    expect(read('.gitignore')).toContain('node_modules')
    expect(read('README.md')).toContain('npm run dev     # http://localhost:5180\n')
  })

  it('Python: ruff and pytest in check.sh, pip in CI and Dependabot, no Node files', () => {
    const r = run(fixture('python'))
    expect(r.stderr).toBe('')
    const check = read('scripts', 'check.sh')
    expect(check).toContain('skipped: ruff not installed')
    expect(check).toContain('-m pytest')
    expect(check).toContain('.venv/bin/python')
    expect(check).not.toMatch(/<!--|check\.mjs/)
    expect(existsSync(join(tmp, 'proj', 'scripts', 'check.mjs'))).toBe(false)
    const ci = read('.github', 'workflows', 'ci.yml')
    expect(ci).toContain('setup-python')
    expect(ci).toContain("if: hashFiles('requirements.txt') != ''")
    expect(ci).toContain("grep -q '^\\[project\\]' pyproject.toml")
    expect(read('.gitignore')).toContain('*.egg-info/')
    expect(ci).not.toContain('setup-node')
    expect(ci.trimEnd().endsWith('- run: bash scripts/check.sh')).toBe(true)
    expect(read('.github', 'dependabot.yml')).toContain('package-ecosystem: pip')
    expect(read('.github', 'dependabot.yml')).not.toContain('npm')
    expect(read('.gitignore')).toMatch(/\.venv\/\n__pycache__\//)
    expect(read('.gitignore')).not.toContain('node_modules')
    expect(read('CLAUDE.md')).toContain('python3 -m venv .venv')
    expect(JSON.parse(read('.claude', 'kit.json')).stack).toBe('python')
    // An empty project has no tests yet: the check says so and passes.
    const c = spawnSync('sh', ['scripts/check.sh'], { cwd: join(tmp, 'proj'), encoding: 'utf8' })
    expect(c.status).toBe(0)
    expect(c.stdout).toContain('skipped: no tests yet')
  })

  it('Other: a check.sh with a TODO that says so, and CI that only runs it', () => {
    expect(run(fixture('other')).status).toBe(0)
    expect(read('scripts', 'check.sh')).toContain('TODO')
    const c = spawnSync('sh', ['scripts/check.sh'], { cwd: join(tmp, 'proj'), encoding: 'utf8' })
    expect(c.status).toBe(0)
    expect(c.stdout).toBe('no checks yet: fill in scripts/check.sh\n')
    const ci = read('.github', 'workflows', 'ci.yml')
    expect(ci).not.toMatch(/setup-node|setup-python|npm|pip/)
    expect(ci).toContain('bash scripts/check.sh')
    expect(read('.github', 'dependabot.yml')).not.toMatch(/npm|pip/)
    expect(read('README.md')).not.toMatch(/npm|python3/)
  })

  it('detects the stack: package.json first, then a Python manifest, else other', () => {
    const dir = join(tmp, 'd')
    const detect = () => spawnSync('node', [FILL, '--detect', dir], { encoding: 'utf8' }).stdout.trim()
    mkdirSync(dir)
    expect(detect()).toBe('other')
    writeFileSync(join(dir, 'requirements.txt'), '')
    expect(detect()).toBe('python')
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(detect()).toBe('node')
  })

  it('--adopt writes only missing files and leaves existing ones alone', () => {
    mkdirSync(join(tmp, 'proj'))
    writeFileSync(join(tmp, 'proj', 'README.md'), 'his own readme\n')
    const r = run(fixture('python'), '--adopt')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('skipped: exists README.md')
    expect(r.stdout).toContain('written: scripts/check.sh')
    expect(read('README.md')).toBe('his own readme\n')
  })

  it('skips plans files steps 5 and 6 already wrote, without asking their values', () => {
    expect(run(fixture('node')).status).toBe(0)
    writeFileSync(join(tmp, 'plans', 'V0.1.md'), 'the draft\n')
    rmSync(join(tmp, 'proj'), { recursive: true })
    const values = fixture('node')
    delete values.rhythm // only V0.1.md uses it
    const r = run(values)
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain('skipped: exists ' + join(tmp, 'plans', 'V0.1.md'))
    expect(readFileSync(join(tmp, 'plans', 'V0.1.md'), 'utf8')).toBe('the draft\n')
  })

  it('Python: finds tests in a subfolder, so a src/tests/ project is never "no tests yet"', () => {
    expect(run(fixture('python')).status).toBe(0)
    mkdirSync(join(tmp, 'proj', 'src', 'tests'), { recursive: true })
    writeFileSync(join(tmp, 'proj', 'src', 'tests', 'test_ok.py'), 'def test_ok():\n    assert True\n')
    const c = spawnSync('sh', ['scripts/check.sh'], { cwd: join(tmp, 'proj'), encoding: 'utf8' })
    expect(c.status).toBe(0)
    expect(c.stdout).not.toContain('no tests yet')
  })

  it('--force never overwrites an existing plans file', () => {
    expect(run(fixture('node')).status).toBe(0)
    writeFileSync(join(tmp, 'plans', 'V0.1.md'), 'his plan\n')
    const r = run(fixture('node'), '--force')
    expect(r.status).toBe(0)
    expect(readFileSync(join(tmp, 'plans', 'V0.1.md'), 'utf8')).toBe('his plan\n')
  })

  it('rejects --adopt with --force', () => {
    const r = run(fixture('node'), '--adopt', '--force')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--force and --adopt together')
  })

  it('--detect errors on a folder that does not exist', () => {
    const r = spawnSync('node', [FILL, '--detect', join(tmp, 'nope')], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("folder doesn't exist")
    expect(r.stdout).toBe('')
  })

  it('stack markers: an unclosed, a nested and an unknown block are errors', () => {
    const errs = (text) => renderText(text, { stack: 'node' }, { file: 't', json: false, ui: false }).errors
    expect(errs('<!-- stack:node -->\na')).toContain('t: a stack block is never closed')
    expect(errs('<!-- stack:node -->\n<!-- stack:python -->\n<!-- /stack -->')).toContain(
      't: a stack block opens inside another',
    )
    expect(errs('<!-- /stack -->')).toContain('t: <!-- /stack --> with no block open')
    expect(errs('a <!-- stack:rust -->')).toContain('t: unknown stack "rust" in a marker')
    expect(errs('<!-- stack:node -->\nkept\n<!-- /stack -->')).toEqual([])
  })

  it('refuses an unknown stack', () => {
    const r = run({ ...fixture('node'), stack: 'rust' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('"stack" must be one of node, python, other')
  })

  it('--allow merges core, the packs and the stack, without repeats', () => {
    const allow = (stack, packs) => {
      const file = join(tmp, 'v.json')
      writeFileSync(file, JSON.stringify({ stack, packs }))
      return JSON.parse(spawnSync('node', [FILL, '--allow', file], { encoding: 'utf8' }).stdout)
    }
    const node = allow('node', ['release', 'design'])
    expect(node).toContain('Bash(npm run build)')
    expect(node).toContain('mcp__Claude_Browser__navigate')
    expect(new Set(node).size).toBe(node.length)
    const py = allow('python', ['release'])
    expect(py).toContain('Bash(.venv/bin/python -m pytest:*)')
    expect(py.join()).not.toContain('npm')
    expect(allow('other', ['release']).join()).not.toMatch(/npm|python|pytest|ruff/)
  })

  it('--proto keeps the guarded targets renamed and prints the line that moves them', () => {
    const r = run(fixture('node'), '--proto')
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const proj = join(tmp, 'proj')
    const guarded = MAP.filter((m) => !m.to.startsWith('plans:') && isGuarded(m.to))
    // The templates' four guarded names, so a new one in MAP is a choice, not a slip.
    expect(guarded.map((m) => m.to).sort()).toEqual(
      ['.claude/kit.json', '.github/dependabot.yml', '.github/workflows/ci.yml', 'scripts/check.sh'],
    )
    for (const m of guarded) {
      expect(existsSync(join(proj, m.from)), m.from).toBe(true)
      expect(existsSync(join(proj, m.to)), m.to).toBe(false)
    }
    // Everything else lands under its real name as before.
    expect(existsSync(join(proj, '.claude', 'lessons.md'))).toBe(true)
    expect(existsSync(join(proj, 'CLAUDE.md'))).toBe(true)

    const line = r.stdout.split('\n').at(-2)
    expect(line).toBe(protoMap(guarded.map((m) => ({ from: join(proj, m.from), to: join(proj, m.to) }))))
    expect(line.startsWith('mkdir -p ')).toBe(true)
    // The printed line, run as a person would, leaves the plain render's layout.
    expect(spawnSync('sh', ['-c', line]).status).toBe(0)
    for (const m of guarded) {
      expect(existsSync(join(proj, m.to)), m.to).toBe(true)
      expect(existsSync(join(proj, m.from)), m.from).toBe(false)
    }
    expect(statSync(join(proj, 'scripts', 'check.sh')).mode & 0o111).not.toBe(0)
  })

  it('protoMap quotes paths with spaces and quotes', () => {
    expect(protoMap([{ from: "/a b/it's", to: '/c/d/e' }])).toBe(`mkdir -p '/c/d' && mv '/a b/it'\\''s' '/c/d/e'`)
    expect(protoMap([])).toBe('')
  })

  it('without --proto nothing is renamed and no map is printed', () => {
    const r = run(fixture('node'))
    expect(r.stdout).not.toContain('mkdir -p')
    expect(existsSync(join(tmp, 'proj', 'dotclaude'))).toBe(false)
  })

  it('refuses a non-empty target unless --force', () => {
    expect(run(fixture('node')).status).toBe(0)
    rmSync(join(tmp, 'plans'), { recursive: true })
    const again = run(fixture('node'))
    expect(again.status).toBe(1)
    expect(again.stderr).toContain('not empty: --adopt for a rerun or an existing project; --force only for a scratch folder')
    expect(run(fixture('node'), '--force').status).toBe(0)
  })
})
