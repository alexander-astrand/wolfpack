import { execFileSync } from 'node:child_process'
import { lutimesSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lastCommit, lastWrite, parseArgs, report } from './run-clock.mjs'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const minAgo = (m) => new Date(NOW - m * 60000)
const root = mkdtempSync(join(tmpdir(), 'run-clock-'))

// A lane: a git repo with one commit `commitMin` ago and its files written `writeMin` ago.
function lane(name, commitMin, writeMin) {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  const f = join(d, 'a.txt')
  writeFileSync(f, name)
  const when = minAgo(commitMin).toISOString()
  const env = { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }
  const git = (...args) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { env, stdio: 'ignore' })
  git('init', '-q')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'one')
  utimesSync(f, minAgo(writeMin), minAgo(writeMin))
  return d
}

const busy = lane('busy', 50, 3)
const quiet = lane('quiet', 45, 40)

describe('lastWrite and lastCommit', () => {
  it('ignores .git, node_modules and .next', () => {
    for (const sub of ['node_modules', '.next']) {
      mkdirSync(join(quiet, sub), { recursive: true })
      writeFileSync(join(quiet, sub, 'x.js'), 'x') // written now
    }
    expect(Math.round((NOW - lastWrite(quiet)) / 60000)).toBe(40)
  })

  it('gives null for a missing folder or a folder outside git', () => {
    expect(lastWrite(join(root, 'nope'))).toBeNull()
    expect(lastCommit(tmpdir())).toBeNull()
    expect(Math.round((NOW - lastCommit(busy).at) / 60000)).toBe(50)
  })
})

describe('report', () => {
  it('prints only the silent lane by default, nothing when all are alive', () => {
    const out = report(parseArgs(['--lanes', busy, quiet]), NOW)
    expect(out.split('\n')).toHaveLength(2)
    expect(out).toMatch(/^SILENT lane quiet: last commit 45 min \(\w+\), last write 40 min, silent 40 min/m)
    expect(report(parseArgs(['--lanes', busy]), NOW)).toBe('')
  })

  it('--all shows every lane; --silent-after moves the limit', () => {
    expect(report(parseArgs(['--lanes', busy, quiet, '--all']), NOW)).toContain('lane busy: last commit 50 min')
    expect(report(parseArgs(['--lanes', quiet, '--silent-after', '60']), NOW)).toBe('')
  })

  it("counts a write in the lane's scratch folder, paired by order", () => {
    const scratch = join(root, 'scratch-quiet')
    mkdirSync(scratch)
    writeFileSync(join(scratch, 'notes.txt'), 'x')
    utimesSync(join(scratch, 'notes.txt'), minAgo(5), minAgo(5))
    expect(report(parseArgs(['--lanes', quiet, busy, '--scratch', scratch]), NOW)).toBe('')
  })

  it("reads a session's transcript mtime and says so in the header", () => {
    const t = join(root, 'abcd1234.jsonl')
    writeFileSync(t, '{}\n')
    utimesSync(t, minAgo(25), minAgo(25))
    const out = report(parseArgs(['--transcript', t]), NOW)
    expect(out).toContain("transcript file mtime, not the app's events")
    expect(out).toContain('SILENT session abcd1234: last write 25 min, silent 25 min')
  })

  it('follows a symlinked transcript to its fresh file, and reads a broken link by its own time', () => {
    // The app's tasks/<id>.output: an old link pointing at a file written 2 min ago.
    const real = join(root, 'live-agent.jsonl')
    writeFileSync(real, '{}\n')
    utimesSync(real, minAgo(2), minAgo(2))
    const link = join(root, 'a1b2c3.output')
    symlinkSync(real, link)
    lutimesSync(link, minAgo(60), minAgo(60))
    expect(report(parseArgs(['--transcript', link]), NOW)).toBe('')
    expect(report(parseArgs(['--transcript', link, '--all']), NOW)).toContain('session a1b2c3.output: last write 2 min')
    const broken = join(root, 'dead.output')
    symlinkSync(join(root, 'nowhere.jsonl'), broken)
    lutimesSync(broken, minAgo(30), minAgo(30))
    expect(report(parseArgs(['--transcript', broken]), NOW)).toContain('SILENT session dead.output: last write 30 min')
  })

  it('calls a lane with nothing to go by silent', () => {
    expect(report(parseArgs(['--lanes', join(root, 'gone')]), NOW)).toContain('SILENT lane gone: last commit -, last write -, silent -')
  })

  it('refuses no lanes, bad minutes and stray words', () => {
    expect(() => parseArgs([])).toThrow(/--lanes/)
    expect(() => parseArgs(['--lanes', 'a', '--silent-after', 'x'])).toThrow(/minutes/)
    expect(() => parseArgs(['--all', 'a'])).toThrow(/Unexpected/)
  })

  it('the script prints nothing when all are alive', () => {
    const script = fileURLToPath(new URL('./run-clock.mjs', import.meta.url))
    const fresh = lane('fresh', 0, 0)
    expect(execFileSync(process.execPath, [script, '--lanes', fresh], { encoding: 'utf8' })).toBe('')
  })
})
