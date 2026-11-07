import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTES, main, movedRoutes, routeFolders } from './routes-moved.mjs'

describe('movedRoutes', () => {
  it('prints renames, deletes and adds under the route folders only', () => {
    const text = ['R100\tsrc/routes/a.tsx\tsrc/routes/b.tsx', 'D\tapp/old/page.tsx', 'A\tapp/new/page.tsx', 'M\tapp/same/page.tsx', 'A\tlib/x.ts', 'R90\tlib/a.ts\tlib/b.ts'].join('\n')
    expect(movedRoutes(text, DEFAULT_ROUTES)).toEqual(['src/routes/a.tsx -> src/routes/b.tsx', '- app/old/page.tsx', '+ app/new/page.tsx'])
  })
  it('a folder without a trailing slash does not match a sibling prefix', () => {
    expect(movedRoutes('A\tsrc/routes-old/x.ts', ['src/routes'])).toEqual([])
  })
})

describe('on a fixture repo', () => {
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })
  const put = (dir, rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  it('lists what the branch moves against main, and reads kit.json routes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'routes-moved-'))
    git(dir, 'init', '-q', '-b', 'main')
    put(dir, 'app/money/page.tsx', 'a long enough page body so the rename is detected\n'.repeat(5))
    put(dir, 'app/todos/page.tsx', 'todos\n')
    put(dir, 'lib/util.ts', 'u\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'base')
    git(dir, 'switch', '-qc', 'work')
    mkdirSync(join(dir, 'app/finance'))
    git(dir, 'mv', 'app/money/page.tsx', 'app/finance/page.tsx')
    git(dir, 'rm', '-q', 'app/todos/page.tsx')
    put(dir, 'app/notes/page.tsx', 'n\n')
    put(dir, 'lib/util.ts', 'changed\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'move')
    const out = []
    expect(main(['--repo', dir], (l) => out.push(l))).toBe(3)
    expect(out.sort()).toEqual(['+ app/notes/page.tsx', '- app/todos/page.tsx', 'app/money/page.tsx -> app/finance/page.tsx'].sort())
    put(dir, '.claude/kit.json', JSON.stringify({ routes: ['lib'] }))
    expect(routeFolders(dir)).toEqual(['lib'])
  })
})
