// Bundle-size benchmark: what a consumer compiling svelte-docinfo into its own
// dist would ship. esbuild, minified, tree-shaken, platform node; the peers a
// Storybook-shaped host already has (typescript, svelte, svelte2tsx, vite) stay
// external, everything else (runtime deps, the schema library) is bundled.
//
// usage: node bundle.mjs --esbuild /path/to/esbuild/package \
//          --tree name=/path/to/built/tree ... [--out dir]

import { mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const args = process.argv.slice(2);
const trees = [];
let esbuildDir = null;
let outDir = join(tmpdir(), 'svelte-docinfo-bundle-bench');
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--tree') {
		const [name, dir] = args[++i].split(/=(.*)/s);
		trees.push({ name, dir });
	} else if (args[i] === '--esbuild') esbuildDir = args[++i];
	else if (args[i] === '--out') outDir = args[++i];
}
const esbuild = createRequire(join(esbuildDir, 'package.json'))('esbuild');

const EXTERNAL = ['typescript', 'svelte', 'svelte/*', 'svelte2tsx', 'vite'];

// entries are written per tree so each can use that tree's parse surface
const entries = (tree) => {
	const types = readFileSync(join(tree.dir, 'dist/types.js'), 'utf8');
	const hasHelper = types.includes('parseModuleJson');
	const index = readFileSync(join(tree.dir, 'dist/index.js'), 'utf8');
	return {
		// zero-dep wire restore, where a tree has one
		...(index.includes('applyAnalyzeResultDefaults')
			? {
					restore: `import {applyAnalyzeResultDefaults} from 'svelte-docinfo/module-json-defaults.js';\nexport const run = (x) => applyAnalyzeResultDefaults(x);\n`
				}
			: {}),
		// minimal consumer: analyze in-memory sources (validation on the hot path)
		analyze: `import {analyze} from 'svelte-docinfo';\nexport const run = (sourceFiles) => analyze({sourceFiles});\n`,
		// disk-discovering consumer (globs, exports discovery)
		analyzeFromFiles: `import {analyzeFromFiles} from 'svelte-docinfo';\nexport const run = (projectRoot) => analyzeFromFiles({projectRoot});\n`,
		// schemas-only: restore wire defaults on a consumer that never analyzes
		schemas: hasHelper
			? `import {parseModuleJson} from 'svelte-docinfo/types.js';\nexport const run = (x) => parseModuleJson(x);\n`
			: `import {ModuleJson} from 'svelte-docinfo/types.js';\nexport const run = (x) => ModuleJson.parse(x);\n`
	};
};

const rows = [];
for (const tree of trees) {
	const work = join(outDir, tree.name);
	rmSync(work, { recursive: true, force: true });
	mkdirSync(join(work, 'node_modules'), { recursive: true });
	symlinkSync(tree.dir, join(work, 'node_modules/svelte-docinfo'));
	for (const [entryName, source] of Object.entries(entries(tree))) {
		const entryFile = join(work, `${entryName}.mjs`);
		writeFileSync(entryFile, source);
		const build = (external) =>
			esbuild.build({
				entryPoints: [entryFile],
				bundle: true,
				minify: true,
				treeShaking: true,
				format: 'esm',
				platform: 'node',
				target: 'node22',
				external,
				metafile: true,
				write: false,
				logLevel: 'error'
			});
		const result = await build(EXTERNAL);
		// the schema library's compressed share: the same bundle with it external
		const without = await build([...EXTERNAL, 'zod', 'zod/*', 'valibot']);
		const code = result.outputFiles[0].contents;
		const codeWithout = without.outputFiles[0].contents;
		const output = Object.values(result.metafile.outputs)[0];
		const byPackage = {};
		for (const [input, info] of Object.entries(output.inputs)) {
			const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll('\\', '/'));
			// the tree is reached through a symlink, so its own files resolve outside node_modules
			const pkg = m ? m[1] : 'svelte-docinfo';
			byPackage[pkg] = (byPackage[pkg] ?? 0) + info.bytesInOutput;
		}
		writeFileSync(join(work, `${entryName}.bundle.mjs`), code);
		writeFileSync(join(work, `${entryName}.meta.json`), JSON.stringify(result.metafile));
		const gzip = (b) => gzipSync(b, { level: 9 }).length;
		rows.push({
			tree: tree.name,
			entry: entryName,
			minified: code.length,
			gzip: gzip(code),
			brotli: brotliCompressSync(code).length,
			withoutSchemaLibMinified: codeWithout.length,
			withoutSchemaLibGzip: gzip(codeWithout),
			schemaLibMinified: code.length - codeWithout.length,
			schemaLibGzip: gzip(code) - gzip(codeWithout),
			byPackage
		});
	}
}
console.log(JSON.stringify(rows, null, '\t'));
