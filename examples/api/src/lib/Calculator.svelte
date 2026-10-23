<!--
	@component
	A calculator that applies `mode` to `result` and the entered number,
	optionally rounding to the configured precision.
-->

<!--
	@module
	Module docs via the HTML comment form, alongside the component comment
	above, which documents the component itself. See `Card.svelte` for the
	in-script JSDoc form of each.
-->

<script lang="ts">
	import { add, multiply, roundTo, type MathConfig } from './math.js';

	let {
		result = $bindable(0),
		config,
		mode = 'add',
		disabled = false,
		onresult
	}: {
		/** Current result (bindable). */
		result?: number;
		/** Math configuration. */
		config?: MathConfig;
		/** Operation mode. */
		mode?: 'add' | 'multiply';
		/** Disable the calculator. */
		disabled?: boolean;
		/** Called with each new result. */
		onresult?: (value: number) => void;
	} = $props();

	let inputValue = $state(0);

	const calculate = () => {
		if (disabled) return;
		const op = mode === 'add' ? add : multiply;
		const value = op(result, inputValue);
		result = config?.round ? roundTo(value, config.precision) : value;
		onresult?.(result);
	};
</script>

<div class="calculator">
	<output>{result}</output>
	<input type="number" bind:value={inputValue} {disabled} />
	<button onclick={calculate} {disabled}>
		{mode === 'add' ? 'Add' : 'Multiply'}
	</button>
</div>

<style>
	.calculator {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	output {
		font-size: 2rem;
		font-weight: bold;
	}
</style>
