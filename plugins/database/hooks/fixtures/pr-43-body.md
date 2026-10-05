Built overnight by `gus-fring` (`/night 2.12 designer=fable stars=2`: slow speed, away, zero pings). 2.12 gives the members push notifications and a home-screen app, repeating nights with auto-cancel and a "Still in?" question after a convert, shop links and Log a cost, a map pin for places, Jedi rank icons in colour, and the 2.11 fixes (profile page, date picker, host line, co-owned games). Plan: `~/.claude/plans/V2.12.md`.

**No browser check ran tonight** (see Notes for review): the QA lanes are a checklist for tomorrow.

## What changed

Risky ones are marked **RISKY**.

1. `f3a3cb9` Process: the 2.11 lessons, drawn things get designed, clean-ups by id (`gus-fring`)
2. `d87cd35` Shop links function, and co-owners set one place, **RISKY: migration 0049** (`the-playbook`)
3. `7e0cca1` Profile page: two stacks, sections fold on phones (`chris-de-kok`)
4. `c6f9afa` Date picker floats above sheets (portal), calendar icon no longer squeezes the placeholder (`jesse-pinkman`)
5. `e0a1d43` Event cards no longer show the "At the host's" line; the event page keeps it (`jesse-pinkman`)
6. `3f3862a` Spirit Island scenarios show their difficulty in Log a play (`jesse-pinkman`)
7. `5c60e86` Move a place's pin on a Leaflet map, no coordinates to type (`saul-goodman`)
8. `835a866` Buy links to Spelexperten and Playoteket, one place for a shared copy (`ahmed-och-ahmed`)
9. `70166fd` Log a cost from any event's Food section or the Buying page (`ahmed-och-ahmed`)
10. `058035d` Jedi rank icons in colour, a size bigger (`jeff-winger`, from `mosbius-designs`' pick)
11. `ddfe035` Push notifications with a push and email switch per kind, **RISKY: migration 0050**, new `notify` and `push` functions, triggers calling `notify` through `pg_net` (`the-playbook`)
12. `c7ea0ae` Add the app to your home screen (manifest, service worker, icon) (`troy-and-abed`)
13. `39a1e34` Turn on notifications on your phone, choose push and email per kind (`troy-and-abed`)
14. `8f8df3a` Reminders the day before, what to bring, polls about to close, repeating nights, auto-cancel and "Still in?" after a convert, **RISKY: migration 0051, the scheduler** (creates `pg_cron`, schedules `run-scheduled-jobs` every 5 minutes) (`the-playbook`)
15. `8ed1b7f` Series announced once, stopped with one email; a convert asks "Still in?" (function wording) (`the-playbook`)
16. `c3833df` Repeat every week / other week / 4 weeks, Stop the series, auto-cancel in the event form (`chris-de-kok`)
17. `9063145` "Still in?" after a convert, **RISKY: reconfirm** (`troy-and-abed`)
18. `f64dd69` Quiet footer with the version and a Feedback link (`jesse-pinkman`)
19. `fea1b1c` Review fix: "bring the game" only to keepers who are going; shop-link fills in batches of 10 (`the-playbook`; 0051 edited in place before merge, re-applied on dev)
20. `1925d4e` Review fix: no auto-cancel on tables, dead card join removed, bring list for every night of a new series (`chris-de-kok`)
21. `86a31e6` Review fix: Log a cost under a private night (`ahmed-och-ahmed`)
22. `14bb462` Review fixes: young Jedi robes on parchment, themed switch knob, service-worker app-path guard, gap (`jesse-pinkman`)
23. `45d9765` Accessibility: date picker keyboard focus and arrows, 40px targets, live regions, labels (`jesse-pinkman`)
24. `046b634` README: set-up for push, notifications and the scheduler (`c-3po`)

## How it was tested on dev

- SQL tests (`supabase/tests/`): 17/17 files PASS on dev and on a fresh local database with all migrations replayed. New: `notifications.sql` (67 checks), `scheduler.sql` (40). Extended: `waitlist.sql` 104, `group_isolation.sql` 416, `host_place_bring.sql` 38, `buying.sql` 115, `function_grants.sql`. `buying.sql` no longer asserts that every group has Buying on (dev's real group has it off); the `host_place_bring.sql` fixture G2 is marked `separate_copies`.
- Edge Functions called on dev: `shop-links` boots, 401 signed out, CORS, matcher run on dev's library (Spelexperten 18/20, Playoteket 15/20); `push` GET returns the key that matches, 401 signed out; `notify` 401 on a wrong secret, 400 on an unknown kind; end to end: a settlement insert goes through `pg_net` to `notify`, 1 of 3 fake devices delivered, the 410 and bad ones deleted. Push encryption uses WebCrypto, RFC 8291 test vectors match. The `shop-links` and `push` member paths were not called end to end as a signed-in member.
- Scheduler: cron job `run-scheduled-jobs` live on dev, first run `succeeded`.
- Dev cleanup (by id, never a whole table): all test rows were deleted by id by the agents; nothing left on dev.
- Browser, 375 / 1024 / 1440px, light and dark: **not run** (the pane's dev tab at :3000 wasn't signed in, and test logins never come from memory). The service worker didn't register in the pane (probably the pane; needs real Chrome or Safari). Leaflet chunk 151 kB (44 kB gz), not in the main bundle.
- `npx tsc -b`, `npm run lint`, `npm test` (537), `npm run knip`, `npm run build`: green.

## Production steps

`/skinny-pete 2.12` follows these; each step is one exact command or a marked human step. The Vercel preview can't be checked before the Before-merge steps (it runs against production's database, which lacks 0049 to 0051).

### Before merge
Run right before merging, then merge straight away: 0051's convert sets reconfirm deadlines and the 2.11 app has no "Still in" button, so nobody should convert a night in between.
1. Backup: `scripts/prod-db.sh backup 2.12` (stop if it fails)
2. Dry run: `scripts/prod-db.sh dry-run` (must list exactly 0049, 0050, 0051)
3. Migrations: `scripts/prod-db.sh push 2.12 0049 0050 0051` (0051 creates `pg_cron` and schedules `run-scheduled-jobs`)
4. Human step (secrets, a person only, before step 5): `npx web-push generate-vapid-keys`, then `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=https://example.party --project-ref <prod-ref>` (`FUNCTION_SECRET` already exists on production)
5. Deploy the functions, one command each:
   1. `supabase functions deploy shop-links --project-ref <prod-ref>`
   2. `supabase functions deploy push --project-ref <prod-ref>`
   3. `supabase functions deploy notify --project-ref <prod-ref>` (`verify_jwt = false` via `config.toml`)
   4. `supabase functions deploy notify-new-game-night --project-ref <prod-ref>`
   5. `supabase functions deploy notify-game-night-changed --project-ref <prod-ref>`
   6. `supabase functions deploy notify-game-night-cancelled --project-ref <prod-ref>`
   7. `supabase functions deploy send-promotion-email --project-ref <prod-ref>` (its shared recipients and stockholm files changed)
6. Check `function_secret` exists: `select key from public.app_settings;`, then: `insert into public.app_settings (key, value) values ('notify_url', 'https://<prod-ref>.supabase.co/functions/v1/notify') on conflict (key) do update set value = excluded.value;`
7. Check the job: `select jobname, schedule, active from cron.job where jobname = 'run-scheduled-jobs';`

### After merge
Vercel ships the frontend.
1. Verify, about 10 minutes later: `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` shows `succeeded`.
2. No shop-link command: the first Games page visit fills the library.

### Human steps
- The VAPID pair (Before merge, step 4).
- On his phone: add to home screen, turn on notifications, Send me a test.
- The QA checklist below (on dev once the :3000 tab is signed in, or on production after the deploy).
- The 2.10.2 and 2.11 signed-in checks: a past night, a member's stats and head to head, Root Smart pick at 4, an Uprising team play; the Buying page, a saved place, an event card.
- Look at the Jedi gallery and keep or overturn C; see which shop links look right on a few games.

## Notes for review

Escalations: none. Pings: none (overnight, away). Stars used: 2/2 (`heisenberg` brief and review, `mosbius-designs` on Fable). Speed: slow (one agent at a time). Overrides: `designer=fable`, `pick=designer` (default).

### Decided on the way
- **Jedi icons:** `heisenberg` briefed from Alexander's words verbatim; `mosbius-designs` (Fable) drew A sticker, B coin, C chunky pixel blocks, and `pick=designer` chose C, the only one readable at 16px in both themes. [Gallery](https://claude.ai/artifact/GALLERY_ID). Alexander can overturn it (A is runner-up; swapping is one file). Sizes 16 to 20px in lists and the compact slider, 20 to 28px on the slider. Open: how the pixel look holds at large sizes; the "Teach, you can." hover title isn't built.
- **Shop links:** both shops answer server fetches (Spelexperten suggest endpoint; Playoteket search ajax, `.se` redirects to `.com`). Exact normalised name match, else the shop's search link. No prices. The library fill runs as the member from the Games page (no service key: the guard refuses API keys), 10 items per round, up to 10 rounds per visit.
- **Co-owners:** `games.separate_copies` ("We each have a copy") and a `set_game_location` RPC; readers unchanged.
- **Reconfirm** is a column, `attendances.reconfirm_by` (status stays `attending`), so no seat counting changed anywhere; `confirm_spot` RPC; deadline = min(24h, start minus 1h), nobody asked under 30 minutes.
- **A series** is made inside `save_game_night` / `save_movie_night` (one announcement for the whole series); repeat 1, 2 or 4 weeks, 2 to 12 nights; with several events in one save each repeats on its own. No series line on the event card (at most 2 new chips, and it would need a query per card): event page only.
- **Notification kinds:** 12, push per kind, email where one exists (plus reconfirm); defaults on. Comments go to those going or waiting; suggestions to the host (else the creator); money skips whoever logged it.
- **Push** via WebCrypto (no library). The VAPID public key is served by the `push` function (no Vercel env var). `VAPID_SUBJECT` is https://example.party.
- **Footer:** v2.12.0 plus Feedback, which opens a new GitHub issue prefilled with the version and page path.
- Scenario difficulty was already seeded in 0046, so no game facts to check. The Q1 buying switch: nothing built (Alexander: "Current setup is fine now that I looked.").
- Not written up as ADRs yet; none of these is a rule that outlives the release except possibly the reconfirm column and the series design, which `/future-ted` can record.

### Set aside, not verified
- **No browser check at all tonight:** no `bengt-johansson` QA (A profile, notifications and footer; B repeat and auto-cancel; C reconfirm flow; D date picker in Plan a purchase, pin and Log a cost), no screenshots, and the `shop-links` and `push` member paths weren't called end to end.
- Known small gaps (on the roadmap): no notice to a member who lost their seat at the reconfirm deadline; no day-before reminder for events made under 24h ahead; no closing push for polls open 3h or less; the activity log records one cancel per stopped night; the auto-cancel email is the usual cancellation email (the push says why); `notification_log` grows without pruning; a second table's own attendance fetch doesn't read `reconfirm_by` (the question shows once in the header); `theme-color` is dark-only; Escape in the date picker also closes a surrounding sheet (as before). `NamesPopover` isn't portalled but is only used on event cards, never in a sheet.
- Every review finding was ticked against its fix diff by `gus-fring`; all matched.

### QA checklist for tomorrow
- [ ] Profile page at 375 and 1024, both themes
- [ ] Notifications on an iPhone home-screen app: Send me a test, per-kind switches
- [ ] Create an "Every other week" x6 series; Stop the series (with and without this night)
- [ ] Auto-cancel warning shows, and turning it off works
- [ ] Convert a night: Still in? / Can't make it / the deadline
- [ ] Plan a purchase: the date picker floats over the sheet
- [ ] Move the pin; "I'm here" allow and deny
- [ ] Shop links appear after adding a game
- [ ] One "Kept at" for two co-owners
- [ ] Log a cost from Food and from Buying, including under a private night

## Budget (Skyler, `node scripts/usage.mjs --timeline`)

| Agent | Step | Budget | Used | Stopped by Hank |
|---|---|---|---|---|
| `the-playbook` | 1 DB for the fixes (0049, shop-links) | 40M | 31.6M | no |
| `heisenberg` ★ | 2 Jedi icons brief | 8M | 0.5M | no |
| `mosbius-designs` (Fable) ★ | 3 Jedi icons, three directions ([gallery](https://claude.ai/artifact/GALLERY_ID), picked C) | 12M | 6.2M | no |
| `chris-de-kok` | 4 Profile page: two stacks, folding | 20M | 3.2M | no |
| `jesse-pinkman` | 5 Date picker, card line, scenario difficulty (also the footer and review fixes) | 15M (+9M footer) | 4.5M | no |
| `saul-goodman` | 6 Move the pin on a map | 20M | 2.2M | no |
| `ahmed-och-ahmed` | 7a+7b Shop links, co-owners, Log a cost | 30M | 9.8M | no |
| `jeff-winger` | 8 Jedi icons from the pick | 12M | 0.8M | no |
| `the-playbook` (fresh) | 9 DB notifications, push, notify (0050) | 45M | 22.8M | no |
| `troy-and-abed` | 10 Home-screen app + notification settings (also step 13, reconfirm) | 25M (+23M total) | 9.4M | no |
| `the-playbook` (fresh) | 11 Scheduler, series, auto-cancel, reconfirm (0051) | 50M | 28.6M | no |
| `chris-de-kok` (fresh) | 12 Repeating nights + auto-cancel in the form | 25M | 6.7M | no |

## Usage

From `node scripts/usage.mjs --commits 23 --timeline 00000000-0000-0000-0000-000000000000` (the README commit came after, so 23 commits counted). One session, so the `gus-fring` row is the navigator.

| Agent (timeline label) | Model | Start | End | Min | Calls | Tokens |
|---|---|---|---|---|---|---|
| `gus-fring` (navigator) | Opus | 00:55 | 03:10 | 75 | 99 | 39.6M |
| `the-playbook`: step 1 DB for the fixes | Opus | 01:00 | 01:19 | 19 | 92 | 31.6M |
| `heisenberg`: step 2 Jedi icons brief | Fable | 01:20 | 02:53 | 2 | 10 | 0.5M |
| `mosbius-designs`: step 3 Jedi icons, three directions | Fable | 01:21 | 01:31 | 10 | 40 | 6.2M |
| `chris-de-kok`: step 4 profile page, two stacks | Opus | 01:33 | 01:35 | 3 | 23 | 3.2M |
| `jesse-pinkman`: step 5 date picker, card line, scenario difficulty | Sonnet | 01:36 | 03:05 | 4 | 34 | 4.5M |
| `saul-goodman`: step 6 move the pin on a map | Opus | 01:39 | 01:42 | 3 | 16 | 2.2M |
| `ahmed-och-ahmed`: steps 7a+7b shop links, co-owners, Log a cost | Opus | 01:42 | 03:04 | 8 | 54 | 9.8M |
| `jeff-winger`: step 8 Jedi icons from the pick | Opus | 01:50 | 01:51 | 1 | 7 | 0.8M |
| `the-playbook`: step 9 DB notifications and push | Opus | 01:52 | 02:12 | 20 | 69 | 22.8M |
| `troy-and-abed`: step 10 home-screen app and notification settings | Opus | 02:13 | 02:50 | 8 | 55 | 9.4M |
| `the-playbook`: step 11 scheduler, recurring, auto-cancel, reconfirm | Opus | 02:19 | 03:01 | 26 | 82 | 28.6M |
| `chris-de-kok`: step 12 repeating nights | Opus | 02:43 | 03:03 | 6 | 40 | 6.7M |
| `kissochbajslowski`: pre-Anton review | Sonnet | 02:53 | 02:58 | 4 | 35 | 6.0M |
| `kissochbajslowski`: design and accessibility review | Sonnet | 03:05 | 03:07 | 1 | 20 | 1.0M |
| `jesse-pinkman`: accessibility fixes from the review | Sonnet | 03:07 | 03:08 | 1 | 10 | 1.0M |
| `c-3po`: README setup, PR description, Usage section (so far) | Sonnet | 03:10 | 03:10 | 0 | 7 | 0.5M |
| **Total** | | | | | | **174.3M** |

- **Per commit:** 7.6M (23 commits), against 13.9M for 2.11 (normal speed, 194.3M including its deploy) and the pre-trial band of 3.4 to 13.3M; this figure has no deploy in it yet.
- **Models:** Opus 89%, Sonnet 7%, Fable 4%. Wall-clock 2h 15m (00:55 to 03:10); agent-minutes 191 = 141% of wall-clock, so slow (one agent at a time) still overlapped some work.
- **Weekly meter** (from `gus-fring`): start 64% all models / 46% Fable, at the draft 68% all / 48% Fable, so +4% all and +2% Fable, inside the 5% target before the deploy; pace target ~14%/day.
- **Rework loops:** `the-playbook` edited 0051 in place once after review (`fea1b1c`) and the review fixes ran across several agents; nothing needed `boba-fett`. The `the-playbook` step-1 job (31.6M) was the single biggest agent row.
- **Slow vs normal, and the Fable trial:** slow was cheaper per commit than 2.11's normal run, but this isn't a clean comparison: QA couldn't run tonight, so slow's extra checking was only the second design reviewer and `heisenberg`'s review. Keep as is; ask for a usage comparison of this run against 2.11 once QA and the deploy are in (it's on the roadmap page).
- **For `/future-ted`:** `/night`'s preflight should check that the :3000 dev tab is signed in, or list it as a person-only need before starting.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

