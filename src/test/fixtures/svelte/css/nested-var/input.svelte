<div class="a"></div>

<style>
	.a {
		color: var(--a, var(--b, red));
		width: calc(var(--c, 1px) * 2 + var(--d));
		box-shadow:
			0 0 var(--e, 1px) var(--f, var(--g)),
			inset 0 0 var(--h, 2px);
		background: VAR(--i, blue);
	}
</style>
