/**
 * Tests for the two diagnostics added by the api-review #3 P3 work:
 *
 * - `misplaced_tag` — symbol-scope JSDoc tag (`@example`, `@deprecated`,
 *   `@since`, `@see`, `@throws`, `@mutates`) found on a non-primary overload
 *   signature. The primary signature's JSDoc feeds the parent declaration's
 *   symbol-level extraction; tags on non-primary overloads would silently drop
 *   from output. This warning surfaces them so authors can move the tag.
 *
 * - `unknown_param` — `@param` key that doesn't reference a real parameter on
 *   the signature being documented. Catches typos (`@param argz` for `args`)
 *   and stale doc after a rename. The description is dropped (status quo);
 *   the diagnostic surfaces the drop without halting analysis.
 *
 * Also locks in the fold-in fix: per-overload `@param` descriptions now flow
 * through to that overload's `parameters[i].description` (they were silently
 * dropped before this work).
 */

import {join} from 'node:path';
import {describe, test, assert} from 'vitest';

import {analyze} from '$lib/analyze.js';
import {byKind, type Diagnostic} from '$lib/diagnostics.js';
import type {SourceFileInfo} from '$lib/source.js';
import {createSourceOptions} from '$lib/source-config.js';

import {withTestProject} from './test-helpers.js';

const createSourceFiles = (
	projectRoot: string,
	files: Record<string, string>,
): Array<SourceFileInfo> =>
	Object.entries(files).map(([path, content]) => ({
		id: join(projectRoot, path),
		content,
	}));

const setup = (projectRoot: string, files: Record<string, string>) => ({
	sourceFiles: createSourceFiles(projectRoot, files),
	sourceOptions: createSourceOptions(projectRoot),
});

const misplaced = (d: Array<Diagnostic>) => byKind(d, 'misplaced_tag');
const unknownParam = (d: Array<Diagnostic>) => byKind(d, 'unknown_param');

describe('overload diagnostics', {timeout: 15_000}, () => {
	describe('misplaced_tag — symbol-scope tag on non-primary overload', () => {
		test('symbol-scope tag on the primary (first) overload flows to parent and emits no diagnostic', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * Description.
 * @example fn('a')
 */
export function fn(a: string): string;
export function fn(a: number): number;
export function fn(a: string | number): string | number { return a; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));
				assert.deepStrictEqual(misplaced(diagnostics), []);

				const fn = modules.find((m) => m.path === 'fn.ts')?.declarations[0];
				assert.ok(fn && fn.kind === 'function');
				assert.deepStrictEqual(fn.examples, ["fn('a')"]);
			});
		});

		test('symbol-scope tag on a non-primary overload emits one warning per misplaced tag and the tag is dropped', async () => {
			const files = {
				'src/lib/fn.ts': `
/** Description. */
export function fn(a: string): string;
/**
 * Number form.
 * @example fn(42)
 * @since 1.0.0
 */
export function fn(a: number): number;
export function fn(a: string | number): string | number { return a; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));

				const warnings = misplaced(diagnostics);
				assert.strictEqual(warnings.length, 2, 'two misplaced tags → two warnings');
				const tagNames = warnings.map((w) => w.tagName).sort();
				assert.deepStrictEqual(tagNames, ['example', 'since']);
				for (const w of warnings) {
					assert.strictEqual(w.severity, 'warning');
					assert.strictEqual(w.functionName, 'fn');
					assert.match(w.message, /non-primary overload of "fn"/);
				}

				// Output: parent has no @example/@since (the misplaced tags didn't reach it),
				// and overloads[1] doesn't carry them either (signature-distinct fields only).
				// Note: examples is `.default([])` in the schema, so absence parses as `[]`.
				const fn = modules.find((m) => m.path === 'fn.ts')?.declarations[0];
				assert.ok(fn && fn.kind === 'function');
				assert.deepStrictEqual(fn.examples, []);
				assert.strictEqual(fn.since, undefined);
			});
		});

		test('signature-distinct tags (@param, @returns) on non-primary overloads flow to that overload — no diagnostic', async () => {
			const files = {
				'src/lib/fn.ts': `
/** Description. */
export function fn(a: string): string;
/**
 * Number form.
 * @param a - the number form param
 * @returns the doubled number
 */
export function fn(a: number): number;
export function fn(a: string | number): string | number { return a; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));
				assert.deepStrictEqual(misplaced(diagnostics), []);
				assert.deepStrictEqual(unknownParam(diagnostics), []);

				const fn = modules.find((m) => m.path === 'fn.ts')?.declarations[0];
				assert.ok(fn && fn.kind === 'function');
				assert.ok(fn.overloads);
				const second = fn.overloads[1];
				assert.ok(second);
				assert.strictEqual(second.docComment, 'Number form.');
				assert.strictEqual(second.returnDescription, 'the doubled number');
				assert.strictEqual(second.parameters[0]?.description, 'the number form param');
			});
		});

		test('class method overloads flag misplaced tags too', async () => {
			const files = {
				'src/lib/cls.ts': `
export class A {
	/** Description. */
	fn(a: string): string;
	/** @example obj.fn(42) */
	fn(a: number): number;
	fn(a: string | number): string | number { return a; }
}
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {diagnostics} = await analyze(setup(projectRoot, files));
				const warnings = misplaced(diagnostics);
				assert.strictEqual(warnings.length, 1);
				assert.strictEqual(warnings[0]?.tagName, 'example');
				assert.strictEqual(warnings[0]?.functionName, 'fn');
			});
		});

		test('@default and @nodocs on a non-primary overload emit misplaced_tag', async () => {
			const files = {
				'src/lib/fn.ts': `
/** Description. */
export function fn(a: string): string;
/**
 * Number form.
 * @default 0
 * @nodocs
 */
export function fn(a: number): number;
export function fn(a: string | number): string | number { return a; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {diagnostics} = await analyze(setup(projectRoot, files));
				const warnings = misplaced(diagnostics);
				const tagNames = warnings.map((w) => w.tagName).sort();
				assert.deepStrictEqual(tagNames, ['default', 'nodocs']);
				for (const w of warnings) {
					assert.strictEqual(w.severity, 'warning');
					assert.strictEqual(w.functionName, 'fn');
				}
			});
		});
	});

	describe('per-overload @param descriptions flow through (signature-scope, not symbol-scope)', () => {
		test('each overload carries its own @param descriptions', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * Description.
 * @param a - primary form
 */
export function fn(a: string): string;
/** @param a - number form */
export function fn(a: number): number;
export function fn(a: string | number): string | number { return a; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));
				assert.deepStrictEqual(misplaced(diagnostics), []);
				assert.deepStrictEqual(unknownParam(diagnostics), []);

				const fn = modules.find((m) => m.path === 'fn.ts')?.declarations[0];
				assert.ok(fn && fn.kind === 'function' && fn.overloads);
				assert.strictEqual(fn.overloads[0]?.parameters[0]?.description, 'primary form');
				assert.strictEqual(fn.overloads[1]?.parameters[0]?.description, 'number form');
			});
		});

		test('each overload carries its own object-property @param descriptions', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * Description.
 * @param o - primary
 * @param o.a - primary a
 */
export function fn(o: {a: string}): string;
/**
 * @param o - secondary
 * @param o.b - secondary b
 */
export function fn(o: {b: number}): number;
export function fn(o: {a: string} | {b: number}): string | number {
	return 'a' in o ? o.a : o.b;
}
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));
				assert.deepStrictEqual(misplaced(diagnostics), []);
				assert.deepStrictEqual(unknownParam(diagnostics), []);

				const fn = modules.find((m) => m.path === 'fn.ts')?.declarations[0];
				assert.ok(fn && fn.kind === 'function' && fn.overloads);
				// each overload sources propertyDescriptions from its own JSDoc only,
				// never bleeding from the parent or the sibling overload
				assert.deepStrictEqual(fn.overloads[0]?.parameters[0]?.propertyDescriptions, {
					a: 'primary a',
				});
				assert.deepStrictEqual(fn.overloads[1]?.parameters[0]?.propertyDescriptions, {
					b: 'secondary b',
				});
			});
		});
	});

	describe('unknown_param — @param key with no matching parameter', () => {
		test('typo on a non-overloaded function emits one warning; description is dropped', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * Description.
 * @param argz - typo for "a"
 */
export function fn(a: string): string { return a; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));

				const warnings = unknownParam(diagnostics);
				assert.strictEqual(warnings.length, 1);
				assert.strictEqual(warnings[0]?.paramName, 'argz');
				assert.strictEqual(warnings[0]?.functionName, 'fn');
				assert.strictEqual(warnings[0]?.severity, 'warning');
				assert.match(warnings[0]?.message ?? '', /typo or stale doc/);

				const fn = modules.find((m) => m.path === 'fn.ts')?.declarations[0];
				assert.ok(fn && fn.kind === 'function');
				assert.strictEqual(fn.parameters[0]?.description, undefined);
			});
		});

		test('typo on an overload emits a warning for that overload', async () => {
			const files = {
				'src/lib/fn.ts': `
/** Description. */
export function fn(a: string): string;
/** @param wrong - typo */
export function fn(a: number): number;
export function fn(a: string | number): string | number { return a; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {diagnostics} = await analyze(setup(projectRoot, files));
				const warnings = unknownParam(diagnostics);
				assert.strictEqual(warnings.length, 1);
				assert.strictEqual(warnings[0]?.paramName, 'wrong');
				assert.strictEqual(warnings[0]?.functionName, 'fn');
			});
		});

		test('correct @param keys produce no unknown_param warnings', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * Description.
 * @param a - first
 * @param b - second
 */
export function fn(a: string, b: number): string { return a + b; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {diagnostics} = await analyze(setup(projectRoot, files));
				assert.deepStrictEqual(unknownParam(diagnostics), []);
			});
		});

		test('dotted @param keys for object-parameter properties produce no warnings', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * Description.
 * @param ctx - the context object
 * @param ctx.node - parent node
 * @param ctx.kindLabel - label
 */
export function fn(ctx: {node: string; kindLabel: string}): string { return ctx.kindLabel; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {diagnostics} = await analyze(setup(projectRoot, files));
				assert.deepStrictEqual(unknownParam(diagnostics), []);
			});
		});

		test('dotted @param descriptions surface as propertyDescriptions on the parameter', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * Description.
 * @param ctx - the context object
 * @param ctx.node - parent node
 * @param ctx.nested.deep - a deeply nested property
 */
export function fn(ctx: {node: string; nested: {deep: boolean}}): string { return ctx.node; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));
				assert.deepStrictEqual(unknownParam(diagnostics), []);
				const decl = modules[0]?.declarations[0];
				assert(decl?.kind === 'function');
				const param = decl.parameters[0];
				assert(param);
				assert.strictEqual(param.name, 'ctx');
				assert.strictEqual(param.description, 'the context object');
				assert.deepStrictEqual(param.propertyDescriptions, {
					node: 'parent node',
					'nested.deep': 'a deeply nested property',
				});
			});
		});

		test('dotted @param on a destructured parameter is not matched (known limitation)', async () => {
			// TypeScript names destructured params `__0`, so a `@param options.a` key
			// has no parameter name to match — propertyDescriptions stays empty and
			// the dotted key (and its bare root) emit unknown_param. Lock-in so the
			// "named object params only" docs can't silently drift.
			const files = {
				'src/lib/fn.ts': `
/**
 * @param options - the options
 * @param options.a - the a value
 */
export function fn({a, b}: {a: string; b: number}): string { return a + String(b); }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {modules, diagnostics} = await analyze(setup(projectRoot, files));
				const decl = modules[0]?.declarations[0];
				assert(decl?.kind === 'function');
				const param = decl.parameters[0];
				assert(param);
				assert.strictEqual(param.name, '__0');
				assert.strictEqual(param.propertyDescriptions, undefined);
				assert.deepStrictEqual(
					unknownParam(diagnostics)
						.map((d) => d.paramName)
						.sort(),
					['options', 'options.a'],
				);
			});
		});

		test('dotted @param key whose root is not a real parameter emits a warning', async () => {
			const files = {
				'src/lib/fn.ts': `
/**
 * @param wrong.node - root "wrong" is not a parameter
 */
export function fn(ctx: {node: string}): string { return ctx.node; }
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {diagnostics} = await analyze(setup(projectRoot, files));
				const warnings = unknownParam(diagnostics);
				assert.strictEqual(warnings.length, 1);
				assert.strictEqual(warnings[0]?.paramName, 'wrong.node');
				assert.strictEqual(warnings[0]?.functionName, 'fn');
			});
		});

		test('typo on a class method emits a warning', async () => {
			const files = {
				'src/lib/cls.ts': `
export class A {
	/**
	 * @param argz - typo
	 */
	fn(a: string): string { return a; }
}
`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {diagnostics} = await analyze(setup(projectRoot, files));
				const warnings = unknownParam(diagnostics);
				assert.strictEqual(warnings.length, 1);
				assert.strictEqual(warnings[0]?.paramName, 'argz');
				assert.strictEqual(warnings[0]?.functionName, 'fn');
			});
		});
	});
});
