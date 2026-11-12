# 0002 No "Waiting on you" pings

**Status:** accepted, 12 Nov 2026. Takes back the ping half of "A missed prompt is not a no" (5 Nov 2026, kit 1.10).

## Context

On 5 Nov 2026 Burrow V1.12's navigator stopped every lane for four hours on two prompts Alexander never saw. The fix added two things: a rule (a refused call while he's quiet is a missed prompt, not his no; keep the other lanes going; park the piece) and a ping for it. The ping came from a user-level hook, `~/.claude/hooks/permission-ping.mjs`, wired on `Notification` (`permission_prompt`) and `Stop`, and from session instructions to run `~/pylos/bin/nestor-push.sh --prompt`.

The hook fired on every question box in every session, so his phone buzzed through the day ("Waiting on you: hejtide · inception · 0.6 wants AskUserQuestion. Answer it in the app; the rest keeps going.", six of them on 12 Nov). Alexander, 12 Nov 2026: "While we are at it, can we remove all these waiting on you pings, they were a mistake to add".

## Decision

No hook and no instruction sends a "Waiting on you" or missed-prompt ping.

- The hook's two entries are out of `~/.claude/settings.json`; the file is kept aside as `permission-ping.mjs.removed` (and its test as `.removed`).
- `~/.claude/global/CLAUDE.md`, `norms.md`, `lessons.md`, `ask-to-start.mjs`, `captain-call`, `cattle-drive`, `ill-be-back` and `night-watch` no longer tell a session to run `nestor-push.sh --prompt`.
- The rest of the rule stays: a refused call while he's quiet is not his no, every other lane goes on, one other route, then that piece alone is parked under "What needs you" for him to answer in the app.
- `nestor-push.sh` keeps its `--prompt` flag with no sender; Nestor's `voice.md` section 2b says so.

## Consequences

- His phone no longer buzzes for questions; a stalled prompt waits in the app until he looks, which is what V1.12 tried to avoid. The keep-going half of the rule is what stops a release from halting on it.
- The hook also blocked a session's stop once after a missed refusal and sent it back to work. That nudge is gone with it; the rule in `CLAUDE.md` and `norms.md` carries it alone.
- Other Telegram lines are untouched: the alert lane (a stalled side session, a refused start in a woken turn, a deploy hard stop), the brief, and the crease lane.
