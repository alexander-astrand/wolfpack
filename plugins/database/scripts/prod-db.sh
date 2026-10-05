#!/usr/bin/env bash
# Kit copy: values from .claude/kit.json (refs, keychain, backupRoot, urls.prod, pluginRoot)
#
# Production database access for /skinny-pete (the ranjit agent).
#
# The project's values come from <root>/.claude/kit.json, never from this
# file, so one copy serves every project:
#
#   refs.dev        dev's Supabase project ref        (required)
#   refs.prod       production's project ref          (required)
#   keychain.prod   the Keychain item holding prod's database URL (required)
#   keychain.dev    the same for dev, for a test run  (optional)
#   backupRoot      where backups go; a leading ~ is your home (required)
#
# A missing required key stops the script (exit 2): it never guesses a value.
#
# The connection string lives in the macOS Keychain, never in the repo or on
# a command line Claude writes. A human adds it once, in their own terminal:
#
#   security add-generic-password -a "$USER" -s <keychain.prod> -w
#
# (it prompts for the value: the session pooler URL from the dashboard's
# Connect dialog, port 5432, password percent-encoded). The guard hook lets
# only ranjit run this script, and asks a human before every run.
#
# For a test run on dev, store dev's URL under <keychain.dev> and prefix the
# command with PROD_DB_KEYCHAIN_ITEM=<keychain.dev>. The script refuses a URL
# that doesn't match the item's project.

set -euo pipefail
set +x

# The backup must be this fresh when migrations run.
BACKUP_MAX_AGE_MIN=120

usage() {
  cat <<'EOF'
Usage: scripts/prod-db.sh <command>

  migrations                 local vs production migration history (read-only)
  dry-run                    what `db push` would apply (read-only)
  backup <release>           roles, schema and data to <backupRoot>/<date>-V<release>/
  push <release> <v>...      apply migrations; needs a fresh backup for <release>
                             and a dry run that lists exactly <v>...
  repair <applied|reverted> <v>...
                             fix production's migration history
  query <file.sql>           run a SQL file in a read-only transaction
  setting <key> <value>      upsert one app_settings row (e.g. notify_url);
                             refuses secrets, which a human sets

Values come from .claude/kit.json: refs.dev, refs.prod, keychain.prod,
backupRoot (required), keychain.dev (for a dev test run).
EOF
  exit 2
}

die() { echo "prod-db: $*" >&2; exit 1; }
# A setup problem (no kit.json, a key missing) exits 2, like usage, so it
# can't be mistaken for a refusal about the database itself.
die_setup() { echo "prod-db: $*" >&2; exit 2; }

# The root is never this file's folder: the kit ships this script inside a
# plugin, away from the project. As the hooks find it (projectRoot):
# CLAUDE_PROJECT_DIR when it names a folder, else the checkout the command
# runs in, so the guard and this script read the same kit.json.
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
  ROOT=$(cd "$CLAUDE_PROJECT_DIR" && pwd -P)
else
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die_setup "run this inside the project's git checkout"
fi
cd "$ROOT"
KIT="$ROOT/.claude/kit.json"

# One value from kit.json by dotted key (refs.dev), printed bare; nothing if
# it's missing. jq when it's there, node otherwise; both read the key as an
# argument, so no value is ever spliced into a program.
kit_get() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$1" 'try getpath($k | split(".")) catch null | if . == null then empty elif type == "string" then . else tojson end' "$KIT"
  else
    node -e '
      const [file, key] = process.argv.slice(1)
      let v = JSON.parse(require("fs").readFileSync(file, "utf8"))
      for (const p of key.split(".")) v = v !== null && typeof v === "object" ? v[p] : undefined
      if (v !== undefined && v !== null) process.stdout.write(typeof v === "string" ? v : JSON.stringify(v))
    ' "$KIT" "$1"
  fi
}
# The same, but a missing or empty value stops the script.
kit_need() {
  local v
  v=$(kit_get "$1") || die_setup "couldn't read $1 from $KIT"
  [ -n "$v" ] || die_setup "$KIT has no $1. Add it; this script has no default for it."
  printf '%s' "$v"
}
expand_home() {
  case "$1" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${1#"~/"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

[ $# -ge 1 ] || usage
cmd=$1; shift

[ -f "$KIT" ] || die_setup "no $KIT. It names the project's refs, Keychain items and backup folder."
if command -v jq >/dev/null 2>&1; then
  jq empty "$KIT" 2>/dev/null || die_setup "$KIT isn't valid JSON"
else
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$KIT" 2>/dev/null || die_setup "$KIT isn't valid JSON"
fi

DEV_REF=$(kit_need refs.dev)
PROD_REF=$(kit_need refs.prod)
PROD_ITEM=$(kit_need keychain.prod)
DEV_ITEM=$(kit_get keychain.dev)
BACKUP_ROOT=$(expand_home "$(kit_need backupRoot)")
for r in "$DEV_REF" "$PROD_REF"; do
  [[ $r =~ ^[a-z]{20}$ ]] || die_setup "$KIT: a Supabase project ref is 20 lowercase letters, got '$r'"
done
[ "$DEV_REF" != "$PROD_REF" ] || die_setup "$KIT: refs.dev and refs.prod are the same project"
case "$BACKUP_ROOT" in /*) ;; *) die_setup "$KIT: backupRoot must be an absolute path or start with ~/" ;; esac

# PROD_DB_KEYCHAIN_ITEM stays an override, so a test run can point at dev.
ITEM="${PROD_DB_KEYCHAIN_ITEM:-$PROD_ITEM}"
if [ "$ITEM" = "$PROD_ITEM" ]; then
  TARGET=production
elif [ -n "$DEV_ITEM" ] && [ "$ITEM" = "$DEV_ITEM" ]; then
  TARGET=dev; BACKUP_ROOT="$BACKUP_ROOT-dev"
else
  die "unknown Keychain item $ITEM (kit.json names keychain.prod${DEV_ITEM:+ and keychain.dev})"
fi

URL=$(security find-generic-password -s "$ITEM" -w 2>/dev/null) ||
  die "no Keychain item $ITEM. Add it in your own terminal: security add-generic-password -a \"\$USER\" -s $ITEM -w"

# The project ref is in the user (pooler) or the host (direct connection).
REF=$(printf '%s' "$URL" | sed -nE 's#.*://postgres\.([a-z]{20})[:@].*#\1#p; s#.*@db\.([a-z]{20})\.supabase\.co.*#\1#p' | head -1)
if [ -z "$REF" ]; then
  # Say what the value looks like, never what it is: no password, and
  # nothing at all if it isn't a URL (it might be a bare password).
  case "$URL" in
    *://*@*) shape="$(printf '%s' "${URL%%://*}")://$(printf '%s' "${URL#*://}" | sed -E 's#^([^:@]*)(:[^@]*)?@#\1:***@#')" ;;
    *://*) shape="a URL without user@host" ;;
    *) shape="not a URL (${#URL} characters)" ;;
  esac
  die "can't find a Supabase project ref in $ITEM. It looks like: $shape
Expected the session pooler URI: postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres"
fi
# Both refs are known now, so the item must point at exactly its own project.
if [ "$TARGET" = dev ]; then
  [ "$REF" = "$DEV_REF" ] || die "$ITEM points at $REF, not dev ($DEV_REF)"
else
  [ "$REF" != "$DEV_REF" ] || die "$ITEM points at dev, not production"
  [ "$REF" = "$PROD_REF" ] || die "$ITEM points at $REF, not production ($PROD_REF)"
fi
case "$URL" in *:6543/*) die "use the session pooler (port 5432), not the transaction pooler (6543)" ;; esac

# Anything a command prints goes through here, so neither the URL nor its
# password can reach Claude's transcript, even in an error message.
PW=${URL#*://}; PW=${PW%%@*}; PW=${PW#*:}
redact() {
  R_URL="$URL" R_PW="$PW" perl -pe '
    BEGIN { $u = $ENV{R_URL}; $p = $ENV{R_PW}; ($d = $p) =~ s/%([0-9A-Fa-f]{2})/chr hex $1/ge }
    s/\Q$u\E/[db-url]/g;
    if (length $p > 3) { s/\Q$p\E/***/g; s/\Q$d\E/***/g }'
}
run() { "$@" 2>&1 | redact; }

echo "Target: $TARGET ($REF)"

release_dir_name() {
  local v=${1#V}; v=${v#v}
  [[ $v =~ ^[0-9]+(\.[0-9]+)*$ ]] || die "release must look like 2.7 or V2.7.1, got '$1'"
  echo "V$v"
}

# Migration versions are the number before the first underscore (0034).
versions_of() { local v; for v in "$@"; do v=$(basename "$v"); v=${v%%_*}; v=${v%.sql}; echo "$v"; done | sort -u; }

# Migration files the dry run would apply. The CLI prints them as a "•" list
# and, for agents, as JSON ("migrations":["0034_x.sql"]); either is enough.
pending() {
  run supabase db push --dry-run --db-url "$URL" | tee /dev/stderr |
    grep -oE '[0-9]{4,}_[^"[:space:],]+\.sql'
}

case "$cmd" in
  migrations)
    run supabase migration list --db-url "$URL"
    ;;

  dry-run)
    # Show what `push` will compare against, so the parser is checked on
    # real output before the first push relies on it.
    # shellcheck disable=SC2046,SC2116 # word-split on purpose: one line of versions
    echo "Parsed versions: $(echo $(versions_of $(pending)))"
    ;;

  backup)
    [ $# -eq 1 ] || usage
    docker info >/dev/null 2>&1 || die "supabase db dump runs pg_dump in Docker. Start Docker Desktop first."
    name="$(date +%F)-$(release_dir_name "$1")"
    dir="$BACKUP_ROOT/$name"
    [ -e "$dir" ] && dir="$dir-$(date +%H%M%S)"
    mkdir -p "$dir"
    chmod 700 "$BACKUP_ROOT" "$dir"
    run supabase db dump --db-url "$URL" -f "$dir/roles.sql" --role-only
    run supabase db dump --db-url "$URL" -f "$dir/schema.sql"
    run supabase db dump --db-url "$URL" -f "$dir/data.sql" --use-copy --data-only
    for f in roles schema data; do
      [ -s "$dir/$f.sql" ] || die "backup failed: $dir/$f.sql is missing or empty. Stop here."
    done
    chmod 600 "$dir"/*.sql
    echo "Backup complete: $dir"
    ls -lh "$dir" | tail -n +2
    ;;

  push)
    [ $# -ge 2 ] || usage
    release=$(release_dir_name "$1"); shift
    # Gate 1: a complete backup for this release, taken just now.
    latest=$(ls -dt "$BACKUP_ROOT"/*-"$release" "$BACKUP_ROOT"/*-"$release"-* 2>/dev/null | head -1 || true)
    [ -n "$latest" ] || die "no backup for $release in $BACKUP_ROOT. Run: scripts/prod-db.sh backup $release"
    for f in roles schema data; do
      [ -s "$latest/$f.sql" ] || die "backup $latest is incomplete ($f.sql). Take a new one."
    done
    [ -n "$(find "$latest/data.sql" -mmin -"$BACKUP_MAX_AGE_MIN")" ] ||
      die "backup $latest is older than $BACKUP_MAX_AGE_MIN minutes. Take a new one."
    echo "Backup: $latest"
    # Gate 2: the dry run lists exactly the release's migrations.
    want=$(versions_of "$@")
    # shellcheck disable=SC2046 # pending prints one file per line
    got=$(versions_of $(pending))
    if [ "$want" != "$got" ]; then
      echo "prod-db: the dry run doesn't match the release. Nothing was pushed." >&2
      # shellcheck disable=SC2086,SC2116 # joined onto one line on purpose
      echo "  expected: $(echo $want)" >&2
      # shellcheck disable=SC2086,SC2116
      echo "  dry run:  $(echo $got)" >&2
      exit 3
    fi
    run supabase db push --db-url "$URL" --yes
    run supabase migration list --db-url "$URL"
    ;;

  repair)
    [ $# -ge 2 ] || usage
    status=$1; shift
    case "$status" in applied|reverted) ;; *) usage ;; esac
    for v in "$@"; do [[ $v =~ ^[0-9]+$ ]] || die "migration versions are numbers (0028), got '$v'"; done
    run supabase migration repair --status "$status" "$@" --db-url "$URL"
    ;;

  query)
    [ $# -eq 1 ] || usage
    file=$1
    [ -f "$file" ] || die "no such file: $file"
    # The transaction is read-only; refuse files that try to leave it or
    # run psql meta-commands (\! runs a shell, \copy writes files).
    if grep -Eiq 'read[[:space:]]+write|transaction_read_only|^[[:space:]]*(commit|end|rollback|abort|begin|start[[:space:]]+transaction|reset|\\)' "$file"; then
      die "$file tries to leave the read-only transaction or runs a psql meta-command"
    fi
    run psql "$URL" -X -q -v ON_ERROR_STOP=1 -1 -c 'set transaction read only' -f "$file"
    ;;

  setting)
    [ $# -eq 2 ] || usage
    key=$1 value=$2
    [[ $key =~ ^[a-z][a-z0-9_]{0,62}$ ]] || die "setting keys are snake_case (notify_url), got '$key'"
    # app_settings also holds function_secret, and this runs with the value on
    # Claude's command line, so anything secret-shaped is refused, by its key
    # or by its value.
    secret_step="a secret stays a human step: set it in the dashboard's SQL editor, never through this script."
    [[ $key =~ (secret|token|password|passwd|service_role|private|credential) ]] && die "'$key' names a secret; $secret_step"
    [[ $value == *$'\n'* || -z $value ]] && die "the value must be one non-empty line"
    [[ $value =~ eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\. ]] && die "the value looks like a JWT; $secret_step"
    [[ $value =~ (^|[^A-Za-z0-9])(sk|rk|pk_live|sb_secret)[_-][A-Za-z0-9] || $value =~ service_role ]] && die "the value looks like an API key; $secret_step"
    [[ $value =~ [^/@:[:space:]]+:[^/@[:space:]]+@[A-Za-z0-9.-] || $value =~ ://[^/[:space:]]*@ ]] &&
      die "the value carries credentials (user:password@host); $secret_step"
    # A long run of mixed letters and digits is a token, whatever its prefix.
    for word in $(printf '%s' "$value" | tr -c 'A-Za-z0-9_+=-' ' '); do
      if [ ${#word} -ge 32 ] && [[ $word =~ [0-9] && $word =~ [A-Za-z] ]]; then
        die "the value holds a long token (${#word} characters); $secret_step"
      fi
    done
    # psql's :'var' quotes the value, so nothing in it runs as SQL. Variables
    # aren't expanded in -c, hence stdin.
    run psql "$URL" -X -q -v ON_ERROR_STOP=1 -1 -v k="$key" -v v="$value" -f - <<'SQL'
select key, value as before from public.app_settings where key = :'k';
insert into public.app_settings (key, value) values (:'k', :'v')
  on conflict (key) do update set value = excluded.value;
select key, value as after from public.app_settings where key = :'k';
SQL
    ;;

  *) usage ;;
esac
