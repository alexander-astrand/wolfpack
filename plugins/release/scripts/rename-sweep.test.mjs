import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filesUnder, hitsIn, isHistory, oldNames, renderHits, renderTable, replacementTable, sweep } from './rename-sweep.mjs'

// A small map in the real one's shape (pylos/notes/name-map.md).
const MAP = [
  '# Name map',
  '',
  '## The map',
  '',
  '| Thing | Name | Was | Why |',
  '|---|---|---|---|',
  '| The Dell server | **delphi** | (kept) | x |',
  '| MacBook Air | **Pollux** | Airgos, `air`, `alexanders-macbook-air` | x |',
  '| Apple Watch | **Murph** | `watch` on Heimdall, "Alexander\'s Apple Watch" in Bluetooth | x |',
  '| HQ folder | **`~/pylos`** | `~/dojo` | x |',
  '| Telegram assistant | **Nestor** | Mr Miyagi | x |',
  '| Kit skill, the catch-all | **`/mr-miyagi`** | `/oracle` | x |',
  '| The dojo\'s brief skill | **`/nestor`** | `/mr-miyagi` (in `~/dojo/.claude/skills`) | x |',
  '| Kit skill, the guide | **`/farbror-vattenmelon`** | `/chiron` | x |',
  '| fantasy\'s voice | **Chiron** (`/chiron`) | none | x |',
  '',
  '## Wrong names in the code today',
  '',
  '| Today | Becomes | What it is |',
  '|---|---|---|',
  '| `dojo-backup.service`/`.timer`, `/usr/local/sbin/dojo-backup` | `delphi-backup` | Nightly backup |',
  '',
  '## Voices',
].join('\n')

describe('oldNames', () => {
  it('reads backticked and quoted names, drops notes, and skips kept or none', () => {
    expect(oldNames('Airgos, `air`, `alexanders-macbook-air`')).toEqual(['Airgos', 'air', 'alexanders-macbook-air'])
    expect(oldNames('`watch` on Heimdall, "Alexander\'s Apple Watch" in Bluetooth')).toEqual(['watch', "Alexander's Apple Watch"])
    expect(oldNames('`/mr-miyagi` (in `~/dojo/.claude/skills`)')).toEqual(['/mr-miyagi'])
    expect(oldNames('(kept; still mounted)')).toEqual([])
    expect(oldNames('none')).toEqual([])
  })
})

describe('replacementTable', () => {
  const t = replacementTable(MAP)
  const olds = t.pairs.map((p) => p.old)
  it('builds old to new from both tables and the global rule\'s phrases, longest first', () => {
    expect(t.pairs.find((p) => p.old === '~/dojo').new).toBe('~/pylos')
    expect(t.pairs.find((p) => p.old === '/usr/local/sbin/dojo-backup').new).toBe('delphi-backup')
    expect(olds).toContain('dojo-backup.service')
    expect(olds).not.toContain('.timer')
    expect(t.pairs.find((p) => p.old === 'the Air')).toMatchObject({ new: 'Pollux', from: 'the global rule' })
    expect(olds.indexOf('~/fantasy-hq')).toBeLessThan(olds.indexOf('fantasy-hq'))
  })
  it('never sweeps an old name that is a current one, and leaves bare short words out unless asked', () => {
    expect(t.ambiguous.map((p) => p.old).sort()).toEqual(['/chiron', '/mr-miyagi'])
    expect(t.skipped.map((p) => p.old)).toEqual(['air', 'watch'])
    expect(replacementTable(MAP, { all: true }).pairs.map((p) => p.old)).toContain('air')
    const table = renderTable(t)
    expect(table).toContain('| `~/dojo` | `~/pylos` | HQ folder |')
    expect(table).toContain('Ambiguous (an old name that is also a current one; read by hand)')
  })
})

describe('hitsIn and sweep', () => {
  const { pairs } = replacementTable(MAP)
  it('finds whole names, the longest claiming its span, and with live skips quoted words', () => {
    expect(hitsIn('cd ~/fantasy-hq and ask Mr Miyagi', pairs)).toEqual([{ line: 1, old: '~/fantasy-hq', new: '~/pelion' }, { line: 1, old: 'Mr Miyagi', new: 'Nestor' }])
    expect(hitsIn('the Airgos-x and the Airplane', pairs)).toEqual([])
    expect(hitsIn('He said "the dojo is home" in ~/dojo', pairs, { live: true })).toEqual([{ line: 1, old: '~/dojo', new: '~/pylos' }])
    expect(hitsIn('He said "the dojo is home"', pairs)).toHaveLength(1)
  })
  it('walks the paths, prints file:line, and skips history with live', () => {
    const root = mkdtempSync(join(tmpdir(), 'rename-sweep-'))
    mkdirSync(join(root, 'docs', 'decisions'), { recursive: true })
    writeFileSync(join(root, 'notes.md'), 'one\nlives in ~/dojo\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '~/dojo was renamed\n')
    writeFileSync(join(root, 'docs', 'decisions', '0001.md'), 'the dojo\n')
    const all = sweep([root], pairs, { cwd: root })
    expect(all.rows.map((r) => r.where).sort()).toEqual(['CHANGELOG.md:1', 'docs/decisions/0001.md:1', 'notes.md:2'])
    const live = sweep([root], pairs, { cwd: root, live: true })
    expect(live.rows).toEqual([{ where: 'notes.md:2', old: '~/dojo', new: '~/pylos' }])
    expect(renderHits(live, true)).toContain('| notes.md:2 | ~/dojo | ~/pylos |')
    expect(isHistory('plugins/core/lessons.md')).toBe(true)
  })

  it('skips a broken symlink and a link loop instead of dying (review nit 4)', () => {
    const root = mkdtempSync(join(tmpdir(), 'rename-sweep-links-'))
    writeFileSync(join(root, 'a.md'), 'x')
    symlinkSync(join(root, 'gone.md'), join(root, 'broken.md'))
    symlinkSync(root, join(root, 'loop'))
    expect(filesUnder(root)).toEqual([join(root, 'a.md')])
  })
})
