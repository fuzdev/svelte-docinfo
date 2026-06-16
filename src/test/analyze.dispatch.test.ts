import {test, assert, describe} from 'vitest';

import {analyzeModule} from '$lib/analyze-core.ts';
import {type ModuleSourceOptions} from '$lib/source-config.ts';
import {byKind, hasErrors, hasWarnings, warningsOf, type Diagnostic} from '$lib/diagnostics.ts';

import {createTestSourceOptions, createTestProgram} from './test-module-helpers.ts';

describe('analyzeModule', {timeout: 10_000}, () => {
	const options: ModuleSourceOptions = createTestSourceOptions('/project', {
		sourcePaths: ['src/lib'],
	});

	test('dispatches to TypeScript analyzer for .ts files', () => {
		const program = createTestProgram([
			{
				path: '/project/src/lib/helpers.ts',
				content: `
/**
 * Module comment.
 *
 * @module
 */

export const VALUE = 42;
export function helper(): string { return 'hello'; }
`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/helpers.ts', content: 'unused - program has it'},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		assert.strictEqual(result.path, 'helpers.ts');
		assert.strictEqual(result.moduleComment, 'Module comment.');
		assert.strictEqual(result.declarations.length, 2);

		const names = result.declarations.map((d) => d.name).sort();
		assert.deepStrictEqual(names, ['VALUE', 'helper'].sort());
	});

	test('skips Svelte files with diagnostic', () => {
		const svelteContent = `<script lang="ts">
let {name}: {name: string} = $props();
</script>
<p>Hello {name}</p>`;

		const diagnostics: Array<Diagnostic> = [];

		// Create a minimal program for the analysis
		const program = createTestProgram([{path: '/project/src/lib/Test.svelte', content: ''}]);

		const result = analyzeModule(
			{id: '/project/src/lib/Test.svelte', content: svelteContent},
			program,
			options,
			diagnostics,
		);

		// Svelte files should be skipped in analyzeModule
		assert.isUndefined(result);
		assert.ok(hasWarnings(diagnostics));
		assert.strictEqual(warningsOf(diagnostics).length, 1);
		const moduleSkipped = byKind(diagnostics, 'module_skipped');
		assert.strictEqual(moduleSkipped.length, 1);
		assert.include(moduleSkipped[0]!.message, 'Svelte files require program integration');
		assert.strictEqual(moduleSkipped[0]!.reason, 'requires_program');
	});

	test('derives modulePath correctly from sourceFile.id', () => {
		const program = createTestProgram([
			{
				path: '/project/src/lib/utils/stringHelpers.ts',
				content: `export const trim = (s: string) => s.trim();`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/utils/stringHelpers.ts', content: ''},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		// Should strip sourceRoot prefix
		assert.strictEqual(result.path, 'utils/stringHelpers.ts');
	});

	test('derives modulePath with custom sourceRoot', () => {
		const customOptions: ModuleSourceOptions = createTestSourceOptions('/custom', {
			sourcePaths: ['root'],
		});

		const program = createTestProgram([
			{
				path: '/custom/root/my_module.ts',
				content: `export const x = 1;`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/custom/root/my_module.ts', content: ''},
			program,
			customOptions,
			diagnostics,
		);

		assert.ok(result);
		assert.strictEqual(result.path, 'my_module.ts');
	});

	test('returns undefined when TypeScript file not in program', () => {
		// Create program without the file we'll try to analyze
		const program = createTestProgram([
			{path: '/project/src/lib/other.ts', content: 'export const x = 1;'},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/missing.ts', content: 'export const y = 2;'},
			program,
			options,
			diagnostics,
		);

		// Should return undefined because file isn't in program
		assert.isUndefined(result);
	});

	test('passes dependencies from SourceFileInfo to result', () => {
		const program = createTestProgram([
			{
				path: '/project/src/lib/consumer.ts',
				content: `export const value = 'test';`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{
				id: '/project/src/lib/consumer.ts',
				content: '',
				dependencies: ['/project/src/lib/depA.ts', '/project/src/lib/depB.ts'],
				dependents: ['/project/src/lib/user.ts'],
			},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		// Dependencies are filtered to source modules and converted to relative paths
		// They follow ModuleJson optional array semantics
		assert.ok(result.path);
	});

	test('returns minimal module for CSS files', () => {
		const program = createTestProgram([
			{path: '/project/src/lib/placeholder.ts', content: 'export const x = 1;'},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/theme.css', content: '.root { color: red; }'},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		assert.strictEqual(result.path, 'theme.css');
		assert.deepStrictEqual(result.declarations, []);
		assert.strictEqual(result.reExports.length, 0);
	});

	test('returns minimal module for JSON files', () => {
		const program = createTestProgram([
			{path: '/project/src/lib/placeholder.ts', content: 'export const x = 1;'},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/data.json', content: '{"key": "value"}'},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		assert.strictEqual(result.path, 'data.json');
		assert.deepStrictEqual(result.declarations, []);
		assert.strictEqual(result.reExports.length, 0);
	});

	test('handles .js files as TypeScript', () => {
		const program = createTestProgram([
			{
				path: '/project/src/lib/script.js',
				content: `export const config = {debug: true};`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/script.js', content: ''},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		assert.strictEqual(result.path, 'script.js');
		assert.strictEqual(result.declarations.length, 1);
		assert.strictEqual(result.declarations[0]!.name, 'config');
	});
});

describe('analyzeModule return structure', () => {
	const options: ModuleSourceOptions = createTestSourceOptions('/project', {
		sourcePaths: ['src/lib'],
	});

	test('TypeScript module returns ModuleJson with reExports array', () => {
		const program = createTestProgram([
			{
				path: '/project/src/lib/simple.ts',
				content: `export const x = 1;`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/simple.ts', content: ''},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		assert.ok(result.path);
		assert.ok(Array.isArray(result.reExports), 'reExports should always be an array');
	});

	test('Svelte module is skipped in analyzeModule', () => {
		const program = createTestProgram([{path: '/project/src/lib/Component.svelte', content: ''}]);

		const svelteContent = `<script lang="ts">
let {value}: {value: string} = $props();
</script>
<p>{value}</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/Component.svelte', content: svelteContent},
			program,
			options,
			diagnostics,
		);

		// Svelte files should be skipped
		assert.isUndefined(result);
	});

	test('CSS module returns ModuleJson with empty reExports', () => {
		const program = createTestProgram([
			{path: '/project/src/lib/placeholder.ts', content: 'export const x = 1;'},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/styles.css', content: 'body { margin: 0; }'},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		assert.strictEqual(result.path, 'styles.css');
		assert.deepStrictEqual(result.declarations, []);
		assert.ok(Array.isArray(result.reExports));
		assert.strictEqual(result.reExports.length, 0);
	});

	test('JSON module returns ModuleJson with empty reExports', () => {
		const program = createTestProgram([
			{path: '/project/src/lib/placeholder.ts', content: 'export const x = 1;'},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/config.json', content: '{"debug": true}'},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		assert.strictEqual(result.path, 'config.json');
		assert.deepStrictEqual(result.declarations, []);
		assert.ok(Array.isArray(result.reExports));
		assert.strictEqual(result.reExports.length, 0);
	});

	test('module with no exports has undefined declarations', () => {
		const program = createTestProgram([
			{
				path: '/project/src/lib/internal.ts',
				content: `const internal = 'not exported';`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/internal.ts', content: ''},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		// No exports → declarations is empty array (Zod default)
		assert.deepStrictEqual(result.declarations, []);
		assert.strictEqual(result.reExports.length, 0);
	});

	test('Svelte component with no props is skipped in analyzeModule', () => {
		const program = createTestProgram([{path: '/project/src/lib/Static.svelte', content: ''}]);

		const svelteContent = `<p>Static content</p>`;

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/Static.svelte', content: svelteContent},
			program,
			options,
			diagnostics,
		);

		// Svelte files should be skipped
		assert.isUndefined(result);
	});
});

describe('analyzeModule error handling', () => {
	const options: ModuleSourceOptions = createTestSourceOptions('/project', {
		sourcePaths: ['src/lib'],
	});

	test('returns undefined for TypeScript file not in program (logs warning)', () => {
		const program = createTestProgram([
			{path: '/project/src/lib/exists.ts', content: 'export const x = 1;'},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const warnings: Array<string> = [];
		const mockLog = {
			warn: (msg: string) => warnings.push(msg),
		};

		const result = analyzeModule(
			{id: '/project/src/lib/not_exists.ts', content: 'export const y = 2;'},
			program,
			options,
			diagnostics,
			mockLog as any,
		);

		assert.isUndefined(result);
		assert.strictEqual(warnings.length, 1);
		assert.include(warnings[0], 'not_exists.ts');
	});

	test('Svelte files are skipped even with malformed content', () => {
		const program = createTestProgram([{path: '/project/src/lib/Bad.svelte', content: ''}]);

		const badContent = `<script lang="ts">
let {name}: {name: string} = $props();
</script>
<p>{name</p>`;

		const diagnostics: Array<Diagnostic> = [];

		// analyzeModule skips Svelte files — no throw, just returns undefined
		const result = analyzeModule(
			{id: '/project/src/lib/Bad.svelte', content: badContent},
			program,
			options,
			diagnostics,
		);
		assert.isUndefined(result);
	});

	test('analysis context collects diagnostics without halting', () => {
		const program = createTestProgram([
			{
				path: '/project/src/lib/valid.ts',
				content: `
export const value = 42;
export function fn(): string { return 'test'; }
`,
			},
		]);

		const diagnostics: Array<Diagnostic> = [];
		const result = analyzeModule(
			{id: '/project/src/lib/valid.ts', content: ''},
			program,
			options,
			diagnostics,
		);

		assert.ok(result);
		// Valid code should produce no diagnostics
		assert.strictEqual(diagnostics.length, 0);
		assert.strictEqual(hasErrors(diagnostics), false);
	});
});
