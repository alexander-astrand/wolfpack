// sync-ranjit.mjs (kit 1.7, Feature 9): the project's ranjit is the kit's
// template with kit.json's values, written or checked; a stale copy fails the
// check with its diff. Run against temp project folders and the real templates.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { TARGET, lineDiff, render, sync, templateFor } from './sync-ranjit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'sync-ranjit.mjs')
const TMP = mkdtempSync(join(tmpdir(), 'sync-ranjit-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const KIT = { project: { name: 'toy-node', noun: 'player' }, refs: { dev: 'devrefdevrefdevrefde', prod: 'prodrefprodrefprodre' }, deployer: 'ranjit' }
let n = 0
function project(kit = KIT) {
  const dir = join(TMP, `p${n++}`)
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'kit.json'), JSON.stringify(kit))
  return dir
}
const run = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' })

describe('which template', () => {
  it('a Supabase production takes ranjit.md, on-merge the no-database one, none or no ref none', () => {
    expect(templateFor(KIT)).toBe('ranjit.md')
    expect(templateFor({ ...KIT, production: 'on-merge' })).toBe('ranjit-no-database.md')
    expect(templateFor({ ...KIT, production: 'none' })).toBeNull()
    expect(templateFor({ refs: { prod: '' } })).toBeNull()
  })
})

describe('render', () => {
  it('fills {{key}} from kit.json and leaves ${{ }} and <… from kit.json> alone', () => {
    const { text, missing } = render('A {{project.name}} release, every {{project.noun}}. ${{ github.ref }} <refs.prod from .claude/kit.json>', KIT)
    expect(text).toBe('A toy-node release, every player. ${{ github.ref }} <refs.prod from .claude/kit.json>')
    expect(missing).toEqual([])
  })

  it('names a key kit.json lacks, or holds empty', () => {
    expect(render('{{project.name}} {{project.noun}}', { project: { name: 'x', noun: '' } }).missing).toEqual(['project.noun'])
  })

  it('the real template renders whole, with the /one-ring line', () => {
    const { text, missing } = render(readFileSync(join(HERE, '..', 'templates', 'ranjit.md'), 'utf8'), KIT)
    expect(missing).toEqual([])
    expect(text).not.toMatch(/\{\{/)
    expect(text).toMatch(/Under `\/one-ring` do not run me: the deploy is the database plugin's script in that session/)
  })
})

describe('sync', () => {
  it('writes the file, then the check passes; an edited copy fails the check with its diff', () => {
    const dir = project()
    const first = run(dir)
    expect(first.status).toBe(0)
    expect(first.stdout).toMatch(/wrote \.claude\/agents\/ranjit\.md from templates\/ranjit\.md/)
    expect(readFileSync(join(dir, TARGET), 'utf8')).toMatch(/Runs a toy-node release's production steps/)
    expect(run(dir, '--check').status).toBe(0)

    const file = join(dir, TARGET)
    writeFileSync(file, readFileSync(file, 'utf8').replace('Runs a toy-node release', 'Only through /skinny-pete, a toy-node release'))
    const stale = run(dir, '--check')
    expect(stale.status).toBe(1)
    expect(stale.stdout).toMatch(/differs from templates\/ranjit\.md/)
    expect(stale.stdout).toMatch(/\n3- description: Only through \/skinny-pete/)
    expect(stale.stdout).toMatch(/\n3\+ description: Runs a toy-node release/)
    // The check never writes.
    expect(readFileSync(file, 'utf8')).toMatch(/Only through \/skinny-pete/)
  })

  it('a missing copy fails the check; a project with no deployer passes, unless a copy is there', () => {
    expect(run(project(), '--check').status).toBe(1)
    const none = project({ ...KIT, production: 'none' })
    expect(run(none, '--check').status).toBe(0)
    mkdirSync(join(none, '.claude', 'agents'))
    writeFileSync(join(none, TARGET), 'old')
    expect(run(none, '--check').status).toBe(1)
  })

  it('usage, an unreadable kit.json and a missing value exit 2', () => {
    expect(run().status).toBe(2)
    expect(run(join(TMP, 'nowhere'), '--check').status).toBe(2)
    const noNoun = project({ ...KIT, project: { name: 'toy-node' } })
    const r = run(noNoun)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/no value for \{\{project\.noun\}\}/)
  })

  it('takes its reads and write from the caller', () => {
    const files = { '/p/.claude/kit.json': JSON.stringify({ ...KIT, production: 'on-merge' }) }
    const written = {}
    const out = sync('/p', {
      read: (f) => files[f] ?? readFileSync(f, 'utf8'),
      exists: (f) => f in files,
      write: (f, t) => { written[f] = t },
    })
    expect(out.code).toBe(0)
    expect(written['/p/.claude/agents/ranjit.md']).toMatch(/Ships a toy-node release by merging its PR/)
  })

  it('lineDiff lists only the lines that differ', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual(['2- b', '2+ B', '4+ d'])
  })
})
