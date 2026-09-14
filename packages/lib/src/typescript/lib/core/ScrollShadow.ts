// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Shared visual recipe for the position-aware scroll-edge shadows. Both scroll
 * systems paint the same fade — {@link Panel} over native `overflow` scrolling
 * and {@link VirtualScroller} over transform-based virtual lists — so the
 * geometry constants, the per-edge strip builder, and the per-edge colour ramp
 * live here as the single source of truth. Each owner keeps its own shadow
 * host (an inert, shadow-free element carrying the per-edge custom properties)
 * and per-edge cache; the four strips painting the edges are appended inside
 * that host by {@link appendScrollShadowStrips}, one per edge, each gated by
 * its own custom property inherited from the host.
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
 * colour is the only part a theme needs to vary, and a constant keeps each
 * strip's own single-shadow geometry simple. `12px` reads as a soft edge cue
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
 * Thickness of each edge strip along its own axis. One extent is enough: the
 * strip's shadow edge sits on the strip's own border, so only the blur's
 * inward bleed is ever visible, and that is spent within `extent`px.
 */
const SCROLL_SHADOW_STRIP_PX = SCROLL_SHADOW_EXTENT_PX;

/**
 * Per-edge strip style: the pinning geometry plus that edge's single inset
 * shadow layer. Each strip pins only three of its four edges — the fixed
 * extent covers the fourth — so a host thinner than `extent`px on that axis
 * would otherwise let the strip's own box extend past the host's: unlike the
 * box-shadow it replaces (which never contributes to scrollable overflow,
 * however far it visually bleeds), a real element that overflows its
 * containing block does. `maxHeight`/`maxWidth: 100%` caps the strip to
 * whatever the host actually offers on that axis — `min(extent, hostSize)` —
 * so it can shrink but never escape, with no JavaScript geometry involved.
 */
function scrollShadowStripStyles(): readonly Record<string, string>[] {
    const extent = SCROLL_SHADOW_EXTENT_PX + "px";
    const thick  = SCROLL_SHADOW_STRIP_PX  + "px";

    return [
        { position: "absolute", top:    "0", left: "0", right:  "0", height: thick, maxHeight: "100%", boxShadow: `inset 0 ${extent} ${extent} -${extent} var(--ts-ss-top, transparent)`    },
        { position: "absolute", bottom: "0", left: "0", right:  "0", height: thick, maxHeight: "100%", boxShadow: `inset 0 -${extent} ${extent} -${extent} var(--ts-ss-bottom, transparent)` },
        { position: "absolute", left:   "0", top:  "0", bottom: "0", width:  thick, maxWidth:  "100%", boxShadow: `inset ${extent} 0 ${extent} -${extent} var(--ts-ss-left, transparent)`   },
        { position: "absolute", right:  "0", top:  "0", bottom: "0", width:  thick, maxWidth:  "100%", boxShadow: `inset -${extent} 0 ${extent} -${extent} var(--ts-ss-right, transparent)` },
    ];
}

/**
 * Creates and appends the four scroll-shadow edge strips inside a shadow-free
 * host, one per edge (top, bottom, left, right — always in that order), each
 * pinned to its own edge by CSS and carrying exactly one layer of the shared
 * shadow recipe. The strips carry no `pointer-events` of their own — the
 * property inherits from the host, which both owners already set to `none`.
 *
 * @param host - The inert overlay element the strips are appended into.
 * @returns The four strip handles, in top/bottom/left/right order.
 */
export function appendScrollShadowStrips(host: Handle): readonly Handle[] {
    const strips: Handle[] = [];

    for (const style of scrollShadowStripStyles()) {
        const strip = DOM.sink.createElement("div");

        DOM.sink.apply(strip, { style });
        DOM.sink.appendChild(host, strip);
        strips.push(strip);
    }

    return strips;
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
