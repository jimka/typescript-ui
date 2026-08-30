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
export const COLLAPSE_EASING = "cubic-bezier(0.4, 0, 0.6, 1)";

/** Handle for the reduced-motion path, where no transition is primed at all. */
const NOOP_HANDLE: Animation.CancelHandle = { cancel: (): void => {} };

/**
 * A primed CSS transition that has not settled yet, as held in a manager's
 * pending list. Two dispositions, because teardown has two shapes.
 *
 * @category Layout
 */
export interface CollapseTransition {
    /**
     * Abandons the transition and its completion callback. For the dispose
     * path, where every participant is being destroyed anyway and touching one
     * would write through a released element handle.
     */
    cancel(): void;

    /**
     * Abandons the transition but runs its cleanup — clearing `transition` on
     * every participant and `will-change` on the animating one — immediately.
     * For the manager-swap path, where the participants stay mounted and would
     * otherwise keep a live transition and a permanent compositor layer.
     */
    settle(): void;
}

/**
 * Primes a transition via `create` and adds its handle to `pending`, arranging
 * for the handle to remove itself once the transition settles. The list is
 * therefore always exactly the set of transitions still in flight — which is
 * what a manager's `detach` needs, and what neither the geometry canceller nor
 * a per-toggle field can hold (both are replaced or nulled while primed
 * transitions from an earlier toggle are still running).
 *
 * @param pending - The manager's live-transition list.
 * @param create - Primes the transition, given the callback that prunes it.
 */
function track(
    pending: CollapseTransition[],
    create:  (onSettled: () => void) => { handle: Animation.CancelHandle; cleanup: () => void },
): void {
    let entry: CollapseTransition | null = null;
    let settled = false;

    const prune = (): void => {
        settled = true;

        const index = entry === null ? -1 : pending.indexOf(entry);

        if (index >= 0) {
            pending.splice(index, 1);
        }
    };

    const { handle, cleanup } = create(prune);

    // `create` settles synchronously under reduced motion, and also when the
    // animating component has no element — in both cases `prune` already ran,
    // before `entry` existed, so there is nothing live to track.
    if (settled) {
        return;
    }

    entry = {
        cancel: (): void => handle.cancel(),
        settle: (): void => {
            handle.cancel();
            cleanup();
        },
    };

    pending.push(entry);
}

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
 * @param onSettled - Invoked once the transition completes (or immediately under
 *   reduced motion), so the caller can drop this handle from its live list.
 * @param completionProperty - Which property's `transitionend` ends the
 *   animation. Defaults to the first property; pass the size property (whose
 *   `transitionend` fires reliably) when the move delta may be zero.
 */
function primeCollapse(
    animating:          Component,
    properties:         string[],
    participants:       Component[],
    onSettled:          () => void,
    completionProperty?: string,
): { handle: Animation.CancelHandle; cleanup: () => void } {
    const cleanup = (): void => {
        for (const participant of participants) {
            participant.setTransition(null);
        }

        animating.setWillChange(null);
    };

    if (Animation.isReducedMotion()) {
        onSettled();

        return { handle: NOOP_HANDLE, cleanup };
    }

    const transition = properties
        .map(property => `${property} ${COLLAPSE_DURATION}ms ${COLLAPSE_EASING}`)
        .join(", ");

    for (const participant of participants) {
        participant.setTransition(transition);
    }

    animating.setWillChange(properties.join(", "));

    const handle = Animation.afterTransition({
        component:        animating,
        property:         completionProperty ?? properties[0],
        durationMs:       COLLAPSE_DURATION,
        fallbackBufferMs: 40,
        onComplete:       () => {
            cleanup();
            onSettled();
        },
    });

    return { handle, cleanup };
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

/**
 * Reads a component's current box geometry into a {@link Rect}.
 *
 * @remarks A participant `LayoutManager.commitBounds` last placed via its
 * size-stable position fast path has its move riding on `getTranslateX`/
 * `getTranslateY` while `getX`/`getY` still report the pre-move value —
 * folding the translate in here is what keeps `starts`/`ends` in
 * {@link runCollapse} accurate for a participant that entered this collapse
 * mid-fast-path.
 */
function captureRect(component: Component): Rect {
    return {
        x:      component.getX() + component.getTranslateX(),
        y:      component.getY() + component.getTranslateY(),
        width:  component.getWidth(),
        height: component.getHeight(),
    };
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
 * mirroring `LayoutManager.commitBounds`'s slow path: the positional setters
 * flush together, and a content-bearing participant re-lays-out its children
 * at the new size.
 *
 * @remarks `rect` is already the fully-resolved position — {@link captureRect}
 * folded any translate in when it captured `end`. Resetting the translate
 * (and its `will-change` hint) here, unconditionally, is what keeps that
 * resolved position from being silently offset again by a leftover translate
 * a participant carried in from entering this collapse mid-fast-path.
 */
function commitRect(component: Component, rect: Rect, relayout: boolean): void {
    component.setAutoCommitStyle(false);
    component.setX(rect.x);
    component.setY(rect.y);
    component.setTranslate(0, 0);
    component.setWillChange(null);
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
 * @param pending - The manager's list of primed CSS transitions that have not
 *   settled yet. `runCollapse` appends to it and each entry removes itself on
 *   completion, so the manager's `detach` can cancel exactly the live ones.
 *   Kept off the returned canceller deliberately: that canceller is nulled when
 *   the geometry animation settles, ~40 ms before the primed transitions'
 *   fallbacks disarm, and a re-toggle replaces it while old transitions are
 *   still running — either would strand a live handle.
 * @param onIdle - Invoked when the animation settles; clears the manager's handle.
 * @returns A canceller the manager stores and passes back as `previous` next time.
 */
export function runCollapse(
    container:    Component,
    toggled:      Component,
    participants: CollapseParticipant[],
    previous:     (() => void) | null,
    pending:      CollapseTransition[],
    onIdle?:      () => void,
): () => void {
    // Stop any in-flight collapse so a rapid re-toggle re-snapshots from the
    // current mid-animation geometry and retargets cleanly. Only the geometry
    // animation is stopped: the primed CSS transitions are left to finish and
    // run their own cleanup, because that cleanup (clearing `transition` and
    // `will-change` on the previous participants) has no other trigger and the
    // fresh prime below covers only the new participant set.
    previous?.();

    // The toggled pane/region holds its final size and reveals only via a
    // clip-path transition; every other participant is JS-driven below so boxes
    // and contents move together.
    track(pending, handle => primeCollapse(toggled, ["clip-path"], [toggled], handle, "clip-path"));

    // Cross-fade each gutter's fill between its transparent divider colour and
    // its opaque strip colour as it morphs, so the strip doesn't pop in or out.
    // Only the toggling gutter's colour actually changes when `doLayout` runs
    // `setOpaque` below; the rest carry the transition harmlessly. The fade is a
    // CSS transition (colour interpolation, `var()` resolution, and the
    // transparent endpoint are all easier left to the browser) sharing the
    // geometry's duration and curve.
    const gutters = participants.filter(participant => !participant.relayout).map(participant => participant.component);
    if (gutters.length > 0) {
        track(pending, handle => primeCollapse(gutters[0], ["background-color"], gutters, handle, "background-color"));
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

    return animateLayout(movers, onIdle);
}
