import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectOwns } from './step-aside.mjs'

// Hank's half of the step-aside cases; the guard's and denied-log's, and the
// check that both plugins carry the same file, sit in the database plugin.
const hank = { matcher: '.*', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/budget-cap.mjs"' }] }

function project(settings, files = []) {
  const dir = mkdtempSync(join(tmpdir(), 'step-aside-'))
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  if (settings !== null) writeFileSync(join(dir, '.claude', 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings))
  for (const f of files) writeFileSync(join(dir, '.claude', 'hooks', f), '// the project\'s own Hank\n')
  return dir
}

const owns = (projectDir) => projectOwns({ kitName: 'budget-cap.mjs', projectDir })

describe('step-aside: the kit Hank', () => {
  it('steps aside when the project registers its own Hank and the file is there', () => {
    expect(owns(project({ hooks: { PreToolUse: [hank] } }, ['budget-cap.mjs']))).toBe(true)
  })
  it('runs when the registration has no file behind it', () => {
    expect(owns(project({ hooks: { PreToolUse: [hank] } }))).toBe(false)
  })
  it('runs when the file is there but nothing registers it', () => {
    expect(owns(project({ hooks: {} }, ['budget-cap.mjs']))).toBe(false)
  })
  it('runs when settings.json is malformed', () => {
    expect(owns(project('not json', ['budget-cap.mjs']))).toBe(false)
  })
  it('runs with no CLAUDE_PROJECT_DIR', () => {
    expect(owns(undefined)).toBe(false)
  })
  it('runs when the project registers Hank for another event only', () => {
    expect(owns(project({ hooks: { PostToolUse: [hank] } }, ['budget-cap.mjs']))).toBe(false)
  })
})
