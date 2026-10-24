<div class="a"></div>

<style>
	.a {
		/* color: var(--a, red); */
		color: var(--b, /* fallback */ red);
		content: 'var(--c, 1)';
		background: url(a.png) var(--e, blue);
		font-family: var(--f, 'a, b', serif);
	}
</style>
