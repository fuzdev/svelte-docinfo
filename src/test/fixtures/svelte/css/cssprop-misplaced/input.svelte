<script lang="ts" module>
	/**
	 * Description 1
	 *
	 * @cssprop --a - Description 2
	 * @module
	 */

	/**
	 * Description 3
	 *
	 * @cssprop --b - Description 4
	 */
	export const fn = (): void => {};
</script>

<div class="a"></div>

<style>
	.a {
		color: var(--a, red);
	}
</style>
