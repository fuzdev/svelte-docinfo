<script lang="ts">
	// import LibraryDetail from '@fuzdev/fuz_ui/LibraryDetail.svelte';
	import {Library, library_context} from '@fuzdev/fuz_ui/library.svelte.js';
	import DocsFooter from '@fuzdev/fuz_ui/DocsFooter.svelte';
	import EcosystemLinksPanel from '@fuzdev/fuz_ui/EcosystemLinksPanel.svelte';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';
	import Svg from '@fuzdev/fuz_ui/Svg.svelte';
	import {logo_fuz} from '@fuzdev/fuz_ui/logos.js';

	import {library_json} from '$routes/library.ts';

	const library = library_context.set(new Library(library_json));

	// TODO standardize
</script>

<main class="width_atmost_md pb_xl9">
	<section class="box">
		<header class="box pt_xl">
			<Svg data={logo_fuz} size="var(--icon_size_xl)" />
			<h1 class="mt_xl2">fuz_template</h1>
		</header>
		<div style:--font_size="var(--font_size_xl)">
			<Breadcrumb>{library_json.package_json.glyph}</Breadcrumb>
		</div>
	</section>
	<!-- <section class="box width:100% mb_lg">
		<div class="panel p_lg width_atmost_md">
			<LibraryDetail {library} />
		</div>
	</section> -->
	<EcosystemLinksPanel />
	<section class="box">
		<DocsFooter {library} root_url="https://www.fuz.dev/" />
	</section>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin: 0 auto;
	}
	h1 {
		display: flex;
		align-items: baseline;
		text-align: center;
	}
</style>
