#!/usr/bin/env node
/**
 * CLI entry point for svelte-docinfo.
 *
 * This file is the bin script entry point. The actual CLI implementation
 * is in `cli.ts` which exports `runCli()` for testing.
 *
 * @module
 */

import {runCli} from './cli.js';

try {
	const exitCode = await runCli();
	process.exit(exitCode);
} catch (error) {
	console.error('Fatal error:', error);
	process.exit(2);
}
