/**
 * Reactive zoom/pan state with input behavior bundled as an attachment.
 *
 * Holds `scale`, `tx`, `ty`, exposes a CSS-/SVG-compatible transform string, and
 * carries an `input` attachment that wires pointer + wheel handlers onto a host
 * element. The consumer owns the host markup and where the transform is applied
 * (typically an inner `<g transform={state.transform}>` for SVG content).
 *
 * When the transform is applied inside an SVG (where coordinates are in viewBox
 * units rather than CSS pixels), set `content_width`/`content_height` to the
 * viewBox dimensions and bind `host_width`/`host_height` to the rendered host
 * element's `clientWidth`/`clientHeight`. The class then converts pointer-pixel
 * input into viewBox units, accounting for `preserveAspectRatio="xMidYMid meet"`
 * letterboxing so pan tracks the cursor 1:1 and zoom pivots on the cursor.
 *
 * Usage:
 *
 * ```svelte
 * <div
 *   class="zoom-host"
 *   {@attach state.input}
 *   bind:clientWidth={state.host_width}
 *   bind:clientHeight={state.host_height}
 * >
 *   <svg width={w} height={h} viewBox="0 0 {w} {h}">
 *     <g transform={state.transform}>...</g>
 *   </svg>
 * </div>
 * ```
 */

import { on } from 'svelte/events';

export interface ZoomPanStateOptions {
	min_scale?: number;
	max_scale?: number;
	initial_scale?: number;
	initial_tx?: number;
	initial_ty?: number;
	/** Promote single-pointer movement to a pan after this many CSS pixels. */
	drag_threshold?: number;
	/** viewBox width — set when the transform is applied inside an SVG. */
	content_width?: number;
	/** viewBox height — set when the transform is applied inside an SVG. */
	content_height?: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class ZoomPanState {
	scale: number = $state(1);
	tx: number = $state(0);
	ty: number = $state(0);

	/** Host element CSS pixel dimensions. Bind to `clientWidth`/`clientHeight`. */
	host_width: number = $state(0);
	host_height: number = $state(0);

	readonly min_scale: number;
	readonly max_scale: number;
	readonly drag_threshold: number;
	readonly content_width: number;
	readonly content_height: number;

	readonly transform: string = $derived(`translate(${this.tx} ${this.ty}) scale(${this.scale})`);

	/**
	 * CSS pixels per content unit under `preserveAspectRatio="xMidYMid meet"`.
	 * Falls back to 1 (identity) when content dimensions aren't provided or the
	 * host hasn't measured yet, so plain CSS-transform usage stays 1:1.
	 */
	private readonly px_per_unit: number = $derived.by(() => {
		if (this.content_width <= 0 || this.content_height <= 0) return 1;
		if (this.host_width <= 0 || this.host_height <= 0) return 1;
		return Math.min(this.host_width / this.content_width, this.host_height / this.content_height);
	});

	private pointers: Map<number, { x: number; y: number }> = new Map();
	private drag_anchor: { x: number; y: number } | null = null;
	private is_dragging = false;

	constructor(options: ZoomPanStateOptions = {}) {
		this.min_scale = options.min_scale ?? 0.1;
		this.max_scale = options.max_scale ?? 8;
		this.drag_threshold = options.drag_threshold ?? 4;
		this.content_width = options.content_width ?? 0;
		this.content_height = options.content_height ?? 0;
		this.scale = options.initial_scale ?? 1;
		this.tx = options.initial_tx ?? 0;
		this.ty = options.initial_ty ?? 0;
	}

	/**
	 * Map an anchor in host CSS pixels (relative to top-left) to the inner
	 * transform's coordinate space, accounting for `xMidYMid meet` letterboxing.
	 * Identity when no content dimensions are configured.
	 */
	private anchor_to_units(px_x: number, px_y: number): { x: number; y: number } {
		if (
			this.content_width <= 0 ||
			this.content_height <= 0 ||
			this.host_width <= 0 ||
			this.host_height <= 0
		) {
			return { x: px_x, y: px_y };
		}
		const ppu = this.px_per_unit;
		const offset_x = (this.host_width - this.content_width * ppu) / 2;
		const offset_y = (this.host_height - this.content_height * ppu) / 2;
		return { x: (px_x - offset_x) / ppu, y: (px_y - offset_y) / ppu };
	}

	reset(): void {
		this.scale = 1;
		this.tx = 0;
		this.ty = 0;
	}

	/**
	 * Scale by `factor` while keeping `(anchor_px_x, anchor_px_y)` fixed on screen.
	 * Anchor coords are in host CSS pixels relative to the host element's top-left.
	 */
	zoom_at(anchor_px_x: number, anchor_px_y: number, factor: number): void {
		const next = clamp(this.scale * factor, this.min_scale, this.max_scale);
		if (next === this.scale) return;
		const { x: anchor_x, y: anchor_y } = this.anchor_to_units(anchor_px_x, anchor_px_y);
		const ratio = next / this.scale;
		this.tx = anchor_x - (anchor_x - this.tx) * ratio;
		this.ty = anchor_y - (anchor_y - this.ty) * ratio;
		this.scale = next;
	}

	/** Pan by `(dx_px, dy_px)` in host CSS pixels; converted to content units internally. */
	pan(dx_px: number, dy_px: number): void {
		const ppu = this.px_per_unit;
		this.tx += dx_px / ppu;
		this.ty += dy_px / ppu;
	}

	/**
	 * Attach pointer + wheel input handlers onto an element.
	 * Apply via `{@attach state.input}` on the host div.
	 */
	input = (el: HTMLElement): (() => void) => {
		const on_pointer_down = (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (this.pointers.size === 1) {
				this.drag_anchor = { x: e.clientX, y: e.clientY };
				this.is_dragging = false;
			} else if (this.pointers.size === 2) {
				// Pinch started; capture both pointers so we keep getting move events
				for (const id of this.pointers.keys()) el.setPointerCapture(id);
				this.is_dragging = true;
			}
		};

		const on_pointer_move = (e: PointerEvent) => {
			const prev = this.pointers.get(e.pointerId);
			if (!prev) return;
			const next = { x: e.clientX, y: e.clientY };

			if (this.pointers.size === 1 && this.drag_anchor) {
				if (!this.is_dragging) {
					const dx = next.x - this.drag_anchor.x;
					const dy = next.y - this.drag_anchor.y;
					if (Math.hypot(dx, dy) > this.drag_threshold) {
						this.is_dragging = true;
						el.setPointerCapture(e.pointerId);
					}
				}
				if (this.is_dragging) {
					this.pan(next.x - prev.x, next.y - prev.y);
				}
			} else if (this.pointers.size === 2) {
				let other: { x: number; y: number } | undefined;
				for (const [id, p] of this.pointers) {
					if (id !== e.pointerId) {
						other = p;
						break;
					}
				}
				if (other) {
					const prev_dist = Math.hypot(prev.x - other.x, prev.y - other.y);
					const next_dist = Math.hypot(next.x - other.x, next.y - other.y);
					if (prev_dist > 0) {
						const factor = next_dist / prev_dist;
						const rect = el.getBoundingClientRect();
						const mid_x = (next.x + other.x) / 2 - rect.left;
						const mid_y = (next.y + other.y) / 2 - rect.top;
						this.zoom_at(mid_x, mid_y, factor);
					}
				}
			}

			this.pointers.set(e.pointerId, next);
		};

		const on_pointer_up = (e: PointerEvent) => {
			this.pointers.delete(e.pointerId);
			if (el.hasPointerCapture(e.pointerId)) {
				el.releasePointerCapture(e.pointerId);
			}
			if (this.pointers.size === 0) {
				this.drag_anchor = null;
			}
		};

		// Eat the trailing synthetic click when a drag/pinch ends so it doesn't
		// navigate a clicked-through link in child SVG `<a>` elements.
		const on_click = (e: MouseEvent) => {
			if (this.is_dragging) {
				e.preventDefault();
				e.stopPropagation();
				this.is_dragging = false;
			}
		};

		const on_wheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = el.getBoundingClientRect();
			const factor = Math.exp(-e.deltaY * 0.0015);
			this.zoom_at(e.clientX - rect.left, e.clientY - rect.top, factor);
		};

		const cleanups = [
			on(el, 'pointerdown', on_pointer_down),
			on(el, 'pointermove', on_pointer_move),
			on(el, 'pointerup', on_pointer_up),
			on(el, 'pointercancel', on_pointer_up),
			on(el, 'click', on_click, { capture: true }),
			on(el, 'wheel', on_wheel, { passive: false })
		];

		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	};
}
