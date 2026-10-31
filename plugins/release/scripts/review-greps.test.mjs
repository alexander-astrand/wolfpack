import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addedLines, hitsOf, KIT_CHECKS, parsePipeline, projectChecks, render, review, toRegExp } from './review-greps.mjs'

const DIFF = [
  'diff --git a/src/Logo.tsx b/src/Logo.tsx',
  '--- a/src/Logo.tsx',
  '+++ b/src/Logo.tsx',
  '@@ -3,0 +4,2 @@',
  '+  <svg width="18.9px" />',
  '+  <button className="outline-none" />',
  'diff --git a/src/Card.tsx b/src/Card.tsx',
  '--- a/src/Card.tsx',
  '+++ b/src/Card.tsx',
  '@@ -10 +10 @@',
  '-old',
  '+  const go = () => navigator.share({ url })',
  '@@ -20,0 +21,2 @@',
  '+  onRemove={() => drop(id)}',
  '+  const list = events.filter((e) => e.day)',
  'diff --git a/src/ShareMenu.tsx b/src/ShareMenu.tsx',
  '--- a/src/ShareMenu.tsx',
  '+++ b/src/ShareMenu.tsx',
  '@@ -1,0 +2 @@',
  '+  navigator.share(data)',
].join('\n')

describe('addedLines', () => {
  it('gives each added line its file and new line number', () => {
    const l = addedLines(DIFF)
    expect(l.map((x) => `${x.file}:${x.line}`)).toEqual(['src/Logo.tsx:4', 'src/Logo.tsx:5', 'src/Card.tsx:10', 'src/Card.tsx:21', 'src/Card.tsx:22', 'src/ShareMenu.tsx:2'])
  })
})

describe('the kit checks', () => {
  it('hit the repeat shapes and leave the share menu alone', () => {
    const hits = hitsOf(addedLines(DIFF), KIT_CHECKS).map((h) => `${h.check} @ ${h.where}`)
    expect(hits).toEqual([
      'fractional px in a logo, mark or icon @ src/Logo.tsx:4',
      'navigator.share outside the shared share menu @ src/Card.tsx:10',
      'outline-none with no focus-visible on the element @ src/Logo.tsx:5',
      'remove, answer or close handler; focus moves nowhere in the file @ src/Card.tsx:21',
      'events listed in the client with no visibility filter (`[private-nights]`) @ src/Card.tsx:22',
    ])
  })
})

describe('builder-checks pipelines', () => {
  it('turns BRE and ERE greps into JS regexps', () => {
    expect(toRegExp('setOpen(false)').test('setOpen(false)')).toBe(true)
    expect(toRegExp('setOpen(false)', { ere: true }).test('setOpen(false)')).toBe(false)
    expect(toRegExp('a|b').test('a|b')).toBe(true)
    expect(toRegExp('(You.re in|Going)', { ere: true }).test('Going')).toBe(true)
    expect(toRegExp('a.b', { fixed: true }).test('axb')).toBe(false)
  })
  it('reads a pipeline with a path and a grep -v, and gives up on anything else', () => {
    const p = parsePipeline('grep -rn "outline-none" src | grep -v "focus-visible"')
    expect(p.paths).toEqual(['src'])
    expect(p.filters.map((f) => f.negate)).toEqual([false, true])
    expect(parsePipeline("git diff main -U0 | grep -nE '^\\+.*[0-9]+\\.[0-9]+px'").paths).toEqual([])
    expect(parsePipeline('echo $?')).toBe(null)
  })
  it('makes one check per greppable bullet and counts the rest as read by hand', () => {
    const md = '# Builder checks\n\n- **No native share**: `grep -rn "navigator.share" src`.\n- **Balanced stacks**, measure them.\n- **Game nights filtered**: `grep -rn "game_nights" src | grep -v Api`.\n'
    const { checks, manual } = projectChecks(md)
    expect(manual).toBe(1)
    const lines = [{ file: 'src/a.ts', line: 1, text: 'from("game_nights")' }, { file: 'src/aApi.ts', line: 2, text: 'game_nights' }, { file: 'docs/x.md', line: 3, text: 'navigator.share' }]
    expect(hitsOf(lines, checks).map((h) => `${h.check} @ ${h.where}`)).toEqual(['Game nights filtered @ src/a.ts:1'])
  })
})

describe('review', () => {
  it('runs on the diff, the project checks, the conventions script and the version field, and prints only hits', () => {
    const repo = mkdtempSync(join(tmpdir(), 'review-greps-'))
    mkdirSync(join(repo, '.claude'))
    writeFileSync(join(repo, '.claude', 'builder-checks.md'), '- **Taps are 44px**: read by hand.\n')
    writeFileSync(join(repo, '.claude', 'kit.json'), JSON.stringify({ conventions: 'scripts/conventions.sh' }))
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '1.2.0' }))
    const calls = []
    const run = (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`)
      if (args.includes('rev-parse')) return 'abc'
      if (cmd === 'sh') throw Object.assign(new Error('x'), { stdout: 'src/a.tsx:3 raw <button>\n' })
      return DIFF
    }
    const r = review({ repo, version: '1.3.0' }, run)
    expect(calls[1]).toBe(`git -C ${repo} diff -U0 origin/main...HEAD`)
    expect(r.manual).toBe(1)
    const out = render(r)
    expect(out).toContain('| `[release-bump]` version field | package.json | reads 1.2.0, the release is 1.3.0 |')
    expect(out).toContain('| conventions (scripts/conventions.sh) | - | src/a.tsx:3 raw <button> |')
    expect(out).toMatch(/^7 hits on 6 added lines \(vs origin\/main\) from 5 grep checks; 1 builder-checks lines have no grep/m)
    const clean = render(review({ repo, base: 'main', conventions: false }, () => ''))
    expect(clean.startsWith('No hits.')).toBe(true)
  })
})
