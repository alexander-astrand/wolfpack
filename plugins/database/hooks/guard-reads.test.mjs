// First: the tests' project and its kit.json (the fixture's values).
import './fixtures/kit-project.mjs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEV_REF, READ_BUDGET_MS, decide, readTimeout } from './guard-production.mjs'

// Kit 1.7 (the kit 1.6.1 council's H5, H1 and M10): the dev reads the guard
// now allows, the shapes that still go to the classifier or a person, a
// regex in node code that held `gh (run|pr)`, and a ranjit spawn under a
// typed /one-ring.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-reads-')))
process.once('exit', () => rmSync(root, { recursive: true, force: true }))
for (const dir of ['supabase/migrations', '.claude', 'src']) mkdirSync(join(root, dir), { recursive: true })
writeFileSync(join(root, 'supabase/migrations/0081_x.sql'), 'security definer\n')
writeFileSync(join(root, 'src/a.ts'), 'x\n')
writeFileSync(join(root, '.env.local'), 'KEY=1\n')

const STUBS = { linkedRef: () => DEV_REF, marker: () => null, chainMarker: () => null, releasePr: () => null, log: () => {}, chainLog: () => {}, readLog: () => '', root }
const call = (command, { cwd = root, mode = 'auto', agent } = {}) =>
  decide({ tool_name: 'Bash', tool_input: { command }, cwd, permission_mode: mode, agent_type: agent }, STUBS)
const d = (command, opts) => call(command, opts)?.decision ?? 'pass'

describe('H5: dev reads on the read allowlist', () => {
  it.each([
    'git show origin/V0.13:supabase/migrations/0004_jobs.sql',
    'git show 5ce1a94 --stat',
    'git diff main...HEAD -- supabase/migrations',
    'git diff --stat',
    'git cat-file -p HEAD:README.md',
    'git ls-tree -r --name-only HEAD',
    'git rev-parse --show-toplevel HEAD',
    `git -C ${root} show HEAD:src/a.ts`,
    'git --no-pager log --oneline -5',
    'grep -n -i -B3 "security definer" supabase/migrations/008*.sql',
    'grep -n security supabase/migrations/0081_x.sql src/a.ts',
    `grep -c x ${root}/src/a.ts`,
    'grep -e definer -e invoker supabase/migrations/0081_x.sql',
    'rg -n "security definer" supabase',
    'rg -l definer',
    'rg --files src',
    'wc -l supabase/migrations/0081_x.sql src/a.ts',
    'git show HEAD:supabase/migrations/0081_x.sql | grep -n definer | head -n 20',
    'git diff --stat | tail -5',
  ])('%s is allowed', (cmd) => {
    expect(call(cmd)).toMatchObject({ decision: 'allow', reason: expect.stringMatching(/read allowlist/) })
  })
})

describe('H5: the shapes that stay off the list', () => {
  it.each([
    // grep -o, an output file, a program run by the tool
    'grep -o definer supabase/migrations/0081_x.sql',
    'grep -no definer supabase/migrations/0081_x.sql',
    'rg -o definer src',
    'rg --pre cat definer src',
    'rg -z definer src',
    'git diff --output=/tmp/x.diff',
    'git diff --ext-diff',
    'git show --textconv HEAD:src/a.ts',
    'git cat-file --filters HEAD:src/a.ts',
    'git diff --no-index /etc/passwd src/a.ts',
    'git -c diff.external=x diff',
    // paths outside the repo, under .claude, .git or an .env file
    'grep root /etc/passwd',
    'grep x ../other/file',
    'wc -l ~/notes.md',
    'grep -n allow .claude/settings.json',
    'rg allow .claude',
    'grep KEY .env.local',
    'grep KEY .env*',
    'grep x .git/config',
    'grep -n x {src,/etc}/a.ts',
    // recursion that would read hidden files, links out, and unrestricted rg
    'grep -rn definer supabase',
    'grep -R definer .',
    'rg -u definer',
    'rg --hidden KEY',
    'rg --no-ignore KEY',
    'rg -L x src',
    // globs override rg's hidden and ignore skipping (review must 2)
    "rg -g '*' x",
    'rg -g .env KEY .',
    "rg -g '*' -e .",
    'rg --glob=.env x',
    'rg --iglob=.env* x',
    'rg --glob .env x',
    // a pattern the shell would expand into dot names
    'grep .* src/a.ts',
    // anything else in the pipe
    'grep -n x src/a.ts | sh',
    'git show HEAD:src/a.ts > /tmp/a.ts',
    'head -n 5 src/a.ts',
  ])('%s is not allowed', (cmd) => {
    expect(call(cmd)?.decision).not.toBe('allow')
  })

  // Review must 1: git diff goes no-index by itself when a path is outside
  // the working tree, and then prints any file.
  it.each([
    'git diff /dev/null ~/.ssh/id_rsa',
    'git diff /dev/null .env.local',
    'git diff -- /dev/null ~/x',
    'git -C /tmp diff /etc/hosts /dev/null',
    'git -C .claude diff',
    'git -C ~ diff',
    'git diff ../other/a ../other/b',
    'git diff src/../../x src/a.ts',
    'git --no-pager diff --stat /etc/hosts /dev/null',
  ])('%s is not a listed read (a no-index diff)', (cmd) => {
    expect(call(cmd)?.decision).not.toBe('allow')
  })

  // Review should 4: committed secrets, and the other secret files.
  it.each([
    'git show HEAD:.env',
    'git show HEAD:.ENV.local',
    'git cat-file -p HEAD:.env.local',
    'git log -p -- .env',
    'git diff HEAD~1 -- sub/.env.production',
    'git show HEAD:.npmrc',
    'git show HEAD:sub/.netrc',
    'git show HEAD:.mcp.json',
    'git log -p --follow=.dev.vars',
    'git ls-tree HEAD .vercel/',
    'grep x .npmrc',
    'grep x .mcp.json',
    'wc -l .dev.vars',
    'rg x .vercel',
    'grep x src/.netrc',
  ])('%s is not a listed read (a secret file)', (cmd) => {
    expect(call(cmd)?.decision).not.toBe('allow')
  })

  it('a diff run from outside the checkout is not a listed read; ranges and repo paths still are', () => {
    expect(d('git diff a b', { cwd: '/tmp' })).not.toBe('allow')
    expect(d('git diff main..HEAD -- ./src')).toBe('allow')
    expect(d(`git -C ${root} diff ${root}/src/a.ts`)).toBe('allow')
    expect(d('git -C src diff ../src/a.ts')).toBe('allow')
  })

  it('rg with no path from a folder outside the repo, or in .claude, is not a listed read', () => {
    expect(d('rg -n x', { cwd: '/tmp' })).not.toBe('allow')
    expect(d('rg -n x', { cwd: join(root, '.claude') })).not.toBe('allow')
    expect(d('rg -n x src', { cwd: root })).toBe('allow')
  })

  it('a relative path with no known cwd is not a listed read', () => {
    expect(decide({ tool_name: 'Bash', tool_input: { command: 'grep x src/a.ts' }, permission_mode: 'auto' }, STUBS)?.decision).not.toBe('allow')
  })

  it("production asks don't change: a push to main, a merge, a production ref", () => {
    expect(d('git push origin main')).toBe('ask')
    expect(d('gh pr merge 12 --squash')).toBe('deny')
    expect(d('supabase db push --project-ref prodrefprodrefprodre')).toBe('deny')
  })
})

describe('M10: a regex in node code is not a release command', () => {
  it('a `gh (a|b)` group stays refused (zsh globs it), and the deny says to run the code from a file', () => {
    const r = call(`node -e 'const kinds = [/gh (run|pr) list/, /git show/]; console.log(kinds)'`)
    expect(r?.decision).toBe('deny')
    expect(r.reason).toMatch(/scratch file and run it by name/)
    expect(call('gh $X')?.reason).not.toMatch(/scratch file/)
  })

  it.each([
    `node -e "const re = /gh pr|gh run/; console.log(re)"`,
    `node -e "const re = [/gh pr/, /gh/]; console.log(re)"`,
    // gh as a segment's own head in code, with only `pr` after it
    `node -e "const a = 1; gh pr"`,
    `node -e 'const re = /^gh (\\w+)/; console.log(1)'`,
  ])('%s passes', (cmd) => {
    expect(call(cmd)).toBeNull()
  })

  it.each([
    `node -e "require('child_process').execSync('gh pr merge 1')"`,
    `node -e "require('child_process').execSync('gh mergeit 1')"`,
    `node -e "require('child_process').execSync('echo merge 1 | xargs gh pr')"`,
    `node -e "require('child_process').execSync('gh $(echo pr merge) 1')"`,
    'echo merge 1 | xargs gh pr',
    'gh pr',
  ])('%s is still refused', (cmd) => {
    expect(d(cmd)).toBe('deny')
  })
})

describe('M10: a hung gh read asks instead of stalling', () => {
  it('outside a decision a read keeps its own timeout', () => {
    expect(readTimeout(5000)).toBe(5000)
  })

  // Review should 6: the real reader (readPr, no openPr stub) against a gh
  // that hangs. The clock is set 11.4 s into its 12 s, so readTimeout gives gh
  // about 0.6 s; without it gh would get its own 5 s and the test fails.
  it('the real gh pr read is cut at what is left of the clock, and the armed call asks', () => {
    const bin = mkdtempSync(join(tmpdir(), 'guard-slow-gh-'))
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 })
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    const realNow = Date.now.bind(Date)
    const t0 = realNow()
    let first = true
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      if (first) { first = false; return t0 }
      return realNow() + READ_BUDGET_MS - 600
    })
    try {
      const cmd = 'scripts/prod-db.sh push 0.14.1 0052'
      const marker = { version: '0.14.1', commands: [cmd], pr: 44, headSha: 'a'.repeat(40), expiresAt: new Date(t0 + 3600_000).toISOString() }
      const r = decide({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: root, permission_mode: 'auto', agent_type: 'ranjit' }, { ...STUBS, marker: () => marker })
      expect(r?.decision).toBe('ask')
      expect(r.reason).toMatch(/couldn't be read/)
      expect(realNow() - t0).toBeLessThan(3000)
    } finally {
      spy.mockRestore()
      process.env.PATH = path
      rmSync(bin, { recursive: true, force: true })
    }
  }, 15_000)

  it('decide stops the clock when it returns, so a later read keeps its own timeout', () => {
    decide({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root, permission_mode: 'auto' }, STUBS)
    expect(readTimeout(5000, Date.now() + 10 * READ_BUDGET_MS)).toBe(5000)
    // ...and when a stub throws inside it.
    expect(() => decide({ tool_name: 'Bash', tool_input: { command: 'git show HEAD:src/a.ts' }, cwd: root, permission_mode: 'auto' }, { ...STUBS, log: () => { throw new Error('boom') } })).not.toThrow(/spent/)
    expect(readTimeout(5000, Date.now() + 10 * READ_BUDGET_MS)).toBe(5000)
  })
})

describe("H1: a ranjit spawn after a typed /one-ring is denied with what to do", () => {
  const spawn = (humanGo, { prompt = 'Run the V0.14.1 production deploy', agent } = {}) => decide(
    { tool_name: 'Agent', tool_input: { subagent_type: 'ranjit', description: 'Run V0.14.1 production deploy', prompt }, cwd: root, permission_mode: 'auto', agent_type: agent },
    { ...STUBS, humanGo: () => humanGo },
  )

  it('denies and names the script', () => {
    const r = spawn({ arg: '0.14.1', at: Date.now() })
    expect(r?.decision).toBe('deny')
    expect(r.reason).toBe('Under /one-ring the deploy is `scripts/full-auto.sh deploy 0.14.1`, run in this session; do not spawn ranjit. '
      + 'This also holds the /skinny-pete fallback for 12 hours after the go; Alexander types `/one-ring stop` to take the go back and free it.')
    expect(spawn({ arg: '0.14.1', at: Date.now() }, { prompt: 'deploy it' })?.decision).toBe('deny')
  })

  it('with no typed go, or from a subagent, gets no decision as before', () => {
    expect(spawn(null)).toBeNull()
    expect(spawn({ arg: '0.14.1', at: Date.now() }, { agent: 'saul-goodman' })).toBeNull()
  })
})
