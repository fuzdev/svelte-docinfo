import {defineConfig} from 'vitest/config';
import {sveltekit} from '@sveltejs/kit/vite';
import {vite_plugin_fuz_css} from '@fuzdev/fuz_css/vite_plugin_fuz_css.js';
import svelte_docinfo from 'svelte-docinfo/vite.js';

export default defineConfig({
	plugins: [vite_plugin_fuz_css(), sveltekit(), svelte_docinfo()],
	optimizeDeps: {exclude: ['@fuzdev/blake3_wasm']},
	test: {
		// svelte.test.ts has ~50 cases at 1.3–2.3s wall each due to inherent
		// svelte2tsx + TS typecheck cost (the `_lastProgram` cache in
		// test-module-helpers.ts already pares program setup to ~100-200ms;
		// the residual cost is `analyzeSvelteModule` itself). Under `gro check`
		// fork contention these can stretch past the 5s default, causing flakes
		// that don't repro in isolation. 10s gives a 4x cushion on nominal cost
		// while still catching real hangs.
		testTimeout: 10_000,
	},
});
