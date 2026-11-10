/**
 * Repo-typecheck stand-ins for the synthetic packages multi-file fixtures
 * import from their `external/` subdirectories.
 *
 * Fixture analysis never loads this file — each fixture's in-memory program
 * resolves a bare specifier against the fixture's own `external/` stubs (see
 * `resolveFixtureSpecifier` in `ts-test-helpers.ts`) — so these declarations
 * exist only so the repo's own typecheck pass accepts the imports. Keep each
 * module a superset of every same-named `external/` stub; a fixture import
 * missing here fails `gro typecheck` loudly — add the name when that happens.
 */

declare module 'extpkg' {
	export const a: number;
	export function fn1(b: string): number;
	export interface C {
		c1: string;
	}
	export interface B {
		[key: string]: unknown;
		b1?: string;
		b2?: number;
	}
	export interface D {
		[key: string]: unknown;
		d1?: string;
	}
}

declare module 'otherpkg' {
	export const d: boolean;
}

declare module 'callpkg' {
	export function spawnish(cmd: string, args: Array<string>): number;
	export function spawnish(cmd: string): number;
}

declare module 'schemapkg' {
	export interface Schema<O> {
		readonly _output: O;
	}
	export type Infer<S> = S extends Schema<infer O> ? O : never;
	export type ObjectOutput<E extends { [key: string]: Schema<unknown> }> = {
		[K in keyof E]: Infer<E[K]>;
	};
	export const string: Schema<string>;
	export const number: Schema<number>;
	export const object: <E extends { [key: string]: Schema<unknown> }>(
		entries: E
	) => Schema<ObjectOutput<E>>;
}

declare module 'utilpkg' {
	export type Exclude<T, U> = T extends U ? never : T;
	export type Pick<T, K extends keyof T> = { [P in K]: T[P] };
	export type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
	export type Partial<T> = { [P in keyof T]?: T[P] };
	export type Readonly<T> = { readonly [P in keyof T]: T[P] };
}
