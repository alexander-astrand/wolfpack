# The Dev HQ feed (`dev-hq.mjs`)

What core's hooks send to Dev HQ in Burrow, and how. Only the hooks and `dev-hq.mjs` act on this, so it lives beside the script instead of in `norms.md`, which 41 skills cite (kit 1.8, council M8: the feed was 2,042 characters of `norms.md` that no skill reads). The card writes skills do make are `norms.md`, "Dev HQ card".

The kit card from Burrow's `/legendary` of 27 Oct 2026; Alexander, 28 Oct: "There are plenty of things that needs seeding in Dev HQ though".

- **When:** core's hooks (`hooks/hooks.json`) run `scripts/dev-hq.mjs hook` at a session's start, each prompt, each turn's end and its end, and after each Artifact publish.
- **The spool:** the hook notes the session's state and a publish's link in `~/.local/state/burrow-dev/kit/` and asks for one push, at most one every two minutes.
- **The push:** the machine's own Dev HQ report (`pollux-send.sh --dry-run`, `delphi-send --dry-run` on delphi) with the kit's parts added, POSTed to `dev-in`.
- **The parts:**
  - `sessions`: the desktop app's list with its titles. Running while a turn runs; waiting only when the latest turn's wrap-up asked him something, the app stopped a turn for him, or the Pylos roll call says waiting about the same activity; any other open session is done as of its last activity, and a terminal or delphi session six hours quiet is done. A full list, so a closed one leaves Running.
  - `team`: each kit agent's and skill's runs, cost a run and last use over 30 days, counted at most hourly; a skill by its slash, `/captain-call`.
  - `links`: each publish once, new with its dot; one he deletes stays deleted.
  - `shares`: the week receipt's slice of the meter per project over the meter's own week, Saturday's reset on, as `{ resets_at, list }`; delphi counts its own.
  - `readings`: every seven-day reading in the tower's tick log with the reset it counts toward, so each lands in its meter week.
  - `tiers`: Pollux only. Each open trial from the trials ledger and one row per service across the projects' `free-tiers.md`, from `scrooge.mjs`, with GitHub Actions minutes from `gh` when its token has the `user` scope.
- **By hand:** `node <core>/scripts/dev-hq.mjs push --dry-run` prints the body; `push --backfill` also files the last week's publishes.
- **Where it sends nothing:** a machine without the sender or the key (the cloud).
- **Its end:** once Burrow's sender reads the spool itself (its script names `burrow-dev/kit`), the hooks stop pushing.
