<script module lang="ts">
	import { z } from 'zod';

	/** A schema whose inferred type shares its name (the merged value+type pattern). */
	export const Point = z.strictObject({ x: z.number(), y: z.number() });
	export type Point = z.infer<typeof Point>;

	/** An inferred (unannotated) return of the lost type — the registry recovers the name. */
	export const parsePoint = (input: unknown) => Point.parse(input);
</script>

<script lang="ts">
	interface Props {
		/** The point to render — typed by the alias-lost inferred type. */
		point: Point;
	}

	const { point }: Props = $props();
</script>

<span>{point.x},{point.y}</span>
