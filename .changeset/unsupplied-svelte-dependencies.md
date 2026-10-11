---
'svelte-docinfo': patch
---

fix: resolve types through a Svelte component the analysis wasn't given

A component that imports another component could have types drawn from it, like `ComponentProps<typeof Button>['variant']`, come out as `any` with no diagnostic. It happened whenever the imported component was a source file that wasn't part of the analyzed set: a sibling left out of `package.json` `exports` under exports discovery, or the rest of the project when a session was handed one component. The session now reads the source files your files import from disk, through TS barrels too, and gives the type checker each component's transformed form, as it already did for `internal/` files. These files still emit no module unless you supply them, and a session reports them from `has()` and `list()`.

Named re-exports of a file outside the analyzed set are documented in the module that re-exports them, as they already were for a file under `internal/`. Before, a same-name re-export of an unanalyzed TS module left only a `reExports` entry pointing at a module the output didn't contain, and the name was documented nowhere; now `export {foo} from './unexported.js'` is a declaration with `aliasOf`. For a component: `export {default as Button} from './Button.svelte'` is a `component` with its props, and a re-exported `<script module>` function, type, or variable keeps its own kind and signature. Before, each was a bare `variable`. A re-exported snippet is the exception: it documents as a `function` with svelte2tsx's generated signature.

`export * from` such a file is unchanged: it is listed in `starExports`, and the names it projects aren't documented.

If such a component fails to transform, the result now carries a `transform_failed` error for it, where before the failure was silent, and a re-export of it is a `component` marked `partial`.

Also fixed: a renamed re-export of a `<script module>` export, like `export {helper as renamed} from './Button.svelte'`, was documented as a `component` with the component's props. It's now the function, type, or variable it names.

`analyze()` is unchanged: it reads nothing you don't pass, so pass every component the checker needs.
