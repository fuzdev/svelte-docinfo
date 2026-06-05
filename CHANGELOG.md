# svelte-docinfo

## 0.4.1

### Patch Changes

- feat: add `AnalyzeResultJsonWire` for the vite plugin value ([#2](https://github.com/fuzdev/svelte-docinfo/pull/2))

## 0.4.0

### Minor Changes

- chore: fix peer deps ([0e39268](https://github.com/fuzdev/svelte-docinfo/commit/0e39268))

## 0.3.0

### Minor Changes

- fix: improve inferred type output for intersections and unions ([#1](https://github.com/fuzdev/svelte-docinfo/pull/1))

## 0.2.1

### Patch Changes

- fix: use `Object.create(null)` to avoid prototype issues ([7b79be8](https://github.com/fuzdev/svelte-docinfo/commit/7b79be8))

## 0.2.0

### Minor Changes

- feat: capture object-property `@param obj.prop` descriptions ([d52b3d3](https://github.com/fuzdev/svelte-docinfo/commit/d52b3d3))

### Patch Changes

- fix: ignore node builtins ([6848647](https://github.com/fuzdev/svelte-docinfo/commit/6848647))
- fix: accept dotted `@param obj.prop` keys in param validation ([6848647](https://github.com/fuzdev/svelte-docinfo/commit/6848647))

  `@param obj.prop` (documenting a property of an object/destructured parameter)
  no longer emits a spurious `unknown_param` warning when `obj` is a real
  parameter.

- fix: resolve without vite to avoid polluting its detection ([b82e4e4](https://github.com/fuzdev/svelte-docinfo/commit/b82e4e4))

## 0.1.0

### Minor Changes

- init ([7ededbf](https://github.com/fuzdev/svelte-docinfo/commit/7ededbf))
