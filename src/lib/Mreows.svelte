<script module lang="ts">
	export interface Mreow {
		glyph: string;
	}

	export const mreow_items: Array<Mreow> = [
		{glyph: '🐵'},
		{glyph: '🐶'},
		{glyph: '🐺'},
		{glyph: '🦊'},
		{glyph: '🐱'},
		{glyph: '🦁'},
		{glyph: '🐯'},
		{glyph: '🐴'},
		{glyph: '🦄'},
		{glyph: '🦓'},
		{glyph: '🐮'},
		{glyph: '🐭'},
		{glyph: '🐹'},
		{glyph: '🐰'},
		{glyph: '🐻'},
		{glyph: '🐼'},
		{glyph: '🐸'},
		{glyph: '🐲'},
	];
</script>

<script lang="ts">
	import {random_item} from '@fuzdev/fuz_util/random.js';

	import Positioned from './Positioned.svelte';

	// don't use this component, it's just a hacky demo

	let {
		mreows = $bindable([]),
	}: {
		mreows?: Array<Mreow>;
	} = $props();

	const mreow = (): void => {
		mreows = [{...random_item(mreow_items)}].concat(mreows);
	};

	const COLUMN_COUNT = 5;
	const PADDING = 40;
	const ICON_SCALE = 0.8;

	interface LayoutItem {
		index: number;
		x: number;
		y: number;
		scale: number;
		row: number;
		column: number;
		mreow: Mreow;
		font_size: number;
	}

	// TODO tweened x/y?
	const create_layout = (mreows: Array<Mreow>, width: number): Array<LayoutItem> => {
		const column_width = Math.floor((width - PADDING * 2) / COLUMN_COUNT);
		const ROW_HEIGHT = column_width;
		return mreows.map((mreow, i): LayoutItem => {
			const row = Math.floor(i / COLUMN_COUNT);
			const flowsLeft = row % 2 === 1;
			const column = flowsLeft ? COLUMN_COUNT - 1 - (i % COLUMN_COUNT) : i % COLUMN_COUNT;
			return {
				index: i,
				x: column * column_width + PADDING,
				y: row * ROW_HEIGHT,
				row,
				column,
				scale: 1,
				mreow,
				font_size: column_width * ICON_SCALE,
			};
		});
	};

	let clientWidth: number | undefined = $state.raw();

	const layout: Array<LayoutItem> = $derived(
		clientWidth === undefined ? [] : create_layout(mreows.slice(1), clientWidth),
	);
</script>

<button type="button" class="row py_md px_xl" onclick={mreow}
	><div class="font_size_xl5">{mreows[0]?.glyph ?? '✨'}</div>
	<div class="mreow">mreow</div></button
>
<div class="mreows" bind:clientWidth>
	{#each layout as item, i (item.mreow)}<Positioned
			x={item.x}
			y={item.y}
			scale={item.scale + Math.cos(i) / 2.5}
			><span style:font-size="{item.font_size}px">{item.mreow.glyph}</span></Positioned
		>{/each}
</div>

<style>
	.mreows {
		position: relative;
		width: 100%;
		margin-top: 4rem;
	}
	/* horrible hack but it's fine, this component shouldn't be used */
	:global(body) {
		overflow-x: hidden;
	}
	.mreow {
		font-size: var(--font_size_xl3);
		font-weight: 300;
		width: 150px;
	}
	button:hover .mreow {
		font-weight: 500;
	}
	button:active .mreow {
		font-weight: 900;
	}
</style>
