#!/usr/bin/env node
// The one gallery page of a design round, written from the designers' shot paths in one call.
// Kit 1.7 (jedi-council 1.6.1 M11, Feature 8): three files named three gallery authors and an
// agent hand-built the HTML each round; now the session that publishes runs this, and nobody
// else writes a gallery.
//
//   node <design>/scripts/gallery.mjs <shots.json> [--out <file>] [--title <title>]
//   node <design>/scripts/gallery.mjs --from-reports <report file or folder> [--words <his words>]...
//                                     [--topic <topic>] [--out <file>] [--title <title>]
//
// --from-reports reads the designers' saved reports (kit 1.8): every JSON shot line in them, and
// each report's tokens (a "tokens" field or the Agent result's total_tokens) as a per-page rate.
// It writes shots.json beside the gallery from them, shows the rate per page, and prints the
// rate line for the gallery notes.
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
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
  const rate = rateLine(doc.rates ?? {})
  const words = doc.words.map((w) => `<blockquote>${esc(w)}</blockquote>`).join('\n') + (rate ? `\n<p class="pick-line">${esc(rate)}</p>` : '')
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
      const tokens = doc.rates?.[p.page]
      const cost = Number.isFinite(tokens) ? `<p class="pick-line">Designer: ${esc(millions(tokens))} for this page</p>` : ''
      return `<h2>${esc(p.page)}</h2>\n${pick}${cost}\n<div class="options">\n${options}\n</div>`
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

// ---------------------------------------------------------------- from the reports
// Kit 1.8 (jedi-council 1.7.1 Features 3 and 17): the session hand-built shots.json from the
// designers' reports each round. Now it saves each report as it comes back and the script reads
// the JSON shot lines `mosbius-designs` writes (its step 5), and the report's tokens when present.

// A report line that is a JSON object: as is, in backticks, or as a list item, with a trailing comma.
function jsonLine(line) {
  const t = line.trim().replace(/^[-*]\s+/, '').replace(/,$/, '').replace(/^`+|`+$/g, '').replace(/,$/, '').trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  try {
    const v = JSON.parse(t)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

// The report's own spend: a `"tokens": N` on any JSON line, else the Agent tool's
// `total_tokens: N` (a saved agent result), else null. Designers can't count their own tokens,
// so the number comes from the result the session saved.
export function reportTokens(text) {
  let best = null
  for (const line of text.split('\n')) {
    const v = jsonLine(line)
    if (v && Number.isFinite(v.tokens)) best = Math.max(best ?? 0, v.tokens)
  }
  if (best != null) return best
  const m = /total_tokens["']?\s*[:=]\s*([\d,_]+)/i.exec(text)
  return m ? Number(m[1].replace(/[,_]/g, '')) : null
}

/**
 * Shots and per-page tokens from report texts (`[{ text, dir }]`, `dir` the folder relative shot
 * paths are read from). A report's tokens are split evenly over the pages it drew; a shot seen
 * twice (same path) is kept once.
 */
export function fromReports(reports) {
  const shots = []
  const seen = new Set()
  const rates = {}
  for (const { text, dir = '.' } of reports) {
    const pages = new Set()
    for (const line of text.split('\n')) {
      const v = jsonLine(line)
      if (!v || !v.page || !v.option || !v.path) continue
      const path = resolve(dir, v.path)
      pages.add(v.page)
      if (seen.has(path)) continue
      seen.add(path)
      const { tokens, ...shot } = v
      shots.push({ ...shot, path })
    }
    const tokens = reportTokens(text)
    if (tokens != null && pages.size) for (const p of pages) rates[p] = (rates[p] ?? 0) + tokens / pages.size
  }
  if (!shots.length) throw new Error('no shot lines in the reports: each is one JSON line {"page", "option", "width", "theme", "path", "note"}')
  return { shots, rates }
}

const REPORT_EXT = new Set(['.md', '.txt', '.json', '.jsonl', '.log'])

/** The report files: one file, or every report-like file directly in a folder. */
export function reportFiles(path) {
  const p = resolve(path)
  if (!statSync(p).isDirectory()) return [p]
  return readdirSync(p)
    .filter((f) => REPORT_EXT.has(extname(f).toLowerCase()) && f !== 'shots.json')
    .sort()
    .map((f) => join(p, f))
}

const millions = (n) => `${(n / 1_000_000).toFixed(1)}M`

/** One line for the gallery notes: the designers' spend and the rate a page, or null without tokens. */
export function rateLine(rates) {
  const pages = Object.keys(rates)
  if (!pages.length) return null
  const total = Object.values(rates).reduce((a, b) => a + b, 0)
  return `Designers: ${millions(total)} for ${pages.length} page${pages.length === 1 ? '' : 's'}, ${millions(total / pages.length)} a page (${pages.map((p) => `${p} ${millions(rates[p])}`).join(', ')}).`
}

export function parseArgs(argv) {
  const o = { input: null, out: null, title: null, fromReports: null, words: [], topic: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (['--out', '--title', '--from-reports', '--words', '--topic'].includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      const v = argv[++i]
      if (a === '--words') o.words.push(v)
      else if (a === '--from-reports') o.fromReports = v
      else o[a.slice(2)] = v
    } else if (a === '--help' || a === '-h') o.help = true
    else if (!o.input && !a.startsWith('--')) o.input = a
    else throw new Error(`unknown argument ${a}`)
  }
  if (o.help) return o
  if (!o.input && !o.fromReports) throw new Error('give the shots JSON file, or --from-reports <file or folder>')
  if (o.input && o.fromReports) throw new Error('give the shots JSON file or --from-reports, not both')
  if (o.fromReports && !o.out) {
    const p = resolve(o.fromReports)
    o.out = join(existsSync(p) && statSync(p).isDirectory() ? p : dirname(p), 'gallery.html')
  }
  o.out ??= join(dirname(resolve(o.input)), 'gallery.html')
  return o
}

export function writeGallery(o) {
  let doc
  if (o.fromReports) {
    const files = reportFiles(o.fromReports)
    const { shots, rates } = fromReports(files.map((f) => ({ text: readFileSync(f, 'utf8'), dir: dirname(f) })))
    doc = normalise({ topic: o.topic ?? undefined, words: o.words, shots })
    doc.rates = rates
    // The record of what the gallery shows, written for the next round and the cull: never by hand.
    writeFileSync(join(dirname(o.out), 'shots.json'), JSON.stringify({ topic: o.topic ?? undefined, words: doc.words, rates, shots }, null, 2) + '\n')
  } else {
    const base = dirname(resolve(o.input))
    doc = normalise(JSON.parse(readFileSync(resolve(o.input), 'utf8')))
    // Relative shot paths are read from the JSON's folder.
    doc.shots = doc.shots.map((s) => ({ ...s, path: resolve(base, s.path) }))
  }
  if (o.title) doc.title = o.title
  // A missing image fails the whole page.
  const missing = doc.shots.filter((s) => !existsSync(s.path)).map((s) => s.path)
  if (missing.length) throw new Error(`missing shots:\n  ${missing.join('\n  ')}`)
  const html = render(doc)
  writeFileSync(o.out, html)
  return { out: o.out, bytes: Buffer.byteLength(html), rate: rateLine(doc.rates ?? {}) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const o = parseArgs(process.argv.slice(2))
    if (o.help) {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//'))).join('\n'))
    } else {
      const { out, bytes, rate } = writeGallery(o)
      console.log(`${out} (${(bytes / 1024).toFixed(0)} KB)`)
      if (o.fromReports) console.log(`${join(dirname(out), 'shots.json')} (written from the reports)`)
      if (rate) console.log(`${rate} Put this line in the gallery notes (notes.md).`)
      console.log('Next: publish this file with the Artifact tool (private) and keep the link.')
    }
  } catch (e) {
    console.error(`gallery: ${e.message}`)
    process.exit(1)
  }
}
