---
'svelte-docinfo': patch
---

fix: normalize the absolute module paths TypeScript embeds in printed type text

The checker prints a module object as `typeof import("<absolute path>")` — from
an `import()` expression or a `typeof` over a namespace import. It reached
`typeSignature` (declarations and members), `returnType`, and the `text`/`name`
of a `TypeJson` node, exposing the svelte2tsx virtual suffix on Svelte targets.
Output was machine-dependent as a result, and any site rendering
`typeSignature` published a local filesystem path.

Paths now normalize in tiers: a module in this output is named by its
`ModuleJson.path`, so the string doubles as a lookup key — linkify with
`modules.find((m) => m.path === s)` and read a miss as "not a module here"
(`typeof import("Wid.svelte")` for a component). A package is named by its path
below `node_modules/`, and everything else relative to the project root —
root-relative for an in-project file that emits no module, `../sibling/x.ts`
for one outside it.

Only paths naming a file the program loaded are rewritten, leaving author text
and path-shaped string-literal types (`type P = "/usr/bin"`) untouched.

Diagnostics get the same treatment. `Diagnostic.message` is now scrubbed
alongside `Diagnostic.file`, so no field on the record carries an absolute path
— `import_parse_failed` previously leaked one through the wrapped
es-module-lexer error. And a `Diagnostic.file` outside the project root now
takes the `../` form rather than having its leading slash dropped, which had
produced a string that reads as root-relative but resolves elsewhere; rejoining
with `projectRoot`, as the docs have always said to, now recovers the original
path in every case.
