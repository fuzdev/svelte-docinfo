/**
 * Tests for the identity-keyed alias registry and the `alias_lost` diagnostic,
 * through the real pipeline with real zod (`analyze()` over in-memory files
 * rooted at the repo cwd, so `'zod'` resolves via this repo's node_modules —
 * the ts fixture harness is `noResolve` with a stub lib and can't express
 * these).
 *
 * What only real zod can lock: the safety gate keyed on `namedSymbolName`'s
 * `__`-prefix rule (real inferred object outputs carry
 * `Mapped | Instantiated`, not `ObjectFlags.Anonymous` — a gate keyed on the
 * flag would silently register nothing), the recursive getter pattern (a
 * cyclic lost type that overflows an unguarded containment walk), `z.enum`
 * non-recovery (interned literal unions must never register), the `z.input`
 * family, and lib-dependent absence flips (`Array<Lost>`, `Promise<Lost>`
 * instantiations don't exist under the stub lib). Simulation-based fixture
 * locks live at `ts/declarations/{variable,function}/alias-lost-inferred`,
 * `ts/declarations/type/alias-lost-{callable,nullable-optional}`, and
 * `svelte/component/zod-merged-schema`.
 */

import { test, assert, describe, beforeAll } from 'vitest';
import { join } from 'node:path';

import { analyze } from '$lib/analyze.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';
import { byKind } from '$lib/diagnostics.ts';
import type { DeclarationJson, ModuleJson, TypeJson } from '$lib/types.ts';

import { testSourceOptions } from './test-module-helpers.ts';

const SCHEMAS = `import { z } from 'zod';

/** The canonical schema/type pair — a merged value+type symbol. */
export const Point = z.strictObject({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;
/** Identity-equal to \`Point\` — enters the ambiguity set, loses the tie-break. */
export type PointOutput = z.output<typeof Point>;

/** \`.default()\` splits input and output into distinct types. */
export const WithDefault = z.strictObject({ a: z.string().default('x') });
export type WithDefault = z.infer<typeof WithDefault>;
export type WithDefaultInput = z.input<typeof WithDefault>;

/** A literal union — interned, never registrable, excluded from the warning. */
export const Kind = z.enum(['a', 'b']);
export type Kind = z.infer<typeof Kind>;

/** A null-bearing union — the member-set side index's case. */
export const NullableSchema = Point.nullable();
export type NullablePoint = z.infer<typeof NullableSchema>;

/** zod 4's documented recursive pattern — a cyclic lost type. */
export const Category = z.strictObject({
	name: z.string(),
	get children() {
		return z.array(Category);
	}
});
export type Category = z.infer<typeof Category>;

/** Two aliases over one schema — the tie-break decides the single winner. */
export const Twin = z.strictObject({ t: z.string() });
export type TwinB = z.infer<typeof Twin>;
export type TwinA = z.output<typeof Twin>;

/** A primitive union — lost, unrecoverable, not excluded: the warning's residue. */
export const Id = z.union([z.string(), z.number()]);
export type Id = z.infer<typeof Id>;

/** A brand intersection — lost and unrecoverable but excluded from the warning. */
export const Uid = z.string().brand<'Uid'>();
export type Uid = z.infer<typeof Uid>;

/** An array-root loss — \`namedSymbolName\` is \`Array\`, outside the predicate. */
export const ArrSchema = z.array(z.strictObject({ a: z.string() }));
export type Arr = z.infer<typeof ArrSchema>;

const HiddenSchema = z.strictObject({ h: z.string() });
/** @nodocs */
export type Hidden = z.infer<typeof HiddenSchema>;

declare const hiddenSeed: Hidden;
/** Inferred position of the nodocs-excluded alias — must not recover its name. */
export const derivedHidden = hiddenSeed;
`;

const CONSUMERS = `import {
	ArrSchema,
	Category,
	Kind,
	Point,
	Twin,
	type NullablePoint,
	type WithDefaultInput
} from './schemas.js';
import { gatedSeed } from './internal/gated.js';

declare const seedInput: WithDefaultInput;

/** Inferred return of the lost type — the registry names it. */
export const parsePoint = (input: unknown) => Point.parse(input);
/** Inferred \`Array<Lost>\` — the element reference makes the absent tree appear. */
export const pointList = (input: unknown) => [Point.parse(input)];
/** Inferred \`Promise<Lost>\` — the typeArg reference makes the absent tree appear. */
export const pointLater = async (input: unknown) => Point.parse(input);
/** The lost type at the depth cap — registry recovery still fires there. */
export const pointDeep = (input: unknown) => [[[[[Point.parse(input)]]]]];
/** Inferred literal union — interned, never recovered. */
export const parseKind = (input: unknown) => Kind.parse(input);
/** Inferred variable of the input-side type. */
export const derivedInput = seedInput;
/** Inferred return of the cyclic lost type. */
export const parseCategory = (input: unknown) => Category.parse(input);
/** Tie-break: recovers the winning twin's name. */
export const parseTwin = (input: unknown) => Twin.parse(input);
/** Array-root loss — outside the predicate, never recovers. */
export const parseArr = (input: unknown) => ArrSchema.parse(input);
/** Inferred variable of a gated module's lost type — must not recover. */
export const derivedGated = gatedSeed;

export type OptionalHolder = {
	maybe?: NullablePoint;
};
`;

// gated by the default `**/internal/**` exclude: owned (passed as input, so
// the checker sees it) but never emitted — its aliases must stay unregistered
const GATED = `interface GBox {
	out: { g: string };
}
export type GatedType = GBox['out'];
export const gatedSeed: GatedType = { g: '' };
`;

// a rename re-export of the unrecoverable residue — synthesis re-analyzes the
// canonical declaration, exercising the `alias_lost` dedupe
const BARREL = `export { Id as PublicId } from './schemas.js';
`;

let result: AnalyzeResultJson;
let schemas: ModuleJson;
let consumers: ModuleJson;

const declOf = (module: ModuleJson, name: string): DeclarationJson => {
	const declaration = module.declarations.find((d) => d.name === name);
	assert.ok(declaration, `expected declaration ${name}`);
	return declaration;
};

/** A registry-recovered reference: registry hits always carry the declaring module. */
const schemaRef = (name: string): TypeJson => ({
	kind: 'reference',
	name,
	module: 'schemas.ts'
});

beforeAll(async () => {
	const projectRoot = process.cwd();
	const files: Record<string, string> = {
		'src/lib/schemas.ts': SCHEMAS,
		'src/lib/consumers.ts': CONSUMERS,
		'src/lib/internal/gated.ts': GATED,
		'src/lib/barrel.ts': BARREL
	};
	result = await analyze({
		sourceFiles: Object.entries(files).map(([path, content]) => ({
			id: join(projectRoot, path),
			content
		})),
		sourceOptions: testSourceOptions()
	});
	schemas = result.modules.find((m) => m.path === 'schemas.ts')!;
	consumers = result.modules.find((m) => m.path === 'consumers.ts')!;
	assert.ok(schemas, 'expected the schemas module');
	assert.ok(consumers, 'expected the consumers module');
}, 60_000);

describe('alias registry over real zod', () => {
	test('an inferred return of a lost object type recovers the registered name', () => {
		// real zod outputs are Mapped | Instantiated, NOT ObjectFlags.Anonymous —
		// recovery here proves the gate keys on the __-prefix symbol rule
		const decl = declOf(consumers, 'parsePoint');
		assert(decl.kind === 'function', 'expected a function');
		// registry hits carry `module` — the winning alias's declaring module
		assert.deepStrictEqual(decl.returnTypeInfo, schemaRef('Point'));
		// the flat string stays the checker's canonical rendering
		assert.strictEqual(decl.returnType, '{ x: number; y: number; }');
	});

	test('Array<Lost> and Promise<Lost> flip from absent to structured', () => {
		// lib-dependent shapes the stub-lib ts harness can't instantiate; without
		// the registry both trees are absent (an anonymous element/typeArg says
		// nothing beyond the flat string)
		const list = declOf(consumers, 'pointList');
		assert(list.kind === 'function', 'expected a function');
		assert.deepStrictEqual(list.returnTypeInfo, {
			kind: 'array',
			element: schemaRef('Point')
		});
		const later = declOf(consumers, 'pointLater');
		assert(later.kind === 'function', 'expected a function');
		// the checker-named `Promise` reference carries no `module` — only the
		// registry-recovered typeArg does
		assert.deepStrictEqual(later.returnTypeInfo, {
			kind: 'reference',
			name: 'Promise',
			typeArgs: [schemaRef('Point')]
		});
	});

	test('registry recovery fires at the depth cap, module included', () => {
		// five array levels put the element at MAX_TYPE_JSON_DEPTH — the cap
		// branch consults recovery before degrading to elided text, and a
		// registry hit there carries `module` like any other
		const decl = declOf(consumers, 'pointDeep');
		assert(decl.kind === 'function', 'expected a function');
		let node = decl.returnTypeInfo;
		for (let i = 0; i < 5; i++) {
			assert(node?.kind === 'array', `expected an array node at depth ${i}`);
			node = node.element;
		}
		assert.deepStrictEqual(node, schemaRef('Point'));
	});

	test('z.enum outputs never register — interned literal unions expand', () => {
		const decl = declOf(consumers, 'parseKind');
		assert(decl.kind === 'function', 'expected a function');
		assert(decl.returnTypeInfo?.kind === 'union', 'expected a union tree');
		assert.deepStrictEqual(decl.returnTypeInfo.members, [
			{ kind: 'literal', value: 'a', text: '"a"' },
			{ kind: 'literal', value: 'b', text: '"b"' }
		]);
	});

	test('the z.input family registers beside the output type', () => {
		const decl = declOf(consumers, 'derivedInput');
		assert(decl.kind === 'variable', 'expected a variable');
		assert.deepStrictEqual(decl.typeInfo, schemaRef('WithDefaultInput'));
	});

	test('a cyclic lost type registers without crashing and recovers', () => {
		// zod 4's recursive getter pattern — the containment walk's seen-set is
		// what keeps registration from overflowing
		const decl = declOf(consumers, 'parseCategory');
		assert(decl.kind === 'function', 'expected a function');
		assert.deepStrictEqual(decl.returnTypeInfo, schemaRef('Category'));
	});

	test('own-declaration self-skip: the pair documents structurally, nested self-hits stay live', () => {
		const decl = declOf(schemas, 'Category');
		assert(decl.kind === 'type', 'expected a type declaration');
		// no self-reference collapse at the declaration: members carry the shape
		assert.strictEqual(decl.typeInfo, undefined);
		const names = decl.members.map((m) => m.name);
		assert.deepStrictEqual(names, ['name', 'children']);
		// the nested self-hit terminates the recursive type with its name
		const children = decl.members.find((m) => m.name === 'children');
		assert(children?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(children.typeInfo, {
			kind: 'array',
			element: schemaRef('Category')
		});
	});

	test('ambiguity resolves to a global single winner via compareStrings', () => {
		// TwinA and TwinB are identity-equal; declaration order says TwinB first,
		// the tie-break says TwinA everywhere
		const decl = declOf(consumers, 'parseTwin');
		assert(decl.kind === 'function', 'expected a function');
		assert.deepStrictEqual(decl.returnTypeInfo, schemaRef('TwinA'));
		// same rule keeps parsePoint on 'Point' over its 'PointOutput' twin
	});

	test('null-bearing optional recovers through the member-set side index', () => {
		// the optional widening flattens `NullablePoint | undefined` past identity
		// match; the surviving members' id set still keys the registered union
		const holder = declOf(consumers, 'OptionalHolder');
		assert(holder.kind === 'type', 'expected a type declaration');
		const maybe = holder.members.find((m) => m.name === 'maybe');
		assert(maybe?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(maybe.optional, true);
		assert.strictEqual(maybe.typeSignature, '{ x: number; y: number; } | null');
		assert.deepStrictEqual(maybe.typeInfo, schemaRef('NullablePoint'));
	});

	test('an array-root loss stays outside the predicate — documented v1 boundary', () => {
		// `Arr` resolves to `{ a: string }[]`, whose symbol is `Array` — named by
		// `namedSymbolName`, so `isAliasLostType` declines and nothing registers;
		// the anonymous element recovers nothing and the tree stays absent
		const decl = declOf(consumers, 'parseArr');
		assert(decl.kind === 'function', 'expected a function');
		assert.strictEqual(decl.returnTypeInfo, undefined);
	});

	test('@nodocs aliases never register', () => {
		const decl = declOf(schemas, 'derivedHidden');
		assert(decl.kind === 'variable', 'expected a variable');
		assert.strictEqual(decl.typeInfo, undefined);
	});

	test('gated-module aliases never register', () => {
		// `internal/gated.ts` is owned checker context but emits no module, so
		// its lost alias has no doc page — a reference would dangle
		assert.strictEqual(
			result.modules.find((m) => m.path.includes('gated')),
			undefined
		);
		const decl = declOf(consumers, 'derivedGated');
		assert(decl.kind === 'variable', 'expected a variable');
		assert.strictEqual(decl.typeInfo, undefined);
	});

	test('every reference `module` in the output names an emitted module', () => {
		// the no-dangling-links invariant: `module` is emitted only from registry
		// entries, and only emitted modules register, so a `(module, name)`
		// lookup always lands on a module in this output
		const emittedPaths = new Set(result.modules.map((m) => m.path));
		const moduleRefs: Array<string> = [];
		const walk = (value: unknown): void => {
			if (Array.isArray(value)) {
				for (const entry of value) walk(entry);
				return;
			}
			if (value === null || typeof value !== 'object') return;
			const record = value as Record<string, unknown>;
			if (record.kind === 'reference' && typeof record.module === 'string') {
				moduleRefs.push(record.module);
			}
			for (const entry of Object.values(record)) walk(entry);
		};
		walk(result.modules);
		assert.ok(moduleRefs.length > 0, 'expected registry-recovered references in the corpus');
		for (const module of moduleRefs) {
			assert.ok(emittedPaths.has(module), `expected an emitted module for ${module}`);
		}
	});
});

describe('alias_lost diagnostic', () => {
	test('fires exactly on the unrecoverable, non-excluded residue', () => {
		// one loss in the corpus is neither registry-recoverable nor excluded:
		// `Id` (a primitive union — interned, no anonymous component, not a
		// literal union, not a brand). Everything else self-heals or is excluded:
		// recoverable losses (Point, WithDefault(+Input), NullablePoint,
		// Category, TwinA), the recoverable twins suppressed by type identity
		// (PointOutput, TwinB), `z.enum` literal unions (Kind), brand
		// intersections (Uid), array-root shapes outside the predicate (Arr),
		// and `@nodocs` (Hidden). Exactly-one also locks the synthesis dedupe:
		// the barrel's rename re-analyzes `Id`'s declaration and must not
		// warn a second time
		const warnings = byKind(result.diagnostics, 'alias_lost');
		assert.deepStrictEqual(
			warnings.map((w) => w.aliasName),
			['Id']
		);
		const warning = warnings[0]!;
		assert.strictEqual(warning.severity, 'warning');
		assert.strictEqual(warning.file, 'src/lib/schemas.ts');
		assert.ok(warning.line !== undefined && warning.line > 0);
		assert.include(warning.message, '"Id"');
	});

	test('the rename synthesis the dedupe guards against actually ran', () => {
		// keeps the exactly-one assertion above honest: if synthesis ever stops
		// re-analyzing the canonical, the dedupe would be locking nothing
		const barrel = result.modules.find((m) => m.path === 'barrel.ts');
		assert.ok(barrel, 'expected the barrel module');
		const publicId = barrel.declarations.find((d) => d.name === 'PublicId');
		assert.ok(publicId, 'expected the synthesized rename alias');
		assert.deepStrictEqual(publicId.aliasOf, { module: 'schemas.ts', name: 'Id' });
	});

	test('never fires on the svelte2tsx-internal component alias', async () => {
		// a generic component's virtual carries `type <Name>__SvelteComponent_`
		// with an alias-lost RHS by construction — not an author-side type (the
		// svelte layer filters it from declarations), so it must not warn.
		// Surfaced by the whole-module fixture capture: every generic component
		// warned once per analysis. In-memory analysis over a cwd-rooted id
		// (the beforeAll idiom) so the virtual's `svelte` imports resolve — in
		// an isolated tmpdir the loss predicate fails on error types and the
		// assertion passes vacuously
		const genericComponent = `<script lang="ts" generics="T">
	let { prop1 }: { prop1: Array<T> } = $props();
</script>

{#each prop1 as item}{String(item)}{/each}
`;
		const generic = await analyze({
			sourceFiles: [
				{ id: join(process.cwd(), 'src/lib/Widget.svelte'), content: genericComponent }
			],
			sourceOptions: testSourceOptions()
		});
		assert.deepStrictEqual(byKind(generic.diagnostics, 'alias_lost'), []);
		assert.ok(
			generic.modules[0]?.declarations.some((d) => d.kind === 'component'),
			'expected the component to analyze'
		);
	});
});
