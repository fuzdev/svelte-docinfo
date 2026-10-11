---
'svelte-docinfo': minor
---

feat: replace zod with valibot for the output schemas, and add parse helpers

**Breaking.** The exported schemas (`AnalyzeResultJson`, `ModuleJson`, `DeclarationJson`, `MemberJson`, `TypeJson`, `Diagnostic`, and the rest of `types.ts` and `diagnostics.ts`) are now [valibot](https://valibot.dev/) schemas instead of zod ones. The `zod` peer dependency is gone, and `valibot` is a regular dependency, so there's nothing extra to install. The analysis output is unchanged: the same JSON, the same TypeScript types, the same defaults.

Three helpers are the stable way to validate output and restore the defaults the compact wire form omits, whatever schema library sits behind them: `parseAnalyzeResult` for a whole result, `parseModuleJson` for one module, and `parseDiagnostics` for an array of diagnostics.

To migrate:

- `AnalyzeResultJson.parse(x)` → `parseAnalyzeResult(x)`, `ModuleJson.parse(x)` → `parseModuleJson(x)`, and `z.array(Diagnostic).parse(x)` → `parseDiagnostics(x)`.
- Any other schema has no methods now, so call valibot's functions on it: `DeclarationJson.parse(x)` → `v.parse(DeclarationJson, x)`, `.safeParse(x)` → `v.safeParse(Schema, x)`, with `import * as v from 'valibot'` and `valibot` in your own dependencies.
- `AnalyzeResultJson` is a piped schema (an array guard, then the object), so it has no `.entries`; compose from `ModuleJson` and `Diagnostic` instead of picking from the envelope.
- `z.infer<typeof ModuleJson>` → the exported `ModuleJson` type (or `v.InferOutput<typeof ModuleJson>`), and `z.input<…>` → `v.InferInput<…>`. `ModuleJsonInput` and `AnalyzeResultJsonWire` are still exported.
- Composing a schema into your own (`z.array(ModuleJson)`, a field of a `z.object`) needs valibot on your side too, since the two libraries' schemas don't mix.
- If nothing else in your project uses zod, you can drop it.

Validation failures change shape. A parse helper throws valibot's `ValiError`, not a `ZodError`, so catch it as a plain `Error`, or check `instanceof v.ValiError` to read the structured `issues`. Its `message` lists every issue valibot reports, one per line, as `path: message`, with the dot path left out for an issue at the root value:

```
modules.0.declarations.0.typeInfo: Invalid key: Expected never but received "typeInfo"
modules.1.path: Invalid type: Expected string but received 1
```

An object with several unknown keys reports only the first of them, where zod named them all, so fixing one can surface the next. Calling `v.parse` yourself throws valibot's own message instead, which carries only the first issue's text. The per-issue wording is valibot's and differs from zod's, so don't match on it.
