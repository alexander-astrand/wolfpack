import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { agentModels, cells, check, parseExpected, stepTables } from './plan-check.mjs'

const models = { 'chris-de-kok': 'opus', kissochbajslowski: 'sonnet', 'bengt-johansson': 'sonnet', 'jesse-pinkman': 'sonnet' }

const plan = (rows, expected = '**Expected: ≈ 106M.** Cap ≈ 140M.') => [
  '# V9.9',
  '',
  '| Step | What | Found (file:line) | Agent | Model | Budget | Check |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  'Desktop pages: none (no screen in this release)',
  expected,
].join('\n')

const good = [
  '| E1 | the bridge | lib/note-doc.ts:34-47 | chris-de-kok | Opus | 10M | check |',
  '| Q1 | QA phone | scripts/qa/shot.mjs | bengt-johansson | Sonnet | 7M | report |',
  '| R | review | | kissochbajslowski | Sonnet | 10M | findings |',
  '| H1 | his phone look | | Alexander | | | his yes |',
]

describe('plan-check', () => {
  it('passes a clean plan and counts the agent steps, not the human one', () => {
    expect(check(plan(good), models)).toEqual({ steps: 3, fails: [] })
  })

  it('item 1: a step with no budget', () => {
    const rows = [...good, '| E2 | editor | lib/x.ts:9 | chris-de-kok | Opus | | check |']
    expect(check(plan(rows), models).fails).toEqual(['item 1: step E2 (line 9): no budget'])
  })

  it('item 2: no Expected line; the older "Expected real spend" shape passes', () => {
    expect(check(plan(good, 'Cap 140M.'), models).fails).toEqual([expect.stringMatching(/^item 2:/)])
    expect(check(plan(good, '- **Expected real spend ≈ 106M (about 2.3 points).**'), models).fails).toEqual([])
  })

  it('item 10: a build step with no file:line; review and QA rows are exempt', () => {
    const rows = [...good, '| E3 | ticks | the tick component | chris-de-kok | Opus | 8M | check |']
    expect(check(plan(rows), models).fails).toEqual(['item 10: step E3 (line 9): no file:line beside the step'])
    const fix = [...good, '| FX | one fix order | none: sized from the review findings | chris-de-kok | Opus | 10M | check |']
    expect(check(plan(fix), models).fails).toEqual([])
  })

  it('item 12: a model above the route needs a reason in its row', () => {
    const bare = [...good, '| E4 | chips | lib/living.tsx:12 | chris-de-kok | Fable, high | 12M | check |']
    expect(check(plan(bare), models).fails).toEqual([expect.stringMatching(/^item 12: step E4 .*opus route/)])
    const why = [...good, '| E4 | chips | lib/living.tsx:12 | chris-de-kok | Fable: the hardest editor work | 12M | check |']
    expect(check(plan(why), models).fails).toEqual([])
  })

  it('stamp: an Opus reviewer without a reason, or a second one, is refused', () => {
    const bare = good.map((r) => r.replace('| kissochbajslowski | Sonnet |', '| kissochbajslowski | Opus |'))
    expect(check(plan(bare), models).fails).toEqual([
      expect.stringMatching(/^item 12: step R/),
      expect.stringMatching(/^stamp: step R .*without a reason/),
    ])
    const one = good.map((r) => r.replace('| kissochbajslowski | Sonnet |', '| kissochbajslowski | Opus for the wall review: 40 files |'))
    expect(check(plan(one), models).fails).toEqual([])
    const two = [...one, '| R2 | second review | | kissochbajslowski | Opus because the guard moved | 10M | findings |']
    expect(check(plan(two), models).fails).toEqual([expect.stringMatching(/^stamp: step R2 .*second reviewer row/)])
  })

  it('reads the other header spellings: Id, Tag, Agent · model', () => {
    const v15 = [
      '| Id | What | Agent · model | Lane | Tag | Grepped |',
      '|---|---|---|---|---|---|',
      '| U1 | trips tab | chris-de-kok · Opus | A | 10M | app/us/trips/page.tsx:12 |',
      '| R1 | review | kissochbajslowski · Opus | - | 8M | |',
      '',
      'Desktop pages: /us/trips Calm and Full (magnus-wislander)',
      'Expected: ≈ 300M',
    ].join('\n')
    expect(check(v15, models).fails).toEqual([
      expect.stringMatching(/^item 12: step R1 /),
      expect.stringMatching(/^stamp: step R1 .*without a reason/),
    ])
  })

  // The Burrow V1.12 retro (5 Nov 2026): fixes 2, 3, 4, 10 and 13.
  const v112 = (rows, extra = []) =>
    [
      '| Step | What | Found | Agent | Model | Budget | Intent |',
      '|---|---|---|---|---|---|---|',
      ...rows,
      '',
      'Desktop pages: /notes Calm and Full (magnus-wislander, his look)',
      'Expected: ≈ 120M',
      ...extra,
    ].join('\n')
  const tables = '| N1 | the grid | lib/note-table.ts:322 | chris-de-kok | Opus | 10M | I1 |'

  it('item 14: an intent with no first tap, or a tap with no place in the code', () => {
    expect(check(v112([tables]), models).fails).toEqual([expect.stringMatching(/^item 14: I1 has no first-tap line/)])
    const vague = ['', '## Intents and first taps', '- I1 · tables · first tap: Aa, Table']
    expect(check(v112([tables], vague), models).fails).toEqual([expect.stringMatching(/^item 14: I1 \(line \d+\): the first tap needs/)])
    const today = ['', '## Intents and first taps', '- I1 · tables · first tap: Aa, Table · components/mine/notebook/format-bar.tsx:70']
    expect(check(v112([tables], today), models).fails).toEqual([])
    const built = ['', '## Intents and first taps', '- **I1** · tables · first tap: Aa, Table · built by N0']
    expect(check(v112([tables], built), models).fails).toEqual([])
  })

  it('item 15: no Desktop pages line', () => {
    expect(check(plan(good).replace(/^Desktop pages:.*$/m, ''), models).fails).toEqual([expect.stringMatching(/^item 15:/)])
  })

  it('item 16: never Sonnet on design, and Opus QA in a design release', () => {
    const taps = ['', '## Intents and first taps', '- I2 · every page redone · first tap: open Food · app/food/page.tsx:1']
    const sweep = '| S1 | Food redo: words to faces, glass, bubbles | app/food/page.tsx:12 | jesse-pinkman | Sonnet | 8M | I2 |'
    const qa = '| Q1 | QA by hand | | bengt-johansson | Sonnet | 7M | I2 |'
    expect(check(v112([sweep, qa], taps), models).fails).toEqual([
      expect.stringMatching(/^item 16: step S1 .*design work on sonnet/),
      expect.stringMatching(/^item 16: step Q1 .*QA of a design release runs Opus/),
    ])
    const opus = [sweep.replace('jesse-pinkman | Sonnet', 'chris-de-kok | Opus'), qa.replace('Sonnet', 'Opus: a design release')]
    expect(check(v112(opus, taps), models).fails).toEqual([])
    const review = '| R | review the layout diff | | kissochbajslowski | Sonnet | 10M | |'
    expect(check(v112([review]), models).fails).toEqual([])
  })

  it('item 17: Expected past 400M needs a Split line', () => {
    const big = v112([tables], ['', '## Intents and first taps', '- I1 · t · first tap: Aa · built by N1']).replace('≈ 120M', '≈ 735M')
    expect(check(big, models).fails).toEqual([expect.stringMatching(/^item 17: Expected ≈ 735M/)])
    expect(check(`${big}\nSplit: offered V1.12 design system and V1.13 the page redo; recommended`, models).fails).toEqual([])
  })

  it('item 18: a plan rule with no check', () => {
    const rules = ['', '## Plan rules', '- Never a second row above the bar · surface: food', '- One row with the + above the bar · surface: food · check: 375 shot beside main']
    expect(check(`${plan(good)}\n${rules.join('\n')}`, models).fails).toEqual([expect.stringMatching(/^item 18: plan rule at line \d+ has no `check:`/)])
  })

  it('refuses a plan with no step table', () => {
    expect(check('# V1\n\nExpected: ≈ 10M', models).fails).toEqual([expect.stringMatching(/^no step table/)])
  })

  it('splits cells on pipes outside backticks and escapes', () => {
    expect(cells('| a | `Enter|Tab` | b \\| c |')).toEqual(['a', '`Enter|Tab`', 'b | c'])
    expect(stepTables(plan(good))[0].rows).toHaveLength(4)
  })

  it('parses every Expected headline shape, unit required, any case', () => {
    expect(parseExpected('**Expected:** ≈ 120M')).toBe(120e6)
    expect(parseExpected('Expected: ~120M')).toBe(120e6)
    expect(parseExpected('- **Expected real spend ≈ 106M (about 2.3 points).**')).toBe(106e6)
    expect(parseExpected('**Expected: ≈ 1.2b.** Cap 2B')).toBe(1.2e9)
    expect(parseExpected('Expected: 800k')).toBe(8e5)
    expect(parseExpected('Expected: ≈ 120')).toBeNull()
    expect(check(plan(good, 'Expected: ≈ 120'), models).fails).toEqual([expect.stringMatching(/^item 2:/)])
  })

  // MUST 1 of the kit 1.8 review: the old `file://${argv[1]}` guard exited 0
  // with no output through a spaced path or a symlink, so a failing plan stamped.
  it('runs as a CLI through a spaced path and a symlink, and fails a failing plan', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'plan check '))
    const real = join(tmp, 'a dir', 'plan-check.mjs')
    mkdirSync(join(tmp, 'a dir'))
    copyFileSync(fileURLToPath(new URL('./plan-check.mjs', import.meta.url)), real)
    const link = join(tmp, 'link.mjs')
    symlinkSync(real, link)
    const file = join(tmp, 'V9.9.md')
    writeFileSync(file, plan(good, 'Cap 140M.'))
    for (const script of [real, link]) {
      const r = spawnSync(process.execPath, [script, file, '--agents', tmp], { encoding: 'utf8' })
      expect(r.status).toBe(1)
      expect(r.stdout).toMatch(/^item 2:/m)
    }
  })

  it('reads the route models from the agent files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-check-'))
    mkdirSync(join(dir, 'release', 'agents'), { recursive: true })
    writeFileSync(join(dir, 'release', 'agents', 'kissochbajslowski.md'), '---\nname: kissochbajslowski\nmodel: sonnet\n---\n')
    expect(agentModels(dir)).toEqual({ kissochbajslowski: 'sonnet' })
  })
})
