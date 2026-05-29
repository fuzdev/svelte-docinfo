import type {Task} from '@fuzdev/gro';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {analyzeSvelteModule, transformSvelteSource} from '$lib/svelte.js';
import {createAnalysisProgram} from '$lib/typescript-program.js';
import type {Diagnostic} from '$lib/diagnostics.js';
import {compactReplacer} from '$lib/declaration-helpers.js';
import {createSourceOptions} from '$lib/source-config.js';

import {discoverFixtureDirs} from '../../test-helpers.js';
import {fixtureNameToComponentName} from './svelte-test-helpers.js';

export const task: Task = {
	summary: 'generate expected.json files for svelte fixtures',
	run: async ({log}) => {
		const fixturesDir = import.meta.dirname;
		const sourceOptions = createSourceOptions(process.cwd());

		// Discover and read all fixtures
		const fixtureDirs = await discoverFixtureDirs(fixturesDir, '.svelte');
		log.info(`found ${fixtureDirs.length} fixtures`);

		const fixtureData = await Promise.all(
			fixtureDirs.map(async ({path: fixtureDir, name}) => {
				const inputPath = join(fixtureDir, 'input.svelte');
				const expectedPath = join(fixtureDir, 'expected.json');
				const content = await readFile(inputPath, 'utf-8');
				const sourceFile = {id: inputPath, content};
				const result = transformSvelteSource(sourceFile);
				if (!result.virtual) {
					throw new Error(
						`transform failed for ${inputPath}: ${result.diagnostics[0]?.message ?? 'unknown error'}`,
					);
				}
				return {name, sourceFile, virtualFile: result.virtual, expectedPath};
			}),
		);

		// Create a single shared program with all virtual files
		const allVirtualFiles = new Map(
			fixtureData.map((d) => [d.virtualFile.virtualPath, d.virtualFile.content]),
		);
		const program = createAnalysisProgram({virtualFiles: allVirtualFiles});
		const checker = program.getTypeChecker();

		let generatedCount = 0;
		let skippedCount = 0;

		for (const {name, sourceFile, virtualFile, expectedPath} of fixtureData) {
			const componentName = fixtureNameToComponentName(name);
			const modulePath = `${componentName}.svelte`;
			const diagnostics: Array<Diagnostic> = [];
			const result = analyzeSvelteModule(
				sourceFile,
				modulePath,
				checker,
				sourceOptions,
				diagnostics,
				program,
				virtualFile,
			);
			if (!result) throw new Error(`Analysis returned undefined for ${modulePath}`);

			// Output all non-nodocs declarations (component + module exports)
			const declarations = result.declarations.filter((d) => !d.nodocs).map((d) => d.declaration);
			if (!declarations.some((d) => d.kind === 'component')) {
				throw new Error(`No component declaration found for ${modulePath}`);
			}

			const output = JSON.stringify(declarations, compactReplacer, '\t') + '\n';

			let existing: string | null = null;
			try {
				existing = await readFile(expectedPath, 'utf-8');
			} catch {
				// File doesn't exist yet
			}

			if (existing === output) {
				skippedCount++;
				log.info(`skipped ${name}/expected.json`);
			} else {
				generatedCount++;
				await writeFile(expectedPath, output);
				log.info(`generated ${name}/expected.json`);
			}
		}

		log.info(`done! generated: ${generatedCount}, skipped: ${skippedCount}`);
	},
};
