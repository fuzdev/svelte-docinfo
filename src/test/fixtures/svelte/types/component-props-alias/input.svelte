<script lang="ts">
	import type { A } from './a.ts';

	let { prop }: { prop: A } = $props();
</script>

<div>{prop.a}</div>
