<script lang="ts">
	import { modules } from 'virtual:svelte-docinfo';

	console.log('svelte-docinfo modules:', modules);
</script>

<main>
	<h1>svelte-docinfo + Vite</h1>
	<p>
		Vite plugin serves analysis as the <code>virtual:svelte-docinfo</code> import with HMR (<a
			href="https://svelte-docinfo.fuz.dev/">docs</a
		>,
		<a href="https://github.com/fuzdev/svelte-docinfo/tree/main/examples/vite">source</a>).
	</p>
	<p>{modules.length} module{modules.length === 1 ? '' : 's'} analyzed:</p>
	<ul>
		{#each modules as mod}
			<li>
				<strong>{mod.path}</strong>
				{#if mod.declarations?.length}
					—
					{#each mod.declarations as decl, i}
						{#if i > 0},
						{/if}<code>{decl.name}</code>
					{/each}
				{/if}
			</li>
		{/each}
	</ul>
	<details>
		<summary>Raw JSON</summary>
		<pre><code>{JSON.stringify(modules, null, '\t')}</code></pre>
	</details>
</main>

<style>
	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
		font-family: system-ui, sans-serif;
	}
	code {
		background: #f0f0f0;
		padding: 0.15em 0.3em;
		border-radius: 3px;
	}
</style>
