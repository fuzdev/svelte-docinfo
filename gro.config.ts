import type {CreateGroConfig} from '@fuzdev/gro';

/**
 * Register the ambient `virtual-svelte-docinfo.d.ts` in `package.json` `exports`.
 *
 * The file lives at the package root (not `src/lib/`) on purpose:
 * `@sveltejs/package`'s `resolve_aliases` would rewrite the
 * `'svelte-docinfo/...'` imports inside its `declare module` block to relative
 * paths, which TypeScript can't resolve inside an ambient module declaration
 * in consumer projects — types silently collapse to `any`. The
 * `'svelte-docinfo' → 'src/lib'` alias driving that rewrite is load-bearing
 * for fuz_ui's `library_gen` (circular dev-dep), so it stays. Keeping the file
 * at the root keeps it out of `svelte-package`'s reach; this hook re-injects
 * the exports entry that gro's auto-generator (scoped to `src/lib`) skips.
 */
const config: CreateGroConfig = (base_config) => {
	base_config.map_package_json = (package_json) => {
		if (!package_json.exports || typeof package_json.exports !== 'object') return package_json;
		// Insert after the `.` root entry so the order reads top-down.
		const next: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(package_json.exports)) {
			next[key] = value;
			if (key === '.') {
				next['./virtual-svelte-docinfo.js'] = {
					types: './virtual-svelte-docinfo.d.ts',
				};
			}
		}
		return {...package_json, exports: next};
	};
	return base_config;
};

export default config;
