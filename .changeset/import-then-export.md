---
'svelte-docinfo': minor
---

fix: document import-then-export like the export-from form

An imported binding exported again under a name other than the one its module exports it as (`import {foo as bar} from './x.ts'; export {bar}`, `import G from './G.svelte'; export {G}`, `import * as ns from './x.ts'; export {ns}`) documented nothing when the target emits a module. Each import-then-export form now gives the same output as the export-from statement it stands for, with `sourceLine` at the export:

- A renamed or default import gives a synthesized alias with `aliasOf`, as `export {foo as bar} from` and `export {default as G} from` do. A Svelte component's is a `component` alias.
- A namespace import gives a `namespace` declaration, as `export * as ns from` does, and a renamed re-export of it from another module is a `namespace` alias with `aliasOf` naming that module, where it used to be a `variable` typed `typeof import(...)`.
- **breaking:** `export default X` over an import is `export {default} from` (or `export {x as default} from`). `import G from './G.svelte'; export default G` (and `export {G as default}`) used to give a `default` component declaration; it now gives only a `reExports` edge named `G`, as `export {default} from './G.svelte'` does. With JSDoc on the statement, the synthesized alias is named `G` and sits at the `export default` line, which it lacked before. A component that failed to transform documents under its name too, as `export {default} from` did already.
- A same-name re-export through such a module links to the module that declares the name, so no `reExports` edge points at a module without it.
- A same-name `export {default} from './c.ts'` over a component that failed to transform no longer depends on unrelated files: it links to `c.ts` whether or not some other component imports `svelte`.
- JSDoc on an `export default x` statement now applies, as on `export {x as default}`, and `@nodocs` there suppresses.

A package binding imported and exported again still records nothing.
