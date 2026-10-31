# The Dude's taste

**This is the project's own `.claude/taste.md`, started from the kit's slim template (`design/taste-template.md`).** It holds only what is this project's: where it starts, and its own sendbacks. The general rules live once in the kit's `design/taste.md`, which every reader below reads beside this file, so they are never copied here (kit 1.8, council M11).

## Where this project starts

<!-- Filled from round one's picks; each line keeps the reason he gave, in his words. -->
- Theme: {{theme.pick}} (dark-first or light-first). Why: {{reason}}
- Density: {{density.pick}} (dense or roomy). Why: {{reason}}
- Copy: {{copy.pick}} (sober or playful). Why: {{reason}}

An app whose look you'd steal: {{look.steal}} · one you'd never: {{look.never}}

**Who reads it, and when** (always beside the kit's `design/taste.md`, by section):
- `mosbius-designs`, before drawing: an option that breaks a rule here isn't an option.
- Builders, before building a page or component: check the areas it touches.
- `bengt-johansson` and the Bengan Boys, before passing anything: a pass means "Alexander wouldn't send this back", not "it matches the spec". `tomas-svensson` starts from `taste-repeats.mjs <pages>`, which reads both files.
- `kissochbajslowski`, the reviewer: a diff that repeats a sendback below is a must.

The worst sendback is a repeat. When one page has solved something (a page's scrolling, a row's drag), every later page copies that solution.

## Sendbacks

`future-ted` adds each new sendback at the wrap-up, in this format, under a heading named as in the kit's `design/taste.md` (Scrolling and columns, Maps and embedded widgets, Layout and balance, Placement of actions, Titles and notes, Buttons, Colour and themes, Icons and drawn things, Wording, Feedback and confirmations, Phones), so a reader greps the same section in both files. No entry without a source. A rule that would hold in any app goes to the kit's file instead:

```
- <the rule>. Solved on: <page>. (<page sent back>, <release>: "<his words>")
```

**`Solved on: <page>` is the repeat index.** It names the page that already gets the pattern right; leave it out while no page does, and the first page to get it right adds it. A reader with a diff's page list greps `Solved on:` in the sections for those pages (or runs `taste-repeats.mjs`): a page that lacks the solved pattern is the likely repeat, checked first.

A pick that overturned `heisenberg`'s lean goes under its heading as `Kept as built: <what>. (<page>, <release>: "<his words>")`, one line each.
