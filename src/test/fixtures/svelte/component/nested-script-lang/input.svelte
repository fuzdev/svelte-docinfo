<div>
	<script lang="ts">
		const nested: number = 1;
	</script>
</div>

<script>
	/** @type {{a: string, b?: number}} */
	let { a, b = 1 } = $props();
</script>

<div>{a}{b}</div>
