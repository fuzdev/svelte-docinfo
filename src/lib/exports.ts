/**
 * Package.json exports field discovery for source files.
 *
 * Maps dist paths in package.json `exports` to source file paths,
 * enabling zero-config file discovery without glob patterns.
 *
 * @see `source.ts` for `SourceFileInfo`
 * @see `analyze.ts` for `analyzeFromFiles` (primary consumer)
 *
 * @module
 */

import { readFile, access } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';

import type { SourceFileInfo } from './source.ts';
import type { Diagnostic } from './diagnostics.ts';
import { to_error_message } from './error.ts';
import { toPosixPath } from './paths.ts';
import { MAX_FILE_CONCURRENCY, map_concurrent } from './concurrency.ts';
import { baselineExcludesForBase, hasBaselineExcludedSegment } from './source-config.ts';

// Types

/**
 * A parsed entry from package.json exports field.
 */
export interface ExportEntry {
	/** The export specifier (e.g., `"."`, `"./*.js"`). */
	specifier: string;
	/** Whether the specifier contains a wildcard (`*`). */
	isPattern: boolean;
	/** Resolved dist paths by condition (e.g., `{types: "./dist/index.d.ts", default: "./dist/index.js"}`). */
	conditions: Record<string, string>;
}

/**
 * Options for `discoverFromExports`.
 */
export interface ExportsDiscoveryOptions {
	/** Absolute path to project root. */
	projectRoot: string;
	/** Dist directory name relative to projectRoot. Default: `'dist'`. */
	distDir?: string;
	/** Source directory name relative to projectRoot. Default: `'src/lib'`. */
	sourceDir?: string;
	/** Glob patterns to exclude from discovered files. */
	exclude?: Array<string>;
}

/**
 * Result of discovering source files from package.json exports.
 *
 * Self-contained: includes both the discovered files and any error diagnostics
 * (e.g., files that exist but could not be read).
 */
export interface ExportsDiscoveryResult {
	/**
	 * Discovered source files, or `null` if no exports field found.
	 * Empty array means exports field exists but resolved no source files
	 * (likely a misconfigured dist-to-source mapping).
	 */
	files: Array<SourceFileInfo> | null;
	/** Error diagnostics for files that exist but could not be read. */
	diagnostics: Array<Diagnostic>;
}

/**
 * Result of reading and parsing package.json exports.
 */
export interface ParsedExports {
	/** All parsed export entries. */
	entries: Array<ExportEntry>;
	/**
	 * Specifiers (exact or wildcard patterns) whose export target resolves
	 * nothing — a literal `null`, or a conditions object with no usable
	 * target. Node's explicit-exclusion form: `"./internal/*": null` blocks
	 * the subpaths a broader wildcard would otherwise expose. Discovery
	 * honors these with Node's best-match semantics: a subpath whose
	 * most-specific matching key is blocked is not exported, so its source
	 * file is not discovered.
	 *
	 * Interpret via `createBlockedSpecifierChecker` — a naive membership
	 * check (`blocked.includes(specifier)`) is wrong for wildcard keys and
	 * ignores the positive keys that can out-match a blocked one.
	 */
	blocked: Array<string>;
	/** Whether the package.json had an exports field. */
	hasExports: boolean;
}

// Condition priority

/** Priority order for selecting the condition to use for source mapping. */
const CONDITION_PRIORITY = ['svelte', 'default', 'import', 'require'];

// Parsing

/**
 * Read and parse the exports field from package.json.
 *
 * Handles all Node.js export formats: strings, objects with conditions,
 * nested conditions, null exclusions (surfaced on `blocked` for
 * best-match blocking during discovery), and wildcard patterns.
 *
 * @param projectRoot - absolute path to project root
 * @returns parsed `ParsedExports`, or `{entries: [], blocked: [], hasExports: false}` if no exports field
 */
export const parsePackageExports = async (projectRoot: string): Promise<ParsedExports> => {
	let pkg: Record<string, unknown>;
	try {
		const content = await readFile(join(projectRoot, 'package.json'), 'utf-8');
		pkg = JSON.parse(content) as Record<string, unknown>;
	} catch {
		return { entries: [], blocked: [], hasExports: false };
	}

	const exportsField = pkg.exports;
	if (!exportsField || typeof exportsField !== 'object') {
		return { entries: [], blocked: [], hasExports: false };
	}

	const entries: Array<ExportEntry> = [];
	const blocked: Array<string> = [];

	for (const [specifier, value] of Object.entries(exportsField as Record<string, unknown>)) {
		// Skip package.json self-reference
		if (specifier === './package.json') continue;

		// A literal null target is Node's explicit exclusion — record it so
		// discovery can block the subpaths it covers.
		if (value === null) {
			blocked.push(specifier);
			continue;
		}

		const conditions = flattenConditions(value);
		if (!conditions) {
			// A conditions object with no usable target (all-null values, or
			// empty) blocks like a literal null — Node resolves nothing for it.
			// Other unparseable shapes (fallback arrays) skip and fail open:
			// they do export something.
			if (typeof value === 'object' && !Array.isArray(value)) blocked.push(specifier);
			continue;
		}

		entries.push({
			specifier,
			isPattern: specifier.includes('*'),
			conditions
		});
	}

	return { entries, blocked, hasExports: true };
};

/**
 * Flatten a possibly-nested export value into a flat conditions record.
 *
 * Top-level `null` targets never reach here — `parsePackageExports` routes
 * them to `blocked` first; a `null` nested *inside* a conditions object just
 * contributes nothing.
 *
 * @returns flat conditions record, or null when nothing usable remains
 */
const flattenConditions = (value: unknown, prefix?: string): Record<string, string> | null => {
	// Null condition target = that condition doesn't resolve
	if (value === null || value === undefined) return null;

	// String = direct path (condition is the parent key, or 'default')
	if (typeof value === 'string') {
		return { [prefix ?? 'default']: value };
	}

	// Object = conditions map (possibly nested)
	if (typeof value === 'object' && !Array.isArray(value)) {
		// Null-prototype map: condition keys come from package.json `exports` (external
		// input) and are read back by key in `selectCondition` (`key in conditions`,
		// `conditions[key]`); avoids prototype keys leaking into membership/lookup.
		const result: Record<string, string> = Object.create(null);
		for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
			const flattened = flattenConditions(nested, key);
			if (flattened) {
				Object.assign(result, flattened);
			}
		}
		return Object.keys(result).length > 0 ? result : null;
	}

	return null;
};

// Null-target blocking

/**
 * Split a pattern-ish string at its first `*` — the one star rule shared by
 * exports-key matching, glob widening, and specifier reconstruction. Any
 * further `*` sits in `after` and is treated literally, matching Node's
 * handling of exports keys. Returns `null` for a starless string.
 */
const splitAtFirstStar = (s: string): { before: string; after: string } | null => {
	const star = s.indexOf('*');
	return star === -1 ? null : { before: s.slice(0, star), after: s.slice(star + 1) };
};

/** A wildcard exports key split at its first `*` for Node-style matching. */
interface ExportsPatternKey {
	/** Static text before the `*`. */
	base: string;
	/** Static text after the `*` (matched literally, like Node's patternTrailer). */
	trailer: string;
	/** Full key length (Node's minimum-specifier-length bound). */
	length: number;
	/** Whether this key's target is `null`. */
	blocked: boolean;
}

/**
 * Node's `PATTERN_KEY_COMPARE`: the key with the longer static base wins;
 * ties break to the longer key overall. Negative when `a` is the better
 * (more specific) match.
 */
const comparePatternKeys = (a: ExportsPatternKey, b: ExportsPatternKey): number =>
	b.base.length - a.base.length || b.length - a.length;

/**
 * Build a predicate deciding whether an export specifier is blocked, per
 * Node's resolution semantics: an exact (starless) key wins outright, else
 * the best-matching wildcard key (`comparePatternKeys`) decides — and when
 * that winner's target is `null`, the subpath is not exported.
 *
 * Blocking is only observable when blocked keys exist, so this returns
 * `null` for the common no-blocked-keys case and callers skip specifier
 * computation entirely.
 *
 * Exported for consumers reading `ParsedExports.blocked` directly — this is
 * the one implementation of the interpretation rule.
 */
export const createBlockedSpecifierChecker = (
	parsed: ParsedExports
): ((specifier: string) => boolean) | null => {
	if (parsed.blocked.length === 0) return null;

	const exact = new Map<string, boolean>();
	const patterns: Array<ExportsPatternKey> = [];
	const add = (key: string, blocked: boolean): void => {
		const split = splitAtFirstStar(key);
		if (split === null) {
			exact.set(key, blocked);
			return;
		}
		patterns.push({ base: split.before, trailer: split.after, length: key.length, blocked });
	};
	for (const entry of parsed.entries) add(entry.specifier, false);
	for (const key of parsed.blocked) add(key, true);

	return (specifier) => {
		const exactHit = exact.get(specifier);
		if (exactHit !== undefined) return exactHit;
		let best: ExportsPatternKey | null = null;
		for (const p of patterns) {
			// Node's match rule: specifier extends the base, and the trailer (when
			// present) matches with at least one captured character.
			if (!specifier.startsWith(p.base) || specifier === p.base) continue;
			if (p.trailer !== '' && !(specifier.endsWith(p.trailer) && specifier.length >= p.length)) {
				continue;
			}
			if (best === null || comparePatternKeys(p, best) < 0) best = p;
		}
		return best?.blocked ?? false;
	};
};

// Source mapping

/**
 * Map a dist file path to its source file path.
 *
 * Replaces the dist directory prefix with the source directory and maps
 * file extensions based on the export condition.
 *
 * @param distPath - the dist path from exports (e.g., `"./dist/index.js"`)
 * @param condition - the export condition (e.g., `"default"`, `"svelte"`, `"types"`)
 * @param options - mapping configuration
 * @returns source path relative to project root, or null if not mappable
 */
export const mapDistToSource = (
	distPath: string,
	condition: string,
	options: { distDir: string; sourceDir: string }
): string | null => {
	const { distDir, sourceDir } = options;

	// Skip types-only conditions (not source files)
	if (condition === 'types') return null;

	// Normalize: strip leading ./
	const normalized = distPath.replace(/^\.\//, '');

	// Must start with dist dir
	if (!normalized.startsWith(distDir + '/')) return null;

	// Replace dist prefix with source prefix. Empty `sourceDir` (the
	// no-common-prefix sourcePaths case where `getSourceRoot` returns `''`)
	// means "source files live at project root" — emit `relPath` directly
	// rather than `'/relPath'`, which would resolve as an absolute path and
	// fail every `fileExists` check.
	const relPath = normalized.slice(distDir.length + 1);
	const sourceBase = sourceDir ? `${sourceDir}/${relPath}` : relPath;

	// Extension mapping based on condition
	if (condition === 'svelte') {
		// Svelte condition → keep .svelte extension
		return sourceBase;
	}

	if (sourceBase.endsWith('.css')) {
		return sourceBase;
	}

	if (sourceBase.endsWith('.json')) {
		return sourceBase;
	}

	// .js → .ts (primary), .js (fallback — handled by caller checking existence)
	if (sourceBase.endsWith('.js')) {
		return sourceBase.replace(/\.js$/, '.ts');
	}

	return sourceBase;
};

// Discovery

/**
 * Per-run invariants threaded through the concrete and wildcard resolvers —
 * built once in `discoverFromExports`.
 */
interface ExportsDiscoveryContext {
	/** Absolute project root (POSIX). */
	projectRoot: string;
	/** Dist→source mapping configuration. */
	mappingOptions: { distDir: string; sourceDir: string };
	/** User exclude globs — applied as glob `ignore` on the wildcard path. */
	exclude: Array<string> | undefined;
	/** Compiled form of `exclude` for the concrete path. */
	excludeMatcher: ((relPath: string) => boolean) | undefined;
	/** Blocked-key best-match checker; `null` when the exports field has no blocked keys. */
	isBlockedSpecifier: ((specifier: string) => boolean) | null;
	/** Accumulator: absolute path → relative source path. */
	discovered: Map<string, string>;
}

/**
 * Select the best condition for source mapping from an export entry.
 */
const selectCondition = (conditions: Record<string, string>): [string, string] | null => {
	for (const key of CONDITION_PRIORITY) {
		if (key in conditions) return [key, conditions[key]!];
	}
	// Fall back to first non-types condition
	for (const [key, value] of Object.entries(conditions)) {
		if (key !== 'types') return [key, value];
	}
	return null;
};

/**
 * Discover source files using package.json exports field.
 *
 * Reads package.json, parses exports, maps dist paths to source paths,
 * expands wildcard patterns, and loads file content.
 *
 * Returns `{files: null}` when no package.json or no exports field exists,
 * signaling the caller to fall back to glob discovery. Returns `{files: []}`
 * when exports exist but resolve no source files (likely misconfigured mapping).
 *
 * For concrete exports, maps directly to source paths and verifies existence.
 * For wildcard exports, globs the source directory for matching files.
 *
 * Null-target keys are honored with Node's resolution semantics: a subpath
 * whose most-specific matching key is `null` is not exported, so its file is
 * not discovered — `"./internal/*": null` beside the usual `"./*.js"`
 * wildcards keeps `src/lib/internal/` out of discovery exactly as it keeps
 * the subpaths unresolvable for consumers (the `src/lib/internal/`
 * convention's exports half).
 *
 * @param options - discovery configuration
 * @returns `ExportsDiscoveryResult` with discovered files and any error diagnostics
 */
export const discoverFromExports = async (
	options: ExportsDiscoveryOptions
): Promise<ExportsDiscoveryResult> => {
	const { projectRoot, distDir = 'dist', sourceDir = 'src/lib', exclude } = options;

	const parsed = await parsePackageExports(projectRoot);
	if (!parsed.hasExports) return { files: null, diagnostics: [] };

	const ctx: ExportsDiscoveryContext = {
		projectRoot,
		mappingOptions: { distDir, sourceDir },
		exclude,
		excludeMatcher: exclude?.length ? picomatch(exclude) : undefined,
		// Blocked keys gate the subpaths they best-match (Node semantics);
		// `null` when the exports field has none.
		isBlockedSpecifier: createBlockedSpecifierChecker(parsed),
		discovered: new Map()
	};

	for (const entry of parsed.entries) {
		const selected = selectCondition(entry.conditions);
		if (!selected) continue;
		const [condition, distPath] = selected;

		if (entry.isPattern) {
			// Wildcard: expand via glob. Files whose specifier a blocked key
			// best-matches are skipped; a file reachable through several
			// wildcard entries stays discovered if any of its specifiers
			// resolves (Map union).
			await expandWildcardExport(distPath, condition, entry.specifier, ctx);
		} else {
			// Concrete: map directly. Never block-checked — an exact key with a
			// target wins over every wildcard in Node's resolution, blocked keys
			// included.
			await resolveConcreteExport(distPath, condition, ctx);
		}
	}

	const { discovered } = ctx;
	if (discovered.size === 0) return { files: [], diagnostics: [] };

	// Load file contents with bounded concurrency to keep FD pressure under
	// the typical ulimit on large projects. See `concurrency.ts`.
	const diagnostics: Array<Diagnostic> = [];
	const absPaths = Array.from(discovered.keys());
	const results = await map_concurrent(
		absPaths,
		MAX_FILE_CONCURRENCY,
		async (absPath): Promise<SourceFileInfo | null> => {
			try {
				const content = await readFile(absPath, 'utf-8');
				return { id: absPath, content } satisfies SourceFileInfo;
			} catch (err) {
				diagnostics.push({
					kind: 'module_unreadable',
					severity: 'error',
					file: toPosixPath(relative(projectRoot, absPath)),
					message: `Could not read file discovered via package.json exports: ${to_error_message(err)}`
				});
				return null;
			}
		}
	);
	const files = results.filter((r): r is SourceFileInfo => r !== null);

	return { files, diagnostics };
};

/**
 * Resolve a concrete (non-wildcard) export entry to a source file.
 *
 * Applies `excludeMatcher` to the mapped source path — the wildcard path gets
 * exclusion through the glob's `ignore`, and skipping it here would let a
 * concrete entry (a root `.` export mapping to `src/lib/index.ts`) bypass
 * `exclude` at the discovery stage. The always-on baseline applies the same
 * way: matched relative to the source dir (like the wildcard path's anchored
 * glob ignore), so a concrete entry mapping into `node_modules` or a
 * dot-directory below it is never discovered.
 */
const resolveConcreteExport = async (
	distPath: string,
	condition: string,
	ctx: ExportsDiscoveryContext
): Promise<void> => {
	const { mappingOptions, projectRoot, excludeMatcher, discovered } = ctx;
	const sourcePath = mapDistToSource(distPath, condition, mappingOptions);
	if (!sourcePath) return;
	// `mapDistToSource` prefixes `sourceDir/`, so the slice is the base-relative
	// remainder; the `.js` fallback below differs only in the final segment,
	// which the baseline never checks, so one check covers both.
	const { sourceDir } = mappingOptions;
	const baseRelative = sourceDir ? sourcePath.slice(sourceDir.length + 1) : sourcePath;
	if (hasBaselineExcludedSegment(baseRelative)) return;
	if (excludeMatcher?.(sourcePath)) return;

	const absPath = toPosixPath(resolve(projectRoot, sourcePath));
	if (discovered.has(absPath)) return;

	// Check existence — try .ts first, fall back to .js
	if (await fileExists(absPath)) {
		discovered.set(absPath, sourcePath);
	} else if (sourcePath.endsWith('.ts')) {
		const jsPath = sourcePath.replace(/\.ts$/, '.js');
		if (excludeMatcher?.(jsPath)) return;
		const absJs = toPosixPath(resolve(projectRoot, jsPath));
		if (await fileExists(absJs)) {
			discovered.set(absJs, jsPath);
		}
	}
};

/**
 * Widen an exports-derived source pattern into a directory-crossing glob.
 *
 * A package.json `exports` wildcard matches subpaths *including* `/` — the
 * `./*.js` key resolves `./auth/session.js` with `*` capturing `auth/session`.
 * A plain glob `*`, by contrast, stops at a directory separator, so globbing
 * the mapped `src/lib/*.ts` would match only top-level modules and silently
 * drop every nested one. When the wildcard sits after a directory separator
 * (the ubiquitous `<dir>/*.ext` shape), splice in a globstar segment so the
 * glob crosses directories the way Node's resolver does; the globstar matches
 * zero-or-more segments, so top-level files still match.
 *
 * Two shapes are deliberately left un-widened:
 * - A mid-segment wildcard (`prefix-*.ts`) has no faithful globstar translation.
 * - A bare-root wildcard (`*.ts`, from an empty `sourceDir`) would widen to a
 *   project-root `**` that rakes in `node_modules`/`dist`. Empty `sourceDir`
 *   only arises from the multi-`sourcePaths` no-common-prefix layout (which
 *   `discoverSourceFiles` short-circuits before reaching here) or an explicit
 *   `sourceRoot: ''`; leaving it non-recursive matches the prior behavior
 *   without the explosion risk.
 *
 * Both fall through to matching same-directory files only.
 */
const toRecursiveExportGlob = (pattern: string): string => {
	const split = splitAtFirstStar(pattern);
	if (split === null) return pattern;
	if (split.before.endsWith('/')) return `${split.before}**/*${split.after}`;
	return pattern;
};

/**
 * Extensions a `.ts`-mapped exports pattern also matches — `mapDistToSource`
 * maps `.js` dist entries to `.ts` sources, but the same entry serves
 * Svelte/JS/CSS files too.
 */
const TS_VARIANT_EXTENSIONS = ['.svelte', '.js', '.css'];

/**
 * Expand a `.ts`-suffixed pattern (or pattern trailer) into every
 * source-extension variant it matches, itself first. The one variant table:
 * the glob expansion and the specifier inversion
 * (`createSpecifierForSourcePath`) both consume it, so they can't drift — a
 * divergence would make blocked-key checking silently fail open for the
 * missed extension.
 */
const tsExtensionVariants = (pattern: string): Array<string> =>
	pattern.endsWith('.ts')
		? [pattern, ...TS_VARIANT_EXTENSIONS.map((ext) => pattern.slice(0, -3) + ext)]
		: [pattern];

/**
 * Expand a wildcard export pattern to matching source files.
 */
const expandWildcardExport = async (
	distPath: string,
	condition: string,
	entrySpecifier: string,
	ctx: ExportsDiscoveryContext
): Promise<void> => {
	const { mappingOptions, projectRoot, exclude, isBlockedSpecifier, discovered } = ctx;
	const mappedPattern = mapDistToSource(distPath, condition, mappingOptions);
	if (!mappedPattern) return;

	// The exports `*` crosses directory separators; a glob `*` does not — widen
	// it so nested modules aren't silently dropped. A `.ts`-mapped pattern also
	// matches Svelte/JS/CSS sources (`tsExtensionVariants`).
	const patterns = tsExtensionVariants(toRecursiveExportGlob(mappedPattern));

	// Blocked-key checking: reconstruct the specifier this entry would resolve
	// a file under and ask the best-match checker. A path whose specifier can't
	// be reconstructed (degenerate multi-`*` pattern, unmatched shape) fails
	// open — the file stays discovered, matching the pre-blocking behavior.
	const toSpecifier =
		isBlockedSpecifier && createSpecifierForSourcePath(mappedPattern, entrySpecifier);
	const isBlockedPath =
		isBlockedSpecifier && toSpecifier
			? (relPath: string): boolean => {
					const specifier = toSpecifier(relPath);
					return specifier !== null && isBlockedSpecifier(specifier);
				}
			: null;

	const filePaths = await glob(patterns, {
		cwd: projectRoot,
		// user exclude + the always-on baseline anchored below the source dir —
		// anchoring preserves an explicit dot-dir source dir (`.hidden/src`)
		ignore: [...(exclude ?? []), ...baselineExcludesForBase(mappingOptions.sourceDir)],
		absolute: true
	});

	for (const rawAbsPath of filePaths) {
		// Posixify before keying — tinyglobby returns native separators on
		// Windows; the rest of the pipeline expects POSIX absolute paths.
		const absPath = toPosixPath(rawAbsPath);
		if (discovered.has(absPath)) continue;
		// Compute relative source path from absolute. Both sides are POSIX
		// at this point, so the slice produces a forward-slash relative path.
		const relPath = absPath.slice(projectRoot.length + 1);
		if (isBlockedPath?.(relPath)) continue;
		discovered.set(absPath, relPath);
	}
};

/**
 * Build the source-path → export-specifier mapping for one wildcard entry.
 *
 * Inverts the discovery direction: the glob matched source files against the
 * dist-mapped pattern (`src/lib/*.ts` for the `./*.js` entry), so the text the
 * pattern's `*` captured, substituted into the entry's specifier, is the
 * specifier Node would resolve that file under (`src/lib/internal/foo.ts` →
 * capture `internal/foo` → `./internal/foo.js`). Extension variants come from
 * `tsExtensionVariants`, the same table the glob used, so `.svelte`/`.js`/
 * `.css` files map too — their specifier keeps this entry's extension
 * (`./X.js` for an `X.svelte` match), which is exact for prefix-shaped
 * blocked keys (`./internal/*`) and only approximate for a blocked key
 * targeting a specific foreign extension.
 *
 * Returns `null` when the pattern shape can't be inverted (no `*`, or a
 * second `*` in the trailer); the per-path mapper returns `null` for a path
 * that doesn't fit the pattern. Callers treat both as "don't block".
 */
const createSpecifierForSourcePath = (
	mappedPattern: string,
	entrySpecifier: string
): ((relPath: string) => string | null) | null => {
	const pattern = splitAtFirstStar(mappedPattern);
	const specifier = splitAtFirstStar(entrySpecifier);
	if (!pattern || !specifier || pattern.after.includes('*')) return null;

	const trailers = tsExtensionVariants(pattern.after);

	return (relPath) => {
		if (!relPath.startsWith(pattern.before)) return null;
		for (const t of trailers) {
			if (relPath.length > pattern.before.length + t.length && relPath.endsWith(t)) {
				const capture = relPath.slice(pattern.before.length, relPath.length - t.length);
				return specifier.before + capture + specifier.after;
			}
		}
		return null;
	};
};

/**
 * Check if a file exists.
 */
const fileExists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};
