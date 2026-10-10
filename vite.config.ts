import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-static';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { svelte_preprocess_mdz } from '@fuzdev/mdz/svelte_preprocess_mdz.ts';
import { svelte_preprocess_fuz_code } from '@fuzdev/fuz_code/svelte_preprocess_fuz_code.ts';
import { create_csp_directives } from '@fuzdev/fuz_ui/csp.ts';
import { csp_directives_of_fuzdev } from '@fuzdev/fuz_ui/csp_of_fuzdev.ts';
import { vite_plugin_fuz_css } from '@fuzdev/fuz_css/vite_plugin_fuz_css.ts';
import { vite_plugin_pkg_json } from '@fuzdev/fuz_ui/vite_plugin_pkg_json.ts';
import svelte_docinfo from './src/lib/vite.ts';

export default defineConfig({
	server: {
		// Vite watches the whole root, an inotify watch per file, and gro's `.gro/` output
		// needn't come out of the user's `max_user_watches` budget
		watch: { ignored: ['**/.gro/**'] }
	},
	resolve: {
		// Dependencies (fuz_ui) import `svelte-docinfo/*.js` at runtime, and the package isn't
		// installed in its own `node_modules` (self-reference doesn't apply to imports from
		// inside another package), so point those specifiers at the `src/lib` source. A plain
		// Vite alias, not SvelteKit's deprecated `alias`, which Gro doesn't support.
		alias: [
			{
				find: /^svelte-docinfo\/(.+)\.(?:js|ts)$/,
				replacement: fileURLToPath(new URL('src/lib/$1.ts', import.meta.url))
			}
		]
	},
	plugins: [
		sveltekit({
			preprocess: [svelte_preprocess_mdz(), svelte_preprocess_fuz_code(), vitePreprocess()],
			compilerOptions: { runes: true },
			inspector: true,
			adapter: adapter(),
			paths: { relative: false }, // use root-absolute paths for SSR path comparison: https://svelte.dev/docs/kit/configuration#paths
			csp: { directives: create_csp_directives({ extend: [csp_directives_of_fuzdev] }) },
			version: { name: execSync('git rev-parse HEAD').toString().trim() }
		}),
		svelte_docinfo(),
		vite_plugin_fuz_css(),
		vite_plugin_pkg_json()
	],
	optimizeDeps: { exclude: ['@fuzdev/blake3-wasm'] },
	test: {
		// Cap the fork pool. The suite is TS-typecheck + svelte2tsx bound, so
		// per-worker memory and cache/bandwidth pressure — not core count — is
		// the limit. Vitest's default (`availableParallelism - 1`, ~15 on a
		// 16-core box) was measured strictly worse than 4: slower wall (49s vs
		// 45s), ~55% more peak RAM (7.5GB vs 4.8GB), nearly double the total
		// CPU-work (180s vs 101s) purely to contention. That measurement
		// predates the `_sourceFileCache` in test-module-helpers.ts (which cut
		// `svelte.test.ts`, the anchor file, from ~40s to ~7s) — 4 still works
		// well; re-measure before raising.
		maxWorkers: 4,
		// `svelte.test.ts` cases run svelte2tsx + a TS typecheck each (the
		// `_sourceFileCache` in test-module-helpers.ts pares program setup to
		// ~60ms; the residual cost is `analyzeSvelteModule` itself). Nominal
		// per-case cost is well under 1s, but leftover fork contention can still
		// stretch a case past the 5s default and flake in a way that doesn't
		// repro in isolation. 10s gives a wide cushion while still catching hangs.
		testTimeout: 10_000
	}
});
