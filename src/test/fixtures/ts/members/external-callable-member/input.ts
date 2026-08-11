import type { spawnish } from 'callpkg';

/**
 * Options whose callable member is typed by an external function — the
 * external overload set, its docs, and its tag-validation warnings must not
 * be harvested into output.
 */
export interface RunnerOptions {
	/** Custom runner for testing. */
	run?: typeof spawnish;
	/** Local callable, enumerated as always. */
	local?: (a: string) => number;
}
