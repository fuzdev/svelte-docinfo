/** Diagnostics and duplicate detection - shows error handling and validation. */

import {writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
	analyzeFromFiles,
	compactReplacer,
	errorsOf,
	hasErrors,
	hasWarnings,
	warningsOf,
} from 'svelte-docinfo';

const dir = dirname(fileURLToPath(import.meta.url));

const {modules, diagnostics} = await analyzeFromFiles({
	projectRoot: dir,
	// Throws if any two declarations share the same name across modules.
	// Use 'warn' to log instead of throwing, or pass a function for custom handling.
	// Omit this for libraries that don't need flat namespace enforcement.
	onDuplicates: 'throw',
});

// Inspect diagnostics for warnings and errors. `diagnostics` is a plain
// `Array<Diagnostic>` — round-trip-safe through JSON.
if (hasErrors(diagnostics)) {
	const errors = errorsOf(diagnostics);
	console.error(`Analysis produced ${errors.length} error(s):`);
	for (const d of errors) {
		console.error(`  [${d.kind}] ${d.file ?? 'unknown'}:${d.line ?? '?'} - ${d.message}`);
	}
	process.exit(1);
}

if (hasWarnings(diagnostics)) {
	const warnings = warningsOf(diagnostics);
	console.warn(`Analysis produced ${warnings.length} warning(s):`);
	for (const d of warnings) {
		console.warn(`  [${d.kind}] ${d.file ?? 'unknown'}:${d.line ?? '?'} - ${d.message}`);
	}
}

// Persist the full AnalyzeResultJson envelope so the diagnostics field round-trips.
// `compactReplacer` strips empty arrays — load via `AnalyzeResultJson.parse` to restore defaults.
await writeFile(
	join(dir, 'output-diagnostics.json'),
	JSON.stringify({modules, diagnostics}, compactReplacer, '\t'),
);

console.log(`Analyzed ${modules.length} modules with ${diagnostics.length} diagnostic(s)`);
