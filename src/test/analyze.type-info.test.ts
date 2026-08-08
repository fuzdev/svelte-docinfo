/**
 * Tests for structured type extraction (`typeInfo` / `TypeJson`) and the
 * source-order prop emission that landed with it.
 *
 * Exercises the whole `analyze` pipeline: the absence contract (terminal roots
 * carry no `typeInfo`) and its type-alias-root exception, alias preservation
 * through the optional-widening strip, the origin walk (flat-string member
 * order with nullish last, written sub-aliases as nested union nodes, the
 * null-bearing optional alias surviving), enum `{value, text}` pairs,
 * reference/array linkability, the boolean collapse, checker-backed class
 * members, the depth cap on recursive aliases, the terminal-text size budget,
 * and the `compactReplacer`
 * round-trip for a literal `false` value (the one data-bearing `false` on the
 * wire). Round-2 shape: callable classification (named generic instantiations
 * as references, bare/aliased signatures and hybrids staying `function`),
 * structured tuple elements (the empty-tuple carve-out included), and
 * `returnTypeInfo` on functions, members, and overloads. Round-3 shape:
 * written-name recovery — an alias TypeScript dropped (indexed-access or
 * conditional right-hand side) re-emerges from the written annotation as a
 * `{kind: 'reference', name}` node, in both directions: recovery at every
 * wired site (returns, parameters, variables, type-alias properties, component
 * props) and the non-triggers (checker names never overridden, import renames
 * resolving to the importable name, `typeof`/import-type/inline-literal and
 * argument-carrying annotations excluded, type parameters inert). Fixture
 * lock-ins: `ts/types/type-info` and `svelte/props/type-info`, plus the
 * recovery cases `ts/types/type-info-recovery`,
 * `ts/declarations/{function,variable}/type-info-recovery`, and
 * `svelte/props/type-info-recovery`.
 */

import { test, assert, describe } from 'vitest';

import { AnalyzeResultJson } from '$lib/analyze-core.ts';
import { compactReplacer } from '$lib/declaration-helpers.ts';
import { TypeJson, type ModuleJson } from '$lib/types.ts';

import { analyzeTestProject } from './test-module-helpers.ts';

/** Analyze a single-file project and return its module. */
const analyzeFile = async (path: string, content: string): Promise<ModuleJson> => {
	const { modules } = await analyzeTestProject({ [path]: content });
	assert.ok(modules[0], `expected a module for ${path}`);
	return modules[0];
};

describe('typeInfo extraction', () => {
	test('union alias declarations enumerate members with the alias kept', async () => {
		const module = await analyzeFile('src/lib/a.ts', `export type A = 'a' | 'b' | 'c';`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.deepStrictEqual(declaration.typeInfo, {
			kind: 'union',
			alias: 'A',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' },
				{ kind: 'literal', value: 'c', text: '"c"' }
			]
		});
	});

	test('optional aliased union keeps its alias through the widening strip', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`type A = 'a' | 'b';
export type O = { a?: A };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(member.typeSignature, 'A');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			alias: 'A',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
	});

	test('enum members carry the runtime value and the qualified name as text', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`enum E {
	A = 'a',
	B = 1
}
export type O = { e?: E };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			alias: 'E',
			members: [
				{ kind: 'literal', value: 'a', text: 'E.A' },
				{ kind: 'literal', value: 1, text: 'E.B' }
			]
		});
	});

	test('terminal roots carry no typeInfo (absence contract)', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export type O = {
	a?: boolean;
	b: string;
	c?: () => void;
	d: { a: string };
	e: B;
};`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		for (const member of declaration.members) {
			if (member.kind !== 'variable') continue;
			assert.strictEqual(
				member.typeInfo,
				undefined,
				`expected no typeInfo on terminal member ${member.name}`
			);
		}
	});

	test('the boolean collapse folds the checkers `true | false` pair back', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type O = {
	a?: boolean | null;
	b: boolean | 'x';
};`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const [a, b] = declaration.members;
		assert(a?.kind === 'variable' && b?.kind === 'variable');
		// `boolean` survives whole on the origin walk; on the normalized-list
		// fallback the collapse folds the checker's expanded `true | false` pair
		// back — either way, never a `'true' | 'false'` literal union
		assert.deepStrictEqual(a.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'intrinsic', text: 'boolean' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
		assert.deepStrictEqual(b.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'intrinsic', text: 'boolean' },
				{ kind: 'literal', value: 'x', text: '"x"' }
			]
		});
	});

	test('references keep type args and arrays keep their element', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export type O = {
	a: Map<string, B>;
	b?: Array<B>;
};`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const [a, b] = declaration.members;
		assert(a?.kind === 'variable' && b?.kind === 'variable');
		assert.deepStrictEqual(a.typeInfo, {
			kind: 'reference',
			name: 'Map',
			typeArgs: [
				{ kind: 'intrinsic', text: 'string' },
				{ kind: 'reference', name: 'B' }
			]
		});
		assert.deepStrictEqual(b.typeInfo, {
			kind: 'array',
			element: { kind: 'reference', name: 'B' }
		});
	});

	test('variable declarations and parameters carry typeInfo', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`type A = 'a' | 'b';
export const a: A | null = null;
export const fn = (b?: number | 'a'): void => {
	void b;
};`
		);
		const variable = module.declarations.find((d) => d.name === 'a');
		assert(variable?.kind === 'variable', 'expected a variable declaration');
		// the union's `origin` keeps the written `A` as a nested alias-carrying
		// node instead of the checker's flattened literals
		assert.deepStrictEqual(variable.typeInfo, {
			kind: 'union',
			members: [
				{
					kind: 'union',
					alias: 'A',
					members: [
						{ kind: 'literal', value: 'a', text: '"a"' },
						{ kind: 'literal', value: 'b', text: '"b"' }
					]
				},
				{ kind: 'intrinsic', text: 'null' }
			]
		});

		const fn = module.declarations.find((d) => d.name === 'fn');
		assert(fn?.kind === 'function', 'expected a function declaration');
		const param = fn.parameters[0];
		assert.ok(param, 'expected a parameter');
		assert.strictEqual(param.type, 'number | "a"');
		assert.deepStrictEqual(param.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'intrinsic', text: 'number' },
				{ kind: 'literal', value: 'a', text: '"a"' }
			]
		});
	});

	test('union members follow the flat string: written order, nullish last', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type O = {
	a: null | 'a';
	b: string | null | number;
};`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const [a, b] = declaration.members;
		assert(a?.kind === 'variable' && b?.kind === 'variable');
		// the printer sinks null/undefined to the end of whatever it prints, so
		// the flat strings read `"a" | null` and `string | number | null` — the
		// tree matches them, not the written order
		assert.strictEqual(a.typeSignature, '"a" | null');
		assert.deepStrictEqual(a.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
		assert.strictEqual(b.typeSignature, 'string | number | null');
		assert.deepStrictEqual(b.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'intrinsic', text: 'string' },
				{ kind: 'intrinsic', text: 'number' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
	});

	test('a written sub-alias survives as a nested union node', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`type A = 'a' | 'b';
export type O = { a: A | number };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		// the checker's `origin` lists plain members before named sub-unions
		// (written `A | number` prints `number | A`) — the tree matches the flat
		// string, and `A` survives as a node where the normalized list would
		// flatten it into its literals
		assert.strictEqual(member.typeSignature, 'number | A');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'intrinsic', text: 'number' },
				{
					kind: 'union',
					alias: 'A',
					members: [
						{ kind: 'literal', value: 'a', text: '"a"' },
						{ kind: 'literal', value: 'b', text: '"b"' }
					]
				}
			]
		});
	});

	test('a null-bearing optional alias keeps its alias', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`type A = { a: string } | null;
export type O = { a?: A };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(member.typeSignature, 'A');
		// dropping the widening `undefined` from the origin list leaves the
		// alias-carrying `A` union as the sole member, promoted to the root —
		// matching the flat string's own recovery
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			alias: 'A',
			members: [
				{ kind: 'object', text: '{ a: string; }' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
	});

	test('checker-backed class members carry typeInfo', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`type A = 'a' | 'b';
export class C {
	a = 'a' as A | null;
	b: A = 'a';
	get c(): A | null {
		return this.a;
	}
}`
		);
		const declaration = module.declarations.find((d) => d.name === 'C');
		assert(declaration?.kind === 'class', 'expected a class declaration');
		const inferred = declaration.members.find((m) => m.name === 'a');
		assert(inferred?.kind === 'variable', 'expected a variable member');
		const expected: TypeJson = {
			kind: 'union',
			members: [
				{
					kind: 'union',
					alias: 'A',
					members: [
						{ kind: 'literal', value: 'a', text: '"a"' },
						{ kind: 'literal', value: 'b', text: '"b"' }
					]
				},
				{ kind: 'intrinsic', text: 'null' }
			]
		};
		// inferred (unannotated) property — checker-backed, so the tree is emitted
		assert.deepStrictEqual(inferred.typeInfo, expected);
		// annotated property — checker-backed like the inferred one, so the
		// alias-kept union tree is emitted (was AST-backed written text with no tree)
		const annotated = declaration.members.find((m) => m.name === 'b');
		assert(annotated?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(annotated.typeSignature, 'A');
		assert.deepStrictEqual(annotated.typeInfo, {
			kind: 'union',
			alias: 'A',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
		// getter-backed accessor — checker-backed like the inferred property
		const accessor = declaration.members.find((m) => m.name === 'c');
		assert(accessor?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(accessor.typeInfo, expected);
	});

	test('index signature members carry typeInfo', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type O = { [key: string]: 'a' | 'b' };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members.find((m) => m.name === '[key: string]');
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
	});

	test('interface property members are checker-backed with typeInfo', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export interface Options {
	mode: 'a' | 'b';
	opt?: string | null;
}`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');
		const mode = declaration.members.find((m) => m.name === 'mode');
		assert(mode?.kind === 'variable', 'expected a variable member');
		// checker rendering, not written text — double quotes are the checker's
		assert.strictEqual(mode.typeSignature, '"a" | "b"');
		assert.deepStrictEqual(mode.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
		// the optional-widening strip pairs with `optional: true`, keeping `null`
		const opt = declaration.members.find((m) => m.name === 'opt');
		assert(opt?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(opt.optional, true);
		assert.strictEqual(opt.typeSignature, 'string | null');
	});

	test('a callable interface property classifies as a function member, like the type-alias path', async () => {
		const iface = await analyzeFile(
			'src/lib/a.ts',
			`export interface I {
	fn: (a: string) => number;
}`
		);
		const alias = await analyzeFile(
			'src/lib/b.ts',
			`export type I = {
	fn: (a: string) => number;
};`
		);
		const ifaceDecl = iface.declarations[0];
		const aliasDecl = alias.declarations[0];
		assert(ifaceDecl?.kind === 'interface', 'expected an interface declaration');
		assert(aliasDecl?.kind === 'type', 'expected a type declaration');
		const ifaceMember = ifaceDecl.members.find((m) => m.name === 'fn');
		const aliasMember = aliasDecl.members.find((m) => m.name === 'fn');
		assert(ifaceMember?.kind === 'function', 'expected a function member on the interface');
		assert(aliasMember?.kind === 'function', 'expected a function member on the type alias');
		// the same written shape extracts identically across the two container kinds
		assert.strictEqual(ifaceMember.typeSignature, aliasMember.typeSignature);
		assert.deepStrictEqual(ifaceMember.parameters, aliasMember.parameters);
		assert.strictEqual(ifaceMember.returnType, aliasMember.returnType);
	});

	test('`@default` on a property that classifies callable is dropped, not emitted', async () => {
		// `defaultValue` is schema-allowed on variable members only; a callable
		// property flips to a function member after TSDoc parsing, so the apply
		// gate must run against the settled kind or `ModuleJson.parse` throws
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export interface I {
	/**
	 * A callable option.
	 *
	 * @default noop
	 */
	fn: () => void;
}`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');
		const member = declaration.members.find((m) => m.name === 'fn');
		assert(member?.kind === 'function', 'expected a function member');
		assert.strictEqual(member.docComment, 'A callable option.');
		assert.ok(!('defaultValue' in member), 'expected no defaultValue on a function member');
	});

	test('interface index signatures are checker-backed with typeInfo', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export interface I {
	[key: string]: 'a' | 'b';
}`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');
		const member = declaration.members.find((m) => m.name === '[key: string]');
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(member.typeSignature, '"a" | "b"');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
	});

	test('setter-only accessors are checker-backed with typeInfo', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`type A = 'a' | 'b';
export class C {
	#v: A | null = null;
	set writeOnly(v: A | null) {
		this.#v = v;
	}
}`
		);
		const declaration = module.declarations.find((d) => d.name === 'C');
		assert(declaration?.kind === 'class', 'expected a class declaration');
		const accessor = declaration.members.find((m) => m.name === 'writeOnly');
		assert(accessor?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(accessor.modifiers, ['setter']);
		assert.strictEqual(accessor.typeSignature, 'A | null');
		assert.deepStrictEqual(accessor.typeInfo, {
			kind: 'union',
			members: [
				{
					kind: 'union',
					alias: 'A',
					members: [
						{ kind: 'literal', value: 'a', text: '"a"' },
						{ kind: 'literal', value: 'b', text: '"b"' }
					]
				},
				{ kind: 'intrinsic', text: 'null' }
			]
		});
	});

	test('an optional unconstrained type parameter keeps its bare name', async () => {
		// the widened `E | undefined` has exactly one member after dropping
		// `undefined`, which is taken directly — `getNonNullableType` can only
		// answer `NonNullable<E>` for a bare type parameter and prints `E & {}`
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export interface I<E> {
	c?: E;
}
export const f = <E,>(c?: E): void => {};`
		);
		const iface = module.declarations.find((d) => d.name === 'I');
		assert(iface?.kind === 'interface', 'expected an interface declaration');
		const c = iface.members.find((m) => m.name === 'c');
		assert(c?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(c.typeSignature, 'E');
		assert.strictEqual(c.optional, true);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		assert.strictEqual(f.parameters[0]?.type, 'E');
	});

	test('the depth cap terminates a recursive alias', async () => {
		const module = await analyzeFile('src/lib/a.ts', `export type J = string | Array<J>;`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.ok(declaration.typeInfo, 'expected typeInfo on the recursive alias');
		// must be parseable — i.e., finite — and bottom out in a degraded text node
		const parsed = TypeJson.parse(declaration.typeInfo);
		let node = parsed;
		let depth = 0;
		while (node.kind === 'union' || node.kind === 'array') {
			node = node.kind === 'union' ? node.members.at(-1)! : node.element;
			depth++;
			assert.ok(depth < 20, 'expected the walk to terminate');
		}
	});

	test('the text budget bounds one terminal node, without hand-slicing it', async () => {
		// the width bound companion to the depth cap: a terminal node's whole
		// payload is one string, so depth can't contain it. This is the shape a
		// schema-inferred alias produces — TypeScript drops the alias symbol for
		// an indexed-access/conditional right-hand side (`z.infer<typeof S>`), so
		// the checker expands the full structure at every use site
		const properties = Array.from({ length: 60 }, (_, i) => `propertyNumber${i}: string`).join(
			'; '
		);
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type O = { big: { ${properties} } | null };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert(member.typeInfo?.kind === 'union', 'expected a union typeInfo');
		const object = member.typeInfo.members[0];
		assert(object?.kind === 'object', 'expected an object node');
		// well under budget, and the checker's own elision rather than a prefix —
		// `text` stays a parseable type string
		assert.ok(object.text.length < 1000, `expected the elided form, got ${object.text.length}`);
		assert.match(object.text, /^\{ .* \.\.\. \d+ more \.\.\.; .* \}$/);
	});

	test('a literal false value survives the compact wire round-trip', async () => {
		const result = await analyzeTestProject({
			'src/lib/a.ts': `export type O = { a?: false | 'a' };`
		});
		const findMember = (modules: Array<ModuleJson>) => {
			const declaration = modules[0]?.declarations[0];
			assert(declaration?.kind === 'type', 'expected a type declaration');
			const member = declaration.members[0];
			assert(member?.kind === 'variable', 'expected a variable member');
			return member;
		};

		const expected: TypeJson = {
			kind: 'union',
			members: [
				{ kind: 'literal', value: false, text: 'false' },
				{ kind: 'literal', value: 'a', text: '"a"' }
			]
		};
		assert.deepStrictEqual(findMember(result.modules).typeInfo, expected);

		// `compactReplacer` strips `false` flag fields but must not strip the
		// data-bearing literal `value` — the keyed exemption under test
		const restored = AnalyzeResultJson.parse(JSON.parse(JSON.stringify(result, compactReplacer)));
		assert.deepStrictEqual(findMember(restored.modules).typeInfo, expected);
	});

	test('snippet parameter tuple elements carry typeInfo', async () => {
		// `Snippet` is declared locally rather than imported from `svelte`, which
		// isn't resolvable in the temp test project; the structural detection
		// matches the same shape (a callable `Snippet`-named instantiation)
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Snippet<T extends Array<unknown>> {(...args: T): void}

	let { a }: { a?: Snippet<[b: 'a' | 'b']> } = $props();
</script>

<div>{a}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const prop = declaration.props[0];
		assert.ok(prop?.parameters, 'expected snippet parameters');
		assert.deepStrictEqual(prop.parameters[0]?.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
		// the prop's own tree: a reference whose tuple typeArg carries the same
		// structure the sibling `parameters` projects
		assert.deepStrictEqual(prop.typeInfo, {
			kind: 'reference',
			name: 'Snippet',
			typeArgs: [
				{
					kind: 'tuple',
					elements: [
						{
							name: 'b',
							type: {
								kind: 'union',
								members: [
									{ kind: 'literal', value: 'a', text: '"a"' },
									{ kind: 'literal', value: 'b', text: '"b"' }
								]
							}
						}
					]
				}
			]
		});
	});

	test('parameter-derived tuple labels name snippet parameters', async () => {
		// `Parameters<typeof g>` labels come from `g`'s parameter declarations —
		// the shared naming rule (`tupleElementName`) keeps `parameters` and the
		// tree in agreement
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Snippet<T extends Array<unknown>> {(...args: T): void}

	const g = (first: string, second: number): void => {};

	let { s }: { s?: Snippet<Parameters<typeof g>> } = $props();
</script>

<div>{s}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const prop = declaration.props[0];
		assert.ok(prop?.parameters, 'expected snippet parameters');
		assert.deepStrictEqual(
			prop.parameters.map((p) => p.name),
			['first', 'second']
		);
	});

	test('rest snippet tuple elements report the array form with rest marked', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Snippet<T extends Array<unknown>> {(...args: T): void}

	interface B {
		a: string;
	}

	let { s }: { s?: Snippet<[a: string, ...rest: B[]]> } = $props();
</script>

<div>{s}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const prop = declaration.props[0];
		assert.ok(prop?.parameters, 'expected snippet parameters');
		// rest elements report like rest signature parameters: the printed
		// array form with `rest: true`, and an array `typeInfo` node
		const rest = prop.parameters[1];
		assert.ok(rest, 'expected a rest parameter entry');
		assert.strictEqual(rest.name, 'rest');
		assert.strictEqual(rest.type, 'B[]');
		assert.strictEqual(rest.rest, true);
		assert.deepStrictEqual(rest.typeInfo, {
			kind: 'array',
			element: { kind: 'reference', name: 'B' }
		});
		assert.deepStrictEqual(prop.typeInfo, {
			kind: 'reference',
			name: 'Snippet',
			typeArgs: [
				{
					kind: 'tuple',
					elements: [
						{ name: 'a', type: { kind: 'intrinsic', text: 'string' } },
						{
							name: 'rest',
							rest: true,
							type: { kind: 'array', element: { kind: 'reference', name: 'B' } }
						}
					]
				}
			]
		});
	});

	test('rest element array text parenthesizes like the printer', async () => {
		// each tuple keeps a fixed leading element — a rest-only tuple
		// (`[...E[]]`) is normalized by the checker to a plain array
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Snippet<T extends Array<unknown>> {(...args: T): void}

	interface B {
		a: string;
	}

	type UA = 'a' | 'b';

	enum EN {
		A = 'a',
		B = 'b'
	}

	let { v, ua, en, bo, ro, str }: {
		v?: Snippet<[a: string, ...vals: ('a' | 'b')[]]>;
		ua?: Snippet<[a: string, ...vals: UA[]]>;
		en?: Snippet<[a: string, ...vals: EN[]]>;
		bo?: Snippet<[a: string, ...vals: boolean[]]>;
		ro?: Snippet<[a: string, ...vals: (readonly B[])[]]>;
		str?: Snippet<[a: string, ...vals: string[]]>;
	} = $props();
</script>

<div>{v}{ua}{en}{bo}{ro}{str}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const restParam = (name: string) =>
			declaration.props.find((p) => p.name === name)?.parameters?.[1];
		// the printer's own parenthesization: bare unions need parens; aliased
		// unions and enums print as their names; `boolean` is a checker union
		// but prints bare; a readonly-array element must parenthesize —
		// `readonly B[][]` would denote a different type
		assert.strictEqual(restParam('v')?.type, '("a" | "b")[]');
		assert.strictEqual(restParam('ua')?.type, 'UA[]');
		assert.strictEqual(restParam('en')?.type, 'EN[]');
		assert.strictEqual(restParam('bo')?.type, 'boolean[]');
		assert.strictEqual(restParam('ro')?.type, '(readonly B[])[]');
		assert.strictEqual(restParam('str')?.type, 'string[]');
		// the absence half of the rest contract: an intrinsic element makes no tree
		assert.strictEqual(restParam('str')?.typeInfo, undefined);
	});

	test('a variadic snippet spread carries the spread type with rest marked', async () => {
		// the local `Snippet` lives in the instance script, so under a generic
		// component it captures `T` as an outer type parameter and the params
		// tuple is the *second* checker type argument — also covering the
		// find-first-tuple lookup in `extractSnippetParameters`
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts" generics="T extends Array<unknown>">
	interface Snippet<P extends Array<unknown>> {(...args: P): void}

	let { s }: { s?: Snippet<[a: string, ...rest: T]> } = $props();
</script>

<div>{s}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const rest = declaration.props[0]?.parameters?.[1];
		// the spread type is not array-wrapped — `T` stands in for the elements
		// it expands to; `rest: true` still marks the position
		assert.strictEqual(rest?.name, 'rest');
		assert.strictEqual(rest?.type, 'T');
		assert.strictEqual(rest?.rest, true);
		assert.strictEqual(rest?.typeInfo, undefined);
	});
});

describe('callable classification', () => {
	test('a named generic callable instantiation is a reference, not a function', async () => {
		// `| null` keeps the property a variable member — a bare callable-typed
		// property is classified as a function member before `typeInfo` applies
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface Factory<T> {
	(): T;
}
export type O = { f: Factory<string> | null };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			members: [
				{
					kind: 'reference',
					name: 'Factory',
					typeArgs: [{ kind: 'intrinsic', text: 'string' }]
				},
				{ kind: 'intrinsic', text: 'null' }
			]
		});
	});

	test('aliased function types and hybrid callable interfaces stay function nodes', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type Handler = (e: string) => void;
interface Callable {
	(): void;
	extra: string;
}
export type O = {
	h: Handler | null;
	c: Callable | null;
};`
		);
		const declaration = module.declarations.find((d) => d.name === 'O');
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const [h, c] = declaration.members;
		assert(h?.kind === 'variable' && c?.kind === 'variable');
		// callability is the load-bearing renderer signal — the names survive
		// only inside `text`
		assert.deepStrictEqual(h.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'function', text: 'Handler' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
		assert.deepStrictEqual(c.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'function', text: 'Callable' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
	});

	test('an alias over a callable instantiation references by the alias name', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface Factory<T> {
	(): T;
}
type MyFactory = Factory<string>;
export type O = { f: MyFactory | null };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'reference', name: 'MyFactory' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
	});

	test('a this-referencing non-generic callable interface stays a function node', async () => {
		// `self(): this` makes the declared type `Reference`-flagged — the
		// argument-carrying gate keeps classification independent of thisness
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface Chainable {
	(): void;
	self(): this;
}
export type O = { c: Chainable | null };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'union',
			members: [
				{ kind: 'function', text: 'Chainable' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
	});
});

describe('tuple elements', () => {
	test('tuples carry named, optional, and rest elements', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export type O = { t: [a: string, b?: B | null, ...rest: B[]] };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'tuple',
			elements: [
				{ name: 'a', type: { kind: 'intrinsic', text: 'string' } },
				{
					name: 'b',
					optional: true,
					// the optional element's widening `undefined` is stripped like an
					// optional property's — `optional: true` carries it, `null` stays
					type: {
						kind: 'union',
						members: [
							{ kind: 'reference', name: 'B' },
							{ kind: 'intrinsic', text: 'null' }
						]
					}
				},
				{
					name: 'rest',
					rest: true,
					// the rest element's type is the printed array form
					type: { kind: 'array', element: { kind: 'reference', name: 'B' } }
				}
			]
		});
	});

	test('a tuple with no linkable element stays absent at a non-alias root', async () => {
		const module = await analyzeFile('src/lib/a.ts', `export type O = { t: [string, number] };`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		// same rule as arrays: `[string, number]` is the whole flat story
		assert.strictEqual(member.typeInfo, undefined);
	});

	test('an unresolved variadic spread keeps the spread type with rest marked', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export const f = <T extends Array<unknown>>(t: [a: B, ...T]): void => {};`
		);
		const fn = module.declarations[0];
		assert(fn?.kind === 'function', 'expected a function declaration');
		const param = fn.parameters[0];
		assert.ok(param, 'expected a parameter');
		assert.deepStrictEqual(param.typeInfo, {
			kind: 'tuple',
			elements: [
				{ name: 'a', type: { kind: 'reference', name: 'B' } },
				// no array rewrap — the unresolved spread stands in for the
				// elements it expands to
				{ rest: true, type: { kind: 'other', text: 'T' } }
			]
		});
	});

	test('an optional undefined element keeps the intrinsic with optional marked', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export type O = { t: [a: B, x?: undefined] };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members[0];
		assert(member?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(member.typeInfo, {
			kind: 'tuple',
			elements: [
				{ name: 'a', type: { kind: 'reference', name: 'B' } },
				// the written type and the widening coincide — nothing to strip
				{ name: 'x', optional: true, type: { kind: 'intrinsic', text: 'undefined' } }
			]
		});
	});

	test('readonly arrays and tuples carry the readonly marker', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export type O = { t: readonly [a: B, b: string]; arr: readonly B[] };`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const [t, arr] = declaration.members;
		assert(t?.kind === 'variable' && arr?.kind === 'variable');
		assert.deepStrictEqual(t.typeInfo, {
			kind: 'tuple',
			elements: [
				{ name: 'a', type: { kind: 'reference', name: 'B' } },
				{ name: 'b', type: { kind: 'intrinsic', text: 'string' } }
			],
			readonly: true
		});
		assert.deepStrictEqual(arr.typeInfo, {
			kind: 'array',
			element: { kind: 'reference', name: 'B' },
			readonly: true
		});
	});

	test('a reference over the empty tuple stays absent, unlike one with elements', async () => {
		// the one instantiation that says nothing the flat string doesn't — a
		// tree over `[]` would be a wrapper around no content. `Snippet<[]>` is
		// the case that matters (every `children` prop in the ecosystem)
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Snippet<T extends Array<unknown> = []> {(...args: T): void}

	let { children, header }: { children?: Snippet; header?: Snippet<[title: string]> } = $props();
</script>

<div>{children}{header}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const children = declaration.props.find((p) => p.name === 'children');
		assert.ok(children, 'expected a children prop');
		assert.strictEqual(children.type, 'Snippet<[]>');
		assert.strictEqual(children.typeInfo, undefined);
		// a tuple with elements still earns the tree
		const header = declaration.props.find((p) => p.name === 'header');
		assert.deepStrictEqual(header?.typeInfo, {
			kind: 'reference',
			name: 'Snippet',
			typeArgs: [
				{
					kind: 'tuple',
					elements: [{ name: 'title', type: { kind: 'intrinsic', text: 'string' } }]
				}
			]
		});
	});
});

describe('returnTypeInfo', () => {
	test('function return types carry structure; terminal returns stay absent', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export const fn = (): 'a' | 'b' => 'a';
export const terminal = (): void => {};`
		);
		const fn = module.declarations.find((d) => d.name === 'fn');
		assert(fn?.kind === 'function', 'expected a function declaration');
		assert.strictEqual(fn.returnType, '"a" | "b"');
		assert.deepStrictEqual(fn.returnTypeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
		const terminal = module.declarations.find((d) => d.name === 'terminal');
		assert(terminal?.kind === 'function', 'expected a function declaration');
		assert.strictEqual(terminal.returnTypeInfo, undefined);
	});

	test('overloads carry their own returnTypeInfo', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export function f(a: string): 'a' | 'b';
export function f(a: number): number;
export function f(a: string | number): 'a' | 'b' | number {
	return typeof a === 'string' ? 'a' : a;
}`
		);
		const fn = module.declarations.find((d) => d.name === 'f');
		assert(fn?.kind === 'function', 'expected a function declaration');
		const [first, second] = fn.overloads;
		assert.ok(first && second, 'expected two overloads');
		assert.deepStrictEqual(first.returnTypeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		});
		assert.strictEqual(second.returnTypeInfo, undefined);
	});

	test('call-signature members carry returnTypeInfo', async () => {
		const module = await analyzeFile('src/lib/a.ts', `export type F = (a: string) => 'x' | 'y';`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const member = declaration.members.find((m) => m.name === '(call)');
		assert(member?.kind === 'function', 'expected a call-signature member');
		assert.deepStrictEqual(member.returnTypeInfo, {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'x', text: '"x"' },
				{ kind: 'literal', value: 'y', text: '"y"' }
			]
		});
	});
});

describe('typeInfo at type-alias roots', () => {
	// the checker prints an aliased type as its own bare name, so at these roots
	// `typeSignature` says nothing and the absence contract's premise fails

	test('an array alias keeps its structure even when the element is terminal', async () => {
		const module = await analyzeFile('src/lib/a.ts', `export type A = string[];`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		// `"A"` is the whole flat story, and there are no members to fall back on
		assert.strictEqual(declaration.typeSignature, 'A');
		assert.deepStrictEqual(declaration.typeInfo, {
			kind: 'array',
			element: { kind: 'intrinsic', text: 'string' }
		});
	});

	test('a tuple alias carries structured elements', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export type A = [a: string, b: B];`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.strictEqual(declaration.typeSignature, 'A');
		assert.deepStrictEqual(declaration.typeInfo, {
			kind: 'tuple',
			elements: [
				{ name: 'a', type: { kind: 'intrinsic', text: 'string' } },
				{ name: 'b', type: { kind: 'reference', name: 'B' } }
			]
		});
	});

	test('a readonly tuple alias keeps readonly at the root', async () => {
		// the alias root's flat string is just the alias name, so the marker is
		// the only place readonly-ness survives
		const module = await analyzeFile('src/lib/a.ts', `export type A = readonly [string, number];`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.strictEqual(declaration.typeSignature, 'A');
		assert.deepStrictEqual(declaration.typeInfo, {
			kind: 'tuple',
			elements: [
				{ type: { kind: 'intrinsic', text: 'string' } },
				{ type: { kind: 'intrinsic', text: 'number' } }
			],
			readonly: true
		});
	});

	test('a terminal alias reprints what the alias stands for', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type A<T> = T extends string ? 'a' : 'b';`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.strictEqual(declaration.typeSignature, 'A<T>');
		// printed with `InTypeAlias`, else the text would repeat the alias name
		assert.deepStrictEqual(declaration.typeInfo, {
			kind: 'other',
			text: 'T extends string ? "a" : "b"'
		});
	});

	test('the self-alias skip surfaces the aliased shape, not a self-reference', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface B {
	a: string;
}
export type A = Map<string, B>;`
		);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		// without `skipAliasName` this would build `{kind: 'reference', name: 'A'}`
		assert.deepStrictEqual(declaration.typeInfo, {
			kind: 'reference',
			name: 'Map',
			typeArgs: [
				{ kind: 'intrinsic', text: 'string' },
				{ kind: 'reference', name: 'B' }
			]
		});
	});

	test('object and function aliases stay absent — members already carry them', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type A = { a: string };
export type B = (a: string) => void;`
		);
		const [a, b] = module.declarations;
		assert(a?.kind === 'type' && b?.kind === 'type');
		assert.strictEqual(a.typeInfo, undefined);
		assert.deepStrictEqual(
			a.members.map((m) => m.name),
			['a']
		);
		assert.strictEqual(b.typeInfo, undefined);
		assert.deepStrictEqual(
			b.members.map((m) => m.name),
			['(call)']
		);
	});

	test('an interned alias stays absent — the flat string prints structurally', async () => {
		const module = await analyzeFile('src/lib/a.ts', `export type A = string;`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		// intrinsics carry no alias symbol, so `typeSignature` is the real type
		assert.strictEqual(declaration.typeSignature, 'string');
		assert.strictEqual(declaration.typeInfo, undefined);
	});
});

describe('written-name recovery', () => {
	// an indexed-access right-hand side loses `aliasSymbol`, so the checker
	// prints `Inferred` structurally everywhere — the same mechanism as
	// `z.infer<typeof S>` without the zod dependency
	const INFERRED_SETUP = `interface Box {
	out: { a: string; b: number };
}
export type Inferred = Box['out'];
`;

	test('a written return annotation recovers an alias TypeScript dropped', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export const f = (): Promise<Inferred> => Promise.resolve({ a: '', b: 0 });`
		);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		// the flat string stays the checker's structural rendering — recovery is tree-only
		assert.strictEqual(f.returnType, 'Promise<{ a: string; b: number; }>');
		assert.deepStrictEqual(f.returnTypeInfo, {
			kind: 'reference',
			name: 'Promise',
			typeArgs: [{ kind: 'reference', name: 'Inferred' }]
		});
	});

	test('an import rename recovers the importable name, never the local one', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/dep.ts': INFERRED_SETUP,
			'src/lib/a.ts': `import type { Inferred as Renamed } from './dep.js';

export const f = (): Promise<Renamed> => Promise.resolve({ a: '', b: 0 });`
		});
		const module = modules.find((m) => m.path === 'a.ts');
		const f = module?.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(f.returnTypeInfo, {
			kind: 'reference',
			name: 'Promise',
			typeArgs: [{ kind: 'reference', name: 'Inferred' }]
		});
	});

	test('recovery holds at depth through checker rewrites', async () => {
		// the checker collapses `Array<Inferred>` to `{...}[]`; identity lookup
		// still finds the element two levels down
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export const f = (): Map<string, Array<Inferred>> => new Map();`
		);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(f.returnTypeInfo, {
			kind: 'reference',
			name: 'Map',
			typeArgs: [
				{ kind: 'intrinsic', text: 'string' },
				{ kind: 'array', element: { kind: 'reference', name: 'Inferred' } }
			]
		});
	});

	test('union member recovery is position-independent', async () => {
		// written `null | Inferred` prints nullish-sunk, so the member recovers at
		// a different position than it was written at — identity, not position
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export const f = (): null | Inferred => null;
export const g = (): Inferred | undefined => undefined;`
		);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(f.returnTypeInfo, {
			kind: 'union',
			members: [
				{ kind: 'reference', name: 'Inferred' },
				{ kind: 'intrinsic', text: 'null' }
			]
		});
		const g = module.declarations.find((d) => d.name === 'g');
		assert(g?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(g.returnTypeInfo, {
			kind: 'union',
			members: [
				{ kind: 'reference', name: 'Inferred' },
				{ kind: 'intrinsic', text: 'undefined' }
			]
		});
	});

	test('an alias-lost union recovers as a reference instead of expanding', async () => {
		// the union analog of the object case (`z.infer` over a discriminated
		// union): no alias symbol to label members with, so a written name
		// replaces the expansion — including through the optional-widening strip,
		// where `getNonNullableType` rebuilds to the same interned union
		const module = await analyzeFile(
			'src/lib/a.ts',
			`interface UBox {
	u: 'a' | { x: number };
}
export type U = UBox['u'];

export const f = (): Array<U> => [];
export type Holder = { field?: U };`
		);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(f.returnTypeInfo, {
			kind: 'array',
			element: { kind: 'reference', name: 'U' }
		});
		const holder = module.declarations.find((d) => d.name === 'Holder');
		assert(holder?.kind === 'type', 'expected a type declaration');
		const field = holder.members[0];
		assert(field?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(field.typeInfo, { kind: 'reference', name: 'U' });
	});

	test('a namespace-qualified annotation recovers the bare symbol name', async () => {
		// `schemas.Inferred` resolves through the namespace import to the symbol —
		// the qualifier is a file-local spelling like an import rename, and the
		// bare name is the one the flat-namespace docs model can resolve
		const { modules } = await analyzeTestProject({
			'src/lib/dep.ts': INFERRED_SETUP,
			'src/lib/a.ts': `import type * as schemas from './dep.js';

export const f = (): schemas.Inferred => ({ a: '', b: 0 });`
		});
		const module = modules.find((m) => m.path === 'a.ts');
		const f = module?.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(f.returnTypeInfo, { kind: 'reference', name: 'Inferred' });
	});

	test('typeof, import-type, and inline-literal annotations never trigger recovery', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/dep.ts': INFERRED_SETUP,
			'src/lib/a.ts': `const value = { a: '', b: 0 };

export const viaTypeof = (): typeof value => value;
export const viaImportType = (): import('./dep.js').Inferred => ({ a: '', b: 0 });
export const viaLiteral = (): Promise<{ a: string }> => Promise.resolve({ a: '' });`
		});
		const module = modules.find((m) => m.path === 'a.ts');
		for (const name of ['viaTypeof', 'viaImportType']) {
			const decl = module?.declarations.find((d) => d.name === name);
			assert(decl?.kind === 'function', `expected a function declaration for ${name}`);
			// an anonymous object at the root with nothing recovered stays absent
			assert.strictEqual(decl.returnTypeInfo, undefined, `expected no recovery for ${name}`);
		}
		const viaLiteral = module?.declarations.find((d) => d.name === 'viaLiteral');
		assert(viaLiteral?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(viaLiteral.returnTypeInfo, {
			kind: 'reference',
			name: 'Promise',
			typeArgs: [{ kind: 'object', text: '{ a: string; }' }]
		});
	});

	test('an argument-carrying written annotation never recovers by its bare name', async () => {
		// `Get<Box>` loses its alias like `z.infer<typeof S>`, and like it the
		// bare symbol name misrepresents the instantiation — excluded by design
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
type Get<T extends Box> = T['out'];

export const f = (): Promise<Get<Box>> => Promise.resolve({ a: '', b: 0 });`
		);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		assert(f.returnTypeInfo?.kind === 'reference', 'expected the Promise reference');
		assert.deepStrictEqual(f.returnTypeInfo.typeArgs?.[0], {
			kind: 'object',
			text: '{ a: string; b: number; }'
		});
	});

	test('a name the checker already has is never overridden', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/dep.ts': `export interface Original {
	a: string;
}`,
			'src/lib/a.ts': `import type { Original as Renamed } from './dep.js';

export const f = (): Promise<Renamed> => Promise.resolve({ a: '' });`
		});
		const module = modules.find((m) => m.path === 'a.ts');
		const f = module?.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		// the interface's own symbol names the node; the written `Renamed` is inert
		assert.deepStrictEqual(f.returnTypeInfo, {
			kind: 'reference',
			name: 'Promise',
			typeArgs: [{ kind: 'reference', name: 'Original' }]
		});
	});

	test('a recovered bare reference is emitted at the root', async () => {
		// a checker-named bare reference defers to the flat string printing the
		// same name; a recovered one stands against the anonymous expansion, so
		// the contract relaxes — while the checker-named case stays absent
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export const recovered = (): Inferred => ({ a: '', b: 0 });
export const checkerNamed = (): Box => ({ out: { a: '', b: 0 } });`
		);
		const recovered = module.declarations.find((d) => d.name === 'recovered');
		assert(recovered?.kind === 'function', 'expected a function declaration');
		assert.strictEqual(recovered.returnType, '{ a: string; b: number; }');
		assert.deepStrictEqual(recovered.returnTypeInfo, { kind: 'reference', name: 'Inferred' });
		const checkerNamed = module.declarations.find((d) => d.name === 'checkerNamed');
		assert(checkerNamed?.kind === 'function', 'expected a function declaration');
		assert.strictEqual(checkerNamed.returnTypeInfo, undefined);
	});

	test('parameters and variables recover through their annotations', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export const p = (required: Inferred, optional?: Inferred): string => '';
export const v: Inferred = { a: '', b: 0 };`
		);
		const p = module.declarations.find((d) => d.name === 'p');
		assert(p?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(p.parameters?.[0]?.typeInfo, { kind: 'reference', name: 'Inferred' });
		// the optional-widening strip and recovery compose
		assert.deepStrictEqual(p.parameters?.[1]?.typeInfo, { kind: 'reference', name: 'Inferred' });
		const v = module.declarations.find((d) => d.name === 'v');
		assert(v?.kind === 'variable', 'expected a variable declaration');
		assert.deepStrictEqual(v.typeInfo, { kind: 'reference', name: 'Inferred' });
	});

	test('component props recover through the props type annotation', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Box {
		out: { a: string; b: number };
	}
	type Inferred = Box['out'];

	let { config }: { config: Inferred } = $props();
</script>

<div>{config.a}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const prop = declaration.props[0];
		assert.ok(prop, 'expected a prop');
		assert.strictEqual(prop.type, '{ a: string; b: number; }');
		assert.deepStrictEqual(prop.typeInfo, { kind: 'reference', name: 'Inferred' });
	});

	test('a type-alias right-hand side recovers through its own written node', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export type AliasOfLost = Inferred;
export type MaybeInferred = Inferred | undefined;`
		);
		// a bare-reference right-hand side: the flat string prints the expansion
		// (the alias was lost), so the recovered reference is the only name
		const bare = module.declarations.find((d) => d.name === 'AliasOfLost');
		assert(bare?.kind === 'type', 'expected a type declaration');
		assert.deepStrictEqual(bare.typeInfo, { kind: 'reference', name: 'Inferred' });
		// the outer alias survives (a union right-hand side keeps its alias
		// symbol — only the indexed-access `Inferred` lost one) and the member
		// recovers inside it
		const union = module.declarations.find((d) => d.name === 'MaybeInferred');
		assert(union?.kind === 'type', 'expected a type declaration');
		assert.deepStrictEqual(union.typeInfo, {
			kind: 'union',
			alias: 'MaybeInferred',
			members: [
				{ kind: 'reference', name: 'Inferred' },
				{ kind: 'intrinsic', text: 'undefined' }
			]
		});
	});

	test('index signatures and getter accessors recover through their annotations', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export type Dict = { [key: string]: Inferred };

export class Holder {
	get current(): Inferred {
		return { a: '', b: 0 };
	}
}`
		);
		const dict = module.declarations.find((d) => d.name === 'Dict');
		assert(dict?.kind === 'type', 'expected a type declaration');
		const index = dict.members.find((m) => m.name === '[key: string]');
		assert(index?.kind === 'variable', 'expected an index-signature member');
		assert.deepStrictEqual(index.typeInfo, { kind: 'reference', name: 'Inferred' });
		const holder = module.declarations.find((d) => d.name === 'Holder');
		assert(holder?.kind === 'class', 'expected a class declaration');
		const accessor = holder.members.find((m) => m.name === 'current');
		assert(accessor?.kind === 'variable', 'expected an accessor member');
		assert.deepStrictEqual(accessor.typeInfo, { kind: 'reference', name: 'Inferred' });
	});

	test('interface properties, class fields, and setter-only accessors recover through their annotations', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export interface Holder {
	p: Inferred;
	[key: string]: Inferred;
}

export class Field {
	p: Inferred = { a: '', b: 0 };
	set writeOnly(v: Inferred) {}
}`
		);
		const holder = module.declarations.find((d) => d.name === 'Holder');
		assert(holder?.kind === 'interface', 'expected an interface declaration');
		const prop = holder.members.find((m) => m.name === 'p');
		assert(prop?.kind === 'variable', 'expected a variable member');
		// the flat string stays the checker's structural rendering — recovery is tree-only
		assert.strictEqual(prop.typeSignature, '{ a: string; b: number; }');
		assert.deepStrictEqual(prop.typeInfo, { kind: 'reference', name: 'Inferred' });
		const index = holder.members.find((m) => m.name === '[key: string]');
		assert(index?.kind === 'variable', 'expected an index-signature member');
		assert.deepStrictEqual(index.typeInfo, { kind: 'reference', name: 'Inferred' });
		const field = module.declarations.find((d) => d.name === 'Field');
		assert(field?.kind === 'class', 'expected a class declaration');
		const classProp = field.members.find((m) => m.name === 'p');
		assert(classProp?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(classProp.typeInfo, { kind: 'reference', name: 'Inferred' });
		const setter = field.members.find((m) => m.name === 'writeOnly');
		assert(setter?.kind === 'variable', 'expected an accessor member');
		assert.deepStrictEqual(setter.typeInfo, { kind: 'reference', name: 'Inferred' });
	});

	test('recovery fires at the depth cap, replacing elided text', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export const f = (): Array<Array<Array<Array<Array<Inferred>>>>> => [];`
		);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		let node = f.returnTypeInfo;
		let depth = 0;
		while (node?.kind === 'array') {
			node = node.element;
			depth++;
		}
		assert.strictEqual(depth, 5, 'expected the element at the depth cap');
		// without cap-site recovery this would be `{kind: 'other', text: '{ a: string; b: number; }'}`
		assert.deepStrictEqual(node, { kind: 'reference', name: 'Inferred' });
	});

	test('each overload recovers through its own return annotation', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export function pick(kind: 'inferred'): Inferred;
export function pick(kind: 'name'): string;
export function pick(kind: string): Inferred | string {
	return kind === 'name' ? '' : { a: '', b: 0 };
}`
		);
		const pick = module.declarations.find((d) => d.name === 'pick');
		assert(pick?.kind === 'function', 'expected a function declaration');
		assert.ok(pick.overloads, 'expected overloads');
		assert.deepStrictEqual(pick.overloads[0]?.returnTypeInfo, {
			kind: 'reference',
			name: 'Inferred'
		});
		assert.strictEqual(pick.overloads[1]?.returnTypeInfo, undefined);
	});

	test('snippet parameters and the prop tree recover the same name', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Snippet<T extends Array<unknown>> {(...args: T): void}

	interface Box {
		out: { a: string; b: number };
	}
	type Inferred = Box['out'];

	let { row }: { row?: Snippet<[item: Inferred]> } = $props();
</script>

<div>{row}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const prop = declaration.props[0];
		assert.ok(prop?.parameters, 'expected snippet parameters');
		const expected: TypeJson = { kind: 'reference', name: 'Inferred' };
		// both projections of the same tuple element read the same annotation —
		// a recovered name can't appear in one and not the other
		assert.deepStrictEqual(prop.parameters[0]?.typeInfo, expected);
		assert(prop.typeInfo?.kind === 'reference', 'expected a Snippet reference');
		const tuple = prop.typeInfo.typeArgs?.[0];
		assert(tuple?.kind === 'tuple', 'expected a tuple typeArg');
		assert.deepStrictEqual(tuple.elements?.[0]?.type, expected);
	});

	test('type parameters stay inert in generic contexts', async () => {
		const module = await analyzeFile('src/lib/a.ts', `export const id = <T>(x: T): T => x;`);
		const id = module.declarations.find((d) => d.name === 'id');
		assert(id?.kind === 'function', 'expected a function declaration');
		// a written \`T\` names nothing recoverable — both fields stay absent
		assert.strictEqual(id.parameters?.[0]?.typeInfo, undefined);
		assert.strictEqual(id.returnTypeInfo, undefined);
	});

	test('recovered names are identifiers — no comment or newline survives', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`${INFERRED_SETUP}
export const f = (): /* leading */ Inferred /* trailing */ | undefined => undefined;`
		);
		const f = module.declarations.find((d) => d.name === 'f');
		assert(f?.kind === 'function', 'expected a function declaration');
		const names: Array<string> = [];
		const collect = (node: TypeJson | undefined): void => {
			if (!node) return;
			if (node.kind === 'reference') {
				names.push(node.name);
				node.typeArgs?.forEach(collect);
			} else if (node.kind === 'union' || node.kind === 'intersection') {
				node.members.forEach(collect);
			} else if (node.kind === 'array') {
				collect(node.element);
			} else if (node.kind === 'tuple') {
				node.elements?.forEach((el) => {
					collect(el.type);
				});
			}
		};
		collect(f.returnTypeInfo);
		assert.deepStrictEqual(names, ['Inferred']);
		for (const name of names) {
			assert.match(name, /^[A-Za-z_$][\w$]*$/);
		}
	});
});

describe('prop source order', () => {
	test('props emit in source order, not checker order', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/A.svelte': `<script lang="ts">
	interface Props {
		c?: string;
		a: string;
		onx?: () => void;
		b?: boolean;
	}

	let { c, a, onx, b }: Props = $props();
</script>

<div>{c}{a}{b}</div>`
		});
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		assert.deepStrictEqual(
			declaration.props.map((p) => p.name),
			['c', 'a', 'onx', 'b']
		);
	});
});
