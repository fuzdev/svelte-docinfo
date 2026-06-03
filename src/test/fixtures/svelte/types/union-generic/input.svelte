<script lang="ts">
	import type {HTMLButtonAttributes, HTMLAnchorAttributes} from 'svelte/elements';

	const props: HTMLButtonAttributes | HTMLAnchorAttributes = $props();
</script>

<span>{props.title}</span>
