import type { Task } from '@fuzdev/gro';

import { compactReplacer } from '#lib/declaration-helpers.ts';

import { runUpdateTask } from '../../test-helpers.ts';
import { analyzeTsFixture, TS_FIXTURE_INPUT_EXTENSIONS } from './ts-test-helpers.ts';

export const task: Task = {
	summary: 'generate expected.json files for ts fixtures',
	run: async ({ log }) => {
		await runUpdateTask(
			{
				fixturesDir: import.meta.dirname,
				inputExtension: TS_FIXTURE_INPUT_EXTENSIONS,
				loadExtraFiles: true,
				jsonReplacer: compactReplacer,
				// dispatches single-file vs multi-file capture on `extraFiles`
				process: (input, _name, extraFiles, inputExtension) =>
					analyzeTsFixture(input, extraFiles, inputExtension)
			},
			log
		);
	}
};
