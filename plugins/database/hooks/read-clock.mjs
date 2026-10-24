// The guard's shared read clock (kit 1.7, council M10), in a file of its own
// so production-steps.mjs and chain-arm.mjs can use it: guard-production.mjs
// imports both of them and reads their exports as it loads, so either one
// importing the guard back would load before its own values exist.
//
// The reads of one decision share this clock, so network hangs in its gh and
// git reads can't add up. decide is synchronous: guard-entry's 18 s timer
// can't fire while an execFileSync blocks, so it never cuts a read short, and
// the hook's own 20 s kill lets the call through undecided. This clock is
// what keeps a decision inside both. A read that would start with the clock
// spent fails at once; every reader turns a failure into "couldn't be read",
// which refuses the allow and leaves the call to its ask. decide starts the
// clock and stops it; a read outside a decision (a test, the arm script, the
// deploy) keeps its own timeout only.

export const READ_BUDGET_MS = 12_000
let readsFrom = null

/** Starts the clock for one decision. */
export function startReads(now = Date.now()) {
  readsFrom = now
}

/** Stops it: reads keep their own timeouts again. */
export function stopReads() {
  readsFrom = null
}

/** A read's timeout: its own, or what is left of the decision's clock when that is less. Throws when the clock is spent. */
export function readTimeout(own, now = Date.now()) {
  if (readsFrom === null) return own
  const left = READ_BUDGET_MS - (now - readsFrom)
  if (left < 250) throw new Error(`the guard's ${READ_BUDGET_MS / 1000} s for reads is spent`)
  return Math.min(own, left)
}
