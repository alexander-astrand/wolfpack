# V<version>: <theme>

The shape every release plan keeps (Burrow V1.12 retro, 5 Nov 2026). `/inception`'s planner writes it, `plan-check.mjs` checks the marked sections, `compose-order.mjs` reads `## Plan rules`. Copy the headings; drop the `<...>` lines.

## His words
Quote marks hold only what Alexander typed, each with its date and source (norms.md, "Quote marks"). A planner's or a designer's list goes under its own name, never in quotes as his.
- "<his words>" (<date>, <where: chat, notes file, superlab>)
- Planner's list (`admiral-ackbar`, <date>, from <source>): <the list, no quote marks>

## Intents and first taps
One line per intent: its number, the tap a person makes to start using it, and where that tap lives in the current code (`file:line`), or the step that builds it. `plan-check.mjs` item 14 refuses an intent with no first tap. QA does each tap by hand; a step box is ticked only after its first tap works.
- I1 · <intent> · first tap: <"Aa, Table, a 3 × 3 grid appears"> · <components/x.tsx:70> | built by <step id>

## Desktop pages
Every page the release touches at 1024 and up, in each mode the project has (Burrow: Calm and Full), and who looks at each. `plan-check.mjs` item 15 refuses a plan without the line; a release with no screen writes `Desktop pages: none (<why>)`.
Desktop pages: <page> Calm and Full (magnus-wislander, his look) · <page> Full only (<why>)

## Plan rules
Every rule the plan makes about a surface (a layout, a row, a word), with the surface it holds on and how it's checked. `compose-order.mjs` copies each rule into every order whose step touches its surface; `plan-check.mjs` item 18 refuses a rule with no check.
- <"Never a second row above the bar"> · surface: <food, bottom-bar.tsx> · check: <a 375 shot beside main | grep -c 'shop-row' = 0>

## Split
Required when Expected is about 400M or more (`plan-check.mjs` item 17): the split the planner offered, where it cuts (design system, then his look, then the page redo), and why it is or isn't recommended.
Split: <offered: V<a> design system and his look, V<b> the page redo; recommended because ...>

## Taste calls
Every taste call and who made it. One taken in away mode is named again at the top of the go message and waits for his tick (`ill-be-back`).
- <the call> · <his pick, date> | <recommended default, taken away, waits for his tick>

## Not drawn, so not built
Each scope sentence of his that no drawing answers, word for word (`superlab`, step 2).
- "<his sentence>" · not drawn, so not built · <where it went: roadmap, next release>

## Steps
| Step | What | Found (file:line) | Agent | Model | Lane | Budget | Check | Intent |
|---|---|---|---|---|---|---|---|---|
| <id> | <what> | <lib/x.ts:34> | <agent> | <model, reason if above route> | <lane> | <N>M | <first tap, verdict, test> | <I1> |

Rates: <n> commits × <rate>M (<source>), navigator <steps> × 2.2M, after-draft <ratio> × draft, deploy <n>M
Expected: ≈ <N>M

## Not in this release
- <item> → <where> (agreed <when>)
