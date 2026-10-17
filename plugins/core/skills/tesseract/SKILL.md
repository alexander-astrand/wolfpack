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

A lane lives outside `.claude`, in `~/Desktop/<Project>-lanes/<lane>`, never under `.claude/worktrees` (`isolation: "worktree"` puts it there, where every write asks even in Auto and its builds break the main checkout's lint: `[lane-home]`, kit 1.5, H2). The navigator makes it before the spawn and names its path in the order. A lane can't `git switch` to a branch the main checkout already holds, so it gets its own branch from the release branch, with `V<x>` filled in:

1. **Branch:** the navigator runs `git fetch origin && git worktree add -b <lane-branch> ~/Desktop/<Project>-lanes/<lane> origin/V<x>` (a design mock-up lane branches from `main`).
2. **Env:** copy `.env.local` from the main checkout into the worktree.
3. **Its own port and tab:** run the dev server on its own vite port (not `project.devPort` from `.claude/kit.json`) and open its own browser tab, so it doesn't collide with the main session's preview.
4. **Push:** `git pull --rebase origin V<x>` first, then `git push origin HEAD:V<x>` (a plain `git push` would try to push `<lane-branch>`, not `V<x>`). Or leave it unpushed when the order says the navigator merges the lane's branch.
5. **Database lanes link themselves:** a worktree can't inherit `supabase/.temp` (the Slap Bet Commissioner refuses copying it, by design), so `the-playbook` in a worktree links itself instead: `supabase link --project-ref <refs.dev from .claude/kit.json>`.

`captain-call` merges each lane's branch into the release branch before any step that touches its files.
- A worktree lane edits only files under its own worktree root, by relative path (2.12.2: a lane's edits to agent files landed unpushed in the main checkout).
- A worktree's dev server runs on another port and is not signed in (the login lives on the main dev port's origin), so signed-in browser checks happen there after the lane's push, by QA or the navigator's next builder.

## Clean-up at a release's end
`tesseract` owns cleaning lanes up: at the end of the release the navigator runs these steps, and a lane whose branch is merged or whose agent is done is removed.
After the release's PR merges: `git worktree list`, and for each lane under `~/Desktop/<Project>-lanes/` whose `git -C <path> status --porcelain` is empty and whose branch is on origin or was merged (a squash-merged branch is deleted from origin), `git worktree remove <path>`. Skip a dirty one and list it in the report. Leave the branches alone. Leftover worktrees cost disk space, and a repo-wide grep walks their copies. Then `git worktree prune` to drop records of folders already gone, and remove `~/Desktop/<Project>-lanes/` itself once it's empty (`rmdir`). A leftover `.claude/worktrees/*` from before kit 1.5 is cleaned the same way.
