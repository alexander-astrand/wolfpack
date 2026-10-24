---
name: kids-im-home
description: End this session's away mode and report what happened while Alexander was away.
disable-model-invocation: true
---

## Voice
kids-im-home · away mode off (Home Alone, "Kevin, I'm home"; the Terminator back as promised) · warm, a count of what was kept safe
- start: "I'm home. Away mode is off. Here's how the house did."
- commit: (silent)
- refusal: "That call stays as it was while you were out. Here's why."
- ping: "One thing came up in the quiet. Yours to say."
- wrap: "House still standing. Report below."

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · kids-im-home <subject>` (norms.md).

Away mode ends now. Running agents carry on: "I'm back" reports where things stand, it doesn't stop them (a stop makes the next agent re-read the whole diff). Only an explicit "stop" stops one.

**Read the away file first** when the session ran a `/night-watch`: `<plans>V<version>.away.md` (`<plans>` is kit.json's `plans`, default `~/.claude/plans/`), which the night wrote as it went under `## Decided`, `## Waiting on Alexander` and `## Done`. Build the reply from it, add what the file doesn't have yet, and link it. No such file: build the reply from the session's own notes.

Reply with:
- **Decided while away:** each place you took the recommended option instead of asking, and why.
- **Waiting on Alexander:** the list of person-only items you kept while away.
- **Done:** what landed, from the away file's `## Done` (one line, the shas linked), when there is one.
- **Questions held back:** anything you'd normally have asked with `AskUserQuestion`, recommended option first, asked now for real.

Then carry on as a normal session: pings and questions work as usual again.
