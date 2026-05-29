# @fuzdev/fuz_template ❄

[<img src="/static/logo.svg" alt="a friendly pixelated spider facing you" align="right" width="192" height="192">](https://template.fuz.dev/)

> a static web app and Node library template with
> [TypeScript](https://github.com/microsoft/TypeScript),
> [Svelte](https://github.com/sveltejs/svelte),
> [SvelteKit](https://github.com/sveltejs/kit),
> [Vite](https://github.com/vitejs/vite),
> [esbuild](https://github.com/evanw/esbuild),
> [Gro](https://github.com/fuzdev/gro),
> and [fuz_ui](https://github.com/fuzdev/fuz_ui)

[**template.fuz.dev**](https://template.fuz.dev/)

## contents

- [SvelteKit](https://github.com/sveltejs/kit) with [Svelte](https://github.com/sveltejs/svelte) and
  [Vite](https://github.com/vitejs/vite)
- [fuz_css](https://github.com/fuzdev/fuz_css): CSS framework and design system based on style variables
- [fuz_ui](https://github.com/fuzdev/fuz_ui):
  - Svelte UI library - [ui.fuz.dev](https://ui.fuz.dev/)
  - is optional, to remove, `npm uninstall @fuzdev/fuz_ui` and delete the imports
- [Gro](https://github.com/fuzdev/gro):
  - extends [SvelteKit](https://github.com/sveltejs/kit) and
    [Vite](https://github.com/vitejs/vite)
  - integrated [TypeScript](https://github.com/microsoft/TypeScript)
    with [Svelte](https://github.com/sveltejs/svelte) and
    [svelte-check](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check)
  - testing with [Vitest](https://github.com/vitest-dev/vitest)
  - formatting with [Prettier](https://github.com/prettier/prettier)
  - linting with [ESLint](https://github.com/eslint/eslint)
    and [`@ryanatkn/eslint-config`](https://github.com/ryanatkn/eslint-config)
  - also has [a task system](https://github.com/fuzdev/gro/blob/main/src/docs/task.md)
    with a bunch of [builtins](https://github.com/fuzdev/gro/blob/main/src/docs/tasks.md),
    [codegen](https://github.com/fuzdev/gro/blob/main/src/docs/gen.md),
    and [other things](https://github.com/fuzdev/gro/tree/main/src/lib/docs)
- optional [utilities library `@fuzdev/fuz_util`](https://github.com/fuzdev/fuz_util)

## usage

This project uses [SvelteKit](https://kit.svelte.dev/) with the static adapter
and [Vite](https://vitejs.dev/),
so the normal commands like `vite dev` work as expected.
It also uses [Gro](https://github.com/fuzdev/gro)
for tasks like deploying and more.

If you're logged into GitHub, click "Use this template" above or clone with
[`degit`](https://github.com/Rich-Harris/degit):

```bash
npx degit fuzdev/fuz_template cooltoy
cd cooltoy
npm i
# then
vite dev
# or
npm run dev
# or
gro dev # npm i -g @fuzdev/gro
gro sync # called by `gro dev`, refreshes generated files and calls `svelte-kit sync`
```

> learn more about [SvelteKit](https://github.com/sveltejs/kit),
> [Vite](https://github.com/vitejs/vite), [Gro](https://github.com/fuzdev/gro),
> and [fuz_ui](https://github.com/fuzdev/fuz_ui)

To publish `package.json` and a map of the `src/` directory
to `.well-known/` in your build output, add the Vite plugin to your config.
This can leak sensitive information, so enable it only if you intend it to be public!

```ts
// vite.config.ts
import {sveltekit} from '@sveltejs/kit/vite';
import {vite_plugin_library_well_known} from '@fuzdev/gro';

export default {
	plugins: [sveltekit(), vite_plugin_library_well_known()],
};
```

> [Windows will not be suported](https://github.com/fuzdev/fuz_template/issues/4) because
> I chose Bash instead - Fuz recommends [WSL](https://docs.microsoft.com/en-us/windows/wsl/about)

The template includes
[`@sveltejs/adapter-static`](https://github.com/sveltejs/kit/tree/master/packages/adapter-static)
so it can [deploy](https://github.com/fuzdev/gro/blob/main/src/docs/deploy.md)
with no further configuration.
To learn how to swap it out for another deployment target, see
[the SvelteKit adapter docs](https://svelte.dev/docs/kit/adapters).

To make it your own, change `@fuzdev/fuz_template` and `template.fuz.dev`
to your project name in the following files:

- [`package.json`](package.json)
- [`svelte.config.js`](svelte.config.js)
- [`src/routes/+layout.svelte`](src/routes/+layout.svelte)
- [`src/routes/+page.svelte`](src/routes/+page.svelte)
- update or delete [`src/static/CNAME`](src/static/CNAME)
  and ./.github/FUNDING.yml

Then run `npm i` to update `package-lock.json`.

Optionally add a [license file](https://choosealicense.com/)
and [`package.json` value](https://spdx.org/licenses/), like `"license": "MIT"`.

## build

```bash
npm run build
# or
gro build
```

See [Gro's build docs](https://github.com/fuzdev/gro/blob/main/src/docs/build.md) for more.

## test

```bash
npm test
# or
gro test
gro test filepattern1 filepatternB
gro test -- --forwarded-args 'to vitest'
```

See [Vitest](https://github.com/vitest-dev/vitest),
[`src/lib/example.test.ts`](src/lib/example.test.ts),
and [Gro's test docs](https://github.com/fuzdev/gro/blob/main/src/docs/test.md) for more.

## deploy

[Deploy](https://github.com/fuzdev/gro/blob/main/src/docs/deploy.md)
(build, commit, and push) to the `deploy` branch, e.g. for GitHub Pages:

```bash
npm i -D @sveltejs/package # enables Gro's library plugin by default
npm run deploy
# or
gro deploy
```

## credits 🐢<sub>🐢</sub><sub><sub>🐢</sub></sub>

[Svelte](https://github.com/sveltejs/svelte) ∙
[SvelteKit](https://github.com/sveltejs/kit) ∙
[Vite](https://github.com/vitejs/vite) ∙
[esbuild](https://github.com/evanw/esbuild) ∙
[Vitest](https://github.com/vitest-dev/vitest) ∙
[TypeScript](https://github.com/microsoft/TypeScript) ∙
[ESLint](https://github.com/eslint/eslint) ∙
[Prettier](https://github.com/prettier/prettier) ∙
[fuz_css](https://github.com/fuzdev/fuz_css) ∙
[Fuz](https://github.com/fuzdev/fuz_ui) ∙
[Gro](https://github.com/fuzdev/gro) ∙
[@fuzdev/fuz_util](https://github.com/fuzdev/fuz_util) ∙
[Zod](https://github.com/colinhacks/zod) ∙
& [more](package.json)

## [🐦](https://wikipedia.org/wiki/Free_and_open-source_software)
