import type { Task } from '@fuzdev/gro';

import { compactReplacer } from '$lib/declaration-helpers.ts';

import { runUpdateTask } from '../../test-helpers.ts';
import { analyzeFixtureModule } from './ts-test-helpers.ts';

export const task: Task = {
	summary: 'generate expected.json files for ts fixtures',
	run: async ({ log }) => {
		await runUpdateTask(
			{
				fixturesDir: import.meta.dirname,
				inputExtension: '.ts',
				jsonReplacer: compactReplacer,
				process: analyzeFixtureModule
			},
			log
		);
	}
};
