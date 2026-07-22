/**
 * CLI-specific test helpers for subprocess execution and console capture.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { runCli } from '$lib/cli.ts';

/**
 * Result of capturing console output.
 */
export interface ConsoleCaptureResult {
	/** Captured output lines. */
	lines: Array<string>;
	/** Restore the original console method. */
	restore: () => void;
}

/**
 * Capture console.log output during test execution.
 *
 * Returns an object with captured lines and a restore function.
 * Always call restore() when done, typically in a finally block.
 *
 * @example
 * ```ts
 * const capture = captureConsoleLog();
 * try {
 *   console.log('hello', 'world');
 *   assert.ok(capture.lines.some(l => l.includes('hello')));
 * } finally {
 *   capture.restore();
 * }
 * ```
 */
export const captureConsoleLog = (): ConsoleCaptureResult => {
	const lines: Array<string> = [];
	const original = console.log;
	console.log = (...args: Array<unknown>) => lines.push(args.join(' '));
	return {
		lines,
		restore: () => {
			console.log = original;
		}
	};
};

/**
 * Capture console.error output during test execution.
 */
export const captureConsoleError = (): ConsoleCaptureResult => {
	const lines: Array<string> = [];
	const original = console.error;
	console.error = (...args: Array<unknown>) => lines.push(args.join(' '));
	return {
		lines,
		restore: () => {
			console.error = original;
		}
	};
};

/**
 * Capture both console.log and console.error output.
 */
export const captureConsole = (): {
	logs: Array<string>;
	errors: Array<string>;
	restore: () => void;
} => {
	const logCapture = captureConsoleLog();
	const errorCapture = captureConsoleError();
	return {
		logs: logCapture.lines,
		errors: errorCapture.lines,
		restore: () => {
			logCapture.restore();
			errorCapture.restore();
		}
	};
};

/**
 * Result of running a subprocess.
 */
export interface SubprocessResult {
	/** Exit code (null if process was killed). */
	code: number | null;
	/** Captured stdout. */
	stdout: string;
	/** Captured stderr. */
	stderr: string;
}

/** Options accepted by the subprocess helpers. */
export interface RunSubprocessOptions {
	/** Working directory for the spawned process. */
	cwd?: string;
}

/**
 * Spawn a command and capture stdout/stderr/exit code.
 *
 * @param command - executable name (resolved via PATH)
 * @param args - arguments to pass
 * @param options - optional cwd
 */
export const runSubprocess = (
	command: string,
	args: Array<string> = [],
	options: RunSubprocessOptions = {}
): Promise<SubprocessResult> =>
	new Promise((resolve) => {
		const proc = spawn(command, args, { shell: false, cwd: options.cwd });
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
		proc.on('close', (code) => resolve({ code, stdout, stderr }));
	});

/**
 * Run a Node.js script as a subprocess and capture output.
 *
 * Useful for testing CLI tools that may call process.exit().
 *
 * @param scriptPath - Absolute path to the script to run
 * @param args - Arguments to pass to the script
 * @param options - optional cwd
 */
export const runNodeSubprocess = (
	scriptPath: string,
	args: Array<string> = [],
	options: RunSubprocessOptions = {}
): Promise<SubprocessResult> => runSubprocess('node', [scriptPath, ...args], options);

/**
 * Result of running the CLI with captured console output.
 */
export interface CliCaptureResult {
	/** CLI exit code. */
	exitCode: number;
	/** Lines captured from stdout (console.log). */
	stdout: Array<string>;
	/** Lines captured from stderr (console.error). */
	stderr: Array<string>;
}

/**
 * Run the CLI and capture stdout/stderr, handling console capture/restore automatically.
 *
 * Eliminates the try/finally boilerplate that appears in every CLI test.
 *
 * @param argv - full argv array (e.g., `['node', 'svelte-docinfo', projectRoot, '--quiet']`)
 */
export const runCliCapture = async (argv: Array<string>): Promise<CliCaptureResult> => {
	const capture = captureConsole();
	try {
		const exitCode = await runCli(argv);
		return {
			exitCode,
			stdout: [...capture.logs],
			stderr: [...capture.errors]
		};
	} finally {
		capture.restore();
	}
};

/** Project root directory (two levels up from src/test/). */
export const PROJECT_ROOT = join(import.meta.dirname, '../..');

/** Directory containing API examples. */
export const EXAMPLES_API_DIR = join(PROJECT_ROOT, 'examples/api');

/** Directory containing CLI examples. */
export const EXAMPLES_CLI_DIR = join(PROJECT_ROOT, 'examples/cli');

/** Directory containing Vite plugin examples. */
export const EXAMPLES_VITE_DIR = join(PROJECT_ROOT, 'examples/vite');
