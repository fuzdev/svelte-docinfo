<script lang="ts">
	let {
		prop1,
		prop2
	}: {
		/**
		 * Description 1
		 *
		 * @default "value"
		 * @example
		 * const a = 'text';
		 * @deprecated Description 2
		 * @see https://fuz.dev
		 * @since 1.0.0
		 */
		prop1: string;
		/**
		 * Description 3
		 *
		 * @throws TypeError - Description 4
		 * @throws RangeError - Description 5
		 * @see {@link https://fuz.dev}
		 * @see fn1
		 */
		prop2?: number;
	} = $props();
</script>

<div>{prop1} {prop2}</div>
