<script lang="ts">
	import type { A } from './types.ts';

	let { prop1, ...rest }: A = $props();
</script>

<button {...rest}>{prop1}</button>
