import type { Task } from '@fuzdev/gro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { compactReplacer } from '$lib/declaration-helpers.ts';

import { discoverFixtureDirs, runUpdateTask, type ModuleFixtureJson } from '../../test-helpers.ts';
import { analyzeSvelteFixtureModules } from './svelte-test-helpers.ts';

export const task: Task = {
	summary: 'generate expected.json files for svelte fixtures',
	run: async ({ log }) => {
		const fixturesDir = import.meta.dirname;

		// Batch analysis needs every input up front (one shared program), so
		// inputs are read once here and `runUpdateTask`'s per-fixture `process`
		// is a lookup into the precomputed results.
		const fixtureDirs = await discoverFixtureDirs(fixturesDir, '.svelte');
		const inputs = await Promise.all(
			fixtureDirs.map(async ({ path, name }) => ({
				name,
				input: await readFile(join(path, 'input.svelte'), 'utf-8')
			}))
		);
		const analyzed = analyzeSvelteFixtureModules(inputs);
		const resultsByName = new Map<string, ModuleFixtureJson>(
			inputs.map(({ name }, i) => [name, analyzed[i]!])
		);

		await runUpdateTask(
			{
				fixturesDir,
				inputExtension: '.svelte',
				jsonReplacer: compactReplacer,
				process: (_input, name) => {
					const result = resultsByName.get(name);
					if (!result) throw new Error(`missing analysis result for ${name}`);
					return result;
				}
			},
			log
		);
	}
};
