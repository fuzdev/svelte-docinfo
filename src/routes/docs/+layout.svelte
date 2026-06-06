<script lang="ts">
	import type {Snippet} from 'svelte';
	import Docs from '@fuzdev/fuz_ui/Docs.svelte';
	import {Library, library_context} from '@fuzdev/fuz_ui/library.svelte.js';
	import {library_json_from_modules} from '@fuzdev/fuz_util/library_json.js';
	import {modules} from 'virtual:svelte-docinfo';
	import pkg_json from 'virtual:pkg.json';

	import {tomes} from '$routes/docs/tomes.js';

	const {
		children,
	}: {
		children: Snippet;
	} = $props();

	const library_json = library_json_from_modules(pkg_json, modules);

	library_context.set(new Library(library_json));
</script>

<Docs {tomes}>
	{@render children()}
</Docs>
