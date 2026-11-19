---
'svelte-docinfo': minor
---

feat: an object or function type literal whose checker printing loses a name the source wrote (a lost alias expanded, a computed type) is terminal text printed from the written literal, on one line with comments dropped and import renames resolved, at a site's root too: `selected_theme?: { theme: Theme }` reads `{kind: 'object', text: '{ theme: Theme; }'}` where it had no tree beside a flat string expanding `Theme`. A literal the checker prints with every written name keeps the checker's text.

feat: a written union's members and a written tuple's elements follow their own written types as an annotated site does (`keyof A | null` keeps `{kind: 'other', text: 'keyof A'}` where it read the keys; `Uuid | null` keeps `Uuid`; `ComponentProps<typeof X>` stays a reference in a tuple), and a tree whose members followed is kept even where its structure alone would leave it absent. An alias's right-hand side orders its union's members but isn't followed.
