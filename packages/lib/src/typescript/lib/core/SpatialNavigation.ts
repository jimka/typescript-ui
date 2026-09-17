// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, NAVIGATION_TARGET_ATTR, NAVIGATION_TARGET_SELECTOR, CLIP_FRAME_ATTR } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, Rect } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { FocusReveal } from "~/core/FocusReveal.js";
import { LayerManager } from "~/core/LayerManager.js";
import { focusScopeRoot, visibleFocusable, focusCandidates, isLiveHandle, ancestorsToDocument, ancestorsBefore } from "~/core/Focusable.js";
import { ROVING_MEMBER_ATTR, ROVING_MEMBER_SELECTOR } from "~/core/RovingTabIndex.js";

/**
 * A compass direction to search for a spatial-navigation candidate in.
 *
 * @category Core
 */
export type SpatialDirection = "north" | "south" | "east" | "west";

/** One rectangular span along a single axis, as read off a {@link Rect}. */
interface Span {
    start: number;
    end:   number;
}

// A candidate whose perpendicular span misses the origin's is penalised at
// twice the rate of raw forward distance — the CSS Spatial Navigation spec's
// own vertical `orthogonalWeight`. See the plan's `[^weight]` note.
const PERPENDICULAR_WEIGHT: number = 2;

// Two flex siblings that are visually flush can each round their shared edge
// independently, so a genuinely adjacent candidate's primary gap can come out
// a few thousandths of a pixel negative instead of exactly 0 (observed: two
// `TabButton`s a real tab strip lays out edge-to-edge, ~0.000004px apart).
// Tolerating that little of an overlap never admits a candidate that's
// actually behind the origin — real "wrong side" overlaps in this codebase's
// layouts run at least whole pixels deep.
const PRIMARY_GAP_EPSILON: number = 1;

/** The primary gap and perpendicular spans for `direction`, per the plan's ranking-rule table. */
function project(origin: Rect, candidate: Rect, direction: SpatialDirection):
    { primary: number; originSpan: Span; candidateSpan: Span } {
    switch (direction) {
        case "north":
            return {
                primary:       origin.top - candidate.bottom,
                originSpan:    { start: origin.left, end: origin.right },
                candidateSpan: { start: candidate.left, end: candidate.right },
            };
        case "south":
            return {
                primary:       candidate.top - origin.bottom,
                originSpan:    { start: origin.left, end: origin.right },
                candidateSpan: { start: candidate.left, end: candidate.right },
            };
        case "west":
            return {
                primary:       origin.left - candidate.right,
                originSpan:    { start: origin.top, end: origin.bottom },
                candidateSpan: { start: candidate.top, end: candidate.bottom },
            };
        case "east":
            return {
                primary:       candidate.left - origin.right,
                originSpan:    { start: origin.top, end: origin.bottom },
                candidateSpan: { start: candidate.top, end: candidate.bottom },
            };
    }
}

/** How far two spans fail to overlap; `0` whenever they overlap at all. */
function gapBetween(a: Span, b: Span): number {
    return Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));
}

// gapBetween reports 0 both for a genuine overlap and for two spans that
// merely touch at a shared edge (e.g. a fixed-height toolbar's top edge
// flush against the chrome row above it) — that degenerate case must not
// count as "sharing the band", or an adjacent, different-row element can
// out-rank the true same-row neighbour. Overlap requires positive width.
function spansOverlap(a: Span, b: Span): boolean {
    return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

/** The midpoint of a span. */
function centreOf(span: Span): number {
    return (span.start + span.end) / 2;
}

/**
 * One element paired with the rectangle it occupies, as fed to
 * {@link rankInDirection}.
 *
 * @category Core
 */
export interface SpatialCandidate {
    handle: Handle;
    rect:   Rect;
}

/**
 * Eligible candidates in `direction` from `origin`, best first. Pure; reads
 * no DOM. A candidate is eligible when its primary gap (the clearance between
 * `origin`'s forward edge and its near edge) is no more than
 * {@link PRIMARY_GAP_EPSILON} negative — tolerating the sub-pixel overlap
 * `getBoundingClientRect()` can report between two visually-flush siblings —
 * and its rect is not the zero rect (`width === 0 && height === 0`). A
 * negative gap within that tolerance scores as `0`, not as a small negative
 * bonus. Eligible candidates are ranked by three keys, in order: whether the
 * candidate genuinely overlaps `origin`'s perpendicular band — a positive-width
 * intersection, not merely touching at a shared edge — (overlapping always
 * ranks first — a large primary gap along the row or column the arrow moves
 * within must not lose to a small one that requires leaving that row or
 * column entirely), then by `primaryGap + 2 × perpendicularGap` ascending,
 * then by perpendicular-centre distance from `origin` ascending, then by the
 * order `candidates` supplied them in.
 *
 * @param origin - The rectangle to search outward from.
 * @param candidates - The candidates to rank.
 * @param direction - The compass direction to search in.
 * @category Core
 */
export function rankInDirection(
    origin:     Rect,
    candidates: readonly SpatialCandidate[],
    direction:  SpatialDirection,
): Handle[] {
    const scored: Array<{ handle: Handle; score: number; centreDelta: number; sharesBand: boolean }> = [];

    for (const { handle, rect } of candidates) {
        if (rect.width === 0 && rect.height === 0) {
            continue;
        }

        const { primary, originSpan, candidateSpan } = project(origin, rect, direction);

        if (primary < -PRIMARY_GAP_EPSILON) {
            continue;
        }

        scored.push({
            handle,
            score:       Math.max(0, primary) + PERPENDICULAR_WEIGHT * gapBetween(originSpan, candidateSpan),
            centreDelta: Math.abs(centreOf(candidateSpan) - centreOf(originSpan)),
            sharesBand:  spansOverlap(originSpan, candidateSpan),
        });
    }

    scored.sort((a, b) =>
        Number(!a.sharesBand) - Number(!b.sharesBand) ||
        a.score - b.score ||
        a.centreDelta - b.centreDelta);

    return scored.map(entry => entry.handle);
}

/**
 * Which candidate set a {@link SpatialNavigation.move} call searches, and
 * what happens on arrival — see the plan's `## Architecture Decisions` table.
 *
 * @category Core
 */
export type SpatialTier = "component" | "target";

/**
 * The modifier set that arms a tier's arrow keys.
 *
 * @category Core
 */
export interface SpatialNavigationModifiers {
    ctrl?:  boolean;
    alt?:   boolean;
    shift?: boolean;
    meta?:  boolean;
}

/**
 * Options for {@link SpatialNavigation.enable} / {@link SpatialNavigation.configure}.
 *
 * @category Core
 */
export interface SpatialNavigationOptions {
    /** Fine tier. Default `{ ctrl: true, alt: true }`. Replaces the whole set, not merged. */
    componentModifiers?: SpatialNavigationModifiers;
    /** Coarse tier. Default `{ ctrl: true, shift: true }`. Replaces the whole set, not merged. */
    targetModifiers?:    SpatialNavigationModifiers;
}

// The DOM attribute `moveFocus` mirrors onto whatever element it lands
// focus on — matched by a click-activated control's `:focus-visible` ring
// rule (`registerFocusVisibleRing`) alongside the native pseudo-class.
// Chromium's native `:focus-visible` heuristic does not treat a keydown with
// `ctrlKey` / `altKey` held as keyboard-navigation-worthy, even when it
// synchronously drives a real `.focus()` call — exactly the shape of this
// service's own `Ctrl+Alt` / `Ctrl+Shift` chords — so relying on the bare
// pseudo-class alone would silently never show a ring for either chord.
// Exported so `focusRing` reads the exact string this module writes.
export const FOCUS_VISIBLE_ATTR = "data-ts-ui-focus-visible";

const ARROW_DIRECTIONS: Record<string, SpatialDirection> = {
    ArrowUp: "north", ArrowDown: "south", ArrowLeft: "west", ArrowRight: "east",
};

// Ctrl+Alt + arrow (fine) and Ctrl+Shift + arrow (coarse, kept from the
// superseded directional-panel-navigation plan): free of OS/browser bindings
// on Windows and macOS; GNOME's Ctrl+Alt+arrow workspace-switch collision is
// a known, documented trade the configurable modifier set exists to work
// around — see the plan's `[^chords]` note.
const DEFAULT_COMPONENT_MODIFIERS: SpatialNavigationModifiers = { ctrl: true, alt: true };
const DEFAULT_TARGET_MODIFIERS:    SpatialNavigationModifiers = { ctrl: true, shift: true };

// Sentinel used to register the service's viewport listener — mirrors
// FocusHistory's identical `_owner` pattern. `SpatialNavigation` has no DOM
// element of its own, so a stable, otherwise-unused `Component` owns it.
const _owner: Component = new Component();

// Last-focused descendant per navigation target, keyed by the target's element.
const _lastFocus: Map<Handle, Handle> = new Map<Handle, Handle>();

let _enabled: boolean = false;
let _componentModifiers: SpatialNavigationModifiers = DEFAULT_COMPONENT_MODIFIERS;
let _targetModifiers:    SpatialNavigationModifiers = DEFAULT_TARGET_MODIFIERS;

/** Whether `e`'s modifier keys match `modifiers` exactly. */
function matchesModifiers(e: KeyboardEvent, modifiers: SpatialNavigationModifiers): boolean {
    return e.ctrlKey === !!modifiers.ctrl && e.altKey === !!modifiers.alt &&
        e.shiftKey === !!modifiers.shift && e.metaKey === !!modifiers.meta;
}

/**
 * Which tier (if any) claims `e`: the component tier when its modifiers
 * match, else the target tier when its modifiers match, else neither. A
 * same-modifier collision between the two configured sets favours the
 * component tier — see the plan's `[^chords]` note.
 *
 * @param e - The keyboard event to test.
 */
function claimedTier(e: KeyboardEvent): SpatialTier | null {
    if (!_enabled || ARROW_DIRECTIONS[e.code] === undefined) {
        return null;
    }

    if (LayerManager.hasActiveInputLayer()) {
        return null;
    }

    if (matchesModifiers(e, _componentModifiers)) {
        return "component";
    }

    if (matchesModifiers(e, _targetModifiers)) {
        return "target";
    }

    return null;
}

/** Drops every `_lastFocus` entry whose target key is no longer connected. */
function pruneStaleMemory(): void {
    for (const target of _lastFocus.keys()) {
        if (!isLiveHandle(target)) {
            _lastFocus.delete(target);
        }
    }
}

/**
 * Walks from `origin` up to (and including) `<html>` — see {@link
 * ancestorsToDocument} for why the walk is bounded there — recording `origin`
 * against **every** ancestor carrying {@link NAVIGATION_TARGET_ATTR}, not
 * only the nearest, so an outer target's memory is correct too. Mirrors
 * {@link FocusTraversal}'s `findTabKeyOwner` walk.
 *
 * @param origin - The element being moved away from.
 */
function recordOrigin(origin: Handle): void {
    for (const h of ancestorsToDocument(origin)) {
        if (DOM.source.hasAttribute(h, NAVIGATION_TARGET_ATTR)) {
            _lastFocus.set(h, origin);
        }
    }
}

/**
 * Drops a navigation target from `targets` whenever another target in the
 * same set is one of its DOM ancestors and that ancestor does not itself
 * contain `origin`. Such an ancestor stands for its whole nested subtree
 * when the move approaches from outside it — the descendant is reached
 * afterwards through the ancestor's own remembered focus (`_lastFocus`), not
 * ranked as an independent peer that could out-score it on raw geometry.
 * When `origin` is inside the ancestor already (moving between its nested
 * targets), that ancestor is left to fail {@link rankInDirection}'s own
 * primary-gap check instead — it geometrically contains `origin`, so it is
 * never "beside" or "beyond" any of its own descendants — and this filter
 * leaves every descendant untouched.
 *
 * @param targets - The candidate navigation-target handles to filter.
 * @param origin - The element being moved away from.
 */
function outermostTargets(targets: Handle[], origin: Handle): Handle[] {
    return targets.filter(target =>
        !targets.some(other => other !== target &&
            DOM.source.contains(other, target) && !DOM.source.contains(other, origin)));
}

// The tags `leafFocusables` treats as a genuinely interactive leaf (a real
// `<button>`, even one another button is raw-appended onto, like a
// `TabButton`'s overlaid `TabCloseButton`), as opposed to a passive container
// whose own focusability comes solely from `[tabindex]`. Membership is
// unaffected by what FOCUSABLE_SELECTOR matches — it is this tier's own
// interactive/passive ruling, not a restatement of that selector.
const NATIVE_FOCUSABLE_TAGS = new Set(["button", "input", "select", "textarea", "a"]);

/** Whether `handle` renders as one of {@link NATIVE_FOCUSABLE_TAGS}. */
function isNativeFocusableTag(handle: Handle): boolean {
    return NATIVE_FOCUSABLE_TAGS.has(DOM.source.getTagName(handle).toLowerCase());
}

/**
 * Whether `handle` is a genuinely independent leaf: either a real interactive
 * tag ({@link isNativeFocusableTag}) or an explicit `RovingTabIndex` member
 * ({@link ROVING_MEMBER_SELECTOR}). Both are deliberate, framework-level
 * signals that an element is meant to be reachable on its own — as opposed to
 * a plain element that merely carries a `tabindex` incidentally, e.g. a
 * `Checkbox` used as an always-visible boolean table-cell renderer: it sets
 * its own `tabindex="0"` for standalone use, but is never enrolled in any
 * `RovingTabIndex` group and renders as no native tag, so it carries neither
 * signal.
 */
function isIndependentLeaf(handle: Handle): boolean {
    return isNativeFocusableTag(handle) || DOM.source.hasAttribute(handle, ROVING_MEMBER_ATTR);
}

/**
 * `first` followed by whichever handles in `second` are not already in
 * `first` — a stable union, since a `RovingTabIndex` group's own active
 * member is always found by both {@link visibleFocusable} and
 * {@link rovingGroupMembers} at once.
 *
 * @param first - The primary list; every one of its handles is kept, in order.
 * @param second - Additional handles, appended in order, skipping duplicates.
 */
function mergeHandles(first: Handle[], second: Handle[]): Handle[] {
    return [...first, ...second.filter(handle => !first.includes(handle))];
}

/**
 * Visible, enabled members of any `RovingTabIndex` group inside `root`,
 * regardless of their current `tabindex`. `visibleFocusable`'s
 * `FOCUSABLE_SELECTOR` query only ever sees a group's single active member —
 * every other one carries `tabindex="-1"`, which that selector's guard hides
 * on every branch. Any roved-off member of a `ToolBar` (or `ButtonGroup`, or
 * a `RadioButton` group, …) would otherwise be permanently unreachable by
 * this tier — reachable only by first landing on whichever sibling happens to
 * hold the group's own Tab stop — which is what makes this helper
 * load-bearing rather than a corner case.
 *
 * @param root - The element to search inside.
 */
function rovingGroupMembers(root: Handle): Handle[] {
    return DOM.source.querySelectorAll(root, ROVING_MEMBER_SELECTOR)
        .filter(handle => DOM.source.isRenderedVisible(handle) && !DOM.source.hasAttribute(handle, "disabled"));
}

/**
 * Resolves every containment relationship between component-tier candidates
 * in favour of whichever side is a genuinely independent leaf
 * ({@link isIndependentLeaf}) — a real interactive tag or an explicit
 * `RovingTabIndex` member — over one that merely happens to sit inside (or
 * around) it:
 *
 * - A composite widget's own container commonly carries its own focusable
 *   element too — `ToolBar`, `MenuBar`, and `TabBar` all do, as the single
 *   roving-tabindex Tab stop such a widget conventionally exposes — and it is
 *   not itself "the nearest individual focusable element" the fine tier is
 *   meant to land on: a border or inset pixel can let it out-rank its own
 *   content on raw geometry, stranding the move on the container with none of
 *   its buttons reachable. Such a container is dropped whenever it contains
 *   an independent leaf.
 * - A native-tag candidate is always kept regardless of what it contains — a
 *   `TabButton` is a real, independently meaningful leaf in its own right,
 *   not a passive host, even though its overlaid `TabCloseButton` is a
 *   genuine DOM child of it (raw-appended, not enrolled in a layout);
 *   dropping it the same way would leave every closeable tab reachable only
 *   by its close button.
 * - Conversely, a candidate that is *not* an independent leaf is dropped when
 *   it sits inside another candidate at all, independent leaf or not — e.g.
 *   `Table`'s `<tbody>` (its own single grid-pattern Tab stop) containing a
 *   boolean column's always-visible Checkbox cell renderer, which sets its
 *   own `tabindex="0"` for standalone use but is enrolled in no roving group
 *   and renders as no native tag. Left unfiltered, every such cell would
 *   out-rank the table's own single stop on raw geometry, scattering one
 *   composite widget into as many stops as it has incidentally-tabbable
 *   cells — exactly what the roving-tabindex marker (not a bare `tabindex`)
 *   exists to opt a descendant out of.
 *
 * @param handles - The candidate handles to filter.
 */
function leafFocusables(handles: Handle[]): Handle[] {
    return handles.filter(handle => {
        if (isIndependentLeaf(handle)) {
            return true;
        }

        const containsAnIndependentLeaf = handles.some(other =>
            other !== handle && isIndependentLeaf(other) && DOM.source.contains(handle, other));
        const containedByAnotherCandidate = handles.some(other =>
            other !== handle && DOM.source.contains(other, handle));

        return !containsAnIndependentLeaf && !containedByAnotherCandidate;
    });
}

/** The overlapping portion of two rects; zero width/height (never negative) when they don't overlap on that axis. */
function intersectRects(a: Rect, b: Rect): Rect {
    const left   = Math.max(a.left, b.left);
    const top    = Math.max(a.top, b.top);
    const width  = Math.max(0, Math.min(a.right, b.right) - left);
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - top);

    return { x: left, y: top, width, height, top, left, right: left + width, bottom: top + height };
}

/**
 * `handle`'s ancestor-walk geometry, computed in one pass up to (but not
 * including) `root` — and bounded at `<html>` too, via {@link
 * ancestorsBefore}, since a caller's `root` is not guaranteed to be an
 * ancestor of `handle` at all:
 *
 * - `clippedToNothing`: whether an ancestor is currently clipping `handle`
 *   to nothing — `overflow`/`overflowX`/`overflowY` of `hidden` or `clip` on
 *   an ancestor whose own rendered rect has zero width or height. This is
 *   the signature a height-animated collapsible region (an `Accordion`
 *   section, a `Border` region, a `Split` pane, …) leaves on its content
 *   while collapsed — the content keeps its ordinary, unclipped layout size
 *   and position, so its own rect reports exactly where it would sit if the
 *   region were open, deceptively close to whatever genuinely visible
 *   content follows it in the document. A sibling merely scrolled out of an
 *   ordinary (non-zero-sized) scrolling container's view does not match
 *   this: only its position is offset, never its clipping ancestor's own
 *   size.
 * - `rect`: `handle`'s rect, intersected with every {@link CLIP_FRAME_ATTR}-
 *   marked ancestor's rect — the effective, visually truncated box a `Grid`
 *   cell's oversized child actually occupies. `Component.setClipFrame` parks
 *   such a child at its full, natural size *inside* a same-origin
 *   `overflow: hidden` frame sized to the cell, so `getElementRect` alone
 *   can report geometry spilling deep into a neighbouring cell — enough to
 *   put a genuinely-adjacent candidate's raw rect "behind" the origin on the
 *   spilling axis and drop it from ranking entirely. Deliberately narrower
 *   than the `clippedToNothing` check above: an ordinary scrolling
 *   container's own rect is left alone, so a candidate merely scrolled out
 *   of view keeps its full raw rect for the scrolling-container priority
 *   tier to reason about instead of collapsing to a zero-area intersection
 *   here.
 *
 * @param handle - The candidate to compute geometry for.
 * @param root - The bound to stop the ancestor walk at.
 */
function ancestorGeometry(handle: Handle, root: Handle): { clippedToNothing: boolean; rect: Rect } {
    let rect = DOM.source.getElementRect(handle);
    let clippedToNothing = false;

    for (const h of ancestorsBefore(handle, root)) {
        const { overflow, overflowX, overflowY } = DOM.source.getComputedOverflow(h);

        if ([overflow, overflowX, overflowY].some(value => value === "hidden" || value === "clip")) {
            const ancestorRect = DOM.source.getElementRect(h);

            if (ancestorRect.width === 0 || ancestorRect.height === 0) {
                clippedToNothing = true;
            }
        }

        if (DOM.source.hasAttribute(h, CLIP_FRAME_ATTR)) {
            rect = intersectRects(rect, DOM.source.getElementRect(h));
        }
    }

    return { clippedToNothing, rect };
}

/**
 * `handle`'s effective rect ({@link ancestorGeometry}) alone, for a caller —
 * `moveFocus`'s own origin — with no need for the accompanying
 * `clippedToNothing` check.
 *
 * @param handle - The element to compute the effective rect for.
 * @param root - The bound to stop the ancestor walk at.
 */
function effectiveRect(handle: Handle, root: Handle): Rect {
    return ancestorGeometry(handle, root).rect;
}

/**
 * The candidate set for `tier` inside `root`, paired with each handle's
 * current effective rect ({@link ancestorGeometry}): for the component tier,
 * every visible focusable element plus every visible, enabled
 * `RovingTabIndex` member ({@link rovingGroupMembers}) other than `origin`,
 * excluding one currently clipped to nothing by a collapsed ancestor ({@link
 * ancestorGeometry}) and any composite container whose own content is also
 * a candidate ({@link leafFocusables}); for the target tier, every visible
 * marked navigation target, with nested targets whose outer ancestor is also
 * a candidate resolved via {@link outermostTargets} first.
 */
function collectCandidates(root: Handle, origin: Handle, tier: SpatialTier): SpatialCandidate[] {
    if (tier === "target") {
        const targets = outermostTargets(
            DOM.source.querySelectorAll(root, NAVIGATION_TARGET_SELECTOR).filter(handle => DOM.source.isRenderedVisible(handle)),
            origin,
        );

        return targets.map(handle => ({ handle, rect: effectiveRect(handle, root) }));
    }

    const handles = leafFocusables(
        mergeHandles(visibleFocusable(root), rovingGroupMembers(root)).filter(handle => handle !== origin),
    );

    return handles
        .map(handle => ({ handle, geometry: ancestorGeometry(handle, root) }))
        .filter(entry => !entry.geometry.clippedToNothing)
        .map(entry => ({ handle: entry.handle, rect: entry.geometry.rect }));
}

/**
 * `origin`'s nearest registered {@link FocusReveal} ancestor element — its
 * nearest scrolling or hiding container — or null when it is inside none.
 *
 * @param origin - The element to find the nearest revealer for.
 */
function nearestRevealerElement(origin: Handle): Handle | null {
    const containing = FocusReveal.containing(origin);

    return containing.length > 0 ? containing[containing.length - 1].getRevealElement() : null;
}

/**
 * Ranks `candidates` in `direction` from `originRect`, keeping every
 * candidate inside `origin`'s nearest scrolling/hiding container ranked
 * ahead of every candidate outside it, however the two score against each
 * other — ranking each group separately with {@link rankInDirection} and
 * concatenating preserves each group's own internal order. Without this, a
 * sibling scrolled far enough out of its container's view can end up, in raw
 * page coordinates, farther from `origin` than some unrelated element
 * positioned elsewhere on the page (e.g. a fixed tab strip near the page's
 * top, while the scrolled-out sibling has been pushed up to that same
 * coordinate) — letting a move escape the container before it is actually
 * exhausted. `origin` having no such ancestor, or a candidate belonging to
 * none, ranks exactly as {@link rankInDirection} alone would rank it.
 *
 * @param originRect - The origin's rectangle.
 * @param origin - The origin element, used to find its nearest container.
 * @param candidates - The candidates to rank.
 * @param direction - The compass direction to search in.
 */
function rankWithContainerPriority(
    originRect: Rect,
    origin: Handle,
    candidates: readonly SpatialCandidate[],
    direction: SpatialDirection,
): Handle[] {
    const container = nearestRevealerElement(origin);

    if (container === null) {
        return rankInDirection(originRect, candidates, direction);
    }

    const inside:  SpatialCandidate[] = [];
    const outside: SpatialCandidate[] = [];

    for (const candidate of candidates) {
        (DOM.source.contains(container, candidate.handle) ? inside : outside).push(candidate);
    }

    return [
        ...rankInDirection(originRect, inside, direction),
        ...rankInDirection(originRect, outside, direction),
    ];
}

/**
 * `focusCandidates(root, recorded)`, with `root`'s own match demoted to the
 * very end whenever another candidate is available alongside it. A marked
 * container commonly carries its own focusable element too — `ToolBar`,
 * `MenuBar`, and `TabBar` all set their own `tabindex="0"`, as the single
 * roving-tabindex Tab stop a composite widget conventionally exposes — and
 * that must not pre-empt the coarse tier's actual job of handing off to the
 * container's remembered, or first, focusable descendant: landing on the
 * container itself leaves a following move with nothing reachable inside it
 * (every descendant sits geometrically inside the origin, not beside it in
 * any compass direction). `root` is still the sole, and so still the
 * landing, candidate for a genuine leaf navigation target that has no
 * descendant at all (a `TextArea` marked as its own target, say).
 *
 * @param root - The navigation target to land inside.
 * @param recorded - The previously-focused handle to prefer, if still live.
 */
function targetLandings(root: Handle, recorded: Handle | undefined): Handle[] {
    const candidates = focusCandidates(root, recorded);
    const rootIndex  = candidates.indexOf(root);

    if (rootIndex === -1 || candidates.length === 1) {
        return candidates;
    }

    return [...candidates.slice(0, rootIndex), ...candidates.slice(rootIndex + 1), root];
}

/**
 * Tries each of `ranked`'s handles in turn, revealing and focusing it, and
 * stops at the first that actually takes focus.
 *
 * @param ranked - The candidate handles to try, best first.
 * @param tier - Which candidate set `ranked` came from.
 * @returns True if focus moved.
 */
function tryFocusCandidates(ranked: readonly Handle[], tier: SpatialTier): boolean {
    for (const candidate of ranked) {
        const landings = tier === "component"
            ? [candidate]
            : targetLandings(candidate, _lastFocus.get(candidate));

        for (const landing of landings) {
            FocusReveal.reveal(landing);
            DOM.sink.focus(landing, { preventScroll: true });

            if (DOM.source.getActiveElement() === landing) {
                DOM.sink.edit(landing).attr(FOCUS_VISIBLE_ATTR, "true").commit();

                return true;
            }
        }
    }

    return false;
}

/**
 * Moves focus one step in `direction` for `tier`, walking the ranked
 * candidates and stopping at the first that actually takes focus.
 *
 * `getActiveElement()` never actually reports `null` in a real document —
 * once nothing has been explicitly focused, `document.activeElement` defaults
 * to `<body>` itself (`null` only ever happens in the offline test harness's
 * simplified model). Neither is a genuine point to search outward from:
 * ranking candidates against `<body>`'s own rect produced an
 * arbitrary-looking landing. Both fall back to {@link FocusTraversal}'s own
 * `stepFrom` helper's "nothing to continue from" convention instead — the
 * first candidate in DOM order for a forward (south/east) direction, the
 * last for a backward (north/west) one.
 *
 * @param direction - The direction to move focus in.
 * @param tier - Which candidate set to search.
 * @returns True if focus moved.
 */
function moveFocus(direction: SpatialDirection, tier: SpatialTier): boolean {
    const origin = DOM.source.getActiveElement();
    const root   = focusScopeRoot();

    if (origin === null || origin === DOM.source.getBody()) {
        const candidates = collectCandidates(root, DOM.source.getBody(), tier).map(entry => entry.handle);
        const forward    = direction === "south" || direction === "east";

        return tryFocusCandidates(forward ? candidates : [...candidates].reverse(), tier);
    }

    const originRect = effectiveRect(origin, root);

    if (originRect.width === 0 && originRect.height === 0) {
        return false;
    }

    pruneStaleMemory();
    recordOrigin(origin);

    const ranked = rankWithContainerPriority(originRect, origin, collectCandidates(root, origin, tier), direction);

    return tryFocusCandidates(ranked, tier);
}

/**
 * Document `focusout` handler: strips {@link FOCUS_VISIBLE_ATTR} off
 * whatever element just lost focus. Mirrors {@link FocusHistory}'s own
 * `onFocusIn` — the bubbling `focusout` (not the non-bubbling `blur`) is
 * this codebase's established idiom for tracking focus transitions at the
 * viewport level. Unconditional: `removeAttr` on an element that never
 * carried the marker is a harmless no-op, and this runs for every focus
 * transition on the page while the service is enabled, not only the ones it
 * drove itself — exactly like the marker's own lifecycle needs (it must
 * clear on a plain Tab or mouse-driven blur too, not only a subsequent
 * spatial-navigation move).
 *
 * @param e - The `FocusEvent`.
 */
function onFocusOut(e: FocusEvent): void {
    if (!DOM.source.isElement(e.target)) {
        return;
    }

    DOM.sink.apply(DOM.source.intern(e.target), { removeAttr: [FOCUS_VISIBLE_ATTR] });
}

/**
 * Document `keydown` handler: consumes the chord whenever {@link claimedTier}
 * resolves a tier, moving focus if a candidate takes it — the chord is
 * consumed either way, so a widget standing down never leaves the key doing
 * something else instead. An OS auto-repeat keydown (`e.repeat`) for a held
 * chord is still consumed but never moves focus a second time for one
 * physical press — the same guard `Button`'s own space-bar handler applies
 * to its press state.
 *
 * @param e - The keyboard event.
 * @returns `{ stop: true, prevent: true }` when a tier claims the key;
 *   nothing otherwise, so every other key keeps propagating.
 */
function onKeyDown(e: KeyboardEvent): Event.ListenerResult {
    const tier = claimedTier(e);

    if (tier === null) {
        return;
    }

    if (!e.repeat) {
        moveFocus(ARROW_DIRECTIONS[e.code], tier);
    }

    return { stop: true, prevent: true };
}

/**
 * Global spatial-focus-navigation service: moves keyboard focus to the
 * nearest candidate in the pressed direction. `Ctrl+Alt`+arrow (the
 * `"component"` tier) moves to the nearest individual focusable element;
 * `Ctrl+Shift`+arrow (the `"target"` tier) moves to the nearest container
 * marked via {@link Component.setNavigationTarget} and hands focus to that
 * container's remembered — or first — focusable descendant. When one marked
 * container nests another, a move approaching from outside both always lands
 * on the outer one first — see {@link outermostTargets} — which then hands
 * off to its own remembered descendant, drilling down through any further
 * nesting the same way; a move already inside the nest reaches the specific
 * inner container directly, since the outer one no longer lies in that
 * direction. When nothing is genuinely focused yet, a move lands on the
 * first candidate in DOM order (south/east) or the last (north/west)
 * instead of ranking against `<body>`'s own rect. The component tier never
 * lands on a composite widget's own wrapping container while a real
 * descendant is also a candidate ({@link leafFocusables}), and never on a
 * candidate a collapsed ancestor is currently clipping to nothing
 * ({@link ancestorGeometry}). Opt-in — call {@link enable} to start;
 * nothing auto-starts it.
 *
 * Any new framework arrow-key handler must guard itself with
 * {@link claimsKey} so it stands down while the service claims the same
 * key — see `docs/concepts/accessibility.md`'s "Spatial focus navigation"
 * section.
 *
 * @category Core
 */
export namespace SpatialNavigation {
    /**
     * Starts the service. Idempotent — calling it again while already
     * enabled only applies `options`.
     *
     * @param options - Optional modifier overrides, applied via
     * {@link configure} before enabling.
     */
    export function enable(options?: SpatialNavigationOptions): void {
        if (options) {
            configure(options);
        }

        if (_enabled) {
            return;
        }

        _enabled = true;

        Event.addViewportListener(_owner, "keydown", onKeyDown);
        Event.addViewportListener(_owner, "focusout", onFocusOut);
    }

    /**
     * Stops the service and empties the focus memory. Idempotent — the
     * listener detach only runs once — but the memory is always emptied,
     * even if the service was never enabled: `move()` populates `_lastFocus`
     * on its own, independent of the keyboard listeners `enable()` attaches.
     */
    export function disable(): void {
        _lastFocus.clear();

        if (!_enabled) {
            return;
        }

        _enabled = false;

        Event.removeViewportListener(_owner, "keydown", onKeyDown);
        Event.removeViewportListener(_owner, "focusout", onFocusOut);
    }

    /** Whether the service is currently active. */
    export function isEnabled(): boolean {
        return _enabled;
    }

    /**
     * Updates one or both tiers' modifier sets without toggling enablement.
     * Each field replaces its tier's whole set; an omitted field is untouched.
     *
     * @param options - The fields to update.
     */
    export function configure(options: SpatialNavigationOptions): void {
        if (options.componentModifiers !== undefined) {
            _componentModifiers = options.componentModifiers;
        }

        if (options.targetModifiers !== undefined) {
            _targetModifiers = options.targetModifiers;
        }
    }

    /**
     * Whether this key event belongs to the service, so a widget must not
     * act on it. True when the service is enabled, `e` matches either
     * tier's configured chord, and no registered layer's dismiss mode is
     * other than `"manual"` anywhere in the stack (see
     * {@link LayerManager.hasActiveInputLayer}).
     *
     * @param e - The keyboard event to test.
     */
    export function claimsKey(e: KeyboardEvent): boolean {
        return claimedTier(e) !== null;
    }

    /**
     * Moves focus one step in `direction` for `tier`.
     *
     * @param direction - The direction to move focus in.
     * @param tier - Which candidate set to search.
     * @returns True if focus moved.
     */
    export function move(direction: SpatialDirection, tier: SpatialTier): boolean {
        return moveFocus(direction, tier);
    }
}
