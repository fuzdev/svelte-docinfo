/**
 * Nested object types.
 */
export type A = {
	a: {
		b: {
			c: string;
			d: number;
		};
		e: boolean;
	};
	f: Array<{ g: string }>;
};
