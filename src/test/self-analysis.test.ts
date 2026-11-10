import { fileURLToPath } from 'node:url';
import { test, assert } from 'vitest';

import { analyzeFromFiles } from '#lib/analyze.ts';
import type { ModuleJson } from '#lib/types.ts';

// The output schemas document each field on its `FooEntries` entry, and the
// public interfaces (`ModuleJson`, `ModuleJsonInput`, the variants) extend the
// output and input types fuz_schema computes from the entries. The comment
// reaches the interface's property only through fuz_schema's types, so this
// analyzes the schema modules themselves, as the docs site does, and pins that
// the members carry their entry's comment and that no exported alias is lost.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const SCHEMA_MODULES = [
	'src/lib/types.ts',
	'src/lib/diagnostics.ts',
	'src/lib/analyze-core.ts',
	'src/lib/schema.ts'
];

const memberDoc = (
	modules: Array<ModuleJson>,
	path: string,
	declarationName: string,
	memberName: string
): string | undefined => {
	const module = modules.find((m) => m.path === path);
	assert.ok(module, `expected module ${path}`);
	const declaration = module.declarations.find((d) => d.name === declarationName);
	assert.ok(declaration, `expected ${declarationName} in ${path}`);
	assert.ok('members' in declaration, `expected ${declarationName} to have members`);
	const member = declaration.members.find((m) => m.name === memberName);
	assert.ok(member, `expected member ${memberName} of ${declarationName}`);
	return member.docComment;
};

test('the schema modules document their fields from the entries', { timeout: 60_000 }, async () => {
	const { modules, diagnostics } = await analyzeFromFiles({
		projectRoot: ROOT,
		include: SCHEMA_MODULES,
		rootFileNames: []
	});
	assert.deepStrictEqual(
		diagnostics.filter((d) => d.kind === 'alias_lost'),
		[]
	);

	for (const [path, declarationName, memberName, prefix] of [
		// an output interface, and the input interface over the same entries
		['types.ts', 'ModuleJson', 'moduleComment', 'The prose of the file-level comment'],
		['types.ts', 'ModuleJsonInput', 'moduleComment', 'The prose of the file-level comment'],
		// a declaration variant, output and input
		['types.ts', 'FunctionDeclarationJson', 'returnType', 'Function/method return type.'],
		['types.ts', 'FunctionDeclarationJsonInput', 'returnType', 'Function/method return type.'],
		// a field spread in from a shared fragment
		['types.ts', 'VariableMemberJson', 'docComment', undefined],
		// a diagnostic variant's own field, and a base field every variant shares
		['diagnostics.ts', 'TypeExtractionDiagnostic', 'symbolName', 'Name of the symbol'],
		['diagnostics.ts', 'TypeExtractionDiagnostic', 'file', 'File path relative to project root'],
		[
			'diagnostics.ts',
			'TypeExtractionDiagnosticInput',
			'file',
			'File path relative to project root'
		]
	] as const) {
		const doc = memberDoc(modules, path, declarationName, memberName);
		assert.ok(doc, `expected ${declarationName}.${memberName} to carry its entry's doc comment`);
		if (prefix) assert.ok(doc.startsWith(prefix), `${declarationName}.${memberName}: ${doc}`);
	}
});
