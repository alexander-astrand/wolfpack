import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokensInStretches, weeklyStretches } from './meter-calibrate.mjs'

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
