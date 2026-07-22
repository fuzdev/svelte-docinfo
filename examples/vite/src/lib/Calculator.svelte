<!--
	@component
	Calculator component for demonstrating Svelte analysis.
-->

<script lang="ts">
	import { add, multiply, type MathConfig } from './math.js';

	let {
		result = $bindable(0),
		config,
		mode = 'add',
		disabled = false
	}: {
		/** Current result (bindable). */
		result?: number;
		/** Math configuration. */
		config?: MathConfig;
		/** Operation mode. */
		mode?: 'add' | 'multiply';
		/** Disable the calculator. */
		disabled?: boolean;
	} = $props();

	let input_value = $state(0);

	const calculate = () => {
		if (disabled) return;
		const op = mode === 'add' ? add : multiply;
		let value = op(result, input_value);
		if (config?.round) {
			const factor = 10 ** config.precision;
			value = Math.round(value * factor) / factor;
		}
		result = value;
	};
</script>

<div class="calculator">
	<output>{result}</output>
	<input type="number" bind:value={input_value} {disabled} />
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
