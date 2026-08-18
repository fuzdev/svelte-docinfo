---
'svelte-docinfo': patch
---

fix: `{@link}` preserved in extracted text; `@throws` keeps braced types and multiline descriptions

Inline `{@link X}` no longer drops from `docComment` and tag-sourced
fields (TS renders `{@link A|b}` as `{@link A |b}`). `@throws {TypeError}`
bare and `@throws {RangeError} - x` now keep their types (unions
included) instead of losing them or vanishing, and descriptions no
longer truncate at the first newline.
