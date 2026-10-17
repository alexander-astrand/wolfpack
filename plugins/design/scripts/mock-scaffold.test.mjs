import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractTokens, guessBgFg, parseArgs, scaffold, shotList, tokenNames } from './mock-scaffold.mjs'

const TAILWIND = `@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
/* a comment with { braces } */
@theme inline {
  --color-surface: var(--surface);
  --font-sans: system-ui;
}
@layer base {
  :root { --surface: #fff; --ink: #111 }
  .dark { --surface: #111; --ink: #eee; }
  body { margin: 0; @apply text-ink; }
}
@media (prefers-color-scheme: dark) {
  :root:not(.light) { --surface: #000; }
}
.card { padding: 4px; }
`

describe('extractTokens', () => {
  const out = extractTokens(TAILWIND)
  it('keeps only custom properties, with their selectors', () => {
    expect(out).toContain(':root {\n  --color-surface: var(--surface);\n  --font-sans: system-ui;\n}')
    expect(out).toContain('.dark {\n  --surface: #111;\n  --ink: #eee;\n}')
    expect(out).toContain('--ink: #111;')
    expect(out).not.toMatch(/@import|@apply|@custom-variant|padding|margin|comment/)
  })
  it('keeps the @media around a block', () => {
    expect(out).toContain('@media (prefers-color-scheme: dark) {\n:root:not(.light) {\n  --surface: #000;\n}\n}')
  })
})

describe('guessBgFg', () => {
  it('finds common background and text names', () => {
    expect(guessBgFg(tokenNames(extractTokens(TAILWIND)))).toEqual({ bg: '--color-surface', fg: '--ink' })
    expect(guessBgFg(['--brand', '--background', '--foreground'])).toEqual({ bg: '--background', fg: '--foreground' })
    expect(guessBgFg(['--brand'])).toEqual({ bg: undefined, fg: undefined })
  })
})

describe('shotList', () => {
  it('is every option at every width in the first theme, plus each other theme once', () => {
    const l = shotList({ topic: 't', base: 'file:///m.html', out: '/o', options: ['a', 'b'], widths: [375, 1024], themes: ['dark', 'light'], lightAt: 375 })
    expect(l.shots.map((s) => s.name)).toEqual(['t-a-375-dark', 't-a-1024-dark', 't-a-375-light', 't-b-375-dark', 't-b-1024-dark', 't-b-375-light'])
    expect(l.shots[0]).toEqual({ name: 't-a-375-dark', query: { option: 'a' }, width: 375, theme: 'dark' })
  })
})

describe('parseArgs', () => {
  it('needs a folder, a topic and tokens or a base', () => {
    expect(() => parseArgs(['x'])).toThrow(/topic/)
    expect(() => parseArgs(['x', '--topic', 't'])).toThrow(/--tokens/)
    const o = parseArgs(['x', '--topic', 't', '--base', 'http://localhost:5174/mock/t', '--widths', '390,1440'])
    expect(o.lightAt).toBe(390)
    expect(o.out).toMatch(/\.claude\/plans\/design\/t$/)
  })
})

describe('scaffold', () => {
  it('writes the mock, the page and the shot list, and never overwrites page.js', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mock-'))
    const css = join(dir, 'index.css')
    writeFileSync(css, TAILWIND)
    scaffold(parseArgs([join(dir, 'm'), '--topic', 'tt', '--tokens', css, '--out', join(dir, 'shots')]))
    const html = readFileSync(join(dir, 'm/mock.html'), 'utf8')
    expect(html).toContain('background: var(--color-surface); color: var(--ink);')
    expect(html).toContain('<script src="page.js"></script>')
    expect(readFileSync(join(dir, 'm/page.js'), 'utf8')).toContain('window.mockOptions')
    const list = JSON.parse(readFileSync(join(dir, 'm/shots.json'), 'utf8'))
    expect(list.base).toMatch(/^file:\/\/.*\/m\/mock\.html$/)
    expect(list.shots).toHaveLength(6)
    writeFileSync(join(dir, 'm/page.js'), 'mine')
    scaffold(parseArgs([join(dir, 'm'), '--topic', 'tt', '--tokens', css]))
    expect(readFileSync(join(dir, 'm/page.js'), 'utf8')).toBe('mine')
  })
  it('writes only the shot list for a mock route in the app', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mock-'))
    scaffold(parseArgs([dir, '--topic', 'tt', '--base', 'http://localhost:5174/mock/tt']))
    expect(existsSync(join(dir, 'mock.html'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'shots.json'), 'utf8')).base).toBe('http://localhost:5174/mock/tt')
  })
})
