/**
 * Tests for union member order in `typeInfo` trees: members follow the written
 * union (the alias declaration's right-hand side for a non-generic aliased
 * union, else the annotation at the site), with nullish members last, while
 * the flat strings keep the checker's order.
 *
 * The checker's own order is type-creation order, so every test analyzes its
 * subject beside `a.ts`, which sorts first and interns the literals in reverse.
 * Each test asserts the scrambled flat string too, proving the tree's order
 * comes from the written node and not from a creation order that happened to
 * match. Fixture lock-in: `ts/types/union-written-order`.
 */

import { test, assert, describe } from 'vitest';

import { typeJsonToText } from '#lib/declaration-helpers.ts';
import type { DeclarationJson, TypeJson } from '#lib/types.ts';

import { analyzeTestProject } from './test-module-helpers.ts';

/** Interns `'d'`, `'c'`, `'b'`, `'a'`, `'x'` in that order before `b.ts` runs (`a.ts` sorts first). */
const SCRAMBLE = `export type Z = 'd' | 'c' | 'b' | 'a' | 'x';`;

/** Analyze `content` as `src/lib/b.ts` beside the scrambling `a.ts`, returning `b.ts`'s declarations. */
const analyzeScrambled = async (content: string): Promise<Array<DeclarationJson>> => {
	const { modules } = await analyzeTestProject({
		'src/lib/a.ts': SCRAMBLE,
		'src/lib/b.ts': content
	});
	const module = modules.find((m) => m.path === 'b.ts');
	assert.ok(module, 'expected the b.ts module');
	return module.declarations;
};

const findDeclaration = (declarations: Array<DeclarationJson>, name: string): DeclarationJson => {
	const declaration = declarations.find((d) => d.name === name);
	assert.ok(declaration, `expected a declaration named ${name}`);
	return declaration;
};

/** The rendered text of each member of a union node (an alias-carrying sub-union renders as its name). */
const memberTexts = (node: TypeJson | undefined): Array<string> => {
	assert(node?.kind === 'union', `expected a union node, got ${JSON.stringify(node)}`);
	return node.members.map(typeJsonToText);
};

/** A variable declaration's flat string and tree. */
const variable = (
	declarations: Array<DeclarationJson>,
	name: string
): { typeSignature?: string; typeInfo?: TypeJson } => {
	const declaration = findDeclaration(declarations, name);
	assert(declaration.kind === 'variable', `expected ${name} to be a variable`);
	return declaration;
};

describe('union members in written order', () => {
	test('a site annotation orders the tree, the flat string keeps the checker order', async () => {
		const declarations = await analyzeScrambled(`export const a: 'a' | 'b' | 'c' | 'd' = 'a';`);
		const { typeSignature, typeInfo } = variable(declarations, 'a');
		assert.strictEqual(typeSignature, '"d" | "c" | "b" | "a"');
		assert.deepStrictEqual(memberTexts(typeInfo), ['"a"', '"b"', '"c"', '"d"']);
	});

	test('an aliased union takes its declaration order at every use, inferred ones included', async () => {
		const declarations = await analyzeScrambled(`export type A = 'a' | 'b' | 'c';
const x = 'a' as A;
export const fn = () => x;`);
		const alias = findDeclaration(declarations, 'A');
		assert(alias.kind === 'type');
		assert.deepStrictEqual(memberTexts(alias.typeInfo), ['"a"', '"b"', '"c"']);
		const fn = findDeclaration(declarations, 'fn');
		assert(fn.kind === 'function');
		// no annotation at the return: the alias declaration supplies the order
		assert.strictEqual(fn.returnType, 'A');
		assert.deepStrictEqual(memberTexts(fn.returnTypeInfo), ['"a"', '"b"', '"c"']);
	});

	test('duplicate written members place once, at their first appearance', async () => {
		const declarations = await analyzeScrambled(`export const a: 'a' | 'b' | 'a' | 'c' = 'a';`);
		const { typeSignature, typeInfo } = variable(declarations, 'a');
		assert.strictEqual(typeSignature, '"c" | "b" | "a"');
		assert.deepStrictEqual(memberTexts(typeInfo), ['"a"', '"b"', '"c"']);
	});

	test('written members the checker reduced away are skipped, the rest keep written order', async () => {
		// `'c'` and `'b'` reduce into `string`, leaving `string | number`
		const declarations = await analyzeScrambled(`export const a: number | 'c' | string | 'b' = 1;`);
		const { typeSignature, typeInfo } = variable(declarations, 'a');
		assert.strictEqual(typeSignature, 'string | number');
		assert.deepStrictEqual(memberTexts(typeInfo), ['number', 'string']);
	});

	test('a written `boolean` keeps its position and collapses', async () => {
		const declarations = await analyzeScrambled(`export const a: 'a' | boolean | 'b' = 'a';`);
		const { typeSignature, typeInfo } = variable(declarations, 'a');
		assert.strictEqual(typeSignature, 'boolean | "b" | "a"');
		assert.deepStrictEqual(memberTexts(typeInfo), ['"a"', 'boolean', '"b"']);
	});

	test('an optional `null`-bearing union keeps written order with `null` last', async () => {
		const declarations = await analyzeScrambled(`export interface O {
	a?: 'a' | null | 'b';
	b?: 'a' | 'b';
}`);
		const o = findDeclaration(declarations, 'O');
		assert(o.kind === 'interface');
		const [a, b] = o.members;
		assert(a?.kind === 'variable' && b?.kind === 'variable');
		assert.strictEqual(a.typeSignature, '"b" | "a" | null');
		assert.deepStrictEqual(memberTexts(a.typeInfo), ['"a"', '"b"', 'null']);
		assert.strictEqual(b.typeSignature, '"b" | "a"');
		assert.deepStrictEqual(memberTexts(b.typeInfo), ['"a"', '"b"']);
	});

	test('tuple elements and type arguments take their written order', async () => {
		const declarations = await analyzeScrambled(`interface M<T> {
	a: T;
}
export const fn = (a: ['a' | 'b', ('c' | 'd')?]): M<'a' | 'b'> => ({ a: a[0] });`);
		const fn = findDeclaration(declarations, 'fn');
		assert(fn.kind === 'function');
		const param = fn.parameters[0];
		assert.ok(param);
		assert.strictEqual(param.type, '["b" | "a", ("d" | "c" | undefined)?]');
		assert.strictEqual(
			param.typeInfo && typeJsonToText(param.typeInfo),
			'["a" | "b", ("c" | "d")?]'
		);
		assert.strictEqual(fn.returnType, 'M<"b" | "a">');
		assert.strictEqual(fn.returnTypeInfo && typeJsonToText(fn.returnTypeInfo), 'M<"a" | "b">');
	});

	test('a generic alias instantiation falls back to the checker order', async () => {
		// the instantiation has no written union of its own, and the alias
		// declaration's members are not the instantiation's (`T` is replaced)
		const declarations = await analyzeScrambled(`export type G<T> = T | 'a' | 'b';
export const a: G<'c'> = 'c';`);
		const g = findDeclaration(declarations, 'G');
		assert(g.kind === 'type');
		// at its own declaration the right-hand side is the site annotation
		assert.deepStrictEqual(memberTexts(g.typeInfo), ['T', '"a"', '"b"']);
		const { typeSignature, typeInfo } = variable(declarations, 'a');
		assert.strictEqual(typeSignature, 'G<"c">');
		assert.deepStrictEqual(memberTexts(typeInfo), ['"c"', '"b"', '"a"']);
	});

	test('a named sub-union stays whole at its written position, in its own written order', async () => {
		const declarations = await analyzeScrambled(`export type Size = 'a' | 'b';
export const a: 'x' | Size = 'x';
export const b: Size | 'x' = 'x';`);
		const a = variable(declarations, 'a');
		const b = variable(declarations, 'b');
		// the checker orders by type id whatever was written
		assert.strictEqual(a.typeSignature, '"x" | Size');
		assert.strictEqual(b.typeSignature, '"x" | Size');
		assert.deepStrictEqual(memberTexts(a.typeInfo), ['"x"', 'Size']);
		assert.deepStrictEqual(memberTexts(b.typeInfo), ['Size', '"x"']);
		assert(b.typeInfo?.kind === 'union');
		const size = b.typeInfo.members[0];
		assert(size?.kind === 'union' && size.alias === 'Size');
		assert.deepStrictEqual(memberTexts(size), ['"a"', '"b"']);
	});

	test('enums keep declaration order, and a written enum-member union its written order', async () => {
		const declarations = await analyzeScrambled(`// @ts-expect-error erasableSyntaxOnly
export enum E {
	B = 'b',
	A = 'a'
}
export const a: E = E.A;
export const b: E | null = null;
export const c: E.A | E.B = E.A;`);
		const a = variable(declarations, 'a');
		assert(a.typeInfo?.kind === 'union' && a.typeInfo.alias === 'E');
		assert.deepStrictEqual(memberTexts(a.typeInfo), ['E.B', 'E.A']);
		const b = variable(declarations, 'b');
		assert.deepStrictEqual(memberTexts(b.typeInfo), ['E', 'null']);
		const c = variable(declarations, 'c');
		assert.strictEqual(c.typeSignature, 'E');
		assert.deepStrictEqual(memberTexts(c.typeInfo), ['E.A', 'E.B']);
	});

	test('two written unions over one member set share the first one written', async () => {
		// the lookup keys a written union by its member set, so the second
		// union takes the first one's order: a known edge
		const declarations = await analyzeScrambled(
			`export const a: ['a' | 'b', 'b' | 'a'] = ['a', 'a'];`
		);
		const { typeSignature, typeInfo } = variable(declarations, 'a');
		assert.strictEqual(typeSignature, '["b" | "a", "b" | "a"]');
		assert.strictEqual(typeInfo && typeJsonToText(typeInfo), '["a" | "b", "a" | "b"]');
	});

	test('an unannotated position with no alias keeps the checker order', async () => {
		const declarations = await analyzeScrambled(`export const fn = (a: 'a' | 'b') => a;`);
		const fn = findDeclaration(declarations, 'fn');
		assert(fn.kind === 'function');
		assert.deepStrictEqual(memberTexts(fn.parameters[0]?.typeInfo), ['"a"', '"b"']);
		assert.strictEqual(fn.returnType, '"b" | "a"');
		assert.deepStrictEqual(memberTexts(fn.returnTypeInfo), ['"b"', '"a"']);
	});

	test('an alias declaration that misses a member falls back to the checker order', async () => {
		// an alias local to a generic scope keeps its symbol through
		// instantiation with no type arguments, so its declaration writes `T`
		// where the instantiation has `'b'`: validation rejects it rather than
		// drop the unplaced member
		const declarations = await analyzeScrambled(`export function mk<T extends string>() {
	type L = 'a' | T | 'c';
	return null! as L;
}
export const v = mk<'b'>();`);
		const { typeSignature, typeInfo } = variable(declarations, 'v');
		assert.strictEqual(typeSignature, 'L');
		assert.deepStrictEqual(memberTexts(typeInfo), ['"c"', '"b"', '"a"']);
	});
});
