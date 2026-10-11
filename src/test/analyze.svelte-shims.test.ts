/**
 * Tests for rooting svelte2tsx's ambient shims (`getSvelteShimRoots`).
 *
 * Without the shims, every component's default export is `any`, and so is
 * anything typed through one (`typeof Other`, `ComponentProps<typeof Other>`).
 * The svelte fixtures lock the one-shot program path; these cover the
 * language-service path (`analyze`, sessions) and the root-list policy: shims
 * join with the first Svelte virtual, leave with the last, and stay out of
 * TS-only programs.
 *
 * The temporary projects symlink the repo's `node_modules`, since the shims'
 * component types come from `svelte`, which doesn't resolve from a bare temp
 * directory.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';
import { symlink, unlink } from 'node:fs/promises';

import { analyze } from '#lib/analyze.ts';
import { createAnalysisSession } from '#lib/session.ts';
import { createSourceOptions } from '#lib/source-config.ts';
import type { SourceFileInfo } from '#lib/source.ts';
import { transformSvelteSource } from '#lib/svelte.ts';
import { createAnalysisProgram, getSvelteShimRoots } from '#lib/typescript-program.ts';

import { findModule, withTestProject } from './test-helpers.ts';

const OTHER = `<script lang="ts">
	let { a }: { a: 'a' | 'b' } = $props();
</script>
<div>{a}</div>
`;

const USES_OTHER = `<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Other from './Other.svelte';
	let { b }: { b?: ComponentProps<typeof Other>['a'] } = $props();
</script>
<Other a={b ?? 'a'} />
`;

const TS_USES_OTHER = `import type { ComponentProps } from 'svelte';
import Other from './Other.svelte';
export const c = Other;
export type C = ComponentProps<typeof Other>['a'];
`;

const FILES = {
	'src/lib/Other.svelte': OTHER,
	'src/lib/UsesOther.svelte': USES_OTHER,
	'src/lib/uses_other.ts': TS_USES_OTHER
};

/**
 * Component kinds beyond runes TS: JS-lang (JSDoc props), legacy
 * (`export let`), and props typed by an intersection, read through a `.ts`
 * module, plus a parameter whose alias the registry recovers.
 */
const MORE_FILES = {
	'src/lib/JsComp.svelte': `<script>
	/** @type {{ x: number }} */
	let { x } = $props();
</script>
<p>{x}</p>
`,
	'src/lib/Legacy.svelte': `<script lang="ts">
	export let z: number = 1;
</script>
<p>{z}</p>
`,
	'src/lib/Inter.svelte': `<script lang="ts">
	import type { Base } from './base.ts';
	let { a, b }: Base & { b: string } = $props();
</script>
<p>{a}{b}</p>
`,
	'src/lib/base.ts': 'export interface Base { a: number }\n',
	'src/lib/uses.ts': `import type { ComponentProps } from 'svelte';
import Inter from './Inter.svelte';
import JsComp from './JsComp.svelte';
import Legacy from './Legacy.svelte';
export type InterProps = ComponentProps<typeof Inter>;
export const takesInter = (p: ComponentProps<typeof Inter>) => p;
export const jsComp = JsComp;
export const legacy = Legacy;
`
};

/**
 * `withTestProject` with the repo's `node_modules` linked in. The link is
 * removed before the project's recursive cleanup runs.
 */
const withLinkedProject = async (
	files: Record<string, string>,
	fn: (projectRoot: string) => Promise<void>
): Promise<void> => {
	await withTestProject(files, async (projectRoot) => {
		const link = join(projectRoot, 'node_modules');
		await symlink(join(process.cwd(), 'node_modules'), link, 'dir');
		try {
			await fn(projectRoot);
		} finally {
			await unlink(link);
		}
	});
};

const toSourceFiles = (
	projectRoot: string,
	files: Record<string, string>
): Array<SourceFileInfo> =>
	Object.entries(files).map(([path, content]) => ({ id: join(projectRoot, path), content }));

/** Whether a root is one of the shim files, by name (the path is the realpath). */
const isShimRoot = (path: string): boolean => path.endsWith('/svelte2tsx/svelte-shims-v4.d.ts');

describe('svelte2tsx shims', { timeout: 30_000 }, () => {
	test('component types resolve through the language-service path', async () => {
		await withLinkedProject(FILES, async (projectRoot) => {
			const { modules } = await analyze({
				sourceFiles: toSourceFiles(projectRoot, FILES),
				sourceOptions: createSourceOptions(projectRoot)
			});

			const usesOther = findModule(modules, 'UsesOther.svelte').declarations[0];
			assert(usesOther?.kind === 'component', 'expected a component');
			assert.strictEqual(usesOther.props[0]?.type, '"a" | "b"');

			const ts = findModule(modules, 'uses_other.ts');
			const c = ts.declarations.find((d) => d.name === 'c');
			assert.ok(c);
			assert.match(c.typeSignature ?? '', /^Component</);
			const cType = ts.declarations.find((d) => d.name === 'C');
			assert.ok(cType);
			assert.strictEqual(cType.typeSignature, '"a" | "b"');
		});
	});

	test('JS-lang and legacy component types resolve through a .ts module', async () => {
		await withLinkedProject(MORE_FILES, async (projectRoot) => {
			const { modules } = await analyze({
				sourceFiles: toSourceFiles(projectRoot, MORE_FILES),
				sourceOptions: createSourceOptions(projectRoot)
			});
			const uses = findModule(modules, 'uses.ts');

			// non-`any` is the fix; the exact text carries svelte2tsx's generated
			// names (`$$ComponentProps`, `__sveltets_2_IsomorphicComponent`), which
			// are current behavior with a scrub planned, so they aren't pinned here
			const jsComp = uses.declarations.find((d) => d.name === 'jsComp');
			assert.ok(jsComp);
			assert.match(jsComp.typeSignature ?? '', /^Component</);
			const legacy = uses.declarations.find((d) => d.name === 'legacy');
			assert.ok(legacy);
			assert.notStrictEqual(legacy.typeSignature, 'any');
			assert.include(legacy.typeSignature ?? '', 'z?: number');
		});
	});

	test('the alias registry recovers a name typed through a component', async () => {
		await withLinkedProject(MORE_FILES, async (projectRoot) => {
			const { modules, diagnostics } = await analyze({
				sourceFiles: toSourceFiles(projectRoot, MORE_FILES),
				sourceOptions: createSourceOptions(projectRoot)
			});
			const takesInter = findModule(modules, 'uses.ts').declarations.find(
				(d) => d.name === 'takesInter'
			);
			assert(takesInter?.kind === 'function', 'expected a function');
			assert.deepStrictEqual(takesInter.parameters[0]?.typeInfo, {
				kind: 'reference',
				name: 'InterProps',
				module: 'uses.ts'
			});
			assert.ok(!diagnostics.some((d) => d.kind === 'alias_lost'));
		});
	});

	test('session roots the shims with the first Svelte file and drops them with the last', async () => {
		await withLinkedProject(FILES, async (projectRoot) => {
			const session = createAnalysisSession({ sourceOptions: createSourceOptions(projectRoot) });
			try {
				const shimCount = () => session.getProgram().getRootFileNames().filter(isShimRoot).length;

				await session.setFile({
					id: join(projectRoot, 'src/lib/plain.ts'),
					content: 'export const d = 1;'
				});
				assert.strictEqual(shimCount(), 0, 'a TS-only program has no shim roots');

				await session.setFile({ id: join(projectRoot, 'src/lib/Other.svelte'), content: OTHER });
				assert.strictEqual(shimCount(), 1);
				// the shims lead the root list
				assert.ok(isShimRoot(session.getProgram().getRootFileNames()[0] ?? ''));

				await session.deleteFile(join(projectRoot, 'src/lib/Other.svelte'));
				assert.strictEqual(shimCount(), 0);
			} finally {
				session.dispose();
			}
		});
	});

	test('createAnalysisProgram roots the shims only beside a Svelte virtual', async () => {
		await withLinkedProject({ 'src/lib/plain.ts': 'export const d = 1;' }, async (projectRoot) => {
			const tsOnly = createAnalysisProgram({
				projectRoot,
				virtualFiles: new Map([
					[join(projectRoot, 'src/lib/extra.ts'), { content: 'export const e = 1;' }]
				])
			});
			assert.ok(!tsOnly.getRootFileNames().some(isShimRoot));

			const { virtual } = transformSvelteSource({
				id: join(projectRoot, 'src/lib/Other.svelte'),
				content: OTHER
			});
			assert.ok(virtual);
			const withSvelte = createAnalysisProgram({
				projectRoot,
				virtualFiles: new Map([[virtual.virtualPath, virtual]])
			});
			assert.strictEqual(withSvelte.getRootFileNames().filter(isShimRoot).length, 1);
		});
	});

	test('a shim the tsconfig already roots is not rooted twice', async () => {
		const [shim] = getSvelteShimRoots(['/a/B.svelte.__svelte2tsx__.ts']);
		assert.ok(shim);
		await withLinkedProject(
			{
				'tsconfig.json': JSON.stringify({
					compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', strict: true },
					include: ['src/**/*', shim]
				})
			},
			async (projectRoot) => {
				const { virtual } = transformSvelteSource({
					id: join(projectRoot, 'src/lib/Other.svelte'),
					content: OTHER
				});
				assert.ok(virtual);
				const program = createAnalysisProgram({
					projectRoot,
					virtualFiles: new Map([[virtual.virtualPath, virtual]])
				});
				assert.strictEqual(program.getRootFileNames().filter((f) => f === shim).length, 1);
			}
		);
	});

	test('getSvelteShimRoots returns nothing without a Svelte virtual, and a stable list with one', () => {
		assert.deepStrictEqual(getSvelteShimRoots(['/a/b.ts', '/a/B.svelte']), []);
		const roots = getSvelteShimRoots(['/a/b.ts', '/a/B.svelte.__svelte2tsx__.ts']);
		assert.strictEqual(roots.length, 1);
		assert.ok(roots.every(isShimRoot));
		// resolved once and cached; program reuse needs only the fixed order,
		// since the language service compares root lists by content
		assert.strictEqual(getSvelteShimRoots(['/a/C.svelte.__svelte2tsx__.ts']), roots);
	});
});
