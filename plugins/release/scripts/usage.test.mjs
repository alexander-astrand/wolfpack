import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { budgetRows, budgetTableMarkdown, stepOf, stoppedInLog, countCalls, hhmm, projectFolderName, readEntries, resolveLocalId, sessionCommand, tallyEntries, tokensPerPoint, totalTokens } from './usage.mjs'

const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 }
const line = (id, block) => ({
  type: 'assistant',
  message: { id, model: 'claude-opus-x', usage, content: [block] },
})

describe('tallyEntries', () => {
  it('counts a three-block message once for tokens and calls, and its tool call once', () => {
    const entries = [
      line('msg_1', { type: 'thinking', thinking: '…' }),
      line('msg_1', { type: 'text', text: 'hi' }),
      line('msg_1', { type: 'tool_use', name: 'Read', input: {} }),
    ]
    const b = tallyEntries(entries).get('claude-opus-x')
    expect(b.calls).toBe(1)
    expect(totalTokens(b)).toBe(100)
    expect(countCalls(entries).calls).toBe(1)
  })

  it('counts two different ids twice', () => {
    const b = tallyEntries([line('msg_1', { type: 'text', text: 'a' }), line('msg_2', { type: 'text', text: 'b' })]).get('claude-opus-x')
    expect(b.calls).toBe(2)
    expect(totalTokens(b)).toBe(200)
  })

  it('keeps counting lines that have no id', () => {
    const noId = { message: { model: 'm', usage } }
    expect(tallyEntries([noId, noId]).get('m').calls).toBe(2)
  })
})

describe('resolveLocalId', () => {
  const base = mkdtempSync(join(tmpdir(), 'usage-sessions-'))
  mkdirSync(join(base, 'acct', 'org'), { recursive: true })
  writeFileSync(join(base, 'acct', 'org', 'local_abc.json'), JSON.stringify({ cliSessionId: 'f47d909c-0000' }))

  it('finds the transcript id in the app session file two folders down', () => {
    expect(resolveLocalId('local_abc', base)).toBe('f47d909c-0000')
  })

  it('says so when no file matches', () => {
    expect(() => resolveLocalId('local_nope', base)).toThrow(/No session file for "local_nope"/)
  })
})

describe('forked copies (M2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-forks-'))
  const prompt = { type: 'user', message: { content: '<command-name>/core:inception</command-name>' } }
  const text = `${[prompt, line('msg_a', { type: 'text', text: 'a' }), line('msg_b', { type: 'text', text: 'b' })].map((e) => JSON.stringify(e)).join('\n')}\n`
  writeFileSync(join(dir, 'aaaa1111-copy.jsonl'), text)
  writeFileSync(join(dir, 'bbbb2222-copy.jsonl'), text) // byte-identical, as the app forks them

  it('readEntries with one seen Set counts two byte-identical files once', () => {
    const seen = new Set()
    const first = tallyEntries(readEntries(join(dir, 'aaaa1111-copy.jsonl'), seen))
    const second = tallyEntries(readEntries(join(dir, 'bbbb2222-copy.jsonl'), seen))
    expect(totalTokens(first.get('claude-opus-x'))).toBe(200)
    expect(second.size).toBe(0)
  })

  it('the script sums the pair as one session and names the copy', () => {
    const script = fileURLToPath(new URL('./usage.mjs', import.meta.url))
    const out = JSON.parse(execFileSync(process.execPath, [script, '--json', '--dir', dir, 'aaaa1111', 'bbbb2222'], { encoding: 'utf8' }))
    expect(out.grandTotal).toBe(200)
    expect(out.copies).toEqual(['bbbb2222-copy'])
  })

  it('labels a session by its start command, else the first one it ran, in brackets', () => {
    expect(sessionCommand([prompt])).toBe('/core:inception')
    const later = [{ type: 'user', message: { content: 'plan the horizon' } }, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'core:inception' } }] } }]
    expect(sessionCommand(later)).toBe('(/core:inception)')
    expect(sessionCommand([{ type: 'user', message: { content: 'hi' } }])).toBe('(none)')
  })
})

describe('tokensPerPoint', () => {
  it('is 46M a point without a meter key', () => {
    expect(tokensPerPoint(null)).toBe(46e6)
    expect(tokensPerPoint({ project: {} })).toBe(46e6)
  })

  it('takes kit.json meter.tokensPerPoint, per family or as one number', () => {
    expect(tokensPerPoint({ meter: { tokensPerPoint: { opus: 40e6 } } })).toBe(40e6)
    expect(tokensPerPoint({ meter: { tokensPerPoint: 30e6 } }, 'sonnet')).toBe(30e6)
  })

  it('keeps Fable measured and derives Sonnet and Haiku from the Opus figure', () => {
    expect(tokensPerPoint(null, 'fable')).toBe(8e6)
    expect(tokensPerPoint(null, 'sonnet')).toBeGreaterThan(46e6)
    expect(tokensPerPoint(null, 'haiku')).toBeGreaterThan(tokensPerPoint(null, 'sonnet'))
  })
})

describe('hhmm', () => {
  it('prints UTC with a trailing Z', () => {
    expect(hhmm(Date.parse('2026-10-03T08:05:59Z'))).toBe('08:05Z')
  })
})

describe('projectFolderName', () => {
  it('turns every character outside A-Z, a-z, 0-9 into a dash, the way Claude Code names transcript folders', () => {
    expect(projectFolderName('/Users/a/wolfpack/.claude/worktrees/kit-1-5-771956'))
      .toBe('-Users-a-wolfpack--claude-worktrees-kit-1-5-771956')
    expect(projectFolderName('/Users/a/Desktop/my_app')).toBe('-Users-a-Desktop-my-app')
  })
})

// A release session with three spawns: one tagged and reused, one stopped by
// Hank (his deny in a tool result), one with no tag (the role's default).
describe('--budget-table (kit 1.7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-budget-'))
  const sub = join(dir, 'cccc3333', 'subagents')
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(dir, 'cccc3333.jsonl'), `${JSON.stringify(line('nav', { type: 'text', text: 'go' }))}\n`)
  const spend = (id, tokens, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-x', usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content: [] } })
  const user = (content) => ({ type: 'user', message: { content } })
  const run = (id, meta, entries) => {
    writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify(meta))
    writeFileSync(join(sub, `agent-${id}.jsonl`), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`)
  }
  run('a1', { agentType: 'release:jeff-winger', description: 'jeff-winger: step 3 hank table [budget 12M]' }, [
    user('order, quoting c-3po [budget 4M] in the body'),
    spend('m1', 5_000_000, '2026-10-24T10:00:00Z'),
    user('step 4\n[budget 9M]'),
    spend('m2', 2_000_000, '2026-10-24T10:20:00Z'),
  ])
  run('a2', { agentType: 'c-3po', description: 'c-3po: README [budget 1M]' }, [
    user('order'),
    spend('m3', 1_100_000, '2026-10-24T09:00:00Z'),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: "Budget reached: report what you did. (Hank: 110% (1.1M of 1.0M) used.)" }] } },
  ])
  run('a3', { agentType: 'lorenzo-von-matterhorn', description: 'lorenzo-von-matterhorn: find the tower' }, [user('find'), spend('m4', 300_000, '2026-10-24T11:00:00Z')])
  const budgets = { parseBudget: (d) => (/\[budget (\d+)M\]/.exec(d ?? '')?.[1] ?? 0) * 1e6 || null, followUpBudget: (t) => (/\n\[budget (\d+)M\]$/.exec(t)?.[1] ?? 0) * 1e6 || null, defaultFor: () => 2e6 }

  it('gives one row per spawn in start order, with step, tag, follow-up total and stops', () => {
    const rows = budgetRows(dir, ['cccc3333'], { budgets, hankLog: join(dir, 'none.log') })
    expect(rows.map((r) => r.agent)).toEqual(['c-3po', 'jeff-winger', 'lorenzo-von-matterhorn'])
    const [c3, jeff, lorenzo] = rows
    expect(jeff).toMatchObject({ step: 'step 3 hank table', budget: 9e6, tagged: true, tokens: 7e6, stopped: false })
    expect(c3.stopped).toBe(true)
    expect(lorenzo).toMatchObject({ budget: 2e6, tagged: false })
    const md = budgetTableMarkdown(rows)
    expect(md).toContain('| jeff-winger | step 3 hank table | 9.0M | 7.0M (78%) | no |')
    expect(md).toContain('| lorenzo-von-matterhorn | find the tower | 2.0M (default) | 0.3M (15%) | no |')
  })

  it("reads a stop from hank.log's line for the agent id", () => {
    const log = join(dir, 'hank.log')
    writeFileSync(log, '2026-10-24T11:01:00Z stopped lorenzo-von-matterhorn a3 at 101% (2.0M of 2.0M)\n')
    expect(stoppedInLog(readFileSync(log, 'utf8'))).toEqual(new Set(['a3']))
    expect(budgetRows(dir, ['cccc3333'], { budgets, hankLog: log }).find((r) => r.agentId === 'a3').stopped).toBe(true)
  })

  it('takes the step from a description with or without the plugin prefix', () => {
    expect(stepOf('release:saul-goodman: step 2 [budget 8M]', 'saul-goodman')).toBe('step 2')
    expect(stepOf('fix the tower', 'saul-goodman')).toBe('fix the tower')
  })

  it('the script prints the table with Hank as the source of tags', () => {
    const script = fileURLToPath(new URL('./usage.mjs', import.meta.url))
    const out = execFileSync(process.execPath, [script, '--budget-table', '--dir', dir, '--hank-log', join(dir, 'none.log'), 'cccc3333'], { encoding: 'utf8', cwd: dir })
    expect(out).toContain('| Agent | Step | Budget | Used | Stopped by Hank |')
    expect(out).toContain('| c-3po | README | 1.0M | 1.1M (110%) | yes |')
    // no tag: Hank's default for the scout (budgets.json, 2M)
    expect(out).toContain('| lorenzo-von-matterhorn | find the tower | 2.0M (default) |')
  })
})
