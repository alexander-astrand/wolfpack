# Design directions

**Each project keeps its own `.claude/directions.md`, started from this template.** It is the short list of directions a designer may be dealt: `deal.mjs` deals two for a layout and three for a drawn thing (a logo, an icon, an illustration), and `mosbius-designs` draws one option per dealt direction. The point (kit 1.9, from taste-skill's idea, our own words and list): a model asked for two options tends to give the category default twice, so a script picks the directions and the designer chooses how to draw them.

A project with no `directions.md` is dealt from the kit's starter list at the end of this file, and the deal says so. `heisenberg` writes a project's first list at its next `/superlab` or setup session, from the starter and the project's `taste.md`, and shows it to Alexander as one page before it is saved.

**How the deal weighs them:** a direction named in the `Pick` cell of `~/.claude/plans/design/library.md` is dealt more often, and more again when that row's `Score` says the lean won. A direction never picked still gets dealt: the weight only tilts the odds. The same set is never dealt twice in a row for one project (`~/.claude/plans/design/<project>/deals.log`; a deal older than 30 days is forgotten).

## The entry format

One `###` heading per direction, its name; then four lines. Keep the name short and unique: it is what the library's `Pick` cell names, so the weighting can find it.

```
### <Name>
- Feel: <the feel in one line>
- Type: <the type pairing: headings / body>
- Palette: <the palette lean: base, accent, light or dark first>
- Reference: <one app, site or object that has it>
```

## Worked example

### Field notebook
- Feel: a well-kept paper notebook: ruled calm, ink accents, nothing shouts.
- Type: a bookish serif for headings (Source Serif) / a plain grotesk for body (Inter)
- Palette: warm off-white paper, ink-blue accent, one rust for warnings; light first, dark as pencil on slate
- Reference: Field Notes memo books

## Starter directions

The kit's eight, written by `heisenberg` at kit 1.9 (C3) from his picks in `~/.claude/plans/design/library.md` and the rules in `taste.md`. Each `Why` names the pick it grew from, so a project's own list can keep or drop it on the record. The worked example above is a ninth in the deal pool; a project's list may keep it or cut it.

### Cabin lamp
- Feel: a board-game night seen from the road: dark wood, one lit window, the art on the wall and the words under it.
- Type: a round, friendly display (Fredoka) / a soft humanist sans (Nunito)
- Palette: walnut-dark base, amber accent kept for the primary and what is selected, parchment panels behind text in light; dark first
- Reference: hutzUp's Hut, the hearth on its start page
- Why: his 3.0 front door and the Hut's full-bleed art hero went 7-0 (1 and 6 Oct 2026); amber only on the primary and the selected tab was Set 1, his pick.

### Linen and falu
- Feel: a Swedish summer house on a bright day: washed linen, the red of the boards, the sea as the thing you tap.
- Type: a warm text serif with a real italic (Newsreader) / a plain rounded sans (Figtree)
- Palette: linen off-white base, falu red as the mark and one line, sea blue for links and taps, honey for what is good; light first, dark as night on the porch
- Reference: a Falu-red boathouse with white trim
- Why: "Falu & lin" over "Tjära & ockra" at Svärdsvik V0.1 (31 Oct 2026), the whole round 6-0 in this palette.

### Sunlit kitchen
- Feel: a kitchen at nine in the morning: cream walls, one yellow bowl, coral where something needs you, cheerful without noise.
- Type: a bookish serif with weight to spare (Literata) / a plain rounded sans (Figtree)
- Palette: cream base, sunlit yellow and coral as flat fills, warm brown-black ink; light first, dark as coral on ink
- Reference: enamel kitchenware, a yellow bowl on a cream shelf
- Why: his own split at Burrow V1.4 (30 Oct 2026), "Sunlit for light mode and coral and ink for dark mode", over the quieter plum I leaned to; "I want more nice and warm colors".

### Voxel garden
- Feel: a small world built from clean cubes: techy and calm, every shape three flat tones, nothing blurred.
- Type: a squared display face (Tektur) / a plain humanist sans (Nunito Sans)
- Palette: deep aubergine base, one violet accent as a flat fill (no gradient, no glow), mint and sand as the cubes' other two tones; dark first, light as the same cubes on chalk
- Reference: Monument Valley's isometric blocks
- Why: "the voxel garden" over the aurora and the build log at portfolio V0.3 (15 Oct 2026), 4-0: the direction that grew the identity he had, not the leap.

### Passbook
- Feel: a bank passbook you trust: one big number per card, every figure in its labelled column, the unit beside it.
- Type: a plain grotesk with tabular figures (IBM Plex Sans) / the same family's mono for numbers (IBM Plex Mono)
- Palette: warm grey paper base, ink text, one green for up and one rust for down, nothing else coloured; light first, dark as green ink on slate
- Reference: a Swiss railway timetable
- Why: his money shape holds across projects: Burrow's jars 14-0, "Tre staplar" over the ledger at Svärdsvik's kassan (31 Oct 2026), the strip's marks and numbers over the curve (V0.8).

### Almanac
- Feel: a page from an old almanac drawn fresh: one painted panel leads (a sun's arc, a moon, a season in weeks) and the facts sit under it in rows.
- Type: a sturdy grotesk (Archivo) / a soft humanist sans (Nunito Sans)
- Palette: dusk blue base in dark, apricot and straw as the painted light, sky bands stepped in flat tones; dark first, light as the same panel on cream
- Reference: Burrow's sky card with the sun's arc (the jackpot draw of 17 Oct 2026)
- Why: "I love the arc so let's do that! Exactly what I wanted"; when he says "creative freedom" a drawn panel wins over a line of text (Burrow V0.13, 17 Oct 2026).

### Game box
- Feel: a board-game lid on the table: big print with a shadow, the cover whole as a tile beside the words, a card per game.
- Type: a heavy print display (Lilita One) / a soft humanist sans (Nunito)
- Palette: cream card-stock base, one deep bottle green as the house colour, the covers bring the rest; light first, dark as the inside of the box
- Reference: the lid of Ark Nova or Spirit Island
- Why: covers as whole tiles beside the title was his good example on the Hut card (9 Oct 2026); the game box with a print shadow was his second in the wordmark round (6 Oct 2026). The bolder of the eight: deal it as the B.

### Control room
- Feel: a scoreboard for someone who runs the thing: dense on purpose, a rail of sections, the live preview beside the controls, every status a colour.
- Type: a narrow grotesk (Barlow Semi Condensed) / a mono for figures and times (JetBrains Mono)
- Palette: slate base, ice blue as the one accent, green, amber and red only as status; dark first, light as a grey workbench
- Reference: an arena scoreboard
- Why: "the control room" over the workshop for the admin panel from 1600 (9 Oct 2026, 2-0); in his own Full mode he takes the fuller option when it reads by shape (Burrow V0.10). For desktop, admin and stats pages; on the phone it folds to one column.
