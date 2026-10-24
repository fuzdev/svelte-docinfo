<div class="a"><span class="b"></span></div>

<style>
	.a {
		--a: 1px;
		margin: var(--a, 2px);
		padding: var(--b, 3px);
	}
	.b {
		width: var(--c, 4px);
	}
	:global(:root) {
		--c: 5px;
	}
</style>
