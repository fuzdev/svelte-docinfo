export function fn(
	{
		a,
		// comment
		b = `x
y`,
		c: [d, ...e] = []
	}: { a: string; b?: string; c?: Array<number> },
	...[f, g]: [number, number]
): unknown {
	return [a, b, d, e, f, g];
}
