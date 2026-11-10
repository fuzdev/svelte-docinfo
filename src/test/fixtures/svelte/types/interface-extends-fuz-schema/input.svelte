<script module lang="ts">
	import * as s from '@fuzdev/fuz_schema/schema.ts';

	const AEntries = {
		/** Description 1 */
		a: s.string,
		b: s.optional(s.number)
	};

	/** Description 2 */
	export const A = s.object(AEntries);
	/** An interface over an inferred schema type documents the inferred members. */
	export interface A extends s.Infer<typeof A> {}

	/** Description 3 */
	export interface B extends s.SchemaStrictObjectOutput<typeof AEntries> {}
</script>

<script lang="ts">
	const { prop }: { prop: A } = $props();
</script>

<span>{prop.a}</span>
