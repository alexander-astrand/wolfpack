import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tallyEntries, totalTokens } from '../scripts/usage.mjs'
import { DEFAULT_BUDGETS, STOPPED, WARNING, bareAgentType, decide, kitBudgets, parseBudget, watchNavigator } from './budget-cap.mjs'

const M = 1_000_000
const SESSION = 'sess-1'
let root, subDir, stateDir, logs

// A session folder shaped like Claude Code's: <project>/<session>.jsonl, with
// each subagent's transcript and meta under <project>/<session>/subagents/.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hank-test-'))
  subDir = join(root, SESSION, 'subagents')
  mkdirSync(subDir, { recursive: true })
  stateDir = join(root, 'state')
  logs = []
  // The kit is looked up under CLAUDE_PROJECT_DIR: point it at the temp root
  // (no kit there) so the repo's own kit.json never leaks into a test.
  savedProjectDir = process.env.CLAUDE_PROJECT_DIR
  process.env.CLAUDE_PROJECT_DIR = root
})
let savedProjectDir
afterEach(() => {
  if (savedProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR
  else process.env.CLAUDE_PROJECT_DIR = savedProjectDir
})

function agent(id, { type, description, tokens = 0, shots = 0, transcript = true }) {
  writeFileSync(join(subDir, `agent-${id}.meta.json`), JSON.stringify({ agentType: type, description }))
  if (transcript) {
    writeFileSync(join(subDir, `agent-${id}.jsonl`), '')
    spend(id, tokens, shots)
  }
}

// Appends one assistant entry: `tokens` of usage, and `shots` screenshots.
function spend(id, tokens, shots = 0) {
  const content = Array.from({ length: shots }, () => ({ type: 'tool_use', name: 'mcp__Claude_Browser__computer', input: { action: 'screenshot' } }))
  const entry = { type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content } }
  appendFileSync(join(subDir, `agent-${id}.jsonl`), JSON.stringify(entry) + '\n')
}

function call(id, type, tool = 'Bash', toolInput = { command: 'ls' }) {
  const input = { session_id: SESSION, transcript_path: join(root, `${SESSION}.jsonl`), agent_id: id, agent_type: type, tool_name: tool, tool_input: toolInput }
  const r = decide(input, { stateDir, log: (l) => logs.push(l) })
  return r ? r.decision : 'allow'
}

describe('budgets', () => {
  it('reads the [budget …] tag', () => {
    expect(parseBudget('chris-de-kok: step 2 [budget 18M]')).toBe(18 * M)
    expect(parseBudget('x [budget 1.5M]')).toBe(1.5 * M)
    expect(parseBudget('x [budget 800k]')).toBe(800_000)
    expect(parseBudget('no tag')).toBeNull()
  })

  it('finds the budget of a plugin agent named <plugin>:<agent>', () => {
    expect(bareAgentType('release:chris-de-kok')).toBe('chris-de-kok')
    expect(bareAgentType('chris-de-kok')).toBe('chris-de-kok')
    // 16M is under chris-de-kok's 25M × 80%, but past the 15M default a missed lookup would use.
    agent('p1', { type: 'release:chris-de-kok', description: 'step F', tokens: 16 * M })
    expect(call('p1', 'release:chris-de-kok')).toBe('allow')
  })

  it('never counts the main session', () => {
    expect(decide({ tool_name: 'Bash', tool_input: {} })).toBeNull()
  })

  it('allows, warns at 80% and stops at 100% of the tagged budget', () => {
    agent('a1', { type: 'chris-de-kok', description: 'chris-de-kok: step [budget 10M]', tokens: 5 * M })
    expect(call('a1', 'chris-de-kok')).toBe('allow')
    spend('a1', 3.5 * M)
    const warn = decide(
      { session_id: SESSION, transcript_path: join(root, `${SESSION}.jsonl`), agent_id: 'a1', agent_type: 'chris-de-kok', tool_name: 'Bash', tool_input: {} },
      { stateDir, log: () => {} },
    )
    expect(warn).toMatchObject({ decision: 'note' })
    expect(warn.reason).toContain(WARNING)
    spend('a1', 2 * M)
    const stop = decide(
      { session_id: SESSION, transcript_path: join(root, `${SESSION}.jsonl`), agent_id: 'a1', agent_type: 'chris-de-kok', tool_name: 'Read', tool_input: {} },
      { stateDir, log: () => {} },
    )
    expect(stop).toMatchObject({ decision: 'deny' })
    expect(stop.reason).toContain(STOPPED)
  })

  it('always lets the final report through', () => {
    agent('a2', { type: 'jesse-pinkman', description: 'jesse-pinkman: x [budget 1M]', tokens: 5 * M })
    expect(call('a2', 'jesse-pinkman')).toBe('deny')
    expect(call('a2', 'jesse-pinkman', 'SubagentHandback', { message: 'done' })).toBe('allow')
  })

  it('falls back to the role default without a tag', () => {
    agent('a3', { type: 'lorenzo-von-matterhorn', description: 'lorenzo-von-matterhorn: where is X', tokens: 2.1 * M })
    expect(call('a3', 'lorenzo-von-matterhorn')).toBe('deny')
    agent('a4', { type: 'chris-de-kok', description: 'chris-de-kok: step', tokens: 2.1 * M })
    expect(call('a4', 'chris-de-kok')).toBe('allow')
  })

  it('gives every builder in the pool the same 25M default', () => {
    for (const name of ['ahmed-och-ahmed', 'saul-goodman', 'jeff-winger', 'troy-and-abed']) {
      agent(`p-${name}`, { type: name, description: `${name}: step`, tokens: 16 * M })
      expect(call(`p-${name}`, name)).toBe('allow')
      agent(`q-${name}`, { type: name, description: `${name}: step`, tokens: 26 * M })
      expect(call(`q-${name}`, name)).toBe('deny')
    }
  })

  it('caps heisenberg at 8M by default', () => {
    agent('h1', { type: 'heisenberg', description: 'heisenberg: brief', tokens: 7 * M })
    expect(call('h1', 'heisenberg')).not.toBe('deny')
    agent('h2', { type: 'heisenberg', description: 'heisenberg: brief', tokens: 8.1 * M })
    expect(call('h2', 'heisenberg')).toBe('deny')
  })

  it('names a generic agent from its description prefix', () => {
    agent('a5', { type: 'claude', description: 'heisenberg: brief', tokens: 21 * M })
    expect(call('a5', 'claude')).toBe('deny')
  })

  it('only counts new lines on later calls', () => {
    agent('a6', { type: 'c-3po', description: 'c-3po: readme [budget 4M]', tokens: 1 * M })
    expect(call('a6', 'c-3po')).toBe('allow')
    expect(call('a6', 'c-3po')).toBe('allow') // the same 1M, not counted twice
    spend('a6', 3.1 * M)
    expect(call('a6', 'c-3po')).toBe('deny')
  })
})

describe('follow-ups', () => {
  it('takes a SendMessage tag as the new total', () => {
    agent('s1', { type: 'chris-de-kok', description: 'chris-de-kok: step 1 [budget 12M]', tokens: 13 * M })
    expect(call('s1', 'chris-de-kok')).toBe('deny')
    const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Step 2: Hank. [budget 30M]' }] } }
    appendFileSync(join(subDir, 'agent-s1.jsonl'), JSON.stringify(msg) + '\n')
    expect(call('s1', 'chris-de-kok')).toBe('allow')
  })
})

describe('exemptions', () => {
  it('only logs for ranjit', () => {
    agent('r1', { type: 'ranjit', description: 'ranjit: deploy [budget 1M]', tokens: 9 * M })
    expect(call('r1', 'ranjit')).toBe('allow')
    expect(logs.join('\n')).toMatch(/ranjit over budget/)
  })

  it('warns the-playbook at 100% and stops it at 150%', () => {
    agent('p1', { type: 'the-playbook', description: 'the-playbook: 0046 [budget 10M]', tokens: 12 * M })
    expect(call('p1', 'the-playbook')).toBe('note')
    spend('p1', 3 * M)
    expect(call('p1', 'the-playbook')).toBe('deny')
  })
})

describe('screenshots', () => {
  it('caps bengt-johansson at 5, counting batches and zooms', () => {
    agent('q1', { type: 'bengt-johansson', description: 'bengt-johansson: polls [budget 12M]', tokens: 1 * M, shots: 4 })
    const shot = { action: 'screenshot' }
    expect(call('q1', 'bengt-johansson', 'mcp__Claude_Browser__computer', shot)).toBe('allow')
    spend('q1', 0, 1)
    expect(call('q1', 'bengt-johansson', 'mcp__Claude_Browser__computer', { action: 'zoom' })).toBe('deny')
    const batch = { actions: [{ name: 'computer', input: shot }] }
    expect(call('q1', 'bengt-johansson', 'mcp__Claude_Browser__browser_batch', batch)).toBe('deny')
    // Text checks still go through.
    expect(call('q1', 'bengt-johansson', 'mcp__Claude_Browser__get_page_text', {})).toBe('allow')
  })

  // Frame shots: tiny screenshots taken only so `scroll` has coordinates.
  const frameShot = (scale = 0.2) => ({ type: 'tool_use', name: 'mcp__Claude_Browser__computer', input: { action: 'screenshot', scale } })
  function spendFrames(id, n) {
    const entry = { type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, content: Array.from({ length: n }, () => frameShot()) } }
    appendFileSync(join(subDir, `agent-${id}.jsonl`), JSON.stringify(entry) + '\n')
  }
  function decideFor(id, type, tool, toolInput) {
    return decide({ session_id: SESSION, transcript_path: join(root, `${SESSION}.jsonl`), agent_id: id, agent_type: type, tool_name: tool, tool_input: toolInput }, { stateDir, log: () => {} })
  }

  it("doesn't count a frame shot (scale ≤ 0.25) toward the cap", () => {
    agent('f2', { type: 'bengt-johansson', description: 'bengt-johansson: wheel [budget 12M]', tokens: 1 * M, shots: 5 })
    spendFrames('f2', 6)
    expect(call('f2', 'bengt-johansson', 'mcp__Claude_Browser__computer', { action: 'screenshot', scale: 0.2 })).toBe('allow')
    expect(call('f2', 'bengt-johansson', 'mcp__Claude_Browser__computer', { action: 'screenshot', scale: 0.25 })).toBe('allow')
    expect(call('f2', 'bengt-johansson', 'mcp__Claude_Browser__browser_batch', { actions: [{ name: 'computer', input: { action: 'screenshot', scale: 0.1 } }, { name: 'computer', input: { action: 'scroll' } }] })).toBe('allow')
    // A larger scale, no scale, or a zoom still counts.
    expect(call('f2', 'bengt-johansson', 'mcp__Claude_Browser__computer', { action: 'screenshot', scale: 0.3 })).toBe('deny')
    expect(call('f2', 'bengt-johansson', 'mcp__Claude_Browser__computer', { action: 'zoom', scale: 0.2 })).toBe('deny')
    const r = decideFor('f2', 'bengt-johansson', 'mcp__Claude_Browser__computer', { action: 'screenshot' })
    expect(r.reason).toMatch(/Screenshot cap reached: 5 of 5 full-size/)
    expect(r.reason).toMatch(/Text and geometry checks still work/)
  })

  it('stops the 13th frame shot', () => {
    agent('f3', { type: 'tomas-svensson', description: 'tomas-svensson: wheel', tokens: 1 * M })
    spendFrames('f3', 12)
    const r = decideFor('f3', 'tomas-svensson', 'mcp__Claude_Browser__computer', { action: 'screenshot', scale: 0.2 })
    expect(r).toMatchObject({ decision: 'deny' })
    expect(r.reason).toMatch(/Frame-shot cap reached: 12 of 12/)
    expect(r.reason).toMatch(/Text and geometry checks still work/)
    // Full-size shots are a separate count and still go through.
    expect(call('f3', 'tomas-svensson', 'mcp__Claude_Browser__computer', { action: 'screenshot' })).toBe('allow')
  })

  it('leaves the builders uncapped', () => {
    agent('f4', { type: 'chris-de-kok', description: 'chris-de-kok: step', tokens: 1 * M, shots: 20 })
    spendFrames('f4', 20)
    expect(call('f4', 'chris-de-kok', 'mcp__Claude_Browser__computer', { action: 'screenshot', scale: 0.2 })).toBe('allow')
    expect(call('f4', 'chris-de-kok', 'mcp__Claude_Browser__computer', { action: 'screenshot' })).toBe('allow')
  })
})

describe('fallback', () => {
  it('estimates from calls when the transcript is missing, and logs it', () => {
    agent('f1', { type: 'lorenzo-von-matterhorn', description: 'lorenzo-von-matterhorn: x [budget 100k]', transcript: false })
    expect(call('f1', 'lorenzo-von-matterhorn')).toBe('allow') // 40k of 100k
    expect(call('f1', 'lorenzo-von-matterhorn')).toBe('note') // 80k
    expect(call('f1', 'lorenzo-von-matterhorn')).toBe('deny') // 120k
    expect(logs.join('\n')).toMatch(/no transcript/)
  })
})

describe('the navigator', () => {
  const navFile = () => join(root, `${SESSION}.jsonl`)
  // One assistant turn: `tokens` of usage as context, optionally calling a tool.
  function navTurn(tokens, tool) {
    const content = tool ? [{ type: 'tool_use', id: tool.id, name: tool.name, input: tool.input }] : []
    const entry = { type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content } }
    appendFileSync(navFile(), JSON.stringify(entry) + '\n')
  }
  function navResult(id, chars) {
    const entry = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(chars) }] } }
    appendFileSync(navFile(), JSON.stringify(entry) + '\n')
  }
  function nav(tool = 'Bash') {
    return decide({ session_id: SESSION, transcript_path: navFile(), tool_name: tool, tool_input: {} }, { stateDir, log: (l) => logs.push(l) })
  }
  beforeEach(() => writeFileSync(navFile(), ''))

  it('says nothing under the marks', () => {
    navTurn(100_000)
    expect(nav()).toBeNull()
  })

  it('warns once at 60M, naming the three biggest reads', () => {
    navTurn(200_000, { id: 't1', name: 'Read', input: { file_path: '/repo/big.md' } })
    navResult('t1', 400_000)
    navTurn(200_000, { id: 't2', name: 'Agent', input: { description: 'yoda: review' } })
    navResult('t2', 40_000)
    navTurn(200_000, { id: 't3', name: 'Bash', input: { command: 'git diff' } })
    navResult('t3', 80_000)
    navTurn(200_000, { id: 't4', name: 'Read', input: { file_path: '/repo/tiny.ts' } })
    navResult('t4', 400)
    for (let i = 0; i < 300; i++) navTurn(200_000)
    const r = nav()
    expect(r).toMatchObject({ decision: 'note' })
    expect(r.reason).toMatch(/60M used/)
    expect(r.reason).toMatch(/Read \/repo\/big\.md \(~100k\); Bash git diff \(~20k\); Agent yoda: review \(~10k\)/)
    expect(r.reason).not.toMatch(/tiny/)
    expect(nav()).toBeNull() // once per session
  })

  it('warns once at 100M', () => {
    for (let i = 0; i < 310; i++) navTurn(200_000)
    expect(nav().reason).toMatch(/60M used/)
    expect(nav()).toBeNull()
    for (let i = 0; i < 200; i++) navTurn(200_000)
    expect(nav().reason).toMatch(/100M used/)
    expect(nav()).toBeNull()
  })

  it("warns once when one call's context passes 250k", () => {
    navTurn(240_000)
    expect(nav()).toBeNull()
    navTurn(260_000)
    expect(nav().reason).toMatch(/context reached 260k/)
    navTurn(270_000)
    expect(nav()).toBeNull()
  })

  it('is never blocked, however far over', () => {
    for (let i = 0; i < 1000; i++) navTurn(249_000)
    for (const tool of ['Bash', 'Agent', 'Edit', 'SendMessage', 'mcp__Claude_Browser__computer']) {
      const r = nav(tool)
      expect(r === null || r.decision === 'note').toBe(true)
    }
  })

  it('fails quiet without a transcript', () => {
    expect(watchNavigator({ session_id: SESSION, transcript_path: join(root, 'missing.jsonl'), tool_name: 'Bash' }, { stateDir })).toBeNull()
  })
})

describe('the 2.12.2 roster', () => {
  function withModel(id, type, model, tokens, shots = 0) {
    agent(id, { type, description: `${type}: x` })
    const content = Array.from({ length: shots }, () => ({ type: 'tool_use', name: 'mcp__Claude_Browser__computer', input: { action: 'screenshot' } }))
    const entry = { type: 'assistant', message: { model, usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content } }
    appendFileSync(join(subDir, `agent-${id}.jsonl`), JSON.stringify(entry) + '\n')
  }
  const shot = { action: 'screenshot' }

  it('gives mosbius-designs 8M and 6 screenshots on Opus', () => {
    withModel('m1', 'mosbius-designs', 'claude-opus-5', 8.1 * M)
    expect(call('m1', 'mosbius-designs')).toBe('deny')
    withModel('m2', 'mosbius-designs', 'claude-opus-5', 1 * M, 6)
    expect(call('m2', 'mosbius-designs', 'mcp__Claude_Browser__computer', shot)).toBe('deny')
    withModel('m3', 'mosbius-designs', 'claude-opus-5', 1 * M, 5)
    expect(call('m3', 'mosbius-designs', 'mcp__Claude_Browser__computer', shot)).toBe('allow')
  })

  it('gives mosbius-designs 12M and 10 screenshots on Fable', () => {
    withModel('m4', 'mosbius-designs', 'claude-fable-5', 8.1 * M)
    expect(call('m4', 'mosbius-designs')).toBe('allow')
    withModel('m5', 'mosbius-designs', 'claude-fable-5', 12.1 * M)
    expect(call('m5', 'mosbius-designs')).toBe('deny')
    withModel('m6', 'mosbius-designs', 'claude-fable-5', 1 * M, 9)
    expect(call('m6', 'mosbius-designs', 'mcp__Claude_Browser__computer', shot)).toBe('allow')
    withModel('m7', 'mosbius-designs', 'claude-fable-5', 1 * M, 10)
    expect(call('m7', 'mosbius-designs', 'mcp__Claude_Browser__computer', shot)).toBe('deny')
  })

  it("gives the QA pool bengt-johansson's 14M and 5 screenshots", () => {
    for (const name of ['tomas-svensson', 'magnus-wislander', 'staffan-olsson', 'stefan-lovgren']) {
      withModel(`a-${name}`, name, 'claude-opus-5', 13 * M)
      expect(call(`a-${name}`, name)).not.toBe('deny')
      withModel(`b-${name}`, name, 'claude-opus-5', 14.1 * M)
      expect(call(`b-${name}`, name)).toBe('deny')
      withModel(`c-${name}`, name, 'claude-opus-5', 1 * M, 4)
      expect(call(`c-${name}`, name, 'mcp__Claude_Browser__computer', shot)).toBe('allow')
      withModel(`d-${name}`, name, 'claude-opus-5', 1 * M, 5)
      expect(call(`d-${name}`, name, 'mcp__Claude_Browser__computer', shot)).toBe('deny')
    }
  })

  it('gives the new roles their defaults, also when named by description prefix', () => {
    for (const [name, budget] of [['daredevil', 3], ['mike-ehrmantraut', 30], ['three-eyed-raven', 8]]) {
      agent(`u-${name}`, { type: 'claude', description: `${name}: x`, tokens: (budget - 0.1) * M })
      expect(call(`u-${name}`, 'claude')).not.toBe('deny')
      agent(`o-${name}`, { type: 'claude', description: `${name}: x`, tokens: (budget + 0.1) * M })
      expect(call(`o-${name}`, 'claude')).toBe('deny')
    }
  })
})

describe('counting each message once (2.14.6)', () => {
  // One message as Claude Code writes it: a line per content block, each with
  // the message's whole usage.
  const line = (id, tokens, block) =>
    JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5', usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content: [block] } }) + '\n'
  const thinking = { type: 'thinking', thinking: '…' }
  const tool = { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }

  it('counts a message written as two lines across two calls once', () => {
    agent('m1', { type: 'saul-goodman', description: 'saul-goodman: step [budget 10M]' })
    appendFileSync(join(subDir, 'agent-m1.jsonl'), line('msg_1', 6 * M, thinking))
    expect(call('m1', 'saul-goodman')).toBe('allow')
    appendFileSync(join(subDir, 'agent-m1.jsonl'), line('msg_1', 6 * M, tool))
    expect(call('m1', 'saul-goodman')).toBe('allow') // 6M, not 12M
  })

  it('does the same for the navigator', () => {
    const nav = join(root, `${SESSION}.jsonl`)
    writeFileSync(nav, line('msg_n', 70 * M, thinking))
    const input = { session_id: SESSION, transcript_path: nav, tool_name: 'Bash', tool_input: {} }
    expect(watchNavigator(input, { stateDir }).reason).toMatch(/60M used/)
    appendFileSync(nav, line('msg_n', 70 * M, tool))
    expect(watchNavigator(input, { stateDir })).toBeNull() // 70M, so no 100M note
  })

  it('fed one line at a time, matches tallyEntries on the whole transcript', () => {
    agent('m2', { type: 'saul-goodman', description: 'saul-goodman: step [budget 100000M]' })
    const file = join(subDir, 'agent-m2.jsonl')
    let text = ''
    for (let i = 0; i < 300; i++) {
      const blocks = 1 + (i % 4)
      for (let b = 0; b < blocks; b++) text += line(`msg_${i}`, 1000 + i, b === blocks - 1 ? tool : thinking)
      text += JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } }) + '\n'
    }
    for (const l of text.split('\n').filter(Boolean)) {
      appendFileSync(file, l + '\n')
      call('m2', 'saul-goodman')
    }
    const whole = [...tallyEntries(text.split('\n').filter(Boolean).map((l) => JSON.parse(l))).values()].reduce((s, b) => s + totalTokens(b), 0)
    const hank = JSON.parse(readFileSync(join(stateDir, 'm2.json'), 'utf8')).tokens
    expect(Math.abs(hank - whole) / whole).toBeLessThan(0.01)
    expect(hank).toBe(whole)
  })
})

describe('kit.json budgets (2.14.6)', () => {
  const kit = (budgets) => {
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude', 'kit.json'), typeof budgets === 'string' ? budgets : JSON.stringify({ budgets }))
  }

  it("uses the kit's own entry for a role", () => {
    kit({ 'chris-de-kok': '5M', '*': '15M' })
    agent('k1', { type: 'chris-de-kok', description: 'chris-de-kok: step', tokens: 6 * M })
    expect(call('k1', 'chris-de-kok')).toBe('deny')
  })

  it('uses "*" for a role the kit leaves out', () => {
    kit({ '*': '3M' })
    agent('k2', { type: 'jesse-pinkman', description: 'jesse-pinkman: x', tokens: 4 * M })
    expect(call('k2', 'jesse-pinkman')).toBe('deny')
  })

  it('lets the [budget …] tag win over the kit', () => {
    kit({ 'chris-de-kok': '5M' })
    agent('k3', { type: 'chris-de-kok', description: 'chris-de-kok: step [budget 20M]', tokens: 6 * M })
    expect(call('k3', 'chris-de-kok')).toBe('allow')
  })

  it("keeps mosbius-designs' model numbers over the kit's \"*\"", () => {
    kit({ '*': '30M' })
    agent('k4', { type: 'mosbius-designs', description: 'mosbius-designs: x', tokens: 9 * M })
    expect(call('k4', 'mosbius-designs')).toBe('deny') // Opus 8M, not 30M
  })

  it('falls back to the built-in table when the kit is missing, logging it once', () => {
    agent('k5', { type: 'chris-de-kok', description: 'chris-de-kok: step', tokens: 24 * M })
    expect(call('k5', 'chris-de-kok')).toBe('note') // 24M of the built-in 25M
    spend('k5', 1.1 * M)
    expect(call('k5', 'chris-de-kok')).toBe('deny')
    expect(logs.filter((l) => /no kit/.test(l))).toHaveLength(1)
  })

  it('falls back when the kit is malformed, with a log line', () => {
    kit('{ "budgets": ')
    agent('k6', { type: 'chris-de-kok', description: 'chris-de-kok: step', tokens: 26 * M })
    expect(call('k6', 'chris-de-kok')).toBe('deny') // the built-in 25M
    expect(logs.join('\n')).toMatch(/no readable budgets/)
  })

  it('ignores a value above 100M, with a log line', () => {
    kit({ 'chris-de-kok': '500M' })
    agent('k7', { type: 'chris-de-kok', description: 'chris-de-kok: step', tokens: 26 * M })
    expect(call('k7', 'chris-de-kok')).toBe('deny')
    expect(logs.join('\n')).toMatch(/above the 100M ceiling/)
  })

  it('reads "25M", "800k" and plain numbers, and sets aside the rest', () => {
    const notes = []
    mkdirSync(join(root, '.claude'), { recursive: true })
    const file = join(root, '.claude', 'kit.json')
    writeFileSync(file, JSON.stringify({ budgets: { a: '25M', b: '800k', c: 3_000_000, d: 'lots', e: -1, f: '0M', g: 0 } }))
    expect(kitBudgets(file, notes)).toEqual({ a: 25 * M, b: 800_000, c: 3 * M })
    expect(notes).toHaveLength(4)
  })

  it('sets aside a zero budget and falls back', () => {
    kit({ 'chris-de-kok': '0M' })
    agent('k8', { type: 'chris-de-kok', description: 'chris-de-kok: step', tokens: 1 * M })
    expect(call('k8', 'chris-de-kok')).toBe('allow') // the built-in 25M, not 0
    expect(call('k8', 'chris-de-kok')).toBe('allow')
    expect(logs.join('\n')).toMatch(/chris-de-kok unreadable/)
  })

  it("mirrors the built-in table in the repo's .claude/kit.json", () => {
    const repoKit = fileURLToPath(new URL('../kit.json', import.meta.url))
    if (!existsSync(repoKit)) return // the proto has no kit beside it
    const budgets = kitBudgets(repoKit)
    const { '*': rest, ...named } = budgets
    expect(named).toEqual(DEFAULT_BUDGETS)
    expect(rest).toBe(15 * M)
  })
})
