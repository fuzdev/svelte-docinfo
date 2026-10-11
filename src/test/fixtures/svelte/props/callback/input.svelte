<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLButtonAttributes, MouseEventHandler } from 'svelte/elements';

	type A = (x: string, y?: number) => void;

	type Props = HTMLButtonAttributes & {
		/** Description 1 */
		a: (x: string) => void;
		/** Description 2 */
		b?: () => void;
		c: (() => void) | null;
		d?: A;
		e?: (x: number) => Promise<Array<string>>;
		f?: <T>(x: T, ...y: Array<T>) => T;
		g?: { (x: string): void; (x: number, y: boolean): void };
		h?: ((x: string) => void) | ((y: number) => void);
		i?: MouseEventHandler<HTMLButtonElement>;
		onclick?: (x: string) => void;
		j?: Component<{ x: number }>;
		k?: Snippet<[x: string]>;
		l?: new (x: number) => Date;
	};

	let { a, b, c, d, e, f, g, h, i, onclick, j, k, l, ...rest }: Props = $props();
</script>

<button
	{...rest}
	onclick={() => {
		a('a');
		b?.();
		c?.();
		d?.('a');
		void e?.(1);
		f?.(1);
		g?.('a');
		onclick?.('a');
	}}
>
	{h}{i}{j}{l}
	{@render k?.('a')}
</button>
