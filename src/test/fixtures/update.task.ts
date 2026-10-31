import type { Task } from '@fuzdev/gro';

export const task: Task = {
	summary: 'generate all fixture expected.json files (tsdoc + ts + svelte)',
	run: async ({ invoke_task, log }) => {
		log.info('updating tsdoc fixtures...');
		await invoke_task('src/test/fixtures/tsdoc/update.task.ts');

		log.info('updating ts fixtures...');
		await invoke_task('src/test/fixtures/ts/update.task.ts');

		log.info('updating svelte fixtures...');
		await invoke_task('src/test/fixtures/svelte/update.task.ts');

		log.info('all fixtures updated!');
	}
};
