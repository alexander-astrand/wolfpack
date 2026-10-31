# Standing facts (`.claude/standing-facts.md`)

What this project's builders kept asking for in their `Cheaper next time` lines, so no order has to carry it again.

- **Who writes it:** `future-ted`, at the wrap, from the `order`-tagged cheaper lines that hold for any step: one line each, and a line dropped once it no longer holds. Nobody else edits it.
- **Who reads it:** the order composer (`compose-order.mjs`) puts the lines that touch a step into its order, and builders read it first. Lines under "Every order" go into every order; the others go in when they share a path, a backticked name or two words with the step.
- **Where it comes from:** the first preflight (or `/inception`) copies this starter when the project has none (kit 1.8, H3). Replace the examples below; a line still holding a `<...>` placeholder is skipped.

The composer already prints the shell shape and the closing ask, so they don't belong here.

## Every order
- <a shared part every page step should use, for example: folds are `Section defaultOpen={false}`, ticks `Tick`, card heads `CardHead`>

## Files
- <a gitignored env file a lane needs, for example: copy `.env.local` into a worktree lane, never commit it>
- <the test command for one file, for example: `npx vitest run <path>`>

## Data
- <the loader that already holds some data, for example: money reads come from `lib/money-load.ts`, never a second query>
- <the service-role need, for example: which scripts or tests need it and where the key is read from>

## Traps
- <a trap that cost a builder a turn, and the way round it>
