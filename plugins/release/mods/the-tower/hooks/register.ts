import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// The script stays the one source of the line: the terminal's statusLine runs it
// too, so the mod only feeds it the same JSON the terminal pipes in. It is the
// release plugin's own copy, found the way sessions find the kit (towerScript).
const SCRIPT = 'scripts/the-tower.mjs'
// The release plugin when settings name none: the checkout every session loads.
const FALLBACK = 'wolfpack-live/plugins/release'
// Shown in place of the script's part when no copy is found, so a missing kit
// shows at once instead of an empty line (20 Oct 2026: a fixed path to an old
// copy of the script went unnoticed for days).
const MISSING = 'tower: no the-tower.mjs (release plugin?)'
// The daily budget's day part (user-level, beside its hook): it also keeps
// ~/.claude/meter-now.json fresh, which the hook reads as the meter now.
const BUDGET = '.claude/hooks/daily-budget.mjs'
const EVERY_MS = 10_000
// A tick another session already logged this long ago is the same move.
const DEDUPE_MS = 60_000

let home: string | undefined
let last: string | undefined
// The last meter value seen per window kind; empty until this load's first poll.
let seen: Map<string, number> | undefined

async function sh($: EngineInterface, script: string, ...args: string[]): Promise<string> {
  const r = await $.process.run(['sh', '-c', script, 'sh', ...args], { timeoutMs: 5_000 })
  return r.exitCode === 0 ? r.stdout : ''
}

// The release plugin's script, from the folders sessions load: the `release`
// entry of CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json's env block (the
// same list Claude Code reads), then ~/wolfpack-live. Read on every refresh, so
// a move of the kit shows on the next tick; undefined when no copy exists.
async function towerScript($: EngineInterface, home: string): Promise<string | undefined> {
  let dirs = ''
  try {
    const settings = JSON.parse(await $.fs.read(`${home}/.claude/settings.json`))
    dirs = settings?.env?.CLAUDE_CODE_PLUGIN_DIRS ?? ''
  } catch {
    // Unreadable settings: the fallback still finds the usual checkout.
  }
  const expand = (d: string) => (d === '~' ? home : d.startsWith('~/') ? `${home}/${d.slice(2)}` : d)
  const release = dirs.split(':').map(d => expand(d.trim().replace(/\/+$/, ''))).filter(d => d.split('/').at(-1) === 'release')
  for (const dir of [...release, `${home}/${FALLBACK}`]) {
    const path = `${dir}/${SCRIPT}`
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return undefined
}

// One line per meter move in ~/.claude/meter-ticks.log, so the 20x vs 5x ratio
// can be measured against transcripts (plans/research/meter-window.mjs).
// $.fs has no append, so the shell appends and tail-reads; values are logged
// unrounded (the API gives at most one decimal).
async function logTicks($: EngineInterface, limits: SessionRateLimit[] | undefined): Promise<void> {
  if (!home || !limits?.length) return
  const file = `${home}/.claude/meter-ticks.log`
  const now = new Date()
  const iso = now.toISOString()
  if (seen === undefined) {
    // A load (or reload) writes where the meter stands, never a false tick.
    seen = new Map(limits.map(l => [l.kind, l.percentUsed]))
    const lines = limits.map(l => `${iso}\t${l.kind}\tstart\t${l.percentUsed}\t${l.resetsAt ?? ''}`)
    await sh($, 'printf "%s\\n" "$2" >> "$1"', file, lines.join('\n'))
    return
  }
  const moved = limits.filter(l => seen!.get(l.kind) !== l.percentUsed)
  if (!moved.length) return
  // Several sessions poll the same meter: skip a move another one just logged.
  const tail = (await sh($, 'tail -n 50 "$1" 2>/dev/null', file)).split('\n')
  const fresh: string[] = []
  for (const l of moved) {
    const old = seen.get(l.kind)
    seen.set(l.kind, l.percentUsed)
    if (old === undefined) continue
    const prev = tail.map(t => t.split('\t')).filter(c => c[1] === l.kind && c[2] !== 'start').at(-1)
    const isDup = prev !== undefined && Number(prev[3]) === l.percentUsed && now.getTime() - Date.parse(prev[0] ?? '') < DEDUPE_MS
    if (!isDup) fresh.push(`${iso}\t${l.kind}\t${old}\t${l.percentUsed}\t${l.resetsAt ?? ''}`)
  }
  if (fresh.length) await sh($, 'printf "%s\\n" "$2" >> "$1"', file, fresh.join('\n'))
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    if (home === undefined) {
      const r = await $.process.run(['printenv', 'HOME'], { timeoutMs: 5_000 })
      home = r.stdout.trim()
    }
    const cwd = await $.session.cwd()
    const sid = await $.session.id()
    const slug = cwd.replace(/[^A-Za-z0-9-]/g, '-')
    // The live weekly window, which a script can't read on its own.
    const usage = await $.session.usage().catch(() => undefined)
    const input = {
      session_id: sid,
      cwd,
      workspace: { current_dir: cwd },
      transcript_path: home ? `${home}/.claude/projects/${slug}/${sid}.jsonl` : undefined,
      rate_limits: usage?.rateLimits,
    }
    const script = home ? await towerScript($, home) : undefined
    let tower: string | undefined = MISSING
    if (script) {
      const r = await $.process.run(['node', script], { stdin: JSON.stringify(input), timeoutMs: 5_000 })
      tower = r.exitCode === 0 ? r.stdout.trim().split('\n')[0] || undefined : undefined
    }
    const day = usage?.rateLimits?.length
      ? (await sh($, 'printf %s "$2" | node "$1" --tower', `${home}/${BUDGET}`, JSON.stringify({ rate_limits: usage.rateLimits }))).trim()
      : ''
    const line = tower && day ? `${tower} · ${day}` : tower ?? (day || undefined)
    if (line !== last) {
      last = line
      $.ui.status(line)
    }
    await logTicks($, usage?.rateLimits).catch(() => undefined)
  } catch {
    // The tower never breaks a session: a failed read leaves the last line up.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Awaited so the line is up on the first draw; the script reads only small
    // files and exits in about 50 ms, and its run is capped at 5 s.
    await refresh($)
    $.clock.every(EVERY_MS, () => void refresh($))
    return result
  })
}
