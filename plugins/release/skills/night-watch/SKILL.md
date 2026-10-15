---
name: night-watch
description: Start a release for an unattended overnight run - /maverick in slow speed and away mode.
argument-hint: <version> [allowance=cheap|normal|high|unlimited]
disable-model-invocation: true
---

`/night-watch <version>` is `/maverick <version> slow away`: the careful speed from the `oceans-eleven` skill, and no pings until the draft PR is done.
**Title:** as `maverick`'s: the session titles itself `<project.name> · release · <version> <name>` in its first minute (`set_session_title` on `self`). Its first and last line use the card below; the work in between is `maverick`'s.
Overnight a silent lane or an unanswered prompt is the likeliest failure (`[watchdog]`, as the `maverick` skill's Build says): never end a turn without a background `sleep 600` while anything runs; on each wake check every lane's last commit and file write, stop one silent for 20 minutes and hand its files to a fresh agent of the same role, and do a step stuck on a prompt yourself by a path with no prompt.
A navigator never ends its turn waiting on a sibling session: ask by `send_message`, carry on, and take the answer as a hand-back; a send that comes back queued is not delivered until the target's events show it acted (`[send-confirmed]`); nobody is up to unstick a held message overnight.
The night runs in this one session (`[release-session]`): no handoff and no cards overnight. Part sessions only when the stamped plan names them, opened in this first turn with `start_session` as `maverick` says (the app refuses it in any turn a timer wakes), or by Alexander before he went to bed; either way the plan logs them.
## Voice
night-watch · the overnight run (Game of Thrones' Night's Watch) · "the night is dark", sworn, keeps the wall till morning
- start: "Night gathers, and now the watch begins. Draft PR by morning."
- commit: (silent)
- refusal: "The wall holds. That one waits for the morning."
- ping: (silent)
- wrap: "The watch ends. The draft is open, the report below."

Night is when nobody's waiting, so it spends the time on checking rather than tokens on a bigger model.
An `allowance=` argument is passed on unchanged (default normal; the `oceans-eleven` skill's Allowances table). Anything else after the version is passed on as input for the plan.
Before the first builder starts, the :<project.devPort> tab must be signed in (the `maverick` preflight's probe): if it isn't, ask Alexander to sign in before the night begins, and if nobody can answer, stop rather than build without QA.
Before the first builder starts, list everything the night will need from a person (production secrets such as a push key pair, Vercel or dashboard settings, game facts only Alexander knows) straight into the plan's Human steps, and build around them rather than waiting (2.12: production's VAPID pair).

Now follow `${CLAUDE_PLUGIN_ROOT}/skills/maverick/SKILL.md` in full, with the arguments **$ARGUMENTS slow away** (read it as a file: `maverick` is user-only, so it can't be called as a skill from here).
