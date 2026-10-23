<script lang="ts">
	// resolves first, interning the literals in reverse, which sets the
	// checker's internal order for the union below
	const z = 'a' as 'd' | 'c' | 'b' | 'a';
	const a = { b: { c: 1 } };

	// an indexed-access right-hand side loses `aliasSymbol`; an instance
	// script exports nothing, so only the written channel names it
	type A = (typeof a)['b'];

	interface Props {
		prop1: A;
		prop2?: 'a' | 'b' | 'c' | 'd';
	}

	let { prop1, prop2 = z }: Props = $props();
</script>

<p>{prop1.c}{prop2}</p>
