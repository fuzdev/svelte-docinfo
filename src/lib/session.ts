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
 * A batch that adds paths then retries the import specifiers earlier batches
 * couldn't resolve, since the file that settles one is the dep rather than
 * the importer (see `AnalysisSession` → Deferred resolutions).
 *
 * @see `analyze-core.ts` for the two-phase analysis orchestrator
 * @see `dep-resolver.ts` for the `ImportResolver` token contract
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import {
	createAnalysisLanguageService,
	createOwnedDirIndex,
	type AnalysisLanguageService,
	type AnalysisLanguageServiceOptions
} from './typescript-program.ts';
import type { Diagnostic } from './diagnostics.ts';
import { to_error_message } from './error.ts';
import type { AnalysisLog } from './log.ts';
import { transformSvelteSource, type SvelteVirtualFile } from './svelte.ts';
import {
	type ImportResolver,
	type ResolveImport,
	createDefaultResolver,
	ensureLexerReady,
	isNodeBuiltin,
	lexImports,
	normalizeResolveImport
} from './dep-resolver.ts';
import type { SourceFileInfo } from './source.ts';
import {
	type ModuleSourceOptions,
	hasBaselineExcludedSegment,
	isSource,
	normalizeSourceOptions
} from './source-config.ts';
import { toPosixPath } from './paths.ts';
import { MAX_FILE_CONCURRENCY, MAX_RESOLVE_CONCURRENCY, map_concurrent } from './concurrency.ts';
import {
	analyzeCore,
	normalizeDiagnosticPaths,
	AnalyzeResultJson,
	type OnDuplicates
} from './analyze-core.ts';
import { computeDependents } from './postprocess.ts';

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
	 * can group by `Diagnostic.file` for per-file publish — already
	 * project-root-relative, normalized at rest before the entry was stored.
	 *
	 * The array is fresh but its elements are the *stored* diagnostic objects,
	 * so mutating one (re-running `normalizeDiagnosticPaths` against a
	 * different root, say) corrupts the session's own state. Copy before
	 * mutating.
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
 * **Deferred resolutions**: a cache hit reuses the entry's dependency edges,
 * but an import specifier that resolved to nothing isn't a settled answer —
 * its target may be ingested later, and the file that changes then is the
 * *dep*, not the importer, so the importer would stay a cache hit with a
 * missing edge. A `setFiles` that adds paths therefore retries the unresolved
 * specifiers of already-owned entries and updates their edges in place,
 * retiring any `resolver_failed` that has since resolved. This is the one way
 * an entry changes without being re-ingested; it consumes no resolver work for
 * files whose imports all resolved, and none at all for pre-resolved callers,
 * whose edges are theirs to declare.
 *
 * **Promise resolution**: `setFile` / `setFiles` resolve only after the
 * serial LS push (phase 3) completes for every file in the batch. Awaiting
 * the returned promise is sufficient — no separate flush step.
 *
 * **Owned ⊇ emitted**: ingest is additive and ungated — any file can be
 * pushed, and owned entries are served to the checker from memory before the
 * disk fallback, so non-source files (unsaved buffers, virtual-only helpers,
 * configs) can shape type resolution in the modules that import them.
 * `query()` gates the *module set* through `isSource`: only owned files under
 * `sourceOptions.sourcePaths` and not matching `exclude` emit a `ModuleJson`.
 * The gate emits no diagnostics — `query()` logs the gated count as info, and
 * `list()` reports the full owned set for introspection. By default the
 * session completes the owned set itself: `contextClosure` ingests the
 * in-root non-source dependency closure (e.g. `internal/` modules public
 * files import) so those files are version-tracked rather than pinned at
 * their first disk read.
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
	 * Run a two-phase analysis pass against the current owned set, gated by
	 * `isSource` — owned files outside `sourcePaths` (or matching `exclude`)
	 * provide checker context but emit no module (see "Owned ⊇ emitted"
	 * above).
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
	 * The LS-backed `ts.Program`, for incremental consumers doing their own
	 * checker work over analyzed declarations (e.g., a docgen provider
	 * converting `ts.Type`s into its own structured model).
	 *
	 * Freshness caveat: returns whatever the most recent ingest produced —
	 * the same reference as the prior call when no file version bumped, else
	 * a fresh program reusing unchanged ASTs via the document registry. A
	 * retained reference goes stale after any `setFile` / `setFiles` /
	 * `deleteFile`; re-call after mutating. Subject to the session's
	 * concurrency contract above; invalid after `dispose()`.
	 */
	getProgram(): ts.Program;
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
 * `tsconfig` and `compilerOptions` drive the LS's construction-time
 * `loadTsconfig` parse — the session's only tsconfig parse. The lazy default
 * `ImportResolver` reuses the LS's merged options via `getCompilerOptions()`,
 * so module resolution and the checker see the same merge semantics —
 * user-supplied `compilerOptions` override parsed tsconfig keys, but never
 * bypass the tsconfig.json file requirement. The parse is a construction-time
 * snapshot: a tsconfig.json edit mid-session is not picked up — create a new
 * session.
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
	 * `DEFAULT_SOURCE_OPTIONS`. (The `SourceOptionsOverrides` ergonomic shape —
	 * exclude-callback form included — exists only on
	 * `AnalyzeFromFilesOptions.sourceOptions` and the Vite plugin, where the
	 * defaults merge happens inside `createSourceOptions`.)
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
	/**
	 * Own the in-root non-source dependency closure as context files
	 * (default `true`).
	 *
	 * After each ingest batch, the session reads from disk any file the
	 * batch's imports resolved to that is under `projectRoot`, fails
	 * `isSource` (outside `sourcePaths` or matching `exclude` — e.g. the
	 * `src/lib/internal/` convention), has no `node_modules`/dot-directory
	 * segments, and has an analyzer type — transitively, until the closure
	 * converges. Context files are owned but never emit modules (`query()`
	 * gates them), so this changes no output; what it changes is *freshness*:
	 * an owned file's edit version-bumps the LS, whereas a disk-resolved file
	 * is read once and pinned for the session's lifetime. Watch-style
	 * consumers (the Vite plugin) gate their watchers on
	 * `isSource(file) || session.has(file)`, so context-file edits trigger
	 * re-analysis and public output tracks internal types live.
	 *
	 * Context batches always ingest in lex+resolve mode (their edges exist
	 * only to walk the closure — context files emit nothing), so a fully
	 * pre-resolved consumer whose files import in-root non-source paths
	 * constructs the default resolver after all. Context ingest diagnostics
	 * surface via `allIngestDiagnostics()`, not the batch return, and
	 * `setFiles` results stay keyed by the caller's input IDs. Unreadable
	 * candidates are skipped silently (the LS disk fallback covers them).
	 *
	 * Context files are never evicted: once owned they stay owned (and, under
	 * the Vite plugin, watched) for the session's lifetime, even when no
	 * importer remains.
	 *
	 * Set `false` only when the caller supplies every file the checker needs
	 * (the internal `analyze()` wrapper does): TS/JS context is covered by the
	 * LS disk fallback either way, but a gated `.svelte` dependency resolves
	 * only through the closure's ingest (svelte2tsx runs there — the disk
	 * fallback serves raw Svelte the checker can't parse), so
	 * `analyzeFromFiles()` keeps the closure on despite being one-shot.
	 */
	contextClosure?: boolean;
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
	/**
	 * The lexed specifiers and their resolutions, kept only while at least one
	 * non-builtin specifier resolved to `null` — a file whose imports all
	 * resolved can't gain edges from a later ingest, so it stores nothing.
	 *
	 * An unresolved specifier is a *deferred* answer, not a final one: the
	 * target may be ingested later, and this entry is a cache hit until its own
	 * content changes, so nothing would re-resolve it. `healUnresolvedEdges`
	 * retries these slots after a batch adds paths and rebuilds
	 * `unfilteredDeps` from the full array rather than appending to it, so a
	 * healed entry stores exactly what a fresh ingest would (same dedupe rule,
	 * same first-occurrence order) and nothing downstream can tell the two
	 * apart.
	 */
	unresolved?: {
		specifiers: ReadonlyArray<string>;
		resolved: Array<string | null>;
		/**
		 * The `ingestSeq` these slots were resolved under. The heal skips its
		 * own call's entries: everything a `setFiles` adds is already in the
		 * resolution host's overlay during that call's phase 2, so retrying
		 * them would re-run a resolver over answers that can't have changed —
		 * observable as duplicate resolver calls, and endless for an import
		 * that is simply a typo.
		 */
		seq: number;
	};
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
			documentRegistry: options.documentRegistry
		},
		options.log
	);

	const owned = new Map<string, OwnedEntry>();
	// Ancestor directories of the owned set, kept in lockstep at the three
	// mutation sites (phase-3 `owned.set`, `deleteFile`, `dispose`) — the
	// default resolver's host answers `directoryExists` from it, see
	// `createOwnedDirIndex`.
	const ownedDirs = createOwnedDirIndex();

	// Bumped whenever the owned set's *membership* changes (a path added or
	// removed — content changes can't change what exists). Resolvers cache
	// failed lookups, which the next membership change may falsify, so each
	// resolver's cache is dropped when it predates the current generation.
	// Per-resolver rather than a single flag: a per-call override must not
	// consume the session default's invalidation, or vice versa.
	let ownedGeneration = 0;
	const resolverGenerations = new WeakMap<ImportResolver, number>();

	// Incremented once per `setFiles` (so the context closure's batches share
	// the caller's number) — stamps deferred resolutions so the heal pass can
	// tell "resolved before this call" from "resolved during it".
	let ingestSeq = 0;

	// The in-flight ingest batch, overlaid on `owned` by the resolution host:
	// dependency resolution (phase 2) runs before the batch commits (phase 3),
	// and a batch must resolve against itself — first ingest of importer + dep
	// in one call. Registered/removed per batch in `runBatch`. Batches never
	// nest (the context closure runs after `runBatch` returns) and overlapping
	// calls are unsupported (see `AnalysisSession`), so the overlay is only
	// ever one batch deep.
	const pendingBatch = new Map<string, string>();
	const pendingDirs = createOwnedDirIndex();

	// The default resolver must see the same world the checker does: owned
	// content over disk (the LS host already serves it — see
	// `typescript-program.ts`). Without this, a file in a directory that
	// exists nowhere on disk (unsaved buffers, virtual-only layouts) resolves
	// for types but silently drops its dependency edges. Keys are POSIX like
	// the owned map; `ts.resolveModuleName` probes forward-slash paths.
	const resolutionHost: ts.ModuleResolutionHost = {
		fileExists: (path) => pendingBatch.has(path) || owned.has(path) || ts.sys.fileExists(path),
		readFile: (path) => pendingBatch.get(path) ?? owned.get(path)?.content ?? ts.sys.readFile(path),
		directoryExists: (path) =>
			pendingDirs.has(path) || ownedDirs.has(path) || ts.sys.directoryExists(path),
		realpath: ts.sys.realpath,
		getCurrentDirectory: () => sourceOptions.projectRoot,
		useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
	};

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
	// gating below). Compiler options come from the LS handle — the session's
	// one tsconfig parse, at LS construction — so the resolver and the checker
	// see the same merged config. The TS module-resolution cache is kept on
	// the resolver so consecutive resolves share state.
	let lazyDefault: ImportResolver | undefined;
	const getDefaultResolver = (): ImportResolver => {
		lazyDefault ??= createDefaultResolver(
			ls.getCompilerOptions(),
			sourceOptions.projectRoot,
			resolutionHost
		);
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
				preResolvedDeps: usePreResolved ? preResolvedDeps : undefined
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
					severity: 'warning'
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
			preResolvedDeps: usePreResolved ? preResolvedDeps : undefined
		};
	};

	// Project resolver output to stored edges: drop unresolved slots and
	// non-source targets, dedupe in first-occurrence order — multiple
	// statements importing the same module are one edge. Shared by phase 3 and
	// `healUnresolvedEdges` so a healed entry's edges are byte-identical to a
	// fresh ingest's.
	const depsFromResolved = (resolved: ReadonlyArray<string | null>): Array<string> => {
		const depSet = new Set<string>();
		for (const r of resolved) {
			if (r === null) continue;
			if (!isSource(r, sourceOptions)) continue;
			depSet.add(r);
		}
		return [...depSet];
	};

	// Whether any resolution is *deferred* rather than settled: a specifier
	// that resolved to `null` and isn't a Node builtin (builtins are never
	// resolved by design — their slot stays `null` forever, so treating them
	// as retryable would flag every file importing `node:fs`).
	const hasDeferredResolution = (
		specifiers: ReadonlyArray<string>,
		resolved: ReadonlyArray<string | null>
	): boolean => specifiers.some((s, i) => resolved[i] === null && !isNodeBuiltin(s));

	// Phase 3: serial per-file LS push + entry write
	const phase3 = (
		pending: PendingIngest,
		resolved: ReadonlyArray<string | null>
	): SetFileResult => {
		if (pending.cacheHit) {
			// Cached SetFileResult: same diagnostics array reference, changed: false.
			// `[...]` clone keeps the caller from mutating the entry's stored array.
			// Cached entry's diagnostics were normalized at the time the entry was stored.
			return { changed: false, diagnostics: [...pending.ingestDiagnostics] };
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
		let unfilteredDeps: Array<string>;
		if (pending.preResolvedDeps !== undefined) {
			const depSet = new Set<string>();
			for (const raw of pending.preResolvedDeps) {
				const posix = toPosixPath(raw);
				if (!isSource(posix, sourceOptions)) continue;
				depSet.add(posix);
			}
			unfilteredDeps = [...depSet];
		} else {
			unfilteredDeps = depsFromResolved(resolved);
		}

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
						ingestDiagnostics: pending.ingestDiagnostics
					}
				: {
						mode: 'lex+resolve',
						content: pending.file.content,
						virtual: pending.virtual,
						unfilteredDeps,
						// Non-null assert: lex+resolve branch implies the batch picked a
						// resolver, so phase 1 stored its identity on the pending entry.
						resolverIdentity: pending.resolverIdentity!,
						ingestDiagnostics: pending.ingestDiagnostics
					};
		if (entry.mode === 'lex+resolve' && hasDeferredResolution(pending.specifiers, resolved)) {
			entry.unresolved = {
				specifiers: pending.specifiers,
				resolved: [...resolved],
				seq: ingestSeq
			};
		}
		if (pending.transformFailed) entry.transformFailed = true;
		// A path new to the owned set falsifies cached resolution failures, so
		// the generation moves; the dir index is idempotent and just gets told.
		if (!owned.has(pending.file.id)) ownedGeneration++;
		ownedDirs.add(pending.file.id);
		owned.set(pending.file.id, entry);

		// LS push — virtual path for successful Svelte transforms, real path
		// for TS/JS. CSS/JSON aren't TypeScript-resolvable; skip the push.
		// Transform-failed Svelte: no virtual; skip.
		const analyzer = sourceOptions.getAnalyzerType(pending.file.id);
		if (pending.virtual) {
			ls.setFile(pending.virtual.virtualPath, pending.virtual);
		} else if (analyzer === 'typescript') {
			ls.setFile(pending.file.id, pending.file);
		} else if (pending.previousVirtualPath) {
			// Transform regressed (had virtual → now transform_failed). Evict the
			// stale virtual from the LS so other files importing this `.svelte`
			// don't see the prior svelte2tsx output via the checker.
			ls.deleteFile(pending.previousVirtualPath);
		}

		return { changed: true, diagnostics: [...pending.ingestDiagnostics] };
	};

	// Batch ingest core: orchestrate three phases. `rawDeps` carries the
	// batch's posixified resolved import targets before any `isSource`
	// filtering — the context-closure seed; never stored on entries.
	const runBatch = async (
		files: ReadonlyArray<SourceFileInfo>,
		opts?: SetFileOptions
	): Promise<{ result: SetFilesResult; rawDeps: Set<string> }> => {
		await ensureLexerReady();

		// Resolver gating: pick one only if any file in the batch lacks
		// `dependencies` (i.e., needs lex+resolve). For fully pre-resolved
		// batches the resolver is never consulted, so we skip `pickResolver`
		// entirely — that avoids constructing the lazy default
		// (`createDefaultResolver`) for consumers like the Gro filer that
		// always hand over pre-resolved deps.
		const needsResolver = files.some((f) => f.dependencies === undefined);
		// Normalize the per-call override (bare fn → fresh identity each call).
		const resolver: ImportResolver | null = needsResolver
			? pickResolver(normalizeResolveImport(opts?.resolveImport))
			: null;

		// Drop resolution state cached before the owned set last changed shape.
		// The default resolver caches `ts.resolveModuleName` results for its
		// lifetime, failed lookups included — without this, a dep ingested
		// after an importer already failed to resolve it would never produce an
		// edge, however many times the importer changed afterwards. A resolver
		// that has never run here counts as stale (no entry ≠ current
		// generation), which costs one no-op clear on a cold cache.
		if (resolver !== null && resolverGenerations.get(resolver) !== ownedGeneration) {
			resolver.invalidate?.();
			resolverGenerations.set(resolver, ownedGeneration);
		}

		// Posixify ids at ingest — the internal contract is forward-slash
		// everywhere. Skip the clone when the input is already POSIX (common
		// path on Linux/macOS).
		const normalizedFiles = files.map((f) => {
			const posixId = toPosixPath(f.id);
			return posixId === f.id ? f : { ...f, id: posixId };
		});

		// Overlay the batch onto the resolution host's view for the duration
		// of the phases — see `pendingBatch`.
		for (const f of normalizedFiles) {
			pendingBatch.set(f.id, f.content);
			pendingDirs.add(f.id);
		}
		try {
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
				// Load-bearing beyond the wasted work it avoids: a cache hit's
				// `ingestDiagnostics` is the *stored* array, already normalized at
				// rest, and phase 3 skips it — so a `resolver_failed` pushed here
				// would never be normalized and would ship an absolute path.
				if (p.cacheHit) continue;
				for (let si = 0; si < p.specifiers.length; si++) {
					// Skip Node builtins — never a source file, and routing them
					// through a host resolver (Vite/Rollup) provokes spurious
					// "externalized for browser compatibility" warnings. The
					// resolved slot stays `null` (its pre-filled default).
					if (isNodeBuiltin(p.specifiers[si]!)) continue;
					tasks.push({ pendingIdx: pi, specIdx: si, specifier: p.specifiers[si]! });
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
					'svelte-docinfo: phase-2 invariant violated — tasks pending without a resolver'
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
						error: undefined
					};
				} catch (err) {
					return {
						...t,
						resolved: null,
						error: to_error_message(err)
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
				p.cacheHit ? [] : new Array<string | null>(p.specifiers.length).fill(null)
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
					specifier: r.specifier
				});
			}

			// Raw dependency targets of the batch's changed files (posixified,
			// pre-`isSource`) — the context-closure seed. Cache-hit entries
			// contribute nothing: their closure was walked when they last changed,
			// and a context file missed then (e.g. an unreadable candidate)
			// self-heals on the importer's next change.
			const rawDeps = new Set<string>();
			for (let i = 0; i < pendings.length; i++) {
				const p = pendings[i]!;
				if (p.cacheHit) continue;
				if (p.preResolvedDeps !== undefined) {
					for (const raw of p.preResolvedDeps) rawDeps.add(toPosixPath(raw));
				} else {
					for (const r of resolvedByPending[i]!) {
						if (r !== null) rawDeps.add(r);
					}
				}
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

			return { result: { changedIds, diagnostics: aggregateDiagnostics, perFile }, rawDeps };
		} finally {
			// Whole-overlay clear rather than per-file removal: the overlay is
			// exactly this batch (never nested, never overlapping), so there is
			// nothing else in it to preserve.
			pendingBatch.clear();
			pendingDirs.clear();
		}
	};

	// Context-closure ingest (see `AnalysisSessionOptions.contextClosure`).

	const contextClosureEnabled = options.contextClosure ?? true;
	const rootPrefix = sourceOptions.projectRoot.endsWith('/')
		? sourceOptions.projectRoot
		: `${sourceOptions.projectRoot}/`;

	// A raw dependency target qualifies as a context candidate when it is
	// in-root, not already owned, fails `isSource` (source files come from the
	// caller or discovery, never from closure — under exports discovery an
	// undiscovered source file must not sneak into the emitted set), carries
	// no `node_modules`/dot-directory segments (package deps and build caches
	// are not project context), and has an analyzer type (binary assets a
	// custom resolver resolves are not ingestable).
	const isContextCandidate = (dep: string): boolean =>
		!owned.has(dep) &&
		dep.startsWith(rootPrefix) &&
		!isSource(dep, sourceOptions) &&
		!hasBaselineExcludedSegment(dep.slice(rootPrefix.length)) &&
		sourceOptions.getAnalyzerType(dep) !== null;

	// Walk the candidate set to a fixpoint: read each candidate from disk,
	// ingest it through the normal batch pipeline (owned, LS-pushed,
	// version-tracked — but gated from output by `query()`), and recurse on
	// the new batch's raw deps. Terminates because each round only processes
	// never-attempted paths. Unreadable candidates are skipped silently — the
	// LS disk fallback (or a genuinely broken import) covers them.
	const ingestContextClosure = async (
		seedDeps: ReadonlySet<string>,
		opts: SetFileOptions | undefined
	): Promise<void> => {
		const attempted = new Set<string>();
		let candidates = [...seedDeps].filter(isContextCandidate);
		while (candidates.length > 0) {
			for (const c of candidates) attempted.add(c);
			const loaded = await map_concurrent(candidates, MAX_FILE_CONCURRENCY, async (id) => {
				try {
					return { id, content: await readFile(id, 'utf-8') };
				} catch {
					return null;
				}
			});
			const files = loaded.filter((f) => f !== null);
			if (files.length === 0) return;
			const batch = await runBatch(files, opts);
			candidates = [...batch.rawDeps].filter((id) => !attempted.has(id) && isContextCandidate(id));
		}
	};

	// Retry the deferred resolutions of *owned* entries after a batch adds
	// paths (see `OwnedEntryLexResolve.unresolved`).
	//
	// The entry cache is keyed on content, so an importer that resolved a
	// specifier to nothing before its target existed is a cache hit forever
	// after: without this pass its edge would only appear when the importer's
	// own content next changed, which is the wrong trigger — the file that
	// changed is the dep. The build-tool flow is exactly this shape (a watcher
	// hands over the created file alone), so leaving it to the next edit means
	// the graph is quietly wrong in between.
	//
	// Scoped tightly: only entries carrying deferred slots, only slots resolved
	// before this call (see `unresolved.seq`), only their `null` slots, and
	// only when the entry's resolver is the one in effect now (a different
	// resolver is a different answer, not a stale one). No re-lex, no
	// re-transform, and edges rebuild from the full array rather than being
	// appended to, so the entry matches a fresh ingest byte for byte. Deletion
	// needs no counterpart — a resolved target that goes away is filtered out
	// at query time by the owned-set projection.
	//
	// The resolver's own cache needs no clearing here even though phase 3 just
	// moved the generation: everything this call commits was already visible to
	// its phase 2 through the pending overlay, so the cache cannot be holding a
	// false negative for it. Only a *previous* call's answers are stale, and
	// `runBatch` cleared those at the top.
	//
	// A settled slot also retires the `resolver_failed` its ingest emitted, if
	// any — the claim was true then and isn't now. Two margins remain, both
	// self-healing on the importer's next ingest: a resolver that throws *here*
	// leaves the slot deferred and its original diagnostic standing, and a
	// newly-resolved edge pointing at an in-root non-source file doesn't itself
	// seed a context-closure round.
	const healUnresolvedEdges = async (opts: SetFileOptions | undefined): Promise<void> => {
		// A scan of the owned set rather than a side index of deferred entries:
		// it can't desync, and it only runs on a batch that added paths.
		const stale: Array<[string, OwnedEntryLexResolve]> = [];
		for (const [id, entry] of owned) {
			if (entry.mode === 'lex+resolve' && entry.unresolved && entry.unresolved.seq !== ingestSeq) {
				stale.push([id, entry]);
			}
		}
		if (stale.length === 0) return;

		const resolver = pickResolver(normalizeResolveImport(opts?.resolveImport));
		const retries: Array<{ id: string; entry: OwnedEntryLexResolve; slot: number }> = [];
		for (const [id, entry] of stale) {
			if (entry.resolverIdentity !== resolver.identity) continue;
			const { specifiers, resolved } = entry.unresolved!;
			for (let i = 0; i < specifiers.length; i++) {
				if (resolved[i] === null && !isNodeBuiltin(specifiers[i]!)) {
					retries.push({ id, entry, slot: i });
				}
			}
		}
		if (retries.length === 0) return;

		const results = await map_concurrent(retries, MAX_RESOLVE_CONCURRENCY, async (r) => {
			try {
				const resolved = await resolver.resolve(r.entry.unresolved!.specifiers[r.slot]!, r.id);
				return { ...r, resolved: resolved === null ? null : toPosixPath(resolved) };
			} catch {
				return { ...r, resolved: null };
			}
		});

		const attempted = new Set<OwnedEntryLexResolve>();
		const settled = new Map<OwnedEntryLexResolve, Set<string>>();
		for (const r of results) {
			attempted.add(r.entry);
			if (r.resolved === null) continue;
			r.entry.unresolved!.resolved[r.slot] = r.resolved;
			let specifiers = settled.get(r.entry);
			if (!specifiers) {
				specifiers = new Set();
				settled.set(r.entry, specifiers);
			}
			specifiers.add(r.entry.unresolved!.specifiers[r.slot]!);
		}
		for (const entry of attempted) {
			const { specifiers, resolved } = entry.unresolved!;
			const settledSpecifiers = settled.get(entry);
			if (settledSpecifiers) {
				entry.unfilteredDeps = depsFromResolved(resolved);
				// A `resolver_failed` for a specifier that now resolves is no
				// longer true — durable ingest diagnostics would otherwise
				// publish it (LSP, the Vite virtual module) for the session's
				// life. Phase 2 emits at most one per (file, specifier), so
				// matching on the specifier drops exactly the settled ones.
				if (entry.ingestDiagnostics.length > 0) {
					entry.ingestDiagnostics = entry.ingestDiagnostics.filter(
						(d) => d.kind !== 'resolver_failed' || !settledSpecifiers.has(d.specifier)
					);
				}
			}
			if (hasDeferredResolution(specifiers, resolved)) {
				// Attempted under this call, so don't retry within it; the next
				// call that adds a path tries the remainder again — the specifier
				// it needs may be exactly what that call brings.
				entry.unresolved!.seq = ingestSeq;
			} else {
				// All settled — drop the retry state so the entry stops being scanned.
				entry.unresolved = undefined;
			}
		}
	};

	const setFiles = async (
		files: ReadonlyArray<SourceFileInfo>,
		opts?: SetFileOptions
	): Promise<SetFilesResult> => {
		ingestSeq++;
		const generationBefore = ownedGeneration;
		const { result, rawDeps } = await runBatch(files, opts);
		if (contextClosureEnabled) await ingestContextClosure(rawDeps, opts);
		// Only additions can settle a deferred resolution, and `deleteFile`
		// moves the generation too — but a batch never deletes, so a moved
		// generation here means paths were added.
		if (ownedGeneration !== generationBefore) await healUnresolvedEdges(opts);
		return result;
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
		ownedDirs.remove(posixId);
		ownedGeneration++;
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
		// Build query inputs from owned entries — gated by `isSource`, per cache
		// strategy A (store unfiltered, filter at query). Owned files outside
		// `sourcePaths` or matching `exclude` emit no module: they exist to give
		// the checker in-memory content (unsaved buffers, virtual files — the LS
		// host serves owned entries before falling back to disk), and gating at
		// query rather than ingest keeps that context intact while duplicates,
		// re-export resolution, and dependents all see only the emitted set.
		// Dependency edges were already `isSource`-filtered at ingest; filtering
		// against the emitted set here makes the invariant local — output never
		// references a module it doesn't contain.
		const log = opts?.log ?? options.log;
		const emittedIds = new Set<string>();
		for (const id of owned.keys()) {
			if (isSource(id, sourceOptions)) emittedIds.add(id);
		}
		// the gate is silent in diagnostics (context files are a supported use,
		// not a problem) — but a misconfigured sourcePaths yields an empty
		// result with zero signal, so surface the count as info
		const gatedCount = owned.size - emittedIds.size;
		if (gatedCount > 0) {
			log?.info(
				`Source gate: ${gatedCount} of ${owned.size} owned files emit no module (outside sourcePaths or matching exclude)`
			);
		}
		const sourceFiles: Array<SourceFileInfo> = [];
		const contextSvelteFiles: Array<SourceFileInfo> = [];
		const svelteVirtualFiles = new Map<string, SvelteVirtualFile>();
		const transformFailedIds = new Set<string>();

		for (const [id, entry] of owned) {
			if (!emittedIds.has(id)) {
				// Gated Svelte file with a good virtual (context closure, or a
				// caller-pushed input): offered to `analyzeCore` as canonical-fill
				// context so a public re-export of a gated component documents
				// with props. Analyzed only when referenced; never emits.
				if (entry.virtual && !entry.transformFailed) {
					contextSvelteFiles.push({ id, content: entry.content, dependencies: [] });
					svelteVirtualFiles.set(id, entry.virtual);
				}
				continue;
			}
			const filteredDeps = entry.unfilteredDeps.filter((d) => emittedIds.has(d));
			sourceFiles.push({ id, content: entry.content, dependencies: filteredDeps });
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
			contextSvelteFiles,
			onDuplicates: opts?.onDuplicates,
			log
		});

		return result;
	};

	const dispose = (): void => {
		ls.dispose();
		owned.clear();
		ownedDirs.clear();
	};

	return {
		setFile,
		setFiles,
		deleteFile,
		has,
		list,
		query,
		allIngestDiagnostics,
		getProgram: () => ls.getProgram(),
		dispose
	};
};
