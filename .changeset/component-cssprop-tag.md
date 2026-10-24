---
'svelte-docinfo': minor
---

feat: document a component's CSS custom properties with `@cssprop`

- A `@cssprop --name - description` tag in a Svelte component's doc comment (the Custom Elements Manifest form; `@cssproperty` is a synonym) adds the property to `cssCustomProperties`, whether or not the fallback-read heuristic finds it, so bare reads (`width: var(--card_width)`) can be documented. An optional braced syntax (`@cssprop {<color>} --a`) lands as `syntax`, and an optional bracketed default (`@cssprop [--a=1px]`) as `fallback`, over the read's.
- `ComponentCssPropertyJson` gains `description`, `syntax`, and `documented` (`true` for a tagged entry; defaults to `false` and is stripped by `compactReplacer`). Documented entries come first, in tag order, then the heuristic's in first-read order. A tagged name the component reads, bare, nested in another read's fallback, set by itself, or in its markup's static style text (child components' `--x="var(--y)"` attributes included), merges with the read, taking its `sourceLine` and, without a tag default, its `fallback`. Since the heuristic also lists global tokens read with a fallback, consumers can show only the `documented` entries of a component that has any.
- The tags are read from whichever source wins `docComment` (in-script JSDoc above `$props()`, else the HTML `@component` comment); the losing source's are ignored. They never reach `docComment`.
- New `unknown_cssprop` warning (`propertyName`, `componentName`, `line` at the tag): a tagged name the component never reads. The entry stays. Not emitted when the style isn't read (`css_lang_unsupported`, `css_parse_failed`), where tagged entries are still listed.
- `@cssprop` in a module comment, or on an exported declaration other than a component, warns `misplaced_tag` with the new `tagName: 'cssprop'` (on a declaration, `functionName` names it) and is dropped.
- A component with no `<style>` but with `var(` text and a `@cssprop` tag is now parsed for its styling API, so its tags see the reads in its markup's style attributes.
