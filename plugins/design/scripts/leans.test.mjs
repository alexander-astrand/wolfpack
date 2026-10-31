import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLOSE, OPEN, notesBullets, parseLibrary, recordLines, rewriteLeans, run, scoreKind } from './leans.mjs'

const LIBRARY = `# Design library

Intro.

| Date | Topic | Page | Brief | Gallery | heisenberg's lean | Pick | Alexander's words | Why | Score |
|---|---|---|---|---|---|---|---|---|---|
| 1 Oct 2026 | 2.13.4 | Hut page | b | g | A | A | "yes" | w | n/a |
| 19 Oct 2026 | V0.14.2 | Todos | b | g | B | B over A | "ok" | w | lean won |
| 20 Oct 2026 | V0.14.3 | Money | b | g | A | **B** over A | "the | one" | w | lean lost |
| 21 Oct 2026 | V0.14.4 | Home | b | g | A | A | - | w | lean 3-2 (lost on name) |
| 22 Oct 2026 | V0.15 | Trips | b | g | none | A | - | w | no lean |

## Jackpots

| Date | Project | Score |
|---|---|---|
| 1 Oct | x | lean lost |
`

const AGENT = `---
name: heisenberg
---

## Leans
What he leans to. Rewritten 15 Oct 2026.
- **Calm pages:** towards the calm.
- Away from: bolder leaps.

**Brief mode** (before design).
1. The feel.
`

describe('scoreKind', () => {
  it('reads the four kinds and skips unscored rows', () => {
    expect(scoreKind('lean won')).toBe('won')
    expect(scoreKind('**lean lost**')).toBe('lost')
    expect(scoreKind('no lean')).toBe('none')
    expect(scoreKind('lean half')).toBe('mixed')
    expect(scoreKind('lean lost (round 1 sent back), then lean won')).toBe('mixed')
    for (const s of ['n/a', '', undefined, '-']) expect(scoreKind(s)).toBeNull()
  })
})

describe('parseLibrary', () => {
  it('reads the first Score table only, with Score from the last cell when a cell quotes a pipe', () => {
    const rows = parseLibrary(LIBRARY)
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.kind)).toEqual([null, 'won', 'lost', 'mixed', 'none'])
    expect(rows[1]).toMatchObject({ date: '19 Oct 2026', page: 'Todos', lean: 'B' })
  })

  it('throws on a library with no Score column', () => {
    expect(() => parseLibrary('| a | b |\n|---|---|\n| 1 | 2 |')).toThrow(/Score/)
  })
})

describe('recordLines', () => {
  it('counts, names the latest rows and the lost or mixed ones, inside the markers', () => {
    const lines = recordLines(parseLibrary(LIBRARY), '2026-10-31')
    expect(lines[0]).toBe(OPEN)
    expect(lines.at(-1)).toBe(CLOSE)
    expect(lines[1]).toMatch(/2026-10-31.*4 scored rows, lean won 1, lean lost 1, no lean 1, mixed 1; 1 rows from before scoring skipped/)
    expect(lines.join('\n')).toMatch(/Lost or mixed.*Money.*Home/)
    expect(lines.join('\n')).not.toMatch(/…/)
  })
})

describe('notesBullets', () => {
  it("takes the bullets under the setup-session heading and stops at the next heading", () => {
    const notes = "# Notes\n- not this\n## For the kit's next setup session\nNew leans:\n- one\n- two\n## Other\n- not this either\n"
    expect(notesBullets(notes)).toEqual(['- one', '- two'])
    expect(notesBullets('# nothing here')).toBeNull()
  })
})

describe('rewriteLeans', () => {
  const record = recordLines(parseLibrary(LIBRARY), '2026-10-31')

  it('puts the record after the intro, keeps the bullets and the rest of the file', () => {
    const out = rewriteLeans(AGENT, { record })
    expect(out).toMatch(/## Leans\nWhat he leans to\. Rewritten 15 Oct 2026\.\n<!-- leans\.mjs -->\n\*\*The record\*\*/)
    expect(out).toMatch(/<!-- \/leans\.mjs -->\n- \*\*Calm pages:\*\* towards the calm\.\n- Away from: bolder leaps\.\n\n\*\*Brief mode\*\*/)
    expect(out.startsWith('---\nname: heisenberg')).toBe(true)
  })

  it('replaces the record block on a second run, never appends', () => {
    const once = rewriteLeans(AGENT, { record })
    const twice = rewriteLeans(once, { record: recordLines(parseLibrary(LIBRARY), '2026-11-02') })
    expect(twice.match(/<!-- leans\.mjs -->/g)).toHaveLength(1)
    expect(twice).toMatch(/2026-11-02/)
    expect(twice).not.toMatch(/2026-10-31/)
  })

  it("swaps the bullets for the notes' ones when given", () => {
    const out = rewriteLeans(AGENT, { record, bullets: ['- new lean'] })
    expect(out).toMatch(/<!-- \/leans\.mjs -->\n- new lean\n\n\*\*Brief mode\*\*/)
    expect(out).not.toMatch(/Calm pages/)
  })
})

describe('run', () => {
  it('prints the section without --write and writes the file with it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leans-'))
    const lib = join(dir, 'library.md')
    const agent = join(dir, 'heisenberg.md')
    const notes = join(dir, 'notes.md')
    writeFileSync(lib, LIBRARY)
    writeFileSync(agent, AGENT)
    writeFileSync(notes, "## For the kit's next setup session\n- from the notes\n")
    const printed = run(['--library', lib, '--agent', agent, '--today', '2026-10-31'])
    expect(printed.startsWith('## Leans')).toBe(true)
    expect(printed).not.toMatch(/Brief mode/)
    expect(readFileSync(agent, 'utf8')).toBe(AGENT)
    expect(run(['--library', lib, '--agent', agent, '--notes', notes, '--write'])).toMatch(/1 bullets from the notes/)
    expect(readFileSync(agent, 'utf8')).toMatch(/- from the notes/)
  })
})
