/**
 * Shared test constants to reduce duplication and improve consistency.
 */

/**
 * Common test paths used across test files.
 */
export const TEST_PATHS = {
	/** Standard test project root */
	PROJECT_ROOT: '/home/user/project',
	/** Default source directory */
	SRC_LIB: 'src/lib',
	/** Absolute path to a TypeScript file */
	ABSOLUTE_TS: '/home/user/project/src/lib/foo.ts',
	/** Absolute path to a Svelte file */
	ABSOLUTE_SVELTE: '/home/user/project/src/lib/Button.svelte',
	/** Nested path prefix for testing deep structures */
	NESTED: 'path/to',
	/** Nested absolute TypeScript path */
	NESTED_TS: '/home/user/project/src/lib/nested/bar.ts',
	/** Nested absolute Svelte path */
	NESTED_SVELTE: '/home/user/project/src/lib/nested/Button.svelte',
} as const;

/**
 * Common file names used in tests.
 */
export const TEST_FILES = {
	/** Generic TypeScript file */
	TS: 'foo.ts',
	/** Generic JS file */
	JS: 'utils.js',
	/** Generic Svelte component */
	SVELTE: 'Button.svelte',
	/** Generic test file */
	TEST: 'foo.test.ts',
	/** TypeScript declaration file */
	DTS: 'types.d.ts',
	/** CSS file */
	CSS: 'styles.css',
	/** JSON file */
	JSON: 'data.json',
} as const;

/**
 * Common module names for testing.
 */
export const TEST_MODULES = {
	MATH: 'math.ts',
	UTILS: 'utils.ts',
	HELPERS: 'helpers.ts',
	INDEX: 'index.ts',
	BUTTON: 'Button.svelte',
	CARD: 'Card.svelte',
} as const;
