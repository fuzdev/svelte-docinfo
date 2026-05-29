import {test, assert, describe} from 'vitest';
import {z} from 'zod';

import {
	byKind,
	Diagnostic,
	errorsOf,
	formatDiagnostic,
	hasErrors,
	hasWarnings,
	warningsOf,
	type ClassMemberDiagnostic,
	type MisplacedTagDiagnostic,
	type ModuleSkippedDiagnostic,
	type SignatureAnalysisDiagnostic,
	type SveltePropDiagnostic,
	type TypeExtractionDiagnostic,
	type UnknownParamDiagnostic,
} from '$lib/diagnostics.js';

/**
 * Create a type extraction diagnostic for testing.
 */
const createTypeDiagnostic = (
	overrides: Partial<TypeExtractionDiagnostic> = {},
): TypeExtractionDiagnostic => ({
	kind: 'type_extraction_failed',
	file: 'src/lib/test.ts',
	line: 10,
	column: 5,
	message: 'Failed to extract type',
	severity: 'error',
	symbolName: 'testSymbol',
	...overrides,
});

/**
 * Create a signature analysis diagnostic for testing.
 */
const createSignatureDiagnostic = (
	overrides: Partial<SignatureAnalysisDiagnostic> = {},
): SignatureAnalysisDiagnostic => ({
	kind: 'signature_analysis_failed',
	file: 'src/lib/helpers.ts',
	line: 25,
	column: 1,
	message: 'Failed to analyze signature',
	severity: 'warning',
	functionName: 'helperFn',
	...overrides,
});

/**
 * Create a class member diagnostic for testing.
 */
const createClassMemberDiagnostic = (
	overrides: Partial<ClassMemberDiagnostic> = {},
): ClassMemberDiagnostic => ({
	kind: 'class_member_failed',
	file: 'src/lib/MyClass.ts',
	line: 50,
	column: 3,
	message: 'Failed to analyze class member',
	severity: 'error',
	className: 'MyClass',
	memberName: 'my_method',
	...overrides,
});

/**
 * Create a Svelte prop diagnostic for testing.
 */
const createSveltePropDiagnostic = (
	overrides: Partial<SveltePropDiagnostic> = {},
): SveltePropDiagnostic => ({
	kind: 'svelte_prop_failed',
	file: 'Button.svelte',
	line: 5,
	column: 10,
	message: 'Failed to resolve prop type',
	severity: 'warning',
	componentName: 'Button',
	propName: 'variant',
	...overrides,
});

/**
 * Create a module skipped diagnostic for testing.
 */
const createModuleSkippedDiagnostic = (
	overrides: Partial<ModuleSkippedDiagnostic> = {},
): ModuleSkippedDiagnostic => ({
	kind: 'module_skipped',
	file: 'unknown.xyz',
	message: 'No analyzer for file type',
	severity: 'warning',
	reason: 'no_analyzer',
	...overrides,
});

/**
 * Create a misplaced_tag diagnostic for testing.
 */
const createMisplacedTagDiagnostic = (
	overrides: Partial<MisplacedTagDiagnostic> = {},
): MisplacedTagDiagnostic => ({
	kind: 'misplaced_tag',
	file: 'src/lib/fn.ts',
	line: 5,
	column: 1,
	message: '@example on non-primary overload of "fn"',
	severity: 'warning',
	tagName: 'example',
	functionName: 'fn',
	...overrides,
});

/**
 * Create an unknown_param diagnostic for testing.
 */
const createUnknownParamDiagnostic = (
	overrides: Partial<UnknownParamDiagnostic> = {},
): UnknownParamDiagnostic => ({
	kind: 'unknown_param',
	file: 'src/lib/fn.ts',
	line: 3,
	column: 1,
	message: '@param "argz" on "fn" doesn\'t match any parameter',
	severity: 'warning',
	paramName: 'argz',
	functionName: 'fn',
	...overrides,
});

describe('diagnostics array', () => {
	// Shared test pattern for severity-query helpers (hasErrors / hasWarnings)
	const severityQueryTests = (
		fn: (diagnostics: Array<Diagnostic>) => boolean,
		targetSeverity: 'error' | 'warning',
	) => {
		const oppositeSeverity = targetSeverity === 'error' ? 'warning' : 'error';

		const createTarget =
			targetSeverity === 'error' ? createTypeDiagnostic : createSignatureDiagnostic;
		const createTarget2 =
			targetSeverity === 'error' ? createClassMemberDiagnostic : createSveltePropDiagnostic;
		const createOpposite =
			targetSeverity === 'error' ? createSignatureDiagnostic : createTypeDiagnostic;
		const createOpposite2 =
			targetSeverity === 'error' ? createSveltePropDiagnostic : createClassMemberDiagnostic;

		test(`returns false when no diagnostics`, () => {
			const diagnostics: Array<Diagnostic> = [];
			assert.strictEqual(fn(diagnostics), false);
		});

		test(`returns false when only ${oppositeSeverity}s`, () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createOpposite({severity: oppositeSeverity}));
			diagnostics.push(createOpposite2({severity: oppositeSeverity}));
			assert.strictEqual(fn(diagnostics), false);
		});

		test(`detects at least one ${targetSeverity}`, () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createOpposite({severity: oppositeSeverity}));
			diagnostics.push(createTarget({severity: targetSeverity}));
			assert.strictEqual(fn(diagnostics), true);
		});

		test(`detects all ${targetSeverity}s`, () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createTarget({severity: targetSeverity}));
			diagnostics.push(createTarget2({severity: targetSeverity}));
			assert.strictEqual(fn(diagnostics), true);
		});
	};

	describe('hasErrors', () => severityQueryTests(hasErrors, 'error'));
	describe('hasWarnings', () => severityQueryTests(hasWarnings, 'warning'));

	describe('errorsOf', () => {
		test('returns empty array when no diagnostics', () => {
			const diagnostics: Array<Diagnostic> = [];

			assert.deepEqual(errorsOf(diagnostics), []);
		});

		test('returns empty array when only warnings', () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createSignatureDiagnostic({severity: 'warning'}));
			diagnostics.push(createSveltePropDiagnostic({severity: 'warning'}));

			assert.deepEqual(errorsOf(diagnostics), []);
		});

		test('returns only error diagnostics', () => {
			const diagnostics: Array<Diagnostic> = [];
			const error1 = createTypeDiagnostic({severity: 'error'});
			const warning = createSignatureDiagnostic({severity: 'warning'});
			const error2 = createClassMemberDiagnostic({severity: 'error'});

			diagnostics.push(error1);
			diagnostics.push(warning);
			diagnostics.push(error2);

			const errors = errorsOf(diagnostics);

			assert.strictEqual(errors.length, 2);
			assert.include(errors, error1);
			assert.include(errors, error2);
			assert.notInclude(errors, warning);
		});
	});

	describe('warningsOf', () => {
		test('returns empty array when no diagnostics', () => {
			const diagnostics: Array<Diagnostic> = [];

			assert.deepEqual(warningsOf(diagnostics), []);
		});

		test('returns empty array when only errors', () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createTypeDiagnostic({severity: 'error'}));
			diagnostics.push(createClassMemberDiagnostic({severity: 'error'}));

			assert.deepEqual(warningsOf(diagnostics), []);
		});

		test('returns only warning diagnostics', () => {
			const diagnostics: Array<Diagnostic> = [];
			const error = createTypeDiagnostic({severity: 'error'});
			const warning1 = createSignatureDiagnostic({severity: 'warning'});
			const warning2 = createSveltePropDiagnostic({severity: 'warning'});

			diagnostics.push(error);
			diagnostics.push(warning1);
			diagnostics.push(warning2);

			const warnings = warningsOf(diagnostics);

			assert.strictEqual(warnings.length, 2);
			assert.include(warnings, warning1);
			assert.include(warnings, warning2);
			assert.notInclude(warnings, error);
		});
	});

	describe('byKind', () => {
		test('returns empty array when no diagnostics of kind', () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createTypeDiagnostic());
			diagnostics.push(createSignatureDiagnostic());

			const result = byKind(diagnostics, 'class_member_failed');

			assert.deepEqual(result, []);
		});

		test('filters by type_extraction_failed', () => {
			const diagnostics: Array<Diagnostic> = [];
			const typeDiag = createTypeDiagnostic();
			diagnostics.push(typeDiag);
			diagnostics.push(createSignatureDiagnostic());
			diagnostics.push(createClassMemberDiagnostic());

			const result = byKind(diagnostics, 'type_extraction_failed');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], typeDiag);
			// Verify type narrowing works - accessing symbolName should be valid
			assert.strictEqual(result[0]!.symbolName, 'testSymbol');
		});

		test('filters by signature_analysis_failed', () => {
			const diagnostics: Array<Diagnostic> = [];
			const sigDiag = createSignatureDiagnostic();
			diagnostics.push(createTypeDiagnostic());
			diagnostics.push(sigDiag);
			diagnostics.push(createClassMemberDiagnostic());

			const result = byKind(diagnostics, 'signature_analysis_failed');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], sigDiag);
			assert.strictEqual(result[0]!.functionName, 'helperFn');
		});

		test('filters by class_member_failed', () => {
			const diagnostics: Array<Diagnostic> = [];
			const classDiag = createClassMemberDiagnostic();
			diagnostics.push(createTypeDiagnostic());
			diagnostics.push(classDiag);

			const result = byKind(diagnostics, 'class_member_failed');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], classDiag);
			assert.strictEqual(result[0]!.className, 'MyClass');
			assert.strictEqual(result[0]!.memberName, 'my_method');
		});

		test('filters by svelte_prop_failed', () => {
			const diagnostics: Array<Diagnostic> = [];
			const svelteDiag = createSveltePropDiagnostic();
			diagnostics.push(createTypeDiagnostic());
			diagnostics.push(svelteDiag);

			const result = byKind(diagnostics, 'svelte_prop_failed');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], svelteDiag);
			assert.strictEqual(result[0]!.componentName, 'Button');
			assert.strictEqual(result[0]!.propName, 'variant');
		});

		test('filters by module_skipped', () => {
			const diagnostics: Array<Diagnostic> = [];
			const moduleDiag = createModuleSkippedDiagnostic();
			diagnostics.push(createTypeDiagnostic());
			diagnostics.push(moduleDiag);

			const result = byKind(diagnostics, 'module_skipped');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], moduleDiag);
			assert.strictEqual(result[0]!.reason, 'no_analyzer');
		});

		test('filters module_skipped by reason not_in_program', () => {
			const diagnostics: Array<Diagnostic> = [];
			const moduleDiag = createModuleSkippedDiagnostic({reason: 'not_in_program'});
			diagnostics.push(moduleDiag);

			const result = byKind(diagnostics, 'module_skipped');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]!.reason, 'not_in_program');
		});

		test('returns multiple diagnostics of same kind', () => {
			const diagnostics: Array<Diagnostic> = [];
			const typeDiag1 = createTypeDiagnostic({symbolName: 'foo'});
			const typeDiag2 = createTypeDiagnostic({symbolName: 'bar'});
			diagnostics.push(typeDiag1);
			diagnostics.push(createSignatureDiagnostic());
			diagnostics.push(typeDiag2);

			const result = byKind(diagnostics, 'type_extraction_failed');

			assert.strictEqual(result.length, 2);
			assert.include(result, typeDiag1);
			assert.include(result, typeDiag2);
		});
	});

	describe('JSON round-trip', () => {
		// The whole reason for moving to plain data: JSON.stringify → JSON.parse
		// must yield a value the helpers accept unchanged. Class instances would
		// have lost their methods here.
		test('empty collector survives JSON round-trip', () => {
			const diagnostics: Array<Diagnostic> = [];

			const parsed = JSON.parse(JSON.stringify(diagnostics)) as typeof diagnostics;

			assert.deepEqual(parsed, []);
			assert.strictEqual(hasErrors(parsed), false);
			assert.strictEqual(hasWarnings(parsed), false);
			assert.deepEqual(errorsOf(parsed), []);
			assert.deepEqual(warningsOf(parsed), []);
			assert.deepEqual(byKind(parsed, 'type_extraction_failed'), []);
		});

		test('populated collector survives JSON round-trip', () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createTypeDiagnostic({message: 'type error', symbolName: 'Foo', line: 42}));
			diagnostics.push(createSignatureDiagnostic({message: 'sig warning', functionName: 'bar'}));
			diagnostics.push(createClassMemberDiagnostic({severity: 'error'}));

			const parsed = JSON.parse(JSON.stringify(diagnostics)) as typeof diagnostics;

			// Byte-identical re-serialization
			assert.strictEqual(JSON.stringify(parsed), JSON.stringify(diagnostics));

			// Helpers behave identically against parsed and original
			assert.strictEqual(hasErrors(parsed), hasErrors(diagnostics));
			assert.strictEqual(hasWarnings(parsed), hasWarnings(diagnostics));
			assert.deepEqual(errorsOf(parsed), errorsOf(diagnostics));
			assert.deepEqual(warningsOf(parsed), warningsOf(diagnostics));
			assert.deepEqual(
				byKind(parsed, 'type_extraction_failed'),
				byKind(diagnostics, 'type_extraction_failed'),
			);

			// And specific values land where expected
			assert.strictEqual(parsed.length, 3);
			assert.strictEqual(parsed[0]!.kind, 'type_extraction_failed');
			assert.strictEqual(parsed[0]!.message, 'type error');
		});

		test('AnalyzeResultJson-shape survives JSON round-trip with diagnostics intact', () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createTypeDiagnostic({message: 'test error'}));

			const result = {modules: [], diagnostics};
			const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

			// `diagnostics` is a bare array — flattened from the old `{all: [...]}` wrapper
			assert.ok(Array.isArray(parsed.diagnostics));
			assert.strictEqual(parsed.diagnostics.length, 1);
			assert.strictEqual(parsed.diagnostics[0]!.message, 'test error');
			assert.strictEqual(hasErrors(parsed.diagnostics), true);
		});
	});

	describe('Zod schema round-trip', () => {
		// The schema must match every variant emitted by analysis code. Each
		// factory produces a populated diagnostic; `Diagnostic.parse` must
		// accept it without error and return a deep-equal object. Catches
		// schema/interface drift — e.g., adding a variant without updating
		// the discriminated union.
		test('every variant survives Diagnostic.parse → JSON.stringify → JSON.parse → Diagnostic.parse', () => {
			const variants: Array<Diagnostic> = [
				createTypeDiagnostic(),
				createSignatureDiagnostic(),
				createClassMemberDiagnostic(),
				createSveltePropDiagnostic(),
				createModuleSkippedDiagnostic(),
				createMisplacedTagDiagnostic(),
				createUnknownParamDiagnostic(),
				// import_parse_failed and duplicate_comment have no factory; build inline
				{
					kind: 'import_parse_failed',
					file: 'src/lib/foo.ts',
					line: 1,
					column: 1,
					message: 'Failed to parse imports',
					severity: 'warning',
				},
				{
					kind: 'duplicate_comment',
					file: 'Foo.svelte',
					message: 'Multiple @module comments',
					severity: 'warning',
					commentType: 'module_comment',
				},
			];
			for (const d of variants) {
				const validated = Diagnostic.parse(d);
				const reparsed = Diagnostic.parse(JSON.parse(JSON.stringify(validated)));
				assert.deepEqual(reparsed, validated);
			}
		});

		test('z.array(Diagnostic).parse accepts an empty array', () => {
			// Diagnostics is a bare `Array<Diagnostic>` on the wire — no wrapper.
			// CLI emits `[]` when no diagnostics are collected, and parse round-trips it.
			const parsed = z.array(Diagnostic).parse([]);
			assert.deepEqual(parsed, []);
		});

		test('absent line/column round-trip as missing keys (not null)', () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createModuleSkippedDiagnostic());

			const json = JSON.stringify(diagnostics);
			// No `line`/`column` keys in the JSON (per the optional() schema)
			assert.notInclude(json, 'line');
			assert.notInclude(json, 'column');
			assert.notInclude(json, 'null');

			// Re-parse via schema
			const reparsed = z.array(Diagnostic).parse(JSON.parse(json));
			assert.strictEqual(reparsed.length, 1);
			assert.strictEqual(reparsed[0]!.line, undefined);
			assert.strictEqual(reparsed[0]!.column, undefined);
		});

		test('populated diagnostics survive JSON.stringify → z.array(Diagnostic).parse', () => {
			const diagnostics: Array<Diagnostic> = [];
			diagnostics.push(createTypeDiagnostic({line: 42, column: 7}));
			diagnostics.push(createModuleSkippedDiagnostic());
			diagnostics.push(createMisplacedTagDiagnostic({tagName: 'deprecated'}));

			const reparsed = z.array(Diagnostic).parse(JSON.parse(JSON.stringify(diagnostics)));
			assert.deepEqual(reparsed, diagnostics);
			// Helpers behave identically against schema-parsed diagnostics
			assert.strictEqual(hasErrors(reparsed), hasErrors(diagnostics));
			assert.deepEqual(errorsOf(reparsed), errorsOf(diagnostics));
			assert.deepEqual(byKind(reparsed, 'misplaced_tag'), byKind(diagnostics, 'misplaced_tag'));
		});
	});

	describe('array shape', () => {
		test('starts as empty array', () => {
			const diagnostics: Array<Diagnostic> = [];

			assert.deepEqual(diagnostics, []);
		});

		test('contains all added diagnostics', () => {
			const diagnostics: Array<Diagnostic> = [];
			const diag1 = createTypeDiagnostic();
			const diag2 = createSignatureDiagnostic();

			diagnostics.push(diag1);
			diagnostics.push(diag2);

			assert.strictEqual(diagnostics.length, 2);
			assert.include(diagnostics, diag1);
			assert.include(diagnostics, diag2);
		});
	});
});

describe('formatDiagnostic', () => {
	describe('basic formatting', () => {
		test('formats error with line and column', () => {
			const diagnostic = createTypeDiagnostic({
				file: 'test.ts',
				line: 10,
				column: 5,
				severity: 'error',
				message: 'Type extraction failed',
			});

			const result = formatDiagnostic(diagnostic);

			assert.strictEqual(result, './test.ts:10:5: error: Type extraction failed');
		});

		test('formats warning with line and column', () => {
			const diagnostic = createSignatureDiagnostic({
				file: 'helpers.ts',
				line: 25,
				column: 1,
				severity: 'warning',
				message: 'Could not analyze signature',
			});

			const result = formatDiagnostic(diagnostic);

			assert.strictEqual(result, './helpers.ts:25:1: warning: Could not analyze signature');
		});

		test('formats with line only (undefined column)', () => {
			const diagnostic = createTypeDiagnostic({
				file: 'test.ts',
				line: 10,
				column: undefined,
				message: 'Error message',
			});

			const result = formatDiagnostic(diagnostic);

			assert.strictEqual(result, './test.ts:10: error: Error message');
		});

		test('formats with no location (undefined line and column)', () => {
			const diagnostic = createTypeDiagnostic({
				file: 'test.ts',
				line: undefined,
				column: undefined,
				message: 'Error message',
			});

			const result = formatDiagnostic(diagnostic);

			assert.strictEqual(result, './test.ts: error: Error message');
		});
	});

	describe('prefix', () => {
		test('always prepends ./ to file path', () => {
			const diagnostic = createTypeDiagnostic({file: 'test.ts'});

			const result = formatDiagnostic(diagnostic);

			assert.ok(result.startsWith('./'));
		});
	});

	describe('all diagnostic kinds format correctly', () => {
		test('formats type_extraction_failed', () => {
			const diagnostic = createTypeDiagnostic({
				file: 'test.ts',
				line: 10,
				column: 5,
			});

			const result = formatDiagnostic(diagnostic);

			assert.include(result, 'test.ts:10:5');
			assert.include(result, 'error');
		});

		test('formats signature_analysis_failed', () => {
			const diagnostic = createSignatureDiagnostic({
				file: 'helpers.ts',
				line: 25,
				column: 1,
			});

			const result = formatDiagnostic(diagnostic);

			assert.include(result, 'helpers.ts:25:1');
		});

		test('formats class_member_failed', () => {
			const diagnostic = createClassMemberDiagnostic({
				file: 'MyClass.ts',
				line: 50,
				column: 3,
			});

			const result = formatDiagnostic(diagnostic);

			assert.include(result, 'MyClass.ts:50:3');
		});

		test('formats svelte_prop_failed', () => {
			const diagnostic = createSveltePropDiagnostic({
				file: 'Button.svelte',
				line: 5,
				column: 10,
			});

			const result = formatDiagnostic(diagnostic);

			assert.include(result, 'Button.svelte:5:10');
		});

		test('formats module_skipped with absent location', () => {
			const diagnostic = createModuleSkippedDiagnostic({
				file: 'unknown.xyz',
				line: undefined,
				column: undefined,
				message: 'No analyzer for file type',
			});

			const result = formatDiagnostic(diagnostic);

			assert.strictEqual(result, './unknown.xyz: warning: No analyzer for file type');
		});

		test('formats misplaced_tag', () => {
			const diagnostic = createMisplacedTagDiagnostic({
				file: 'fn.ts',
				line: 7,
				column: 2,
				message: '@example on non-primary overload of "fn"',
			});

			const result = formatDiagnostic(diagnostic);

			assert.include(result, 'fn.ts:7:2');
			assert.include(result, 'warning');
			assert.include(result, '@example');
		});

		test('formats unknown_param', () => {
			const diagnostic = createUnknownParamDiagnostic({
				file: 'fn.ts',
				line: 3,
				column: 1,
				message: '@param "argz" on "fn" doesn\'t match any parameter',
			});

			const result = formatDiagnostic(diagnostic);

			assert.include(result, 'fn.ts:3:1');
			assert.include(result, 'warning');
			assert.include(result, '@param');
		});
	});
});

describe('diagnostic type discrimination', () => {
	test('diagnostics can be narrowed by kind', () => {
		const diagnostics: Array<Diagnostic> = [
			createTypeDiagnostic(),
			createSignatureDiagnostic(),
			createClassMemberDiagnostic(),
			createSveltePropDiagnostic(),
			createModuleSkippedDiagnostic(),
			createMisplacedTagDiagnostic(),
			createUnknownParamDiagnostic(),
		];

		for (const d of diagnostics) {
			switch (d.kind) {
				case 'type_extraction_failed':
					assert.strictEqual(d.symbolName, 'testSymbol');
					break;
				case 'signature_analysis_failed':
					assert.strictEqual(d.functionName, 'helperFn');
					break;
				case 'class_member_failed':
					assert.strictEqual(d.className, 'MyClass');
					assert.strictEqual(d.memberName, 'my_method');
					break;
				case 'svelte_prop_failed':
					assert.strictEqual(d.componentName, 'Button');
					assert.strictEqual(d.propName, 'variant');
					break;
				case 'module_skipped':
					assert.strictEqual(d.reason, 'no_analyzer');
					break;
				case 'misplaced_tag':
					assert.strictEqual(d.tagName, 'example');
					assert.strictEqual(d.functionName, 'fn');
					break;
				case 'unknown_param':
					assert.strictEqual(d.paramName, 'argz');
					assert.strictEqual(d.functionName, 'fn');
					break;
				case 'module_unreadable':
				case 'import_parse_failed':
				case 'duplicate_comment':
				case 'source_map_failed':
				case 'duplicate_declaration':
				case 'transform_failed':
				case 'resolver_failed':
					assert.fail('unreachable');
			}
		}
	});
});
