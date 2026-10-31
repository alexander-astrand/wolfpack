#!/usr/bin/env node
// Who asks, and why, for `/jedi-council` (F21, kit 1.7.1 council): the guard's
// asks and denies per agent by reason, and the questions (AskUserQuestion calls)
// per skill and per session. The readers' cheaper lines asked for these: "whose
// habit is the psql ask" and "which skill asks the most" took a hand grep each.
// Called by council-facts.mjs; plain functions, paths passed in.
//
// The guard log is tab-separated (columns in denied-log.mjs): 2 agent, 8
// decision, 9 the reason's first line, and 10 a stable reason code once the
// guard writes one. The code wins when present; the text is the fallback.
//
// Questions are counted the way the kit 1.7.1 council counted its 1,508: every
// main transcript touched since the window's start, sub-agents left out (they
// can't ask), each tool_use id once. The in-window count is printed beside it.
//
// Usage: node council-asks.mjs --since <YYYY-MM-DD> [--dir <transcripts>]… [--guard <guard-decisions.log>]…
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readEntries } from './usage.mjs'
import { windowFiles } from './council-starts.mjs'
import { sessionLabel, skillKey } from './council-speed.mjs'

// The reason a guard row counts under: column 10's code, else column 9's text cut short.
export function guardReason(cols) {
  const code = (cols[9] || '').trim()
  if (code) return code
  const text = (cols[8] || '').trim()
  return text ? (text.length > 70 ? `${text.slice(0, 67)}...` : text) : '(no reason)'
}

// The calls an `allows` row let through: column 4 is its JSON counts
// ({ calls, asks, denies, through }, the guard paste's allowsLine). The same
// small sum as denied-log.mjs's guardTotals, kept here so this script reads no
// hook file that may not be pasted yet. A cut row counts 0.
export function allowsThrough(cols) {
  try {
    return Number(JSON.parse(cols[3]).through) || 0
  } catch {
    return 0
  }
}

// Map "agent\tdecision\treason" to count, for rows on or after `from`. An
// `allows` row is one per session, so counting rows printed the number of
// sessions as "allows": it counts the calls let through instead, from the last
// `allows` row per session id (column 6).
export function guardReasons(files, from, tally = new Map()) {
  const allows = new Map()
  for (const file of files) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const cols = line.split('\t')
      if (!line.trim() || Date.parse(cols[0]) < from) continue
      const key = `${cols[1] || '?'}\t${cols[7] || '?'}\t${guardReason(cols)}`
      if (cols[7] === 'allows') {
        allows.set(cols[5] || '?', { key, n: allowsThrough(cols) })
        continue
      }
      tally.set(key, (tally.get(key) || 0) + 1)
    }
  }
  for (const { key, n } of allows.values()) tally.set(key, (tally.get(key) || 0) + n)
  return tally
}

export function guardTable(tally) {
  if (!tally.size) return 'No guard rows in the window (no `.claude/guard-decisions.log`, or none since the start).'
  const out = ['| Agent | Decision | Reason (code, or the text) | Rows (allows: calls let through) |', '|---|---|---|---|']
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const [agent, decision, reason] = k.split('\t')
    out.push(`| ${agent} | ${decision} | ${reason.replace(/\|/g, '/')} | ${n} |`)
  }
  return out.join('\n')
}

// Every AskUserQuestion in the main transcripts of `dirs` touched since `from`.
export function questionTally(dirs, from) {
  const bySkill = new Map()
  const bySession = []
  const ids = new Set()
  let all = 0
  let inWindow = 0
  for (const dir of dirs) {
    for (const f of windowFiles(dir, from)) {
      const entries = readEntries(join(dir, f))
      const label = sessionLabel(entries)
      let n = 0
      for (const e of entries) {
        if (e?.type !== 'assistant') continue
        for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
          if (b?.type !== 'tool_use' || b.name !== 'AskUserQuestion' || ids.has(b.id)) continue
          ids.add(b.id)
          n += 1
          all += 1
          if (!(Date.parse(e.timestamp) < from)) inWindow += 1
        }
      }
      if (!n) continue
      bySession.push({ session: f.slice(0, 8), label, n })
      const skill = skillKey(label) ? `/${skillKey(label)}` : '(no command)'
      bySkill.set(skill, (bySkill.get(skill) || 0) + n)
    }
  }
  return { bySkill, bySession: bySession.sort((a, b) => b.n - a.n), all, inWindow }
}

export function questionsTable(q) {
  const out = [`${q.all} AskUserQuestion calls in every main transcript touched since the window's start (${q.inWindow} dated inside it); sub-agents left out, each call once.`, '']
  out.push('| Skill (session start) | Questions |', '|---|---|')
  for (const [k, n] of [...q.bySkill].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) out.push(`| ${k} | ${n} |`)
  out.push('', '| Session | Command or title | Questions |', '|---|---|---|')
  for (const s of q.bySession) out.push(`| ${s.session} | ${s.label.replace(/\|/g, '/')} | ${s.n} |`)
  return out.join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const dirs = []
  const guards = []
  let since = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dirs.push(argv[++i])
    else if (argv[i] === '--guard') guards.push(argv[++i])
    else if (argv[i] === '--since') since = argv[++i]
  }
  const from = Date.parse(since ?? '')
  if (Number.isNaN(from)) {
    console.log('Usage: node council-asks.mjs --since <YYYY-MM-DD> [--dir <transcripts>]… [--guard <guard-decisions.log>]…')
    process.exit(1)
  }
  console.log(guardTable(guardReasons(guards, from)))
  console.log('')
  console.log(questionsTable(questionTally(dirs, from)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main()
