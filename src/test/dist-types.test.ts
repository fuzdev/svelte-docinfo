import { test, assert } from 'vitest';
import ts from 'typescript';
import * as s from '@fuzdev/fuz_schema/schema.ts';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';

import * as types from '#lib/types.ts';
import * as diagnostics from '#lib/diagnostics.ts';
import * as analyzeCore from '#lib/analyze-core.ts';

// Consumers typecheck against the emitted declarations, not the source, and
// two failures there are invisible to this repo's own typecheck: TS2589
// ("excessively deep") when inferred schema types are written out
// structurally, and declarations that balloon for the same reason without
// reaching that limit. This emits the `src/lib` declarations in memory, checks
// that the schema modules stay referential and within a size budget, and
// typechecks a consumer against them, with `declaration` on so composing the
// exported schemas must produce nameable types too.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LIB_DIR = join(ROOT, 'src/lib');
// virtual: emitted files live only in memory, served by the consumer's host
const DIST_DIR = join(ROOT, '__dist_types__');
const CONSUMER_PATH = join(ROOT, '__dist_types_consumer__.ts');

const CONSUMER = `
import * as s from '@fuzdev/fuz_schema/schema.js';
import {
	analyze,
	analyzeFromFiles,
	parseAnalyzeResult,
	parseModuleJson,
	parseDiagnostics,
	createSourceOptions,
	AnalyzeResultJson,
	type Diagnostic
} from './__dist_types__/index.js';
import {
	ModuleJson,
	DeclarationJson,
	type FunctionDeclarationJsonInput,
	type ModuleJsonInput,
	type ParameterJsonInput
} from './__dist_types__/types.js';
import { isKind } from './__dist_types__/declaration-helpers.js';

export const ComposedModules = s.array(ModuleJson);
export const ComposedResult = s.object({ result: AnalyzeResultJson, at: s.string });

// inferred positions over a schema's input type and an entry: the emitted
// declarations must be able to name them
export const inputOf = <T extends s.Schema>(_schema: T) => (x: unknown) => x as s.InferInput<T>;
export const resultInput = inputOf(AnalyzeResultJson);
export const moduleInput = inputOf(ModuleJson);
export const resultModules = AnalyzeResultJson.def.modules;

export const consume = async (): Promise<number> => {
	let r1: AnalyzeResultJson = await analyze({ sourceFiles: [], sourceOptions: createSourceOptions('/') });
	r1 = parseAnalyzeResult({});
	const r2 = await analyzeFromFiles({ projectRoot: '.' });
	const m: ModuleJson = parseModuleJson({ path: 'a.ts' });
	const input: ModuleJsonInput = { path: 'a.ts' };
	const p: ParameterJsonInput = { name: 'a', type: 'string' };
	const f: FunctionDeclarationJsonInput = { name: 'f', kind: 'function' };
	const d: DeclarationJson | undefined = m.declarations[0];
	const n = d && isKind(d, 'function') ? d.parameters.length : 0;
	const diagnostics: Array<Diagnostic> = parseDiagnostics([]);
	const composed = s.parse_or_throw(ComposedResult, { result: {}, at: 'x' });
	return (
		r1.modules.length +
		r2.modules.length +
		diagnostics.length +
		n +
		input.path.length +
		p.name.length +
		f.name.length +
		s.parse_or_throw(ComposedModules, []).length +
		composed.result.diagnostics.length
	);
};
`;

// the modules that export schemas, by emitted basename
const SCHEMA_MODULES: Record<string, Record<string, unknown>> = {
	types,
	diagnostics,
	'analyze-core': analyzeCore
};

// `schema.ts` references fuz_schema for the shared helpers and exports no schema
const SCHEMA_HELPERS_MODULE = 'schema';

// Ceiling on the schema modules' combined declaration text, in characters.
// The TS2589 check only bites once most schemas have lost their names, and
// the per-schema check below only sees exported consts, so this is the
// backstop for structure inlined some other way (a nested unexported schema,
// a shared fragment). The ceiling leaves headroom over the current emit for
// ordinary schema growth, and sits far below what wholesale inlining
// produces. Raise it deliberately when the schemas really grow,
// after checking nothing was inlined.
const SCHEMA_DECLARATIONS_BUDGET = 180_000;

const isSchema = (value: unknown): boolean => s.is_schema(value);

// every exported schema, composed the ways a consumer would (wrapped, inferred
// both ways, parsed), so naming one schema can't hide another's depth
const buildComposeConsumer = (): string => {
	const lines: Array<string> = [];
	for (const [module, exports] of Object.entries(SCHEMA_MODULES)) {
		const alias = module.replace('-', '_');
		lines.push(`import * as ${alias} from './__dist_types__/${module}.js';`);
		for (const [name, value] of Object.entries(exports)) {
			if (!isSchema(value)) continue;
			const ref = `${alias}.${name}`;
			const id = `${alias}_${name}`;
			lines.push(
				`export const ${id}_array = s.array(${ref});`,
				`export const ${id}_wrapped = s.object({ value: ${ref}, list: s.with_default_fn(s.array(${ref}), () => []) });`,
				`export type ${id}_out = s.Infer<typeof ${id}_wrapped>;`,
				`export type ${id}_in = s.InferInput<typeof ${id}_wrapped>;`,
				`export const ${id}_parse = (u: unknown): ${id}_out => s.parse_or_throw(${id}_wrapped, u);`
			);
		}
	}
	return lines.join('\n') + '\n';
};

const emitLibDeclarations = (): Map<string, string> => {
	const emitted: Map<string, string> = new Map();
	const program = ts.createProgram([join(LIB_DIR, 'index.ts')], {
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		strict: true,
		declaration: true,
		emitDeclarationOnly: true,
		allowImportingTsExtensions: true,
		rewriteRelativeImportExtensions: true,
		skipLibCheck: true,
		rootDir: LIB_DIR,
		outDir: DIST_DIR
	});
	const result = program.emit(undefined, (fileName, text) => {
		emitted.set(fileName, text);
	});
	assert.deepStrictEqual(
		result.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
		[]
	);
	return emitted;
};

test('emitted declarations typecheck for a consumer', { timeout: 120_000 }, () => {
	const emitted = emitLibDeclarations();
	assert.ok(emitted.has(join(DIST_DIR, 'index.d.ts')), 'expected emitted declarations');

	let schemaDeclarationsSize = 0;
	for (const module of Object.keys(SCHEMA_MODULES)) {
		const text = emitted.get(join(DIST_DIR, `${module}.d.ts`));
		assert.ok(text, `expected ${module}.d.ts`);
		schemaDeclarationsSize += text.length;
	}

	// a schema exported from any other module would escape every check here
	const schemaLibModules = [...emitted]
		.filter(
			([fileName, text]) =>
				fileName.endsWith('.d.ts') && /['"]@fuzdev\/fuz_schema\/schema\.(?:ts|js)['"]/.test(text)
		)
		.map(([fileName]) => basename(fileName, '.d.ts'))
		.sort();
	assert.deepStrictEqual(
		schemaLibModules,
		[...Object.keys(SCHEMA_MODULES), SCHEMA_HELPERS_MODULE].sort()
	);
	assert.isBelow(schemaDeclarationsSize, SCHEMA_DECLARATIONS_BUDGET);

	// no exported schema's declared type writes out an object structure:
	// losing one name grows the total too little for the budget to notice
	for (const [module, exports] of Object.entries(SCHEMA_MODULES)) {
		const text = emitted.get(join(DIST_DIR, `${module}.d.ts`))!;
		for (const [name, value] of Object.entries(exports)) {
			if (!isSchema(value)) continue;
			const declared = new RegExp(`^export declare const ${name}: ([^;]*);`, 'm').exec(text);
			assert.ok(declared, `expected a declaration for ${name} in ${module}.d.ts`);
			assert.notInclude(declared[1], '{', `${name} is declared structurally`);
			// a `FooSchema`'s output and input are interfaces under the public names,
			// so errors and hovers print `Foo`, never a `@nodocs` name (the recursive
			// schemas are typed by hand-written interfaces of their own)
			if (declared[1] === `${name}Schema`) {
				for (const [type, base] of [
					[name, 'SchemaStrictObjectOutput'],
					[`${name}Input`, 'SchemaStrictObjectInput']
				]) {
					assert.match(
						text,
						new RegExp(`^export interface ${type} extends s\\.${base}<`, 'm'),
						`expected ${type} as an interface in ${module}.d.ts`
					);
				}
			}
		}
		assert.notMatch(
			text,
			/\w+Schema(?:Output|Input)\b/,
			`${module}.d.ts names a *SchemaOutput type`
		);
	}

	const composed = buildComposeConsumer();
	assert.include(composed, 'types_ModuleJson_wrapped');
	assert.include(composed, 'diagnostics_Diagnostic_wrapped');
	assert.include(composed, 'analyze_core_AnalyzeResultJson_wrapped');
	const consumerText = CONSUMER + composed;

	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		strict: true,
		declaration: true,
		emitDeclarationOnly: true,
		skipLibCheck: true
	};
	const host = ts.createCompilerHost(options);
	const readFile = host.readFile.bind(host);
	const fileExists = host.fileExists.bind(host);
	const directoryExists = host.directoryExists?.bind(host) ?? ts.sys.directoryExists;
	const getSourceFile = host.getSourceFile.bind(host);
	const served = (path: string): string | undefined =>
		path === CONSUMER_PATH ? consumerText : emitted.get(path);
	host.readFile = (path) => served(path) ?? readFile(path);
	host.fileExists = (path) => served(path) !== undefined || fileExists(path);
	host.directoryExists = (path) => path.startsWith(DIST_DIR) || directoryExists(path);
	host.getSourceFile = (path, languageVersion, onError, shouldCreate) => {
		const text = served(path);
		if (text !== undefined) return ts.createSourceFile(path, text, languageVersion);
		return getSourceFile(path, languageVersion, onError, shouldCreate);
	};
	const consumer = ts.createProgram([CONSUMER_PATH], options, host);
	const diagnostics = ts
		.getPreEmitDiagnostics(consumer)
		.filter((d) => d.file?.fileName === CONSUMER_PATH)
		.map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
	assert.deepStrictEqual(diagnostics, []);
});
