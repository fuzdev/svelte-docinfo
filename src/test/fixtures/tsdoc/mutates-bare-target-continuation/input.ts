/**
 * Description.
 *
 * @mutates cache
 * evicts stale entries on read
 */
export function fn(cache: any) {
	cache.evict();
}
