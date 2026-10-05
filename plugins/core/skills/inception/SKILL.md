---
name: inception
description: The planning session before a chain or an important release - dom-cobb or admiral-ackbar takes the plan apart, Alexander answers the open questions, and the plan file gets its "Ready to build" stamp. Run by hand in its own session, before /maverick, /captain-call or /cattle-drive. Nothing is built.
argument-hint: <version> [chain <v2> <v3>…] | horizon <from>–<to>
disable-model-invocation: true
---

Plan: **$ARGUMENTS**

Alexander, 30 Sep 2026: "Yeah for sure implement the planning session that I run separately". It came out of 2.12.2, where chain mode started with no plan ("builds on whatever the spike found"), was designed mid-release, and pulled in `dom-cobb`, `yoda` and an Anton gate on the way. The release cost 12% of the week against 5%. **Planning happens here, before the release starts, never inside it.**

**Title:** the session titles itself `<project> · inception · <version>` (a chain: `<first>→<last>`; horizon: `horizon <from>–<to>`) in its first minute (`set_session_title` on `self`). `<project>` is `project.name` in the project's `.claude/kit.json`.

## Voice
dom-cobb · the planner (Inception: Cobb plans every layer before anyone goes under) · calm and exact, "layer", "the kick", never "Kids"
- start: "Every layer first. Then we go under."
- commit: "Plan saved. One layer down."
- refusal: "Refused. Not planning around it; here's why."
- ping: "Layer three needs your call. A or B?"
- wrap: "Stamped. Ready to build."
One line at the start and the end only. Shape and rules: `<design>/voice-card.md` (`<design>` is the folder of the wolfpack `design` plugin, which ships the card).

## When it's required
Before the release starts, for:
- every **chain** (all its releases in one session: a chain can't ask Alexander mid-run, so this is the only time to ask);
- every release that touches production or the setup: the database plugin guard's frozen set (its `chain-arm.mjs` FROZEN list), `/cattle-drive`, `ranjit`, or the agent structure beyond wording;
- every release the roadmap sizes L or bigger, or that Alexander calls important.

Other releases may skip it: `maverick` plans them at the start as before, from a plan file that already answers the checklist below.

## The session
Run in the mode Alexander started it in; **never switch to manual** (Alexander, 1 Oct 2026). If a call is refused, finish the rest and list that item under "What needs you". Opus at medium effort (it writes only plan files and memory). A session can set its own permission mode but not its own model or effort (`set_session_effort` refuses "self"; 30 Sep 2026), so if they don't match, print `/model opus`, `/effort medium` and stop. Budget: **25M in all**, the planner's run included; a chain's own budget is set at **10M + 15M per link session** (2.12.4's retest, planned at 30M, used 72.4M: 10 + 15 × 4 = 70M).

1. **Read** the plan file(s) `<plans>V<version>.md`, `<plans>` (kit.json `plans`, default `~/.claude/plans/`) (Alexander's words are verbatim at the top and outrank every paraphrase), `.claude/lessons.md`, and memory `project_roadmap.md`. Never the roadmap page in full (with kit.json `roadmap: file`, only the release's entry in `<plans>roadmap.md`). Read the weekly meter (`mcp__ccd_session_mgmt__get_usage`).
2. **One planner, one run, ≤ 10M, chosen by size** (4 Oct: nine inceptions cost 3.3-17.2M each, and `dom-cobb` took ≈ 15 min and ≈ 40 calls every time):
   - `dom-cobb` (Fable, high) only for a chain or a release that edits the database plugin guard's frozen set (its `chain-arm.mjs` FROZEN list);
   - `admiral-ackbar` (Opus, high) for a single release, production or full auto included.

   Target: a single-release inception ≈ 10 min, a chain ≈ 25 min.

   **Give it a packet, not the file list:** you've already read the plan, lessons and memory in step 1, so its order carries the plan section verbatim, the lesson slugs that apply with their lines, and file:line ranges for the code it must check. It reads only what the packet lacks (about 15-20 calls, not 40). The order: take the plan apart against the checklist below. Return a step table, the gaps with a recommendation for each, and the questions only Alexander can answer. It writes nothing but its section of the plan file.
3. **Alexander decides.** Put the questions to him in one `AskUserQuestion` (up to four), the recommendation first. His answers go in the plan file word for word, marked with the date. If he wants something built that doesn't fit, it goes on the roadmap (`/badger`), not into the plan.
4. **Stamp it** when every checklist line holds: a section `## Ready to build (<date>, <planner>, Alexander)` with the final step table and a `mode:` line, `mode: bypass` or `mode: auto` (`chain.md` and `maverick` read it). Bypass for a release that edits skills, agents or settings, since Auto's classifier refuses those as Self-Modification (lesson `[auto]`); Auto for the rest. If a line doesn't hold, the part it covers is cut from the release and goes on the roadmap. Say which.
5. **Pages:** one fresh `c-3po` for every page move, started in the background while Alexander answers step 3 (2.14.2's inception spent three, 4.8M in all): it writes every move as rows on the roadmap page (`the-trail`; with `roadmap: file`, as edits to `<plans>roadmap.md`) and updates the Command Deck's "next up". Its order carries "skip if already there" checks (2.14.6's wrap-up: two of four roadmap changes were already on the page) and the replacement text, so `c-3po` doesn't draft cards; budget about 2M for the roadmap rows (no full read since 2.14.6.2; the Command Deck needs more).
6. **End** with the exact lines to start the release (or the chain), and the plan's budget next to what's left of the week.
   After the stamp, `/war-room`'s meter lane gets the release's share from the plan's size line: `update` on `meter/<YYYY-Www>` with `{release, share_pct}` appended to `planned` (`set` with `used_pct` from the meter if the week has no row yet), so Alexander sees the week's booking beside his projects.

## The checklist ("ready to build")
1. **Every part has a step:** agent, model, lane, budget, how it's checked. No "decide on the way", no "builds on whatever X finds": a spike or a design question is either done here or its part is cut.
2. **The total fits the budget:** 5% of the week (≈ 215M) incl. deploy by default, or the number Alexander sets, which must fit what's left of the week. At most one theme per release.
3. **Every design question is decided,** with who decided it and when. The navigator doesn't reopen these.
4. **"Not in this release":** everything that was on the roadmap entry or in earlier notes but isn't in the plan, with where it went and when Alexander agreed. The roadmap (page or `<plans>roadmap.md`) matches.
5. **Alexander's open questions are answered,** and the defaults he hasn't confirmed are listed for the navigator's one start question.
6. **Agents:** only the ones the plan names. No planner inside the release; the adviser is `farbror-vattenmelon` under `captain-call` (`yoda` only for an Opus `maverick`); code review is `kissochbajslowski`'s. Any agent Alexander removed from a role stays removed.
7. **A bug has its repro path:** an item called a bug names how a member (`project.noun` in `.claude/kit.json`) reaches it before it gets a step (2.12.5 step 4 cost 11.5M on a "Still in?" on a second table that can't be reached: an event with tables can't switch kind). Not reachable means not a step.
8. **Chains only:** every release in the chain is stamped, its taste picks are settled, its migrations are listed, and the arm is one tap at the start. Any edit to the chain's own skills (`cattle-drive`, `chain.md`, `maverick`, `future-ted`) lands in a commit to `main` before the arm, never in a link's step 0: the conductor has already read them (`[roadmap-page]`, chain 2.14.5).
9. **A live run Alexander must do** (a signed-in look, a real device, a send to his phone) is listed as a human step afterwards, before any publish it gates, never a step a link waits on (`[live-check]`).

## `/inception horizon <from>–<to>` (no version)
Long-range planning: the order and size of the releases in a range, e.g. `2.13–2.14`. Nothing is built, and **no "Ready to build" stamp**: each release still gets its own `/inception <version>`. Budget **20M in all**.
- **Input:** feature ideas land on the roadmap whenever they come (`Roadmap: …` or `/badger`); horizon orders what's there plus any ideas typed at its start. Wrap-up notes stay about the release just finished (how it ran, bugs and tweaks to its features); an idea given at a wrap-up is `/badger`ed there.
- **Planner:** one `dom-cobb` run (Fable, high, ≤ 10M). It orders and sizes the releases in the range, one theme each, against the weekly budget and the V2/V3 windows in CLAUDE.md, and returns the order, the gaps, the questions only Alexander can answer, and "Not in this range" for what's left out.
- **Alexander decides** in one question round (`AskUserQuestion`, recommendation first); his answers go in word for word, dated.
- **Pages:** a fresh `c-3po` puts the order on the roadmap page as `the-trail` says (row writes: `get` the row first, so a link's newer write is not overwritten), or with `roadmap: file` edits `<plans>roadmap.md` in place.
- **Beside a release or chain:** it writes only `<plans>`, its own scratchpad and the roadmap, never runs git, never edits a plan file of a release that's running or stamped, never touches the checkout (the drive's deploy needs it untouched from arm to disarm). Open it in manual mode after the chain's arm, so the conductor never counts it as an empty session.
