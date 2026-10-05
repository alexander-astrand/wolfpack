// First: the tests' project and its kit.json (the fixture's values).
import './fixtures/kit-project.mjs'
// C1 (2.12.2): the arm takes a merge-only release, but only when its
// Production steps say None in words and its diff has no migration or
// function. The older parser tests live in guard-production.test.mjs.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  GH_FILES_MS, PLAN_TITLE, allowedCommands, armList, completeFiles, gitFacts, mergeOnlyWhyNot, migrationsWhyNot, parseGitFacts, parseProductionSteps,
  planCalls, planCheck, planCheckText, planLines, prFacts, previewText, withCompleteFiles,
} from './production-steps.mjs'

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
const cli = fileURLToPath(new URL('./production-steps.mjs', import.meta.url))
// The plugin's own copy of the arm script; its test is skipped until it's pasted in (the guard refuses an agent's copy).
const script = fileURLToPath(new URL('../scripts/full-auto.sh', import.meta.url))
const SHA = '0123456789abcdef0123456789abcdef01234567'
const frontend = { files: ['src/pages/EventPage.tsx', 'README.md'], isDraft: true }
const ghJson = (body, over = {}) => JSON.stringify({
  body, isDraft: true, files: frontend.files.map((path) => ({ path, additions: 1, deletions: 0 })), changedFiles: frontend.files.length, ...over,
})
// A throwaway repo with origin/main and a head on top (2.12.4): the CLI reads
// git's diff and tree there, as arm does in the checkout.
function repo({ base = () => {}, change = () => {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'c1-git-'))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text) }
  const link = (path, to) => { mkdirSync(join(dir, path, '..'), { recursive: true }); symlinkSync(to, join(dir, path)) }
  git('init', '-q')
  put('README.md', 'x\n')
  put('src/util.ts', 'export {}\n')
  put('supabase/migrations/0050_x.sql', 'select 1;\n')
  put('supabase/functions/notify/index.ts', "import './util.ts'\n")
  base({ put, link, git })
  git('add', '-A')
  git('commit', '-qm', 'base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  change({ put, link, git })
  git('add', '-A')
  git('commit', '-qm', 'head')
  return { dir, sha: git('rev-parse', 'HEAD'), done: () => rmSync(dir, { recursive: true, force: true }) }
}
// gh on PATH for the CLI's own head lookup (preview and check-plan).
function ghStub(dir) {
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
case "$*" in
  "pr list "*) echo "46 V9.9.9" ;;
  *"--json headRefOid"*) echo "\${C1_SHA:-${SHA}}" ;;
  *"--json number,body,isDraft,files,changedFiles"*) cat "$C1_JSON" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`)
  chmodSync(join(dir, 'gh'), 0o755)
}

// A body in the template's shape with the three parts filled in as given.
const steps = ({ before = 'None.', after = 'None.', human = '- None.' } = {}) =>
  `## Production steps\n\n### Before merge\n${before}\n\n### After merge\n${after}\n\n### Human steps before the deploy can finish\n${human}\n\n### Human steps afterwards\n- A phone test.\n\n## Notes for review\n`

describe('C1: a merge-only release', () => {
  it('C1: arms a merge-only release when Before merge and After merge both say None', () => {
    const body = fixture('merge-only-body.md')
    expect(parseProductionSteps(body, 46)).toEqual([])
    expect(mergeOnlyWhyNot(body)).toBeNull()
    expect(armList(body, 46, frontend)).toEqual({ commands: ['gh pr ready 46', 'gh pr merge 46 --squash --admin'], mergeOnly: true })
    // Out of draft already: the merge alone.
    expect(armList(body, 46, { ...frontend, isDraft: false })).toEqual({ commands: ['gh pr merge 46 --squash --admin'], mergeOnly: true })
    // The template's other spellings of None.
    for (const none of ['None', '"None".', '1. None', '- [x] None', '* None.']) {
      expect(mergeOnlyWhyNot(steps({ before: none, after: none, human: none })), none).toBeNull()
    }
    // What arm writes, through the CLI as scripts/full-auto.sh calls it, in a
    // checkout where git can read the head (2.12.4).
    const r = repo({ change: ({ put }) => put('src/pages/EventPage.tsx', 'x\n') })
    try {
      const marker = JSON.parse(execFileSync('node', [cli, '9.9.9', '46', r.sha, '4', '--pr-json'], { cwd: r.dir, input: ghJson(body), encoding: 'utf8' }))
      expect(marker).toMatchObject({ version: '9.9.9', pr: 46, headSha: r.sha, mergeOnly: true, commands: ['gh pr ready 46', 'gh pr merge 46 --squash --admin'] })
    } finally {
      r.done()
    }
  })

  it('C1: refuses when the Production steps section is missing', () => {
    expect(armList('## What changed\n\n1. A button.\n', 46, frontend).refuse).toMatch(/no "## Production steps" section/)
    expect(armList('', 46, frontend).refuse).toMatch(/no "## Production steps" section/)
    // Only inside an HTML comment is the same as missing.
    expect(armList(`<!--\n${steps()}-->\n`, 46, frontend).refuse).toMatch(/no "## Production steps" section/)
    // A part missing, doubled, or a second section that could hide commands.
    expect(armList(steps().replace('### After merge\nNone.\n', ''), 46, frontend).refuse).toMatch(/no "### After merge" part/)
    expect(armList(steps().replace('## Notes', '### Before merge\nNone.\n\n## Notes'), 46, frontend).refuse).toMatch(/"Before merge" appears twice/)
    expect(armList(steps() + steps(), 46, frontend).refuse).toMatch(/more than one "## Production steps" section/)
    // The template's one-line frontend-only form has no parts to read.
    expect(armList('## Production steps\n\nNone: frontend only, ships on merge.\n', 46, frontend).refuse).toMatch(/no "### Before merge" part/)
  })

  it('C1: refuses when a part is empty rather than None', () => {
    expect(armList(steps({ before: '' }), 46, frontend).refuse).toMatch(/"Before merge" is empty/)
    // A comment is not a word: the template's own comment under After merge.
    expect(armList(steps({ after: '<!-- Vercel ships the frontend when this merges. -->' }), 46, frontend).refuse).toMatch(/"After merge" is empty/)
    expect(armList(steps({ human: '' }), 46, frontend).refuse).toMatch(/"Human steps before the deploy can finish" is empty/)
  })

  it("C1: refuses when a list item can't be parsed", () => {
    const refuse = (parts) => armList(steps(parts), 46, frontend).refuse
    expect(refuse({ before: '1. Run the backup by hand' })).toMatch(/"Before merge" doesn't read None: "1. Run the backup by hand" is neither None nor a command/)
    // A command the parser can't take isn't None either, even beside a None.
    expect(refuse({ after: 'None.\n- `scripts/prod-db.sh setting a`' })).toMatch(/"After merge" doesn't read None/)
    expect(refuse({ after: '1. `supabase functions deploy notify --project-ref <other>`' })).toMatch(/"After merge" doesn't read None/)
    expect(refuse({ before: 'None of the above' })).toMatch(/doesn't read None/)
    expect(refuse({ before: 'None.\nNone.' })).toMatch(/says None more than once/)
    expect(refuse({ before: '#### Later\nNone.' })).toMatch(/doesn't read None/)
  })

  it('C1: refuses merge-only when the diff has a migration or a function', () => {
    const body = fixture('merge-only-body.md')
    const refuse = (files) => armList(body, 46, { ...frontend, files: [...frontend.files, ...files] }).refuse
    expect(refuse(['supabase/migrations/0053_maps.sql'])).toMatch(/the diff changes supabase\/migrations\/0053_maps\.sql: a migration or a function/)
    expect(refuse(['supabase/functions/notify/index.ts'])).toMatch(/supabase\/functions\/notify\/index\.ts/)
    expect(refuse(['supabase/functions/_shared/eventKinds.ts'])).toMatch(/_shared/)
    expect(refuse(['Supabase/Migrations/0053.sql'])).toMatch(/a migration or a function/)
    // Through gh's JSON too.
    expect(() => execFileSync('node', [cli, '9.9.9', '46', SHA, '4', '--pr-json'], {
      input: ghJson(body, { files: [{ path: 'supabase/migrations/0053_maps.sql' }], changedFiles: 1 }), stdio: 'pipe',
    })).toThrow(/a migration or a function/)
  })

  it("C1: refuses when the files list can't be read", () => {
    const body = fixture('merge-only-body.md')
    expect(armList(body, 46).refuse).toMatch(/changed files couldn't be read/)
    expect(armList(body, 46, { files: null, isDraft: true }).refuse).toMatch(/changed files couldn't be read/)
    expect(armList(body, 46, { files: [{ path: 'src/x.ts' }], isDraft: true }).refuse).toMatch(/changed files couldn't be read/)
    expect(armList(body, 46, { files: frontend.files, isDraft: null }).refuse).toMatch(/draft couldn't be read/)
    // gh's list cut short (fewer paths than changedFiles), or not a list: unread.
    expect(prFacts(ghJson(body, { changedFiles: 150 })).files).toBeNull()
    expect(prFacts(ghJson(body, { files: 'src/x.ts' })).files).toBeNull()
    expect(prFacts(ghJson(body, { files: [{ name: 'x' }], changedFiles: 1 })).files).toBeNull()
    expect(prFacts('')).toBeNull()
    expect(prFacts('gh: HTTP 502')).toBeNull()
    expect(prFacts('{"number": 46}')).toBeNull()
    // The CLI: a bare body (files unknown) and a failed gh call both refuse.
    for (const [input, args] of [[body, []], ['', ['--pr-json']], ['not json', ['--pr-json']]]) {
      expect(() => execFileSync('node', [cli, '9.9.9', '46', SHA, '4', ...args], { input, stdio: 'pipe' }), args.join()).toThrow()
    }
  })

  it('C1: refuses when a human step before the deploy is listed', () => {
    for (const human of ['- [ ] Set the VAPID secret', '- [x] Set the VAPID secret', '- [x] None.\n- [ ] Set the VAPID secret']) {
      expect(armList(steps({ human }), 46, frontend).refuse, human).toMatch(/"Human steps before the deploy can finish" doesn't read None/)
    }
  })

  it('C1: a release with commands parses exactly as before', () => {
    const body = fixture('pr-44-body.md')
    const three = ['scripts/prod-db.sh backup 2.12.1', 'scripts/prod-db.sh dry-run', 'scripts/prod-db.sh push 2.12.1 0052']
    expect(parseProductionSteps(body, 44)).toEqual(three)
    const expected = { commands: [...three, 'gh pr ready 44', 'gh pr merge 44 --squash', 'gh pr merge 44 --squash --admin'], mergeOnly: false }
    expect(allowedCommands(body, 44)).toEqual(expected.commands)
    // Files and draft state don't matter to a release with commands.
    for (const facts of [undefined, {}, { files: ['supabase/migrations/0052_x.sql'], isDraft: false }]) expect(armList(body, 44, facts)).toEqual(expected)
    const marker = JSON.parse(execFileSync('node', [cli, '2.12.1', '44', SHA, '4'], { input: body, encoding: 'utf8' }))
    expect(marker.commands).toEqual(expected.commands)
    expect(marker).not.toHaveProperty('mergeOnly')
    expect(JSON.parse(execFileSync('node', [cli, '2.12.1', '44', SHA, '4', '--pr-json'], { input: ghJson(body), encoding: 'utf8' })).commands).toEqual(expected.commands)
  })

  it.skipIf(!existsSync(script))('C1: preview says merge-only and lists the two calls', () => {
    const body = fixture('merge-only-body.md')
    const text = previewText(body, 46, frontend)
    expect(text).toMatch(/^arm would arm a merge-only release .*for 4 hours:\n {2}1\. gh pr ready 46\n {2}2\. gh pr merge 46 --squash --admin\n$/)
    expect(previewText(body, 46).startsWith('arm would refuse:')).toBe(true)

    const dir = mkdtempSync(join(tmpdir(), 'c1-gh-'))
    const r = repo({ change: ({ put }) => put('src/pages/EventPage.tsx', 'x\n') })
    try {
      ghStub(dir)
      // The CLI looks the PR's head up with gh and reads git there (2.12.4).
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, C1_SHA: r.sha }
      expect(execFileSync('node', [cli, 'preview', '46', '--pr-json'], { cwd: r.dir, env, input: ghJson(body), encoding: 'utf8' })).toBe(text)

      // The script end to end, with gh stubbed on PATH; preview writes nothing.
      const json = join(dir, 'pr.json')
      writeFileSync(json, ghJson(body))
      const preview = (file) => execFileSync('bash', [script, 'preview', '9.9.9'], {
        encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, C1_JSON: file },
      })
      const out = preview(json)
      // The stub's head isn't a commit git has, so merge-only is refused there.
      const unread = previewText(body, 46, { ...frontend, git: null })
      expect(unread).toMatch(/^arm would refuse: .*git's diff against origin\/main couldn't be read/)
      expect(out.startsWith(`Preview for V9.9.9, PR #46 at 0123456. Nothing is armed or written.\n${unread}`)).toBe(true)
      // Then the one-tap verdict, one line per condition (2.12.3). This stub
      // gives no PR list, so it can't pass.
      expect(out).toMatch(/\nOne-tap arm for V9\.9\.9: refused[^\n]*\n {2}(?:ok|no) {2}in the arm given at the start/)
      // gh failing on the PR read: no merge-only, just a refusal.
      expect(preview(join(dir, 'missing.json'))).not.toMatch(/merge-only|gh pr merge/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      r.done()
    }
  })
})

// 2.12.4 (yoda's review 4, C1): gh lists a rename by its new path only, and a
// symlink under supabase/ can change a function the diff never names. The
// CLI reads git's diff (both paths) and tree at the head arm is given.
describe('2.12.4: C1 reads renames and symlinks with git', () => {
  const body = fixture('merge-only-body.md')
  const gh = (files) => ghJson(body, { files: files.map((path) => ({ path })), changedFiles: files.length })
  const arm = (r, files, sha = r.sha) => execFileSync('node', [cli, '9.9.9', '46', sha, '4', '--pr-json'], { cwd: r.dir, input: gh(files), encoding: 'utf8', stdio: 'pipe' })
  const refusal = (r, files, sha) => {
    try { arm(r, files, sha) } catch (e) { return String(e.stderr) }
    return ''
  }

  it('near misses: a frontend change, and a symlink outside supabase/, still arm merge-only', () => {
    const r = repo({ change: ({ put, link }) => { put('README.md', 'y\n'); link('docs/readme.md', '../README.md') } })
    try {
      expect(gitFacts(r.sha, r.dir)).toEqual({ changed: ['README.md', 'docs/readme.md'], links: [] })
      expect(JSON.parse(arm(r, ['README.md', 'docs/readme.md']))).toMatchObject({ mergeOnly: true, headSha: r.sha, commands: ['gh pr ready 46', 'gh pr merge 46 --squash --admin'] })
    } finally {
      r.done()
    }
  })

  it('refuses a merged migration renamed out of supabase/migrations/, which gh lists by its new path only', () => {
    const r = repo({ change: ({ put, git }) => { put('docs/.keep', ''); git('mv', 'supabase/migrations/0050_x.sql', 'docs/0050_x.sql') } })
    try {
      const files = ['docs/.keep', 'docs/0050_x.sql']
      // gh's list alone passed it (the gap).
      expect(armList(body, 46, { files, isDraft: true }).mergeOnly).toBe(true)
      expect(gitFacts(r.sha, r.dir).changed).toContain('supabase/migrations/0050_x.sql')
      expect(refusal(r, files)).toMatch(/the diff changes supabase\/migrations\/0050_x\.sql \(git's list, a rename's old path too\)/)
    } finally {
      r.done()
    }
  })

  it('refuses any symlink under supabase/, in the tree or in the diff', () => {
    // On main already: the PR changes only the file the function's link points at.
    const onMain = repo({ base: ({ link }) => link('supabase/functions/notify/util.ts', '../../../src/util.ts'), change: ({ put }) => put('src/util.ts', 'export const x = 1\n') })
    // New in the PR, outside migrations/ and functions/.
    const added = repo({ change: ({ link }) => link('supabase/seed.sql', '../README.md') })
    try {
      expect(armList(body, 46, { files: ['src/util.ts'], isDraft: true }).mergeOnly).toBe(true)
      expect(refusal(onMain, ['src/util.ts'])).toMatch(/supabase\/functions\/notify\/util\.ts under supabase\/ is a symlink/)
      expect(refusal(added, ['supabase/seed.sql'])).toMatch(/supabase\/seed\.sql under supabase\/ is a symlink/)
    } finally {
      onMain.done()
      added.done()
    }
  })

  it("refuses when git can't read the head, and reads git's output strictly", () => {
    const r = repo({ change: ({ put }) => put('README.md', 'y\n') })
    try {
      expect(refusal(r, ['README.md'], SHA)).toMatch(/git's diff against origin\/main couldn't be read/)
    } finally {
      r.done()
    }
    expect(armList(body, 46, { ...frontend, git: null }).refuse).toMatch(/git's diff against origin\/main couldn't be read/)
    expect(armList(body, 46, { ...frontend, git: { changed: ['x'] } }).refuse).toMatch(/couldn't be read/)
    // No git key at all (the one-tap verdict and the guard's ask): gh's list only.
    expect(armList(body, 46, frontend).mergeOnly).toBe(true)
    expect(gitFacts('not-a-sha')).toBeNull()
    expect(parseGitFacts('garbage', '')).toBeNull()
    expect(parseGitFacts(':100644 100644 aa bb R100\0old\0', '')).toBeNull()
    expect(parseGitFacts(':100644 100644 aa bb R100\0supabase/migrations/1.sql\0docs/1.sql\0', '120000 blob cc\tSupabase/x\0')).toEqual({
      changed: ['supabase/migrations/1.sql', 'docs/1.sql'], links: ['Supabase/x'],
    })
    // A release with commands never reads git.
    expect(armList(fixture('pr-44-body.md'), 44, { get git() { throw new Error('read') } }).mergeOnly).toBe(false)
  })
})

// 2.12.3: the plan-vs-PR check that replaces yoda's chain verdict. A script:
// ranjit's planned production calls against the list arm derives from the PR.
describe('2.12.3: the plan check', () => {
  const DB = steps({ before: '1. `scripts/prod-db.sh backup 2.13`\n2. `scripts/prod-db.sh push 2.13 0053`', after: '1. `supabase functions deploy notify --project-ref <prod-ref>`' })
  const facts = { files: ['README.md', 'supabase/migrations/0053_comment_app_settings.sql'], isDraft: true }
  const GOOD = [
    '1. Backup: `scripts/prod-db.sh backup 2.13`',
    '2. `scripts/prod-db.sh migrations` (a read, not checked)',
    '3. `scripts/prod-db.sh push 2.13 0053`',
    '4. supabase functions deploy notify --project-ref prodrefprodrefprodre',
    '5. `gh pr checks 50` and `gh pr view 50 --json mergeable`',
    '6. `gh pr ready 50`',
    '7. Merge: `gh pr merge 50 --squash --admin`',
  ].join('\n')
  const check = (plan, over = {}, body = DB) => planCheck(plan, body, '2.13', 50, { ...facts, ...over })

  it('passes a plan with every step once, in order, backup first and the merge last', () => {
    const out = check(GOOD)
    expect(out.problems).toEqual([])
    expect(out.calls).toEqual([
      'scripts/prod-db.sh backup 2.13', 'scripts/prod-db.sh push 2.13 0053', 'supabase functions deploy notify --project-ref prodrefprodrefprodre',
      'gh pr ready 50', 'gh pr merge 50 --squash --admin',
    ])
    expect(planCheckText(out, '2.13', 50)).toMatch(/^Plan check for V2\.13 \(PR #50\): the plan matches the PR: 5 production calls, the backup first, the merge last\.\n {2}1\. scripts\/prod-db\.sh backup 2\.13\n/)
    // Merge-only: ready and the merge, nothing else.
    expect(planCheck('`gh pr ready 50`\n`gh pr merge 50 --squash --admin`', steps(), '2.13', 50, frontend).problems).toEqual([])
  })

  it('refuses a plan that differs from the PR, one problem per line', () => {
    const cases = [
      [GOOD.replace('3. `scripts/prod-db.sh push 2.13 0053`\n', ''), "the PR's step `scripts/prod-db.sh push 2.13 0053` isn't in the plan"],
      [GOOD.replace('push 2.13 0053', 'push 2.13 0053 0054'), "`scripts/prod-db.sh push 2.13 0053 0054` isn't on the list arm derives from the PR"],
      [GOOD + '\n8. `scripts/prod-db.sh setting notify_url x`', "`scripts/prod-db.sh setting notify_url x` isn't on the list"],
      [GOOD.replace('prodrefprodrefprodre', 'devrefdevrefdevrefde'), "isn't on the list arm derives from the PR"],
      [GOOD.replace('1. Backup: `scripts/prod-db.sh backup 2.13`\n', '') + '\n`scripts/prod-db.sh backup 2.13`', "`scripts/prod-db.sh backup 2.13` isn't the first production call"],
      [GOOD.replace('7. Merge: `gh pr merge 50 --squash --admin`', ''), 'the plan has no merge'],
      [GOOD + '\n`gh pr merge 50 --squash`', 'the plan merges more than once'],
      [GOOD.replace('4. supabase functions deploy notify --project-ref prodrefprodrefprodre\n', '') + '\nsupabase functions deploy notify --project-ref prodrefprodrefprodre', "the merge isn't the last production call"],
      [GOOD.replace('6. `gh pr ready 50`\n', ''), "the PR is a draft, and the plan doesn't mark it ready"],
      [GOOD.replace('6. `gh pr ready 50`\n', '').replace('1. Backup', '0. `gh pr ready 50`\n1. Backup'), "`gh pr ready 50` isn't the step right before the merge"],
      [GOOD + '\n`scripts/prod-db.sh backup 2.13`', 'is in the plan twice'],
      [GOOD.replace('`scripts/prod-db.sh push 2.13 0053`', '`scripts/prod-db.sh backup 2.13`').replace('1. Backup: `scripts/prod-db.sh backup 2.13`', '1. `scripts/prod-db.sh push 2.13 0053`'), "the steps aren't in the PR's order"],
      [GOOD + '\n`supabase db push`', "`supabase db push` isn't on the list"],
    ]
    for (const [plan, why] of cases) expect(check(plan).problems.join('\n'), why).toContain(why)
    expect(check(GOOD, { isDraft: false }).problems).toEqual(["the PR isn't a draft, so `gh pr ready 50` is extra"])
    // The migrations are the PR's files.
    expect(check(GOOD, { files: ['supabase/migrations/0053_a.sql', 'supabase/migrations/0054_b.sql'] }).problems).toEqual(["the pushes (0053) aren't the PR's migration files (0053 0054)"])
    expect(check(GOOD, { files: null }).problems.join()).toContain("the PR's changed files couldn't be read")
    // What arm would refuse, the check refuses too.
    expect(check(GOOD, {}, '## Notes\n').problems[0]).toMatch(/Production steps list no command/)
    expect(planCheckText(check(''), '2.13', 50)).toMatch(/^Plan check for V2\.13 \(PR #50\): the plan doesn't match the PR\. A hard stop; fix the plan and check again\.\n {2}- /)
  })

  it('reads plan lines as list items, labels or code spans, and leaves reads and prose out', () => {
    expect(planCalls('- [ ] `gh pr ready 50`\n* Merge: gh pr merge 50 --squash\n# a note: gh pr merge 1\nThen `gh pr view 50`\n3) scripts/prod-db.sh dry-run')).toEqual([
      'gh pr ready 50', 'gh pr merge 50 --squash', 'scripts/prod-db.sh dry-run',
    ])
  })

  it('check-plan on the command line: exit 0 on a match, 1 with the problems', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-'))
    try {
      writeFileSync(join(dir, 'plan.md'), GOOD)
      const json = JSON.stringify({ body: DB, isDraft: true, files: facts.files.map((path) => ({ path })), changedFiles: 2 })
      expect(execFileSync('node', [cli, 'check-plan', '2.13', '50', join(dir, 'plan.md'), '--pr-json'], { input: json, encoding: 'utf8' })).toMatch(/the plan matches the PR/)
      writeFileSync(join(dir, 'bad.md'), GOOD.replace('7. Merge: `gh pr merge 50 --squash --admin`', ''))
      let err
      try { execFileSync('node', [cli, 'check-plan', '2.13', '50', join(dir, 'bad.md'), '--pr-json'], { input: json, encoding: 'utf8', stdio: 'pipe' }) } catch (e) { err = e }
      expect(err?.status).toBe(1)
      expect(err?.stdout).toContain('the plan has no merge')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// 2.14.6 (Guard round two, step 3): the arm reads past gh's 100 files, one
// push per release, and preview prints the plan ranjit copies.
describe('2.14.6: every file, one push, and the plan to copy', () => {
  const many = Array.from({ length: 132 }, (_, i) => `src/f${String(i).padStart(3, '0')}.ts`)
  // 2.13.8's shape: gh gives the first 100 of 132.
  const cut = { number: 77, body: steps(), isDraft: true, files: many.slice(0, 100).map((path) => ({ path })), changedFiles: 132 }

  it('[pr-size]: 100 of 132 files and the paged read make the list complete, and merge-only arms', () => {
    const asked = []
    expect(completeFiles(cut, (n) => { asked.push(n); return many })).toEqual(many)
    expect(asked).toEqual([77])
    const facts = prFacts(JSON.stringify(withCompleteFiles(cut, () => many)))
    expect(facts.files).toHaveLength(132)
    expect(armList(facts.body, 77, facts)).toEqual({ commands: ['gh pr ready 77', 'gh pr merge 77 --squash --admin'], mergeOnly: true })
    // A migration on the second page is seen, not passed as none.
    const hidden = [...many.slice(0, 131), 'supabase/migrations/0071_x.sql']
    expect(armList(cut.body, 77, { ...facts, files: completeFiles(cut, () => hidden) }).refuse).toMatch(/supabase\/migrations\/0071_x\.sql/)
    // A whole first list is never paged.
    expect(completeFiles({ ...cut, files: many.map((path) => ({ path })) }, () => { throw new Error('no page needed') })).toEqual(many)
    // One call of at most 3 s, inside the guard's worst case (Gap 3).
    expect(GH_FILES_MS).toBe(3000)
  })

  it('[pr-size]: a failed or short page, or a list without its number, is unread: not armed', () => {
    const fails = [() => { throw new Error('timed out') }, () => many.slice(0, 131), () => [...many.slice(0, 131), many[0]], () => 'x', undefined]
    for (const fetch of fails) {
      expect(completeFiles(cut, fetch)).toBeNull()
      expect(withCompleteFiles(cut, fetch)).toBe(cut)
      const facts = prFacts(JSON.stringify(withCompleteFiles(cut, fetch)))
      expect(facts.files).toBeNull()
      expect(armList(facts.body, 77, facts).refuse).toMatch(/changed files couldn't be read/)
    }
    expect(completeFiles({ ...cut, number: undefined }, () => many)).toBeNull()
    expect(completeFiles(null, () => many)).toBeNull()
  })

  it('[pr-size]: the CLI pages a cut list with gh api, so preview sees the migration on page 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-size-'))
    try {
      const files = [...many.slice(0, 131), 'supabase/migrations/0071_x.sql']
      writeFileSync(join(dir, 'files.txt'), files.join('\n') + '\n')
      writeFileSync(join(dir, 'gh'), `#!/bin/sh
case "$*" in
  "api repos/{owner}/{repo}/pulls/77/files --paginate --jq .[].filename") cat "${join(dir, 'files.txt')}" ;;
  *) exit 1 ;;
esac
`)
      chmodSync(join(dir, 'gh'), 0o755)
      const body = steps({ before: '1. `scripts/prod-db.sh backup 2.14.6`\n2. `scripts/prod-db.sh push 2.14.6 0071`' })
      const input = JSON.stringify({ ...cut, body, files: files.slice(0, 100).map((path) => ({ path })) })
      const run = (path) => execFileSync('node', [cli, 'preview', '77', '2.14.6', '--pr-json'], { input, encoding: 'utf8', env: { ...process.env, PATH: path } })
      // Paged: the push is the PR's migration, so the plan prints.
      expect(run(`${dir}:${process.env.PATH}`)).toContain(`${PLAN_TITLE} (check-plan passes it; copy it as it is):\n1. \`scripts/prod-db.sh backup 2.14.6\``)
      // gh failing: the files stay unread, and the plan says why not.
      writeFileSync(join(dir, 'files.txt'), '')
      expect(run(`${dir}:${process.env.PATH}`)).toContain("the PR's changed files couldn't be read")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("[deploy-order]: two push lines are refused before the arm: a release's migrations go in one push", () => {
    const two = ['scripts/prod-db.sh backup 2.13', 'scripts/prod-db.sh push 2.13 0053', 'scripts/prod-db.sh push 2.13 0054']
    const files = ['supabase/migrations/0053_a.sql', 'supabase/migrations/0054_b.sql']
    expect(migrationsWhyNot(two, files, '2.13')).toBe("a release's migrations go in one push (`scripts/prod-db.sh push 2.13 <nnnn…>`), and the PR has 2")
    // Said even with the files unread.
    expect(migrationsWhyNot(two, null, '2.13')).toMatch(/^a release's migrations go in one push/)
    expect(migrationsWhyNot(['scripts/prod-db.sh backup 2.13', 'scripts/prod-db.sh push 2.13 0053 0054'], files, '2.13')).toBe('')
    // preview says it in place of a plan; check-plan says it too.
    const body = steps({ before: '1. `scripts/prod-db.sh backup 2.13`\n2. `scripts/prod-db.sh push 2.13 0053`\n3. `scripts/prod-db.sh push 2.13 0054`' })
    const text = previewText(body, 50, { files, isDraft: true }, '2.13')
    expect(text).toContain(`${PLAN_TITLE}: none; check-plan would stop on the PR's own list:\n  - a release's migrations go in one push`)
    expect(planCheck(planLines(body, 50, { files, isDraft: true }).join('\n'), body, '2.13', 50, { files, isDraft: true }).problems.join()).toContain("a release's migrations go in one push")
  })

  it('preview prints the plan as ranjit writes it, and check-plan passes the block as it is', () => {
    const text = previewText(steps(), 46, frontend, '2.14.6')
    expect(text.endsWith(`${PLAN_TITLE} (check-plan passes it; copy it as it is):\n1. \`gh pr ready 46\`\n2. \`gh pr merge 46 --squash --admin\`\n`)).toBe(true)
    const block = text.slice(text.indexOf(PLAN_TITLE))
    expect(planCheck(block, steps(), '2.14.6', 46, frontend)).toEqual({ calls: ['gh pr ready 46', 'gh pr merge 46 --squash --admin'], problems: [] })
    expect(planLines(steps(), 46, { ...frontend, isDraft: false })).toEqual(['1. `gh pr merge 46 --squash --admin`'])
    // A release with steps: the PR's order, then ready and one merge.
    const DB = steps({ before: '1. `scripts/prod-db.sh backup 2.13`\n2. `scripts/prod-db.sh push 2.13 0053`', after: '1. `supabase functions deploy notify --project-ref <prod-ref>`' })
    const facts = { files: ['README.md', 'supabase/migrations/0053_x.sql'], isDraft: true }
    expect(planLines(DB, 50, facts)).toEqual([
      '1. `scripts/prod-db.sh backup 2.13`', '2. `scripts/prod-db.sh push 2.13 0053`', '3. `supabase functions deploy notify --project-ref prodrefprodrefprodre`',
      '4. `gh pr ready 50`', '5. `gh pr merge 50 --squash --admin`',
    ])
    const full = previewText(DB, 50, facts, '2.13')
    expect(planCheck(full.slice(full.indexOf(PLAN_TITLE)), DB, '2.13', 50, facts).problems).toEqual([])
    // No version (the guard's prompt) or a refusal: no plan.
    expect(previewText(steps(), 46, frontend)).not.toContain(PLAN_TITLE)
    expect(previewText(steps(), 46, {}, '2.14.6')).not.toContain(PLAN_TITLE)
  })
})
