/**
 * Internal concurrency helpers — bounded `Promise.all` for the few sites
 * where unbounded fan-out would risk resource exhaustion.
 *
 * - `MAX_FILE_CONCURRENCY` — parallel `readFile` cap. Bounds FD pressure so
 *   projects with thousands of source files don't trip `EMFILE` against the
 *   typical 1024-FD ulimit. Used by `files.globFiles` and `exports.discoverFromExports`.
 * - `MAX_RESOLVE_CONCURRENCY` — parallel resolver-call cap for session phase 2.
 *   Async resolvers (Vite/Rollup `resolveId`, user-supplied) get backpressure
 *   instead of a 20k+ task fan-out at once. Sync resolvers (TS default,
 *   no-deps stub) settle in microtasks regardless of the bound.
 *
 * Same numerical value today, separately named so a future tuning pass can
 * move them independently (FD pressure and resolver backpressure are unrelated
 * limits that happen to coincide at this cap).
 *
 * @module
 */

export const MAX_FILE_CONCURRENCY = 100;

export const MAX_RESOLVE_CONCURRENCY = 100;

/**
 * Maps over `items` with a bounded number of in-flight promises, preserving
 * input order.
 *
 * Fail-fast: when `fn` rejects, the outer promise rejects with that error and
 * idle workers stop pulling from the queue (already-in-flight `fn` calls run
 * to completion — there's no `AbortSignal` plumbing). Subsequent rejections
 * from in-flight calls are swallowed by `Promise.all` (only the first wins),
 * so a misbehaving `fn` can't surface a second error after the function
 * returns.
 *
 * @param items - input array
 * @param concurrency - maximum number of concurrent operations
 * @param fn - mapping function (receives item and index)
 * @returns array of results in input order
 */
export const map_concurrent = async <T, R>(
	items: ReadonlyArray<T>,
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<Array<R>> => {
	const results: Array<R> = new Array(items.length);
	let next = 0;
	let failed = false;
	const worker = async (): Promise<void> => {
		while (!failed) {
			const i = next++;
			if (i >= items.length) return;
			try {
				results[i] = await fn(items[i]!, i);
			} catch (err) {
				failed = true;
				throw err;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return results;
};
