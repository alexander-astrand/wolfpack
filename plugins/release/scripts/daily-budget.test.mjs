// The kit's copy of ~/.claude/hooks/daily-budget.test.mjs (kit 1.5, L2), on
// Vitest like the plugin's other tests; the cases are unchanged.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ACTIVE_FROM, dayLine, dayTokens, decide, meterAtStart, readOverride, standing, weeklyTicks, windowAt } from './daily-budget.mjs'

const RESET = Date.parse('2026-10-17T10:00:00Z') // the week after activation
const H = 3_600_000
const iso = (t) => new Date(t).toISOString()
// Window 3 of that week (index 2): starts Mon 12 Oct 10:00Z.
const W3 = RESET - 7 * 24 * H + 2 * 24 * H

function env({ now, used, log = [], override = '', model = 'opus', warned } = {}) {
  return {
    now,
    meterNow: { at: iso(now - 10_000), rate_limits: [{ kind: 'seven_day', percentUsed: used, resetsAt: iso(RESET) }] },
    logLines: log.map(([t, old, nw]) => `${iso(t)}\tseven_day\t${old}\t${nw}\t${iso(RESET)}`),
    state: {},
    override,
    sessionModel: model,
    projectDir: '/nonexistent',
    home: '/nonexistent',
    warned: warned ?? new Set(),
  }
}
const agent = (extra = {}) => ({ session_id: 's', tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', ...extra } })

test('windows start at the weekly reset, not the clock', () => {
  const w = windowAt(W3 + 5 * H, RESET)
  assert.equal(iso(w.start), '2026-10-12T10:00:00.000Z')
  assert.equal(w.n, 2)
  // After summer time ends the reset moves to 11:00Z and the windows with it.
  const late = Date.parse('2026-10-31T11:00:00Z')
  assert.equal(iso(windowAt(late - 7 * 24 * H + 30 * H, late).start), '2026-10-25T11:00:00.000Z')
  // A reset the meter hasn't caught up with rolls the week forward.
  assert.equal(windowAt(RESET + H, RESET).n, 0)
})

test('the meter at the window start comes from the log', () => {
  const ticks = weeklyTicks([
    `${iso(W3 - H)}\tseven_day\t29\t30\t${iso(RESET)}`,
    `${iso(W3 + H)}\tseven_day\t30\t31\t${iso(RESET)}`,
    `${iso(W3 + H)}\tfive_hour\t1\t2\t${iso(RESET)}`,
  ])
  const win = windowAt(W3 + 2 * H, RESET)
  assert.equal(meterAtStart(ticks, win), 30)
  assert.equal(meterAtStart(ticks.slice(1), win), 30) // only a later move: its old value
  assert.equal(meterAtStart([], { ...win, n: 0 }), 0) // a week's first window starts at 0
})

test('under 14%: allowed; at 14%: new agents and heavy skills denied', () => {
  const log = [[W3 - H, 29, 30], [W3 + 13 * H, 30, 36]]
  assert.equal(decide(agent(), env({ now: W3 + 14 * H, used: 36, log })), null)
  const capped = env({ now: W3 + 20 * H, used: 44, log: [...log, [W3 + 19 * H, 36, 44]] })
  assert.equal(decide(agent(), capped).decision, 'deny')
  assert.match(decide(agent(), capped).reason, /^Daily budget reached: .*14\.0% of 14%/)
  assert.equal(decide({ session_id: 's', tool_name: 'Workflow', tool_input: {} }, capped).decision, 'deny')
  assert.equal(decide({ session_id: 's', tool_name: 'Skill', tool_input: { skill: 'maverick' } }, capped).decision, 'deny')
  assert.equal(decide({ session_id: 's', tool_name: 'Skill', tool_input: { skill: '88-mph', args: 'large x' } }, capped).decision, 'deny')
  // Never blocked: small skills and routines, ranjit and the deploy skills, a running agent's own calls.
  assert.equal(decide({ session_id: 's', tool_name: 'Skill', tool_input: { skill: '88-mph', args: 'small x' } }, capped), null)
  assert.equal(decide({ session_id: 's', tool_name: 'Skill', tool_input: { skill: 'groundhog-day' } }, capped), null)
  assert.equal(decide({ session_id: 's', tool_name: 'Skill', tool_input: { skill: 'skinny-pete' } }, capped), null)
  assert.equal(decide(agent({ subagent_type: 'ranjit' }), capped), null)
  assert.equal(decide({ ...agent(), agent_id: 'a1' }, capped), null)
})

test('over 7% before the 12 h mark: one model down for the rest of the window', () => {
  const log = [[W3 - H, 29, 30], [W3 + 5 * H, 30, 38]] // 8% at 5 h
  const e = () => env({ now: W3 + 16 * H, used: 38, log })
  const opus = decide(agent(), e())
  assert.equal(opus.decision, 'deny')
  assert.match(opus.reason, /would run opus; re-spawn it with `model: sonnet`/)
  assert.notEqual(decide(agent({ model: 'sonnet' }), e())?.decision, 'deny')
  assert.equal(decide(agent({ model: 'fable' }), e()).decision, 'deny')
  assert.match(decide(agent(), env({ now: W3 + 16 * H, used: 38, log, model: 'sonnet' })).reason, /`model: haiku`/)
  // A Skill call in the step-down warns the session once, then says nothing.
  const warned = new Set()
  const skill = { session_id: 's', tool_name: 'Skill', tool_input: { skill: 'badger' } }
  assert.equal(decide(skill, { ...e(), warned }).decision, 'note')
  assert.equal(decide(skill, { ...e(), warned }), null)
  // 8% reached only after the 12 h mark: no step-down.
  assert.equal(decide(agent(), env({ now: W3 + 16 * H, used: 38, log: [[W3 - H, 29, 30], [W3 + 13 * H, 30, 38]] })), null)
})

test('the lift: last 2 windows with the weekly meter ≤ 60%', () => {
  const W6 = RESET - 2 * 24 * H
  const log = [[W6 - H, 39, 40], [W6 + 2 * H, 40, 56]]
  const lifted = env({ now: W6 + 3 * H, used: 56, log })
  assert.equal(decide(agent(), lifted), null)
  assert.equal(dayLine(standing(lifted)), 'day 16.0/14% lifted')
  // Over 60%: the cap holds again.
  const over = env({ now: W6 + 3 * H, used: 61, log: [[W6 - H, 44, 45], [W6 + 2 * H, 45, 61]] })
  assert.equal(decide(agent(), over).decision, 'deny')
  // Not in the last two windows: no lift.
  assert.equal(decide(agent(), env({ now: W3 + 3 * H, used: 46, log: [[W3 - H, 29, 30], [W3 + 2 * H, 30, 46]] })).decision, 'deny')
})

test('the override file, by scope and until it expires', () => {
  const now = W3 + 20 * H
  const capped = (override) => env({ now, used: 44, log: [[W3 - H, 29, 30], [W3 + 19 * H, 30, 44]], override })
  assert.equal(decide(agent({ model: 'sonnet' }), capped(`until=${iso(now + H)} scope=cap`)), null)
  assert.equal(decide(agent({ model: 'sonnet' }), capped(`until=${iso(now + H)} scope=all`)), null)
  assert.equal(decide(agent(), capped(`until=${iso(now - H)} scope=all`)).decision, 'deny') // expired
  assert.equal(decide(agent(), capped(`until=${iso(now + H)} scope=fable`)).decision, 'deny') // wrong scope
  assert.deepEqual([...readOverride(`until=${iso(now + H)} scope=fable,cap`, now)], ['fable', 'cap'])
  assert.match(decide(agent(), capped('')).reason, /~\/\.claude\/budget-override/)
})

test('a missing or stale meter fails open with one warning', () => {
  const warned = new Set()
  const stale = { ...env({ now: W3 + H, used: 99 }), warned }
  stale.meterNow.at = iso(W3 + H - 31 * 60_000)
  assert.equal(decide(agent(), stale).decision, 'note')
  assert.equal(decide(agent(), stale), null)
  const missing = { ...env({ now: W3 + H, used: 99 }), meterNow: undefined, home: '/nonexistent', warned: new Set() }
  assert.match(decide(agent(), missing).reason, /^Daily budget not enforced: no meter/)
})

test('before the switch-on date it only computes', () => {
  const r = Date.parse('2026-10-10T10:00:00Z')
  const e = { ...env({ now: ACTIVE_FROM - H, used: 70 }), meterNow: { at: iso(ACTIVE_FROM - H), rate_limits: [{ kind: 'seven_day', percentUsed: 70, resetsAt: iso(r) }] } }
  e.logLines = [`${iso(ACTIVE_FROM - 20 * H)}\tseven_day\t5\t6\t${iso(r)}`]
  assert.equal(decide(agent(), e), null)
  assert.equal(decide(agent(), { ...e, forceActive: true }).decision, 'deny')
  assert.equal(dayLine(standing(e)), 'day 65.0/14%')
})

test('the day in tokens reads the one meter figure (kit 1.5)', () => {
  const st = standing(env({ now: W3 + H, used: 32, log: [[W3 - H, 29, 30]] }))
  assert.equal(st.dayUse, 2)
  assert.equal(dayTokens(st, null), 92e6)
  assert.equal(dayTokens(st, { meter: { tokensPerPoint: { opus: 40e6 } } }), 80e6)
  assert.equal(dayTokens({ ok: false }, null), null)
})
