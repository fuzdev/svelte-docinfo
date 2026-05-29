/**
 * TypeScript program and language-service creation.
 *
 * Two entry points sharing host configuration (tsconfig parsing, virtual file
 * plumbing, `.svelte` module resolution):
 *
 * - `createAnalysisProgram` — one-shot `ts.Program` from a `ts.CompilerHost`.
 *   Lower-level escape hatch for power users + dependency resolution. Does not
 *   support incremental updates.
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

import {join, dirname} from 'node:path';
import ts from 'typescript';

import type {AnalysisLog} from './log.js';
import {SVELTE_VIRTUAL_SUFFIX} from './source.js';
import {type ModuleSourceOptions, getSourceRoot} from './source-config.js';
import {toPosixPath} from './paths.js';

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
	 * Path to tsconfig.json (relative to `projectRoot`).
	 * @default 'tsconfig.json'
	 */
	tsconfig?: string;
	/**
	 * Compiler options merged on top of those parsed from `tsconfig.json`
	 * (per-key override; user-supplied keys win). Does not bypass the
	 * `tsconfig.json` file requirement — `loadTsconfig` still throws when no
	 * config file is found.
	 */
	compilerOptions?: ts.CompilerOptions;
}

/**
 * Options for `createAnalysisProgram`.
 */
export interface AnalysisProgramOptions extends LoadTsconfigOptions {
	/**
	 * Virtual files to seed the program (maps virtual path to content).
	 *
	 * Used to include svelte2tsx transformed outputs alongside real source files,
	 * enabling full type resolution for Svelte components via the checker.
	 *
	 * On a `LanguageService`, virtuals can also be added/replaced/removed after
	 * construction via `setFile` / `deleteFile`.
	 */
	virtualFiles?: Map<string, string>;
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
 * Owns the LS, document registry, and a `Map<path, {content, version}>` of
 * "owned" files (real source files + virtuals pushed via `setFile`). Files
 * not in the owned map are read from disk on demand by the LS host.
 *
 * Each `setFile(path, content)` bumps the version when content differs from
 * cache, so the next `getProgram()` reparses only the changed file. Calling
 * `getProgram()` with no version bumps returns the same `ts.Program` as the
 * previous call (reference-stable when nothing changed).
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
	 * Set or replace a file's content (real path or virtual path).
	 *
	 * - New file: added to the owned map with version 1.
	 * - Existing file with identical content: no-op (version unchanged).
	 * - Existing file with new content: version bumped.
	 *
	 * @returns `true` when the file was added or its version bumped, `false` on no-op.
	 */
	setFile(path: string, content: string): boolean;
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

/**
 * Load and parse tsconfig.json into compiler options + initial file list.
 *
 * Shared by `createAnalysisProgram` and `createAnalysisLanguageService` so
 * tsconfig-resolution behavior stays identical across the two paths. Also
 * useful directly when a caller needs only `CompilerOptions` (e.g., import
 * resolution via `ts.resolveModuleName`) without the cost of building a full
 * `ts.Program`.
 *
 * @throws Error if tsconfig.json (or the requested `tsconfigName`) is not found.
 */
export const loadTsconfig = (
	options?: LoadTsconfigOptions,
	log?: AnalysisLog,
): {compilerOptions: ts.CompilerOptions; rootFileNames: Array<string>} => {
	const projectRoot = options?.projectRoot ?? process.cwd();
	const tsconfigName = options?.tsconfig ?? 'tsconfig.json';

	const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, tsconfigName);
	if (!configPath) {
		throw new Error(`No ${tsconfigName} found in ${projectRoot}`);
	}

	log?.info(`using ${configPath}`);

	const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);

	const compilerOptions = options?.compilerOptions
		? {...parsedConfig.options, ...options.compilerOptions}
		: parsedConfig.options;

	return {compilerOptions, rootFileNames: parsedConfig.fileNames};
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
	hasVirtual: (path: string) => boolean,
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
		extension: ts.Extension.Ts,
	};
};

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
 * @throws Error if tsconfig.json is not found
 *
 * @example
 * ```ts
 * const program = createAnalysisProgram({projectRoot: process.cwd()});
 * ```
 */
export const createAnalysisProgram = (
	options?: AnalysisProgramOptions,
	log?: AnalysisLog,
): ts.Program => {
	const {compilerOptions, rootFileNames} = loadTsconfig(options, log);
	const virtualFiles = options?.virtualFiles;

	if (!virtualFiles || virtualFiles.size === 0) {
		return ts.createProgram(rootFileNames, compilerOptions);
	}

	// Include virtual file paths alongside real files
	const allRootFiles = [...rootFileNames, ...virtualFiles.keys()];

	const host = ts.createCompilerHost(compilerOptions);
	const originalGetSourceFile = host.getSourceFile;
	const originalFileExists = host.fileExists;
	const originalReadFile = host.readFile;

	host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
		const virtualContent = virtualFiles.get(fileName);
		if (virtualContent !== undefined) {
			return ts.createSourceFile(fileName, virtualContent, languageVersion, true);
		}
		return originalGetSourceFile.call(host, fileName, languageVersion, onError, shouldCreate);
	};

	host.fileExists = (fileName) => {
		if (virtualFiles.has(fileName)) return true;
		return originalFileExists.call(host, fileName);
	};

	host.readFile = (fileName) => {
		const virtualContent = virtualFiles.get(fileName);
		if (virtualContent !== undefined) return virtualContent;
		return originalReadFile.call(host, fileName);
	};

	host.resolveModuleNameLiterals = (literals, containingFile, _redirected, optionsInner) => {
		return literals.map((literal) => {
			const resolved = resolveSvelteVirtualSpecifier(literal.text, containingFile, (p) =>
				virtualFiles.has(p),
			);
			if (resolved) return {resolvedModule: resolved};
			return ts.resolveModuleName(literal.text, containingFile, optionsInner, host);
		});
	};

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
 * @throws Error if tsconfig.json is not found
 *
 * @example
 * ```ts
 * const ls = createAnalysisLanguageService({projectRoot});
 * ls.setFile('/abs/path/to/foo.ts', 'export const x = 1;');
 * const program = ls.getProgram();
 * // ... use program ...
 * ls.setFile('/abs/path/to/foo.ts', 'export const x = 2;'); // bumps version
 * const program2 = ls.getProgram(); // fresh program, foo.ts reparsed
 * ls.dispose();
 * ```
 */
export const createAnalysisLanguageService = (
	options?: AnalysisLanguageServiceOptions,
	log?: AnalysisLog,
): AnalysisLanguageService => {
	const projectRoot = options?.projectRoot ?? process.cwd();
	const {compilerOptions, rootFileNames} = loadTsconfig(options, log);
	const documentRegistry = options?.documentRegistry ?? ts.createDocumentRegistry();

	interface OwnedFile {
		content: string;
		version: number;
		snapshot: ts.IScriptSnapshot;
	}
	const owned = new Map<string, OwnedFile>();
	// Root file names from tsconfig — kept as a Set for fast membership checks
	// during deleteFile (so a deleted owned file that was *also* in tsconfig
	// stays in the program's root set, falling through to disk).
	const tsconfigRoots = new Set<string>(rootFileNames);
	// Virtual roots (e.g., `.__svelte2tsx__.ts` paths) added via `setFile`.
	// Tracked separately so `deleteFile` can drop them from the LS's root list.
	const ownedRoots = new Set<string>();

	const setFileInternal = (path: string, content: string): boolean => {
		const existing = owned.get(path);
		if (existing && existing.content === content) return false;
		owned.set(path, {
			content,
			version: existing ? existing.version + 1 : 1,
			snapshot: ts.ScriptSnapshot.fromString(content),
		});
		if (!tsconfigRoots.has(path)) ownedRoots.add(path);
		return true;
	};

	// Seed initial virtuals from options. Common path for one-shot callers.
	if (options?.virtualFiles) {
		for (const [path, content] of options.virtualFiles) {
			setFileInternal(path, content);
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
		directoryExists: ts.sys.directoryExists,
		getCurrentDirectory: () => projectRoot,
		getDirectories: ts.sys.getDirectories,
		realpath: ts.sys.realpath,
		useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
	};

	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => compilerOptions,
		getScriptFileNames: () => {
			// Combine tsconfig roots with owned virtual roots. Set semantics
			// dedupe when an owned file was also a tsconfig root.
			if (ownedRoots.size === 0) return [...tsconfigRoots];
			const combined = new Set(tsconfigRoots);
			for (const path of ownedRoots) combined.add(path);
			return [...combined];
		},
		getScriptVersion: (fileName) => {
			const entry = owned.get(fileName);
			// External / disk-only files: stable version. We don't watch them;
			// the LS reads them once into the document registry.
			return entry ? String(entry.version) : '1';
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
		fileExists: moduleResolutionHost.fileExists,
		readFile: moduleResolutionHost.readFile,
		directoryExists: moduleResolutionHost.directoryExists,
		getDirectories: moduleResolutionHost.getDirectories,
		readDirectory: ts.sys.readDirectory,
		realpath: moduleResolutionHost.realpath,
		useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
		resolveModuleNameLiterals: (literals, containingFile, _redirected, optionsInner) => {
			return literals.map((literal) => {
				const resolved = resolveSvelteVirtualSpecifier(literal.text, containingFile, (p) =>
					owned.has(p),
				);
				if (resolved) return {resolvedModule: resolved};
				return ts.resolveModuleName(
					literal.text,
					containingFile,
					optionsInner,
					moduleResolutionHost,
				);
			});
		},
	};

	const ls = ts.createLanguageService(host, documentRegistry);

	const getProgram = (): ts.Program => {
		const program = ls.getProgram();
		if (!program) {
			throw new Error('LanguageService.getProgram() returned undefined');
		}
		return program;
	};

	const setFile = (path: string, content: string): boolean => setFileInternal(path, content);

	const deleteFile = (path: string): boolean => {
		const removed = owned.delete(path);
		ownedRoots.delete(path);
		return removed;
	};

	const hasFile = (path: string): boolean => owned.has(path);

	const dispose = (): void => {
		ls.dispose();
		owned.clear();
		ownedRoots.clear();
	};

	return {getProgram, setFile, deleteFile, hasFile, dispose};
};

/**
 * Predicate for determining whether a TypeScript source file is external to the project.
 * Used by intersection type filtering to separate user-authored properties from
 * library/framework properties.
 *
 * Constructed from `ModuleSourceOptions` at analysis entry points — files under the
 * source root (e.g., `src/lib/`) are internal, everything else is external.
 */
export type IsExternalFile = (sourceFile: ts.SourceFile) => boolean;

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
	const projectPrefix = options.projectRoot + '/';
	const effectiveRoot = getSourceRoot(options);
	const sourcePrefix = effectiveRoot ? projectPrefix + effectiveRoot + '/' : projectPrefix;
	return (sf) =>
		!sf.fileName.startsWith(projectPrefix) ||
		sf.fileName.includes('/node_modules/') ||
		(sf.isDeclarationFile && !sf.fileName.startsWith(sourcePrefix));
};
