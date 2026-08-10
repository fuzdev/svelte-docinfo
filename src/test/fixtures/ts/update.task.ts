import type { Task } from '@fuzdev/gro';

import { compactReplacer } from '$lib/declaration-helpers.ts';

import { runUpdateTask } from '../../test-helpers.ts';
import { analyzeTsFixture } from './ts-test-helpers.ts';

export const task: Task = {
	summary: 'generate expected.json files for ts fixtures',
	run: async ({ log }) => {
		await runUpdateTask(
			{
				fixturesDir: import.meta.dirname,
				inputExtension: '.ts',
				loadExtraFiles: true,
				jsonReplacer: compactReplacer,
				// dispatches single-file vs multi-file capture on `extraFiles`
				process: (input, _name, extraFiles) => analyzeTsFixture(input, extraFiles)
			},
			log
		);
	}
};
