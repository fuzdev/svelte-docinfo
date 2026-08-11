# Fixture Naming Policy

This document defines naming conventions for test fixtures in svelte-docinfo.

## Core Principle

**Use generic names for structural tests, descriptive names only for edge cases.**

These fixtures test **documentation extraction** (component props, types, JSDoc, class members) from Svelte components and TypeScript modules. The fixture structure and test cases matter, not the semantic meaning of the data. Generic names reduce visual noise and keep fixtures minimal.

## Key Insight: Descriptive Directories, Generic Content

**Fixture directory names should be descriptive** of what's being tested:

- ✅ `deprecated-simple` - clear what's tested
- ❌ `basic-comment` - too vague

**Fixture content should be generic** to reduce visual noise:

- ✅ `export class A { a: number; }` - focuses on structure
- ❌ `export class User { name: string; }` - distracts with semantics

The directory name carries the meaning, so the content can be minimal.

## Naming Guidelines

### Svelte Components

| Category            | ✅ Use                                  | ❌ Avoid                                   |
| ------------------- | --------------------------------------- | ------------------------------------------ |
| **Component Names** | From directory (e.g., `PropsBasic`)     | Custom semantic names in fixture           |
| **Prop Names**      | `prop`, `prop1`, `prop2`, `a`, `b`      | `title`, `count`, `name`, `user`, `status` |
| **Type Names**      | `A`, `B`, `C`, `T`, `U` (single letter) | `User`, `Status`, `Props`, `Config`        |
| **Type Properties** | `a`, `b`, `value`, `id`                 | `name`, `email`, `userId`, `timestamp`     |
| **Text Content**    | `text`, `text1`, `block1`               | `Hello World`, `Click here`, `Welcome`     |
| **Descriptions**    | `"Description"`, `"Description 1"`      | Realistic/semantic descriptions            |
| **HTML Attributes** | `data-attr`, `data-attr1`               | `data-user-id`, `data-item-name`           |
| **Event Handlers**  | `onclick`, `onchange` (standard)        | `handleClick`, `onUserUpdate`              |
| **Union Values**    | `'a'`, `'b'`, `'c'`                     | `'primary'`, `'secondary'`, `'active'`     |
| **Default Values**  | `'value'`, `1`, `true`                  | `'blue'`, `100`, `'John Doe'`              |

### TypeScript Modules

| Category                 | ✅ Use                                                      | ❌ Avoid                                       |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------- |
| **Class Names**          | `A`, `B`, `C` (single letter)                               | `User`, `Counter`, `DataService`               |
| **Interface Names**      | `A`, `B`, `C` (single letter)                               | `User`, `Config`, `Result`                     |
| **Type Alias Names**     | `A`, `B`, `C` (single letter)                               | `Status`, `Mode`, `Callback`                   |
| **Function Names**       | `fn`, `fn1`, `fn2`                                          | `greet`, `calculate`, `fetchData`              |
| **Variable Names**       | `a`, `b`, `c`                                               | `count`, `config`, `userData`                  |
| **Class Members**        | `a`, `b`, `c`                                               | `name`, `email`, `timestamp`                   |
| **Method Names**         | `fn1`, `fn2`, `fn3`                                         | `toString`, `getData`, `increment`             |
| **Parameters**           | `a`, `b`, `c` (or `x`, `y` in callbacks)                    | `name`, `options`, `callback`                  |
| **Generic Type Params**  | `T`, `U`, `V` (standard)                                    | `TData`, `TItem`, `Type`                       |
| **Type Constraints**     | Keep structure: `{id: number}`                              | Semantic: `{userId: number; userName: string}` |
| **@param Descriptions**  | `"Description 1"` (leading dash is TSDoc syntax, stripped)  | `"The user's name"`, `"An array of items"`     |
| **@returns Description** | `"Description 1"`                                           | `"A greeting string"`, `"The first item"`      |
| **@throws Description**  | `"Description 1"` (dash stripped, consistent with `@param`) | `"if value is invalid"`, semantic messages     |
| **@deprecated Message**  | `"Description 1"`                                           | `"Use newFn() instead"`, specific messages     |
| **@mutates Description** | `"a - Description 1"` (param - desc)                        | `"obj - adds processed field"`, semantic desc  |
| **@since Version**       | `"1.0.0"` (generic semver)                                  | `"2.0.0"`, real version numbers                |
| **@example Content**     | `const a = fn('value', {b: true});`                         | Real function calls with semantic data         |
| **@see References**      | `https://fuz.dev`, `fn1`, `{@link ...}`                     | Real URLs, semantic function names             |
| **URLs in @see tags**    | `https://fuz.dev`                                           | `https://fuz.dev`, other domains               |

## Fixture Directory Names

Directory names should be **descriptive and specific**:

| ✅ Good                        | ❌ Avoid (too vague) | Why                                   |
| ------------------------------ | -------------------- | ------------------------------------- |
| `props-bindable`               | `two-way-binding`    | Clearly states what's tested          |
| `props-with-descriptions`      | `documented-props`   | Specific about multi-line docs        |
| `class-private-excluded`       | `private-members`    | "excluded" clarifies test intent      |
| `type-generic-with-constraint` | `advanced-types`     | Specific about constraints + defaults |
| `module-comment-after-imports` | `basic-comment`      | Describes the specific test case      |
| `deprecated-simple`            | `deprecated`         | "simple" clarifies single-tag case    |

**Pattern:** `<category>-<specific-feature>` (kebab-case)

- Svelte categories: `component`, `props`, `types`, `reexports`, `errors`
- TypeScript categories: `class`, `interface`, `type`, `function`, `variable`, `module-comment`, `reexports`
- TSDoc categories: `comment`, `tags`, `param`, `returns`, `throws`, `example`, `deprecated`, `see`, `since`, `mutates`, `nodocs`
- Feature: Be specific about what's tested (e.g., `bindable` not `binding`, `after-imports` not `comments`)

**TSDoc naming examples:**

- `comment-description-only` - JSDoc with description but no tags
- `tags-without-description` - JSDoc with tags but no description
- `tags-comprehensive` - All supported tags together
- `param-with-dash` - @param tags with dash separator
- `see-formats-mixed` - Multiple @see formats in one fixture

## Examples

### ✅ Good - Generic Names (Svelte)

```svelte
<script lang="ts">
	let {
		prop1,
		prop2
	}: {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2: number;
	} = $props();
</script>

<div>{prop1} {prop2}</div>
```

### ❌ Bad - Semantic Names (Svelte)

```svelte
<script lang="ts">
	let {
		userName,
		age
	}: {
		/** The user's full name */
		userName: string;
		/** The user's age in years */
		age: number;
	} = $props();
</script>

<div>{userName} is {age} years old</div>
```

Semantic names add visual noise. We're testing extraction, not building a real component.

## When to Use Descriptive Names

**Only for edge case tests** where the name clarifies what's being tested:

- `props-untyped` fixture: `untypedProp` explains the error condition
- Parser edge cases, special syntax, error cases

## Type Complexity

Keep structural complexity, use generic names: `type A = 'a' | 'b' | 'c'` not `type Status = 'idle' | 'loading' | 'success'`.

## Fixture File Structure

### Svelte Component Fixtures

Svelte fixtures are organized into categorized subdirectories:

```
src/test/fixtures/svelte/
├── component/         # Component-level features
│   ├── no-props/
│   │   ├── input.svelte
│   │   └── expected.json
│   ├── template-only/
│   └── with-jsdoc/
├── props/             # Prop extraction
│   ├── basic/
│   ├── bindable/
│   ├── cross-module/
│   ├── default-values/
│   ├── optional/
│   └── with-descriptions/
├── types/             # Type resolution
│   ├── cross-module-external/
│   ├── extends-html/
│   ├── intersection/
│   └── multiple-kinds/
├── reexports/         # Re-export encodings (multi-file)
│   ├── component-renamed/
│   ├── component-same-name/
│   ├── external-package/
│   ├── gated-component/
│   ├── gated-module/
│   └── module-exports/
└── errors/            # Error handling
    └── untyped/
```

Each fixture directory contains:

- `input.svelte` - The Svelte component to analyze
- `expected.json` - Expected module fixture object (see Expected Output Format)

### Multi-File Svelte Fixtures

A svelte fixture directory may carry sibling files beside `input.svelte` —
`.ts` and `.svelte`, recursive (`SVELTE_EXTRA_FILE_EXTENSIONS`). The harness
(`analyzeSvelteFixtureModules` in `svelte/svelte-test-helpers.ts`) maps the
fixture into a per-fixture namespace dir under the repo's `src/lib` and
analyzes the whole set through `analyzeCore` over the one shared batch
program:

```
src/test/fixtures/svelte/reexports/component-renamed/
├── input.svelte           # → src/lib/<Name>/<Name>.svelte (the entry,
│                          #   renamed so the component name derives from it)
├── Other.svelte           # → src/lib/<Name>/Other.svelte (transformed like
│                          #   any component; importable as ./Other.svelte)
└── expected.json          # AnalyzeResultJson envelope (see below)
```

Mapping rules:

- **Namespace dir per fixture** — `<Name>` is the fixture path's PascalCase
  component name, so sibling names can't collide across fixtures in the one
  shared program; module paths become `<Name>/<Name>.svelte` /
  `<Name>/types.ts`. Siblings keep their disk-relative position to the
  entry, so `./types.ts` / `./Other.svelte` specifiers resolve identically
  on disk (repo typecheck) and in the mapped project. Keep every specifier
  inside the fixture's own dir: one climbing out (`../Other/types.ts`) would
  resolve in the shared program — every fixture's files are in it — but not
  in the harness resolver, whose `fileIds` is per-fixture, so the type would
  resolve while the dependency edge silently didn't. Unguarded, since the
  layout gives no reason to write one.
- **The entry imports siblings, never the reverse.** The entry is _renamed_
  (`input.svelte` → `<Name>.svelte`; the ts harness keeps `input.ts`)
  because the component name derives from the filename, so no specifier for
  the entry resolves both on disk and mapped — a harness pre-pass lexes
  every file (gated `internal/` siblings included, which dep resolution
  never lexes) and throws on an import resolving to the fixture-root
  `input.svelte`; a _nested_ sibling legitimately named `input.svelte`
  passes. Components that import each other are both siblings, with the
  entry as the barrel.
- **`internal/` siblings are gated** by the default `**/internal/**`
  exclude: gated `.ts` siblings reach the checker via the program alone,
  gated `.svelte` siblings additionally ride
  `AnalyzeCoreInputs.contextSvelteFiles` so a gated component re-export
  fills props — mirroring `session.query`'s assembly.
- **Guards** (all throw): the namespace dir existing on disk under
  `src/lib`, a sibling mapping onto the entry's id (literally named
  `<Name>.svelte`), any file importing the entry, two fixture paths
  PascalCasing to one component name (mapped ids would silently last-win in
  the shared program), and a regenerated module set missing the fixture's
  _own_ component — name-matched, since a component re-export alias is
  itself a `kind: 'component'` declaration (`svelteFixtureEntryPath` is the
  shared entry-path spelling).
- **External shapes use the repo's real packages** (`svelte`,
  `svelte/store`, `svelte/elements`) — there is no `external/` mapping here;
  the program resolves against real `node_modules`, and synthetic-package
  forms stay ts-side.

Semantics mirror the ts side via the shared `captureFixtureProject`
(`module-fixture-helpers.ts`): only `isSource`-passing files emit modules,
`dependencies` are pre-resolved with the production lexer over the session's
content-to-lex rule (the svelte2tsx _virtual_ for `.svelte` files — raw
svelte isn't lex-able as TS), filtered to the emitted set, and
`computeDependents` derives the reverse edges.

### TypeScript Module Fixtures

```
src/test/fixtures/ts/declarations/class/generic/
├── input.ts           # Input TypeScript module
└── expected.json      # Expected module fixture object
```

- `input.ts` - The TypeScript module to analyze
- `expected.json` - Expected module fixture object (see Expected Output Format)

### Multi-File TypeScript Fixtures

A ts fixture directory may carry sibling source files beside `input.ts` — the
harness (`analyzeFixtureProject` in `ts/ts-test-helpers.ts`) maps them into a
synthetic project and analyzes the whole set through `analyzeCore`, so
re-export fields, gated canonicals, and path-based externality are all
expressible:

```
src/test/fixtures/ts/reexports/gated/
├── input.ts               # → src/lib/input.ts (the entry)
├── internal/helper.ts     # → src/lib/internal/helper.ts (gated by the
│                          #   default `**/internal/**` exclude)
└── expected.json          # AnalyzeResultJson envelope (see below)

src/test/fixtures/ts/types/external-heritage/
├── input.ts                    # imports `extpkg` as a bare specifier
├── external/extpkg/index.d.ts  # → node_modules/extpkg/index.d.ts
└── expected.json
```

Mapping rules:

- **Local siblings** (any `*.ts` outside `external/`) map to
  `src/lib/<relative path>` — importable via relative specifiers (`./dep.js`
  or `./dep.ts`; `index` fallbacks work). A sibling under `internal/` hits the
  default exclude and exercises the gated-canonical machinery.
- **`external/**`** maps verbatim into the synthetic project's
  `node_modules/` — `external/extpkg/index.d.ts` is importable as `extpkg`
  (`external/pkg/sub.ts` as `pkg/sub`) and classifies external through the
  production path predicate, no test-only injection. The directory is named
  `external/`, not `node_modules/`, so `.gitignore`'s any-depth match can't
  silently untrack fixture files.
- Discovery is unchanged — only `input.ts` marks a fixture directory, so
  sibling files and subdirectories are never mistaken for fixtures.

Semantics mirror `session.query`'s input assembly: only `isSource`-passing
locals emit modules (gated siblings reach the checker via the program alone),
`dependencies` are pre-resolved by the harness with the production lexer
(type-only edges kept, edges filtered to the emitted set), and
`computeDependents` derives the reverse edges — so `dependencies`/`dependents`
in baselines match real one-shot output.

Repo typecheck: bare synthetic-package specifiers don't resolve for the repo's
own `svelte-check` pass, so `ts/fixture-packages.d.ts` carries ambient
stand-ins — keep each `declare module` a superset of every same-named
`external/` stub (fixture analysis never loads that file).

## Expected Output Format

Both fixture sets capture the **whole module analysis object plus diagnostics**
— the `ModuleFixtureJson` schema in `src/test/fixtures/module-fixture-helpers.ts` (`ModuleJson`
extended with a `diagnostics` array). Written through `compactReplacer`, so
defaulted fields (empty arrays, `false` booleans) are stripped on disk; a
fixture with no declarations and no comment is just `{"path": "..."}`. Each
fixture analyzes through `analyzeCore` itself (per fixture, so fixtures stay
independent projects), which runs the diagnostic boundary passes — positions
are original-source and paths are machine-independent.

**Multi-file fixtures (ts and svelte) capture the `AnalyzeResultJson`
envelope instead** (`{modules, diagnostics}`, same wire rules) — cross-module
facts land on more than one module (`alsoExportedFrom` on the canonical,
`dependents` on the dep), so every emitted module is locked. Single-file
fixtures keep the single-module shape; the loader distinguishes by the
presence of sibling files.

### Svelte Module Output

`path` is `<ComponentName>.svelte` (PascalCase from the fixture directory);
a multi-file fixture's entry module is `<Name>/<Name>.svelte` with siblings
under `<Name>/`.
`declarations` holds all non-nodocs declarations — the component first (primary
export), then module-level exports (snippets, functions, variables, types).
Module comments land in `moduleComment`; analysis warnings (e.g.
`legacy_props`, `duplicate_comment`) land in `diagnostics`, so fixture edits
can't drift detection silently.

```json
{
	"path": "PropsBasic.svelte",
	"declarations": [
		{
			"name": "PropsBasic",
			"kind": "component",
			"docComment": "Component documentation",
			"props": [
				{
					"name": "prop1",
					"type": "string",
					"description": "Description 1"
				}
			],
			"sourceLine": 1
		}
	]
}
```

**Component fields:**

- `name` - Derived from fixture directory (PascalCase)
- `kind` - `"component"`
- `docComment` - Component-level JSDoc (if present)
- `props` - Array of prop objects
- `sourceLine` - Source-mapped line in the original `.svelte` file (component points to `<script>` tag, module exports point to their declaration line)
- `acceptsChildren` - Boolean, present when `true`
- `lang` - `"js"` for JavaScript-only components, absent for TypeScript (default)

**Prop fields:**

- `name` - Prop name (matches input)
- `type` - TypeScript type string
- `description` - Extracted from JSDoc (optional)
- `optional` - Boolean, only present if `true`
- `bindable` - Boolean, only present if `true`
- `parameters` - Array of parameter objects (for snippet-typed props only)

### TypeScript Module Output

`path` is always `input.ts` — the harness analyzes each fixture at a synthetic
`/home/user/project/src/lib/input.ts` (see `analyzeFixtureModule` in
`ts-test-helpers.ts`), so diagnostic `file` fields read `src/lib/input.ts`.
All exports are captured, module comments land in `moduleComment` (the
`module/comment/*` fixtures lock theirs beside any declarations), and a
declaration in `declarations` matches the `DeclarationJson` interface:

```json
{
	"path": "input.ts",
	"declarations": [
		{
			"name": "fn",
			"kind": "function",
			"typeSignature": "(a: string, b: number): string",
			"returnType": "string",
			"returnDescription": "Description 3",
			"parameters": [
				{
					"name": "a",
					"type": "string",
					"description": "Description 1"
				}
			]
		}
	]
}
```

**Common fields:**

- `name` - Export name
- `kind` - `"function"`, `"class"`, `"type"`, `"interface"`, `"enum"`, `"variable"`
- `docComment` - JSDoc comment text (optional)
- `sourceLine` - Line number in source file

**Class-specific fields:**

- `members` - Array of member objects (properties, methods, constructor)
- `genericParams` - Array of type parameter objects

**Function-specific fields:**

- `parameters` - Array of parameter objects
- `returnType` - Return type string
- `returnDescription` - @returns tag content

**Type-specific fields:**

- `typeSignature` - Full type definition
- `members` - Array of member objects (for interfaces and object-like type aliases)
- `genericParams` - Array of type parameter objects

## Coverage Checklist

### Svelte Component Fixtures

- [x] Basic props (string, number, boolean)
- [x] Optional props (`?` syntax)
- [x] Props with default values
- [x] Props with multi-line descriptions
- [x] Bindable props (`$bindable()`)
- [x] Complex types (unions, interfaces, type aliases, Snippet, functions, arrays)
- [x] Extending HTML element types (SvelteHTMLElements)
- [x] Intersection types (custom props & HTMLAttributes)
- [x] `interface Props extends` external bags — single, generic, multiple, attribute-forwarding (no own props), through a local base, a diamond over one bag, and a utility instantiation in heritage position (`Omit<HTMLAttributes<HTMLDivElement>, 'onclick'>` — real lib `Omit`, so the fixture also locks that derived properties keep their external origins) (`types/interface-extends-*`); plus a bag composed inside a local alias (`types/nested-alias-html`). Generic local bases lock the type-parameter guard: a base whose heritage text names its own params records nothing (`types/interface-extends-generic-base`) or degrades to the instantiation-site name when attribute-forwarding (`types/interface-extends-generic-base-only`), while a component's own generic stays in scope and emits (`types/intersection-component-generic` — inline form: a _named_ props type in a generic component trips TS4060 under `declaration: true`, so no fixture can model that combination; the in-scope-param emission is what it locks). Import renames resolve to the name the module exports, locked against real `svelte/elements` at every leaf shape: descended-to (`types/interface-extends-renamed-import`, which also imports one bag under two names so the dedupe collapse is visible), written at the annotation itself with generic arguments preserved (`types/intersection-renamed-import`), an indexed access whose key survives the substitution (`types/bare-renamed-import`), and a generic instantiation where the substitution and the type-parameter guard inspect the same node — the renamed identifier moves, the component's own in-scope `T` stays (`types/generic-renamed-import`). All lock `externalTypes`; the walk's internals are unit-tested in `src/test/external-properties.test.ts` with a synthetic externality predicate (ts-side behavior locks live in the multi-file `ts/types/external-*` fixtures, real path-based externality via `external/` stubs), and the cross-module forms — props typed by an interface/alias imported from a sibling module (the dominant real-world pattern), a rename spelled in that sibling, and a package that renames on the way out — are locked behavior-level in `src/test/analyze.props-cross-module.test.ts`, with the base sibling-interface form also fixture-locked (`props/cross-module`, `types/cross-module-external`)
- [x] `externalTypes` on a **type alias** rather than a component (`types/module-alias-html`) — every other fixture documents the field on a component, so this is the only one exercising the type-alias path (`extractTypeAliasProperties` and its `hasExtractableProperties` gate) against real package origins; `external-properties.test.ts` reaches that path only with a synthetic externality predicate. The same fixture locks the two paths disagreeing on unions by design: `EitherProps` is a union of external bags and records no `externalTypes` and no `members`, while the component annotated with that very type records both bags (the component path bypasses the gate)
- [x] Component with JSDoc (@component, @example tags)
- [x] Component without props
- [x] Component without script
- [x] Error cases (untyped props)
- [x] Snippet-typed props (bare, parameterized, generic, optional params)
- [x] Exported snippets (basic, typed, parameterless, untyped, with function, with props)
- [x] `acceptsChildren` detection (explicit, inherited, no-children)
- [x] JS components (JSDoc `@type`/`@typedef` props with descriptions/defaults/bindable/snippets in `props/jsdoc-type`, untyped inference + HTML `@component` doc in `component/javascript`)
- [x] Legacy `export let` components (zero props + HTML `@component` fallback instead of doc leak, in `component/legacy-export-let`; the `legacy_props` diagnostic is locked by that fixture's own `expected.json` — the harness captures diagnostics — with behavior-level coverage in `analyze.legacy-components.test.ts`)
- [x] Re-exports (multi-file, `reexports/*`): component rename with phase-2 prop/doc fill (`component-renamed`), component same-name re-key with `alsoExportedFrom` + forward `reExports` edge — the bare `export {default}` form, spelled in a sibling ts barrel because `export {default as Other}` classifies as a rename and a component's own `<script module>` can't cleanly re-export another default (`component-same-name`), `<script module>` value re-exports — same-name links, Position-3 doc synthesis, rename alias with inherited shape, star exports (`module-exports`), external-package re-exports against the real `svelte` incl. rename `originalName`, type-only, and `externalStarExports` (`external-package` — single-file: no cross-module facts), gated Svelte canonical filling props via `contextSvelteFiles` (`gated-component`), gated ts module synthesizing full aliases with dangling `aliasOf` (`gated-module`). All lock `dependencies`/`dependents`; behavior-level mechanics stay in `src/test/analyze.reexport-*.test.ts`
- [x] Cross-module props (multi-file): props typed by an interface from a sibling `./types.ts` (`props/cross-module`); a sibling interface extending a real `svelte/elements` bag, `externalTypes` agreeing on both sides of the module boundary (`types/cross-module-external`). Deeper rename/package variants stay behavior-level in `analyze.props-cross-module.test.ts`

### TypeScript Module Fixtures

- [x] Class declarations (basic, generic, with private fields)
- [x] Interface declarations (basic, generic with constraints)
- [x] Type aliases (object literals, intersections, mapped, unions, tuples, conditionals, template literals, type references, index signatures, call/construct signatures, readonly, overloads)
- [x] Function declarations (basic, generic with constraints)
- [x] Variable declarations (simple, complex types)
- [x] Function parameters (basic, optional, default values)
- [x] Class members (public, private, static, readonly)
- [x] Generic type parameters (with constraints, with defaults)
- [x] Module comments (@module tag, after imports, multiple, empty)
- [x] JSDoc extraction (descriptions, @param, @returns tags)
- [x] No comment cases (intentionally undocumented)
- [x] Re-exports (multi-file, `reexports/*`): same-name link + Position-3 JSDoc synthesis (`same-name`), renamed aliases with inherited shape + local doc override (`renamed`), star exports with no materialization (`star`), star + explicit overlap without duplication (`star-overlap`), namespace re-export with module pointer (`namespace`), 3-hop chain accumulating intermediates on the canonical with edges at the deep canonical (`chain`), type-only edges — statement-level and inline — beside the marker-less type-only rename alias (`type-only`), external-package re-exports incl. rename `originalName`, type-only, `* as ns`, and `externalStarExports` (`external-package`), gated canonicals synthesizing full aliases with dangling `aliasOf` (`gated`), and a same-name chain through a gated rename hop synthesizing at the deep canonical (`gated-rename-hop`). All lock `dependencies`/`dependents` too (harness pre-resolves with the production lexer). Behavior-level mechanics stay in `src/test/analyze.reexport-*.test.ts`
- [x] External types on the ts path (multi-file, `types/external-*`): intersection with an external bag carrying an index signature — members filtered at every granularity, `externalTypes` label (`external-intersection`); interface heritage — verbatim `extends` beside `externalTypes`, transitive through a local base (`external-heritage`). Unit mechanics stay in `src/test/external-properties.test.ts` / `external-composition.test.ts`

### TSDoc Fixtures (JSDoc Tag Parsing)

- [x] Comment with description only (no tags)
- [x] Comment with tags but no description
- [x] Empty comment (`/** */`)
- [x] No JSDoc comment at all
- [x] Single and multiple @param tags (with dash separator)
- [x] @returns tag
- [x] Single and multiple @throws tags (with error types)
- [x] Single and multiple @example tags
- [x] @deprecated tag
- [x] @internal tag (with prose and bare)
- [x] @see tag (bare URL, {@link}, with text)
- [x] @see with mixed formats
- [x] @since tag
- [x] @mutates tag (single and multiple)
- [x] @nodocs tag
- [x] Comprehensive fixture with all tags

## Rationale

1. **Clarity first**: Directory names clarify what's tested
2. **Generic when possible**: Prevents domain coupling in structural tests
3. **Minimal fixtures**: Reduce visual noise, easier to maintain
4. **Consistent patterns**: Enable validation and duplicate detection
5. **Valid syntax**: All fixtures must be valid Svelte/TypeScript

## See Also

- `src/test/svelte.test.ts` - How Svelte fixtures are loaded and validated
- `src/test/typescript.test.ts` - How TypeScript fixtures are loaded and validated
- `src/test/tsdoc.test.ts` - How TSDoc fixtures are loaded and validated
- `src/test/fixtures/module-fixture-helpers.ts` - Shared capture machinery for the ts and svelte harnesses (`ModuleFixtureJson`, `captureModuleFixture`, `captureFixtureProject`, `resolveFixtureSpecifier`, `validateModuleFixture`)
- `src/test/fixtures/svelte/svelte-test-helpers.ts` - Svelte fixture loading utilities
- `src/test/fixtures/ts/ts-test-helpers.ts` - TypeScript fixture loading utilities
- `src/test/fixtures/tsdoc/tsdoc-test-helpers.ts` - TSDoc fixture loading utilities
