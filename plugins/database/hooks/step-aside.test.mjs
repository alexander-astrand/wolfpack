import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { projectOwns } from './step-aside.mjs'

const here = (f) => fileURLToPath(new URL(f, import.meta.url))
const GUARD = here('./guard-entry.mjs')
const DENIED = here('./denied-log.mjs')

// Hutzup's own registrations, as in its frozen .claude/settings.json.
const cmd = (name) => ({ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${name}"` })
const HUTZUP = {
  hooks: {
    PreToolUse: [
      { matcher: 'Bash|Edit|MultiEdit|Write|NotebookEdit|SendMessage|Agent', hooks: [cmd('guard-entry.mjs')] },
      { matcher: 'mcp__.*', hooks: [cmd('guard-entry.mjs')] },
      { matcher: '.*', hooks: [cmd('budget-cap.mjs')] },
    ],
    PermissionDenied: [{ matcher: '.*', hooks: [cmd('denied-log.mjs')] }],
  },
}

/** A temp project: `settings` (an object, a raw string, or null for none) and the hook files it has. */
function project(settings, files = []) {
  const dir = mkdtempSync(join(tmpdir(), 'step-aside-'))
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  if (settings !== null) writeFileSync(join(dir, '.claude', 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings))
  for (const f of files) writeFileSync(join(dir, '.claude', 'hooks', f), '// the project\'s own copy\n')
  return dir
}

const guardOwns = (projectDir) => projectOwns({ kitName: 'guard-entry.mjs', names: ['guard-entry.mjs', 'guard-production.mjs'], projectDir })

// The guard denies an empty stdin (it fails closed), so any output means it ran.
function runGuard(projectDir) {
  const env = { ...process.env }
  delete env.CLAUDE_PROJECT_DIR
  if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir
  return spawnSync(process.execPath, [GUARD], { input: '', env, encoding: 'utf8' })
}

describe('step-aside: the kit guard', () => {
  it('steps aside when the project registers its own guard and the file is there', () => {
    expect(guardOwns(project(HUTZUP, ['guard-entry.mjs']))).toBe(true)
    const run = runGuard(project(HUTZUP, ['guard-entry.mjs']))
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
  })

  it('runs when the registration has no file behind it', () => {
    const dir = project(HUTZUP, [])
    expect(guardOwns(dir)).toBe(false)
    expect(runGuard(dir).stdout).toContain('"permissionDecision":"deny"')
  })

  it('runs when the file is there but nothing registers it', () => {
    const dir = project({ hooks: { PreToolUse: [{ matcher: '.*', hooks: [cmd('budget-cap.mjs')] }] } }, ['guard-entry.mjs'])
    expect(guardOwns(dir)).toBe(false)
    expect(runGuard(dir).stdout).toContain('"permissionDecision":"deny"')
  })

  it('runs when settings.json is malformed or missing', () => {
    for (const dir of [project('{ "hooks": ', ['guard-entry.mjs']), project(null, ['guard-entry.mjs'])]) {
      expect(guardOwns(dir)).toBe(false)
      expect(runGuard(dir).stdout).toContain('"permissionDecision":"deny"')
    }
  })

  it('runs with no CLAUDE_PROJECT_DIR', () => {
    expect(guardOwns(undefined)).toBe(false)
    expect(runGuard(undefined).stdout).toContain('"permissionDecision":"deny"')
  })

  it('runs when the project guards fewer tools than the kit (no mcp__ matcher)', () => {
    const narrow = { hooks: { PreToolUse: [HUTZUP.hooks.PreToolUse[0]] } }
    expect(guardOwns(project(narrow, ['guard-entry.mjs']))).toBe(false)
  })

  it('accepts a catch-all matcher and a guard-production.mjs registration', () => {
    const wide = { hooks: { PreToolUse: [{ matcher: '*', hooks: [cmd('guard-production.mjs')] }] } }
    expect(guardOwns(project(wide, ['guard-production.mjs']))).toBe(true)
    // registered as guard-production.mjs, but only guard-entry.mjs is there
    expect(guardOwns(project(wide, ['guard-entry.mjs']))).toBe(false)
  })

  it('never counts a kit-path registration as the project\'s own', () => {
    const viaPlugin = { hooks: { PreToolUse: HUTZUP.hooks.PreToolUse.map((e) => ({ ...e, hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard-entry.mjs"' }] })) } }
    expect(guardOwns(project(viaPlugin, ['guard-entry.mjs']))).toBe(false)
  })
})

describe('step-aside: the kit denied-log', () => {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: 's', permission_mode: 'auto' })
  const log = (dir) => join(dir, '.claude', 'permission-denied.log')
  const runLog = (dir) => spawnSync(process.execPath, [DENIED], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' })

  it('steps aside when the project logs its own refusals', () => {
    const dir = project(HUTZUP, ['denied-log.mjs'])
    const run = runLog(dir)
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(existsSync(log(dir))).toBe(false)
  })

  it('logs when the project has no copy of its own', () => {
    const dir = project(HUTZUP, [])
    expect(runLog(dir).status).toBe(0)
    expect(readFileSync(log(dir), 'utf8')).toContain('\tBash\t')
  })
})

describe('step-aside: one file in two plugins', () => {
  it('the release plugin carries the same step-aside.mjs', () => {
    expect(readFileSync(here('../../release/hooks/step-aside.mjs'), 'utf8')).toBe(readFileSync(here('./step-aside.mjs'), 'utf8'))
  })
})
