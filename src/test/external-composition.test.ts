/**
 * Unit tests for the external-composition model — membership by declaration
 * origin at every granularity (named properties, index signatures,
 * call/construct signatures; roots, branches, and inheritance alike) and the
 * `externalTypes` attribution that pairs with it, including the heritage walk
 * on interfaces and classes.
 *
 * A multi-file program is what these need and what the fixture harnesses can't
 * give: `ts` fixtures are single-file, so nothing in one is ever external.
 * `external-properties.test.ts` covers the label walk's descent mechanics;
 * this file locks the membership/attribution contract across declaration
 * kinds.
 */

import { test, assert, describe } from 'vitest';
import ts from 'typescript';

import { extractTypeInfo } from '$lib/typescript-extract-type.ts';
import { extractClassInfo } from '$lib/typescript-extract-class.ts';
import type { IsExternalFile } from '$lib/typescript-program.ts';
import { type Diagnostic } from '$lib/diagnostics.ts';
import type { DeclarationJsonBuild } from '$lib/declaration-build.ts';

import { createMultiFileProgram } from './fixtures/ts/ts-test-helpers.ts';
import { mockExtractContext } from './test-helpers.ts';

const isExternal: IsExternalFile = (f) => f.fileName.includes('/external/');

/** The external module the compositions below reach. */
const EXT = {
	path: '/src/lib/external/ext.ts',
	content: `
		export interface ExtNamed { x: string; y: number }
		export interface ExtIndexOnly { [key: string]: number }
		export interface ExtCallable { (): string }
		export interface ExtCtor { new (): { z: number } }
		export interface ExtMixed { x: string; [key: string]: unknown }
		export interface ExtGen<T> { attr?: T }
		export class ExtBase { p = 1; m(): void {} }
		export declare class ExtGBase<T> { attr: T }
	`
};

const findNode = <
	T extends ts.TypeAliasDeclaration | ts.InterfaceDeclaration | ts.ClassDeclaration
>(
	sourceFile: ts.SourceFile,
	name: string,
	guard: (n: ts.Node) => n is T
): T => {
	const found = sourceFile.statements.find(
		(s): s is T & ts.Statement => guard(s) && s.name?.text === name
	);
	if (!found) throw new Error(`declaration not found: ${name}`);
	return found;
};

/** Run `extractTypeInfo` against a type alias or interface by name. */
const run = <T extends ts.TypeAliasDeclaration | ts.InterfaceDeclaration>(
	files: Array<{ path: string; content: string }>,
	name: string,
	guard: (n: ts.Node) => n is T
): { declaration: DeclarationJsonBuild; diagnostics: Array<Diagnostic> } => {
	const { program, sourceFiles } = createMultiFileProgram(files);
	const checker = program.getTypeChecker();
	const node = findNode(sourceFiles.get('/src/lib/test.ts')!, name, guard);
	const declaration: DeclarationJsonBuild = {
		kind: ts.isInterfaceDeclaration(node) ? 'interface' : 'type',
		name
	};
	const diagnostics: Array<Diagnostic> = [];
	extractTypeInfo(
		node,
		declaration,
		mockExtractContext(checker, { diagnostics, isExternalFile: isExternal })
	);
	return { declaration, diagnostics };
};

/** Run `extractClassInfo` against a class by name. */
const runClass = (
	files: Array<{ path: string; content: string }>,
	name: string
): { declaration: DeclarationJsonBuild } => {
	const { program, sourceFiles } = createMultiFileProgram(files);
	const checker = program.getTypeChecker();
	const node = findNode(sourceFiles.get('/src/lib/test.ts')!, name, ts.isClassDeclaration);
	const declaration: DeclarationJsonBuild = { kind: 'class', name };
	extractClassInfo(node, declaration, mockExtractContext(checker, { isExternalFile: isExternal }));
	return { declaration };
};

const memberNames = (declaration: DeclarationJsonBuild): Array<string> =>
	(declaration.members ?? []).map((m) => m.name ?? '').filter((n) => n !== '');

describe('call/construct signature membership by declaration origin', () => {
	test('an external branch’s call signature is dropped and attributed', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtCallable} from './external/ext.js';
						export type C = ExtCallable & { a: string };
					`
				}
			],
			'C',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a']);
		assert.deepEqual(declaration.externalTypes, ['ExtCallable']);
	});

	test('an external branch’s construct signature is dropped and attributed', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtCtor} from './external/ext.js';
						export type C = ExtCtor & { a: string };
					`
				}
			],
			'C',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a']);
		assert.deepEqual(declaration.externalTypes, ['ExtCtor']);
	});

	test('a local callable branch keeps its call signature beside an external one', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtCallable} from './external/ext.js';
						interface LocalCallable { (n: number): boolean }
						export type C = ExtCallable & LocalCallable;
					`
				}
			],
			'C',
			ts.isTypeAliasDeclaration
		);
		const call = declaration.members?.find((m) => m.name === '(call)');
		assert.ok(call, 'local call signature should be kept');
		// the kept signature is the local one, not the external `(): string`
		assert.match(call.typeSignature ?? '', /number/);
		assert.deepEqual(declaration.externalTypes, ['ExtCallable']);
	});

	test('a bare external callable root is dropped and attributed', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtCallable} from './external/ext.js';
						export type C = ExtCallable;
					`
				}
			],
			'C',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), []);
		assert.deepEqual(declaration.externalTypes, ['ExtCallable']);
	});
});

describe('index signature membership by declaration origin', () => {
	test('a bare external index-only root is dropped and attributed', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtIndexOnly} from './external/ext.js';
						export type P = ExtIndexOnly;
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), []);
		assert.deepEqual(declaration.externalTypes, ['ExtIndexOnly']);
	});

	test('a bare external mixed root drops both halves together', () => {
		// named props and the index sig disagreed before: props filtered, index
		// sig emitted — now both drop by the one rule and the label covers both
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtMixed} from './external/ext.js';
						export type P = ExtMixed;
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), []);
		assert.deepEqual(declaration.externalTypes, ['ExtMixed']);
	});

	test('a hand-written mapped root keeps its declaration-less index sig', () => {
		const { declaration } = run(
			[
				{
					path: '/src/lib/test.ts',
					content: `export type P = { [K in string]: number };`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['[key: string]']);
	});

	test('a homomorphic instantiation over an external source keeps the synthesized index sig', () => {
		// the checker re-derives the info with no declaration, so fail-open
		// keeps it — a documented residual beside the dropped named props
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtMixed} from './external/ext.js';
						type Mask<T> = { [K in keyof T]: T[K] };
						export type P = Mask<ExtMixed>;
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['[key: string]']);
	});

	test('an index sig inherited through a local base is dropped and attributed', () => {
		// the old branch test was node-level: `LocalBase` is declared locally,
		// so the inherited external info leaked through it
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtIndexOnly} from './external/ext.js';
						interface LocalBase extends ExtIndexOnly {}
						export type C = LocalBase & { a: string };
					`
				}
			],
			'C',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a']);
		assert.deepEqual(declaration.externalTypes, ['ExtIndexOnly']);
	});

	test('same-kind index sigs in one intersection keep the local constituent’s own info', () => {
		// merging two same-kind sigs loses the declaration, so the constituents
		// are tested individually — the local one wins with its own value type
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtIndexOnly} from './external/ext.js';
						interface LocalIndexed { [key: string]: string }
						export type C = ExtIndexOnly & LocalIndexed;
					`
				}
			],
			'C',
			ts.isTypeAliasDeclaration
		);
		const index = declaration.members?.find((m) => m.name === '[key: string]');
		assert.ok(index, 'local index sig should be kept');
		assert.strictEqual(index.typeSignature, 'string');
		assert.deepEqual(declaration.externalTypes, ['ExtIndexOnly']);
	});
});

describe('interface members are own-only, call/construct signatures included', () => {
	test('an inherited external call signature is not enumerated, and is attributed', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtCallable} from './external/ext.js';
						export interface I extends ExtCallable { a: string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a']);
		assert.deepEqual(declaration.externalTypes, ['ExtCallable']);
	});

	test('an inherited local call signature is not enumerated either', () => {
		// own-only is the interface charter, not an externality rule: inherited
		// local props aren't enumerated, so an inherited local `(call)` isn't
		// the one exception — `extends` points at the base, documented at its
		// own declaration
		const { declaration } = run(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						interface LocalCallable { (): string }
						export interface I extends LocalCallable { a: string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a']);
		assert.strictEqual(declaration.externalTypes, undefined);
	});

	test('own call and construct signatures stay enumerated', () => {
		const { declaration } = run(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						export interface I {
							(): string;
							new (): { z: number };
							a: string;
						}
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a', '(call)', '(construct)']);
	});

	test('a merged block’s call signature is own', () => {
		// "own" is any declaration of the interface symbol, not the one node
		// being processed — a second `interface I` block in the same file
		// contributes its signature
		const { declaration } = run(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						export interface I { a: string }
						export interface I { (): string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.ok(
			declaration.members?.some((m) => m.name === '(call)'),
			'merged block call signature should be own'
		);
	});
});

describe('interface externalTypes from heritage', () => {
	test('a direct external base is recorded beside verbatim extends', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						export interface I extends ExtNamed { a: string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(declaration.extends, ['ExtNamed']);
		assert.deepEqual(declaration.externalTypes, ['ExtNamed']);
		assert.deepEqual(memberNames(declaration), ['a']);
	});

	test('a bag behind a local base is recorded transitively', () => {
		// `extends` dead-ends at the possibly-unexported local name; the field
		// answers what the component annotated with this interface is told
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						interface LocalBase extends ExtNamed { fromBase?: boolean }
						export interface I extends LocalBase { a: string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(declaration.extends, ['LocalBase']);
		assert.deepEqual(declaration.externalTypes, ['ExtNamed']);
	});

	test('a generic external base substitutes the written argument', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtGen} from './external/ext.js';
						interface Mid<T> extends ExtGen<T> {}
						export interface I extends Mid<string> { a: string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(declaration.externalTypes, ['ExtGen<string>']);
	});

	test('an all-local heritage records nothing', () => {
		const { declaration } = run(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						interface LocalBase { fromBase?: boolean }
						export interface I extends LocalBase { a: string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(declaration.extends, ['LocalBase']);
		assert.strictEqual(declaration.externalTypes, undefined);
	});

	test('multiple heritage entries contribute in source order', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed, ExtIndexOnly} from './external/ext.js';
						interface LocalBase extends ExtIndexOnly { fromBase?: boolean }
						export interface I extends ExtNamed, LocalBase { a: string }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(declaration.extends, ['ExtNamed', 'LocalBase']);
		assert.deepEqual(declaration.externalTypes, ['ExtNamed', 'ExtIndexOnly']);
	});

	test('the field is heritage-only — a member’s external type records nothing', () => {
		// a property whose type is external is enumerated with that type on the
		// member itself; nothing is hidden, so nothing needs attribution
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						export interface I { a: ExtNamed }
					`
				}
			],
			'I',
			ts.isInterfaceDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a']);
		assert.strictEqual(declaration.externalTypes, undefined);
	});
});

describe('class externalTypes from the extends chain', () => {
	test('a direct external base class is recorded beside verbatim extends', () => {
		const { declaration } = runClass(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import {ExtBase} from './external/ext.js';
						export class C extends ExtBase { own = true }
					`
				}
			],
			'C'
		);
		assert.strictEqual(declaration.extends, 'ExtBase');
		assert.deepEqual(declaration.externalTypes, ['ExtBase']);
		assert.deepEqual(memberNames(declaration), ['own']);
	});

	test('an external base behind a local base class is recorded transitively', () => {
		const { declaration } = runClass(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import {ExtBase} from './external/ext.js';
						class Mid extends ExtBase { fromMid = 1 }
						export class C extends Mid { own = true }
					`
				}
			],
			'C'
		);
		assert.strictEqual(declaration.extends, 'Mid');
		assert.deepEqual(declaration.externalTypes, ['ExtBase']);
	});

	test('a generic local base class substitutes the written argument', () => {
		const { declaration } = runClass(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import {ExtGBase} from './external/ext.js';
						class Mid<T> extends ExtGBase<T> { fromMid = 1 }
						export class C extends Mid<string> { own = true }
					`
				}
			],
			'C'
		);
		assert.deepEqual(declaration.externalTypes, ['ExtGBase<string>']);
	});

	test('implements contributes nothing', () => {
		// an implemented interface adds no members — the class declares its own
		const { declaration } = runClass(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						export class C implements ExtNamed { x = ''; y = 0 }
					`
				}
			],
			'C'
		);
		assert.deepEqual(declaration.implements, ['ExtNamed']);
		assert.strictEqual(declaration.externalTypes, undefined);
	});

	test('an all-local extends chain records nothing', () => {
		const { declaration } = runClass(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						class Base { fromBase = 1 }
						export class C extends Base { own = true }
					`
				}
			],
			'C'
		);
		assert.strictEqual(declaration.extends, 'Base');
		assert.strictEqual(declaration.externalTypes, undefined);
	});
});

describe('local generic instantiations extract members', () => {
	test('a local generic interface instantiation emits instantiated members', () => {
		const { declaration } = run(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						interface LocalGen<T> { a: T; b?: number }
						export type X = LocalGen<string>;
					`
				}
			],
			'X',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a', 'b']);
		const a = declaration.members?.find((m) => m.name === 'a');
		assert.strictEqual(a?.typeSignature, 'string');
	});

	test('a local generic base reaching an external bag keeps members and attribution', () => {
		// one type parameter used to erase the whole declaration: the
		// Reference-flagged gate returned before members or labels ran
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						interface LocalGen2<T> extends ExtNamed { a: T }
						export type Z = LocalGen2<string>;
					`
				}
			],
			'Z',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['a']);
		assert.deepEqual(declaration.externalTypes, ['ExtNamed']);
	});

	test('an external generic instantiation stays gated', () => {
		// the Array<T>/Promise<T> rule: an external target's prototype surface
		// is not the author's shape — membership stays empty, the reference is
		// wholly external and labels itself
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtGen} from './external/ext.js';
						export type X = ExtGen<string>;
					`
				}
			],
			'X',
			ts.isTypeAliasDeclaration
		);
		assert.strictEqual(declaration.members, undefined);
	});
});

describe('indexed access over a local container descends to the property', () => {
	test('a wholly external property type records the bag, not the container', () => {
		// the leaf fallback used to emit `LocalMap['a']` — a project-local,
		// possibly-unexported name — into the external-contributors field
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						interface LocalMap { a: ExtNamed }
						export type P = LocalMap['a'];
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), []);
		assert.deepEqual(declaration.externalTypes, ['ExtNamed']);
	});

	test('a mixed property type records the external branch instead of dropping silently', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						interface LocalMap { a: ExtNamed & { loc: string } }
						export type P = LocalMap['a'];
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), ['loc']);
		assert.deepEqual(declaration.externalTypes, ['ExtNamed']);
	});

	test('a numeric-literal index descends like a string one', () => {
		const { declaration } = run(
			[
				EXT,
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtNamed} from './external/ext.js';
						interface LocalMap { 0: ExtNamed }
						export type P = LocalMap[0];
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), []);
		assert.deepEqual(declaration.externalTypes, ['ExtNamed']);
	});

	test('an external container keeps its written index-access entry', () => {
		// the `SvelteHTMLElements['li']` shape: the external container is never
		// descended, the written access is the right single entry
		const { declaration } = run(
			[
				{
					path: '/src/lib/external/ext.ts',
					content: `
						export interface ExtNamed { x: string; y: number }
						export interface ExtMapHolder { div: ExtNamed }
					`
				},
				{
					path: '/src/lib/test.ts',
					content: `
						import type {ExtMapHolder} from './external/ext.js';
						export type P = ExtMapHolder['div'];
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.deepEqual(memberNames(declaration), []);
		assert.deepEqual(declaration.externalTypes, ["ExtMapHolder['div']"]);
	});

	test('a self-referential container annotation terminates', () => {
		// the property's annotation reaches its own indexed access again as a
		// direct branch — the walk holds the property declaration on the path,
		// so the revisit is skipped instead of recursing forever. Completion is
		// the assertion; nothing external is reached. (TypeScript reports the
		// circularity itself; extraction only has to not walk it forever.)
		const { declaration } = run(
			[
				{
					path: '/src/lib/test.ts',
					content: `
						interface L { a: L['a'] & { x: string } }
						export type P = L['a'] & { own: boolean };
					`
				}
			],
			'P',
			ts.isTypeAliasDeclaration
		);
		assert.strictEqual(declaration.externalTypes, undefined);
	});
});
