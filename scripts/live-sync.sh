#!/bin/sh
# Moves the checkout sessions load (default ~/wolfpack-live, or $1) onto origin/main
# (kit 1.5, H1). Run after a kit merge, and every 30 minutes by scripts/launchd/.
# A checkout with local changes is left alone and the changes printed, unless every
# changed file already equals origin/main's version (then they are discarded).
set -eu

dir="${1:-$HOME/wolfpack-live}"
[ -d "$dir/.git" ] || [ -f "$dir/.git" ] || { echo "live-sync: $dir is not a git checkout" >&2; exit 1; }

git -C "$dir" fetch --quiet origin

behind=$(git -C "$dir" rev-list --count HEAD..origin/main)
changed=$(git -C "$dir" status --porcelain)
if [ -n "$changed" ]; then
  # Differs from origin/main in content? Untracked files always count as local work.
  if [ -n "$(git -C "$dir" ls-files --others --exclude-standard)" ] ||
    ! git -C "$dir" diff --quiet origin/main -- $(git -C "$dir" diff --name-only HEAD); then
    echo "live-sync: $dir has local changes, not moving:" >&2
    echo "$changed" >&2
    exit 1
  fi
  git -C "$dir" checkout --quiet --force --detach origin/main
fi

git -C "$dir" checkout --quiet --detach origin/main
echo "live at $(git -C "$dir" rev-parse --short HEAD), was $behind behind"
