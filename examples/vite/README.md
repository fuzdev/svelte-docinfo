# Vite Plugin Example

A minimal Vite + Svelte app using the svelte-docinfo Vite plugin.

The plugin analyzes the project's source files at build time and serves the result
as the `virtual:svelte-docinfo` import. In dev mode it watches for file changes
and sends HMR updates, so your docs stay in sync as you edit.

## Run

```bash
npm i
npm run dev      # dev server with HMR — edit source files and see updates
npm run build    # production build
```

## Dependencies

This example lists `svelte` and `svelte2tsx` as explicit devDependencies
because the `file:../..` link doesn't auto-install peer dependencies. Of the
four peers (`svelte`, `svelte2tsx`, `typescript`, `zod`), the other two resolve
through the linked package's own `node_modules`, as do its regular
dependencies.

## Setup

Three steps to add svelte-docinfo to a Vite or SvelteKit project
(see [vite.config.ts](vite.config.ts), [src/vite-env.d.ts](src/vite-env.d.ts),
and [src/App.svelte](src/App.svelte) for the full working example):

1. Add the plugin in `vite.config.ts`
2. Add the `/// <reference>` type in `vite-env.d.ts` (or `app.d.ts` for SvelteKit)
3. Import `{modules} from 'virtual:svelte-docinfo'` anywhere in your app
