import {library_gen} from '@fuzdev/fuz_ui/library_gen.js';

export const gen = library_gen({
	on_duplicates: 'throw' as any, // TODO fix when published
	source: {
		exclude_patterns: [/\.test\.ts$/, /\/index\.ts$/],
	},
});
