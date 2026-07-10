import {defineConfig} from 'vitest/config';
import {sveltekit} from '@sveltejs/kit/vite';
import {vite_plugin_fuz_css} from '@fuzdev/fuz_css/vite_plugin_fuz_css.ts';
import {vite_plugin_pkg_json} from '@fuzdev/fuz_ui/vite_plugin_pkg_json.ts';
import svelte_docinfo from 'svelte-docinfo/vite.js';

export default defineConfig({
	plugins: [sveltekit(), svelte_docinfo(), vite_plugin_fuz_css(), vite_plugin_pkg_json()],
	optimizeDeps: {exclude: ['@fuzdev/blake3_wasm']},
	test: {
		// Cap the fork pool. The suite is TS-typecheck + svelte2tsx bound, so
		// per-worker memory and cache/bandwidth pressure — not core count — is
		// the limit. Vitest's default (`availableParallelism - 1`, ~15 on a
		// 16-core box) is strictly worse here: measured against 4 workers it was
		// slower wall (49s vs 45s), used ~55% more peak RAM (7.5GB vs 4.8GB), and
		// nearly doubled total CPU-work (180s vs 101s) purely to contention. Wall
		// time is anchored by the single longest file (`svelte.test.ts`, ~40s),
		// so extra forks buy no throughput — they only stampede the machine.
		// 4 is the measured sweet spot; raise it only after splitting that file.
		maxWorkers: 4,
		// `svelte.test.ts` cases run svelte2tsx + a TS typecheck each (the
		// `_lastProgram` cache in test-module-helpers.ts pares program setup to
		// ~100-200ms; the residual cost is `analyzeSvelteModule` itself). Nominal
		// per-case cost is well under 1s, but leftover fork contention can still
		// stretch a case past the 5s default and flake in a way that doesn't
		// repro in isolation. 10s gives a wide cushion while still catching hangs.
		testTimeout: 10_000,
	},
});
