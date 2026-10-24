// The one-word deploy's runner (kit 1.6), played against a fake GitHub, git,
// Docker and prod-db.sh: the order it runs things in, and that every stop
// comes before the production step it protects.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EXIT, alreadyListed, ciState, deploy, holdsDeploy, leftStepsComment, migrationChanges, namesVersion, openHumanSteps, parseGo, pickPr, touchedFunctions, versionOf } from './deploy.mjs'

const TMP = mkdtempSync(join(tmpdir(), 'deploy-test-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const JOBS = ['Checks', 'Database']
const KIT = { refs: { dev: 'devrefdevrefdevrefde', prod: 'prodrefprodrefprodre' }, urls: { prod: 'https://app.example.com' }, deployer: 'ranjit', ci: { workflow: '.github/workflows/ci.yml', jobs: JOBS }, keychain: { prod: 'x-prod' }, backupRoot: '~/Backups/x' }
const HEAD = 'a'.repeat(40)
const MERGE = 'b'.repeat(40)
const green = () => JOBS.map((name) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' }))
const skipped = () => JOBS.map((name) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion: 'SKIPPED' }))
const BODY = '## Production steps\n### Before merge\n- Backup: `scripts/prod-db.sh backup 0.14.3.1`\n### After merge\nNone\n### Human steps before the deploy can finish\nNone\n'

/**
 * A fake world. `pr` is the PR as GitHub holds it; the options say how each
 * outside call answers. Every call lands in `calls` as one line.
 */
function world(opts = {}) {
  const o = {
    kit: KIT, behind: 0, migrations: 'A\tsupabase/migrations/0100_months_ahead_pay.sql\nM\tlib/pay.ts', applied: '0099',
    dryRun: '0100', docker: [0], backups: [0], push: 0, functionsTouched: null, functionDirs: ['pay-feed'], functionsDiff: 'lib/pay.ts\nsupabase/functions/pay-feed/index.ts',
    ciAfterReady: 'green', deployments: [{ id: 7, environment: 'Production' }], deployState: 'success', smoke: '', mergeOk: true,
    ...opts,
  }
  const pr = { number: 34, title: 'V0.14.3.1: months ahead pay', state: 'OPEN', isDraft: true, headRefName: 'claude/months-ahead-pay-d6b9f3', headRefOid: HEAD,
    baseRefName: 'main', body: BODY, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', statusCheckRollup: skipped(),
    createdAt: '2026-10-21T08:00:00Z', mergedAt: null, mergeCommit: null, url: 'u', ...o.pr }
  const prs = { [pr.number]: pr, ...(o.prs ?? {}) }
  const calls = []
  const docker = [...o.docker]
  const backups = [...o.backups]
  const res = (status, stdout = '', stderr = '') => ({ status, stdout, stderr })
  const run = (cmd, args, { cwd } = {}) => {
    const line = `${cmd.replace(/^.*\/scripts\/prod-db\.sh$/, 'prod-db.sh')} ${args.join(' ')}`
    calls.push(line)
    if (cmd === 'git') {
      if (args[0] === 'show') return res(0, JSON.stringify(o.kit))
      if (args[0] === 'worktree' && args[1] === 'add') {
        const wt = args[3]
        mkdirSync(join(wt, 'scripts'), { recursive: true })
        writeFileSync(join(wt, 'scripts', 'prod-db.sh'), '')
        if (o.functionsTouched !== null) writeFileSync(join(wt, 'scripts', 'functions-touched.mjs'), '')
        if (o.functionDirs.length) mkdirSync(join(wt, 'supabase', 'functions'), { recursive: true })
        return res(0)
      }
      if (args[0] === 'worktree') { rmSync(args.at(-1), { recursive: true, force: true }); return res(0) }
      if (args[0] === 'diff' && args[1] === '--quiet') return res(0)
      if (args[0] === 'diff' && args[1] === '--name-status') return res(0, o.migrations)
      if (args[0] === 'diff' && args[1] === '--name-only') return res(0, o.functionsDiff)
      if (args[0] === 'ls-tree') return res(0, o.functionDirs.join('\n'))
      return res(0)
    }
    if (cmd === 'gh') {
      const [a, b, c] = args
      if (a === 'pr' && b === 'list') return res(0, JSON.stringify(Object.values(prs)))
      if (a === 'pr' && b === 'view') return res(0, JSON.stringify(prs[c]))
      if (a === 'pr' && b === 'ready') {
        prs[c].isDraft = false
        prs[c].statusCheckRollup = o.ciAfterReady === 'red' ? [...skipped(), { __typename: 'CheckRun', name: 'Checks', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/1' }]
          : green()
        return res(0)
      }
      if (a === 'pr' && b === 'update-branch') return res(1, '', 'merge conflict')
      if (a === 'pr' && b === 'merge') {
        if (!o.mergeOk) return res(1, '', 'Pull request is not mergeable')
        Object.assign(prs[c], { state: 'MERGED', mergeCommit: { oid: MERGE }, mergedAt: '2026-10-21T10:00:00Z' })
        return res(0)
      }
      if (a === 'api' && b.includes('/compare/')) return res(0, String(o.behind))
      if (a === 'api' && b.includes('/statuses')) return res(0, o.deployState)
      if (a === 'api' && b.includes('/deployments')) return res(0, JSON.stringify(o.deployments))
      return res(0)
    }
    if (cmd.endsWith('prod-db.sh')) {
      if (args[0] === 'migrations') return o.migrationsFail ?? res(0, o.applied.split(' ').map((v) => `   ${v}    |  ${v}   | x`).join('\n'))
      if (args[0] === 'backup') {
        const code = backups.length > 1 ? backups.shift() : backups[0]
        return code === 0 ? res(0, 'Backup complete: /b/2026-10-21-V0.14.3.1\n') : res(1, '', typeof code === 'string' ? code : 'prod-db: backup failed')
      }
      if (args[0] === 'dry-run') return res(0, `Parsed versions: ${o.dryRun}\n`)
      if (args[0] === 'push') return res(o.push, '', o.push ? 'ERROR: relation exists' : '')
      return res(0)
    }
    if (cmd === 'docker') return res(docker.length > 1 ? docker.shift() : docker[0])
    if (cmd === 'node') return res(0, o.functionsTouched ?? '')
    return res(0)
  }
  let clock = Date.parse('2026-10-21T10:00:00Z')
  const lines = []
  const io = { root: TMP, tmp: mkdtempSync(join(TMP, 'io-')), env: {}, run, sleep: (ms) => { clock += ms }, now: () => clock, log: (l) => lines.push(l), fetchOk: () => o.smoke }
  return { io, calls, lines, prs }
}
const production = (calls) => calls.filter((c) => /^prod-db\.sh (?:backup|push|setting)|^supabase functions deploy|^gh pr merge/.test(c))

describe('a deploy that goes through', () => {
  it('runs ready, CI, backup, dry run, push, functions, merge, host and smoke in that order', () => {
    const w = world()
    expect(deploy(['0.14.3.1'], w.io)).toBe(EXIT.DONE)
    const order = ['gh pr ready 34', 'prod-db.sh migrations', 'prod-db.sh backup 0.14.3.1', 'prod-db.sh dry-run', 'prod-db.sh push 0.14.3.1 0100',
      'supabase functions deploy pay-feed --project-ref prodrefprodrefprodre', `gh pr merge 34 --squash --match-head-commit ${HEAD}`, 'gh api repos/{owner}/{repo}/deployments?sha=']
    let at = -1
    for (const step of order) {
      const i = w.calls.findIndex((c, j) => j > at && c.startsWith(step))
      expect(i, `${step} after step ${at}: ${w.calls.join('\n')}`).toBeGreaterThan(at)
      at = i
    }
    expect(w.lines.at(-1)).toMatch(/^DONE: PR #34 merged \(bbbbbbb\); backup \/b\/2026-10-21-V0\.14\.3\.1; migrations 0100; functions pay-feed; live at https:\/\/app\.example\.com/)
    expect(w.calls.filter((c) => c.startsWith('git worktree remove'))).toHaveLength(1)
  })

  it('finds the PR by number too, and uses functions-touched when the project has it', () => {
    const w = world({ functionsTouched: 'calendar-feed\npay-feed\n' })
    expect(deploy(['#34'], w.io)).toBe(EXIT.DONE)
    expect(w.calls.filter((c) => c.startsWith('supabase functions deploy')).map((c) => c.split(' ')[3])).toEqual(['calendar-feed', 'pay-feed'])
  })

  it('skips the backup and push when production has the migrations, and the merge when the PR is merged', () => {
    const w = world({ applied: '0099 0100' })
    expect(deploy(['34'], w.io)).toBe(EXIT.DONE)
    expect(w.calls.some((c) => /^prod-db\.sh (?:backup|push)/.test(c))).toBe(false)
    const again = deploy(['34'], { ...w.io })
    expect(again).toBe(EXIT.DONE)
    expect(w.lines.some((l) => /already merged/.test(l))).toBe(true)
  })

  it('starts Docker when it is down and retries a failed backup, never skipping it', () => {
    const w = world({ docker: [1, 1, 0], backups: [1, 0] })
    expect(deploy(['34'], w.io)).toBe(EXIT.DONE)
    expect(w.calls).toContain('open -a Docker')
    expect(w.calls.filter((c) => c.startsWith('prod-db.sh backup'))).toHaveLength(2)
    expect(w.calls.findIndex((c) => c.startsWith('prod-db.sh push'))).toBeGreaterThan(w.calls.findLastIndex((c) => c.startsWith('prod-db.sh backup')))
  })

  it('ships a project with no database: ready, CI, merge, host, smoke', () => {
    const w = world({ kit: { production: 'on-merge', urls: { prod: 'https://me.example.com' }, ci: { workflow: 'ci.yml', jobs: JOBS } } })
    expect(deploy(['34'], w.io)).toBe(EXIT.DONE)
    expect(production(w.calls)).toEqual([`gh pr merge 34 --squash --match-head-commit ${HEAD}`])
    const none = world({ kit: { production: 'none', ci: { workflow: 'ci.yml', jobs: JOBS } } })
    expect(deploy(['34'], none.io)).toBe(EXIT.DONE)
    expect(none.calls.some((c) => c.includes('/deployments'))).toBe(false)
  })
})

describe('every stop comes before what it protects', () => {
  it('red CI: nothing reaches production', () => {
    const w = world({ ciAfterReady: 'red' })
    expect(deploy(['34'], w.io)).toBe(EXIT.CI_RED)
    expect(production(w.calls)).toEqual([])
    expect(w.lines.at(-2)).toMatch(/STOP ci_red: .*Checks: FAILURE \(https:\/\/ci\/1\)/)
    expect(w.lines.at(-1)).toMatch(/^NEXT: read the failing job/)
  })

  it('conflicts, or a branch GitHub can\'t bring up to date', () => {
    expect(deploy(['34'], world({ pr: { mergeable: 'CONFLICTING' } }).io)).toBe(EXIT.CONFLICT)
    const w = world({ behind: 2 })
    expect(deploy(['34'], w.io)).toBe(EXIT.CONFLICT)
    expect(production(w.calls)).toEqual([])
  })

  it('an unticked human step before the deploy waits for him, before production', () => {
    const w = world({ pr: { body: BODY.replace('before the deploy can finish\nNone', 'before the deploy can finish\n- [ ] Set RESEND_KEY in Supabase secrets') } })
    expect(deploy(['34'], w.io)).toBe(EXIT.WAITS)
    expect(production(w.calls)).toEqual([])
    expect(w.lines.at(-1)).toMatch(/Telegram/)
  })

  it('a step tagged [secret], [password] or [payment] holds the deploy, before production', () => {
    for (const tag of ['[secret]', '[password]', '[payment]']) {
      const w = world({ pr: { body: BODY.replace('before the deploy can finish\nNone', `before the deploy can finish\n- [ ] ${tag} Add the new key in the dashboard`) } })
      expect(deploy(['34'], w.io)).toBe(EXIT.WAITS)
      expect(production(w.calls)).toEqual([])
      expect(w.lines.at(-2)).toMatch(/STOP waits: .*Add the new key/)
      expect(w.calls.some((c) => c.startsWith('gh pr comment'))).toBe(false)
    }
  })

  it('any other unticked step never holds it: listed in one PR comment, and the deploy carries on', () => {
    const steps = '- [ ] Check the start page signed in\n- [ ] Tell the group the new page is up'
    const w = world({ pr: { body: BODY.replace('before the deploy can finish\nNone', `before the deploy can finish\n${steps}`) } })
    expect(deploy(['34'], w.io)).toBe(EXIT.DONE)
    const comment = w.calls.findIndex((c) => c.startsWith('gh pr comment 34 --body'))
    expect(comment).toBeGreaterThan(-1)
    expect(w.calls[comment]).toContain('Check the start page signed in')
    expect(w.calls[comment]).toContain('Tell the group the new page is up')
    expect(comment).toBeLessThan(w.calls.findIndex((c) => c.startsWith('prod-db.sh backup')))
  })

  it('a re-run does not write the same comment twice, and a held step still lists the rest', () => {
    const steps = '- [ ] Check the start page signed in'
    const body = BODY.replace('before the deploy can finish\nNone', `before the deploy can finish\n${steps}`)
    const w = world({ pr: { body, comments: [{ body: leftStepsComment([steps]) }] } })
    expect(deploy(['34'], w.io)).toBe(EXIT.DONE)
    expect(w.calls.some((c) => c.startsWith('gh pr comment'))).toBe(false)
    const both = world({ pr: { body: body.replace(steps, `${steps}\n- [ ] [secret] Set the mail key`) } })
    expect(deploy(['34'], both.io)).toBe(EXIT.WAITS)
    expect(both.calls.filter((c) => c.startsWith('gh pr comment'))).toHaveLength(1)
    expect(both.lines.at(-2)).not.toMatch(/start page/)
  })

  it('a dry run that is not the PR\'s migrations: after the backup, before the push', () => {
    const w = world({ dryRun: '0100 0101' })
    expect(deploy(['34'], w.io)).toBe(EXIT.MIGRATIONS)
    expect(production(w.calls)).toEqual(['prod-db.sh backup 0.14.3.1'])
  })

  it('an edited migration stops before the backup', () => {
    const w = world({ migrations: 'M\tsupabase/migrations/0099_old.sql\nA\tsupabase/migrations/0100_new.sql' })
    expect(deploy(['34'], w.io)).toBe(EXIT.MIGRATIONS)
    expect(production(w.calls)).toEqual([])
  })

  it('a backup that fails three times stops the push', () => {
    const w = world({ backups: [1] })
    expect(deploy(['34'], w.io)).toBe(EXIT.BACKUP)
    expect(w.calls.filter((c) => c.startsWith('prod-db.sh backup'))).toHaveLength(3)
    expect(w.calls.some((c) => c.startsWith('prod-db.sh push'))).toBe(false)
  })

  it('a missing Keychain item is his to add', () => {
    const w = world({ backups: ['prod-db: no Keychain item x-prod. Add it in your own terminal: security add-generic-password'] })
    expect(deploy(['34'], w.io)).toBe(EXIT.WAITS)
    expect(w.calls.filter((c) => c.startsWith('prod-db.sh backup'))).toHaveLength(1)
  })

  it('a failed push or a refused merge stops before the next step', () => {
    const push = world({ push: 1 })
    expect(deploy(['34'], push.io)).toBe(EXIT.PUSH)
    expect(push.calls.some((c) => c.startsWith('gh pr merge'))).toBe(false)
    expect(deploy(['34'], world({ mergeOk: false }).io)).toBe(EXIT.CONFLICT)
  })

  it('a host deploy that fails, or a smoke that fails, after the merge', () => {
    expect(deploy(['34'], world({ deployState: 'failure' }).io)).toBe(EXIT.HOST)
    expect(deploy(['34'], world({ smoke: 'HTTP 500' }).io)).toBe(EXIT.SMOKE)
    expect(deploy(['34'], world({ deployments: [], smoke: '' }).io)).toBe(EXIT.DONE)
  })

  it('a bad argument, a closed PR, two open PRs for one version', () => {
    expect(deploy(['main'], world().io)).toBe(EXIT.SETUP)
    expect(deploy(['34'], world({ pr: { state: 'CLOSED' } }).io)).toBe(EXIT.SETUP)
    const two = world({ prs: { 35: { number: 35, title: 'Fix V0.14.3.1 again', state: 'OPEN', headRefName: 'x' } } })
    expect(deploy(['0.14.3.1'], two.io)).toBe(EXIT.SETUP)
  })
})

describe('a fix-forward under the same go', () => {
  const merged = { state: 'MERGED', mergedAt: '2026-10-21T09:00:00Z', mergeCommit: { oid: MERGE } }
  const ff = (body, createdAt = '2026-10-21T09:30:00Z') => ({ 40: { number: 40, title: 'Fix the pay card', state: 'OPEN', isDraft: true, headRefName: 'claude/fix', headRefOid: HEAD, baseRefName: 'main',
    body, mergeable: 'MERGEABLE', statusCheckRollup: skipped(), createdAt } })
  it('deploys a PR that says it is the fix-forward, opened after the merge', () => {
    const w = world({ pr: merged, prs: ff(`Fix-forward for #34.\n${BODY}`), migrations: 'M\tlib/pay.ts', functionsDiff: '' })
    expect(deploy(['34', '40'], w.io)).toBe(EXIT.DONE)
    expect(w.calls).toContain(`gh pr merge 40 --squash --match-head-commit ${HEAD}`)
  })
  it('finds the merged release by version even when the fix-forward names it too', () => {
    const prs = ff(`Fix-forward for #34.\n${BODY}`)
    prs[40].title = 'V0.14.3.1 fix-forward: the pay card'
    const w = world({ pr: merged, prs, migrations: 'M\tlib/pay.ts', functionsDiff: '' })
    expect(deploy(['0.14.3.1', '40'], w.io)).toBe(EXIT.DONE)
    expect(w.calls).toContain(`gh pr merge 40 --squash --match-head-commit ${HEAD}`)
  })

  it('refuses one that does not say so, or came before the merge', () => {
    expect(deploy(['34', '40'], world({ pr: merged, prs: ff(BODY) }).io)).toBe(EXIT.SETUP)
    expect(deploy(['34', '40'], world({ pr: merged, prs: ff('Fix-forward for #34', '2026-10-21T08:30:00Z') }).io)).toBe(EXIT.SETUP)
    expect(deploy(['34', '40'], world({ prs: ff('Fix-forward for #34') }).io)).toBe(EXIT.SETUP)
  })
})

describe('the helpers', () => {
  it('parseGo: a bare number is a PR, dotted is a version', () => {
    expect(parseGo('34')).toEqual({ pr: 34 })
    expect(parseGo('#34')).toEqual({ pr: 34 })
    expect(parseGo('V0.14.3.1')).toEqual({ version: '0.14.3.1' })
    expect(parseGo('kit')).toBeNull()
  })

  it('a version names a PR by its branch or as a word of its title, never a longer version', () => {
    expect(namesVersion({ headRefName: 'V0.14', title: '' }, '0.14')).toBe(true)
    expect(namesVersion({ headRefName: 'x', title: 'V0.14.3.1: months ahead pay' }, '0.14.3.1')).toBe(true)
    expect(namesVersion({ headRefName: 'x', title: 'Burrow 0.14.3.1 fix' }, '0.14.3.1')).toBe(true)
    expect(namesVersion({ headRefName: 'x', title: 'V0.14.3.10' }, '0.14.3.1')).toBe(false)
    expect(namesVersion({ headRefName: 'x', title: 'V0.14.3.1' }, '0.14.3')).toBe(false)
    expect(namesVersion({ headRefName: 'x', title: 'V10.14.3.1' }, '0.14.3.1')).toBe(false)
    expect(versionOf({ number: 34, headRefName: 'x', title: 'V0.14.3.1: pay' })).toBe('0.14.3.1')
    expect(versionOf({ number: 34, headRefName: 'x', title: 'pay' })).toBe('34')
    expect(pickPr([{ number: 1, title: 'V2.1', state: 'MERGED', mergedAt: '2026-01-01' }], '2.1')).toEqual({ number: 1 })
    expect(pickPr([], '2.1').refuse).toMatch(/no PR names V2\.1/)
  })

  it('ciState: skipped draft runs are pending, a failure is red, all passed is green', () => {
    expect(ciState(skipped(), JOBS).state).toBe('pending')
    expect(ciState([], JOBS).state).toBe('pending')
    expect(ciState([...skipped(), ...green()], JOBS).state).toBe('green')
    expect(ciState([...green(), { __typename: 'StatusContext', context: 'Vercel', state: 'PENDING' }], JOBS).state).toBe('pending')
    expect(ciState([...green(), { __typename: 'StatusContext', context: 'Vercel', state: 'FAILURE' }], JOBS).state).toBe('red')
    expect(ciState([{ __typename: 'CheckRun', name: 'Checks', workflowName: 'CI', status: 'IN_PROGRESS' }, green()[1]], JOBS).state).toBe('pending')
  })

  it('migrationChanges: new files to push, any other change to one stops', () => {
    expect(migrationChanges('A\tsupabase/migrations/0101_b.sql\nA\tsupabase/migrations/0100_a.sql\nM\tapp/x.ts')).toEqual({ added: ['0100', '0101'], edited: [] })
    expect(migrationChanges('M\tsupabase/migrations/0099_x.sql').edited).toHaveLength(1)
    expect(migrationChanges('D\tsupabase/migrations/0099_x.sql').edited).toHaveLength(1)
    expect(migrationChanges('R100\tsupabase/migrations/0100_a.sql\tsupabase/migrations/0101_a.sql').edited).toHaveLength(1)
    expect(migrationChanges('R100\tdrafts/a.sql\tsupabase/migrations/0101_a.sql')).toEqual({ added: ['0101'], edited: [] })
    expect(migrationChanges('A\tsupabase/migrations/README.md').edited).toHaveLength(1)
  })

  it('touchedFunctions: own folders, or all when a shared file changed', () => {
    expect(touchedFunctions('supabase/functions/a/index.ts\napp/x.ts', ['a', 'b'])).toEqual(['a'])
    expect(touchedFunctions('supabase/functions/_shared/x.ts', ['b', 'a'])).toEqual(['a', 'b'])
    expect(touchedFunctions('supabase/functions/deno.json', ['a'])).toEqual(['a'])
    expect(touchedFunctions('app/x.ts', ['a'])).toEqual([])
  })

  it('openHumanSteps: unticked items only, None and ticked ones are done', () => {
    const body = '### Human steps before the deploy can finish\n- [x] Set A\n- [ ] Set B\n- [ ] None\n### Human steps afterwards\n- [ ] Look on the phone\n'
    expect(openHumanSteps(body)).toEqual(['- [ ] Set B'])
    expect(openHumanSteps('### Human steps before the deploy can finish\nNone\n')).toEqual([])
  })

  it('holdsDeploy: the three tags, or a step that names a secret, a password or a payment', () => {
    expect(holdsDeploy('- [ ] [secret] Add MAIL_KEY')).toBe(true)
    expect(holdsDeploy('- [ ] [Password] Store the database password')).toBe(true)
    expect(holdsDeploy('- [ ] [payment] Upgrade the plan')).toBe(true)
    expect(holdsDeploy('- [ ] Set RESEND_KEY in Supabase secrets')).toBe(true)
    expect(holdsDeploy('- [ ] Check the start page')).toBe(false)
    expect(holdsDeploy('- [ ] Confirm the dates with the group')).toBe(false)
  })

  it('alreadyListed: a marked comment that names every step', () => {
    const c = [{ body: leftStepsComment(['- [ ] A', '- [ ] B']) }]
    expect(alreadyListed(c, ['- [ ] A'])).toBe(true)
    expect(alreadyListed(c, ['- [ ] A', '- [ ] C'])).toBe(false)
    expect(alreadyListed([{ body: '- [ ] A' }], ['- [ ] A'])).toBe(false)
    expect(alreadyListed(undefined, ['- [ ] A'])).toBe(false)
  })
})
