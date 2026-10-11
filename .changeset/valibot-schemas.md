---
'svelte-docinfo': minor
---

feat: replace zod with valibot for the output schemas, and add parse helpers

**Breaking.** The exported schemas are now [valibot](https://valibot.dev/) schemas. `zod` is no longer a peer, and `valibot` is a regular dependency, so there's nothing to install. Analysis output is unchanged: the same JSON, TypeScript types, and defaults.

Three new helpers validate output and restore the defaults the compact wire form omits, without your code touching the schema library: `parseAnalyzeResult` for a whole result, `parseModuleJson` for one module, and `parseDiagnostics` for an array of diagnostics.

To migrate:

- `AnalyzeResultJson.parse(x)` → `parseAnalyzeResult(x)`, `ModuleJson.parse(x)` → `parseModuleJson(x)`, and `z.array(Diagnostic).parse(x)` → `parseDiagnostics(x)`.
- For any other schema, `Schema.parse(x)` → `v.parse(Schema, x)` and `.safeParse(x)` → `v.safeParse(Schema, x)`, with `valibot` in your own dependencies. Composing one into a schema of yours (`z.array(ModuleJson)`) needs valibot too, since zod and valibot schemas don't mix.
- `z.infer<typeof ModuleJson>` → the exported `ModuleJson` type, and `z.input<…>` → `ModuleJsonInput` (or `v.InferOutput` and `v.InferInput`). The exported type names are unchanged.
- `AnalyzeResultJson` has no `.entries`, because an array guard is piped ahead of the object. Build on `ModuleJson` and `Diagnostic` instead.

A parse helper that fails throws valibot's `ValiError` in place of a `ZodError`, with the structured list on `.issues`. Its `message` has one line per issue, as `path: message`:

```
modules.0.declarations.0.typeInfo: Invalid key: Expected never but received "typeInfo"
modules.1.path: Invalid type: Expected string but received 1
```

An object with several unknown keys reports only the first, where zod named them all. The wording is valibot's, so don't match on it.
