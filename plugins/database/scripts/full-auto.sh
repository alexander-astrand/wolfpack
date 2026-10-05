#!/usr/bin/env bash
# Kit copy: values from .claude/kit.json (refs, keychain, backupRoot, urls.prod, pluginRoot)
#
# Arms or disarms full auto (/cattle-drive): one release, or a chain of them.
#
#   scripts/full-auto.sh arm-chain <version> [<version> …]
#                                         the one yes: a person approves this call
#   scripts/full-auto.sh arm <version>    ranjit, at the deploy (see below)
#   scripts/full-auto.sh done <version>   ranjit, once a release is deployed
#   scripts/full-auto.sh disarm
#   scripts/full-auto.sh preview <version>  what arm would list, and the one-tap
#                                         verdict per condition; writes nothing
#   scripts/full-auto.sh check-plan <version> <plan file>
#                                         ranjit's plan against the PR; writes nothing
#
# This copy reads two optional keys from <root>/.claude/kit.json:
#
#   pluginRoot   the database plugin's folder; its hooks/ holds chain-arm.mjs
#                and production-steps.mjs. Unset: the database@wolfpack plugin
#                installed for this project (or for the user), else the
#                project's own .claude/hooks/.
#   urls.prod    the production site. done checks, for up to 90 seconds,
#                that it answers (the smoke: the site is up, not proof the
#                new deploy is live); empty or missing means no deploy wait
#                and no smoke, and done says so.
#
# The root is CLAUDE_PROJECT_DIR when it names a folder (as the hooks take
# it), else the git checkout the command runs in, and every node call gets
# CLAUDE_PROJECT_DIR=<root>, so the hooks read this project's markers even
# when they live in a plugin folder.
#
# arm writes .claude/full-auto.json: the version, the open release PR's
# number and head SHA, an expiry, and the exact production commands parsed
# from the PR's Production steps (Before merge, After merge) plus the merge.
# A release with no production command arms as merge-only (`gh pr ready` if
# a draft, then `gh pr merge --squash --admin`) only when its Before merge,
# After merge and Human steps before the deploy can finish each say "None"
# and its changed files hold no migration or function.
# Under that marker the guard lets ranjit, and only ranjit, run those
# commands without asking, and logs each call to .claude/full-auto.log. On a
# database release nothing on the list runs until the backup has, and
# nothing runs after the merge.
#
# arm-chain writes .claude/full-auto-chain.json: the versions in order (at
# most 4; a single drive is a chain of one), the ones done, a 48-hour expiry
# and the hash of the frozen set (FROZEN in chain-arm.mjs: the guard's files,
# check.sh, CI, yoda's and ranjit's texts). It refuses unless those files are
# exactly origin/main's. It is the one yes: under it, ranjit's
# `arm <version>` passes without asking when the version is the chain's next,
# the frozen set is unchanged and the release doesn't change it, CI is green
# by job name, the list comes from the PR with the backup first, and the
# pushes are exactly the PR's migration files. A broken condition is a hard
# stop, except that a release outside the tap (not in it, or one that changes
# the frozen set) asks a person at its arm. `preview` prints that verdict per
# condition. While a chain is armed the guard refuses any change to the
# frozen set and any nested claude.
#
# check-plan compares ranjit's planned production calls (a file, one step
# per line) with the list arm derives from the PR: every step once, in the
# PR's order, nothing extra, the backup first on a database release, the
# pushes = the PR's migration files, the merge last. A mismatch exits 1: a
# hard stop before the arm.
#
# done closes a chained release only when production shows it done, read
# here, not from the log: the PR merged, each pushed migration applied
# (prod-db.sh migrations), each listed function deployed after the arm
# (supabase functions list), no call in the release log that asked a person,
# and, with urls.prod set, the site answering. Anything else and it disarms
# everything. Its last line is ranjit's report line:
# `merged <sha>; functions: <name> v<n>, …`.
#
# .claude/full-auto-chain.log keeps the tap, each arm, each done and each
# disarm, and the guard's line for every production call while a chain is
# armed. Nothing truncates it.
#
# The guard never lets an agent run arm-chain on its own: it always asks a
# person, and it refuses every other write to the markers and their logs.
# Neither arm is allowlisted in .claude/settings.json for the same reason.
# done is ranjit's alone. disarm only takes rights away, so it runs like any
# other command, and so do preview and check-plan, which only read and print.

set -euo pipefail

die() { echo "full-auto: $*" >&2; exit 1; }
die_setup() { echo "full-auto: $*" >&2; exit 2; }

# This file's own folder, read before the cd below: as shipped in a plugin
# (<plugin>/scripts/), the plugin's hooks sit beside it in <plugin>/hooks/.
# Logical, not -P: a plugin folder reached through a link keeps its hooks.
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# The kit ships this script inside a plugin, so its own folder says nothing
# about the project. The root is the hooks' own (projectRoot): CLAUDE_PROJECT_DIR
# when it names a folder, so this script and the guard read the same markers
# even from a worktree's cwd; else the checkout the command runs in.
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
  ROOT=$(cd "$CLAUDE_PROJECT_DIR" && pwd -P)
else
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die_setup "run this inside the project's git checkout"
fi
cd "$ROOT"
# The hooks run from a plugin folder too; this tells them which project's
# markers and frozen set to read.
export CLAUDE_PROJECT_DIR="$ROOT"
KIT="$ROOT/.claude/kit.json"

# One value from kit.json by dotted key, printed bare; nothing if the file or
# the key is missing (both keys this script reads are optional). The key is
# an argument to a fixed program, never spliced into it.
kit_get() {
  [ -f "$KIT" ] || return 0
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
expand_home() {
  case "$1" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${1#"~/"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# The folder holding chain-arm.mjs and production-steps.mjs, in this order:
# kit.json's pluginRoot (set but wrong is an error, never a quiet fallback),
# the plugin this script ships in (its .claude-plugin/plugin.json says it is
# one; a project's own scripts/ has none), the database@wolfpack plugin
# Claude Code installed for this project or for the user, then the project's
# own .claude/hooks/. The marketplace's clone
# under ~/.claude/plugins/marketplaces/ is left out on purpose: it is there
# whether or not this project installed the plugin, so it would shadow a
# project that keeps its own hooks.
hooks_dir() {
  local root dir
  root=$(kit_get pluginRoot) || die_setup "couldn't read $KIT"
  if [ -n "$root" ]; then
    root=$(expand_home "$root")
    case "$root" in /*) ;; *) root="$ROOT/$root" ;; esac
    [ -f "$root/hooks/chain-arm.mjs" ] || die_setup "kit.json's pluginRoot ($root) has no hooks/chain-arm.mjs"
    printf '%s' "$root/hooks"
    return
  fi
  # The parent by name: "scripts/.." through a link would be the link's target's.
  local own
  own=$(dirname "$SELF_DIR")
  if [ -f "$own/.claude-plugin/plugin.json" ] && [ -f "$own/hooks/chain-arm.mjs" ]; then
    printf '%s' "$own/hooks"
    return
  fi
  dir=$(node -e '
    const fs = require("fs"), path = require("path")
    const [file, root] = process.argv.slice(1)
    let entries = []
    try { entries = JSON.parse(fs.readFileSync(file, "utf8")).plugins?.["database@wolfpack"] ?? [] } catch {}
    const pick = entries.find((e) => e.projectPath === root) ?? entries.find((e) => e.scope === "user")
    if (pick?.installPath && fs.existsSync(path.join(pick.installPath, "hooks", "chain-arm.mjs"))) process.stdout.write(path.join(pick.installPath, "hooks"))
  ' "$HOME/.claude/plugins/installed_plugins.json" "$ROOT")
  if [ -n "$dir" ]; then printf '%s' "$dir"; return; fi
  [ -f "$ROOT/.claude/hooks/chain-arm.mjs" ] ||
    die_setup "no chain-arm.mjs: set pluginRoot in $KIT, install the database plugin, or keep the hooks in .claude/hooks/"
  printf '%s' "$ROOT/.claude/hooks"
}

MARKER=.claude/full-auto.json
LOG=.claude/full-auto.log
CHAIN=.claude/full-auto-chain.json
CHAIN_LOG=.claude/full-auto-chain.log
# yoda's chain verdict until 2.12.3; a stale one is still removed.
VERDICT=.claude/full-auto-verdict.json
# Long enough for a deploy with a wait for the host, short enough that a
# forgotten marker dies the same evening.
HOURS=4
# What the parser reads: the body for the steps; the files, their count and
# the draft state for merge-only; the number, so the parser can page a list
# gh cut at 100 files. A failed read gives the parser nothing to parse,
# which refuses.
PR_FIELDS=number,body,isDraft,files,changedFiles
USAGE="usage: scripts/full-auto.sh arm <version> | arm-chain <version> … | done <version> | disarm | preview <version> | check-plan <version> <plan file>"
# done's whole site check fits in this many seconds: the Bash tool kills a
# call at 120-600 s, and a killed done would leave both markers armed.
SITE_DEADLINE=90
SITE_TRY_SECONDS=10
SITE_PAUSE_SECONDS=10

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
version_arg() {
  local v=${1#V}
  [[ $v =~ ^[0-9]+(\.[0-9]+)*$ ]] || die "a version looks like 2.12.1, got '$1'"
  printf '%s' "$v"
}

# The open PR for V$1, as preview and check-plan read it: its number, or a
# refusal naming what's wrong.
release_pr() {
  local open pr
  open=$(gh pr list --state open --limit 100 --json number,headRefName \
    --jq '.[] | select(.headRefName | test("^V[0-9]")) | "\(.number) \(.headRefName)"')
  pr=$(printf '%s\n' "$open" | awk -v b="V$1" '$2 == b { print $1 }')
  [ -n "$pr" ] || die "no open PR for V$1, so arm would refuse"
  [ "$(printf '%s\n' "$open" | wc -l | tr -d ' ')" = 1 ] ||
    echo "arm would refuse: more than one release PR is open: $(printf '%s ' "$open")" >&2
  printf '%s' "$pr"
}

# Removes every marker and says so in both logs. Always safe: it only takes
# rights away.
disarm_all() {
  local why=$1 any=
  for f in "$MARKER" "$CHAIN" "$VERDICT"; do if [ -e "$f" ]; then any=1; fi; done
  rm -f "$MARKER" "$CHAIN" "$VERDICT"
  if [ -n "$any" ]; then
    printf '%s\tdisarmed\t%s\n' "$(stamp)" "$why" >> "$LOG"
    printf '%s\tdisarmed\t%s\n' "$(stamp)" "$why" >> "$CHAIN_LOG"
  fi
  [ -n "$any" ]
}

# done's smoke: the production site answers with a success status. That says
# the site is up, not that this release's deploy is live; ranjit checks the
# host's deploy separately. Prints one line, the reason when it fails (always
# on stdout and as a return, never an exit, so done's message carries it). No
# urls.prod means nothing to check, said out loud. Bounded by SITE_DEADLINE.
deploy_check() {
  local url start
  if ! url=$(kit_get urls.prod 2>/dev/null); then
    echo "couldn't read urls.prod from $KIT"
    return 1
  fi
  if [ -z "$url" ]; then
    echo "No urls.prod in .claude/kit.json: no deploy wait and no smoke."
    return 0
  fi
  if ! [[ $url =~ ^https?://[^[:space:]]+$ ]]; then
    echo "kit.json's urls.prod isn't an http(s) URL"
    return 1
  fi
  start=$SECONDS
  while :; do
    if curl -fsS -o /dev/null --max-time "$SITE_TRY_SECONDS" "$url" 2>/dev/null; then
      echo "Smoke: $url answers (the site is up; the host's deploy itself is checked separately)."
      return 0
    fi
    # Another try only if it can finish before the deadline.
    [ $((SECONDS - start + SITE_PAUSE_SECONDS + SITE_TRY_SECONDS)) -le "$SITE_DEADLINE" ] || break
    sleep "$SITE_PAUSE_SECONDS"
  done
  echo "$url didn't answer within $SITE_DEADLINE seconds"
  return 1
}

case "${1:-}" in
  arm)
    [ $# -eq 2 ] || die "usage: scripts/full-auto.sh arm <version>"
    version=$(version_arg "$2")
    HOOKS=$(hooks_dir)

    # At most one release PR is open at a time; anything else is a state
    # full auto shouldn't guess its way through.
    open=$(gh pr list --state open --limit 100 --json number,headRefName \
      --jq '.[] | select(.headRefName | test("^V[0-9]")) | "\(.number) \(.headRefName)"')
    [ -n "$open" ] || die "no release PR is open"
    [ "$(printf '%s\n' "$open" | wc -l | tr -d ' ')" = 1 ] || die "more than one release PR is open: $(printf '%s ' "$open")"
    read -r pr branch <<<"$open"
    [ "$branch" = "V$version" ] || die "the open release PR is #$pr ($branch), not V$version"

    sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
    json=$(gh pr view "$pr" --json "$PR_FIELDS" | node "$HOOKS/production-steps.mjs" "$version" "$pr" "$sha" "$HOURS" --pr-json) ||
      die "not armed"
    printf '%s\n' "$json" > "$MARKER"
    # A fresh log per release: the last one was posted to its own PR.
    printf '%s\tarmed\tV%s PR #%s %s\n' "$(stamp)" "$version" "$pr" "$sha" > "$LOG"
    if [ -e "$CHAIN" ]; then printf '%s\tarmed\tV%s PR #%s %s\n' "$(stamp)" "$version" "$pr" "$sha" >> "$CHAIN_LOG"; fi

    echo "Full auto armed for V$version (PR #$pr at ${sha:0:7}) for $HOURS hours. ranjit may run, without asking:"
    node -e 'const m = JSON.parse(process.argv[1]); if (m.mergeOnly) console.log("  (merge-only: the PR says None under Before merge, After merge and Human steps before the deploy can finish)"); for (const c of m.commands) console.log("  " + c)' "$json"
    echo "The backup runs first on a database release, and the merge last. A push to the PR, or the expiry, disarms it. Disarm now: scripts/full-auto.sh disarm"
    ;;
  arm-chain)
    shift
    [ $# -ge 1 ] || die "usage: scripts/full-auto.sh arm-chain <version> [<version> …] (at most 4, each like 2.13.1)"
    HOOKS=$(hooks_dir)
    # A finished chain lingers only for its last wrap-up, so a new tap
    # replaces it instead of asking for a disarm first.
    if [ ! -e "$MARKER" ] && [ -e "$CHAIN" ] &&
      node -e 'process.exit(typeof JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).finished === "string" ? 0 : 1)' "$CHAIN" 2>/dev/null; then
      rm -f "$CHAIN"
      printf '%s\tchain-cleared\tthe finished chain, for a new tap\n' "$(stamp)" >> "$CHAIN_LOG"
    fi
    if [ -e "$MARKER" ] || [ -e "$CHAIN" ]; then die "a release or a chain is armed; disarm first (scripts/full-auto.sh disarm)"; fi
    # A new drive starts both logs clean, so the log its PR comment carries
    # is this drive's alone. One generation is kept beside them as
    # *.prev.log (ignored by *.log). Only a log that's there moves: a tap that
    # fails below and is retried leaves the older one in place.
    for f in "$LOG" "$CHAIN_LOG"; do
      if [ -e "$f" ]; then mv -f "$f" "${f%.log}.prev.log"; fi
    done

    # The tap covers the frozen set as it is on main: nothing local, nothing
    # a branch changed, nothing untracked beside it.
    git fetch --quiet origin main || die "couldn't fetch origin/main"
    frozen=()
    while IFS= read -r p; do frozen+=("$p"); done < <(node "$HOOKS/chain-arm.mjs" frozen)
    [ ${#frozen[@]} -gt 0 ] || die "couldn't read the frozen set"
    changed=$(git diff --name-only origin/main -- "${frozen[@]}" | head -1)
    [ -z "$changed" ] || die "the guard's files differ from origin/main: $changed"
    # Ignored files too (a .local copy is still on disk); the local settings
    # are hashed instead, since they are never on main.
    extra=$(git ls-files --others -- "${frozen[@]}" | { grep -vx '.claude/settings.local.json' || true; } | head -1)
    [ -z "$extra" ] || die "the guard's files differ from origin/main: $extra (not on main)"

    main_sha=$(git rev-parse origin/main)
    json=$(node "$HOOKS/chain-arm.mjs" new-chain "$main_sha" "$@") || die "not armed"
    printf '%s\n' "$json" > "$CHAIN"
    order=$(node -e 'console.log(JSON.parse(process.argv[1]).versions.map((v) => "V" + v).join(" → "))' "$json")
    printf '%s\tchain-armed\t%s main %s\n' "$(stamp)" "$order" "${main_sha:0:7}" >> "$CHAIN_LOG"

    echo "Armed for $order, in this order, for 48 hours (main at ${main_sha:0:7}). That was the one yes."
    echo "Each release's deploy arms without asking when it's next, leaves the guard's files alone, has CI green by job name, and its PR lists the backup first and exactly its migrations; scripts/full-auto.sh preview <version> shows the verdict. A release that changes the guard's files asks at its arm."
    echo "Until it's done or disarmed, the guard's files, .claude/kit.json, check.sh, CI and yoda's and ranjit's texts are locked, and no nested claude runs."
    echo "After each deploy ranjit runs scripts/full-auto.sh done <version>, which checks production. Disarm now: scripts/full-auto.sh disarm"
    ;;
  done)
    [ $# -eq 2 ] || die "usage: scripts/full-auto.sh done <version>"
    version=$(version_arg "$2")
    [ -e "$CHAIN" ] || die "no chain is armed"
    HOOKS=$(hooks_dir)

    # chain-arm.mjs reads production and prints the chain with this version
    # done, or why not; this script writes. On the last release the chain
    # stays, marked finished, so the guard still allows the last wrap-up's
    # files; it expires 90 minutes on, and disarm removes it.
    if ! out=$(node "$HOOKS/chain-arm.mjs" done "$version"); then
      disarm_all "done V$version refused: ${out:-no reason given}" || true
      die "V$version isn't done: ${out:-no reason given}. Full auto and the chain are disarmed."
    fi
    # The site is part of "done": a deploy that never comes up stops the
    # chain like any other gap. Without urls.prod this only says it skipped.
    # A kill mid-wait (the tool's timeout, Ctrl-C) disarms instead of
    # leaving both markers armed with nothing written.
    trap 'disarm_all "done V$version interrupted" || true; exit 130' INT TERM
    if ! smoke=$(deploy_check); then
      trap - INT TERM
      disarm_all "done V$version refused: ${smoke:-the site check failed}" || true
      die "V$version isn't done: ${smoke:-the site check failed}. Full auto and the chain are disarmed."
    fi
    trap - INT TERM
    # Line 1 the status, line 2 what production shows (the merge SHA and the
    # function versions, ranjit's report line), then the chain.
    status=$(printf '%s\n' "$out" | head -1)
    shown=$(printf '%s\n' "$out" | sed -n 2p)
    json=$(printf '%s\n' "$out" | tail -n +3)
    rm -f "$MARKER" "$VERDICT"
    printf '%s\tdone\tV%s\n' "$(stamp)" "$version" >> "$LOG"
    # The smoke first: the last two lines stay the status and ranjit's
    # report line, the shape he reads.
    echo "$smoke"
    if [ "$status" = last ]; then
      printf '%s\n' "$json" > "$CHAIN"
      printf '%s\tdone\tV%s\n%s\tchain-done\n' "$(stamp)" "$version" "$(stamp)" >> "$CHAIN_LOG"
      echo "V$version is done on production, and so is the chain. The chain marker stays, finished, for the wrap-up's files for 90 minutes; disarm removes it now."
    else
      printf '%s\n' "$json" > "$CHAIN"
      printf '%s\tdone\tV%s\n' "$(stamp)" "$version" >> "$CHAIN_LOG"
      echo "V$version is done on production. Next in the chain: ${status#next }."
    fi
    # The report line stays last.
    echo "$shown"
    ;;
  preview)
    [ $# -eq 2 ] || die "usage: scripts/full-auto.sh preview <version>"
    version=$(version_arg "$2")
    HOOKS=$(hooks_dir)
    # The same lookup as arm, but a state arm refuses is printed, not fatal,
    # so the preview shows everything wrong at once.
    pr=$(release_pr "$version")
    sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
    echo "Preview for V$version, PR #$pr at ${sha:0:7}. Nothing is armed or written."
    # With the version it also prints ranjit's plan in check-plan's shape.
    gh pr view "$pr" --json "$PR_FIELDS" | node "$HOOKS/production-steps.mjs" preview "$pr" "$version" --pr-json || true
    # What the guard will decide at ranjit's arm, condition by condition.
    node "$HOOKS/chain-arm.mjs" one-tap "$version" || true
    if [ -e "$MARKER" ]; then echo "A marker is in place now: $MARKER."; fi
    if [ -e "$CHAIN" ]; then echo "A chain is armed now: $CHAIN."; fi
    ;;
  check-plan)
    [ $# -eq 3 ] || die "usage: scripts/full-auto.sh check-plan <version> <plan file>"
    version=$(version_arg "$2")
    [ -f "$3" ] || die "no plan file at $3"
    HOOKS=$(hooks_dir)
    pr=$(release_pr "$version")
    gh pr view "$pr" --json "$PR_FIELDS" | node "$HOOKS/production-steps.mjs" check-plan "$version" "$pr" "$3" --pr-json
    ;;
  disarm)
    [ $# -eq 1 ] || die "usage: scripts/full-auto.sh disarm"
    # Needs no hooks folder: taking rights away works even when the setup
    # is broken.
    if disarm_all "by hand"; then
      echo "Full auto disarmed, the chain too if one was armed. The logs stay in $LOG and $CHAIN_LOG."
    else
      echo "Full auto wasn't armed."
    fi
    ;;
  *)
    die "$USAGE"
    ;;
esac
