import type { Task } from '@fuzdev/gro';

import { compactReplacer } from '$lib/declaration-helpers.ts';

import { runUpdateTask } from '../../test-helpers.ts';
import {
	analyzeSvelteFixtureModules,
	SVELTE_EXTRA_FILE_EXTENSIONS
} from './svelte-test-helpers.ts';

export const task: Task = {
	summary: 'generate expected.json files for svelte fixtures',
	run: async ({ log }) => {
		await runUpdateTask(
			{
				fixturesDir: import.meta.dirname,
				inputExtension: '.svelte',
				loadExtraFiles: true,
				extraFileExtensions: SVELTE_EXTRA_FILE_EXTENSIONS,
				jsonReplacer: compactReplacer,
				// batch: the whole set analyzes against one shared program
				processAll: analyzeSvelteFixtureModules
			},
			log
		);
	}
};
