#!/usr/bin/env node
// The spawn count `/jedi-council` reads: every Agent (or old Task) call in the
// window, per role and the model the call asked for, so a lens sees which
// routes were run above their model. First the admiral's scratch `spawns.mjs`
// (kit 1.6.1 council); standing since kit 1.7, called by council-facts.mjs.
// A call with no `model` runs on the agent file's frontmatter model.
//
// Usage: node council-spawns.mjs --since <YYYY-MM-DD> [--dir <transcripts>]…
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectDir, readEntries } from './usage.mjs'
import { windowFiles } from './council-starts.mjs'

// The role a spawn names: its subagent_type without the plugin prefix; a
// generic spawn is named by its description's "<name>:" prefix (captain-call's convention).
export function spawnRole(input = {}) {
  const type = String(input.subagent_type || 'general-purpose').replace(/^[\w-]+:/, '')
  if (!/^(general-purpose|claude)$/.test(type)) return type
  return /^\s*([a-z0-9-]+)\s*:/.exec(input.description || '')?.[1] || type
}

// Adds the spawns in `entries` to `tally` (a Map of "role / model" to count).
export function countSpawns(entries, tally = new Map()) {
  const done = new Set()
  for (const e of entries) {
    if (e?.type !== 'assistant') continue
    for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b?.type !== 'tool_use' || (b.name !== 'Agent' && b.name !== 'Task') || done.has(b.id)) continue
      done.add(b.id)
      const key = `${spawnRole(b.input)} / ${b.input?.model || '(frontmatter)'}`
      tally.set(key, (tally.get(key) || 0) + 1)
    }
  }
  return tally
}

export function spawnTally(dirs, from) {
  const tally = new Map()
  for (const dir of dirs) {
    for (const f of windowFiles(dir, from)) {
      countSpawns(readEntries(join(dir, f)), tally)
      const sub = join(dir, f.slice(0, -'.jsonl'.length), 'subagents')
      if (existsSync(sub)) for (const s of readdirSync(sub).filter((x) => x.endsWith('.jsonl'))) countSpawns(readEntries(join(sub, s)), tally)
    }
  }
  return tally
}

// One row per spawn (F21, kit 1.7.1 council): the readers asked "which runs
// were Fable and why", which the tally can't answer; the description can.
export function spawnRows(dirs, from) {
  const rows = []
  const done = new Set()
  const add = (entries, session) => {
    for (const e of entries) {
      if (e?.type !== 'assistant') continue
      const t = Date.parse(e.timestamp)
      if (!Number.isNaN(t) && t < from) continue
      for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (b?.type !== 'tool_use' || (b.name !== 'Agent' && b.name !== 'Task') || done.has(b.id)) continue
        done.add(b.id)
        rows.push({ session, time: e.timestamp || '', role: spawnRole(b.input), type: b.input?.subagent_type || 'general-purpose', model: b.input?.model || '(frontmatter)', description: String(b.input?.description || '') })
      }
    }
  }
  for (const dir of dirs) {
    for (const f of windowFiles(dir, from)) {
      const id = f.slice(0, -'.jsonl'.length)
      add(readEntries(join(dir, f)), id.slice(0, 8))
      const sub = join(dir, id, 'subagents')
      if (existsSync(sub)) for (const s of readdirSync(sub).filter((x) => x.endsWith('.jsonl'))) add(readEntries(join(sub, s)), `${id.slice(0, 8)} (agent)`)
    }
  }
  return rows.sort((a, b) => a.time.localeCompare(b.time))
}

const cell = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s).replace(/\|/g, '/')

export function spawnRowsTable(rows) {
  const out = ['| Session | Time (UTC) | Role | Agent type | Model asked | Description |', '|---|---|---|---|---|---|']
  for (const r of rows) out.push(`| ${r.session} | ${r.time.slice(5, 16).replace('T', ' ')} | ${r.role} | ${r.type.replace(/^[\w-]+:/, '')} | ${r.model} | ${cell(r.description, 80)} |`)
  return out.join('\n')
}

export function spawnsTable(tally) {
  const out = ['| Role | Model asked | Spawns |', '|---|---|---|']
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const [role, model] = k.split(' / ')
    out.push(`| ${role} | ${model} | ${n} |`)
  }
  out.push(`| **Total** | | ${[...tally.values()].reduce((s, n) => s + n, 0)} |`)
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
  if (Number.isNaN(from)) {
    console.log('Usage: node council-spawns.mjs --since <YYYY-MM-DD> [--dir <transcripts>]…')
    process.exit(1)
  }
  console.log(spawnsTable(spawnTally(dirs.length ? dirs : [projectDir(null)], from)))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
