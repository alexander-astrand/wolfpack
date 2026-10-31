# The guard paste (kit 1.8)

The guard is frozen: a release prepares its change and a person pastes it (`[frozen]` in `core/lessons.md`, call 2 at `/memento kit-1.7.1`). `kit-1.8.patch` is `jeff-winger`'s six commits from the `kit-1.8-guard` lane, cut from 3535692, applied as they are:

1. **H5** a glob under a `$var` folder is judged by its last part (`for d in $r/.claude/worktrees/*/` passes; `$r/scripts/*`, `${r:-x/scripts}/*`, `$r/x/../*` stay refused), seven probe shapes in `guard-reads.test.mjs`.
2. **M1** every refusal and the header name `/one-ring` first, `/skinny-pete` as the fallback (one `PROD_ROUTE` constant).
3. **M12** the decision log's column 10 is a stable reason code; `guard-allows.mjs` writes a per-session allow count at SessionEnd; a step-aside writes one row per session.
4. **F16** `denied-log.mjs --summary` names the rule and the habit line per repeated reason; `guard-production.mjs --explain '<cmd>'` is the dry guard.
5. **L3** a bare "token" in a human step no longer holds the deploy (an env name, a secret kind or a hand-over verb still does).
6. **F6** the deploy prints a cost line (minutes, the longest wait, the 4.5M / 12 min baseline) before `DONE`.

Paste it from the release checkout with `node scripts/guard-paste.mjs`: it applies the patch with `git am --3way`, runs the hook tests, removes this folder in one commit and pushes. `--dry` prints the steps first. On red nothing is pushed and it prints the undo.
