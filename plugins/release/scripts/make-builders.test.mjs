import { describe, expect, it } from 'vitest'
import { BUILDERS, MARKER, expected, sync } from './make-builders.mjs'

describe('make-builders', () => {
  it('keeps all six builders in step with templates/builder.md', () => {
    expect(sync()).toEqual([])
  })

  it('keeps the head and replaces only what follows the marker', () => {
    expect(expected(`head\n${MARKER}\n\nold body`, 'new body\n')).toBe(`head\n${MARKER}\n\nnew body\n`)
  })

  it('names the five Opus builders and the Sonnet one', () => {
    expect(BUILDERS).toHaveLength(6)
  })
})
