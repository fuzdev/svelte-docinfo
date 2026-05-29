/** One function call - the simplest approach. */

import {writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {analyzeFromFiles, compactReplacer} from 'svelte-docinfo';

const dir = dirname(fileURLToPath(import.meta.url));

const {modules} = await analyzeFromFiles({
	projectRoot: dir,
});

// compactReplacer strips Zod defaults (empty arrays, false) for compact output.
await writeFile(join(dir, 'output-simple.json'), JSON.stringify({modules}, compactReplacer, '\t'));

console.log(`Analyzed ${modules.length} modules`);
