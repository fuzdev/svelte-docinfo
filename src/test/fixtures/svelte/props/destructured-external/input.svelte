<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = {
		/** Description 1 */
		prop1?: string;
		/** Description 2 */
		disabled?: boolean;
	} & Omit<HTMLInputAttributes, 'onchange'>;

	let {
		prop1 = $bindable(''),
		type = 'text',
		required,
		class: a = 'a',
		title: b,
		oninput: _,
		'data-attr1': c,
		// @ts-expect-error `onchange` is omitted from the props type
		onchange,
		disabled,
		children,
		...rest
	}: Props = $props();
</script>

<input
	bind:value={prop1}
	{type}
	{required}
	class={a}
	title={b}
	data-attr1={c}
	{disabled}
	{...rest}
/>
{@render children?.()}
