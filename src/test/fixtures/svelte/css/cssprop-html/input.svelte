<!--
@component
Description 1

@cssprop --b - Description 2
@cssprop --a - Description 3
@cssproperty {<color>} --c - Description 4
@cssprop [--d=2px] - Description 5
@cssprop --x - Description 6
-->
<div class="a"></div>

<style>
	.a {
		color: var(--a, red);
		margin: var(--b);
		background: var(--c, blue);
		padding: var(--d, 1px);
		border-width: var(--e, 3px);
	}
</style>
