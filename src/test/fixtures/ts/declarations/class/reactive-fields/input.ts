/**
 * A class with reactive rune fields.
 */
export class A {
	a: number = $state(0);
	b: number = $derived(this.a * 2);
}
