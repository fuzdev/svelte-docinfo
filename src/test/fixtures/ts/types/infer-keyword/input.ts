/**
 * Infer keyword in conditional types.
 */
export type A<T> = T extends Array<infer U> ? U : never;
