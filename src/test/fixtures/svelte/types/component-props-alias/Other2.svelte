<script lang="ts">
	import type { E } from './base.ts';

	let { e, b }: E & { b: string } = $props();
</script>

<div>{e}{b}</div>
