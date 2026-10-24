# Standing facts (`.claude/standing-facts.md`)

The facts this project's builders keep asking for in their `Cheaper next time` lines, so no order has to carry them again. The order composer (`lorenzo-von-matterhorn`, before each build step) appends the lines that touch the step to the order; builders read this file first. The navigator adds to it at the wrap from the `order`-tagged cheaper lines that hold for any step, one line each, and drops a line once it no longer holds. Kit 1.7 starter: copy it to `.claude/standing-facts.md` and replace the examples.

## Shell
- The shell is zsh: spell every path out, one per line; a space-separated `$P` list is not split.
- One command per Bash call, `git -C <repo>`, no `cd <dir> &&`, no `VAR=…` prefix.
- Commit path-scoped: `git -C <repo> commit -F <msg file> -- <paths>` (the `-F` before `--`).

## Files
- Gitignored env files: <for example `.env.local`; copy it into a worktree lane, never commit it>.
- The test command for one file: <for example `npx vitest run <path>`>.

## Data
- The loader that already holds <the data>: <path>.
- Service role: <which scripts or tests need it, and where the key is read from>.

## Traps
- <a trap that cost a builder a turn, and the way round it>
