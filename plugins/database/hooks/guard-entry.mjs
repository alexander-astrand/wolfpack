#!/usr/bin/env node
// What .claude/settings.json runs before each tool call: the Slap Bet
// Commissioner's front door. It imports nothing at top level, so a guard that
// fails to load (a syntax error, a missing import, a half-finished edit) or
// throws is caught here and the call is blocked (exit 2), never let through
// unchecked. Keep it this small: this file is the one thing that must run.
// A guard that hangs decides nothing, and a hook killed at its timeout (20s
// in settings.json) doesn't block the call, so past 18s this blocks it. Kit
// 1.7 (M10): a decision already written stands (a slow allow or ask was
// turned into a block here when the timer came due as the guard finished).
// An undecided call still blocks rather than asks: the guard might have
// denied it, and an ask would let a person pass what the guard refuses. The
// guard's reads share a 12 s clock (readTimeout), so a gh hang turns into a
// "couldn't be read" ask well before this fires.
setTimeout(() => {
  if (globalThis.guardDecided) return
  process.stderr.write('The production guard took more than 18s, so this call is blocked. A person looks at why.\n')
  process.exit(2)
}, 18000).unref()
// A project that registers its own guard (Hutzup's frozen .claude/hooks/)
// keeps it, and this copy steps aside: no decision, no output. Any error in
// that check runs the kit's guard as before, never skips it. Kit 1.8 (M12):
// the first step-aside of a session leaves one row in guard-decisions.log, so
// a council can tell which guard ran; a failed log still steps aside.
let projectGuards = false
try {
  const { projectOwns } = await import(new URL('./step-aside.mjs', import.meta.url).href)
  projectGuards = projectOwns({ kitName: 'guard-entry.mjs', names: ['guard-entry.mjs', 'guard-production.mjs'] })
} catch {
  projectGuards = false
}
if (projectGuards) {
  try {
    let raw = ''
    for await (const chunk of process.stdin) raw += chunk
    const { stepAsideOnce } = await import(new URL('./denied-log.mjs', import.meta.url).href)
    stepAsideOnce(raw)
  } catch { /* no row; the project's guard decides either way */ }
  process.exit(0)
}
try {
  const guard = await import(new URL('./guard-production.mjs', import.meta.url).href)
  await guard.main()
} catch (err) {
  process.stderr.write(`The production guard (hooks/guard-production.mjs in the database plugin) failed to run, so this call is blocked: ${err?.message ?? err}. A person fixes the guard by hand.\n`)
  process.exit(2)
}
