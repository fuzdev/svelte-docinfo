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

import {readFile, access} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {glob} from 'tinyglobby';

import type {SourceFileInfo} from './source.js';
import type {Diagnostic} from './diagnostics.js';
import {toPosixPath} from './paths.js';
import {MAX_FILE_CONCURRENCY, map_concurrent} from './concurrency.js';

// ── Types ────────────────────────────────────────────────────────────────────

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
	/** Whether the package.json had an exports field. */
	hasExports: boolean;
}

// ── Condition priority ───────────────────────────────────────────────────────

/** Priority order for selecting the condition to use for source mapping. */
const CONDITION_PRIORITY = ['svelte', 'default', 'import', 'require'];

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Read and parse the exports field from package.json.
 *
 * Handles all Node.js export formats: strings, objects with conditions,
 * nested conditions, null exclusions, and wildcard patterns.
 *
 * @param projectRoot - absolute path to project root
 * @returns parsed `ParsedExports`, or `{entries: [], hasExports: false}` if no exports field
 */
export const parsePackageExports = async (projectRoot: string): Promise<ParsedExports> => {
	let pkg: Record<string, unknown>;
	try {
		const content = await readFile(join(projectRoot, 'package.json'), 'utf-8');
		pkg = JSON.parse(content) as Record<string, unknown>;
	} catch {
		return {entries: [], hasExports: false};
	}

	const exportsField = pkg.exports;
	if (!exportsField || typeof exportsField !== 'object') {
		return {entries: [], hasExports: false};
	}

	const entries: Array<ExportEntry> = [];

	for (const [specifier, value] of Object.entries(exportsField as Record<string, unknown>)) {
		// Skip package.json self-reference
		if (specifier === './package.json') continue;

		const conditions = flattenConditions(value);
		if (!conditions) continue; // null exclusion or unparseable

		entries.push({
			specifier,
			isPattern: specifier.includes('*'),
			conditions,
		});
	}

	return {entries, hasExports: true};
};

/**
 * Flatten a possibly-nested export value into a flat conditions record.
 *
 * @returns flat conditions record, or null for explicit exclusions
 */
const flattenConditions = (value: unknown, prefix?: string): Record<string, string> | null => {
	// Null = explicit exclusion
	if (value === null || value === undefined) return null;

	// String = direct path (condition is the parent key, or 'default')
	if (typeof value === 'string') {
		return {[prefix ?? 'default']: value};
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

// ── Source mapping ───────────────────────────────────────────────────────────

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
	options: {distDir: string; sourceDir: string},
): string | null => {
	const {distDir, sourceDir} = options;

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

// ── Discovery ────────────────────────────────────────────────────────────────

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
 * @param options - discovery configuration
 * @returns `ExportsDiscoveryResult` with discovered files and any error diagnostics
 */
export const discoverFromExports = async (
	options: ExportsDiscoveryOptions,
): Promise<ExportsDiscoveryResult> => {
	const {projectRoot, distDir = 'dist', sourceDir = 'src/lib', exclude} = options;

	const parsed = await parsePackageExports(projectRoot);
	if (!parsed.hasExports) return {files: null, diagnostics: []};

	const mappingOptions = {distDir, sourceDir};
	const discovered: Map<string, string> = new Map(); // absolute path → relative source path

	for (const entry of parsed.entries) {
		const selected = selectCondition(entry.conditions);
		if (!selected) continue;
		const [condition, distPath] = selected;

		if (entry.isPattern) {
			// Wildcard: expand via glob

			await expandWildcardExport(
				distPath,
				condition,
				mappingOptions,
				projectRoot,
				exclude,
				discovered,
			);
		} else {
			// Concrete: map directly
			await resolveConcreteExport(distPath, condition, mappingOptions, projectRoot, discovered);
		}
	}

	if (discovered.size === 0) return {files: [], diagnostics: []};

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
				return {id: absPath, content} satisfies SourceFileInfo;
			} catch (err) {
				diagnostics.push({
					kind: 'module_unreadable',
					severity: 'error',
					file: toPosixPath(relative(projectRoot, absPath)),
					message: `Could not read file discovered via package.json exports: ${err instanceof Error ? err.message : String(err)}`,
				});
				return null;
			}
		},
	);
	const files = results.filter((r): r is SourceFileInfo => r !== null);

	return {files, diagnostics};
};

/**
 * Resolve a concrete (non-wildcard) export entry to a source file.
 */
const resolveConcreteExport = async (
	distPath: string,
	condition: string,
	mappingOptions: {distDir: string; sourceDir: string},
	projectRoot: string,
	discovered: Map<string, string>,
): Promise<void> => {
	const sourcePath = mapDistToSource(distPath, condition, mappingOptions);
	if (!sourcePath) return;

	const absPath = toPosixPath(resolve(projectRoot, sourcePath));
	if (discovered.has(absPath)) return;

	// Check existence — try .ts first, fall back to .js
	if (await fileExists(absPath)) {
		discovered.set(absPath, sourcePath);
	} else if (sourcePath.endsWith('.ts')) {
		const jsPath = sourcePath.replace(/\.ts$/, '.js');
		const absJs = toPosixPath(resolve(projectRoot, jsPath));
		if (await fileExists(absJs)) {
			discovered.set(absJs, jsPath);
		}
	}
};

/**
 * Expand a wildcard export pattern to matching source files.
 */
const expandWildcardExport = async (
	distPath: string,
	condition: string,
	mappingOptions: {distDir: string; sourceDir: string},
	projectRoot: string,
	exclude: Array<string> | undefined,
	discovered: Map<string, string>,
): Promise<void> => {
	const sourcePattern = mapDistToSource(distPath, condition, mappingOptions);
	if (!sourcePattern) return;

	// Convert mapped pattern to glob: "src/lib/*.ts" is already a valid glob
	const patterns = [sourcePattern];

	// For .ts patterns, also try .svelte and .js
	if (sourcePattern.endsWith('.ts')) {
		patterns.push(sourcePattern.replace(/\.ts$/, '.svelte'));
		patterns.push(sourcePattern.replace(/\.ts$/, '.js'));
		// Also try CSS
		patterns.push(sourcePattern.replace(/\.ts$/, '.css'));
	}

	const filePaths = await glob(patterns, {
		cwd: projectRoot,
		ignore: exclude,
		absolute: true,
	});

	for (const rawAbsPath of filePaths) {
		// Posixify before keying — tinyglobby returns native separators on
		// Windows; the rest of the pipeline expects POSIX absolute paths.
		const absPath = toPosixPath(rawAbsPath);
		if (!discovered.has(absPath)) {
			// Compute relative source path from absolute. Both sides are POSIX
			// at this point, so the slice produces a forward-slash relative path.
			const relPath = absPath.slice(projectRoot.length + 1);
			discovered.set(absPath, relPath);
		}
	}
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
