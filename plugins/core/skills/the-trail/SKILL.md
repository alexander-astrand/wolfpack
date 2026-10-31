---
name: the-trail
description: Edit the shared roadmap page (a claude.ai data artifact) by writing rows - a status, a card, a section or the header is one ArtifactData write, never a republish - or a static roadmap page (kit.json pages.roadmapSource) by editing its source and republishing. Use whenever the roadmap changes in a project with a roadmap page (kit.json pages.roadmap), in the same turn, even with roadmap file, including from /badger, /future-ted, /inception and /captain-call.
---

## Status card (the common write; stop here when it's all you need)
A release's status on a **data page** (kit 1.8, F-4: most calls were this one write, and each read the whole skill):
1. The page: its id from `pages.roadmap` in `.claude/kit.json` or memory `project_roadmap.md`. A static page (`pages.roadmapSource` set) or `roadmap: file`: read on, this card isn't for you.
2. `get` `cards/<anchor>` (e.g. `cards/v1-5`) for its badge's PR number.
3. `update` `cards/<anchor>`: `status` (`shipped | in-progress | in-review | planned | parked`), `badge` ("Shipped · PR #80", "Planned") and `updated_at` (ISO), together.
4. `str_replace` on `meta/page`'s `revised_html`: one dated line in front of its first words ("31 Oct 2026 (V1.5 shipped); earlier …"), never the field resent.
5. `get` the card back to check it, and the same change into `project_roadmap.md` when the project keeps one.
Anything else (a new card, a section, a batch, an `order` move, the header): the full skill below.

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · the-trail <subject>` (norms.md).

## Voice
the-trail · the wagon master (The Oregon Trail) · "ford the river", "the wagon's loaded", counts every mile
- start: (silent)
- commit: "Wagon's loaded: one row written, the page shows it."
- refusal: "Can't ford this one. Here's what stopped the wagon."
- ping: "Fork in the trail: which card, A or B?"
- wrap: "Camp made. The trail's up to date."
Shape and rules: `<design>/voice-card.md` (`<design>` is the folder of the wolfpack `design` plugin, which ships the card).

The roadmap page is a private claude.ai artifact (since 2.14.6.2 a data page). **Name it by its id from memory `project_roadmap.md`, or by `pages.roadmap` in `.claude/kit.json` when a private repo fills it**; in a session without either, ask Alexander. **Which roadmap is the record** (one rule for every skill that reads or writes it; lens Must 9, kit 1.5): `.claude/kit.json`'s `roadmap` wins. `page` (or no key): this page. `file`: `<plans>roadmap.md` is the record, and a `pages.roadmap` page beside it (hejtide, Kastalia, Burrow) follows it in the same turn ("The page follows the record", below). `none` (Pylos): the project keeps no roadmap; nothing is written, and the skill asks which project's roadmap the idea belongs on. A public repo leaves `pages.roadmap` empty: the roadmap link is never in a public repo (the deck and team map links may be). And **private projects never go on the page** (they live on their Dev HQ card in Burrow, norms.md "Dev HQ card", never on the roadmap page).

The page's shape is `page.html` beside this file (no content in it). Everything you read on the page lives in the artifact's `db` as rows. Alexander and Anton (Editors) change a card's status right on the page; only the owner and Editors can write (`write: "admin"`).

## The page follows the record
Every skill that changes the roadmap (`/badger`, `future-ted`, `/inception`, `captain-call`, `c-3po`, `memento`, any other) puts the same change on the project's roadmap page **in the same turn**, whatever `roadmap` says, unasked (`[roadmap-page-same-turn]`). With `file`, write `<plans>roadmap.md` first (it is the record), then the page; never leave the page for a wrap-up, a later session or his reminder. His words, 25 Oct 2026: "make sure to update the artifact if you haven't already, that should always be part of your job"; and 27 Oct, after a Burrow `/badger` wrote only the file because this skill called the page "only a view": "It's not added to the artifact, do I really need to tell you this every time? I feel like this has been a rule forever and you still don't do it automatically". kit.json `pages` says which page and which kind:

| `pages.roadmap` | `pages.roadmapSource` | The page | How it's written |
|---|---|---|---|
| a URL | empty or missing | a **data page** (hejtide, Kastalia) | rows, as "Steps" below, with the check its kind of write needs |
| a URL | a path (`~` allowed) | a **static page** (Burrow: one HTML file under `<plans>`, no rows) | edit the source and republish, as "A static page" below |
| empty | | no page | the file alone |

With `roadmap: page` the page is the record and the table changes nothing. A memory note naming a roadmap page that kit.json lacks means kit.json is behind: write that page this once and say in the reply that kit.json's `pages.roadmap` (and `pages.roadmapSource` for a static page) needs filling; kit.json is locked to agents, so that is a setup step.

## A static page (`pages.roadmapSource`)
1. **Read the live page:** `Artifact` `read` with `url` = `pages.roadmap` (a publish to a URL this session hasn't read is refused). If it holds a change the source lacks (another session published from its own copy), carry that into the source first.
2. **Edit the source** with exact string replacements, never rewritten from memory: the same change you made in `roadmap.md`, in the shape of its neighbouring cards, and one dated line in front of its "Updated" line ("27 Oct 2026 (after `/badger`: …). Earlier …").
3. **Publish:** `Artifact` with `url` = `pages.roadmap`, `file_path` = the source, a short `label` ("badger: <idea>"), no `icon`, `capabilities` left out. Never without `url` (that makes a second page). A refusal that hands back a newer live version: merge it into the source and publish once more.
4. **Check:** the result names the same URL. The reply says "page republished".

## The rows
| Doc | What | Fields |
|---|---|---|
| `meta/page` | header, principle, small notes | `eyebrow`, `title`, `lede_html`, `status_html` (3 spans), `revised_html`, `principle_eyebrow`, `principle_html`, `glance_heading`, `glance_also_html`, `releases_heading`, `releases_also_html`, `footer_html`, `updated_at` |
| `meta/archive` | the shipped rows that point to the archive page | `rows: [{href, ver, theme_html, pips, size_html, what_html}]` |
| `cards/<anchor>` | one release card each (`cards/v2-14-7`, `cards/r3-0-1`) | `id`, `ver`, `title`, `status`, `badge`, `variant`, `track`, `order`, `size_pips`, `size_text`, `why`, `pre_html`, `body_html`, `glance_ver`, `glance_theme`, `glance_size`, `glance_pips`, `glance_what`, `glance_hide`, `updated_at` |
| `sections/<id>` | `open-questions`, `parked`, `scope`, `claude-usage`, `ships` | `heading`, `class`, `anchor`, `label_id`, `order`, `body_html`, `updated_at` |

- **`status`** is `shipped | in-progress | in-review | planned | parked`; **`badge`** is the pill's words ("Shipped · PR #80", "Planned", "Collecting notes"). Write both together. A card with `badge: ""` (V3, V4) shows no pill.
- **`variant`** `"" | v3x | v3 | v4` picks the card's look; **`track`** `shipped | to-come | beyond` picks its At a glance group (a shipped card shows under Shipped whatever its track, except `beyond`).
- **`order`**: today's cards are 1000, 2000, … A new card takes the midpoint of its neighbours (between 12000 and 13000: 12500), so one row moves, not all.
- **At a glance is built from the cards**: one row per card unless `glance_hide: true` (a card inside a range row such as 2.14.2–2.14.4.1). The `glance_*` fields are the row's own words; left out, the row uses `ver`, `title`, `size_pips`, `size_text`.
- **Markup fields** (`*_html`, `why`, `size_text`, `glance_theme`, `glance_size`, `glance_what`) take today's markup only: `p ul ol li strong em code a h3 h4 h5 div span i small dl dt dd table thead tbody tr th td pre button br` with `class`, `href`, `id`, `aria-*`, `type`. The page runs them through DOMPurify; anything else (a `style`, an image, a script) is dropped. `ver`, `title`, `badge` and `heading` are plain text.
- `updated_at` is an ISO time; set it on every write.

## Steps (ArtifactData, on the page's id)
1. **Change a status:** `get` `cards/<anchor>` (to see the badge's PR number), then `update` `cards/<anchor>` with `status`, `badge` and `updated_at`. No full read, no republish.
2. **Add a card:** `get` the two neighbours' `order`, then `set` `cards/<new-anchor>` with every field above (`order` = the midpoint). Copy a neighbour's shape for `body_html` (`<h4>What's in it</h4><ul><li>…</li></ul>`, notes as `<p class="note">`, facts as `<div class="tech">`).
3. **Edit a card's text:** `get` it, change the one field in your copy, `update` only that field (`body_html` is replaced whole, so start from the text you just read).
4. **Edit a section** (an Open question, a Parked idea, a guideline): `get` `sections/<id>`, change `body_html`, `update` it.
5. **The header:** `update` `meta/page` with `revised_html` (and `status_html` or `lede_html` when they change). The "Revised:" word is the page's own. **Change `revised_html` and `status_html` with `str_replace`, never by resending the field:** it edits one string in place, while a resent field replaces the whole log (`[roadmap-page]`: 2.14.7's first `meta/page` write cut the revision log to one entry, restored by retyping). The log keeps its newest ten entries; older ones go to the archive page.
6. **Several changes at once** (a wrap-up, the conductor's end publish): one `batch` of these writes. The conductor's end publish is now a few row updates.
7. **Check:** `get` what you wrote back, or `list` `cards` for a count.
8. **Keep memory in step:** the same change goes into `project_roadmap.md`.

One write at a time per doc: never two writes to the same card in one batch. A rejected write means the page refused you; say so, don't retry in a loop.

## The check: which writes need it
The full check is for the writes that can leave the page wrong: a `batch`, a new card, a section change, the header, a card's `order` or `badge`. One status row, or one line added to one card's `body_html`, gets the `get` read-back of step 7 and nothing more. `/badger` follows the same split (its steps say which of its writes is which). For the writes that need it: `list` the page's rows (`meta/page`, `meta/archive`, every `cards/*`) into a JSON file keyed by doc path, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap-check.mjs <rows.json> <page.html>`, and paste its "At a glance" quick list into your report. It fails on a status the page doesn't know, two cards saying next, a "Folded into" note for a release that has shipped, and a header, lede or footer that names the wrong release as next, in progress or live. A failure is fixed (one more write) before the job reports done; the page is never left wrong.

## A full republish: only for the page's shape
For a data page. When `page.html` itself changes (layout, CSS, a new field the page must draw, the access rules): read the current version with the Artifact tool in full (the publish tool refuses an unread version), then `publish` with the **same `url`**, `file_path: ${CLAUDE_PLUGIN_ROOT}/skills/the-trail/page.html`, a short `label`, and `capabilities` **left out** so the access rules stay (only a rule change sends them again: `{db: {rules: [{path: "", read: "view", write: "admin"}]}, user: {}}`). Publishing without `url` creates a second page, so never do that. Republishing leaves the rows alone. Commit `page.html` in the same release, in both copies: the project's `.claude/skills/the-trail/page.html` and the kit's differ only in `<title>` and the eyebrow (the project's name against the kit's plain "Roadmap"), on purpose; every other change goes into both.

## Style
Plain words for the whole group, not code talk. A release note says what the members (`project.noun` in `.claude/kit.json`) get, then one line on how. Dates as "26 Sep".
