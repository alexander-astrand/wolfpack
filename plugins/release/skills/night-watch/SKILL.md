---
name: night-watch
description: Start a release for an unattended overnight run - /captain-call in slow speed and away mode.
argument-hint: <version> [allowance=cheap|normal|high|unlimited]
disable-model-invocation: true
---

`/night-watch <version>` is `/captain-call <version> slow away`: the careful speed from the `oceans-eleven` skill, and no pings until the draft PR is done.
**Title:** as `captain-call`'s: the session titles itself `<project.name> · release · <version> <name>` in its first minute (`set_session_title` on `self`). Its first and last line use the card below; the work in between is `captain-call`'s.
Overnight a silent lane or an unanswered prompt is the likeliest failure (`[watchdog]`, as the `captain-call` skill's Build says): never end a turn without a background `sleep` at the lesson's away interval while anything runs; on each wake check every lane's last commit and file write, stop one silent for 20 minutes and hand its files to a fresh agent of the same role, and do a step stuck on a prompt yourself by a path with no prompt.
A navigator never ends its turn waiting on a sibling session: ask by `send_message`, carry on, and take the answer as a hand-back; a send that comes back queued is not delivered until the target's events show it acted (`[send-confirmed]`); nobody is up to unstick a held message overnight.
The night runs in this one session (`[release-session]`): no handoff and no cards overnight (starting a session and a refused start: norms.md "Starting sessions"). Every session the night needs later is opened in this first turn with `start_session` as `captain-call` says (the app refuses it in any turn a timer wakes): the parked follow-up session always ("One follow-up session", woken at the final ping), part sessions only when the stamped plan names them, or by Alexander before he went to bed; either way the plan logs them.
## Voice
night-watch · the overnight run (Game of Thrones' Night's Watch) · "the night is dark", sworn, keeps the wall till morning
- start: "Night gathers, and now the watch begins. Draft PR by morning."
- commit: (silent)
- refusal: "The wall holds. That one waits for the morning."
- ping: (silent)
- wrap: "The watch ends. The draft is open, the report below."

Night is when nobody's waiting, so it spends the time on checking rather than tokens on a bigger model.
An `allowance=` argument is passed on unchanged (default normal; the `oceans-eleven` skill's Allowances table). Anything else after the version is passed on as input for the plan.
## The pre-bed launch check (first minute, while he is still up)
Everything the night could stop on is asked now, in **one message** in the first minute, never one item at a time and never after he's gone (kit 1.7, Feature 7: one night stopped at 13 minutes on a sign-in, Burrow V0.9 sat 11 hours on a guard ask). Gather the facts first, then write the message:
- **The dev tab:** the `captain-call` preflight's probe on the :<project.devPort> tab. Signed in, or "no UI" when the plan touches no page. Signed out: the message asks him to sign in on that tab now.
- **The human steps:** everything the night will need from a person (production secrets such as a push key pair, Vercel or dashboard settings, facts only Alexander knows), listed one per line straight into the plan's Human steps. The night builds around them rather than waiting (2.12: production's VAPID pair).
- **The allow rules:** the commands and tools the plan's steps will call that aren't on the allow list (`~/.claude/settings.json` and the project's `.claude/settings.json`), each as the exact rule line. Nobody answers a prompt overnight, so a missing rule is a stop or a slower route.
- **The meter:** `get_usage`, the week and the daily window, against the plan's expected spend.
- **The follow-up session:** its title, started parked in this turn (below), so he can see it exists.

End that message with what he does before bed (sign in, add the rule lines, answer a human step). The night doesn't wait for his answer: the planning starts now and his answers are folded in as they come. Only a signed-out dev tab on a release with pages holds the first builder; still signed out at the first watchdog wake, stop rather than build without QA.

## The away file
The night writes `<plans>V<version>.away.md` (`<plans>` is kit.json's `plans`, default `~/.claude/plans/`) as it goes, one line each time something lands, under three headings: `## Decided` (each recommended option taken instead of asking, and why), `## Waiting on Alexander` (each person-only item, with the ledger link) and `## Done` (each step committed, with its sha). Write it with Edit or Write, never a shell line. It is the morning report: `/kids-im-home` reads it first, and the final ping links it.

## Run
Now follow `${CLAUDE_PLUGIN_ROOT}/skills/captain-call/SKILL.md` in full, with the arguments **$ARGUMENTS slow away** (read it as a file: `captain-call` is user-only, so it can't be called as a skill from here). Its `away` reads the `ill-be-back` skill: take **`sleeping`** as the away reason, so that skill's prompt rule for an unanswered night applies to every step and every order.
