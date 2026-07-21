// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DragFeedback } from "~/overlay/DragFeedback.js";
import { DragGhost } from "~/overlay/DragGhost.js";
import { Event } from "~/core/Event.js";
import { ReorderIndicator } from "~/overlay/ReorderIndicator.js";
import { DOM } from "~/core/DOM.js";

/**
 * Arbitrary, caller-defined payload attached to a drag source — the
 * shape is consumer-domain and the manager never inspects fields.
 *
 * @category Core
 */
export type DragData = Record<string, unknown>;

/**
 * Payload delivered to every named drag-source / drop-target callback
 * and to every fired DOM event. Field names are stable across
 * `dragstart`, `dragover`, `dragleave`, `drop`, `dragend`.
 *
 * @category Core
 */
export interface DragEventDetail {
    /** The source's resolved drag data — read from the source options at session start. */
    dragData : DragData;
    /** The source component's id (`getId()`), useful for cycle / self-drop checks. */
    sourceId : string;
    /** Viewport-relative pointer X at the moment the event was raised. */
    clientX  : number;
    /** Viewport-relative pointer Y at the moment the event was raised. */
    clientY  : number;
}

/**
 * Drag-data payload attached to every tab-header drag — the cross-container
 * contract shared by the within-strip reorder path, tab tear-off / re-dock, the
 * Ctrl-drag window re-dock, and the downstream edge-split / dock-manager work.
 * A drop target reads it off {@link DragEventDetail}'s `dragData`. Because
 * {@link DragData} is a plain record it cannot carry a live component reference,
 * so `componentId` keys into the module-level `tabDragRegistry` to resolve the
 * dragged content.
 *
 * @category Core
 */
export interface TabDragData {
    /** Discriminator a drop target tests in its `accepts` predicate. */
    tabDrag:     true;
    /** The source strip's stable id — distinguishes reorder-within from dock-from-elsewhere. */
    sourceTabId: string;
    /** The dragged content component's id — the key into `tabDragRegistry`. */
    componentId: string;
    /** The tab label — used for the drag ghost and the tear-off window title. */
    label:       string;
}

/**
 * Resolves a {@link TabDragData} `componentId` back to the live content
 * component being dragged. Written when a header drag starts and cleared when it
 * ends, so a drop target — the same strip, another strip, or a torn-off
 * {@link DragData}-carrying window — can move the real component rather than
 * only learning its id. Shared by-import across `Tab` and `Window`; one
 * instance, so a source-side write is visible to the destination-side read.
 */
export const tabDragRegistry: Map<string, Component> = new Map<string, Component>();

/**
 * Dwell, in milliseconds, before a tab held over a drop target spring-loads a
 * raise of that target's host window — surfacing a backgrounded float so the user
 * can aim the drop. Shared by the two dock drop surfaces so a region body
 * ([`DockRegion`](/api/layout/classes/DockRegion)) and a tab bar
 * ([`TabBar`](/api/component/container/classes/TabBar)) raise on the same cadence.
 *
 * Long enough that brushing a drag across a background window in transit does not
 * raise it, short enough that a deliberate hover surfaces the target. Set above a
 * `MenuItem` submenu's 150ms hover delay because raising a whole window is a
 * heavier, more disruptive action than opening a submenu, so it should demand a
 * clearly deliberate pause.
 */
export const SPRING_RAISE_DELAY_MS = 1000;

/**
 * Construction-time options accepted by {@link DragManager.makeDragSource}.
 *
 * @category Core
 */
export interface DragSourceOptions {
    /** Static or factory-produced payload attached to the session. */
    dragData     : DragData | (() => DragData);
    /**
     * Optional veto callback fired the moment the threshold is crossed.
     * Return `false` to abort the drag before any overlay is shown.
     */
    onDragStart? : (detail: DragEventDetail) => boolean | void;
    /**
     * Optional ghost factory. The returned component is used in place of
     * the manager's default ghost (which carries no label and matches the
     * source's size). The component must be detached when returned.
     */
    ghostFactory?: (source: Component, data: DragData) => Component;
    /** CSS cursor applied to `<body>` while the drag is active. */
    cursor?      : string;
    /**
     * Fired once the gesture ends, after any `onDrop`. `dropped` is `true` when
     * the release was handled by a registered drop target — whether the target
     * accepted the drop or refused it — and `false` only on a release over empty
     * space. Lets a source distinguish a release that landed on a target from a
     * fall-through to empty space (e.g. tab tear-off), the signal the `"dragend"`
     * DOM event alone cannot carry.
     */
    onDragEnd?   : (detail: DragEventDetail, dropped: boolean) => void;
}

/**
 * Construction-time options accepted by {@link DragManager.makeDropTarget}.
 *
 * @category Core
 */
export interface DropTargetOptions {
    /**
     * Validity predicate. Returns `true` when the dragged source may
     * drop on this target; the visual feedback tint mirrors the result.
     */
    accepts      : (detail: DragEventDetail) => boolean;
    /**
     * Optional hover callback. Return a number to position the
     * [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator) at the
     * given y inside the target; return `null` / `undefined` for no
     * reorder line.
     */
    onDragOver?  : (detail: DragEventDetail) => number | null | void;
    /** Optional leave callback (cursor exits target's box). */
    onDragLeave? : (detail: DragEventDetail) => void;
    /** Optional drop callback — return `false` to suppress the `drop` event. */
    onDrop?      : (detail: DragEventDetail) => boolean | void;
    /**
     * Suppresses the whole-target validity tint
     * ([`DragFeedback`](/api/overlay/classes/DragFeedback)) for this target. Pass it
     * when the target paints its own positional validity feedback (e.g. a
     * [`DockRegion`](/api/layout/classes/DockRegion) colours the drop *zone*
     * blue/red in `onDragOver`) so the two don't stack into a tinted frame *and*
     * a tinted zone. `accepts` still governs whether `onDragOver`/`onDrop` fire.
     */
    suppressValidityTint?: boolean;
    /**
     * Optional non-scrolling layer to host the validity tint, sized to the
     * target's box within it. Pass it when the target scrolls its own content
     * (e.g. a Tab strip's clip frame) so the tint overlays the *viewport* and
     * stays put instead of riding the scroll. Defaults to the target itself.
     */
    feedbackHost?: Component;
}

interface DragSourceRecord {
    component: Component;
    options:   DragSourceOptions;
}

interface DropTargetRecord {
    component: Component;
    options:   DropTargetOptions;
}

interface DragSession {
    source:           Component;
    sourceOptions:    DragSourceOptions;
    dragData:         DragData;
    startX:           number;
    startY:           number;
    committed:        boolean;
    ghost:            Component | null;
    feedback:         DragFeedback | null;
    indicator:        ReorderIndicator | null;
    currentTarget:    Component | null;
    previousBodyCursor: string;
}

/**
 * Distance the cursor must travel between `mousedown` and `mousemove`
 * before the press-and-drag commits to a drag. The 4 px slop matches
 * the standard HIG threshold on Windows and macOS — anything shorter
 * fires a drag on plain clicks; anything longer feels unresponsive.
 */
const DRAG_THRESHOLD = 4;

/**
 * Diagonal offsets applied to the ghost's top-left corner so the cursor
 * stays clear of the preview. Matches Finder / VS Code placement.
 */
const GHOST_OFFSET_X = 12;
const GHOST_OFFSET_Y = 12;

const dragSources = new Map<string, DragSourceRecord>();
const dropTargets = new Map<string, DropTargetRecord>();
let activeSession: DragSession | null = null;

/**
 * Process-wide drag-and-drop coordinator. Maintains the global source /
 * target registry, owns the single active drag session, and
 * positions the three overlay components
 * ([`DragGhost`](/api/overlay/classes/DragGhost),
 * [`DragFeedback`](/api/overlay/classes/DragFeedback),
 * [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator)) above the
 * page during a drag.
 *
 * Consumers register through the two factory functions and receive a
 * teardown closure to unwire when the source / target component goes
 * away. The manager itself fires no events directly — every callback
 * lives on the option bag the caller passed to the factory.
 *
 * @example
 * ```typescript
 * const tearDownSrc = DragManager.makeDragSource(row, {
 *     dragData: () => ({ recordId: row.getRecord()?.get('id') }),
 * });
 * const tearDownTgt = DragManager.makeDropTarget(folder, {
 *     accepts: (d) => d.dragData.recordId !== folder.getRecord()?.get('id'),
 *     onDrop:  (d) => moveRecord(d.dragData.recordId, folder),
 * });
 * ```
 *
 * @category Core
 */
export namespace DragManager {

    /**
     * Registers a component as a drag source. The component's mousedown
     * event begins a pending drag session that commits once the cursor
     * travels past the 4 px movement threshold.
     *
     * @param component - The source component.
     * @param options - Drag source configuration.
     *
     * @returns A teardown function that removes the source registration
     *   and the mousedown listener.
     */
    export function makeDragSource(component: Component, options: DragSourceOptions): () => void {
        dragSources.set(component.getId(), { component, options });
        component.addMouseDownSubtreeListener(onSourceMouseDown);

        return tearDownDragSource.bind(null, component);
    }

    /**
     * Registers a component as a drop target. The component is queried
     * for `accepts` during every `mousemove` while a drag is active and
     * receives the configured callbacks at the appropriate phases.
     *
     * @param component - The drop target.
     * @param options - Drop target configuration.
     *
     * @returns A teardown function that removes the target registration.
     */
    export function makeDropTarget(component: Component, options: DropTargetOptions): () => void {
        dropTargets.set(component.getId(), { component, options });

        return tearDownDropTarget.bind(null, component);
    }

    /**
     * Returns whether a drag is currently in progress (committed past
     * the 4 px movement threshold).
     *
     * @returns `true` while the ghost is visible; `false` otherwise.
     */
    export function isDragging(): boolean {
        return activeSession !== null && activeSession.committed;
    }

    /**
     * Aborts an in-flight drag. Mirrors a `mouseup` outside any drop
     * target — no drop callback fires; the session tears down.
     */
    export function cancel(): void {
        if (activeSession === null) {
            return;
        }

        endSession(false, 0, 0);
    }
}

/**
 * Resolves the source's drag-data payload — accepts either a literal or
 * a factory function on every drag start so callers can carry per-row
 * state without re-registering the source.
 */
function resolveDragData(options: DragSourceOptions): DragData {
    return typeof options.dragData === "function" ? options.dragData() : options.dragData;
}

/**
 * Removes the per-component mousedown listener and drops the source
 * record. Bound to `(component)` by `makeDragSource` so the returned
 * teardown closure stays a stable named-function reference.
 */
function tearDownDragSource(component: Component): void {
    component.removeMouseDownSubtreeListener(onSourceMouseDown);
    dragSources.delete(component.getId());
}

/**
 * Drops the target record. Bound to `(component)` by
 * `makeDropTarget` so the returned teardown closure stays a stable
 * named-function reference.
 */
function tearDownDropTarget(component: Component): void {
    dropTargets.delete(component.getId());
}

/**
 * Records the pending press and arms the viewport-level move / up
 * listeners. Nothing visual happens until the cursor crosses the
 * threshold.
 *
 * Registered as a subtree mousedown listener on every drag source, so
 * a press on any descendant of the source bubbles up the subtree
 * walker and the framework's Event router applies `component` as
 * `this` for the matching source — the lookup that identifies which
 * source was pressed.
 */
function onSourceMouseDown(this: Component, e: MouseEvent): void {
    if (activeSession !== null) {
        return;
    }

    if (e.button !== 0) {
        return;
    }

    const record = dragSources.get(this.getId());

    if (!record) {
        return;
    }

    const source  = record.component;
    const options = record.options;

    activeSession = {
        source,
        sourceOptions: options,
        dragData:      resolveDragData(options),
        startX:        e.clientX,
        startY:        e.clientY,
        committed:     false,
        ghost:         null,
        feedback:      null,
        indicator:     null,
        currentTarget: null,
        previousBodyCursor: DOM.source.getInlineStyle(DOM.source.getBody(), "cursor"),
    };

    // Viewport listeners route through Event.baseViewportListener, which stops
    // mouseup propagation at window capture phase whenever any viewport
    // listener for the type exists. A raw document-level mouseup binding would
    // race SpinButton-class registrants that already pre-empt mouseup at
    // capture and never fire.
    Event.addViewportListener(source, "mousemove", onMouseMove);
    Event.addViewportListener(source, "mouseup",   onMouseUp);
}

/**
 * Builds the session's three overlay components and writes the page-
 * wide cursor. Called once on the first mousemove that crosses the
 * threshold.
 */
function commitSession(session: DragSession): void {
    session.committed = true;

    const ghost = session.sourceOptions.ghostFactory
        ? session.sourceOptions.ghostFactory(session.source, session.dragData)
        : new DragGhost();

    session.ghost     = ghost;
    session.feedback  = new DragFeedback();
    session.indicator = new ReorderIndicator();

    if (typeof (ghost as unknown as { show?: () => void }).show === "function") {
        (ghost as unknown as { show: () => void }).show();
    } else {
        const el = ghost.getElement(true)!;

        DOM.sink.appendChild(DOM.source.getDocumentElement(), el);
    }

    if (session.sourceOptions.cursor) {
        DOM.sink.apply(DOM.source.getBody(), { style: { cursor: session.sourceOptions.cursor } });
    }
}

/**
 * Builds the immutable detail payload threaded through every
 * source / target callback for the current pointer position.
 */
function buildDetail(session: DragSession, clientX: number, clientY: number): DragEventDetail {
    return {
        dragData: session.dragData,
        sourceId: session.source.getId(),
        clientX,
        clientY,
    };
}

/**
 * Hit-tests under the ghost (which is pointer-events-none) and returns
 * the registered drop target whose element is the first match in the
 * z-stack, or `null` when no registered target sits under the cursor.
 */
function pickDropTarget(clientX: number, clientY: number): DropTargetRecord | null {
    const stack = DOM.source.elementsFromPoint(clientX, clientY);

    for (const el of stack) {
        const record = dropTargets.get(DOM.source.getId(el));

        if (record) {
            return record;
        }
    }

    return null;
}

/**
 * Detaches the validity tint from the previous target and fires its
 * `onDragLeave`. No-op when there is no previous target.
 */
function leaveCurrentTarget(session: DragSession, detail: DragEventDetail): void {
    if (session.currentTarget === null) {
        return;
    }

    const prev = dropTargets.get(session.currentTarget.getId());

    if (prev && prev.options.onDragLeave) {
        prev.options.onDragLeave(detail);
    }

    if (session.feedback) {
        session.feedback.detach();
    }

    if (session.indicator) {
        session.indicator.detach();
    }

    session.currentTarget = null;
}

/**
 * Attaches the validity tint to the new target, calls `onDragOver`
 * once, and positions the reorder indicator if the callback returned a
 * y value.
 */
function enterNewTarget(session: DragSession, target: DropTargetRecord, detail: DragEventDetail): void {
    const accepted = target.options.accepts(detail);

    if (session.feedback && !target.options.suppressValidityTint) {
        session.feedback.setValid(accepted);
        session.feedback.attachTo(target.component, target.options.feedbackHost);
    }

    if (!accepted) {
        session.currentTarget = target.component;

        return;
    }

    const hint = target.options.onDragOver?.(detail);

    if (typeof hint === "number" && session.indicator) {
        session.indicator.attachTo(target.component);
        session.indicator.setInsertionY(hint);
    } else if (session.indicator) {
        session.indicator.detach();
    }

    session.currentTarget = target.component;
}

/**
 * Drives the active session forward each frame: commits past the
 * threshold, moves the ghost, hands target changes to the
 * enter / leave helpers, and re-runs `onDragOver` while the cursor stays
 * inside the same target.
 *
 * @returns `true` while a drag session is live, consuming the move so nothing else tracks the pointer.
 */
function onMouseMove(e: MouseEvent): Event.ListenerResult {
    if (activeSession === null) {
        return;
    }

    const session = activeSession;

    if (!session.committed) {
        const dx = e.clientX - session.startX;
        const dy = e.clientY - session.startY;

        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) {
            return true;
        }

        const startDetail = buildDetail(session, e.clientX, e.clientY);

        if (session.sourceOptions.onDragStart?.(startDetail) === false) {
            endSession(false, e.clientX, e.clientY);

            return true;
        }

        commitSession(session);
        Event.fireEvent(session.source, "dragstart", { detail: startDetail });
    }

    if (session.ghost) {
        const dragGhost = session.ghost as unknown as { moveTo?: (x: number, y: number) => void };

        if (typeof dragGhost.moveTo === "function") {
            dragGhost.moveTo(e.clientX + GHOST_OFFSET_X, e.clientY + GHOST_OFFSET_Y);
        } else {
            session.ghost.setX(e.clientX + GHOST_OFFSET_X);
            session.ghost.setY(e.clientY + GHOST_OFFSET_Y);
        }
    }

    const detail = buildDetail(session, e.clientX, e.clientY);
    const target = pickDropTarget(e.clientX, e.clientY);

    if (target === null) {
        leaveCurrentTarget(session, detail);

        return true;
    }

    if (session.currentTarget !== target.component) {
        leaveCurrentTarget(session, detail);
        enterNewTarget(session, target, detail);

        return true;
    }

    // Same target as last frame — re-check accepts so the feedback
    // tint stays accurate (the validity of a drop can change as the
    // cursor moves within the same target, e.g. crossing into a
    // descendant region the source isn't allowed to land on). Skip
    // onDragOver / reorder indicator entirely while the drop is
    // rejected.
    const accepted = target.options.accepts(detail);

    if (session.feedback && !target.options.suppressValidityTint) {
        session.feedback.setValid(accepted);
    }

    if (!accepted) {
        if (session.indicator) {
            session.indicator.detach();
        }

        return true;
    }

    const hint = target.options.onDragOver?.(detail);

    if (typeof hint === "number" && session.indicator) {
        session.indicator.attachTo(target.component);
        session.indicator.setInsertionY(hint);
    } else if (session.indicator) {
        session.indicator.detach();
    }

    return true;
}

/**
 * Commits the drop (if any) and tears down the session.
 *
 * @returns `true` when a drag session was live, consuming the release that ends it;
 *   nothing when there is no session, so the release keeps propagating.
 */
function onMouseUp(e: MouseEvent): Event.ListenerResult {
    if (activeSession === null) {
        return;
    }

    const session = activeSession;
    const detail  = buildDetail(session, e.clientX, e.clientY);
    let dropped   = false;

    if (session.committed && session.currentTarget !== null) {
        const target = dropTargets.get(session.currentTarget.getId());

        if (target) {
            // Released over a registered drop target. Dispatch the drop only
            // when the target accepts; either way the release was *handled* by a
            // target rather than falling through to empty space, so report
            // `dropped` so the source skips its empty-space fallback — e.g. a Tab
            // header snaps back instead of tearing off into a window when the
            // target refused it (a rejected self-dock is a no-op, not a detach).
            if (target.options.accepts(detail)) {
                const onDropResult = target.options.onDrop?.(detail);

                if (onDropResult !== false) {
                    Event.fireEvent(session.source, "drop", { detail });
                }
            }

            dropped = true;
        }
    }

    endSession(dropped, e.clientX, e.clientY);

    return true;
}

/**
 * Removes overlays, unwires viewport listeners, restores the body
 * cursor, and fires `dragend` when the session committed.
 */
function endSession(dropped: boolean, clientX: number, clientY: number): void {
    if (activeSession === null) {
        return;
    }

    const session = activeSession;

    Event.removeViewportListener(session.source, "mousemove", onMouseMove);
    Event.removeViewportListener(session.source, "mouseup",   onMouseUp);

    if (session.feedback) {
        session.feedback.detach();
    }

    if (session.indicator) {
        session.indicator.detach();
    }

    if (session.ghost) {
        const dragGhost = session.ghost as unknown as { hide?: () => void };

        if (typeof dragGhost.hide === "function") {
            dragGhost.hide();
        } else {
            session.ghost.removeElement();
        }
    }

    if (session.sourceOptions.cursor) {
        DOM.sink.apply(DOM.source.getBody(), { style: { cursor: session.previousBodyCursor } });
    }

    if (session.committed) {
        const detail = buildDetail(session, clientX, clientY);

        Event.fireEvent(session.source, "dragend", { detail });
        session.sourceOptions.onDragEnd?.(detail, dropped);
    }

    activeSession = null;
}
