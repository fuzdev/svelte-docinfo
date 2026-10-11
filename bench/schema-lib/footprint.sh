#!/usr/bin/env bash
# Install footprint: packs each built tree, installs the tarball into a clean
# consumer the way a user would (production deps, required peers auto-installed
# by npm 7+), and reports the unpacked size of every installed package. Sizes
# are `du -sb` (apparent bytes) per top-level `node_modules` entry.
#
# usage: footprint.sh <work-dir> name=/path/to/built/tree ...
set -euo pipefail
work=$1
shift
mkdir -p "$work"
for spec in "$@"; do
	name=${spec%%=*}
	tree=${spec#*=}
	dir="$work/$name"
	rm -rf "$dir"
	mkdir -p "$dir"
	tarball=$(cd "$tree" && npm pack --silent --pack-destination "$dir" | tail -1)
	cd "$dir"
	echo '{"name":"footprint-consumer","private":true,"type":"module"}' >package.json
	nice npm install --omit=dev --no-audit --no-fund --prefer-offline "./$tarball" >/dev/null
	{
		echo "# $name tarball $(stat -c %s "$tarball") bytes"
		echo "total $(du -sb node_modules | cut -f1)"
		# every installed package (nested copies included), own bytes only
		npm ls --all --parseable --omit=dev 2>/dev/null | tail -n +2 | sort -u |
			while read -r p; do
				printf '%s %s %s\n' \
					"$(node -p "const j=require('$p/package.json');j.name+' '+j.version")" \
					"$(du -sb --exclude=node_modules "$p" | cut -f1)"
			done | sort
	} >"$dir/footprint.txt"
	echo "== $name"
	head -2 "$dir/footprint.txt"
done
