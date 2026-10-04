---
name: one-ring
description: Merge a release's PR without a review, on Alexander's go. The same run as /skinny-pete <version> merge; never on your own.
argument-hint: <version>
disable-model-invocation: true
---

Merge: **$ARGUMENTS**

**Title:** as `skinny-pete`'s: the session titles itself `<project.name> · deploy · <version>` in its first minute (`set_session_title` on `self`). Its voice is that skill's card.

This is `/skinny-pete <version> merge` under a shorter name (Alexander: "Still no /merge skill?"). Read `skinny-pete`'s SKILL.md and follow it exactly, with `merge` set — the deployer, manual permission mode and the guard hook all still apply, because merging ships to production. Don't shortcut any of its steps: the plan, the go, the run, the human steps, the report, and the closing "Deploy usage" PR comment.
