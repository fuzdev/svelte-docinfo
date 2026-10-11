// Error quality: feeds the same malformed envelopes to each tree's parse
// surface and prints the thrown message plus each issue's path and message.
//
// usage: node errors.mjs name=/path/to/built/tree ...

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const fn = (name, extra = {}) => ({ name, kind: 'function', ...extra });

const CASES = {
	'unknown key on a module': { modules: [{ path: 'a.ts', bogus: 1 }] },
	'wrong type for path': { modules: [{ path: 42 }] },
	'unknown declaration kind': { modules: [{ path: 'a.ts', declarations: [{ name: 'x', kind: 'bogus' }] }] },
	'missing declaration name': { modules: [{ path: 'a.ts', declarations: [{ kind: 'function' }] }] },
	'key from another variant (props on function)': {
		modules: [{ path: 'a.ts', declarations: [fn('f', { props: [] })] }]
	},
	'bad nested TypeJson (union member missing text)': {
		modules: [
			{
				path: 'a.ts',
				declarations: [
					{
						name: 'v',
						kind: 'variable',
						typeInfo: { kind: 'union', members: [{ kind: 'intrinsic' }] }
					}
				]
			}
		]
	},
	'deep: bad parameter type on a class method': {
		modules: [
			{
				path: 'a.ts',
				declarations: [
					{
						name: 'C',
						kind: 'class',
						members: [{ name: 'm', kind: 'function', parameters: [{ name: 'p', type: 1 }] }]
					}
				]
			}
		]
	},
	'diagnostic with line 0': {
		diagnostics: [
			{ kind: 'module_unreadable', severity: 'error', file: 'a.ts', message: 'x', line: 0 }
		]
	},
	'not an object': 'nope'
};

const issuePath = (issue) =>
	(issue.path ?? []).map((p) => (typeof p === 'object' && p !== null ? p.key : p)).join('.');

for (const spec of process.argv.slice(2)) {
	const [name, dir] = spec.split(/=(.*)/s);
	const mod = await import(pathToFileURL(join(dir, 'dist/index.js')).href);
	const parse = mod.parseAnalyzeResult ?? ((x) => mod.AnalyzeResultJson.parse(x));
	console.log(`\n######## ${name}`);
	for (const [label, input] of Object.entries(CASES)) {
		console.log(`\n--- ${label}`);
		try {
			parse(input);
			console.log('ACCEPTED (no error)');
		} catch (err) {
			console.log(`${err.constructor?.name}: ${String(err.message).slice(0, 600)}`);
			for (const issue of err.issues ?? []) {
				console.log(`  [${issuePath(issue)}] ${issue.message}`);
			}
		}
	}
}
