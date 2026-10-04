# The Dude's taste

**Each project keeps its own `.claude/taste.md`, started from this template.** Copy it there and grow it: the plugin's agents and skills read the project's file, never this one. The rules below held in the project this kit came from and hold for most apps; keep them, drop what doesn't fit, and add your own sendbacks under the headings.

Alexander's design taste. Every rule names the page and the release whose work he sent back, with his words in quotes where he wrote them. CLAUDE.md's conventions are the short form; this file is the why, so a new page gets it right the first time.

**Who reads it, and when:**
- `mosbius-designs`, before drawing: an option that breaks a rule here isn't an option.
- Builders, before building a page or component: check the areas it touches.
- `bengt-johansson` and the Bengan Boys, before passing anything: a pass means "Alexander wouldn't send this back", not "it matches the spec". A spec answer isn't a taste check.
- `kissochbajslowski`, the reviewer: a diff that repeats a sendback below is a must.

The worst sendback is a repeat. When one page has solved something (a page's scrolling, a row's drag), every later page copies that solution.

`future-ted` adds each new sendback at the wrap-up, in this format, under its heading. No entry without a source:

```
- <the rule>. (<page>, <release>: "<his words>")
```

## Scrolling and columns
- One scrollbar per page. A two-column page scrolls as one: the main column moves with the page, the side column is sticky and scrolls on its own with no visible bar.
- His first words and his later answer both count.
- Two-column pages are two stacks, one per column, never one grid whose rows stretch.
- A sticky side column never scrolls over the box above it.
- Sideways rows drag with a mouse, and the grab works anywhere, cards included.

## Maps and embedded widgets
- A map never catches the page's scroll: no wheel zoom and no one-finger pan until it's tapped; zoom by its buttons.
- Menus and date pickers float above sheets and modals, never stretch them.
- Every date field is the app's own date picker, and it opens on screen.
- An icon inside a field gets room of its own.
- Placing a pin never asks anyone for coordinates.

## Layout and balance
- Two columns are balanced by height, not by number of cards.
- Sections fold, on phones and on desktop, and stay folded when you come back.
- No bare corners: space beside a poster or header carries something useful.
- No stretched-out desktop pages.
- Desktop width goes to content: more items per row, not wider margins or longer title bars.
- At the widest width a page shows more columns side by side, no drawn-out rows or sections.
- A ranked list doesn't split into two parallel columns on wide.
- A face and name never hang to one side because a mark is missing.
- Boxes of different heights stack without holes: stacks balanced by height, not a grid row.
- A settings page on desktop isn't one long column: its sections sit side by side or beside a section nav.
- A box on desktop isn't mostly empty.
- Images fit their box, at 375 too.
- A card's art keeps its shape: never a narrow strip cut from a cover or poster.
- A stat is drawn for the kind of thing it measures.
- Charts and tables are tied to stats that matter, and fun too.
- A crowded row keeps what it holds on that row: no new rows for text or a button.
- A card stays lean; details live on the detail page.
- A start page is a classic page, not a card in the middle of the art.
- A notice row on a card shows at most two items, the soonest to close first, then a link to the rest.
- A list's single column sits centred at every width.
- Nothing added just to fill a space.

## Placement of actions
- Host and admin actions sit on the item's top card, never squeezed beside a credit line.
- A notice people must see gets a place where they'll see it.
- A feature switched off takes its nav item, page and links with it.
- A control says what it does and shows that it did it.
- A setting goes where settings live, not on every section.
- An undo sits in the status line it undoes, never alone on a line of its own.
- Links the app can find load by themselves; nobody pastes them.
- A settings form saves from a bar that appears at the bottom only when there is something to save, and sits above the phone nav. No Save button at rest.

## Titles and notes
- A section title shares its row only with a count. A note goes under the title.
- Names show in full; badges never truncate them.
- A page title sized for a name fits its space: it steps down in size to stay on one row on a phone, to a floor, and still shows the name in full.

## Buttons
- One look per button type on every page: a tab, a primary, a secondary, a chip and a text button each look the same wherever they appear.
- Every button shows the pointer, and a selected tab doesn't react to hover.
- The back link is one look everywhere.
- No button shape of its own on one page.
- Secondary buttons stand out from the card.
- One selected look per control type.
- A selected tab is plain to see in both themes.
- Marks that say who someone is (You, Owner) never look tappable, but a person's face or name opens that person.
- A control that sits on the page background, outside a card, is opaque: the background art never shows through it.
- A secondary action on a card is compact on desktop; it never matches the card's main action in size.
- One red button per state.
- Hover belongs to buttons and unselected tabs, nothing else: no hover on a card, a title or a hero.
- An action that opens a form opens it in a modal, like the rest of the app.
- Text over a picture reads on every picture: it gets a scrim of its own.

## Colour and themes
- Disabled buttons use the disabled tokens, never a faded brand colour.
- No white text on yellow.
- Both themes are checked; colours come from tokens.
- A panel behind text on art never glares bright white in light mode.

## Icons and drawn things
- Drawn marks are colourful and read as what they are at real size.
- Our own drawn icons over emoji and stock pictures.
- A figure shown big is drawn for that size, not a small icon scaled up.
- A drawn thing handed to one designer still gets its options shown afterwards: taste changes on seeing them at real size.
- Faces are faces, props are big enough to see.
- Kept as built against `heisenberg`'s lean: (each pick that overturned the lean goes here, with his words).
- Taste picks are his: show options before building.

## Wording
- The group's name or slogan never stands as the product's line on a product page.
- A title names everything its rows hold.
- One number gets one phrase everywhere.
- Plain and specific wording. (CLAUDE.md)

## Feedback and confirmations
- Every action that changes something shows a pop-up.
- Pop-ups in the app's own style.
- Deleting and big decisions ask "are you sure" in a modal.

## Phones
- Phones first; checked at 375 and 1024, 1440 for layout work.
- On cards, text never wraps at 375: it shrinks.
- The first thing that matters is visible at 375 without scrolling.
