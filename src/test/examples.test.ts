/** Integration tests for the examples. */

import {test, assert, describe, beforeAll} from 'vitest';
import {readdir, readFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {AnalyzeResultJson} from '$lib/analyze-core.js';

import {
	EXAMPLES_API_DIR,
	EXAMPLES_VITE_DIR,
	PROJECT_ROOT,
	runCliCapture,
	runSubprocess,
} from './test-cli-helpers.js';

const runScript = (script: string, cwd: string) => runSubprocess('node', [script], {cwd});

/** Shared precondition: the library is built. Examples link to `file:../..` so dist/ must exist. */
const ensureBuilt = (): void => {
	if (!existsSync(join(PROJECT_ROOT, 'dist/index.js'))) {
		throw new Error(`dist/ not found — run \`npm run build\` first`);
	}
};

/** Per-example precondition: the example's node_modules are installed. */
const ensureExampleInstalled = (exampleDir: string, label: string): void => {
	if (!existsSync(join(exampleDir, 'node_modules'))) {
		throw new Error(`${label}/node_modules not found — run \`npm run setup-examples\` first`);
	}
};

/**
 * Read an example output file and validate it against the documented
 * `AnalyzeResultJson` schema — catches accidental drift in what the
 * examples serialize (missing fields, wrong shapes). Returns the parsed
 * envelope with array defaults restored.
 */
const validateOutput = async (path: string): Promise<AnalyzeResultJson> => {
	if (!existsSync(path)) throw new Error(`Missing: ${path}`);
	const raw: unknown = JSON.parse(await readFile(path, 'utf-8'));
	const result = AnalyzeResultJson.parse(raw);
	if (result.modules.length === 0) throw new Error(`Expected at least one module in ${path}`);
	return result;
};

describe('examples/api', () => {
	const EXAMPLE_SCRIPTS: Array<[string, string]> = [
		['analyze-simple.js', 'output-simple.json'],
		['analyze-custom-discovery.js', 'output-custom-discovery.json'],
		['analyze-build-tool.js', 'output-build-tool.json'],
		['analyze-diagnostics.js', 'output-diagnostics.json'],
		['analyze-non-sveltekit.js', 'output-non-sveltekit.json'],
		['analyze-session.js', 'output-session.json'],
	];

	beforeAll(async () => {
		ensureBuilt();
		ensureExampleInstalled(EXAMPLES_API_DIR, 'examples/api');
		// Wipe any committed/leftover output-*.json so the equivalence test
		// can't pass against stale data when an example script fails mid-run.
		await Promise.all(
			EXAMPLE_SCRIPTS.map(([, output]) => rm(join(EXAMPLES_API_DIR, output), {force: true})),
		);
	});

	test.each(EXAMPLE_SCRIPTS)('%s', {timeout: 30000}, async (script, output) => {
		const result = await runScript(script, EXAMPLES_API_DIR);
		assert.strictEqual(
			result.code,
			0,
			`${script} should exit with code 0\nstderr: ${result.stderr}`,
		);
		await validateOutput(join(EXAMPLES_API_DIR, output));
	});

	test('all outputs are equivalent', {timeout: 30000}, async () => {
		const simple = await validateOutput(join(EXAMPLES_API_DIR, 'output-simple.json'));
		const custom = await validateOutput(join(EXAMPLES_API_DIR, 'output-custom-discovery.json'));
		const buildTool = await validateOutput(join(EXAMPLES_API_DIR, 'output-build-tool.json'));
		const diagnostics = await validateOutput(join(EXAMPLES_API_DIR, 'output-diagnostics.json'));
		const session = await validateOutput(join(EXAMPLES_API_DIR, 'output-session.json'));

		assert.deepStrictEqual(simple.modules, custom.modules);
		assert.deepStrictEqual(custom.modules, buildTool.modules);
		assert.deepStrictEqual(buildTool.modules, diagnostics.modules);
		assert.deepStrictEqual(diagnostics.modules, session.modules);
	});

	test('non-sveltekit output has paths relative to src/', async () => {
		// The non-sveltekit example configures `sourcePaths: ['src']`, so the
		// utils.ts file should appear with path "utils.ts" — not "lib/utils.ts"
		// (sveltekit default) or "src/utils.ts" (unstripped). This is the
		// differentiator the example exists to demonstrate.
		const result = await validateOutput(join(EXAMPLES_API_DIR, 'output-non-sveltekit.json'));
		const utils = result.modules.find((m) => m.path === 'utils.ts');
		assert.ok(
			utils,
			`expected a module with path "utils.ts", got: ${result.modules.map((m) => m.path).join(', ')}`,
		);
	});
});

describe('examples/cli', () => {
	// The cli/ example is a README of commands, not a runnable project. Smoke-test
	// the commands it documents by exercising the in-process CLI against the
	// api/ example's source tree — the same target the README's "Try it" section
	// uses (`npx svelte-docinfo ../api --pretty`).
	test('runs against examples/api and emits valid AnalyzeResultJson', async () => {
		const result = await runCliCapture(['node', 'svelte-docinfo', EXAMPLES_API_DIR, '--quiet']);
		assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr.join('\n')}`);
		const parsed = AnalyzeResultJson.parse(JSON.parse(result.stdout.join('\n')));
		assert.ok(parsed.modules.length > 0, 'expected at least one module');
	});
});

describe('examples/vite', () => {
	beforeAll(() => {
		ensureBuilt();
		ensureExampleInstalled(EXAMPLES_VITE_DIR, 'examples/vite');
	});

	test('vite build emits virtual-module content', {timeout: 60000}, async () => {
		const result = await runSubprocess('npx', ['vite', 'build'], {cwd: EXAMPLES_VITE_DIR});
		assert.strictEqual(
			result.code,
			0,
			`vite build should exit with code 0\nstderr: ${result.stderr}`,
		);

		// Read every emitted JS chunk and confirm the virtual module actually
		// resolved — these identifiers come from examples/vite/src/lib/math.ts.
		// If the plugin no-op'd the import, the bundle would be missing them.
		// `'math.ts'` is the analyzed module's path (unique to the virtual
		// emit) and `'MathConfig'` is the interface name (specific to the
		// source). `'multiply'` was dropped — too generic to act as a sentinel.
		const assetsDir = join(EXAMPLES_VITE_DIR, 'dist/assets');
		const jsFiles = (await readdir(assetsDir)).filter((f) => f.endsWith('.js'));
		assert.ok(jsFiles.length > 0, 'expected at least one emitted JS chunk');
		const bundled = (
			await Promise.all(jsFiles.map((f) => readFile(join(assetsDir, f), 'utf-8')))
		).join('\n');
		for (const expected of ['math.ts', 'MathConfig']) {
			assert.ok(
				bundled.includes(expected),
				`bundled output should contain "${expected}" from the virtual module`,
			);
		}
	});
});
