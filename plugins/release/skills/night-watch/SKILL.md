---
name: night-watch
description: Start a release for an unattended overnight run - /maverick in slow speed and away mode.
argument-hint: <version> [allowance=cheap|normal|high|unlimited]
disable-model-invocation: true
---

`/night-watch <version>` is `/maverick <version> slow away`: the careful speed from the `oceans-eleven` skill, and no pings until the draft PR is done.
**Title:** as `maverick`'s: the session titles itself `<project.name> · release · <version> <name>` in its first minute (`set_session_title` on `self`). Its voice is the navigator's card in that skill.
Night is when nobody's waiting, so it spends the time on checking rather than tokens on a bigger model.
An `allowance=` argument is passed on unchanged (default normal; the `oceans-eleven` skill's Allowances table). Anything else after the version is passed on as input for the plan.
Before the first builder starts, the :<project.devPort> tab must be signed in (the `maverick` preflight's probe): if it isn't, ask Alexander to sign in before the night begins, and if nobody can answer, stop rather than build without QA.
Before the first builder starts, list everything the night will need from a person (production secrets such as a push key pair, Vercel or dashboard settings, game facts only Alexander knows) straight into the plan's Human steps, and build around them rather than waiting (2.12: production's VAPID pair).

Now follow `${CLAUDE_PLUGIN_ROOT}/skills/maverick/SKILL.md` in full, with the arguments **$ARGUMENTS slow away** (read it as a file: `maverick` is user-only, so it can't be called as a skill from here).
