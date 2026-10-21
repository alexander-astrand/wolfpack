# The Dude's taste: the general rules

Alexander's design taste that holds for any app he builds: buttons, colour and contrast, scrolling, maps, menus, wording, feedback. Each project's own `.claude/taste.md` keeps the rules that name its pages, kinds and components; **readers read both, by section** (the headings match). Every rule names the page and the release whose work he sent back, with his words in quotes where he wrote them; most sources are Hutzup's, where these rules were learned.

**Who reads it, and when:**
- `mosbius-designs`, before drawing: an option that breaks a rule here isn't an option.
- Builders, before building a page or component: check the areas it touches.
- `bengt-johansson` and the Bengan Boys, before passing anything: a pass means "Alexander wouldn't send this back", not "it matches the spec". A spec answer isn't a taste check (the 2.12 "two panes" answer, built exactly, came back).
- `kissochbajslowski`, the reviewer: a diff that repeats a sendback below is a must.

The worst sendback is a repeat. "Please be better at self learning here, it's an identical situation" (shelf, 2.10). When one page has solved something (the event page's scrolling, the polls row's drag), every later page copies that solution.

`future-ted` adds each new sendback at the wrap-up: the rule, then (page, release: what was sent back). No entry without a source. A rule that would hold in any app goes here (a kit edit, made in a worktree off the kit's `main` and merged by PR); one that names the project's page, kind or component goes in the project's file.

## Scrolling and columns
- One scrollbar per page. A two-column page scrolls like the event page: the main column moves with the page, the side column is sticky and scrolls on its own with no visible bar. (Profile, 2.12.1: two visible scrollbars; "Scrolls showing on both columns should be obvious not to do, should have learned from event page"; "The Profile page should NEVER pass through in its current state")
- His first words and his later answer both count. (Profile, 2.12: "Separate the columns for scrolling", answered as two panes, came back in 2.12.1 as "stack the left column till max screen size and then have scroll only without bar on right column")
- Two-column pages are two stacks, one per column, never one grid whose rows stretch. (Profile, 2.11: "Columns warped on profile page")
- A sticky side column never scrolls over the box above it. (Dahan page, 2.13.2: "Scroll bug for the right column with right now at the top on dahan page, it's schools over the top box when scrolling up")
- Sideways rows drag with a mouse (`ScrollRow`), and the grab works anywhere, cards included. (Shelf, 2.10: "No pull and drag on the side scroll on the shelf, did we not learn to include this from the polls on front page?"; polls row, 2.8.2: dragged only between cards)
- A settings page scrolls as one page: no column scrolls on its own; a rail or preview stays put only while it fits the screen (the event page's sticky side is for content pages, not settings). (Your profile and Group settings, 3.3.2 part 5, 9 Oct 2026: "Can we also remove the dual scrolling columns, it's just confusing, both here and on group settings")
- A sideways row shows each picture whole: covers in a `ScrollRow` are never cut at the row's top, bottom or ends. (Shelf on the profile page, 3.3 morning look, 9 Oct 2026: "Images cut off when side scrolling on the shelf on profile looks weird")
- Each jump marker (a scroll dot or square) lands somewhere of its own; markers that would land on the same spot merge into one. (Side squares, portfolio 0.3: "The bottom two dots on the side scroller are both the bottom of the page.")

## Maps and embedded widgets
- A map never catches the page's scroll: no wheel zoom and no one-finger pan until it's tapped; zoom by its buttons. (Profile and event page, 2.12: "When scrolling it gets stuck on the map and zoom outs, very annoying")
- Menus and date pickers float above sheets and modals, never stretch them. (Plan a purchase, 2.11: "has the dropdown calendar extend the modal, should have been learned that it shouldn't do that, needs to be on top of the modal")
- Every date field is our `DatePicker`, and it opens on screen. (Events filter, 2.14 wrap-up: "not our own custom calendar. The bottom one also drops down below the screen")
- An icon inside a field gets room of its own. (Plan a purchase, 2.11: "calendar icon is squished next to select a date in the placeholder")
- Placing a pin never asks anyone for coordinates. (Places, 2.11: "moving it requires setting your own coordinates which nobody really knows")

## Layout and balance
- Two columns are balanced by height, not by number of cards. (Profile, 2.12: "the right side having way more boxes than the left")
- Sections fold, on phones and on desktop, and stay folded when you come back. (Event page talk, 2.8.3: "Foldable fields ... on both desktop and mobile"; game page, 2.9: "make all the parts foldable"; profile settings, 2.11: "foldable on mobile, like the event page"; profile, 2.12: "add the fold icons on desktop too")
- No bare corners: space beside a poster or header carries something useful. (Movie page, 2.9: "Top part next to movie posters on movie page is very bare now ... just make it look better")
- A single centred poster reads sparse on desktop: from lg it splits into two columns, never a narrow column on a wide backdrop. (Public page, /memento 3.0: picked two columns over a bigger poster)
- No stretched-out desktop pages. (Movies page, 2.9: "could use a less stretched out design on desktop")
- A ranked list doesn't split into two parallel columns on wide. (A list page, `/memento 2.14.2`: "List parallel to each other is weird, need better design on wide.")
- Boxes of different heights stack without holes: stacks balanced by height, not a grid row. (Lists overview, 2.14 wrap-up: "Board games list box … not as high as other boxes, creates stacking issues")
- A settings page on desktop isn't one long column: its sections sit side by side or beside a section nav. (Group settings, 2.14 wrap-up: "group settings is now a long column, better design for larger screens on that one too")
- A box on desktop isn't mostly empty. (Watchlists' sync row, 2.14 wrap-up: "alot of unused space on desktop")
- Images fit their box, at 375 too. (Game page, 2.9: "Have all images of games fit their box"; Books page, 2.13.1: "massive image bug on mobile, where the cover image is super long to the left")
- A card's art keeps its shape: never a narrow strip cut from a cover or poster. (Events board, 2.14 wrap-up: "squished and just showing a narrow version of the game/movie images")
- Charts and tables are "tied to stats that matter", and fun too. (Stats pages, 2.10)
- A crowded row keeps what it holds on that row: no new rows for text or a button. (Events top, 2.8.1 pick)
- A start page is a classic page, not a card in the middle of the art. (Start page, 2.14 S1: "a bigger redesign with no box in the middle, more a classic start page look")
- A notice row on a card shows at most two items, the soonest to close first, then a link to the rest. (Hut's sign, 2.14 S2, Alexander: "max two rows of open polls though, the once that closes in shortest time and then the link to all polls to not make it crowded")
- A cover and a date tile on one row share the top line and the height. (Event page heading, 3.1.1 draft, 8 Oct 2026: "This looks weird with image and date tag on different levels.")
- A boxed line has as much air under its last line as above its first. (The Hut's pinned line, 3.1.1 build, 8 Oct 2026: "Also the pinned message at the top there needs more padding on the bottom")
- A list's single column sits centred at every width. (List page, 2.14.5: "Center the list column always")
- Nothing added just to fill a space. (Footer, 2.12: "Just a fairly pointless footer was added in this release")
- A part grows with the screen, it never stretches: from 1440 up, covers, tiles, type and faces step up at c3 and c4; one top 10 list at 1920 is a bigger list, not a wider box. (Every page, /superlab 3.1.1, 8 Oct 2026: "to keep the structure and not making it drawn out we need the different part to scale when the screen gets bigger … Images, text etc needs to just become bigger than across the board to make it look better and not drawn out.")
- At wide widths a page fills its width and its columns: never squished to one side, never a column left empty in the middle. (Chip in's Together page and a book night's event page, 3.3 morning look, 9 Oct 2026: "Together page on chip in has becomes squished to the left in wide mode now"; "What's going on a book event page in wide mode? Split columns with one lacking in the middle")
- A page with no side column never leaves half the grid empty: a one-card page centres, a two-card page puts them side by side. (An admin's Group settings at 1440, /superlab 3.3.2 wide-admin, 9 Oct 2026: found at the before-shots; the shape he sent back that morning on Chip in's Together page)

## Placement of actions
- Every way in stays reachable on every width: if phones get a menu row, desktop gets a place too, and a one-item switcher still opens its menu (Create a group / Join with a code). (Switcher, /memento 3.0 TASTE WAIT 1)
- A notice people must see gets a place where they'll see it. (Auto-cancel warning, 2.12: "Make the cancelled automatically text clearer within 24 hours, so people see it. Would like a better placement to begin with")
- A feature switched off takes its nav item, page and links with it. (Buying together, 2.11: "the page and nav item needs to be removed")
- A control says what it does and shows that it did it. (Dahan page, 2.10: "What does the only me/group toggle do on every section ... Very unclear. Also no confirmation or anything when clicked")
- A setting goes where settings live (the profile), not on every section. (Dahan page, 2.10: the per-section toggle; CLAUDE.md)
- An undo sits in the status line it undoes, never alone on a line of its own. (Book night at 375, 2.13.1 pick at `/memento`: "✓ Finished · Loved it · undo")
- A settings form saves from a bar that appears at the bottom only when there is something to save, and sits above the phone nav. No Save button at rest. (Group settings, 2.13.8's K12, picked at `/memento` 2 Oct over a labelled-groups option and as built: "I like the sticky save bar at the bottom that appear when you have something to save. Just keep it above mobile nav." Built in 2.14.)
- Share on a desktop opens our own menu of chat apps (WhatsApp, Telegram, Email, Copy message); phones keep the native share sheet. (Share, 3.0.5, on macOS's sheet: "Where is what's app, telegram? There are a bunch of weird apps here that are not messaging app. Also no pointer and the menu is pretty ugly.")

## Titles and notes
- A section title shares its row only with a count. A note goes under the title. (Dahan and stats pages, 2.10: "Every title ... has weird text next to it that truncates on both mobile and desktop")
- Names show in full; badges never truncate them. (Dahans list, 2.8.2: "You"/"Owner" badges truncated the name)
- A page title sized for a name fits its space: it steps down in size to stay on one row on a phone, to a floor, and still shows the name in full. (Hut title, 2.13.5.3, at `/memento` 2 Oct: "I think the group name's size should be based on how much space there is. It wraps to two rows no on mobile, not a big fan of that")

## Buttons
- One look per button type on every page: a tab, a primary, a secondary, a chip and a text button each look the same wherever they appear. Not every button looks alike, but every button of one type does. (Books, Games and Movies pages and the video game modal, 2.13.1–2.13.2: "We need much better conformity with buttons in general"; "all doesn't have to look the same but the same typ ones should all be consistent across pages")
- Every button shows the pointer, and a selected tab doesn't react to hover. (Book page, 2.13.1: "Not pointer on the buttons on the book page, come on? Did all the reviews miss that"; tabs: "Hover on selected tabs shouldn't happen")
- The back link is one boxed text button everywhere: card fill with a hairline, fill on hover, no underline. (Back links, 2.14 S2, Alexander: "If we keep the one with box we should have background color hover on it as other buttons have adn remove underscore"; 2.13.8 had boxed it only over art, which he read as a trial.)
- No button shape of its own on one page. (Book page, 2.13.1: "why are the book page buttons rounded like no other buttons? Makes no sense")
- Secondary buttons stand out from the card: a slightly raised fill and a soft shadow, in both themes. (All pages, 2.13.5 note: "A little bit of box shadow on the secondary buttons at least? Right now then don't really stand out at all. Maybe just slightly different color too from the background"; option 3 at `/memento`)
- The primary button carries the same soft shadow as the secondary, in both themes: one family of buttons. (All pages, chain 2.13.5.1 note: "Might consider box shadow on the main buttons too"; option B at `/memento` 2 Oct, over an amber glow)
- A status is a mark, never a toggle: "You're in" doesn't take you out when tapped; the way out is its own button ("Not this time"). (Chip in, 3.1.1 draft, 8 Oct 2026: "why is your'e in clickable and then your'e not in when clicking it? The point of not this time is to abort")
- A control that sits on the page background, outside a card, is opaque: the background art never shows through it. (Libraries shelf pills, 2.13.5.3: "Background of tabs in library can't be see through")
- A secondary action on a card is compact on desktop; it never matches the card's main action in size. (Event cards, 2.13.5.2: "Make I'm out button smaller on the event cards on desktop")
- One red button per state: a live night shows Cancel event; Delete appears only once the night is cancelled or past. (Event page, 2.13.5.2: "Why does an event have both cancel event and delete now?"; picked at `/memento` 2 Oct)
- Hover belongs to buttons and unselected tabs, nothing else: no hover on a card, a title or a hero. (Hut hero, 2.13.4: "Hover should only be on buttons and unselected tabs, nothing else")
- An action that opens a form opens it in a modal, like the rest of the app. (Log a cost, 2.13.x: "Why is log a cost not a modal popup? Goes against the design of the rest of the app")
- Text over a picture reads on every picture: it gets a scrim of its own. (Hut hero, 2.13.4: "Next board game night on hut hard to read depending on the background")

## Colour and themes
- A floating panel stands out from what's under it: a raised surface, a crisp border and a real shadow, in every theme. (The games popover in Amber and Light, 3.3.2 part 5, 9 Oct 2026: "Dropdowns need to stand out more from teh background")
- Disabled buttons use the disabled tokens, never a faded brand colour. (All buttons, 2.9: "Disabled button is yellow with white text, no like at all ... yellow is not good for disabled either")
- No white text on yellow; badges use the accent-soft pair. (Dahans list, 2.8.2: "yellow with white text is hard to read")
- A panel behind text on art is warm in light too, never bright white. (Start page, 2.14 wrap-up: "The white behind the text … on the start page light mode is very white and disturbing … Works much better in dark mode")
- A backdrop must be visible in light theme too: contrast comes from a panel behind each text block, never a full-page scrim that hides the art. (Group backdrops, 3.0.2 → /memento 3.0: "The new lightmode backdrops are non existent, can't see them")

## Icons and drawn things
- Covers show whole, never cropped or blown up behind a title: a book or poster stands as a tile beside the words. (No Dahan's Hut card, 3.3.2 part 5, 9 Oct 2026: The Intelligent Investor running into the title, "looks terrible"; Lonesome Dove's tile beside the title, good)
- Drawn marks are colourful and read as what they are at real size. (Jedi icons, 2.11: "I want them cooler with more color, can't really see what they are besides yoda")
- Our own drawn icons over emoji and stock pictures. (Jedi ranks, 2.10.2: "Custom icons for the Jedi levels would be cooler, yoda at grandmaster"; hut logo, 2.12: "we should probably design our own hut logo")
- A figure shown big is drawn for that size, not a small icon scaled up. (404 page, 2.14 wrap-up, the set's `hand` at 48px: "The hand emoji on the 404 Star Wars page is very ugly, remake") Picked: B, the mind trick (fingers together, thumb out, three lit rays), over `mosbius-designs`' A, the open palm, that 2.14.3 shipped (`/memento` 4 Oct: "Changed my mind and liked b hand instead."). A drawn thing handed to one designer still gets its options shown to him afterwards: he changed his mind on seeing them at real size.
- Faces are faces, props are big enough to see. (Jedi icons, 2.12: "looks weird with a black hole as his face"; "Bigger saber for the grandmaster, he has tiny one now")
- Drawn smoke moves: it keeps rising and drifting; a still plume reads as stale. (Light hearth, 3.1.1 draft, 8 Oct 2026: "The smoke needs to be moving in light mode, it can't just be stale, that looks weird")
- A logo draws on whole pixels: its boxes, padding and radius rounded, or the edges blur. (Wordmark, 3.0.5: 109x25.25 boxes, fixed in e8ceabb; his human step "the logo's sharpness on your screen"; repeated in portfolio 0.3's cube marks at 18.9px, a review must)
- A link to a known service (GitHub, LinkedIn) shows that service's logo, with its name kept for screen readers. (Hero, footer and about, portfolio 0.3: "I also want linkedin and github to be logos")
- Taste picks are his: show options before building. (Jedi icons, 2.12: his hybrid of three options, not the designer's pick, the third time)

## Wording
- The group's name or slogan never stands as the product's line on a product page. (Start page, 2.14 S1: "no No Dahan, No Party left as in the designs now")
- A title names everything its rows hold. (Book page, 2.13.1 pick at `/memento`: "Readers · 2 finished", not "Who's read it" over rows that say "Wants to read it")
- One number gets one phrase everywhere. (Pages a day, 2.13.1 pick at `/memento`: "to make it" on Smart pick and the night page)
- After Next week, what's left of the current month reads "Rest of <month>"; later months keep their name. (Events board, 3.1.1 build, 8 Oct 2026: "SInce we have this week and next week, we might do "rest of now" for the rest of the same month, so rest of october on this one.")
- A figure says its unit beside it ("38M tokens planned", never a bare "38M planned"). (Write-up numbers row, portfolio 0.2: "The numbers are also a bit confusing, unclear that we are talking about tokens...")
- Text for outside readers names roles and models ("an agent on Opus at medium effort"), never the team's own nicknames. (Write-up, portfolio 0.2: "We should probably take out our agent names from the write up too, otherwise it's confusing for others. Just say agent on opus medium etc insteas")
- A voice line may bend a movie quote past three words when it's a parody, not the quote: maverick's (the navigator's name until kit 1.5) "I feel the need. The need for a smaller diff." and captain-call's "I won't tolerate rudeness in a diff." stay. (Voice cards, 2.14.6.1, pick at `/memento`: "Keep both as is", over the trims)

## Feedback and confirmations
- Every action that changes something shows a pop-up. (Event page, 2.8.3: "Cancelling my spot or dealing me in should trigger toastify, as well as all other functions like that!")
- Pop-ups in the app's own style, the toastify way. (Toasts, 2.8.2: "why not react-toastify ... it looks better")
- Deleting and big decisions ask "are you sure" in a modal, and so does cancelling a spot. (Polls, 2.9: "Go over to make sure all deletions and big decisions ask a follow up are you sure in a modal"; event page, 2.8.3)

## Phones
- Phones first; checked at 375 and 1024, 1440 for layout work. (CLAUDE.md)
