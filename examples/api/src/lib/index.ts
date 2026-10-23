/**
 * Public entry point demonstrating the re-export forms svelte-docinfo tracks.
 * @module
 */

// same-name re-exports — recorded as `reExports` here
// and `alsoExportedFrom` on the canonical declarations
export { add, multiply, sumBy, type MathConfig } from './math.js';
export { Counter } from './counter.svelte.js';
export { default as Calculator } from './Calculator.svelte';
export { default as Card } from './Card.svelte';
export { default as List } from './List.svelte';

// renamed re-export — synthesizes an alias declaration with `aliasOf`
export { addVector as vectorAdd } from './math.js';

// namespace re-export — synthesizes a `namespace` declaration projecting shapes.ts
export * as shapes from './shapes.js';

// direct external re-export — recorded on `externalReExports`, no declaration synthesized
export type { Snippet } from 'svelte';
