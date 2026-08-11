<script lang="ts">
	import type { A } from './types.ts';

	let { prop1, prop2 }: A = $props();
</script>

<div>
	{prop1}
	{prop2}
</div>
