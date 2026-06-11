<script lang="ts">
	import {resolve} from '$app/paths';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';
</script>

<svelte:head>
	<title>demo - svelte-docinfo</title>
</svelte:head>

<div class="box w_100 py_xl4">
	<h1>demo</h1>
	<p>experiments in presenting what svelte-docinfo extracts</p>
	<nav class="column gap_lg mt_xl">
		<a href={resolve('/demo/extraction')} class="panel px_xl py_md">
			<h2 class="mt_0 mb_sm">extraction</h2>
			<p class="text_70" style:font-weight="400">
				modules, source, and extracted data side by side
			</p>
		</a>
	</nav>
	<section class="width_atmost_sm">
		<blockquote>
			The extraction demo analyzes the
			<a href="https://github.com/fuzdev/svelte-docinfo/tree/main/examples/api"
				>examples/api corpus</a
			>
			with Svelte components with snippet props, classes, enums, overloads, runes, re-export forms, and
			one intentional doc mistake. See also the
			<a href="{resolve('/docs/output-format')}#Examples">example docs</a>.
		</blockquote>
	</section>
	<footer class="mt_xl4">
		<Breadcrumb />
	</footer>
</div>
