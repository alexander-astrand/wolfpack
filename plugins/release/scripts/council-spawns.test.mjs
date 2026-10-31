import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countSpawns, spawnRole, spawnRows, spawnRowsTable, spawnTally, spawnsTable } from './council-spawns.mjs'

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

describe('spawnRows and spawnRowsTable (F21)', () => {
  it('gives one row per spawn with its type, model and description, the agent\'s own spawns marked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'council-spawns-rows-'))
    const at = (e, ts) => ({ ...e, timestamp: ts })
    writeFileSync(join(dir, 's1234567890.jsonl'), jsonl([at(spawn('a', { subagent_type: 'release:mace-windu', model: 'fable', description: 'mace: the big one | why' }), '2026-10-20T10:00:00Z'), at(spawn('a', { subagent_type: 'release:mace-windu' }), '2026-10-20T10:00:00Z'), at(spawn('old', {}), '2026-09-01T00:00:00Z')]))
    mkdirSync(join(dir, 's1234567890', 'subagents'), { recursive: true })
    writeFileSync(join(dir, 's1234567890', 'subagents', 'agent-x.jsonl'), jsonl([at(spawn('c', { description: 'c-3po: lens' }), '2026-10-20T11:00:00Z')]))
    const table = spawnRowsTable(spawnRows([dir], Date.parse('2026-10-10')))
    expect(table.split('\n').slice(2)).toEqual(['| s1234567 | 10-20 10:00 | mace-windu | mace-windu | fable | mace: the big one / why |', '| s1234567 (agent) | 10-20 11:00 | c-3po | general-purpose | (frontmatter) | c-3po: lens |'])
  })
})
