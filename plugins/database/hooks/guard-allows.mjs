#!/usr/bin/env node
// The SessionEnd hook (hooks.json): one `allows` row per session in
// .claude/guard-decisions.log, so a council can compute the guard's ask rate
// (kit 1.8, M12; the kit 1.7.1 council could count asks and denies, never the
// calls let through). The work is denied-log.mjs's sessionEnd, which counts
// the session's guarded tool calls from its transcripts once, at the end:
// nothing is written per call, so the guard stays as fast as before.
//
//   node guard-allows.mjs   (stdin: the SessionEnd hook input)
//
// Its own file, not `denied-log.mjs --session-end`: step-aside.mjs matches a
// project's copy against every registration of the kit's file, and a
// SessionEnd entry for denied-log.mjs would stop HutzUp's own copy from
// counting as the owner. Exits 0 and prints nothing, always.

let raw = ''
try {
  for await (const chunk of process.stdin) raw += chunk
  const { sessionEnd } = await import(new URL('./denied-log.mjs', import.meta.url).href)
  await sessionEnd(raw)
} catch { /* a logger never gets in the way */ }
process.exit(0)
