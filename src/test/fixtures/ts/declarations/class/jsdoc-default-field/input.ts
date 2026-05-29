declare function compute_initial(): string;

export class Worker {
	/**
	 * Worker status.
	 * @default 'idle'
	 */
	status: string = compute_initial();
}
