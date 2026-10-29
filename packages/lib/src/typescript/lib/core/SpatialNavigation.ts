// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, NAVIGATION_TARGET_ATTR, NAVIGATION_TARGET_SELECTOR, NAVIGATION_GROUP_ATTR, CLIP_FRAME_ATTR } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, Rect } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { FocusReveal } from "~/core/FocusReveal.js";
import { LayerManager } from "~/core/LayerManager.js";
import { FOCUSABLE_SELECTOR, focusCandidates, isLiveHandle, ancestorsToDocument, ancestorsBefore } from "~/core/Focusable.js";
import { ROVING_MEMBER_ATTR, ROVING_MEMBER_SELECTOR } from "~/core/RovingTabIndex.js";
import { MIN_VISIBLE_PX, project, gapBetween, spansOverlap, rankLevel } from "~/core/SpatialRanking.js";
import type { Span } from "~/core/SpatialRanking.js";

/**
 * A compass direction to search for a spatial-navigation candidate in.
 *
 * @category Core
 */
export type SpatialDirection = "north" | "south" | "east" | "west";

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
 * 1px negative — tolerating the sub-pixel overlap
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
    /** Coarse tier. Default `{ ctrl: true, alt: true, shift: true }`. Replaces the whole set, not merged. */
    targetModifiers?:    SpatialNavigationModifiers;
}

// The DOM attribute `moveFocus` mirrors onto whatever element it lands
// focus on — matched by a click-activated control's `:focus-visible` ring
// rule (`registerFocusVisibleRing`) alongside the native pseudo-class.
// Chromium's native `:focus-visible` heuristic does not treat a keydown with
// `ctrlKey` / `altKey` held as keyboard-navigation-worthy, even when it
// synchronously drives a real `.focus()` call — exactly the shape of this
// service's own `Ctrl+Alt` / `Ctrl+Alt+Shift` chords — so relying on the bare
// pseudo-class alone would silently never show a ring for either chord.
// Exported so `focusRing` reads the exact string this module writes.
export const FOCUS_VISIBLE_ATTR = "data-ts-ui-focus-visible";

/**
 * The one selector the control chord reads its candidates with: every
 * focusable element plus every `RovingTabIndex` member, whatever its current
 * `tabindex`. A single query returns them in document order, which is the
 * order equal scores are settled by. Exported so tests seed the exact string
 * the service queries.
 */
export const NAVIGATION_CANDIDATE_SELECTOR: string = FOCUSABLE_SELECTOR + ", " + ROVING_MEMBER_SELECTOR;

const ARROW_DIRECTIONS: Record<string, SpatialDirection> = {
    ArrowUp: "north", ArrowDown: "south", ArrowLeft: "west", ArrowRight: "east",
};

// Ctrl+Alt + arrow (fine) and Ctrl+Alt+Shift + arrow (coarse). Neither
// chord is bound by a browser, by native text editing, or by CodeMirror's
// default keymap, except Ctrl+Alt+Up/Down, which CodeEditor binds to
// add-cursor-above/below on Windows and Linux. GNOME binds Ctrl+Alt+arrow
// (switch workspace) and, on older releases, Ctrl+Alt+Shift+arrow (move
// the window to a workspace). These are documented trades; each tier's
// modifier set is configurable to work around them. The coarse tier was
// Ctrl+Shift + arrow in 0.10.0, which took word selection away from
// every text input.
const DEFAULT_COMPONENT_MODIFIERS: SpatialNavigationModifiers = { ctrl: true, alt: true };
const DEFAULT_TARGET_MODIFIERS:    SpatialNavigationModifiers = { ctrl: true, alt: true, shift: true };

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
 * the `findTabKeyOwner` walk in `core/Focusable.ts`.
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
 * `handle`'s rect, intersected with every {@link CLIP_FRAME_ATTR}-marked
 * ancestor's rect up to (but not including) `root` — and bounded at `<html>`
 * too, via {@link ancestorsBefore}, since a caller's `root` is not guaranteed
 * to be an ancestor of `handle` at all. This is the effective, visually
 * truncated box a `Grid` cell's oversized child actually occupies:
 * `Component.setClipFrame` parks such a child at its full, natural size
 * *inside* a same-origin `overflow: hidden` frame sized to the cell, so
 * `getElementRect` alone can report geometry spilling deep into a
 * neighbouring cell. Used by the target tier, whose candidates are whole
 * regions; the component tier clips by every clipping ancestor instead
 * ({@link describeControl}).
 *
 * @param handle - The element to compute the effective rect for.
 * @param root - The bound to stop the ancestor walk at.
 */
function effectiveRect(handle: Handle, root: Handle): Rect {
    let rect = DOM.source.getElementRect(handle);

    for (const h of ancestorsBefore(handle, root)) {
        const isClipFrame = DOM.source.hasAttribute(h, CLIP_FRAME_ATTR);

        if (isClipFrame) {
            rect = intersectRects(rect, DOM.source.getElementRect(h));
        }
    }

    return rect;
}

/**
 * The target tier's candidate set inside `root`, paired with each handle's
 * current effective rect ({@link effectiveRect}): every visible marked
 * navigation target, with nested targets whose outer ancestor is also a
 * candidate resolved via {@link outermostTargets} first.
 *
 * @param root - The search root.
 * @param origin - The element being moved away from.
 */
function collectTargets(root: Handle, origin: Handle): SpatialCandidate[] {
    const targets = outermostTargets(
        DOM.source.querySelectorAll(root, NAVIGATION_TARGET_SELECTOR).filter(handle => DOM.source.isRenderedVisible(handle)),
        origin,
    );

    return targets.map(handle => ({ handle, rect: effectiveRect(handle, root) }));
}

/** One clipping ancestor and its rectangle. */
interface ClipBox {
    handle: Handle;
    rect:   Rect;
}

/** One element with the geometry every control-chord rule needs. */
interface Control {
    handle: Handle;
    /** The element's own rectangle, unclipped. */
    rect:   Rect;
    /** Its clipping ancestors, innermost first, up to and including the search root. */
    clips:  ClipBox[];
    /** Its view rectangle — the part on screen — or null when it is not in view or is covered. */
    view:   Rect | null;
}

/** One level of the control chord's search: a group or a scroll viewport around the origin. */
interface SearchLevel {
    kind:    "group" | "viewport";
    element: Handle;
}

/** Per-move cache: an ancestor's clip box, or null when that ancestor does not clip. */
type ClipCache = Map<Handle, ClipBox | null>;

/** What one move reads once and every measurement of that move shares. */
interface MoveScope {
    /** The element the whole search stays inside. */
    root:            Handle;
    /** `<body>`, which is never a clipping ancestor. */
    body:            Handle;
    /** `<html>`, which is never a clipping ancestor either, and where every ancestor walk ends. */
    documentElement: Handle;
    /** The browser viewport, which stands in for the two as the outermost clip. */
    window:          Rect;
    /** Each ancestor's clip box, read at most once. */
    clipBoxes:       ClipCache;
}

/**
 * The element a whole move stays inside: the element of the registered layer
 * `origin` is in — a floating window, a drawer — or `<body>` when no layer
 * contains it or nothing is focused. Moves inside a window therefore never
 * leave it, and moves in the page behind it never enter it.
 *
 * @param origin - The focused element, or null when nothing is focused.
 * @returns The search root.
 */
function searchRoot(origin: Handle | null): Handle {
    if (origin === null) {
        return DOM.source.getBody();
    }

    const layerElement = LayerManager.getLayerContaining(origin)?.getLayerElement() ?? null;

    return layerElement ?? DOM.source.getBody();
}

/**
 * Reads what a move shares across all its measurements: the two elements
 * that never clip, the browser viewport, and an empty clip cache.
 *
 * @param root - The search root of the move.
 */
function openMoveScope(root: Handle): MoveScope {
    const { width, height } = DOM.source.getViewportSize();

    return {
        root,
        body:            DOM.source.getBody(),
        documentElement: DOM.source.getDocumentElement(),
        window:          { x: 0, y: 0, width, height, top: 0, left: 0, right: width, bottom: height },
        clipBoxes:       new Map<Handle, ClipBox | null>(),
    };
}

/** Whether `inner` lies wholly inside `outer`. */
function isRectInside(inner: Rect, outer: Rect): boolean {
    return inner.left >= outer.left && inner.right <= outer.right &&
        inner.top >= outer.top && inner.bottom <= outer.bottom;
}

/**
 * `handle`'s clip box when it clips its content, read once per move: an
 * element clips when its computed `overflow`, `overflow-x` or `overflow-y` is
 * anything but `visible`, or when it carries {@link CLIP_FRAME_ATTR}.
 *
 * @param handle - The ancestor to test.
 * @param cache - This move's clip cache.
 * @returns The clip box, or null when `handle` does not clip.
 */
function clipBoxOf(handle: Handle, cache: ClipCache): ClipBox | null {
    const cached = cache.get(handle);

    if (cached !== undefined) {
        return cached;
    }

    const { overflow, overflowX, overflowY } = DOM.source.getComputedOverflow(handle);

    const clips = [overflow, overflowX, overflowY].some(value => value !== "visible") ||
        DOM.source.hasAttribute(handle, CLIP_FRAME_ATTR);

    const box = clips ? { handle, rect: DOM.source.getElementRect(handle) } : null;

    cache.set(handle, box);

    return box;
}

/**
 * `handle`'s clipping ancestors, innermost first, from its parent up to and
 * including the search root. `<body>` and `<html>` are never clipping
 * ancestors — their rectangles are not reliable clip boxes, and the browser
 * viewport stands in for them. The walk is bounded at `<html>`, so it never
 * reaches the `document` node when `handle` is mounted outside the root.
 *
 * @param handle - The element whose clipping ancestors to collect.
 * @param scope - This move's shared readings.
 */
function clipChain(handle: Handle, scope: MoveScope): ClipBox[] {
    const parent = DOM.source.getParentNode(handle);
    const boxes: ClipBox[] = [];

    if (parent === null) {
        return boxes;
    }

    for (const ancestor of ancestorsToDocument(parent)) {
        if (ancestor !== scope.body && ancestor !== scope.documentElement) {
            const box = clipBoxOf(ancestor, scope.clipBoxes);

            if (box !== null) {
                boxes.push(box);
            }
        }

        if (ancestor === scope.root) {
            break;
        }
    }

    return boxes;
}

/** `rect` intersected with every box in `boxes`. */
function clipTo(rect: Rect, boxes: readonly ClipBox[]): Rect {
    return boxes.reduce((clipped, box) => intersectRects(clipped, box.rect), rect);
}

/**
 * Whether `clipped` — what is left of an element after clipping — still shows
 * enough of it to count: `full` is not empty, and on each axis `clipped`
 * shows {@link MIN_VISIBLE_PX} or the element's whole extent, whichever is
 * less.
 *
 * @param clipped - The element's rectangle after clipping.
 * @param full - The element's own rectangle.
 */
function hasExtent(clipped: Rect, full: Rect): boolean {
    if (full.width <= 0 || full.height <= 0) {
        return false;
    }

    return clipped.width >= Math.min(MIN_VISIBLE_PX, full.width) &&
        clipped.height >= Math.min(MIN_VISIBLE_PX, full.height);
}

/**
 * The rectangles of every open layer stacked above the search root — what can
 * hide a control from view. With `<body>` as the root that is every open
 * layer; with a layer's element as the root, only the layers above that one.
 *
 * @param root - The search root.
 */
function coveringRects(root: Handle): Rect[] {
    const rootLayer = LayerManager.getLayerContaining(root);
    const rects: Rect[] = [];

    for (const layer of LayerManager.getLayers()) {
        if (layer === rootLayer) {
            continue;
        }

        const stackedAbove = rootLayer === null ||
            LayerManager.getZIndex(layer) > LayerManager.getZIndex(rootLayer);

        if (!stackedAbove) {
            continue;
        }

        const element = layer.getLayerElement();

        if (element === null) {
            continue;
        }

        const rendered = DOM.source.isRenderedVisible(element);

        if (rendered) {
            rects.push(DOM.source.getElementRect(element));
        }
    }

    return rects;
}

/**
 * Measures one element for the control chord: its own rectangle, its clipping
 * ancestors, and its view rectangle — its own rectangle intersected with
 * every clipping ancestor and with the browser viewport. The view rectangle
 * is null when too little of the element shows ({@link hasExtent}) or when
 * what shows lies wholly inside one of `covers`.
 *
 * @param handle - The element to measure.
 * @param scope - This move's shared readings.
 * @param covers - Rectangles of the layers stacked above the search root.
 */
function describeControl(handle: Handle, scope: MoveScope, covers: readonly Rect[]): Control {
    const rect  = DOM.source.getElementRect(handle);
    const clips = clipChain(handle, scope);
    const shown = intersectRects(clipTo(rect, clips), scope.window);

    return { handle, rect, clips, view: showsUncovered(shown, rect, covers) ? shown : null };
}

/**
 * Whether `shown` — what is on screen of an element whose own rectangle is
 * `full` — counts as visible: enough of it shows ({@link hasExtent}), and it
 * does not lie wholly inside one of `covers`.
 *
 * @param shown - The part of the element that is on screen.
 * @param full - The element's own rectangle.
 * @param covers - Rectangles of the layers stacked above the search root.
 */
function showsUncovered(shown: Rect, full: Rect, covers: readonly Rect[]): boolean {
    return hasExtent(shown, full) && !covers.some(cover => isRectInside(shown, cover));
}

/** Whether `handle` is an enabled control: no `disabled` attribute, and `aria-disabled` is not `"true"`. */
function isEnabledControl(handle: Handle): boolean {
    return !DOM.source.hasAttribute(handle, "disabled") &&
        DOM.source.getAttribute(handle, "aria-disabled") !== "true";
}

/**
 * The control chord's candidates inside `root`, in document order, each
 * measured by {@link describeControl}: every focusable element and every
 * `RovingTabIndex` member that is enabled and rendered, other than `origin`,
 * after {@link leafFocusables} has dropped a composite container whose own
 * content is also a candidate. A control that contains `origin`, or sits
 * inside it, is dropped too: it is never ahead of the control focus is
 * already on, even when the move starts from a row or cell inside that
 * control.
 *
 * @param origin - The focused element, or null when nothing is focused.
 * @param scope - This move's shared readings.
 * @param covers - Rectangles of the layers stacked above the search root.
 */
function collectControls(origin: Handle | null, scope: MoveScope, covers: readonly Rect[]): Control[] {
    const eligible = DOM.source.querySelectorAll(scope.root, NAVIGATION_CANDIDATE_SELECTOR)
        .filter(handle => handle !== origin && isEnabledControl(handle) && DOM.source.isRenderedVisible(handle));

    return leafFocusables(eligible)
        .filter(handle => origin === null ||
            (!DOM.source.contains(origin, handle) && !DOM.source.contains(handle, origin)))
        .map(handle => describeControl(handle, scope, covers));
}

/**
 * `outer`'s extent along the arrow of `direction` joined with `inner`'s
 * extent across it: for a vertical move, `outer`'s top and bottom with
 * `inner`'s left and right.
 *
 * @param outer - The rectangle that supplies the extent along the arrow.
 * @param inner - The rectangle that supplies the extent across the arrow.
 * @param direction - The direction of the move.
 */
function alongAndAcross(outer: Rect, inner: Rect, direction: SpatialDirection): Rect {
    const vertical = direction === "north" || direction === "south";
    const left     = vertical ? inner.left : outer.left;
    const right    = vertical ? inner.right : outer.right;
    const top      = vertical ? outer.top : inner.top;
    const bottom   = vertical ? outer.bottom : inner.bottom;

    return { x: left, y: top, width: right - left, height: bottom - top, top, left, right, bottom };
}

/**
 * The element a move starts from, measured. For a widget that names a
 * current row or cell with `aria-activedescendant` — a `Tree`, a `List`, a
 * `Table` — the move starts level with that row or cell and from the
 * widget's own edge: the row or cell supplies the rectangle's extent across
 * the arrow, the widget its extent along it ({@link alongAndAcross}). `→`
 * from a tree therefore lands level with the current row, while `↓` from
 * that same tree still lands on what is below the tree, not on something
 * beside the row. The named element must be inside `origin` and in view;
 * otherwise — a field whose active descendant lives in a dropdown elsewhere,
 * a row scrolled out of its widget — `origin` is measured whole.
 *
 * @param origin - The focused element.
 * @param direction - The direction of the move.
 * @param scope - This move's shared readings.
 */
function originAnchor(origin: Handle, direction: SpatialDirection, scope: MoveScope): Control {
    const whole    = describeControl(origin, scope, []);
    const activeId = DOM.source.getAttribute(origin, "aria-activedescendant");
    const active   = activeId ? DOM.source.getElementById(activeId) : null;
    const isInside = active !== null && active !== origin && DOM.source.contains(origin, active);

    if (active === null || !isInside) {
        return whole;
    }

    const current = describeControl(active, scope, []);

    if (whole.view === null || current.view === null) {
        return whole;
    }

    return {
        handle: origin,
        rect:   alongAndAcross(whole.rect, intersectRects(current.rect, whole.rect), direction),
        clips:  whole.clips,
        view:   alongAndAcross(whole.view, current.view, direction),
    };
}

/**
 * The view rectangle of `origin`'s nearest ancestor that has one — where a
 * move starts from when `origin` itself has been scrolled or clipped out of
 * sight.
 *
 * @param origin - The focused element.
 * @param scope - This move's shared readings; the walk stops before its root.
 * @returns The rectangle, or null when no ancestor is in view either.
 */
function nearestAncestorView(origin: Handle, scope: MoveScope): Rect | null {
    for (const ancestor of ancestorsBefore(origin, scope.root)) {
        const view = describeControl(ancestor, scope, []).view;

        if (view !== null) {
            return view;
        }
    }

    return null;
}

/**
 * The scroll viewport of every registered {@link FocusRevealer} around
 * `origin` that reveals by scrolling. A revealer's viewport is not always an
 * ancestor of `origin` — a `ScrollStrip`'s arrow buttons sit inside the strip
 * but outside its clip — so {@link searchLevels} keeps only the ones it meets
 * on the way up from `origin`.
 *
 * @param origin - The focused element.
 */
function scrollViewportsOf(origin: Handle): Set<Handle> {
    const viewports = new Set<Handle>();

    for (const revealer of FocusReveal.containing(origin)) {
        const viewport = revealer.getScrollViewportElement?.() ?? null;

        if (viewport !== null) {
            viewports.add(viewport);
        }
    }

    return viewports;
}

/**
 * The levels a move searches before the search root, innermost first: each
 * ancestor of `origin` below `root` that is a scroll viewport or carries
 * {@link NAVIGATION_GROUP_ATTR}. Walking `origin`'s own ancestors is what
 * limits the scroll viewports to the ones that contain it.
 *
 * @param origin - The focused element.
 * @param root - The search root, which is the last level and not listed.
 */
function searchLevels(origin: Handle, root: Handle): SearchLevel[] {
    const viewports = scrollViewportsOf(origin);
    const levels: SearchLevel[] = [];

    for (const ancestor of ancestorsBefore(origin, root)) {
        const isViewport = viewports.has(ancestor);
        const isGroup    = DOM.source.hasAttribute(ancestor, NAVIGATION_GROUP_ATTR);

        if (isViewport) {
            levels.push({ kind: "viewport", element: ancestor });
        } else if (isGroup) {
            levels.push({ kind: "group", element: ancestor });
        }
    }

    return levels;
}

/**
 * `control`'s rectangle as content of the scroll viewport `viewport`: its own
 * rectangle intersected only with the clipping ancestors strictly inside
 * `viewport`. The viewport's own clip — and everything outside it — is left
 * out, so a control merely scrolled out of the viewport keeps its extent
 * while one clipped away by something inside it does not.
 *
 * @param control - A control inside `viewport`.
 * @param viewport - The scroll viewport's element.
 */
function contentRectIn(control: Control, viewport: Handle): Rect {
    // `contains` is inclusive, so the viewport itself must be excluded by hand.
    const inside = control.clips.filter(box =>
        box.handle !== viewport && DOM.source.contains(viewport, box.handle));

    return clipTo(control.rect, inside);
}

/** The controls that are in view, each as a candidate ranked by its view rectangle. */
function viewCandidates(controls: readonly Control[]): SpatialCandidate[] {
    const candidates: SpatialCandidate[] = [];

    for (const control of controls) {
        if (control.view !== null) {
            candidates.push({ handle: control.handle, rect: control.view });
        }
    }

    return candidates;
}

/**
 * The least shift that brings the span `start`–`end` inside `min`–`max`. A
 * span longer than the range keeps its start on the range's start.
 *
 * @param start - The span's start.
 * @param end - The span's end.
 * @param min - The range's start.
 * @param max - The range's end.
 */
function shiftInto(start: number, end: number, min: number, max: number): number {
    if (start < min) {
        return min - start;
    }

    if (end > max) {
        return Math.max(max - end, min - start);
    }

    return 0;
}

/**
 * Where `rect` sits once `box` — a scroll viewport's own box — has scrolled
 * the least amount that brings it inside, which is what revealing a control
 * does. A rectangle already inside `box` does not move.
 *
 * @param rect - A rectangle of the viewport's content.
 * @param box - The viewport's own rectangle.
 */
function scrolledInto(rect: Rect, box: Rect): Rect {
    const dx = shiftInto(rect.left, rect.right, box.left, box.right);
    const dy = shiftInto(rect.top, rect.bottom, box.top, box.bottom);

    return {
        x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height,
        top: rect.top + dy, left: rect.left + dx, right: rect.right + dx, bottom: rect.bottom + dy,
    };
}

/**
 * The candidates a group level accepts for a move, best first: the in-view
 * controls inside the group that are in line with the origin.
 *
 * @param group - The group's element.
 * @param originView - The rectangle the move starts from.
 * @param controls - Every candidate of the move.
 * @param direction - The direction of the move.
 */
function rankGroupLevel(
    group:      Handle,
    originView: Rect,
    controls:   readonly Control[],
    direction:  SpatialDirection,
): Handle[] {
    const inside = controls.filter(control => DOM.source.contains(group, control.handle));

    return rankLevel(originView, viewCandidates(inside), direction, "line", null);
}

/**
 * The candidates a scroll-viewport level accepts for a move, best first: the
 * controls inside the viewport that are in line with the origin, each
 * measured as content of the viewport ({@link contentRectIn}) so one scrolled
 * out of it counts. A control counts only when landing on it would show
 * something: once the viewport has scrolled it in ({@link scrolledInto}) it
 * must show inside the part of the viewport that is itself on screen, and not
 * wholly behind a layer. The level is skipped when the origin has no extent
 * inside the viewport, or when none of the viewport is on screen.
 *
 * @param viewport - The scroll viewport's element.
 * @param anchor - The measured element the move starts from.
 * @param controls - Every candidate of the move.
 * @param direction - The direction of the move.
 * @param scope - This move's shared readings.
 * @param covers - Rectangles of the layers stacked above the search root.
 */
function rankViewportLevel(
    viewport:  Handle,
    anchor:    Control,
    controls:  readonly Control[],
    direction: SpatialDirection,
    scope:     MoveScope,
    covers:    readonly Rect[],
): Handle[] {
    const from         = contentRectIn(anchor, viewport);
    const originInside = hasExtent(from, anchor.rect);
    const frame        = describeControl(viewport, scope, []);

    if (!originInside || frame.view === null) {
        return [];
    }

    const pool: SpatialCandidate[] = [];

    for (const control of controls) {
        const inside = DOM.source.contains(viewport, control.handle);

        if (!inside) {
            continue;
        }

        const rect      = contentRectIn(control, viewport);
        const revealed  = intersectRects(scrolledInto(rect, frame.rect), frame.view);
        const reachable = showsUncovered(revealed, control.rect, covers);

        if (reachable) {
            pool.push({ handle: control.handle, rect });
        }
    }

    return rankLevel(from, pool, direction, "line", null);
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
 * Asks `landing` to take focus, without letting the browser scroll for it.
 *
 * @param landing - The element to focus.
 * @returns True when `landing` is the focused element afterwards.
 */
function takesFocus(landing: Handle): boolean {
    DOM.sink.focus(landing, { preventScroll: true });

    return DOM.source.getActiveElement() === landing;
}

/**
 * Tries to land focus on one element. The target tier reveals the element
 * first — it lands inside collapsed regions, which cannot take focus until
 * they open. The component tier focuses first and reveals only on success:
 * its candidates are already focusable, so a candidate that refuses focus
 * scrolls nothing and leaves no trace. A landing is marked
 * {@link FOCUS_VISIBLE_ATTR} either way.
 *
 * @param landing - The element to focus.
 * @param tier - Which tier the landing is for.
 * @returns True when `landing` took focus.
 */
function landOn(landing: Handle, tier: SpatialTier): boolean {
    if (tier === "target") {
        FocusReveal.reveal(landing);
    }

    const focused = takesFocus(landing);

    if (!focused) {
        return false;
    }

    if (tier === "component") {
        FocusReveal.reveal(landing);
    }

    DOM.sink.edit(landing).attr(FOCUS_VISIBLE_ATTR, "true").commit();

    return true;
}

/**
 * Tries each of `ranked`'s handles in turn and stops at the first that
 * actually takes focus ({@link landOn}).
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
            const landed = landOn(landing, tier);

            if (landed) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Moves focus one step in `direction` for the component tier — the control
 * chord. The candidates are the enabled, rendered controls inside `root`
 * ({@link collectControls}); one that is not in view, or is wholly behind a
 * layer, is not a candidate. The move starts level with the origin's current
 * row or cell when it has one ({@link originAnchor}), and searches level by
 * level: each group and scroll viewport around the origin, innermost first,
 * then the whole search root. An inner level accepts only candidates in line
 * with the origin; the search root also accepts one in the cone the arrow
 * points into and one in line with the origin's group. The first level with
 * a candidate that takes focus decides the move; when none does, focus stays
 * where it is and nothing is written or scrolled.
 *
 * With nothing focused there is no point to search outward from, so the move
 * lands on the first in-view candidate in document order for a forward
 * (south/east) direction and the last for a backward (north/west) one. The
 * same holds when focus is on the search root itself: a floating window
 * focuses its own element when it is activated, and every control in it is
 * inside that element.
 *
 * @param direction - The direction to move focus in.
 * @param origin - The focused element, or null when nothing is focused.
 * @param root - The search root.
 * @returns True if focus moved.
 */
function moveComponentFocus(direction: SpatialDirection, origin: Handle | null, root: Handle): boolean {
    const start    = origin === root ? null : origin;
    const scope    = openMoveScope(root);
    const covers   = coveringRects(root);
    const controls = collectControls(start, scope, covers);
    const inView   = viewCandidates(controls);

    if (start === null) {
        const handles = inView.map(candidate => candidate.handle);
        const forward = direction === "south" || direction === "east";

        return tryFocusCandidates(forward ? handles : handles.reverse(), "component");
    }

    const anchor     = originAnchor(start, direction, scope);
    const originView = anchor.view ?? nearestAncestorView(start, scope);

    if (originView === null) {
        return false;
    }

    pruneStaleMemory();
    recordOrigin(start);

    const levels = searchLevels(start, root);

    for (const level of levels) {
        const ranked = level.kind === "group"
            ? rankGroupLevel(level.element, originView, controls, direction)
            : rankViewportLevel(level.element, anchor, controls, direction, scope, covers);

        const moved = tryFocusCandidates(ranked, "component");

        if (moved) {
            return true;
        }
    }

    const group     = levels.find(level => level.kind === "group");
    const groupRect = group ? describeControl(group.element, scope, []).view : null;

    return tryFocusCandidates(rankLevel(originView, inView, direction, "open", groupRect), "component");
}

/**
 * Moves focus one step in `direction` for the target tier — the region
 * chord — walking the ranked navigation targets and stopping at the first
 * that actually takes focus. With nothing focused it lands in the first
 * target in document order for a forward (south/east) direction and the last
 * for a backward (north/west) one.
 *
 * @param direction - The direction to move focus in.
 * @param origin - The focused element, or null when nothing is focused.
 * @param root - The search root.
 * @returns True if focus moved.
 */
function moveTargetFocus(direction: SpatialDirection, origin: Handle | null, root: Handle): boolean {
    if (origin === null) {
        const candidates = collectTargets(root, DOM.source.getBody()).map(entry => entry.handle);
        const forward    = direction === "south" || direction === "east";

        return tryFocusCandidates(forward ? candidates : [...candidates].reverse(), "target");
    }

    const originRect = effectiveRect(origin, root);

    if (originRect.width === 0 && originRect.height === 0) {
        return false;
    }

    pruneStaleMemory();
    recordOrigin(origin);

    const ranked = rankWithContainerPriority(originRect, origin, collectTargets(root, origin), direction);

    return tryFocusCandidates(ranked, "target");
}

/**
 * Moves focus one step in `direction` for `tier`: resolves the origin and the
 * search root, then hands over to the tier's own move.
 *
 * `getActiveElement()` never actually reports `null` in a real document —
 * once nothing has been explicitly focused, `document.activeElement` defaults
 * to `<body>` itself (`null` only ever happens in the offline test harness's
 * simplified model). Neither is a genuine point to search outward from:
 * ranking candidates against `<body>`'s own rect produced an
 * arbitrary-looking landing. Both are passed on as "no origin", and each tier
 * falls back to {@link FocusTraversal}'s own `stepFrom` helper's "nothing to
 * continue from" convention instead — the first candidate in DOM order for a
 * forward (south/east) direction, the last for a backward (north/west) one.
 *
 * @param direction - The direction to move focus in.
 * @param tier - Which candidate set to search.
 * @returns True if focus moved.
 */
function moveFocus(direction: SpatialDirection, tier: SpatialTier): boolean {
    const active = DOM.source.getActiveElement();
    const origin = active === null || active === DOM.source.getBody() ? null : active;
    const root   = searchRoot(origin);

    return tier === "component"
        ? moveComponentFocus(direction, origin, root)
        : moveTargetFocus(direction, origin, root);
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
 * Global spatial-focus-navigation service: moves keyboard focus by
 * direction. `Ctrl+Alt`+arrow (the `"component"` tier, the control chord)
 * moves to a single control; `Ctrl+Alt+Shift`+arrow (the `"target"` tier, the
 * region chord) moves to the nearest container marked via
 * {@link Component.setNavigationTarget} and hands focus to that container's
 * remembered — or first — focusable descendant. Opt-in — call
 * {@link enable} to start; nothing auto-starts it.
 *
 * The control chord moves to the control a person would point at as the next
 * one that way. Only an enabled control that is in view is a candidate — not
 * one scrolled out of another panel, clipped away, off screen, or wholly
 * behind a floating window — and never a composite widget's own wrapping
 * container while a real descendant is also a candidate. A move looks
 * outward from the focused control: through each row of controls (a
 * container marked via {@link Component.setNavigationGroup}) and each
 * scrolling panel it is inside, nearest first, then everywhere else. Inside
 * a row or a panel only a control in line with the focused one counts, and a
 * control scrolled out of the panel still counts and is scrolled into view on
 * landing; everywhere else a control must be in line with the focused one, or
 * at least as far forward as it is sideways. A `Tree`, `List` or `Table`
 * moves level with its current row or cell, from the widget's own edge.
 * When nothing qualifies, focus stays where it is.
 *
 * When one marked region-chord container nests another, a move approaching
 * from outside both always lands on the outer one first, which then hands off
 * to its own remembered descendant, drilling down through any further nesting
 * the same way; a move already inside the nest reaches the specific inner
 * container directly, since the outer one no longer lies in that direction.
 *
 * Both chords stay inside the floating window focus is in, and never enter
 * one from the page behind it. When nothing is genuinely focused yet, a move
 * lands on the first candidate in DOM order (south/east) or the last
 * (north/west) instead of ranking against `<body>`'s own rect; the control
 * chord does the same when focus is on a floating window's own element.
 *
 * Any new framework arrow-key handler must guard itself with
 * {@link claimsKey} so it stands down while the service claims the same
 * key — see `docs/concepts/accessibility.md`'s "Spatial focus navigation"
 * section.
 *
 * @category Core
 */
/**
 * Forgets the service's state in the DOM environment a sink swap replaces: it
 * reports itself disabled, because `Event` drops its viewport listeners on the
 * same swap, and the focus memory is emptied, because it maps handles the
 * outgoing sink minted. The modifier configuration stays. Registered with
 * `DOM.onSinkChange` below and called from nowhere else.
 */
function forgetEnvironment(): void {
    _enabled = false;
    _lastFocus.clear();
}

DOM.onSinkChange(forgetEnvironment);

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
