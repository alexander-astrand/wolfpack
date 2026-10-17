#!/usr/bin/env node
// What .claude/settings.json runs before each tool call: the Slap Bet
// Commissioner's front door. It imports nothing at top level, so a guard that
// fails to load (a syntax error, a missing import, a half-finished edit) or
// throws is caught here and the call is blocked (exit 2), never let through
// unchecked. Keep it this small: this file is the one thing that must run.
// A guard that hangs decides nothing, and a hook killed at its timeout (20s
// in settings.json) doesn't block the call, so past 18s this blocks it.
setTimeout(() => {
  process.stderr.write('The production guard took more than 18s, so this call is blocked. A person looks at why.\n')
  process.exit(2)
}, 18000).unref()
// A project that registers its own guard (Hutzup's frozen .claude/hooks/)
// keeps it, and this copy steps aside: no decision, no output. Any error in
// that check runs the kit's guard as before, never skips it.
let projectGuards = false
try {
  const { projectOwns } = await import(new URL('./step-aside.mjs', import.meta.url).href)
  projectGuards = projectOwns({ kitName: 'guard-entry.mjs', names: ['guard-entry.mjs', 'guard-production.mjs'] })
} catch {
  projectGuards = false
}
if (projectGuards) process.exit(0)
// A project with no production (kit.json "production": "none" and no refs.prod)
// has nothing for the guard to protect, so skip loading its large module on
// every call (kit 1.5, council L7). Any doubt (no kit.json, bad JSON, any
// other value) runs the guard as before.
let noProduction = false
try {
  const { readFileSync } = await import('node:fs')
  const kit = JSON.parse(readFileSync(`${process.env.CLAUDE_PROJECT_DIR || process.cwd()}/.claude/kit.json`, 'utf8'))
  noProduction = kit?.production === 'none' && !kit?.refs?.prod
} catch {
  noProduction = false
}
if (noProduction) process.exit(0)
try {
  const guard = await import(new URL('./guard-production.mjs', import.meta.url).href)
  await guard.main()
} catch (err) {
  process.stderr.write(`The production guard (hooks/guard-production.mjs in the database plugin) failed to run, so this call is blocked: ${err?.message ?? err}. A person fixes the guard by hand.\n`)
  process.exit(2)
}
