#!/usr/bin/env node
// One call for a release's roadmap status (jedi-council 1.9 F8): edits the release's line in
// <plans>roadmap.md, the record, and prints the matching page row write in the-trail's shape.
// This script cannot call the Artifact tool: the navigator makes the one ArtifactData `update`
// itself from the JSON printed here. The row's `if_version` pin comes from the `get` of the card
// (the-trail step 1 reads it first), so it prints as a placeholder for the navigator to fill.
//
//   node <release>/scripts/roadmap-apply.mjs --release V1.12 --status "In review (draft PR 91)"
//        [--plans <dir, default ~/.claude/plans/>] [--dry]
//
// <plans>roadmap.md holds one bullet per release: `- V1.12 · title · ... · <status>`. The status is
// the segment that starts with Planned, Planning, In progress, In review, Shipped or Parked; it is
// replaced, or appended as a last segment when the line has none. The file is written only when the
// line changes (--dry writes nothing). Exit 1 when the release has no line (add the card first).
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATUS_SEGMENT = /^(planned|planning|in progress|in review|shipped|parked)\b/i

export function parseArgs(argv) {
  const o = { plans: join(homedir(), '.claude', 'plans'), release: null, status: null, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--plans') o.plans = argv[++i]
    else if (a === '--release') o.release = argv[++i]
    else if (a === '--status') o.status = argv[++i]
    else if (a === '--dry') o.dry = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (!o.release || !o.status) throw new Error('needs --release <version> and --status <text>')
  // " · " separates the line's segments, so a status holding one could not be found again on the next call.
  if (o.status.includes(' · ')) throw new Error('--status must not contain " · " (write "Shipped (PR 91)")')
  return o
}

// The page's status enum from the status words (the-trail: shipped | in-progress | in-review | planned | parked).
export function statusKey(text) {
  const t = text.trim().toLowerCase()
  if (t.startsWith('shipped')) return 'shipped'
  if (t.startsWith('in progress')) return 'in-progress'
  if (t.startsWith('in review')) return 'in-review'
  if (t.startsWith('parked')) return 'parked'
  if (t.startsWith('planned') || t.startsWith('planning')) return 'planned'
  throw new Error(`status "${text}" must start with Shipped, In progress, In review, Planned or Parked`)
}

export const anchorOf = (release) => `v${release.replace(/^v/i, '').replace(/\./g, '-').toLowerCase()}`

// Returns the new text and whether a line changed, or null when the release has no line.
export function applyStatus(text, release, status) {
  const ver = release.replace(/^v/i, '')
  const lines = text.split('\n')
  const at = lines.findIndex((l) => new RegExp(`^- v${ver.replace(/\./g, '\\.')} ·`, 'i').test(l))
  if (at < 0) return null
  const parts = lines[at].split(' · ')
  const k = parts.findIndex((p, i) => i > 0 && STATUS_SEGMENT.test(p))
  if (k > 0) parts[k] = status
  else parts.push(status)
  const next = parts.join(' · ')
  const changed = next !== lines[at]
  lines[at] = next
  return { text: lines.join('\n'), changed, line: next }
}

export function rowWrite(release, status, now = new Date()) {
  return {
    op: 'update',
    path: `cards/${anchorOf(release)}`,
    if_version: '<version from the get of this card>',
    value: { status: statusKey(status), badge: status, updated_at: now.toISOString() },
  }
}

export function main(argv, out = console.log) {
  const o = parseArgs(argv)
  const file = join(o.plans, 'roadmap.md')
  if (!existsSync(file)) throw new Error(`no ${file}`)
  const r = applyStatus(readFileSync(file, 'utf8'), o.release, o.status)
  if (!r) throw new Error(`${file} has no line starting "- ${o.release} ·": add the card first`)
  const row = rowWrite(o.release, o.status)
  if (r.changed && !o.dry) writeFileSync(file, r.text)
  out(`${o.dry ? 'would write' : r.changed ? 'wrote' : 'unchanged'} ${file}`)
  out(r.line.length > 200 ? `${r.line.slice(0, 200)}...` : r.line)
  out('page row write for the navigator (one ArtifactData update, then get it back):')
  out(JSON.stringify(row, null, 2))
  return 0
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
