import type { ComponentProps } from 'svelte';

import Other from './Other.svelte';

export const a = Other;

export type A = ComponentProps<typeof Other>;

export type B = A['a'];
