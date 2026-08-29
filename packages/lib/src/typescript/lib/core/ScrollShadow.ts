// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Shared visual recipe for the position-aware scroll-edge shadows. Both scroll
 * systems paint the same fade — {@link Panel} over native `overflow` scrolling
 * and {@link VirtualScroller} over transform-based virtual lists — so the
 * geometry constants, the box-shadow recipe, and the per-edge colour ramp live
 * here as the single source of truth. Each owner keeps its own overlay element
 * and per-edge cache; only the drift-prone visual maths is shared.
 *
 * @category Core
 */

/**
 * Reach in pixels of each scroll-edge shadow — used as the inset shadow's
 * offset, blur, and (negative) spread, so each edge's fade hugs its border and
 * dies out roughly this far inward.
 *
 * Fixed framework-side rather than themed, for the same reason the keyboard
 * focus indicator fixes its `2px` width (see `Theme.indicator.focus`): the
 * colour is the only part a theme needs to vary, and a constant keeps the
 * overlay's four-shadow geometry simple. `12px` reads as a soft edge cue
 * without masking a meaningful strip of content.
 */
const SCROLL_SHADOW_EXTENT_PX = 12;

/**
 * Distance in pixels over which an edge's shadow ramps from none to full as the
 * scroll position moves away from that edge's extreme. The strength is
 * `clamp(distanceFromExtreme / this, 0, 1)`, so the shadow fades in smoothly
 * just after leaving an edge and fades out as the opposite edge is approached,
 * instead of popping on/off at a single-pixel threshold. `40px` gives a visible
 * fade without staying faint through a meaningful amount of overflow.
 */
const SCROLL_SHADOW_RAMP_PX = 40;

/**
 * Ramps an edge's shadow in by how far the scroll position sits past that
 * edge's extreme. The `- 1` folds in a sub-pixel epsilon: within 1px of an
 * extreme the strength is 0, so a fractional scrollSize/clientSize mismatch
 * can't leave a phantom fade.
 *
 * @param distance - Pixels the scroll position is past the edge's extreme.
 * @returns The edge strength in the range 0–1.
 */
export function scrollShadowRamp(distance: number): number {
    return Math.max(0, Math.min(1, (distance - 1) / SCROLL_SHADOW_RAMP_PX));
}

/**
 * Builds the four-layer inset `box-shadow` recipe — one blurred shadow per edge,
 * each gated by a local custom property (`--ts-ss-top` / `-bottom` / `-left` /
 * `-right`) defaulting to `transparent`, so lighting an edge is a single
 * property flip rather than a shadow rebuild. The `-extent` spread keeps each
 * shadow hugging its own edge while the equal blur fades it inward over
 * `extent`px, so the edge reads as a soft cast shadow rather than the
 * hard-terminated band a `linear-gradient` would paint.
 *
 * @returns The `box-shadow` value.
 */
export function scrollShadowBoxShadow(): string {
    const extent = SCROLL_SHADOW_EXTENT_PX + "px";

    return (
        `inset 0 ${extent} ${extent} -${extent} var(--ts-ss-top, transparent),` +
        `inset 0 -${extent} ${extent} -${extent} var(--ts-ss-bottom, transparent),` +
        `inset ${extent} 0 ${extent} -${extent} var(--ts-ss-left, transparent),` +
        `inset -${extent} 0 ${extent} -${extent} var(--ts-ss-right, transparent)`
    );
}

/**
 * Value for one edge's shadow custom property: the theme shadow colour scaled
 * toward transparent by `percent`, or `null` at zero so the `box-shadow` layer
 * falls back to its `transparent` default.
 *
 * @param percent - The edge strength as a whole percentage (0–100).
 * @returns The `color-mix` value, or `null` when the edge is off.
 */
export function scrollShadowEdgeValue(percent: number): string | null {
    return percent === 0
        ? null
        : `color-mix(in srgb, var(--ts-ui-scroll-shadow-color) ${percent}%, transparent)`;
}

/**
 * Per-edge scroll-shadow strength, quantised to a whole percent (0-100).
 * Shared shape; each owner ({@link Panel}, {@link VirtualScroller}) keeps its
 * own instance.
 *
 * @category Core
 */
export interface ScrollShadowEdges {
    top:    number;
    bottom: number;
    left:   number;
    right:  number;
}

/**
 * Quantises a 0-1 edge strength to a whole percentage and reports whether it
 * differs from the cached value for that edge, updating the cache in place
 * when it does.
 *
 * @param edges - The owner's own per-edge percentage cache; mutated in place.
 * @param edge - Which edge's cached percentage to check and update.
 * @param strength - The edge's raw 0-1 strength.
 * @returns The new percentage when it changed, or `null` when unchanged (nothing to write).
 */
export function quantizeShadowEdge(edges: ScrollShadowEdges, edge: keyof ScrollShadowEdges, strength: number): number | null {
    const percent = Math.round(strength * 100);

    if (edges[edge] === percent) {
        return null;
    }

    edges[edge] = percent;

    return percent;
}
