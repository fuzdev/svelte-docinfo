/**
 * Optional properties whose declared type includes `null`.
 */
export type A = {
	a?: null;
	b?: string | null;
	c?: (() => void) | null;
	d?: null | undefined;
	e?: string;
	f?: () => void;
	g: string | null;
	h?: undefined;
	i?: (() => void) | (() => number);
};
