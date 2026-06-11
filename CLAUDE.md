# svelte-docinfo

> static analysis for TypeScript and Svelte

Extracts structured metadata from TypeScript and Svelte 5 source via the TypeScript
compiler API — full type inference instead of manual annotations. Build-tool agnostic;
consumers add package metadata and formatting. Use cases: docs, code search, dev tools.

Conventions: [fuz-stack skill](https://github.com/fuzdev/fuz_docs).

## Committing

`git add` and `git commit` are denied by `.claude/settings.local.json` in
this repo — make the edits and stop, the user commits.

**Examples**: `examples/vite/`, `examples/api/`, `examples/cli/`

## Capabilities

- **Full type resolution** — imported types, generics, complex inferred types
- **TSDoc/JSDoc** — standard tags (`@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@see`, `@since`, `@default`, `@module`) plus `@nodocs` and `@mutates`. `@mutates` keys are unvalidated — typically a parameter name; compound paths (`this.foo`) and external state references accepted as-is. Dotted `@param obj.prop` tags for named object parameters surface as `ParameterJson.propertyDescriptions` (keyed by sub-path: `obj.prop` → `prop`, `obj.a.b` → `a.b`); the property segment is unvalidated like `@mutates`. Matching is by parameter name, so destructured params (`__0` synthetic names) are not covered
- **Svelte 5 components** — props via svelte2tsx, generics, snippet parameter extraction
- **Reactivity runes** — detects `$state`, `$state.raw`, `$derived`, `$derived.by` initializers (variables and class fields, `reactivity` field)
- **Re-export tracking** — `alsoExportedFrom` for same-name (with the forward view on `ModuleJson.reExports` — `{name, module, typeOnly, sourceLine}`), `aliasOf` for renames, star exports tracked separately, direct external re-exports on `externalReExports`/`externalStarExports`; default slot uses `name === 'default'` (see Re-Export Philosophy)
- **Dependency graphs** — imports/dependents between source modules
- **Function overloads** — all public signatures with per-overload JSDoc. Signature-scope tags (`@param`/`@returns`) flow to that overload's `parameters[i].description`/`returnDescription`. Symbol-scope tags (`@example`, `@deprecated`, `@since`, `@see`, `@throws`, `@mutates`, `@default`, `@nodocs`) belong on the parent only; on a non-primary overload they emit `misplaced_tag` and are dropped
- **Source locations** — file + line for declarations; synthesized aliases and re-export edges carry the local export specifier's line (Svelte `<script module>` lines remapped to the original source)
- **Diagnostic collection** — accumulates without halting; `partial: true` on declarations/members where extraction failed mid-flight. See Diagnostic Collection for kinds, ingest-time vs query-time split, and discovery-category routing.

## Architecture

### Modules

**Low-level** (compiler API wrappers)

- `typescript-program.ts` — program / language-service creation: `createAnalysisProgram(AnalysisProgramOptions)` (one-shot `ts.Program`), `createAnalysisLanguageService(AnalysisLanguageServiceOptions)` (persistent `ts.LanguageService` with versioned `IScriptSnapshot`s — `getProgram`/`setFile`/`deleteFile`/`hasFile`/`dispose`), `loadTsconfig(LoadTsconfigOptions?)` (returns `{compilerOptions, rootFileNames}` without building a program; used by the session's lazy default `ImportResolver`), `IsExternalFile`/`createIsExternalFile`. Options hierarchy: `LoadTsconfigOptions` (projectRoot/tsconfig/compilerOptions) ← `AnalysisProgramOptions` (+virtualFiles) ← `AnalysisLanguageServiceOptions` (+documentRegistry). `AnalysisSessionOptions` (`analyze.ts`) extends `Omit<AnalysisLanguageServiceOptions, 'projectRoot' | 'virtualFiles'>`. Internal `resolveSvelteVirtualSpecifier` keeps `.svelte` resolution identical across both program paths
- Per-kind extractors at `typescript-extract-*.ts` (`@internal`, not stable API) — split per kind, imported directly (no barrel). Used by `analyzeDeclaration` and fixture-based tests:
  - `typescript-extract-shared.ts` — cross-kind helpers: `inferDeclarationKind`, `extractSignatureParameters`, `populateCallableMember` (shared signature→member projection for functions, methods, constructors, type-alias function properties), `emitCallOrConstructSignature` (interface + type-alias property processing), `parseGenericParam`, `extractModifiers`, `getNodeLocation`, `detectReactivity`, `filterExternalProperties`, `isExternalIntersectionBranch`, `resolveIntersectionTypeNode`
  - `typescript-extract-function.ts` — `extractFunctionInfo`, `extractVariableInfo`
  - `typescript-extract-type.ts` — `extractTypeInfo` (type aliases + interfaces), `extractEnumInfo`
  - `typescript-extract-type-properties.ts` — `extractTypeAliasProperties` (named properties, index/call/construct signatures, external-property filtering, mapped-type readonly)
  - `typescript-extract-class.ts` — `extractClassInfo` (members, accessors, constructor)
- `typescript-exports.ts` — module-level orchestration: `analyzeTypescriptModule`, `analyzeExports`, `analyzeDeclaration`, `extractModuleComment`. Handles alias chains, namespace classification, JSDoc routing for re-exports
- `tsdoc.ts` — JSDoc/TSDoc parsing: `parseComment`, `applyToDeclaration`, `cleanComment`, `hasModuleTag`
- `diagnostics.ts` — Zod schemas: `Diagnostic` (`z.discriminatedUnion('kind', [...])` over 14 variants: 4 ingest-time, 9 query-time, 1 discovery-time), `DiagnosticKind`/`DiagnosticSeverity` enums. The diagnostics collection is a plain `Array<Diagnostic>` — no wrapper, no factory helper; construct with `[]`, mutate with `Array.push`, validate with `z.array(Diagnostic).parse(...)`. Read helpers: `hasErrors`, `hasWarnings`, `errorsOf`, `warningsOf`, `byKind`, `formatDiagnostic`. `Diagnostic.file` is contractually project-root-relative — `analyze`/`analyzeFromFiles` normalize via `projectRoot/` strip + `stripVirtualSuffix` before returning
- `log.ts` — `AnalysisLog` interface (minimal `info`/`warn`/`error` logger threaded through analysis functions). Separate from diagnostics: diagnostics are structured records, logs are unstructured progress messages

**Mid-level** (domain utilities)

- `svelte.ts` — Svelte component analysis via svelte2tsx: `analyzeSvelteModule`, `transformSvelteSource`, `extractScriptContent`, `extractSvelteModuleComment`, `extractHtmlModuleComment`. Snippet detection: `isSnippetTypeString`, `extractSnippetParameters`, `isSnippetReturnType`, `synthesizeSnippetTypeSignature`
- `source.ts` — file type predicates (`isTypescript`, `isSvelte`, `isCss`, `isJson`), virtual path helpers (`stripVirtualSuffix`, `SVELTE_VIRTUAL_SUFFIX`), `getDefaultAnalyzer`, `getComponentName`, types `SourceFileInfo`, `AnalyzerType`
- `paths.ts` — path-normalization chokepoint. `toPosixPath(p)` (backslash→forward, idempotent, fast-path on POSIX input). Contract: every path stored, compared, or `Map`/`Set`-keyed is POSIX form; downstream code inherits normalization through the seams below. Native paths accepted at public-API boundaries (`normalizeSourceOptions`, session `setFile`/`setFiles`/`deleteFile`/`has`, `analyze`, `analyzeFromFiles`); posixified at storage-bound `node:path` call sites whose result flows into a key, prefix comparison, or output field — `source-config.isSource`/`extractPath`, `analyze-core.normalizeDiagnosticPaths`, `typescript-program.resolveSvelteVirtualSpecifier`, `files.loadFile`/`globFiles`, `exports.discoverFromExports`, defensive `svelte.transformSvelteSource` and `postprocess.computeDependents` (cover direct callers outside the session), session phase-2 resolver outputs, `vite.ts` watcher events. Drive-letter case and `\\?\` prefixes out of scope (they don't arise from the path sources this library consumes)
- `concurrency.ts` — concurrency caps + bounded-`Promise.all` helper. `MAX_FILE_CONCURRENCY` (parallel `readFile`; `files.globFiles`, `exports.discoverFromExports`), `MAX_RESOLVE_CONCURRENCY` (parallel resolver calls; session phase 2), `map_concurrent` (order-preserving fail-fast worker pool). Same numerical cap today, named separately for future independent tuning
- `source-config.ts` — source configuration: `ModuleSourceOptions`, `createSourceOptions`, `normalizeSourceOptions`, `getSourceRoot`, `extractPath`, `isSource`, `extractDependencies`
- `types.ts` — Zod schemas: `DeclarationJson` (9-variant discriminated union), `MemberJson` (3-variant), `ModuleJson`, `OverloadJson`, `Reactivity` enum
- `declaration-build.ts` — internal construction types: `DeclarationJsonBuild`, `MemberJsonBuild`, `DeclarationAnalysis`, `ModuleExportsAnalysis`, `ModuleAnalysis` (re-export edges use the public `ReExportJson` from `types.ts`)
- `declaration-helpers.ts` — display (`getDisplayName`, `generateImport`), serialization (`compactReplacer`), narrowing (`isKind`), type-reference discovery (`findTypeReferences`, `buildTypeReferencePatterns`)
- `postprocess.ts` — `findDuplicates`, `mergeReExports`, `resolveComponentAliases`, `resolveExportSurface` (full export surface with ES star semantics — see Re-Export Philosophy), `sortModules`, `computeDependents`, `compareStrings` (code-unit comparator — all output ordering goes through it or default `.sort()`, never bare `localeCompare`, for environment-independent output)

**High-level** (orchestration)

- `analyze.ts` — one-shot wrappers `analyze(AnalyzeOptions)` (single-use session) and `analyzeFromFiles(AnalyzeFromFilesOptions)` (one-shot + file discovery + dep resolution). Does not re-export — the persistent session entry point (`createAnalysisSession`) lives in `session.ts`; shared types/values (`AnalyzeResultJson`, `AnalyzeResultJsonWire`, `throwOnDuplicates`, `OnDuplicates`/`OnDuplicatesCallback`, `analyzeModule`, `normalizeDiagnosticPaths`) live in `analyze-core.ts`; the resolver types (`ResolveImport` union, `ImportResolver`, `ResolveImportFn`) live in `dep-resolver.ts`; `Discovery` lives in `discovery.ts`. Consumers reach the common surface through the main barrel (`svelte-docinfo`) or import from the source module directly.
- `session.ts` — `createAnalysisSession(AnalysisSessionOptions)` (persistent; owns the LS, content cache, svelte2tsx virtual cache; δ surface `setFile`/`setFiles`/`deleteFile`/`has`/`list`/`query`/`allIngestDiagnostics`/`dispose`. `allIngestDiagnostics()` returns cumulative ingest-time diagnostics across owned entries — Vite plugin uses this to publish without tracking per-batch returns). Duplicate-name dispatch via `onDuplicates: 'throw' | 'warn' | OnDuplicatesCallback`
- `analyze-core.ts` — shared two-phase orchestrator: `analyzeCore()` (shared two-phase loop), `analyzeModule()` (single-module dispatcher for non-Svelte files), `AnalyzeResultJson`, `AnalyzeResultJsonWire` (serialized input-side counterpart published on `virtual:svelte-docinfo`; both re-exported from the barrel), `throwOnDuplicates`, `normalizeDiagnosticPaths`, `OnDuplicates`/`OnDuplicatesCallback`
- `vite.ts` — Vite plugin (default export `svelteDocinfo`); serves analysis as `virtual:svelte-docinfo`. Hooks: `configResolved` (resolve `projectRoot`/`sourceOptions`/`logger`; throws on `discovery: 'exports'` + `include`), `buildStart` (analyze), `resolveId`/`load` (serve cached), `configureServer` (file watching + debounced HMR). TypeScript support via `virtual-svelte-docinfo.d.ts` at the package root (not `src/lib/`) — see that file's header for why moving it breaks consumer type resolution

**File system helpers** (optional, for standalone projects)

- `discovery.ts` — `discoverSourceFiles` (exports-first with glob fallback), `DiscoverSourceFilesOptions`, `DiscoverSourceFilesResult`
- `files.ts` — `loadFile`, `globFiles`, `deriveIncludePatterns` (builds `<path>/**/*.{ts,js,svelte,css,json}` per source path; used by `discoverSourceFiles` to derive a default include from `sourcePaths`). Returned `SourceFileInfo.id` is POSIX-form per the `paths.ts` contract
- `exports.ts` — package.json exports discovery: `parsePackageExports`, `mapDistToSource`, `discoverFromExports`

**CLI**

- `cli.ts` — `runCli()` with commander argument parsing
- `main.ts` — entry point with shebang (compiles to `dist/main.js`)

**Barrel export**: `import {...} from 'svelte-docinfo'` re-exports the common API surface. Direct imports (e.g., `svelte-docinfo/typescript-exports.js`) expose each module's full public API for power users.

### Two-Phase Analysis

Re-exports reference declarations in other modules: phase 1 discovers, phase 2 links.

1. **Module analysis** — iterate source files, dispatch by file type (TS, Svelte, CSS, JSON), collect declarations and re-export info
2. **Re-export resolution** — `mergeReExports()` builds `alsoExportedFrom` arrays on canonical declarations; sort modules deterministically

### Build-Tool Agnostic

`SourceFileInfo` abstraction instead of direct file access:

```ts
interface SourceFileInfo {
	id: string; // absolute path (native ok at boundary; posixified at ingest)
	content: string; // file contents
	dependencies?: string[]; // opt-in: pre-resolved deps skip lex+resolve
}
```

Files may come from any source (filesystem, memory, build pipeline). Windows backslash paths posixified at the ingest boundary (see `paths.ts`); `session.list()` and output (`ModuleJson.path`, `Diagnostic.file`) report POSIX form. Reverse edges (`dependents`) are computed inside `computeDependents` from forward edges of the owned set, not caller-supplied; the enriched shape (`SourceFileInfo & {dependents?: string[]}`) flows through `analyzeModule`, `analyzeSvelteModule`, `extractDependencies`.

### File Discovery

`analyzeFromFiles()` discovers source files via the `discovery` option (a `Discovery` string union):

- `'auto'` (default) — try **package.json exports** first via `discoverFromExports()` (reads `exports`, maps dist → source; handles concrete entries, wildcard patterns, condition priorities `svelte` > `default` > `import` > `require`; `distDir` configurable, default `dist`). Fall back to **glob patterns** (`tinyglobby`) when `exports` is missing or empty; include derived from `sourceOptions.sourcePaths` via `deriveIncludePatterns` when no explicit `include` is supplied, so custom `sourcePaths` survive the fallback.
- `'exports'` — strict: package.json exports only. Throws when `exports` is missing/empty; combining with `include` is a config error (also throws).
- `'glob'` — skip exports; use globs parameterized by `include`.

Providing `include` under `'auto'` collapses the chain to glob immediately (exports discovery has no include-pattern concept; honoring it would silently drop the user's filter on packages with an `exports` field).

`exclude` is a single field on `ModuleSourceOptions` (globs, default `['**/*.test.ts', '**/*.spec.ts']`), applied at both stages: discovery filters via `globFiles`/`discoverFromExports`, analysis via `isSource()` against `relative(projectRoot, absolutePath)`. `AnalyzeFromFilesOptions.exclude` is a shortcut that fully replaces `sourceOptions.exclude` (no merge; applied before `createSourceOptions`). Compiled to a picomatch matcher cached by options-object identity — mutating `options.exclude` post-`isSource` has no effect.

`discoverSourceFiles()` (in `discovery.ts`) exposes discovery without running analysis, for build-tool integrations.

### Svelte 5+ Component Analysis

Svelte 5+ only by design — svelte2tsx output format changed significantly between versions and dual paths aren't worth the cost. Enforced at runtime with a clear error.

`analyzeSvelteModule` workflow:

1. Pre-transform `.svelte` files via svelte2tsx (`transformSvelteSource`)
2. Include virtuals in the TS program. One-shot path: `createAnalysisProgram({virtualFiles})`; session path: `setFile(virtualPath, content)` (re-keyed by content equality, so cached transforms survive analysis cycles). Custom `resolveModuleNameLiterals` maps `.svelte` imports to virtual paths for Svelte-to-Svelte re-exports; shared between both via `resolveSvelteVirtualSpecifier`
3. Run `analyzeExports()` on the virtual source for `<script module>` exports, re-exports, star exports; normalize virtual paths via `stripVirtualSuffix()`
4. Filter internal svelte2tsx identifiers (`$$*`, `__sveltets_*`, default export)
5. Reclassify exported snippets to `kind: 'snippet'` via `isSnippetReturnType`; synthesize `Snippet<[...]>` type string
6. Remap `sourceLine` for module-level exports back to the original `.svelte` source (`mapVirtualPosition`)
7. Synthesize `ComponentDeclarationJson` with `lang`, props, generics, JSDoc, source line, `acceptsChildren`
8. Extract props via `extractPropsViaChecker` — resolves imported types; extracts structured `parameters` for snippet-typed props; detects `acceptsChildren` via Path A (resolves `children` symbol on the unfiltered props type and verifies it is `Snippet<...>` — handles inherited `Snippet`-typed children from `SvelteHTMLElements`/`DOMAttributes` while rejecting non-Snippet `children: string`) or Path B (template usage via `__sveltets_2_ensureSnippet`)

### Incremental Analysis (`createAnalysisSession`)

Persistent handle backed by a `ts.LanguageService` for consumers re-analyzing the same source set repeatedly (Vite plugin, future LSP). One-shot consumers use `analyze()` / `analyzeFromFiles()` — both wrap a single-use session internally.

The session owns three caches keyed by absolute path:

1. **Source content** — `Map<id, {content, virtual?}>`. Each `analyze(input)` diffs by content equality: unchanged files reuse cached state; changed files push new content via `setFile` (version-bumps); disappeared files drop via `deleteFile`.
2. **svelte2tsx virtuals** — cached on the same entry. svelte2tsx is content-pure, so re-running is gated solely by source-content change. The `.svelte` source is never pushed to the LS — only the `.__svelte2tsx__.ts` virtual at `virtualPath`.
3. **`ts.LanguageService` state** — parsed ASTs and checker state, retained across `getProgram()` calls via the document registry. `getProgram()` returns the same `ts.Program` reference when no version bumped, else a fresh program reusing unchanged ASTs.

Dependency resolution lives inside `setFiles` — by default the session lexes import specifiers (phase 1) and resolves them in parallel (phase 2). Build-tool integrations with their own dep graph (Gro filer, etc.) can opt into a pre-resolved fast path via `SourceFileInfo.dependencies`: phase 1 skips lex and phase 2 has nothing to resolve, so `unfilteredDeps` is populated from the caller's absolute paths (post `isSource` filter and posixification). Cache key shifts accordingly — `(content, dependencies element-wise equality vs stored snapshot)` for pre-resolved, `(content, resolverIdentity)` for lex+resolve — and mode flips invalidate the cache. `query()` projects `unfilteredDeps` through the current owned set in either mode.

Two pre-resolved-path caveats:

- **Trust mode** — the session doesn't cross-check `SourceFileInfo.dependencies` against `content`. Declared edges accepted unconditionally; edges in `content` but absent from the array silently omitted. The lex+resolve path is always grounded in syntactic imports. Build-tool integrations own correctness; a buggy caller-side resolver skews `ModuleJson.dependencies`/`dependents` with no warning. Document-only, no opt-in diagnostic — legitimate cross-batch ingest sequences (declare-then-set, declare-then-delete) would produce noise.
- **Type-only edges** — whether `import type {X} from './x'` shows as a dep is the caller's resolver decision. Default lex+resolve (`es-module-lexer`) keeps type-only specifiers; Gro's filer (`parse_imports` with `ignore_types=true`) drops them. Switching lex+resolve → pre-resolved-via-Gro removes type-only edges from `ModuleJson.dependencies`. Intentional: type imports aren't runtime deps; the pre-resolved path defers the policy to the caller. Shallow-array cache key means callers producing fresh arrays per call (e.g., `[...filer.dependencies.keys()]`) cache-hit cleanly without upstream memoization; the session snapshots at ingest, so mid-flight mutation of the caller's array doesn't produce false hits.

`createAnalysisProgram` remains the one-shot entry point (tests, power users wanting a `ts.Program` with virtual-Svelte support). Sibling to `createAnalysisLanguageService`; both share `loadTsconfig` and `resolveSvelteVirtualSpecifier`. The session's lazy default `ImportResolver` consumes only `ts.CompilerOptions`; `loadTsconfig` is called lazily when no `resolveImport` is supplied AND at least one batch file lacks `dependencies` (fully pre-resolved batches skip construction entirely), avoiding a multi-second `ts.createProgram` solely to hand back a config object. User-supplied `compilerOptions` does not bypass the call — it merges per-key over the parsed tsconfig inside `loadTsconfig`.

### Format-Agnostic Extraction

TSDoc is extracted at build-time as raw strings. Rendering format (markdown, HTML) is a consumer concern.

## Data Model

Hierarchy: `ModuleJson[]` → `DeclarationJson[]` → `MemberJson[]`. Members never contain their own members (single-level nesting).

**ModuleJson** — `path` (relative to `sourceRoot`), `declarations`, `moduleComment`, `dependencies`, `dependents`, `starExports`, `reExports` (same-name re-export edges `{name, module, typeOnly, sourceLine}`, the forward view of `alsoExportedFrom` — see Re-Export Philosophy), `externalReExports` (direct external re-exports `{name, specifier, originalName?, typeOnly, sourceLine}`), `externalStarExports` (`export * from 'pkg'` specifiers as written), `partial` (set when the module is a placeholder for a Svelte file whose svelte2tsx transform threw at ingest). Array fields default to `[]` at runtime; `partial` and `typeOnly` default to `false`.

**DeclarationJson** — `z.discriminatedUnion('kind', [...])` with 9 strict-object variants. Use `isKind(decl, 'function')` or check `decl.kind` to narrow.

`DeclarationKind`: `'type' | 'function' | 'variable' | 'class' | 'interface' | 'enum' | 'component' | 'snippet' | 'namespace'` (no `'constructor'` — that's `MemberKind` only).

**MemberJson** — `z.discriminatedUnion('kind', [...])` with 3 variants. `MemberKind`: `'function' | 'variable' | 'constructor'`.

**Shared fields** (all variants and members): `name`, `kind`, `docComment`, `typeSignature`, `modifiers`, `sourceLine`, `genericParams`, `examples`, `deprecatedMessage`, `seeAlso`, `throws`, `since`, `mutates`, `partial`. **Top-level only**: `alsoExportedFrom`, `aliasOf`. `name` is always populated; default-slot entries carry `name === 'default'` (see Re-Export Philosophy).

**Field presence by variant** — fields exist only on the variant schemas that define them:

| Field             | function | variable | class | interface | type | enum | component | snippet | namespace | FunctionMember | VariableMember | ConstructorMember |
| ----------------- | -------- | -------- | ----- | --------- | ---- | ---- | --------- | ------- | --------- | -------------- | -------------- | ----------------- |
| parameters        | ✓        |          |       |           |      |      |           | ✓       |           | ✓              |                | ✓                 |
| returnType        | ✓        |          |       |           |      |      |           |         |           | ✓              |                |                   |
| returnDescription | ✓        |          |       |           |      |      |           |         |           | ✓              |                |                   |
| overloads         | ✓        |          |       |           |      |      |           |         |           | ✓              |                | ✓                 |
| members           |          |          | ✓     | ✓         | ✓    | ✓    |           |         |           |                |                |                   |
| props             |          |          |       |           |      |      | ✓         |         |           |                |                |                   |
| extends           |          |          | ✓     | ✓         |      |      |           |         |           |                |                |                   |
| intersects        |          |          |       |           | ✓    |      | ✓         |         |           |                |                |                   |
| implements        |          |          | ✓     |           |      |      |           |         |           |                |                |                   |
| acceptsChildren   |          |          |       |           |      |      | ✓         |         |           |                |                |                   |
| lang              |          |          |       |           |      |      | ✓         |         |           |                |                |                   |
| reactivity        |          | ✓        |       |           |      |      |           |         |           |                | ✓              |                   |
| module            |          |          |       |           |      |      |           |         | ✓         |                |                |                   |
| optional          |          |          |       |           |      |      |           |         |           | ✓              | ✓              |                   |
| defaultValue      |          | ✓        |       |           |      |      |           |         |           |                | ✓              |                   |
| alsoExportedFrom  | ✓        | ✓        | ✓     | ✓         | ✓    | ✓    | ✓         | ✓       | ✓         |                |                |                   |
| aliasOf           | ✓        | ✓        | ✓     | ✓         | ✓    | ✓    | ✓         | ✓       | ✓         |                |                |                   |

**Variant notes**:

- `TypeDeclarationJson.members`
  - Populated for object-like types (object literals, intersections, mapped types, type references) via `getPropertiesOfType()`
  - Skipped for unions, primitives, tuples, generic refs (`Array<T>`, `Promise<T>`)
  - External-property filtering (`filterExternalProperties`): properties contributed by external sources (node_modules, declaration files) are dropped, and the external types that contributed them are listed in `intersects`. Shape-general, not intersection-only — applies to every property-bearing shape that reaches extraction: intersections, bare external references (`type Foo = SomeExternal`), and indexed-access (`SvelteHTMLElements['li']`). Unions are skipped here (no `members`, no `intersects`) per the rule above. The `intersects` labels come from an AST walk of the written type, so the `&` / index-access text is preserved verbatim
- `ComponentDeclarationJson`
  - Same external-property filtering as `TypeDeclarationJson` for prop types, but applied unconditionally (the type-alias `hasExtractableProperties` gate is bypassed) — so a component's `intersects` also covers **union** prop types (e.g. `HTMLButtonAttributes | HTMLAnchorAttributes`), which the type-alias path skips
  - `acceptsChildren` — true if the component accepts a `Snippet`-typed `children` prop (verified via type inference, not just symbol presence) or uses children implicitly in the template
  - `lang: 'js'` for JS-only components; omitted for TypeScript (the default)
- `SnippetDeclarationJson` — template snippets exported from `<script module>`; type signature synthesized as `Snippet<[...]>`. No `returnType`/`overloads`
- `NamespaceDeclarationJson` — synthesized for `export * as ns from './x'`
  - `module` points at the source the namespace projects (relative to `src/lib`)
  - No inline members; consumers render `ns.a`/`ns.b` by reading the source module's `declarations`
- `reactivity` (on `VariableDeclarationJson` / `VariableMemberJson`) — set when the initializer is a value-producing rune call. `$props`/`$bindable` are modeled separately on `ComponentPropJson`
- `optional` — reflects a `?` token on the member (interface property/method signatures, type-alias properties from intersections/object literals, class property declarations). N/A for top-level declarations, constructors, or call/index signatures
- **Default-slot entries** carry `name === 'default'` — the symbol's actual JS-spec name. All forms land here: `export default ...`, `export {x as default}`, `export {default} from './x'`. Renames _out of_ the slot (`export {default as Foo} from './x'`) carry `name: 'Foo'` and `aliasOf: {module, name: 'default'}`. Svelte components are named after their `.svelte` file, so `export {default as Foo} from './X.svelte'` uses the component name in `aliasOf.name`. `findDuplicates` skips `name === 'default'`; `mergeReExports` keys uniformly by `(module, name)`. Consumers wanting `import X from 'mod'` form branch on `name === 'default'` (see `generateImport` in `declaration-helpers.ts`)

**Build-time vs validated types**: `DeclarationJsonBuild`/`MemberJsonBuild` are permissive interfaces with all fields optional, used internally by analysis functions during incremental construction. Zod validates at the `ModuleJson.parse()` boundary.

**Zod input/output split**: array fields use `.default([])` so they're optional in serialized JSON (compact) but guaranteed `[]` after `.parse()`. Use `compactReplacer` with `JSON.stringify` for compact output.

## Key Design Decisions

### Diagnostic Collection

- `AnalyzeResultJson.diagnostics` is `Array<Diagnostic>` — round-trip-safe through `JSON.stringify` / `z.array(Diagnostic).parse`. Symmetric with `AnalyzeResultJson.modules`. Mutate with `Array.push`, query via free helpers (`hasErrors`, `errorsOf`, `byKind`, etc.).
- The `{modules, diagnostics}` envelope is itself a Zod schema — `AnalyzeResultJson` (in `analyze-core.ts`, re-exported from `analyze.ts` and the barrel) — with both fields `.default([])`. Schema and type share the name. `JSON.stringify(result, compactReplacer)` strips empty arrays (`{modules: [], diagnostics: []}` → `{}`); `AnalyzeResultJson.parse` restores them. Construction sites hand back hand-built objects without re-running `.parse()` — inner arrays are already Zod-validated upstream, the envelope is a type contract not a validation gate. Raw-JSON consumers (e.g., `jq '.diagnostics | length'` on `{}` returns `0`) don't need the parse step.
- Entries carry `file` (project-root-relative, no leading slash, no `./` prefix), optional 1-based line/column, `message`, `severity`, programmatic `kind`.
- Severity is a stable per-kind property: always `warning` — `module_skipped`, `misplaced_tag`, `unknown_param`, `source_map_failed`, `duplicate_declaration`, `duplicate_comment`, `import_parse_failed`, `resolver_failed`, `type_extraction_failed`, `signature_analysis_failed`, `class_member_failed`, `svelte_prop_failed`. Always `error` — `transform_failed`, `module_unreadable`. `duplicate_declaration` is emitted regardless of `onDuplicates` (which remains the dispatch mechanism for fail-fast/custom handling).
- Session APIs split kinds into **ingest-time** (`transform_failed`, `source_map_failed`, `import_parse_failed`, `resolver_failed` — surfaced via `setFile`/`setFiles` returns, durable on entries) and **query-time** (recomputed each `query()`); concat is safe. Discovery emits a third category (`module_unreadable` from `discoverFromExports`): `analyzeFromFiles` merges it before returning; `createAnalysisSession` doesn't run discovery, so direct consumers own discovery diagnostics (Vite plugin tracks them in a side-channel field for HMR survival).
- On mid-flight extraction failure, the declaration/member gets `partial: true` — consumers detect incomplete data without cross-referencing diagnostics. Continue-with-flag over halt-on-error: failures are typically one bad declaration in a large library.

### Re-Export Philosophy

`findDuplicates()` detects duplicate declaration names across modules — by canonical identity, resolving `aliasOf` chains first, so an alias and its canonical (Position-3 synthesis, `export {default as Foo} from './Foo.svelte'`) are one thing, not a collision; `@nodocs` excludes declarations from both documentation and duplicate checking. Two encodings, content-conditional shape:

- **Same-name** → `alsoExportedFrom` on the canonical ("same thing, more import paths"). **Position 3**: when the local export statement carries JSDoc or `@nodocs`, an alias is _also_ synthesized in the re-exporting module (so local content has a home), in addition to the link. `@nodocs` suppresses both link and synthesis. Trigger is "presence of local content," not "presence of rename" — rename and content are orthogonal axes
- **Renamed** → synthesized declaration with `aliasOf` ("new public name pointing at existing thing"). Inherits `typeSignature`, `docComment`, `parameters`, `reactivity` from canonical; `sourceLine` is the local export specifier's line (not the canonical's location)
- **Star exports** → tracked in `starExports` arrays; statement-level `@nodocs` suppresses the entry (the same rule as the other two encodings). Star-projected bindings are not materialized in the projecting module (no declarations, no links, no edges — `analyzeExports` skips symbols with no declaration in the current file; merged symbols count as local when any declaration is). The rule is uniform across binding kinds: value symbols, projected re-export specifiers, and _namespace_ bindings (the locality skip runs before the namespace classifier, so both the shared `NamespaceExport` node and projected `export {ns}` specifiers are silenced)

**Forward view**: the same-name edges also publish on the re-exporting module as `ModuleJson.reExports` (`Array<ReExportJson>` — `{name, module, typeOnly, sourceLine}`, sorted by name then module with sourceLine tie-break; names can collide via Svelte default re-keying) so barrels are self-describing without inverting every `alsoExportedFrom` array. `mergeReExports(modules)` derives the reverse view from these fields directly. `module` is the canonical module (multi-hop resolved); `(module, name)` is the same lookup contract as `aliasOf`, including the Svelte filename-derived-name exception. Statement-level `@nodocs` suppresses entry and back-link together; the views can disagree at the margins — an entry whose canonical declaration is `@nodocs`, or whose module isn't in the analyzed set (session with partial owned set; LS resolves unowned files from disk), has no back-link. Same-name only: renames stay alias declarations, star exports stay in `starExports`

**External re-exports**: statements whose _immediate_ target is an external package publish on `ModuleJson.externalReExports` (`{name, specifier, originalName?, typeOnly, sourceLine}` — covers `export {x} from 'pkg'`, renames, `export * as ns from 'pkg'`) and `externalStarExports` (`export * from 'pkg'`, specifier as written). No canonical to resolve — flat statement facts, not graph edges; no declarations synthesized. Forms that stay silent: import-then-export (`import {x} from 'pkg'; export {x}`), chains reaching a package through another source module (that module owns the entry), unresolvable specifiers. Statement-level `@nodocs` suppresses, like the other encodings.

**Surface resolution**: `resolveExportSurface(modules, path)` (in `postprocess.ts`, barrel-exported) combines declarations, `reExports`, `externalReExports`, and transitively-resolved `starExports` into one name-sorted surface with provenance (`via: 'declaration' | 'reExport' | 'external' | 'star'`), applying ES semantics: explicit beats star, names ambiguous between stars excluded, `default` (including canonical Svelte components, which represent their file's default export) never projects. Position-3 alias + edge collapse to the declaration entry (edge's `typeOnly` carried). Incompleteness is reported, not guessed: `unresolvedStarExports` (targets outside the set), `externalStarExports` (names unknowable). Cycles terminate by contributing nothing along the back-edge. Names follow the docinfo model — Svelte components under filename-derived names, so a star-projected re-keyed component edge is treated as a default-slot re-export and skipped (a `<script module>` const sharing the component's exact name is skipped with it — documented caveat).

**Svelte component re-exports** — synthesize a `kind: 'component'` placeholder rather than running `analyzeDeclaration` on svelte2tsx's `__SvelteComponent_` type alias. Same-name branch re-keys `default` to the component's filename-derived name (so `mergeReExports` matches). Phase-2 `resolveComponentAliases` (in `mergeReExports`) copies `props`/`acceptsChildren`/`intersects`/`genericParams`/`lang`/doc fields from canonical onto each aliased declaration. Fill-gaps-only merge: local doc-comment fields applied before phase 2 stick

**Namespace re-exports** (`export * as ns from './x'`) — detected in `analyzeExports` before reaching `analyzeDeclaration`; otherwise the publisher's filesystem path leaks into `typeSignature` as `typeof import("/abs/path")`

- Detection via `ValueModule` flag on the deeply-resolved alias (robust to N-hop chains)
- **Origination** (`export * as ns from './x'`) → fresh `NamespaceDeclarationJson`
- **Same-name** (`export {ns} from './has-namespace'`, N-hop chains of such specifiers) → `alsoExportedFrom` link (Position 3 applies). Star projection of a namespace binding is _not_ same-name — it's silenced by the locality skip like all star projection
- **Renamed** (`export {ns as foo}`) → alias with `aliasOf` pointing at the namespace-defining file, walking the immediate-alias chain forward to find the canonical `NamespaceExport`

Lock-in tests at `src/test/analyze.reexport-edges.test.ts` (aliases, chains, Position 3), `src/test/analyze.reexport-namespace.test.ts`, `src/test/analyze.reexport-forward.test.ts` (forward edges, star-projection silence, externals), and `src/test/postprocess.surface.test.ts` (`resolveExportSurface`).

### Supported / Not Supported

**Supported**:

- Functions (generics, overloads, rest parameters)
- Classes (generics, members, constructors, static/readonly, getters/setters; member `typeSignature` inferred via checker when no annotation)
- Interfaces (generics, index/method/call/construct signatures)
- Type aliases (unions, intersections, mapped types)
- Variables (const/let, explicit or inferred types; const assertions)
- Enums (regular and const, with member values + JSDoc)
- Svelte 5 reactivity runes (`$state`, `$state.raw`, `$derived`, `$derived.by`) — syntactic detection runs on every file regardless of extension, intentional so the same patterns can be captured anywhere

**Class member visibility**: public + protected included; private (`private` keyword, `#field`) excluded. Getters/setters merged by name with `getter`/`setter` modifiers.

**Not supported** (silently skipped):

- Standalone `namespace Foo {}` declarations (low priority). Note: `export * as ns from './x'` namespace re-exports _are_ supported as `NamespaceDeclarationJson`
- Decorators (low priority)
- Indirect external re-exports — import-then-export (`import {x} from 'pkg'; export {x}`) and re-export chains that reach a package through another source module leave no trace; only statements directly referencing the external specifier land in `externalReExports`/`externalStarExports`. Unresolvable specifiers (missing package, typo) are silently skipped; `export type * from` is recorded like a value star (per-statement type-only-ness isn't captured for stars); a type-only _rename_ of a value (`export type {someConst as c} from './x'`) synthesizes a normal alias with no type-only marker. No diagnostics for any of these
- Per-parameter doc fields — `ParameterJson` captures `name`/`type`/`optional`/`rest`/`description`/`defaultValue`/`propertyDescriptions` only; `ComponentPropJson` includes `docFields` (`examples`, `deprecatedMessage`, `seeAlso`, `throws`, `since`), `ParameterJson` deliberately does not (function parameters rarely carry the richer per-parameter doc tags; component props commonly do). Object-property descriptions from dotted `@param obj.prop` tags _are_ captured — see `propertyDescriptions` below.

## API

- `analyzeFromFiles()` – One-shot — standalone projects, file discovery from disk
- `analyze()` – One-shot — build tools, you provide `SourceFileInfo[]`
- `createAnalysisSession()` – Incremental — Vite plugin, LSP-style tools (reuses LS across analyses)

All three produce `AnalyzeResultJson = {modules: ModuleJson[], diagnostics: Array<Diagnostic>}`. The one-shot APIs are thin wrappers over single-use sessions. The CLI and Vite virtual module both emit this same shape — CLI runs output through `compactReplacer` (no top-level carve-out), so empty arrays are stripped on the wire; consumers ingesting the JSON should parse through `AnalyzeResultJson` to restore defaults. Consumers handle package metadata and serialization — see `LibraryJson` in `@fuzdev/fuz_util` for the fuz pattern.

### CLI

```bash
npx svelte-docinfo                    # analyze cwd to stdout
npx svelte-docinfo -o output.json     # write to file
npx svelte-docinfo --pretty           # pretty-print
```

- `[project-root]` – Project root directory (default: cwd)
- `-i, --include <pattern>` – Include pattern (repeatable, replaces exports discovery)
- `-e, --exclude <pattern>` – Exclude glob, applied at discovery and analysis (repeatable)
- `-o, --output <file>` – Output file (default: stdout; `-` is the explicit stdout sentinel)
- `--discovery <mode>` – `auto` | `exports` | `glob` (default: `auto` — exports first, glob fallback). `exports` is strict and throws when package.json exports is missing
- `--dist-dir <dir>` – Dist directory for exports discovery (default: dist)
- `--source-dir <dir>` – Source directory relative to project root (default: src/lib). Repeatable; derives implicit include glob when `--include` not provided
- `--source-root <dir>` – Source root for module path extraction (default: single source-dir or longest common prefix; pass `.` for project-relative paths)
- `--on-duplicates <mode>` – `throw` | `warn` (default: emit `duplicate_declaration` diagnostic, no dispatch)
- `--only <pattern>` – Glob filter applied to module paths in output (repeatable); full project still analyzed (re-exports/dependents stay correct), diagnostics not filtered
- `--no-resolve-dependencies` – Disable dependency resolution
- `--pretty` – Pretty-print JSON (default: compact)
- `-q, --quiet` – Suppress info messages on stderr
- `-V, --version` – Show version number

Compact JSON by default. Exit codes: 0 (success), 1 (analysis errors), 2 (CLI errors).

### Ecosystem Integration

fuz_ui's `library_gen.ts` wraps `analyze()` with `SourceJson` metadata, producing `library.json` for runtime documentation. See `references/documentation_system.md` in the fuz-stack skill for the full pipeline from analysis to rendered Tome pages and API routes.

## Dependencies

**Core**: `typescript`, `commander`, `tinyglobby`, `es-module-lexer`, `@jridgewell/trace-mapping`

**Peer** (required): `svelte` 5+, `svelte2tsx`, `zod` 4+ — `svelte`/`svelte2tsx`
are eagerly imported on every entry (`svelte.ts` is statically reachable from all
public entries), so required even for pure-TypeScript analysis; `zod` is a peer so
its schema types resolve to a single instance in the consumer's tree

## Testing

Fixtures (`src/test/fixtures/`): input + `expected.json`. Regenerate via `gro src/test/fixtures/update`. Integration: `examples.test.ts` runs all example scripts (requires `npm run build` and `npm run setup-examples` first).

## Development

```bash
gro check     # typecheck, test, gen --check, format --check, lint
gro test      # run tests
gro gen       # run code generators
```

**IMPORTANT**: Do not run `gro dev` — the developer manages the dev server.

**Standards**: TypeScript strict mode, Svelte 5 runes API, tab indentation, 100 char width, tests in `src/test/` (not co-located), explicit `.js` file extensions in imports.
