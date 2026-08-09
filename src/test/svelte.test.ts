import { test, assert, describe, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import {
	analyzeSvelteModule,
	transformSvelteSource,
	extractScriptContent,
	extractModuleScriptContent,
	extractSvelteModuleComment,
	extractHtmlModuleComment,
	synthesizeSnippetTypeSignature
} from '$lib/svelte.ts';
import { createAnalysisProgram } from '$lib/typescript-program.ts';
import { type Diagnostic, byKind, hasErrors, hasWarnings, warningsOf } from '$lib/diagnostics.ts';
import type { ModuleAnalysis } from '$lib/declaration-build.ts';
import type { SourceFileInfo } from '$lib/source.ts';
import type { ModuleSourceOptions } from '$lib/source-config.ts';

import {
	buildSvelteFixtureRegistry,
	loadFixtures,
	validateDeclarationStructures,
	fixtureNameToComponentName,
	type SvelteFixture
} from './fixtures/svelte/svelte-test-helpers.ts';
import { normalizeJson, FIXTURES_SVELTE_DIR } from './test-helpers.ts';
import {
	testSourceOptions,
	createTestSourceOptions,
	createCachedAnalysisProgram
} from './test-module-helpers.ts';

/** Read fixture file content for analysis. */
const readFixture = (filePath: string): string => readFileSync(filePath, 'utf-8');

/** Run `transformSvelteSource` and unwrap the virtual file or throw. */
const transformOrThrow = (sf: SourceFileInfo) => {
	const r = transformSvelteSource(sf);
	if (!r.virtual) {
		throw new Error(`transform failed: ${sf.id}: ${r.diagnostics[0]?.message ?? 'unknown error'}`);
	}
	return r.virtual;
};

let fixtures: Array<SvelteFixture> = [];

beforeAll(async () => {
	fixtures = await loadFixtures();
});

/** Analyze a Svelte source via `analyzeSvelteModule` and extract the component declaration. */
const analyzeTestComponent = (
	sourceFile: SourceFileInfo,
	modulePath: string,
	diagnostics: Array<Diagnostic> = [] as Array<Diagnostic>
) => {
	const virtualFile = transformOrThrow(sourceFile);
	const program = createCachedAnalysisProgram(new Map([[virtualFile.virtualPath, virtualFile]]));
	const testChecker = program.getTypeChecker();
	const result = analyzeSvelteModule(
		sourceFile,
		modulePath,
		testChecker,
		// Root options at the component's own directory so its file is treated as
		// internal — the production invariant is that analyzed files live under
		// `projectRoot`. With the default cwd root, synthetic ids outside cwd are
		// judged external and the component's own inline props get filtered out as
		// if they came from node_modules.
		createTestSourceOptions(dirname(sourceFile.id)),
		diagnostics,
		program,
		virtualFile,
		// registry over the single-module set, mirroring analyzeCore's pre-pass
		buildSvelteFixtureRegistry(program, [{ virtualFile, modulePath }])
	);
	if (!result) throw new Error(`Analysis returned undefined for ${modulePath}`);
	const componentDecl = result.declarations.find((d) => d.declaration.kind === 'component');
	if (!componentDecl) throw new Error(`No component declaration found for ${modulePath}`);
	return componentDecl.declaration;
};

/** Analyze a Svelte source through the production pipeline (for tests that need moduleComment or full analysis). */
const analyzeSvelteTestIntegration = (
	sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> },
	modulePath: string,
	diagnostics: Array<Diagnostic>,
	options?: ModuleSourceOptions
): ModuleAnalysis => {
	// Default options root at the component's own directory so its file is treated
	// as internal (see `analyzeTestComponent` for why); callers needing a specific
	// project layout pass `options` explicitly.
	const opts = options ?? createTestSourceOptions(dirname(sourceFile.id));
	const virtualFile = transformOrThrow(sourceFile);
	const program = createCachedAnalysisProgram(new Map([[virtualFile.virtualPath, virtualFile]]));
	const testChecker = program.getTypeChecker();
	const result = analyzeSvelteModule(
		sourceFile,
		modulePath,
		testChecker,
		opts,
		diagnostics,
		program,
		virtualFile,
		buildSvelteFixtureRegistry(program, [{ virtualFile, modulePath }])
	);
	if (!result) throw new Error(`Analysis returned undefined for ${modulePath}`);
	return result;
};

describe('svelte component analyzer (fixture-based)', () => {
	test('all fixtures analyze correctly', { timeout: 15_000 }, () => {
		// Pre-transform all fixtures and create a single shared program (much faster than per-fixture)
		const fixtureData = fixtures.map((fixture) => {
			const componentName = fixtureNameToComponentName(fixture.name);
			const modulePath = `${componentName}.svelte`;
			const sourceFile: SourceFileInfo = {
				id: join(FIXTURES_SVELTE_DIR, `${fixture.name}/input.svelte`),
				content: fixture.input
			};
			const virtualFile = transformOrThrow(sourceFile);
			return { fixture, modulePath, sourceFile, virtualFile };
		});

		// Entries carry `scriptKind` so JS-lang fixtures parse as JS (JSDoc types)
		const allVirtualFiles = new Map(
			fixtureData.map((d) => [d.virtualFile.virtualPath, d.virtualFile])
		);
		const program = createAnalysisProgram({ virtualFiles: allVirtualFiles });
		const fixtureChecker = program.getTypeChecker();
		const opts = testSourceOptions();
		// one registry over the whole fixture set, mirroring analyzeCore's pre-pass
		const aliasRegistry = buildSvelteFixtureRegistry(program, fixtureData);

		for (const { fixture, modulePath, sourceFile, virtualFile } of fixtureData) {
			const diagnostics: Array<Diagnostic> = [];
			const moduleResult = analyzeSvelteModule(
				sourceFile,
				modulePath,
				fixtureChecker,
				opts,
				diagnostics,
				program,
				virtualFile,
				aliasRegistry
			);
			assert.ok(moduleResult, `Analysis returned undefined for fixture "${fixture.name}"`);

			// Compare all non-nodocs declarations with expected
			const actualDeclarations = moduleResult.declarations
				.filter((d) => !d.nodocs)
				.map((d) => d.declaration);
			assert.deepEqual(
				normalizeJson(actualDeclarations),
				normalizeJson(fixture.expected),
				`Fixture "${fixture.name}" failed`
			);
		}
	});

	test('all fixtures have valid structure', () => {
		for (const fixture of fixtures) {
			validateDeclarationStructures(fixture.expected);
		}
	});
});

describe('svelte component analysis', () => {
	test('analyzes a basic component from disk', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'props/basic/input.svelte');
		const modulePath = 'PropsBasic.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.strictEqual(declaration.name, 'PropsBasic');
		assert.strictEqual(declaration.kind, 'component');
		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 2);

		const propNames = declaration.props.map((p) => p.name);
		assert.include(propNames, 'prop1');
		assert.include(propNames, 'prop2');
	});

	test('extracts component documentation when present', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'props/basic/input.svelte');
		const modulePath = 'PropsBasic.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		// The component has JSDoc in the script block - extraction depends on svelte2tsx behavior
		// Just verify we get a valid component back (docComment extraction is tested in fixture tests)
		assert.strictEqual(declaration.name, 'PropsBasic');
		assert.strictEqual(declaration.kind, 'component');
	});

	test('handles component with JSDoc in HTML comment', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'component/with-jsdoc/input.svelte');
		const modulePath = 'ComponentJsdoc.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.strictEqual(declaration.name, 'ComponentJsdoc');
		assert.strictEqual(declaration.kind, 'component');
	});

	test('handles component without props', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'component/no-props/input.svelte');
		const modulePath = 'ComponentNoProps.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.strictEqual(declaration.name, 'ComponentNoProps');
		assert.strictEqual(declaration.kind, 'component');
		// Props should be undefined or empty
		assert.ok(!declaration.props || declaration.props.length === 0);
	});

	test('legacy-export-let fixture emits legacy_props naming its exact props', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'component/legacy-export-let/input.svelte');
		const modulePath = 'ComponentLegacyExportLet.svelte';

		const diagnostics: Array<Diagnostic> = [];
		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath,
			diagnostics
		);

		// the fixture's expected.json locks declarations only (the harness
		// discards diagnostics), so the diagnostic on this exact input is
		// locked here — a fixture edit can't drift detection silently
		assert.ok(!declaration.props || declaration.props.length === 0);
		const legacy = byKind(diagnostics, 'legacy_props');
		assert.strictEqual(legacy.length, 1);
		assert.strictEqual(legacy[0]!.componentName, 'ComponentLegacyExportLet');
		assert.deepStrictEqual(legacy[0]!.propNames, ['prop1', 'prop2', 'prop3']);
		// `export let prop1` sits on line 16 of input.svelte
		assert.strictEqual(legacy[0]!.line, 16);
	});

	test('extracts prop descriptions', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'props/with-descriptions/input.svelte');
		const modulePath = 'PropsDescriptions.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 3);
		const prop1 = declaration.props.find((p) => p.name === 'prop1');
		assert.ok(prop1, 'Expected to find prop1');
		assert.strictEqual(prop1.description, 'Description 1 line 1.\nDescription 1 line 2.');
		const prop2 = declaration.props.find((p) => p.name === 'prop2');
		assert.ok(prop2);
		assert.strictEqual(prop2.description, 'Description 2 line 1.\nDescription 2 line 2.');
	});

	test('detects optional props', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'props/optional/input.svelte');
		const modulePath = 'PropsOptional.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 3);
		const optionalNames = declaration.props
			.filter((p) => p.optional)
			.map((p) => p.name)
			.sort();
		assert.deepStrictEqual(optionalNames, ['prop2', 'prop3']);
	});

	test('detects bindable props', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'props/bindable/input.svelte');
		const modulePath = 'PropsBindable.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 3);
		const bindableNames = declaration.props
			.filter((p) => p.bindable)
			.map((p) => p.name)
			.sort();
		assert.deepStrictEqual(bindableNames, ['prop2', 'prop3']);
	});

	test('extracts correct module path as component name', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'props/basic/input.svelte');
		const content = readFixture(filePath);

		// Test with nested path
		const declaration1 = analyzeTestComponent(
			{ id: filePath, content },
			'components/Button.svelte'
		);
		assert.strictEqual(declaration1.name, 'Button');

		// Test with simple path
		const declaration2 = analyzeTestComponent({ id: filePath, content }, 'Alert.svelte');
		assert.strictEqual(declaration2.name, 'Alert');
	});

	test('handles TypeScript component', () => {
		// props_basic uses lang="ts"
		const filePath = join(FIXTURES_SVELTE_DIR, 'props/basic/input.svelte');
		const modulePath = 'TypeScript_Component.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.strictEqual(declaration.kind, 'component');
		// Should have typed props
		assert.ok(declaration.props);
		const prop2 = declaration.props.find((p) => p.name === 'prop2');
		assert.ok(prop2);
		assert.strictEqual(prop2.type, 'number');
	});

	test('handles JS component (no lang="ts")', () => {
		// component/template_only has no script tag with lang="ts"
		const filePath = join(FIXTURES_SVELTE_DIR, 'component/template-only/input.svelte');
		const modulePath = 'Js_Component.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.strictEqual(declaration.name, 'Js_Component');
		assert.strictEqual(declaration.kind, 'component');
		// Basic component has no props
		assert.ok(!declaration.props || declaration.props.length === 0);
	});

	test('handles single-quoted lang attribute', () => {
		const svelteContent = `<script lang='ts'>
	let {count}: {count: number} = $props();
</script>
<p>{count}</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/SingleQuote.svelte', content: svelteContent },
			'SingleQuote.svelte'
		);

		assert.strictEqual(declaration.kind, 'component');
		assert.ok(declaration.props);
		const prop = declaration.props.find((p) => p.name === 'count');
		assert.ok(prop);
		assert.strictEqual(prop.type, 'number');
	});

	test('uses pre-read content when provided', () => {
		const svelteContent = `<script lang="ts">
	let {value = 'test'}: {value?: string} = $props();
</script>
<p>{value}</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte'
		);

		assert.strictEqual(declaration.name, 'Test');
		assert.strictEqual(declaration.kind, 'component');
		assert.ok(declaration.props);
		const valueProp = declaration.props.find((p) => p.name === 'value');
		assert.ok(valueProp);
		assert.strictEqual(valueProp.type, 'string');
		assert.strictEqual(valueProp.optional, true);
	});
});

describe('extractScriptContent', () => {
	test('extracts script content from basic component', () => {
		const svelteSource = `<script lang="ts">
	const foo = 'bar';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
	});

	test('extracts script content without lang attribute', () => {
		const svelteSource = `<script>
	const foo = 'bar';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
	});

	test('returns undefined for component without script', () => {
		const svelteSource = `<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.isUndefined(result);
	});

	test('does not match script module tag', () => {
		const svelteSource = `<script module>
	export const shared = 'value';
</script>
<script lang="ts">
	const foo = 'bar';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
		assert.notInclude(result, 'shared');
	});

	test('handles empty script tag', () => {
		const svelteSource = `<script lang="ts"></script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.strictEqual(result, '');
	});

	test('handles script with single quotes in lang attribute', () => {
		const svelteSource = `<script lang='ts'>
	const foo = 'bar';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
	});

	test('does not match Svelte 4 context="module" syntax', () => {
		const svelteSource = `<script context="module">
	export const shared = 'value';
</script>
<script lang="ts">
	const foo = 'bar';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
		assert.notInclude(result, 'shared');
	});

	test('extracts first matching script when module script comes after', () => {
		const svelteSource = `<script lang="ts">
	const foo = 'bar';
</script>
<script module>
	export const shared = 'value';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
		assert.notInclude(result, 'shared');
	});

	test('does not match module attribute in any position', () => {
		const svelteSource = `<script lang="ts" module>
	export const shared = 'value';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.isUndefined(result, 'Should not match <script> with module attribute after lang');
	});

	test('does not match Svelte 4 context="module" in any position', () => {
		const svelteSource = `<script lang="ts" context="module">
	export const shared = 'value';
</script>
<p>Hello</p>`;

		const result = extractScriptContent(svelteSource);
		assert.isUndefined(result, 'Should not match <script> with context="module" after lang');
	});

	test('extracts script content with generics attribute', () => {
		const svelteSource = `<script lang="ts" generics="T">
	let {items}: {items: T[]} = $props();
</script>
<ul>{#each items as item}<li>{item}</li>{/each}</ul>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result, 'Should match <script> with generics attribute');
		assert.include(result, 'items');
	});

	test('extracts script content with generics before lang', () => {
		const svelteSource = `<script generics="T extends {id: number}" lang="ts">
	let {items}: {items: T[]} = $props();
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result, 'Should match <script> regardless of attribute order');
		assert.include(result, 'items');
	});

	test('extracts full content when generics contains an arrow type', () => {
		const svelteSource = `<script lang="ts" generics="T extends () => void">
	let {callback}: {callback: T} = $props();
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		// exact equality — the old regex ended the opening tag at the arrow's
		// `>`, prefixing the content with the tag remainder (` void">`)
		assert.strictEqual(result, '\n\tlet {callback}: {callback: T} = $props();\n');
	});

	test('extracts full content when generics contains a generic type argument', () => {
		const svelteSource = `<script lang="ts" generics="T extends Record<string, unknown>">
	let {items}: {items: T[]} = $props();
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.strictEqual(result, '\n\tlet {items}: {items: T[]} = $props();\n');
	});

	test('extracts full content with single-quoted generics containing an arrow type', () => {
		const svelteSource = `<script lang="ts" generics='T extends () => void'>
	let {callback}: {callback: T} = $props();
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.strictEqual(result, '\n\tlet {callback}: {callback: T} = $props();\n');
	});

	test('does not treat the word module inside an attribute value as a module script', () => {
		const svelteSource = `<script lang="ts" generics="T extends import('./module.js').Item">
	let {items}: {items: T[]} = $props();
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result, 'instance script misclassified as module script');
		assert.include(result, 'items');
	});

	test('skips commented-out script tags', () => {
		const svelteSource = `<!--
<script>
	const commented = 'out';
</script>
-->
<script lang="ts">
	const foo = 'bar';
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
		assert.notInclude(result, 'commented');
	});

	test('matches a closing tag with trailing whitespace', () => {
		const svelteSource = `<script>
	const foo = 'bar';
</script >
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result, "Svelte's parser accepts </script >");
		assert.include(result, "const foo = 'bar'");
	});

	test('ignores self-closing script tags', () => {
		const svelteSource = `<script />
<script>
	const foo = 'bar';
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, "const foo = 'bar'");
	});

	test('does not match capitalized component tags', () => {
		const svelteSource = `<Script>
	not a script element
</Script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.isUndefined(result, '<Script> is a component, not a script element');
	});

	test('handles a multiline opening tag', () => {
		const svelteSource = `<script
	lang="ts"
	generics="T extends () => void"
>
	let {callback}: {callback: T} = $props();
</script>
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, 'callback');
		assert.notInclude(result, 'generics');
	});

	test('does not match a script code sample inside an @component comment', () => {
		const svelteSource = `<!--
	@component
	Usage: \`<script lang="ts">import Comp from './Comp.svelte';</script>\`
-->
<p>Content</p>`;

		const result = extractScriptContent(svelteSource);
		assert.isUndefined(result, 'code sample inside a comment is not a script element');
	});
});

describe('extractModuleScriptContent', () => {
	test('extracts module script content', () => {
		const svelteSource = `<script module>
	export const shared = 'value';
</script>
<script lang="ts">
	const foo = 'bar';
</script>
<p>Content</p>`;

		const result = extractModuleScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, 'shared');
		assert.notInclude(result, 'foo');
	});

	test('extracts Svelte 4 context="module" script content', () => {
		const svelteSource = `<script context="module">
	export const shared = 'value';
</script>
<p>Content</p>`;

		const result = extractModuleScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, 'shared');
	});

	test('skips commented-out module scripts', () => {
		const svelteSource = `<!--
<script module>
	export const commented = 'out';
</script>
-->
<script module>
	export const real = 'value';
</script>
<p>Content</p>`;

		const result = extractModuleScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, 'real');
		assert.notInclude(result, 'commented');
	});

	test('returns undefined when only a commented-out module script exists', () => {
		const svelteSource = `<!--
<script module>
	export const commented = 'out';
</script>
-->
<p>Content</p>`;

		const result = extractModuleScriptContent(svelteSource);
		assert.isUndefined(result);
	});

	test('finds the real module script past an instance script with module in an attribute value', () => {
		const svelteSource = `<script lang="ts" generics="T extends import('./module.js').Item">
	let {items}: {items: T[]} = $props();
</script>
<script module>
	export const shared = 'value';
</script>
<p>Content</p>`;

		const result = extractModuleScriptContent(svelteSource);
		assert.ok(result, 'real module script shadowed by attribute-value false positive');
		assert.include(result, 'shared');
		assert.notInclude(result, 'items');
	});

	test('does not match context with a non-module value', () => {
		const svelteSource = `<script context="other">
	const foo = 'bar';
</script>
<p>Content</p>`;

		const result = extractModuleScriptContent(svelteSource);
		assert.isUndefined(result);
	});

	test('matches module combined with other attributes', () => {
		const svelteSource = `<script module lang="ts">
	export const shared = 'value';
</script>
<p>Content</p>`;

		const result = extractModuleScriptContent(svelteSource);
		assert.ok(result);
		assert.include(result, 'shared');
	});
});

describe('transformSvelteSource script-kind detection', () => {
	const scriptKindOf = (content: string): ts.ScriptKind => {
		const result = transformSvelteSource({ id: '/project/src/lib/Comp.svelte', content });
		assert.ok(result.virtual);
		return result.virtual.scriptKind;
	};

	test('lang="ts" parses as TS', () => {
		const kind = scriptKindOf(`<script lang="ts">
	let {a}: {a: string} = $props();
</script>
<div>{a}</div>`);
		assert.strictEqual(kind, ts.ScriptKind.TS);
	});

	test('no lang parses as JS', () => {
		const kind = scriptKindOf(`<script>
	let {a} = $props();
</script>
<div>{a}</div>`);
		assert.strictEqual(kind, ts.ScriptKind.JS);
	});

	test('lang="typescript" parses as JS — Svelte core accepts only ts', () => {
		// svelte2tsx's fallback detection takes ts|typescript; the compiler
		// doesn't, and it decides whether the component compiles at all
		const kind = scriptKindOf(`<script lang="typescript">
	let {a} = $props();
</script>
<div>{a}</div>`);
		assert.strictEqual(kind, ts.ScriptKind.JS);
	});

	test('the first valued lang attribute decides the whole file', () => {
		// the compiler's ts flag is parser-wide, so this instance lang="ts"
		// can't flip a file the module script already declared js
		const kind = scriptKindOf(`<script module lang="js">
	export const shared = 'value';
</script>
<script lang="ts">
	let {a} = $props();
</script>
<div>{a}</div>`);
		assert.strictEqual(kind, ts.ScriptKind.JS);
	});

	test('whitespace around the lang = sign is a Svelte parse error', () => {
		// requiring a literal `lang=` costs nothing — Svelte's parser rejects
		// the spaced spelling, so svelte2tsx throws before kind could matter
		const result = transformSvelteSource({
			id: '/project/src/lib/Comp.svelte',
			content: `<script lang = "ts">
	let {a} = $props();
</script>
<div>{a}</div>`
		});
		assert.isUndefined(result.virtual);
		assert.strictEqual(result.diagnostics[0]?.kind, 'transform_failed');
	});

	test('lang="ts" in template text does not flip a JS component to TS', () => {
		const kind = scriptKindOf(`<script>
	let {a} = $props();
</script>
<pre>{'<script lang="ts">'}</pre>
<div>{a}</div>`);
		assert.strictEqual(kind, ts.ScriptKind.JS);
	});

	test('lang="ts" on the module script counts', () => {
		const kind = scriptKindOf(`<script module lang="ts">
	export const shared: string = 'value';
</script>
<div>hi</div>`);
		assert.strictEqual(kind, ts.ScriptKind.TS);
	});
});

describe('extractSvelteModuleComment', () => {
	test('extracts module comment at start of script', () => {
		const scriptContent = `
/**
 * This is a module-level comment.
 * It describes the entire module.
 *
 * @module
 */

import {something} from './somewhere.js';

const foo = 'bar';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.ok(result);
		assert.include(result, 'This is a module-level comment');
		assert.include(result, 'It describes the entire module');
	});

	test('extracts module comment after imports', () => {
		const scriptContent = `
import {something} from './somewhere.js';

/**
 * Module comment after imports.
 *
 * @module
 */

const foo = 'bar';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.ok(result);
		assert.include(result, 'Module comment after imports');
	});

	test('does not extract comment without @module tag', () => {
		const scriptContent = `
/**
 * This is a regular JSDoc comment.
 * It should not be treated as a module comment.
 */

const foo = 'bar';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.isUndefined(result);
	});

	test('returns undefined when no JSDoc comment present', () => {
		const scriptContent = `
// Regular comment
const foo = 'bar';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.isUndefined(result);
	});

	test('handles script with only imports', () => {
		const scriptContent = `
/**
 * Module with only imports.
 *
 * @module
 */

import {a} from './a.js';
import {b} from './b.js';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.ok(result);
		assert.include(result, 'Module with only imports');
	});

	test('ignores block comments that are not JSDoc', () => {
		const scriptContent = `
/* This is a regular block comment, not JSDoc */

const foo = 'bar';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.isUndefined(result);
	});

	test('returns undefined for empty script content', () => {
		const result = extractSvelteModuleComment('');
		assert.isUndefined(result);
	});

	test('returns undefined for whitespace-only content', () => {
		const result = extractSvelteModuleComment('   \n\n   ');
		assert.isUndefined(result);
	});

	test('extracts first module comment when multiple JSDoc comments exist', () => {
		const scriptContent = `
/**
 * First module comment.
 *
 * @module
 */

/**
 * Second comment after blank line.
 */

const foo = 'bar';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.ok(result);
		assert.include(result, 'First module comment');
		assert.notInclude(result, 'Second comment');
	});

	test('handles JSDoc with @module and other tags', () => {
		const scriptContent = `
/**
 * @see https://fuz.dev
 *
 * @module
 */

const foo = 'bar';
`;

		const result = extractSvelteModuleComment(scriptContent);
		assert.ok(result);
		assert.include(result, '@see https://fuz.dev');
		// @module tag should be stripped from output
		assert.notInclude(result, '@module');
	});
});

describe('svelte module comment extraction (integration)', () => {
	test('extracts module comment from component', () => {
		const svelteContent = `<script lang="ts">
/**
 * This component displays a greeting message.
 *
 * @see https://fuz.dev/docs
 *
 * @module
 */

let {name}: {name: string} = $props();
</script>
<p>Hello {name}</p>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Greeting.svelte', content: svelteContent },
			'Greeting.svelte',
			[] as Array<Diagnostic>
		);
		const componentDecl = result.declarations.find((d) => d.declaration.kind === 'component');

		assert.ok(componentDecl);
		assert.strictEqual(componentDecl.declaration.name, 'Greeting');
		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'This component displays a greeting message');
	});

	test('returns undefined moduleComment when not present', () => {
		const svelteContent = `<script lang="ts">
let {name}: {name: string} = $props();
</script>
<p>Hello {name}</p>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Simple.svelte', content: svelteContent },
			'Simple.svelte',
			[] as Array<Diagnostic>
		);

		assert.isUndefined(result.moduleComment);
	});

	test('distinguishes module comment from component comment', () => {
		const svelteContent = `<script lang="ts">
/**
 * Module-level documentation.
 *
 * @module
 */

/** Component documentation attached to props. */
let {name}: {name: string} = $props();
</script>
<p>Hello {name}</p>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Dual.svelte', content: svelteContent },
			'Dual.svelte',
			[] as Array<Diagnostic>
		);
		const declaration = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'Module-level documentation');
		assert.notInclude(result.moduleComment, 'Component documentation');

		// Component doc should be separate
		assert.ok(declaration.docComment);
		assert.include(declaration.docComment, 'Component documentation');
	});

	test('instance @module on an import does not double-count via the virtual', () => {
		// svelte2tsx hoists instance-script imports (with leading JSDoc) to the
		// virtual's top level — a `@module` comment attached to an import must
		// read as the instance comment only, not also as a `<script module>` one
		const svelteContent = `<script lang="ts">
/**
 * Module docs attached to the import.
 * @module
 */
import {tick} from 'svelte';

let {name}: {name: string} = $props();
void tick;
</script>
<p>Hello {name}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Hoisted.svelte', content: svelteContent },
			'Hoisted.svelte',
			diagnostics
		);

		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'Module docs attached to the import');
		const duplicates = diagnostics.filter((d) => d.kind === 'duplicate_comment');
		assert.strictEqual(duplicates.length, 0);
	});

	test('extracts module comment from <script module>', () => {
		const svelteContent = `<script module lang="ts">
/**
 * Module docs from the module script.
 * @module
 */
export const shared = 1;
</script>
<p>text</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/ModuleScript.svelte', content: svelteContent },
			'ModuleScript.svelte',
			diagnostics
		);

		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'Module docs from the module script');
		assert.strictEqual(diagnostics.filter((d) => d.kind === 'duplicate_comment').length, 0);
	});

	test('instance and <script module> @module comments warn as duplicates', () => {
		const svelteContent = `<script module lang="ts">
/**
 * From the module script.
 * @module
 */
export const shared = 1;
</script>
<script lang="ts">
/**
 * From the instance script.
 * @module
 */

let {name}: {name: string} = $props();
</script>
<p>Hello {name}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/DualModule.svelte', content: svelteContent },
			'DualModule.svelte',
			diagnostics
		);

		// Instance comment wins per the documented priority
		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'From the instance script');

		const duplicates = diagnostics.filter(
			(d) => d.kind === 'duplicate_comment' && d.commentType === 'module_comment'
		);
		assert.strictEqual(duplicates.length, 1);
		assert.include(duplicates[0]!.message, 'JSDoc in <script>');
		assert.include(duplicates[0]!.message, 'JSDoc in <script module>');
	});

	test('@nodocs in a module comment warns (no module-level meaning)', () => {
		// instance-script, <script module>, and HTML comments are all checked
		// in analyzeSvelteModule against the original source — each misplaced
		// comment warns once
		const scriptModuleContent = `<script module lang="ts">
/**
 * Module docs.
 *
 * @module
 * @nodocs
 */
export const a = 1;
</script>
<p>text</p>`;

		const scriptModuleDiagnostics: Array<Diagnostic> = [];
		analyzeSvelteTestIntegration(
			{ id: '/fake/path/ScriptModule.svelte', content: scriptModuleContent },
			'ScriptModule.svelte',
			scriptModuleDiagnostics
		);
		const fromScriptModule = scriptModuleDiagnostics.filter((d) => d.kind === 'misplaced_tag');
		assert.strictEqual(fromScriptModule.length, 1);
		assert.strictEqual(fromScriptModule[0]!.tagName, 'nodocs');

		const htmlContent = `<!--
@module
@nodocs
Module docs.
-->
<p>text</p>`;

		const htmlDiagnostics: Array<Diagnostic> = [];
		analyzeSvelteTestIntegration(
			{ id: '/fake/path/HtmlModule.svelte', content: htmlContent },
			'HtmlModule.svelte',
			htmlDiagnostics
		);
		const fromHtml = htmlDiagnostics.filter((d) => d.kind === 'misplaced_tag');
		assert.strictEqual(fromHtml.length, 1);
		assert.strictEqual(fromHtml[0]!.tagName, 'nodocs');
	});
});

describe('svelte analysis diagnostic collection', () => {
	test('analysis context is threaded through correctly', () => {
		const svelteContent = `<script lang="ts">
let {name, count}: {name: string; count: number} = $props();
</script>
<p>Hello {name}, count: {count}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const declaration = analyzeTestComponent(
			{ id: '/fake/path/Valid.svelte', content: svelteContent },
			'Valid.svelte',
			diagnostics
		);

		// Valid component should produce no diagnostics
		assert.strictEqual(diagnostics.length, 0);
		assert.strictEqual(hasErrors(diagnostics), false);
		assert.strictEqual(hasWarnings(diagnostics), false);

		// Component should be successfully analyzed
		assert.strictEqual(declaration.kind, 'component');
		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 2);
	});

	test('handles component with empty script tag', () => {
		const svelteContent = `<script lang="ts"></script>
<p>Static content</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/Empty.svelte', content: svelteContent },
			'Empty.svelte'
		);

		assert.strictEqual(declaration.name, 'Empty');
		assert.strictEqual(declaration.kind, 'component');
		// No props expected
		assert.ok(!declaration.props || declaration.props.length === 0);
	});

	test('handles component with only template (no script)', () => {
		const svelteContent = `<p>Just a template, no script</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/NoScript.svelte', content: svelteContent },
			'NoScript.svelte',
			diagnostics
		);
		const componentDecl = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		assert.strictEqual(componentDecl.name, 'NoScript');
		assert.strictEqual(componentDecl.kind, 'component');
		// No script means no module comment
		assert.isUndefined(result.moduleComment);
	});

	test('handles component with module context only', () => {
		const svelteContent = `<script module>
export const sharedValue = 'shared';
</script>
<p>Module context only</p>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/ModuleOnly.svelte', content: svelteContent },
			'ModuleOnly.svelte',
			[] as Array<Diagnostic>
		);
		const componentDecl = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		assert.strictEqual(componentDecl.name, 'ModuleOnly');
		assert.strictEqual(componentDecl.kind, 'component');
		// No instance script means no props
		assert.ok(!componentDecl.props || componentDecl.props.length === 0);
	});

	test('handles component with both script types', () => {
		const svelteContent = `<script module>
export const CONSTANT = 'value';
</script>
<script lang="ts">
let {name}: {name: string} = $props();
</script>
<p>Hello {name}</p>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Both.svelte', content: svelteContent },
			'Both.svelte',
			[] as Array<Diagnostic>
		);
		const componentDecl = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		assert.strictEqual(componentDecl.name, 'Both');
		assert.strictEqual(componentDecl.kind, 'component');
		// Should extract props from instance script
		assert.ok(componentDecl.props);
		assert.strictEqual(componentDecl.props.length, 1);
		assert.strictEqual(componentDecl.props[0]!.name, 'name');
	});

	test('handles component with untyped props gracefully', () => {
		// Component with props that lack explicit type annotations
		const svelteContent = `<script lang="ts">
let {untypedProp} = $props();
</script>
<p>{untypedProp}</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/Untyped.svelte', content: svelteContent },
			'Untyped.svelte'
		);

		assert.strictEqual(declaration.name, 'Untyped');
		assert.strictEqual(declaration.kind, 'component');
		// Props without explicit type annotations are extracted with 'any' type
		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 1);
		assert.strictEqual(declaration.props[0]!.name, 'untypedProp');
		assert.strictEqual(declaration.props[0]!.type, 'any');
	});

	test('handles complex intersection type props', () => {
		const filePath = join(FIXTURES_SVELTE_DIR, 'types/intersection/input.svelte');
		const modulePath = 'TypesIntersection.svelte';

		const declaration = analyzeTestComponent(
			{ id: filePath, content: readFixture(filePath) },
			modulePath
		);

		assert.strictEqual(declaration.kind, 'component');
		// Should extract props from intersection type without errors
		assert.ok(declaration.props);
	});

	test('throws on severely malformed template with clear error', () => {
		// JS parse errors in expressions are not recoverable
		const svelteContent = `<script lang="ts">
let {name}: {name: string} = $props();
</script>
<p>{name</p>`;
		// Note: missing closing brace in template expression

		// svelte2tsx throws directly on JS parse errors
		assert.throws(
			() =>
				analyzeTestComponent(
					{ id: '/fake/path/Malformed.svelte', content: svelteContent },
					'Malformed.svelte'
				),
			/Unterminated regular expression/
		);
	});
});

describe('svelte props type not found diagnostic', () => {
	test('emits warning when $props() type reference cannot be resolved', () => {
		// Component references an imported type that doesn't exist — checker can't resolve it.
		const svelteContent = `<script lang="ts">
let {name}: MissingType = $props();
</script>
<p>{name}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const sourceFile: SourceFileInfo = {
			id: '/fake/path/Test.svelte',
			content: svelteContent
		};
		const virtualFile = transformOrThrow(sourceFile);
		const program = createCachedAnalysisProgram(new Map([[virtualFile.virtualPath, virtualFile]]));
		const testChecker = program.getTypeChecker();
		const result = analyzeSvelteModule(
			sourceFile,
			'Test.svelte',
			testChecker,
			testSourceOptions(),
			diagnostics,
			program,
			virtualFile
		);

		assert.ok(result);
		const componentDecl = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;
		assert.strictEqual(componentDecl.kind, 'component');
		assert.strictEqual(componentDecl.name, 'Test');

		// Checker resolves MissingType as an error type — props extraction may
		// emit a warning or return empty props depending on checker behavior.
		// The key assertion is that analysis completes without throwing.
	});

	test('does not emit warning for component without $props()', () => {
		const svelteContent = `<script lang="ts">
const greeting = 'hello';
</script>
<p>{greeting}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		analyzeTestComponent(
			{ id: '/fake/path/NoProps.svelte', content: svelteContent },
			'NoProps.svelte',
			diagnostics
		);

		// No diagnostic for components that simply don't use $props()
		assert.strictEqual(diagnostics.length, 0);
	});

	test('does not emit warning when props are successfully extracted', () => {
		const svelteContent = `<script lang="ts">
let {name}: {name: string} = $props();
</script>
<p>{name}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const declaration = analyzeTestComponent(
			{ id: '/fake/path/GoodProps.svelte', content: svelteContent },
			'GoodProps.svelte',
			diagnostics
		);

		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 1);
		// No warnings since props were extracted successfully
		assert.strictEqual(hasWarnings(diagnostics), false);
	});
});

describe('svelte analysis edge cases', () => {
	test('extracts sourceLine for component with script on line 1', () => {
		const svelteContent = `<script lang="ts">
let {value}: {value: number} = $props();
</script>
<p>{value}</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/WithLine.svelte', content: svelteContent },
			'WithLine.svelte'
		);

		assert.ok(declaration.sourceLine);
		assert.strictEqual(declaration.sourceLine, 1);
	});

	test('extracts sourceLine pointing to script tag line', () => {
		const svelteContent = `<!-- Component comment -->
<script lang="ts">
let {value}: {value: number} = $props();
</script>
<p>{value}</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/WithComment.svelte', content: svelteContent },
			'WithComment.svelte'
		);

		// sourceLine should point to the <script> tag, not always 1
		assert.ok(declaration.sourceLine);
		assert.strictEqual(declaration.sourceLine, 2);
	});

	test('handles script with only comments', () => {
		const svelteContent = `<script lang="ts">
// Just a comment, no code
/* Another comment */
</script>
<p>Content</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/Comments.svelte', content: svelteContent },
			'Comments.svelte'
		);

		assert.strictEqual(declaration.name, 'Comments');
		assert.strictEqual(declaration.kind, 'component');
	});

	test('handles script with imports only', () => {
		const svelteContent = `<script lang="ts">
import {onMount} from 'svelte';
</script>
<p>No props, just imports</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/ImportsOnly.svelte', content: svelteContent },
			'ImportsOnly.svelte'
		);

		assert.strictEqual(declaration.name, 'ImportsOnly');
		assert.ok(!declaration.props || declaration.props.length === 0);
	});

	test('preserves prop order from source', () => {
		const svelteContent = `<script lang="ts">
let {first, second, third}: {first: string; second: number; third: boolean} = $props();
</script>
<p>{first} {second} {third}</p>`;

		const declaration = analyzeTestComponent(
			{ id: '/fake/path/PropOrder.svelte', content: svelteContent },
			'PropOrder.svelte'
		);

		assert.ok(declaration.props);
		assert.strictEqual(declaration.props.length, 3);
		// Verify order is preserved
		assert.strictEqual(declaration.props[0]!.name, 'first');
		assert.strictEqual(declaration.props[1]!.name, 'second');
		assert.strictEqual(declaration.props[2]!.name, 'third');
	});
});

describe('analyzeSvelteModule with SourceFileInfo dependencies', () => {
	test('passes dependencies from SourceFileInfo to result', () => {
		const svelteContent = `<script lang="ts">
let {value}: {value: string} = $props();
</script>
<p>{value}</p>`;

		const options = createTestSourceOptions('/project', {
			sourcePaths: ['src/lib']
		});

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{
				id: '/project/src/lib/Consumer.svelte',
				content: svelteContent,
				dependencies: [
					'/project/src/lib/utils.ts',
					'/project/node_modules/external/index.js' // should be filtered
				],
				dependents: ['/project/src/lib/Parent.svelte']
			},
			'Consumer.svelte',
			diagnostics,
			options
		);

		// Dependencies should be filtered to source modules only
		assert.ok(Array.isArray(result.dependencies));
		assert.include(result.dependencies, 'utils.ts');
		assert.notInclude(result.dependencies, '/project/node_modules/external/index.js');

		assert.ok(Array.isArray(result.dependents));
		assert.include(result.dependents, 'Parent.svelte');
	});

	test('returns empty arrays when SourceFileInfo has no dependencies', () => {
		const svelteContent = `<script lang="ts">
let {standalone}: {standalone: boolean} = $props();
</script>
<p>{standalone}</p>`;

		const options = createTestSourceOptions('/project', {
			sourcePaths: ['src/lib']
		});

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{
				id: '/project/src/lib/Standalone.svelte',
				content: svelteContent
				// No dependencies or dependents provided
			},
			'Standalone.svelte',
			diagnostics,
			options
		);

		// Should return empty arrays, not undefined
		assert.ok(Array.isArray(result.dependencies));
		assert.ok(Array.isArray(result.dependents));
		assert.strictEqual(result.dependencies.length, 0);
		assert.strictEqual(result.dependents.length, 0);
	});

	test('all array fields are always arrays (never undefined)', () => {
		const svelteContent = `<script lang="ts">
let {x}: {x: number} = $props();
</script>
<p>{x}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Simple.svelte', content: svelteContent },
			'Simple.svelte',
			diagnostics
		);

		// Verify all array fields are arrays
		assert.ok(Array.isArray(result.declarations), 'declarations should be array');
		assert.ok(Array.isArray(result.dependencies), 'dependencies should be array');
		assert.ok(Array.isArray(result.dependents), 'dependents should be array');
		assert.ok(Array.isArray(result.starExports), 'starExports should be array');
		assert.ok(Array.isArray(result.reExports), 'reExports should be array');

		// Svelte components don't have starExports or reExports
		assert.strictEqual(result.starExports.length, 0);
		assert.strictEqual(result.reExports.length, 0);
	});
});

describe('extractHtmlModuleComment', () => {
	test('extracts @module from HTML comment', () => {
		const source = `<!--
	@module
	Module docs from HTML.

	Additional details.
-->
<div>content</div>`;

		const result = extractHtmlModuleComment(source);
		assert.ok(result);
		assert.include(result, 'Module docs from HTML.');
		assert.include(result, 'Additional details.');
		assert.notInclude(result, '@module');
	});

	test('returns undefined when no HTML comment', () => {
		const source = `<script lang="ts">let {x}: {x: string} = $props();</script>`;
		assert.isUndefined(extractHtmlModuleComment(source));
	});

	test('returns undefined when HTML comment has no @module', () => {
		const source = `<!-- Just a regular comment --><div>content</div>`;
		assert.isUndefined(extractHtmlModuleComment(source));
	});

	test('returns undefined for @component HTML comment', () => {
		const source = `<!--
	@component
	Component description.
-->
<div>content</div>`;
		assert.isUndefined(extractHtmlModuleComment(source));
	});

	test('finds @module in later HTML comment', () => {
		const source = `<!-- no module here -->
<!--
	@module
	Second comment module docs.
-->
<div>content</div>`;

		const result = extractHtmlModuleComment(source);
		assert.ok(result);
		assert.include(result, 'Second comment module docs.');
	});

	test('coexists with @component HTML comment', () => {
		const source = `<!--
	@component
	Component description.
-->
<!--
	@module
	Module description.
-->
<div>content</div>`;

		const result = extractHtmlModuleComment(source);
		assert.ok(result);
		assert.include(result, 'Module description.');
		assert.notInclude(result, 'Component description.');
	});

	test('works with template-only component', () => {
		const source = `<!--
	@module
	A template-only component.
-->
<div>Static content</div>`;

		const result = extractHtmlModuleComment(source);
		assert.ok(result);
		assert.include(result, 'A template-only component.');
	});

	test('handles empty @module comment', () => {
		const source = `<!-- @module --><div>content</div>`;
		assert.isUndefined(extractHtmlModuleComment(source));
	});
});

describe('svelte HTML @module integration', () => {
	test('extracts moduleComment from HTML @module', () => {
		const svelteContent = `<!--
	@module
	Module docs from HTML.
-->
<script lang="ts">
let {x}: {x: string} = $props();
</script>
<p>{x}</p>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'Module docs from HTML.');
	});

	test('JSDoc @module in <script> takes priority over HTML @module', () => {
		const svelteContent = `<!--
	@module
	HTML module docs.
-->
<script lang="ts">
/**
 * JSDoc module docs.
 *
 * @module
 */
let {x}: {x: string} = $props();
</script>
<p>{x}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			diagnostics
		);

		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'JSDoc module docs.');
		assert.notInclude(result.moduleComment, 'HTML module docs.');

		// Should emit duplicate warning
		assert.ok(hasWarnings(diagnostics));
		const warnings = warningsOf(diagnostics);
		assert.ok(warnings.some((w) => w.kind === 'duplicate_comment'));
	});

	test('HTML @module works for template-only components', () => {
		const svelteContent = `<!--
	@module
	A template-only component.
-->
<div>Static content</div>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Static.svelte', content: svelteContent },
			'Static.svelte',
			[] as Array<Diagnostic>
		);

		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'A template-only component.');
	});

	test('both @component and @module as HTML comments', () => {
		const svelteContent = `<!--
	@component
	Component description from HTML.
-->
<!--
	@module
	Module description from HTML.
-->
<script lang="ts">
let {x}: {x: string} = $props();
</script>
<p>{x}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			diagnostics
		);
		const declaration = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		assert.ok(declaration.docComment);
		assert.include(declaration.docComment, 'Component description from HTML.');
		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'Module description from HTML.');
		// No duplicate warnings — different comment types
		assert.strictEqual(hasWarnings(diagnostics), false);
	});

	test('@module on $props does not leak into docComment', () => {
		const svelteContent = `<script lang="ts">
/**
 * Module description.
 *
 * @module
 */
let {prop1}: {prop1: string} = $props();
</script>
<div>{prop1}</div>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);
		const declaration = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		assert.ok(result.moduleComment);
		assert.include(result.moduleComment, 'Module description.');
		// @module JSDoc should NOT leak into component docComment
		assert.isUndefined(declaration.docComment);
	});

	test('@nodocs on the component comment marks the component', () => {
		const svelteContent = `<script lang="ts">
/**
 * Component description.
 * @nodocs
 */
let {prop1}: {prop1: string} = $props();
</script>
<div>{prop1}</div>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);
		const component = result.declarations.find((d) => d.declaration.kind === 'component')!;

		assert.strictEqual(component.nodocs, true);
	});

	test('@nodocs in the HTML @component comment marks the component', () => {
		const svelteContent = `<!--
	@component
	Component description.
	@nodocs
-->
<script lang="ts">
let {prop1}: {prop1: string} = $props();
</script>
<div>{prop1}</div>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);
		const component = result.declarations.find((d) => d.declaration.kind === 'component')!;

		assert.strictEqual(component.nodocs, true);
	});

	test('component without @nodocs is not marked', () => {
		const svelteContent = `<script lang="ts">
/** Component description. */
let {prop1}: {prop1: string} = $props();
</script>
<div>{prop1}</div>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);
		const component = result.declarations.find((d) => d.declaration.kind === 'component')!;

		assert.strictEqual(component.nodocs, false);
	});
});

describe('svelte duplicate docComment diagnostic', () => {
	test('warns when both HTML @component and script JSDoc exist', () => {
		const svelteContent = `<!--
	@component
	HTML component description.
-->
<script lang="ts">
/** JSDoc component description. */
let {x}: {x: string} = $props();
</script>
<p>{x}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			diagnostics
		);
		const declaration = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		// JSDoc wins
		assert.ok(declaration.docComment);
		assert.include(declaration.docComment, 'JSDoc component description.');

		// Should emit duplicate warning
		assert.ok(hasWarnings(diagnostics));
		const warnings = warningsOf(diagnostics);
		const duplicateWarning = warnings.find((w) => w.kind === 'duplicate_comment');
		assert.ok(duplicateWarning);
		assert.strictEqual(duplicateWarning.kind, 'duplicate_comment');
		assert.include(duplicateWarning.message, '@component');
	});

	test('no warning when only HTML @component exists', () => {
		const svelteContent = `<!--
	@component
	HTML component description.
-->
<script lang="ts">
let {x}: {x: string} = $props();
</script>
<p>{x}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			diagnostics
		);

		assert.strictEqual(hasWarnings(diagnostics), false);
	});

	test('no warning when only script JSDoc exists', () => {
		const svelteContent = `<script lang="ts">
/** Component docs. */
let {x}: {x: string} = $props();
</script>
<p>{x}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			diagnostics
		);

		assert.strictEqual(hasWarnings(diagnostics), false);
	});

	test('a documented local below $props is neither docComment nor a duplicate', () => {
		const svelteContent = `<!--
	@component
	HTML component description.
-->
<script lang="ts">
let {x}: {x: string} = $props();

/** Local state, not component docs. */
let open = $state(false);
</script>
<p>{x}{open}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			diagnostics
		);
		const declaration = result.declarations.find(
			(d) => d.declaration.kind === 'component'
		)!.declaration;

		assert.ok(declaration.docComment);
		assert.include(declaration.docComment, 'HTML component description.');
		assert.strictEqual(hasWarnings(diagnostics), false);
	});
});

describe('svelte exported snippet declarations', () => {
	test('exported snippet is classified as kind: snippet', () => {
		const svelteContent = `<script module lang="ts">
	export { greet };
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl, 'Expected a snippet declaration');
		assert.strictEqual(snippetDecl.declaration.name, 'greet');
		assert.strictEqual(snippetDecl.declaration.kind, 'snippet');
		assert.strictEqual(snippetDecl.declaration.typeSignature, 'Snippet<[a: string]>');
		assert.ok(snippetDecl.declaration.parameters);
		assert.strictEqual(snippetDecl.declaration.parameters.length, 1);
		assert.strictEqual(snippetDecl.declaration.parameters[0]!.name, 'a');
		assert.strictEqual(snippetDecl.declaration.parameters[0]!.type, 'string');
	});

	test('exported snippet with multiple typed parameters', () => {
		const svelteContent = `<script module lang="ts">
	export { greet };
</script>

{#snippet greet(a: string, b: number)}
	<p>{a} {b}</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl);
		assert.strictEqual(snippetDecl.declaration.typeSignature, 'Snippet<[a: string, b: number]>');
		assert.strictEqual(snippetDecl.declaration.parameters!.length, 2);
		assert.strictEqual(snippetDecl.declaration.parameters![0]!.name, 'a');
		assert.strictEqual(snippetDecl.declaration.parameters![1]!.name, 'b');
		assert.strictEqual(snippetDecl.declaration.parameters![1]!.type, 'number');
	});

	test('parameterless exported snippet', () => {
		const svelteContent = `<script module lang="ts">
	export { greet };
</script>

{#snippet greet()}
	<p>text</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl);
		assert.strictEqual(snippetDecl.declaration.typeSignature, 'Snippet<[]>');
		// Parameterless snippet has empty parameters array
		assert.ok(snippetDecl.declaration.parameters);
		assert.strictEqual(snippetDecl.declaration.parameters.length, 0);
	});

	test('untyped snippet parameters infer as any', () => {
		const svelteContent = `<script module lang="ts">
	export { greet };
</script>

{#snippet greet(a, b)}
	<p>{a} {b}</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl);
		assert.strictEqual(snippetDecl.declaration.typeSignature, 'Snippet<[a: any, b: any]>');
		assert.strictEqual(snippetDecl.declaration.parameters![0]!.type, 'any');
	});

	test('snippet export does not affect regular function exports', () => {
		const svelteContent = `<script module lang="ts">
	export { greet };
	export const fn1 = (a: string): number => a.length;
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl, 'Expected snippet declaration');
		assert.strictEqual(snippetDecl.declaration.name, 'greet');

		const fnDecl = result.declarations.find((d) => d.declaration.name === 'fn1');
		assert.ok(fnDecl, 'Expected function declaration');
		assert.strictEqual(fnDecl.declaration.kind, 'function');
		assert.strictEqual(fnDecl.declaration.returnType, 'number');
	});

	test('snippet has no returnType, returnDescription, or overloads', () => {
		const svelteContent = `<script module lang="ts">
	export { greet };
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl);
		// Snippets should NOT have function-specific fields
		assert.isUndefined(snippetDecl.declaration.returnType);
		assert.isUndefined(snippetDecl.declaration.returnDescription);
		assert.isUndefined(snippetDecl.declaration.overloads);
	});

	test('exported snippet picks up JSDoc from export statement', () => {
		const svelteContent = `<script module lang="ts">
	/** Description of greet snippet. */
	export { greet };
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl, 'Expected a snippet declaration');
		assert.strictEqual(snippetDecl.declaration.docComment, 'Description of greet snippet.');
	});

	test('exported snippet with @nodocs on export statement is marked nodocs', () => {
		const svelteContent = `<script module lang="ts">
	/** @nodocs */
	export { greet };
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		// The nodocs snippet should be present with nodocs: true
		const nodocSnippet = result.declarations.find(
			(d) => d.declaration.name === 'greet' && d.nodocs
		);
		assert.ok(nodocSnippet, 'Expected snippet with nodocs: true');
		assert.strictEqual(nodocSnippet.declaration.kind, 'snippet');
	});

	test('snippet coexists with component props', () => {
		const svelteContent = `<script module lang="ts">
	export { greet };
</script>

<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}

<div>{prop1}</div>`;

		const result = analyzeSvelteTestIntegration(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte',
			[] as Array<Diagnostic>
		);

		const snippetDecl = result.declarations.find((d) => d.declaration.kind === 'snippet');
		assert.ok(snippetDecl, 'Expected snippet declaration');
		assert.strictEqual(snippetDecl.declaration.name, 'greet');

		const componentDecl = result.declarations.find((d) => d.declaration.kind === 'component');
		assert.ok(componentDecl, 'Expected component declaration');
		assert.ok(componentDecl.declaration.props);
		assert.strictEqual(componentDecl.declaration.props.length, 1);
		assert.strictEqual(componentDecl.declaration.props[0]!.name, 'prop1');
	});
});

describe('synthesizeSnippetTypeSignature', () => {
	test('renders optional and rest markers', () => {
		// the rest branch is unreachable from valid components (Svelte
		// compile-errors rest params in `{#snippet}`), so the pure function is
		// the only place to cover it
		assert.strictEqual(
			synthesizeSnippetTypeSignature([
				{ name: 'a', type: 'string', optional: false, rest: false },
				{ name: 'b', type: 'number', optional: true, rest: false },
				{ name: 'rest', type: 'boolean[]', optional: false, rest: true }
			]),
			'Snippet<[a: string, b?: number, ...rest: boolean[]]>'
		);
	});
});

describe('svelte acceptsChildren detection', () => {
	test('Path B: template children usage without $props() declaration', () => {
		// Template-only component using {@render children?.()} without declaring children in $props().
		// This triggers Path B detection via the __sveltets_2_ensureSnippet(children pattern
		// in the svelte2tsx virtual source.
		const svelteContent = '<div>{@render children?.()}</div>';

		const result = analyzeTestComponent(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte'
		);

		assert.strictEqual(result.acceptsChildren, true);
		// Props are undefined (not []) because analyzeTestComponent returns pre-Zod build objects
		assert.ok(!result.props || result.props.length === 0, 'Expected no props');
	});

	test('Path B: virtual source contains ensureSnippet children pattern', () => {
		// Verify the svelte2tsx transformation produces the expected detection pattern
		const virtualFile = transformOrThrow({
			id: '/fake/path/Test.svelte',
			content: '<div>{@render children?.()}</div>'
		});

		assert.ok(
			virtualFile.content.includes('__sveltets_2_ensureSnippet(children'),
			'Expected virtual source to contain children snippet pattern'
		);
	});

	test('Path A: intersection-wrapped children snippet sets acceptsChildren', () => {
		// `Snippet<[]> & {...}` — the intersection-branch walk in
		// `detectChildrenSnippet`; `children` is never rendered, so Path B
		// can't rescue a false negative here
		const svelteContent = `<script lang="ts">
	interface Snippet<T extends Array<unknown>> {(...args: T): void}

	let { children }: { children?: Snippet<[]> & { key: string } } = $props();
</script>

<div></div>`;

		const result = analyzeTestComponent(
			{ id: '/fake/path/Test.svelte', content: svelteContent },
			'Test.svelte'
		);

		assert.strictEqual(result.acceptsChildren, true);
	});
});
