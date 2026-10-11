/**
 * Dev-server tests for the Vite plugin (vite.ts), driven through a real
 * `createServer` in middleware mode.
 *
 * These tests cover:
 * - A change invalidates `virtual:svelte-docinfo` in every environment that loaded it
 * - The full reload goes to the client environment's hot channel only
 * - The dev flow reaches none of the mixed server APIs Vite is removing
 * - Closing a middleware-mode server runs `buildEnd`, which disposes the session
 * - A change still pending when the server closes is dropped, not spun on
 * - A middleware-mode restart that reuses the plugin keeps the new server's session
 * - A failed restart leaves the plugin on the old server, which Vite keeps running
 * - Only the files discovery selects emit modules: an edit to a context file
 *   refreshes it in place, and a new file is an input only if discovery says so
 */

import { test, assert, describe } from 'vitest';
import {
	createServer,
	type HotPayload,
	type InlineConfig,
	type Logger,
	type Plugin,
	type ViteDevServer
} from 'vite';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import svelteDocinfo, { type VitePluginSvelteDocinfoOptions } from '#lib/vite.ts';

import { withTestProject } from './test-helpers.ts';
import { PROJECT_ROOT, runSubprocess } from './test-cli-helpers.ts';

const VIRTUAL_ID = 'virtual:svelte-docinfo';
const RESOLVED_VIRTUAL_ID = '\0virtual:svelte-docinfo';

/** Generous for a loaded machine: a debounce, a re-ingest, and a query. */
const WAIT_TIMEOUT = 8_000;
const TEST_TIMEOUT = 20_000;
/** Kills a child that hangs or spins, well inside `SUBPROCESS_TEST_TIMEOUT`. */
const SUBPROCESS_TIMEOUT = 15_000;
const SUBPROCESS_TEST_TIMEOUT = 30_000;

const PROJECT_FILES = {
	'src/lib/a.ts': "import { b } from './b.ts';\nexport const a = b + 1;\n",
	'src/lib/b.ts': 'export const b = 1;\n'
};

const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
	const deadline = Date.now() + WAIT_TIMEOUT;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
		await new Promise((r) => setTimeout(r, 20));
	}
};

interface CapturedLogs {
	warnings: Array<string>;
	errors: Array<string>;
}

const createCapturingLogger = (logs: CapturedLogs): Logger => {
	const noop = () => {};
	return {
		info: noop,
		warn: (msg) => void logs.warnings.push(msg),
		warnOnce: (msg) => void logs.warnings.push(msg),
		error: (msg) => void logs.errors.push(msg),
		clearScreen: noop,
		hasErrorLogged: () => false,
		hasWarned: false
	};
};

/** A hot payload sent on some environment's channel, tagged with its name. */
interface SentPayload {
	environment: string;
	payload: HotPayload;
}

/**
 * Records every payload sent on every environment's hot channel, so a test
 * can assert where the plugin's reload went. Only the object form is
 * recorded — the `(event, data)` form is for custom events, which the plugin
 * doesn't send.
 */
const recordHotSends = (server: ViteDevServer): Array<SentPayload> => {
	const sent: Array<SentPayload> = [];
	for (const [environment, { hot }] of Object.entries(server.environments)) {
		const original = hot.send;
		hot.send = (...args: Array<unknown>): void => {
			if (typeof args[0] === 'object') sent.push({ environment, payload: args[0] as HotPayload });
			Reflect.apply(original, hot, args);
		};
	}
	return sent;
};

/** The payload the plugin sends when the output changes. */
const RELOAD_PAYLOAD: HotPayload = { type: 'full-reload', path: '*' };

const isReload = (payload: HotPayload): boolean => payload.type === 'full-reload';

const withDevServer = async (
	fn: (server: ViteDevServer, projectRoot: string) => Promise<void>,
	config?: InlineConfig,
	pluginOptions?: VitePluginSvelteDocinfoOptions,
	files: Record<string, string> = PROJECT_FILES
): Promise<void> => {
	await withTestProject(files, async (projectRoot) => {
		let server: ViteDevServer | null = null;
		try {
			server = await createServer({
				...config,
				root: projectRoot,
				configFile: false,
				logLevel: 'silent',
				// `watch: null` swaps chokidar for a no-op emitter, so the only
				// change events are the ones a test emits
				server: { middlewareMode: true, ws: false, watch: null },
				optimizeDeps: { noDiscovery: true },
				plugins: [
					svelteDocinfo({
						projectRoot,
						discovery: 'glob',
						include: ['src/**/*.ts'],
						hmrDebounceMs: 10,
						...pluginOptions
					}),
					...(config?.plugins ?? [])
				]
			});
			await fn(server, projectRoot);
		} finally {
			await server?.close();
		}
	});
};

/** Edits `src/lib/b.ts` to add an export and tells the watcher. */
const changeSource = async (server: ViteDevServer, projectRoot: string): Promise<void> => {
	const file = join(projectRoot, 'src/lib/b.ts');
	await writeFile(file, 'export const b = 1;\nexport const changedExport = 2;\n');
	server.watcher.emit('change', file);
};

const loadVirtual = async (server: ViteDevServer, environment: string): Promise<string> => {
	const result = await server.environments[environment]!.transformRequest(VIRTUAL_ID);
	assert(result, `${environment} serves ${VIRTUAL_ID}`);
	return result.code;
};

/** The module paths in the served virtual module. */
const servedModulePaths = async (server: ViteDevServer): Promise<Array<string>> => {
	const code = await loadVirtual(server, 'ssr');
	return [...code.matchAll(/"path":\s*"([^"]+)"/g)].map((m) => m[1]!);
};

/** `a.ts` is the package's one export; it imports `b.ts`, which is not exported. */
const EXPORTS_PROJECT_FILES = {
	'package.json': JSON.stringify({
		name: 'test-pkg',
		exports: { './a.js': { default: './dist/a.js' } }
	}),
	'src/lib/a.ts': "import { b } from './b.ts';\nexport const a = b;\n",
	'src/lib/b.ts': 'export const b = 1;\n'
};

describe('svelteDocinfo dev inputs', () => {
	test(
		'an edit to a context file reaches its importer without emitting a module',
		async () => {
			await withDevServer(
				async (server, projectRoot) => {
					assert.deepEqual(await servedModulePaths(server), ['a.ts']);
					assert.notInclude(await loadVirtual(server, 'ssr'), 'changed');

					const file = join(projectRoot, 'src/lib/b.ts');
					await writeFile(file, "export const b = 'changed';\n");
					server.watcher.emit('change', file);
					await waitFor(
						() =>
							server.environments.ssr.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
								?.transformResult === null,
						'the ssr invalidation'
					);

					// `a`'s type follows the edit, and `b.ts` is still not a module:
					// a cold build of this tree wouldn't discover it either
					assert.include(await loadVirtual(server, 'ssr'), 'changed');
					assert.deepEqual(await servedModulePaths(server), ['a.ts']);
				},
				undefined,
				{ discovery: 'exports', include: undefined },
				EXPORTS_PROJECT_FILES
			);
		},
		TEST_TIMEOUT
	);

	test(
		'a new file is an input only when discovery selects it',
		async () => {
			// glob discovery covers the new file (the harness's `src/**` include
			// makes module paths relative to `src`)
			await withDevServer(async (server, projectRoot) => {
				assert.deepEqual(await servedModulePaths(server), ['lib/a.ts', 'lib/b.ts']);
				const file = join(projectRoot, 'src/lib/c.ts');
				await writeFile(file, 'export const c = 1;\n');
				server.watcher.emit('add', file);
				await waitFor(
					() =>
						server.environments.ssr.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
							?.transformResult === null,
					'the ssr invalidation'
				);
				assert.deepEqual(await servedModulePaths(server), ['lib/a.ts', 'lib/b.ts', 'lib/c.ts']);
			});

			// an explicit exports map doesn't; the next real change shows it stayed out
			await withDevServer(
				async (server, projectRoot) => {
					assert.deepEqual(await servedModulePaths(server), ['a.ts']);
					const added = join(projectRoot, 'src/lib/c.ts');
					await writeFile(added, 'export const c = 1;\n');
					server.watcher.emit('add', added);

					const file = join(projectRoot, 'src/lib/a.ts');
					await writeFile(
						file,
						"import { b } from './b.ts';\nexport const a = b;\nexport const a2 = 2;\n"
					);
					server.watcher.emit('change', file);
					await waitFor(
						() =>
							server.environments.ssr.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
								?.transformResult === null,
						'the ssr invalidation'
					);
					assert.include(await loadVirtual(server, 'ssr'), 'a2');
					assert.deepEqual(await servedModulePaths(server), ['a.ts']);
				},
				undefined,
				{ discovery: 'exports', include: undefined },
				EXPORTS_PROJECT_FILES
			);
		},
		TEST_TIMEOUT * 2
	);
});

const waitForInvalidation = (server: ViteDevServer): Promise<void> =>
	waitFor(
		() =>
			server.environments.ssr.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)?.transformResult ===
			null,
		'the ssr invalidation'
	);

describe('svelteDocinfo dev inputs across debounce windows', () => {
	test(
		'a new file its importer reached first still becomes an input on its add event',
		async () => {
			await withDevServer(async (server, projectRoot) => {
				assert.deepEqual(await servedModulePaths(server), ['lib/a.ts', 'lib/b.ts']);

				// the importer's edit lands first, so the closure ingests the new
				// file as context before the watcher reports it
				const added = join(projectRoot, 'src/lib/c.ts');
				await writeFile(added, 'export const c = 1;\n');
				const importer = join(projectRoot, 'src/lib/a.ts');
				await writeFile(importer, "import { c } from './c.ts';\nexport const a = c;\n");
				server.watcher.emit('change', importer);
				await waitForInvalidation(server);
				await loadVirtual(server, 'ssr');

				server.watcher.emit('add', added);
				await waitForInvalidation(server);
				assert.deepEqual(await servedModulePaths(server), ['lib/a.ts', 'lib/b.ts', 'lib/c.ts']);
			});
		},
		TEST_TIMEOUT
	);

	test(
		'a new file whose add is overtaken by a change still becomes an input',
		async () => {
			await withDevServer(async (server, projectRoot) => {
				assert.deepEqual(await servedModulePaths(server), ['lib/a.ts', 'lib/b.ts']);
				// create-then-write: the change lands while the add's read is in
				// flight and supersedes it, but the file is still new
				const added = join(projectRoot, 'src/lib/c.ts');
				await writeFile(added, 'export const c = 1;\n');
				server.watcher.emit('add', added);
				server.watcher.emit('change', added);
				await waitForInvalidation(server);
				assert.deepEqual(await servedModulePaths(server), ['lib/a.ts', 'lib/b.ts', 'lib/c.ts']);
			});
		},
		TEST_TIMEOUT
	);

	test(
		'a context dependency deleted and recreated types its importer again',
		async () => {
			const button = `<script lang="ts">\n\tlet { variant }: { variant: 'primary' | 'secondary' } = $props();\n</script>\n<button>{variant}</button>`;
			await withDevServer(
				async (server, projectRoot) => {
					assert.deepEqual(await servedModulePaths(server), ['Modal.svelte']);
					assert.include(await loadVirtual(server, 'ssr'), 'secondary');

					const file = join(projectRoot, 'src/lib/Button.svelte');
					await rm(file);
					server.watcher.emit('unlink', file);
					await waitForInvalidation(server);
					assert.notInclude(await loadVirtual(server, 'ssr'), 'secondary');

					// the importer is unchanged, so only the plugin handing the file
					// back restores what the checker sees
					await writeFile(file, button);
					server.watcher.emit('add', file);
					await waitForInvalidation(server);
					assert.include(await loadVirtual(server, 'ssr'), 'secondary');
					assert.deepEqual(await servedModulePaths(server), ['Modal.svelte']);
				},
				undefined,
				{ discovery: 'exports', include: undefined },
				{
					'package.json': JSON.stringify({
						name: 'test-pkg',
						exports: { './Modal.svelte': { svelte: './dist/Modal.svelte' } }
					}),
					'src/lib/Button.svelte': button,
					'src/lib/Modal.svelte': `<script lang="ts">\n\timport type { ComponentProps } from 'svelte';\n\timport Button from './Button.svelte';\n\tlet { confirm }: { confirm: ComponentProps<typeof Button>['variant'] } = $props();\n</script>\n<Button variant={confirm} />`
				}
			);
		},
		TEST_TIMEOUT
	);
});

describe('svelteDocinfo dev environments', () => {
	test(
		'a change invalidates the virtual module in every environment that loaded it',
		async () => {
			// SvelteKit loads the module in `ssr` as well as `client`, and a
			// framework or adapter can name its own server environment, stood in
			// for by `edge`; `worker` never loads it
			const loaded = ['client', 'ssr', 'edge'];
			await withDevServer(
				async (server, projectRoot) => {
					const sent = recordHotSends(server);
					for (const name of loaded) {
						const code = await loadVirtual(server, name);
						assert.notInclude(code, 'changedExport');
						// a self-accepting data module would re-run while its importers
						// kept the old values, so the module has no HMR boundary
						assert.notInclude(code, 'import.meta.hot', `${name} has no HMR boundary`);
					}

					await changeSource(server, projectRoot);
					await waitFor(() => sent.some((s) => isReload(s.payload)), 'the reload');

					for (const name of loaded) {
						const mod = server.environments[name]!.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
						assert(mod, `${name} has the module`);
						assert.isNull(mod.transformResult, `${name} invalidated the module`);
						assert.include(await loadVirtual(server, name), 'changedExport', `${name} reloads`);
					}
					assert.isUndefined(
						server.environments.worker!.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID),
						'an environment that never loaded the module gains no node'
					);

					assert.deepEqual(
						sent,
						[{ environment: 'client', payload: RELOAD_PAYLOAD }],
						'one full reload, on the client environment only'
					);
				},
				{ environments: { edge: {}, worker: {} } }
			);
		},
		TEST_TIMEOUT
	);

	test(
		'no reload is sent when only a server environment loaded the module',
		async () => {
			await withDevServer(async (server, projectRoot) => {
				const sent = recordHotSends(server);
				assert.notInclude(await loadVirtual(server, 'ssr'), 'changedExport');

				await changeSource(server, projectRoot);
				await waitFor(
					() =>
						server.environments.ssr.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
							?.transformResult === null,
					'the ssr invalidation'
				);

				assert.include(await loadVirtual(server, 'ssr'), 'changedExport');
				assert.deepEqual(sent, [], 'no browser loaded the module, so nothing is sent');
			});
		},
		TEST_TIMEOUT
	);

	test(
		'the dev flow reaches none of the server APIs Vite is removing',
		async () => {
			// Vite replaces the mixed `server.moduleGraph`, `server.hot`, and
			// `server.pluginContainer` with per-environment ones, and these flags
			// warn on each use of the old. Dependency resolution stays on, so the
			// dev resolver runs at the initial ingest.
			const logs: CapturedLogs = { warnings: [], errors: [] };
			await withDevServer(
				async (server, projectRoot) => {
					const sent = recordHotSends(server);
					const initial = await loadVirtual(server, 'client');
					assert.include(initial, '"dependencies":["lib/b.ts"]', 'the dev resolver ran');
					await loadVirtual(server, 'ssr');

					await changeSource(server, projectRoot);
					await waitFor(() => sent.some((s) => isReload(s.payload)), 'the reload');
				},
				{
					future: {
						removeServerModuleGraph: 'warn',
						removeServerHot: 'warn',
						removeServerPluginContainer: 'warn'
					},
					customLogger: createCapturingLogger(logs)
				}
			);
			assert.deepEqual(
				logs.warnings.filter((w) => w.includes('vite future')),
				[],
				'no deprecated server API was reached'
			);
			assert.deepEqual(logs.errors, []);
		},
		TEST_TIMEOUT
	);

	test(
		'closing a middleware-mode server runs buildEnd once',
		async () => {
			// middleware mode has no `httpServer` to hear a close on, so the
			// session's disposal hangs off `buildEnd`, which Vite runs for the
			// client environment only when the server closes
			await withTestProject(PROJECT_FILES, async (projectRoot) => {
				const plugin = svelteDocinfo({ projectRoot, discovery: 'glob', include: ['src/**/*.ts'] });
				const buildEnd = plugin.buildEnd as (this: unknown, error?: Error) => void;
				let calls = 0;
				plugin.buildEnd = function (this: unknown, error?: Error) {
					calls++;
					buildEnd.call(this, error);
				};
				const server = await createServer({
					root: projectRoot,
					configFile: false,
					logLevel: 'silent',
					server: { middlewareMode: true, ws: false, watch: null },
					optimizeDeps: { noDiscovery: true },
					environments: { edge: {} },
					plugins: [plugin]
				});
				await loadVirtual(server, 'client');
				assert.strictEqual(calls, 0);
				await server.close();
				assert.strictEqual(calls, 1);
			});
		},
		TEST_TIMEOUT
	);

	test(
		'a middleware-mode restart keeps the session live',
		async () => {
			// an inline-config restart reuses this plugin instance: the new server's `buildStart`
			// creates its session before the old server's `buildEnd` runs, which
			// must leave the new session be
			await withDevServer(async (server, projectRoot) => {
				assert.notInclude(await loadVirtual(server, 'client'), 'changedExport');
				await server.restart();
				assert.notInclude(await loadVirtual(server, 'client'), 'changedExport');

				const sent = recordHotSends(server);
				await changeSource(server, projectRoot);
				await waitFor(() => sent.some((s) => isReload(s.payload)), 'the reload after restart');
				assert.include(await loadVirtual(server, 'client'), 'changedExport');
			});
		},
		TEST_TIMEOUT
	);

	test(
		'a failed restart leaves the plugin on the old server',
		async () => {
			// Vite builds the new server before closing the old one; when building
			// it fails, Vite logs the failure and keeps the old server running, so
			// the plugin must keep resolving and reloading through the old one
			const logs: CapturedLogs = { warnings: [], errors: [] };
			let failConfigureServer = false;
			// the server whose creation fails, held in an object so its type doesn't narrow to `null`
			const failed: { server: ViteDevServer | null } = { server: null };
			const failOnRestart: Plugin = {
				name: 'fail-on-restart',
				configureServer(s) {
					if (!failConfigureServer) return;
					failed.server = s;
					throw new Error('configureServer failed on restart');
				}
			};
			await withDevServer(
				async (server, projectRoot) => {
					assert.notInclude(await loadVirtual(server, 'client'), 'changedExport');
					failConfigureServer = true;
					await server.restart();
					failConfigureServer = false;
					assert.include(logs.errors, 'server restart failed', 'Vite logs the failure');

					const sent = recordHotSends(server);
					// edits the importer, so its dependency resolves again after the restart
					const file = join(projectRoot, 'src/lib/a.ts');
					await writeFile(
						file,
						"import { b } from './b.ts';\nexport const a = b + 1;\nexport const changedExport = 2;\n"
					);

					// the server that failed to be created still has the plugin's
					// watcher listeners, and Vite never closes its watcher, but it was
					// never adopted, so its events are dropped
					assert(failed.server, 'the failing plugin saw the new server');
					failed.server.watcher.emit('change', file);
					await new Promise((r) => setTimeout(r, 500));
					assert.deepEqual(sent, [], 'the failed server feeds nothing');

					server.watcher.emit('change', file);
					await waitFor(
						() => sent.some((s) => isReload(s.payload)),
						'the reload on the old server'
					);

					const code = await loadVirtual(server, 'client');
					assert.include(code, 'changedExport', 'the old server serves the new output');
					assert.include(code, '"dependencies":["lib/b.ts"]', 'the dependency still resolves');
					assert.notInclude(code, 'resolver_failed');
				},
				{ customLogger: createCapturingLogger(logs), plugins: [failOnRestart] }
			);
		},
		TEST_TIMEOUT
	);

	test(
		'a change pending when the server closes is dropped, and the process stays live',
		async () => {
			// With the session gone after `buildEnd`, a flush that kept the pending
			// change would loop on microtasks forever and starve every timer, so
			// the scenario runs in a child process the test can kill: a spin fails
			// on the deadline instead of wedging the test worker
			await withTestProject(PROJECT_FILES, async (projectRoot) => {
				const viteUrl = pathToFileURL(join(PROJECT_ROOT, 'node_modules/vite/dist/node/index.js'));
				const pluginUrl = pathToFileURL(join(PROJECT_ROOT, 'src/lib/vite.ts'));
				const file = join(projectRoot, 'src/lib/b.ts');
				const script = join(projectRoot, 'close-pending.mjs');
				await writeFile(
					script,
					`import { createServer } from ${JSON.stringify(viteUrl.href)};
import svelteDocinfo from ${JSON.stringify(pluginUrl.href)};
import { writeFile } from 'node:fs/promises';
const projectRoot = ${JSON.stringify(projectRoot)};
const file = ${JSON.stringify(file)};
const server = await createServer({
	root: projectRoot,
	configFile: false,
	logLevel: 'silent',
	server: { middlewareMode: true, ws: false, watch: null },
	optimizeDeps: { noDiscovery: true },
	plugins: [svelteDocinfo({ projectRoot, discovery: 'glob', include: ['src/**/*.ts'], hmrDebounceMs: 300 })]
});
await server.environments.client.transformRequest('virtual:svelte-docinfo');
await writeFile(file, 'export const b = 1;\\nexport const changedExport = 2;\\n');
server.watcher.emit('change', file);
// the change is read and enqueued, and the debounce is still pending
await new Promise((r) => setTimeout(r, 50));
await server.close();
// the debounce fires after the close
await new Promise((r) => setTimeout(r, 600));
console.log('alive');
process.exit(0);
`
				);
				const { code, stdout, stderr } = await runSubprocess(process.execPath, [script], {
					cwd: projectRoot,
					timeoutMs: SUBPROCESS_TIMEOUT
				});
				assert.strictEqual(code, 0, `the process exits on its own rather than spinning\n${stderr}`);
				assert.include(stdout, 'alive');
			});
		},
		SUBPROCESS_TEST_TIMEOUT
	);
});
