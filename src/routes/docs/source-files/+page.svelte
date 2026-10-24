<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'source-files';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>source files - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			Every analyzed file informs types, but only <strong>source files</strong> are documented, each
			as one <code>ModuleJson</code>: the files discovery finds that sit under the source paths
			(default <code>src/lib</code>) and match no <code>exclude</code> pattern. This page covers how
			files are found and scoped; the options are the same across the
			<TomeLink slug="vite-plugin">Vite plugin</TomeLink>, the <TomeLink slug="cli">CLI</TomeLink>
			(as flags), and the <TomeLink slug="js-api">JS API</TomeLink>.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Discovery" />
		<p>The <code>discovery</code> option picks how files are found:</p>
		<ul>
			<li>
				<code>'auto'</code> (default): from <code>package.json</code> <code>exports</code>, falling
				back to globs when there are none
			</li>
			<li>
				<code>'exports'</code>: from <code>exports</code> only, throwing when they're missing or
				name no source files
			</li>
			<li><code>'glob'</code>: every module file under the source paths</li>
		</ul>
		<p>
			Exports discovery maps each <code>dist</code> entry back to its source: a <code>.js</code> to
			the <code>.ts</code>, <code>.tsx</code>, <code>.js</code>, or <code>.jsx</code> beside it, in
			that order, and an <code>.mjs</code> to an <code>.mts</code> or <code>.mjs</code>. Wildcard
			entries (<code>"./*.js"</code>) expand, and <code>null</code> entries
			(<code>"./internal/*": null</code>) block subpaths with Node's matching rules.
		</p>
		<p>
			Modules are <code>.svelte</code>, <code>.ts</code>, <code>.mts</code>, <code>.tsx</code>,
			<code>.js</code>, <code>.mjs</code>, and <code>.jsx</code> files. Discovery also finds
			<code>.css</code> and <code>.json</code> files, which document as modules with no
			declarations. <code>.cjs</code>, <code>.cts</code>, and declaration files aren't analyzed.
		</p>
		<p>
			<code>include</code> globs replace discovery (they collapse <code>'auto'</code> to glob, and
			combining them with <code>'exports'</code> throws). Each pattern's static base joins the
			source paths, so the files it finds are documented; a pattern with no base
			(<code>**/*.ts</code>) makes the whole project source.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Excluding files" />
		<p>
			<code>exclude</code> applies at discovery and analysis alike, so an excluded file is never
			documented however it was found. The default is
			<code>{`['**/*.{test,spec}.{ts,mts,tsx,js,mjs,jsx}', '**/internal/**']`}</code>. An array
			replaces it, and a callback extends it:
		</p>
		<Code lang="ts" content={`exclude: (defaults) => [...defaults, '**/*.gen.ts']`} />
		<p>
			The CLI's <code>--exclude</code> always replaces the defaults. Beneath any
			<code>exclude</code>, <code>node_modules</code> and dot-directories below a source path are
			never source; <code>dist</code> and <code>build</code> are ordinary names.
		</p>
		<p>
			<strong><code>src/lib/internal/</code></strong> holds modules that ship for public modules to
			import but aren't documented, usually paired with an <code>"./internal/*": null</code> exports
			entry. They still inform types, and in dev an edit to one re-analyzes the modules that use it.
			A public re-export of an internal symbol documents in full at the re-export. To document them
			anyway, drop the pattern:
			<code>{`exclude: (defaults) => defaults.filter((p) => p !== '**/internal/**')`}</code>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Source paths" />
		<p>
			<code>sourceOptions.sourcePaths</code> (CLI: <code>--source-dir</code>, repeatable) lists the
			source directories, and <code>sourceRoot</code> (<code>--source-root</code>) is the base of
			<code>ModuleJson.path</code>, by default the single source path or the common prefix of
			several. Pass <code>'.'</code> for project-relative paths.
		</p>
		<Code
			lang="ts"
			content={`import {createSourceOptions} from 'svelte-docinfo';

const sourceOptions = createSourceOptions(process.cwd(), {
  sourcePaths: ['packages/a/src', 'packages/b/src'],
});`}
		/>
		<p>
			Paths and patterns are relative to the project root. Absolute ones inside it are accepted, and
			anything outside it throws when the options are created. <code>'/src/lib'</code> is a
			filesystem path, not shorthand for <code>'src/lib'</code>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="tsconfig" />
		<p>
			Analysis runs with your project's compiler options, from <code>tsconfig.json</code> found at
			or above the project root (the <code>tsconfig</code> option, or <code>--tsconfig</code>, names
			another). The file and its whole <code>extends</code> chain must load, so a SvelteKit project
			needs <code>svelte-kit sync</code> first. <code>tsconfig: false</code>
			(<code>--no-tsconfig</code>) analyzes without one, under strict built-in options
			(<DeclarationLink name="DEFAULT_COMPILER_OPTIONS" />), and <code>compilerOptions</code> merge
			over either, key by key.
		</p>
		<p>
			<code>allowJs</code> is always on, so JS modules document under any tsconfig (see
			<TomeLink slug="js" />).
		</p>
		<p>
			Every file the tsconfig includes loads, which makes a cold start scale with the project.
			<code>rootFileNames</code> narrows that to the analyzed files and what they import; an ambient
			type declared in a file nothing imports then resolves to <code>any</code>, unless you keep the
			declaration files with the <code>declarationFileRoots</code> preset (see
			<DeclarationLink name="RootFileNames" />).
		</p>
	</TomeSection>
</TomeContent>
