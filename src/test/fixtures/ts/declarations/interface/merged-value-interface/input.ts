export const MergedIface = { a: 'x', b: 1 };
/**
 * Merged const+interface pair — the interface wins.
 */
export interface MergedIface {
	a: string;
	b: number;
}
