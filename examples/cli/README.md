# CLI Examples

> Usage reference — not a runnable project. Run these commands from any project
> with TypeScript or Svelte source files, or point at the sibling `api/` example.

The CLI is the fastest way to try svelte-docinfo. Run it in any project
with TypeScript or Svelte source files and it prints JSON to stdout.

## Basic usage

```bash
npx svelte-docinfo                    # analyze the current directory
npx svelte-docinfo -o output.json     # write to a file instead
npx svelte-docinfo --pretty           # pretty-print the JSON output
```

## Try it

You can analyze the sibling `api/` example to see real output:

```bash
npx svelte-docinfo ../api --pretty
```

You'll get back JSON describing the example's source files:

```json
{
	"modules": [
		{
			"path": "Calculator.svelte",
			"declarations": [
				{"name": "Calculator", "kind": "component", "props": [...], ...}
			]
		},
		{
			"path": "math.ts",
			"declarations": [
				{"name": "add", "kind": "function", "docComment": "Add two numbers.", ...},
				{"name": "multiply", "kind": "function", ...},
				{"name": "MathConfig", "kind": "interface", ...},
				{"name": "Vector2", "kind": "interface", ...},
				{"name": "add_vector", "kind": "function", ...}
			]
		}
	]
}
```

## Options

Control which files are analyzed and how output is formatted:

```bash
npx svelte-docinfo -i "src/**/*.ts"   # custom include pattern (forces glob discovery)
npx svelte-docinfo -e "**/*.test.ts"  # exclude files matching a pattern
npx svelte-docinfo --discovery glob   # skip package.json exports, use glob instead
npx svelte-docinfo --discovery exports  # strict — fail if package.json exports is missing
npx svelte-docinfo --no-resolve-dependencies  # skip dependency graph resolution
npx svelte-docinfo --on-duplicates throw  # enforce flat namespace (fail on duplicate names)
npx svelte-docinfo --only 'components/**'  # emit only modules matching glob (analysis still runs on full project)
npx svelte-docinfo -q                 # suppress info messages on stderr
```

## Discovery strategies

The default `--discovery auto` reads your `package.json` `exports` field and
falls back to glob patterns when `exports` is missing or empty. Two other
strategies are explicit:

| Mode      | Behavior                                                                            |
| --------- | ----------------------------------------------------------------------------------- |
| `auto`    | exports first, glob fallback (default)                                              |
| `exports` | exports only — **fails** if `package.json` has no usable `exports` field            |
| `glob`    | glob only — `exports` field ignored, use `--include` / `--exclude` to parameterize  |

Use `exports` for libraries that should always declare their public surface
via `package.json`. CI fails loudly if someone removes the `exports` field by
accident.

## Multiple source directories (monorepos)

`--source-dir` is repeatable. When set, it also derives the implicit include
glob, so glob fallback discovers files in each directory.

```bash
# Source-root auto-derived as 'src' (common prefix of both entries) — module
# paths come out like 'lib/foo.ts', 'routes/page.svelte'
npx svelte-docinfo --source-dir src/lib --source-dir src/routes --discovery glob

# No common prefix — pass `--source-root .` to keep module paths project-relative.
# Module paths come out like 'src/lib/foo.ts', 'lib/utils/bar.ts'.
npx svelte-docinfo \
  --source-dir src/lib \
  --source-dir lib/utils \
  --source-root . \
  --discovery glob
```

## Output streams

Info messages print to stderr; only JSON goes to stdout. The terminal shows them
interleaved, but `>` and `|` capture clean JSON. Use `-q` to suppress info
(warnings and errors still print to stderr).

`-o -` (and `--output -`) explicitly routes JSON to stdout — same as omitting
`-o` entirely, but useful for scripts where the output path is parameterized:
`svelte-docinfo -o "$OUT"` works whether `$OUT` is a file path or `-`.

## Piping with jq

The default output is compact JSON, which works well with `jq` for queries:

```bash
npx svelte-docinfo | jq '.modules | length'                  # count modules
npx svelte-docinfo | jq -r '.modules[].declarations[].name'  # list all exported names

# Find every deprecated declaration with its module path
npx svelte-docinfo | jq '.modules[] | .path as $p | .declarations[]
  | select(.deprecatedMessage) | {module: $p, name, deprecatedMessage}'

# List exported functions with their parameter names
npx svelte-docinfo | jq '.modules[].declarations[]
  | select(.kind == "function") | {name, params: [.parameters[]?.name]}'
```

## Exit codes

| Code | Meaning         |
| ---- | --------------- |
| 0    | Success         |
| 1    | Analysis errors |
| 2    | CLI errors      |
