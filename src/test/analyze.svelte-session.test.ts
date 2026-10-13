/**
 * Tests for Svelte components across session edits: each `setFile` is a new
 * source for the same file, so everything read from the source has to be read
 * again.
 *
 * 1. legacy components — a script edit, and a component changing between
 *    legacy and runes, each re-queried
 * 2. script tags — a nested script edited, added, and left as the only one,
 *    and a nested `lang` appearing in a JS component
 *
 * The same shapes on one cold batch are in `analyze.legacy-components.test.ts`;
 * the session's `lang` flip is in `analyze.js-components.test.ts`.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import type { ComponentDeclarationJson } from '#lib/types.ts';
import { createAnalysisSession } from '#lib/session.ts';
import { createSourceOptions } from '#lib/source-config.ts';

import { findComponent, withTestProject } from './test-helpers.ts';

/** Comparison projection over props: the fields these tests assert. */
const propShapes = (component: ComponentDeclarationJson) =>
	component.props.map(({ name, type, optional, bindable, defaultValue }) => ({
		name,
		type,
		optional,
		bindable,
		defaultValue
	}));

/** `body` as a script nested in `<svelte:head>`, which isn't the component's. */
const NESTED = (body: string): string => `<svelte:head>
	<script>
		${body}
	</script>
</svelte:head>
`;

const LEGACY_V1 = `<script lang="ts">
	export let a: string;
</script>
<div>{a}</div>
`;

const LEGACY_V2 = `<script lang="ts">
	export let a: string;
	export let b = 1;
</script>
<div>{a}{b}</div>
`;

const RUNES = `<script lang="ts">
	let { a, b = $bindable(1) }: { a: string; b?: number } = $props();
</script>
<div>{a}{b}</div>
`;

/** Drive one component through a session, querying after each version. */
const querySteps = (versions: Array<string>): Promise<Array<ComponentDeclarationJson>> =>
	// the project supplies only tsconfig.json: the session takes content
	// directly and never reads the `.svelte` from disk
	withTestProject({}, async (projectRoot) => {
		const id = join(projectRoot, 'src/lib/Comp.svelte');
		const session = createAnalysisSession({ sourceOptions: createSourceOptions(projectRoot) });
		try {
			const steps: Array<ComponentDeclarationJson> = [];
			for (const content of versions) {
				await session.setFile({ id, content });
				const { modules, diagnostics } = session.query();
				assert.deepStrictEqual(diagnostics, []);
				steps.push(findComponent(modules));
			}
			return steps;
		} finally {
			session.dispose();
		}
	});

describe('legacy components across session edits', { timeout: 30_000 }, () => {
	test('an edit to a legacy script shows in the next query', async () => {
		const [first, second, third] = await querySteps([LEGACY_V1, LEGACY_V2, LEGACY_V1]);
		assert.deepStrictEqual(
			propShapes(first!).map((p) => p.name),
			['a']
		);
		assert.deepStrictEqual(propShapes(second!), [
			{ name: 'a', type: 'string', optional: false, bindable: true, defaultValue: undefined },
			{ name: 'b', type: 'number', optional: true, bindable: true, defaultValue: '1' }
		]);
		assert.deepStrictEqual(propShapes(third!), propShapes(first!));
	});

	test('a component changing between legacy and runes re-reads its mode', async () => {
		const [legacy, runes, legacyAgain] = await querySteps([LEGACY_V2, RUNES, LEGACY_V2]);
		// legacy: every prop bindable, the default is the initializer
		assert.deepStrictEqual(
			propShapes(legacy!).map(({ name, bindable }) => ({ name, bindable })),
			[
				{ name: 'a', bindable: true },
				{ name: 'b', bindable: true }
			]
		);
		// runes: only the `$bindable()` prop
		assert.deepStrictEqual(
			propShapes(runes!).map(({ name, bindable }) => ({ name, bindable })),
			[
				{ name: 'a', bindable: false },
				{ name: 'b', bindable: true }
			]
		);
		assert.deepStrictEqual(propShapes(legacyAgain!), propShapes(legacy!));
	});

	test('a default slot counts only while the component reads as legacy', async () => {
		const slot = (script: string): string =>
			`<script lang="ts">\n\t${script}\n</script>\n<slot />\n`;
		const [legacy, runes, legacyAgain] = await querySteps([
			slot('export let a = 1;'),
			slot('let { a = 1 }: { a?: number } = $props();'),
			slot('export let a = 1;')
		]);
		assert.isTrue(legacy!.acceptsChildren);
		assert.isNotTrue(runes!.acceptsChildren);
		assert.isTrue(legacyAgain!.acceptsChildren);
	});
});

describe('nested scripts across session edits', { timeout: 30_000 }, () => {
	test('an edit to a nested script changes nothing about the component', async () => {
		const [first, second] = await querySteps([
			NESTED('export let nested = 1;') + LEGACY_V1,
			NESTED('export let nested = 1; export let other = 2;') + LEGACY_V1
		]);
		assert.deepStrictEqual(
			propShapes(first!).map((p) => p.name),
			['a']
		);
		assert.deepStrictEqual(second, first);
	});

	test('the script tags on the virtual follow the source as scripts move', async () => {
		// the instance script alone, then a nested script ahead of it, then the
		// nested script alone: each ingest locates the tags again
		const [alone, nestedFirst, nestedOnly] = await querySteps([
			LEGACY_V1,
			NESTED('export let nested = 1;') + LEGACY_V1,
			NESTED('export let nested = 1;') + '<div>text1</div>\n'
		]);
		assert.deepStrictEqual(
			propShapes(alone!).map((p) => p.name),
			['a']
		);
		assert.deepStrictEqual(
			propShapes(nestedFirst!).map((p) => p.name),
			['a']
		);
		assert.deepStrictEqual(nestedOnly!.props, []);
	});

	test('a nested lang="ts" appearing does not flip a JS component', async () => {
		const JS = `<script>
	/** @type {{a: string}} */
	let { a } = $props();
</script>
<div>{a}</div>
`;
		const [plain, withNested] = await querySteps([
			JS,
			`<div><script lang="ts">const nested: number = 1;</script></div>\n` + JS
		]);
		assert.strictEqual(plain!.lang, 'js');
		assert.strictEqual(withNested!.lang, 'js');
		assert.deepStrictEqual(propShapes(withNested!), propShapes(plain!));
	});
});
