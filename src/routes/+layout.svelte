<script lang="ts">
	import '$routes/fuz.css';
	import '@fuzdev/fuz_code/theme.css';
	import '$routes/style.css';

	import ThemeRoot from '@fuzdev/fuz_ui/ThemeRoot.svelte';
	import type {Snippet} from 'svelte';

	const {
		children,
	}: {
		children: Snippet;
	} = $props();
</script>

<svelte:head>
	<title>@fuzdev/fuz_template</title>
</svelte:head>

<ThemeRoot>
	{@render children()}
</ThemeRoot>
