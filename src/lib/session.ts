/**
 * Persistent analysis session — δ-shaped API over a `ts.LanguageService`.
 *
 * Maps cleanly onto LSP and Vite/HMR consumers:
 *
 * - `setFile` / `setFiles` — additive ingest; transform-if-Svelte, lex
 *   specifiers, resolve imports (parallel), push content/virtual to the LS.
 *   Returns ingest-time diagnostics + a `changed` flag. Cache-hit no-op
 *   when content matches AND the mode-specific cache key matches (resolver
 *   identity for lex+resolve, dependency-snapshot equality for pre-resolved).
 * - `deleteFile` — drop owned entry, evict from LS.
 * - `has` / `list` — owned-set introspection (covers what consumers used to
 *   get from their own mirror caches).
 * - `query` — sync analysis pass against the current owned set; returns
 *   analysis-pass diagnostics only (ingest diagnostics surface via the
 *   `setFile`/`setFiles` returns).
 * - `dispose` — release LS resources.
 *
 * The session owns a single `Map<id, OwnedEntry>` covering content, svelte
 * virtuals, unfiltered deps, the mode-specific cache key (resolver identity
 * or pre-resolved snapshot), and ingest-time diagnostics. svelte2tsx runs
 * at most once per content change. Resolver work parallelizes across the
 * batch in phase 2 of the three-phase setFiles pipeline; fully pre-resolved
 * batches skip phase 2 (and the default-resolver construction) entirely.
 *
 * @see `analyze-core.ts` for the two-phase analysis orchestrator
 * @see `dep-resolver.ts` for the `ImportResolver` token contract
 *
 * @module
 */

import {
	createAnalysisLanguageService,
	loadTsconfig,
	type AnalysisLanguageService,
	type AnalysisLanguageServiceOptions,
} from './typescript-program.js';
import type {Diagnostic} from './diagnostics.js';
import {to_error_message} from './error.js';
import type {AnalysisLog} from './log.js';
import {transformSvelteSource, type SvelteVirtualFile} from './svelte.js';
import {
	type ImportResolver,
	type ResolveImport,
	createDefaultResolver,
	ensureLexerReady,
	isNodeBuiltin,
	lexImports,
	normalizeResolveImport,
} from './dep-resolver.js';
import type {SourceFileInfo} from './source.js';
import {type ModuleSourceOptions, isSource, normalizeSourceOptions} from './source-config.js';
import {toPosixPath} from './paths.js';
import {MAX_RESOLVE_CONCURRENCY, map_concurrent} from './concurrency.js';
import {
	analyzeCore,
	normalizeDiagnosticPaths,
	AnalyzeResultJson,
	type OnDuplicates,
} from './analyze-core.js';
import {computeDependents} from './postprocess.js';

/**
 * Options for a per-file or per-batch resolver override.
 *
 * Identity is required (not optional) — silently coalescing missing identities
 * to a function reference would destroy cache reuse when the same logical
 * resolver is wrapped in fresh closures across calls.
 */
export interface SetFileOptions {
	/**
	 * Per-call override of the session-default resolver — a bare
	 * `ResolveImportFn` or a token-paired `ImportResolver` (see `ResolveImport`).
	 *
	 * A bare function is normalized with a fresh identity on each call, so the
	 * files touched by this call re-resolve rather than cache-hitting — the
	 * expected behavior for a deliberate one-off override. To reuse the resolve
	 * cache across calls, pass an `ImportResolver` with a stable `identity`.
	 */
	resolveImport?: ResolveImport;
}

/**
 * Result of `setFile` (single-file ingest).
 *
 * `changed` is `true` when content or the mode-specific cache key (resolver
 * identity for lex+resolve; dependency snapshot for pre-resolved) differed
 * from the cached entry — the owned entry was rewritten. An LS push
 * accompanies the entry write only when the file is TS/JS or has a
 * successful Svelte virtual; CSS/JSON and transform-failed Svelte rewrite
 * the entry without touching the LS. `false` indicates a cache-hit no-op:
 * the cached `ingestDiagnostics` are returned but no work ran.
 */
export interface SetFileResult {
	/** Whether content or the mode-specific cache key differed from the cached entry. */
	changed: boolean;
	/** Ingest-time diagnostics for this file (durable on the entry). */
	diagnostics: Array<Diagnostic>;
}

/**
 * Result of `setFiles` (batch ingest).
 *
 * Carries both aggregate views (`changedIds`, pre-flattened `diagnostics`)
 * and a structured `perFile` map. HMR-style consumers want
 * `changedIds.size > 0` as the hot check; LSP-style consumers want per-file
 * diagnostic association via `perFile`. Both are populated in the same
 * single-pass walk over the batch — no extra cost.
 */
export interface SetFilesResult {
	/**
	 * IDs whose content or mode-specific cache key differed from the cached
	 * entry — the subset of input file IDs that actually triggered work.
	 * Empty when every file was a cache-hit no-op.
	 */
	changedIds: ReadonlySet<string>;
	/**
	 * Pre-flattened union of every file's `ingestDiagnostics`. Consumers
	 * can group by `Diagnostic.file` for per-file publish.
	 */
	diagnostics: Array<Diagnostic>;
	/**
	 * Per-file `SetFileResult` keyed by input file ID. Use this when the
	 * grouping `Diagnostic.file` would do isn't enough — e.g., LSP wanting
	 * to publish empty-diagnostic-list updates for files that ingested
	 * cleanly.
	 */
	perFile: ReadonlyMap<string, SetFileResult>;
}

/**
 * Per-call input to `query`.
 */
export interface QueryOptions {
	/** Behavior when duplicate declaration names are found across modules. */
	onDuplicates?: OnDuplicates;
	/** Per-call logger override (defaults to the session-level logger). */
	log?: AnalysisLog;
}

/**
 * Persistent analysis handle.
 *
 * **Concurrency**: not safe across overlapping calls. Serialize externally
 * (each caller awaits the previous `setFile`/`setFiles` before starting the
 * next). The LS underneath is sync, but the resolver phase awaits I/O for
 * async resolvers (Vite/Rollup), so the session does cross await boundaries.
 *
 * **Cache-hit semantics**: per-entry, all-or-nothing. The implementation
 * must not split the guarantee across separate caches (e.g. transform-cache
 * hit + lex re-run). The match criterion is mode-discriminated:
 *
 * - lex+resolve mode: `existing.content === incoming.content` AND
 *   `existing.resolverIdentity === incoming.resolverIdentity`.
 * - pre-resolved mode: `existing.content === incoming.content` AND
 *   `arraysShallowEqual(existing.preResolvedDepsSnapshot, incoming.dependencies)`.
 *
 * Mode flips (an entry previously ingested as lex+resolve now arrives with
 * `dependencies`, or vice versa) always cache-miss.
 *
 * **Promise resolution**: `setFile` / `setFiles` resolve only after the
 * serial LS push (phase 3) completes for every file in the batch. Awaiting
 * the returned promise is sufficient — no separate flush step.
 */
export interface AnalysisSession {
	/**
	 * Ingest one file's content into the session. Idempotent on cache hit.
	 *
	 * @returns `{changed, diagnostics}` — `changed: false` indicates a
	 *   cache-hit no-op where the cached ingest diagnostics are returned.
	 */
	setFile(file: SourceFileInfo, opts?: SetFileOptions): Promise<SetFileResult>;
	/**
	 * Ingest a batch of files. Additive — never removes; use `deleteFile` for
	 * removal. Cache hits are folded into the result with `changed: false`.
	 */
	setFiles(files: ReadonlyArray<SourceFileInfo>, opts?: SetFileOptions): Promise<SetFilesResult>;
	/** Drop a file from the session and evict from the LS. */
	deleteFile(id: string): Promise<void>;
	/** Whether the given file ID is currently owned by the session. */
	has(id: string): boolean;
	/** Snapshot of currently-owned file IDs (sort order is insertion order). */
	list(): ReadonlyArray<string>;
	/**
	 * Run a two-phase analysis pass against the current owned set.
	 *
	 * @returns analyzed modules and analysis-pass diagnostics. Ingest
	 *   diagnostics from prior `setFile`/`setFiles` calls are NOT included
	 *   here — concat with those returns for the full picture.
	 * @throws Error if `onDuplicates: 'throw'` and duplicates exist
	 */
	query(opts?: QueryOptions): AnalyzeResultJson;
	/**
	 * Concatenated ingest-time diagnostics across every owned entry — the
	 * cumulative view of every `setFile`/`setFiles` return, kept current as
	 * entries are added/replaced/deleted.
	 *
	 * Lets long-lived consumers (Vite plugin, LSP) publish the full ingest
	 * picture without tracking per-batch returns themselves. Cheap: walks
	 * the owned map.
	 */
	allIngestDiagnostics(): Array<Diagnostic>;
	/**
	 * Release LS resources and clear the owned set. The session must not be
	 * used after disposal.
	 */
	dispose(): void;
}

/**
 * Options for `createAnalysisSession`.
 *
 * `documentRegistry` flows through to the underlying `LanguageService` only.
 * `tsconfig` and `compilerOptions` flow to both the LS *and* the lazy default
 * `ImportResolver` (`getDefaultResolver` re-invokes `loadTsconfig` with them
 * to produce a merged `ts.CompilerOptions` for module resolution). The two
 * paths share the same merge semantics — user-supplied `compilerOptions`
 * override parsed tsconfig keys, but never bypass the tsconfig.json file
 * requirement.
 *
 * `projectRoot` and `virtualFiles` from the LS options shape are excluded —
 * the session derives `projectRoot` from `sourceOptions` and manages
 * svelte2tsx virtuals internally per file.
 */
export interface AnalysisSessionOptions extends Omit<
	AnalysisLanguageServiceOptions,
	'projectRoot' | 'virtualFiles'
> {
	/**
	 * Module source options for path extraction and source filtering.
	 *
	 * Must be a fully-constructed `ModuleSourceOptions` — the session re-runs
	 * `normalizeSourceOptions` (idempotent) but does not apply any defaults.
	 * Pass through `createSourceOptions(projectRoot, overrides?)` to merge with
	 * `DEFAULT_SOURCE_OPTIONS`. (The `Partial<SourceOptionsDefaults>` ergonomic
	 * shape exists only on `AnalyzeFromFilesOptions.sourceOptions`, where the
	 * defaults merge happens inside `analyzeFromFiles`.)
	 */
	sourceOptions: ModuleSourceOptions;
	/**
	 * Session-default custom import resolver used when no per-call override is
	 * supplied — a bare `ResolveImportFn` or a token-paired `ImportResolver`
	 * (see `ResolveImport`). A bare function is normalized once at construction,
	 * so its synthesized identity is stable for the session's lifetime (cache
	 * reuse works). When omitted, the session lazily constructs the TS+tsconfig
	 * default on first use.
	 */
	resolveImport?: ResolveImport;
	/** Optional logger for session-level messages. */
	log?: AnalysisLog;
}

/**
 * Element-wise equality on two readonly string arrays. Used for the
 * pre-resolved-deps cache key: a fresh array with identical contents
 * cache-hits (matches Gro filer's `[...Map.keys()]`-per-call pattern), while
 * any length, element, or order difference cache-misses. Order-sensitive
 * because `unfilteredDeps` ordering reflects the caller's declared graph
 * shape — reordering without a content change is a caller-driven intent
 * signal worth honoring.
 */
const arraysShallowEqual = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
};

/**
 * Shared shape across both ingest modes. `mode` discriminates whether the
 * entry's cache key is resolver-identity-based (`'lex+resolve'`) or
 * dependency-snapshot-based (`'pre-resolved'`).
 */
interface OwnedEntryBase {
	content: string;
	virtual?: SvelteVirtualFile;
	/**
	 * All absolute paths this file depends on (post `isSource` filter, pre
	 * owned-set filter). Cache strategy A — query-time filter to the current
	 * owned set covers transient absences correctly. Populated either from
	 * resolver output (lex+resolve path) or from caller-supplied
	 * `SourceFileInfo.dependencies` (pre-resolved path).
	 */
	unfilteredDeps: Array<string>;
	/** Ingest-time diagnostics, durable across cache hits. */
	ingestDiagnostics: Array<Diagnostic>;
	/** svelte2tsx threw during ingest — query synthesizes placeholder ModuleJson. */
	transformFailed?: boolean;
}

interface OwnedEntryLexResolve extends OwnedEntryBase {
	mode: 'lex+resolve';
	/** Identity that produced `unfilteredDeps`. Cache key for re-resolve elision. */
	resolverIdentity: string | symbol;
}

interface OwnedEntryPreResolved extends OwnedEntryBase {
	mode: 'pre-resolved';
	/**
	 * Snapshot of the caller's `SourceFileInfo.dependencies` at storage time.
	 * Used as the cache key — element-wise (shallow) equality + content
	 * equality → cache hit; any length or per-element difference invalidates.
	 * Owning a snapshot rather than the caller's reference means mid-flight
	 * mutation by the caller doesn't produce false cache hits.
	 */
	preResolvedDepsSnapshot: ReadonlyArray<string>;
}

type OwnedEntry = OwnedEntryLexResolve | OwnedEntryPreResolved;

interface PendingIngest {
	file: SourceFileInfo;
	virtual: SvelteVirtualFile | undefined;
	transformFailed: boolean;
	ingestDiagnostics: Array<Diagnostic>;
	/** Specifiers from lex; empty for cache hits, CSS/JSON, transform-failed Svelte, pre-resolved deps. */
	specifiers: Array<string>;
	/**
	 * Resolver identity in effect for this file. `undefined` when the file is
	 * pre-resolved (no resolver consulted, snapshot drives the cache key) or
	 * when the entire batch is pre-resolved (resolver never constructed).
	 */
	resolverIdentity: string | symbol | undefined;
	/** True when an existing entry matched on content + (identity or pre-resolved snapshot). */
	cacheHit: boolean;
	/**
	 * Caller-supplied pre-resolved dependencies for this file, when present.
	 * Phase 3 uses these directly (filtered through `isSource`) instead of the
	 * resolver output, and stores a snapshot on the entry as
	 * `preResolvedDepsSnapshot` for the next cache check.
	 */
	preResolvedDeps?: ReadonlyArray<string>;
	/**
	 * Virtual path of the *previous* successful Svelte transform, captured at
	 * cache-miss time. Phase 3 evicts it from the LS when the new ingest
	 * doesn't push a fresh virtual (transform regressed to `transform_failed`),
	 * so other files importing this `.svelte` don't see stale checker state.
	 * `undefined` when the file had no prior virtual (cold ingest, or prior
	 * transform also failed).
	 */
	previousVirtualPath: string | undefined;
}

/**
 * Create a persistent analysis session.
 *
 * @example Vite plugin integration
 * ```ts
 * const session = createAnalysisSession({sourceOptions, resolveImport, log});
 * await session.setFiles(initialFiles);
 * const result = session.query();
 * // on watcher events:
 * await session.setFile({id, content});
 * await session.deleteFile(removedId);
 * const next = session.query();
 * // on shutdown:
 * session.dispose();
 * ```
 *
 * @example One-shot via the public wrapper
 * ```ts
 * // Equivalent to `analyze(...)` — the wrapper goes through a session internally.
 * const session = createAnalysisSession({sourceOptions});
 * try {
 *   await session.setFiles(sourceFiles);
 *   return session.query({onDuplicates: 'throw'});
 * } finally {
 *   session.dispose();
 * }
 * ```
 */
export const createAnalysisSession = (options: AnalysisSessionOptions): AnalysisSession => {
	const sourceOptions = normalizeSourceOptions(options.sourceOptions);

	const ls: AnalysisLanguageService = createAnalysisLanguageService(
		{
			projectRoot: sourceOptions.projectRoot,
			tsconfig: options.tsconfig,
			compilerOptions: options.compilerOptions,
			documentRegistry: options.documentRegistry,
		},
		options.log,
	);

	const owned = new Map<string, OwnedEntry>();

	// TODO: the owned-entry cache is in-memory only, so cold one-shot runs
	// (`analyzeFromFiles` from the CLI, `vite build`) re-transform and re-analyze
	// every file from scratch — the expensive case given svelte2tsx + the TS
	// checker. A schema-versioned disk cache (cf. fuz_css `css_cache.ts`: mirror
	// the source tree, key each file's extracted JSON by content hash, stamp an
	// integer cache-version bumped on output-shape changes, self-heal on
	// hash/version/parse mismatch, atomic temp-file+rename writes, skip on CI)
	// would make those cold paths incremental across process restarts. The
	// existing per-entry content-equality check is the in-memory analog; the
	// cache key would need the same `(content, mode-specific key)` discipline
	// the session already uses, plus the version stamp.

	// Lazy default resolver — only constructed when needed: a `setFiles` batch
	// has at least one file lacking `dependencies`, the call doesn't supply a
	// per-call override, and no session-default resolver was configured. Fully
	// pre-resolved batches skip the construction entirely (see `needsResolver`
	// gating below). The TS module-resolution cache is kept on the resolver so
	// consecutive resolves share state.
	let lazyDefault: ImportResolver | undefined;
	const getDefaultResolver = (): ImportResolver => {
		if (lazyDefault) return lazyDefault;
		const {compilerOptions} = loadTsconfig(
			{
				projectRoot: sourceOptions.projectRoot,
				tsconfig: options.tsconfig,
				compilerOptions: options.compilerOptions,
			},
			options.log,
		);
		lazyDefault = createDefaultResolver(compilerOptions, sourceOptions.projectRoot);
		return lazyDefault;
	};

	// Normalize the session default once at construction. A bare function gets a
	// single synthesized identity here, stable for the session's lifetime — so
	// repeated ingests of byte-identical content cache-hit on identity.
	const sessionDefaultResolver = normalizeResolveImport(options.resolveImport);

	const pickResolver = (override?: ImportResolver): ImportResolver => {
		if (override) return override;
		if (sessionDefaultResolver) return sessionDefaultResolver;
		return getDefaultResolver();
	};

	// Phase 1: sync per-file transform/lex
	// `resolver` is `null` when the entire batch is pre-resolved — phase 1
	// needs no resolver identity in that case, and skipping `pickResolver`
	// avoids constructing the lazy default for fully pre-resolved consumers.
	const phase1 = (file: SourceFileInfo, resolver: ImportResolver | null): PendingIngest => {
		const existing = owned.get(file.id);

		// Pre-resolved deps mode: caller asserted `file.dependencies` is the
		// authoritative absolute-path list. Skip lex+resolve; Svelte still gets
		// transformed because the LS needs the virtual.
		const preResolvedDeps = file.dependencies;
		const usePreResolved = preResolvedDeps !== undefined;

		// Cache hit shape depends on mode:
		//   pre-resolved → match content + element-wise deps equality (a fresh
		//                  array with the same contents still hits — Gro's
		//                  `[...Map.keys()]` per-call pattern cache-reuses
		//                  cleanly across persistent-session calls)
		//   lex+resolve  → match content + same resolver identity AND prior
		//                  entry was lex+resolve mode (mode flip invalidates)
		// All-or-nothing per the spec (no half-runs).
		const cacheHit =
			existing !== undefined &&
			existing.content === file.content &&
			(usePreResolved
				? existing.mode === 'pre-resolved' &&
					arraysShallowEqual(existing.preResolvedDepsSnapshot, preResolvedDeps)
				: existing.mode === 'lex+resolve' &&
					resolver !== null &&
					existing.resolverIdentity === resolver.identity);

		if (cacheHit) {
			return {
				file,
				virtual: existing.virtual,
				transformFailed: existing.transformFailed === true,
				ingestDiagnostics: existing.ingestDiagnostics,
				specifiers: [],
				// Phase 3 short-circuits on `cacheHit: true` before reading this
				// field — leave it undefined to document that it's unused on
				// the cache-hit path (the entry in `owned` already carries the
				// authoritative resolver identity / deps snapshot).
				resolverIdentity: undefined,
				cacheHit: true,
				previousVirtualPath: undefined,
				preResolvedDeps: usePreResolved ? preResolvedDeps : undefined,
			};
		}

		// Capture the prior virtual path before we replace the entry. If the new
		// transform fails, phase 3 evicts the stale virtual from the LS.
		const previousVirtualPath = existing?.virtual?.virtualPath;

		const ingestDiagnostics: Array<Diagnostic> = [];
		const analyzer = sourceOptions.getAnalyzerType(file.id);

		// Transform if Svelte. transformSvelteSource returns ingest diagnostics
		// directly (transform_failed on throw, source_map_failed on map error).
		// Runs regardless of mode — the LS host needs the virtual for checker
		// state, independent of how we obtain dependency edges.
		let virtual: SvelteVirtualFile | undefined;
		let transformFailed = false;
		if (analyzer === 'svelte') {
			const tres = transformSvelteSource(file);
			for (const d of tres.diagnostics) ingestDiagnostics.push(d);
			if (tres.virtual) {
				virtual = tres.virtual;
			} else {
				transformFailed = true;
			}
		}

		// Lex import specifiers — skipped when caller supplied pre-resolved deps.
		// Sync — caller awaited ensureLexerReady. CSS/JSON files have nothing to
		// lex; transform_failed Svelte has no virtual content to lex.
		let specifiers: Array<string> = [];
		if (
			!usePreResolved &&
			!transformFailed &&
			(analyzer === 'typescript' || analyzer === 'svelte')
		) {
			try {
				const contentToLex = virtual ? virtual.content : file.content;
				specifiers = lexImports(contentToLex, file.id);
			} catch (err) {
				ingestDiagnostics.push({
					kind: 'import_parse_failed',
					file: file.id,
					message: `Failed to parse imports: ${to_error_message(err)}`,
					severity: 'warning',
				});
			}
		}

		return {
			file,
			virtual,
			transformFailed,
			ingestDiagnostics,
			specifiers,
			resolverIdentity: resolver?.identity,
			cacheHit: false,
			previousVirtualPath,
			preResolvedDeps: usePreResolved ? preResolvedDeps : undefined,
		};
	};

	// Phase 3: serial per-file LS push + entry write
	const phase3 = (
		pending: PendingIngest,
		resolved: ReadonlyArray<string | null>,
	): SetFileResult => {
		if (pending.cacheHit) {
			// Cached SetFileResult: same diagnostics array reference, changed: false.
			// `[...]` clone keeps the caller from mutating the entry's stored array.
			// Cached entry's diagnostics were normalized at the time the entry was stored.
			return {changed: false, diagnostics: [...pending.ingestDiagnostics]};
		}

		// Normalize ingest diagnostics to project-root-relative paths before
		// the entry is stored. After this point, `entry.ingestDiagnostics` is
		// normalized at rest — `allIngestDiagnostics()` can read it directly
		// without depending on a later in-place mutation via the aggregate.
		normalizeDiagnosticPaths(pending.ingestDiagnostics, sourceOptions.projectRoot);

		// Build `unfilteredDeps` from one of two sources:
		//   pre-resolved → caller's `file.dependencies`, posixified + filtered
		//   lex+resolve  → resolver task outputs, already posixified, filtered
		// The Set dedupes in first-occurrence order — multiple statements
		// importing the same module (or a duplicate caller-declared edge) are
		// one edge.
		const depSet = new Set<string>();
		if (pending.preResolvedDeps !== undefined) {
			for (const raw of pending.preResolvedDeps) {
				const posix = toPosixPath(raw);
				if (!isSource(posix, sourceOptions)) continue;
				depSet.add(posix);
			}
		} else {
			for (const r of resolved) {
				if (r === null) continue;
				if (!isSource(r, sourceOptions)) continue;
				depSet.add(r);
			}
		}
		const unfilteredDeps = [...depSet];

		// Build a mode-specific entry. The discriminator (`mode`) tags which
		// cache-key field to read on the next ingest: `resolverIdentity` for
		// lex+resolve, `preResolvedDepsSnapshot` for pre-resolved. Snapshot
		// the caller's array on the pre-resolved branch — owning a copy means
		// subsequent caller-side mutation doesn't produce false cache hits.
		const entry: OwnedEntry =
			pending.preResolvedDeps !== undefined
				? {
						mode: 'pre-resolved',
						content: pending.file.content,
						virtual: pending.virtual,
						unfilteredDeps,
						preResolvedDepsSnapshot: pending.preResolvedDeps.slice(),
						ingestDiagnostics: pending.ingestDiagnostics,
					}
				: {
						mode: 'lex+resolve',
						content: pending.file.content,
						virtual: pending.virtual,
						unfilteredDeps,
						// Non-null assert: lex+resolve branch implies the batch picked a
						// resolver, so phase 1 stored its identity on the pending entry.
						resolverIdentity: pending.resolverIdentity!,
						ingestDiagnostics: pending.ingestDiagnostics,
					};
		if (pending.transformFailed) entry.transformFailed = true;
		owned.set(pending.file.id, entry);

		// LS push — virtual path for successful Svelte transforms, real path
		// for TS/JS. CSS/JSON aren't TypeScript-resolvable; skip the push.
		// Transform-failed Svelte: no virtual; skip.
		const analyzer = sourceOptions.getAnalyzerType(pending.file.id);
		if (pending.virtual) {
			ls.setFile(pending.virtual.virtualPath, pending.virtual.content);
		} else if (analyzer === 'typescript') {
			ls.setFile(pending.file.id, pending.file.content);
		} else if (pending.previousVirtualPath) {
			// Transform regressed (had virtual → now transform_failed). Evict the
			// stale virtual from the LS so other files importing this `.svelte`
			// don't see the prior svelte2tsx output via the checker.
			ls.deleteFile(pending.previousVirtualPath);
		}

		return {changed: true, diagnostics: [...pending.ingestDiagnostics]};
	};

	// setFiles: orchestrate three phases
	const setFiles = async (
		files: ReadonlyArray<SourceFileInfo>,
		opts?: SetFileOptions,
	): Promise<SetFilesResult> => {
		await ensureLexerReady();

		// Resolver gating: pick one only if any file in the batch lacks
		// `dependencies` (i.e., needs lex+resolve). For fully pre-resolved
		// batches the resolver is never consulted, so we skip `pickResolver`
		// entirely — that avoids constructing the lazy default
		// (`loadTsconfig` + `createDefaultResolver`) for consumers like the
		// Gro filer that always hand over pre-resolved deps.
		const needsResolver = files.some((f) => f.dependencies === undefined);
		// Normalize the per-call override (bare fn → fresh identity each call).
		const resolver: ImportResolver | null = needsResolver
			? pickResolver(normalizeResolveImport(opts?.resolveImport))
			: null;

		// Posixify ids at ingest — the internal contract is forward-slash
		// everywhere. Skip the clone when the input is already POSIX (common
		// path on Linux/macOS).
		const normalizedFiles = files.map((f) => {
			const posixId = toPosixPath(f.id);
			return posixId === f.id ? f : {...f, id: posixId};
		});

		// Phase 1: sync per-file transform + lex.
		const pendings: Array<PendingIngest> = [];
		for (const file of normalizedFiles) {
			pendings.push(phase1(file, resolver));
		}

		// Phase 2: parallel resolve. `Promise.resolve(sync)` adapts sync resolvers
		// without per-call branching; async resolvers (Vite/Rollup) parallelize
		// naturally. Each task returns its (file, idx, resolved) tuple so we can
		// scatter results back into the right pending entry.
		//
		// Resolver throws are caught per-task and emitted as `resolver_failed`
		// ingest diagnostics on the importing file. Treating throws as `null`
		// (legitimately unresolvable) would silently mask buggy resolvers; the
		// distinction matters for LSP-style consumers that publish failures.
		interface ResolveTask {
			pendingIdx: number;
			specIdx: number;
			specifier: string;
		}
		const tasks: Array<ResolveTask> = [];
		for (let pi = 0; pi < pendings.length; pi++) {
			const p = pendings[pi]!;
			if (p.cacheHit) continue;
			for (let si = 0; si < p.specifiers.length; si++) {
				// Skip Node builtins — never a source file, and routing them
				// through a host resolver (Vite/Rollup) provokes spurious
				// "externalized for browser compatibility" warnings. The
				// resolved slot stays `null` (its pre-filled default).
				if (isNodeBuiltin(p.specifiers[si]!)) continue;
				tasks.push({pendingIdx: pi, specIdx: si, specifier: p.specifiers[si]!});
			}
		}
		// Resolver invariant: `tasks` non-empty implies `resolver !== null`.
		// A task is only enqueued for a non-cache-hit pending with at least
		// one specifier, which by phase 1's logic implies the file went
		// through the lex+resolve branch, which only runs when at least one
		// file in the batch lacks `dependencies` — i.e., `needsResolver` was
		// `true` and a resolver was picked. Convert this unreachable-by-
		// invariant into unreachable-by-throw so the `resolver!` below has
		// an explicit runtime defense rather than relying on the chain.
		if (tasks.length > 0 && resolver === null) {
			throw new Error(
				'svelte-docinfo: phase-2 invariant violated — tasks pending without a resolver',
			);
		}
		const taskResults = await map_concurrent(tasks, MAX_RESOLVE_CONCURRENCY, async (t) => {
			const pending = pendings[t.pendingIdx]!;
			try {
				const resolved = await resolver!.resolve(t.specifier, pending.file.id);
				// Posixify resolver output — custom resolvers (Vite/Rollup,
				// user-supplied) may emit native paths on Windows. The TS
				// default resolver already returns POSIX, so this is a no-op
				// there. Storing POSIX keeps unfilteredDeps consistent with
				// owned-set keys in `query()`'s ownedIds filter.
				return {
					...t,
					resolved: resolved === null ? null : toPosixPath(resolved),
					error: undefined,
				};
			} catch (err) {
				return {
					...t,
					resolved: null,
					error: to_error_message(err),
				};
			}
		});

		// Group resolved results by pending index for phase 3. Resolver errors
		// land on the importing file's ingest diagnostics so per-file grouping
		// (LSP publish, etc.) keeps them attached to the right source.
		// Dedup on (pendingIdx, specifier) — duplicate imports of the same path
		// throw N times, but the diagnostic carries no per-import-site info, so
		// emitting once per specifier keeps the output non-redundant.
		const resolvedByPending: Array<Array<string | null>> = pendings.map((p) =>
			p.cacheHit ? [] : new Array<string | null>(p.specifiers.length).fill(null),
		);
		const seenFailures = new Map<number, Set<string>>();
		for (const r of taskResults) {
			resolvedByPending[r.pendingIdx]![r.specIdx] = r.resolved;
			if (r.error === undefined) continue;
			let seen = seenFailures.get(r.pendingIdx);
			if (!seen) {
				seen = new Set();
				seenFailures.set(r.pendingIdx, seen);
			}
			if (seen.has(r.specifier)) continue;
			seen.add(r.specifier);
			const pending = pendings[r.pendingIdx]!;
			pending.ingestDiagnostics.push({
				kind: 'resolver_failed',
				file: pending.file.id,
				message: `Import resolver threw for "${r.specifier}": ${r.error}`,
				severity: 'warning',
				specifier: r.specifier,
			});
		}

		// Phase 3: serial per-file LS push + entry write. Single LS mutator
		// across the batch — no interleaved updates from concurrent tasks.
		const perFile = new Map<string, SetFileResult>();
		const changedIds = new Set<string>();
		const aggregateDiagnostics: Array<Diagnostic> = [];

		for (let i = 0; i < pendings.length; i++) {
			const pending = pendings[i]!;
			const result = phase3(pending, resolvedByPending[i]!);
			perFile.set(pending.file.id, result);
			if (result.changed) changedIds.add(pending.file.id);
			for (const d of result.diagnostics) aggregateDiagnostics.push(d);
		}

		return {changedIds, diagnostics: aggregateDiagnostics, perFile};
	};

	const setFile = async (file: SourceFileInfo, opts?: SetFileOptions): Promise<SetFileResult> => {
		const batch = await setFiles([file], opts);
		return batch.perFile.get(toPosixPath(file.id))!;
	};

	// `deleteFile` returns `Promise<void>` for symmetry with `setFile`/`setFiles`
	// (the spec calls this "async-by-convention"). The body is purely sync —
	// `ls.deleteFile` and `Map.delete` are sync — so we wrap the return rather
	// than declaring `async` (which would trip eslint's require-await).
	const deleteFile = (id: string): Promise<void> => {
		const posixId = toPosixPath(id);
		const entry = owned.get(posixId);
		if (!entry) return Promise.resolve();
		if (entry.virtual) {
			ls.deleteFile(entry.virtual.virtualPath);
		} else {
			ls.deleteFile(posixId);
		}
		owned.delete(posixId);
		return Promise.resolve();
	};

	const has = (id: string): boolean => owned.has(toPosixPath(id));
	const list = (): ReadonlyArray<string> => [...owned.keys()];

	const allIngestDiagnostics = (): Array<Diagnostic> => {
		const out: Array<Diagnostic> = [];
		for (const entry of owned.values()) {
			for (const d of entry.ingestDiagnostics) out.push(d);
		}
		return out;
	};

	const query = (opts?: QueryOptions): AnalyzeResultJson => {
		// Build query inputs from owned entries. Filter unfilteredDeps to the
		// current owned set per cache strategy A.
		const ownedIds = new Set(owned.keys());
		const sourceFiles: Array<SourceFileInfo> = [];
		const svelteVirtualFiles = new Map<string, SvelteVirtualFile>();
		const transformFailedIds = new Set<string>();

		for (const [id, entry] of owned) {
			const filteredDeps = entry.unfilteredDeps.filter((d) => ownedIds.has(d));
			sourceFiles.push({id, content: entry.content, dependencies: filteredDeps});
			if (entry.virtual) svelteVirtualFiles.set(id, entry.virtual);
			if (entry.transformFailed) transformFailedIds.add(id);
		}

		// Compute bidirectional dependents from the filtered forward edges.
		const filesWithDeps = computeDependents(sourceFiles);

		// `getProgram()` returns the same `ts.Program` reference as the prior
		// call when no version bumped, or a fresh program reusing unchanged
		// ASTs via the document registry.
		const program = ls.getProgram();

		const result = analyzeCore({
			sourceFiles: filesWithDeps,
			sourceOptions,
			program,
			svelteVirtualFiles,
			transformFailedIds,
			onDuplicates: opts?.onDuplicates,
			log: opts?.log ?? options.log,
		});

		return result;
	};

	const dispose = (): void => {
		ls.dispose();
		owned.clear();
	};

	return {setFile, setFiles, deleteFile, has, list, query, allIngestDiagnostics, dispose};
};
