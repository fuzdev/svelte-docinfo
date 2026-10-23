<script lang="ts">
	import { resolve } from '$app/paths';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';
</script>

<svelte:head>
	<title>demo - svelte-docinfo</title>
</svelte:head>

<div class="box width:100% py_xl4">
	<h1>demo</h1>
	<div class="width_atmost_sm mt_xl">
		<nav class="column gap_lg">
			<a
				href={resolve('/demo/extraction/[...module_path]', { module_path: '' })}
				class="demo-card panel px_xl py_md"
			>
				<h2 class="mt_0 mb_sm">extraction</h2>
				<p class="text_70" style:font-weight="400">
					modules, source, and extracted data side by side
				</p>
			</a>
		</nav>
		<p class="mt_lg">
			The extraction demo analyzes the
			<a href="https://github.com/fuzdev/svelte-docinfo/tree/main/examples/api">
				examples/api corpus
			</a>, which covers Svelte components with snippet, callback, and generic props, classes,
			enums, overloads, runes, re-export forms, and one intentional doc mistake, shown as a
			diagnostic. See also the
			<a href="{resolve('/docs/output-format')}#Examples">output format examples</a>.
		</p>
	</div>
	<footer class="mt_xl4">
		<Breadcrumb />
	</footer>
</div>

<style>
	/* underline only the title on hover, not the whole card body */
	.demo-card,
	.demo-card:hover {
		text-decoration: none;
	}
	.demo-card:hover h2 {
		text-decoration: var(--text_decoration_hover);
	}
</style>
