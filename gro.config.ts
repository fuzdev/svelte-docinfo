import type { CreateGroConfig } from '@fuzdev/gro';

/**
 * Register the ambient `virtual-svelte-docinfo.d.ts` in `package.json` `exports`.
 *
 * The file lives at the package root, out of `svelte-package`'s alias
 * rewriting (its header explains why), so gro's `src/lib`-scoped exports
 * generator skips it; this hook re-injects the entry.
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
					types: './virtual-svelte-docinfo.d.ts'
				};
			}
		}
		return { ...package_json, exports: next };
	};
	return base_config;
};

export default config;
