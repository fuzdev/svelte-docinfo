<script module lang="ts">
	import * as v from 'valibot';

	/** A schema whose inferred type shares its name (the merged value+type pattern). */
	export const Point = v.strictObject({ x: v.number(), y: v.number() });
	export type Point = v.InferOutput<typeof Point>;

	/** An inferred (unannotated) return of the lost type — the registry recovers the name. */
	export const parsePoint = (input: unknown) => v.parse(Point, input);
</script>

<script lang="ts">
	interface Props {
		/** The point to render — typed by the alias-lost inferred type. */
		point: Point;
	}

	const { point }: Props = $props();
</script>

<span>{point.x},{point.y}</span>
