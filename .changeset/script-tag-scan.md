---
'svelte-docinfo': patch
---

fix: make script-tag scanning quote-aware and attribute-accurate

The original-source script scan (module comments, legacy-prop detection,
`extractScriptContent`/`extractModuleScriptContent`) now ports Svelte's own
preprocessor regex and decides by parsed attributes instead of
pattern-matching raw tag text:

- attribute values containing `>` (`generics="T extends () => void"`) no
  longer truncate the opening tag and mangle the extracted content
- module scripts are identified by attribute name (`module`, or
  `context="module"`), so the word `module` inside an attribute value no
  longer misclassifies the instance script or shadows a real
  `<script module>`
- commented-out scripts (`<!-- <script>… -->`) are skipped
- `</script >` is matched (Svelte's parser accepts it); self-closing
  `<script />` and capitalized `<Script>` component tags are not
- `lang` is read from script-tag attributes, not a whole-file text search, so
  `lang="ts"` appearing in markup no longer flips a JS component to TS parsing
  and silently discards its JSDoc prop types
- `lang` detection matches the Svelte compiler: the first script tag with a
  valued `lang` decides the file, and only `lang="ts"` counts —
  `lang="typescript"` is now treated as JS
