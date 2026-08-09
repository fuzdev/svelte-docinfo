/** Options with defaulted callbacks. */
export interface RetryOptions {
	/**
	 * Called before each retry attempt.
	 *
	 * @default noop
	 */
	onRetry: (attempt: number) => void;
	/**
	 * Computes the backoff delay.
	 *
	 * @defaultValue exponential backoff starting at 100ms
	 */
	computeDelay?(attempt: number): number;
	/**
	 * Maximum number of attempts.
	 *
	 * @default 3
	 */
	maxAttempts?: number;
}
