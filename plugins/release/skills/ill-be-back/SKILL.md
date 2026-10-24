---
name: ill-be-back
description: Switch this session into away mode - no pings, no questions, until the current job ends. Alexander uses this before he's out of reach for a while, optionally saying why and until when.
argument-hint: "[reason] [until]"
disable-model-invocation: true
---

## Voice
ill-be-back · away mode on (the Terminator, "I'll be back"; Home Alone's house holds while the family is out) · flat, brief, the house holds
- start: "I'll be back. Away mode is on, the house holds."
- commit: (silent)
- refusal: "Not while you're gone. That one waits for you."
- ping: (silent)
- wrap: "Still on watch. Nothing asked until the job ends."

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · ill-be-back <subject>` (norms.md).

Away mode is on for this session, until "back" or `/kids-im-home`. Arguments: **$ARGUMENTS**

The reason says what Alexander can still do: `running`, `gym`, `sleeping`, `meeting`, `driving`, or free text (read it the same way: can he glance at his phone or not?). `until` is a time ("19:30", Stockholm) or a duration ("2h").

- No `AskUserQuestion`, no `PushNotification`, until the end of the current job (the release, the follow-up, whatever is running).
- Where you'd normally ask, take the recommended option instead and note it under "Decided while away" (in the PR description if there's one, otherwise in your next reply).
- **Permission prompts depend on the reason.** `running` or `gym`: he can tap yes or no on his watch or phone, so work that needs a prompt carries on as usual; questions stay held. `sleeping`, `driving`, `meeting`: treat a prompt as one nobody will answer, and prefer paths that don't need one; set aside what can't be done without. **`sleeping`** (what `/night-watch` passes) is the strictest: nobody looks for hours, so a prompt is never waited on; the step takes a path with no prompt or goes under "Waiting on Alexander" (in `/night-watch`'s away file, `<plans>V<version>.away.md`, when there is one), and the rest goes on. No reason given is read as `sleeping`. Every order you send while away says so too: "nobody answers a prompt: edit with Edit or Write, scratch files by absolute path, never `cd <folder> && cat > …` or a sed script over several lines" (Burrow V0.9: part 3 sat on one guard ask from 02:12 to 13:04).
- **The watchdog runs all the time while away** (`[watchdog]`, the `captain-call` skill's Build has the steps): while any agent, lane or session of the job runs, never end a turn without a `sleep` at the lesson's away interval, started with `run_in_background: true`, which wakes this session when it exits; on each wake check every lane's last commit and file write and every session's last event, stop what's been silent 20 minutes and hand its work to a fresh agent, and do a step stuck on a prompt yourself, by a path with no prompt.
- **A send isn't delivered until the target acts** (`[send-confirmed]`): a message to another session that comes back queued is checked in its events within minutes; if it hasn't acted, you do the work and stop what runs against Alexander's word.
- A piece of work you can't decide or can't do without a person: set it aside with a short note, and keep building the rest.
- Keep a running list of what only a person can do (secrets, dashboard settings, anything production, a call only Alexander can make).
- A message from Alexander while away is input, not the end of away mode: read it, act on it, keep going. Only an explicit "back" or `/kids-im-home` ends it.
- "Back" reports where things stand; it never stops a running agent (stopping one makes the next agent re-read the whole diff). Only an explicit "stop" does that.
- At the end of the job, send one ping: `PushNotification` plus a message covering what was decided, what's waiting, and the list of person-only items. With `until`, hold that ping until then if the job ends earlier (a ping at 3am helps nobody); if the job ends later, ping when it ends.

`/captain-call <version> away` starts a release already in this mode, for an unattended overnight run.
