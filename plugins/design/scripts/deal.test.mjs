import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE, dealSet, deal, lastDeal, logLine, parseDirections, seeded, weigh } from './deal.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const DIRECTIONS = `# Design directions

## Directions

### Field notebook
- Feel: a paper notebook.
- Type: Source Serif / Inter
- Palette: warm paper, ink blue
- Reference: Field Notes

### Night tram
- Feel: dark, lit signs.
- Type: DIN / Inter
- Palette: dark first, amber
- Reference: Zurich trams

### Seed catalogue
- Feel: botanical plates.
- Type: Fraunces / Inter
- Palette: cream, leaf green
- Reference: an old seed catalogue

### Ski map
- Feel: bold piste colours.
- Type: Futura / Inter
- Palette: snow white, piste blue and red
- Reference: Are's trail map
`

const LIBRARY = `| Date | Topic | Page | heisenberg's lean | Pick | Score |
|---|---|---|---|---|---|
| 1 Oct 2026 | t | Home | Ski map | Ski map over Night tram | lean won |
| 2 Oct 2026 | t | Todos | Night tram | Ski map | lean lost |
| 3 Oct 2026 | t | Money | none | Field notebook | no lean |
`

// A temp project with its own directions.md (or none), a library and a log folder.
function setup({ directions = DIRECTIONS, library = LIBRARY, log = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deal-'))
  const project = join(root, 'proj')
  mkdirSync(join(project, '.claude'), { recursive: true })
  if (directions != null) writeFileSync(join(project, '.claude', 'directions.md'), directions)
  const lib = join(root, 'library.md')
  if (library != null) writeFileSync(lib, library)
  const logDir = join(root, 'design')
  if (log != null) {
    mkdirSync(join(logDir, 'proj'), { recursive: true })
    writeFileSync(join(logDir, 'proj', 'deals.log'), log)
  }
  const args = (...more) => ['--project', project, '--library', lib, '--log-dir', logDir, '--now', '2026-11-03', ...more]
  return { root, project, lib, logDir, logFile: join(logDir, 'proj', 'deals.log'), args }
}

describe('parseDirections', () => {
  it('reads every entry with its fields, from one to many', () => {
    const d = parseDirections(DIRECTIONS)
    expect(d.map((x) => x.name)).toEqual(['Field notebook', 'Night tram', 'Seed catalogue', 'Ski map'])
    expect(d[1]).toMatchObject({ feel: 'dark, lit signs.', type: 'DIN / Inter', palette: 'dark first, amber', reference: 'Zurich trams' })
    expect(parseDirections('### Only one\n- Feel: x\n')).toHaveLength(1)
  })

  it('skips the code fence, entries with no fields and a repeated name; keeps an extra line', () => {
    const text = '```\n### <Name>\n- Feel: <x>\n```\n### Empty\n\n### A\n- Feel: a\n- Why: his picks\n### a\n- Feel: again\n'
    const d = parseDirections(text)
    expect(d).toEqual([{ name: 'A', feel: 'a', why: 'his picks' }])
  })

  it("reads the kit's template: the worked example now, the starters when C3 fills them", () => {
    const d = parseDirections(readFileSync(DEFAULT_TEMPLATE, 'utf8'))
    expect(d.length).toBeGreaterThanOrEqual(1)
    expect(d[0]).toHaveProperty('feel')
    expect(d.some((x) => x.name.startsWith('<'))).toBe(false)
  })
})

describe('weigh', () => {
  it('adds one per pick and one more when the lean won; never zero', () => {
    const rows = [
      { pick: 'Ski map over Night tram', kind: 'won' },
      { pick: 'Ski map', kind: 'lost' },
      { pick: 'Field notebook', kind: 'none' },
    ]
    const w = Object.fromEntries(weigh(parseDirections(DIRECTIONS), rows).map((d) => [d.name, d.weight]))
    // "Night tram" is in the first Pick cell only as the loser, but the match is by name: it counts.
    expect(w).toEqual({ 'Field notebook': 2, 'Night tram': 3, 'Seed catalogue': 1, 'Ski map': 4 })
  })

  it('a heavier direction is dealt more often', () => {
    const weighted = [
      { name: 'Heavy', weight: 9 },
      { name: 'Light', weight: 1 },
      { name: 'Other', weight: 1 },
    ]
    const rand = seeded(7)
    let heavy = 0
    for (let i = 0; i < 400; i++) if (dealSet(weighted, 1, { rand })[0].name === 'Heavy') heavy++
    expect(heavy).toBeGreaterThan(280)
  })
})

describe('dealSet', () => {
  const four = parseDirections(DIRECTIONS).map((d) => ({ ...d, weight: 1 }))

  it('deals two for a layout and three for a drawn thing, no direction twice', () => {
    for (const n of [2, 3]) {
      const hand = dealSet(four, n, { rand: seeded(1) })
      expect(hand).toHaveLength(n)
      expect(new Set(hand.map((d) => d.name)).size).toBe(n)
    }
  })

  it('never deals the last set again, even when the weights push hard for it', () => {
    const lopsided = four.map((d) => ({ ...d, weight: d.name === 'Ski map' || d.name === 'Night tram' ? 1000 : 1 }))
    const last = 'night tram | ski map'
    for (let s = 0; s < 50; s++) {
      const names = dealSet(lopsided, 2, { last, rand: seeded(s) }).map((d) => d.name.toLowerCase()).sort().join(' | ')
      expect(names).not.toBe(last)
    }
  })

  it('deals what there is when the list is short', () => {
    expect(dealSet(four.slice(0, 2), 3, { rand: seeded(1) })).toHaveLength(2)
  })
})

describe('lastDeal', () => {
  it('takes the latest line of the same kind and forgets one older than 30 days', () => {
    const log = logLine('2026-10-01', 'layout', ['A', 'B']) + logLine('2026-10-20', 'drawn', ['C', 'D', 'E']) + logLine('2026-10-25', 'layout', ['D', 'C'])
    expect(lastDeal(log, 'layout', '2026-11-03')).toBe('c | d')
    expect(lastDeal(log, 'drawn', '2026-11-03')).toBe('c | d | e')
    expect(lastDeal(logLine('2026-09-01', 'layout', ['A', 'B']), 'layout', '2026-11-03')).toBeNull()
  })
})

describe('deal', () => {
  it('deals 2 and 3, writes one log line per deal, and --dry writes none', () => {
    const t = setup()
    const a = deal(t.args('--seed', '1'))
    expect(a.dealt).toHaveLength(2)
    expect(a.starter).toBe(false)
    const b = deal(t.args('--kind', 'drawn', '--seed', '2'))
    expect(b.dealt).toHaveLength(3)
    expect(readFileSync(t.logFile, 'utf8').trim().split('\n')).toHaveLength(2)
    const c = deal(t.args('--dry', '--seed', '3'))
    expect(c.log).toBeNull()
    expect(readFileSync(t.logFile, 'utf8').trim().split('\n')).toHaveLength(2)
    expect(a.brief).toMatch(/^Brief: dealt 2 directions for a layout from directions\.md: \*\*/)
  })

  it('never deals the same pair twice in a row, over many deals', () => {
    const t = setup()
    let prev = null
    for (let s = 0; s < 30; s++) {
      const key = deal(t.args('--seed', String(s))).dealt.map((d) => d.name).sort().join(' | ')
      expect(key).not.toBe(prev)
      prev = key
    }
  })

  it('ignores a log line older than 30 days', () => {
    // The same seed with no log deals some pair; that pair logged yesterday is avoided, logged
    // in September it is dealt again.
    const names = (r) => r.dealt.map((d) => d.name)
    const first = names(deal(setup().args('--dry', '--seed', '5')))
    const fresh = setup({ log: logLine('2026-11-02', 'layout', first) })
    expect(names(deal(fresh.args('--dry', '--seed', '5'))).sort()).not.toEqual([...first].sort())
    const old = setup({ log: logLine('2026-09-01', 'layout', first) })
    expect(names(deal(old.args('--dry', '--seed', '5')))).toEqual(first)
  })

  it('with one possible set the repeat is dealt, not refused', () => {
    const two = DIRECTIONS.split('### Seed catalogue')[0]
    const t = setup({ directions: two, log: logLine('2026-11-02', 'layout', ['Field notebook', 'Night tram']) })
    expect(deal(t.args('--dry')).dealt).toHaveLength(2)
  })

  it('with no library every direction weighs the same, with a note', () => {
    const t = setup({ library: null })
    const r = deal(t.args('--dry', '--seed', '1'))
    expect(r.dealt).toHaveLength(2)
    expect(r.dealt.every((d) => d.weight === 1)).toBe(true)
    expect(r.notes.join(' ')).toMatch(/no library at/)
  })

  it("a project with no directions.md is dealt from the kit's starter, and says so", () => {
    const t = setup({ directions: null })
    const r = deal(t.args('--dry', '--seed', '1', '--template', writeTemplate(t.root)))
    expect(r.starter).toBe(true)
    expect(r.notes[0]).toMatch(/no \.claude\/directions\.md.*kit's starter/)
    expect(r.dealt).toHaveLength(2)
    expect(r.brief).toMatch(/from the kit's starter/)
  })

  it('refuses an unknown kind', () => {
    expect(() => deal(setup().args('--kind', 'poster'))).toThrow(/layout or drawn/)
  })
})

// The starter as C3 will leave it: the template's worked example plus starter entries.
function writeTemplate(root) {
  const f = join(root, 'starter.md')
  writeFileSync(f, `${readFileSync(DEFAULT_TEMPLATE, 'utf8')}\n${DIRECTIONS.split('## Directions')[1]}`)
  return f
}

describe('main guard', () => {
  const t = setup()
  const cli = (script) => execFileSync('node', [script, ...t.args('--dry', '--seed', '1')], { encoding: 'utf8' })

  it('runs through a spaced path', () => {
    const dir = join(t.root, 'a spaced dir')
    mkdirSync(dir)
    copyFileSync(join(HERE, 'deal.mjs'), join(dir, 'deal.mjs'))
    copyFileSync(join(HERE, 'leans.mjs'), join(dir, 'leans.mjs'))
    expect(cli(join(dir, 'deal.mjs'))).toMatch(/\nBrief: dealt 2 directions/)
  })

  it('runs through a symlink', () => {
    const link = join(t.root, 'linked deal.mjs')
    symlinkSync(join(HERE, 'deal.mjs'), link)
    expect(existsSync(link)).toBe(true)
    const out = cli(link)
    expect(JSON.parse(out.slice(0, out.lastIndexOf('\nBrief:'))).dealt).toHaveLength(2)
  })
})
