---
name: car-wash
description: Produce a release's Usage section for the PR from this session's Claude Code transcripts, tallied by model with the release plugin's usage.mjs. Used at the end of /maverick, and by hand.
---

**Title:** runs inside another session; keeps that session's title.

Give the release PR a "Usage" section so the next release's budgets are set from numbers, not a feeling.

## Run it
This session's own transcript is the newest `.jsonl` in the project's transcript directory whose first lines mention this release (or pass `--dir <path>` for a different one). Count the commits on the branch (`git log --oneline main..HEAD | wc -l`), then:

```
node <release plugin>/scripts/usage.mjs --commits <N> <session-id>
```

Add `--timeline` for one row per agent (description, type, model, start/end, active minutes, calls, screenshots, tokens) and a wall-clock line per session; `--chart <out.html>` also writes it as a swimlane page (the wrap-up publishes that one).

Session IDs may be a short prefix. If the release spans more than one session (a `/compact`, a resumed session), pass every session ID on one command line; the totals combine.

## The meter
Read the claude.ai weekly usage meter with `mcp__ccd_session_mgmt__get_usage`, before the release starts and now, and report both numbers as a ceiling only: **a release's % is its own sessions' Skyler total ÷ 27M** (`[meter]`), and the meter delta also counts every other session open on that meter, so name those beside it (2.12.5's delta included beside-sessions). Judge the ≤5% target on the tokens. Compare per-commit tokens with the last two releases' rows in `.claude/lessons.md` and the PR Usage sections.

## The PR section
Keep it short:
- the table Skyler (`<release plugin>/scripts/usage.mjs`) prints (part, model, calls, tokens, share), the total and per-commit rows; label each agent row with the timeline's own description for it (`--timeline`), never from memory of the plan's step numbers, and name the agent (`chris-de-kok`, `jesse-pinkman`, …)
- the wall-clock line from `--timeline` (session start to end, and agent-minutes against it)
- the one-line model breakdown (e.g. "`maverick` Fable 19%, Opus agents 72%, Sonnet 10%")
- how per-commit compares to the recent releases, and where the weekly meter sits
- any rework loop that inflated the numbers (a bug that took two `boba-fett` passes, a plan that changed mid-build) named honestly, not smoothed over
- a keep/tune line for the run's routing: keep it as is, or tune something (a step that should go to a cheaper model, an agent that ran too long), and say why
