/**
 * Error-message normalization.
 *
 * `toErrorMessage` is the single primitive for coercing an unknown caught
 * value to a human-readable string — `value.message` for an `Error`, otherwise
 * a caller-supplied fallback or `String(value)`. Used wherever a `catch (err)`
 * binding (typed `unknown`) feeds a diagnostic message, log line, or error
 * field.
 *
 * @module
 */

/** Extract a human-readable message from an unknown thrown value. */
export const toErrorMessage = (value: unknown, fallback?: string): string =>
	value instanceof Error ? value.message : (fallback ?? String(value));
