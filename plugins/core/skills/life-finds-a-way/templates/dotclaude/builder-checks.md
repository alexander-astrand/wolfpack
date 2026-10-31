# Builder checks

What keeps coming back on this project, one line each with its grep. Builders run them on their diff before they commit; `kissochbajslowski` reads a hit as a must. Add a line when a review must or a send-back comes back a second time; the first three are the kit's own (`design/taste.md`, seeded by `/life-finds-a-way`, kit 1.5 H4).

- **A logo or mark draws on whole pixels** (the kit's taste: a wordmark at 109x25.25 and a mark at 18.9px both blurred, in two projects). `git diff main -U0 | grep -nE '^\+.*[0-9]+\.[0-9]+px'` shows no fractional size in a logo, mark or icon box; a computed size goes through `Math.round`.
- **No native share outside the shared share menu** (the kit's taste: on a desktop, macOS's sheet showed no chat apps; phones keep the native sheet). `git diff main -U0 | grep -n 'navigator.share'` hits only inside the one shared share menu component.
- **No floating text** (the kit's taste, 31 Oct 2026: an empty-state line lay bare on the page ground beside a lone card). `git diff main -U0 | grep -niE '^\+.*(nothing yet|no [a-z]+ yet|goes here|empty)'`: each hit sits inside the card or section it is about, never straight in the page's column; in the browser the page scan's `floatingText` count is 0.
