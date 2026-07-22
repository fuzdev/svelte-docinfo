import type { ExtractionData } from './extraction_state.svelte.ts';
import json from './extraction_data.json' with { type: 'json' };

// double cast: the JSON file's inferred literal type widens enum-like fields
// (e.g. `kind`) to `string`, which doesn't overlap the wire unions
export const extraction_data: ExtractionData = json as unknown as ExtractionData;
