<!--
@component
@cssprop [--a=blue] - Description 1
@cssprop [--b=var(--c, 1px)] - Description 2
@cssprop [--d=2px] - Description 3
@cssprop [--e=3px] - Description 4
-->
<div class="a"></div>

<style>
	@property --e {
		syntax: '<length>';
		inherits: true;
		initial-value: 4px;
	}
	.a {
		color: var(--a, red);
		margin: var(--b, var(--c, 1px));
		padding: var(--d);
		width: var(--e, 3px);
	}
</style>
