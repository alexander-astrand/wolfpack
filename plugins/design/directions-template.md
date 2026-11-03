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

<!-- heisenberg fills this section in kit 1.9 step C3: the kit's eight starter directions, in the entry format above, each with a one-line "Why it fits his picks". Until then the deal falls back on the worked example above. -->
- Placeholder: the eight starter directions land here (kit 1.9, C3).
