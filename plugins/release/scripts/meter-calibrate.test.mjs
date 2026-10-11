import { describe, expect, it } from 'vitest'
import { weeklyStretches } from './meter-calibrate.mjs'

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
