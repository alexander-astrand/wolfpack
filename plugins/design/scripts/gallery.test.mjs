import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { esc, group, normalise, parseArgs, render, writeGallery } from './gallery.mjs'

const SHOTS = [
  { page: 'Profile', option: 'b', width: 1024, theme: 'dark', path: 'p-b-1024.jpg' },
  { page: 'Profile', option: 'a', width: 1024, theme: 'dark', path: 'p-a-1024.jpg', note: 'Two stacks' },
  { page: 'Profile', option: 'a', width: 375, theme: 'dark', path: 'p-a-375.jpg', pick: true, reason: 'One scrollbar' },
  { page: 'Notes', option: 'a', width: 375, path: 'n-a-375.png' },
]
const fakeUri = (p) => `data:image/jpeg;base64,${p}`

describe('normalise', () => {
  it('takes a bare list or an object with shots', () => {
    expect(normalise(SHOTS).shots).toHaveLength(4)
    expect(normalise({ topic: 't', words: 'his words', shots: SHOTS }).words).toEqual(['his words'])
  })
  it('refuses a shot without a page, option or path', () => {
    expect(() => normalise([{ page: 'x', option: 'a' }])).toThrow(/shot 1 has no "path"/)
    expect(() => normalise({})).toThrow(/no shots/)
  })
})

describe('group', () => {
  it('keeps first-seen page and option order, sorts shots by width, finds the pick', () => {
    const [profile, notes] = group(SHOTS)
    expect(profile.page).toBe('Profile')
    expect(profile.options.map((o) => o.option)).toEqual(['b', 'a'])
    expect(profile.options[1].shots.map((s) => s.width)).toEqual([375, 1024])
    expect(profile.options[1].note).toBe('Two stacks')
    expect(profile).toMatchObject({ pick: 'a', reason: 'One scrollbar' })
    expect(notes.pick).toBeNull()
  })
  it('refuses two picks on one page', () => {
    expect(() => group([...SHOTS, { page: 'Profile', option: 'b', path: 'x.jpg', pick: true }])).toThrow(/two picks/)
  })
})

describe('render', () => {
  const html = render(normalise({ topic: 'wide', words: ['Make it <bigger> & "better"'], shots: SHOTS }), fakeUri)
  it('quotes his words escaped at the top', () => {
    expect(html).toContain('<blockquote>Make it &lt;bigger&gt; &amp; &quot;better&quot;</blockquote>')
    expect(html.indexOf('<blockquote>')).toBeLessThan(html.indexOf('<h2>Profile</h2>'))
  })
  it('inlines every image and marks the pick', () => {
    expect(html.match(/<img src="data:image\/jpeg;base64,/g)).toHaveLength(4)
    expect(html).toContain('Option A <span class="badge">Pick</span>')
    expect(html).toContain('Pick: option A. One scrollbar')
  })
  it('carries light and dark tokens and never scrolls sideways', () => {
    expect(html).toContain('@media (prefers-color-scheme: dark)')
    expect(html).toContain('overflow-x: hidden')
    expect(html).toContain('max-width: 100%')
    expect(html).toContain('width=device-width')
  })
  it('escapes every typed field', () => {
    expect(esc(`<a href='x'>`)).toBe('&lt;a href=&#39;x&#39;&gt;')
  })
})

describe('writeGallery', () => {
  it('reads shot paths beside the JSON and writes gallery.html there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gallery-'))
    writeFileSync(join(dir, 'a.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
    writeFileSync(join(dir, 'shots.json'), JSON.stringify([{ page: 'P', option: 'a', width: 375, path: 'a.jpg' }]))
    const o = parseArgs([join(dir, 'shots.json')])
    expect(o.out).toBe(join(dir, 'gallery.html'))
    const { out, bytes } = writeGallery(o)
    expect(bytes).toBeGreaterThan(0)
    expect(readFileSync(out, 'utf8')).toContain('data:image/jpeg;base64,/9j/')
  })
  it('fails on a missing shot and names it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gallery-'))
    writeFileSync(join(dir, 'shots.json'), JSON.stringify([{ page: 'P', option: 'a', path: 'gone.jpg' }]))
    expect(() => writeGallery(parseArgs([join(dir, 'shots.json')]))).toThrow(/missing shots:[\s\S]*gone\.jpg/)
  })
})
