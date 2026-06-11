/**
 * Import resolver primitives for the analysis session.
 *
 * Exposes the `ImportResolver` token contract (`{resolve, identity}`) plus
 * building blocks the session uses inside its three-phase setFiles pipeline:
 *
 * - `ensureLexerReady` — one-time wasm init for `es-module-lexer`. Phase 1 is
 *   sync per-file; the session awaits this once before the loop starts.
 * - `lexImports` — sync specifier extraction from already-prepared content
 *   (raw TS/JS, or svelte2tsx virtual content for `.svelte` files).
 * - `createDefaultResolver` — the TS + tsconfig fallback used when neither
 *   `AnalysisSessionOptions.resolveImport` nor a per-call override is provided.
 *   Carries a fresh symbol identity per session (cache-key-safe).
 * - `normalizeResolveImport` — coerces the public `ResolveImport` union (bare
 *   function or token-paired resolver) to an `ImportResolver` at each boundary.
 * - `wrapResolveImport` — the fn→token primitive behind `normalizeResolveImport`:
 *   wraps a bare function in an `ImportResolver`, synthesizing a throwaway
 *   identity unless a stable one is passed.
 *
 * @internal — subpath-importable for power users who want to drive resolution
 * outside the session, but not part of the stable barrel surface.
 *
 * @see `session.ts` for the three-phase ingestion pipeline that consumes these
 * @see `loadTsconfig` in `typescript-program.ts` for the TS module-resolution
 *   compiler-options shortcut used by the default resolver
 *
 * @module
 */

import {isBuiltin} from 'node:module';
import {dirname, isAbsolute, resolve as resolvePath} from 'node:path';
import ts from 'typescript';
import {init as esModuleLexerInit, parse as esModuleLexerParse} from 'es-module-lexer';

import {toPosixPath} from './paths.js';

/**
 * Bare import-resolver function — the convenience form.
 *
 * Resolve an import specifier to an absolute file path, or `null` if the
 * specifier is unresolvable (external package, missing file, etc.). May return
 * synchronously or asynchronously; sync returns are awaited harmlessly in the
 * session's parallel resolve phase.
 *
 * @param specifier - import specifier from source code
 * @param fromFile - absolute path of the importing file
 */
export type ResolveImportFn = (
	specifier: string,
	fromFile: string,
) => string | null | Promise<string | null>;

/**
 * Token-paired import resolver.
 *
 * `identity` is a stable opaque token that keys the session's resolve cache
 * alongside content. Cache hits require both (a) byte-for-byte identical
 * source content and (b) identity equality. Naive function-reference keys
 * would silently destroy cache reuse when callers wrap the resolver in fresh
 * closures (a very common pattern in Vite/Rollup plugins) — opaque tokens
 * lift the responsibility to the caller, where it can be done correctly.
 */
export interface ImportResolver {
	/** Resolve an import specifier to an absolute file path, or `null`. */
	resolve: ResolveImportFn;
	/**
	 * Stable opaque token identifying this resolver's cache scope.
	 *
	 * Two `ImportResolver`s with `identity` `===` to each other are treated
	 * as cache-equivalent. `string` for human-readable identities (e.g.,
	 * `'vite-plugin-container'`); `symbol` for generated sentinels.
	 */
	identity: string | symbol;
}

/**
 * Public resolver shape accepted across the API — a bare `ResolveImportFn` or
 * the token-paired `ImportResolver`.
 *
 * Every entry point that accepts `resolveImport` (`analyze`, `analyzeFromFiles`,
 * `createAnalysisSession`, and the session's `setFile`/`setFiles` per-call
 * override) takes this union, so the same value copy-pastes between them. Pass:
 *
 * - a **bare function** for the common case — a fresh cache identity is
 *   synthesized at the boundary. Correct for one-shot use (`analyze`,
 *   `analyzeFromFiles`) and for a session default (wrapped once at
 *   construction, so identity is stable for the session's lifetime).
 * - an **`ImportResolver`** with a stable `identity` when you need the session
 *   to reuse its resolve cache across calls where the same logical resolver is
 *   rebuilt as a fresh closure (Vite/Rollup plugins). A bare function handed to
 *   a *per-call* `setFile`/`setFiles` override is treated as a distinct
 *   resolver each call (fresh identity → touched files re-resolve), which is
 *   the expected behavior for a deliberate one-off override.
 */
export type ResolveImport = ResolveImportFn | ImportResolver;

/**
 * Normalize the public `ResolveImport` union to an `ImportResolver`.
 *
 * Wraps a bare function via `wrapResolveImport` (fresh synthesized identity);
 * passes a token-paired resolver through unchanged. `undefined` in, `undefined`
 * out — callers fall back to the session default. Call once per logical
 * resolver scope: at session construction for the default, per call for an
 * override.
 */
export const normalizeResolveImport = (
	value: ResolveImport | undefined,
): ImportResolver | undefined =>
	value === undefined ? undefined : typeof value === 'function' ? wrapResolveImport(value) : value;

/**
 * Ensure `es-module-lexer`'s wasm runtime is initialized.
 *
 * Idempotent and cheap after the first call. The session awaits this once at
 * the top of `setFiles` so phase 1's per-file lex is purely synchronous.
 */
export const ensureLexerReady = async (): Promise<void> => {
	await esModuleLexerInit;
};

/**
 * Lex import specifiers from prepared content.
 *
 * Sync — caller must have awaited `ensureLexerReady` at least once before
 * invoking. For `.svelte` files, pass the svelte2tsx-transformed virtual
 * content, not the raw `.svelte` source (which isn't lex-able as JS/TS).
 *
 * Dynamic imports (`import(specifier)` with non-literal arg) are omitted.
 *
 * @throws Error if lexing fails (malformed source). Callers should catch and
 *   emit `import_parse_failed`.
 *
 * @param content - prepared file content (TS/JS, or svelte2tsx virtual)
 * @param fileId - absolute file path (used for error messages)
 * @returns specifiers in declaration order
 */
export const lexImports = (content: string, fileId: string): Array<string> => {
	const [imports] = esModuleLexerParse(content, fileId);
	const specifiers: Array<string> = [];
	for (const imp of imports) {
		if (imp.n) specifiers.push(imp.n);
	}
	return specifiers;
};

/**
 * Whether a lexed specifier names a Node builtin (`fs`, `node:fs/promises`, …).
 *
 * Builtins can never be a project source file, so resolving them is pointless —
 * and routing them through a host resolver (Vite/Rollup) makes that host emit
 * "externalized for browser compatibility" warnings for browser-targeted
 * configs. Callers skip resolution for these and treat them as unresolved
 * (`null`), which the downstream `isSource` filter would do anyway.
 */
export const isNodeBuiltin = (specifier: string): boolean => isBuiltin(specifier);

/**
 * Create the default `ImportResolver` (TypeScript + tsconfig).
 *
 * Uses `ts.resolveModuleName` against `ts.sys` directly — no `ts.Program` is
 * built. Identity is a fresh symbol per call, so each session that constructs
 * its own default gets a unique cache scope. Multiple sessions sharing one
 * resolver instance share the cache scope (correct, since resolver state is
 * shared too).
 *
 * `ts.resolveModuleName` cannot resolve real `.svelte` files (no compiler
 * option teaches it the extension), so relative and absolute `.svelte`
 * specifiers — with or without the extension written — fall back to manual
 * filesystem resolution against `fromFile`. Non-relative `.svelte` specifiers
 * (tsconfig `paths` aliases, package subpaths) stay unresolved; supply a
 * custom `resolveImport` for those setups.
 *
 * @param compilerOptions - parsed tsconfig (from `loadTsconfig`)
 * @param projectRoot - absolute project root for the module-resolution cache
 */
export const createDefaultResolver = (
	compilerOptions: ts.CompilerOptions,
	projectRoot: string,
): ImportResolver => {
	const cache = ts.createModuleResolutionCache(
		projectRoot,
		ts.sys.useCaseSensitiveFileNames ? (f) => f : (f) => f.toLowerCase(),
		compilerOptions,
	);
	const resolve = (specifier: string, fromFile: string): string | null => {
		const result = ts.resolveModuleName(specifier, fromFile, compilerOptions, ts.sys, cache);
		if (result.resolvedModule) return result.resolvedModule.resolvedFileName;
		// ts.resolveModuleName never resolves real .svelte files — no compiler
		// option teaches it the extension — so resolve relative/absolute
		// specifiers manually, appending .svelte when it isn't written.
		if (specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier)) {
			const withExt = specifier.endsWith('.svelte') ? specifier : specifier + '.svelte';
			const candidate = isAbsolute(withExt) ? withExt : resolvePath(dirname(fromFile), withExt);
			// posixified for parity with ts.resolveModuleName, which always
			// returns forward-slash paths
			if (ts.sys.fileExists(candidate)) return toPosixPath(candidate);
		}
		return null;
	};
	return {resolve, identity: Symbol('ts-default')};
};

/**
 * Wrap a bare `resolveImport` function into an `ImportResolver` token.
 *
 * `identity` is optional; when omitted, a fresh `Symbol('wrapped')` is
 * synthesized per call. The synthesized default suits single-use scopes —
 * `normalizeResolveImport` relies on it to wrap a bare function for a one-shot
 * `analyze` call or for a session default (wrapped once at construction, so the
 * identity stays stable for the session's lifetime).
 *
 * For a long-lived session that re-wraps the *same* logical resolver across
 * calls (Vite plugin, LSP), a throwaway identity cache-misses every time — the
 * fresh `Symbol('wrapped')` never compares equal. Pass a stable `identity`
 * here, or — simpler — construct an `ImportResolver` (`{resolve, identity}`)
 * directly and pass it through the `ResolveImport` union.
 */
export const wrapResolveImport = (
	resolveImport: ResolveImportFn,
	identity: string | symbol = Symbol('wrapped'),
): ImportResolver => ({
	resolve: resolveImport,
	identity,
});

/**
 * Shared no-op `ImportResolver` for the "dependency resolution disabled" case.
 *
 * Stable string identity (`'no-deps'`) instead of a per-call symbol so that
 * repeated ingests within a long-lived session cache-hit on identity. Each
 * session still owns its own cache (entries live on the per-session `owned`
 * map; sessions don't share state), but within one session every reference
 * to `noDepsResolver` is `===` to every other — so a Vite re-save of
 * byte-identical content with `resolveDependencies: false` exercises the
 * cache-hit branch. The resolver always returns `null`, so any two calls
 * with identical content under this identity produce identical resolution
 * results — `string` identity correctly captures that. Used by both the
 * one-shot `analyzeFromFiles` path and the long-lived Vite plugin
 * (`resolveDependencies: false`).
 */
export const noDepsResolver: ImportResolver = {
	resolve: () => null,
	identity: 'no-deps',
};
