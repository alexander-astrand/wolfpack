import { describe, expect, it } from 'vitest'
import { kitLine, kitProblems, readKit } from './leon-kit.mjs'

const level = { branch: 'main', behind: 0, ahead: 0, changed: 0, untracked: 0 }

// A git that answers from a table, keyed by the arguments.
const fakeGit = (answers) => (_dir, args) => {
  const key = args.join(' ')
  if (!(key in answers)) throw new Error(`unexpected git ${key}`)
  const a = answers[key]
  if (a instanceof Error) throw a
  return a
}
const kit = (over = {}) => ({
  'branch --show-current': 'main\n',
  'rev-list --count HEAD..origin/main': '0\n',
  'rev-list --count origin/main..HEAD': '0\n',
  'status --porcelain': '',
  ...over,
})
const line = (answers) => kitLine('/k', { git: fakeGit(answers), exists: () => true, shown: '~/wolfpack' })

describe('leon-kit', () => {
  it('finds nothing wrong on main, level and clean', () => {
    expect(kitProblems(level)).toEqual([])
    expect(line(kit())).toBe('KIT ok: ~/wolfpack on main, level with origin/main, clean')
  })

  it('reports another branch, behind and uncommitted work together (the 20 Oct case)', () => {
    const answers = kit({
      'branch --show-current': '88-mph-large-upgrade\n',
      'rev-list --count HEAD..origin/main': '20\n',
      'rev-list --count origin/main..HEAD': '2\n',
      'status --porcelain': ' M plugins/design/agents/heisenberg.md\n?? .claude/\n',
    })
    expect(readKit('/k', fakeGit(answers))).toEqual({ branch: '88-mph-large-upgrade', behind: 20, ahead: 2, changed: 1, untracked: 1 })
    expect(line(answers)).toBe(
      'KIT off: ~/wolfpack on 88-mph-large-upgrade, not main; 20 behind origin/main; 2 not on origin/main; uncommitted: 1 changed, 1 untracked',
    )
  })

  it('reports main that is only behind, or only dirty', () => {
    expect(line(kit({ 'rev-list --count HEAD..origin/main': '3\n' }))).toBe('KIT off: ~/wolfpack 3 behind origin/main')
    expect(line(kit({ 'status --porcelain': '?? notes.md\n' }))).toBe('KIT off: ~/wolfpack uncommitted: 0 changed, 1 untracked')
  })

  it('calls a detached checkout off main', () => {
    expect(kitProblems({ ...level, branch: '' })).toEqual(['detached, not on main'])
  })

  it('says missing or unreadable instead of throwing', () => {
    expect(kitLine('/k', { exists: () => false, shown: '~/wolfpack' })).toBe('KIT missing: ~/wolfpack')
    expect(line(kit({ 'rev-list --count HEAD..origin/main': new Error("fatal: bad revision 'HEAD..origin/main'\nmore") }))).toBe(
      "KIT unreadable: ~/wolfpack (fatal: bad revision 'HEAD..origin/main')",
    )
    expect(line(kit({ 'rev-list --count origin/main..HEAD': 'x\n' }))).toBe('KIT unreadable: ~/wolfpack (rev-list gave no count)')
  })

  it('never asks git to fetch, switch or change anything', () => {
    const asked = []
    const git = (dir, args) => {
      asked.push(args[0])
      return fakeGit(kit())(dir, args)
    }
    kitLine('/k', { git, exists: () => true })
    expect([...new Set(asked)].sort()).toEqual(['branch', 'rev-list', 'status'])
  })
})
