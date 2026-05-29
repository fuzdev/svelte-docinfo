<script lang="ts">
	let {
		fn1,
		fn2,
		fn3,
	}: {
		/** Description 1 */
		fn1: <T>(value: T) => T;
		/** Description 2 */
		fn2: (...args: string[]) => void;
		/** Description 3 */
		fn3?: (a: string, b: number, ...rest: boolean[]) => Promise<string>;
	} = $props();
</script>

<div>
	{fn1('value')}
	<button onclick={() => fn2('a', 'b')}>text</button>
	{#if fn3}
		<button onclick={async () => await fn3('a', 1, true, false)}>text</button>
	{/if}
</div>
