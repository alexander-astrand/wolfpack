---
name: tesseract
description: "Set up a worktree lane beside the main checkout - branch tracking, env, ports, and the database self-link - so this doesn't get copied into every order by hand."
---

# Worktree lane

## Voice
tesseract · the worktree lane (Interstellar's tesseract, a room that reaches another time) · "a lane beside the lane", calm, spatial
- start: "Opening a lane beside this one. Branch, env, ports."
- commit: (silent)
- refusal: "The lane won't open. Here's the gap between the two."
- ping: "Two lanes want the same port. Which one stays?"
- wrap: "The lane is set. Same code, a different room."

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · tesseract <subject>` (norms.md).

A lane lives outside `.claude`, in `~/Desktop/<Project>-lanes/<lane>`, never under `.claude/worktrees` (`isolation: "worktree"` puts it there, where every write asks even in Auto and its builds break the main checkout's lint: `[lane-home]`, kit 1.5, H2). The navigator makes it before the spawn and names its path and port in the order. A lane can't `git switch` to a branch the main checkout already holds, so it gets its own branch from the release branch, with `V<x>` filled in.

**One call makes the lane** (`<kit>` is `${CLAUDE_PLUGIN_ROOT}/../..` written out as an absolute path, so the allow line matches):

`node <kit>/plugins/core/scripts/lane.mjs add <lane> --base V<x>`

It makes the worktree at `<parent>/<Project>-lanes/<lane>` on a branch named `<lane>` (`--branch <b>` for another name; a design mock-up lane takes `--base main`), copies `.env.local` from the main checkout, links the main checkout's `node_modules` when the lock files match or else runs the install (kit.json `project.install`, else the lock file's own command), picks a free dev port above `project.devPort` (`--port <n>` to choose), and links the database when the project has `supabase/` (next paragraph). It prints one line, `lane <lane>: <path> port <n> branch <b> (deps linked, env copied, db skipped)` or the like, which goes into the order as it stands. It never fetches or pushes: when `V<x>` is only on origin, run `git fetch origin` as its own call first and pass `--base origin/V<x>`.

- **Its own port and tab:** the lane's dev server runs on the port `lane.mjs` printed and opens its own browser tab, so it doesn't collide with the main session's preview.
- **Database lanes link themselves:** a worktree can't inherit `supabase/.temp` (the project's guard hook refuses copying it, by design), so `lane.mjs` runs `supabase link --project-ref <refs.dev from .claude/kit.json>` in the lane. A `db failed (<reason>)` in its line means `the-playbook` runs that link itself in the lane before any database step.
- **Push:** `git pull --rebase origin V<x>` first, then `git push origin HEAD:V<x>` (a plain `git push` would try to push `<lane-branch>`, not `V<x>`). Or leave it unpushed when the order says the navigator merges the lane's branch.

`captain-call` merges each lane's branch into the release branch before any step that touches its files.
- A worktree lane edits only files under its own worktree root, by relative path (2.12.2: a lane's edits to agent files landed unpushed in the main checkout).
- A worktree's dev server runs on another port and is not signed in (the login lives on the main dev port's origin), so signed-in browser checks happen there after the lane's push, by QA or the navigator's next builder.

## Clean-up at a release's end
`tesseract` owns cleaning lanes up: at the end of the release the navigator runs these steps, and a lane whose branch is merged or whose agent is done is removed.
After the release's PR merges: `node <kit>/plugins/core/scripts/lane.mjs list` prints each lane with its port, branch and `clean` or `dirty`. For each clean lane whose branch is on origin or was merged (a squash-merged branch is deleted from origin), `node <kit>/plugins/core/scripts/lane.mjs remove <lane>`: it removes the worktree, prunes the records of folders already gone, and removes the `<Project>-lanes/` folder once it's empty. It refuses a lane with changes; list that one in the report. It never deletes a branch. Leftover worktrees cost disk space, and a repo-wide grep walks their copies. A leftover `.claude/worktrees/*` from before kit 1.5 is cleaned by hand: `git worktree remove <path>` when its status is empty, then `git worktree prune`.
