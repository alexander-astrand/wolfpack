---
name: kids-im-home
description: End this session's away mode and report what happened while Alexander was away.
disable-model-invocation: true
---

**Title:** runs inside another session; keeps that session's title.

Away mode ends now. Running agents carry on — "I'm back" reports where things stand, it doesn't stop them (a stop makes the next agent re-read the whole diff). Only an explicit "stop" stops one.

Reply with:
- **Decided while away:** each place you took the recommended option instead of asking, and why.
- **Waiting on Alexander:** the list of person-only items you kept while away.
- **Questions held back:** anything you'd normally have asked with `AskUserQuestion`, recommended option first, asked now for real.

Then carry on as a normal session: pings and questions work as usual again.
