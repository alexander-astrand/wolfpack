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
]

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

  it('release/hooks/ask-to-start.mjs reads an empty hook payload and exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'main guard '))
    const link = join(dir, 'linked.mjs')
    symlinkSync(join(PLUGINS, 'release', 'hooks', 'ask-to-start.mjs'), link)
    const r = run(link, [], '{}')
    expect(r.error).toBeUndefined()
    expect(r.status).toBe(0)
  })
})
