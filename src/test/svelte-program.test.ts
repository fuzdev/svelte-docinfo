/**
 * Tests for Svelte virtual source → program integration.
 *
 * Verifies that including svelte2tsx virtual outputs in the TypeScript program
 * enables checker-backed analysis: imported prop types, `<script module>` exports,
 * and re-exports from Svelte files.
 */

import {test, assert, describe} from 'vitest';
import {join} from 'node:path';

import {analyze} from '$lib/analyze.js';
import {transformSvelteSource, type SvelteVirtualFile} from '$lib/svelte.js';
import {createAnalysisProgram} from '$lib/typescript-program.js';
import type {SourceFileInfo} from '$lib/source.js';
import {createSourceOptions} from '$lib/source-config.js';

import {
	withTestProject,
	findModule,
	assertHasDeclaration,
	assertHasComponentDeclaration,
	assertHasProps,
} from './test-helpers.js';

/** Create source file infos from a files map, filtering to analyzable types. */
const createSourceFiles = (
	projectRoot: string,
	files: Record<string, string>,
): Array<SourceFileInfo> => {
	return Object.entries(files)
		.filter(
			([path]) =>
				path.endsWith('.ts') ||
				path.endsWith('.svelte') ||
				path.endsWith('.css') ||
				path.endsWith('.json'),
		)
		.map(([path, content]) => ({
			id: join(projectRoot, path),
			content,
		}));
};

describe('Svelte virtual source → program integration', {timeout: 15_000}, () => {
	test('resolves imported prop types via checker', async () => {
		const files = {
			'src/lib/types.ts': `export interface Props {
	/** Description of a */
	a: string;
	/** Description of b */
	b?: number;
}`,
			'src/lib/Component.svelte': `<script lang="ts">
import type {Props} from './types.js';
let {a, b}: Props = $props();
</script>
<p>{a} {b}</p>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 2);

			const componentModule = findModule(modules, 'Component.svelte');
			const component = assertHasComponentDeclaration(componentModule, 'Component');
			assertHasProps(component, ['a', 'b']);

			// Imported props should have resolved types and descriptions
			const propA = component.props.find((p) => p.name === 'a');
			assert.ok(propA);
			assert.strictEqual(propA.type, 'string');
			assert.strictEqual(propA.description, 'Description of a');
			assert.strictEqual(propA.optional, false);

			const propB = component.props.find((p) => p.name === 'b');
			assert.ok(propB);
			assert.strictEqual(propB.type, 'number');
			assert.strictEqual(propB.description, 'Description of b');
			assert.strictEqual(propB.optional, true);
		});
	});

	test('captures <script module> exports alongside component', async () => {
		const files = {
			'src/lib/Component.svelte': `<script module>
export const CONSTANT = 'value';
export type Config = { a: string };
</script>
<script lang="ts">
let {prop1}: {prop1: string} = $props();
</script>
<p>{prop1}</p>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 1);
			const mod = modules[0]!;

			// Should have exactly 3 declarations: CONSTANT, Config, Component
			assert.strictEqual(mod.declarations.length, 3);

			const component = assertHasComponentDeclaration(mod, 'Component');
			assertHasProps(component, ['prop1']);

			const constant = assertHasDeclaration(mod, 'CONSTANT');
			assert.strictEqual(constant.kind, 'variable');

			const configType = assertHasDeclaration(mod, 'Config');
			assert.strictEqual(configType.kind, 'type');
		});
	});

	test('transformSvelteSource produces valid virtual file', () => {
		const sourceFile: SourceFileInfo = {
			id: '/project/src/lib/Test.svelte',
			content: `<script lang="ts">
let {value}: {value: number} = $props();
</script>
<p>{value}</p>`,
		};

		const result = transformSvelteSource(sourceFile);
		assert.ok(result.virtual, 'Should successfully transform');
		const virtual = result.virtual;

		assert.ok(virtual.virtualPath.endsWith('.__svelte2tsx__.ts'));
		assert.ok(virtual.content.length > 0);
		assert.ok(virtual.content.includes('$props'));
		assert.ok(virtual.sourceMap, 'Should produce a source map');
	});

	test('virtual files in program enable checker resolution', async () => {
		const files = {
			'src/lib/types.ts': `export type Color = 'a' | 'b' | 'c';`,
			'src/lib/Badge.svelte': `<script lang="ts">
import type {Color} from './types.js';
let {color}: {color: Color} = $props();
</script>
<span>{color}</span>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			// Pre-transform and include in program
			const virtualFiles = new Map<string, string>();
			const svelteVirtuals = new Map<string, SvelteVirtualFile>();
			for (const sf of sourceFiles) {
				if (sf.id.endsWith('.svelte')) {
					const {virtual} = transformSvelteSource(sf);
					if (!virtual) throw new Error(`transform failed for ${sf.id}`);
					virtualFiles.set(virtual.virtualPath, virtual.content);
					svelteVirtuals.set(sf.id, virtual);
				}
			}

			const program = createAnalysisProgram({
				projectRoot,
				virtualFiles,
			});

			// Verify virtual file is in the program
			for (const [, virtual] of svelteVirtuals) {
				const tsSource = program.getSourceFile(virtual.virtualPath);
				assert.ok(tsSource, 'Virtual file should be in program');
			}
		});
	});

	test('component with both script types and imported props', async () => {
		const files = {
			'src/lib/types.ts': `export interface ItemProps {
	/** The item identifier */
	id: number;
	/** The item label */
	label: string;
}`,
			'src/lib/Item.svelte': `<script module>
export const DEFAULT_LABEL = 'untitled';
</script>
<script lang="ts">
import type {ItemProps} from './types.js';
let {id, label}: ItemProps = $props();
</script>
<div data-id={id}>{label}</div>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			const itemModule = findModule(modules, 'Item.svelte');

			// Should have module export + component
			const constant = assertHasDeclaration(itemModule, 'DEFAULT_LABEL');
			assert.strictEqual(constant.kind, 'variable');

			const component = assertHasComponentDeclaration(itemModule, 'Item');
			assertHasProps(component, ['id', 'label']);

			// Imported props should have resolved types and descriptions
			const idProp = component.props.find((p) => p.name === 'id');
			assert.ok(idProp);
			assert.strictEqual(idProp.type, 'number');
			assert.strictEqual(idProp.description, 'The item identifier');

			const labelProp = component.props.find((p) => p.name === 'label');
			assert.ok(labelProp);
			assert.strictEqual(labelProp.type, 'string');
		});
	});

	test('inline props still work with checker-backed path', async () => {
		const files = {
			'src/lib/Simple.svelte': `<script lang="ts">
/** A simple component. */
let {prop1, prop2}: {
	/** Description 1 */
	prop1: string;
	/** Description 2 */
	prop2?: number;
} = $props();
</script>
<div>{prop1} {prop2}</div>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 1);
			const component = assertHasComponentDeclaration(modules[0]!, 'Simple');
			assert.strictEqual(component.docComment, 'A simple component.');
			assertHasProps(component, ['prop1', 'prop2']);

			const prop1 = component.props.find((p) => p.name === 'prop1');
			assert.ok(prop1);
			assert.strictEqual(prop1.type, 'string');
			assert.strictEqual(prop1.description, 'Description 1');
			assert.strictEqual(prop1.optional, false);

			const prop2 = component.props.find((p) => p.name === 'prop2');
			assert.ok(prop2);
			assert.strictEqual(prop2.type, 'number');
			assert.strictEqual(prop2.description, 'Description 2');
			assert.strictEqual(prop2.optional, true);
		});
	});

	test('component without props works with checker-backed path', async () => {
		const files = {
			'src/lib/Static.svelte': `<p>Static content</p>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 1);
			assertHasComponentDeclaration(modules[0]!, 'Static');
			assert.strictEqual(modules[0]!.declarations.length, 1, 'Should have only the component');
		});
	});

	test('generic component with imported props', async () => {
		const files = {
			'src/lib/types.ts': `export interface ListProps<T> {
	/** The items */
	items: T[];
	/** Selected item */
	selected?: T;
}`,
			'src/lib/List.svelte': `<script lang="ts" generics="T">
import type {ListProps} from './types.js';
let {items, selected}: ListProps<T> = $props();
</script>
<ul>{#each items as item}<li>{item}</li>{/each}</ul>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			const listModule = findModule(modules, 'List.svelte');
			const component = assertHasComponentDeclaration(listModule, 'List');
			assertHasProps(component, ['items', 'selected']);

			// Generic params should be extracted
			assert.ok(component.genericParams, 'Should have generic params');
			assert.strictEqual(component.genericParams.length, 1);
			assert.strictEqual(component.genericParams[0]!.name, 'T');

			// Imported generic props should have resolved types
			const itemsProp = component.props.find((p) => p.name === 'items');
			assert.ok(itemsProp);
			assert.strictEqual(itemsProp.type, 'T[]');
			assert.strictEqual(itemsProp.description, 'The items');
			assert.strictEqual(itemsProp.optional, false);

			const selectedProp = component.props.find((p) => p.name === 'selected');
			assert.ok(selectedProp);
			assert.strictEqual(selectedProp.optional, true);
		});
	});

	test('bindable props with defaults via checker path', async () => {
		const files = {
			'src/lib/Toggle.svelte': `<script lang="ts">
let {
	active = false,
	label,
}: {
	/** Whether active */
	active?: boolean;
	/** The label */
	label: string;
} = $props();
</script>
<button onclick={() => active = !active}>{label}: {active}</button>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			const mod = findModule(modules, 'Toggle.svelte');
			const component = assertHasComponentDeclaration(mod, 'Toggle');
			assertHasProps(component, ['active', 'label']);

			const activeProp = component.props.find((p) => p.name === 'active');
			assert.ok(activeProp);
			assert.strictEqual(activeProp.type, 'boolean');
			assert.strictEqual(activeProp.optional, true);
			assert.strictEqual(activeProp.defaultValue, 'false');
			assert.strictEqual(activeProp.description, 'Whether active');

			const labelProp = component.props.find((p) => p.name === 'label');
			assert.ok(labelProp);
			assert.strictEqual(labelProp.type, 'string');
			assert.strictEqual(labelProp.optional, false);
		});
	});

	test('mixed .ts and .svelte files with re-exports', async () => {
		const files = {
			'src/lib/Button.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/utils.ts': `export const VERSION = '1.0.0';`,
			'src/lib/index.ts': `export {VERSION} from './utils.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 3);

			// Svelte component via checker-backed path
			const buttonModule = findModule(modules, 'Button.svelte');
			const component = assertHasComponentDeclaration(buttonModule, 'Button');
			assertHasProps(component, ['label']);

			// Re-exports between .ts files should still work
			const utilsModule = findModule(modules, 'utils.ts');
			const version = assertHasDeclaration(utilsModule, 'VERSION');
			assert.strictEqual(version.kind, 'variable');

			// index.ts re-exports VERSION → alsoExportedFrom should be populated
			assert.ok(
				version.alsoExportedFrom.length > 0,
				'VERSION should have alsoExportedFrom via re-export',
			);
		});
	});

	test('re-exports from <script module> are tracked', async () => {
		const files = {
			'src/lib/types.ts': `export type Status = 'active' | 'inactive';`,
			'src/lib/Widget.svelte': `<script module>
export {type Status} from './types.js';
</script>
<script lang="ts">
let {name}: {name: string} = $props();
</script>
<div>{name}</div>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 2);

			// The Svelte module should have both the re-exported type and the component
			const widgetModule = findModule(modules, 'Widget.svelte');
			const component = assertHasComponentDeclaration(widgetModule, 'Widget');
			assertHasProps(component, ['name']);

			// Status should be tracked as alsoExportedFrom on the canonical declaration
			const typesModule = findModule(modules, 'types.ts');
			const status = assertHasDeclaration(typesModule, 'Status');
			assert.ok(
				status.alsoExportedFrom.length > 0,
				'Status should have alsoExportedFrom via Svelte re-export',
			);
		});
	});

	test('@nodocs on <script module> exports are filtered', async () => {
		const files = {
			'src/lib/Widget.svelte': `<script module>
/** @nodocs */
export const INTERNAL = 'hidden';
export const PUBLIC = 'visible';
</script>
<script lang="ts">
let {name}: {name: string} = $props();
</script>
<div>{name}</div>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			const mod = findModule(modules, 'Widget.svelte');

			// INTERNAL should be filtered out by @nodocs, leaving PUBLIC + component
			const names = mod.declarations.map((d) => d.name);
			assert.ok(!names.includes('INTERNAL'), '@nodocs export should be filtered');
			assert.ok(names.includes('PUBLIC'), 'Public export should remain');
			assertHasComponentDeclaration(mod, 'Widget');
		});
	});

	test('Svelte-to-Svelte re-export via <script module>', async () => {
		const files = {
			'src/lib/Exported.svelte': `<script module>
export const VERSION = '2.0.0';
</script>
<script lang="ts">
let {value}: {value: string} = $props();
</script>
<p>{value}</p>`,
			'src/lib/Reexporter.svelte': `<script module>
export {VERSION} from './Exported.svelte';
</script>
<script lang="ts">
let {name}: {name: string} = $props();
</script>
<div>{name}</div>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 2);

			// Both modules should have their component declarations
			const exportedModule = findModule(modules, 'Exported.svelte');
			assertHasComponentDeclaration(exportedModule, 'Exported');
			const versionDecl = assertHasDeclaration(exportedModule, 'VERSION');
			assert.strictEqual(versionDecl.kind, 'variable');

			const reexporterModule = findModule(modules, 'Reexporter.svelte');
			assertHasComponentDeclaration(reexporterModule, 'Reexporter');

			// VERSION should have alsoExportedFrom populated via the Svelte re-export
			assert.ok(
				versionDecl.alsoExportedFrom.length > 0,
				'VERSION should have alsoExportedFrom via Svelte-to-Svelte re-export',
			);
			assert.ok(
				versionDecl.alsoExportedFrom.some((m) => m.endsWith('Reexporter.svelte')),
				`VERSION alsoExportedFrom should include Reexporter.svelte, got: ${JSON.stringify(versionDecl.alsoExportedFrom)}`,
			);
		});
	});

	test('Svelte-to-Svelte star export via <script module>', async () => {
		const files = {
			'src/lib/Base.svelte': `<script module>
export const BASE_VERSION = '1.0';
export type BaseConfig = { enabled: boolean };
</script>
<p>Base</p>`,
			'src/lib/Barrel.svelte': `<script module>
export * from './Base.svelte';
</script>
<script lang="ts">
let {active}: {active: boolean} = $props();
</script>
<div>{active}</div>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 2);

			const barrelModule = findModule(modules, 'Barrel.svelte');
			// Star exports should reference the Base.svelte module
			assert.ok(
				barrelModule.starExports.some((s) => s.endsWith('Base.svelte')),
				`Barrel starExports should include Base.svelte, got: ${JSON.stringify(barrelModule.starExports)}`,
			);
		});
	});

	test('Svelte importing type from another Svelte via <script module>', async () => {
		const files = {
			'src/lib/Provider.svelte': `<script module>
export type Theme = 'light' | 'dark';
</script>
<p>Provider</p>`,
			'src/lib/Consumer.svelte': `<script lang="ts">
import type {Theme} from './Provider.svelte';
let {theme}: {theme: Theme} = $props();
</script>
<div class={theme}>Content</div>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			assert.strictEqual(modules.length, 2);

			const consumerModule = findModule(modules, 'Consumer.svelte');
			const component = assertHasComponentDeclaration(consumerModule, 'Consumer');
			assertHasProps(component, ['theme']);

			// The imported type should be resolved
			const themeProp = component.props.find((p) => p.name === 'theme');
			assert.ok(themeProp);
			assert.strictEqual(themeProp.type, 'Theme');
		});
	});

	test('no svelte2tsx internals leak into declarations', async () => {
		const files = {
			'src/lib/Leaky.svelte': `<script lang="ts">
let {value}: {value: string} = $props();
</script>
<p>{value}</p>`,
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);

			const {modules} = await analyze({
				sourceFiles,
				sourceOptions: createSourceOptions(projectRoot),
			});

			const mod = findModule(modules, 'Leaky.svelte');

			// Should only have the component declaration, no internal svelte2tsx symbols
			assert.strictEqual(mod.declarations.length, 1, 'Should have exactly 1 declaration');
			assert.strictEqual(mod.declarations[0]!.kind, 'component');

			// Verify no internal identifiers leaked
			for (const decl of mod.declarations) {
				assert.ok(!decl.name.startsWith('$$'), `"${decl.name}" is an internal svelte2tsx symbol`);
				assert.ok(
					!decl.name.startsWith('__sveltets_'),
					`"${decl.name}" is an internal svelte2tsx symbol`,
				);
			}
		});
	});
});
