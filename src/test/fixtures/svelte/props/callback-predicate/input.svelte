<script lang="ts" module>
	export interface A {
		a: number;
	}
</script>

<script lang="ts">
	const {
		prop1,
		prop2,
		prop3
	}: {
		prop1: (x: unknown) => x is A;
		prop2?: (x: unknown) => asserts x is Array<A>;
		prop3?: (this: A, { a }: A) => void;
	} = $props();
</script>

{prop1}{prop2}{prop3}
