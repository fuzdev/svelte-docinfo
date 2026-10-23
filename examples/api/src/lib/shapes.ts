/**
 * Geometric shapes demonstrating classes, interfaces, enums, a union type
 * alias, function overloads, const assertions, and richer JSDoc tags
 * (`@deprecated` among them).
 * @module
 */

/** Supported shape categories. */
export enum ShapeKind {
	Circle = 'circle',
	Rectangle = 'rectangle'
}

/** Cardinal directions as a const enum (inlined at use sites). */
export const enum Direction {
	North,
	East,
	South,
	West
}

/** Anything with a computable area. */
export interface HasArea {
	/** Area in square units. */
	readonly area: number;
}

/** What `shapeArea` measures: a shape, or a circle's radius. */
export type ShapeInput = HasArea | number;

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
 * @see `shapeArea`
 */
export class Rectangle implements HasArea {
	/** Shared kind tag for all rectangles. */
	static readonly kind = ShapeKind.Rectangle;

	/** Width in units. */
	width: number;
	/** Height in units. */
	height: number;

	// private state is excluded from extraction
	#drawCount = 0;

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
	protected countDraw(): number {
		return ++this.#drawCount;
	}
}

/**
 * Compute the area of a shape.
 * @param shape - the shape to measure
 * @returns the shape's area
 * @example
 * ```ts
 * shapeArea(new Rectangle(2, 3)) // 6
 * shapeArea(1) // Math.PI
 * ```
 */
export function shapeArea(shape: HasArea): number;
/**
 * Compute the area of a circle from its radius.
 * @param radius - circle radius in units
 * @returns the circle's area
 */
export function shapeArea(radius: number): number;
export function shapeArea(shapeOrRadius: ShapeInput): number {
	return typeof shapeOrRadius === 'number'
		? Math.PI * shapeOrRadius ** 2
		: shapeOrRadius.area;
}

/**
 * Describe a shape for display.
 * @param shape - the shape to describe
 * @param options - formatting options
 * @param options.precision - decimal places for the area
 * @param options.label - prefix for the description
 * @returns a human-readable description
 */
export function describeShape(
	shape: HasArea,
	options: { precision?: number; label?: string } = {}
): string {
	return `${options.label ?? 'shape'}: area ${shape.area.toFixed(options.precision ?? 2)}`;
}

/**
 * Compute a rectangle's area from its dimensions.
 * @param width - rectangle width
 * @param height - rectangle height
 * @returns the area
 * @deprecated use `shapeArea(new Rectangle(width, height))`
 */
export function rectangleArea(width: number, height: number): number {
	return width * height;
}

/** Unit square corners as a readonly tuple (const assertion). */
export const UNIT_SQUARE = [
	{ x: 0, y: 0 },
	{ x: 1, y: 0 },
	{ x: 1, y: 1 },
	{ x: 0, y: 1 }
] as const;
