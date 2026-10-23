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
  reads `src/lib/input.ts`. An `input.js` (single-file only) analyzes as JS
  the same way, at `src/lib/input.js`, for the JSDoc paths.
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
comments, `duplicate_comment`, and other warnings are
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
  (`props/source-order-redeclared`), destructured external props admitted past
  the filter, TS and JS (`props/destructured-external*`)
- Component: JSDoc/`@component`, docComment precedence (`doccomment-*`), module
  comments (`module-comment*`: tags from each source, a `*/` and an indented
  example in an HTML comment, misplaced tags, a tag-only script comment
  outranking an HTML one, and one of only misplaced tags yielding), no props,
  template-only, generics,
  `acceptsChildren` (`children-*`, `no-children`; a default slot setting it on
  a template-only and a propless legacy component, and not on a runes one —
  `$props()`, a rune-using exported binding, `<svelte:options runes />` over a
  rune-free script — nor a named slot alone: `slot-*`), exported snippets
  (`exported-snippet*`), merged valibot schema, JS components (`javascript`,
  `props/jsdoc-type`; typedef `@property` types as written nodes, recovering a lost alias
  and ordering a union as written: `props/jsdoc-typedef-written{,-ts}`), JSDoc parameters
  on a JS `<script module>` function
  (`component/javascript-module-params`), and JS `<script module>` typedefs
  with original-source lines and a merged const+typedef
  (`component/javascript-module-typedef`); a `@typedef` line in a
  `<script module>` module comment and in an HTML `@component` comment,
  each keeping its prose, the latter's typedef documenting nothing
  (`component/{module,component}-comment-typedef`), its lost alias naming
  nothing at use sites and warning no `alias_lost`
  (`component/component-comment-typedef-lost`); a `@typedef` line in the
  in-script JSDoc above `$props()` keeping its prose for the component, over
  the HTML comment (`component/doccomment-both-typedef-block`)
- Script tags: a `<script>` nested in the template is not the component's
  (`component/nested-script-*`): ahead of a legacy instance script (`-legacy`)
  and a runes one (`-runes`), with `lang="ts"` in a JS component (`-lang`),
  with its own `@module` comment and export ahead of a `<script module>`
  (`-module`), as JSON-LD in `<svelte:head>` (`-json-ld`); a top-level script
  below the template is (`component/script-after-template`). These inputs keep
  their tag order through `.formatignore`, since the formatter moves scripts
  to the top
- Legacy `export let` (`*/legacy-*`): props with the HTML fallback doc
  (`component/legacy-export-let`), TS with defaults, JSDoc, and imported types
  (`props/legacy-typescript`), JS with `@type` and initializer optionality
  (`props/legacy-javascript`), accessors, type-only exports, and the
  `export {a as class}` rename (`props/legacy-accessors-rename`), callbacks and
  snippets (`props/legacy-callback`), `$$restProps`/`$$props` use
  (`props/legacy-rest-props`), generics (`component/legacy-generic`), default
  slot → `acceptsChildren` and named-slot-only → not
  (`component/legacy-slot-{default,named}`), `$$Props` over an external bag with
  an index signature and an admitted `export let` name
  (`types/legacy-props-external`)
- Types: snippets, unions, tuples, literal unions, intersections with
  `HTMLAttributes`, `SvelteHTMLElements` extension, types derived from a
  component's own type (`typeof Other`, `ComponentProps<typeof Other>` from a
  `.svelte` and a `.ts` module: `types/component-type-query`), and project
  aliases over generated `$$ComponentProps` props recovering through both
  channels, `alias_lost` where neither can, and unaliased props expanding, bare
  and in arrays and tuples; legacy props through the shims'
  `__sveltets_2_PropsWithChildren` and a reserved `$$Props`
  (`types/component-props-alias`)
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
  (`gated-module`), a `@nodocs` typedef block on `export {a}` and
  `export {b} from` hiding the typedefs and keeping both re-export edges
  (`typedef-block-nodocs`)
- Errors: `untyped`, `template-malformed`, `type-resolution-failed`

**ts**

- Declarations of every kind, generics, members (visibility, static,
  readonly, accessors, external callables), parameters (optional, defaults,
  rest, dotted `@param` docs; JS `@param {T} [b]`/`{T=}`/`[b=0]` and
  `@param {object}`-nested docs with TS twins: `parameters/jsdoc-*`), module
  comments (`module/comment/*`: tags to module fields, tag-only, bare tags,
  multi-line `@see`, unknown tags, and declaration-only tags warning
  `misplaced_tag`)
- Structured types and name recovery: `types/type-info*`,
  `declarations/*/type-info-recovery`, `declarations/*/alias-lost-*`; merged
  value+type symbols: `declarations/*/merged-value-*`; union members in
  written order against a sibling that created the literals in reverse first
  (`types/union-written-order`; mechanics in
  `analyze.type-info-union-order.test.ts`); alias-lost unions written as
  union members, grouping and the fallbacks to expansion
  (`types/union-lost-alias-written`)
- JSDoc typedefs as type aliases (`declarations/type/jsdoc-*`, each JS one
  beside a `-ts` twin where TS has one): `@property` members (bracketed and
  `{T=}` optional, a nested `{object}`), written union order at the alias and
  use sites, `@callback` `(call)` members, `@template` generics with a
  constraint and default, block tags and `@nodocs`, `alias_lost`; whose
  block prose a typedef takes (`jsdoc-typedef-blocks`: several typedefs in
  one block, detached and directly above a declaration, one in a function's
  `@param`/`@returns` block, typedef blocks above declarations, which skip
  them, with `@nodocs`/`@deprecated`/`@see` and `@type` staying the
  typedef's, and a `@callback` block with its `@param` above a const); a
  `@module` block's typedef leaving the module its prose
  (`module/comment/typedef{,-ts}`); a `.ts` file's typedefs and `@enum`
  declaring nothing, and its declaration skipping a typedef block
  (`jsdoc-typedef-in-ts`); a merged const+typedef (`merged-value-typedef`);
  a JS `@enum` const, with string and array initializers listing no library
  members, and an `Object.freeze` and a spread initializer
  (`declarations/enum/jsdoc`); a JS component's typedef props over an
  external bag (svelte `types/jsdoc-typedef-external`)
- JSDoc annotations in JS, each beside a `-ts` twin: `@template` generics with a
  constraint and default on functions, arrows, function expressions, classes, methods, a
  `@type` function type, and a `typeof` member (`generics/jsdoc-template`), never on an
  `@overload`-ed function or method's implementation; `@param`/`@type`/`@returns` types as
  written nodes, recovering lost aliases at parameters (`[b]` included), returns,
  variables, fields, getters (`@returns` and `@type`), and setters
  (`types/jsdoc-type-info-recovery`), and ordering unions as written, `{T=}` included
  (`types/jsdoc-union-written-order`); a `.ts` file's JSDoc types annotating nothing, the
  checker's union order standing at a parameter, return, field, and getter
  (`types/jsdoc-ignored-in-ts`)
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
comments, a comprehensive all-tags case, and a `@module` block's tags never
reaching the declaration below it (`module-block-*`).

## See also

- `src/test/{tsdoc,typescript,svelte}.test.ts` — fixture loading and validation
- `module-fixture-helpers.ts` — shared capture (`ModuleFixtureJson`,
  `captureModuleFixture`, `captureFixtureProject`, `resolveFixtureSpecifier`,
  `validateModuleFixture`)
- `{tsdoc,ts,svelte}/*-test-helpers.ts` — per-set loaders
