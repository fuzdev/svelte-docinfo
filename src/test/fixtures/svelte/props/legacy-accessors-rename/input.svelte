<svelte:options runes={false} />

<script lang="ts">
	type T = number;
	export type { T };

	/** Description 1 */
	export const a = 1;
	export function fn(): number {
		return a;
	}
	const b = 2;
	export { b };

	let c = 'value';
	/** Description 2 */
	export { c as class };
	export let d: number;
	let e = true;
	export { e };
</script>

<div class={c}>{a} {b} {d satisfies T} {e}</div>
