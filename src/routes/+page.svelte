<script lang="ts">
	import Svg from '@fuzdev/fuz_ui/Svg.svelte';
	import {logo_svelte_docinfo} from '$lib/logo.js';
	import {resolve} from '$app/paths';
	import DocsFooter from '@fuzdev/fuz_ui/DocsFooter.svelte';
	import {site_context} from '@fuzdev/fuz_ui/site.svelte.js';
	import {FUZ_DEV_URL} from '@fuzdev/fuz_ui/constants.js';

	const site = site_context.get();
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
			<a href={resolve('/demo')} class="panel px_xl py_md font_size_xl2 text-align:center">demo</a>
		</div>
	</section>
	<section>
		<DocsFooter repo_url={site.repo_url} root_url={FUZ_DEV_URL} />
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
