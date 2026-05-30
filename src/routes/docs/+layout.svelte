<script lang="ts">
	import type {Snippet} from 'svelte';
	import Docs from '@fuzdev/fuz_ui/Docs.svelte';
	import {Library, library_context} from '@fuzdev/fuz_ui/library.svelte.js';
	import {library_json_from_modules} from '@fuzdev/fuz_util/library_json.js';
	import type {PackageJson} from '@fuzdev/fuz_util/package_json.js';
	import {modules} from 'virtual:svelte-docinfo';

	import {tomes} from '$routes/docs/tomes.js';
	import package_json from '../../../package.json' with {type: 'json'};

	const {
		children,
	}: {
		children: Snippet;
	} = $props();

	const library_json = library_json_from_modules(package_json as PackageJson, modules);

	const library = library_context.set(new Library(library_json));
</script>

<Docs {tomes} {library}>
	{@render children()}
</Docs>
