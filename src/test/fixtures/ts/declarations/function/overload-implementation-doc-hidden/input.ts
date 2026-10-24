/** Description 1. */
export default function (a: string): string;
export default function (a: number): number;
/** Description 2. */
export default function (a: string | number): string | number {
	return a;
}

export function fn1(a: string): string;
export function fn1(a: number): number;
/** Description 3. */
export function fn1(a: string | number): string | number {
	return a;
}

export { fn1 as fn2 };
