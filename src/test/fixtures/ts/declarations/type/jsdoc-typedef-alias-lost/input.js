/**
 * @typedef {object} A
 * @property {{a: string}} b
 */

/**
 * An indexed-access right-hand side loses `aliasSymbol`.
 * @typedef {A['b']} B
 */

/** @typedef {B} C */

export {};
