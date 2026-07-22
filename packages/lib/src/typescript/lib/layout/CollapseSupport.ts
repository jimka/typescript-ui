// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Animation } from "~/core/Animation.js";
import { DOM } from "~/core/DOM.js";

// Pixel thickness of the opaque collapse strip a collapsed pane/region tucks
// into — the size the gutter assumes in its strip state, leaving room for its
// restore chevron. The layout math in `Split.doLayout`/`Border.doLayout` needs
// a number, so the value lives here as a constant rather than only as the
// `--ts-ui-collapse-strip-size` theme token — kept in lockstep by convention
// (token default 18px).
export const COLLAPSE_STRIP_SIZE = 18;

// Collapse/restore transition duration in milliseconds. Mirrors the
// Accordion's 200ms default so the two surfaces share one motion personality;
// kept as a code constant (not a theme token) for the same reason Accordion's
// duration is — motion belongs to the layout, not the theme.
const COLLAPSE_DURATION = 200;

// Symmetric easing curve, identical to the Accordion's, so a collapse reads as
// a time-reverse of a restore. A symmetric curve (`easing(t) + easing(1-t) = 1`)
// avoids the "content vanished, then nothing happened" feel of asymmetric
// material curves. Shared with Accordion deliberately for a consistent feel.
const COLLAPSE_EASING = "cubic-bezier(0.4, 0, 0.6, 1)";

/** Handle for the reduced-motion path, where no transition is primed at all. */
const NOOP_HANDLE: Animation.CancelHandle = { cancel: (): void => {} };

/**
 * Primes a collapse/restore animation: installs a multi-property geometry
 * transition on every participating element, pre-promotes the driving element
 * to its own compositor layer, and schedules the layer's release plus
 * transition cleanup on `transitionend` (with a `setTimeout` fallback).
 *
 * The gutter that carries the motion both *moves* (`left`/`top`) and *resizes*
 * (`width`/`height`) between its divider and strip states, so the transition
 * spans the full axis property list rather than a single size property.
 *
 * The caller is expected to flip its collapsed flag and call `scheduleLayout`
 * immediately after — the next `doLayout` writes the new geometry, which the
 * just-installed transition animates.
 *
 * Under `prefers-reduced-motion: reduce` this is a no-op: no transition is
 * installed, so the upcoming `doLayout` writes land instantly.
 *
 * @param animating - The element that visibly moves; promoted via `will-change`
 *   and the one whose `transitionend` (filtered to `completionProperty`) ends
 *   the animation.
 * @param properties - The CSS properties to transition (e.g. `["left", "width"]`
 *   for a horizontal move-and-resize).
 * @param participants - Every element that should carry the transition for this
 *   toggle: the gutter plus whatever shifts to fill — `Border` passes the gutter
 *   and the centre; `Split` passes all panes and gutters.
 * @param completionProperty - Which property's `transitionend` ends the
 *   animation. Defaults to the first property; pass the size property (whose
 *   `transitionend` fires reliably) when the move delta may be zero.
 */
function primeCollapse(animating: Component, properties: string[], participants: Component[], completionProperty?: string): Animation.CancelHandle {
    if (Animation.isReducedMotion()) {
        return NOOP_HANDLE;
    }

    const transition = properties
        .map(property => `${property} ${COLLAPSE_DURATION}ms ${COLLAPSE_EASING}`)
        .join(", ");

    for (const participant of participants) {
        participant.setTransition(transition);
    }

    animating.setWillChange(properties.join(", "));

    return Animation.afterTransition({
        component:        animating,
        property:         completionProperty ?? properties[0],
        durationMs:       COLLAPSE_DURATION,
        fallbackBufferMs: 40,
        onComplete:       () => {
            for (const participant of participants) {
                participant.setTransition(null);
            }

            animating.setWillChange(null);
        },
    });
}

/** An axis-aligned box used to snapshot and interpolate a participant's bounds. */
interface Rect {
    x:      number;
    y:      number;
    width:  number;
    height: number;
}

/**
 * One element animated by {@link animateLayout}: its captured start/end bounds
 * and whether its content must be re-laid-out each frame.
 *
 * @remarks A content-bearing pane (`relayout: true`) needs `doLayout` per frame
 * so its children track the animating box instead of snapping to the final
 * size; an empty gutter (`relayout: false`) only needs its box geometry written,
 * since its single chevron child re-centres via CSS as the box resizes.
 */
interface CollapseMover {
    component: Component;
    relayout:  boolean;
    start:     Rect;
    end:       Rect;
}

/** Reads a component's current box geometry into a {@link Rect}. */
function captureRect(component: Component): Rect {
    return { x: component.getX(), y: component.getY(), width: component.getWidth(), height: component.getHeight() };
}

/**
 * Parses a `cubic-bezier(x1, y1, x2, y2)` CSS timing string into a JS easing
 * function `progress → eased`, so a JS-driven animation can move in lockstep
 * with a CSS transition that uses the same curve. Falls back to linear if the
 * string isn't a cubic-bezier. Uses Newton-Raphson (then bisection) to invert
 * the bezier's x(t) for a given progress before sampling y(t).
 */
function parseCubicBezier(css: string): (progress: number) => number {
    const match = css.match(/cubic-bezier\(([^)]+)\)/);
    if (!match) {
        return progress => progress;
    }

    const [x1, y1, x2, y2] = match[1].split(",").map(value => parseFloat(value));

    const ax = 3 * x1, bx = 3 * (x2 - x1) - ax, cx = 1 - ax - bx;
    const ay = 3 * y1, by = 3 * (y2 - y1) - ay, cy = 1 - ay - by;

    const sampleX  = (t: number) => ((cx * t + bx) * t + ax) * t;
    const sampleY  = (t: number) => ((cy * t + by) * t + ay) * t;
    const sampleDX = (t: number) => (3 * cx * t + 2 * bx) * t + ax;

    return progress => {
        let t = progress;

        for (let i = 0; i < 8; i += 1) {
            const x = sampleX(t) - progress;
            if (Math.abs(x) < 1e-6) {
                return sampleY(t);
            }

            const dx = sampleDX(t);
            if (Math.abs(dx) < 1e-6) {
                break;
            }

            t -= x / dx;
        }

        // Bisection fallback for the rare flat-slope case.
        let lo = 0, hi = 1;
        t = progress;
        while (lo < hi) {
            const x = sampleX(t);
            if (Math.abs(x - progress) < 1e-6) {
                break;
            }
            if (x < progress) {
                lo = t;
            } else {
                hi = t;
            }
            t = (lo + hi) / 2;
        }

        return sampleY(t);
    };
}

// JS twin of COLLAPSE_EASING, so the rAF geometry interpolation and the
// clip-path CSS transition share one motion curve.
const COLLAPSE_EASE = parseCubicBezier(COLLAPSE_EASING);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
    x:      lerp(a.x,      b.x,      t),
    y:      lerp(a.y,      b.y,      t),
    width:  lerp(a.width,  b.width,  t),
    height: lerp(a.height, b.height, t),
});

/**
 * Writes a resolved rect to a component as a single batched DOM update,
 * mirroring `LayoutManager.commitBounds`: the four positional setters flush
 * together, and a content-bearing participant re-lays-out its children at the
 * new size.
 */
function commitRect(component: Component, rect: Rect, relayout: boolean): void {
    component.setAutoCommitStyle(false);
    component.setX(rect.x);
    component.setY(rect.y);
    component.setWidth(rect.width);
    component.setHeight(rect.height);

    if (relayout) {
        component.doLayout();
    }

    component.setAutoCommitStyle(true);
}

/**
 * Drives a coordinated collapse/restore by interpolating every participant's
 * box from its `start` to its `end` over {@link COLLAPSE_DURATION} on
 * {@link COLLAPSE_EASING}, re-laying-out content-bearing panes each frame.
 *
 * This is the JS half of the collapse animation: it keeps the resizing panes,
 * the moving gutter, and their contents moving together, while the *toggled*
 * pane/region holds its final geometry and only reveals via a `clip-path` CSS
 * transition (primed separately by {@link primeCollapse}). Both halves share
 * the easing curve, so they stay in lockstep. Because linear interpolation of
 * two gap-free layouts is itself gap-free at every step, no seams open between
 * adjacent panes mid-animation.
 *
 * The caller is expected to have already snapshotted each mover's `start`,
 * written the end layout (its `doLayout`), and captured each mover's `end`.
 * This function lands on `start` synchronously — so the just-written end state
 * never paints — then animates forward.
 *
 * Under `prefers-reduced-motion: reduce` it writes the end state and completes
 * immediately, with no animation frames.
 *
 * @param movers - The participants with their captured start/end bounds.
 * @param onComplete - Invoked once the animation settles (or immediately under
 *   reduced motion); not invoked if the returned canceller runs first.
 * @returns A canceller that stops the animation in place (leaving the current
 *   interpolated geometry), so a rapid re-toggle can re-snapshot and retarget.
 */
function animateLayout(movers: CollapseMover[], onComplete?: () => void): () => void {
    if (Animation.isReducedMotion()) {
        for (const mover of movers) {
            commitRect(mover.component, mover.end, mover.relayout);
        }

        onComplete?.();

        return () => {};
    }

    let cancelled = false;
    let raf       = 0;

    // Land on the start frame synchronously so the caller's just-written end
    // geometry never reaches the screen.
    for (const mover of movers) {
        commitRect(mover.component, mover.start, mover.relayout);
    }

    const startTime = performance.now();

    const frame = (now: number): void => {
        if (cancelled) {
            return;
        }

        const progress = Math.min(1, (now - startTime) / COLLAPSE_DURATION);
        const eased     = COLLAPSE_EASE(progress);

        for (const mover of movers) {
            commitRect(mover.component, progress >= 1 ? mover.end : lerpRect(mover.start, mover.end, eased), mover.relayout);
        }

        if (progress < 1) {
            raf = DOM.sink.requestAnimationFrame(frame);
        } else {
            onComplete?.();
        }
    };

    raf = DOM.sink.requestAnimationFrame(frame);

    return () => {
        cancelled = true;

        if (raf) {
            DOM.sink.cancelAnimationFrame(raf);
        }
    };
}

/**
 * One participant in a {@link runCollapse} pass: the moving element and whether
 * its content must be re-laid-out each frame — `true` for a content-bearing
 * pane/region, `false` for an empty gutter.
 */
export interface CollapseParticipant {
    component: Component;
    relayout:  boolean;
}

/**
 * Runs one coordinated collapse/restore for a layout manager — the shared
 * plumbing behind [`Split.setPaneCollapsed`](/api/layout/classes/Split) and
 * [`Border.setRegionCollapsed`](/api/layout/classes/Border). The caller has
 * already flipped its own collapsed flag and assembled `participants`: every
 * box that moves — the panes/regions (`relayout: true`) and the gutters
 * (`relayout: false`), the `toggled` one included.
 *
 * The pass: cancel any in-flight collapse (`previous`); prime the `toggled`
 * pane/region's clip-path reveal (it keeps its final size and only clips, so it
 * never reads as a content snap); snapshot every participant's start geometry;
 * write the end layout via the container's `doLayout`; capture the end geometry;
 * and hand the lot to the rAF driver, which interpolates the boxes — re-laying
 * out the content-bearing ones — in lockstep with the clip transition.
 *
 * @param container - The manager's container, laid out to compute the end state.
 * @param toggled - The pane/region being collapsed or restored (clip-revealed).
 * @param participants - Every moving box, including `toggled`.
 * @param previous - The manager's current animation canceller, or null when idle.
 * @param onIdle - Invoked when the animation settles; clears the manager's handle.
 * @returns A canceller the manager stores and passes back as `previous` next time.
 */
export function runCollapse(
    container:    Component,
    toggled:      Component,
    participants: CollapseParticipant[],
    previous:     (() => void) | null,
    onIdle?:      () => void,
): () => void {
    // Stop any in-flight collapse so a rapid re-toggle re-snapshots from the
    // current mid-animation geometry and retargets cleanly.
    previous?.();

    // The toggled pane/region holds its final size and reveals only via a
    // clip-path transition; every other participant is JS-driven below so boxes
    // and contents move together.
    const primed: Animation.CancelHandle[] = [primeCollapse(toggled, ["clip-path"], [toggled], "clip-path")];

    // Cross-fade each gutter's fill between its transparent divider colour and
    // its opaque strip colour as it morphs, so the strip doesn't pop in or out.
    // Only the toggling gutter's colour actually changes when `doLayout` runs
    // `setOpaque` below; the rest carry the transition harmlessly. The fade is a
    // CSS transition (colour interpolation, `var()` resolution, and the
    // transparent endpoint are all easier left to the browser) sharing the
    // geometry's duration and curve.
    const gutters = participants.filter(participant => !participant.relayout).map(participant => participant.component);
    if (gutters.length > 0) {
        primed.push(primeCollapse(gutters[0], ["background-color"], gutters, "background-color"));
    }

    // Snapshot the start geometry, write the end layout, then capture the end
    // geometry and animate between the two.
    const starts = participants.map(participant => captureRect(participant.component));

    container.doLayout();

    const movers: CollapseMover[] = participants.map((participant, index) => ({
        component: participant.component,
        relayout:  participant.relayout,
        start:     starts[index],
        end:       captureRect(participant.component),
    }));

    const cancelLayout = animateLayout(movers, onIdle);

    // Fold the two primed transitions into the canceller the manager already
    // stores, so one call abandons the whole collapse — including the fallback
    // timers that would otherwise outlive the participants' element handles.
    return (): void => {
        cancelLayout();

        for (const animation of primed) {
            animation.cancel();
        }
    };
}
