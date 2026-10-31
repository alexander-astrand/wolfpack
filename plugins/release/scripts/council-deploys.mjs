#!/usr/bin/env node
// The window's `/one-ring` runs as one table for `/jedi-council`'s deploy lens
// ("for the next council", kit 1.7.1): each run's session, start, argument,
// how it ended (the deploy script's `DONE:` or `STOP <kind>:` line) and its
// cost line when the run printed one (Feature 6 prints it at DONE). The
// deploy lens read six sessions by hand to build this. Called by
// council-facts.mjs; the session's tokens are in the speed table by its id.
//
// Usage: node council-deploys.mjs --since <YYYY-MM-DD> [--dir <transcripts>]…
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readEntries } from './usage.mjs'
import { windowFiles } from './council-starts.mjs'

const ONE_RING = /<command-name>\s*\/?(?:[\w-]+:)?one-ring\s*<\/command-name>/
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : b?.type === 'tool_result' ? textOf(b.content) : '')).join('\n') : '')

// The runs in one transcript: each /one-ring command and what followed it, up
// to the next /one-ring command.
export function runsIn(entries, session) {
  const runs = []
  for (const e of entries) {
    const text = textOf(e?.message?.content)
    if (e?.type === 'user' && ONE_RING.test(text)) {
      runs.push({ session, start: e.timestamp || '', arg: (/<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] || '').trim(), ended: null, cost: null })
      continue
    }
    const run = runs.at(-1)
    if (!run || !text) continue
    if (!run.ended) {
      const end = /^(DONE: .*|STOP [\w-]+: .*)$/m.exec(text)
      if (end) run.ended = end[1].trim()
    }
    if (!run.cost) {
      const cost = /^.*\bcost\b.*\d+(?:\.\d+)?\s?M\b.*$/im.exec(text)
      if (cost) run.cost = cost[0].trim()
    }
  }
  return runs
}

export function deployRuns(dirs, from) {
  const runs = []
  for (const dir of dirs) for (const f of windowFiles(dir, from)) runs.push(...runsIn(readEntries(join(dir, f)), f.slice(0, 8)).filter((r) => !(Date.parse(r.start) < from)))
  return runs.sort((a, b) => a.start.localeCompare(b.start))
}

const cell = (s, n) => (s ? (s.length > n ? `${s.slice(0, n - 3)}...` : s).replace(/\|/g, '/') : '–')

export function deploysTable(runs) {
  if (!runs.length) return 'No `/one-ring` runs in the window.'
  const out = ['| Session | Start (UTC) | Argument | Ended | Cost line |', '|---|---|---|---|---|']
  for (const r of runs) out.push(`| ${r.session} | ${r.start.slice(5, 16).replace('T', ' ')} | ${cell(r.arg, 30)} | ${cell(r.ended, 90)} | ${cell(r.cost, 90)} |`)
  out.push('', `${runs.length} runs, ${runs.filter((r) => r.ended?.startsWith('DONE')).length} reached DONE, ${runs.filter((r) => r.cost).length} printed a cost line.`)
  return out.join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const dirs = []
  let since = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dirs.push(argv[++i])
    else if (argv[i] === '--since') since = argv[++i]
  }
  const from = Date.parse(since ?? '')
  if (Number.isNaN(from) || !dirs.length) {
    console.log('Usage: node council-deploys.mjs --since <YYYY-MM-DD> --dir <transcripts>…')
    process.exit(1)
  }
  console.log(deploysTable(deployRuns(dirs, from)))
}

if (process.argv[1] && import.meta.url === pathToFileURL((await import('node:fs')).realpathSync(process.argv[1])).href) main()
