/**
 * Tests for the identity-keyed alias registry and the `alias_lost` diagnostic,
 * through the real pipeline with a real schema library (`analyze()` over
 * in-memory files rooted at the repo cwd, so `'valibot'` resolves via this
 * repo's node_modules — the ts fixture harness is `noResolve` with a stub lib
 * and can't express these).
 *
 * What only a real library can lock: the safety gate keyed on
 * `namedSymbolName`'s `__`-prefix rule (real inferred object outputs carry
 * `Mapped | Instantiated`, not `ObjectFlags.Anonymous` — a gate keyed on the
 * flag would silently register nothing), picklist non-recovery (interned
 * literal unions must never register), the input-side family, and
 * lib-dependent absence flips (`Array<Lost>`, `Promise<Lost>` instantiations
 * don't exist under the stub lib). `v.InferOutput<typeof S>` is an indexed
 * access, so it loses its alias the way every inferred-schema alias does.
 * Simulation-based fixture locks live at
 * `ts/declarations/{variable,function}/alias-lost-inferred`,
 * `ts/declarations/type/alias-lost-{callable,nullable-optional}`, and
 * `svelte/component/valibot-merged-schema`.
 *
 * Recursion is the one shape valibot doesn't lose: its documented recursive
 * pattern declares the type explicitly beside `v.lazy`. The cyclic lost type
 * that a getter-based recursive schema infers (zod's documented pattern) is
 * locked by a dependency-free simulation at the end of this file.
 */

import { test, assert, describe, beforeAll } from 'vitest';
import { join } from 'node:path';
import ts from 'typescript';

import { analyze } from '#lib/analyze.ts';
import type { AnalyzeResultJson } from '#lib/analyze-core.ts';
import { byKind } from '#lib/diagnostics.ts';
import { createAnalysisSession } from '#lib/session.ts';
import type { DeclarationJson, ModuleJson, TypeJson } from '#lib/types.ts';

import { testSourceOptions } from './test-module-helpers.ts';

const SCHEMAS = `import * as v from 'valibot';

/** The canonical schema/type pair — a merged value+type symbol. */
export const Point = v.strictObject({ x: v.number(), y: v.number() });
export type Point = v.InferOutput<typeof Point>;
/** Identity-equal to \`Point\` — enters the ambiguity set, loses the tie-break. */
export type PointOutput = v.InferOutput<typeof Point>;

/** A default splits input and output into distinct types. */
export const WithDefault = v.strictObject({ a: v.optional(v.string(), 'x') });
export type WithDefault = v.InferOutput<typeof WithDefault>;
export type WithDefaultInput = v.InferInput<typeof WithDefault>;

/** A literal union — interned, never registrable, excluded from the warning. */
export const Kind = v.picklist(['a', 'b']);
export type Kind = v.InferOutput<typeof Kind>;

/** A null-bearing union — the member-set side index's case. */
export const NullableSchema = v.nullable(Point);
export type NullablePoint = v.InferOutput<typeof NullableSchema>;

/** valibot's documented recursive pattern — an explicit type beside \`v.lazy\`. */
export type Category = { name: string; children: Array<Category> };
export const Category: v.GenericSchema<Category> = v.strictObject({
	name: v.string(),
	children: v.array(v.lazy(() => Category))
});

/** Two aliases over one schema — the tie-break decides the single winner. */
export const Twin = v.strictObject({ t: v.string() });
export type TwinB = v.InferOutput<typeof Twin>;
export type TwinA = v.InferOutput<typeof Twin>;

/** A primitive union — lost, unrecoverable, not excluded: the warning's residue. */
export const Id = v.union([v.string(), v.number()]);
export type Id = v.InferOutput<typeof Id>;

/** A brand intersection — lost and unrecoverable but excluded from the warning. */
export const Uid = v.pipe(v.string(), v.brand('Uid'));
export type Uid = v.InferOutput<typeof Uid>;

/** An array-root loss — \`namedSymbolName\` is \`Array\`, outside the predicate. */
export const ArrSchema = v.array(v.strictObject({ a: v.string() }));
export type Arr = v.InferOutput<typeof ArrSchema>;

const HiddenSchema = v.strictObject({ h: v.string() });
/** @nodocs */
export type Hidden = v.InferOutput<typeof HiddenSchema>;

declare const hiddenSeed: Hidden;
/** Inferred position of the nodocs-excluded alias — must not recover its name. */
export const derivedHidden = hiddenSeed;
`;

const CONSUMERS = `import * as v from 'valibot';
import {
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
export const parsePoint = (input: unknown) => v.parse(Point, input);
/** Inferred \`Array<Lost>\` — the element reference makes the absent tree appear. */
export const pointList = (input: unknown) => [v.parse(Point, input)];
/** Inferred \`Promise<Lost>\` — the typeArg reference makes the absent tree appear. */
export const pointLater = async (input: unknown) => v.parse(Point, input);
/** The lost type at the depth cap — registry recovery still fires there. */
export const pointDeep = (input: unknown) => [[[[[v.parse(Point, input)]]]]];
/** Inferred literal union — interned, never recovered. */
export const parseKind = (input: unknown) => v.parse(Kind, input);
/** Inferred variable of the input-side type. */
export const derivedInput = seedInput;
/** Inferred return of the explicitly typed recursive schema. */
export const parseCategory = (input: unknown) => v.parse(Category, input);
/** Tie-break: recovers the winning twin's name. */
export const parseTwin = (input: unknown) => v.parse(Twin, input);
/** Array-root loss — outside the predicate, never recovers. */
export const parseArr = (input: unknown) => v.parse(ArrSchema, input);
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

describe('alias registry over real valibot', () => {
	test('merged pairs document the type meaning with members', () => {
		const point = declOf(schemas, 'Point');
		assert(point.kind === 'type', 'expected a type declaration');
		assert.strictEqual(point.mergedValue, true);
		assert.strictEqual(point.typeSignature, '{ x: number; y: number; }');
		assert.deepStrictEqual(
			point.members.map((m) => m.name),
			['x', 'y']
		);
		for (const name of ['WithDefault', 'Kind', 'Id', 'Uid', 'Category']) {
			const decl = declOf(schemas, name);
			assert(decl.kind === 'type', `expected a type declaration for ${name}`);
			assert.strictEqual(decl.mergedValue, true, `expected ${name} merged`);
		}
		// a type-only alias over the same schema carries no value meaning
		const pointOutput = declOf(schemas, 'PointOutput');
		assert(pointOutput.kind === 'type', 'expected a type declaration');
		assert.strictEqual(pointOutput.mergedValue, false);
	});

	test('an inferred return of a lost object type recovers the registered name', () => {
		// real inferred outputs are Mapped | Instantiated, NOT ObjectFlags.Anonymous
		// (locked below) — recovery here proves the gate keys on the __-prefix
		// symbol rule
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

	test('picklist outputs never register — interned literal unions expand', () => {
		const decl = declOf(consumers, 'parseKind');
		assert(decl.kind === 'function', 'expected a function');
		assert(decl.returnTypeInfo?.kind === 'union', 'expected a union tree');
		assert.deepStrictEqual(decl.returnTypeInfo.members, [
			{ kind: 'literal', value: 'a', text: '"a"' },
			{ kind: 'literal', value: 'b', text: '"b"' }
		]);
	});

	test('the input-side family registers beside the output type', () => {
		const decl = declOf(consumers, 'derivedInput');
		assert(decl.kind === 'variable', 'expected a variable');
		assert.deepStrictEqual(decl.typeInfo, schemaRef('WithDefaultInput'));
	});

	test('the explicitly typed recursive schema is checker-named, not lost', () => {
		const parseCategory = declOf(consumers, 'parseCategory');
		assert(parseCategory.kind === 'function', 'expected a function');
		assert.strictEqual(parseCategory.returnType, 'Category');
		assert.strictEqual(parseCategory.returnTypeInfo, undefined);
		const category = declOf(schemas, 'Category');
		assert(category.kind === 'type', 'expected a type declaration');
		const children = category.members.find((m) => m.name === 'children');
		assert(children?.kind === 'variable', 'expected a variable member');
		// checker-named, so no registry `module`
		assert.deepStrictEqual(children.typeInfo, {
			kind: 'array',
			element: { kind: 'reference', name: 'Category' }
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
		// recoverable losses (Point, WithDefault(+Input), NullablePoint, TwinA),
		// the recoverable twins suppressed by type identity (PointOutput, TwinB),
		// picklist literal unions (Kind), brand intersections (Uid, a
		// `string & Brand<"Uid">`), array-root shapes outside the predicate (Arr),
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
		// nothing else in the corpus reports at all
		assert.deepStrictEqual(
			result.diagnostics.map((d) => d.kind),
			['alias_lost']
		);
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

// a dependency-free schema library reduced to its type-level shape: a mapped
// output over the shape's entries, read back through a conditional. The
// getter makes the shape refer to its own schema, the recursive pattern that
// infers a cyclic type with no declared name anywhere in the cycle
const SIMULATED = `interface Schema<TOut> {
	readonly out: TOut;
	parse(input: unknown): TOut;
}
type Infer<T> = T extends Schema<infer TOut> ? TOut : never;
declare function str(): Schema<string>;
declare function arr<T>(element: T): Schema<Array<Infer<T>>>;
declare function obj<T extends object>(shape: T): Schema<{ [K in keyof T]: Infer<T[K]> }>;

/** A getter-based recursive schema — a cyclic lost type. */
export const Category = obj({
	name: str(),
	get children() {
		return arr(Category);
	}
});
export type Category = Infer<typeof Category>;

/** Inferred return of the cyclic lost type. */
export const parseCategory = (input: unknown) => Category.parse(input);
`;

describe('alias registry over a cyclic lost type', () => {
	let simulated: ModuleJson;

	/** A registry-recovered reference into the simulated module. */
	const simulatedRef = (name: string): TypeJson => ({
		kind: 'reference',
		name,
		module: 'simulated.ts'
	});

	beforeAll(async () => {
		const simulatedResult = await analyze({
			sourceFiles: [{ id: join(process.cwd(), 'src/lib/simulated.ts'), content: SIMULATED }],
			sourceOptions: testSourceOptions()
		});
		assert.deepStrictEqual(simulatedResult.diagnostics, []);
		simulated = simulatedResult.modules.find((m) => m.path === 'simulated.ts')!;
		assert.ok(simulated, 'expected the simulated module');
	}, 60_000);

	test('a cyclic lost type registers without crashing and recovers', () => {
		// registration and recovery both terminate on a type that contains
		// itself, and the inferred position takes the alias's name
		const decl = declOf(simulated, 'parseCategory');
		assert(decl.kind === 'function', 'expected a function');
		assert.deepStrictEqual(decl.returnTypeInfo, simulatedRef('Category'));
	});

	test('own-declaration self-skip: the pair documents structurally, nested self-hits stay live', () => {
		const decl = declOf(simulated, 'Category');
		assert(decl.kind === 'type', 'expected a type declaration');
		assert.strictEqual(decl.mergedValue, true);
		// no self-reference collapse at the declaration: members carry the shape
		assert.strictEqual(decl.typeInfo, undefined);
		const names = decl.members.map((m) => m.name);
		assert.deepStrictEqual(names, ['name', 'children']);
		// the nested self-hit terminates the recursive type with its name
		const children = decl.members.find((m) => m.name === 'children');
		assert(children?.kind === 'variable', 'expected a variable member');
		assert.deepStrictEqual(children.typeInfo, {
			kind: 'array',
			element: simulatedRef('Category')
		});
	});
});

describe('the safety-gate depth bound', () => {
	/** A lost union over `levels` array levels around an anonymous object. */
	const analyzeDeep = async (levels: number): Promise<AnalyzeResultJson> =>
		analyze({
			sourceFiles: [
				{
					id: join(process.cwd(), 'src/lib/deep.ts'),
					content: `interface Box {
	deep: { a: string }${'[]'.repeat(levels)} | null;
}
export type Deep = Box['deep'];
declare const seed: Deep;
export const d = seed;
`
				}
			],
			sourceOptions: testSourceOptions()
		});

	const deepOf = (result: AnalyzeResultJson): DeclarationJson =>
		declOf(result.modules.find((m) => m.path === 'deep.ts')!, 'd');

	test('a container within the bound registers and recovers', async () => {
		const result = await analyzeDeep(9);
		assert.deepStrictEqual(result.diagnostics, []);
		const d = deepOf(result);
		assert(d.kind === 'variable', 'expected a variable');
		assert.deepStrictEqual(d.typeInfo, { kind: 'reference', name: 'Deep', module: 'deep.ts' });
	}, 60_000);

	test('past the bound the alias stays unregistered and alias_lost reports it', async () => {
		const result = await analyzeDeep(10);
		const d = deepOf(result);
		assert(d.kind === 'variable', 'expected a variable');
		assert.strictEqual(d.typeInfo?.kind, 'union');
		const lost = byKind(result.diagnostics, 'alias_lost');
		assert.deepStrictEqual(
			lost.map((w) => w.aliasName),
			['Deep']
		);
	}, 60_000);
});

describe('the shape of a lost object type', () => {
	test('inferred schema outputs are Mapped | Instantiated, never Anonymous', async () => {
		// keeps the recovery tests above honest about what they prove: were
		// these types `ObjectFlags.Anonymous`, a gate keyed on that flag would
		// pass them too, and nothing would hold the `__`-prefix rule in place
		const session = createAnalysisSession({ sourceOptions: testSourceOptions() });
		try {
			const files = {
				'src/lib/schemas.ts': SCHEMAS,
				'src/lib/simulated.ts': SIMULATED
			};
			await session.setFiles(
				Object.entries(files).map(([path, content]) => ({
					id: join(process.cwd(), path),
					content
				}))
			);
			const program = session.getProgram();
			const checker = program.getTypeChecker();
			for (const [path, aliasName] of [
				['src/lib/schemas.ts', 'Point'],
				['src/lib/simulated.ts', 'Category']
			] as const) {
				const sourceFile = program.getSourceFile(join(process.cwd(), path));
				assert.ok(sourceFile, `expected a source file for ${path}`);
				const alias = sourceFile.statements.find(
					(node): node is ts.TypeAliasDeclaration =>
						ts.isTypeAliasDeclaration(node) && node.name.text === aliasName
				);
				assert.ok(alias, `expected the ${aliasName} alias in ${path}`);
				const type = checker.getTypeFromTypeNode(alias.type);
				assert.strictEqual(type.aliasSymbol, undefined, `expected ${aliasName} to lose its alias`);
				assert.ok(type.flags & ts.TypeFlags.Object, `expected ${aliasName} to be an object type`);
				const { objectFlags } = type as ts.ObjectType;
				assert.ok(objectFlags & ts.ObjectFlags.Mapped, `expected ${aliasName} to be mapped`);
				assert.ok(
					objectFlags & ts.ObjectFlags.Instantiated,
					`expected ${aliasName} to be instantiated`
				);
				assert.ok(
					!(objectFlags & ts.ObjectFlags.Anonymous),
					`expected ${aliasName} not to be anonymous`
				);
			}
		} finally {
			session.dispose();
		}
	});
});
