/**
 * Path normalization chokepoint.
 *
 * Internal contract: every path stored, compared, or used as a Map/Set key
 * inside this library is in POSIX form (forward slashes). The library accepts
 * native paths (backslash on Windows, forward slash elsewhere) at every public
 * API boundary and at every `node:path` call site whose result flows into
 * storage or comparison.
 *
 * `toPosixPath` is the only normalization primitive — anything that needs to
 * convert a native path to the internal form goes through it. The function is
 * idempotent: forward-slash inputs round-trip unchanged, so calls outside
 * Windows are effectively a no-op.
 *
 * Drive-letter case (`C:` vs `c:`) and Windows long-path prefixes (`\\?\`) are
 * deliberately out of scope — they don't arise from the path sources this
 * library consumes (tsconfig roots, glob results, caller-supplied ids).
 *
 * @module
 */

/**
 * Normalize a path to POSIX form (forward slashes).
 *
 * Replaces every backslash with a forward slash. Idempotent: forward-slash
 * input returns unchanged. Empty string returns empty string.
 *
 * @example
 * ```ts
 * toPosixPath('C:\\proj\\src\\lib\\foo.ts') // => 'C:/proj/src/lib/foo.ts'
 * toPosixPath('/home/user/proj/foo.ts')     // => '/home/user/proj/foo.ts' (unchanged)
 * toPosixPath('')                            // => ''
 * ```
 */
export const toPosixPath = (p: string): string => (p.includes('\\') ? p.replace(/\\/g, '/') : p);
