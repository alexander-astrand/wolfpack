import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { floorRow, parseTokens, readFloors, tokensInStretches, weeklyStretches } from './meter-calibrate.mjs'

describe('tokensInStretches', () => {
  it('streams the transcripts and counts a message once per stretch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meter-calibrate-'))
    const line = (id, ts, n) =>
      JSON.stringify({ timestamp: ts, message: { id, model: 'claude-opus-x', usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: n, output_tokens: 0 } } })
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    // One message on two lines, a forked copy in a second file, one outside the stretch, and noise.
    writeFileSync(a, [line('m1', '2026-10-08T10:30:00Z', 9), line('m1', '2026-10-08T10:30:00Z', 9), 'not json', line('m2', '2026-10-09T10:00:00Z', 99)].join('\n'))
    writeFileSync(b, `${[line('m1', '2026-10-08T10:30:00Z', 9), JSON.stringify({ type: 'user' }), line('m3', '2026-10-08T11:00:00Z', 4)].join('\n')}\n`)
    const stretch = { t0: Date.parse('2026-10-08T10:00:00Z'), t1: Date.parse('2026-10-08T12:00:00Z') }
    expect(await tokensInStretches([a, b], [stretch, { t0: 0, t1: Date.parse('2030-01-01') }])).toEqual([15, 115])
  })
})

const reset = '2026-10-10T10:00:00.000Z'
const row = (t, from, now) => `${t}\tseven_day\t${from}\t${now}\t${reset}`

describe('weeklyStretches', () => {
  it('takes the first and last reading of a week', () => {
    const log = [row('2026-10-08T10:00:00Z', 'start', 2), row('2026-10-08T11:00:00Z', 2, 3), row('2026-10-08T12:00:00Z', 3, 7)].join('\n')
    const [s] = weeklyStretches(log)
    expect([s.p0, s.p1]).toEqual([2, 7])
  })

  it('splits plans at a marker row and skips five_hour rows', () => {
    const log = [
      '2026-10-01T00:00:00Z\tplan\t5x',
      row('2026-10-01T10:00:00Z', 'start', 1),
      row('2026-10-01T12:00:00Z', 1, 4),
      '2026-10-02T00:00:00Z\tplan\t20x',
      '2026-10-02T10:00:00Z\tfive_hour\t1\t2\t2026-10-02T15:00:00Z',
      `2026-10-02T11:00:00Z\tseven_day\tstart\t4\t2026-10-17T10:00:00.000Z`,
      `2026-10-02T12:00:00Z\tseven_day\t4\t6\t2026-10-17T10:00:00.000Z`,
    ].join('\n')
    expect(weeklyStretches(log).map((s) => s.plan)).toEqual(['5x', '20x'])
  })
})

// Burrow V1.2: Skyler 608.5M for the release's sessions while the meter moved 8 points.
describe('release floors', () => {
  it('reads tokens as M, B or a plain number', () => {
    expect(parseTokens('608.5M')).toBe(608_500_000)
    expect(parseTokens('1.2b')).toBe(1_200_000_000)
    expect(parseTokens('46000000')).toBe(46_000_000)
    expect(parseTokens('lots')).toBeNaN()
  })

  it('writes a row the reader gives back with its tokens a point', () => {
    const row = floorRow('Burrow V1.2', '608.5M', '8', new Date('2026-10-28T12:00:00Z'))
    expect(row).toBe('2026-10-28T12:00:00.000Z\tBurrow V1.2\t608500000\t8')
    const [f] = readFloors(`${row}\nnot a row\n`)
    expect(f).toMatchObject({ label: 'Burrow V1.2', points: 8 })
    expect(f.perPoint).toBeCloseTo(76_062_500)
  })

  it('refuses a reading it could not use', () => {
    expect(() => floorRow('Burrow V1.2', 'lots', 8)).toThrow(/tokens like 608.5M/)
    expect(() => floorRow('Burrow V1.2', '608.5M', 0)).toThrow(/delta in points/)
    expect(() => floorRow('', '608.5M', 8)).toThrow(/label/)
  })
})
