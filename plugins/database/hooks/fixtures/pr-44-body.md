## Production steps

`/skinny-pete 2.12.1` follows these; each step is one exact command or a marked human step.

### How to run this deploy on full auto
1. Mark PR #44 ready for review (Alexander's call), and tick every item under "Human steps before the deploy can finish" (none expected).
2. A new session in this repo: `/model opus`, `/effort medium`, permission mode **Auto**.
3. Type `/cattle-drive 2.12.1`. `ranjit` (xhigh) plans, and `yoda` reads the plan against these steps.
4. One tap: approve the arm for 2.12.1 when the guard asks. Its list must be `scripts/prod-db.sh backup 2.12.1`, `scripts/prod-db.sh dry-run`, `scripts/prod-db.sh push 2.12.1 0052`, `gh pr ready 44` and `gh pr merge 44 --squash [--admin]`.
5. Watch for: no other permission prompt. Any prompt or ping after the arm is a hard stop. The end: `ranjit`'s PR comment with the log, the marker disarmed, and a ping to run `/future-ted 2.12.1`.
6. Fallback, if a call stalls on a prompt or the arm is refused: deny it, disarm, then a new session in manual mode: `/skinny-pete 2.12.1 merge`.

Nothing may be pushed to V2.12.1 after the arm (the armed SHA must match the PR head). `gh pr ready 44` in the arm list is a no-op once the PR is ready.

### Before merge
1. Backup: `scripts/prod-db.sh backup 2.12.1` (stop if it fails)
2. Dry run: `scripts/prod-db.sh dry-run` (must list exactly 0052)
3. Migration: `scripts/prod-db.sh push 2.12.1 0052`

### After merge
1. Verify: the Vercel deploy is green; on production, edit a cost, make an event repeat, open Plan a purchase (plain text, no backticks: the parser reads backticked text as commands).

No function deploys: nothing under supabase/functions changed. Dev's push and shop-links functions were redeployed only to catch dev up with 7084caa; production already has the CORS fix. No Storage changes.

### Human steps before the deploy can finish
- None.

### Human steps afterwards
- [ ] GitHub ruleset: set "bypass only through pull requests" (the hotfix decision: a hotfix is a tiny PR merged with --admin).
- [ ] The Android / phone push test left from the 2.12 wrap-up.
- [ ] The signed-in checks still open from 2.10.2, 2.11 and 2.12.
- [ ] Remove the leftover worktrees under .claude/worktrees (the Auto-mode classifier refused an agent's removal; each is clean): run git worktree prune, then git worktree remove .claude/worktrees/DIR for each DIR that git worktree list shows.
- [ ] Update .claude/settings.local.json (Alexander's own file): the save-shot.mjs allow entries still name the old browser-check path; they should name spidey-sense.
- [ ] Optional: correct four agents' voice lines (`chris-de-kok`, `kissochbajslowski`, `lorenzo-von-matterhorn`, `romeo-olsson`); `jesse-pinkman` guessed them.

