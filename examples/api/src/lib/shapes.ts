/**
 * Geometric shapes demonstrating classes, interfaces, enums, function
 * overloads, const assertions, and richer JSDoc tags.
 * @module
 */

/** Supported shape categories. */
export enum ShapeKind {
	Circle = 'circle',
	Rectangle = 'rectangle',
}

/** Cardinal directions as a const enum (inlined at use sites). */
export const enum Direction {
	North,
	East,
	South,
	West,
}

/** Anything with a computable area. */
export interface HasArea {
	/** Area in square units. */
	readonly area: number;
}

/** Options for drawing a shape outline. */
export interface DrawOptions {
	/**
	 * Stroke color as a CSS color string.
	 * @default 'black'
	 */
	stroke?: string;
	/** Line width in pixels. */
	width?: number;
}

/**
 * An axis-aligned rectangle.
 * @since 0.6.0
 * @see `shape_area`
 */
export class Rectangle implements HasArea {
	/** Shared kind tag for all rectangles. */
	static readonly kind = ShapeKind.Rectangle;

	/** Width in units. */
	width: number;
	/** Height in units. */
	height: number;

	// private state is excluded from extraction
	#draw_count = 0;

	/**
	 * @param width - initial width
	 * @param height - initial height
	 * @throws `RangeError` when either dimension is negative
	 */
	constructor(width: number, height: number) {
		if (width < 0 || height < 0) throw new RangeError('dimensions must be non-negative');
		this.width = width;
		this.height = height;
	}

	/** Area in square units. */
	get area(): number {
		return this.width * this.height;
	}

	/** Longest side; setting it makes the rectangle a square. */
	get size(): number {
		return Math.max(this.width, this.height);
	}
	set size(value: number) {
		this.width = value;
		this.height = value;
	}

	/**
	 * Scale both dimensions in place.
	 * @param factor - multiplier applied to width and height
	 * @mutates `this`
	 */
	scale(factor: number): void {
		this.width *= factor;
		this.height *= factor;
	}

	/** Number of times this rectangle has been drawn, for subclasses. */
	protected count_draw(): number {
		return ++this.#draw_count;
	}
}

/**
 * Compute the area of a shape.
 * @param shape - the shape to measure
 * @returns the shape's area
 * @example
 * ```ts
 * shape_area(new Rectangle(2, 3)) // 6
 * shape_area(1) // Math.PI
 * ```
 */
export function shape_area(shape: HasArea): number;
/**
 * Compute the area of a circle from its radius.
 * @param radius - circle radius in units
 * @returns the circle's area
 */
export function shape_area(radius: number): number;
export function shape_area(shape_or_radius: HasArea | number): number {
	return typeof shape_or_radius === 'number'
		? Math.PI * shape_or_radius ** 2
		: shape_or_radius.area;
}

/**
 * Describe a shape for display.
 * @param shape - the shape to describe
 * @param options - formatting options
 * @param options.precision - decimal places for the area
 * @param options.label - prefix for the description
 * @returns a human-readable description
 */
export const describe_shape = (
	shape: HasArea,
	options: {precision?: number; label?: string} = {},
): string => `${options.label ?? 'shape'}: area ${shape.area.toFixed(options.precision ?? 2)}`;

/** Unit square corners as a readonly tuple (const assertion). */
export const UNIT_SQUARE = [
	{x: 0, y: 0},
	{x: 1, y: 0},
	{x: 1, y: 1},
	{x: 0, y: 1},
] as const;
