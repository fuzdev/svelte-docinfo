import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({
	plugins: [svelte(), svelteDocinfo({onDuplicates: 'throw'})],
});
