#!/usr/bin/env node
// A ready mock folder for mosbius-designs: the project's own theme tokens, a plain shell, one
// option per key behind ?option=, the theme behind ?theme=, and the shot list batch-shots.mjs
// takes in one call. Kit 1.5 (jedi-council 2.5): 6 of mosbius's 10 "Cheaper next time" lines
// asked for this, because every designer rebuilt the same scaffold by hand.
//
//   node <design>/scripts/mock-scaffold.mjs <mock folder> --topic <topic> --tokens <css>[,<css>]
//        [--options a,b] [--widths 375,1024] [--themes dark,light] [--light-at 375]
//        [--bg <--token>] [--fg <--token>] [--out <shot folder>] [--base <url>]
//
// Writes into <mock folder>:
//   mock.html   tokens + shell; reads ?option= and ?theme= (sets data-theme and the class)
//   page.js     yours: window.mockOptions = { a: () => '<html>', b: … } (never overwritten)
//   shots.json  every option at every width in the first theme, plus each other theme once
//               at --light-at: 2 options x (2 widths + 1 light) = the 6 shots of an ordinary layout
// --base <url> skips mock.html and page.js: the mock is a route in the app (Hutzup's
// src/pages/mock/), and only the shot list is written, with the same ?option= and ?theme=.
// Then: node <design>/scripts/qa/batch-shots.mjs <mock folder>/shots.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Keeps only the custom properties (--name: value) of a stylesheet, with their selectors and any
// @media around them, so a Tailwind source file (@import, @apply, @theme) becomes plain CSS a
// static page can use. @theme blocks become :root.
export function extractTokens(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const stack = [] // { prelude, decls }
  let buf = ''
  for (const ch of src) {
    if (ch === '{') {
      stack.push({ prelude: buf.trim(), decls: '' })
      buf = ''
    } else if (ch === '}') {
      const block = stack.pop()
      if (!block) continue
      const decls = (block.decls + buf)
        .split(';')
        .map((d) => d.trim())
        .filter((d) => /^--[\w-]+\s*:/.test(d))
      buf = ''
      if (!decls.length) continue
      let selector = block.prelude.startsWith('@theme') ? ':root' : block.prelude
      if (selector.startsWith('@')) continue
      const medias = stack.map((b) => b.prelude).filter((p) => p.startsWith('@media'))
      let rule = `${selector} {\n${decls.map((d) => `  ${d};`).join('\n')}\n}`
      for (const m of medias.reverse()) rule = `${m} {\n${rule}\n}`
      out.push(rule)
    } else if (ch === ';') {
      // A top-level statement (@import, @custom-variant) is dropped; inside a block it is a declaration.
      if (stack.length) stack[stack.length - 1].decls += buf + ';'
      buf = ''
    } else buf += ch
  }
  return out.join('\n')
}

export function tokenNames(css) {
  return [...new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))]
}

// The page's background and text tokens, guessed from common names when not given.
export function guessBgFg(names) {
  const bg = names.find((n) => /^--(color-)?(background|bg|surface|canvas|paper|page)(-default|-base)?$/.test(n)) ?? names.find((n) => /^--(color-)?(background|bg)/.test(n))
  const fg = names.find((n) => /^--(color-)?(foreground|fg|text|ink)(-default|-base)?$/.test(n)) ?? names.find((n) => /^--(color-)?(foreground|fg)/.test(n))
  return { bg, fg }
}

export function shotList({ topic, base, out, options, widths, themes, lightAt }) {
  const shots = []
  const [first, ...others] = themes
  for (const option of options) {
    for (const width of widths) shots.push({ name: `${topic}-${option}-${width}-${first}`, query: { option }, width, theme: first })
    for (const theme of others) shots.push({ name: `${topic}-${option}-${lightAt}-${theme}`, query: { option }, width: lightAt, theme })
  }
  return { base, out, themeVia: 'param:theme', shots }
}

export function mockHtml({ topic, tokens, sources, bg, fg }) {
  const body = [bg && `background: var(${bg});`, fg && `color: var(${fg});`].filter(Boolean).join(' ')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mock: ${topic}</title>
<style>
/* The project's tokens, from ${sources.join(', ')} (mock-scaffold.mjs; run it again to refresh). */
${tokens}
/* The shell. Bars are static: a sticky bar painted over the content in portfolio's shots. */
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; ${body} }
.mock-bar { position: static; display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 16px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
.mock-tabs { position: static; display: flex; justify-content: space-around; height: 64px; border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
.mock-tabs span { padding: 20px 8px; opacity: 0.7; }
@media (min-width: 1024px) { .mock-tabs { display: none; } }
</style>
</head>
<body>
<header class="mock-bar"><strong>${topic}</strong></header>
<main id="page"></main>
<nav class="mock-tabs"><span>Home</span><span>Tab</span><span>Tab</span><span>Me</span></nav>
<!-- A classic script, not a module: Chromium refuses module imports over file://. -->
<script>
  const q = new URLSearchParams(location.search)
  const theme = q.get('theme')
  if (theme) { document.documentElement.dataset.theme = theme; document.documentElement.classList.add(theme) }
</script>
<script src="page.js"></script>
<script>
  const options = window.mockOptions || {}
  const key = q.get('option') || Object.keys(options)[0]
  if (window.mockCss) document.head.insertAdjacentHTML('beforeend', '<style>' + window.mockCss + '</style>')
  document.getElementById('page').innerHTML = options[key] ? options[key]() : '<p>No option "' + key + '" in page.js</p>'
  document.title = 'mock: ${topic} ' + key
</script>
</body>
</html>
`
}

export function pageJs(options) {
  const lines = options.map((o) => `  ${o}: () => \`\n    <section style="padding: 16px">\n      <h1>Option ${o.toUpperCase()}</h1>\n    </section>\`,`)
  return `// Your part of the mock: one function per option, returning that option's page as HTML.
// Use the project's tokens as var(--name) so every theme is right; hard-coded data is fine.
// mock.html shows ?option=<key> (the first when none) in ?theme=<name>.
window.mockCss = \`\`
window.mockOptions = {
${lines.join('\n')}
}
`
}

export function parseArgs(argv) {
  const o = { dir: null, topic: null, tokens: [], options: ['a', 'b'], widths: [375, 1024], themes: ['dark', 'light'], lightAt: null, bg: null, fg: null, out: null, base: null }
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '--topic') o.topic = v()
    else if (a === '--tokens') o.tokens = list(v())
    else if (a === '--options') o.options = list(v())
    else if (a === '--widths') o.widths = list(v()).map(Number)
    else if (a === '--themes') o.themes = list(v())
    else if (a === '--light-at') o.lightAt = Number(v())
    else if (a === '--bg') o.bg = v()
    else if (a === '--fg') o.fg = v()
    else if (a === '--out') o.out = v()
    else if (a === '--base') o.base = v()
    else if (a === '--help' || a === '-h') o.help = true
    else if (!o.dir && !a.startsWith('--')) o.dir = a
    else throw new Error(`unknown argument ${a}`)
  }
  if (o.help) return o
  if (!o.dir || !o.topic) throw new Error('give a mock folder and --topic')
  if (!o.base && !o.tokens.length) throw new Error('give --tokens <the project CSS file with its theme variables>, or --base for a mock route in the app')
  if (o.widths.some((w) => !Number.isInteger(w))) throw new Error('--widths takes whole numbers')
  o.lightAt ??= o.widths[0]
  o.out ??= join(homedir(), '.claude/plans/design', o.topic)
  return o
}

export function scaffold(o) {
  const dir = resolve(o.dir)
  mkdirSync(dir, { recursive: true })
  const written = []
  let base = o.base
  if (!base) {
    const css = o.tokens.map((f) => readFileSync(resolve(f), 'utf8')).join('\n')
    const tokens = extractTokens(css)
    const guess = guessBgFg(tokenNames(tokens))
    const bg = o.bg ?? guess.bg
    const fg = o.fg ?? guess.fg
    writeFileSync(join(dir, 'mock.html'), mockHtml({ topic: o.topic, tokens, sources: o.tokens, bg, fg }))
    written.push(`mock.html (${tokenNames(tokens).length} tokens; page ${bg ?? 'no bg token'} on ${fg ?? 'no text token'})`)
    if (!existsSync(join(dir, 'page.js'))) {
      writeFileSync(join(dir, 'page.js'), pageJs(o.options))
      written.push('page.js')
    }
    base = pathToFileURL(join(dir, 'mock.html')).href
  }
  const list = shotList({ topic: o.topic, base, out: o.out, options: o.options, widths: o.widths, themes: o.themes, lightAt: o.lightAt })
  writeFileSync(join(dir, 'shots.json'), JSON.stringify(list, null, 2) + '\n')
  written.push(`shots.json (${list.shots.length} shots into ${o.out})`)
  return written.map((w) => join(dir, w))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const o = parseArgs(process.argv.slice(2))
    if (o.help) {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).join('\n'))
    } else {
      for (const line of scaffold(o)) console.log(line)
      console.log(`Next: fill page.js, then node ${join(dirname(fileURLToPath(import.meta.url)), 'qa/batch-shots.mjs')} ${join(resolve(o.dir), 'shots.json')}`)
    }
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
}
