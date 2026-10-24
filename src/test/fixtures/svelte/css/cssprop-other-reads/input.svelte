<!--
@component
@cssprop --b - Description 1
@cssprop --c - Description 2
@cssprop --d - Description 3
@cssprop --f - Description 4
@cssprop --g - Description 5
-->
<script lang="ts">
	import Other from './Other.svelte';
</script>

<div class="a" style="color: var(--c, red)" style:margin="var(--g)"></div>
<Other --e="var(--f)" />

<style>
	.a {
		--d: 1px;
		padding: var(--a, var(--b, 2px));
		margin: var(--d);
	}
</style>
