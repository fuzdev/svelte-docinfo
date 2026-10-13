<svelte:options runes={false} />

<script lang="ts" generics="T extends { a: string }, U = T[]">
	export let a: T;
	export let b: Array<T> = [];
	export let c: U | undefined = undefined;
	export let d: (x: T) => void;
</script>

<div>{a.a} {b.length} {c} {d}</div>
