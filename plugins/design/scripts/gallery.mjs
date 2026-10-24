#!/usr/bin/env node
// The one gallery page of a design round, written from the designers' shot paths in one call.
// Kit 1.7 (jedi-council 1.6.1 M11, Feature 8): three files named three gallery authors and an
// agent hand-built the HTML each round; now the session that publishes runs this, and nobody
// else writes a gallery.
//
//   node <design>/scripts/gallery.mjs <shots.json> [--out <file>] [--title <title>]
//
// <shots.json> is a list of shots, or { "topic", "title", "words": [...], "shots": [...] }:
//   { "page": "Profile", "option": "a", "width": 375, "theme": "dark", "path": "<jpg>",
//     "note": "what the option does", "pick": true, "reason": "why it wins" }
// "words" are Alexander's words, quoted at the top verbatim. "pick" and "reason" are the
// designer's or heisenberg's pick for that page, on any one shot of the picked option; "note"
// on any shot of an option. Images are inlined as data URIs, so the page stands alone and the
// Artifact tool can publish it as is. Light and dark follow the viewer's setting; at 375 the page
// never scrolls sideways.
// Writes <out> (default: gallery.html beside the JSON) and prints its path and size.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

// Typed text (his words, notes, reasons) goes into HTML, so every piece is escaped.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function normalise(input) {
  const doc = Array.isArray(input) ? { shots: input } : { ...input }
  if (!Array.isArray(doc.shots) || !doc.shots.length) throw new Error('no shots: give a list, or an object with "shots"')
  doc.shots.forEach((s, i) => {
    for (const k of ['page', 'option', 'path']) if (!s[k]) throw new Error(`shot ${i + 1} has no "${k}"`)
  })
  doc.words = [].concat(doc.words ?? []).filter(Boolean)
  return doc
}

// Pages in the order they first appear, each with its options in first-seen order and the shots
// sorted by width so 375 sits before 1024 everywhere.
export function group(shots) {
  const pages = new Map()
  for (const s of shots) {
    if (!pages.has(s.page)) pages.set(s.page, { page: s.page, options: new Map(), pick: null, reason: '' })
    const p = pages.get(s.page)
    if (!p.options.has(s.option)) p.options.set(s.option, { option: s.option, note: '', shots: [] })
    const o = p.options.get(s.option)
    o.shots.push(s)
    if (s.note && !o.note) o.note = s.note
    if (s.pick) {
      if (p.pick && p.pick !== s.option) throw new Error(`page "${s.page}" has two picks: ${p.pick} and ${s.option}`)
      p.pick = s.option
      if (s.reason) p.reason = s.reason
    }
  }
  return [...pages.values()].map((p) => ({
    ...p,
    options: [...p.options.values()].map((o) => ({ ...o, shots: o.shots.sort((a, b) => (Number(a.width) || 0) - (Number(b.width) || 0)) })),
  }))
}

export function dataUri(path, read = readFileSync) {
  const mime = MIME[extname(path).toLowerCase()]
  if (!mime) throw new Error(`not an image type the page can inline: ${path}`)
  return `data:${mime};base64,${read(path).toString('base64')}`
}

const CSS = `
:root { color-scheme: light dark; --bg: #f7f5f0; --card: #ffffff; --ink: #1d1b18; --muted: #5c574f; --line: #dcd6cc; --accent: #8a5a00; --pick-bg: #fbefd6; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #15140f; --card: #211f19; --ink: #f1ede4; --muted: #b3ac9f; --line: #3a362d; --accent: #f0b84a; --pick-bg: #3a2e14; }
}
* { box-sizing: border-box; }
html, body { margin: 0; overflow-x: hidden; }
body { background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, sans-serif; padding: 16px; }
main { max-width: 1280px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 12px; }
h2 { font-size: 1.25rem; margin: 32px 0 8px; }
h3 { font-size: 1rem; margin: 0 0 4px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
blockquote { margin: 0 0 8px; padding: 8px 12px; border-left: 3px solid var(--accent); background: var(--card); overflow-wrap: anywhere; }
.pick-line { margin: 0 0 12px; color: var(--muted); overflow-wrap: anywhere; }
.options { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
.option { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; min-width: 0; }
.option.picked { border-color: var(--accent); }
.badge { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--pick-bg); color: var(--ink); border: 1px solid var(--accent); }
.note { margin: 0 0 8px; color: var(--muted); overflow-wrap: anywhere; }
.shots { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }
figure { margin: 0; flex: 1 1 140px; min-width: 0; }
figure.w-wide { flex-basis: 260px; }
img { display: block; max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line); }
figcaption { font-size: 0.8rem; color: var(--muted); margin-top: 4px; }
`

export function render(doc, uri = dataUri) {
  const pages = group(doc.shots)
  const title = doc.title || (doc.topic ? `Design gallery: ${doc.topic}` : 'Design gallery')
  const words = doc.words.map((w) => `<blockquote>${esc(w)}</blockquote>`).join('\n')
  const body = pages
    .map((p) => {
      const options = p.options
        .map((o) => {
          const picked = p.pick === o.option
          const shots = o.shots
            .map((s) => {
              const cap = [s.width && `${s.width}px`, s.theme].filter(Boolean).join(' · ')
              const wide = Number(s.width) >= 1024 ? ' class="w-wide"' : ''
              return `<figure${wide}><img src="${uri(s.path)}" alt="${esc(`${p.page}, option ${o.option}${cap ? `, ${cap}` : ''}`)}" loading="lazy"><figcaption>${esc(cap)}</figcaption></figure>`
            })
            .join('')
          return `<section class="option${picked ? ' picked' : ''}"><h3>Option ${esc(String(o.option).toUpperCase())}${picked ? ' <span class="badge">Pick</span>' : ''}</h3>${o.note ? `<p class="note">${esc(o.note)}</p>` : ''}<div class="shots">${shots}</div></section>`
        })
        .join('\n')
      const pick = p.pick ? `<p class="pick-line">Pick: option ${esc(String(p.pick).toUpperCase())}${p.reason ? `. ${esc(p.reason)}` : ''}</p>` : ''
      return `<h2>${esc(p.page)}</h2>\n${pick}\n<div class="options">\n${options}\n</div>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${words}
${body}
</main>
</body>
</html>
`
}

export function parseArgs(argv) {
  const o = { input: null, out: null, title: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out' || a === '--title') {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      o[a.slice(2)] = argv[++i]
    } else if (a === '--help' || a === '-h') o.help = true
    else if (!o.input && !a.startsWith('--')) o.input = a
    else throw new Error(`unknown argument ${a}`)
  }
  if (o.help) return o
  if (!o.input) throw new Error('give the shots JSON file')
  o.out ??= join(dirname(resolve(o.input)), 'gallery.html')
  return o
}

export function writeGallery(o) {
  const base = dirname(resolve(o.input))
  const doc = normalise(JSON.parse(readFileSync(resolve(o.input), 'utf8')))
  if (o.title) doc.title = o.title
  // Relative shot paths are read from the JSON's folder; a missing image fails the whole page.
  doc.shots = doc.shots.map((s) => ({ ...s, path: resolve(base, s.path) }))
  const missing = doc.shots.filter((s) => !existsSync(s.path)).map((s) => s.path)
  if (missing.length) throw new Error(`missing shots:\n  ${missing.join('\n  ')}`)
  const html = render(doc)
  writeFileSync(o.out, html)
  return { out: o.out, bytes: Buffer.byteLength(html) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const o = parseArgs(process.argv.slice(2))
    if (o.help) {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 18).join('\n'))
    } else {
      const { out, bytes } = writeGallery(o)
      console.log(`${out} (${(bytes / 1024).toFixed(0)} KB)`)
      console.log('Next: publish this file with the Artifact tool (private) and keep the link.')
    }
  } catch (e) {
    console.error(`gallery: ${e.message}`)
    process.exit(1)
  }
}
