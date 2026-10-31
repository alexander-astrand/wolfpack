# Standing facts (`.claude/standing-facts.md`)

What the kit's builders kept asking for in their `Cheaper next time` lines, so no order has to carry it again. Written by `future-ted` at the wrap from the `order` lines that hold for any step; started at kit-1.8's wrap (31 Oct 2026).

## Every order
- Read a file with Read before an Edit, even after `cat` showed it (troy-and-abed, kit-1.8 studio).
- A sweep or todo list names the file and a unique anchor string, never line numbers (jesse-pinkman, kit-1.8 sweep 1).
- Each fix commit's message carries its review finding ID, e.g. `fix(M3): …` (kissochbajslowski, kit-1.8 round 2).

## Files
- A lesson in `plugins/core/lessons.md` is one line of at most 300 characters (`scripts/check.mjs` fails a longer one); an order that edits lessons names the exact `[slug]` tags (jesse-pinkman, kit-1.8 first).
- A guard lane needs `git -C <lane> grep` allowed; give a guard reviewer an `--explain` run list so shapes are run, not read (jeff-winger, kissochbajslowski, kit-1.8).

## Traps
- A new CLI's main guard is `pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url`, and its test spawns it through a spaced path and a symlink: two kit-1.8 lanes shipped the plain `file://` form and both were round 1 musts.
- A new dry-run mode injects every appender (log, ledger, marker) as a no-op: kit-1.8's `--explain` wrote full-auto logs until review.
- Two fix lanes on one shared file get a line rule up front (who owns which lines), never "split as you go" (jeff-winger, kit-1.8 fix-A).
