import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCards, frontList, renderCards, segmentTurns, transcriptKey } from './council-skills.mjs'

const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 }
const asst = (id, block, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-x', usage, content: [block] } })
const prompt = (text, ts) => ({ type: 'user', timestamp: ts, message: { content: text } })
const result = (ts) => ({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', content: 'ok' }] } })
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const put = (path, text) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

// A tiny kit (one skill, two agents), two projects, one session with one agent run.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'council-skills-'))
  const kit = join(root, 'plugins')
  put(join(kit, 'release', 'skills', 'jedi', 'SKILL.md'), '---\nname: jedi\ndescription: The review.\n---\nRead `.claude/only-here.md` and `.claude/both.md`.\n')
  put(join(kit, 'release', 'agents', 'sweeper.md'), '---\nname: sweeper\ndescription: Reads.\ntools: Read, Grep, Glob\nmaxTurns: 2\nskills:\n  - jedi\n---\nRun `node x.mjs` and use ToolSearch.\nYou have no Bash.\n')
  put(join(kit, 'release', 'agents', 'free.md'), '---\nname: free\ndescription: Everything.\n---\nRun `grep -n`.\n')
  const a = join(root, 'repo-a')
  const b = join(root, 'repo-b')
  put(join(a, '.claude', 'only-here.md'), 'x')
  put(join(a, '.claude', 'both.md'), 'x')
  put(join(b, '.claude', 'both.md'), 'x')
  put(join(a, '.claude', 'lessons.md'), '- **[sweeper-rule]** the sweeper reads first.\n')
  const tdir = join(root, 'projects', transcriptKey(a))
  put(join(tdir, 's1.jsonl'), jsonl([prompt('<command-name>/jedi</command-name>', '2026-10-17T10:00:00Z'), asst('n1', { type: 'tool_use', name: 'Agent', input: {} }, '2026-10-17T10:00:10Z')]))
  // the run: two turns, then a SendMessage resume with one more turn
  put(join(tdir, 's1', 'subagents', 'agent-1.jsonl'), jsonl([
    prompt('go', '2026-10-17T10:01:00Z'),
    asst('a1', { type: 'tool_use', name: 'Read', input: {} }, '2026-10-17T10:01:10Z'),
    result('2026-10-17T10:01:20Z'),
    asst('a2', { type: 'text', text: 'Done.\nCheaper next time: paste the greps into the order first.' }, '2026-10-17T10:02:00Z'),
    prompt('one more', '2026-10-17T10:30:00Z'),
    asst('a3', { type: 'text', text: 'Cheaper next time: <one idea>' }, '2026-10-17T10:30:10Z'),
  ]))
  put(join(tdir, 's1', 'subagents', 'agent-1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'sweeper: sweep' }))
  return { kit, projects: { a, b }, transcripts: join(root, 'projects'), since: '2026-10-10' }
}

describe('frontList', () => {
  it('reads inline, bracketed and block lists', () => {
    expect(frontList('---\ntools: Read, Bash\n---\n', 'tools')).toEqual(['Read', 'Bash'])
    expect(frontList('---\nskills: [a, b]\n---\n', 'skills')).toEqual(['a', 'b'])
    expect(frontList('---\nskills:\n  - a\n  - b\n---\n', 'skills')).toEqual(['a', 'b'])
  })
})

describe('segmentTurns', () => {
  it('starts a new segment at each prompt, not at a tool result', () => {
    expect(segmentTurns([prompt('go'), asst('a1', {}), result(), asst('a2', {}), prompt('more'), asst('a3', {})])).toEqual([2, 1])
  })
  it('splits on promptId when the transcript has one', () => {
    const p = (e, promptId) => ({ ...e, promptId })
    expect(segmentTurns([p(prompt('go'), 'x'), p(asst('a1', {}), 'x'), p(result(), 'y'), p(asst('a2', {}), 'y')])).toEqual([1, 1])
  })
})

describe('the cards on a tiny fixture', () => {
  const opts = fixture()
  const r = buildCards(opts)
  const { cards, cheaper } = renderCards(r, opts)

  it('counts the start command, the preload and the agent run', () => {
    expect(cards).toContain('- runs: 1 sessions started with it')
    expect(cards).toMatch(/preloaded by .*: sweeper \(1 runs\)/)
    expect(cards).toContain('- runs: 1 (')
  })

  it('tells a resume from a cap stop', () => {
    expect(cards).toContain('- cap stops: 1 of 1 (a s1 2 turns); resumed runs: 1')
  })

  it('flags tools the body names but the tools line lacks, and skips a negated line', () => {
    expect(cards).toContain('- tools named but not granted: ToolSearch (line 9), `node` (line 9, needs Bash)')
    // free has no tools: line, so it has every tool
    expect(cards.split('### agent free')[1].split('###')[0]).not.toContain('tools named but not granted')
  })

  it('flags a path that exists in one project only', () => {
    expect(cards).toContain('- paths in one project only: `.claude/only-here.md` (a)')
    expect(cards).not.toContain('`.claude/both.md` (')
  })

  it('collects real cheaper lines and the lessons that cite an agent', () => {
    expect(cards).toContain('a s1: paste the greps into the order first.')
    expect(cheaper).not.toContain('<one idea>')
    expect(cards).toMatch(/lessons citing it: 1: .*\[sweeper-rule\]/)
  })
})
