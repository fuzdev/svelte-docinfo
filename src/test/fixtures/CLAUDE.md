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

- Svelte categories: `component`, `props`, `types`
- TypeScript categories: `class`, `interface`, `type`, `function`, `variable`, `module-comment`
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
		prop2,
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
		age,
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
│   ├── default-values/
│   ├── optional/
│   └── with-descriptions/
├── types/             # Type resolution
│   ├── extends-html/
│   ├── intersection/
│   └── multiple-kinds/
└── errors/            # Error handling
    └── untyped/
```

Each fixture directory contains:

- `input.svelte` - The Svelte component to analyze
- `expected.json` - Expected `ComponentDeclarationJson` object

### TypeScript Module Fixtures

```
src/test/fixtures/ts/declarations/class/generic/
├── input.ts           # Input TypeScript module
└── expected.json      # Expected DeclarationJson output
```

- `input.ts` - The TypeScript module to analyze
- `expected.json` - Expected `DeclarationJson` object (or module comment string for `module/comment/*` fixtures)

## Expected Output Format

### Svelte Module Output

`expected.json` is an array of all non-nodocs `DeclarationJson` objects from the module output. The component declaration is always first (primary export), followed by module-level exports (snippets, functions, variables, types).

```json
[
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
```

Fixtures with exported snippets:

```json
[
	{
		"name": "ComponentExportedSnippet",
		"kind": "component",
		"sourceLine": 3
	},
	{
		"name": "greet",
		"kind": "snippet",
		"sourceLine": 5,
		"typeSignature": "Snippet<[a: string]>",
		"parameters": [
			{
				"name": "a",
				"type": "string"
			}
		]
	}
]
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

`expected.json` matches the `DeclarationJson` interface:

```json
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

**Note:** Module comment fixtures contain just the comment string or `null`.

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
- [x] Component with JSDoc (@component, @example tags)
- [x] Component without props
- [x] Component without script
- [x] Error cases (untyped props)
- [x] Snippet-typed props (bare, parameterized, generic, optional params)
- [x] Exported snippets (basic, typed, parameterless, untyped, with function, with props)
- [x] `acceptsChildren` detection (explicit, inherited, no-children)

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
- `src/test/fixtures/svelte/svelte-test-helpers.ts` - Svelte fixture loading utilities
- `src/test/fixtures/ts/ts-test-helpers.ts` - TypeScript fixture loading utilities
- `src/test/fixtures/tsdoc/tsdoc-test-helpers.ts` - TSDoc fixture loading utilities
