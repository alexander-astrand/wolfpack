import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCards, closingLines, frontList, ghPrBodies, renderCards, segmentTurns, transcriptKey } from './council-skills.mjs'

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

describe('ghPrBodies', () => {
  it('asks gh for the window\'s PRs from the repo folder, and gives none with a note when gh fails', () => {
    let seen
    const ok = ghPrBodies('/r/x', '2026-10-10', (cmd, args, opts) => {
      seen = [cmd, args.join(' '), opts.cwd]
      return '[{"number":1,"body":"b"}]'
    })
    expect(seen).toEqual(['gh', 'pr list --state all --limit 200 --search created:>=2026-10-10 --json number,body', '/r/x'])
    expect(ok.prs).toEqual([{ number: 1, body: 'b' }])
    const bad = ghPrBodies('/r/x', '2026-10-10', () => {
      throw Object.assign(new Error('x'), { stderr: 'not logged in\nmore' })
    })
    expect(bad).toEqual({ prs: [], note: 'gh failed in x: not logged in' })
  })
})

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

  it('shows the closing-lines table: jedi has no Next: and no no-timer line', () => {
    expect(cards).toContain('| /jedi | release | no | no |')
    expect(closingLines('End on `Next: x`. Keep no timer.')).toEqual({ next: true, noTimer: true })
  })

  it('counts a session keyed as the speed table keys it: a later command in brackets lands on its card, a titled brief on none', () => {
    const o = fixture()
    const tdir = join(o.transcripts, transcriptKey(o.projects.a))
    put(join(tdir, 's2.jsonl'), jsonl([prompt('please review', '2026-10-17T11:00:00Z'), { type: 'user', timestamp: '2026-10-17T11:00:05Z', message: { content: '<command-name>/release:jedi</command-name>' } }, asst('n2', { type: 'text', text: 'ok' }, '2026-10-17T11:00:10Z')]))
    put(join(tdir, 's3.jsonl'), jsonl([prompt('a brief', '2026-10-17T12:00:00Z'), { type: 'custom-title', customTitle: 'a · build · x' }, asst('n3', { type: 'text', text: 'ok' }, '2026-10-17T12:00:10Z')]))
    const out = renderCards(buildCards(o), o).cards
    expect(out).toContain('- runs: 2 sessions started with it')
    expect(out).toContain('Sessions started with no command: 1 labelled by their title')
  })

  it('reads the parents\' Agent results and the window\'s PR bodies too (H3)', () => {
    const o = fixture()
    const tdir = join(o.transcripts, transcriptKey(o.projects.a))
    put(join(tdir, 's4.jsonl'), jsonl([
      prompt('go', '2026-10-17T13:00:00Z'),
      asst('n4', { type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'free', description: 'free: step 1' } }, '2026-10-17T13:00:05Z'),
      { type: 'user', timestamp: '2026-10-17T13:10:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'sha abc\nCheaper next time: name the shared parts in the order.' }] }] } },
    ]))
    const calls = []
    const prBodies = (repo, since) => {
      calls.push(since)
      return repo === o.projects.a
        ? { prs: [{ number: 7, body: '## Notes for review\n\n- `order` sweeper: list the lane CLI once.\n- plain note\n\nCheaper next time: run the probe before the order.' }], note: null }
        : { prs: [], note: 'gh failed in repo-b: offline' }
    }
    const r = buildCards({ ...o, prBodies })
    const { cards, cheaper } = renderCards(r, o)
    expect(calls).toEqual(['2026-10-10', '2026-10-10'])
    expect(cards.split('### agent free')[1]).toContain('a s4: name the shared parts in the order.')
    expect(cheaper).toContain('a #7: `order` sweeper: list the lane CLI once.')
    expect(cheaper).toContain('## PR bodies, no agent named')
    expect(cheaper).toContain('a #7: run the probe before the order.')
    expect(cheaper).not.toContain('plain note')
    expect(cheaper).toMatch(/transcripts \(1\), the parents' Agent results not already there \(1\), and the window's PR bodies \(2;/)
    expect(cheaper).toContain('gh failed in repo-b: offline')
  })

  it('collects real cheaper lines and the lessons that cite an agent', () => {
    expect(cards).toContain('a s1: paste the greps into the order first.')
    expect(cheaper).not.toContain('<one idea>')
    expect(cards).toMatch(/lessons citing it: 1: .*\[sweeper-rule\]/)
  })
})
