// First: the tests' project and its kit.json (the fixture's values).
import './fixtures/kit-project.mjs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decide } from './guard-production.mjs'
import { SHIPS_ON_MERGE, loadKitConfig } from './production-steps.mjs'

// portfolio V0.1 and V0.3 (15 Oct 2026): Vercel ships main to astrand.xyz and
// there is no database and no ranjit, so `gh pr ready` and `gh pr merge` were
// refused to everyone and Alexander merged by hand. `"production": "on-merge"`
// lets the session mark the PR ready and asks him at a green merge.
const KIT = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/kit.json', import.meta.url)), 'utf8'))
const ON_MERGE = { ci: KIT.ci, production: 'on-merge', refs: { dev: '', prod: '' }, urls: { prod: 'https://astrand.xyz' }, deployer: '' }
const green = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', baseRefName: 'main',
  statusCheckRollup: KIT.ci.jobs.map((name) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' })) }
const at = (command, { pr = green, mode = 'auto', cwd = '/repo' } = {}) => decide(
  { tool_name: 'Bash', tool_input: { command }, cwd, permission_mode: mode },
  { root: '/repo', linkedRef: () => KIT.refs.dev, openPr: () => pr, marker: () => null, chainMarker: () => null, releasePr: () => null, log: () => {}, chainLog: () => {}, readLog: () => '' },
) ?? { decision: 'pass' }

describe('portfolio V0.3: a project its host ships from main merges on a person\'s go', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-on-merge-'))
  const file = join(dir, 'kit.json')
  const load = (kit) => { writeFileSync(file, JSON.stringify(kit)); loadKitConfig(file) }
  beforeAll(() => load(ON_MERGE))
  afterAll(() => { loadKitConfig(); rmSync(dir, { recursive: true, force: true }) })

  it('reads "production": "on-merge" only with a prod url and no prod ref or deployer', () => {
    expect(SHIPS_ON_MERGE).toBe(true)
    for (const kit of [{ ...ON_MERGE, refs: KIT.refs }, { ...ON_MERGE, urls: { prod: '' } }, { ...ON_MERGE, urls: { prod: 'not a url' } }, { ...ON_MERGE, deployer: 'ranjit' }, { ...ON_MERGE, production: 'On-merge' }, { ...ON_MERGE, production: undefined }]) {
      load(kit)
      expect(SHIPS_ON_MERGE, JSON.stringify(kit)).toBe(false)
      expect(at('gh pr merge 3 --squash').decision).toBe('deny')
    }
    load(ON_MERGE)
  })

  it('gh pr ready passes, and a green merge asks, naming the live URL', () => {
    expect(at('gh pr ready 3').decision).toBe('pass')
    const out = at('gh pr merge 3 --squash --delete-branch')
    expect(out.decision).toBe('ask')
    expect(out.reason).toContain('PR #3 into main')
    expect(out.reason).toContain('https://astrand.xyz')
  })

  it('refuses a draft, red, conflicting or closed PR, a merge with no number, --admin, --auto and the API', () => {
    expect(at('gh pr merge 3', { pr: { ...green, isDraft: true } }).reason).toContain('draft')
    expect(at('gh pr merge 3', { pr: { ...green, mergeable: 'CONFLICTING' } }).reason).toContain('CONFLICTING')
    expect(at('gh pr merge 3', { pr: { ...green, statusCheckRollup: [{ ...green.statusCheckRollup[0], conclusion: 'FAILURE' }] } }).reason).toContain('green')
    expect(at('gh pr merge 3', { pr: { ...green, state: 'MERGED' } }).reason).toContain('MERGED')
    for (const cmd of ['gh pr merge', 'gh pr merge 3 --admin', 'gh pr merge 3 --auto', 'gh api -X PUT repos/o/r/pulls/3/merge']) {
      expect(at(cmd).decision, cmd).toBe('deny')
    }
  })

  it('refuses a merge aimed at another repo or checkout, and in bypass mode', () => {
    for (const cmd of ['gh pr merge 5 -R o/r', 'GH_REPO=o/r gh pr merge 5', 'cd ../hutzup && gh pr merge 5']) {
      expect(at(cmd).decision, cmd).toBe('deny')
    }
    expect(at('gh pr merge 3', { mode: 'bypassPermissions' }).reason).toContain('Auto mode')
  })

  it('a merge here ships, so a built word or an alias still counts as a hidden merge', () => {
    for (const cmd of ['G=gh; $G pr merge 3', 'gh $SUB 3', 'gh pr $M 3', 'gh co 3']) {
      expect(at(cmd).decision, cmd).toBe('deny')
    }
    expect(at('supabase db push --linked').decision).toBe('deny')
  })
})
