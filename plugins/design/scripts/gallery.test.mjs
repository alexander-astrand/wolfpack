import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { esc, fromReports, group, normalise, parseArgs, rateLine, render, reportFiles, reportTokens, writeGallery } from './gallery.mjs'

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

// Kit 1.8 (council Features 3 and 17): the gallery from the designers' saved reports.
const REPORT_A = `**Option A** stacks. **Option B** folds.
- \`{"page": "Trips", "option": "a", "width": 375, "theme": "light", "path": "t-a-375.jpg", "note": "Stacks", "pick": true, "reason": "One column"}\`
- \`{"page": "Trips", "option": "b", "width": 375, "theme": "light", "path": "t-b-375.jpg"}\`,
{"page": "Trips", "option": "a", "width": 375, "theme": "light", "path": "t-a-375.jpg"}
{not json}
<usage>total_tokens: 4,400,000</usage>`
const REPORT_B = `{"page": "Home", "option": "a", "width": 1024, "path": "/abs/h-a.jpg", "tokens": 3000000}
{"page": "Notes", "option": "a", "width": 1024, "path": "n-a.jpg"}`

describe('from the reports', () => {
  it('takes every JSON shot line once, resolving paths from the report folder', () => {
    const { shots, rates } = fromReports([{ text: REPORT_A, dir: '/r' }, { text: REPORT_B, dir: '/r' }])
    expect(shots.map((s) => s.path)).toEqual(['/r/t-a-375.jpg', '/r/t-b-375.jpg', '/abs/h-a.jpg', '/r/n-a.jpg'])
    expect(shots[0]).toMatchObject({ pick: true, reason: 'One column', note: 'Stacks' })
    expect(shots[2]).not.toHaveProperty('tokens')
    // A report's tokens split over the pages it drew.
    expect(rates).toEqual({ Trips: 4_400_000, Home: 1_500_000, Notes: 1_500_000 })
  })

  it('reads tokens from a JSON field or the Agent result, else none', () => {
    expect(reportTokens('{"tokens": 2500000}')).toBe(2_500_000)
    expect(reportTokens('total_tokens: 1_200_000')).toBe(1_200_000)
    expect(reportTokens('no number here')).toBeNull()
    expect(fromReports([{ text: '{"page":"P","option":"a","path":"p.jpg"}' }]).rates).toEqual({})
  })

  it('refuses reports with no shot lines', () => {
    expect(() => fromReports([{ text: 'just prose' }])).toThrow(/no shot lines/)
  })

  it('prints one rate line for the notes', () => {
    expect(rateLine({ Trips: 4_400_000, Home: 1_600_000 })).toBe('Designers: 6.0M for 2 pages, 3.0M a page (Trips 4.4M, Home 1.6M).')
    expect(rateLine({})).toBeNull()
  })

  it('writes shots.json and the gallery from a folder of reports, with the rate per page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gallery-'))
    for (const f of ['t-a-375.jpg', 't-b-375.jpg']) writeFileSync(join(dir, f), Buffer.from([0xff, 0xd8, 0xff]))
    writeFileSync(join(dir, 'trips.md'), REPORT_A)
    writeFileSync(join(dir, 'image.jpg.notes'), 'ignored')
    expect(reportFiles(dir)).toEqual([join(dir, 'trips.md')])
    const o = parseArgs(['--from-reports', dir, '--words', 'Make Trips calm', '--topic', 'trips'])
    expect(o.out).toBe(join(dir, 'gallery.html'))
    const { out, rate } = writeGallery(o)
    expect(rate).toMatch(/^Designers: 4\.4M for 1 page, 4\.4M a page/)
    const html = readFileSync(out, 'utf8')
    expect(html).toContain('<blockquote>Make Trips calm</blockquote>')
    expect(html).toContain('Designer: 4.4M for this page')
    const saved = JSON.parse(readFileSync(join(dir, 'shots.json'), 'utf8'))
    expect(saved).toMatchObject({ topic: 'trips', words: ['Make Trips calm'], rates: { Trips: 4_400_000 } })
    expect(saved.shots).toHaveLength(2)
    // A second run reads the reports again, never the shots.json it wrote.
    expect(reportFiles(dir)).not.toContain(join(dir, 'shots.json'))
  })

  it('keeps a hand-curated shots.json as shots.json.bak before writing its own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gallery-'))
    for (const f of ['t-a-375.jpg', 't-b-375.jpg']) writeFileSync(join(dir, f), Buffer.from([0xff, 0xd8, 0xff]))
    writeFileSync(join(dir, 'trips.md'), REPORT_A)
    writeFileSync(join(dir, 'shots.json'), '{"title": "curated by hand"}\n')
    writeGallery(parseArgs(['--from-reports', dir]))
    expect(readFileSync(join(dir, 'shots.json.bak'), 'utf8')).toBe('{"title": "curated by hand"}\n')
    expect(JSON.parse(readFileSync(join(dir, 'shots.json'), 'utf8')).shots).toHaveLength(2)
    // The backup is no report either.
    expect(reportFiles(dir)).toEqual([join(dir, 'trips.md')])
  })

  it('refuses both inputs at once, and needs one', () => {
    expect(() => parseArgs(['s.json', '--from-reports', 'r'])).toThrow(/not both/)
    expect(() => parseArgs([])).toThrow(/--from-reports/)
  })
})
