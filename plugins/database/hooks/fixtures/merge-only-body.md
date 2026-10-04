<!-- One PR per release. The reviewer reviews. -->

A frontend-only release: the event page's map hint moves off the pin.

## What changed

1. The map hint sits under the pin.

## How it was tested on dev

- SQL tests (`supabase/tests/`): not touched
- Browser, 375 / 1024 / 1440px, light and dark: checked

## Production steps

`/skinny-pete 9.9.9` follows these; each step is one exact command or a marked human step.

### How to run this deploy on full auto
1. Mark this PR ready for review (your call).
2. Type `/cattle-drive 9.9.9`.
4. One tap: approve `scripts/full-auto.sh arm 9.9.9`; its list must be `gh pr ready 46` and `gh pr merge 46 --squash --admin`.

### Before merge
<!-- Whenever the database changes (migrations, or SQL run by hand), step 1 is the backup. -->
None.

### After merge
<!-- Vercel ships the frontend when this merges. -->
- None

### Human steps before the deploy can finish
<!-- Secrets, anything a person types, dashboard settings the release needs. -->
- [ ] None.

### Human steps afterwards
- Look at the map on a phone.

## Notes for review

- Nothing on production but the merge.
