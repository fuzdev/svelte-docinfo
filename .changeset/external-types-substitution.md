---
'svelte-docinfo': patch
---

fix: `externalTypes` substitutes written type arguments through the descent

Text collected past a generic declaration boundary can name that
declaration's own type parameters — `interface A<T> extends
HTMLAttributes<T>` reached via `Props extends A<HTMLDivElement>` puts
`HTMLAttributes<T>` in hand, `T` dangling at the documented site. The old
guard suppressed such text and degraded to the nearest enclosing well-formed
name (`A<HTMLDivElement>`) or to no entry at all — the hottest gap in a
corpus survey of published Svelte libraries, where generic base interfaces
and `Without<T, U>`-style local utilities bind the attribute bag to a type
parameter.

The descent now binds each declaration's type parameters to the reference's
written arguments and splices them into emitted text, so the entry is the
instantiated form the documented site actually composes:
`HTMLAttributes<HTMLDivElement>`, not the wrapper's name. Arguments render at
their own site first — outer substitutions and import renames applied — so
chained generics compose across boundaries; an omitted argument takes its
declared default, rendered under the bindings built so far. Substitution is
textual and identifier-scoped like the rename resolution it composes with,
so the written argument list and `&` / index-access shape survive. The old
degradation remains only as the backstop for a parameter with neither
argument nor default, which valid instantiations don't produce.
