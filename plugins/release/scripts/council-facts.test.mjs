import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anchorsOf, buildFacts, closingTable, gitRange, kitFiles, learningChanges, learningSection, permissionSection, staleRefs } from './council-facts.mjs'
import { projectDirs, transcriptKey } from './council-skills.mjs'

const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 }
const asst = (id, block, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-x', usage, content: [block] } })
const prompt = (text, ts) => ({ type: 'user', timestamp: ts, message: { content: text } })
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const put = (path, text) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

// A tiny kit, one project with a session in its own folder and one in a worktree's.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'council-facts-'))
  const kitRoot = join(root, 'kit')
  const kit = join(kitRoot, 'plugins')
  put(join(kit, 'core', 'norms.md'), '# Norms\n\n## Starting sessions\n\n- **The deploy leg:** parked.\n')
  put(join(kit, 'release', 'skills', 'jedi', 'SKILL.md'), '---\nname: jedi\ndescription: The review.\n---\nSee `norms.md`, "Starting sessions" and `norms.md`\'s "The deploy leg".\nAlso `norms.md`, "Gone section" and `other.md`, "Elsewhere".\nThen /special-delivery.\nNext: the wrap.\n')
  put(join(kit, 'core', 'lessons.md'), '- /special-delivery was folded.\n')
  const repo = join(root, 'repo')
  put(join(repo, '.claude', 'permission-denied.log'), ['2026-10-01T00:00:00Z\tmain\tBash\told', '2026-10-17T10:00:00Z\tmain\tBash\tx', '2026-10-17T10:01:00Z\tr2-d2\tWrite\ty'].join('\n') + '\n')
  const transcripts = join(root, 'projects')
  const key = transcriptKey(repo)
  put(join(transcripts, key, 's1.jsonl'), jsonl([
    prompt('<command-name>/jedi</command-name>', '2026-10-17T10:00:00Z'),
    asst('n1', { type: 'tool_use', id: 'sp1', name: 'Agent', input: { description: 'c-3po: skills-lens core', model: 'sonnet' } }, '2026-10-17T10:00:10Z'),
  ]))
  put(join(transcripts, `${key}--claude-worktrees-lane`, 's2.jsonl'), jsonl([
    { type: 'custom-title', customTitle: 'kit · lane · b2' },
    asst('n2', { type: 'tool_use', id: 'st1', name: 'mcp__ccd_session__start_session', input: { initiation: 'user_asked' } }, '2026-10-17T11:00:00Z'),
  ]))
  put(join(transcripts, `${key}-other`, 's3.jsonl'), jsonl([prompt('not this repo', '2026-10-17T12:00:00Z')]))
  return { root, kitRoot, kit, repo, transcripts, key }
}

describe('projectDirs', () => {
  it('finds the repo\'s folder and its worktrees\' folders, not a lookalike', () => {
    const f = fixture()
    expect(projectDirs(f.transcripts, f.repo).map((d) => d.slice(f.transcripts.length + 1))).toEqual([f.key, `${f.key}--claude-worktrees-lane`])
    expect(projectDirs(join(f.root, 'nowhere'), f.repo)).toEqual([])
  })
})

describe('gitRange', () => {
  it('lists the commits and the diff stat', () => {
    const run = (args) => (args.includes('log') ? 'abc123 One\ndef456 Two\n' : ' 3 files changed, 10 insertions(+)\n')
    const text = gitRange('/r', 'ccf8c0c', run)
    expect(text).toContain('2 commits (merges left out) from `ccf8c0c`')
    expect(text).toContain('3 files changed')
    expect(text).toContain('- def456 Two')
  })
  it('says so when not asked or when git fails', () => {
    expect(gitRange(null, null)).toMatch(/^Not asked/)
    expect(gitRange('/r', 'x', () => { throw Object.assign(new Error('bad'), { stderr: 'fatal: bad revision\nmore' }) })).toBe('git failed: fatal: bad revision')
  })
})

describe('permissionSection', () => {
  it('counts each source in the window and says "all classifier" with no guard log', () => {
    const f = fixture()
    const text = permissionSection({ repo: f.repo }, Date.parse('2026-10-10'))
    expect(text).toContain('### repo (all classifier')
    expect(text).toContain('| classifier | .claude/permission-denied.log | 2 | Bash 1, Write 1 |')
    expect(text).toContain('| guard | .claude/guard-decisions.log | no log | – |')
  })
  it('drops the note once a guard log exists', () => {
    const f = fixture()
    put(join(f.repo, '.claude', 'guard-decisions.log'), '2026-10-17T10:00:00Z\tmain\tBash\tdeny\n')
    const text = permissionSection({ repo: f.repo }, Date.parse('2026-10-10'))
    expect(text).toContain('### repo\n')
    expect(text).toContain('| guard | .claude/guard-decisions.log | 1 | Bash 1 |')
  })
})

describe('staleRefs', () => {
  it('reads headings and bold leads as anchors', () => {
    expect(anchorsOf('## Starting sessions\n- **The deploy leg:** x')).toEqual(['starting sessions', 'the deploy leg'])
  })
  it('flags retired names outside history files and cited sections with no anchor', () => {
    const f = fixture()
    const r = staleRefs(kitFiles(f.kitRoot), f.kitRoot, ['special-delivery'])
    expect(r.retiredHits).toEqual(['plugins/release/skills/jedi/SKILL.md:7 (special-delivery)'])
    expect(r.cites).toBe(4)
    expect(r.outside).toBe(1)
    expect(r.missing).toEqual(['plugins/release/skills/jedi/SKILL.md:6 `norms.md` "Gone section"'])
  })
})

describe('learningChanges (F20)', () => {
  it('lists each lessons and taste commit on every branch and counts sendbacks once each', () => {
    const asked = []
    const run = (args) => {
      asked.push(args.join(' '))
      if (args.includes('--numstat')) return '@@abc123|2026-10-30|origin/wrap-1.2|Lessons from 1.2\n\n3\t1\t.claude/lessons.md\n2\t0\t.claude/taste.md\n@@def456|2026-10-31||Taste fix\n\n1\t0\t.claude/taste.md\n'
      return '+++ b/.claude/taste.md\n+- Buttons stay round (Alexander, 1.2 sendback)\n+- no source here\n+- Buttons stay round (Alexander, 1.2 sendback)\n+- Cards breathe (bengt, 1.2)\n'
    }
    const r = learningChanges('/r', '2026-10-10', run)
    expect(asked[0]).toContain('log --all --since=2026-10-10')
    expect(r.sendbacks).toBe(2)
    expect(r.commits[0]).toEqual({ sha: 'abc123', date: '2026-10-30', refs: 'origin/wrap-1.2', subject: 'Lessons from 1.2', files: ['lessons.md +3 -1', 'taste.md +2 -0'] })
    const s = learningSection({ burrow: '/r' }, '2026-10-10', run)
    expect(s).toContain('### burrow: 2 commits, 2 sendbacks added to taste')
    expect(s).toContain('- 2026-10-31 `def456` Taste fix: taste.md +1 -0')
  })
})

describe('buildFacts', () => {
  it('writes every section in order and reads the worktree\'s transcripts', () => {
    const f = fixture()
    const o = { since: '2026-10-10', kit: f.kit, transcripts: f.transcripts, projects: { repo: f.repo }, retired: ['special-delivery'], git: null, from: null }
    const { facts, cards } = buildFacts(o)
    const heads = facts.split('\n').filter((l) => l.startsWith('## '))
    expect(heads).toEqual(['## Git range', '## Speed, per project', '## Roles (runs per model)', '## Closing lines (from the cards)', '## Session starts (start_session by initiation)', '## Agent spawns (role and the model the call asked for)', '## Agent spawns, one row each', '## Guard reasons, per agent', '## Questions (AskUserQuestion), per skill and session', '## /one-ring runs', '## Lessons and taste changes', '## Permission logs, by source', '## Stale references'])
    expect(facts).toContain('| s1 | /jedi | jedi |')
    expect(facts).toContain('| s2 | title: kit · lane · b2 |')
    expect(facts).toContain('| c-3po | sonnet | 1 |')
    expect(facts).toContain('| s2 | kit · lane · b2 | 1 | 0 |')
    expect(facts).toContain('| /jedi | release | yes |')
    expect(closingTable(cards)).toContain('| Skill | Plugin | Next: | No timer |')
  })
})
