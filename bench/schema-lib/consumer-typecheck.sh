#!/usr/bin/env bash
# Typechecks a consumer repo against a built svelte-docinfo tree without
# publishing or touching the consumer: a tar copy of the consumer (no `.git`,
# no `node_modules`) gets a `node_modules` of symlinks into the real one, with
# `svelte-docinfo` swapped for the tree's packed files (`dist/`, `package.json`,
# the virtual-module types) resolving its own dependencies from the tree's
# install. Reports `gro typecheck` exit status and wall time (median of N).
#
# usage: consumer-typecheck.sh <work-dir> <runs> <consumer-checkout> name=/path/to/built/tree ...
set -uo pipefail
work=$1
runs=$2
consumer=$(realpath "$3")
shift 3
cname=$(basename "$consumer")
median() { sort -n | awk '{a[NR]=$1} END {print (NR%2 ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2)}'; }
for spec in "$@"; do
	name=${spec%%=*}
	tree=${spec#*=}
	dir="$work/$cname--$name"
	rm -rf "$dir"
	mkdir -p "$dir/node_modules"
	tar -C "$consumer" --exclude=.git --exclude=node_modules -cf - . | tar -C "$dir" -xf -
	for entry in "$consumer"/node_modules/* "$consumer"/node_modules/.bin; do
		ln -s "$entry" "$dir/node_modules/$(basename "$entry")"
	done
	rm "$dir/node_modules/svelte-docinfo"
	mkdir "$dir/node_modules/svelte-docinfo"
	cp -r "$tree/dist" "$tree/package.json" "$tree/virtual-svelte-docinfo.d.ts" "$dir/node_modules/svelte-docinfo/"
	ln -s "$tree/node_modules" "$dir/node_modules/svelte-docinfo/node_modules"
	cd "$dir"
	# gro reads git state; a throwaway repo, never the consumer's
	git init -q && git add -A >/dev/null 2>&1 && git -c user.name=bench -c user.email=bench@localhost commit -qm snapshot
	times=()
	status=0
	for _ in $(seq "$runs"); do
		s=$(date +%s%N)
		nice gro typecheck >"$dir/typecheck.log" 2>&1 || status=$?
		times+=("$((($(date +%s%N) - s) / 1000000))")
	done
	echo "== $cname against $name: exit $status; gro typecheck ms: median $(printf '%s\n' "${times[@]}" | median) all [${times[*]}]"
	if [ "$status" -ne 0 ]; then grep -E 'Error|TS[0-9]+' "$dir/typecheck.log" | head -10; fi
done
