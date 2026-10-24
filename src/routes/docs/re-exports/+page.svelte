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
			An imported binding exported again (<code>{`import {a} from './x'; export {a}`}</code>, or
			<code>export default</code> of an import) counts as the <code>export … from</code> it stands
			for.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Encodings" />
		<ul>
			<li>
				<strong>Same name</strong> (<code>{`export {a} from './x'`}</code>): the declaration's
				<code>alsoExportedFrom</code> lists the re-exporting modules, and each of those lists the
				edge in <code>ModuleJson.reExports</code>
				(<code>{`{name, module, typeOnly, sourceLine}`}</code>), with <code>module</code> naming the
				declaring module through any chain.
			</li>
			<li>
				<strong>Renamed</strong> (<code>{`export {a as b} from './x'`}</code>): a full declaration
				<code>b</code> in the re-exporting module, with
				<code>aliasOf: {`{module, name: "a"}`}</code> and the local specifier's
				<code>sourceLine</code>.
			</li>
			<li>
				<strong>Star</strong> (<code>export * from './x'</code>): <code>x</code>'s path in
				<code>starExports</code>, with no per-name entries. If <code>x</code> isn't documented
				itself, its names document in the re-exporting module instead.
			</li>
			<li>
				<strong>Namespace</strong> (<code>export * as ns from './x'</code>): a
				<code>kind: 'namespace'</code> declaration whose <code>module</code> names <code>x</code>;
				read its members from that module.
			</li>
			<li>
				<strong>Packages</strong> (<code>{`export {a} from 'pkg'`}</code>,
				<code>export * from 'pkg'</code>): <code>externalReExports</code> and
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
			<code>export default</code> and <code>{`export {a as default}`}</code> carry
			<code>name: "default"</code>, except Svelte components, which take their filename's name. A
			rename out of the default slot (<code>{`export {default as A} from './x'`}</code>) carries
			<code>name: "A"</code> and <code>aliasOf: {`{module, name: "default"}`}</code>, or the
			component's name for a Svelte component.
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
