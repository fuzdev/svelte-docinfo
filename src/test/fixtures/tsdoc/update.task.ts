import type {Task} from '@fuzdev/gro';
import {join} from 'node:path';
import ts from 'typescript';

import {runUpdateTask} from '../../test-helpers.js';
import {findAndParseTsdoc} from './tsdoc-test-helpers.js';

export const task: Task = {
	summary: 'generate expected.json files for tsdoc fixtures',
	run: async ({log}) => {
		await runUpdateTask(
			{
				fixturesDir: join(import.meta.dirname),
				inputExtension: '.ts',
				process: (input, name) => {
					const sourceFile = ts.createSourceFile(
						`${name}.ts`,
						input,
						ts.ScriptTarget.Latest,
						true,
						ts.ScriptKind.TS,
					);
					return findAndParseTsdoc(sourceFile);
				},
				jsonReplacer: (_key, value) => {
					// Convert Map to object for JSON serialization
					if (value instanceof Map) {
						return Object.fromEntries(value);
					}
					return value;
				},
			},
			log,
		);
	},
};
