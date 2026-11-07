import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findUsage, locate, notInThisRelease, reworkCandidates, sessionIds, stepSpend, titleHas, wrapFacts } from './wrap-facts.mjs'

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
    expect(sessionIds(`session ${SID} b ${SID}`, `local_${DEPLOY}`)).toEqual([SID, `local_${DEPLOY}`])
  })

  it("skips a uuid the plan quotes as something else, such as the Vercel connector's (kit 1.9 wrap)", () => {
    const plan = 'Pollux\'s desktop uuid `3be6532e-019b-4c2b-89d9-df0479a0419f` goes in the fixture'
    expect(sessionIds(plan, `- release session ${SID}`)).toEqual([SID])
  })

  it('adds the transcripts titled "<project> · <kind> · <version>", from a lane outside the repo (kit 1.9 wrap)', async () => {
    const { project, projects } = fixture()
    const main = join(projects, '..', 'main')
    const titled = join(projects, main.replace(/[^A-Za-z0-9]/g, '-'))
    mkdirSync(titled)
    const REL = '0ee31d09-f681-45a7-b56c-d34bf210dbf0'
    writeFileSync(join(titled, `${REL}.jsonl`), `${JSON.stringify({ type: 'custom-title', customTitle: 'wolfpack · release · kit-1.7', sessionId: REL })}\n`)
    writeFileSync(join(titled, 'ffff0000-1111-4222-8333-944455556666.jsonl'), `${JSON.stringify({ type: 'custom-title', customTitle: 'wolfpack · release · kit-1.7.1' })}\n`)
    const git = () => `${main}/.git\n`
    const out = await wrapFacts('kit-1.7', { project, gh: gh([]), projectsDir: projects, git, resolveLocal: (id) => id })
    expect(out.sessions.found.map((s) => s.id)).toEqual([SID, REL])
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

  it('finds PR #46 "Kit 1.8: ..." by title and reads session ids from the build log (kit 1.8)', async () => {
    const { project, projects } = fixture()
    const plans = join(project, '..', 'plans')
    const BUILD = 'cccc0000-1111-4222-8333-944455556666'
    writeFileSync(join(plans, 'kit-1.8.md'), '# Kit 1.8\n')
    writeFileSync(join(plans, 'kit-1.8-build.md'), `- 10:02 builder session ${BUILD}\n`)
    const fake = (args) => {
      if (args[1] === 'list') return JSON.stringify([{ number: 46, title: 'Kit 1.8: lessons that stick', state: 'OPEN', isDraft: true, mergeCommit: null, createdAt: '2026-11-01T07:00:00Z', url: 'u46' }])
      return JSON.stringify({ body: '', comments: [], commits: [] })
    }
    for (const name of ['1.8', 'Kit 1.8', 'kit-1.8']) {
      const out = await wrapFacts(name, { project, gh: fake, projectsDir: projects, resolveLocal: (id) => id })
      expect(out.prs.map((p) => p.number)).toEqual([46])
      expect(out.sessions.missing).toEqual([BUILD])
    }
  })

  it('copies the plan\'s "Not in this release" section, up to the next heading or the end (kit 1.10 F11)', () => {
    const plan = '# Plan\n\n## Steps\n\n- a\n\n## Not in this release\n\n- **X** → there\n- **Y** → here\n\n## Notes\n\nlater\n'
    expect(notInThisRelease(plan)).toBe('- **X** → there\n- **Y** → here')
    expect(notInThisRelease('## Not in this release\n\n- last one\n')).toBe('- last one')
    expect(notInThisRelease('# Plan\n\nnothing\n')).toBe('')
  })

  it('prints one spend line per step from the steps log, and a total (kit 1.10 F11)', () => {
    const tsv = 'when\tagent\tstep\tbudget\tused\tstopped\ttag\tcheaper\n' +
      't1\tjesse-pinkman\tB0 test\t2.0M\t0.3M\tno\torder\tx\n' +
      't2\tahmed\tB1a template\t6.0M\t1.1M\tno\torder\ty\n'
    const out = stepSpend(tsv)
    expect(out.lines).toEqual(['B0 test: 0.3M of 2.0M (jesse-pinkman)', 'B1a template: 1.1M of 6.0M (ahmed)'])
    expect(out.total).toBe('Total: 1.4M of 8M')
    expect(stepSpend('').lines).toEqual([])
  })

  it('wrapFacts carries both from the plan and the steps file beside it', async () => {
    const { project, projects } = fixture()
    const plansDir = join(project, 'plans')
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(project, '.claude', 'kit.json'), JSON.stringify({ plans: plansDir }))
    writeFileSync(join(plansDir, 'V1.7.md'), `Session ${SID}\n\n## Not in this release\n\n- **Z** → later\n`)
    writeFileSync(join(plansDir, 'V1.7-steps.tsv'), 'when\tagent\tstep\tbudget\tused\tstopped\ttag\tcheaper\nt\tbob\tA1 x\t3.0M\t2.5M\tno\torder\tz\n')
    const out = await wrapFacts('1.7', { project, projectsDir: projects, gh: () => '[]', resolveLocal: (id) => id })
    expect(out.notInRelease).toBe('- **Z** → later')
    expect(out.stepSpend.lines).toEqual(['A1 x: 2.5M of 3.0M (bob)'])
  })

  it('says what is missing when gh fails, instead of failing', async () => {
    const { project, projects } = fixture()
    const out = await wrapFacts('1.7', { project, projectsDir: projects, gh: () => { throw new Error('not logged in') } })
    expect(out.prs).toEqual([])
    expect(out.missing[0]).toMatch(/gh pr list failed: not logged in/)
    expect(out.sessions.found.map((s) => s.id)).toEqual([SID]) // the plan still names it
  })
})
