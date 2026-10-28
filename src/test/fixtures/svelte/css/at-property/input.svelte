<div class="a"></div>

<style>
	@property --a {
		syntax: '<color>';
		inherits: true;
		initial-value: red;
	}
	@property --b {
		syntax: '<length>';
		inherits: true;
		initial-value: 1px;
	}
	@property --c {
		syntax: '*';
		inherits: false;
	}
	.a {
		color: var(--a);
		margin: var(--b, 2px);
		padding: var(--c);
	}
</style>
