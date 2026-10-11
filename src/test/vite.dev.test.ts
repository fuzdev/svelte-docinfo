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
 */

import { test, assert, describe } from 'vitest';
import {
	createServer,
	type HotPayload,
	type InlineConfig,
	type Logger,
	type ViteDevServer
} from 'vite';
import { writeFile } from 'node:fs/promises';
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
	pluginOptions?: VitePluginSvelteDocinfoOptions
): Promise<void> => {
	await withTestProject(PROJECT_FILES, async (projectRoot) => {
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
					})
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
