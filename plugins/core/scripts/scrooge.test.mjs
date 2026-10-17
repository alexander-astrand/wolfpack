import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { firstNumber, readFreeTiers, readTrials, render, scan } from './scrooge.mjs'

const trials = `# Trials

| Service | Account / project | Started | Ends | Card on file | At the end | Source |
|---|---|---|---|---|---|---|
| Vercel Pro trial | his account | ≈ 2026-10-11 | ≈ 2026-10-25 | unknown | unknown | his words |
| Resend Pro trial | job-hunt | 2026-10-01 | | no | downgrade | x |
`

const freeTiers = `# Free-tier limits

Checked: 2026-10-05

## Vercel (Hobby)

| Limit | Value | Used | When you hit it | Source | Read |
|---|---|---|---|---|---|
| Bandwidth | 100 GB / month | 72 GB | Paused | https://vercel.com | 2026-10-05 |
| Functions | 1,000,000 / month | 10,000 | Paused | same | 2026-10-05 |
| Seats | 1 | | n/a | same | |

## CoinGecko

| Limit | Value | When you hit it | Source | Read |
|---|---|---|---|---|
| Our use | about 240 a month ≈ 80 % of the limit | | cron | 2026-10-14 |
`

describe('scrooge', () => {
  it('counts days left on a trial and warns two days before and after', () => {
    const at = (today) => readTrials(trials, today, 'trials.md')[0]
    expect(at('2026-10-17')).toMatchObject({ daysLeft: 8, status: 'ok', approx: true, warnFrom: '2026-10-23', card: 'unknown' })
    expect(at('2026-10-23').status).toBe('warn')
    expect(at('2026-10-25')).toMatchObject({ daysLeft: 0, status: 'warn' })
    expect(at('2026-10-26')).toMatchObject({ daysLeft: -1, status: 'ended' })
    expect(readTrials(trials, '2026-10-17', 'trials.md')[1]).toMatchObject({ ends: null, status: 'no-date' })
  })

  it('flags usage at 70% or more, rows with no date and a stale file', () => {
    const f = readFreeTiers(freeTiers, '2026-10-17', 'free-tiers.md', 'demo')
    expect(f).toMatchObject({ checked: '2026-10-05', refreshDue: '2026-11-04', stale: false, rows: 4, usageRows: 3 })
    expect(f.flags).toEqual([
      { kind: 'usage', what: 'Vercel (Hobby): Bandwidth', pct: 72 },
      { kind: 'no-date', what: 'Vercel (Hobby): Seats' },
      { kind: 'usage', what: 'CoinGecko: Our use', pct: 80 },
    ])
    expect(readFreeTiers(freeTiers, '2026-11-05', 'free-tiers.md', 'demo').stale).toBe(true)
  })

  it('reads thousands separators', () => {
    expect(firstNumber('about 10 000')).toBe(10000)
    expect(firstNumber('1,000,000 / month')).toBe(1000000)
    expect(firstNumber('n/a')).toBe(null)
  })

  it('finds projects by kit.json, reads each plans folder once, and renders', () => {
    const home = mkdtempSync(join(tmpdir(), 'scrooge-'))
    const plans = join(home, '.claude', 'plans')
    for (const [name, kit] of [
      ['App', { project: { name: 'app' }, plans: '~/.claude/plans/app/' }],
      ['Twin', { project: { name: 'twin' }, plans: '~/.claude/plans/app' }],
      ['Bare', {}],
    ]) {
      mkdirSync(join(home, 'Desktop', name, '.claude'), { recursive: true })
      writeFileSync(join(home, 'Desktop', name, '.claude', 'kit.json'), JSON.stringify(kit))
    }
    mkdirSync(join(plans, 'app'), { recursive: true })
    writeFileSync(join(plans, 'trials.md'), trials)
    writeFileSync(join(plans, 'app', 'free-tiers.md'), freeTiers)
    writeFileSync(join(plans, 'app', 'costs.md'), '| Service | Cost | Renews |\n|---|---|---|\n| Domain | $12/yr | 2026-10-18 |\n')

    const r = scan({ home, today: '2026-10-17' })
    expect(r.projects.map((p) => p.plans)).toEqual(['~/.claude/plans/app/', '~/.claude/plans/'])
    expect(r.trials).toHaveLength(2)
    expect(r.freeTiers).toHaveLength(1)
    expect(r.costs).toEqual([
      expect.objectContaining({ service: 'Domain', cost: '$12/yr', date: '2026-10-18', daysLeft: 1, status: 'warn' }),
    ])
    const text = render(r)
    expect(text).toContain(' ! Vercel Pro trial (his account): ends 2026-10-25 (approx.), 8 days left, warning from 2026-10-23; card on file: unknown')
    expect(text).toContain(' !   Vercel (Hobby): Bandwidth: 72% of the limit')
    expect(text).toContain('!! app: Domain, $12/yr: next 2026-10-18 (1 day)')
  })
})
