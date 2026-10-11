---
'svelte-docinfo': patch
---

fix: root svelte2tsx's shims so component types resolve instead of `any`

The analysis program never loaded svelte2tsx's ambient declarations (`svelte-shims-v4.d.ts`), so the helpers every Svelte virtual calls didn't resolve and each component's default export typed as `any`. Anything typed through a component degraded with it, in `.svelte` and `.ts` modules alike: `ComponentProps<typeof Button>['variant']` documented as `any`, and so did `export const b = Button`. Programs with Svelte files now root the shims, resolved from svelte-docinfo's own svelte2tsx, and those types resolve: `"primary" | "secondary"`, and `Component<Props, {}, "">` for a component with a named props type. Props without a name of their own (an inline `$props()` annotation, or a JS component's JSDoc) print with svelte2tsx's generated name, `Component<$$ComponentProps, {}, "">`, and legacy components print as svelte2tsx's `__sveltets_2_IsomorphicComponent<…>`. Component props were already correct, since they're read from the `$props()` annotation. TS-only programs are unchanged.
