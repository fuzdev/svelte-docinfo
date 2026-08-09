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
 * Windows are effectively a no-op. `isAbsolutePosixPath` is its companion
 * predicate, for the places that have to branch on whether a path in the
 * internal form is absolute; `node:path`'s `isAbsolute` can't answer that,
 * being flavored by the host rather than by the form.
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

/**
 * Whether a POSIX-form path is absolute — rooted (`/src/x.ts`) or drive-qualified
 * (`C:/proj/x.ts`).
 *
 * Not `node:path`'s `isAbsolute`, which is platform-flavored: on Linux it reads
 * a posixified Windows path like `C:/proj/x.ts` as relative. Everything here is
 * already in the internal POSIX form by contract, so the check has to cover both
 * shapes regardless of host.
 *
 * @example
 * ```ts
 * isAbsolutePosixPath('/home/user/proj/foo.ts') // => true
 * isAbsolutePosixPath('C:/proj/foo.ts')         // => true
 * isAbsolutePosixPath('src/lib/foo.ts')         // => false
 * isAbsolutePosixPath('../sibling/foo.ts')      // => false
 * ```
 */
export const isAbsolutePosixPath = (p: string): boolean =>
	p.startsWith('/') || /^[A-Za-z]:\//.test(p);
