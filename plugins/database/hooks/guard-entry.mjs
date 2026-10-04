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
try {
  const guard = await import(new URL('./guard-production.mjs', import.meta.url).href)
  await guard.main()
} catch (err) {
  process.stderr.write(`The production guard (hooks/guard-production.mjs in the database plugin) failed to run, so this call is blocked: ${err?.message ?? err}. A person fixes the guard by hand.\n`)
  process.exit(2)
}
