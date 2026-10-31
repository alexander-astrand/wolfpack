# The order composer (kit 1.8, council Feature 2)

How the navigator builds each step's work order with `compose-order.mjs`. Read by section (`grep -n '^## '`). The script's header comment is the full spec.

## Run it

`node ${CLAUDE_PLUGIN_ROOT}/scripts/compose-order.mjs --plan <plan file> --step <id> --project <project root>`, once per step, before the spawn. `--json` gives the same as data. Exit 2 means no row for that step: the plan's step table has no such id, or the step lives in prose; write that order by hand.

It reads the plan's step row (columns found by header word: Step, What, Agent or Who, Model, Lane, Budget or Ceiling, Found or Files or Where, Check), `.claude/kit.json`, `.claude/standing-facts.md`, `budgets.json` and the routing rules below. It reads files only; no agent, no database.

## What it prints, and what you add

It prints the order's fixed half: the spawn line (agent, `model`, effort, mode), the Agent `description` ending in the `[budget NM]` tag, the step, the files to read, the tests that read them, the standing facts that touch the step, the shell-shape line and the closing ask. Paste it as it stands; the "Composer notes" under it are for you, not the agent.

You add the half that needs judgment: why the step exists, the taste lines word for word, the shared parts by name, the owner of any helper lanes share, the dev port and tab, the PR box to tick, and for a builder after a playbook step, its "what the frontend will call" section verbatim.

## The rules it applies

- **Budget, never absent:** the plan's cell, else kit.json `budgets`, else `budgets.json`. A build order above the 15M ceiling is held at it (the note says cut the step at `/inception`). A designer with no cap, "lifted" or "unlimited" gets the 12M stop, and a designer cap above its route is cut to the route (H7).
- **Designer model and mode:** a drawn thing (icons, badges, illustrations, "drawn-things") or a step marked "important design" runs Fable at 12M, a star. Palettes, type or font pairs and a first look run Opus at 5M. A plain one-page layout with a token CSS file (the row's own `.css`, else `app/globals.css` and the like) runs `mode: scripted` with `model: "sonnet"`; several pages, a mock as a route in the app, or no token CSS stays Opus layout mode. The plan's own model word does not override this; the note says when it differed.
- **Reviewer:** `kissochbajslowski` on Opus only when the row gives the reason in brackets (call B); otherwise the note says it stayed Sonnet.
- **Closing ask:** `End with "Cheaper next time:" as the report's last line`; for `the-playbook`, as the report's first field, or none (H3).

## The playbook's lane brief

For a `the-playbook` step it adds the lane brief (Feature 7): the stack (local or hosted dev), the test, apply, read-the-schema and types commands, and per table or function the row names, the `scope.mjs` line to run and the non-code files naming it (docs, `CLAUDE.md`, `.claude/*.md`, `supabase/queries/`). Run each `scope.mjs` line and paste its output under the brief. A project whose commands differ sets `database.{test,apply,schema,types}` in kit.json.

## Standing facts

The composer puts the touching lines of `.claude/standing-facts.md` into the order. When the project has none, its note says so: the first preflight copies `templates/standing-facts.md` there. `future-ted`, at the wrap, adds one line per `order`-tagged cheaper line that holds for any step; nobody else writes it.
