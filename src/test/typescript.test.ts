import {test, assert, describe, beforeAll} from 'vitest';
import ts from 'typescript';

import {DeclarationJson, type DeclarationJsonInput} from '$lib/types.js';
import {createAnalysisProgram} from '$lib/typescript-program.js';
import {detectReactivity, extractSignatureParameters} from '$lib/typescript-extract-shared.js';
import {analyzeExports, analyzeTypescriptModule} from '$lib/typescript-exports.js';
import {type Diagnostic, hasErrors, hasWarnings} from '$lib/diagnostics.js';

import {
	loadFixtures,
	validateDeclarationStructure,
	createTestProgram,
	createMultiFileProgram,
	createFixtureProgram,
	extractDeclarationFromSource,
	type TsFixture,
} from './fixtures/ts/ts-test-helpers.js';
import {normalizeJson} from './test-helpers.js';
import {
	testSourceOptions,
	createTestSourceOptions,
	createVirtualSourceOptions,
} from './test-module-helpers.js';

let fixtures: Array<TsFixture> = [];

beforeAll(async () => {
	fixtures = await loadFixtures();
});

describe('TypeScript helpers (fixture-based)', () => {
	test('all fixtures extract correctly', () => {
		for (const fixture of fixtures) {
			// Create program and source file from fixture
			const {checker, sourceFile} = createFixtureProgram(fixture);

			// Extract the declaration from the source file
			const result = extractDeclarationFromSource(sourceFile, checker, fixture.category);

			// Compare with expected (normalize to match JSON serialization)
			assert.deepEqual(
				normalizeJson(result),
				normalizeJson(fixture.expected),
				`Fixture "${fixture.category}/${fixture.name}" failed`,
			);
		}
	});

	test('all fixtures have valid structure', () => {
		for (const fixture of fixtures) {
			// Skip moduleComment category (returns string, not DeclarationJson)
			if (fixture.category === 'moduleComment') continue;

			// Skip error category (may return null or degraded results)
			if (fixture.category === 'error') continue;

			// Validate that null only appears in module/comment/*, errors/*, or tsdoc/nodocs-filtering fixtures
			if (fixture.expected === null) {
				// Allow null for @nodocs test case
				if (fixture.name !== 'tsdoc/nodocs-filtering') {
					throw new Error(
						`Unexpected null in fixture ${fixture.name} - only module/comment/*, errors/*, and tsdoc/nodocs-filtering should return null. ` +
							`This likely indicates a fixture that doesn't test anything useful and should be removed.`,
					);
				}
				continue; // Skip structure validation for null
			}

			// Validate declaration structure
			validateDeclarationStructure(fixture.expected as DeclarationJsonInput);
		}
	});

	test('class fixtures correctly exclude private fields', () => {
		const privateFieldsFixture = fixtures.find(
			(f) => f.category === 'class' && f.name === 'declarations/class/private-excluded',
		);

		if (!privateFieldsFixture) {
			throw new Error('declarations/class/private-excluded fixture not found');
		}

		// Parse through Zod to restore stripped array/boolean defaults so
		// `result.members` is `Array<...>` (Output shape), not optional.
		const result = privateFieldsFixture.expected
			? DeclarationJson.parse(privateFieldsFixture.expected)
			: null;

		// Verify that private members are NOT in the output
		if (result?.kind === 'class') {
			const memberNames = result.members.map((m: {name?: string}) => m.name);
			// Private fields (#field syntax)
			assert.notInclude(memberNames, '#a', 'Private field #a should be excluded');
			assert.notInclude(memberNames, '#b', 'Private field #b should be excluded');
			assert.notInclude(memberNames, '#fn', 'Private method #fn should be excluded');
			// Private keyword members
			assert.notInclude(memberNames, 'd', 'Private property d should be excluded');
			// Private constructor
			assert.notInclude(memberNames, 'constructor', 'Private constructor should be excluded');

			// Protected members SHOULD be included
			assert.include(memberNames, 'e', 'Protected property e should be included');
			assert.include(memberNames, 'fn5', 'Protected method fn5 should be included');

			// Public members SHOULD be included
			assert.include(memberNames, 'c', 'Public field c should be included');
			assert.include(memberNames, 'fn1', 'Public method fn1 should be included');
			assert.include(memberNames, 'fn2', 'Public method fn2 should be included');
		} else {
			throw new Error('Expected members to be defined for class A');
		}
	});

	test('class fixtures correctly extract getters and setters', () => {
		const accessorsFixture = fixtures.find(
			(f) => f.category === 'class' && f.name === 'members/class-accessors',
		);

		if (!accessorsFixture) {
			throw new Error('members/class-accessors fixture not found');
		}

		const result = accessorsFixture.expected
			? DeclarationJson.parse(accessorsFixture.expected)
			: null;

		if (result?.kind !== 'class' || result.members.length === 0) {
			throw new Error('Expected members to be defined for class A');
		}

		// Find accessor 'a' (has both getter and setter)
		const accessorA = result.members.find((m: {name?: string}) => m.name === 'a');
		assert.ok(accessorA, 'Accessor "a" should be present');
		assert.strictEqual(accessorA.kind, 'variable', 'Accessor should have kind "variable"');
		assert.deepEqual(
			accessorA.modifiers,
			['getter', 'setter'],
			'Accessor "a" should have both getter and setter modifiers',
		);
		assert.strictEqual(accessorA.typeSignature, 'string', 'Accessor "a" should have type "string"');
		assert.strictEqual(
			accessorA.docComment,
			'Description 1',
			'Accessor "a" should use getter\'s JSDoc',
		);

		// Find accessor 'b' (read-only, only getter)
		const accessorB = result.members.find((m) => m.name === 'b');
		assert.ok(accessorB, 'Accessor "b" should be present');
		assert.deepEqual(
			accessorB.modifiers,
			['getter'],
			'Accessor "b" should only have getter modifier',
		);
		assert.strictEqual(accessorB.typeSignature, 'number', 'Accessor "b" should have type "number"');

		// Verify private backing field is NOT present
		const privateField = result.members.find((m) => m.name === '_a');
		assert.notOk(privateField, 'Private backing field "_a" should be excluded');
	});

	test('class accessors exclude private but include protected', () => {
		// Create a class with private and protected accessors
		const sourceCode = `
export class A {
	private get priv(): string { return 'priv'; }
	protected get prot(): number { return 1; }
	public get pub(): boolean { return true; }
	get implicit(): string { return 'implicit'; }
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1, 'Should have 1 class declaration');
		const classDecl = result.declarations[0]!.declaration;
		assert.ok(classDecl.members, 'Class should have members');

		const memberNames = classDecl.members.map((m) => m.name);

		// Private should be excluded, protected should be included (extension API)
		assert.notInclude(memberNames, 'priv', 'Private accessor should be excluded');
		assert.include(memberNames, 'prot', 'Protected accessor should be included');

		// Public and implicit public should be included
		assert.include(memberNames, 'pub', 'Public accessor should be included');
		assert.include(memberNames, 'implicit', 'Implicit public accessor should be included');

		// Protected accessor should have protected modifier
		const protAccessor = classDecl.members.find((m) => m.name === 'prot')!;
		assert.include(
			protAccessor.modifiers!,
			'protected',
			'Protected accessor should have protected modifier',
		);
	});

	test('class accessors handle static accessors correctly', () => {
		const sourceCode = `
export class A {
	static get config(): string { return 'config'; }
	static set config(value: string) { /* set */ }
	static get readonlyStatic(): number { return 42; }
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		const classDecl = result.declarations[0]!.declaration;
		assert.ok(classDecl.members, 'Class should have members');

		// Find static accessor 'config' (has both getter and setter)
		const config = classDecl.members.find((m) => m.name === 'config');
		assert.ok(config, 'Static accessor "config" should be present');
		assert.include(config.modifiers!, 'static', 'Should have static modifier');
		assert.include(config.modifiers!, 'getter', 'Should have getter modifier');
		assert.include(config.modifiers!, 'setter', 'Should have setter modifier');

		// Find static read-only accessor
		const readonlyStatic = classDecl.members.find((m) => m.name === 'readonlyStatic');
		assert.ok(readonlyStatic, 'Static accessor "readonlyStatic" should be present');
		assert.include(readonlyStatic.modifiers!, 'static', 'Should have static modifier');
		assert.include(readonlyStatic.modifiers!, 'getter', 'Should have getter modifier');
		assert.notInclude(readonlyStatic.modifiers!, 'setter', 'Should not have setter modifier');
	});

	test('class accessors handle setter-only accessors', () => {
		const sourceCode = `
export class A {
	/** Write-only property */
	set writeOnly(value: string) { console.log(value); }
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		const classDecl = result.declarations[0]!.declaration;
		assert.ok(classDecl.members, 'Class should have members');

		const writeOnly = classDecl.members.find((m) => m.name === 'writeOnly');
		assert.ok(writeOnly, 'Setter-only accessor "writeOnly" should be present');
		assert.deepEqual(writeOnly.modifiers, ['setter'], 'Should only have setter modifier');
		assert.strictEqual(
			writeOnly.typeSignature,
			'string',
			'Should extract type from setter parameter',
		);
		assert.strictEqual(
			writeOnly.docComment,
			'Write-only property',
			'Should extract JSDoc from setter',
		);
	});

	test('private constructors are excluded', () => {
		const sourceCode = `
export class A {
	private constructor(a: string) {}
	static fn1(a: string): A {
		return new A(a);
	}
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1, 'Should have 1 class declaration');
		const classDecl = result.declarations[0]!.declaration;
		assert.ok(classDecl.members, 'Class should have members');

		const memberNames = classDecl.members.map((m) => m.name);
		assert.notInclude(memberNames, 'constructor', 'Private constructor should be excluded');
		assert.include(memberNames, 'fn1', 'Public static method should be included');
	});

	test('protected constructors are included with modifier', () => {
		const sourceCode = `
export abstract class A {
	protected constructor(a: string) {}
	abstract fn1(): void;
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1, 'Should have 1 class declaration');
		const classDecl = result.declarations[0]!.declaration;
		assert.ok(classDecl.members, 'Class should have members');

		const memberNames = classDecl.members.map((m) => m.name);
		assert.include(memberNames, 'constructor', 'Protected constructor should be included');

		const ctor = classDecl.members.find((m) => m.name === 'constructor')!;
		assert.include(ctor.modifiers!, 'protected', 'Constructor should have protected modifier');
	});

	test('public constructors are included without special modifier', () => {
		const sourceCode = `
export class A {
	constructor(public a: string) {}
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		const classDecl = result.declarations[0]!.declaration;
		const memberNames = classDecl.members!.map((m) => m.name);
		assert.include(memberNames, 'constructor', 'Public constructor should be included');
	});

	test('extracts constructor signature from anonymous default-exported class', () => {
		// `export default class { ... }` is the only legal nameless ClassDeclaration
		// shape. Previously, `extractClassInfo` gated ctor extraction on `node.name`,
		// dropping `typeSignature` and `parameters` for anonymous classes (only the
		// 'constructor' member name made it through). The AST→signature path works
		// symmetrically for named and anonymous classes.
		const sourceCode = `
export default class {
	constructor(a: string, b?: number) {}
	fn1(): void {}
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1, 'Should have 1 class declaration');
		const classDecl = result.declarations[0]!.declaration;
		assert.strictEqual(classDecl.kind, 'class');
		assert.strictEqual(classDecl.name, 'default', "Default slot is named 'default'");

		const ctor = classDecl.members?.find((m) => m.name === 'constructor');
		assert.ok(ctor, 'Constructor member should be present');
		assert.strictEqual(ctor.kind, 'constructor');
		if (ctor.kind !== 'constructor') throw new Error('expected constructor');
		assert.ok(ctor.typeSignature, 'Constructor typeSignature should be populated');
		assert.match(ctor.typeSignature, /a: string/, 'Constructor signature should include a: string');
		assert.strictEqual(ctor.parameters?.length, 2, 'Should extract both parameters');
		assert.strictEqual(ctor.parameters![0]!.name, 'a');
		assert.strictEqual(ctor.parameters![0]!.type, 'string');
		assert.strictEqual(ctor.parameters![1]!.name, 'b');
		assert.strictEqual(ctor.parameters![1]!.optional, true, 'b? should be optional');
		assert.notOk(ctor.partial, 'Should not be flagged partial');
	});

	test('extracts overload signatures from anonymous default-exported class', () => {
		const sourceCode = `
export default class {
	constructor(a: string);
	constructor(a: number);
	constructor(a: string | number) {}
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		const classDecl = result.declarations[0]!.declaration;
		const ctor = classDecl.members?.find((m) => m.name === 'constructor');
		assert.ok(ctor, 'Constructor member should be present');
		if (ctor.kind !== 'constructor') throw new Error('expected constructor');
		assert.strictEqual(
			ctor.overloads?.length,
			2,
			'Should extract two overload signatures (impl excluded)',
		);
		assert.strictEqual(ctor.overloads![0]!.parameters![0]!.type, 'string');
		assert.strictEqual(ctor.overloads![1]!.parameters![0]!.type, 'number');
	});
});

describe('analyzeExports', () => {
	test('extracts module comment and all exported identifiers', () => {
		const sourceCode = `
/**
 * Test module with exports.
 *
 * @module
 */

export const foo = 42;
export function bar(): string { return 'bar'; }
export type Baz = { value: number };
`;

		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		// Should have module comment
		assert.strictEqual(result.moduleComment, 'Test module with exports.');

		// Should have 3 identifiers
		assert.strictEqual(result.declarations.length, 3);

		const names = result.declarations.map((i) => i.declaration.name);
		assert.include(names, 'foo');
		assert.include(names, 'bar');
		assert.include(names, 'Baz');
	});

	test('handles module with no exports', () => {
		const sourceCode = `
/**
 * Module with no exports.
 *
 * @module
 */

const internal = 'not exported';
`;

		const sourceFile = ts.createSourceFile('empty.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'empty.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.moduleComment, 'Module with no exports.');
		assert.strictEqual(result.declarations.length, 0);
	});

	test('handles module with no comment', () => {
		const sourceCode = `
export const foo = 'no comment';
export const bar = 123;
`;

		const sourceFile = ts.createSourceFile(
			'module_no_comment.ts',
			sourceCode,
			ts.ScriptTarget.Latest,
			true,
		);
		const checker = createTestProgram(sourceFile, 'module_no_comment.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.isUndefined(result.moduleComment);
		assert.strictEqual(result.declarations.length, 2);
	});

	test('extracts full declaration metadata', () => {
		const sourceCode = `
/**
 * Adds two numbers.
 * @param a First number
 * @param b Second number
 * @returns The sum
 */
export function add(a: number, b: number): number {
	return a + b;
}
`;

		const sourceFile = ts.createSourceFile('math.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'math.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1);

		const addFn = result.declarations[0]!.declaration;
		assert.strictEqual(addFn.name, 'add');
		assert.strictEqual(addFn.kind, 'function');
		assert.strictEqual(addFn.docComment, 'Adds two numbers.');
		assert.strictEqual(addFn.returnType, 'number');
		assert.strictEqual(addFn.returnDescription, 'The sum');
		assert.ok(addFn.parameters);
		assert.strictEqual(addFn.parameters.length, 2);
		const firstParam = addFn.parameters[0];
		assert.ok(firstParam);
		assert.strictEqual(firstParam.name, 'a');
		assert.strictEqual(firstParam.description, 'First number');
	});

	test('handles class exports with members', () => {
		const sourceCode = `
export class Counter {
	value: number = 0;

	increment(): void {
		this.value++;
	}
}
`;

		const sourceFile = ts.createSourceFile('counter.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'counter.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1);

		const counter = result.declarations[0]!.declaration;
		assert.strictEqual(counter.name, 'Counter');
		assert.strictEqual(counter.kind, 'class');
		assert.ok(counter.members);
		assert.isTrue(counter.members.length >= 2);

		const memberNames = counter.members.map((m) => m.name);
		assert.include(memberNames, 'value');
		assert.include(memberNames, 'increment');
	});

	test('handles type exports with properties', () => {
		const sourceCode = `
export interface Config {
	/** The name of the configuration. */
	name: string;
	/** Whether the config is enabled. */
	enabled: boolean;
}
`;

		const sourceFile = ts.createSourceFile('config.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'config.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1);

		const config = result.declarations[0]!.declaration;
		assert.strictEqual(config.name, 'Config');
		assert.strictEqual(config.kind, 'interface');
		assert.ok(config.members);
		assert.strictEqual(config.members.length, 2);
	});

	test('handles re-exports', () => {
		const sourceCode = `
const internalValue = 42;
export { internalValue as exportedValue };
`;

		const sourceFile = ts.createSourceFile('reexport.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'reexport.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		// Should have the re-exported value
		assert.strictEqual(result.declarations.length, 1);
		assert.strictEqual(result.declarations[0]!.declaration.name, 'exportedValue');
	});

	test('handles mixed export kinds in same module', () => {
		const sourceCode = `
/**
 * Module with all kinds of exports.
 */

export const VERSION = '1.0.0';

export function greet(name: string): string {
	return \`Hello, \${name}\`;
}

export type Config = {
	debug: boolean;
};

export interface Logger {
	log(message: string): void;
}

export class Service {
	start(): void {}
}
`;

		const sourceFile = ts.createSourceFile('mixed.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'mixed.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		// Should have 5 identifiers of different kinds
		assert.strictEqual(result.declarations.length, 5);

		const byName = new Map(result.declarations.map((i) => [i.declaration.name, i.declaration]));

		// Check each kind
		const version = byName.get('VERSION');
		assert.ok(version);
		assert.strictEqual(version.kind, 'variable');

		const greet = byName.get('greet');
		assert.ok(greet);
		assert.strictEqual(greet.kind, 'function');

		const config = byName.get('Config');
		assert.ok(config);
		assert.strictEqual(config.kind, 'type');

		const logger = byName.get('Logger');
		assert.ok(logger);
		assert.strictEqual(logger.kind, 'interface');

		const service = byName.get('Service');
		assert.ok(service);
		assert.strictEqual(service.kind, 'class');
	});

	test('returns @nodocs identifiers with nodocs flag for consumer filtering', () => {
		const sourceCode = `
/**
 * Module with nodocs exports.
 */

export const publicValue = 42;

/**
 * Helper excluded from documentation.
 * @nodocs
 */
export function nodocsHelper(): void {}

/** @nodocs */
export type NodocsType = { secret: string };

export function public_function(): string {
	return 'public';
}
`;

		const sourceFile = ts.createSourceFile('nodocs.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'nodocs.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		// Should have ALL 4 identifiers - filtering is now consumer responsibility
		assert.strictEqual(result.declarations.length, 4);

		const names = result.declarations.map((i) => i.declaration.name);
		assert.include(names, 'publicValue');
		assert.include(names, 'public_function');
		assert.include(names, 'nodocsHelper');
		assert.include(names, 'NodocsType');

		// Verify nodocs flags are correctly set
		const byName = new Map(result.declarations.map((d) => [d.declaration.name, d]));

		assert.strictEqual(byName.get('publicValue')!.nodocs, false);
		assert.strictEqual(byName.get('public_function')!.nodocs, false);
		assert.strictEqual(byName.get('nodocsHelper')!.nodocs, true);
		assert.strictEqual(byName.get('NodocsType')!.nodocs, true);

		// Consumer can filter like this:
		const publicOnly = result.declarations.filter((d) => !d.nodocs);
		assert.strictEqual(publicOnly.length, 2);
	});

	test('detects same-name re-exports and tracks in reExports array', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/helpers.ts',
				content: `
/** A helper function. */
export function helper(): void {}

export const CONSTANT = 42;
`,
			},
			{
				path: '/src/lib/index.ts',
				content: `
// Re-export from helpers
export {helper, CONSTANT} from './helpers.js';

// Direct export
export const localValue = 'local';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const indexFile = sourceFiles.get('/src/lib/index.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(indexFile, checker, virtualOptions, [] as Array<Diagnostic>);

		// index.ts should only have localValue as a direct export
		// helper and CONSTANT are re-exports and should be in reExports array
		assert.strictEqual(result.declarations.length, 1);
		assert.strictEqual(result.declarations[0]!.declaration.name, 'localValue');

		// reExports should contain the two re-exported identifiers
		assert.strictEqual(result.reExports.length, 2);

		const reExportNames = result.reExports.map((r) => r.name);
		assert.include(reExportNames, 'helper');
		assert.include(reExportNames, 'CONSTANT');

		// Each re-export should reference the original module
		for (const reExport of result.reExports) {
			assert.strictEqual(reExport.originalModule, 'helpers.ts');
		}
	});

	test('handles renamed re-exports with aliasOf metadata', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/internal.ts',
				content: `
/** Internal implementation. */
export function internalImpl(): string {
	return 'internal';
}
`,
			},
			{
				path: '/src/lib/public.ts',
				content: `
// Renamed re-export
export {internalImpl as public_api} from './internal.js';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const publicFile = sourceFiles.get('/src/lib/public.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(publicFile, checker, virtualOptions, [] as Array<Diagnostic>);

		// Renamed re-export creates a NEW declaration with aliasOf
		assert.strictEqual(result.declarations.length, 1);
		const declaration = result.declarations[0]!.declaration;
		assert.strictEqual(declaration.name, 'public_api');
		assert.ok(declaration.aliasOf);
		assert.strictEqual(declaration.aliasOf.module, 'internal.ts');
		assert.strictEqual(declaration.aliasOf.name, 'internalImpl');

		// Should not be in reExports (renamed exports are tracked as new declarations)
		assert.strictEqual(result.reExports.length, 0);
	});

	test('handles mixed direct exports and re-exports', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/utils.ts',
				content: `
export const utilA = 'a';
export const utilB = 'b';
`,
			},
			{
				path: '/src/lib/mixed.ts',
				content: `
// Direct exports
export function directFn(): void {}
export type DirectType = { value: string };

// Same-name re-export
export {utilA} from './utils.js';

// Renamed re-export
export {utilB as renamedUtil} from './utils.js';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const mixedFile = sourceFiles.get('/src/lib/mixed.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(mixedFile, checker, virtualOptions, [] as Array<Diagnostic>);

		// Should have 3 identifiers: directFn, DirectType, renamedUtil
		assert.strictEqual(result.declarations.length, 3);

		const names = result.declarations.map((i) => i.declaration.name);
		assert.include(names, 'directFn');
		assert.include(names, 'DirectType');
		assert.include(names, 'renamedUtil');
		assert.notInclude(names, 'utilA'); // same-name re-export excluded

		// renamedUtil should have aliasOf
		const renamed = result.declarations.find((i) => i.declaration.name === 'renamedUtil');
		assert.ok(renamed?.declaration.aliasOf);
		assert.strictEqual(renamed.declaration.aliasOf.module, 'utils.ts');
		assert.strictEqual(renamed.declaration.aliasOf.name, 'utilB');

		// reExports should contain utilA
		assert.strictEqual(result.reExports.length, 1);
		assert.strictEqual(result.reExports[0]!.name, 'utilA');
		assert.strictEqual(result.reExports[0]!.originalModule, 'utils.ts');
	});

	test('picks up JSDoc from within-file alias export statements', () => {
		const sourceCode = `
const fn1 = (a: string): number => a.length;

/** Description of fn1. */
export { fn1 };
`;

		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1);
		const decl = result.declarations[0]!;
		assert.strictEqual(decl.declaration.name, 'fn1');
		assert.strictEqual(decl.declaration.kind, 'function');
		assert.strictEqual(decl.declaration.docComment, 'Description of fn1.');
	});

	test('JSDoc @nodocs on export statement marks declaration as nodocs', () => {
		const sourceCode = `
const fn1 = (a: string): number => a.length;

/** @nodocs */
export { fn1 };
`;

		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1);
		assert.strictEqual(result.declarations[0]!.nodocs, true);
	});
});

describe('createAnalysisProgram with AnalysisProgramOptions', {timeout: 10_000}, () => {
	test('creates program with default options', () => {
		// Uses current directory and default tsconfig.json
		const program = createAnalysisProgram();

		assert.ok(program);
		assert.ok(program.getTypeChecker());
		assert.ok(program.getSourceFiles().length > 0);
	});

	test('creates program with explicit projectRoot', () => {
		// Explicit projectRoot pointing to project directory
		const program = createAnalysisProgram({projectRoot: process.cwd()});

		assert.ok(program);
		assert.ok(program.getSourceFiles().length > 0);
	});

	test('creates program with custom compiler options', () => {
		// Override strict mode
		const program = createAnalysisProgram({
			compilerOptions: {
				strict: false,
			},
		});

		assert.ok(program);
		// Verify program was created (compiler options are merged)
		assert.ok(program.getSourceFiles().length > 0);
	});

	test('throws when tsconfig not found', () => {
		// Non-existent directory
		assert.throws(
			() => createAnalysisProgram({projectRoot: '/non/existent/path'}),
			/No tsconfig\.json found/,
		);
	});

	test('throws with custom tsconfig name when not found', () => {
		// Try to use a non-existent custom tsconfig name
		assert.throws(
			() => createAnalysisProgram({tsconfig: 'nonexistent.config.json'}),
			/No nonexistent\.config\.json found/,
		);
	});
});

describe('diagnostic collection in analyzeExports', () => {
	test('collects diagnostics without halting analysis', () => {
		// A module with valid exports - should produce no diagnostics
		const sourceCode = `
export const value = 42;
export function fn(): string { return 'test'; }
`;

		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const result = analyzeExports(sourceFile, checker, testSourceOptions(), diagnostics);

		// Should have successful analysis
		assert.strictEqual(result.declarations.length, 2);
		// No diagnostics for valid code
		assert.strictEqual(diagnostics.length, 0);
	});

	test('analysis context is threaded through to all declarations', () => {
		// Multiple exports - context should be used for each
		const sourceCode = `
export const a = 1;
export const b = 2;
export const c = 3;
export function fn(): number { return 1; }
export class MyClass {
	value: number = 0;
}
`;

		const sourceFile = ts.createSourceFile('multi.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'multi.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const result = analyzeExports(sourceFile, checker, testSourceOptions(), diagnostics);

		// All declarations should be extracted successfully
		assert.strictEqual(result.declarations.length, 5);
		// No diagnostics for valid code
		assert.strictEqual(hasErrors(diagnostics), false);
		assert.strictEqual(hasWarnings(diagnostics), false);
	});

	test('extracts sourceLine for each declaration', () => {
		const sourceCode = `
export const first = 1;

export const second = 2;

export function third(): void {}
`;

		const sourceFile = ts.createSourceFile('lines.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'lines.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const result = analyzeExports(sourceFile, checker, testSourceOptions(), diagnostics);

		// Each declaration should have a sourceLine
		for (const {declaration: decl} of result.declarations) {
			assert.ok(decl.sourceLine, `Declaration ${decl.name} should have sourceLine`);
			assert.ok(decl.sourceLine > 0, `sourceLine should be positive for ${decl.name}`);
		}

		// Verify relative ordering (second comes after first)
		const firstDecl = result.declarations.find((d) => d.declaration.name === 'first')!.declaration;
		const secondDecl = result.declarations.find(
			(d) => d.declaration.name === 'second',
		)!.declaration;
		assert.ok(secondDecl.sourceLine! > firstDecl.sourceLine!);
	});
});

describe('re-export chains', () => {
	test('handles re-export chain (A → B → C)', () => {
		// C.ts exports original, B.ts re-exports from C, A.ts re-exports from B
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/c.ts',
				content: `
/** Original declaration in C. */
export const original = 'from C';
`,
			},
			{
				path: '/src/lib/b.ts',
				content: `
// Re-export from C
export {original} from './c.js';
`,
			},
			{
				path: '/src/lib/a.ts',
				content: `
// Re-export from B (which re-exports from C)
export {original} from './b.js';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const virtualOptions = createVirtualSourceOptions();

		// Analyze C - should have the original declaration
		const cFile = sourceFiles.get('/src/lib/c.ts')!;
		const cResult = analyzeExports(cFile, checker, virtualOptions, diagnostics);
		assert.strictEqual(cResult.declarations.length, 1);
		assert.strictEqual(cResult.declarations[0]!.declaration.name, 'original');
		assert.strictEqual(cResult.reExports.length, 0);

		// Analyze B - should track re-export from C
		const bFile = sourceFiles.get('/src/lib/b.ts')!;
		const bResult = analyzeExports(bFile, checker, virtualOptions, diagnostics);
		assert.strictEqual(bResult.declarations.length, 0); // No direct declarations
		assert.strictEqual(bResult.reExports.length, 1);
		assert.strictEqual(bResult.reExports[0]!.name, 'original');
		assert.strictEqual(bResult.reExports[0]!.originalModule, 'c.ts');

		// Analyze A - TypeScript resolves re-export chains to original source
		const aFile = sourceFiles.get('/src/lib/a.ts')!;
		const aResult = analyzeExports(aFile, checker, virtualOptions, diagnostics);
		assert.strictEqual(aResult.declarations.length, 0);
		assert.strictEqual(aResult.reExports.length, 1);
		assert.strictEqual(aResult.reExports[0]!.name, 'original');
		// TypeScript's getAliasedSymbol resolves to the ORIGINAL source (C), not intermediate (B)
		// This is expected behavior - re-export chains resolve to origin
		assert.strictEqual(aResult.reExports[0]!.originalModule, 'c.ts');
	});

	test('handles mixed direct exports and re-export chains', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/base.ts',
				content: `
export const baseValue = 'base';
`,
			},
			{
				path: '/src/lib/combined.ts',
				content: `
// Direct export
export const localValue = 'local';

// Re-export from base
export {baseValue} from './base.js';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const combinedFile = sourceFiles.get('/src/lib/combined.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(combinedFile, checker, virtualOptions, diagnostics);

		// Should have localValue as direct declaration
		assert.strictEqual(result.declarations.length, 1);
		assert.strictEqual(result.declarations[0]!.declaration.name, 'localValue');

		// Should have baseValue as re-export
		assert.strictEqual(result.reExports.length, 1);
		assert.strictEqual(result.reExports[0]!.name, 'baseValue');
	});
});

describe('star exports tracking', () => {
	test('detects export * from statements', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/helpers.ts',
				content: `
export const helperA = 'a';
export const helperB = 'b';
export function helperFn(): void {}
`,
			},
			{
				path: '/src/lib/index.ts',
				content: `
// Star export - re-exports all from helpers
export * from './helpers.js';

// Direct export
export const indexValue = 'index';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const indexFile = sourceFiles.get('/src/lib/index.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(indexFile, checker, virtualOptions, diagnostics);

		// starExports should contain helpers.ts
		assert.strictEqual(result.starExports.length, 1);
		assert.strictEqual(result.starExports[0], 'helpers.ts');

		// Direct export should be in declarations
		assert.ok(result.declarations.some((d) => d.declaration.name === 'indexValue'));

		// TypeScript expands export * to individual symbols via getExportsOfModule,
		// which are then tracked as reExports (same-name re-exports from source modules)
		// The count depends on how TypeScript resolves the star export
		// At minimum, we've verified the starExports array captures the namespace-level info
	});

	test('handles multiple star exports', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/utilsA.ts',
				content: `export const utilA = 'a';`,
			},
			{
				path: '/src/lib/utilsB.ts',
				content: `export const utilB = 'b';`,
			},
			{
				path: '/src/lib/barrel.ts',
				content: `
export * from './utilsA.js';
export * from './utilsB.js';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const barrelFile = sourceFiles.get('/src/lib/barrel.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(barrelFile, checker, virtualOptions, diagnostics);

		// Should have both star exports
		assert.strictEqual(result.starExports.length, 2);
		assert.include(result.starExports, 'utilsA.ts');
		assert.include(result.starExports, 'utilsB.ts');
	});

	test('excludes star exports from external modules', () => {
		// When export * from a node_modules package, it shouldn't appear in starExports
		const sourceCode = `
// This would be a star export from an external package
// We can't easily test this without actual node_modules,
// but we verify the logic works for source modules only
export const local = 'value';
`;

		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const result = analyzeExports(sourceFile, checker, testSourceOptions(), diagnostics);

		// No star exports in this simple case
		assert.strictEqual(result.starExports.length, 0);
	});

	test('mixed star exports and named re-exports', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/types.ts',
				content: `
export type Config = { value: string };
export type Options = { enabled: boolean };
`,
			},
			{
				path: '/src/lib/utils.ts',
				content: `
export const utilFn = (): void => {};
`,
			},
			{
				path: '/src/lib/combined.ts',
				content: `
// Star export
export * from './types.js';

// Named re-export
export {utilFn} from './utils.js';

// Direct export
export const combinedValue = 'combined';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const combinedFile = sourceFiles.get('/src/lib/combined.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(combinedFile, checker, virtualOptions, diagnostics);

		// Star export for types.ts
		assert.strictEqual(result.starExports.length, 1);
		assert.strictEqual(result.starExports[0], 'types.ts');

		// Named re-export for utilFn
		assert.ok(result.reExports.some((r) => r.name === 'utilFn'));

		// Direct declaration
		assert.ok(result.declarations.some((d) => d.declaration.name === 'combinedValue'));

		// The starExports array provides namespace-level info about types.ts
		// Individual type exports (Config, Options) may or may not appear in reExports
		// depending on TypeScript's expansion behavior
	});

	test('star export and named re-export of same symbol does not duplicate', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/a.ts',
				content: `export const foo = 'value';`,
			},
			{
				path: '/src/lib/index.ts',
				content: `
export * from './a.js';
export {foo} from './a.js';
`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const indexFile = sourceFiles.get('/src/lib/index.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(indexFile, checker, virtualOptions, diagnostics);

		// foo should appear in reExports only once (TypeScript deduplicates symbols)
		const fooReExports = result.reExports.filter((r) => r.name === 'foo');
		assert.strictEqual(fooReExports.length, 1, 'foo should appear in reExports exactly once');
		assert.strictEqual(fooReExports[0]!.originalModule, 'a.ts');

		// starExports should still track the namespace-level export
		assert.strictEqual(result.starExports.length, 1);
		assert.strictEqual(result.starExports[0], 'a.ts');
	});

	test('star exports return empty array when no star exports present', () => {
		const sourceCode = `
export const value = 42;
export function fn(): void {}
`;

		const sourceFile = ts.createSourceFile('no_star.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'no_star.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const result = analyzeExports(sourceFile, checker, testSourceOptions(), diagnostics);

		// starExports should be empty array, not undefined
		assert.ok(Array.isArray(result.starExports));
		assert.strictEqual(result.starExports.length, 0);
	});
});

describe('type-only re-exports', () => {
	test('handles type-only same-name re-exports', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/types.ts',
				content: `export type A = { value: string };`,
			},
			{
				path: '/src/lib/index.ts',
				content: `export type {A} from './types.js';`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const indexFile = sourceFiles.get('/src/lib/index.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(indexFile, checker, virtualOptions, diagnostics);

		// Same-name type re-export should be tracked in reExports, not declarations
		assert.strictEqual(result.declarations.length, 0);
		assert.strictEqual(result.reExports.length, 1);
		assert.strictEqual(result.reExports[0]!.name, 'A');
		assert.strictEqual(result.reExports[0]!.originalModule, 'types.ts');
	});

	test('handles renamed type-only re-exports with aliasOf', () => {
		const {program, sourceFiles} = createMultiFileProgram([
			{
				path: '/src/lib/types.ts',
				content: `export type A = { value: string };`,
			},
			{
				path: '/src/lib/index.ts',
				content: `export type {A as B} from './types.js';`,
			},
		]);
		const checker = program.getTypeChecker();

		const diagnostics: Array<Diagnostic> = [];
		const indexFile = sourceFiles.get('/src/lib/index.ts')!;
		const virtualOptions = createVirtualSourceOptions();
		const result = analyzeExports(indexFile, checker, virtualOptions, diagnostics);

		// Renamed type re-export creates a new declaration with aliasOf
		assert.strictEqual(result.declarations.length, 1);
		const declaration = result.declarations[0]!.declaration;
		assert.strictEqual(declaration.name, 'B');
		assert.ok(declaration.aliasOf);
		assert.strictEqual(declaration.aliasOf.name, 'A');
		assert.strictEqual(declaration.aliasOf.module, 'types.ts');

		assert.strictEqual(result.reExports.length, 0);
	});
});

describe('analyzeTypescriptModule with SourceFileInfo dependencies', () => {
	test('passes dependencies from SourceFileInfo to result', () => {
		const sourceCode = `export const value = 42;`;

		const sourceFile = ts.createSourceFile('consumer.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'consumer.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const options = createTestSourceOptions('/project', {
			sourcePaths: ['src/lib'],
		});

		const result = analyzeTypescriptModule(
			{
				id: '/project/src/lib/consumer.ts',
				content: sourceCode,
				dependencies: [
					'/project/src/lib/depA.ts',
					'/project/src/lib/depB.ts',
					'/project/node_modules/external/index.js', // should be filtered
				],
				dependents: ['/project/src/lib/user.ts'],
			},
			sourceFile,
			'consumer.ts',
			checker,
			options,
			diagnostics,
		);

		// Dependencies should be filtered to source modules only
		assert.ok(Array.isArray(result.dependencies));
		assert.include(result.dependencies, 'depA.ts');
		assert.include(result.dependencies, 'depB.ts');
		// External deps should be filtered out
		assert.notInclude(result.dependencies, '/project/node_modules/external/index.js');

		assert.ok(Array.isArray(result.dependents));
		assert.include(result.dependents, 'user.ts');
	});

	test('returns empty arrays when SourceFileInfo has no dependencies', () => {
		const sourceCode = `export const standalone = true;`;

		const sourceFile = ts.createSourceFile(
			'standalone.ts',
			sourceCode,
			ts.ScriptTarget.Latest,
			true,
		);
		const checker = createTestProgram(sourceFile, 'standalone.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const options = createTestSourceOptions('/project', {
			sourcePaths: ['src/lib'],
		});

		const result = analyzeTypescriptModule(
			{
				id: '/project/src/lib/standalone.ts',
				content: sourceCode,
				// No dependencies or dependents provided
			},
			sourceFile,
			'standalone.ts',
			checker,
			options,
			diagnostics,
		);

		// Should return empty arrays, not undefined
		assert.ok(Array.isArray(result.dependencies));
		assert.ok(Array.isArray(result.dependents));
		assert.strictEqual(result.dependencies.length, 0);
		assert.strictEqual(result.dependents.length, 0);
	});

	test('all array fields are always arrays (never undefined)', () => {
		const sourceCode = `export const x = 1;`;

		const sourceFile = ts.createSourceFile('simple.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'simple.ts').getTypeChecker();
		const diagnostics: Array<Diagnostic> = [];

		const result = analyzeTypescriptModule(
			{id: '/project/src/lib/simple.ts', content: sourceCode},
			sourceFile,
			'simple.ts',
			checker,
			testSourceOptions(),
			diagnostics,
		);

		// Verify all array fields are arrays
		assert.ok(Array.isArray(result.declarations), 'declarations should be array');
		assert.ok(Array.isArray(result.dependencies), 'dependencies should be array');
		assert.ok(Array.isArray(result.dependents), 'dependents should be array');
		assert.ok(Array.isArray(result.starExports), 'starExports should be array');
		assert.ok(Array.isArray(result.reExports), 'reExports should be array');
	});
});

describe('extractSignatureParameters', () => {
	test('extracts basic parameters with types', () => {
		const sourceCode = `export function greet(name: string, age: number): void {}`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		// Get the function's signature
		const fnSymbol = checker.getSymbolAtLocation(
			(sourceFile.statements[0] as ts.FunctionDeclaration).name!,
		)!;
		const fnType = checker.getTypeOfSymbolAtLocation(fnSymbol, sourceFile.statements[0]!);
		const sig = fnType.getCallSignatures()[0]!;

		const params = extractSignatureParameters(sig, checker, undefined);

		assert.strictEqual(params.length, 2);
		assert.strictEqual(params[0]!.name, 'name');
		assert.strictEqual(params[0]!.type, 'string');
		assert.strictEqual(params[1]!.name, 'age');
		assert.strictEqual(params[1]!.type, 'number');
	});

	test('extracts optional parameters', () => {
		const sourceCode = `export function test(required: string, optional?: number): void {}`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const fnSymbol = checker.getSymbolAtLocation(
			(sourceFile.statements[0] as ts.FunctionDeclaration).name!,
		)!;
		const fnType = checker.getTypeOfSymbolAtLocation(fnSymbol, sourceFile.statements[0]!);
		const sig = fnType.getCallSignatures()[0]!;

		const params = extractSignatureParameters(sig, checker, undefined);

		assert.strictEqual(params.length, 2);
		assert.strictEqual(params[0]!.optional, false); // not optional
		assert.strictEqual(params[1]!.optional, true);
	});

	test('extracts default values', () => {
		const sourceCode = `export function test(value: boolean = true): void {}`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const fnSymbol = checker.getSymbolAtLocation(
			(sourceFile.statements[0] as ts.FunctionDeclaration).name!,
		)!;
		const fnType = checker.getTypeOfSymbolAtLocation(fnSymbol, sourceFile.statements[0]!);
		const sig = fnType.getCallSignatures()[0]!;

		const params = extractSignatureParameters(sig, checker, undefined);

		assert.strictEqual(params.length, 1);
		assert.strictEqual(params[0]!.defaultValue, 'true');
	});

	test('applies TSDoc descriptions from params map', () => {
		const sourceCode = `export function greet(name: string): void {}`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const fnSymbol = checker.getSymbolAtLocation(
			(sourceFile.statements[0] as ts.FunctionDeclaration).name!,
		)!;
		const fnType = checker.getTypeOfSymbolAtLocation(fnSymbol, sourceFile.statements[0]!);
		const sig = fnType.getCallSignatures()[0]!;

		const tsdocParams = {name: 'The user name'};
		const params = extractSignatureParameters(sig, checker, tsdocParams);

		assert.strictEqual(params[0]!.description, 'The user name');
	});

	test('returns empty array for function with no parameters', () => {
		const sourceCode = `export function noop(): void {}`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const fnSymbol = checker.getSymbolAtLocation(
			(sourceFile.statements[0] as ts.FunctionDeclaration).name!,
		)!;
		const fnType = checker.getTypeOfSymbolAtLocation(fnSymbol, sourceFile.statements[0]!);
		const sig = fnType.getCallSignatures()[0]!;

		const params = extractSignatureParameters(sig, checker, undefined);

		assert.ok(Array.isArray(params));
		assert.strictEqual(params.length, 0);
	});
});

describe('detectReactivity', () => {
	// Parse a snippet of source containing a single variable statement and return
	// its initializer expression. Lets each test name exactly the AST shape it cares about.
	const initializerOf = (source: string): ts.Expression | undefined => {
		const sf = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true);
		const stmt = sf.statements[0];
		if (!stmt || !ts.isVariableStatement(stmt)) {
			throw new Error('expected a variable statement');
		}
		return stmt.declarationList.declarations[0]?.initializer;
	};

	test('detects $state', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $state(0);')), '$state');
	});

	test('detects $derived', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $derived(0);')), '$derived');
	});

	test('detects $state.raw', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $state.raw(0);')), '$state.raw');
	});

	test('detects $derived.by', () => {
		assert.strictEqual(
			detectReactivity(initializerOf('let a = $derived.by(() => 0);')),
			'$derived.by',
		);
	});

	test('returns undefined for unrelated identifier callees', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = someFn(0);')), undefined);
	});

	test('returns undefined for $state with unknown property', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $state.foo(0);')), undefined);
	});

	test('returns undefined for $derived with unknown property', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $derived.foo(0);')), undefined);
	});

	test('returns undefined for non-rune base with matching property name', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = foo.raw(0);')), undefined);
	});

	test('returns undefined for non-call initializer', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = 0;')), undefined);
	});

	test('returns undefined for undefined initializer', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a;')), undefined);
	});

	test('returns undefined for arrow function initializer', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = () => $state(0);')), undefined);
	});

	test('returns undefined when rune is wrapped by another call', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = wrap($state(0));')), undefined);
	});

	test('returns undefined for deeper property access (e.g. obj.$state())', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = obj.$state();')), undefined);
	});

	test('detects rune even with no arguments', () => {
		// `$state()` is invalid Svelte semantics but the AST detection is purely syntactic.
		assert.strictEqual(detectReactivity(initializerOf('let a = $state();')), '$state');
	});

	test('detects rune with explicit type arguments', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $state<number>(0);')), '$state');
	});

	test('detects rune through `as` cast', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $state(0) as number;')), '$state');
	});

	test('detects rune through `satisfies` clause', () => {
		assert.strictEqual(
			detectReactivity(initializerOf('let a = $state.raw([]) satisfies Array<number>;')),
			'$state.raw',
		);
	});

	test('detects rune through outer parentheses', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = ($state(0));')), '$state');
	});

	test('detects rune through non-null assertion', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = $state(0)!;')), '$state');
	});

	test('detects rune through legacy <T> type assertion', () => {
		assert.strictEqual(detectReactivity(initializerOf('let a = <number>$state(0);')), '$state');
	});

	test('detects rune through stacked wrappers', () => {
		assert.strictEqual(
			detectReactivity(initializerOf('let a = (($state(0) as number)!);')),
			'$state',
		);
	});

	test('returns undefined when callee itself is parenthesized', () => {
		// We unwrap the outer expression but not the callee — `($state)(0)` is
		// vanishingly rare and supporting it would complicate the detector.
		assert.strictEqual(detectReactivity(initializerOf('let a = ($state)(0);')), undefined);
	});

	test('returns undefined for new-expression even with rune-named class', () => {
		// `new $state(0)` parses as NewExpression, not CallExpression. Not a rune.
		assert.strictEqual(detectReactivity(initializerOf('let a = new $state(0);')), undefined);
	});
});

describe('default-export name resolution', () => {
	test("export default function foo() lands in name: 'default'", () => {
		const sourceCode = `
/** Doc */
export default function foo(a: string): number {
	return a.length;
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 1);
		const decl = result.declarations[0]!.declaration;
		assert.strictEqual(decl.name, 'default', "Default-slot entry's name is 'default'");
		assert.strictEqual(decl.kind, 'function');
		assert.strictEqual(decl.docComment, 'Doc');
	});

	test("export default class Foo lands in name: 'default'", () => {
		const sourceCode = `
export default class Foo {
	constructor(a: string) {}
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		const decl = result.declarations[0]!.declaration;
		assert.strictEqual(decl.name, 'default');
		assert.strictEqual(decl.kind, 'class');
	});

	test("anonymous default export lands in name: 'default'", () => {
		const sourceCode = `
export default function (a: string): number {
	return a.length;
}
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		const decl = result.declarations[0]!.declaration;
		assert.strictEqual(decl.name, 'default');
		assert.strictEqual(decl.kind, 'function');
	});

	test("export {x as default} lands in name: 'default'", () => {
		const sourceCode = `
const x = (a: string) => a.length;
export {x as default};
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		const decl = result.declarations[0]!.declaration;
		assert.strictEqual(decl.name, 'default', 'Renamed-into-default slot is named default');
	});

	test('mixed const x; export {x}; export {x as default} produces two distinct declarations', () => {
		// `const x` exported twice: once as itself (named slot) and once as default
		// (default slot). The two entries are distinguished by `name`: one is `'x'`,
		// the other is `'default'`.
		const sourceCode = `
const x = (a: string) => a.length;
export {x};
export {x as default};
`;
		const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();

		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(result.declarations.length, 2);
		const named = result.declarations.find((d) => d.declaration.name === 'x');
		const def = result.declarations.find((d) => d.declaration.name === 'default');
		assert.ok(named, 'Named slot entry should be present');
		assert.ok(def, 'Default slot entry should be present');
	});

	test("cross-file anonymous defaults each carry name: 'default'", () => {
		// Two modules each have their own default slot. They share the name
		// `'default'` but the slot is module-scoped per the JS spec, so
		// `findDuplicates` skips `name === 'default'` (no collision).
		const {program} = createMultiFileProgram([
			{path: '/src/lib/a.ts', content: 'export default function foo() {}\n'},
			{path: '/src/lib/b.ts', content: 'export default function bar() {}\n'},
		]);
		const checker = program.getTypeChecker();
		const options = createVirtualSourceOptions();

		const aResult = analyzeExports(
			program.getSourceFile('/src/lib/a.ts')!,
			checker,
			options,
			[] as Array<Diagnostic>,
		);
		const bResult = analyzeExports(
			program.getSourceFile('/src/lib/b.ts')!,
			checker,
			options,
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(aResult.declarations[0]!.declaration.name, 'default');
		assert.strictEqual(bResult.declarations[0]!.declaration.name, 'default');
	});

	test("renamed re-export of default lands in named slot with aliasOf.name === 'default'", () => {
		const {program} = createMultiFileProgram([
			{path: '/src/lib/a.ts', content: 'export default function foo() {}\n'},
			{path: '/src/lib/b.ts', content: "export {default as Foo} from './a.js';\n"},
		]);
		const checker = program.getTypeChecker();
		const options = createVirtualSourceOptions();

		const bResult = analyzeExports(
			program.getSourceFile('/src/lib/b.ts')!,
			checker,
			options,
			[] as Array<Diagnostic>,
		);

		assert.strictEqual(bResult.declarations.length, 1);
		const aliasDecl = bResult.declarations[0]!.declaration;
		assert.strictEqual(aliasDecl.name, 'Foo');
		// Canonical's actual symbol name in `a.ts` is 'default'.
		assert.strictEqual(aliasDecl.aliasOf?.name, 'default');
		assert.strictEqual(aliasDecl.aliasOf?.module, 'a.ts');
	});
});

describe('class field type inference', () => {
	// Stub rune signatures so the checker can infer rune-field types in tests
	// (real Svelte projects get the same shape from svelte's ambient types).
	const RUNE_AMBIENTS = `
declare function $state<T>(initial: T): T;
declare function $derived<T>(value: T): T;
`;

	const extractClass = (source: string) => {
		const sourceFile = ts.createSourceFile(
			'test.ts',
			RUNE_AMBIENTS + source,
			ts.ScriptTarget.Latest,
			true,
		);
		const checker = createTestProgram(sourceFile, 'test.ts').getTypeChecker();
		const result = analyzeExports(
			sourceFile,
			checker,
			testSourceOptions(),
			[] as Array<Diagnostic>,
		);
		return result.declarations[0]!.declaration;
	};

	interface Member {
		name: string;
		typeSignature?: string;
		reactivity?: string;
	}

	test('unannotated $state field gets typeSignature from the checker', () => {
		const decl = extractClass(`
export class A {
	a = $state(0);
}
		`);
		const member = (decl.members as Array<Member>)[0]!;
		assert.strictEqual(member.reactivity, '$state');
		assert.strictEqual(member.typeSignature, 'number');
	});

	test('unannotated $derived field gets typeSignature from the checker', () => {
		const decl = extractClass(`
export class A {
	a = $state(0);
	b = $derived(this.a * 2);
}
		`);
		const member = (decl.members as Array<Member>)[1]!;
		assert.strictEqual(member.reactivity, '$derived');
		assert.strictEqual(member.typeSignature, 'number');
	});

	test('unannotated plain field gets typeSignature from the checker', () => {
		// Confirm the fallback applies broadly, not just to rune fields.
		const decl = extractClass(`
export class A {
	a = 'hello';
}
		`);
		const member = (decl.members as Array<Member>)[0]!;
		assert.strictEqual(member.typeSignature, 'string');
	});
});
