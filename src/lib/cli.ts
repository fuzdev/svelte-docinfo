/**
 * CLI for svelte-docinfo.
 *
 * Static analysis for TypeScript and Svelte source code.
 *
 * @example
 * ```bash
 * # Analyze current project
 * svelte-docinfo
 *
 * # Analyze specific directory
 * svelte-docinfo ./packages/my-lib
 *
 * # Write to file
 * svelte-docinfo --output docs/library.json
 * ```
 *
 * @module
 */

import {Command, type OptionValues} from 'commander';
import {writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import picomatch from 'picomatch';

import {analyzeFromFiles} from './analyze.ts';
import type {OnDuplicates} from './analyze-core.ts';
import type {Discovery} from './discovery.ts';
import {hasErrors} from './diagnostics.ts';
import {to_error_message} from './error.ts';
import type {AnalysisLog} from './log.ts';
import {compactReplacer} from './declaration-helpers.ts';

/** Collect repeatable option values into an array. */
const collect = (value: string, previous: Array<string> | undefined): Array<string> =>
	previous ? [...previous, value] : [value];

/** Allowed values for `--on-duplicates`. */
const ON_DUPLICATES_VALUES = ['throw', 'warn'] as const;
type OnDuplicatesFlag = (typeof ON_DUPLICATES_VALUES)[number];
const isOnDuplicatesFlag = (value: string): value is OnDuplicatesFlag =>
	(ON_DUPLICATES_VALUES as ReadonlyArray<string>).includes(value);

/** Allowed values for `--discovery`. */
const DISCOVERY_VALUES = ['auto', 'exports', 'glob'] as const satisfies ReadonlyArray<Discovery>;
const isDiscoveryFlag = (value: string): value is Discovery =>
	(DISCOVERY_VALUES as ReadonlyArray<string>).includes(value);

/**
 * CLI options parsed from command line arguments.
 */
export interface CliOptions {
	/** File patterns to include (undefined = use exports discovery or defaults). */
	include?: Array<string>;
	/**
	 * File patterns to exclude (undefined = use defaults — test and spec files).
	 *
	 * When provided, **fully replaces** the defaults — no array merge. Passing
	 * a custom `--exclude` pattern drops the default test/spec filters unless
	 * the caller re-includes them explicitly.
	 */
	exclude?: Array<string>;
	/** Output file path (undefined = stdout). */
	output?: string;
	/**
	 * Whether to resolve dependencies. Mapped from the `--no-resolve-dependencies`
	 * flag (commander populates `true` by default; `false` when the flag is passed).
	 * Optional here so external callers can omit it; treated as `true` when undefined.
	 */
	resolveDependencies?: boolean;
	/**
	 * Discovery strategy (undefined = 'auto').
	 *
	 * Mapped from `--discovery <auto|exports|glob>`.
	 */
	discovery?: Discovery;
	/** Dist directory name for exports-based discovery (undefined = 'dist'). */
	distDir?: string;
	/**
	 * Source directories relative to project root (undefined = ['src/lib']).
	 *
	 * Repeatable. Drives the implicit include glob in the glob-discovery
	 * fallback (via `deriveIncludePatterns` inside `discoverSourceFiles`) so
	 * custom source directories survive without needing an explicit `--include`.
	 */
	sourceDir?: Array<string>;
	/**
	 * Source root for module path extraction, relative to project root
	 * (undefined = single sourceDir or longest common prefix).
	 *
	 * Module paths in output are stripped of `<projectRoot>/<sourceRoot>/`.
	 * Pass `.` (or `""`) to keep module paths project-relative — useful when
	 * `sourceDir` entries share no common prefix. The `.` form is normalized
	 * to `""` inside `normalizeSourceOptions`.
	 */
	sourceRoot?: string;
	/**
	 * Behavior when duplicate declaration names are found across modules
	 * (undefined = emit `duplicate_declaration` diagnostic, no dispatch).
	 *
	 * Duplicate detection always runs regardless of this option — the diagnostic
	 * is the data, this option is the dispatch action.
	 */
	onDuplicates?: OnDuplicatesFlag;
	/**
	 * Glob patterns to filter the emitted `modules` array against `ModuleJson.path`
	 * (undefined = emit all analyzed modules).
	 *
	 * Repeatable. Output-only filter: full-project analysis still runs so re-exports,
	 * dependents, and `alsoExportedFrom` stay correct against the complete owned set.
	 * Diagnostics aren't filtered — they may reference modules dropped from output.
	 */
	only?: Array<string>;
	/** Whether to suppress info messages to stderr. Treated as `false` when undefined. */
	quiet?: boolean;
	/** Whether to pretty-print JSON output. Treated as `false` when undefined. */
	pretty?: boolean;
}

/**
 * Run the CLI with the given arguments.
 *
 * @param argv - command line arguments (defaults to `process.argv`)
 * @returns exit code: 0 for success, 1 if errors in diagnostics, 2 for CLI errors
 */
export const runCli = async (argv: Array<string> = process.argv): Promise<number> => {
	// Track exit code from action (commander actions don't return values)
	let exitCode = 0;

	const program = new Command();

	// Read version from package.json using URL resolution (works in both source and dist).
	// Loud throw on lookup failure — silent fallback would let a broken install
	// report `0.0.0` for `--version` indefinitely.
	const pkg = await (async () => {
		// Try dist path first, then source path
		const attempted: Array<string> = [];
		for (const relativePath of ['../package.json', '../../package.json']) {
			const pkgUrl = new URL(relativePath, import.meta.url);
			attempted.push(pkgUrl.href);
			try {
				const content = await readFile(pkgUrl, 'utf-8');
				return JSON.parse(content) as {version: string};
			} catch {
				continue;
			}
		}
		throw new Error(
			`svelte-docinfo: failed to load package.json for version. Attempted: ${attempted.join(', ')}`,
		);
	})();

	program
		.name('svelte-docinfo')
		.description('Static analysis for TypeScript and Svelte source code')
		.version(pkg.version)
		.argument('[project-root]', 'Project root directory', process.cwd())
		.option(
			'-i, --include <pattern>',
			'Include pattern (repeatable, replaces exports discovery; ' +
				'incompatible with --discovery exports)',
			collect,
		)
		.option(
			'-e, --exclude <pattern>',
			'Exclude glob (applied at discovery and analysis, repeatable; ' +
				'fully replaces defaults — does not merge with **/*.test.ts, **/*.spec.ts)',
			collect,
		)
		.option('-o, --output <file>', 'Output file (default: stdout; pass `-` for explicit stdout)')
		.option('--no-resolve-dependencies', 'Disable dependency resolution')
		.option(
			'--discovery <mode>',
			`Source file discovery strategy: ${DISCOVERY_VALUES.join('|')} ` +
				'(default: auto — exports first, glob fallback). ' +
				'`exports` is strict and fails if package.json exports is missing or empty ' +
				'(also incompatible with --include).',
		)
		.option('--dist-dir <dir>', 'Dist directory for exports discovery (default: dist)')
		.option(
			'--source-dir <dir>',
			'Source directory relative to project root (default: src/lib). ' +
				'Repeatable for monorepos. Drives the implicit include glob for the ' +
				'glob-discovery fallback when no --include is provided.',
			collect,
		)
		.option(
			'--source-root <dir>',
			'Prefix stripped from module paths in output (default: the source-dir, ' +
				'or longest common prefix when multiple). Pass `.` to keep paths project-relative.',
		)
		.option(
			'--on-duplicates <mode>',
			`Dispatch on duplicate declaration names across modules: ${ON_DUPLICATES_VALUES.join('|')} ` +
				'(default: emit duplicate_declaration diagnostic, no dispatch)',
		)
		.option(
			'--only <pattern>',
			'Glob filter applied to module paths in output (repeatable). ' +
				'Full project is still analyzed — re-exports/dependents stay correct — ' +
				'but only matching modules are emitted. Diagnostics are not filtered ' +
				'and may reference modules dropped from output.',
			collect,
		)
		.option('--pretty', 'Pretty-print JSON output', false)
		.option(
			'-q, --quiet',
			'Suppress info messages on stderr (warnings and errors still print)',
			false,
		)
		.addHelpText(
			'after',
			`
Examples:
  $ svelte-docinfo                                Analyze current project
  $ svelte-docinfo ./packages/my-lib              Analyze specific directory
  $ svelte-docinfo -o docs.json                   Write to file
  $ svelte-docinfo --source-dir src               Non-SvelteKit project (src/ root)
  $ svelte-docinfo --source-dir src/lib --source-dir src/routes
                                                  Multiple source dirs (source-root auto-derived as 'src')
  $ svelte-docinfo --source-dir src/lib --source-dir lib/utils --source-root .
                                                  No common prefix — module paths stay project-relative
  $ svelte-docinfo --discovery glob               Skip package.json exports
  $ svelte-docinfo --discovery exports            Strict — fail if exports missing
  $ svelte-docinfo --on-duplicates throw          Enforce flat namespace
  $ svelte-docinfo --only 'components/**'         Emit only modules under components/
  $ svelte-docinfo --only '*.svelte'              Emit only Svelte modules (top-level)
  $ svelte-docinfo | jq .                         Pipe to jq for readable output`,
		)
		.action(async (projectRoot: string, raw: OptionValues) => {
			try {
				// Validate enum-shaped options before constructing the rest of the options.
				// Commander accepts arbitrary strings; we narrow to the allowed sets.
				if (raw.onDuplicates !== undefined && !isOnDuplicatesFlag(raw.onDuplicates)) {
					throw new Error(
						`Invalid --on-duplicates value: "${raw.onDuplicates}". ` +
							`Expected one of: ${ON_DUPLICATES_VALUES.join(', ')}`,
					);
				}
				if (raw.discovery !== undefined && !isDiscoveryFlag(raw.discovery)) {
					throw new Error(
						`Invalid --discovery value: "${raw.discovery}". ` +
							`Expected one of: ${DISCOVERY_VALUES.join(', ')}`,
					);
				}

				const options: CliOptions = {
					include: raw.include,
					exclude: raw.exclude,
					output: raw.output,
					resolveDependencies: raw.resolveDependencies,
					discovery: raw.discovery,
					distDir: raw.distDir,
					sourceDir: raw.sourceDir,
					sourceRoot: raw.sourceRoot,
					onDuplicates: raw.onDuplicates,
					only: raw.only,
					quiet: raw.quiet,
					pretty: raw.pretty,
				};

				const resolvedRoot = resolve(projectRoot);

				// Stderr logger — `--quiet` only mutes info; warnings and errors always print
				// so silent CI runs still surface actionable signal.
				const log: AnalysisLog = {
					info: options.quiet ? () => {} : (msg: string) => console.error(msg),
					warn: (msg: string) => console.error(`warning: ${msg}`),
					error: (msg: string) => console.error(`error: ${msg}`),
				};

				// Build sourceOptions only when source-dir or source-root is specified,
				// so the default (`['src/lib']`) flows through `createSourceOptions`.
				// `!== undefined` rather than truthy: `--source-root ''` (or `--source-root .`,
				// aliased internally) is a valid opt-in for project-relative module paths
				// when sourcePaths share no common prefix.
				const sourceOptions =
					options.sourceDir !== undefined || options.sourceRoot !== undefined
						? {
								...(options.sourceDir !== undefined ? {sourcePaths: options.sourceDir} : {}),
								...(options.sourceRoot !== undefined ? {sourceRoot: options.sourceRoot} : {}),
							}
						: undefined;

				const onDuplicates: OnDuplicates | undefined = options.onDuplicates;

				const {modules, diagnostics} = await analyzeFromFiles({
					projectRoot: resolvedRoot,
					include: options.include,
					exclude: options.exclude,
					resolveDependencies: options.resolveDependencies,
					discovery: options.discovery,
					distDir: options.distDir,
					...(sourceOptions !== undefined ? {sourceOptions} : {}),
					...(onDuplicates !== undefined ? {onDuplicates} : {}),
					log,
				});

				// `--only` is an output-only filter: analysis ran against the full
				// owned set so re-exports/dependents/`alsoExportedFrom` are correct,
				// then matching modules are kept for emission. Diagnostics pass
				// through untouched — filtering them by the same patterns would
				// silently drop warnings about modules the user excluded from output.
				const matchOnly = options.only && picomatch(options.only);
				const emittedModules = matchOnly ? modules.filter((m) => matchOnly(m.path)) : modules;

				// `AnalyzeResultJson` is the wire-format contract — both `modules`
				// and `diagnostics` default to `[]` on `.parse()`, so empty arrays
				// stripped here round-trip losslessly through the schema. Consumers
				// programmatically ingesting analysis JSON should parse through
				// `AnalyzeResultJson` to restore defaults; raw-JSON consumers
				// (`jq '.diagnostics | length'` returns `0` on `{}` since jq treats
				// null length as 0) don't need the parse step.
				const jsonOutput = JSON.stringify(
					{modules: emittedModules, diagnostics},
					compactReplacer,
					options.pretty ? 2 : undefined,
				);

				// Write output. `-o -` is the conventional stdout sentinel
				// (matches gzip, curl, cat); accept it as an explicit form so
				// `svelte-docinfo -o "$OUT"` works when $OUT=-.
				if (options.output && options.output !== '-') {
					await writeFile(options.output, jsonOutput + '\n');
					log.info(`Wrote output to ${options.output}`);
				} else {
					console.log(jsonOutput);
				}

				exitCode = hasErrors(diagnostics) ? 1 : 0;
			} catch (error) {
				// Friendly one-line error for users; full stack only on DEBUG=1
				// so CI logs and bug reports can still capture it on demand.
				const message = to_error_message(error);
				console.error(`error: ${message}`);
				if (process.env.DEBUG) {
					console.error(error);
				}
				exitCode = 2;
			}
		});

	await program.parseAsync(argv);
	return exitCode;
};
