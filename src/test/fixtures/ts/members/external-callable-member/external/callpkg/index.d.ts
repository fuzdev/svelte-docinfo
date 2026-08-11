/**
 * External overloaded function whose docs must never reach output.
 *
 * @param cmd - The command.
 * @param args - Argument list.
 * @since 1.0.0
 */
export declare function spawnish(cmd: string, args: Array<string>): number;
/**
 * Tag bait: on a harvested non-primary overload, `@since` would emit
 * `misplaced_tag` and the stale `@param` an `unknown_param`.
 *
 * @param arglist - names no parameter
 * @since 2.0.0
 */
export declare function spawnish(cmd: string): number;
