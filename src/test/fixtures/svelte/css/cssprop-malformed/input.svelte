<!--
@component
Description 1

@cssprop --a - Description 2
@cssprop a - Description 3
@cssprop --a - Description 4
@cssprop {<color> --b - Description 5
@cssprop
@cssproperty --a - Description 6
@cssprop
  --c - Description 7
@cssprop [--d=var(--e,
  1px)] - Description 8
@cssprop d - Description 9
-->
<div class="a"></div>

<style>
	.a {
		color: var(--a, red);
		margin: var(--c);
		padding: var(--d, var(--e, 1px));
	}
</style>
