import type { ComponentProps } from 'svelte';

import Other1 from './Other1.svelte';
import Other2 from './Other2.svelte';
import Other3 from './Other3.svelte';
import Other4 from './Other4.svelte';
import Other5 from './Other5.svelte';
import Legacy from './Legacy.svelte';
import Legacy2 from './Legacy2.svelte';

export type A = ComponentProps<typeof Other1>;

export const fn1 = (a: A) => a;

export const fn2 = (a: ComponentProps<typeof Other1>) => a;

export const a = Other1;

export type B = ComponentProps<typeof Other2>;

export const fn3 = (b: B) => b;

export type C = ComponentProps<typeof Other3>;

export const fn4 = (c: C) => c;

export const d = Other4;

export const fn5 = (d: ComponentProps<typeof Other4>) => d;

export type G = ComponentProps<typeof Other5>;

export const fn6 = (g: G) => g;

export const fn7 = (g: ComponentProps<typeof Other5>) => g;

export const fn8 = (d: Array<ComponentProps<typeof Other4>>) => d;

export const fn9 = (d: ReadonlyArray<ComponentProps<typeof Other4>>) => d;

export const fn10 = (d: [first: ComponentProps<typeof Other4>, second?: number]) => d;

export type LP = ComponentProps<Legacy>;

export const fn11 = (lp: LP) => lp;

export const fn12 = (lp: ComponentProps<Legacy>) => lp;

export type LP2 = ComponentProps<Legacy2>;

export const fn13 = (lp: LP2) => lp;

export const fn14 = (d: [ComponentProps<typeof Other4>?]) => d;

export type T4 = [ComponentProps<typeof Other4>];

export const fn15 = (t: T4) => t;

export type U4 = ComponentProps<typeof Other4> | undefined;

export const fn16 = (u: [U4?]) => u;
