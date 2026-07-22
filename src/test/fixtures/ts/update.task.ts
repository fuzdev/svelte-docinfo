import type { Task } from '@fuzdev/gro';
import { join } from 'node:path';
import ts from 'typescript';

import { compactReplacer } from '$lib/declaration-helpers.ts';

import { runUpdateTask } from '../../test-helpers.ts';
import {
	createTestProgram,
	extractDeclarationFromSource,
	inferCategoryFromName
} from './ts-test-helpers.ts';

export const task: Task = {
	summary: 'generate expected.json files for ts fixtures',
	run: async ({ log }) => {
		await runUpdateTask(
			{
				fixturesDir: join(import.meta.dirname),
				inputExtension: '.ts',
				jsonReplacer: compactReplacer,
				process: (input, name) => {
					const category = inferCategoryFromName(name);
					const sourceFile = ts.createSourceFile(
						`${name}.ts`,
						input,
						ts.ScriptTarget.Latest,
						true,
						ts.ScriptKind.TS
					);
					const checker = createTestProgram(sourceFile, `${name}.ts`).getTypeChecker();
					return extractDeclarationFromSource(sourceFile, checker, category);
				}
			},
			log
		);
	}
};
