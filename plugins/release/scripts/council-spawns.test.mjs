import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countSpawns, spawnRole, spawnTally, spawnsTable } from './council-spawns.mjs'

const spawn = (id, input, name = 'Agent') => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } })
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('spawnRole', () => {
  it('drops the plugin prefix and names a generic spawn by its description', () => {
    expect(spawnRole({ subagent_type: 'release:r2-d2' })).toBe('r2-d2')
    expect(spawnRole({ subagent_type: 'general-purpose', description: 'c-3po: skills-lens core' })).toBe('c-3po')
    expect(spawnRole({ description: 'look at the lens' })).toBe('general-purpose')
    expect(spawnRole()).toBe('general-purpose')
  })
})

describe('countSpawns', () => {
  it('counts Agent and Task calls by role and model, a repeated line once', () => {
    const entries = [
      spawn('a', { subagent_type: 'release:mace-windu', model: 'opus' }),
      spawn('a', { subagent_type: 'release:mace-windu', model: 'opus' }),
      spawn('b', { subagent_type: 'release:mace-windu' }, 'Task'),
      spawn('c', { description: 'c-3po: skills-lens design', model: 'sonnet' }),
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'd', name: 'Read', input: {} }] } },
    ]
    const tally = countSpawns(entries)
    expect(Object.fromEntries(tally)).toEqual({ 'mace-windu / opus': 1, 'mace-windu / (frontmatter)': 1, 'c-3po / sonnet': 1 })
  })
})

describe('spawnTally and spawnsTable', () => {
  it('adds the subagents\' own spawns and sorts most first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-spawns-'))
    writeFileSync(join(dir, 's1.jsonl'), jsonl([spawn('a', { description: 'c-3po: lens', model: 'sonnet' }), spawn('b', { description: 'c-3po: lens', model: 'sonnet' })]))
    mkdirSync(join(dir, 's1', 'subagents'), { recursive: true })
    writeFileSync(join(dir, 's1', 'subagents', 'agent-x.jsonl'), jsonl([spawn('c', { subagent_type: 'release:r2-d2', model: 'haiku' })]))
    const table = spawnsTable(spawnTally([dir], 0))
    expect(table.split('\n')).toEqual(['| Role | Model asked | Spawns |', '|---|---|---|', '| c-3po | sonnet | 2 |', '| r2-d2 | haiku | 1 |', '| **Total** | | 3 |'])
  })
})
