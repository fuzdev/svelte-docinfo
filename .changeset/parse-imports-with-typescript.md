---
'svelte-docinfo': patch
---

fix: find dependency edges with a syntax-only TypeScript parse instead of es-module-lexer

The JS lexer misread some TypeScript syntax (a non-null assertion before a division, `a! / b`, or nested generics closing before an arrow, `Promise<Result<A, B>> => {}`) and threw, so the file got an `import_parse_failed` warning and lost all its dependency edges. The parse handles all TypeScript syntax. Edges also now include type-only re-exports (`export type {...} from`, `export type * from`), `import x = require()`, module augmentations, and `import('…')` types, which the lexer dropped. `es-module-lexer` is no longer a dependency.
