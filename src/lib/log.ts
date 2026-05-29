/**
 * Minimal logger interface threaded through analysis functions.
 *
 * Separate from `diagnostics.ts` because logging and diagnostics are not the
 * same concern: diagnostics are structured, schema-validated records of
 * analysis-time failures; logs are unstructured progress/info messages the
 * caller chooses how to display.
 *
 * @module
 */

/**
 * Minimal logger interface for analysis functions.
 *
 * Intentionally narrow so that both `@fuzdev/fuz_util`'s `Logger` class and
 * Vite's built-in logger satisfy it without adapters or casts.
 *
 * @example
 * ```ts
 * // Stderr logger for CLI usage
 * const log: AnalysisLog = {
 *   info: (msg) => console.error(msg),
 *   warn: (msg) => console.error(`warning: ${msg}`),
 *   error: (msg) => console.error(`error: ${msg}`),
 * };
 * ```
 */
export interface AnalysisLog {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}
