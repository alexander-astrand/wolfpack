---
name: the-trail
description: Edit the shared roadmap page (a claude.ai data artifact) by writing rows - a status, a card, a section or the header is one ArtifactData write, never a republish. Use whenever the roadmap page needs a status, entry or note changed, including from /badger and /maverick.
---

**Title:** runs inside another session; keeps that session's title, unless that title doesn't parse as `project · kind · subject`: then it first titles the session `<project> · side · the-trail <subject>` (norms.md).

## Voice
the-trail · the wagon master (The Oregon Trail) · "ford the river", "the wagon's loaded", counts every mile
- start: (silent)
- commit: "Wagon's loaded: one row written, the page shows it."
- refusal: "Can't ford this one. Here's what stopped the wagon."
- ping: "Fork in the trail: which card, A or B?"
- wrap: "Camp made. The trail's up to date."
Shape and rules: `<design>/voice-card.md` (`<design>` is the folder of the wolfpack `design` plugin, which ships the card).

The roadmap page is a private claude.ai artifact (since 2.14.6.2 a data page). **Name it by its id from memory `project_roadmap.md`, or by `pages.roadmap` in `.claude/kit.json` when a private repo fills it**; in a session without either, ask Alexander. A public repo leaves `pages.roadmap` empty: the roadmap link is never in a public repo (the deck and team map links may be). And **private projects never go on the page** (they live on the `/war-room`, never on the roadmap page).

The page's shape is `page.html` beside this file (no content in it). Everything you read on the page lives in the artifact's `db` as rows. Alexander and Anton (Editors) change a card's status right on the page; only the owner and Editors can write (`write: "admin"`).

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

## A full republish: only for the page's shape
When `page.html` itself changes (layout, CSS, a new field the page must draw, the access rules): read the current version with the Artifact tool in full (the publish tool refuses an unread version), then `publish` with the **same `url`**, `file_path: ${CLAUDE_PLUGIN_ROOT}/skills/the-trail/page.html`, a short `label`, and `capabilities` **left out** so the access rules stay (only a rule change sends them again: `{db: {rules: [{path: "", read: "view", write: "admin"}]}, user: {}}`). Publishing without `url` creates a second page, so never do that. Republishing leaves the rows alone. Commit `page.html` in the same release, in both copies: the project's `.claude/skills/the-trail/page.html` and the kit's differ only in `<title>` and the eyebrow (the project's name against the kit's plain "Roadmap"), on purpose; every other change goes into both.

## Style
Plain words for the whole group, not code talk. A release note says what the members (`project.noun` in `.claude/kit.json`) get, then one line on how. Dates as "26 Sep".
