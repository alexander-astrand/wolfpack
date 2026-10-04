---
name: tesseract
description: "Set up a worktree lane beside the main checkout - branch tracking, env, ports, and the database self-link - so this doesn't get copied into every order by hand."
---

# Worktree lane

**Title:** runs inside another session; keeps that session's title.

A lane running beside the main checkout (`isolation: "worktree"`) starts from `main`, not the release branch, and can't `git switch` to a branch the main checkout already holds. Its order gives it this setup, with `V<x>` filled in:

1. **Branch:** track the release branch under a local name: `git fetch origin && git switch -c <local-name> --track origin/V<x>`.
2. **Env:** copy `.env.local` from the main checkout into the worktree.
3. **Its own port and tab:** run the dev server on its own vite port (not `project.devPort` from `.claude/kit.json`) and open its own browser tab, so it doesn't collide with the main session's preview.
4. **Push:** `git pull --rebase origin V<x>` first, then `git push origin HEAD:V<x>` (a plain `git push` would try to push `<local-name>`, not `V<x>`).
5. **Database lanes link themselves:** a worktree can't inherit `supabase/.temp` (the Slap Bet Commissioner refuses copying it, by design), so `the-playbook` in a worktree links itself instead: `supabase link --project-ref <refs.dev from .claude/kit.json>`.

`maverick` merges each lane's branch into the release branch before any step that touches its files.
- A worktree lane edits only files under its own worktree root, by relative path (2.12.2: a lane's edits to agent files landed unpushed in the main checkout).
- A worktree's dev server runs on another port and is not signed in (the login lives on the main dev port's origin), so signed-in browser checks happen there after the lane's push, by QA or the navigator's next builder.

## Clean-up at a release's end
After the release's PR merges: `git worktree list`, and for each `.claude/worktrees/*` whose `git -C <path> status --porcelain` is empty and whose branch is on origin or was merged (a squash-merged branch is deleted from origin), `git worktree remove <path>`. Skip a dirty one and list it in the report. Leave the branches alone. Leftover worktrees cost disk space, and a repo-wide grep walks their copies. Then `git worktree prune` to drop records of folders already gone.
