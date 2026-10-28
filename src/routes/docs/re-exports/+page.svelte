<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 're-exports';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>re-exports - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			A declaration is documented once, in the module that declares it, and re-exports point to it.
			An imported binding exported again
			(<Code lang="ts" inline content={`import {a} from './x'; export {a}`} />, or
			<Code lang="ts" inline content="export default" /> of an import) counts as the
			<Code lang="ts" inline content="export … from" /> it stands for.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Encodings" />
		<ul>
			<li>
				<strong>Same name</strong> (<Code lang="ts" inline content={`export {a} from './x'`} />):
				the declaration's <code>alsoExportedFrom</code> lists the re-exporting modules, and each of
				those lists the edge in <code>ModuleJson.reExports</code>
				(<code>{`{name, module, typeOnly, sourceLine}`}</code>), with <code>module</code> naming the
				declaring module through any chain.
			</li>
			<li>
				<strong>Renamed</strong> (<Code lang="ts" inline content={`export {a as b} from './x'`} />):
				a full declaration <code>b</code> in the re-exporting module, with
				<Code lang="ts" inline content={'aliasOf: {module, name: "a"}'} /> and the local specifier's
				<code>sourceLine</code>.
			</li>
			<li>
				<strong>Star</strong> (<Code lang="ts" inline content="export * from './x'" />):
				<code>x</code>'s path in <code>starExports</code>, with no per-name entries. If
				<code>x</code> isn't documented itself, its names document in the re-exporting module
				instead.
			</li>
			<li>
				<strong>Namespace</strong> (<Code lang="ts" inline content="export * as ns from './x'" />):
				a <Code lang="ts" inline content="kind: 'namespace'" /> declaration whose
				<code>module</code> names <code>x</code>; read its members from that module.
			</li>
			<li>
				<strong>Packages</strong> (<Code lang="ts" inline content={`export {a} from 'pkg'`} />,
				<Code lang="ts" inline content="export * from 'pkg'" />): <code>externalReExports</code> and
				<code>externalStarExports</code>, with the specifier as written.
			</li>
		</ul>
		<p>
			A re-export of a symbol from a module that isn't documented (like an <code>internal/</code>
			one) is a full declaration with <code>aliasOf</code>, even under the same name, since there's
			no declaration to link to; its <code>aliasOf.module</code> names a module the output lacks. A
			re-export statement with its own JSDoc also gets a declaration of its own, its docs over the
			original's, and <code>@nodocs</code> on one drops it entirely.
		</p>
		<p>
			A Svelte component svelte2tsx failed to transform re-exports as a <code>partial</code>
			component.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Default exports" />
		<p>
			<Code lang="ts" inline content="export default" /> and
			<Code lang="ts" inline content={'export {a as default}'} /> carry
			<Code lang="ts" inline content={'name: "default"'} />, except Svelte components, which take
			their filename's name. A rename out of the default slot
			(<Code lang="ts" inline content={`export {default as A} from './x'`} />) carries
			<Code lang="ts" inline content={'name: "A"'} /> and
			<Code lang="ts" inline content={'aliasOf: {module, name: "default"}'} />, or the component's
			name for a Svelte component.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="A module's full export surface" />
		<p>
			<DeclarationLink name="resolveExportSurface" /> combines a module's declarations, re-exports,
			and stars with ES semantics: explicit exports shadow star names, names ambiguous between stars
			drop, and <code>default</code> never projects. It reports stars it can't see into rather than
			guessing.
		</p>
		<Code
			lang="ts"
			content={`import {resolveExportSurface} from 'svelte-docinfo/postprocess.js';

const surface = resolveExportSurface(modules, 'index.ts');`}
		/>
		<p>
			The <TomeLink slug="output-format" hash="Examples">output format examples</TomeLink> include a
			barrel with a rename and a star.
		</p>
	</TomeSection>
</TomeContent>
