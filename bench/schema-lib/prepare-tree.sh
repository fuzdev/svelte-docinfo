#!/usr/bin/env bash
# Copies a svelte-docinfo checkout (working tree, uncommitted edits included) to
# a build dir, gives it its own `npm ci`, and builds `dist/`. The copy excludes
# `.git` (a worktree's `.git` file would route git writes to the real repo) and
# `node_modules`, and gets a throwaway git repo of its own. `gro build`
# re-points the global `svelte-docinfo` link at the copy, so it's restored
# afterwards.
#
# usage: prepare-tree.sh <source-checkout> <dest-dir>
set -euo pipefail
src=$(realpath "$1")
dest=$2
link="$(npm root -g)/svelte-docinfo"
global_link_target=${SVELTE_DOCINFO_LINK:-$(readlink "$link" 2>/dev/null || true)}

rm -rf "$dest"
mkdir -p "$dest"
tar -C "$src" --exclude=.git --exclude=node_modules --exclude=.svelte-kit --exclude=dist --exclude=build -cf - . | tar -C "$dest" -xf -
cd "$dest"
# gro build reads `git rev-parse HEAD`; a throwaway repo, never the real one
git init -q && git add -A && git -c user.name=bench -c user.email=bench@localhost commit -qm snapshot
nice npm ci --prefer-offline --no-audit --no-fund >/dev/null
nice gro build >/dev/null
if [ -n "$global_link_target" ]; then ln -sfn "$global_link_target" "$link"; fi
echo "built $dest ($(du -sh dist | cut -f1) dist)"
