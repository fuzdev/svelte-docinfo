<script lang="ts">
	import Svg from '@fuzdev/fuz_ui/Svg.svelte';
	import {logo_svelte_docinfo} from '$lib/logo.js';
	import {resolve} from '$app/paths';
	import DocsFooter from '@fuzdev/fuz_ui/DocsFooter.svelte';
</script>

<main>
	<section class="box">
		<header class="box pt_xl7">
			<Svg data={logo_svelte_docinfo} size="var(--icon_size_xl)" />
			<h1 class="mt_xl3 mb_xl">svelte-docinfo</h1>
		</header>
		<p class="px_xl text-align:center">static analysis for TypeScript and Svelte</p>
	</section>
	<section>
		<div class="column gap_lg">
			<a href={resolve('/docs')} class="panel px_xl py_md font_size_xl2 text-align:center">docs</a>
		</div>
	</section>
	<section>
		<!-- TODO remove `library` from the `DocsFooter` props -->
		<DocsFooter
			library={{repo_url: 'https://github.com/fuzdev/svelte-docinfo'} as any}
			root_url="https://www.fuz.dev/"
		/>
	</section>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin: 0 auto;
	}
</style>
