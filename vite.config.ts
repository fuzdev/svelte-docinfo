import {defineConfig} from 'vite';
import {sveltekit} from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	optimizeDeps: {exclude: ['@fuzdev/blake3_wasm']},
});
