import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addedLines, hitsOf, KIT_CHECKS, kitPathHits, parsePipeline, projectChecks, render, review, toRegExp } from './review-greps.mjs'

const DIFF = [
  'diff --git a/src/Logo.tsx b/src/Logo.tsx',
  '--- a/src/Logo.tsx',
  '+++ b/src/Logo.tsx',
  '@@ -3,0 +4,2 @@',
  '+  <svg width="18.9px" />',
  '+  <button className="outline-none" />',
  'diff --git a/src/Card.tsx b/src/Card.tsx',
  '--- a/src/Card.tsx',
  '+++ b/src/Card.tsx',
  '@@ -10 +10 @@',
  '-old',
  '+  const go = () => navigator.share({ url })',
  '@@ -20,0 +21,2 @@',
  '+  onRemove={() => drop(id)}',
  '+  const list = events.filter((e) => e.day)',
  'diff --git a/src/ShareMenu.tsx b/src/ShareMenu.tsx',
  '--- a/src/ShareMenu.tsx',
  '+++ b/src/ShareMenu.tsx',
  '@@ -1,0 +2 @@',
  '+  navigator.share(data)',
].join('\n')

describe('addedLines', () => {
  it('gives each added line its file and new line number', () => {
    const l = addedLines(DIFF)
    expect(l.map((x) => `${x.file}:${x.line}`)).toEqual(['src/Logo.tsx:4', 'src/Logo.tsx:5', 'src/Card.tsx:10', 'src/Card.tsx:21', 'src/Card.tsx:22', 'src/ShareMenu.tsx:2'])
  })
})

describe('the kit checks', () => {
  it('hit the repeat shapes and leave the share menu alone', () => {
    const hits = hitsOf(addedLines(DIFF), KIT_CHECKS).map((h) => `${h.check} @ ${h.where}`)
    expect(hits).toEqual([
      'fractional px in a logo, mark or icon @ src/Logo.tsx:4',
      'navigator.share outside the shared share menu @ src/Card.tsx:10',
      'outline-none with no focus-visible on the element @ src/Logo.tsx:5',
      'remove, answer or close handler; focus moves nowhere in the file @ src/Card.tsx:21',
      'events listed in the client with no visibility filter (`[private-nights]`) @ src/Card.tsx:22',
    ])
  })
})

describe('builder-checks pipelines', () => {
  it('turns BRE and ERE greps into JS regexps', () => {
    expect(toRegExp('setOpen(false)').test('setOpen(false)')).toBe(true)
    expect(toRegExp('setOpen(false)', { ere: true }).test('setOpen(false)')).toBe(false)
    expect(toRegExp('a|b').test('a|b')).toBe(true)
    expect(toRegExp('(You.re in|Going)', { ere: true }).test('Going')).toBe(true)
    expect(toRegExp('a.b', { fixed: true }).test('axb')).toBe(false)
  })
  it('reads a pipeline with a path and a grep -v, and gives up on anything else', () => {
    const p = parsePipeline('grep -rn "outline-none" src | grep -v "focus-visible"')
    expect(p.paths).toEqual(['src'])
    expect(p.filters.map((f) => f.negate)).toEqual([false, true])
    expect(parsePipeline("git diff main -U0 | grep -nE '^\\+.*[0-9]+\\.[0-9]+px'").paths).toEqual([])
    expect(parsePipeline('echo $?')).toBe(null)
  })
  it('makes one check per greppable bullet and counts the rest as read by hand', () => {
    const md = '# Builder checks\n\n- **No native share**: `grep -rn "navigator.share" src`.\n- **Balanced stacks**, measure them.\n- **Game nights filtered**: `grep -rn "game_nights" src | grep -v Api`.\n'
    const { checks, manual } = projectChecks(md)
    expect(manual).toBe(1)
    const lines = [{ file: 'src/a.ts', line: 1, text: 'from("game_nights")' }, { file: 'src/aApi.ts', line: 2, text: 'game_nights' }, { file: 'docs/x.md', line: 3, text: 'navigator.share' }]
    expect(hitsOf(lines, checks).map((h) => `${h.check} @ ${h.where}`)).toEqual(['Game nights filtered @ src/a.ts:1'])
  })

  // The shapes of real builder-checks lines (31 Oct 2026), kept as fixed lines so
  // CI, which has no project checked out, still covers the parser. The projects'
  // live files are replayed in "each project's live builder-checks.md" below.
  const REAL = [
    "- **A logo or mark draws on whole pixels** (the kit's taste: a wordmark at 109x25.25 and a mark at 18.9px both blurred, in two projects). `git diff main -U0 | grep -nE '^\\+.*[0-9]+\\.[0-9]+px'` shows no fractional size in a logo, mark or icon box; a computed size goes through `Math.round`.",
    "- **An add line keeps its text until the write succeeds.** Use `AddLine` (`components/ui/add-line.tsx`), or clear only after the write returns. Grep: `git diff main -- components | grep -n \"setText('')\\|setValue('')\"`. (V0.6 G2 N11: notes, other shops, wishes, `aa71d30`.)",
    "- **A page's width, column count and sticky top come from `<Page shape>` / `styles/layout.css`, under Full only.** Calm keeps its own page CSS untouched. Grep the diff: `git diff main -- '*.css' | grep -n 'max-width:\\|position: sticky'` outside layout.css; the `layout` convention fails on them. (V0.9 S2, scoped to Full in V0.10 P1b.)",
    "- **Today comes from `localDate`, a week, month or year edge from `lib/dates.ts`.** Grep the diff: `git diff main -- app components lib | grep -n \"^+.*\\(Europe/Stockholm\\|sv-SE\\)\"` (only `lib/time.ts` may hold it). (V0.12 inception, gap 1.)",
    "- **A page that stops showing a fact stops reading it.** A step that removes a window, card or line from a page removes its loader's query too. Grep the diff's removed fields against the page's loader: `git diff main -- components | grep -n \"^-.*\\(facts\\|windows\\|sum\\)\"`, then the loader for each.",
    "- **A clean-up that deletes a style greps what the page shows first.** Grep: each deleted selector in `git diff main -- '*.css' | grep -n \"^-\\.\"` against `components/` and `app/`.",
    "- **A layout change is looked at, not measured.** Grep: `git log -1 --format=%B | grep -c '1440'`. (V0.9, aborted: builders checked a width cap and PNG hashes and never looked.)",
    "- **A lock file is written by npm 10.** Grep: `git diff main --name-only | grep package-lock.json` prints a line only when the commit body names npm 10.",
  ]

  it('reads a git diff pipeline the way the shell does: `^\\+` fires, `-- <paths>` and globs scope it', () => {
    const { checks, manual } = projectChecks(REAL.join('\n'))
    expect(checks).toHaveLength(4)
    expect(manual).toBe(4)
    const lines = [
      { file: 'src/Logo.tsx', line: 1, text: '  <svg width="18.9px" />' },
      { file: 'components/add.tsx', line: 2, text: "    setText('')" },
      { file: 'styles/page.css', line: 3, text: '  max-width: 720px;' },
      { file: 'components/a.tsx', line: 4, text: '  style={{ position: sticky }}' },
      { file: 'app/today.tsx', line: 5, text: "  const tz = 'Europe/Stockholm'" },
      { file: 'docs/notes.md', line: 6, text: 'Europe/Stockholm' },
      { file: 'components/b.tsx', line: 7, text: '-.old facts windows sum' },
    ]
    expect(hitsOf(lines, checks).map((h) => h.where)).toEqual(['src/Logo.tsx:1', 'components/add.tsx:2', 'styles/page.css:3', 'app/today.tsx:5'])
  })

  it('counts `^-` patterns, other git commands and any non-plain grep option as read by hand', () => {
    expect(parsePipeline('git diff main -- components | grep -n "^-.*\\(facts\\|windows\\|sum\\)"')).toBe(null)
    expect(parsePipeline("git log -1 --format=%B | grep -c '1440'")).toBe(null)
    expect(parsePipeline('git diff main --name-only | grep package-lock.json')).toBe(null)
    expect(parsePipeline('grep -rn --include=*.ts "navigator.share" src')).toBe(null)
    expect(parsePipeline('grep -n -e "setText" -e "setValue" components')).toBe(null)
    expect(parsePipeline('grep -L "no_oauth_client" supabase/migrations/x.sql')).toBe(null)
    expect(parsePipeline('git diff main -- app components lib | grep -n "x"')).toMatchObject({ paths: ['app', 'components', 'lib'], diff: true })
  })
})

// Kit 1.9 P3: the projects' own files, read live (no pasted copies). A project
// whose file is absent is skipped, so CI (no projects) runs none of these.
const HOME = homedir()
const PROJECT_FILES = ['Desktop/HutzUp', 'Desktop/burrow', 'burrow', 'HutzUp', 'pelion', 'Desktop/pelion']
  .map((p) => join(HOME, p, '.claude', 'builder-checks.md'))
  .filter((f) => existsSync(f))
// One planted violation per rule shape: [the rule's name, a file, the line that breaks it].
const PLANTS = [
  [/outline-none/, 'src/Btn.tsx', '  <button className="outline-none">'],
  [/navigator\.share/, 'src/Card.tsx', '  navigator.share({ url })'],
  [/game_nights|private-nights|visibility filter/, 'src/List.tsx', "  supabase.from('game_nights')"],
  [/add line keeps its text/, 'components/Add.tsx', "    setText('')"],
  [/width, column count and sticky top/, 'styles/page.css', '  max-width: 720px;'],
  [/Today comes from/, 'app/today.tsx', "  const tz = 'Europe/Stockholm'"],
  [/whole pixels/, 'src/Logo.tsx', '  <svg width="18.9px" />'],
]

describe.each(PROJECT_FILES.map((f) => [f.replace(HOME, '~'), f]))("each project's live builder-checks.md: %s", (_name, file) => {
  const md = readFileSync(file, 'utf8')
  const { checks, manual } = projectChecks(md)
  const bullets = md.split('\n').filter((l) => /^\s*[-*]\s/.test(l))

  it('turns every bullet into grep checks or a read-by-hand count', () => {
    expect(bullets.length).toBeGreaterThan(0)
    expect(new Set(checks.map((c) => c.name)).size + manual).toBeLessThanOrEqual(bullets.length)
    expect(checks.length).toBeGreaterThan(0)
  })

  it('stays quiet on an ordinary line', () => {
    expect(hitsOf([{ file: 'src/App.tsx', line: 1, text: '  const total = items.length' }], checks)).toEqual([])
  })

  it('fires on the planted violation of each rule the file holds', () => {
    for (const [rule, path, text] of PLANTS) {
      const own = checks.filter((c) => rule.test(c.name))
      if (!own.length) continue
      const hit = hitsOf([{ file: path, line: 1, text }], own)
      expect(hit.length, `${rule} should hit "${text}"`).toBeGreaterThan(0)
    }
  })
})

describe('test files and kit paths', () => {
  const diff = (file, text) => [`+++ b/${file}`, '@@ -0,0 +1 @@', `+${text}`].join('\n')

  it('drops added lines in test files, fixtures and __tests__ folders', () => {
    for (const f of ['a/x.test.mjs', 'a/x.test.js', 'a/__tests__/x.js', 'a/fixtures/x.md', 'x.spec.ts']) expect(addedLines(diff(f, 'outline-none'))).toEqual([])
    expect(addedLines(diff('a/x.mjs', 'outline-none'))).toHaveLength(1)
  })

  it('counts line numbers past a skipped test file', () => {
    const d = ['+++ b/a.test.mjs', '@@ -0,0 +1,2 @@', '+x', '+y', '+++ b/b.md', '@@ -0,0 +4 @@', '+z'].join('\n')
    expect(addedLines(d)).toEqual([{ file: 'b.md', line: 4, text: 'z' }])
  })

  const files = new Set(['plugins/design/scripts/gallery.mjs', 'plugins/release', 'plugins/core', 'plugins/design', 'plugins/database', 'scripts/check.mjs'])
  const exists = (p) => [...files].some((f) => p.endsWith(`/${f}`))
  const md = (text) => [{ file: 'docs/x.md', line: 7, text }]
  const hits = (text, names = new Set(['norms.md'])) => kitPathHits(md(text), { repo: '/r', exists, trackedNames: () => names }).map((h) => h.text.split(' ')[0])

  it('flags a kit file named in markdown that the kit does not hold (order-common.md)', () => {
    expect(hits('Both agents read `order-common.md` in the kit.')).toEqual(['order-common.md'])
    expect(hits('The kit keeps `norms.md`.')).toEqual([])
  })

  it('flags a missing plugins/, scripts/ or <plugin>/ path and passes real ones', () => {
    expect(hits('See `plugins/design/scripts/gallery.mjs` and `<design>/scripts/gallery.mjs`.')).toEqual([])
    expect(hits('See `plugins/design/scripts/nope.mjs`.')).toEqual(['plugins/design/scripts/nope.mjs'])
    expect(hits('Run `<design>/scripts/nope.mjs`.')).toEqual(['plugins/design/scripts/nope.mjs'])
    expect(hits('See `scripts/check.mjs`, then `scripts/gone.mjs`.')).toEqual(['scripts/gone.mjs'])
  })

  it('leaves URLs, ~/ paths, placeholders, globs and non-markdown files alone', () => {
    expect(hits('https://example.com/plugins/x/y.md and ~/kit/plugins/x/y.md')).toEqual([])
    expect(hits('`plugins/<project>/x.md`, `plugins/*/x.md`, `${ROOT}/scripts/x.mjs`')).toEqual([])
    expect(kitPathHits([{ file: 'a.mjs', line: 1, text: "see 'plugins/x/nope.mjs'" }], { repo: '/r', exists })).toEqual([])
  })
})

describe('review', () => {
  it('runs on the diff, the project checks, the conventions script and the version field, and prints only hits', () => {
    const repo = mkdtempSync(join(tmpdir(), 'review-greps-'))
    mkdirSync(join(repo, '.claude'))
    writeFileSync(join(repo, '.claude', 'builder-checks.md'), '- **Taps are 44px**: read by hand.\n')
    writeFileSync(join(repo, '.claude', 'kit.json'), JSON.stringify({ conventions: 'scripts/conventions.sh' }))
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '1.2.0' }))
    const calls = []
    const run = (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`)
      if (args.includes('rev-parse')) return 'abc'
      if (cmd === 'sh') throw Object.assign(new Error('x'), { stdout: 'src/a.tsx:3 raw <button>\n' })
      return DIFF
    }
    const r = review({ repo, version: '1.3.0' }, run)
    expect(calls[1]).toBe(`git -C ${repo} diff -U0 origin/main...HEAD`)
    expect(r.manual).toBe(1)
    const out = render(r)
    expect(out).toContain('| `[release-bump]` version field | package.json | reads 1.2.0, the release is 1.3.0 |')
    expect(out).toContain('| conventions (scripts/conventions.sh) | - | src/a.tsx:3 raw <button> |')
    expect(out).toMatch(/^7 hits on 6 added lines \(vs origin\/main\) from 5 grep checks; 1 builder-checks lines have no grep/m)
    const clean = render(review({ repo, base: 'main', conventions: false }, () => ''))
    expect(clean.startsWith('No hits.')).toBe(true)
  })
})
