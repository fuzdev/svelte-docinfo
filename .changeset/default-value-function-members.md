---
'svelte-docinfo': minor
---

feat: `defaultValue` on function members and JSDoc/TSDoc tag spelling synonyms

- `FunctionMemberJson` gains optional `defaultValue`: `@default` on a member
  of any container kind now lands there — callable properties
  (`fn: () => void`), method shorthands (`fn(): void`), class methods —
  documenting the behavior used when the callback is omitted. Previously only
  variable-classified members carried the tag, so the same callable option
  documented or silently lost its default depending on spelling and
  container. Top-level function declarations, overloads, and constructors
  still never carry one; `@default` on a non-primary overload keeps its
  `misplaced_tag`. `applyToDeclaration` gains an optional `isMember`
  parameter gating the widened field. Consumers rendering `defaultValue`
  behind a `kind === 'variable'` check should widen it to function members.
- Divergent JSDoc/TSDoc spellings parse as synonyms everywhere the tags land
  (component props included): `@return` like `@returns`, and `@defaultValue`
  (TSDoc) / `@defaultvalue` (JSDoc) like `@default` — previously all three
  were silently ignored. The docs' tags page now describes the supported set
  as the common JSDoc/TSDoc doc tags instead of "a subset of TSDoc" (whose
  `@defaultValue` wasn't parsed while the JSDoc-only `@default` was).
