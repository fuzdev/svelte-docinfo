/**
 * Maximum number of retries before giving up.
 * @default 3
 */
export const max_retries: number = computeRetryLimit();

declare function computeRetryLimit(): number;
