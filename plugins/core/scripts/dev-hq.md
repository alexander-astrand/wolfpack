# The Dev HQ feed (`dev-hq.mjs`)

What core's hooks send to Dev HQ in Burrow, and how. Only the hooks and `dev-hq.mjs` act on this, so it lives beside the script instead of in `norms.md`, which 41 skills cite (kit 1.8, council M8: the feed was 2,042 characters of `norms.md` that no skill reads). The card writes skills do make are `norms.md`, "Dev HQ card".

The kit card from Burrow's `/legendary` of 27 Oct 2026; Alexander, 28 Oct: "There are plenty of things that needs seeding in Dev HQ though".

- **When:** core's hooks (`hooks/hooks.json`) run `scripts/dev-hq.mjs hook` at a session's start, each prompt, each turn's end and its end, and after each Artifact publish.
- **The spool:** the hook notes the session's state and a publish's link in `~/.local/state/burrow-dev/kit/` and asks for one push, at most one every two minutes.
- **The push:** the machine's own Dev HQ report (`pollux-send.sh --dry-run`, `delphi-send --dry-run` on delphi) with the kit's parts added, POSTed to `dev-in`.
- **The parts:**
  - `sessions`: the desktop app's list with its titles. Running while a turn runs; waiting only when the latest turn's wrap-up asked him something, the app stopped a turn for him, or the Pylos roll call says waiting about the same activity; any other open session is done as of its last activity, and a terminal or delphi session six hours quiet is done. A full list, so a closed one leaves Running.
  - `team`: each kit agent's and skill's runs, cost a run and last use over 30 days, counted at most hourly; a skill by its slash, `/captain-call`; `by_project` its runs per project (`{ "burrow": 14, "pylos": 2 }`, by the session's cwd, else its transcript folder), which `dev-in` keeps as `dev_team.by_project` from Burrow V1.9.
  - `links`: each publish once, new with its dot; one he deletes stays deleted.
  - `shares`: the week receipt's slice of the meter per project over the meter's own week, Saturday's reset on, as `{ resets_at, list }`; delphi counts its own.
  - `readings`: every seven-day reading in the tower's tick log with the reset it counts toward, so each lands in its meter week.
  - `tiers`: Pollux only. Each open trial from the trials ledger and one row per service across the projects' `free-tiers.md`, from `scrooge.mjs`, with live numbers from `tier-readers.mjs`, each read at most hourly and carrying its `read_at`:
    - GitHub Actions: gh's billing usage report (needs gh's `user` scope); private-repo minutes this month, with the budget flags (50, 70 and 90 % of the 2,000, the month or a project ahead of its pace, a project past its `ci.minutesBudget`), alerts first.
    - Vercel: the billing charges API with the CLI's own login (CLI 65's `vercel usage` can't parse them); this month's usage and anything billed.
    - Supabase: the Management API with the CLI's token; Edge Function calls this month, the largest database, active free projects.
    - Netlify: the CLI; credits and anything over.
    - Resend: the quota headers on one API answer, with a key in the Keychain as `dev-hq-resend`.
    - Cloudflare: today's Workers requests from the GraphQL Analytics API, with a token (Account Analytics read) in the Keychain as `dev-hq-cloudflare`.
    - CoinGecko: no reader; the Demo plan has no usage API (its `/key` is for paid plans), so the row shows its limit and says so.
- **By hand:** `node <core>/scripts/dev-hq.mjs push --dry-run` prints the body; `push --backfill` also files the last week's publishes.
- **Moves** (Burrow V1.9 D6): `dev-hq.mjs moves <input.json>` posts nothing; it prints the connector writes `/inception` (`plan`) and `/future-ted` (`ship`) make so a project's releases sit on their weeks: the release's `dev_bookings` row on the week of its planned start or ship day (a shipped one with that day), the project's later releases pushed on a week apart when it slipped (never pulled back), and the card's `planned_for`.
- **Where it sends nothing:** a machine without the sender or the key (the cloud).
- **Its end:** once Burrow's sender reads the spool itself (its script names `burrow-dev/kit`), the hooks stop pushing.
