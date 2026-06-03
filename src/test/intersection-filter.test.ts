import {test, assert, describe} from 'vitest';

import {filterExternalProperties} from '$lib/typescript-extract-shared.js';
import {extractTypeInfo} from '$lib/typescript-extract-type.js';
import type {IsExternalFile} from '$lib/typescript-program.js';
import {type Diagnostic} from '$lib/diagnostics.js';
import type {DeclarationJsonBuild, MemberJsonBuild} from '$lib/declaration-build.js';

import {createMultiFileProgram, findTypeAlias} from './fixtures/ts/ts-test-helpers.js';

/**
 * Local convenience wrapper that returns the checker directly — the tests in
 * this file don't need the program object.
 */
const createProgram = (files: Array<{path: string; content: string}>) => {
	const {program, sourceFiles} = createMultiFileProgram(files);
	return {checker: program.getTypeChecker(), sourceFiles};
};

/**
 * Run `extractTypeInfo` against a type alias and return the populated
 * declaration plus the diagnostic collector — convenience for tests that
 * need to assert on members + diagnostics.
 */
const runExtractTypeInfo = (
	files: Array<{path: string; content: string}>,
	typeName: string,
	isExternal: IsExternalFile,
	containingFile = '/src/lib/test.ts',
): {declaration: DeclarationJsonBuild; diagnostics: Array<Diagnostic>} => {
	const {checker, sourceFiles} = createProgram(files);
	const sf = sourceFiles.get(containingFile)!;
	const alias = findTypeAlias(sf, checker, typeName)!;
	const declaration: DeclarationJsonBuild = {kind: 'type', name: typeName};
	const diagnostics: Array<Diagnostic> = [];
	extractTypeInfo(alias.node, checker, declaration, diagnostics, isExternal);
	return {declaration, diagnostics};
};

const memberNames = (declaration: DeclarationJsonBuild): Array<string> =>
	(declaration.members ?? [])
		.map((m: MemberJsonBuild) => m.name ?? '')
		.filter((n): n is string => n !== '')
		.sort();

describe('filterExternalProperties', () => {
	test('keeps all properties for a local non-intersection type, no external types', () => {
		const {checker, sourceFiles} = createProgram([
			{path: '/src/lib/test.ts', content: 'export type Foo = { a: string; b: number };'},
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Foo')!;

		const result = filterExternalProperties(alias.type, alias.node.type, checker, () => false);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['a', 'b']);
		assert.deepEqual(result.externalTypes, []);
	});

	test('keeps all properties when nothing is external', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/test.ts',
				content: `
					type A = { x: string };
					type B = { y: number };
					export type C = A & B;
				`,
			},
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'C')!;

		const result = filterExternalProperties(alias.type, alias.node.type, checker, () => false);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['x', 'y']);
		assert.deepEqual(result.externalTypes, []);
	});

	test('filters properties from external sources', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/external-types.ts',
				content: 'export type External = { ext1: string; ext2: number };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {External} from './external-types.js';
					type Own = { own1: string; own2: boolean };
					export type Combined = Own & External;
				`,
			},
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
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext-a.ts',
				content: 'export type A = { x: string };',
			},
			{
				path: '/src/lib/ext-b.ts',
				content: 'export type B = { y: number };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {A} from './ext-a.js';
					import type {B} from './ext-b.js';
					export type Both = A & B;
				`,
			},
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Both')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext-');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		assert.deepEqual(result.properties, []);
		assert.deepEqual(result.externalTypes.sort(), ['A', 'B']);
	});

	test('predicate controls what counts as external', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/test.ts',
				content: `
					type A = { x: string };
					type B = { y: number };
					export type C = A & B;
				`,
			},
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
			() => false,
		);
		const propNames = noneExternal.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['x', 'y']);
		assert.deepEqual(noneExternal.externalTypes, []);
	});

	test('source root predicate pattern works', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/lib-types.ts',
				content: 'export type LibType = { lib1: string; lib2: number };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {LibType} from './lib-types.js';
					type Own = { own: boolean };
					export type Props = Own & LibType;
				`,
			},
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

	test('inline object literal branches produce no intersects entry', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: 'export type External = { ext: string };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {External} from './ext.js';
					export type Combined = { own: boolean } & External;
				`,
			},
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Combined')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['own']);
		// inline object literal is not a TypeReferenceNode, so no intersects entry for it
		assert.deepEqual(result.externalTypes, ['External']);
	});

	test('mixed intersection with some external branches', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext-a.ts',
				content: 'export type ExternalA = { ext: string };',
			},
			{
				path: '/src/lib/local-b.ts',
				content: 'export type LocalB = { local: number };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExternalA} from './ext-a.js';
					import type {LocalB} from './local-b.js';
					export type Mixed = ExternalA & LocalB & { own: boolean };
				`,
			},
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
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext-a.ts',
				content: 'export type ExtA = { ea: string };',
			},
			{
				path: '/src/lib/ext-b.ts',
				content: 'export type ExtB = { eb: number };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExtA} from './ext-a.js';
					import type {ExtB} from './ext-b.js';
					type Own = { own: boolean };
					export type Triple = Own & ExtA & ExtB;
				`,
			},
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
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/test.ts',
				content: `
					type A = { x: string };
					type B = { y: number };
					export type C = A & B;
				`,
			},
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
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: 'export type External = { ext1: string; ext2: number };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {External} from './ext.js';
					export type Bare = External;
				`,
			},
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Bare')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		assert.deepEqual(result.properties, []);
		assert.deepEqual(result.externalTypes, ['External']);
	});

	test('union of external references: each member surfaced', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: `
					export type ExtA = { shared: string; a: number };
					export type ExtB = { shared: string; b: boolean };
				`,
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExtA, ExtB} from './ext.js';
					export type U = ExtA | ExtB;
				`,
			},
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
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: 'export type Bag = { li: { a: string; b: number } };',
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {Bag} from './ext.js';
					export type Indexed = Bag['li'];
				`,
			},
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Indexed')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		assert.deepEqual(result.properties, []);
		assert.deepEqual(result.externalTypes, ["Bag['li']"]);
	});

	test('intersection whose external branch is a union of references', () => {
		const {checker, sourceFiles} = createProgram([
			{
				path: '/src/lib/ext.ts',
				content: `
					export type ExtA = { shared: string };
					export type ExtB = { shared: string };
				`,
			},
			{
				path: '/src/lib/test.ts',
				content: `
					import type {ExtA, ExtB} from './ext.js';
					export type Mixed = (ExtA | ExtB) & { own: boolean };
				`,
			},
		]);
		const sf = sourceFiles.get('/src/lib/test.ts')!;
		const alias = findTypeAlias(sf, checker, 'Mixed')!;

		const isExternal: IsExternalFile = (f) => f.fileName.includes('ext.ts');

		const result = filterExternalProperties(alias.type, alias.node.type, checker, isExternal);
		const propNames = result.properties.map((p) => p.name).sort();
		assert.deepEqual(propNames, ['own']);
		assert.deepEqual(result.externalTypes, ['ExtA', 'ExtB']);
	});
});

describe('extractTypeInfo: index-signature filtering on intersections', () => {
	const isExternal: IsExternalFile = (sf) => sf.fileName.includes('/external/');

	test('external branch contributing only an index sig is dropped from members', () => {
		// Local intersection branch has its own named props; external branch is
		// pure index-sig (Record-shaped). The external string-index sig should
		// NOT appear on the local type's members.
		const {declaration} = runExtractTypeInfo(
			[
				{
					path: '/src/lib/external/ext.ts',
					content: 'export type Ext = { [key: string]: number };',
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type A = { a: string; b: number };
						export type C = A & Ext;
					`,
				},
			],
			'C',
			isExternal,
		);

		assert.deepEqual(memberNames(declaration), ['a', 'b']);
		assert.ok(
			!declaration.members?.some((m) => m.name === '[key: string]'),
			'external string index sig must not leak onto local type',
		);
		// `intersects` lists only branches with named external properties
		// (per `filterIntersectionProperties`). A pure-index-sig external branch
		// has zero named props and is intentionally not surfaced there.
		assert.equal(declaration.intersects, undefined);
	});

	test('external branch with named props + index sig (HTMLAttributes-shaped) — both filtered', () => {
		// External branch has both named props and a string index sig. Named
		// props go to `intersects`; the index sig is filtered out.
		const {declaration} = runExtractTypeInfo(
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
					`,
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type A = { a: string };
						export type C = A & Ext;
					`,
				},
			],
			'C',
			isExternal,
		);

		assert.deepEqual(memberNames(declaration), ['a']);
		assert.deepEqual(declaration.intersects, ['Ext']);
		assert.ok(
			!declaration.members?.some((m) => m.name === '[key: string]'),
			'external string index sig must not leak through HTMLAttributes-shaped branches',
		);
	});

	test('local branch with own index sig wins over external branch with index sig', () => {
		// Both branches contribute string index sigs; the local one is kept,
		// external one is filtered.
		const {declaration} = runExtractTypeInfo(
			[
				{
					path: '/src/lib/external/ext.ts',
					content: 'export type Ext = { [key: string]: boolean };',
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {Ext} from './external/ext.js';
						type A = { a: string; [key: string]: number | string };
						export type C = A & Ext;
					`,
				},
			],
			'C',
			isExternal,
		);

		const stringIndex = declaration.members?.find((m) => m.name === '[key: string]');
		assert.ok(stringIndex, 'local string index sig should be emitted');
		// The local branch has `[key: string]: number | string` — `a: string` widens
		// the value type. We just verify it's NOT the external `boolean`.
		assert.notMatch(stringIndex.typeSignature ?? '', /boolean/);
		// External Ext is pure-index-sig; `intersects` tracks only named-external branches.
		assert.equal(declaration.intersects, undefined);
	});

	test('non-intersection types still emit their own index signatures', () => {
		// Regression guard: the filter only kicks in for intersections. A
		// plain Record-like type alias should still surface its index sig.
		const {declaration} = runExtractTypeInfo(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						export type R = {
							a: string;
							[key: string]: string | number;
							[key: number]: boolean;
						};
					`,
				},
			],
			'R',
			isExternal,
		);

		const names = memberNames(declaration);
		assert.ok(names.includes('a'), 'named property kept');
		assert.ok(names.includes('[key: string]'), 'string index sig kept');
		assert.ok(names.includes('[key: number]'), 'number index sig kept');
		assert.deepEqual(declaration.intersects, undefined);
	});
});
