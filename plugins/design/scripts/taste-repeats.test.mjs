import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format, norm, parseArgs, repeats, repeatWords, run, score } from './taste-repeats.mjs'

describe('norm', () => {
  it('turns paths and page names into the same words', () => {
    expect(norm('/trips/:id')).toBe('trips')
    expect(norm('Trips page')).toBe('trips')
    expect(norm('the event page')).toBe('event')
  })
})

describe('score', () => {
  it('ranks a rule solved on another page', () => {
    expect(score('- One scrollbar. Solved on: event page. (Profile, 2.12.1: "two bars")', ['/profile'])).toEqual({ score: 5, reasons: ['solved on event page', 'names profile'] })
  })
  it('gives nothing for the solved page itself unless a repeat word is there', () => {
    expect(score('- One scrollbar. Solved on: event page. (Profile, 2.12.1)', ['/event'])).toBeNull()
    expect(score('- Drag rows. (Shelf, 2.10: "did we not learn this again")', ['/shelf'])).toEqual({ score: 6, reasons: ['says did we not learn, again', 'names shelf'] })
  })
  it('skips untagged rules with no repeat word, and lines that are not rules', () => {
    expect(score('- Covers show whole.', ['/books'])).toBeNull()
    expect(score('Solved on: event page.', ['/x'])).toBeNull()
  })
  it('does not count an ordinal "second" or a Repeat field label as a repeat (the council\'s 21 that were 16)', () => {
    expect(score('- The second bar sits under the header, never over it.', ['/x'])).toBeNull()
    expect(score('- The form puts **Repeat:** under the date, and the "Repeat" select is full width.', ['/x'])).toBeNull()
    expect(score('- Repeat: weekly shows as one chip.', ['/x'])).toBeNull()
    expect(repeatWords('- Sent back a second time: the second bar overlaps.')).toEqual(['second'])
    expect(repeatWords('- (Trips, 3.1: "the third sendback on this, repeated")')).toEqual(['third', 'repeated'])
  })
  it('adds one for the project file', () => {
    expect(score('- A maple. Solved on: polls row. (x)', ['/map'], { project: true }).score).toBe(4)
  })
})

describe('repeats and format', () => {
  const kit = { path: 'kit/taste.md', project: false, text: '## Scrolling\n- One bar. Solved on: event page. (Profile, 2.12.1)\n- Plain rule.\n' }
  const proj = { path: '.claude/taste.md', project: true, text: '## Rows\n- Drag rows anywhere, again. Solved on: polls row. (Shelf, 2.10)\n- Folds stay folded. Solved on: event page. (x)\n' }
  it('prints the top n by score, with file:line', () => {
    const hits = repeats([kit, proj], ['/shelf'], 2)
    expect(hits.map((h) => [h.at, h.score])).toEqual([
      ['.claude/taste.md:2', 8],
      ['.claude/taste.md:3', 4],
    ])
    expect(format(hits)).toMatch(/^1\. \.claude\/taste\.md:2 \(8: solved on polls row; says again; names shelf\)\n {3}Drag rows anywhere/)
  })
  it('says plainly when nothing matched', () => {
    expect(format([])).toMatch(/no `Solved on:` tags yet/)
  })
})

describe('run and parseArgs', () => {
  it('reads both files from their default places and skips a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taste-repeats-'))
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'taste.md'), '- Map never catches the wheel, still. (Trips, 3.1)\n')
    const o = parseArgs(['/trips', '--top', '1', '--kit', join(dir, 'none.md')], dir)
    expect(run(o)).toMatch(/taste\.md:1 \(5: says still; names trips\)/)
  })
  it('refuses a bad flag or top', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['/a', '--top', '0'])).toThrow(/--top/)
  })
  it("runs on the kit's own taste.md", () => {
    expect(run(parseArgs(['/profile'], mkdtempSync(join(tmpdir(), 'tr-'))))).toMatch(/^1\. .*taste\.md:\d+ \(\d+: solved on/)
  })
})
