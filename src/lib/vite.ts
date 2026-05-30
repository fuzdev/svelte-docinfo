/**
 * Vite plugin for svelte-docinfo.
 *
 * Drives a long-lived `AnalysisSession` against a debounce-batched watcher.
 * Every file change funnels into a `pendingChanges` Map and flushes via one
 * `setFiles` + one `query` per debounce window — multi-file editor saves
 * collapse to a single re-analysis instead of N serialized round-trips.
 *
 * The plugin no longer maintains a `fileCache.content` mirror — `setFile`
 * returns `{changed: boolean}` so HMR invalidation reacts to that flag
 * directly. `session.list()` / `session.has()` cover owned-set introspection.
 *
 * Consumers import the analysis result:
 *
 * ```ts
 * import {modules, diagnostics} from 'virtual:svelte-docinfo';
 * ```
 *
 * For TypeScript support, add to your `app.d.ts`:
 *
 * ```ts
 * /// <reference types="svelte-docinfo/virtual-svelte-docinfo.js" />
 * ```
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import svelteDocinfo from 'svelte-docinfo/vite.js';
 *
 * export default defineConfig({
 *   plugins: [
 *     sveltekit(),
 *     svelteDocinfo(),
 *   ],
 * });
 * ```
 *
 * @module
 */

import {readFile} from 'node:fs/promises';
import type {Logger as ViteLogger, Plugin, ViteDevServer} from 'vite';

import {createAnalysisSession, type AnalysisSession} from './session.js';
import type {OnDuplicates} from './analyze-core.js';
import {discoverSourceFiles, type Discovery} from './discovery.js';
import type {SourceFileInfo} from './source.js';
import type {Diagnostic} from './diagnostics.js';
import type {AnalysisLog} from './log.js';
import {compactReplacer} from './declaration-helpers.js';
import {
	createSourceOptions,
	isSource,
	type ModuleSourceOptions,
	type SourceOptionsDefaults,
} from './source-config.js';
import {noDepsResolver, type ImportResolver} from './dep-resolver.js';
import {toPosixPath} from './paths.js';

const VIRTUAL_ID = 'virtual:svelte-docinfo';
const RESOLVED_VIRTUAL_ID = '\0virtual:svelte-docinfo';

/** Stable resolver identity for Vite's plugin-container resolver in dev mode. */
const VITE_DEV_IDENTITY = 'vite-plugin-container';

/** Options for the `svelteDocinfo` Vite plugin. */
export interface VitePluginSvelteDocinfoOptions {
	/**
	 * Absolute path to project root directory.
	 * Defaults to Vite's resolved `config.root`.
	 */
	projectRoot?: string;
	/**
	 * Glob patterns to include (relative to `projectRoot`).
	 *
	 * When provided under the default `discovery: 'auto'`, collapses the chain
	 * to glob (exports discovery is skipped). Combining `include` with
	 * `discovery: 'exports'` throws at config-resolve time — `exports` mode
	 * has no concept of include patterns.
	 *
	 * When omitted, the glob fallback derives an include from
	 * `sourceOptions.sourcePaths` via `deriveIncludePatterns`, so custom
	 * `sourcePaths` survive the fallback instead of silently defaulting to
	 * `src/lib`.
	 */
	include?: Array<string>;
	/**
	 * Glob patterns to exclude, applied at both discovery and analysis time.
	 *
	 * When provided, **fully replaces** `sourceOptions.exclude` (no array
	 * merge) — the default test and spec filters are dropped unless
	 * re-included explicitly.
	 */
	exclude?: Array<string>;
	/**
	 * Whether to resolve import dependencies.
	 *
	 * When `false`, the session's resolver returns null for every specifier,
	 * so module dependencies/dependents stay empty.
	 *
	 * @default true
	 */
	resolveDependencies?: boolean;
	/**
	 * Discovery strategy for source files.
	 *
	 * @default 'auto'
	 * @see {@link Discovery}
	 */
	discovery?: Discovery;
	/**
	 * Dist directory name relative to project root, used for exports-based discovery.
	 * @default 'dist'
	 */
	distDir?: string;
	/**
	 * Partial overrides for default source options (SvelteKit `src/lib` layout).
	 */
	sourceOptions?: Partial<SourceOptionsDefaults>;
	/** Behavior when duplicate declaration names are found across modules. */
	onDuplicates?: OnDuplicates;
	/**
	 * HMR debounce delay in milliseconds. Coalesces rapid file changes during dev.
	 * @default 100
	 */
	hmrDebounceMs?: number;
}

/**
 * Vite plugin: analyzes TypeScript and Svelte source files via a persistent
 * `AnalysisSession` and serves the result as `virtual:svelte-docinfo`.
 *
 * In dev mode, watches source files and triggers debounced HMR updates on
 * changes via `setFiles` batches drained from a pending-changes Map.
 * In build mode, runs analysis once during `buildStart`.
 */
const svelteDocinfo = (options: VitePluginSvelteDocinfoOptions = {}): Plugin => {
	const {
		include,
		exclude,
		resolveDependencies = true,
		discovery,
		distDir,
		sourceOptions,
		onDuplicates,
		hmrDebounceMs = 100,
	} = options;

	let projectRoot: string;
	let resolvedSourceOptions: ModuleSourceOptions;
	let logger: ViteLogger | null = null;
	let isDev = false;
	let modulesJson = '[]';
	let diagnosticsJson = '[]';
	let cachedModuleCode: string | null = null;
	let server: ViteDevServer | null = null;
	let session: AnalysisSession | null = null;

	// Discovery diagnostics survive across HMR cycles (the discovery pass only
	// runs at cold start). Tracked here because the session has no concept of
	// "discovery" — it ingests files the plugin hands to it.
	let discoveryDiagnostics: Array<Diagnostic> = [];

	// ── Resolver wiring ──────────────────────────────────────────────────────
	// Dev resolver: server.pluginContainer.resolveId. Stable identity across
	// the dev session — cache hits work across HMR cycles.
	const viteDevResolver: ImportResolver = {
		resolve: async (specifier, fromFile) => {
			try {
				const r = await server!.pluginContainer.resolveId(specifier, fromFile);
				return r?.id ?? null;
			} catch {
				return null;
			}
		},
		identity: VITE_DEV_IDENTITY,
	};

	// ── In-flight analysis tracking ─────────────────────────────────────────
	// Initial analysis runs once in buildStart; HMR flushes run on debounce.
	// `load()` awaits both so we never serve stale JSON to a freshly-importing
	// module.
	let initialPromise: Promise<void> | null = null;
	let hmrFlushPromise: Promise<void> | null = null;
	const waitInflight = async (): Promise<void> => {
		if (initialPromise) await initialPromise;
		if (hmrFlushPromise) await hmrFlushPromise;
	};

	// Pending-changes Map: path → newContent (string) or unlink marker (null).
	// Drained by `flushBatch`; survives across multiple flush cycles when new
	// events arrive mid-flight.
	const pendingChanges = new Map<string, string | null>();

	// Per-path event sequence. Watcher events (change/add/unlink) bump the
	// counter and stamp the path with the new value; async handlers (the
	// `change` handler awaits readFile before enqueueing) capture the seq at
	// dispatch and drop their result if a newer event has stamped the path
	// in between. Without this, an `unlink` arriving during a `change`'s
	// in-flight readFile gets clobbered when the read resolves with stale
	// content for a now-deleted file.
	let eventSeqCounter = 0;
	const eventSeqs = new Map<string, number>();
	const stampEvent = (path: string): number => {
		const seq = ++eventSeqCounter;
		eventSeqs.set(path, seq);
		return seq;
	};
	const isLatestEvent = (path: string, seq: number): boolean => eventSeqs.get(path) === seq;

	const buildModuleCode = (): string => {
		if (cachedModuleCode !== null) return cachedModuleCode;
		const lines = [
			`export const modules = ${modulesJson};`,
			`export const diagnostics = ${diagnosticsJson};`,
			`export default {modules, diagnostics};`,
		];
		if (isDev) {
			lines.push(`if (import.meta.hot) { import.meta.hot.accept(); }`);
		}
		cachedModuleCode = lines.join('\n');
		return cachedModuleCode;
	};

	const updateOutputFromQuery = (
		modules: ReadonlyArray<unknown>,
		queryDiagnostics: ReadonlyArray<Diagnostic>,
	): boolean => {
		// `JSON.stringify([], compactReplacer)` returns the JS `undefined` because
		// the replacer strips empty arrays — we embed the JSON into a template
		// literal where that would interpolate as the literal text `"undefined"`,
		// so handle the empty-modules case explicitly.
		const newModulesJson = modules.length === 0 ? '[]' : JSON.stringify(modules, compactReplacer);
		// Pull cumulative ingest diagnostics from the session — every owned
		// entry's `ingestDiagnostics` are walked there. Discovery diagnostics
		// don't pass through the session (file discovery happens before ingest),
		// so we maintain those separately and merge at publish time.
		const ingest = session ? session.allIngestDiagnostics() : [];
		const merged: Array<Diagnostic> = [...ingest, ...discoveryDiagnostics, ...queryDiagnostics];
		const newDiagnosticsJson = JSON.stringify(merged);
		if (newModulesJson === modulesJson && newDiagnosticsJson === diagnosticsJson) return false;
		modulesJson = newModulesJson;
		diagnosticsJson = newDiagnosticsJson;
		cachedModuleCode = null;
		return true;
	};

	const sendHmrInvalidation = (): void => {
		if (!server) return;
		const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
		if (!mod) return;
		server.moduleGraph.invalidateModule(mod);
		// Hardcoded Vite URL encoding for \0 prefix on virtual modules.
		// Not a documented Vite public API — if Vite changes the encoding in a
		// future release, HMR silently stops firing (initial load still works
		// through the public resolveId/load hooks). Same pattern as
		// vite_plugin_fuz_css; update both if Vite exposes a proper API.
		const hmrPath = '/@id/__x00__virtual:svelte-docinfo';
		server.hot.send({
			type: 'update',
			updates: [
				{
					type: 'js-update',
					path: hmrPath,
					acceptedPath: hmrPath,
					timestamp: Date.now(),
				},
			],
		});
	};

	const errorLog = (err: unknown): void => {
		const log: Pick<AnalysisLog, 'error'> = logger ?? {error: (msg) => console.error(msg)};
		const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
		log.error(`[svelte-docinfo] ${message}`);
	};

	const isWatchedFile = (file: string): boolean => isSource(file, resolvedSourceOptions);

	// ── Initial analysis (cold start in buildStart) ──────────────────────────
	const runInitialAnalysis = async (): Promise<void> => {
		if (!session) return;
		const {files, diagnostics} = await discoverSourceFiles({
			sourceOptions: resolvedSourceOptions,
			include,
			discovery,
			distDir,
			log: logger ?? undefined,
		});
		discoveryDiagnostics = diagnostics;

		await session.setFiles(files);
		const result = session.query({onDuplicates, log: logger ?? undefined});
		updateOutputFromQuery(result.modules, result.diagnostics);
	};

	// ── HMR flush: drain pendingChanges via setFiles + query ─────────────────
	const flushBatch = async (): Promise<void> => {
		if (initialPromise) await initialPromise;
		if (!session) return;
		if (pendingChanges.size === 0) return;

		// Drain. New events arriving during this flush land in pendingChanges
		// and are picked up by the surrounding while-loop in `scheduleFlush`.
		const drained = [...pendingChanges];
		pendingChanges.clear();

		const toAdd: Array<SourceFileInfo> = [];
		const toDelete: Array<string> = [];
		for (const [path, content] of drained) {
			if (content === null) toDelete.push(path);
			else toAdd.push({id: path, content});
		}

		// Apply deletions first so re-adds (rare but possible: unlink+add same
		// path within one debounce window) work correctly.
		for (const path of toDelete) await session.deleteFile(path);

		let anyChanged = toDelete.length > 0;
		if (toAdd.length > 0) {
			const ingest = await session.setFiles(toAdd);
			if (ingest.changedIds.size > 0) anyChanged = true;
		}

		if (!anyChanged) return;

		// `updateOutputFromQuery` pulls the cumulative ingest diagnostics from
		// `session.allIngestDiagnostics()` itself — no per-batch survival
		// tracking needed at the plugin layer.
		const result = session.query({onDuplicates, log: logger ?? undefined});
		const updated = updateOutputFromQuery(result.modules, result.diagnostics);
		if (updated) sendHmrInvalidation();
	};

	const scheduleFlush = (): Promise<void> => {
		if (hmrFlushPromise) return hmrFlushPromise;
		hmrFlushPromise = (async () => {
			await new Promise<void>((r) => setTimeout(r, hmrDebounceMs));
			try {
				while (pendingChanges.size > 0) {
					await flushBatch();
				}
			} catch (err) {
				errorLog(err);
			} finally {
				hmrFlushPromise = null;
			}
		})();
		return hmrFlushPromise;
	};

	const enqueueChange = (path: string, content: string | null): void => {
		pendingChanges.set(path, content);
		// `eventSeqs[path]` is no longer needed once the latest event has been
		// enqueued: any older in-flight handler will fail `isLatestEvent`
		// against `undefined`, and any newer event will re-stamp on arrival.
		// Bounds the Map's growth in long-running dev sessions with churn.
		eventSeqs.delete(path);
		void scheduleFlush();
	};

	return {
		name: 'vite-plugin-svelte-docinfo',

		configResolved(config) {
			projectRoot = options.projectRoot ?? config.root;
			// `exclude` shortcut overrides `sourceOptions.exclude` (same precedence
			// as `analyzeFromFiles`).
			const mergedSourceOptions =
				exclude !== undefined ? {...sourceOptions, exclude} : sourceOptions;
			resolvedSourceOptions = createSourceOptions(projectRoot, mergedSourceOptions);
			// Reject contradictory discovery config upfront so failures are at
			// config-load time rather than first analysis.
			if (discovery === 'exports' && include) {
				throw new Error(
					"svelte-docinfo: discovery: 'exports' is incompatible with `include`. " +
						"Use discovery: 'glob' (with include) or remove include for strict exports mode.",
				);
			}
			logger = config.logger;
			isDev = config.command === 'serve';
		},

		async buildStart() {
			// Choose resolver based on mode; create the session here (after
			// configResolved set sourceOptions; for dev, after configureServer
			// set `server`).
			let sessionResolver: ImportResolver | undefined;
			if (!resolveDependencies) {
				sessionResolver = noDepsResolver;
			} else if (server) {
				sessionResolver = viteDevResolver;
			} else {
				// Build mode: resolve via the session's TS-based default
				// (`createDefaultResolver`, reached by leaving `resolveImport`
				// undefined) rather than Rollup's `this.resolve`. `this.resolve`
				// mutates the active build's module graph, so resolving a bare
				// package specifier from the analyzed source — e.g. `vite`,
				// imported (type-only) by this module — pulls the whole
				// toolchain (vite → rollup → esbuild) into the client bundle.
				// It tree-shakes away, but floods the log with "externalized for
				// browser" warnings. `ts.resolveModuleName` is side-effect-free
				// and honors tsconfig `paths` (incl. SvelteKit's generated
				// `$lib`), which covers internal dependency edges. Node builtins
				// are already filtered before the resolver (see `session.ts`).
				sessionResolver = undefined;
			}

			// Recreate session on each buildStart so `vite build --watch` cycles
			// get a fresh LS — the document registry across builds isn't a
			// guaranteed-stable contract from Vite's side.
			session?.dispose();
			session = createAnalysisSession({
				sourceOptions: resolvedSourceOptions,
				resolveImport: sessionResolver,
				log: logger ?? undefined,
			});

			initialPromise = runInitialAnalysis().finally(() => {
				initialPromise = null;
			});
			await initialPromise;
		},

		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
			return undefined;
		},

		async load(id) {
			if (id !== RESOLVED_VIRTUAL_ID) return undefined;
			// Wait for any in-flight analysis (initial or HMR-triggered) so we
			// never serve stale JSON to a freshly-importing module.
			await waitInflight();
			return buildModuleCode();
		},

		configureServer(devServer) {
			server = devServer;

			devServer.watcher.on('change', (rawFile) => {
				// Watcher emits native-separator paths on Windows. Posixify at
				// the boundary so eventSeqs/pendingChanges keys, isWatchedFile
				// checks, and downstream session calls all share one canonical id.
				const file = toPosixPath(rawFile);
				if (!isWatchedFile(file)) return;
				// Stamp the event before awaiting readFile so a later unlink/add
				// for the same path bumps the seq and our resolution drops below.
				const seq = stampEvent(file);
				// `.catch(errorLog)` — a sync throw before the first `await` would
				// otherwise become an unhandled rejection.
				void (async () => {
					// Re-read the file. Editors that touch mtime without changing
					// content (formatters saving idempotently) trigger spurious
					// events; the session's content-equality check in setFile
					// handles that case — `changed: false` short-circuits the
					// HMR invalidation.
					let newContent: string;
					try {
						newContent = await readFile(file, 'utf-8');
					} catch {
						// File became unreadable between event and read — treat as unlink.
						if (isLatestEvent(file, seq)) enqueueChange(file, null);
						return;
					}
					// A newer event (unlink/add/change) stamped this path while we
					// were reading — discard our result so we don't overwrite it
					// with stale content (e.g. ingesting a since-deleted file).
					if (!isLatestEvent(file, seq)) return;
					enqueueChange(file, newContent);
				})().catch(errorLog);
			});

			devServer.watcher.on('add', (rawFile) => {
				const file = toPosixPath(rawFile);
				if (!isWatchedFile(file)) return;
				const seq = stampEvent(file);
				void (async () => {
					try {
						const content = await readFile(file, 'utf-8');
						if (!isLatestEvent(file, seq)) return;
						enqueueChange(file, content);
					} catch (err) {
						errorLog(err);
					}
				})().catch(errorLog);
			});

			devServer.watcher.on('unlink', (rawFile) => {
				const file = toPosixPath(rawFile);
				// Use session.has() as the gate: paths outside source paths were
				// never owned, so nothing to do.
				if (!session?.has(file)) return;
				stampEvent(file);
				enqueueChange(file, null);
			});

			devServer.httpServer?.on('close', () => {
				session?.dispose();
				session = null;
			});
		},
	};
};

export default svelteDocinfo;
