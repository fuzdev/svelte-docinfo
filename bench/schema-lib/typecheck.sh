#!/usr/bin/env bash
# Typecheck cost per tree: `gro typecheck` wall time (svelte-check over the
# whole project), `tsc --noEmit --extendedDiagnostics` counters (TS files only),
# and the emitted declaration sizes. Wall times are medians of N runs.
#
# usage: typecheck.sh <runs> name=/path/to/built/tree ...
set -euo pipefail
runs=$1
shift
median() { sort -n | awk '{a[NR]=$1} END {print (NR%2 ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2)}'; }
for spec in "$@"; do
	name=${spec%%=*}
	tree=${spec#*=}
	cd "$tree"
	gro_times=()
	tsc_times=()
	for _ in $(seq "$runs"); do
		s=$(date +%s%N)
		nice gro typecheck >/dev/null 2>&1
		gro_times+=("$(( ($(date +%s%N) - s) / 1000000 ))")
		s=$(date +%s%N)
		nice npx tsc --noEmit -p tsconfig.json >/dev/null 2>&1 || true
		tsc_times+=("$(( ($(date +%s%N) - s) / 1000000 ))")
	done
	diag=$(nice npx tsc --noEmit -p tsconfig.json --extendedDiagnostics 2>&1 | grep -E '^(Types|Instantiations|Memory used|Check time|Total time|Symbols)' || true)
	echo "== $name"
	echo "gro typecheck ms: median $(printf '%s\n' "${gro_times[@]}" | median) all [${gro_times[*]}]"
	echo "tsc --noEmit ms: median $(printf '%s\n' "${tsc_times[@]}" | median) all [${tsc_times[*]}]"
	echo "$diag"
	echo "dist/types.d.ts $(stat -c %s dist/types.d.ts) bytes; dist/*.d.ts total $(cat dist/*.d.ts | wc -c) bytes"
done
