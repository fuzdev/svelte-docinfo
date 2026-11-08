---
'svelte-docinfo': minor
---

feat: replace valibot with `@fuzdev/fuz_schema` for the output schemas

**Breaking.** The exported schemas are now [fuz_schema](https://schema.fuz.dev/) schemas, and `@fuzdev/fuz_schema` replaces `valibot` as a regular dependency. Analysis output is unchanged: the same JSON, TypeScript types, and defaults. The parse helpers (`parseAnalyzeResult`, `parseModuleJson`, `parseDiagnostics`) are unchanged too, and stay the stable entry point.

To migrate code that uses a schema directly:

- `v.parse(Schema, x)` → `s.parse_or_throw(Schema, x)` and `v.safeParse(Schema, x)` → `s.parse(Schema, x)`, with `import * as s from '@fuzdev/fuz_schema/schema.js'`. Composing a schema into one of yours needs fuz_schema too.
- `Schema.entries` → `Schema.def`. `AnalyzeResultJson` is a plain object schema now (`s.object` refuses an array itself), so it has entries again.
- `AnalyzeResultJsonEntriesInput` is gone; use `AnalyzeResultJsonSchemaInput`.

A parse helper that fails throws fuz_schema's `SchemaError` in place of valibot's `ValiError`, with the structured list on `.issues`. Its `message` has one line per issue, as `path: expected X, received Y`, and every unknown key of an object is reported, not just the first:

```
modules.0.declarations.0.typeInfo: expected no unknown keys, received object
modules.1.path: expected string, received number
```

Parsing is copy-on-write: an object that needed no default comes back as the input itself, so don't mutate a parsed value you also hold as input. String maps (`mutates`, `propertyDescriptions`) accept any non-array object and check the value of a `__proto__` key before dropping it.
