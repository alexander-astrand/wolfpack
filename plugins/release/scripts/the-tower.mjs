#!/usr/bin/env node
// /the-tower: Claude Code's status line for this repo. Claude Code pipes the
// session JSON on stdin and shows the one line we print, e.g.
//   V2.14.6.2 · link 2/2 · Hank: chris-de-kok 3.1/10M · the Commissioner said no (gh pr merge) 17:12Z
// It runs on every redraw, so it stays fast and quiet: no network, no git or
// gh process (the branch comes from .git/HEAD), only small files or the tail
// of the logs. Every part is optional and wrapped; a status line that throws
// is noise, so the worst case is the bare branch name.
//
//   node <release plugin>/scripts/the-tower.mjs --install   # adds the statusLine key to ~/.claude/settings.json (asks first)

import { closeSync, copyFileSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const MAX = 79 // under 80 columns, so it fits a narrow terminal
const TOAST_MS = 30 * 60 * 1000 // a refusal older than 30 minutes is history, not news
const WEEK_SHOWN_ABOVE = 80 // the week is only worth a glance when it's nearly gone

const safe = (fn, fallback = null) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

const readJson = (path) => safe(() => JSON.parse(readFileSync(path, 'utf8')))

// The last `bytes` of a file: the logs only grow, and only their end matters.
function tail(path, bytes = 16384) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    return size > bytes ? lines.slice(1) : lines // the first line may be cut
  } finally {
    closeSync(fd)
  }
}

const hhmm = (ms) => `${new Date(ms).toISOString().slice(11, 16)}Z`

// The repo root: walk up to the folder holding .git (a folder, or a file in a worktree).
function repoRoot(start) {
  let dir = start
  for (let i = 0; i < 30 && dir; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

function branchOf(root) {
  let gitDir = join(root, '.git')
  if (statSync(gitDir).isFile()) {
    const m = /gitdir:\s*(.+)/.exec(readFileSync(gitDir, 'utf8'))
    if (!m) return null
    gitDir = m[1].trim()
    if (!gitDir.startsWith('/')) gitDir = join(root, gitDir)
  }
  const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
  return ref ? ref[1] : head.slice(0, 7) // detached: the short sha
}

// Which link of an armed chain this release is, e.g. "link 2/2".
function chainLink(projectDir, branch) {
  const chain = readJson(join(projectDir, '.claude', 'full-auto-chain.json'))
  if (!chain || !Array.isArray(chain.versions)) return null
  if (chain.expiresAt && Date.parse(chain.expiresAt) < Date.now()) return null
  const version = branch.replace(/^V/, '')
  const i = chain.versions.indexOf(version)
  return i < 0 ? null : `link ${i + 1}/${chain.versions.length}`
}

// Hank (this plugin's hooks/budget-cap.mjs) keeps one state file per subagent in
// <scratchpad>/.hank/<session>/<agent_id>.json (tokens, and the budget once
// known). The status line isn't told the scratchpad, so try where Claude Code
// puts it: /private/tmp/claude-<uid>/<project slug>/<session>/scratchpad.
function hankLine(input, projectDir) {
  const sid = input.session_id
  if (!sid) return null
  const slug = input.transcript_path ? basename(dirname(input.transcript_path)) : projectDir.replace(/[^A-Za-z0-9-]/g, '-')
  const uid = safe(() => process.getuid(), '')
  const dirs = [
    join('/private/tmp', `claude-${uid}`, slug, sid, 'scratchpad', '.hank', sid),
    join('/tmp', `claude-${uid}`, slug, sid, 'scratchpad', '.hank', sid),
    join(tmpdir(), '.hank', sid),
  ]
  const dir = dirs.find((d) => existsSync(d))
  if (!dir) return null
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'navigator.json')
    .map((f) => ({ f, t: safe(() => statSync(join(dir, f)).mtimeMs, 0) }))
    .sort((a, b) => b.t - a.t)[0]
  if (!newest) return null
  const state = readJson(join(dir, newest.f))
  if (!state || typeof state.tokens !== 'number') return null
  const id = newest.f.replace(/\.json$/, '')
  const meta = input.transcript_path ? readJson(join(dirname(input.transcript_path), sid, 'subagents', `agent-${id}.meta.json`)) : null
  const name = meta?.agentType || (meta?.description || '').split(':')[0].trim() || 'agent'
  // The same tag Hank reads, when the state file doesn't carry the budget yet.
  const tag = /\[budget\s+(\d+(?:\.\d+)?)\s*([mk])\]/i.exec(meta?.description || '')
  const budget = state.budget ?? (tag ? Number(tag[1]) * (tag[2].toLowerCase() === 'm' ? 1e6 : 1e3) : null)
  const used = (state.tokens / 1e6).toFixed(1)
  return budget ? `Hank: ${name} ${used}/${+(budget / 1e6).toFixed(1)}M` : `Hank: ${name} ${used}M`
}

// The week's share: no plan-limit API reaches a script, so read what the
// meter logger last wrote: ~/.claude/meter.log if it exists, else the plans
// file its scheduled task appends to (the path is read from its SKILL.md).
function weekLine() {
  let pct = null
  const meterLog = join(homedir(), '.claude', 'meter.log')
  if (existsSync(meterLog)) {
    const last = tail(meterLog, 4096).at(-1) || ''
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(last)
    if (m) pct = Number(m[1])
  } else {
    const skill = safe(() => readFileSync(join(homedir(), '.claude', 'scheduled-tasks', 'meter-log', 'SKILL.md'), 'utf8'), '')
    const target = /~\/\.claude\/plans\/[\w.-]+\.md/.exec(skill)?.[0]
    const path = target && join(homedir(), target.slice(2))
    if (path && existsSync(path) && statSync(path).size < 512 * 1024) {
      // Rows: | when | plan | week all models | week Fable | 5-hour | resets |
      // under "## Baseline"; other tables in the file are left alone.
      let inTable = false
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (line.startsWith('## ')) inTable = /^## Baseline/.test(line)
        const m = inTable && /^\|[^|]*\|[^|]*\|\s*(\d+(?:\.\d+)?)%\s*\|/.exec(line)
        if (m) pct = Number(m[1])
      }
    }
  }
  return pct !== null && pct > WEEK_SHOWN_ABOVE ? `week ${Math.round(pct)}%` : null
}

// A short "what" for the toast: a command's first words, or a file's name.
// A script's path shrinks to its name (scripts/stamp.sh -> stamp.sh): the
// line has 80 columns and the folder rarely tells anything.
const firstWords = (command) =>
  String(command)
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((w, i) => (i === 0 ? basename(w) : w))
    .join(' ')

function shortWhat(tool, args) {
  if (args?.command) return firstWords(args.command)
  if (args?.file_path) return basename(String(args.file_path))
  return tool || '?'
}

// The newest refusal of the last 30 minutes: the guard's deny lines in
// .claude/full-auto.log, or auto mode's in .claude/permission-denied.log.
function toast(projectDir) {
  const now = Date.now()
  const found = []
  const guardLog = join(projectDir, '.claude', 'full-auto.log')
  if (existsSync(guardLog)) {
    // <iso> \t <verdict> \t <what> \t <why> \t <agent>
    const row = tail(guardLog)
      .map((l) => l.split('\t'))
      .filter((r) => r[1] === 'deny')
      .at(-1)
    if (row) {
      const what = firstWords(row[2])
      found.push({ t: Date.parse(row[0]), text: (when) => `the Commissioner said no (${what}) ${when}` })
    }
  }
  const deniedLog = join(projectDir, '.claude', 'permission-denied.log')
  if (existsSync(deniedLog)) {
    // <iso> \t <agent> \t <tool> \t <input json> \t <mode> \t <id>
    const row = tail(deniedLog).at(-1)?.split('\t')
    if (row) {
      const what = shortWhat(row[2], safe(() => JSON.parse(row[3])))
      found.push({ t: Date.parse(row[0]), text: (when) => `auto said no (${what}) ${when}` })
    }
  }
  const latest = found.filter((f) => Number.isFinite(f.t) && now - f.t <= TOAST_MS).sort((a, b) => b.t - a.t)[0]
  return latest ? latest.text(hhmm(latest.t)) : null
}

// Fit under 80: shorten the toast's command first, then drop parts, least
// telling first (the chain link, then Hank, then the toast, then the week).
function fit(parts) {
  const join3 = () => Object.values(parts).filter(Boolean).join(' · ')
  if (join3().length > MAX && parts.toast) parts.toast = parts.toast.replace(/\(([^)]{12})[^)]+\)/, '($1…)')
  for (const key of ['link', 'hank', 'toast', 'week']) {
    if (join3().length <= MAX) break
    parts[key] = null
  }
  const line = join3()
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line
}

export function statusLine(input) {
  const start = input?.workspace?.current_dir || input?.cwd || process.cwd()
  const root = safe(() => repoRoot(start))
  const projectDir = input?.workspace?.project_dir || root || start
  const branch = (root && safe(() => branchOf(root))) || basename(start)
  const parts = { release: branch, link: null, hank: null, toast: null, week: null }
  try {
    parts.link = safe(() => chainLink(projectDir, branch))
    parts.hank = safe(() => hankLine(input ?? {}, projectDir))
    parts.toast = safe(() => toast(projectDir))
    parts.week = safe(() => weekLine())
    return fit(parts)
  } catch {
    return branch
  }
}

function readStdin() {
  if (process.stdin.isTTY) return {}
  return safe(() => JSON.parse(readFileSync(0, 'utf8') || '{}'), {}) ?? {}
}

// --install: a human step. Shows the key before and after, asks for y, backs
// the file up, then writes it back with every other key kept.
async function install() {
  const path = join(homedir(), '.claude', 'settings.json')
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '{}'
  let settings
  try {
    settings = JSON.parse(raw)
  } catch {
    console.log(`${path} isn't valid JSON; fix it first. Nothing written.`)
    return
  }
  const after = { type: 'command', command: `node ${fileURLToPath(import.meta.url)}` }
  const show = (v) => (v === undefined ? '(not set)' : JSON.stringify(v, null, 2).split('\n').join('\n  '))
  console.log(`${path}, key "statusLine"`)
  console.log(`- before: ${show(settings.statusLine)}`)
  console.log(`+ after:  ${show(after)}`)
  if (JSON.stringify(settings.statusLine) === JSON.stringify(after)) {
    console.log('Already installed. Nothing written.')
    return
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => rl.question('Write it? (y/N) ', resolve))
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Nothing written.')
    return
  }
  if (existsSync(path)) copyFileSync(path, `${path}.bak-the-tower`)
  settings.statusLine = after
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`Written. Backup: ${path}.bak-the-tower. Restart Claude Code to see it.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--install')) {
    install().catch((err) => console.log(`Install failed: ${err?.message ?? err}. Nothing written.`))
  } else {
    let line = ''
    try {
      line = statusLine(readStdin())
    } catch {
      line = ''
    }
    process.stdout.write(`${line}\n`)
  }
}
