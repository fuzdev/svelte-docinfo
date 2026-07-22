/**
 * Public entry point demonstrating the re-export forms svelte-docinfo tracks.
 * @module
 */

// same-name re-exports — recorded as `reExports` here
// and `alsoExportedFrom` on the canonical declarations
export { add, multiply, type MathConfig } from './math.js';
export { Counter } from './counter.svelte.js';
export { default as Calculator } from './Calculator.svelte';
export { default as Card } from './Card.svelte';

// renamed re-export — synthesizes an alias declaration with `aliasOf`
export { add_vector as vector_add } from './math.js';

// namespace re-export — synthesizes a `namespace` declaration projecting shapes.ts
export * as shapes from './shapes.js';

// direct external re-export — recorded on `externalReExports`, no declaration synthesized
export type { Snippet } from 'svelte';
