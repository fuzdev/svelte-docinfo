import"../chunks/DsnmJJEf.js";import{p as w,f as y,ac as k,b as l,c as _,d,s as h,r as n,t as A,h as a}from"../chunks/CuIJZvP6.js";import{s as D}from"../chunks/aDa_vl4T.js";import{e as L}from"../chunks/DlWAAAyr.js";import{c as R,a as b}from"../chunks/BbzADbVz.js";import{r as M}from"../chunks/SFcNGXOr.js";import{B as V}from"../chunks/jnvJ70hW.js";import{e as $,E}from"../chunks/Bzwuv-MF.js";const T=JSON.parse('[{"path":"Calculator.svelte","declarations":[{"name":"Calculator","kind":"component","docComment":"Calculator component for demonstrating Svelte analysis.","sourceLine":6,"props":[{"name":"result","type":"number","optional":true,"description":"Current result (bindable).","defaultValue":"0","bindable":true},{"name":"config","type":"MathConfig","optional":true,"description":"Math configuration."},{"name":"mode","type":"\\"add\\" | \\"multiply\\"","optional":true,"description":"Operation mode.","defaultValue":"\'add\'"},{"name":"disabled","type":"boolean","optional":true,"description":"Disable the calculator.","defaultValue":"false"}]}],"dependencies":["math.ts"],"dependents":["index.ts"]},{"path":"Card.svelte","declarations":[{"name":"Card","kind":"component","docComment":"Card layout demonstrating `children` and snippet props —\\n`acceptsChildren` and structured snippet parameters in the output.","sourceLine":7,"props":[{"name":"title","type":"string","optional":true,"description":"Title rendered when no `header` snippet is provided."},{"name":"header","type":"Snippet<[title: string]>","optional":true,"description":"Custom header content, receives the resolved title.","parameters":[{"name":"title","type":"string"}]},{"name":"children","type":"Snippet<[]>","description":"Card body content."}],"acceptsChildren":true}],"dependents":["index.ts"]},{"path":"counter.svelte.ts","declarations":[{"name":"Counter","kind":"class","docComment":"A reactive counter built on Svelte 5 runes.","sourceLine":9,"alsoExportedFrom":["index.ts"],"members":[{"name":"count","kind":"variable","docComment":"Current count.","typeSignature":"number","reactivity":"$state"},{"name":"history","kind":"variable","docComment":"Past counts; replaced wholesale on change, so raw state.","typeSignature":"ReadonlyArray<number>","reactivity":"$state.raw"},{"name":"doubled","kind":"variable","docComment":"Double the current count.","typeSignature":"number","reactivity":"$derived"},{"name":"label","kind":"variable","docComment":"Display label computed from several fields.","typeSignature":"string","reactivity":"$derived.by"},{"name":"increment","kind":"function","docComment":"Increment the count, recording the previous value.","typeSignature":"(amount?: number): void","parameters":[{"name":"amount","type":"number","description":"how much to add","defaultValue":"1"}],"returnType":"void"}]}],"moduleComment":"A reactive counter demonstrating Svelte 5 rune detection in plain\\n`.svelte.ts` modules — `$state`, `$state.raw`, `$derived`, and\\n`$derived.by` initializers surface on the `reactivity` field.","dependents":["index.ts"]},{"path":"has-issues.ts","declarations":[{"name":"demonstrate_typo","kind":"function","docComment":"Demonstrates a documentation mistake the analyzer catches.","typeSignature":"(value: number): number","sourceLine":15,"parameters":[{"name":"value","type":"number"}],"returnType":"number","returnDescription":"the input doubled"}],"moduleComment":"This file exists to exercise the `analyze-diagnostics.js` example —\\nthe `@param` below intentionally names a parameter that doesn\'t exist,\\nso the analyzer emits an `unknown_param` warning. Real code shouldn\'t\\nhave this issue, but documentation slips happen, and the `diagnostics`\\nfield lets consumers surface them without halting analysis."},{"path":"index.ts","declarations":[{"name":"Calculator","kind":"component","sourceLine":10,"aliasOf":{"module":"Calculator.svelte","name":"Calculator"},"props":[{"name":"result","type":"number","optional":true,"description":"Current result (bindable).","defaultValue":"0","bindable":true},{"name":"config","type":"MathConfig","optional":true,"description":"Math configuration."},{"name":"mode","type":"\\"add\\" | \\"multiply\\"","optional":true,"description":"Operation mode.","defaultValue":"\'add\'"},{"name":"disabled","type":"boolean","optional":true,"description":"Disable the calculator.","defaultValue":"false"}],"docComment":"Calculator component for demonstrating Svelte analysis."},{"name":"Card","kind":"component","sourceLine":11,"aliasOf":{"module":"Card.svelte","name":"Card"},"props":[{"name":"title","type":"string","optional":true,"description":"Title rendered when no `header` snippet is provided."},{"name":"header","type":"Snippet<[title: string]>","optional":true,"description":"Custom header content, receives the resolved title.","parameters":[{"name":"title","type":"string"}]},{"name":"children","type":"Snippet<[]>","description":"Card body content."}],"acceptsChildren":true,"docComment":"Card layout demonstrating `children` and snippet props —\\n`acceptsChildren` and structured snippet parameters in the output."},{"name":"vector_add","kind":"function","docComment":"Add vectors in place.","typeSignature":"(target: Vector2, source: Vector2): void","sourceLine":14,"mutates":{"target":"modifies x and y fields"},"aliasOf":{"module":"math.ts","name":"add_vector"},"parameters":[{"name":"target","type":"Vector2","description":"vector to mutate"},{"name":"source","type":"Vector2","description":"vector to add"}],"returnType":"void"},{"name":"shapes","kind":"namespace","sourceLine":17,"module":"shapes.ts"}],"moduleComment":"Public entry point demonstrating the re-export forms svelte-docinfo tracks.","dependencies":["Calculator.svelte","Card.svelte","counter.svelte.ts","math.ts","shapes.ts"],"reExports":[{"name":"add","module":"math.ts","sourceLine":8},{"name":"Counter","module":"counter.svelte.ts","sourceLine":9},{"name":"MathConfig","module":"math.ts","typeOnly":true,"sourceLine":8},{"name":"multiply","module":"math.ts","sourceLine":8}],"externalReExports":[{"name":"Snippet","specifier":"svelte","typeOnly":true,"sourceLine":20}]},{"path":"math.ts","declarations":[{"name":"add","kind":"function","docComment":"Add two numbers.","typeSignature":"(a: number, b: number): number","sourceLine":16,"examples":["```ts\\nadd(2, 3) // 5\\n```"],"alsoExportedFrom":["index.ts"],"parameters":[{"name":"a","type":"number","description":"first number"},{"name":"b","type":"number","description":"second number"}],"returnType":"number","returnDescription":"the sum"},{"name":"multiply","kind":"function","docComment":"Multiply two numbers.","typeSignature":"(a: number, b: number): number","sourceLine":24,"alsoExportedFrom":["index.ts"],"parameters":[{"name":"a","type":"number","description":"first number"},{"name":"b","type":"number","description":"second number"}],"returnType":"number","returnDescription":"the product"},{"name":"MathConfig","kind":"interface","docComment":"Configuration for math operations.","typeSignature":"MathConfig","sourceLine":27,"alsoExportedFrom":["index.ts"],"members":[{"name":"precision","kind":"variable","docComment":"Decimal precision.","typeSignature":"number"},{"name":"round","kind":"variable","docComment":"Round results?","typeSignature":"boolean"}]},{"name":"Vector2","kind":"interface","docComment":"A 2D vector.","typeSignature":"Vector2","sourceLine":35,"members":[{"name":"x","kind":"variable","typeSignature":"number"},{"name":"y","kind":"variable","typeSignature":"number"}]},{"name":"add_vector","kind":"function","docComment":"Add vectors in place.","typeSignature":"(target: Vector2, source: Vector2): void","sourceLine":46,"mutates":{"target":"modifies x and y fields"},"parameters":[{"name":"target","type":"Vector2","description":"vector to mutate"},{"name":"source","type":"Vector2","description":"vector to add"}],"returnType":"void"}],"moduleComment":"Math utilities for demonstrating svelte-docinfo analysis.","dependents":["Calculator.svelte","index.ts"]},{"path":"shapes.ts","declarations":[{"name":"shape_area","kind":"function","docComment":"Compute the area of a shape.","typeSignature":"(shape: HasArea): number","sourceLine":106,"examples":["```ts\\nshape_area(new Rectangle(2, 3)) // 6\\nshape_area(1) // Math.PI\\n```"],"parameters":[{"name":"shape","type":"HasArea","description":"the shape to measure"}],"overloads":[{"typeSignature":"(shape: HasArea): number","parameters":[{"name":"shape","type":"HasArea","description":"the shape to measure"}],"returnType":"number","docComment":"Compute the area of a shape.","returnDescription":"the shape\'s area"},{"typeSignature":"(radius: number): number","parameters":[{"name":"radius","type":"number","description":"circle radius in units"}],"returnType":"number","docComment":"Compute the area of a circle from its radius.","returnDescription":"the circle\'s area"}],"returnType":"number","returnDescription":"the shape\'s area"},{"name":"ShapeKind","kind":"enum","docComment":"Supported shape categories.","typeSignature":"ShapeKind","sourceLine":8,"members":[{"name":"Circle","kind":"variable","typeSignature":"ShapeKind.Circle"},{"name":"Rectangle","kind":"variable","typeSignature":"ShapeKind.Rectangle"}]},{"name":"Direction","kind":"enum","docComment":"Cardinal directions as a const enum (inlined at use sites).","typeSignature":"Direction","sourceLine":14,"members":[{"name":"North","kind":"variable","typeSignature":"Direction.North"},{"name":"East","kind":"variable","typeSignature":"Direction.East"},{"name":"South","kind":"variable","typeSignature":"Direction.South"},{"name":"West","kind":"variable","typeSignature":"Direction.West"}]},{"name":"HasArea","kind":"interface","docComment":"Anything with a computable area.","typeSignature":"HasArea","sourceLine":22,"members":[{"name":"area","kind":"variable","docComment":"Area in square units.","typeSignature":"number","modifiers":["readonly"]}]},{"name":"DrawOptions","kind":"interface","docComment":"Options for drawing a shape outline.","typeSignature":"DrawOptions","sourceLine":28,"members":[{"name":"stroke","kind":"variable","docComment":"Stroke color as a CSS color string.","typeSignature":"string","optional":true,"defaultValue":"\'black\'"},{"name":"width","kind":"variable","docComment":"Line width in pixels.","typeSignature":"number","optional":true}]},{"name":"Rectangle","kind":"class","docComment":"An axis-aligned rectangle.","sourceLine":43,"seeAlso":["`shape_area`"],"since":"0.6.0","implements":["HasArea"],"members":[{"name":"kind","kind":"variable","docComment":"Shared kind tag for all rectangles.","typeSignature":"ShapeKind.Rectangle","modifiers":["static","readonly"]},{"name":"width","kind":"variable","docComment":"Width in units.","typeSignature":"number"},{"name":"height","kind":"variable","docComment":"Height in units.","typeSignature":"number"},{"name":"constructor","kind":"constructor","typeSignature":"(width: number, height: number): Rectangle","throws":[{"description":"`RangeError` when either dimension is negative"}],"parameters":[{"name":"width","type":"number","description":"initial width"},{"name":"height","type":"number","description":"initial height"}]},{"name":"scale","kind":"function","docComment":"Scale both dimensions in place.","typeSignature":"(factor: number): void","parameters":[{"name":"factor","type":"number","description":"multiplier applied to width and height"}],"returnType":"void"},{"name":"count_draw","kind":"function","docComment":"Number of times this rectangle has been drawn, for subclasses.","typeSignature":"(): number","modifiers":["protected"],"returnType":"number"},{"name":"area","kind":"variable","docComment":"Area in square units.","typeSignature":"number","modifiers":["getter"]},{"name":"size","kind":"variable","docComment":"Longest side; setting it makes the rectangle a square.","typeSignature":"number","modifiers":["getter","setter"]}]},{"name":"describe_shape","kind":"function","docComment":"Describe a shape for display.","typeSignature":"(shape: HasArea, options?: { precision?: number | undefined; label?: string | undefined; }): string","sourceLine":127,"parameters":[{"name":"shape","type":"HasArea","description":"the shape to describe"},{"name":"options","type":"{ precision?: number | undefined; label?: string | undefined; }","description":"formatting options","defaultValue":"{}","propertyDescriptions":{"precision":"decimal places for the area","label":"prefix for the description"}}],"returnType":"string","returnDescription":"a human-readable description"},{"name":"UNIT_SQUARE","kind":"variable","docComment":"Unit square corners as a readonly tuple (const assertion).","typeSignature":"readonly [{ readonly x: 0; readonly y: 0; }, { readonly x: 1; readonly y: 0; }, { readonly x: 1; readonly y: 1; }, { readonly x: 0; readonly y: 1; }]","sourceLine":133}],"moduleComment":"Geometric shapes demonstrating classes, interfaces, enums, function\\noverloads, const assertions, and richer JSDoc tags.","dependents":["index.ts"]}]'),H={"Calculator.svelte":`<!--
	@component
	Calculator component for demonstrating Svelte analysis.
-->

<script lang="ts">
	import {add, multiply, type MathConfig} from './math.js';

	let {
		result = $bindable(0),
		config,
		mode = 'add',
		disabled = false,
	}: {
		/** Current result (bindable). */
		result?: number;
		/** Math configuration. */
		config?: MathConfig;
		/** Operation mode. */
		mode?: 'add' | 'multiply';
		/** Disable the calculator. */
		disabled?: boolean;
	} = $props();

	let input_value = $state(0);

	const calculate = () => {
		if (disabled) return;
		const op = mode === 'add' ? add : multiply;
		let value = op(result, input_value);
		if (config?.round) {
			const factor = 10 ** config.precision;
			value = Math.round(value * factor) / factor;
		}
		result = value;
	};
<\/script>

<div class="calculator">
	<output>{result}</output>
	<input type="number" bind:value={input_value} {disabled} />
	<button onclick={calculate} {disabled}>
		{mode === 'add' ? 'Add' : 'Multiply'}
	</button>
</div>

<style>
	.calculator {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	output {
		font-size: 2rem;
		font-weight: bold;
	}
</style>
`,"Card.svelte":`<!--
	@component
	Card layout demonstrating \`children\` and snippet props —
	\`acceptsChildren\` and structured snippet parameters in the output.
-->

<script lang="ts">
	import type {Snippet} from 'svelte';

	let {
		title,
		header,
		children,
	}: {
		/** Title rendered when no \`header\` snippet is provided. */
		title?: string;
		/** Custom header content, receives the resolved title. */
		header?: Snippet<[title: string]>;
		/** Card body content. */
		children: Snippet;
	} = $props();
<\/script>

<div class="card">
	<div class="card-header">
		{#if header}
			{@render header(title ?? 'untitled')}
		{:else}
			<h3>{title ?? 'untitled'}</h3>
		{/if}
	</div>
	<div class="card-body">
		{@render children()}
	</div>
</div>

<style>
	.card {
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	.card-header {
		padding: 0.5rem 1rem;
		border-bottom: 1px solid #ccc;
	}
	.card-header h3 {
		margin: 0;
	}
	.card-body {
		padding: 1rem;
	}
</style>
`,"counter.svelte.ts":`/**
 * A reactive counter demonstrating Svelte 5 rune detection in plain
 * \`.svelte.ts\` modules — \`$state\`, \`$state.raw\`, \`$derived\`, and
 * \`$derived.by\` initializers surface on the \`reactivity\` field.
 * @module
 */

/** A reactive counter built on Svelte 5 runes. */
export class Counter {
	/** Current count. */
	count: number = $state(0);
	/** Past counts; replaced wholesale on change, so raw state. */
	history: ReadonlyArray<number> = $state.raw([]);
	/** Double the current count. */
	doubled: number = $derived(this.count * 2);
	/** Display label computed from several fields. */
	label: string = $derived.by(() => \`count: \${this.count} (doubled: \${this.doubled})\`);

	/**
	 * Increment the count, recording the previous value.
	 * @param amount - how much to add
	 * @mutates \`this\`
	 */
	increment(amount: number = 1): void {
		this.history = [...this.history, this.count];
		this.count += amount;
	}
}
`,"has-issues.ts":`/**
 * This file exists to exercise the \`analyze-diagnostics.js\` example —
 * the \`@param\` below intentionally names a parameter that doesn't exist,
 * so the analyzer emits an \`unknown_param\` warning. Real code shouldn't
 * have this issue, but documentation slips happen, and the \`diagnostics\`
 * field lets consumers surface them without halting analysis.
 * @module
 */

/**
 * Demonstrates a documentation mistake the analyzer catches.
 * @param missing - this name doesn't match any real parameter
 * @returns the input doubled
 */
export const demonstrate_typo = (value: number): number => value * 2;
`,"index.ts":`/**
 * Public entry point demonstrating the re-export forms svelte-docinfo tracks.
 * @module
 */

// same-name re-exports — recorded as \`reExports\` here
// and \`alsoExportedFrom\` on the canonical declarations
export {add, multiply, type MathConfig} from './math.js';
export {Counter} from './counter.svelte.js';
export {default as Calculator} from './Calculator.svelte';
export {default as Card} from './Card.svelte';

// renamed re-export — synthesizes an alias declaration with \`aliasOf\`
export {add_vector as vector_add} from './math.js';

// namespace re-export — synthesizes a \`namespace\` declaration projecting shapes.ts
export * as shapes from './shapes.js';

// direct external re-export — recorded on \`externalReExports\`, no declaration synthesized
export type {Snippet} from 'svelte';
`,"math.ts":`/**
 * Math utilities for demonstrating svelte-docinfo analysis.
 * @module
 */

/**
 * Add two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the sum
 * @example
 * \`\`\`ts
 * add(2, 3) // 5
 * \`\`\`
 */
export const add = (a: number, b: number): number => a + b;

/**
 * Multiply two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the product
 */
export const multiply = (a: number, b: number): number => a * b;

/** Configuration for math operations. */
export interface MathConfig {
	/** Decimal precision. */
	precision: number;
	/** Round results? */
	round: boolean;
}

/** A 2D vector. */
export interface Vector2 {
	x: number;
	y: number;
}

/**
 * Add vectors in place.
 * @param target - vector to mutate
 * @param source - vector to add
 * @mutates target - modifies x and y fields
 */
export const add_vector = (target: Vector2, source: Vector2): void => {
	target.x += source.x;
	target.y += source.y;
};
`,"shapes.ts":`/**
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
 * @see \`shape_area\`
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
	 * @throws \`RangeError\` when either dimension is negative
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
	 * @mutates \`this\`
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
 * \`\`\`ts
 * shape_area(new Rectangle(2, 3)) // 6
 * shape_area(1) // Math.PI
 * \`\`\`
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
): string => \`\${options.label ?? 'shape'}: area \${shape.area.toFixed(options.precision ?? 2)}\`;

/** Unit square corners as a readonly tuple (const assertion). */
export const UNIT_SQUARE = [
	{x: 0, y: 0},
	{x: 1, y: 0},
	{x: 1, y: 1},
	{x: 0, y: 1},
] as const;
`},z={modules:T,sources:H},O=z;var j=y("<a> </a>"),q=y('<div class="extraction svelte-1a44gmj"><div class="sidebar svelte-1a44gmj"><!> <nav class="svelte-1a44gmj"></nav></div> <!></div>');function B(g,m){w(m,!0);const{modules:f,sources:v}=O,r=$.set(new E({modules:f,sources:v}));var i=q(),o=d(i),u=d(o);V(u,{class:"py_sm",style:"flex-wrap: nowrap;"});var c=h(u,2);L(c,21,()=>r.modules,s=>s.path,(s,t)=>{var e=j();let p;var x=d(e,!0);n(e),A(S=>{p=R(e,1,"menuitem svelte-1a44gmj",null,p,{selected:a(t).path===r.selected_path}),b(e,"aria-current",a(t).path===r.selected_path?"page":void 0),b(e,"href",S),D(x,a(t).path)},[()=>M("/demo/extraction/[...module_path]",{module_path:a(t).path})]),l(s,e)}),n(c),n(o);var C=h(o,2);k(C,()=>m.children),n(i),l(g,i),_()}export{B as component};
