/**
 * Tests for `src/lib/concurrency.ts`:
 *
 * - `map_concurrent` ordering, bounding, fail-fast, and degenerate inputs.
 *
 * The constants `MAX_FILE_CONCURRENCY` / `MAX_RESOLVE_CONCURRENCY` are exercised
 * indirectly via integration trip-wires elsewhere (`files.test.ts`,
 * `analyze.session.test.ts`); this file targets the helper itself.
 */

import {test, assert, describe} from 'vitest';

import {map_concurrent} from '$lib/concurrency.ts';

// Tiny resolved-after-N-microtasks delay; avoids real timers so suite stays fast.
const microtask_delay = (n: number): Promise<void> => {
	let p = Promise.resolve();
	for (let i = 0; i < n; i++) p = p.then();
	return p;
};

describe('map_concurrent', () => {
	describe('basic functionality', () => {
		test('preserves input order regardless of resolve order', async () => {
			const items = [0, 1, 2, 3, 4];
			// fn for index 0 settles last, index 4 first — order must still match input.
			const result = await map_concurrent(items, 4, async (n) => {
				await microtask_delay(10 - n * 2);
				return n * 10;
			});
			assert.deepStrictEqual(result, [0, 10, 20, 30, 40]);
		});

		test('passes index to fn', async () => {
			const indices: Array<number> = [];
			await map_concurrent(['a', 'b', 'c'], 2, async (_item, i) => {
				indices.push(i);
				return null;
			});
			indices.sort((a, b) => a - b);
			assert.deepStrictEqual(indices, [0, 1, 2]);
		});

		test('returns empty array for empty input', async () => {
			const result = await map_concurrent([], 5, async () => {
				throw new Error('should not run');
			});
			assert.deepStrictEqual(result, []);
		});
	});

	describe('concurrency bound', () => {
		test('peak in-flight never exceeds bound', async () => {
			const items = Array.from({length: 50}, (_, i) => i);
			let in_flight = 0;
			let peak = 0;
			await map_concurrent(items, 5, async () => {
				in_flight++;
				if (in_flight > peak) peak = in_flight;
				await microtask_delay(3);
				in_flight--;
				return null;
			});
			assert.strictEqual(peak, 5);
		});

		test('concurrency=1 runs serially', async () => {
			const order: Array<number> = [];
			const items = [0, 1, 2, 3];
			await map_concurrent(items, 1, async (n) => {
				order.push(n);
				await microtask_delay(2);
				order.push(n);
				return n;
			});
			// Each item's start-end pair is contiguous when serial.
			assert.deepStrictEqual(order, [0, 0, 1, 1, 2, 2, 3, 3]);
		});

		test('concurrency >= items.length spawns at most items.length workers', async () => {
			// Trip-wire for the `Math.min(concurrency, items.length)` clamp:
			// without it, this would spawn 100 workers for 3 items, which still
			// works but wastes microtasks. We assert peak in-flight ≤ items.length.
			const items = [0, 1, 2];
			let in_flight = 0;
			let peak = 0;
			await map_concurrent(items, 100, async () => {
				in_flight++;
				if (in_flight > peak) peak = in_flight;
				await microtask_delay(2);
				in_flight--;
				return null;
			});
			assert.isAtMost(peak, items.length);
		});
	});

	describe('fail-fast', () => {
		test('rejects with the first error', async () => {
			const items = [0, 1, 2, 3];
			let err: unknown;
			try {
				await map_concurrent(items, 2, async (n) => {
					if (n === 1) throw new Error('boom');
					await microtask_delay(5);
					return n;
				});
			} catch (e) {
				err = e;
			}
			assert.instanceOf(err, Error);
			assert.strictEqual(err.message, 'boom');
		});

		test('idle workers stop pulling new items after a failure', async () => {
			// 100 items, 2 workers. fn for index 0 fails immediately; index 1
			// is in-flight when the failure propagates. With early-stop on the
			// shared `failed` flag, neither worker pulls beyond the second item
			// before exiting, so the count of started fn calls stays small.
			const items = Array.from({length: 100}, (_, i) => i);
			let started = 0;
			try {
				await map_concurrent(items, 2, async (n) => {
					started++;
					if (n === 0) throw new Error('boom');
					await microtask_delay(20);
					return n;
				});
				assert.fail('expected rejection');
			} catch (err) {
				assert.strictEqual((err as Error).message, 'boom');
			}
			// Without early-stop both workers would drain all 100 items. With
			// it, both workers see `failed` after at most one more pull each.
			assert.isAtMost(started, 4);
		});

		test('only the first error surfaces when multiple fns reject', async () => {
			const items = [0, 1];
			let err: unknown;
			try {
				await map_concurrent(items, 2, async (n) => {
					await microtask_delay(n + 1);
					throw new Error(`err${n}`);
				});
			} catch (e) {
				err = e;
			}
			assert.instanceOf(err, Error);
			// Index 0 sleeps 1 microtask, index 1 sleeps 2 — index 0 wins.
			assert.strictEqual(err.message, 'err0');
		});
	});

	describe('result placement', () => {
		test('results land at correct indices even with one slow item in the middle', async () => {
			const items = [10, 20, 30, 40, 50];
			const result = await map_concurrent(items, 3, async (n, i) => {
				await microtask_delay(i === 2 ? 8 : 1);
				return n + i;
			});
			assert.deepStrictEqual(result, [10, 21, 32, 43, 54]);
		});
	});
});
