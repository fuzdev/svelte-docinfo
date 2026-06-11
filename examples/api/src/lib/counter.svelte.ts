/**
 * A reactive counter demonstrating Svelte 5 rune detection in plain
 * `.svelte.ts` modules — `$state`, `$state.raw`, `$derived`, and
 * `$derived.by` initializers surface on the `reactivity` field.
 * @module
 */

/** A reactive counter built on Svelte 5 runes. */
export class Counter {
	/** Current count. */
	count: number = $state(0);
	/** Past counts; replaced wholesale on change, so raw state. */
	history: ReadonlyArray<number> = $state.raw([]);
	/** Double the current count. */
	doubled: number = $derived(this.count * 2);
	/** Display label computed from several fields. */
	label: string = $derived.by(() => `count: ${this.count} (doubled: ${this.doubled})`);

	/**
	 * Increment the count, recording the previous value.
	 * @param amount - how much to add
	 * @mutates `this`
	 */
	increment(amount: number = 1): void {
		this.history = [...this.history, this.count];
		this.count += amount;
	}
}
