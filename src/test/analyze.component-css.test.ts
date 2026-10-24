/**
 * Tests for a component's styling API (`cssCustomProperties`) through the
 * analysis entry points: the session's cached reading across queries and
 * edits, a renamed re-export's alias, and a virtual built without one.
 *
 * The extraction rules themselves are locked by the `svelte/css/*` fixtures
 * and `svelte-css.test.ts`.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { byKind } from '#lib/diagnostics.ts';
import { createAnalysisSession } from '#lib/session.ts';
import { createSourceOptions } from '#lib/source-config.ts';

import { findComponent, findModule, withTestProject } from './test-helpers.ts';
import { analyzeDoctored, analyzeTestProject } from './test-module-helpers.ts';

const STYLED = (body: string): string => `<div class="a"></div>
<style>
	.a {
		${body}
	}
</style>
`;

const namesOf = (component: { cssCustomProperties: Array<{ name: string }> }) =>
	component.cssCustomProperties.map((property) => property.name);

describe('cssCustomProperties through a session', { timeout: 30_000 }, () => {
	test('each query reports the cached reading, and an edit re-reads it', async () => {
		await withTestProject({}, async (projectRoot) => {
			const id = join(projectRoot, 'src/lib/Comp.svelte');
			const session = createAnalysisSession({ sourceOptions: createSourceOptions(projectRoot) });
			try {
				await session.setFile({ id, content: STYLED('color: var(--a, red);') });
				const first = session.query();
				assert.deepStrictEqual(namesOf(findComponent(first.modules)), ['--a']);
				// mutating one query's output leaves the next one's alone
				findComponent(first.modules).cssCustomProperties[0]!.name = '--mutated';
				assert.deepStrictEqual(namesOf(findComponent(session.query().modules)), ['--a']);

				const scss = STYLED('color: var(--a, red);').replace('<style>', '<style lang="scss">');
				await session.setFile({ id, content: scss });
				for (let i = 0; i < 2; i++) {
					const { modules, diagnostics } = session.query();
					assert.deepStrictEqual(namesOf(findComponent(modules)), []);
					assert.strictEqual(byKind(diagnostics, 'css_lang_unsupported').length, 1);
				}

				await session.setFile({ id, content: STYLED('color: var(--b, red);') });
				const { modules, diagnostics } = session.query();
				assert.deepStrictEqual(namesOf(findComponent(modules)), ['--b']);
				assert.deepStrictEqual(diagnostics, []);
			} finally {
				session.dispose();
			}
		});
	});
});

describe('cssCustomProperties on re-exports', () => {
	test('a renamed component re-export carries the canonical styling API', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': STYLED('color: var(--a, red);'),
			'src/lib/index.ts': "export { default as Renamed } from './Comp.svelte';\n"
		});
		assert.deepStrictEqual(diagnostics, []);
		const alias = findModule(modules, 'index.ts').declarations.find((d) => d.name === 'Renamed');
		assert(alias?.kind === 'component');
		assert.deepStrictEqual(alias.cssCustomProperties, [
			{ name: '--a', fallback: 'red', sourceLine: 4 }
		]);
	});
});

describe('css_parse_failed', () => {
	test('the component still emits, with a warning at the original position', async () => {
		const source = STYLED('--b: { c };\n\t\tcolor: var(--a, red);');
		const { modules, diagnostics } = await analyzeTestProject({ 'src/lib/Comp.svelte': source });
		assert.deepStrictEqual(namesOf(findComponent(modules)), []);
		const [warning, ...rest] = byKind(diagnostics, 'css_parse_failed');
		assert.deepStrictEqual(rest, []);
		assert(warning);
		assert.strictEqual(warning.file, 'src/lib/Comp.svelte');
		assert.strictEqual(warning.severity, 'warning');
		assert.strictEqual(warning.line, 4);
	});
});

describe('cssCustomProperties on the virtual', () => {
	const SOURCE = '<div class="a"></div>\n<style>\n\t.a { color: var(--a, red); }\n</style>\n';

	test('analysis reads the styling API the virtual carries, without reading the style again', () => {
		const { component } = analyzeDoctored('CssProbe', SOURCE, {
			virtual: (virtual) => ({ ...virtual, css: { properties: [] } })
		});
		assert.ok(component);
		assert.strictEqual(component.cssCustomProperties, undefined);
	});

	test('a virtual that carries none has it read from the source', () => {
		const { component } = analyzeDoctored('CssProbe', SOURCE, {
			virtual: ({ css: _, ...virtual }) => virtual
		});
		assert.ok(component);
		assert.deepStrictEqual(component.cssCustomProperties, [
			{ name: '--a', fallback: 'red', sourceLine: 3 }
		]);
	});
});

describe('loose parsing', () => {
	test('a template error svelte2tsx emits through leaves the styling API read', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte':
				'<div>{a +}</div>\n<style>\n\tdiv { color: var(--a, red); }\n</style>\n'
		});
		assert.deepStrictEqual(byKind(diagnostics, 'css_parse_failed'), []);
		assert.deepStrictEqual(namesOf(findComponent(modules)), ['--a']);
	});
});
