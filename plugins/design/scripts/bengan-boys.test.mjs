import { describe, it, expect } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOYS, fill, partsOf, run } from './bengan-boys.mjs'

const design = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const boy = `---
name: nils
description: Checks one lane
---

## Voice
nils · a player · "hej"
- start: "Hej."

You're one of the Bengan Boys.

## Your lane
The lane, with a $1 in it.

## How you run
`

describe('partsOf', () => {
  it('reads the four parts a Boy keeps', () => {
    expect(partsOf(boy)).toEqual({ name: 'nils', description: 'Checks one lane', voice: 'nils · a player · "hej"\n- start: "Hej."', lane: 'The lane, with a $1 in it.' })
  })
  it('names what is missing instead of writing a broken file', () => {
    expect(() => partsOf('---\nname: x\n---\n', 'x.md')).toThrow(/x\.md: no description, voice, lane/)
  })
  it('refuses a description the frontmatter would misread', () => {
    expect(() => partsOf(boy.replace('Checks one lane', 'Checks: one lane'))).toThrow(/breaks the frontmatter/)
  })
})

describe('fill', () => {
  it('fills every placeholder and keeps a $ as text', () => {
    const t = 'name: {{NAME}}\n{{DESCRIPTION}}\n{{VOICE}}\n{{LANE}}\nshot {{NAME}}-page.jpg'
    expect(fill(t, partsOf(boy))).toBe('name: nils\nChecks one lane\nnils · a player · "hej"\n- start: "Hej."\nThe lane, with a $1 in it.\nshot nils-page.jpg')
  })
})

describe('the four Boys in the plugin', () => {
  it('match the template (run bengan-boys.mjs after changing it)', () => {
    expect(run({ design, check: true })).toEqual([])
  })
  it('a hand edit to the shared text is drift, and a rewrite puts it back', () => {
    const copy = mkdtempSync(join(tmpdir(), 'boys-'))
    cpSync(join(design, 'agents'), join(copy, 'agents'), { recursive: true })
    cpSync(join(design, 'skills/spidey-sense'), join(copy, 'skills/spidey-sense'), { recursive: true })
    const file = join(copy, 'agents', `${BOYS[1]}.md`)
    const before = readFileSync(file, 'utf8')
    writeFileSync(file, before.replace('## Report', '## Report (hand edit)'))
    expect(run({ design: copy, check: true })).toEqual([BOYS[1]])
    expect(run({ design: copy })).toEqual([BOYS[1]])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
