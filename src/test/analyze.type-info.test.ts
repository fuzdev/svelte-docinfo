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
 * members, the depth cap on recursive aliases, and the `compactReplacer`
 * round-trip for a literal `false` value (the one data-bearing `false` on the
 * wire). Fixture lock-ins: `ts/types/type-info` and `svelte/props/type-info`.
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
		// annotated property — AST-backed written text, no tree
		const annotated = declaration.members.find((m) => m.name === 'b');
		assert(annotated?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(annotated.typeInfo, undefined);
		// getter-backed accessor — checker-backed like the inferred property
		const accessor = declaration.members.find((m) => m.name === 'c');
		assert(accessor?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(accessor.typeInfo, expected);
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
		// isn't resolvable in the temp test project; detection is by type string
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

	test('a terminal alias reprints what the alias stands for', async () => {
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
		// printed with `InTypeAlias`, else the text would repeat the alias name
		assert.deepStrictEqual(declaration.typeInfo, {
			kind: 'other',
			text: '[a: string, b: B]'
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
