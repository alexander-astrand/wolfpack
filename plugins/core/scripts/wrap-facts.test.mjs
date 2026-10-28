import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findUsage, locate, reworkCandidates, sessionIds, titleHas, wrapFacts } from './wrap-facts.mjs'

const SID = '0f1e2d3c-1111-4222-8333-944455556666'
const DEPLOY = 'aaaabbbb-1111-4222-8333-944455556666'

// A project with its kit.json pointing at a plans folder, a plan naming the
// release session, and a transcripts folder named the way Claude Code names it.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wrap-facts-'))
  const project = join(root, 'proj')
  const plans = join(root, 'plans')
  const projects = join(root, 'projects')
  mkdirSync(join(project, '.claude'), { recursive: true })
  mkdirSync(plans)
  writeFileSync(join(project, '.claude', 'kit.json'), JSON.stringify({ plans }))
  writeFileSync(join(plans, 'V1.7.md'), `# V1.7\n\n## Build notes\n- release session ${SID}\n`)
  const tdir = join(projects, project.replace(/[^A-Za-z0-9]/g, '-'))
  const sub = join(tdir, SID, 'subagents')
  mkdirSync(sub, { recursive: true })
  const spend = (id, tokens, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-x', usage: { input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 0 }, content: [] } })
  writeFileSync(join(tdir, `${SID}.jsonl`), `${JSON.stringify({ type: 'user', timestamp: '2026-10-24T08:00:00Z', message: { content: '<command-name>/release:captain-call</command-name>' } })}\n${spend('n1', 1_000_000, '2026-10-24T08:01:00Z')}\n`)
  writeFileSync(join(sub, 'agent-x1.meta.json'), JSON.stringify({ agentType: 'release:jeff-winger', description: 'jeff-winger: lane b3b [budget 12M]' }))
  writeFileSync(join(sub, 'agent-x1.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'order' } })}\n${spend('j1', 3_000_000, '2026-10-24T08:10:00Z')}\n`)
  return { project, projects }
}

// gh, faked: the list and one view, as the CLI prints them.
const gh = (calls) => (args) => {
  calls.push(args.join(' '))
  if (args[1] === 'list') {
    return JSON.stringify([
      { number: 41, title: 'Kit 1.7: budgets from one file', state: 'OPEN', isDraft: true, mergeCommit: null, createdAt: '2026-10-24T07:00:00Z', url: 'u41' },
      { number: 40, title: 'Kit 1.7.1 follow-up', state: 'OPEN', isDraft: false, mergeCommit: null, createdAt: '2026-10-24T07:00:00Z', url: 'u40' },
    ])
  }
  return JSON.stringify({
    body: 'Usage below.',
    comments: [{ body: `Deploy usage: session ${DEPLOY}` }],
    commits: [
      { oid: 'aaaaaaa1', messageHeadline: 'Skyler prints the budget table', committedDate: '2026-10-24T08:00:00Z' },
      { oid: 'bbbbbbb2', messageHeadline: 'Fix the review findings in the tower', committedDate: '2026-10-24T12:00:00Z' },
    ],
  })
}

describe('wrap-facts', () => {
  it('matches the version in a title but not a longer one', () => {
    expect(titleHas('Kit 1.7: x', '1.7')).toBe(true)
    expect(titleHas('V1.7 x', '1.7')).toBe(true)
    expect(titleHas('Kit 1.7.1', '1.7')).toBe(false)
    expect(titleHas('Kit 11.7', '1.7')).toBe(false)
  })

  it('finds session ids once each, local ones too', () => {
    expect(sessionIds(`a ${SID} b ${SID}`, `local_${DEPLOY}`)).toEqual([SID, `local_${DEPLOY}`])
  })

  it('counts only fix commits after the draft as rework', () => {
    const prs = [{ number: 1, commits: [{ oid: 'a', messageHeadline: 'fix it', committedDate: '2026-10-24T06:00:00Z' }, { oid: 'b', messageHeadline: 'Fixes the tower', committedDate: '2026-10-24T09:00:00Z' }, { oid: 'c', messageHeadline: 'New page', committedDate: '2026-10-24T09:00:00Z' }] }]
    expect(reworkCandidates(prs, Date.parse('2026-10-24T08:00:00Z')).map((c) => c.sha)).toEqual(['b'])
  })

  it('finds the release plugin beside it in the repo', () => {
    expect(findUsage()).toMatch(/plugins\/release\/scripts\/usage\.mjs$/)
  })

  it('returns the PRs, sessions, budget table, rework and Skyler lines in one call', async () => {
    const { project, projects } = fixture()
    const calls = []
    const out = await wrapFacts('1.7', { project, gh: gh(calls), projectsDir: projects, resolveLocal: (id) => id })
    expect(calls.every((c) => /^pr (list|view)/.test(c))).toBe(true) // read-only
    expect(out.prs).toEqual([{ number: 41, title: 'Kit 1.7: budgets from one file', state: 'OPEN', isDraft: true, mergeSha: null, url: 'u41' }])
    expect(out.sessions.found.map((s) => s.id)).toEqual([SID])
    expect(out.sessions.missing).toEqual([DEPLOY])
    expect(out.budgetTable.rows).toHaveLength(1)
    expect(out.budgetTable.markdown).toContain('| jeff-winger | lane b3b | 12.0M | 3.0M (25%) | no |')
    expect(out.rework.from).toBe('PR opened')
    expect(out.rework.commits.map((c) => c.sha)).toEqual(['bbbbbbb'])
    expect(out.usage.grandTotal).toBe(4_000_000)
    expect(out.usage.lines.some((l) => l.startsWith('Week:'))).toBe(true)
    expect(out.timeline).toHaveLength(1)
    expect(out.timeline[0]).toMatch(/^Wall-clock 0f1e2d3c/)
    expect(out.missing.join('\n')).toContain(`transcripts for ${DEPLOY}`)
  })

  it("falls back to the last 100 PRs when GitHub's search misses a title like V1.2: Dev HQ (Burrow 1.2)", async () => {
    const { project, projects } = fixture()
    const calls = []
    const pr = { number: 53, title: 'V1.2: Dev HQ, grown up, and Food, revisited', state: 'OPEN', isDraft: true, mergeCommit: null, createdAt: '2026-10-27T07:00:00Z', url: 'u53' }
    const fake = (args) => {
      calls.push(args.join(' '))
      if (args[1] === 'list') return JSON.stringify(args.includes('--search') ? [] : [pr, { ...pr, number: 52, title: 'V1.2.1: a patch' }])
      return JSON.stringify({ body: '', comments: [], commits: [] })
    }
    const out = await wrapFacts('1.2', { project, gh: fake, projectsDir: projects, resolveLocal: (id) => id })
    expect(out.prs.map((p) => p.number)).toEqual([53])
    expect(calls.filter((c) => c.startsWith('pr list'))).toHaveLength(2)
    expect(calls[1]).toMatch(/--limit 100/)
    expect(out.missing.join('\n')).not.toMatch(/a PR whose title/)
  })

  it("finds a session in a sibling worktree's transcript folder when run from a worktree (Burrow 1.2)", () => {
    const root = mkdtempSync(join(tmpdir(), 'wrap-facts-projects-'))
    const tree = join(root, '-Users-a-Desktop-Burrow--claude-worktrees-name-map-000f45')
    mkdirSync(tree)
    writeFileSync(join(tree, `${SID}.jsonl`), '\n')
    const fromWrap = locate([SID], '/Users/a/Desktop/Burrow/.claude/worktrees/wrap-1-2-xyz', root)
    expect(fromWrap.found).toEqual([{ id: SID, dir: tree }])
    expect(locate([SID], '/Users/a/Desktop/Burrow', root).found).toHaveLength(1)
  })

  it('says what is missing when gh fails, instead of failing', async () => {
    const { project, projects } = fixture()
    const out = await wrapFacts('1.7', { project, projectsDir: projects, gh: () => { throw new Error('not logged in') } })
    expect(out.prs).toEqual([])
    expect(out.missing[0]).toMatch(/gh pr list failed: not logged in/)
    expect(out.sessions.found.map((s) => s.id)).toEqual([SID]) // the plan still names it
  })
})
