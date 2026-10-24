<!--
@component
@cssprop [--a=red] - Description 1
-->
<div class="a"></div>

<style lang="postcss">
	.a {
		color: var(--a, blue);
	}
</style>
