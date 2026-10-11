/**
 * TypeScript program and language-service creation.
 *
 * Two entry points sharing host configuration (tsconfig parsing, virtual file
 * plumbing, `.svelte` module resolution, svelte2tsx shim roots):
 *
 * - `createAnalysisProgram` — one-shot `ts.Program` from a `ts.CompilerHost`.
 *   Lower-level escape hatch for power users. Does not support incremental
 *   updates.
 * - `createAnalysisLanguageService` — persistent `ts.LanguageService` with
 *   versioned `IScriptSnapshot`s. Incremental: subsequent `getProgram()` calls
 *   reuse parsed ASTs and checker state for unchanged files. Used by
 *   `createAnalysisSession` (in `session.ts`).
 *
 * @see `typescript-exports.ts` for `analyzeExports`, `analyzeDeclaration`
 * @see `typescript-extract-*.ts` for the per-declaration extractors
 * @see `session.ts` for `createAnalysisSession`, the high-level incremental API
 *
 * @module
 */

import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import ts from 'typescript';

import type { AnalysisLog } from './log.ts';
import { SVELTE_VIRTUAL_SUFFIX, isSvelteVirtualPath } from './source.ts';
import { type ModuleSourceOptions, getSourceRoot } from './source-config.ts';
import { toPosixPath } from './paths.ts';
import { compareStrings } from './postprocess.ts';

/**
 * Base configuration shared by every entry point in this module.
 *
 * `projectRoot` + `tsconfig` + `compilerOptions` together drive `loadTsconfig`,
 * which is also exposed publicly. `AnalysisProgramOptions` and
 * `AnalysisLanguageServiceOptions` extend this with their own fields.
 */
export interface LoadTsconfigOptions {
	/**
	 * Absolute path to project root directory.
	 * @default process.cwd()
	 */
	projectRoot?: string;
	/**
	 * Path to tsconfig.json, relative to `projectRoot`; parent directories are
	 * searched when it isn't there. Any config file name works, `jsconfig.json`
	 * included.
	 *
	 * `false` analyzes without a config file: no lookup runs, the compiler
	 * options are `DEFAULT_COMPILER_OPTIONS` with `compilerOptions` merged on
	 * top, and there are no config roots. It's an explicit choice, never a
	 * fallback — a config that's named or defaulted and can't be found still
	 * throws.
	 * @default 'tsconfig.json'
	 */
	tsconfig?: string | false;
	/**
	 * Compiler options merged on top of those parsed from `tsconfig.json`
	 * (per-key override; user-supplied keys win), or on top of
	 * `DEFAULT_COMPILER_OPTIONS` under `tsconfig: false`. Does not by itself
	 * bypass the config file requirement — without `tsconfig: false`,
	 * `loadTsconfig` still throws when no config file is found.
	 */
	compilerOptions?: ts.CompilerOptions;
	/**
	 * The program's root files beyond the analyzed ones, replacing the roots
	 * the tsconfig's `files`/`include` produce (see `RootFileNames`).
	 * @default the tsconfig's roots
	 */
	rootFileNames?: RootFileNames;
}

/**
 * Root files for the analysis program: a list, or a function from the
 * tsconfig's roots to the ones to keep (it receives `[]` under
 * `tsconfig: false`). Paths are absolute or relative to `projectRoot`.
 *
 * By default every file the tsconfig includes is a root, so the cold cost of
 * a program scales with the project — tests, routes, and config files are
 * parsed and bound, along with the packages only they import — however few
 * files are analyzed. The files a session or a one-shot entry analyzes, and
 * their imports, are always in the program (they're roots of their own), so
 * narrowing the roots changes output only where a type reaches a
 * file through no import: an ambient declaration (`declare global`, a
 * `declare module` augmentation, a script-style `.d.ts`) in a file nothing
 * imports. Drop such a root and the types it declares resolve to `any`, with
 * no diagnostic.
 *
 * Keeping the declaration files covers the usual home of ambient types:
 *
 * ```ts
 * rootFileNames: (roots) => roots.filter((file) => file.endsWith('.d.ts'))
 * ```
 *
 * `[]` roots nothing but the analyzed files — the fastest program, for
 * projects known to declare no ambient types.
 */
export type RootFileNames = Array<string> | ((tsconfigRoots: Array<string>) => Array<string>);

/**
 * The compiler options used under `tsconfig: false`, before the caller's
 * `compilerOptions` are merged on top.
 *
 * Set explicitly because the compiler's own defaults vary by TypeScript
 * version, and before TypeScript 6 they are non-strict: without
 * `strictNullChecks` a `string | null` prop prints as `string`.
 * `allowJs`/`checkJs` type the imports of JS-lang components and `.js`
 * modules.
 */
export const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	allowJs: true,
	checkJs: true,
	skipLibCheck: true,
	noEmit: true
};

/**
 * A host-served file entry: content plus optional parser treatment.
 */
export interface VirtualFileEntry {
	content: string;
	/**
	 * Overrides script-kind inference from the path's extension; `undefined`
	 * defers to the extension. JS-lang Svelte virtuals set this to parse as JS
	 * despite their `.ts` suffix; no `allowJs` needed, since virtuals are
	 * host-served.
	 */
	scriptKind?: ts.ScriptKind;
}

/**
 * Ancestor-directory index over a path set, maintained as the set mutates.
 *
 * Module resolution probes `directoryExists` before trying file candidates
 * inside it (`directoryProbablyExists`): a directory reported absent has
 * every candidate recorded as a failed lookup with `fileExists` never
 * consulted, so a directory that exists only as the prefix of served
 * in-memory paths must report present. Refcounted per ancestor so removal is
 * exact — O(path depth) per mutation, O(1) per query; a per-probe scan of the
 * path set would multiply into resolution's hot path (bare-specifier
 * resolution walks many nonexistent ancestor `node_modules` directories per
 * import).
 *
 * The index owns its path set, so `add`/`remove` are idempotent and a caller
 * can't skew the refcounts by double-adding or by removing something it never
 * added (which would drop an ancestor still holding live paths). Membership
 * bookkeeping therefore stays here rather than in each caller's guard.
 *
 * @internal Shared by the one-shot host, the LS host, and the session's
 *   dependency-resolution host; not a stable API.
 */
export interface OwnedDirIndex {
	/** Count `path`'s ancestor directories into the index. Idempotent. */
	add(path: string): void;
	/** Reverse of `add`; a path that isn't indexed is a no-op. */
	remove(path: string): void;
	/** Whether `dir` is an ancestor of any indexed path (trailing slash tolerated). */
	has(dir: string): boolean;
	clear(): void;
}

/** Create an empty `OwnedDirIndex`. @internal */
export const createOwnedDirIndex = (): OwnedDirIndex => {
	const paths = new Set<string>();
	const counts = new Map<string, number>();
	const walk = (path: string, delta: 1 | -1): void => {
		let dir = path;
		while (true) {
			const slash = dir.lastIndexOf('/');
			if (slash <= 0) break;
			dir = dir.slice(0, slash);
			const next = (counts.get(dir) ?? 0) + delta;
			if (next <= 0) counts.delete(dir);
			else counts.set(dir, next);
		}
	};
	return {
		add: (path) => {
			if (paths.has(path)) return;
			paths.add(path);
			walk(path, 1);
		},
		remove: (path) => {
			if (!paths.delete(path)) return;
			walk(path, -1);
		},
		has: (dir) => counts.has(dir.endsWith('/') && dir.length > 1 ? dir.slice(0, -1) : dir),
		clear: () => {
			paths.clear();
			counts.clear();
		}
	};
};

/**
 * Decorate a compiler host so `virtualFiles` shadow the filesystem —
 * `getSourceFile` (honoring per-entry `scriptKind`), `fileExists`, `readFile`,
 * and `directoryExists`.
 *
 * Entries are copied to minimal `{content, scriptKind}` records so the host's
 * closures don't retain larger caller objects (a `SvelteVirtualFile`'s source
 * map, say) for the program's lifetime. The copied map is returned so callers
 * layering module resolution on top (`.svelte` specifier mapping) can key it
 * off the same snapshot instead of re-capturing the caller's map. The entry
 * set is fixed at decoration time — the returned `ReadonlyMap` and the
 * directory index are built in the same pass, so no host answer can be served
 * from a staler view of the set than another (a `LanguageService` is the
 * mutable counterpart; see `createAnalysisLanguageService`).
 *
 * @internal Shared host decoration for `createAnalysisProgram`; exported for
 *   test-side hosts — not a stable API.
 * @mutates host - replaces `getSourceFile`, `fileExists`, `readFile`, and
 *   (when the host defines it) `directoryExists`
 * @returns the copied entries, keyed by path
 */
export const applyVirtualFiles = (
	host: ts.CompilerHost,
	virtualFiles: ReadonlyMap<string, VirtualFileEntry>
): ReadonlyMap<string, VirtualFileEntry> => {
	const originalGetSourceFile = host.getSourceFile;
	const originalFileExists = host.fileExists;
	const originalReadFile = host.readFile;
	// A virtual entry may live in a directory that exists nowhere on disk, so
	// its ancestor chain must report present (see `createOwnedDirIndex` for
	// why resolution never reaches `fileExists` otherwise). A host with no
	// `directoryExists` assumes all directories exist — nothing to fix there,
	// and no index to pay for.
	const originalDirectoryExists = host.directoryExists;
	const virtualDirs = originalDirectoryExists ? createOwnedDirIndex() : undefined;

	const entries = new Map<string, VirtualFileEntry>();
	for (const [path, entry] of virtualFiles) {
		entries.set(path, { content: entry.content, scriptKind: entry.scriptKind });
		virtualDirs?.add(path);
	}

	host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
		const entry = entries.get(fileName);
		if (entry !== undefined) {
			return ts.createSourceFile(fileName, entry.content, languageVersion, true, entry.scriptKind);
		}
		return originalGetSourceFile.call(host, fileName, languageVersion, onError, shouldCreate);
	};

	host.fileExists = (fileName) => {
		if (entries.has(fileName)) return true;
		return originalFileExists.call(host, fileName);
	};

	host.readFile = (fileName) => {
		const entry = entries.get(fileName);
		if (entry !== undefined) return entry.content;
		return originalReadFile.call(host, fileName);
	};

	if (originalDirectoryExists && virtualDirs) {
		host.directoryExists = (directoryName) =>
			virtualDirs.has(directoryName) || originalDirectoryExists.call(host, directoryName);
	}

	return entries;
};

/**
 * Options for `createAnalysisProgram`.
 */
export interface AnalysisProgramOptions extends LoadTsconfigOptions {
	/**
	 * Virtual files to seed the program, keyed by virtual path.
	 *
	 * Used to include svelte2tsx transformed outputs alongside real source files,
	 * enabling full type resolution for Svelte components via the checker.
	 * `SvelteVirtualFile` satisfies the entry shape structurally, so transform
	 * results can be passed as entries directly.
	 *
	 * On a `LanguageService`, virtuals can also be added/replaced/removed after
	 * construction via `setFile` / `deleteFile`.
	 */
	virtualFiles?: Map<string, VirtualFileEntry>;
}

/**
 * Options for `createAnalysisLanguageService`.
 */
export interface AnalysisLanguageServiceOptions extends AnalysisProgramOptions {
	/**
	 * Optional document registry for AST sharing across services.
	 *
	 * Pass an explicit registry to share parsed source files when running
	 * multiple language services (e.g., LSP integration). Defaults to a fresh
	 * registry per service when omitted.
	 */
	documentRegistry?: ts.DocumentRegistry;
}

/**
 * Persistent language-service handle that drives a `ts.Program` incrementally.
 *
 * Owns the LS, document registry, and a `Map<path, {content, version,
 * scriptKind}>` of "owned" files (real source files + virtuals pushed via
 * `setFile`). Files not in the owned map are read from disk on demand by the
 * LS host.
 *
 * Each `setFile(path, entry)` bumps the version when content or script kind
 * differs from cache, so the next `getProgram()` reparses only the changed
 * file. Calling `getProgram()` with no version bumps returns the same
 * `ts.Program` as the previous call (reference-stable when nothing changed).
 *
 * @see `createAnalysisSession` in `session.ts` for the high-level API that
 * wraps this with content cache + svelte virtual cache + analysis pipeline.
 */
export interface AnalysisLanguageService {
	/**
	 * Get the current `ts.Program`.
	 *
	 * Returns the same reference as the previous call when no `setFile` /
	 * `deleteFile` invalidated state in between. Returns a fresh `ts.Program`
	 * (sharing parsed ASTs for unchanged files via the document registry) when
	 * versions changed.
	 *
	 * @throws Error if the underlying LS returned undefined (should not happen
	 *   in practice — TS only returns undefined during initialization)
	 */
	getProgram(): ts.Program;
	/**
	 * The merged compiler options the service was constructed with — parsed
	 * tsconfig with the caller's `compilerOptions` overrides applied per-key.
	 *
	 * Cheap accessor over the construction-time `loadTsconfig` result; prefer
	 * it over `getProgram().getCompilerOptions()` when only the options are
	 * needed — `getProgram()` forces the LS to sync and parse every root file.
	 *
	 * Treat the returned object as read-only: it is the same reference the LS
	 * host serves via `getCompilationSettings`, so mutating it would desync
	 * consumers (e.g., the session's default import resolver) from the checker.
	 */
	getCompilerOptions(): ts.CompilerOptions;
	/**
	 * Set or replace a file's content (real path or virtual path).
	 *
	 * - New file: added to the owned map with version 1.
	 * - Existing file with identical content and script kind: no-op (version unchanged).
	 * - Existing file with new content or script kind: version bumped.
	 *
	 * @returns `true` when the file was added or its version bumped, `false` on no-op.
	 */
	setFile(path: string, entry: VirtualFileEntry): boolean;
	/**
	 * Remove a file from the owned set.
	 *
	 * @returns `true` when the file was tracked, `false` when it was unknown.
	 */
	deleteFile(path: string): boolean;
	/** Whether the given path is currently tracked. */
	hasFile(path: string): boolean;
	/**
	 * Release LS resources.
	 *
	 * Calls `ts.LanguageService.dispose()` and clears the owned map. The
	 * service must not be used after disposal.
	 */
	dispose(): void;
}

// `ts.Diagnostics` isn't in the public typings, so the codes are literals
const TS_FILE_NOT_FOUND = 6053; // `extends` bare specifier that doesn't resolve
const TS_CANNOT_READ_FILE = 5083; // `extends` path that doesn't exist or can't be read
const TS_ROOT_NOT_OBJECT = 5092; // `extends` target whose root value isn't an object

/**
 * Whether a `parseJsonConfigFileContent` diagnostic means a config in the
 * `extends` chain didn't load: a target that's missing or unreadable, one that
 * fails to parse (a syntax diagnostic, TypeScript's 1xxx range), or one whose
 * root isn't an object.
 */
const isConfigChainDiagnostic = (diagnostic: ts.Diagnostic): boolean =>
	diagnostic.category === ts.DiagnosticCategory.Error &&
	(diagnostic.code === TS_FILE_NOT_FOUND ||
		diagnostic.code === TS_CANNOT_READ_FILE ||
		diagnostic.code === TS_ROOT_NOT_OBJECT ||
		(diagnostic.code >= 1000 && diagnostic.code < 2000));

/**
 * Whether a chain diagnostic names a config SvelteKit generates during
 * `svelte-kit sync`: `$app/tsconfig` (SvelteKit 3) or
 * `.svelte-kit/tsconfig.json` (SvelteKit 2). Matched on the specifier alone,
 * not the quotes around it, since localized messages may quote differently.
 */
const isSvelteKitGeneratedConfigMessage = (message: string): boolean =>
	message.includes('$app/') || message.includes('.svelte-kit/tsconfig.json');

const formatConfigDiagnostic = (diagnostic: ts.Diagnostic, configPath: string): string => {
	const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
	const file = diagnostic.file?.fileName;
	const location = file && file !== configPath ? ` in ${file}` : '';
	return `TS${diagnostic.code}${location}: ${message}`;
};

/**
 * Load and parse tsconfig.json into compiler options + initial file list.
 *
 * Shared by `createAnalysisProgram` and `createAnalysisLanguageService` so
 * tsconfig-resolution behavior stays identical across the two paths. Also
 * useful directly when a caller needs only `CompilerOptions` (e.g., import
 * resolution via `ts.resolveModuleName`) without the cost of building a full
 * `ts.Program`.
 *
 * Each call globs the tsconfig `include` to build `rootFileNames`; reuse the
 * result rather than calling per resolve.
 *
 * The config is located like `tsc -p`: `options.tsconfig` relative to
 * `projectRoot`, walking up through parent directories when it isn't there.
 * Relative paths inside it (`extends`, `include`, path-valued options) resolve
 * against the config file's own directory, not `projectRoot`.
 *
 * A config that can't be fully loaded throws rather than analyzing with a
 * partial config: TypeScript reports a missing `extends` target as a
 * diagnostic and carries on without the inherited options (`lib`, `types`,
 * `paths`, `rootDirs`), so external types would silently degrade to `any`.
 * SvelteKit's generated config is the common case (`$app/tsconfig`, or
 * `.svelte-kit/tsconfig.json` before SvelteKit 3) — it exists only after
 * `svelte-kit sync`. Option-level diagnostics (an unknown option, a bad
 * value) and an `include` matching no files don't throw: TypeScript still
 * applies the rest of the config, and the project's own typecheck reports
 * them.
 *
 * Under `tsconfig: false` no file is read: the options are
 * `DEFAULT_COMPILER_OPTIONS` with `options.compilerOptions` merged on top, and
 * the config contributes no roots. `options.rootFileNames` then replaces or
 * filters the roots either way (see `RootFileNames`).
 *
 * @throws Error if tsconfig.json (or the file named by `options.tsconfig`) is
 *   not found or fails to parse, or a config in its `extends` chain is missing
 *   or fails to parse. A missing SvelteKit-generated target adds a hint to run
 *   `svelte-kit sync`.
 */
export const loadTsconfig = (
	options?: LoadTsconfigOptions,
	log?: AnalysisLog
): { compilerOptions: ts.CompilerOptions; rootFileNames: Array<string> } => {
	const projectRoot = options?.projectRoot ?? process.cwd();

	if (options?.tsconfig === false) {
		log?.info('analyzing without a tsconfig');
		return {
			compilerOptions: { ...DEFAULT_COMPILER_OPTIONS, ...options.compilerOptions },
			rootFileNames: resolveRootFileNames(options.rootFileNames, [], projectRoot)
		};
	}
	const tsconfigName = options?.tsconfig ?? 'tsconfig.json';

	const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, tsconfigName);
	if (!configPath) {
		throw new Error(`No ${tsconfigName} found in ${projectRoot} or its parent directories`);
	}

	log?.info(`using ${configPath}`);

	const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
	if (configFile.error) {
		throw new Error(
			`Failed to read ${configPath}: ${formatConfigDiagnostic(configFile.error, configPath)}`
		);
	}
	// base path = the config's own dir (as `tsc -p` does), so relative
	// `extends`/`include` still resolve when the config was found by walking up
	// or `options.tsconfig` names a file in a subdirectory
	const parsedConfig = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		dirname(configPath),
		undefined,
		configPath
	);

	const chainErrors = parsedConfig.errors.filter(isConfigChainDiagnostic);
	if (chainErrors.length > 0) {
		const messages = chainErrors.map((d) => formatConfigDiagnostic(d, configPath));
		// the diagnostic text names the unresolved target, e.g. `File '$app/tsconfig' not found.`
		const hint = messages.some(isSvelteKitGeneratedConfigMessage)
			? ' SvelteKit generates its tsconfig: run `svelte-kit sync` (or `gro sync`) first.'
			: '';
		throw new Error(
			`Failed to load the extends chain of ${configPath}: ${messages.join(' ')}${hint}`
		);
	}

	const compilerOptions = options?.compilerOptions
		? { ...parsedConfig.options, ...options.compilerOptions }
		: parsedConfig.options;

	return {
		compilerOptions,
		rootFileNames: resolveRootFileNames(options?.rootFileNames, parsedConfig.fileNames, projectRoot)
	};
};

/**
 * Apply a `RootFileNames` option to the tsconfig's roots: absent keeps them,
 * a list replaces them, a function maps them. Results are POSIX and absolute
 * (relative entries resolve against `projectRoot`), like every path the
 * program hosts key on.
 */
const resolveRootFileNames = (
	option: RootFileNames | undefined,
	tsconfigRoots: Array<string>,
	projectRoot: string
): Array<string> => {
	if (option === undefined) return tsconfigRoots;
	const roots = typeof option === 'function' ? option([...tsconfigRoots]) : option;
	return roots.map((file) => toPosixPath(resolve(projectRoot, file)));
};

/**
 * Resolve `.svelte` import specifiers to their virtual `.__svelte2tsx__.ts` paths.
 *
 * Shared between the `CompilerHost` and `LanguageServiceHost` paths so cross-Svelte
 * re-exports (`export {X} from './Other.svelte'`) work uniformly. Returns `undefined`
 * for non-Svelte specifiers; the caller falls back to default module resolution.
 */
const resolveSvelteVirtualSpecifier = (
	specifier: string,
	containingFile: string,
	hasVirtual: (path: string) => boolean
): ts.ResolvedModuleFull | undefined => {
	if (!specifier.startsWith('.') || !specifier.endsWith('.svelte')) return undefined;
	// `join`/`dirname` return native separators on Windows. Posixify so the
	// `hasVirtual` lookup hits the POSIX-keyed virtual map populated by
	// session ingest.
	const resolved = toPosixPath(join(dirname(containingFile), specifier)) + SVELTE_VIRTUAL_SUFFIX;
	if (!hasVirtual(resolved)) return undefined;
	return {
		resolvedFileName: resolved,
		isExternalLibraryImport: false,
		extension: ts.Extension.Ts
	};
};

/**
 * Build the `resolveModuleNameLiterals` hook shared by the `CompilerHost` and
 * `LanguageServiceHost` paths: `.svelte` specifiers map to owned virtuals via
 * `resolveSvelteVirtualSpecifier`; everything else falls through to
 * `ts.resolveModuleName` against `resolutionHost`.
 */
const createResolveModuleNameLiterals =
	(
		hasVirtual: (path: string) => boolean,
		resolutionHost: ts.ModuleResolutionHost
	): NonNullable<ts.LanguageServiceHost['resolveModuleNameLiterals']> =>
	(literals, containingFile, _redirected, options) =>
		literals.map((literal) => {
			const resolved = resolveSvelteVirtualSpecifier(literal.text, containingFile, hasVirtual);
			if (resolved) return { resolvedModule: resolved };
			return ts.resolveModuleName(literal.text, containingFile, options, resolutionHost);
		});

/**
 * svelte2tsx's ambient declarations for the code it generates, as file names
 * in the package root. They're joined onto the directory of the package's main
 * entry (the package root) rather than resolved as subpath specifiers, which an
 * `exports` map that doesn't list them would block. A layout change shows up as
 * the shim tests failing, with component types back to `any`.
 *
 * Every Svelte virtual calls helpers that only these declare — the component
 * export is `__sveltets_2_fn_component($$render())`, beside
 * `__sveltets_$$bindings`, `__sveltets_2_ensureSnippet`, and friends. Without
 * them those names don't resolve, so each component's default export is `any`,
 * and so is everything typed through one (`typeof Button`,
 * `ComponentProps<typeof Button>['variant']`) in a `.svelte` or `.ts` module.
 * Props extraction is unaffected either way: it reads the `$props()`
 * annotation, not the component's type.
 *
 * Only the `-v4` shims, the set svelte2tsx emits against for Svelte 4 and up
 * (`svelte.ts` enforces Svelte 5). The template-side `svelteHTML` namespace
 * (`svelte-jsx-v4.d.ts`, or `svelte/svelte-html.d.ts`, which svelte-check
 * roots in its place for Svelte 5) is deliberately left out: template
 * expressions live as statements inside `$$render`'s body, so they never reach
 * a documented type, and that file's `/// <reference lib="dom" />` would add
 * the DOM lib to projects whose `lib` doesn't have it, changing what their
 * own globals resolve to. The unresolved `svelteHTML` calls only produce
 * checker errors in the virtuals, which analysis never reads.
 */
const SVELTE_SHIM_FILE_NAMES = ['svelte-shims-v4.d.ts'];

let svelteShimPaths: ReadonlyArray<string> | undefined;

/** The shim files' POSIX paths, resolved once and cached (see `getSvelteShimRoots`). */
const resolveSvelteShimPaths = (): ReadonlyArray<string> => {
	if (!svelteShimPaths) {
		const packageRoot = dirname(createRequire(import.meta.url).resolve('svelte2tsx'));
		svelteShimPaths = SVELTE_SHIM_FILE_NAMES.map((n) => toPosixPath(join(packageRoot, n)));
	}
	return svelteShimPaths;
};

/**
 * Whether a file is one of the svelte2tsx shims `getSvelteShimRoots` roots,
 * compared by the same resolved path rather than by file name. The `TypeJson`
 * builder reads it to treat a shim-declared svelte2tsx alias as nameless
 * (`linkableAliasSymbol` in `typescript-extract-type-json.ts`).
 *
 * @param fileName - a POSIX path, as `ts.SourceFile.fileName` holds it
 * @internal Not a stable API.
 */
export const isSvelteShimPath = (fileName: string): boolean =>
	resolveSvelteShimPaths().includes(fileName);

/**
 * The program roots svelte2tsx's shims add to a program over `paths`: the shim
 * files when any path is a Svelte virtual, otherwise none, so TS-only programs
 * keep exactly their tsconfig roots and globals.
 *
 * Callers put these first in the root list, ahead of the tsconfig roots.
 *
 * - **Resolution** — the `svelte2tsx` main entry, resolved from svelte-docinfo's
 *   own location (the lookup `svelte.ts`'s `svelte2tsx` import makes), whose
 *   directory is the package root holding the shims. So the shims always match
 *   the copy that generated the virtuals; the helper signatures change in
 *   lockstep with the emitted calls. Resolved once and cached, as POSIX paths.
 * - **A project that also roots the shims** (a tsconfig `include`, or a
 *   triple-slash reference) — the same file dedupes by path. A different copy
 *   (another installed svelte2tsx) declares the same globals twice, and no
 *   single copy wins: a duplicate type alias keeps its first declaration (ours,
 *   rooted first), while duplicate functions merge into one overload set
 *   whose resolution order doesn't follow root order. The duplicate-identifier
 *   errors land in files analysis never reads, but where the two copies
 *   disagree a component's type can mix them. svelte2tsx renames a helper (the
 *   `__sveltets_2_` prefix) when its shape changes incompatibly, which keeps
 *   that rare; it's not detected.
 * - **Shim globals are project-visible** — beside the `__sveltets_` helpers,
 *   the shims declare unprefixed global types (`Expand`, `KeysMatching`,
 *   `SvelteStore`, and others). A project global of the same name collides,
 *   and the shim's declaration wins, being rooted first, so a `.ts` module
 *   typed through that global documents the shim's meaning.
 * - **Never documented** — the files resolve under `node_modules`, so they're
 *   external (`createIsExternalFile`), never `isSource`, and outside the alias
 *   registry. As global scripts they never print as `typeof import("…")`, so
 *   `normalizeModulePathsInTypes` never sees them.
 * - **Order** — a fixed list, so the language service's root-list comparison
 *   still reuses the program when nothing changed. Resolving the helpers can
 *   move when the checker first creates a type, which reorders an origin-less
 *   union printed elsewhere (see `compareStrings` on input order).
 *
 * @internal Shared by both program paths and the test-side program helpers;
 *   not a stable API.
 */
export const getSvelteShimRoots = (paths: Iterable<string>): ReadonlyArray<string> => {
	for (const path of paths) {
		if (isSvelteVirtualPath(path)) return resolveSvelteShimPaths();
	}
	return [];
};

/**
 * A program's root list: the Svelte shims for `extraRoots` (see
 * `getSvelteShimRoots`), then `tsconfigRoots`, then `extraRoots`, deduped by
 * path with first occurrence kept. Dedupe covers an extra root the tsconfig
 * also roots, and a shim the tsconfig (or a caller) roots itself.
 *
 * Callers own the order of `extraRoots`; the language-service path passes its
 * owned roots sorted, so the list is a function of the file set.
 *
 * @param tsconfigRoots - the tsconfig's root file names
 * @param extraRoots - roots beyond the tsconfig's, virtual files included
 * @returns a fresh array
 * @internal Shared by both program paths and the test-side program helpers;
 *   not a stable API.
 */
export const buildRootFileNames = (
	tsconfigRoots: Iterable<string>,
	extraRoots: ReadonlyArray<string>
): Array<string> => [
	...new Set([...getSvelteShimRoots(extraRoots), ...tsconfigRoots, ...extraRoots])
];

/**
 * Create TypeScript program for one-shot analysis.
 *
 * Use `createAnalysisLanguageService` instead when you need to analyze the
 * same source set multiple times — the LS path reuses parsed ASTs and checker
 * state across calls.
 *
 * @param options - configuration options for program creation
 * @param log - optional logger for info messages
 * @returns the TypeScript program
 * @throws Error if the tsconfig can't be loaded (see `loadTsconfig`)
 *
 * @example
 * ```ts
 * const program = createAnalysisProgram({projectRoot: process.cwd()});
 * ```
 */
export const createAnalysisProgram = (
	options?: AnalysisProgramOptions,
	log?: AnalysisLog
): ts.Program => {
	const { compilerOptions, rootFileNames } = loadTsconfig(options, log);
	const virtualFiles = options?.virtualFiles;

	if (!virtualFiles || virtualFiles.size === 0) {
		return ts.createProgram(rootFileNames, compilerOptions);
	}

	// virtual file paths alongside real files, Svelte shims first
	const allRootFiles = buildRootFileNames(rootFileNames, [...virtualFiles.keys()]);

	const host = ts.createCompilerHost(compilerOptions);
	// Resolution keys off the copied snapshot, not the caller's map — same
	// view as the file-serving hooks, and no `SvelteVirtualFile` retention.
	const entries = applyVirtualFiles(host, virtualFiles);
	host.resolveModuleNameLiterals = createResolveModuleNameLiterals((p) => entries.has(p), host);

	return ts.createProgram(allRootFiles, compilerOptions, host);
};

/**
 * Create a persistent language service for incremental analysis.
 *
 * The LS owns parsed source ASTs and checker state across calls. Use the
 * returned handle to push file-content updates (`setFile` / `deleteFile`)
 * between analysis passes; subsequent `getProgram()` calls return either the
 * same `ts.Program` (no changes since last call) or a fresh one that reuses
 * unchanged files via the document registry.
 *
 * @param options - configuration options
 * @param log - optional logger for info messages
 * @returns the language service handle
 * @throws Error if the tsconfig can't be loaded (see `loadTsconfig`)
 *
 * @example
 * ```ts
 * const ls = createAnalysisLanguageService({projectRoot});
 * ls.setFile('/abs/path/to/foo.ts', {content: 'export const x = 1;'});
 * const program = ls.getProgram();
 * // ... use program ...
 * ls.setFile('/abs/path/to/foo.ts', {content: 'export const x = 2;'}); // bumps version
 * const program2 = ls.getProgram(); // fresh program, foo.ts reparsed
 * ls.dispose();
 * ```
 */
export const createAnalysisLanguageService = (
	options?: AnalysisLanguageServiceOptions,
	log?: AnalysisLog
): AnalysisLanguageService => {
	const projectRoot = options?.projectRoot ?? process.cwd();
	const { compilerOptions, rootFileNames } = loadTsconfig(options, log);
	const documentRegistry = options?.documentRegistry ?? ts.createDocumentRegistry();

	interface OwnedFile extends VirtualFileEntry {
		version: number;
		snapshot: ts.IScriptSnapshot;
	}
	const owned = new Map<string, OwnedFile>();
	// Ancestor directories of the owned set, kept in lockstep by
	// `setFileInternal`/`deleteFile` — see `createOwnedDirIndex`.
	const ownedDirs = createOwnedDirIndex();
	// Root file names from the tsconfig (or the `rootFileNames` option) — kept
	// as a Set for fast membership checks during deleteFile (so a deleted owned
	// file that was *also* a configured root stays in the program's root set,
	// falling through to disk).
	const tsconfigRoots = new Set<string>(rootFileNames);
	// Virtual roots (e.g., `.__svelte2tsx__.ts` paths) added via `setFile`.
	// Tracked separately so `deleteFile` can drop them from the LS's root list.
	const ownedRoots = new Set<string>();

	const setFileInternal = (path: string, entry: VirtualFileEntry): boolean => {
		const existing = owned.get(path);
		// Script-kind change with identical content still bumps — a `.svelte`
		// file flipping `lang` must reparse under the new kind.
		if (
			existing &&
			existing.content === entry.content &&
			existing.scriptKind === entry.scriptKind
		) {
			return false;
		}
		ownedDirs.add(path);
		owned.set(path, {
			content: entry.content,
			version: existing ? existing.version + 1 : 1,
			snapshot: ts.ScriptSnapshot.fromString(entry.content),
			scriptKind: entry.scriptKind
		});
		if (!tsconfigRoots.has(path)) ownedRoots.add(path);
		return true;
	};

	// Seed initial virtuals from options. Common path for one-shot callers.
	if (options?.virtualFiles) {
		for (const [path, entry] of options.virtualFiles) {
			setFileInternal(path, entry);
		}
	}

	// Combined module-resolution host — used both as the LS host's resolution
	// surface and (cast) as the fallback host for `ts.resolveModuleName`. Owned
	// content takes precedence over `ts.sys` so virtuals resolve correctly.
	const moduleResolutionHost: ts.ModuleResolutionHost = {
		fileExists: (path) => owned.has(path) || ts.sys.fileExists(path),
		readFile: (path) => {
			const entry = owned.get(path);
			if (entry) return entry.content;
			return ts.sys.readFile(path);
		},
		// Owned files may live in directories that exist nowhere on disk
		// (virtuals, unsaved buffers) — see `createOwnedDirIndex` for why the
		// answer must come from the owned set as well as the disk.
		directoryExists: (path) => ownedDirs.has(path) || ts.sys.directoryExists(path),
		getCurrentDirectory: () => projectRoot,
		getDirectories: ts.sys.getDirectories,
		realpath: ts.sys.realpath,
		useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
	};

	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => compilerOptions,
		getScriptFileNames: () => {
			// Combine tsconfig roots with owned virtual roots. Set semantics
			// dedupe when an owned file was also a tsconfig root. Owned roots
			// are sorted rather than kept in ingest order: root order sets the
			// program's file order, and with it the merge order of
			// `declare global`, module augmentations, and interface merging.
			// The LS compares root lists by content, so a stable sort keeps
			// program reuse intact.
			// Svelte shims lead (see `getSvelteShimRoots`), joining with the
			// first owned virtual and leaving with the last.
			if (ownedRoots.size === 0) return [...tsconfigRoots];
			return buildRootFileNames(tsconfigRoots, [...ownedRoots].sort(compareStrings));
		},
		getScriptVersion: (fileName) => {
			const entry = owned.get(fileName);
			// External / disk-only files: stable version. We don't watch them;
			// the LS reads them once into the document registry. The sentinel is
			// non-numeric so it can never collide with an owned version — owned
			// versions start at 1, and the LS/document registry reparse only on a
			// version-string *change*, so a colliding constant would make the
			// first `setFile` of a previously-disk-resolved file a silent no-op
			// (stale AST served despite new content).
			return entry ? String(entry.version) : 'disk';
		},
		getScriptSnapshot: (fileName) => {
			const entry = owned.get(fileName);
			if (entry) return entry.snapshot;
			if (!ts.sys.fileExists(fileName)) return undefined;
			const content = ts.sys.readFile(fileName);
			if (content === undefined) return undefined;
			return ts.ScriptSnapshot.fromString(content);
		},
		getCurrentDirectory: () => projectRoot,
		getDefaultLibFileName: ts.getDefaultLibFilePath,
		// `ScriptKind.Unknown` (0) is falsy, so `ensureScriptKind` falls back to
		// extension inference for files without an override — the pre-hook default.
		getScriptKind: (fileName) => owned.get(fileName)?.scriptKind ?? ts.ScriptKind.Unknown,
		fileExists: moduleResolutionHost.fileExists,
		readFile: moduleResolutionHost.readFile,
		directoryExists: moduleResolutionHost.directoryExists,
		getDirectories: moduleResolutionHost.getDirectories,
		readDirectory: ts.sys.readDirectory,
		realpath: moduleResolutionHost.realpath,
		useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
		resolveModuleNameLiterals: createResolveModuleNameLiterals(
			(p) => owned.has(p),
			moduleResolutionHost
		)
	};

	const ls = ts.createLanguageService(host, documentRegistry);

	const getProgram = (): ts.Program => {
		const program = ls.getProgram();
		if (!program) {
			throw new Error('LanguageService.getProgram() returned undefined');
		}
		return program;
	};

	const getCompilerOptions = (): ts.CompilerOptions => compilerOptions;

	const setFile = (path: string, entry: VirtualFileEntry): boolean => setFileInternal(path, entry);

	const deleteFile = (path: string): boolean => {
		const removed = owned.delete(path);
		ownedDirs.remove(path);
		ownedRoots.delete(path);
		return removed;
	};

	const hasFile = (path: string): boolean => owned.has(path);

	const dispose = (): void => {
		ls.dispose();
		owned.clear();
		ownedDirs.clear();
		ownedRoots.clear();
	};

	return { getProgram, getCompilerOptions, setFile, deleteFile, hasFile, dispose };
};

/**
 * Predicate for determining whether a TypeScript source file is external to the project.
 * Used by external-contribution filtering (`filterDocumentedProperties` and the
 * index/call-signature origin checks) and `externalTypes` attribution to separate
 * project-authored contributions from library/framework ones.
 *
 * Built by `createIsExternalFile`, which defines externality.
 */
export type IsExternalFile = (sourceFile: ts.SourceFile) => boolean;

/** The project/source prefixes both externality predicates compare against. */
const externalityPrefixes = (
	options: ModuleSourceOptions
): { projectPrefix: string; sourcePrefix: string } => {
	const projectPrefix = options.projectRoot + '/';
	const effectiveRoot = getSourceRoot(options);
	return {
		projectPrefix,
		sourcePrefix: effectiveRoot ? projectPrefix + effectiveRoot + '/' : projectPrefix
	};
};

/**
 * Create an `IsExternalFile` predicate from `ModuleSourceOptions`.
 *
 * A file is external if it is:
 * - Outside the project root
 * - Inside `node_modules/`
 * - A `.d.ts` declaration file outside the source root (catches framework-generated
 *   declarations like `.svelte-kit/non-ambient.d.ts` while keeping user `.d.ts` files
 *   in the source tree)
 */
export const createIsExternalFile = (options: ModuleSourceOptions): IsExternalFile => {
	const { projectPrefix, sourcePrefix } = externalityPrefixes(options);
	return (sf) =>
		!sf.fileName.startsWith(projectPrefix) ||
		sf.fileName.includes('/node_modules/') ||
		(sf.isDeclarationFile && !sf.fileName.startsWith(sourcePrefix));
};

/** Declaration-file suffixes — the path-string stand-in for `isDeclarationFile`. */
const DECLARATION_FILE_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'];

/**
 * Path-string counterpart of `IsExternalFile`, for call sites that hold a
 * file path rather than a `ts.SourceFile` (re-export classification). Same
 * rule, with declaration-file suffixes standing in for `isDeclarationFile`.
 *
 * Deliberately distinct from `isSource`: `isSource` answers "does this file
 * emit a module?" while this answers "is this file outside the project?" —
 * an in-root file can fail `isSource` (the `src/lib/internal/` convention,
 * user excludes) while remaining project-local, and conflating the two
 * mis-files project-local re-exports as external-package facts.
 */
export const createIsExternalPath = (options: ModuleSourceOptions): ((file: string) => boolean) => {
	const { projectPrefix, sourcePrefix } = externalityPrefixes(options);
	return (file) =>
		!file.startsWith(projectPrefix) ||
		file.includes('/node_modules/') ||
		(DECLARATION_FILE_SUFFIXES.some((suffix) => file.endsWith(suffix)) &&
			!file.startsWith(sourcePrefix));
};
