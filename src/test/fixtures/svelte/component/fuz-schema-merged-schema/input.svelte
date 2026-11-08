<script module lang="ts">
	import * as s from '@fuzdev/fuz_schema/schema.ts';

	/** A schema whose inferred type shares its name (the merged value+type pattern). */
	export const Point = s.object({ x: s.number, y: s.number });
	export type Point = s.Infer<typeof Point>;

	/** An inferred (unannotated) return of the lost type — the registry recovers the name. */
	export const parsePoint = (input: unknown) => s.parse_or_throw(Point, input);
</script>

<script lang="ts">
	interface Props {
		/** The point to render — typed by the alias-lost inferred type. */
		point: Point;
	}

	const { point }: Props = $props();
</script>

<span>{point.x},{point.y}</span>
