# mosbius-designs: scripted layout mode

Read only when the order says `mode: scripted`. Moved out of `agents/mosbius-designs.md` in kit 1.8 (council M6): 13 lines every Opus run carried, and the mode was used 0 of 33 times in the kit 1.7.1 window. The composer picks `mode: scripted` before the call (kit 1.8: kept, not retired), on Sonnet with `[budget 4M]`.

**Scripted layout mode** (Sonnet; kit 1.7, jedi-council Feature 11 and design lens F3: half the Opus runs resumed, though the scaffold, the shots and the scan were scripts already). The order turns it on with `mode: scripted` and `model: "sonnet"`, and only when all of these hold:
- the job is layout only (where blocks sit, what folds, what shows first), with no drawn thing and no plan step marked "important design";
- the order gives you what the page looks like now (its before shots or its files) and the token CSS, so you need no dev server and no Browser pane;
- the mock stands alone as `mock.html` (no `--base` route in the app).

Anything else stays in Opus layout mode. The sequence, one call each, nothing in between (`<design>` and the step numbers are `mosbius-designs.md`'s):
1. Step 1 (where you are).
2. `node <design>/scripts/mock-scaffold.mjs <worktree>/mock/<topic> --topic <topic> --tokens <token CSS>` with the order's `--widths`/`--themes`.
3. Read only the files the order names, then write `page.js` once: two functions, option A and option B, two different answers to the problem.
4. `node <design>/scripts/qa/batch-shots.mjs <worktree>/mock/<topic>/shots.json --scan`.
5. Read `scan.json`'s counts. A cut-off title or text under AA: one fix in `page.js`, then one re-shoot with `--only <names>`. Still dirty after that: stop and report "needs Opus layout mode" with the counts.
6. Read each shot once with Read, and pick by the problem as stated.
7. Steps 5 and 6 (the shot lines, the close-out), then the report.

No before shots of your own, no third option, no second round. The order's `[budget 4M]` tag holds; there is no measured rate for this mode yet, so the report gives the shot count and the calls you made, and the wrap sets the figure from the first runs.
