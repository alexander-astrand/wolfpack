import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anchorOf, applyStatus, main, parseArgs, rowWrite, statusKey } from './roadmap-apply.mjs'

const roadmap = [
  '# x: roadmap',
  '',
  '- V1.12 · Notes tables · M · stamped 5 Nov · In progress (draft PR 91)',
  '- V1.12.1 · The fix · M · planning (/inception) · his words (7 Nov): "go"',
  '- V2.0 · Big · L',
].join('\n')

describe('roadmap-apply', () => {
  it('replaces the status segment and leaves other lines alone', () => {
    const r = applyStatus(roadmap, 'V1.12', 'In review (draft PR 91)')
    expect(r.line).toBe('- V1.12 · Notes tables · M · stamped 5 Nov · In review (draft PR 91)')
    expect(r.text).toContain('- V1.12.1 · The fix')
  })
  it('does not mistake V1.12.1 for V1.12, and appends when there is no status segment', () => {
    expect(applyStatus(roadmap, 'V2.0', 'Planned').line).toBe('- V2.0 · Big · L · Planned')
    expect(applyStatus(roadmap, 'V1.12.1', 'Shipped (PR 92)').line).toContain('M · Shipped (PR 92) · his words')
  })
  it('is null for an unknown release and unchanged for the same status', () => {
    expect(applyStatus(roadmap, 'V9', 'Planned')).toBe(null)
    expect(applyStatus(roadmap, 'V1.12', 'In progress (draft PR 91)').changed).toBe(false)
  })
  it('builds the row write with the card anchor and status key', () => {
    expect(anchorOf('V1.12.1')).toBe('v1-12-1')
    expect(statusKey('In review (x)')).toBe('in-review')
    expect(() => statusKey('Done')).toThrow()
    const row = rowWrite('V1.12', 'Shipped (PR #80)', new Date('2026-11-07T10:00:00Z'))
    expect(row.path).toBe('cards/v1-12')
    expect(row.value).toEqual({ status: 'shipped', badge: 'Shipped (PR #80)', updated_at: '2026-11-07T10:00:00.000Z' })
  })
  it('writes the file, but not on --dry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'roadmap-apply-'))
    writeFileSync(join(dir, 'roadmap.md'), roadmap)
    const out = []
    main(['--plans', dir, '--release', 'V1.12', '--status', 'Shipped (PR 91)', '--dry'], (l) => out.push(l))
    expect(readFileSync(join(dir, 'roadmap.md'), 'utf8')).toBe(roadmap)
    main(['--plans', dir, '--release', 'V1.12', '--status', 'Shipped (PR 91)'], (l) => out.push(l))
    expect(readFileSync(join(dir, 'roadmap.md'), 'utf8')).toContain('stamped 5 Nov · Shipped (PR 91)')
    expect(out.join('\n')).toContain('"path": "cards/v1-12"')
  })
  it('needs both flags', () => {
    expect(() => parseArgs(['--release', 'V1'])).toThrow()
  })
})
