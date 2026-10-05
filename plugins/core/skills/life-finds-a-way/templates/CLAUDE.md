# CLAUDE.md

Working notes for Claude Code sessions on {{project.name}}. The README says what the app is; this file is how we work on it.

**Treat the repo as public:** never put keys, passwords, tokens or test logins in any file. `.env.example` lists names, never values.

## Where things live

| Where | What |
|---|---|
| CLAUDE.md | how we work |
| `docs/decisions/` | what we decided and why (one short file each) |
| `{{plans}}{{project.name}}/roadmap.md` | what's next, later, parked, shipped |
| `{{plans}}{{project.name}}/V<x>.md` | one release's notes and plan |
| `.claude/kit.json` | the project's values for the Wolfpack kit |
| `.claude/lessons.md` | tuning numbers learned along the way |
| `.claude/taste.md` | design taste, one rule per sendback (UI projects) |

## The project in one paragraph

{{project.summary}} Its word for a person who uses it: {{project.noun}}.

## Commands

```
npm run dev          # http://localhost:{{project.devPort}} <!-- ui-only -->
scripts/check.sh     # runs lint, tests and build where they exist; prints failures only
```

CI runs the same check on every pull request.

## Releases

- **One theme per release.** A version has one plan file, one branch, one pull request. New ideas go on the roadmap, not into the open release.
- **Every release names what is not in it** ("Not in this release: X, where it went") in its plan and its wrap-up.
- **Commits:** the subject says what the user gets, the body has the details. Push after each piece of work.
- **Every pull request updates `README.md`.**
- Merging is a human go, never automatic.

## Working with Claude

- The kit's working norms are `kit/plugins/core/norms.md` in the wolfpack core plugin; this section is the short form.
- **Questions are pick-one choices**, the recommended option first, each saying what it gives and what it costs.
- **Human steps one at a time:** one line on what the step does, one command in its own block, then wait for "Done", "Got an error" or "Stop here".
- Comments in code explain why, at the density around them. Wording in the app is plain and specific.
- Check before you commit: `scripts/check.sh`. Never run a formatter the repo doesn't configure.
- A step that would reach past the release's theme goes to the roadmap and gets reported.

## Park rule

If the project goes quiet, `{{plans}}{{project.name}}/V0.1.md` says when to park it and what to do then. Follow that note rather than letting things run on.
