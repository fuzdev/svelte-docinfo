<script lang="ts">
	import 'virtual:fuz.css';
	import '@fuzdev/fuz_code/theme.css';

	import ThemeRoot from '@fuzdev/fuz_ui/ThemeRoot.svelte';
	import {SiteState, site_context} from '@fuzdev/fuz_ui/site.svelte.ts';
	import type {Snippet} from 'svelte';
	import pkg_json from 'virtual:pkg.json';

	import {logo_svelte_docinfo} from '$lib/logo.ts';

	const {
		children,
	}: {
		children: Snippet;
	} = $props();

	site_context.set(new SiteState({icon: logo_svelte_docinfo, pkg_json}));
</script>

<svelte:head>
	<title>svelte-docinfo</title>
</svelte:head>

<ThemeRoot>
	{@render children()}
</ThemeRoot>
