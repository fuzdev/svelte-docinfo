---
'svelte-docinfo': minor
---

feat: document a Svelte component's styling API as `cssCustomProperties`

- `ComponentDeclarationJson.cssCustomProperties` lists the CSS custom properties a component's `<style>` reads through `var()` with a fallback (`var(--accent, blue)`) and doesn't set itself, the ones a consumer sets as `<Foo --accent="red" />` or on an ancestor. Each `ComponentCssPropertyJson` entry has the `name` as written, the `fallback`'s verbatim source text, and the `sourceLine` of the first read, one entry per name in first-read order. Only the outermost `var()` counts (`var(--a, var(--b))` lists `--a`, with `var(--b)` its fallback), reads in nested rules, at-rule blocks, `:global`, and keyframes included. A name drops out when the component declares it in its `<style>` (`--accent: …`) or sets it in its markup (`style:--accent`, `style="--accent: …"` on an element). Bare reads without a fallback, mostly global design tokens, aren't listed. The field defaults to `[]` and is stripped by `compactReplacer`; a renamed component re-export carries its canonical's.
- New `css_lang_unsupported` warning: a `<style>` whose `lang` or `type` names a preprocessor language (`scss`, `postcss`, `text/less`) isn't read.
- New `css_parse_failed` warning: when Svelte's parser rejects a component with a `<style>` (malformed CSS, two top-level styles), the component still emits, without the field.
- The `svelte` peer floor is unchanged: the styling API reads through `parse(…, {modern: true, loose: true})`, whose modern AST (`ast.css`) Svelte has had since 5.0. Before 5.13, which added `loose`, a template error also warns `css_parse_failed`.
