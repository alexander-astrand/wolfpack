# What a Supabase project using this pack carries

The database plugin assumes a project laid out like this. The guard reads the project's values from `.claude/kit.json`; everything else is a convention the agents (`the-playbook`, `ranjit`) and the skill (`bro-code`) follow.

## `.claude/kit.json`

- `refs.dev`: the dev Supabase project's ref. The only project anyone may reach freely; the CLI stays linked to it.
- `refs.prod`: the production ref. Only the deployer reaches it.
- `deployer`: the deployer agent's name (`ranjit`; as a plugin agent it also arrives as `database:ranjit`).
- `keychain.dev`, `keychain.prod`: the Keychain items holding the dev and production database URLs, read only by `scripts/prod-db.sh`.
- `urls.prod`: production's web address, the one origin the deployer's signed-out smoke check may read.

A missing file or key fails closed: no ref counts as dev, nobody is the deployer, and every database or Supabase call is treated as production. `kit.json` is in the guard's frozen set: an agent that could edit `refs.dev` could make production look like dev, so a change to it asks a person.

## Migrations

- Numbered files in `supabase/migrations/` (`0001_…sql`, `0002_…sql`).
- Never edit a merged migration; write a new one. An unmerged one may be edited in place.
- After a migration, regenerate the database types and commit them.

## SQL tests

- `supabase/tests/*.sql`: fixture users and groups in one transaction that always rolls back and prints PASS or FAIL (`bro-code`).
- Run all of them after any database change, on dev and from scratch in CI (a fresh database with every migration replayed).

## Functions and grants

- A new database function starts closed: grant `execute` explicitly, and name it in a grants test (`supabase/tests/function_grants.sql`).
- Anything beyond a row-level policy is a `security definer` function that checks the caller's role.

## Edge Functions

- Act as the caller (a shared helper builds the client from the caller's token), never as the service role on a user's behalf.
- Redeploy to dev after a change, and list each one under the release's production steps.

## Production

- Production is reached only through the deployer (`ranjit`), started by a person; the guard refuses every other path and asks a person before each change.
- Back up before any production database change: step 1 of a database release's production steps is `scripts/prod-db.sh backup <version>`. If the backup fails, stop. Storage uploads aren't in a dump.
- The production database's only write path is `scripts/prod-db.sh` (push, repair, setting); Edge Functions go out with `supabase functions deploy`.
