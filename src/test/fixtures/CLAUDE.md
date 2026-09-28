# Test fixtures

Fixture sets for `parseComment` (`tsdoc/`), TypeScript module analysis
(`ts/`), and Svelte component analysis (`svelte/`). Each fixture is a
directory holding an input file plus a generated `expected.json`.

Regenerate with `gro src/test/fixtures/update` (runs tsdoc, then ts, then
svelte), or one set via `gro src/test/fixtures/{tsdoc,ts,svelte}/update`. Never
hand-edit `expected.json`.

## Naming

**Descriptive directories, generic content.** The directory name says what is
tested; the content stays minimal so the structure is what you see.

- ✅ `deprecated-simple`, `props-bindable`, `class-private-excluded`,
  `module-comment-after-imports` — specific about the case
- ❌ `basic-comment`, `two-way-binding`, `advanced-types` — too vague
- ✅ `export class A { a: number; }` — ❌ `export class User { name: string; }`

Layout:

- **svelte** — `svelte/<category>/<case>/`, categories `component`, `props`,
  `types`, `reexports`, `errors`
- **ts** — `ts/<category>/[<sub>/]<case>/`, categories
  `declarations/{class,enum,function,interface,type,variable}`, `generics`,
  `members`, `module/comment`, `parameters`, `reexports`, `tsdoc`, `types`
- **tsdoc** — flat `tsdoc/<tag>-<feature>/` (kebab-case): `comment`, `tags`,
  `param`, `returns`, `throws`, `example`, `deprecated`, `internal`, `link`,
  `see`, `since`, `mutates`, `nodocs`, plus the standalone `no-jsdoc`

Generic content names:

| Thing                      | ✅ Use                                          | ❌ Avoid                                  |
| -------------------------- | ---------------------------------------------- | ---------------------------------------- |
| Types, classes, ifaces     | `A`, `B`, `C`                                  | `User`, `Status`, `Props`, `DataService` |
| Generic params             | `T`, `U`, `V`                                  | `TData`, `TItem`                         |
| Functions / methods        | `fn`, `fn1`, `fn2`                             | `greet`, `getData`                       |
| Variables, members, params | `a`, `b`, `c` (`x`, `y` in callbacks)          | `count`, `email`, `options`              |
| Svelte props               | `prop`, `prop1`, `a`                           | `title`, `userName`                      |
| Component names            | derived from the directory (`PropsBasic`)      | custom names in the fixture              |
| Descriptions / tag prose   | `Description 1` (`@mutates a - Description 1`) | `The user's name`, `Use newFn() instead` |
| Union / default values     | `'a' \| 'b'`, `'value'`, `1`, `true`           | `'primary'`, `'John Doe'`                |
| Template text, attributes  | `text1`, `data-attr1`                          | `Hello World`, `data-user-id`            |
| `@since` / `@see` values   | `1.0.0`, `https://fuz.dev`                     | real versions, other domains             |
| Event handlers             | standard names (`onclick`)                     | `handleClick`, `onUserUpdate`            |

Keep structural complexity while making names generic:
`type A = 'a' | 'b' | 'c'`, not `type Status = 'idle' | 'loading'`. Use a
descriptive name only when it explains an edge case (`errors/untyped` uses
`untyped_prop`). All fixtures must be valid Svelte/TypeScript.

## Single-file fixtures

- **tsdoc** — `input.ts` → the raw `TsdocParsedComment` that `parseComment`
  returns for the file's first JSDoc (`findAndParseTsdoc` in
  `tsdoc/tsdoc-test-helpers.ts`).
- **ts** — `input.ts`, analyzed at a synthetic
  `/home/user/project/src/lib/input.ts` (`analyzeFixtureModule` in
  `ts/ts-test-helpers.ts`), so `path` is `input.ts` and diagnostic `file`
  reads `src/lib/input.ts`.
- **svelte** — `input.svelte`; `path` is `<Name>.svelte`, where `<Name>` is
  the PascalCased fixture path (`props/basic` → `PropsBasic`). `declarations`
  lists the component first, then `<script module>` exports. `sourceLine` is
  source-mapped to the original `.svelte` file: the component points at its
  `<script>` tag, and module exports point at their declarations.

The ts and svelte sets capture the **whole module plus diagnostics**
(`ModuleFixtureJson` in `module-fixture-helpers.ts`: `ModuleJson` extended
with `diagnostics`). Each fixture gets its own `analyzeCore` call (svelte
fixtures share one batch program but are analyzed separately), so there's no
cross-fixture duplicate detection, and `analyzeCore`'s boundary passes give
original-source positions and machine-independent paths. Module
comments, `legacy_props`, `duplicate_comment`, and other warnings are
locked, not just declarations. Output goes through `compactReplacer`, so
defaulted fields are stripped on disk. A fixture with nothing to report is
just `{"path": "..."}`.

## Multi-file fixtures

Sibling files beside the entry turn a fixture into a small project, analyzed
together through `analyzeCore`. `expected.json` then captures the whole
`AnalyzeResultJson` envelope (`{modules, diagnostics}`, same wire rules), since
cross-module facts (`alsoExportedFrom` on the canonical, `dependents` on the
dep) land on more than one module. The loader tells the two shapes apart by
the presence of siblings. Only `input.*` marks a fixture directory, so
siblings and subdirectories are never mistaken for fixtures.

Both harnesses mirror `session.query`'s input assembly through
`captureFixtureProject`:

- only `isSource`-passing files emit modules
- `dependencies` are pre-resolved with the production lexer (`import type`
  edges kept, filtered to the emitted set)
- `computeDependents` derives the reverse edges

So `dependencies`/`dependents` in baselines match real one-shot output.

### ts (`analyzeFixtureProject` in `ts/ts-test-helpers.ts`)

```
ts/reexports/gated/
├── input.ts               # → src/lib/input.ts
├── internal/helper.ts     # → src/lib/internal/helper.ts (gated by `**/internal/**`)
└── expected.json
ts/types/external-heritage/
├── input.ts                    # imports `extpkg`
├── external/extpkg/index.d.ts  # → node_modules/extpkg/index.d.ts
└── expected.json
```

- **Local siblings** (any `*.ts` outside `external/`) map to
  `src/lib/<relative path>`. They're importable relatively (`./dep.ts` or
  `./dep.js`; `index` fallbacks work). An `internal/` sibling is gated and
  exercises the gated-canonical machinery.
- **`external/**`** maps verbatim into `node_modules/`
  (`external/pkg/sub.ts` → `pkg/sub`). It classifies as external through the
  production path predicate, with no test-only injection. The directory is
  named `external/` because `.gitignore`'s any-depth `node_modules` match
  would silently untrack fixture files.
- **Repo typecheck** — bare synthetic-package specifiers don't resolve for the
  repo's own `svelte-check`, so `ts/fixture-packages.d.ts` holds ambient
  stand-ins. Keep each `declare module` a superset of every same-named
  `external/` stub. Fixture analysis never loads that file.

### svelte (`analyzeSvelteFixtureModules` in `svelte/svelte-test-helpers.ts`)

```
svelte/reexports/component-renamed/
├── input.svelte    # → src/lib/<Name>/<Name>.svelte (entry, renamed)
├── Other.svelte    # → src/lib/<Name>/Other.svelte
└── expected.json
```

Siblings are `.ts` and `.svelte`, recursive (`SVELTE_EXTRA_FILE_EXTENSIONS`).
All svelte fixtures share one batch program.

- **Namespace dir per fixture** — `src/lib/<Name>/`, so sibling names can't
  collide across fixtures. Siblings keep their position relative to the entry,
  so `./types.ts` resolves the same on disk (repo typecheck) and mapped. Keep
  specifiers inside the fixture dir. One climbing out (`../Other/types.ts`)
  would resolve in the shared program but not in the per-fixture resolver, so
  the type would resolve while the dependency edge silently didn't. Nothing
  guards against this.
- **The entry imports siblings, never the reverse.** The entry is renamed
  (`input.svelte` → `<Name>.svelte`, since the component name derives from the
  filename), so no specifier for it resolves both on disk and mapped.
  Components that import each other are both siblings, with the entry as the
  barrel.
- **`internal/` siblings are gated.** Gated `.ts` reaches the checker through
  the program alone. Gated `.svelte` also rides
  `AnalyzeCoreInputs.contextSvelteFiles`, so a gated component re-export
  fills props.
- **External shapes use real packages** (`svelte`, `svelte/store`,
  `svelte/elements`). There's no `external/` mapping on this side.
- **`dependencies`** are lexed from the svelte2tsx virtual for `.svelte` files
  (the session's content-to-lex rule).
- **Guards** (all throw):
  - the namespace dir already existing under `src/lib`
  - a sibling literally named `<Name>.svelte`
  - any file importing the fixture-root `input.svelte` (a lex pre-pass covers
    gated siblings too; a nested sibling named `input.svelte` is fine)
  - two fixture paths PascalCasing to one name
  - a regenerated module set missing the fixture's own component (matched by
    name via `svelteFixtureEntryPath`, since a component re-export alias is
    itself `kind: 'component'`)

## Coverage map

Where each behavior is locked. Unit and behavior-level mechanics live in
`src/test/*.test.ts`; fixtures lock end-to-end output.

**svelte**

- Props: basic, optional, defaults (incl. `null`/`undefined`/complex),
  descriptions, `$bindable` variants, JSDoc tags, nullable, `typeInfo` and
  name recovery (`props/type-info*`), source order with redeclared bag props
  (`props/source-order-redeclared`)
- Component: JSDoc/`@component`, docComment precedence (`doccomment-*`), module
  comments (`module-comment*`), no props, template-only, generics,
  `acceptsChildren` (`children-*`, `no-children`), exported snippets
  (`exported-snippet*`), merged zod schema, JS components (`javascript`,
  `props/jsdoc-type`), legacy `export let` (`legacy-export-let` — zero props,
  HTML fallback doc, `legacy_props` warning)
- Types: snippets, unions, tuples, literal unions, intersections with
  `HTMLAttributes`, `SvelteHTMLElements` extension
- `externalTypes`:
  - `interface Props extends` a bag (`types/interface-extends-*`): single,
    generic, multiple, attribute-forwarding, through a local base, diamond,
    and `Omit<…>` in heritage (which also locks that derived properties keep
    external origins)
  - generic local bases substitute their written argument
    (`interface-extends-generic-base{,-only}` → `HTMLAttributes<HTMLDivElement>`);
    a component's own in-scope generic emits as written
    (`intersection-component-generic` — inline form, since a named props type
    in a generic component trips TS4060)
  - import renames resolve to the exported name at each leaf shape:
    descended-to (`interface-extends-renamed-import`, also showing the
    two-names dedupe), annotation-level (`intersection-renamed-import`),
    indexed access (`bare-renamed-import`), generic instantiation
    (`generic-renamed-import`)
  - bag inside a local alias (`nested-alias-html`); the type-alias path and
    its union disagreement with the component path, against real package
    origins (`module-alias-html`)
  - cross-module: `props/cross-module`, `types/cross-module-external`. Deeper
    rename/package variants are in `analyze.props-cross-module.test.ts`, and
    walk internals in `external-properties.test.ts` (synthetic externality)
- Re-exports (`reexports/*`): component rename with phase-2 fill
  (`component-renamed`), same-name re-key via a ts barrel's bare
  `export {default}` (`component-same-name`), `<script module>` links /
  Position-3 / rename / star (`module-exports`), external packages
  (`external-package`), gated Svelte canonical via `contextSvelteFiles`
  (`gated-component`), gated ts module with dangling `aliasOf`
  (`gated-module`)
- Errors: `untyped`, `template-malformed`, `type-resolution-failed`

**ts**

- Declarations of every kind, generics, members (visibility, static,
  readonly, accessors, external callables), parameters (optional, defaults,
  rest, dotted `@param` docs), module comments
- Structured types and name recovery: `types/type-info*`,
  `declarations/*/type-info-recovery`, `declarations/*/alias-lost-*`; merged
  value+type symbols: `declarations/*/merged-value-*`
- TSDoc placement on declarations and members (`ts/tsdoc/*`), including
  `@default` (`declarations/*/jsdoc-default*`)
- Type aliases: object literals, intersections, mapped, unions, tuples,
  conditionals, template literals, index/call/construct signatures, readonly,
  overloads
- Re-exports (`reexports/*`): `same-name` (+ Position 3), `renamed`, `star`,
  `star-overlap`, `namespace`, 3-hop `chain`, `type-only`, `external-package`,
  `gated`, `gated-rename-hop`. Mechanics are in `analyze.reexport-*.test.ts`
- External types (`types/external-*`): intersection with an external bag incl.
  index signature (`external-intersection`); interface heritage, transitive
  through a local base (`external-heritage`). Unit mechanics are in
  `external-properties.test.ts` and `external-composition.test.ts`

**tsdoc** — every parsed tag except `@default` (covered by the ts
`jsdoc-default*` fixtures and svelte `props/jsdoc-tags`): `@param` (incl. dash separator), `@returns`,
`@throws` (braced types incl. unions, bare braced, multiline), `@example`,
`@deprecated`, `@internal` (prose and bare), `@see` (URL, `{@link}`, text,
mixed), `@since`, `@mutates` (compound path, multi-word, backtick, bare,
continuation, list), `@nodocs`, inline `{@link}` in descriptions, empty
comments, and a comprehensive all-tags case.

## See also

- `src/test/{tsdoc,typescript,svelte}.test.ts` — fixture loading and validation
- `module-fixture-helpers.ts` — shared capture (`ModuleFixtureJson`,
  `captureModuleFixture`, `captureFixtureProject`, `resolveFixtureSpecifier`,
  `validateModuleFixture`)
- `{tsdoc,ts,svelte}/*-test-helpers.ts` — per-set loaders
