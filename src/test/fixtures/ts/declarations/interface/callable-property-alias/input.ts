/** A named function type. */
export type Handler = (event: string) => void;

/** A named generic function type. */
export type Mapper<T> = (value: T) => T;

/** A callable interface. */
export interface Runner {
	(task: string): Promise<void>;
}

export interface Hooks {
	/** Typed by a named function type: keeps `Handler`. */
	handler: Handler;
	/** Optional, generic: keeps `Mapper<number>`. */
	map?: Mapper<number>;
	/** Typed by a callable interface. */
	run: Runner;
	/** An inline function type: no tree. */
	inline: (event: string) => void;
	/** A method: no tree. */
	method(event: string): void;
}
