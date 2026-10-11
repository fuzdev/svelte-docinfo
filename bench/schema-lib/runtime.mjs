// Runtime benchmark: end-to-end `analyzeFromFiles` plus the isolated
// validation boundary, across several built svelte-docinfo trees.
//
// usage:
//   node runtime.mjs --tree name=/path/to/built/tree[:option=value] ... \
//     --corpus name=/path/to/project ... [--runs 7] [--parse-iters 15] [--out dir]
//
// Each (tree, corpus, run) is a fresh child process, interleaved round-robin so
// machine drift spreads across trees. A tree is a checkout with `dist/` built and
// its own `node_modules`. `:validate=false` passes `validate: false` to
// `analyzeFromFiles` (the validate-optional prototype).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const child = async (treeDir, corpusRoot, optionsJson, parseIters) => {
	const options = JSON.parse(optionsJson);
	const t0 = performance.now();
	const mod = await import(pathToFileURL(join(treeDir, 'dist/index.js')).href);
	const helpers = await import(pathToFileURL(join(treeDir, 'dist/declaration-helpers.js')).href);
	const tLoad = performance.now() - t0;

	const t1 = performance.now();
	const result = await mod.analyzeFromFiles({ projectRoot: corpusRoot, ...options });
	const tAnalyze = performance.now() - t1;

	// schema modules load after the analysis timing, so a tree that keeps its
	// schema library off the analysis path isn't charged for it in `tLoad`
	const t2 = performance.now();
	const types = await import(pathToFileURL(join(treeDir, 'dist/types.js')).href);
	const core = await import(pathToFileURL(join(treeDir, 'dist/analyze-core.js')).href);
	const tLoadSchemas = performance.now() - t2;
	const AnalyzeResultJson = core.AnalyzeResultJson ?? types.AnalyzeResultJson;
	const parseResult = mod.parseAnalyzeResult ?? ((x) => AnalyzeResultJson.parse(x));
	const parseModule = mod.parseModuleJson ?? ((x) => types.ModuleJson.parse(x));
	// the zero-dep finisher, where a tree has one
	const finishResult = mod.applyAnalyzeResultDefaults;
	const finishModule = mod.applyModuleJsonDefaults;

	const out = JSON.stringify(result);
	const wire = JSON.stringify(result, helpers.compactReplacer);
	const wireModules = JSON.parse(wire).modules ?? [];

	// isolated boundary timings (median of parseIters)
	const timeIt = (fn) => {
		const xs = [];
		for (let i = 0; i < parseIters; i++) {
			const t = performance.now();
			fn();
			xs.push(performance.now() - t);
		}
		return median(xs);
	};
	// in-pipeline proxy: each module parsed from its defaults-absent (wire) form,
	// the closest stand-in for the builder objects analyze-core parses
	const tParseModules = timeIt(() => {
		for (const m of wireModules) parseModule(structuredClone(m));
	}) - timeIt(() => {
		for (const m of wireModules) structuredClone(m);
	});
	const fullObj = JSON.parse(out);
	const tParseFull = timeIt(() => parseResult(fullObj));
	const tRoundTrip = timeIt(() =>
		parseResult(JSON.parse(JSON.stringify(result, helpers.compactReplacer)))
	);
	const tFinishModules = finishModule
		? timeIt(() => {
				for (const m of wireModules) finishModule(structuredClone(m));
			}) -
			timeIt(() => {
				for (const m of wireModules) structuredClone(m);
			})
		: null;
	const tFinishRoundTrip = finishResult
		? timeIt(() => finishResult(JSON.parse(JSON.stringify(result, helpers.compactReplacer))))
		: null;
	const finishEqual = finishResult ? JSON.stringify(finishResult(JSON.parse(wire))) === out : null;
	const roundTripEqual = JSON.stringify(parseResult(JSON.parse(wire))) === out;

	process.stdout.write(
		JSON.stringify({
			tLoad,
			tAnalyze,
			tParseModules,
			tParseFull,
			tRoundTrip,
			tLoadSchemas,
			tFinishModules,
			tFinishRoundTrip,
			finishEqual,
			roundTripEqual,
			modules: result.modules.length,
			diagnostics: result.diagnostics.length,
			bytes: out.length,
			wireBytes: wire.length,
			hash: createHash('sha256').update(out).digest('hex').slice(0, 16),
			outPath: process.env.BENCH_DUMP ? (writeFileSync(process.env.BENCH_DUMP, out), process.env.BENCH_DUMP) : null
		})
	);
};

const parent = () => {
	const args = process.argv.slice(2);
	const trees = [];
	const corpora = [];
	let runs = 7;
	let parseIters = 15;
	let outDir = null;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--tree') {
			const [name, rest] = args[++i].split(/=(.*)/s);
			const [dir, ...opts] = rest.split(':');
			const options = {};
			for (const o of opts) {
				const [k, v] = o.split('=');
				options[k] = JSON.parse(v);
			}
			trees.push({ name, dir, options });
		} else if (a === '--corpus') {
			const [name, dir] = args[++i].split(/=(.*)/s);
			corpora.push({ name, dir });
		} else if (a === '--runs') runs = Number(args[++i]);
		else if (a === '--parse-iters') parseIters = Number(args[++i]);
		else if (a === '--out') outDir = args[++i];
	}
	if (outDir) mkdirSync(outDir, { recursive: true });
	const samples = {};
	for (let r = 0; r < runs; r++) {
		for (const c of corpora) {
			for (const t of trees) {
				const key = `${t.name}|${c.name}`;
				const env = { ...process.env };
				if (outDir && r === 0) env.BENCH_DUMP = join(outDir, `${t.name}--${c.name}.json`);
				else delete env.BENCH_DUMP;
				const res = spawnSync(
					'nice',
					[
						process.execPath,
						process.argv[1],
						'--child',
						t.dir,
						c.dir,
						JSON.stringify(t.options),
						String(parseIters)
					],
					{ env, encoding: 'utf8', maxBuffer: 1 << 28 }
				);
				if (res.status !== 0) {
					console.error(`FAILED ${key}\n${res.stderr}`);
					process.exit(1);
				}
				const sample = JSON.parse(res.stdout.trim().split('\n').at(-1));
				(samples[key] ??= []).push(sample);
				console.error(`run ${r + 1}/${runs} ${key} analyze=${sample.tAnalyze.toFixed(0)}ms`);
			}
		}
	}
	const rows = [];
	for (const [key, xs] of Object.entries(samples)) {
		const [tree, corpus] = key.split('|');
		const stat = (f) => {
			const v = xs.map((x) => x[f]);
			return { median: median(v), min: Math.min(...v), max: Math.max(...v) };
		};
		rows.push({
			tree,
			corpus,
			runs: xs.length,
			load: stat('tLoad'),
			analyze: stat('tAnalyze'),
			parseModules: stat('tParseModules'),
			parseFull: stat('tParseFull'),
			roundTrip: stat('tRoundTrip'),
			loadSchemas: stat('tLoadSchemas'),
			finishModules: xs[0].tFinishModules === null ? null : stat('tFinishModules'),
			finishRoundTrip: xs[0].tFinishRoundTrip === null ? null : stat('tFinishRoundTrip'),
			finishEqual: xs[0].finishEqual === null ? null : xs.every((x) => x.finishEqual),
			roundTripEqual: xs.every((x) => x.roundTripEqual),
			modules: xs[0].modules,
			diagnostics: xs[0].diagnostics,
			bytes: xs[0].bytes,
			wireBytes: xs[0].wireBytes,
			hashes: [...new Set(xs.map((x) => x.hash))]
		});
	}
	const json = JSON.stringify(rows, null, '\t');
	if (outDir) writeFileSync(join(outDir, 'runtime.json'), json);
	console.log(json);
};

if (process.argv[2] === '--child') {
	await child(process.argv[3], process.argv[4], process.argv[5], Number(process.argv[6]));
} else {
	parent();
}
