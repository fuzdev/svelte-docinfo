<div class="a"><span></span></div>

<style>
	.a {
		color: var(--a, red);
		span {
			color: var(--b, red);
		}
		&:hover {
			color: var(--c, red);
		}
		@media (min-width: 1px) {
			color: var(--d, red);
		}
	}
	@container (min-width: 1px) {
		.a {
			color: var(--e, red);
		}
	}
	@supports (display: grid) {
		.a {
			color: var(--f, red);
		}
	}
	@keyframes -global-a {
		from {
			opacity: var(--g, 0);
		}
	}
	:global(.b) .a {
		color: var(--h, red);
	}
	:global {
		.c {
			color: var(--i, red);
		}
	}
</style>
