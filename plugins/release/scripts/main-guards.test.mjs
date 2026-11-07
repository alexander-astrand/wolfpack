// Kit 1.9 P4(b): every script whose main guard moved to the standing form
// (`pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url`) is
// started through a symlink; the old `pathToFileURL(process.argv[1] ?? '')` form
// never ran main there and exited 0 with no output, which looked like success.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PLUGINS = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// [path under plugins/, args, stdin]: each prints something (usage or a result) when main runs.
const SCRIPTS = [
  ['core/scripts/wrap-facts.mjs', [], ''],
  ['release/scripts/usage.mjs', ['--help'], ''],
  ['release/scripts/daily-budget.mjs', ['--status'], ''],
  ['release/scripts/council-roles.mjs', ['--help'], ''],
  ['design/scripts/bengan-boys.mjs', ['--help'], ''],
  ['design/scripts/gallery.mjs', ['--help'], ''],
  ['design/scripts/mock-scaffold.mjs', ['--help'], ''],
  ['design/scripts/qa/qa-flow.mjs', ['--help'], ''],
  ['design/scripts/qa/batch-shots.mjs', ['--help'], ''],
  // database (P4(a)): no args reaches each one's usage path, never a database or the network.
  ['database/hooks/deploy.mjs', [], ''],
  ['database/scripts/seed.mjs', [], ''],
  ['database/scripts/scope.mjs', [], ''],
  ['database/scripts/sync-ranjit.mjs', [], ''],
  // A18: the `process.argv[1] ?? ''` form, moved to the standing form. Each of these prints
  // a usage line or a result without writing a file (make-builders only checks without --write).
  ['database/scripts/run-tests.mjs', ['--x'], ''],
  ['release/scripts/make-builders.mjs', [], ''],
  ['release/scripts/budgets-derive.mjs', ['--help'], ''],
  ['release/scripts/council-facts.mjs', ['--help'], ''],
  ['release/scripts/council-skills.mjs', ['--help'], ''],
  ['release/scripts/council-speed.mjs', ['--help'], ''],
  ['release/scripts/council-spawns.mjs', ['--help'], ''],
  ['release/scripts/council-starts.mjs', ['--help'], ''],
  ['release/scripts/meter-calibrate.mjs', ['--help'], ''],
  // A18 order 2: the `fileURLToPath(import.meta.url) === process.argv[1]` form (and the
  // `resolve(argv[1])` one in root scripts, reached as ../scripts/ from plugins/).
  ['core/scripts/dev-hq.mjs', ['--help'], ''],
  ['core/scripts/scrooge.mjs', [], ''],
  ['core/scripts/week-receipt.mjs', ['--help'], ''],
  ['core/scripts/tier-readers.mjs', [], ''],
  ['core/scripts/envelope.mjs', [], ''],
  ['release/scripts/routes-moved.mjs', ['--help'], ''],
  ['release/scripts/roadmap-apply.mjs', ['--help'], ''],
  ['release/scripts/the-tower.mjs', [], ''],
  ['../scripts/user-commands.mjs', [], ''],
  ['../scripts/drift.mjs', [], ''],
  ['../scripts/bump.mjs', [], ''],
  ['../scripts/check.mjs', [], ''],
]

// Hooks read a payload on stdin; an empty one must exit 0. start-gate and budget-cap print
// nothing for an empty payload, so for them this only proves the file loads and exits cleanly.
const HOOKS = ['release/hooks/ask-to-start.mjs', 'release/hooks/start-gate.mjs', 'release/hooks/budget-cap.mjs']

// These two exit 0 on an empty payload, which a skipped main does too, so each gets
// args that only a running main answers with a non-zero exit and a known message.
const ARGED_HOOKS = [
  ['database/hooks/guard-production.mjs', ['--explain'], 2, /usage: node guard-production\.mjs --explain/],
  ['database/hooks/denied-log.mjs', ['--summary', '--since', 'x'], 1, /--since takes a date/],
]

// These two refuse an empty payload (exit 2 with a reason): main ran, which is the point.
const REFUSING_HOOKS = ['database/hooks/chain-arm.mjs', 'database/hooks/production-steps.mjs']

const run = (link, args, input) => spawnSync('node', [link, ...args], { encoding: 'utf8', input, timeout: 20000, env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'guard-home-')) } })

describe('main guards run through a symlink', () => {
  for (const [path, args, input] of SCRIPTS) {
    it(`${path}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'main guard ')) // a space in the path too
      const link = join(dir, 'linked.mjs')
      symlinkSync(join(PLUGINS, path), link)
      const r = run(link, args, input)
      expect(r.error).toBeUndefined()
      // main ran: it printed a usage line or a result (a skipped main prints nothing).
      expect(`${r.stdout}${r.stderr}`.trim().length).toBeGreaterThan(0)
    })
  }

  for (const path of HOOKS) {
    it(`${path} reads an empty hook payload and exits 0`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'main guard '))
      const link = join(dir, 'linked.mjs')
      symlinkSync(join(PLUGINS, path), link)
      const r = run(link, [], '{}')
      expect(r.error).toBeUndefined()
      expect(r.status).toBe(0)
    })
  }

  for (const [path, args, status, message] of ARGED_HOOKS) {
    it(`${path} answers ${args.join(' ')} with exit ${status} (main ran)`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'main guard '))
      const link = join(dir, 'linked.mjs')
      symlinkSync(join(PLUGINS, path), link)
      const r = run(link, args, '')
      expect(r.error).toBeUndefined()
      expect(r.status).toBe(status)
      expect(r.stderr).toMatch(message)
    })
  }

  for (const path of REFUSING_HOOKS) {
    it(`${path} refuses an empty hook payload (main ran)`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'main guard '))
      const link = join(dir, 'linked.mjs')
      symlinkSync(join(PLUGINS, path), link)
      const r = run(link, [], '{}')
      expect(r.error).toBeUndefined()
      expect(r.status).toBe(2)
      expect(r.stderr.trim().length).toBeGreaterThan(0)
    })
  }
})
