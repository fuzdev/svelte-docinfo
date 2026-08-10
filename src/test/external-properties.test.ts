/**
 * Unit tests for `filterExternalProperties` — the partition of a type's
 * properties into local (kept as `members` / `props`) and external (dropped),
 * and the `externalTypes` labels naming what contributed the dropped ones.
 *
 * A multi-file program is what these need and what the fixture harnesses can't
 * give: `ts` fixtures are single-file, so nothing in one is ever external.
 * Behavior-level coverage lives in the `svelte/types/*` fixtures and
 * `analyze.props-cross-module.test.ts`.
 */

import { test, assert, describe } from 'vitest';

import { filterExternalProperties } from '$lib/typescript-extract-shared.ts';
import { extractTypeInfo } from '$lib/typescript-extract-type.ts';
import type { IsExternalFile } from '$lib/typescript-program.ts';
import { type Diagnostic } from '$lib/diagnostics.ts';
import type { DeclarationJsonBuild, MemberJsonBuild } from '$lib/declaration-build.ts';

import { createMultiFileProgram, findTypeAlias } from './fixtures/ts/ts-test-helpers.ts';
import { mockExtractContext } from './test-helpers.ts';

/**
 * Local convenience wrapper that returns the checker directly — the tests in
 * this file don't need the program object.
 */
const createProgram = (files: Array<{ path: string; content: string }>) => {
	const { program, sourceFiles } = createMultiFileProgram(files);
	return { checker: program.getTypeChecker(), sourceFiles };
};

/**
 * Run `extractTypeInfo` against a type alias and return the populated
 * declaration plus the diagnostic collector — convenience for tests that
 * need to assert on members + diagnostics.
 */
const runExtractTypeInfo = (
	files: Array<{ path: string; content: string }>,
	typeName: string,
	isExternal: IsExternalFile,
	containingFile = '/src/lib/test.ts'
): { declaration: DeclarationJsonBuild; diagnostics: Array<Diagnostic> } => {
	const { checker, sourceFiles } = createProgram(files);
	const sf = sourceFiles.get(containingFile)!;
	const alias = findTypeAlias(sf, checker, typeName)!;
	const declaration: DeclarationJsonBuild = { kind: 'type', name: typeName };
	const diagnostics: Array<Diagnostic> = [];
	extractTypeInfo(
		alias.node,
		declaration,
		mockExtractContext(checker, { diagnostics, isExternalFile: isExternal })
	);
	return { declaration, diagnostics };
};

const memberNames = (declaration: DeclarationJsonBuild): Array<string> =>
	(declaration.members ?? [])
		.map((m: MemberJsonBuild) => m.name ?? '')
		.filter((n): n is string => n !== '')
		.sort();

/**
 * Drive the filter with an alias's right-hand side as the annotation — the
 * same `(type, typeNode)` pair the Svelte props path passes, where a
 * `$props()` annotation is likewise a reference to a locally declared type.
 *
 * Shared by the descent describes below, which differ in what they compose,
 * not in how they ask.
 */
const runFilter = (
	files: Array<{ path: string; content: string }>,
	aliasName: string,
	isExternal: IsExternalFile
): { propNames: Array<string>; externalTypes: Array<string> } => {
	const { checker, sourceFiles } = createProgram(files);
	const sf = sourceFiles.get('/src/lib/test.ts')!;
	const alias = findTypeAlias(sf, checker, aliasName)!;
	const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
	return {
		propNames: result.properties.map((p) => p.name).sort(),
		externalTypes: result.externalTypes
	};
};

/** The external module the descent describes below compose against. */
const EXT = {
	path: '/src/lib/external/ext.ts',
	content: `
		export interface Ext { e1: string; e2?: number }
		export interface Ext2 { e3: boolean }
		export interface ExtChild extends Ext { e4: string }
		export interface ExtG<T> { attr?: T; other?: string }
		export interface ExtG2<T, U> { attr?: T; attr2?: U }
		export interface ExtIdx { [key: string]: number }
		export interface ExtBags { div: Ext; span: Ext2 }
		export default interface ExtDefault { d1: string }
	`
};

describe('filterExternalProperties', () => {
	test('keeps all properties for a local non-intersection type, no external types', () => {
		const { checker, sourceFiles } = createProgram([
			{ path: '/src/lib/test.ts', content: 'export type Foo = { a: string; b: number };' }
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Foo')!;

		const result = filterExternalProperties(alias.type, alias.node.type, checker, () => false);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['a', 'b']);
		assert.deepEqual(result.externalTypes, []);
	});

	test('keeps all properties when nothing is external', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/test.ts',
				content: `
					type A = { x: string };
					type B = { y: number };
					export type C = A & B;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'C')!;

		const result = filterExternalProperties(alias.type, alias.node.type, checker, () => false);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['x', 'y']);
		assert.deepEqual(result.externalTypes, []);
	});

	test('filters properties from external sources', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/external-types.ts',
				content: 'export type External = { ext1: string; ext2: number };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {External} from './external-types.js';
					type Own = { own1: string; own2: boolean };
					export type Combined = Own & External;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Combined')!;

		// treat external-types.ts as external
		const isExternal: IsExternalFile = (f) => f.fileName.includes('external-types');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['own1', 'own2']);
		assert.deepEqual(result.externalTypes, ['External']);
	});

	test('filters all properties when all branches are external', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext-a.ts',
				content: 'export type A = { x: string };'
			},
			{
				path: '/src/lib/ext-b.ts',
				content: 'export type B = { y: number };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {A} from './ext-a.js';
					import type {B} from './ext-b.js';
					export type Both = A & B;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Both')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext-');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		assert.deepEqual(result.properties, []);
		assert.deepEqual(result.externalTypes.sort(), ['A', 'B']);
	});

	test('predicate controls what counts as external', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/test.ts',
				content: `
					type A = { x: string };
					type B = { y: number };
					export type C = A & B;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'C')!;

		// everything is external
		const allExternal = filterExternalProperties(alias.type, alias.node.type, checker, () => true);
		assert.deepEqual(allExternal.properties, []);
		assert.deepEqual(allExternal.externalTypes.sort(), ['A', 'B']);

		// nothing is external
		const noneExternal = filterExternalProperties(
			alias.type,
			alias.node.type,
			checker,
			() => false
		);
		const propNames = noneExternal.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['x', 'y']);
		assert.deepEqual(noneExternal.externalTypes, []);
	});

	test('source root predicate pattern works', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/lib-types.ts',
				content: 'export type LibType = { lib1: string; lib2: number };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {LibType} from './lib-types.js';
					type Own = { own: boolean };
					export type Props = Own & LibType;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Props')!;

		// simulate production pattern: only test.ts is "internal"
		const isExternal: IsExternalFile = (f) => !f.fileName.endsWith('test.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(result.externalTypes, ['LibType']);
	});

	test('inline object literal branches produce no externalTypes entry', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: 'export type External = { ext: string };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {External} from './ext.js';
					export type Combined = { own: boolean } & External;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Combined')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['own']);
		// inline object literal is not a TypeReferenceNode, so no externalTypes entry for it
		assert.deepEqual(result.externalTypes, ['External']);
	});

	test('mixed intersection with some external branches', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext-a.ts',
				content: 'export type ExternalA = { ext: string };'
			},
			{
				path: '/src/lib/local-b.ts',
				content: 'export type LocalB = { local: number };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExternalA} from './ext-a.js';
					import type {LocalB} from './local-b.js';
					export type Mixed = ExternalA & LocalB & { own: boolean };
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Mixed')!;

		// only ext-a is external
		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext-');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['local', 'own']);
		// only ExternalA is fully external, LocalB is internal
		assert.deepEqual(result.externalTypes, ['ExternalA']);
	});

	test('three-way intersection with two external branches', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext-a.ts',
				content: 'export type ExtA = { ea: string };'
			},
			{
				path: '/src/lib/ext-b.ts',
				content: 'export type ExtB = { eb: number };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExtA} from './ext-a.js';
					import type {ExtB} from './ext-b.js';
					type Own = { own: boolean };
					export type Triple = Own & ExtA & ExtB;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Triple')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext-');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(result.externalTypes.sort(), ['ExtA', 'ExtB']);
	});

	test('synthesized properties (no declarations) are kept', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/test.ts',
				content: `
					type A = { x: string };
					type B = { y: number };
					export type C = A & B;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'C')!;

		// even with "everything external" predicate, synthesized props
		// without declarations are kept (isExternalProperty returns false for no decls)
		// In practice this is a safety net — most properties have declarations
		const result = filterExternalProperties(alias.type, alias.node.type, checker, () => true);
		// These properties DO have declarations (they come from the type alias literals),
		// so they ARE filtered when predicate says external
		assert.deepEqual(result.properties, []);
	});

	// Shapes that the previous intersection-only gate let slip through unfiltered.

	test('bare external reference: all members filtered, type surfaced', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: 'export type External = { ext1: string; ext2: number };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {External} from './ext.js';
					export type Bare = External;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Bare')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		assert.deepEqual(result.properties, []);
		assert.deepEqual(result.externalTypes, ['External']);
	});

	test('union of external references: each member surfaced', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: `
					export type ExtA = { shared: string; a: number };
					export type ExtB = { shared: string; b: boolean };
				`
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExtA, ExtB} from './ext.js';
					export type U = ExtA | ExtB;
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'U')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		// union exposes only the shared member, whose declarations are external
		assert.deepEqual(result.properties, []);
		assert.deepEqual(result.externalTypes, ['ExtA', 'ExtB']);
	});

	test('indexed-access into an external type is surfaced verbatim', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: 'export type Bag = { li: { a: string; b: number } };'
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {Bag} from './ext.js';
					export type Indexed = Bag['li'];
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Indexed')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		assert.deepEqual(result.properties, []);
		assert.deepEqual(result.externalTypes, ["Bag['li']"]);
	});

	test('intersection whose external branch is a union of references', () => {
		const { checker, sourceFiles } = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: `
					export type ExtA = { shared: string };
					export type ExtB = { shared: string };
				`
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExtA, ExtB} from './ext.js';
					export type Mixed = (ExtA | ExtB) & { own: boolean };
				`
			}
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Mixed')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(result.externalTypes, ['ExtA', 'ExtB']);
	});

	test('a local property redeclaring an external one is kept; external-only is dropped', () => {
		// Mirrors the common Svelte pattern of narrowing an inherited attribute, e.g.
		// `SvelteHTMLElements['button'] & { onclick: (e: CustomEvent) => void }`. When a
		// prop name appears on both an external branch and a local branch, TypeScript's
		// merged symbol carries the local declaration too, so `isExternalProperty`
		// (external only when *every* declaration is external) keeps it. `extOnly`
		// (declared solely on the external branch) is dropped; `Ext` is still summarized
		// in `externalTypes`. Order-independent — both branch orders behave the same.
		//
		// Caveat: an *incompatible* override whose property type collapses to `never`
		// (e.g. external `string` & local `boolean`) is dropped, not kept — the degenerate
		// type leaves the merged symbol with only the external declaration.
		const probe = (content: string) => {
			const { checker, sourceFiles } = createProgram([
				{
					path: '/src/lib/ext.ts',
					content: 'export type Ext = { shared: string; extOnly: number };'
				},
				{ path: '/src/lib/test.ts', content }
			]);
			const sf = sourceFiles.get('/src/lib/test.ts')!;
			const alias = findTypeAlias(sf, checker, 'C')!;
			const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');
			const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
			return {
				propNames: result.properties.map((p) => p.name).sort(),
				externalTypes: result.externalTypes
			};
		};

		const externalFirst = probe(`
			import type {Ext} from './ext.js';
			export type C = Ext & { shared: string };
		`);
		assert.deepEqual(externalFirst.propNames, ['shared']);
		assert.deepEqual(externalFirst.externalTypes, ['Ext']);

		const localFirst = probe(`
			import type {Ext} from './ext.js';
			export type C = { shared: string } & Ext;
		`);
		assert.deepEqual(localFirst.propNames, ['shared']);
		assert.deepEqual(localFirst.externalTypes, ['Ext']);
	});
});

describe('filterExternalProperties: composition behind a local name', () => {
	const isExternal: IsExternalFile = (f) => f.fileName.includes('/external/');

	test('interface heritage surfaces the external base, like an inline intersection', () => {
		// The community-standard Svelte props form. Inherited properties are
		// filtered out of `props` either way; before, nothing recorded why.
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						interface Props extends Ext { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('an attribute-forwarding interface records the base, not its own name', () => {
		// `interface Props extends Ext {}` has no local property, so the leaf
		// itself reads as wholly external — descending is what keeps the local
		// name out of a field that names external contributors.
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						interface Props extends Ext {}
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, []);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('multiple heritage entries surface in source order', () => {
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext, Ext2} from './external/ext.js';
						interface Props extends Ext2, Ext { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['Ext2', 'Ext']);
	});

	test('a local base contributes its own external heritage transitively', () => {
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						interface Base extends Ext { fromBase?: string }
						interface Props extends Base { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		// the local base's own property stays a property; only `Ext`'s are dropped
		assert.deepEqual(propNames, ['fromBase', 'own']);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('two branches over one base record it once', () => {
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						interface A extends Ext { a?: string }
						interface B extends Ext { b?: number }
						interface Props extends A, B { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('two branches through one local intermediate record it once, under the base name', () => {
		// Path-scoped visit tracking: `Mid` is released when its own walk ends, so
		// `B` reaches through it too. Were it tracked for the whole walk, `B`'s
		// descent would come back empty and `B` — wholly external, having no
		// property of its own — would fall back to emitting its own name.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						interface Mid extends Ext {}
						interface A extends Mid {}
						interface B extends Mid {}
						interface Props extends A, B { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('merged interface declarations each contribute', () => {
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext, Ext2} from './external/ext.js';
						interface Props extends Ext { a: string }
						interface Props extends Ext2 { b: string }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['a', 'b']);
		assert.deepEqual(externalTypes, ['Ext', 'Ext2']);
	});

	test('a local alias branch contributes the bag its definition composes', () => {
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type Base = Ext & { fromBase: string };
						export type P = Base & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['fromBase', 'own']);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('a local name whose definition the walk cannot traverse falls back to itself', () => {
		// A mapped type is not a composition node, so the descent comes back
		// empty — the name is then the only label available, and it is better
		// than dropping the record entirely.
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type Mapped = {[K in keyof Ext]: string};
						export type P = Mapped & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['Mapped']);
	});

	test('an external base chain is one entry — external declarations are never descended', () => {
		// `ExtChild extends Ext`, both external: the leaf reads as a single named
		// bag rather than leaking the definition behind it.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtChild} from './external/ext.js';
						export type P = ExtChild & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['ExtChild']);
	});

	test('an entirely local heritage chain contributes nothing', () => {
		const { propNames, externalTypes } = runFilter(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						interface Base { fromBase: string }
						interface Props extends Base { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['fromBase', 'own']);
		assert.deepEqual(externalTypes, []);
	});

	test('a local alias over a union of external bags contributes each branch', () => {
		// the component path passes union prop types through unchanged, so a
		// named union behind an imported alias must surface its branches like
		// the inline `(Ext | Ext2) & {…}` form does
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext, Ext2} from './external/ext.js';
						type U = Ext | Ext2;
						export type P = U & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['Ext', 'Ext2']);
	});

	test('a union branch with only an index signature is a contributor like a named bag', () => {
		// the leaf test counts declared contributions of any kind, so the
		// index-only branch surfaces beside the named one (union prop types
		// reach this walk through the component path)
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext, ExtIdx} from './external/ext.js';
						type U = Ext | ExtIdx;
						export type P = U & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['Ext', 'ExtIdx']);
	});

	test('a namespace-qualified heritage entry emits its qualified text', () => {
		// `import * as e` + `extends e.Ext` — the heritage expression is a
		// property access, not a bare identifier
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type * as e from './external/ext.js';
						interface Props extends e.Ext { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['e.Ext']);
	});

	test('a generic base substitutes the written argument into its heritage text', () => {
		// `ExtG<T>` is written in `A`'s scope — `T` alone resolves to nothing at
		// the documented site, so the descent binds it to the written argument
		// and the emitted entry is the instantiated form.
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtG} from './external/ext.js';
						interface A<T> extends ExtG<T> { fromBase?: string }
						interface Props extends A<string> { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['fromBase', 'own']);
		assert.deepEqual(externalTypes, ['ExtG<string>']);
	});

	test('an attribute-forwarding generic base records the substituted bag, not itself', () => {
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtG} from './external/ext.js';
						interface A<T> extends ExtG<T> {}
						interface Props extends A<string> { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['ExtG<string>']);
	});

	test('a generic base with mixed heritage substitutes and keeps both entries', () => {
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext, ExtG} from './external/ext.js';
						interface A<T> extends ExtG<T>, Ext { fromBase?: string }
						interface Props extends A<string> { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['ExtG<string>', 'Ext']);
	});

	test('a two-level generic chain substitutes through both boundaries', () => {
		// `B<string>` binds `U`, `A<U>` re-renders under that binding so `A`'s
		// own `T` binds to `string` by the time the leaf emits
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtG} from './external/ext.js';
						interface A<T> extends ExtG<T> {}
						interface B<U> extends A<U> {}
						export type P = B<string> & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['ExtG<string>']);
	});

	test('an omitted argument substitutes the declared default', () => {
		// `<T, U = T>` — the default renders under the bindings built so far,
		// so `U` follows `T`'s argument
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtG2} from './external/ext.js';
						interface A<T, U = T> extends ExtG2<T, U> {}
						interface Props extends A<string> { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['ExtG2<string, string>']);
	});

	test('one parameter referenced twice splices both occurrences', () => {
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtG2} from './external/ext.js';
						interface A<T> extends ExtG2<T, T> {}
						interface Props extends A<string> { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['ExtG2<string, string>']);
	});

	test('a rename inside a written argument resolves before splicing', () => {
		// the argument `E` is a local rename of `Ext` — rendered at its own
		// site first, the spliced text names the importable `Ext`
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext as E, ExtG} from './external/ext.js';
						interface A<T> extends ExtG<T> {}
						interface Props extends A<E> { own: boolean }
						export type P = Props;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['ExtG<Ext>']);
	});

	test('a generic mapped definition still degrades to the outermost instantiated name', () => {
		// the mapped right-hand side is deferred inside the generic definition —
		// not a composition node, nothing to test — so the descent comes back
		// empty and the outer reference, well-formed and wholly external at the
		// documented site, is what gets recorded. A known residual: the shape
		// behind the local generic utility is not recovered (the corpus form is
		// `Without<T, U> = Omit<T, keyof U>`).
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type Mask<T> = { [K in keyof T]: T[K] };
						export type P = Mask<Ext> & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['Mask<Ext>']);
	});

	test('a type parameter in scope at the documented site still emits', () => {
		// The guard is descent-scoped: `T` here belongs to the documented alias
		// itself (declared in `genericParams`), not to a declaration the walk
		// crossed, so `ExtG<T>` is meaningful and kept.
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtG} from './external/ext.js';
						export type P<T> = ExtG<T> & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['ExtG<T>']);
	});

	test('circular heritage terminates', () => {
		// TypeScript reports the circularity itself; extraction only has to not
		// walk it forever.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						interface A extends B, Ext { a: string }
						interface B extends A { b: string }
						export type P = A;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	/**
	 * A chain of distinct local aliases, each re-exporting the next, ending at
	 * the external bag. No cycle terminates it, so `MAX_COMPOSITION_DEPTH` is
	 * the only bound.
	 */
	const aliasChain = (length: number): Array<{ path: string; content: string }> =>
		Array.from({ length }, (_, i) => ({
			path: `/src/lib/a${i}.ts`,
			content:
				i === length - 1
					? `import type {Ext} from './external/ext.js';\nexport type A${i} = Ext;`
					: `import type {A${i + 1}} from './a${i + 1}.js';\nexport type A${i} = A${i + 1};`
		}));

	const chainHead = {
		path: '/src/lib/test.ts',
		content: `
			import type {A0} from './a0.js';
			export type P = A0 & { own: boolean };
		`
	};

	test('a long alias chain within the depth cap still reaches the bag', () => {
		const { propNames, externalTypes } = runFilter(
			[EXT, ...aliasChain(5), chainHead],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('past the depth cap the deepest reference reached is what gets recorded', () => {
		// `depth` counts declaration boundaries crossed, so `A11` — reached after
		// eleven crossings, one past `MAX_COMPOSITION_DEPTH` — is the first
		// reference not descended into. It is wholly external by property origin,
		// so it emits its own text: a *local* alias name from partway down the
		// chain, not the bag behind it. Membership is unaffected either way.
		const { propNames, externalTypes } = runFilter(
			[EXT, ...aliasChain(13), chainHead],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['A11']);
	});
});

/**
 * The descent collects text from *definition* sites, which spell imported
 * names however that file chose to. A name bound by an import rename there is
 * resolved back to the name its module exports, so an entry means the same
 * thing at the documented site as it did where it was written.
 */
describe('filterExternalProperties: import renames at the definition site', () => {
	const isExternal: IsExternalFile = (f) => f.fileName.includes('/external/');

	test('a renamed import records the exported name, not the local binding', () => {
		// `B` is bound only inside base.ts — at the documented site it names
		// nothing, so recording it would hand consumers a dangling identifier.
		const { propNames, externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/base.ts',
					content: `
						import type {Ext as B} from './external/ext.js';
						export interface Base extends B { own: boolean }
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Base} from './base.js';
						export type P = Base;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('one bag spelled two ways across two modules is one entry', () => {
		// Dedupe is by text, so without resolution the same contributor reads
		// as two.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/one.ts',
					content: `
						import type {Ext} from './external/ext.js';
						export interface One extends Ext { a: string }
					`
				},
				{
					path: '/src/lib/two.ts',
					content: `
						import type {Ext as B} from './external/ext.js';
						export interface Two extends B { b: string }
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {One} from './one.js';
						import type {Two} from './two.js';
						export type P = One & Two;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('a renamed generic keeps its written arguments', () => {
		// Substitution is textual and identifier-scoped, so the argument list
		// the definition site wrote survives intact.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/base.ts',
					content: `
						import type {ExtG as G} from './external/ext.js';
						export interface Base extends G<string> { own: boolean }
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Base} from './base.js';
						export type P = Base;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['ExtG<string>']);
	});

	test('a default import is left alone', () => {
		// The other end of a default import is the meaningless name `default`;
		// the local binding is the only usable spelling.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/base.ts',
					content: `
						import type D from './external/ext.js';
						export interface Base extends D { own: boolean }
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Base} from './base.js';
						export type P = Base;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['D']);
	});

	test('a local re-export chain keeps the name that module exports', () => {
		// `R` is what base.ts can import and what a reader can look up, so
		// resolving further — to the declaration's own `Ext` — would name
		// something `hop.ts` does not export.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/hop.ts',
					content: `export type {Ext as R} from './external/ext.js';`
				},
				{
					path: '/src/lib/base.ts',
					content: `
						import type {R} from './hop.js';
						export interface Base extends R { own: boolean }
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Base} from './base.js';
						export type P = Base;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['R']);
	});

	test('a rename written at the documented site itself resolves too', () => {
		// No descent involved — the leaf is the annotation. Consistent either
		// way, and the exported name is the one a reader can look up.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext as B} from './external/ext.js';
						export type P = B & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ['Ext']);
	});

	test('an indexed access under a renamed import keeps its written key', () => {
		// Substitution is identifier-scoped, so only the object name moves —
		// the index-access shape the field carries verbatim is untouched.
		const { externalTypes } = runFilter(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtBags as E} from './external/ext.js';
						export type P = E['div'] & { own: boolean };
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(externalTypes, ["ExtBags['div']"]);
	});

	test('two distinct bags sharing an exported name collapse to one entry', () => {
		// The cost of resolving renames: entries carry no module, so dedupe is by
		// name alone and two unrelated `Bag`s read as one contributor. Documented
		// on the schema — membership filtering is unaffected, both bags'
		// properties are dropped either way.
		const { propNames, externalTypes } = runFilter(
			[
				{ path: '/src/lib/external/one.ts', content: `export interface Bag { a: string }` },
				{ path: '/src/lib/external/two.ts', content: `export interface Bag { b: string }` },
				{
					path: '/src/lib/one.ts',
					content: `
						import type {Bag} from './external/one.js';
						export interface One extends Bag { o: string }
					`
				},
				{
					path: '/src/lib/two.ts',
					content: `
						import type {Bag as B} from './external/two.js';
						export interface Two extends B { t: string }
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {One} from './one.js';
						import type {Two} from './two.js';
						export type P = One & Two;
					`
				}
			],
			'P',
			isExternal
		);
		assert.deepEqual(propNames, ['o', 't']);
		assert.deepEqual(externalTypes, ['Bag']);
	});
});

describe('extractTypeInfo: index-signature filtering on intersections', () => {
	const isExternal: IsExternalFile = (sf) => sf.fileName.includes('/external/');

	test('external branch contributing only an index sig is dropped from members', () => {
		// Local intersection branch has its own named props; external branch is
		// pure index-sig (Record-shaped). The external string-index sig should
		// NOT appear on the local type's members.
		const { declaration } = runExtractTypeInfo(
			[
				{
					path: '/src/lib/external/ext.ts',
					content: 'export type Ext = { [key: string]: number };'
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type A = { a: string; b: number };
						export type C = A & Ext;
					`
				}
			],
			'C',
			isExternal
		);

		assert.deepEqual(memberNames(declaration), ['a', 'b']);
		assert.ok(
			!declaration.members?.some((m) => m.name === '[key: string]'),
			'external string index sig must not leak onto local type'
		);
		// the dropped index signature is attributable: a branch whose declared
		// contributions are wholly external is surfaced even with zero named
		// properties
		assert.deepEqual(declaration.externalTypes, ['Ext']);
	});

	test('external branch with named props + index sig (HTMLAttributes-shaped) — both filtered', () => {
		// External branch has both named props and a string index sig. Named
		// props go to `externalTypes`; the index sig is filtered out.
		const { declaration } = runExtractTypeInfo(
			[
				{
					path: '/src/lib/external/ext.ts',
					content: `
						export type Ext = {
							ext1: string;
							ext2: number;
							[key: \`data-\${string}\`]: string;
							[key: string]: unknown;
						};
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type A = { a: string };
						export type C = A & Ext;
					`
				}
			],
			'C',
			isExternal
		);

		assert.deepEqual(memberNames(declaration), ['a']);
		assert.deepEqual(declaration.externalTypes, ['Ext']);
		assert.ok(
			!declaration.members?.some((m) => m.name === '[key: string]'),
			'external string index sig must not leak through HTMLAttributes-shaped branches'
		);
	});

	test('local branch with own index sig wins over external branch with index sig', () => {
		// Both branches contribute string index sigs; the local one is kept,
		// external one is filtered.
		const { declaration } = runExtractTypeInfo(
			[
				{
					path: '/src/lib/external/ext.ts',
					content: 'export type Ext = { [key: string]: boolean };'
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type A = { a: string; [key: string]: number | string };
						export type C = A & Ext;
					`
				}
			],
			'C',
			isExternal
		);

		const stringIndex = declaration.members?.find((m) => m.name === '[key: string]');
		assert.ok(stringIndex, 'local string index sig should be emitted');
		// The local branch has `[key: string]: number | string` — `a: string` widens
		// the value type. We just verify it's NOT the external `boolean`.
		assert.notMatch(stringIndex.typeSignature ?? '', /boolean/);
		// the dropped external index sig is attributable even with zero named props
		assert.deepEqual(declaration.externalTypes, ['Ext']);
	});

	test('non-intersection types still emit their own index signatures', () => {
		// Regression guard: the filter only kicks in for intersections. A
		// plain Record-like type alias should still surface its index sig.
		const { declaration } = runExtractTypeInfo(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						export type R = {
							a: string;
							[key: string]: string | number;
							[key: number]: boolean;
						};
					`
				}
			],
			'R',
			isExternal
		);

		const names = memberNames(declaration);
		assert.ok(names.includes('a'), 'named property kept');
		assert.ok(names.includes('[key: string]'), 'string index sig kept');
		assert.ok(names.includes('[key: number]'), 'number index sig kept');
		assert.deepEqual(declaration.externalTypes, undefined);
	});
});
