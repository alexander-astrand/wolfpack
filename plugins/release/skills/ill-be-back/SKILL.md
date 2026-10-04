---
name: ill-be-back
description: Switch this session into away mode - no pings, no questions, until the current job ends. Alexander uses this before he's out of reach for a while, optionally saying why and until when.
argument-hint: "[reason] [until]"
disable-model-invocation: true
---

**Title:** runs inside another session; keeps that session's title.

Away mode is on for this session, until "back" or `/kids-im-home`. Arguments: **$ARGUMENTS**

The reason says what Alexander can still do: `running`, `gym`, `sleeping`, `meeting`, `driving`, or free text (read it the same way: can he glance at his phone or not?). `until` is a time ("19:30", Stockholm) or a duration ("2h").

- No `AskUserQuestion`, no `PushNotification`, until the end of the current job (the release, the follow-up, whatever is running).
- Where you'd normally ask, take the recommended option instead and note it under "Decided while away" (in the PR description if there's one, otherwise in your next reply).
- **Permission prompts depend on the reason.** `running` or `gym`: he can tap yes or no on his watch or phone, so work that needs a prompt carries on as usual; questions stay held. `sleeping`, `driving`, `meeting`: treat a prompt as one nobody will answer, and prefer paths that don't need one; set aside what can't be done without.
- A piece of work you can't decide or can't do without a person: set it aside with a short note, and keep building the rest.
- Keep a running list of what only a person can do (secrets, dashboard settings, anything production, a call only Alexander can make).
- A message from Alexander while away is input, not the end of away mode — read it, act on it, keep going. Only an explicit "back" or `/kids-im-home` ends it.
- "Back" reports where things stand; it never stops a running agent (stopping one makes the next agent re-read the whole diff). Only an explicit "stop" does that.
- At the end of the job, send one ping: `PushNotification` plus a message covering what was decided, what's waiting, and the list of person-only items. With `until`, hold that ping until then if the job ends earlier (a ping at 3am helps nobody); if the job ends later, ping when it ends.

`/maverick <version> away` starts a release already in this mode, for an unattended overnight run.
