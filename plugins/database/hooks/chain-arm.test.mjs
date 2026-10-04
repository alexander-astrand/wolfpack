// First: the tests' project and its kit.json (placeholder values).
import './fixtures/kit-project.mjs'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FROZEN, FROZEN_RE, chainArgs, chainWhyNot, doneLine, doneWhyNot, finishChain, frozenHash, localSettingsForHash, markDone, newChain, nextVersion,
  oneTapText, oneTapVerdict, readFrozen,
} from './chain-arm.mjs'
import { decide } from './guard-production.mjs'
import { CI_JOBS, CI_WORKFLOW, PROD_REF, withCompleteFiles } from './production-steps.mjs'

// The plugin's own copy of the arm script (scripts/ beside hooks/).
const SCRIPT = fileURLToPath(new URL('../scripts/full-auto.sh', import.meta.url))

const NOW = Date.parse('2026-10-01T18:00:00Z')
const HOUR = 3600_000
const MAIN = 'c'.repeat(40)
const HASH = 'd'.repeat(64)

// `PROD_DB_KEYCHAIN_ITEM=example-dev-db-url scripts/prod-db.sh migrations` on
// dev, 29 Sep 2026, trimmed to 5 rows (the CLI prints JSON off a terminal).
const MIGRATIONS = [
  'Target: dev (devrefdevrefdevrefde)',
  'Connecting to remote database...',
  '{"migrations":[{"local":"0048","remote":"0048","time":"0048"},{"local":"0049","remote":"0049","time":"0049"},{"local":"0050","remote":"0050","time":"0050"},{"local":"0051","remote":"0051","time":"0051"},{"local":"0052","remote":"0052","time":"0052"}],"message":"Migrations listed"}',
].join('\n')
// `supabase functions list --project-ref devrefdevrefdevrefde -o json`, same
// day, two functions (entrypoint paths shortened).
const FUNCTIONS = JSON.stringify([
  { created_at: 1790082575091, entrypoint_path: 'file:///repo/supabase/functions/invite-user/index.ts', ezbr_sha256: '7eb94a67be6e987b35575e87593541a407639475a9eb06b9815c90f879444ca4', id: '67e10e21-2182-4f4e-a934-3f841458255b', import_map: false, name: 'invite-user', slug: 'invite-user', status: 'ACTIVE', updated_at: 1790511394428, verify_jwt: true, version: 10 },
  { created_at: 1790245787853, entrypoint_path: 'file:///repo/supabase/functions/bgg/index.ts', ezbr_sha256: '26f2541ec8abb856e8a30bdafdce171d2434623c727cf77ee6b413922029239b', id: '44e20cb0-0d94-4e0a-92d6-625ce2dd4005', import_map: false, name: 'bgg', slug: 'bgg', status: 'ACTIVE', updated_at: 1790611316820, verify_jwt: true, version: 14 },
])

describe('C8: the chain arm module', () => {
  it('frozenHash changes when any file in the set changes, and not for a file outside it', () => {
    const inSet = [
      '.claude/hooks/guard-production.mjs', '.claude/hooks/fixtures/pr-44-body.md', '.claude/settings.json', '.claude/settings.local.json',
      'scripts/full-auto.sh', 'scripts/prod-db.sh', 'scripts/check.sh', '.github/workflows/ci.yml', '.github/pull_request_template.md',
      '.claude/agents/yoda.md', '.claude/agents/ranjit.md',
    ]
    // chain-verdict.md is gone with yoda's verdict (2.12.3); the script check replaces it.
    const outside = ['src/App.tsx', '.claude/agents/maverick.md', '.claude/skills/cattle-drive/chain.md', '.claude/skills/cattle-drive/chain-verdict.md', 'scripts/usage.mjs', 'README.md']
    const files = [...inSet, ...outside].map((path) => ({ path, content: `v1 ${path}` }))
    const base = frozenHash(files)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    // Order doesn't matter.
    expect(frozenHash([...files].reverse())).toBe(base)
    for (const path of inSet) {
      expect(frozenHash(files.map((f) => (f.path === path ? { path, content: 'v2' } : f))), path).not.toBe(base)
      expect(frozenHash(files.filter((f) => f.path !== path)), `${path} removed`).not.toBe(base)
      expect(frozenHash(files.map((f) => (f.path === path ? { path, content: null } : f))), `${path} missing`).not.toBe(base)
    }
    for (const path of outside) {
      expect(frozenHash(files.map((f) => (f.path === path ? { path, content: 'v2' } : f))), path).toBe(base)
    }
    expect(frozenHash([...files, { path: 'src/new.ts', content: 'x' }])).toBe(base)
    expect(frozenHash([...files, { path: '.claude/hooks/new.mjs', content: 'x' }])).not.toBe(base)
    // Every entry of the set is matched in any checkout, as the guard's paths are.
    for (const p of FROZEN) expect(FROZEN_RE.test(`/r/.claude/worktrees/x/${p.replace(/\/$/, '/a')}`), p).toBe(true)

    // The same from disk: tracked files from git, the ignored local settings too.
    const dir = mkdtempSync(join(tmpdir(), 'frozen-'))
    try {
      const put = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text) }
      const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
      for (const path of ['.claude/hooks/guard-production.mjs', 'scripts/check.sh', '.github/workflows/ci.yml', '.claude/agents/yoda.md', 'src/a.ts']) put(path, 'one')
      put('.gitignore', '.claude/settings.local.json\n')
      git('init', '-q')
      git('add', '-A')
      const disk = () => frozenHash(readFrozen(dir))
      const first = disk()
      put('src/a.ts', 'two')
      expect(disk()).toBe(first)
      put('.github/workflows/ci.yml', 'two')
      const second = disk()
      expect(second).not.toBe(first)
      put('.claude/settings.local.json', '{}')
      expect(disk()).not.toBe(second)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("the local settings' allow lines don't count; hooks, deny rules and the hooks switch do (2.13.2.1)", () => {
    const dir = mkdtempSync(join(tmpdir(), 'frozen-local-'))
    try {
      const put = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text) }
      put('.claude/hooks/guard-production.mjs', 'one')
      put('.gitignore', '.claude/settings.local.json\n')
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' })
      execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
      const hashOf = (settings) => { put('.claude/settings.local.json', typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2)); return frozenHash(readFrozen(dir)) }
      const base = { permissions: { allow: ['Bash(npm test)'], deny: ['Bash(rm *)'] }, env: { X: '1' } }
      const first = hashOf(base)
      // "Don't ask again" mid-chain: one more allow line, or none at all.
      expect(hashOf({ ...base, permissions: { ...base.permissions, allow: [...base.permissions.allow, 'Bash(git status)'] } })).toBe(first)
      expect(hashOf({ ...base, permissions: { deny: base.permissions.deny } })).toBe(first)
      // Anything that can change what runs or what's refused still counts.
      const hook = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }] }
      expect(hashOf({ ...base, hooks: hook })).not.toBe(first)
      expect(hashOf({ ...base, permissions: { ...base.permissions, deny: [...base.permissions.deny, 'Bash(curl *)'] } })).not.toBe(first)
      expect(hashOf({ ...base, disableAllHooks: true })).not.toBe(first)
      expect(hashOf({ ...base, permissions: { ...base.permissions, ask: ['Bash(git push *)'] } })).not.toBe(first)
      expect(hashOf({ ...base, permissions: { ...base.permissions, defaultMode: 'bypassPermissions' } })).not.toBe(first)
      expect(hashOf({ ...base, env: { X: '2' } })).not.toBe(first)
      // JSON that doesn't parse is hashed as it is.
      const broken = '{ "permissions": { "allow": ["Bash(npm test)"] '
      expect(localSettingsForHash(Buffer.from(broken)).toString('utf8')).toBe(broken)
      expect(hashOf(broken)).not.toBe(hashOf(broken + ' '))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('newChain refuses five versions, a repeat, a bad version', () => {
    const usage = /^Usage: scripts\/full-auto\.sh arm-chain <version> \[<version> …\] \(at most 4, each like 2\.13\.1\)$/
    expect(newChain(['2.13', '2.13.1', '2.13.2', '2.13.3', '2.13.4'], NOW, MAIN, HASH).refuse).toMatch(usage)
    expect(newChain([], NOW, MAIN, HASH).refuse).toMatch(usage)
    expect(newChain(['2.13', 'V2.13'], NOW, MAIN, HASH).refuse).toMatch(/^V2\.13 is in the chain twice/)
    for (const bad of ['2.13;rm', 'latest', '2.13-rc', '']) expect(newChain([bad], NOW, MAIN, HASH).refuse, bad).toMatch(usage)
    expect(newChain(['2.13'], NOW, 'main', HASH).refuse).toMatch(/origin\/main/)
    expect(newChain(['2.13'], NOW, MAIN, 'x').refuse).toMatch(/hashed/)
    expect(newChain(['V2.13', '2.13.1'], NOW, MAIN, HASH)).toEqual({
      chain: {
        chain: 'chain-2026-10-01T18:00:00.000Z', versions: ['2.13', '2.13.1'], done: [],
        armedAt: '2026-10-01T18:00:00.000Z', expiresAt: '2026-10-03T18:00:00.000Z', mainSha: MAIN, frozenHash: HASH,
      },
    })
    // Shadow-first and its word are gone (2.12.3): every link arms one way.
    expect(chainArgs(['2.13', '2.14'])).toEqual({ versions: ['2.13', '2.14'] })
    expect(chainArgs(['2.13', '2.14', 'all-derived']).refuse).toMatch(usage)
    expect(chainArgs(['all-derived', '2.13']).refuse).toMatch(usage)
  })

  it("chainWhyNot: unreadable, expired, 73 hours, a changed guard file", () => {
    const chain = (over = {}) => ({ ...newChain(['2.13', '2.13.1'], NOW, MAIN, HASH).chain, ...over })
    expect(chainWhyNot(chain(), NOW + HOUR, HASH)).toBe('')
    for (const bad of [null, {}, [], 'x', chain({ versions: [] }), chain({ done: null }), chain({ frozenHash: 1 }), chain({ expiresAt: 'soon' })]) {
      expect(chainWhyNot(bad, NOW, HASH)).toBe('the chain marker is unreadable')
    }
    expect(chainWhyNot(chain(), NOW + 48 * HOUR, HASH)).toBe('the chain arm has expired')
    expect(chainWhyNot(chain({ expiresAt: new Date(NOW + 73 * HOUR).toISOString() }), NOW, HASH)).toBe('the chain marker claims more than 72 hours')
    // A tap from long ago, with an expiry moved on, is refused too.
    expect(chainWhyNot(chain({ armedAt: new Date(NOW - 73 * HOUR).toISOString(), expiresAt: new Date(NOW + HOUR).toISOString() }), NOW, HASH))
      .toBe('the chain marker claims more than 72 hours')
    expect(chainWhyNot(chain(), NOW, 'e'.repeat(64))).toMatch(/^the guard's files differ from what was tapped \(/)
  })

  it('nextVersion skips done ones and is null at the end', () => {
    const chain = newChain(['2.13', '2.13.1', '2.13.2'], NOW, MAIN, HASH).chain
    expect(nextVersion(chain)).toBe('2.13')
    expect(nextVersion({ ...chain, done: ['2.13'] })).toBe('2.13.1')
    expect(nextVersion({ ...chain, done: ['2.13', '2.13.1', '2.13.2'] })).toBeNull()
    expect(nextVersion(null)).toBeNull()
  })

  describe('doneWhyNot', () => {
    const ARMED = new Date(1790500000000).toISOString()
    const marker = (over = {}) => ({
      version: '2.13', pr: 50, headSha: 'a'.repeat(40), armedAt: ARMED, expiresAt: new Date(1790500000000 + 4 * HOUR).toISOString(),
      commands: [
        'scripts/prod-db.sh backup 2.13', 'scripts/prod-db.sh push 2.13 0051 0052',
        `supabase functions deploy invite-user --project-ref ${PROD_REF}`, `supabase functions deploy bgg --project-ref ${PROD_REF}`,
        'gh pr ready 50', 'gh pr merge 50 --squash --admin',
      ],
      ...over,
    })
    const log = (...extra) => [`2026-09-24T08:00:00Z\tarmed\tV2.13 PR #50 ${'a'.repeat(40)}`,
      `2026-09-24T08:01:00Z\tallow\tscripts/prod-db.sh push 2.13 0051 0052\tlisted\tranjit`,
      `2026-09-24T08:02:00Z\tallow\tsupabase functions deploy invite-user --project-ref ${PROD_REF}\tlisted\tranjit`, ...extra, ''].join('\n')
    const chain = newChain(['2.13', '2.13.1'], NOW, MAIN, HASH).chain
    const facts = (over = {}) => ({
      version: '2.13', marker: marker(), chain, pr: { number: 50, state: 'MERGED' },
      migrationsText: MIGRATIONS, functionsJson: FUNCTIONS, logText: log(), ...over,
    })

    it('doneWhyNot: an open PR', () => {
      expect(doneWhyNot(facts({ pr: { number: 50, state: 'OPEN' } }))).toBe('PR #50 is OPEN, not MERGED')
      expect(doneWhyNot(facts({ pr: null }))).toBe('PR #50 is unreadable, not MERGED')
    })

    it('doneWhyNot: a pushed migration missing remotely', () => {
      expect(doneWhyNot(facts({ marker: marker({ commands: ['scripts/prod-db.sh push 2.13 0052 0053'] }) }))).toBe("migration 0053 isn't applied on production")
      // Listed locally but not remotely.
      const localOnly = MIGRATIONS.replace('"remote":"0052"', '"remote":""')
      expect(doneWhyNot(facts({ migrationsText: localOnly }))).toBe("migration 0052 isn't applied on production")
      // The table form a terminal gets reads the same.
      expect(doneWhyNot(facts({ migrationsText: '  Local | Remote | Time\n  ------|--------|-----\n  0051  | 0051   | 0051\n  0052  |        | 0052\n' })))
        .toBe("migration 0052 isn't applied on production")
      expect(doneWhyNot(facts({ migrationsText: null }))).toBe("production's migration list couldn't be read")
      expect(doneWhyNot(facts({ migrationsText: 'error: connection refused' }))).toBe("production's migration list couldn't be read")
    })

    it('doneWhyNot: a function not updated since the arm', () => {
      // The must-4 case: the log has ranjit's allow line for the deploy, but
      // production shows invite-user unchanged since before the arm.
      const later = new Date(1790600000000).toISOString()
      expect(log()).toContain('\tallow\tsupabase functions deploy invite-user')
      expect(doneWhyNot(facts({ marker: marker({ armedAt: later }) }))).toBe("function invite-user wasn't deployed to production after the arm")
      expect(doneWhyNot(facts({ marker: marker({ commands: [`supabase functions deploy notify --project-ref ${PROD_REF}`] }) })))
        .toBe("function notify wasn't deployed to production after the arm")
      expect(doneWhyNot(facts({ functionsJson: 'Unauthorized' }))).toBe("production's function list couldn't be read")
    })

    it('doneWhyNot: an ask line in the log', () => {
      expect(doneWhyNot(facts({ logText: log(`2026-09-24T08:03:00Z\task\tscripts/prod-db.sh repair applied 0052\tnot listed\tranjit`) })))
        .toBe('a call asked a person during the deploy: scripts/prod-db.sh repair applied 0052')
      expect(doneWhyNot(facts({ logText: null }))).toBe('the release log is unreadable')
      expect(doneWhyNot(facts({ logText: 'x\tallow\ty\n' }))).toBe('the release log has no armed line')
    })

    // The script's done in a temp repo: fake gh, supabase and prod-db.sh give
    // production's answers; the markers are files there. Never arm-chain.
    // The plugin's own copy of the arm script; skipped until it's pasted in (the guard refuses an agent's copy).
    it.skipIf(!existsSync(SCRIPT))("the script's done closes a deployed release and disarms on a failed deploy", () => {
      const script = SCRIPT
      const dir = mkdtempSync(join(tmpdir(), 'chain-done-'))
      try {
        const put = (path, text, mode) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text, mode ? { mode } : undefined) }
        const read = (path) => { try { return readFileSync(join(dir, path), 'utf8') } catch { return null } }
        put('scripts/full-auto.sh', readFileSync(script, 'utf8'), 0o755)
        for (const f of ['chain-arm.mjs', 'production-steps.mjs']) put(`.claude/hooks/${f}`, readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8'))
        put('scripts/prod-db.sh', `#!/bin/sh\ncat "$(dirname "$0")/migrations.txt"\n`, 0o755)
        put('scripts/migrations.txt', MIGRATIONS)
        put('bin/gh', `#!/bin/sh\necho '{"number":50,"state":"MERGED","mergeCommit":{"oid":"${'f'.repeat(40)}"}}'\n`, 0o755)
        put('bin/supabase', `#!/bin/sh\ncat "${join(dir, 'bin/functions.json')}"\n`, 0o755)
        put('bin/functions.json', FUNCTIONS)
        const arm = (m, text) => {
          put('.claude/full-auto.json', JSON.stringify(m))
          put('.claude/full-auto.log', text)
          put('.claude/full-auto-verdict.json', '{}')
        }
        const done = (v) => {
          try {
            return { code: 0, out: execFileSync('bash', [join(dir, 'scripts/full-auto.sh'), 'done', v], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } }) }
          } catch (err) {
            return { code: err.status, out: `${err.stdout}${err.stderr}` }
          }
        }
        put('.claude/full-auto-chain.json', JSON.stringify(chain))
        arm(marker(), log())
        const first = done('2.13')
        expect(first.out).toContain('Next in the chain: V2.13.1')
        expect(first.code).toBe(0)
        // ranjit's report line (2.14.6), last; the chain marker still gets
        // only the JSON.
        expect(first.out).toMatch(new RegExp(`Next in the chain: V2\\.13\\.1\\.\\nmerged ${'f'.repeat(40)}; functions: invite-user v10, bgg v14\\n$`))
        expect(read('.claude/full-auto.json')).toBeNull()
        expect(read('.claude/full-auto-verdict.json')).toBeNull()
        expect(JSON.parse(read('.claude/full-auto-chain.json')).done).toEqual(['2.13'])
        expect(read('.claude/full-auto-chain.log')).toMatch(/\tdone\tV2\.13\n$/)
        // 2.13.1's deploy of invite-user didn't land: production still shows
        // the old one, though the log has its allow line.
        arm(marker({ version: '2.13.1', armedAt: new Date(1790600000000).toISOString(), commands: [`supabase functions deploy invite-user --project-ref ${PROD_REF}`] }), log())
        const second = done('2.13.1')
        expect(second.code).toBe(1)
        expect(second.out).toContain("function invite-user wasn't deployed to production after the arm")
        for (const f of ['full-auto.json', 'full-auto-chain.json', 'full-auto-verdict.json']) expect(read(`.claude/${f}`), f).toBeNull()
        expect(read('.claude/full-auto-chain.log').trim().split('\n').at(-1)).toMatch(/\tdisarmed\tdone V2\.13\.1 refused: function invite-user/)
        expect(read('.claude/full-auto.log')).toMatch(/\tdisarmed\t/)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    // Gate audit 3 (2.12.4): the last done keeps the chain, finished, for
    // the wrap-up; disarm removes it, and a new tap replaces it.
    it.skipIf(!existsSync(SCRIPT))("the script's last done keeps the chain marker, finished; disarm removes it", () => {
      const script = SCRIPT
      const dir = mkdtempSync(join(tmpdir(), 'chain-finish-'))
      try {
        const put = (path, text, mode) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text, mode ? { mode } : undefined) }
        const read = (path) => { try { return readFileSync(join(dir, path), 'utf8') } catch { return null } }
        put('scripts/full-auto.sh', readFileSync(script, 'utf8'), 0o755)
        for (const f of ['chain-arm.mjs', 'production-steps.mjs']) put(`.claude/hooks/${f}`, readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8'))
        put('scripts/prod-db.sh', `#!/bin/sh\ncat "$(dirname "$0")/migrations.txt"\n`, 0o755)
        put('scripts/migrations.txt', MIGRATIONS)
        put('bin/gh', '#!/bin/sh\necho \'{"number":50,"state":"MERGED"}\'\n', 0o755)
        put('bin/supabase', `#!/bin/sh\ncat "${join(dir, 'bin/functions.json')}"\n`, 0o755)
        put('bin/functions.json', FUNCTIONS)
        const sh = (...args) => {
          try {
            return { code: 0, out: execFileSync('bash', [join(dir, 'scripts/full-auto.sh'), ...args], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } }) }
          } catch (err) {
            return { code: err.status, out: `${err.stdout}${err.stderr}` }
          }
        }
        // A chain of one, freshly tapped (newChain's 48 hours from now).
        const one = newChain(['2.13'], Date.now(), MAIN, HASH).chain
        const armed = new Date(Date.now() - HOUR).toISOString()
        const finishAndCheck = () => {
          put('.claude/full-auto-chain.json', JSON.stringify(one))
          put('.claude/full-auto.json', JSON.stringify(marker({ armedAt: armed, commands: ['gh pr merge 50 --squash --admin'] })))
          put('.claude/full-auto.log', log())
          const out = sh('done', '2.13')
          expect(out.code, out.out).toBe(0)
          expect(out.out).toContain('The chain marker stays, finished')
          expect(read('.claude/full-auto.json')).toBeNull()
          const kept = JSON.parse(read('.claude/full-auto-chain.json'))
          expect(kept.done).toEqual(['2.13'])
          expect(Date.parse(kept.finished)).toBeGreaterThan(Date.now() - 60_000)
          expect(Date.parse(kept.expiresAt) - Date.parse(kept.finished)).toBe(90 * 60_000)
          expect(chainWhyNot(kept, Date.now(), kept.frozenHash)).toBe('')
          expect(read('.claude/full-auto-chain.log')).toMatch(/\tdone\tV2\.13\n[^\n]*\tchain-done\n$/)
        }
        finishAndCheck()
        expect(sh('disarm').out).toContain('Full auto disarmed')
        expect(read('.claude/full-auto-chain.json')).toBeNull()
        // A new tap isn't blocked by a finished chain: it gets as far as the
        // fetch (no git here), with the finished marker cleared.
        finishAndCheck()
        const tap = sh('arm-chain', '2.14')
        expect(tap.out).toContain("couldn't fetch origin/main")
        expect(tap.out).not.toContain('disarm first')
        expect(read('.claude/full-auto-chain.json')).toBeNull()
        // The tap starts both logs clean (2.12.4): the last drive's lines,
        // the clearing included, sit one generation back.
        expect(read('.claude/full-auto-chain.log')).toBeNull()
        expect(read('.claude/full-auto.log')).toBeNull()
        const prevChain = read('.claude/full-auto-chain.prev.log')
        expect(prevChain).toMatch(/\tchain-done\n[^\n]*\tchain-cleared\t/)
        expect(read('.claude/full-auto.prev.log')).toMatch(/\tdone\tV2\.13\n/)
        // A retried tap with no new lines keeps that generation.
        expect(sh('arm-chain', '2.14').out).toContain("couldn't fetch origin/main")
        expect(read('.claude/full-auto-chain.prev.log')).toBe(prevChain)
        // A running chain still blocks it.
        put('.claude/full-auto-chain.json', JSON.stringify(one))
        expect(sh('arm-chain', '2.14').out).toContain('disarm first')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('finishChain: finished now, expiring 90 minutes on or at its own expiry', () => {
      const c = { ...chain, done: ['2.13', '2.13.1'] }
      const f = finishChain(c, NOW)
      expect(f.finished).toBe(new Date(NOW).toISOString())
      expect(f.expiresAt).toBe(new Date(NOW + 90 * 60_000).toISOString())
      expect(f.done).toEqual(['2.13', '2.13.1'])
      expect(finishChain({ ...c, expiresAt: new Date(NOW + 10 * 60_000).toISOString() }, NOW).expiresAt).toBe(new Date(NOW + 10 * 60_000).toISOString())
      expect(finishChain({ ...c, expiresAt: 'soon' }, NOW).expiresAt).toBe(new Date(NOW + 90 * 60_000).toISOString())
    })

    it("markDone keeps each release's PR in prs, for ranjit's report after done (review M5)", () => {
      const first = markDone({ ...chain, versions: ['2.13', '2.13.1'], done: [] }, '2.13', 50, NOW)
      expect(first.next).toBe('2.13.1')
      expect(first.chain.prs).toEqual({ '2.13': 50 })
      expect(first.chain.finished).toBeUndefined()
      const last = markDone(first.chain, '2.13.1', 51, NOW)
      expect(last.next).toBe(null)
      expect(last.chain.prs).toEqual({ '2.13': 50, '2.13.1': 51 })
      expect(last.chain.done).toEqual(['2.13', '2.13.1'])
      expect(last.chain.finished).toBe(new Date(NOW).toISOString())
    })

    it("doneLine: the merge SHA and each deployed function's version, one line (ranjit's ask, 2.14.4)", () => {
      const merged = { number: 50, state: 'MERGED', mergeCommit: { oid: 'f'.repeat(40) } }
      expect(doneLine(merged, marker(), FUNCTIONS)).toBe(`merged ${'f'.repeat(40)}; functions: invite-user v10, bgg v14`)
      // Merge-only, or no function on the list: says so.
      expect(doneLine(merged, marker({ commands: ['gh pr merge 50 --squash --admin'] }), null)).toBe(`merged ${'f'.repeat(40)}; functions: none deployed`)
      // What can't be read says so; done has already checked production.
      expect(doneLine({ number: 50, state: 'MERGED' }, marker(), 'not json')).toBe('merged unknown; functions: invite-user v?, bgg v?')
      expect(doneLine(null, null, null)).toBe('merged unknown; functions: none deployed')
    })

    it('doneWhyNot: all four hold', () => {
      expect(doneWhyNot(facts())).toBe('')
      // A merge-only release reads nothing from production.
      expect(doneWhyNot(facts({ marker: marker({ commands: ['gh pr merge 50 --squash --admin'] }), migrationsText: null, functionsJson: null }))).toBe('')
      // Only the chain's next release, and only its own marker.
      expect(doneWhyNot(facts({ version: '2.13.1' }))).toBe("V2.13.1 isn't the chain's next release (V2.13 is)")
      expect(doneWhyNot(facts({ marker: marker({ version: '2.12' }) }))).toBe('the release marker is for V2.12, not V2.13')
      expect(doneWhyNot(facts({ marker: null }))).toBe('the release marker is missing or unreadable')
      expect(doneWhyNot(facts({ chain: null }))).toBe('no chain is armed, or its marker is unreadable')
      expect(doneWhyNot(facts({ chain: { ...chain, done: ['2.13', '2.13.1'] } }))).toBe('the chain is already done')
    })
  })
})

// 2.12.3: the one-tap arm's verdict, as preview prints it. The guard's rows
// (guard-production.test.mjs, "the one-tap arm") run the same function.
describe('2.12.3: oneTapVerdict and its preview text', () => {
  const GREEN = CI_JOBS.map((name) => ({ __typename: 'CheckRun', name, workflowName: CI_WORKFLOW, status: 'COMPLETED', conclusion: 'SUCCESS' }))
  const chain = newChain(['2.13'], NOW, MAIN, HASH).chain
  const none = '## Production steps\n### Before merge\nNone\n### After merge\nNone\n### Human steps before the deploy can finish\nNone\n## Notes'
  const pr = (over = {}) => ({ number: 46, headRefName: 'V2.13', headRefOid: MAIN, body: none, isDraft: true, files: [{ path: 'README.md' }], changedFiles: 1, statusCheckRollup: GREEN, ...over })

  it('all six hold: allow', () => {
    const rows = oneTapVerdict({ version: '2.13', chain, now: NOW + HOUR, hash: HASH, pr: pr() })
    expect(rows.map((r) => r.why)).toEqual(['', '', '', '', '', ''])
    expect(oneTapText(rows, '2.13')).toBe([
      "One-tap arm for V2.13: all six hold, so ranjit's arm passes without asking.",
      '  ok  in the arm given at the start', '  ok  frozen set unchanged', '  ok  CI green by job name',
      '  ok  the list derived from the PR', '  ok  backup first', "  ok  migrations are the PR's files", '',
    ].join('\n'))
  })

  it('a process release with no chain armed taps at the arm (2.12.3 itself)', () => {
    const files = ['.claude/hooks/guard-production.mjs', 'scripts/full-auto.sh', 'README.md'].map((path) => ({ path }))
    const text = oneTapText(oneTapVerdict({ version: '2.13', chain: null, now: NOW, hash: HASH, pr: pr({ files, changedFiles: 3 }) }), '2.13')
    expect(text).toMatch(/^One-tap arm for V2\.13: refused, so ranjit's arm asks a person \(a tap at the arm\)\.\n/)
    expect(text).toContain('  no  in the arm given at the start: no chain is armed')
    expect(text).toContain("  no  frozen set unchanged: the release changes the guard's frozen files (.claude/hooks/guard-production.mjs and 1 more), so it taps at its arm")
    expect(text).toContain('  ok  CI green by job name')
  })

  it('a hard stop reads as one', () => {
    const rows = oneTapVerdict({ version: '2.13', chain, now: NOW + HOUR, hash: HASH, pr: pr({ statusCheckRollup: [] }) })
    expect(oneTapText(rows, '2.13')).toMatch(/^One-tap arm for V2\.13: refused, a hard stop; ranjit's arm is denied until it's fixed\.\n[\s\S]* {2}no {2}CI green by job name: no checks have run/)
    expect(oneTapVerdict({ version: '2.13', chain, now: NOW + HOUR, hash: HASH, pr: null }).filter((r) => r.why).map((r) => r.name)).toEqual([
      'frozen set unchanged', 'CI green by job name', 'the list derived from the PR', 'backup first', "migrations are the PR's files",
    ])
  })

  it("2.14.6: two push lines are a hard stop preview shows before the arm ([deploy-order])", () => {
    const body = '## Production steps\n### Before merge\n1. `scripts/prod-db.sh backup 2.13`\n2. `scripts/prod-db.sh push 2.13 0053`\n3. `scripts/prod-db.sh push 2.13 0054`\n## Notes'
    const files = ['supabase/migrations/0053_a.sql', 'supabase/migrations/0054_b.sql'].map((path) => ({ path }))
    const text = oneTapText(oneTapVerdict({ version: '2.13', chain, now: NOW + HOUR, hash: HASH, pr: pr({ body, files, changedFiles: 2 }) }), '2.13')
    expect(text).toMatch(/^One-tap arm for V2\.13: refused, a hard stop/)
    expect(text).toContain("  no  migrations are the PR's files: a release's migrations go in one push")
  })

  it('2.14.6: 132 files, paged, pass the tap; unpaged they ask ([pr-size])', () => {
    const many = Array.from({ length: 132 }, (_, i) => `src/f${i}.ts`)
    const cut = pr({ files: many.slice(0, 100).map((path) => ({ path })), changedFiles: 132 })
    const rows = (p) => oneTapVerdict({ version: '2.13', chain, now: NOW + HOUR, hash: HASH, pr: p })
    expect(rows(withCompleteFiles(cut, () => many)).map((r) => r.why)).toEqual(['', '', '', '', '', ''])
    expect(rows(withCompleteFiles(cut, () => { throw new Error('gh timed out') })).find((r) => r.name === 'frozen set unchanged').why).toBe("the PR's changed files couldn't be read")
  })
})

// Gap 2 (2.14.6): 2.13.6.1's arm left `armed` in the log and no prompt line.
// The guard's ask at ranjit's arm of a release that changes the frozen set
// must still be on record after full-auto.sh's arm starts the release log
// afresh. It lives in the chain log, which arm only appends to.
describe("2.14.6: the arm's ask on a frozen release survives the arm's log rotation", () => {
  it.skipIf(!existsSync(SCRIPT))('the ask line sits in the chain log before the armed line, after the arm ran', () => {
    const script = SCRIPT
    const dir = mkdtempSync(join(tmpdir(), 'arm-ask-'))
    try {
      const put = (path, text, mode) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text, mode ? { mode } : undefined) }
      const read = (path) => { try { return readFileSync(join(dir, path), 'utf8') } catch { return null } }
      put('scripts/full-auto.sh', readFileSync(script, 'utf8'), 0o755)
      for (const f of ['chain-arm.mjs', 'production-steps.mjs']) put(`.claude/hooks/${f}`, readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8'))
      const chain = newChain(['2.13'], NOW, MAIN, HASH).chain
      put('.claude/full-auto-chain.json', JSON.stringify(chain))
      put('.claude/full-auto-chain.log', `2026-10-01T18:00:00Z\tchain-armed\tV2.13 main ${MAIN.slice(0, 7)}\n`)
      put('.claude/full-auto.log', '2026-10-01T17:00:00Z\tdone\tV2.12.9\n')
      const GREEN = CI_JOBS.map((name) => ({ __typename: 'CheckRun', name, workflowName: CI_WORKFLOW, status: 'COMPLETED', conclusion: 'SUCCESS' }))
      const body = '## Production steps\n### Before merge\n1. `scripts/prod-db.sh backup 2.13`\n2. `scripts/prod-db.sh push 2.13 0053`\n### After merge\nNone\n## Notes'
      const files = ['.claude/hooks/guard-production.mjs', 'supabase/migrations/0053_x.sql'].map((path) => ({ path }))
      const pr = { number: 50, headRefName: 'V2.13', headRefOid: 'a'.repeat(40), body, isDraft: true, files, changedFiles: 2, statusCheckRollup: GREEN }

      // The guard at ranjit's arm, writing to this dir's logs.
      const append = (f) => (line) => appendFileSync(join(dir, '.claude', f), line + '\n')
      const out = decide({ tool_name: 'Bash', tool_input: { command: 'scripts/full-auto.sh arm 2.13' }, permission_mode: 'default', agent_type: 'ranjit' }, {
        linkedRef: () => 'devrefdevrefdevrefde', now: () => NOW + HOUR, releasePr: () => pr, frozen: () => HASH,
        marker: () => (read('.claude/full-auto.json') === null ? null : JSON.parse(read('.claude/full-auto.json'))),
        chainMarker: () => JSON.parse(read('.claude/full-auto-chain.json')),
        log: append('full-auto.log'), chainLog: append('full-auto-chain.log'),
      })
      expect(out?.decision).toBe('ask')
      expect(out.reason).toContain('so it taps at its arm')

      // A person says yes: the arm runs, gh stubbed.
      put('pr.json', JSON.stringify(pr))
      put('bin/gh', `#!/bin/sh
case "$*" in
  "pr list "*) echo "50 V2.13" ;;
  *"--json headRefOid"*) echo "${'a'.repeat(40)}" ;;
  *"--json number,body,isDraft,files,changedFiles"*) cat "${join(dir, 'pr.json')}" ;;
  *) exit 1 ;;
esac
`, 0o755)
      const armed = execFileSync('bash', [join(dir, 'scripts/full-auto.sh'), 'arm', '2.13'], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } })
      expect(armed).toContain('Full auto armed for V2.13 (PR #50')

      // The release log was started afresh (the rotation)...
      expect(read('.claude/full-auto.log')).toMatch(/^[^\n]*\tarmed\tV2\.13 PR #50 a{40}\n$/)
      // ...and the chain log kept the ask, before the armed line.
      const lines = read('.claude/full-auto-chain.log').trim().split('\n').map((l) => l.split('\t'))
      expect(lines.map((l) => l[1])).toEqual(['chain-armed', 'ask', 'armed'])
      expect(lines[1][2]).toBe('scripts/full-auto.sh arm 2.13')
      expect(lines[1][3]).toMatch(/^one-tap arm: .*the release changes the guard's frozen files \(\.claude\/hooks\/guard-production\.mjs\), so it taps at its arm/)
      expect(lines[1][4]).toBe('ranjit')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
