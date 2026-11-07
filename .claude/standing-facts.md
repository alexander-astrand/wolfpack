# Standing facts (`.claude/standing-facts.md`)

What the kit's builders kept asking for in their `Cheaper next time` lines, so no order has to carry it again. Written by `future-ted` at the wrap from the `order` lines that hold for any step; started at kit-1.8's wrap (31 Oct 2026).

## Every order
- Read a file with Read before an Edit, even after `cat` showed it (troy-and-abed, kit-1.8 studio).
- A sweep or todo list names the file and a unique anchor string, never line numbers (jesse-pinkman, kit-1.8 sweep 1).
- Each fix commit's message carries its review finding ID, e.g. `fix(M3): <what>`, and a finding the fixer refutes gets a commit or report line saying so, so the re-read reads one line, not a diff (kissochbajslowski, kit-1.8 round 2, kit-1.9 R1 re-read).
- A fix order names the test files it touches (saul-goodman, kit-1.9 F1).
- A step whose check needs a later step's output says which check waits for which step (jeff-winger, kit-1.9 C1).
- A sweep order gives each file's real path and the exact form it replaces there (jesse-pinkman, kit-1.9 P3+P4b).
- An order that asks for before and after sizes gives the before line counts (chris-de-kok, kit-1.9 F1 guard).
- Each file path in an order comes from `git ls-files`, and the order names every new file so the builder adds it before a `git commit -- <paths>`; never a bare `git commit` in a shared lane (jesse-pinkman, kit-1.10 B5b, A10; A15 landed in A6's commit).
- An order says what the existing script already does and names any expected failure from another lane's unmerged work up front (jesse-pinkman, kit-1.10 A14, A17).
- An order that reads a transcript names its path and the fields wanted (the go's argument and time, the title lines), so no builder probes a transcript and trips the guard (saul-goodman, chris-de-kok, jesse-pinkman, kit-1.10 A3, A0a, A4).
- A council-fix order pastes the council's Fix lines, and a multi-file line sweep comes as one table (file, anchor, wording), so the builder opens no report and batches its edits (ahmed-och-ahmed, jesse-pinkman, kit-1.10 B4, B9, B10).

## Files
- A lesson in `plugins/core/lessons.md` is one line of at most 300 characters (`scripts/check.mjs` fails a longer one); an order that edits lessons names the exact `[slug]` tags (jesse-pinkman, kit-1.8 first).
- A guard lane needs `git -C <lane> grep` allowed; give a guard reviewer an `--explain` run list so shapes are run, not read (jeff-winger, kissochbajslowski, kit-1.8).
- `guard-paste.mjs` takes a patch folder and no project argument (chris-de-kok, kit-1.9 S1+D1).
- A matcher over a connector's tools is tested on the real tool list (Pollux's 247-name `tools.txt`), never one derived from settings (kissochbajslowski, kit-1.9 R1).
- An Artifact publish refused with the live version handed back counts as the read: merge and publish once (c-3po, kit-1.9 W1).
- A doc or lesson step runs `scripts/check.mjs` before its first edit and after each file (300-character lesson cap), and only the tests it touches (`budget-cap.test.mjs`), never the full suite while other lanes' work is unmerged (jesse-pinkman, kit-1.10 B5a, B11, B2b).
- Builders' frontmatter lives in each agent file's own head; the Bengan Boys' in `spidey-sense/bengan-boy-template.md`; `test-project.mjs` isolates a test, it makes no fixtures (ahmed-och-ahmed, saul-goodman, kit-1.10 B1a, B1b, A11).
- Search `hooks/` with `git grep`, and when code moves out of a hook, grep the tests' sandbox copy lists first (chris-de-kok, jesse-pinkman, kit-1.10 A8, A9).
- The README and PR-body order arrives with the body's skeleton and each step's one-liner pre-filled from the steps file, so the writer only checks them (c-3po, kit-1.10 B12, 3.2M of 3.0M).

## Traps
- A new CLI's main guard is `pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url`, and its test spawns it through a spaced path and a symlink: two kit-1.8 lanes shipped the plain `file://` form and both were round 1 musts.
- A new dry-run mode injects every appender (log, ledger, marker) as a no-op: kit-1.8's `--explain` wrote full-auto logs until review.
- Two fix lanes on one shared file get a line rule up front (who owns which lines), never "split as you go" (jeff-winger, kit-1.8 fix-A).
- Builders can't open `file://` or `preview_start`: an order that wants a Browser pane timing names a dev server already running (ahmed-och-ahmed, kit-1.9 B1).
- Review probes take their import folder as a plain argument (no `VAR=` prefix), and a fixer adds round 1's try-next shapes to its probe, so round 2 reruns one file (chris-de-kok, kissochbajslowski, kit-1.10 X1a, R1 round 2).
- With three fixers on one machine only one runs the full suite; spawn-heavy tests time out when several do (saul-goodman, kit-1.10 X1b).
