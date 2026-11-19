export class A<T = unknown> {
	a!: T;
}

/**
 * @throws {A<string>} Description 1
 * @throws {A | C} Description 2
 * @throws {A} Description 3
 * @throws A Description 4
 * @throws {Unknown<string>} Description 5
 */
export function fn(): void {}

export class C {}

export interface B {
	/** @throws {A<number>} Description 1 */
	fn(): void;
}
