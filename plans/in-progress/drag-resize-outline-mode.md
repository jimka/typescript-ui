---
depends-on: [w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/src/typescript/lib/layout/Accordion.ts
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Body.ts
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/src/typescript/lib/core/Panel.ts
  - packages/lib/src/typescript/lib/component/container/ScrollStrip.ts
  - packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts
  - packages/lib/tests/overlay/AbstractWindow.resizable.test.ts
  - packages/lib/docs/layouts/Split.md
  - packages/lib/docs/layouts/Accordion.md
  - packages/lib/docs/components/Window.md
  - packages/lib/docs/components/Body.md
  - packages/lib/docs/concepts/performance.md
  - packages/lib/docs/concepts/theming.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/README.md
  - packages/qa/src/mount.ts
  - packages/qa/src/harness/drivers.ts
  - packages/qa/src/builders/shell.ts
  - packages/qa/src/builders/shared.ts
  - packages/qa/src/panels/windows.ts
  - packages/qa/tests/drivers.test.ts
  - packages/qa/tests/mount.test.ts
---

# Drag Resize Outline Mode — Implementation Plan

## Overview

Every gutter drag and window-edge drag lays the page out again on every frame. This plan adds a flag, `resizeMode: "live" | "outline"`. In **outline mode** a drag moves a thin outline to where the edge would land, and the page is laid out once, when the drag is released. In **live mode**, the default, drags behave as they do today; the one timing difference is that a window edge now applies its last move at release (see *A live window-edge release now applies its last move at once*). The flag is `00-agenda.md` Decision 2. W3.0 bounds what outline mode saves: each drag frame sits 25–60 ms above an idle frame, and outline mode removes almost all of that excess ([96 record, *Counter-only reads*](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L348)).

A new internal module, `core/ResizeDrag.ts`, holds the mode type, the app-wide default, the outline component and one per-frame drag session. The three drag owners send their pointer moves through that session instead of their own buffers: `Split`'s gutter drag ([Split.ts:1292-1458](packages/lib/src/typescript/lib/layout/Split.ts#L1292)), `Accordion`'s resizable-gutter drag ([Accordion.ts:1876-2102](packages/lib/src/typescript/lib/layout/Accordion.ts#L1876)) and `AbstractWindow`'s edge resize ([AbstractWindow.ts:2114-2262](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2114)). The per-frame buffer the session is built on is `AbstractWindow`'s existing `PerFrameCoalescer` ([AbstractWindow.ts:230-327](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L230)), moved to its own module. Each owner gains a `resizeMode` option with a getter and a setter, and `Body.init` takes the app-wide default.

The QA app gains a way to choose the mode per run, a one-way drag driver and an outline geometry label, so the orchestrator can measure both modes against the base in one session.

---

## Architecture Decisions

### The API: an option on each owner, with an app-wide default set through `Body` — needs your approval

`Split`, `Accordion` and `AbstractWindow` (so `Window` and `TabWindow` too) each take `resizeMode?: ResizeMode`, with `getResizeMode()` and `setResizeMode(mode | null)`. An owner with no mode of its own follows the **app-wide default**, which `Body.init({ resizeMode })` and `Body.setResizeMode(mode)` set and which starts as `"live"`. `Dock` gets no option: the splits and float windows it builds follow the app-wide default. This mirrors `Body.init`'s page-wide `nativeContextMenu` switch ([Body.ts:26-32](packages/lib/src/typescript/lib/core/Body.ts#L26), [:180-208](packages/lib/src/typescript/lib/core/Body.ts#L180)).[^api-choice]

The mode a drag uses is read when the drag starts:

| Owner's own mode | App-wide default | The drag runs |
|---|---|---|
| unset (or set to `null`) | `"live"` | live |
| unset | `"outline"` | outline |
| `"live"` | `"outline"` | live |
| `"outline"` | `"live"` | outline |

**The alternative, for your decision:** options on each owner only, plus a `DockOptions.resizeMode` that `Dock` forwards to every split and float window it builds, as it forwards `tabOptions` ([Dock.ts:88-93](packages/lib/src/typescript/lib/overlay/Dock.ts#L88), [:2020-2030](packages/lib/src/typescript/lib/overlay/Dock.ts#L2020)). That alternative keeps no module-level state, but the option has to be threaded through five construction sites, and it does nothing for an app's own `Split` or `Accordion`.[^no-dock-option]

The app-wide default lives in `core/ResizeDrag.ts`'s module state, not in `Body`'s options bag.[^body-not-options]

### The default stays `"live"`

No existing consumer sees a change. An app opts in with one line, `Body.init({ resizeMode: "outline" })`.[^default-live]

### One drag session serves all three owners — `core/ResizeDrag.ts`

`ResizeDrag<T>` wraps a `PerFrameCoalescer<T>`. An owner gives it three hooks:

- `apply(value)` — lay the move out now (live mode, once per frame);
- `preview(value)` — say where the outline goes (outline mode, once per frame);
- `commit(value)` — lay the last move out once (outline mode, on release).

The owner calls `beginLive()` or `beginOutline(mount)` when a drag starts, `schedule(value)` on every pointer move, `end()` on release and `cancel()` when it is torn down mid-drag. `Split.scheduleDrag`/`flushDrag` and `Accordion.scheduleGutterDrag`/`flushGutterDrag` are hand-written copies of this buffer (slices 06 F06.10 and 08 F08.7); their flush halves and fields are deleted, and the two `schedule…` methods become one-line forwarders into the session. The module is internal, like [`core/PendingPointerDrags.ts`](packages/lib/src/typescript/lib/core/PendingPointerDrags.ts): only the `ResizeMode` type is exported through `core/index.ts`.[^seam-home]

### The outline never shows a place the release cannot reach

Each owner splits one drag frame into a pure **resolve step** and its writes. The live frame calls the same methods, in the same order, as today. The outline preview calls the same resolve step with the drag's bounds read once, when the drag starts. The release commits through the live apply path.[^shared-resolve]

| Owner | Resolve step (new) | Live frame | Outline preview | Release commit |
|---|---|---|---|---|
| `Split` | `resolveLhsSize(bounds, position)` | `onDrag` — unchanged calls | the gutter's line, moved by the resolved size minus the drag-start size | `onDrag` at the last position |
| `Accordion` | `resolveGutterDrag(position, current, mins, maxs)` | `onGutterDrag` | a shadow array of heights, advanced each frame; the line moves by the sum of height changes at and above the upper section | `applySectionHeights` with the shadow |
| `AbstractWindow` | `resolveResizeFrame(frame, width, height)` | `applyResizeFrame` — the setters size each axis | the same switch with pure clamps | `applyResizeFrame` at the last position |

`Accordion`'s drag is incremental: each frame spreads its travel over the current heights. So its preview must replay every frame on the shadow array, not jump to the last position. An offline probe showed the replay matches live mode frame for frame.[^accordion-shadow] The window keeps its eight-way switch once, and the two modes pass it different ways to size an axis.[^window-strategy]

### What the outline looks like and where it lives

`ResizeOutline` is a module-private component in `ResizeDrag.ts`: a box with a 2 px solid border in `--ts-ui-drag-reorder-color` (fallback `#1a73e8`), no fill, `pointer-events: none`, and `will-change: transform` from creation. It moves by `setTranslate`, plus `setWidth` / `setHeight` when a window edge changes its size, batched into one inline-style write per frame. It writes no stylesheet rule of its own.[^outline-look]

- **A gutter's outline** is a 4 px box on the gutter's visual centre line, spanning the gutter's length. Its two borders meet, so it reads as a solid bar the width of `Split`'s visual gutter.
- **A window's outline** is a frame on the window's outer box.
- **Styling.** The border comes from the class tier through `ownClassStyleDefaults`, as `ScrollStripArrowButton`'s chrome does ([ScrollStrip.ts:89-121](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L89)).[^class-tier] The colour reuses the bright "it lands here" drag token.[^token-reuse]
- **Mounting.** A gutter's outline is appended to the gutter's own parent element at `LayerManager.Band.Window - 1`, as [`DragFeedback`](packages/lib/src/typescript/lib/overlay/DragFeedback.ts) and [`ReorderIndicator`](packages/lib/src/typescript/lib/overlay/ReorderIndicator.ts) are. A window's outline is appended to the document element beside the window, at the window's own z-index.[^z-index]
- **Lifetime.** It is created when an outline drag starts and disposed at release or cancel, as `DragManager` does with its ghost and feedback overlays.

### Release lays out once

`end()` flushes the freshest buffered move. In live mode that flush is the last layout; in outline mode `end()` then removes the outline and calls `commit` with that move. `Split` emits `paneresize` and `Accordion` emits `sectionresize` as today: once per release, with the committed sizes. A press and release with no move in between commits nothing, in outline mode as in live mode.

### Cancelling an outline drag

| Trigger | Outline drag | Live drag |
|---|---|---|
| Escape (`keydown`) | outline removed; the release commits nothing and emits no `paneresize` / `sectionresize` | unchanged: ignored |
| The browser window loses focus (a `blur` whose target is the window) | as Escape | unchanged: ignored |
| The owner is torn down, or a window leaves its normal state, mid-drag (`Split.detach`, `Accordion.detach`, a window's `onExitAction`, `setWindowState` or destructor) | outline removed and disposed; nothing committed | the buffered frame is dropped, as today |
| `touchcancel` | a release, as `PointerDrag` routes it: commits | a release |

The outline registers its own viewport `keydown` and `blur` listeners while it is on screen, so a live drag never hears Escape.[^escape-scope] After a cancel, the gutter or border keeps its pointer drag until the button is released: later moves are ignored, and the release ends the drag and restores pointer events as today.[^gesture-stays]

Teardown mid-drag follows the precedent each owner already has for its buffered frame ([Split.ts:1729-1736](packages/lib/src/typescript/lib/layout/Split.ts#L1729), [Accordion.ts:1204-1224](packages/lib/src/typescript/lib/layout/Accordion.ts#L1204)): the owner's own teardown calls `cancel()`. The handle's document-level drag chrome is still ended by `Component.destructor` through `endPointerDragFor` — the C39 fix in `core/PendingPointerDrags.ts` — unchanged.

### No `pauseLayout`

Outline mode never writes the real layout during a drag, so nothing needs pausing. No component's paused flag is set, no `resumeLayout` runs, and no widget sees `isLayoutPaused()` change.[^no-pause]

### Keyboard, collapse and ARIA are unchanged

Gutters and window borders have no keyboard resize and no ARIA value today, so outline mode has neither to update. Collapse (the chevron, `setPaneCollapsed`) and section toggles are not drags and keep their animations. A mode change mid-drag applies to the next drag. A later plan that gives gutters `role="separator"` should report the committed layout, so under outline mode the value changes once, at release.[^aria-rule]

### Nested splits and `Dock`

Each `Split` owns its own session. `Dock` regions are plain `Split`s, so dragging a region's gutter shows one line across that region's container; the release lays out the two panes beside it, and they lay out their nested splits once. `Dock` builds splits at three sites ([Dock.ts:833](packages/lib/src/typescript/lib/overlay/Dock.ts#L833), [DockRegion.ts:480](packages/lib/src/typescript/lib/layout/DockRegion.ts#L480), [LayoutSerialization.ts:549](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L549)); none changes.

### A live window-edge release now applies its last move at once

`Split` and `Accordion` already flush the pending frame synchronously on release. `AbstractWindow.onResizeEnd` did not, so the last buffered move landed a frame or more later. The shared `end()` flushes for all three owners.[^window-flush]

### Scope, and the collapse plan beside it

This plan changes `Split`'s drag path only: its options, `onDragStart`, `onDrag`, `scheduleDrag` / `flushDrag` / `onDragEnd`, `detach`'s drag lines, and new getter and setter. It changes nothing `plans/split-collapse-static-participants.md` edits.[^scope-collapse]

### Three QA-app additions

1. A `resize=live|outline` page parameter sets the app-wide default through `Body.setResizeMode` after `Body.init`, and fails the run on a library build that has no such method.
2. A `dragout` driver drags the panel's `drag` target in one direction and releases `units × step` px from where it started.
3. A `resizeOutline` geometry label (selector `.ResizeOutline`) on both shells and on the `windows` panel.

Together they let one A/B show that outline frames do almost no work, that the page stays still during an outline drag, and that it comes to rest exactly where live mode puts it.[^qa-additions]

---

## Public API

```ts
// core/ResizeDrag.ts — the type is re-exported from core/index.ts
/**
 * How a resize drag shows its progress. `"live"` lays the content out on every
 * frame of the drag; `"outline"` moves an outline to where the edge will land
 * and lays the content out once, when the drag is released.
 *
 * @category Core
 */
export type ResizeMode = "live" | "outline";
```

```ts
// core/Body.ts
export interface BodyOptions extends Omit<ComponentOptions, "components"> {
    /**
     * The resize mode of every Split, resizable Accordion and window that sets
     * none of its own. Defaults to `"live"`. See {@link Body.setResizeMode}.
     */
    resizeMode?: ResizeMode;
}

class Body {
    /** Sets the app-wide resize mode; takes effect from the next drag. */
    setResizeMode(mode: ResizeMode): this;
    /** The app-wide resize mode: `"live"` until set. */
    getResizeMode(): ResizeMode;
}
```

Backing state: `core/ResizeDrag.ts`'s module variable, written by `setAppResizeMode` and read by `getAppResizeMode` (both internal). `applyOptions` dispatches `options.resizeMode` to `setResizeMode`.

```ts
// layout/Split.ts — identical shape on layout/Accordion.ts
export interface SplitOptions extends LayoutManagerOptions {
    /**
     * How a gutter drag shows its progress. Omit it to follow the app-wide
     * default set through `Body.setResizeMode`.
     */
    resizeMode?: ResizeMode;
}

class Split {
    /** The mode this split's gutter drags use: its own, else the app-wide default. */
    getResizeMode(): ResizeMode;
    /** Sets this split's mode; `null` follows the app-wide default again. Takes effect from the next drag. */
    setResizeMode(mode: ResizeMode | null): this;
}
```

Backing field on each: `private _resizeMode: ResizeMode | null = null;`, dispatched from `applyOptions` when `options.resizeMode !== undefined`. Both managers run `applyOptions` from their constructor body, after the field initialisers, so no `declare` is needed.

```ts
// overlay/AbstractWindow.ts
export interface WindowOptions extends ContainerOptions {
    /**
     * How an edge or corner drag shows its progress. Omit it to follow the
     * app-wide default set through `Body.setResizeMode`.
     */
    resizeMode?: ResizeMode;
}

abstract class AbstractWindow {
    getResizeMode(): ResizeMode;
    setResizeMode(mode: ResizeMode | null): this;
}
```

Backing: the options bag. `setResizeMode` writes `this._options.resizeMode = mode ?? undefined`; `getResizeMode` returns `this._options.resizeMode ?? getAppResizeMode()`; `applyOptions` dispatches `options.resizeMode` when it is not `undefined`. The setter writes no DOM, so it is safe inside the `super()` cascade. No class default, so no row in `default-options-fallback.test.ts`.

```ts
// core/Component.ts — visibility only
protected clampWidth(width: number): number;    // was private
protected clampHeight(height: number): number;  // was private
```

---

## Internal Structure

### `core/PerFrameCoalescer.ts` (moved)

[AbstractWindow.ts:230-327](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L230), moved as it is, with `export` added and one type widened: the `fps` getter becomes `() => number | undefined`. `onFrame` already reads it as `const fps = this._fps?.(); if (fps !== undefined && …)`, so a getter that returns `undefined` leaves that frame uncapped. Add that sentence to the constructor's `@param fps`.

### `core/ResizeDrag.ts`

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal drag-frame seam shared by every resize drag that can run
// live or as an outline: a Split gutter, a resizable Accordion gutter and a
// window edge. Only `ResizeMode` is exported from `core/index.ts`; the three
// owners and `Body` import the rest directly, mirroring
// `core/PendingPointerDrags.ts`.

import { Component } from "~/core/Component.js";
import type { ComponentOptions } from "~/core/Component.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { LayerManager } from "~/core/LayerManager.js";
import { PerFrameCoalescer } from "~/core/PerFrameCoalescer.js";

export type ResizeMode = "live" | "outline";            // JSDoc as in Public API

/** A box in the outline parent's coordinate space. */
export interface OutlineRect { x: number; y: number; width: number; height: number; }

/** Where an outline drag draws its outline. */
export interface OutlineMount {
    /** The element the outline is appended to. */
    parent: Handle;
    /** The outline's box when the drag starts. */
    start:  OutlineRect;
    zIndex: number;
}

/** What an owner does with one buffered pointer move. */
export interface ResizeDragHooks<T> {
    /** Live mode: lays the move out now. */
    apply(value: T): void;
    /** Outline mode: the outline's box for the move, clamped as `apply` would clamp; `null` leaves the outline where it is. */
    preview(value: T): OutlineRect | null;
    /** Outline mode, on release: lays out the last previewed move once. */
    commit(value: T): void;
}

// Border width of the outline, in px: the agenda asks for 1–2 px; 1 px is
// hard to see on the 5,120 px-wide screen the QA runs use.
const OUTLINE_BORDER_PX = 2;

// Thickness of a gutter's outline: its two borders meet, so it reads as one
// solid bar. Equals Split's 4 px visual gutter (GUTTER_SIZE).
const OUTLINE_LINE_PX = 2 * OUTLINE_BORDER_PX;

// DragFeedback's and ReorderIndicator's z-index: just below the lowest
// LayerManager band, so an outline drawn in the page paints over page
// content that forms no stacking context of its own, and under every window.
export const IN_PAGE_OUTLINE_Z_INDEX = LayerManager.Band.Window - 1;

const _defaultResizeOutlineOptions: Partial<ComponentOptions> = {
    border: `${OUTLINE_BORDER_PX}px solid var(--ts-ui-drag-reorder-color, #1a73e8)`,
};

let _appResizeMode: ResizeMode = "live";

export function getAppResizeMode(): ResizeMode { return _appResizeMode; }
export function setAppResizeMode(mode: ResizeMode): void { _appResizeMode = mode; }

/** A component's box, `{ getX(), getY(), getWidth(), getHeight() }`. */
export function rectOf(component: Component): OutlineRect { … }

/**
 * The outline for a gutter: an `OUTLINE_LINE_PX`-thick box centred on the
 * gutter's centre line across `axis` (the axis the gutter is dragged along),
 * as long as the gutter.
 */
export function gutterOutline(box: OutlineRect, axis: "x" | "y"): OutlineRect {
    if (axis === "x") {
        return { x: box.x + box.width / 2 - OUTLINE_LINE_PX / 2, y: box.y, width: OUTLINE_LINE_PX, height: box.height };
    }

    return { x: box.x, y: box.y + box.height / 2 - OUTLINE_LINE_PX / 2, width: box.width, height: OUTLINE_LINE_PX };
}

class ResizeOutline extends Component {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultResizeOutlineOptions;

    private _start: OutlineRect | null = null;
    private _onCancel: (() => void) | null = null;
    private readonly _boundOnKeyDown = (e: KeyboardEvent): Event.ListenerResult => this.onKeyDown(e);
    private readonly _boundOnWindowBlur = (e: FocusEvent): void => this.onWindowBlur(e);

    constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
        super(options, { ..._defaultResizeOutlineOptions, ...(subclassDefaults ?? {}) });

        this.setPointerEvents("none");
        this.setWillChange("transform");
    }

    /** Sized by its owner every frame and childless: never clamp to content. */
    protected clampsToContentSize(): boolean { return false; }

    /** Places the outline at `mount.start`, appends it, and listens for Escape and a window blur. */
    show(mount: OutlineMount, onCancel: () => void): void {
        this._start = mount.start;
        this._onCancel = onCancel;
        this.setZIndex(mount.zIndex);
        this.setX(mount.start.x);
        this.setY(mount.start.y);
        this.setWidth(mount.start.width);
        this.setHeight(mount.start.height);
        DOM.sink.appendChild(mount.parent, this.getElement(true)!);
        Event.addViewportListener(this, "keydown", this._boundOnKeyDown);
        Event.addViewportListener(this, "blur", this._boundOnWindowBlur);
    }

    /** Moves the outline to `rect`: one batched inline-style write. */
    place(rect: OutlineRect): void {
        const start = this._start!;

        this.setAutoCommitStyle(false);
        this.setTranslate(rect.x - start.x, rect.y - start.y);
        this.setWidth(rect.width);
        this.setHeight(rect.height);
        this.setAutoCommitStyle(true);
    }

    private onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (e.key !== "Escape") {
            return;
        }

        this._onCancel?.();

        return { stop: true, prevent: true };
    }

    // Viewport listeners run in the capture phase, so an element's blur
    // arrives here too; only the browser window's own blur cancels
    // (LayerManager.onWindowBlur's filter).
    private onWindowBlur(e: FocusEvent): void {
        if (!DOM.source.isWindow(e.target === null ? null : DOM.source.intern(e.target))) {
            return;
        }

        this._onCancel?.();
    }
}

export class ResizeDrag<T> {
    private readonly _hooks: ResizeDragHooks<T>;
    private readonly _coalescer: PerFrameCoalescer<T>;
    private _outline: ResizeOutline | null = null;
    private _previewed: T | null = null;
    private _cancelled: boolean = false;
    private readonly _boundCancel = (): void => this.cancel();

    /**
     * @param fps - Optional frames-per-second cap, read fresh every frame. It
     *   caps live frames only: an outline frame runs no layout.
     */
    constructor(hooks: ResizeDragHooks<T>, fps?: () => number) {
        this._hooks = hooks;
        this._coalescer = new PerFrameCoalescer<T>(
            (value) => this.onFrame(value),
            fps === undefined ? undefined : () => (this._outline === null ? fps() : undefined),
        );
    }

    /** Starts a live drag, closing any drag still open without committing it. */
    beginLive(): void {
        this.reset();
    }

    /** Starts an outline drag at `mount`, closing any drag still open without committing it. */
    beginOutline(mount: OutlineMount): void {
        this.reset();
        this._outline = new ResizeOutline();
        this._outline.show(mount, this._boundCancel);
    }

    /** Buffers a pointer move; ignored after a cancel until the next begin. */
    schedule(value: T): void {
        if (this._cancelled) {
            return;
        }

        this._coalescer.schedule(value);
    }

    /**
     * Ends the drag on release: flushes the freshest move, and in outline mode
     * removes the outline and commits the last previewed move.
     *
     * @returns `false` after a cancel, `true` otherwise.
     */
    end(): boolean {
        if (this._cancelled) {
            this._cancelled = false;

            return false;
        }

        this._coalescer.forceFlush();

        if (this._outline !== null) {
            const last = this._previewed;

            this.reset();

            if (last !== null) {
                this._hooks.commit(last);
            }
        }

        return true;
    }

    /**
     * Drops the buffered move. In outline mode it also removes the outline and
     * marks the drag cancelled, so the release commits nothing.
     */
    cancel(): void {
        this._coalescer.cancel();

        if (this._outline !== null) {
            this.removeOutline();
            this._previewed = null;
            this._cancelled = true;
        }
    }

    private onFrame(value: T): void {
        if (this._outline === null) {
            this._hooks.apply(value);

            return;
        }

        this._previewed = value;

        const rect = this._hooks.preview(value);

        if (rect !== null) {
            this._outline.place(rect);
        }
    }

    private reset(): void {
        this._coalescer.cancel();
        this.removeOutline();
        this._previewed = null;
        this._cancelled = false;
    }

    private removeOutline(): void {
        this._outline?.dispose();
        this._outline = null;
    }
}
```

Give every member a JSDoc comment per the code conventions; the sketch shortens them. `dispose()` purges the outline's viewport listeners through `Component.destructor` → `Event.purgeComponent` and removes its element, so neither needs removing by hand.

### `Split`

```ts
/** A dragged gutter's two neighbours' main-axis bounds, as `onDrag` clamps them. */
interface PairBounds { minLhs: number; maxLhs: number; minRhs: number; maxRhs: number; }

/** One buffered gutter move: `onDrag`'s three arguments. */
interface SplitDragFrame { container: Component; gutter: SplitGutter; position: number; }

/** An outline drag's state: the bounds read at the press, and the gutter's line. */
interface SplitOutlineDrag { bounds: PairBounds; line: OutlineRect; }

// Fields — replacing `_pendingDrag` and `_dragRafHandle` (:178-182):
private _resizeMode: ResizeMode | null = null;
private _outlineDrag: SplitOutlineDrag | null = null;
private readonly _resizeDrag = new ResizeDrag<SplitDragFrame>({
    // `this.onDrag` is looked up at call time, so a test's instance spy still sees every live frame.
    apply:   (frame) => this.onDrag(frame.container, frame.gutter, frame.position),
    preview: (frame) => this.previewDrag(frame),
    commit:  (frame) => this.onDrag(frame.container, frame.gutter, frame.position),
});
```

`onDrag` (:1334-1392) keeps its signature. Lines :1339-1360 become:

```ts
const horizontal = this._orientation === "horizontal";
const total      = this._dragOriginLhsSize + this._dragOriginRhsSize;
const newLhs     = this.resolveLhsSize(this.pairBounds(lhs, rhs, horizontal), position);
const newRhs     = total - newLhs;
```

- `pairBounds(lhs, rhs, horizontal)` holds today's lines :1343-1350: the four `paneMinSize` / `paneMaxSize` reads, in today's order, and the axis picks.
- `resolveLhsSize(bounds, position)` holds today's `total`, `offset`, `loLhs`, `hiLhs` and clamp (:1340, :1352-1360), and returns `newLhs`.

Everything from `dragAmount` on is unchanged.

```ts
private previewDrag(frame: SplitDragFrame): OutlineRect | null {
    const outline = this._outlineDrag;

    if (outline === null) {
        return null;
    }

    const travel = this.resolveLhsSize(outline.bounds, frame.position) - this._dragOriginLhsSize;

    return this._orientation === "horizontal"
        ? { ...outline.line, x: outline.line.x + travel }
        : { ...outline.line, y: outline.line.y + travel };
}
```

At the end of `onDragStart` (:1292-1308):

```ts
if (this.getResizeMode() === "outline") {
    const line = gutterOutline(rectOf(gutter), horizontal ? "x" : "y");

    this._outlineDrag = { bounds: this.pairBounds(lhs, rhs, horizontal), line };
    this._resizeDrag.beginOutline({ parent: DOM.source.getParentNode(gutter.getElement()!)!, start: line, zIndex: IN_PAGE_OUTLINE_Z_INDEX });
} else {
    this._outlineDrag = null;
    this._resizeDrag.beginLive();
}
```

`scheduleDrag` keeps its signature and becomes `this._resizeDrag.schedule({ container, gutter, position })`. `flushDrag` is deleted. `onDragEnd` becomes:

```ts
const committed = this._resizeDrag.end();

this._outlineDrag = null;

if (committed) {
    this.emit("paneresize", this.getPaneSizes());
}
```

### `Accordion`

```ts
/** One buffered gutter move. */
interface GutterDragFrame { gutterIndex: number; position: number; }

/** An outline drag's state: open-section heights at the press and as the outline has them, their bounds, and the gutter's line. */
interface AccordionOutlineDrag { start: number[]; heights: number[]; mins: number[]; maxs: number[]; line: OutlineRect; }

// Fields — replacing `_pendingGutterDrag` and `_dragRafHandle` (:231-238):
private _resizeMode: ResizeMode | null = null;
private _outlineDrag: AccordionOutlineDrag | null = null;
private readonly _resizeDrag = new ResizeDrag<GutterDragFrame>({
    apply:   (frame) => this.onGutterDrag(frame.gutterIndex, frame.position),
    preview: (frame) => this.previewGutterDrag(frame.gutterIndex, frame.position),
    commit:  (frame) => this.commitGutterOutline(frame.gutterIndex),
});
```

`onGutterDrag` (:1928-2024) is split into four private methods, and keeps today's calls in today's order:

| New method | Holds today's lines | Returns |
|---|---|---|
| `isDragPairCurrent(gutterIndex)` | the guard at :1932-1934 (pair exists, is the dragged pair, container present) | `boolean` |
| `readOpenSections(components)` | `current`, `mins`, `maxs` at :1947-1958, over `this._dragOpenIndices` | `{ current, mins, maxs }` |
| `resolveGutterDrag(position, current, mins, maxs)` | :1943 `frameDelta` through the two `distributeDragChain` calls at :1996-1997, including the `_dragLastPointer` advance | `newHeights` |
| `applySectionHeights(components, newHeights)` | :1999-2023: the `_resizeSizes` writes and the `layoutSections` call | `void` |

```ts
private onGutterDrag(gutterIndex: number, position: number): void {
    if (!this.isDragPairCurrent(gutterIndex)) {
        return;
    }

    const components = this.getContainer()!.getComponents();
    const { current, mins, maxs } = this.readOpenSections(components);

    this.applySectionHeights(components, this.resolveGutterDrag(position, current, mins, maxs));
}

private previewGutterDrag(gutterIndex: number, position: number): OutlineRect | null {
    const outline = this._outlineDrag;

    if (outline === null || !this.isDragPairCurrent(gutterIndex)) {
        return null;
    }

    outline.heights = this.resolveGutterDrag(position, outline.heights, outline.mins, outline.maxs);

    let travel = 0;

    for (let pos = 0; pos <= this._dragGutterUpperPos; pos++) {
        travel += outline.heights[pos] - outline.start[pos];
    }

    return { ...outline.line, y: outline.line.y + travel };
}

private commitGutterOutline(gutterIndex: number): void {
    const outline = this._outlineDrag;

    if (outline === null || !this.isDragPairCurrent(gutterIndex)) {
        return;
    }

    this.applySectionHeights(this.getContainer()!.getComponents(), outline.heights);
}
```

At the end of `onGutterDragStart` (:1876-1904), after `_dragLastPointer` is set:

```ts
if (this.getResizeMode() === "outline") {
    const sections = this.readOpenSections(components);
    const gutter   = this._resizeGutters[gutterIndex];
    const line     = gutterOutline(rectOf(gutter), "y");

    this._outlineDrag = { start: sections.current, heights: sections.current.slice(), mins: sections.mins, maxs: sections.maxs, line };
    this._resizeDrag.beginOutline({ parent: DOM.source.getParentNode(gutter.getElement()!)!, start: line, zIndex: IN_PAGE_OUTLINE_Z_INDEX });
} else {
    this._outlineDrag = null;
    this._resizeDrag.beginLive();
}
```

`scheduleGutterDrag` keeps its signature and becomes `this._resizeDrag.schedule({ gutterIndex, position })`. `flushGutterDrag` is deleted. `onGutterDragEnd` becomes:

```ts
const committed   = this._resizeDrag.end();
const wasDragging = this._dragUpper !== null;

this._dragUpper = null;
this._dragLower = null;
this._outlineDrag = null;

if (wasDragging && committed) {
    this.emit("sectionresize", this.getSectionSizes());
}

return true;
```

`end()` runs first because the commit's guard needs `_dragUpper`.

### `AbstractWindow`

```ts
/** One buffered edge move: the pointer and the strip being dragged. */
interface WindowResizeFrame { clientX: number; clientY: number; border: WindowBorder; }

// Fields — replacing `_resizeCoalescer` (:365-366):
private readonly _resizeDrag: ResizeDrag<WindowResizeFrame> = new ResizeDrag<WindowResizeFrame>({
    apply:   (frame) => this.applyResizeFrame(frame),
    preview: (frame) => this.previewResizeFrame(frame),
    commit:  (frame) => this.applyResizeFrame(frame),
}, () => this._resizeFps);
// The chrome floor setWidth/setHeight apply, read once when an outline drag starts.
private _resizeChromeMin: Size | null = null;
```

`resolveResizeFrame(frame, width, height)` holds `applyResizeFrame`'s body from `offsetX` through the switch (:2195-2268). It starts from `rect = { x: _resizeOriginX, y: _resizeOriginY, width: _resizeOriginW, height: _resizeOriginH }`. In every case, each `this.setWidth(expr)` becomes `rect.width = width(expr)`, each `this.setHeight(expr)` becomes `rect.height = height(expr)`, and each `this.setX(originRight - this.getWidth())` becomes `rect.x = originRight - rect.width` (the same for `y`). It returns `rect`.

| Today, `Direction.WEST` | In `resolveResizeFrame` |
|---|---|
| `this.setWidth(Math.min(this._resizeOriginW - offsetX, westWidthCap));` | `rect.width = width(Math.min(this._resizeOriginW - offsetX, westWidthCap));` |
| `this.setX(originRight - this.getWidth());` | `rect.x = originRight - rect.width;` |

```ts
private applyResizeFrame(frame: WindowResizeFrame): void {
    this.setAutoCommitStyle(false);

    const rect = this.resolveResizeFrame(frame, (w) => this.setWidth(w).getWidth(), (h) => this.setHeight(h).getHeight());

    // A no-op for an edge that keeps x or y: each setter returns at its same-value guard.
    this.setX(rect.x);
    this.setY(rect.y);
    this.doLayout();
    this.setAutoCommitStyle(true);
}

private previewResizeFrame(frame: WindowResizeFrame): OutlineRect {
    return this.resolveResizeFrame(frame, (w) => this.resizedWidth(w), (h) => this.resizedHeight(h));
}

/** The width `setWidth(width)` would commit mid-drag: its chrome floor, then Component's clamp. */
private resizedWidth(width: number): number {
    return this.clampWidth(Math.max(width, this._resizeChromeMin!.width));
}
// resizedHeight: the same, with height and clampHeight.
```

In `onResize`'s session-start block (:2125-2137), after the origin capture:

```ts
if (this.getResizeMode() === "outline") {
    this._resizeChromeMin = this.chromeMinSize();
    this._resizeDrag.beginOutline({ parent: DOM.source.getDocumentElement(), start: rectOf(this), zIndex: this.getZIndex() });
} else {
    this._resizeDrag.beginLive();
}
```

---

## Ordered Implementation Steps

Work test-first: each test-writing step names the cases that fail until the next step lands.

1. **Record the A/B base.** In the implementation worktree, before any edit, run `git rev-parse HEAD` and write the SHA into this plan's *Implementation Notes* as "A/B base".

2. **Create `core/PerFrameCoalescer.ts`** per *Internal Structure*: move [AbstractWindow.ts:230-327](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L230) there, export the class, widen the `fps` getter's type, and add a module header comment (framework-internal, not exported from `core/index.ts`, used by `AbstractWindow`'s snap preview and `core/ResizeDrag.ts`). In `AbstractWindow.ts`, delete the class and import it. Check: from `packages/lib`, `npx vitest run tests/overlay/AbstractWindow.resizeFpsCoalescing.test.ts tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts` is green, and `grep -n "class PerFrameCoalescer" src/typescript/lib/overlay/AbstractWindow.ts` prints nothing.

3. **`core/Component.ts`:** change `private clampWidth` ([:4592](packages/lib/src/typescript/lib/core/Component.ts#L4592)) and `private clampHeight` ([:4662](packages/lib/src/typescript/lib/core/Component.ts#L4662)) to `protected`. Nothing else. Check: `npm run typecheck`.

4. **Create `packages/lib/tests/core/ResizeDrag.test.ts`** with cases R1–R14 and B1 of *Expected Behaviour*. Capture frames by spying `DOM.sink.requestAnimationFrame` / `cancelAnimationFrame` and draining them with a timestamp, copying [AbstractWindow.resizeFpsCoalescing.test.ts:49-93](packages/lib/tests/overlay/AbstractWindow.resizeFpsCoalescing.test.ts#L49). Dispatch Escape and blur as [LayerManager.test.ts:734-745](packages/lib/tests/overlay/LayerManager.test.ts#L734) does. Reach the outline white-box through `(drag as unknown as { _outline: Component | null })._outline`. `afterEach`: `setAppResizeMode("live")`, then `DOM.reset()`; B1 also runs `Favicon._reset()` and `Body.getInstance().setNativeContextMenu(true)`, as [BodyContextMenu.test.ts:50-61](packages/lib/tests/core/BodyContextMenu.test.ts#L50) does. Check: the file fails to import.

5. **Create `core/ResizeDrag.ts`** per *Internal Structure*, with a JSDoc comment on every member. Check: R1–R14 pass; B1 still fails.

6. **`core/index.ts` and `core/Body.ts`.**
   - `core/index.ts`: add `export type { ResizeMode } from '~/core/ResizeDrag.js';` after the `Panel` exports.
   - `core/Body.ts`: add `resizeMode` to `BodyOptions` (after `nativeContextMenu`), and `setResizeMode` / `getResizeMode` after `getNativeContextMenu`, delegating to `setAppResizeMode` / `getAppResizeMode`. `applyOptions`: `if (options.resizeMode !== undefined) this.setResizeMode(options.resizeMode);`. Mention the option in `Body.init`'s JSDoc paragraph that lists what `init` installs.
   - Check: B1 passes; `npm run typecheck`.

7. **Create `packages/lib/tests/component/layout/Split.resizeMode.test.ts`** with S1–S7, using the frame capture from step 4. Check: every case fails.

8. **`layout/Split.ts`:**
   - (a) `SplitOptions`: add `resizeMode`.
   - (b) Fields: replace `_pendingDrag` / `_dragRafHandle` and their comment (:178-182) with `_resizeMode`, `_outlineDrag` and `_resizeDrag`, each with a one-line comment.
   - (c) `applyOptions`: dispatch `resizeMode`.
   - (d) Add `getResizeMode` / `setResizeMode` after `setOrientation` (:733-750).
   - (e) Add the `PairBounds`, `SplitDragFrame` and `SplitOutlineDrag` interfaces above the class, and `pairBounds`, `resolveLhsSize`, `previewDrag` beside `onDrag`.
   - (f) `onDragStart`: the outline branch; its JSDoc adds that the drag starts in the split's resize mode, drawing the outline in outline mode. `onDrag`: the resolve split; its JSDoc, `@remarks` included, keeps its text.
   - (g) `scheduleDrag` becomes a forwarder; rewrite its JSDoc: it buffers the move in the shared per-frame drag session, which applies at most one per frame — live mode lays it out, outline mode moves the outline — and keep the paragraph on why a `mousemove` is not applied raw. Delete `flushDrag`. `onDragEnd`: the new body; its JSDoc says it flushes the freshest move, commits it in outline mode, and fires `paneresize` unless the drag was cancelled.
   - (h) `detach`: replace :1729-1736 with `this._resizeDrag.cancel();` and `this._outlineDrag = null;`. Their comment becomes: "Same idea for a drag still in progress (see scheduleDrag): a buffered frame would fire after this detach against panes `gutter.dispose()` below tears down, and an outline would outlive the container." 
   - Check: S1–S7 pass; `npx vitest run tests/component/layout/Split` is green with `Split.test.ts` unmodified; `grep -n "_pendingDrag\|_dragRafHandle\|flushDrag" src/typescript/lib/layout/Split.ts` prints nothing.

9. **Create `packages/lib/tests/component/layout/Accordion.resizeMode.test.ts`** with A1–A4. Check: every case fails.

10. **`layout/Accordion.ts`:**
    - `AccordionOptions` gets `resizeMode` (after `sectionSizes`). Replace the fields at :231-238 with `_resizeMode`, `_outlineDrag` and `_resizeDrag`. `applyOptions` dispatches `resizeMode`. Add `getResizeMode` / `setResizeMode` after `setResizable` (:612-617). Add the `GutterDragFrame` and `AccordionOutlineDrag` interfaces.
    - The `onGutterDrag` split and the new methods per *Internal Structure*; the outline branch at the end of `onGutterDragStart`.
    - `scheduleGutterDrag` becomes a forwarder (JSDoc as in step 8g, keeping its paragraph on why skipping intermediate positions changes nothing). Delete `flushGutterDrag`. `onGutterDragEnd`: the new body; its JSDoc says it ends the session — flushing the freshest move, or committing the outline — and fires `sectionresize` unless the drag was cancelled, including on the `detach()` path. `onGutterDrag`'s JSDoc keeps its description; each new method gets its own.
    - `detach`: replace :1211-1215 with `this._resizeDrag.cancel();`. Keep the comment above it, changing its last sentence to "onGutterDragEnd's own `end()` below then flushes nothing."
    - Check: A1–A4 pass; `Accordion.resizable.test.ts` and `Accordion.manager.test.ts` are green unmodified; `grep -n "_pendingGutterDrag\|_dragRafHandle\|flushGutterDrag" src/typescript/lib/layout/Accordion.ts` prints nothing.

11. **Create `packages/lib/tests/overlay/AbstractWindow.resizeMode.test.ts`** with W1–W5, using the frame capture of `AbstractWindow.resizeFpsCoalescing.test.ts` and building each window as its `resizableWindow()` does: `show()`, then drop the frames that queued. In [`AbstractWindow.resizable.test.ts`](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts#L94), the case 'lets onResize through on a resizable window' adds `win.getElement(true);` after `const win = new Window('W');`, with the comment "rendered: the release now applies the buffered move at once, and a window lays out only once it has an element". Check: W1–W5 fail.

12. **`overlay/AbstractWindow.ts`:**
    - `WindowOptions` gets `resizeMode` (after `constrainToViewport`); `applyOptions` dispatches it; add `getResizeMode` / `setResizeMode` after `setResizeFps` (:2175-2180).
    - Add the `WindowResizeFrame` interface. Replace `_resizeCoalescer` with `_resizeDrag`; add `_resizeChromeMin`.
    - `onResize`: the outline branch in the session-start block; `this._resizeDrag.schedule({ clientX: e.clientX, clientY: e.clientY, border })` replaces the coalescer's `schedule`. `onResizeEnd`: call `this._resizeDrag.end()` and set `_resizeChromeMin = null`, keeping the listener removal; its JSDoc adds that ending the session applies the last move, or commits the outline.
    - `resolveResizeFrame`, the new `applyResizeFrame`, `previewResizeFrame`, `resizedWidth`, `resizedHeight`. `applyResizeFrame`'s JSDoc drops its `{@link _resizeCoalescer}` sentence: it lays out one live frame, or an outline drag's release.
    - `onExitAction` (:1057) and `setWindowState` (:1230): `_resizeCoalescer.cancel()` becomes `_resizeDrag.cancel()`. In `destructor` (:1110), add `this._resizeDrag.cancel();` beside the animation cancels, with the comment "an outline drawn beside the window is not in its subtree, and a buffered frame must not lay out a destroyed window".
    - Update `setResizeFps`' JSDoc: the cap applies to live frames; an outline frame runs no layout.[^fps-outline]
    - Check: W1–W5 pass; every `tests/overlay/AbstractWindow*.test.ts` suite is green; `grep -n "_resizeCoalescer" src/typescript/lib/overlay/AbstractWindow.ts` prints nothing.

13. **Comments that name the deleted `flushDrag`.** Rewrite each by the table below; change nothing else.

    | Before | After |
    |---|---|
    | `` `Split.scheduleDrag`/`flushDrag` `` | `` `Split.scheduleDrag` and its per-frame drag session (`core/ResizeDrag.ts`) `` |
    | `` `Split.flushDrag` `` | `` `Split`'s per-frame drag flush `` |
    | `` `layout/Split.ts`'s `scheduleDrag`/`flushDrag` `` | `` `layout/Split.ts`'s `scheduleDrag` and `core/ResizeDrag.ts` `` |
    | `Split's own scheduleDrag/flushDrag` | `Split's own scheduleDrag and its per-frame drag session` |

    Sites: [AbstractWindow.ts:3299-3300](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3299); [VirtualRowView.ts:482, :526](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L482); [ScrollStrip.ts:566, :611](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L566); [Panel.ts:712, :770](packages/lib/src/typescript/lib/core/Panel.ts#L712); [ResizeLayoutEconomyRealtime.test.ts:6-7, :146](packages/lib/tests/component/tree/ResizeLayoutEconomyRealtime.test.ts#L6); [ScrollStrip.resizeResyncCoalescingRealtime.test.ts:5-6, :133](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts#L5); [DragManager.pointerCoalescing.test.ts:10](packages/lib/tests/overlay/DragManager.pointerCoalescing.test.ts#L10). Check: `grep -rn "flushDrag\|flushGutterDrag\|_resizeCoalescer" packages/lib/src packages/lib/tests packages/qa/src` from the repository root prints nothing.

14. **QA app** (`packages/qa`):
    - (a) `src/harness/drivers.ts`: add `dragout`. Factor `drag`'s body into a private `pressAndDrag(ctx, name, stepFor: (index: number) => number)`, which uses `name` in its error messages; `drag` passes `(i) => triangleStep(i, ctx.units, ctx.stepPx)`, `dragout` passes `() => ctx.stepPx`. Add `dragout` to `DRIVERS` after `drag`. Its JSDoc: drags `target.element` `step` px along `target.axis` every unit, never back, from a `mousedown` at its centre to a `mouseup` `units × step` px away.
    - (b) `src/mount.ts`: export `applyResizeMode(body: Body, value: string | null): void`. It does nothing for `null` or `''`. It throws `resize: unknown mode "<value>" (expected live, outline)` for a value other than `live` or `outline`. It throws `resize=<value>: this library build has no Body.setResizeMode` when `body` has no such function. Otherwise it calls the setter. Call it in `mountPanel` right after `Body.init`. After the target merge, set `targets.dragout = targets.drag` when `drag` is defined and `dragout` is not, with the comment "`dragout` drags the same handle `drag` does, one way".
    - (c) `src/builders/shared.ts`: add `export const RESIZE_OUTLINE_SELECTOR = '.ResizeOutline';` with a comment naming the library's outline element. In `src/builders/shell.ts` (the `geometry` object in `buildShell`) and `src/panels/windows.ts` (the `geometry` field), add `resizeOutline: RESIZE_OUTLINE_SELECTOR`; retype `shell.ts`'s `geometry` as `Record<string, GeometryTarget>`.
    - (d) Tests Q1 in `tests/drivers.test.ts`; Q2 and Q3 in `tests/mount.test.ts`. Extend that file's `afterEach` with `Body.getInstance().setResizeMode('live')`.
    - (e) `README.md`: see *Documentation Impact*.
    - Check: `(cd packages/qa && npm test)`, after `npm run build:lib` in `packages/lib`.

15. **Documentation**, per *Documentation Impact*.

16. **Run *Verification*'s implementer checks.** Stop there. The in-engine A/B is the orchestrator's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/PerFrameCoalescer.ts` |
| Create | `packages/lib/src/typescript/lib/core/ResizeDrag.ts` |
| Create | `packages/lib/tests/core/ResizeDrag.test.ts` |
| Create | `packages/lib/tests/component/layout/Split.resizeMode.test.ts` |
| Create | `packages/lib/tests/component/layout/Accordion.resizeMode.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.resizeMode.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` (two visibility words) |
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` (comments only) |
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` (comments only) |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` (comments only) |
| Modify | `packages/lib/tests/overlay/AbstractWindow.resizable.test.ts` (one line) |
| Modify | `packages/lib/tests/component/tree/ResizeLayoutEconomyRealtime.test.ts` (comments only) |
| Modify | `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts` (comments only) |
| Modify | `packages/lib/tests/overlay/DragManager.pointerCoalescing.test.ts` (comment only) |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/layouts/Accordion.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/concepts/theming.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/qa/src/harness/drivers.ts` |
| Modify | `packages/qa/src/mount.ts` |
| Modify | `packages/qa/src/builders/shared.ts` |
| Modify | `packages/qa/src/builders/shell.ts` |
| Modify | `packages/qa/src/panels/windows.ts` |
| Modify | `packages/qa/tests/drivers.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

R, B, S, A, W and Q are unit-testable offline. M is in-engine only. The Split, Accordion and window figures are today's live-mode results from an offline probe; outline mode must reproduce them at rest.[^probe]

**Driving a drag in a test.** A gutter drag goes through the gutter's own handlers — `gutter.onDragStart({ clientX } as MouseEvent)`, then `gutter.onDrag({ clientX } as MouseEvent)` (`clientY` for a vertical gutter), each followed by a drained frame, then `gutter.onDragStop()` — as [Split.test.ts:1291-1322](packages/lib/tests/component/layout/Split.test.ts#L1291) does. A window drag is `win.onResize(border, event)` per move, each followed by a drained frame, then `onResizeEnd()`. A **visual box** is `getX() + getTranslateX()`, `getY() + getTranslateY()`, `getWidth()`, `getHeight()`. "The outline" is the session's `_outline`.

### `ResizeDrag` — hooks are `vi.fn` spies; `preview(v)` returns `{ x: v, y: 0, width: 4, height: 100 }`

- **R1. Live frames.** `beginLive()`, then `schedule(1)`, `schedule(2)`, `schedule(3)`: no hook runs. One drained frame: `apply` once, with 3. `preview` and `commit` never run.
- **R2. Live release.** `beginLive()`, `schedule(5)`, then `end()` returns `true` and has called `apply(5)` synchronously. A frame drained afterwards applies nothing.
- **R3. Outline start and frames.** On a rendered host `Container`, `beginOutline({ parent: host element, start: { x: 10, y: 0, width: 4, height: 100 }, zIndex: 8999 })`. The outline's element is a child of the host's element. Its box is 10, 0, 4, 100; `getZIndex()` is 8999; `getPointerEvents()` is `"none"`; `getWillChange()` is `"transform"`. `schedule(40)` and a frame: `preview(40)` once, `apply` never, and the outline's `getTranslateX()` is 30 and `getTranslateY()` 0.
- **R4. Outline release.** After R3, `schedule(55)` with no frame, then `end()`: `preview(55)` has run, then `commit(55)` exactly once; the outline is disposed and no longer under the host; `end()` returned `true`.
- **R5. Outline release with no move.** `beginOutline(…)` then `end()`: `commit` never runs, the outline is removed, `true`.
- **R6. Outline cancel.** `beginOutline(…)`, `schedule(40)`, a frame, `cancel()`: the outline is removed. `schedule(60)` and frames: no further `preview`. `end()` returns `false`; `commit` never ran. Then `beginLive()`, `schedule(1)` and a frame: `apply(1)` — the session is reusable.
- **R7. Live cancel.** `beginLive()`, `schedule(5)`, `cancel()`: a drained frame applies nothing; `end()` returns `true`; `apply` never ran.
- **R8. Escape.** Take `Event.listenerCounts().viewport` before the drag. `beginOutline(…)`, then a `keydown` with `key: "a"` dispatched on the window: nothing changes. A `keydown` with `key: "Escape"`: the outline is removed, and `end()` returns `false`. The viewport listener count is back to its value before the drag, and a second Escape dispatch throws nothing.
- **R9. Blur.** During an outline drag, a `blur` whose target is an element's handle leaves the outline. A `blur` whose target is the window removes it, and `end()` returns `false`.
- **R10. The fps cap caps live frames only.** `new ResizeDrag(hooks, () => 20)`. Live: frames drained at 1000 and then, after another `schedule`, at 1030 and 1050 apply at 1000 and 1050 only. Outline: frames at 1000 and 1010 each preview.
- **R11. Beginning again closes the open drag.** `beginOutline` twice: the first outline is disposed and its element has no parent, the second is under the host, and `commit` never ran.
- **R12. The outline writes no stylesheet rule of its own.** After two outline drags, `styleRuleEntries()` holds a class rule for `ResizeOutline` whose text names `--ts-ui-drag-reorder-color`, and no entry whose selector names either outline's `#<id>`.
- **R13. The app-wide default.** `getAppResizeMode()` is `"live"`; after `setAppResizeMode("outline")` it is `"outline"`.
- **R14. `gutterOutline`.**

  | Box | Axis | Result |
  |---|---|---|
  | 97, 0, 10, 300 | `"x"` | 100, 0, 4, 300 |
  | 0, 221.766, 400, 6 | `"y"` | 0, 222.766, 400, 4 |

- **B1. `Body`.** `Body.getInstance().setResizeMode("outline")`: `getResizeMode()` and `getAppResizeMode()` both read `"outline"`, and `new Split().getResizeMode()` is `"outline"`. `await Body.init({ resizeMode: "live" })`: `getResizeMode()` is `"live"`.

### `Split` — the scene

A `Container` host, 400×300, rendered, `clearInsets()`, with `new Split({ orientation: 'horizontal', resizeMode })`. `lhs`: `preferredSize` 100×300, `setMinSize({ width: 60, height: 0 })`, `setMaxSize({ width: 250, height: 10000 })`, rendered, added with `{ weight: 0 }`. `rhs`: `preferredSize` 100×300, `setMinSize({ width: 80, height: 0 })`, rendered, added with `{ weight: 1 }`. After `host.doLayout()`: `lhs` 0, 0, 100, 300; the gutter 97, 0, 10, 300; `rhs` 104, 0, 296, 300. Press at `clientX` 100.

- **S1. Mode resolution** — the table in *The API* decision, including `setResizeMode(null)` falling back.
- **S2. Mid-drag, the panes stay.** Outline mode, a move to 140 and a frame. `lhs`, the gutter and `rhs` keep their boxes; `getPaneSize(lhs)` is 100; spies on `lhs.doLayout` and `rhs.doLayout` report 0 calls. The outline's parent is the gutter's parent element; its box is 100, 0, 4, 300; its translate is 40, 0.
- **S3. The outline honours the clamp.** Moves to 400 then 70, a frame after each: translate 150 (`lhs` stops at its 250 max), then −30.
- **S4. Release lands where live does.** Moves 140, 400, 70, a frame after each, then release. `lhs` 0, 0, 70, 300; the gutter 67, 0, 10, 300; `rhs` 74, 0, 326, 300. `getPaneSizes()` is `[{ unit: 'px', value: 70 }, { unit: 'ratio', value: 1 }]`. `paneresize` fires once, with those sizes. The outline is gone. The same drive in live mode gives the same boxes and sizes.
- **S5. Escape.** Outline mode, a move to 140, a frame, Escape: the outline is removed. A move to 200 and a frame: nothing moves. Release: every box as before the press; no `paneresize`.
- **S6. Detach mid-drag.** Outline mode, a move and a frame, then `host.setLayoutManager(new Fit())`: the outline element is gone, and `Event.listenerCounts().viewport` equals its value before the press.
- **S7. The app-wide default reaches a split with no mode of its own.** No `resizeMode` option; `setAppResizeMode("outline")`; a press and a move show an outline.

`Split.test.ts` passes unmodified, including its spy on `onDrag` ([:1291-1322](packages/lib/tests/component/layout/Split.test.ts#L1291)).

### `Accordion` — the scene

`new Accordion()`, `setHeaderHeight(30)`, `setResizable(true)`, `setResizeMode(mode)`. A `Container` host, rendered, 400×700, `clearInsets()`. Sections, each a rendered `Component` of width 100 with `setMinSize` / `setMaxSize` as given, added with `new AccordionConstraints(label, open)` and `weight` when given:

| Section | Preferred height | Min | Max | Open | Weight |
|---|---|---|---|---|---|
| A | 80 | 40 | 160 | yes | 1 |
| B | 80 | 30 | — | yes | — (resize-pinned) |
| X | 50 | 10 | — | no | — |
| C | 120 | 60 | 200 | yes | 2 |
| D | 100 | 20 | — | yes | 1 |

`host.doLayout()`, then `host.setHeight(560)` and `host.doLayout()`. Then A 87.766, B 80, C 140.426, D 101.809, and gutter 1 (between B and C) at 0, 221.766, 400, 6. Drag gutter 1 through its own handlers: press at `clientY` 0, then moves to 40, 160, 250, −90, −260, 30, 290, 12, each followed by a frame.

- **A1. Mid-drag, the sections stay.** Outline mode, before the release: every section keeps its height. The outline's box is 0, 222.766, 400, 4, and its `getTranslateY()` is 12 (±1e-9) — the sum of A's and B's height changes in the shadow.
- **A2. Release lands where live does.** After the release: A 40, B 139.766, C 200, D 30.234 (to 3 decimals); gutter 1's y is 233.766; `getSectionSizes()` equals the live-mode run's (ratio 0.14802, px 139.766, px 0, ratio 0.74010, ratio 0.11188, to 5 decimals); `sectionresize` fired once. The same drive in live mode gives identical heights, gutter boxes and sizes.
- **A3. Escape.** Outline mode, press, two moves with frames, Escape, release: every height as before the press; no `sectionresize`.
- **A4. Detach mid-drag.** Outline mode, press, a move, a frame, then `host.setLayoutManager(new Fit())`: the outline is gone, and `sectionresize` did not fire. In live mode the same sequence fires `sectionresize` once, as today.

`Accordion.resizable.test.ts` and `Accordion.manager.test.ts` pass unmodified.

### `AbstractWindow` — `new Window('W')`, `show()`: 50, 50, 400, 300 in a 1280×800 viewport

- **W1. Mid-drag, the window stays.** Outline mode, `Direction.EAST`, moves (0, 0) then (30, 0), a frame. The window's box is still 50, 50, 400, 300; spies on `setWidth` and `doLayout` report 0 calls. The outline's parent is `DOM.source.getDocumentElement()`, its `getZIndex()` equals the window's, and its visual box is 50, 50, 430, 300.
- **W2. Every direction lands where live does.** For each row, press at (0, 0), move to the offset, a frame, release. The window's box after release equals the row, in both modes, and in outline mode the outline's visual box just before release equals it too:

  | Direction | Offset | Box after release | Bound that applies |
  |---|---|---|---|
  | EAST | +30, 0 | 50, 50, 430, 300 | — |
  | WEST | +300, 0 | 258, 50, 192, 300 | the chrome floor, 192 |
  | SOUTH | 0, +600 | 50, 50, 400, 750 | the viewport, 800 − 50 |
  | NORTH | 0, −100 | 50, 0, 400, 350 | the viewport's top |
  | NORTHWEST | −20, −20 | 30, 30, 420, 320 | — |
  | SOUTHEAST | +2000, +2000 | 50, 50, 1230, 750 | the viewport, both axes |

- **W3. The fps cap does not delay the outline.** `setResizeFps(20)`, outline mode: moves drained at 1000 and 1010 both move the outline.
- **W4. Cancellation.** Outline mode, a move and a frame, then separately each of `onExitAction()`, `setWindowState('maximized')` and `dispose()`: the outline is gone. Where the window survives (`setWindowState`), a later `onResize` move and `onResizeEnd()` change nothing the maximize did not.
- **W5. A live release applies the last move at once.** Live mode, moves (0, 0) and (30, 0) with no frame, then `onResizeEnd()`: the width is 430 on return.

Every `tests/overlay/AbstractWindow*.test.ts` suite passes, with the one-line change of step 11.

### QA app

- **Q1. `dragout`.** Fake tools; an element whose rectangle is 0, 0, 100, 20; axis `'x'`; 3 units; step 3. `fireMouse` receives `mousedown` at (50, 10) on the element, `mousemove` on `document` at (53, 10), (56, 10), (59, 10), and `mouseup` on `document` at (59, 10). Axis `'y'` moves `y` instead. Axis `'z'` rejects with `dragout: target axis must be "x" or "y"`.
- **Q2. `resize=` and the alias.** Mounting `shell-shallow` with `resize=outline` leaves `Body.getInstance().getResizeMode()` at `"outline"`. `resize=bogus` rejects with `resize: unknown mode "bogus" (expected live, outline)`. The mounted `targets.dragout` is the same object as `targets.drag`.
- **Q3. The label.** Both shells' and the `windows` panel's `geometry` map `resizeOutline` to `'.ResizeOutline'`.

### M. In-engine (the orchestrator's)

The A/B in *Verification*: in outline mode the page does not move during a drag and comes to rest exactly where live mode puts it; outline frames do almost no work; live mode is unchanged.

---

## Verification

**Implementer**, from `packages/lib`:

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint` — clean.
- `npm test` — green, with R1–R14, B1, S1–S7, A1–A4 and W1–W5 new. **The suite is not the gate.** A wrong size-hint memo key once passed every test in the suite (`97-wave2-measurement.md`). Geometry in the engine is the gate.
- The grep checks in steps 2, 8, 10, 12 and 13.
- `npm run build:lib`, then `(cd ../qa && npm test)` — Q1–Q3 new; the panels still mount under jsdom. This opens no window.
- `npm run docs:api` — the 14 warnings `master` already has, and no new one. `npm run docs:llms:check` — clean.
- **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/*.sh`, MiniBrowser or the Tauri host.** Each opens a full-screen window.

**Orchestrator — the in-engine A/B, with the user's go-ahead. The implementer never runs it.** Same session, MiniBrowser, `work=1&seam=1&geom=1` on every run. The cells are W3.0's six drag cells, plus `ssc` for `Accordion`'s gutter, which W3.0 did not measure. Every run drives `drag` (phase 0, W3.0's measured phase), then `dragout:40` (phase 1), then `idle:4` (phase 2, the resting layout). Each cell runs base, live, outline, base, outline, live, base: 7 runs, 49 in all, about 20–25 minutes.

1. Build the base arm — `runqa.sh`'s `wt` arm — at the SHA recorded in step 1, per [`packages/qa/README.md:87-99`](packages/qa/README.md#L87):

   ```sh
   cd /home/jika/typescript/typescript-ui
   git worktree add .worktrees/_ro-base <base-sha> --detach
   ln -sfn "$PWD/node_modules" .worktrees/_ro-base/node_modules
   (cd .worktrees/_ro-base/packages/lib && npm run build:lib)
   export QA_WT_LIB="$PWD/.worktrees/_ro-base/packages/lib"
   ```

2. Build the fix arm — the `main` arm — with `npm run build:lib` in the implementation worktree. The QA page is always the implementation worktree's, so the base arm gets `dragout` and the `resizeOutline` label too; it is never passed `resize=`.

3. Save this script outside the repository as `resize-outline-ab.sh`, in the style of [`packages/qa/sweeps/w3-0.sh`](packages/qa/sweeps/w3-0.sh). From the implementation worktree's root, run `bash resize-outline-ab.sh --dry-run` (expect 49 `runqa` lines), then `bash resize-outline-ab.sh`, then `bash resize-outline-ab.sh --read`. A cell that fails part-way is re-run whole under a new tag: `RO_SESSION=s2 bash resize-outline-ab.sh sdh`, read with `RO_SESSION=s2 bash resize-outline-ab.sh --read sdh`.

   ```bash
   #!/bin/bash
   # resizeMode in-engine A/B: bash resize-outline-ab.sh [--dry-run | --read] [<cell> ...]
   #
   # Every run opens a full-screen window and holds it until the run ends. The
   # orchestrator runs this with the user's go-ahead; an implementer never does.
   # Run from the repository root of the checkout holding the fix, with its
   # packages/lib built (the main arm) and QA_WT_LIB set to a built packages/lib
   # at the plan's base commit (the wt arm). --dry-run and --read open nothing.
   set -u
   RUNQA=packages/qa/runqa.sh
   RESULTS=packages/qa/results
   SESSION=${RO_SESSION:-s1}
   FLAGS='work=1&seam=1&geom=1'
   # Phase 0 is W3.0's measured drag; phase 1 ends 120 px away; phase 2 samples the rest.
   DRIVE='drive=drag,dragout:40,idle:4'
   CELLS="sdh sd4h sdv sds sss ssc we"

   # A cell's panel and grip: W3.0's drag cells (b00), plus ssc for the Accordion gutter.
   params() {
       case "$1" in
           sdh)  echo 'panel=shell-deep' ;;
           sd4h) echo 'panel=shell-deep&n=4' ;;
           sdv)  echo 'panel=shell-deep&grip=dock-v' ;;
           sds)  echo 'panel=shell-deep&grip=sidebar' ;;
           sss)  echo 'panel=shell-shallow&grip=sidebar' ;;
           ssc)  echo 'panel=shell-shallow&grip=section' ;;
           we)   echo 'panel=windows&grip=edge' ;;
           *)    return 1 ;;
       esac
   }

   MODE=run
   case "${1:-}" in
       --dry-run) MODE=dry; shift ;;
       --read) MODE=read; shift ;;
   esac

   selected=${*:-$CELLS}

   for c in $selected; do
       params "$c" > /dev/null || { echo "unknown cell $c (cells: $CELLS)" >&2; exit 2; }
   done

   if [ "$MODE" = read ]; then
       exec python3 - "$RESULTS" "$SESSION" $selected <<'PY'
   import glob, json, sys

   # Ablation bookkeeping that work/u leaves out, as qa-table.py does.
   BOOKKEEPING = ('memo.', 'skipped.', 'stubbed.', 'dose.')
   # The outline's geometry label: null in every live layout and at rest.
   OUTLINE = 'resizeOutline'
   # Per cell: the base label whose growth the outline must track, that label's
   # field, and the outline's field — indices into [left, top, width, height].
   TRAVEL = {
       'sdh': ('editor0', 3, 1), 'sd4h': ('editor0', 3, 1), 'sdv': ('editor0', 2, 0),
       'sds': ('sidebar', 2, 0), 'sss': ('sidebar', 2, 0), 'ssc': ('files', 3, 1),
       'we':  ('win0', 2, 2),
   }
   # Two rounded samples of the same edge may differ by a pixel.
   TOLERANCE_PX = 1

   results, session, cells = sys.argv[1], sys.argv[2], sys.argv[3:]


   def work(ph):
       return sum(v for k, v in ph['work'].items() if not k.startswith(BOOKKEEPING))


   def sink(ph, key):
       return ph['seam']['sink'].get(key, 0)


   def mean(xs):
       return sum(xs) / len(xs)


   def diff(labels):
       return '=' if not labels else 'DIFF(' + ','.join(sorted(labels)) + ')'


   for cell in cells:
       paths = sorted(glob.glob(f'{results}/ro{session}-{cell}-*.json'), key=lambda p: int(p.rsplit('-', 1)[1].split('.')[0]))
       runs = [json.load(open(p)) for p in paths]
       arm = lambda run: run['name'].split('-')[2]
       ref = next(r for r in runs if r['name'].endswith('-base-a'))
       # base-a's phase-0 samples: unit 0 is the layout before the press.
       drag0, rest0 = ref['phases'][0]['geometry'], ref['phases'][2]['geometry']
       print(f'{cell}:')

       for run in runs:
           g = [ph['geometry'] for ph in run['phases']]
           rest = {l for l in rest0 if g[2][l][-1] != rest0[l][-1]}

           if arm(run) == 'outline':
               still = {l for p in (0, 1) for l in drag0 if l != OUTLINE and any(s != drag0[l][0] for s in g[p][l])}
               shown = all(s is not None for p in (0, 1) for s in g[p][OUTLINE]) and all(s is None for s in g[2][OUTLINE])
               travel = 'n/a'

               if shown:
                   label, ref_field, out_field = TRAVEL[cell]
                   o, b = g[0][OUTLINE], drag0[label]
                   hits = sum(abs((o[k][out_field] - o[0][out_field]) - (b[k][ref_field] - b[0][ref_field])) <= TOLERANCE_PX for k in range(1, len(b)))
                   travel = f'{hits}/{len(b) - 1}'

               gate = f"still {diff(still)}  outline {'yes' if shown else 'NO'}  travel {travel}"
           else:
               gate = f"drag {diff({l for l in drag0 if g[0][l] != drag0[l]})}"

           ph = run['phases'][0]
           print(f"  {run['name']:22} avg {ph['timing']['avgMs']:6.2f}  idle {run['idle']['avgMs']:5.2f}  work/u {work(ph):8.2f}"
                 f"  apply/u {sink(ph, 'apply'):7.2f}  rules/u {sink(ph, 'setRuleStyles'):5.2f}  raf/u {sink(ph, 'requestAnimationFrame'):4.2f}"
                 f"  sidebar.doLayout {ph['work'].get('sidebar.doLayout', 0):.2f}  {gate}  rest {diff(rest)}")

       phases = lambda name: [r['phases'][0] for r in runs if arm(r) == name]
       base, live, out = phases('base'), phases('live'), phases('outline')
       ms = lambda phs: [p['timing']['avgMs'] for p in phs]
       bracket = max(ms(base)) - min(ms(base))
       verdict = lambda d: 'win' if d < -bracket else 'regress' if d > bracket else 'flat'
       base_ms, base_work = mean(ms(base)), mean([work(p) for p in base])
       base_idle = mean([r['idle']['avgMs'] for r in runs if arm(r) == 'base'])
       d_live, d_out = mean(ms(live)) - base_ms, mean(ms(out)) - base_ms
       print(f"  bracket {bracket:.2f}  live Δms {d_live:+.2f} ({verdict(d_live)})  Δwork {100 * (mean([work(p) for p in live]) - base_work) / base_work:+.1f}%")
       print(f"  outline Δms {d_out:+.2f} ({verdict(d_out)})  excess removed {100 * -d_out / (base_ms - base_idle):.0f}%  work {100 * mean([work(p) for p in out]) / base_work:.1f}% of base")
   PY
   fi

   if [ "$MODE" = run ]; then
       [ -f packages/lib/dist/lib/core.es.js ] || { echo "build packages/lib first" >&2; exit 2; }
       [ -f "${QA_WT_LIB:-/nonexistent}/dist/lib/core.es.js" ] || { echo "set QA_WT_LIB to a built packages/lib at the base commit" >&2; exit 2; }
   fi

   # One run: printed under --dry-run, otherwise run, stopping at the first failure.
   run() {
       if [ "$MODE" = dry ]; then
           printf 'runqa %s %s %s\n' "$1" "$2" "$3"
       else
           "$RUNQA" "$1" "$2" "$3" || exit 1
       fi
   }

   # Each cell: the base at both ends and in the middle; live and outline mirrored between.
   for c in $selected; do
       p="$(params "$c")&$DRIVE&$FLAGS"
       run "ro$SESSION-$c-base-a"    wt   "$p"
       run "ro$SESSION-$c-live-1"    main "$p&resize=live"
       run "ro$SESSION-$c-outline-1" main "$p&resize=outline"
       run "ro$SESSION-$c-base-b"    wt   "$p"
       run "ro$SESSION-$c-outline-2" main "$p&resize=outline"
       run "ro$SESSION-$c-live-2"    main "$p&resize=live"
       run "ro$SESSION-$c-base-c"    wt   "$p"
   done
   ```

   What `--read` gates:
   - **`drag`** (base and live runs): every label in every phase-0 unit equals `base-a`'s.
   - **`still`** (outline runs): in phases 0 and 1, every label but `resizeOutline` holds `base-a`'s pre-press layout (its phase-0 unit 0) in every unit.
   - **`outline`**: the outline is present in every unit of phases 0–1 and absent in phase 2.
   - **`travel`**: the outline's travel matches `base-a`'s reference label, unit for unit, within a pixel.[^travel-check]
   - **`rest`** (every run): phase 2's last sample equals `base-a`'s for every label.

**Expected readings** (phase 0, `drag×150`, per unit). The W3.0 columns orient; the gates compare each cell with its own base arms.[^readings]

| Cell | W3.0 plain ms | W3.0 idle ms | W3.0 work/u | W3.0 apply/u | Outline work/u | Outline apply/u | Outline Δms |
|---|---|---|---|---|---|---|---|
| `sdh` | 57.5–65.3 | 9.2–9.5 | 872.0 | 132.0 | ≤ 17.4 | 1.0–2.3 | ≈ −48 to −56 |
| `sd4h` | 60.2 | 8.9 | 2,588.0 | 180.0 | ≤ 51.8 | 1.0–2.8 | ≈ −51 |
| `sdv` | 39.6 | 10.9 | 374.0 | 78.0 | ≤ 7.5 | 1.0–1.8 | ≈ −29 |
| `sds` | 69.3–71.1 | 8.8–10.4 | 6,460.9 | 551.1 | ≤ 129 | 1.0–6.5 | ≈ −60 |
| `sss` | 62.9–64.8 | 9.2–10.7 | 5,696.9 | 434.1 | ≤ 114 | 1.0–5.3 | ≈ −54 |
| `ssc` | not measured | — | — | — | ≤ 2% of base | 1.0 to 1 + base/100 | ≥ 80% of the excess |
| `we` | 42.8 | 17.4 | 667.0 | 51.3 | ≤ 13.3 | 1.0–1.5 | ≈ −25 |

Also expected, per unit, on outline runs: `rules/u` ≤ 0.1 (the base writes 6.01 on `sdh` and `sd4h` and 9.01 on `sds`); `raf/u` ≤ 1.05; `sidebar.doLayout` ≤ 0.02 on `sds` and `sss` (1.00 on the base).

**Pass criteria:**

1. `rest =` on every run of every cell. A `DIFF` on a base run means the cell is unstable: re-run it whole under a new `RO_SESSION`. A `DIFF` on a live or outline run stops the merge.
2. Live runs: `drag =` on both. Δms is not `regress`. Δwork is within ±1% (on `we`, 0 to +1%, the release frame now counted inside the phase). A base run's own `drag` `DIFF` voids that cell's in-drag gate: re-run the cell once, and if the base still disagrees, record the cell's in-drag gate as unstable and judge it on `rest` and the counters.
3. Outline runs, both of them: `still =`, `outline yes`, travel at least 95% of units; work ≤ 2% of the base mean; apply/u ≤ 1 + the base's apply/u ÷ 100; the per-unit limits above; Δms `win`.
4. Expected, not a merge stop: "excess removed" ≥ 80% on every cell. A shortfall is recorded and investigated.

**Record.** Append the readings to the *Validated* cells of the `shell-deep`, `shell-shallow` and `windows` rows of [`packages/qa/README.md`](packages/qa/README.md#L322), in the shape of the W3.0 baseline lines there: date, lib SHA, run names `ros1-*`, per cell base → outline ms and work/u, and the gates. Then `git worktree remove .worktrees/_ro-base`.

---

## Documentation Impact

- **Exports.** `ResizeMode` is exported as a type from `core/index.ts` with `@category Core`; the new options and methods render from their JSDoc on the `Split`, `Accordion`, `AbstractWindow` / `Window` / `TabWindow` and `Body` API pages. Public JSDoc may `{@link}` `ResizeMode` and `Body.setResizeMode`, never `ResizeDrag`, `ResizeOutline` or any other symbol of `core/ResizeDrag.ts`: those are internal. No new public class, so `llms.txt`'s manifest is unchanged.
- **[`docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md#L186).** Before *Common methods*, a section:

  > ## Live or outline resizing
  >
  > By default a gutter drag lays both neighbouring panes out on every frame, so their content reflows as the gutter moves. With `resizeMode: 'outline'` the panes stay put while a thin accent-blue line follows the pointer — stopping exactly where the drag would stop — and the panes are laid out once, on release. Press Escape before releasing to cancel: the line disappears and nothing changes.
  >
  > ```typescript
  > const split = Split({ orientation: 'horizontal', resizeMode: 'outline' });
  > ```
  >
  > A split with no `resizeMode` of its own follows the app-wide default set through [`Body.init`](/components/Body#resize-mode), which is `'live'` unless you change it. The mode is read when a drag starts. `paneresize` fires once per release in both modes, and not after a cancelled drag. Outline mode trades the live reflow for speed: a pane with expensive content — a code editor, a wide table — costs nothing while the gutter moves.

  In the *Common methods* table, add a row: `setResizeMode(mode)` | `'live'` or `'outline'`; `null` follows the app-wide default.
- **[`docs/layouts/Accordion.md`](packages/lib/docs/layouts/Accordion.md#L132),** *Resizable sections*, before *Saving and restoring section sizes*: "`resizeMode: 'outline'` (or `setResizeMode('outline')`) makes a gutter drag move a line instead of the sections, and lays the sections out once on release, exactly where a live drag would have left them; Escape cancels. Without it the accordion follows the app-wide default set through [`Body.init`](/components/Body#resize-mode). `sectionresize` fires once per release in both modes, and not after a cancelled drag."
- **[`docs/components/Window.md`](packages/lib/docs/components/Window.md#L57).** A *Common methods* row: `setResizeMode(mode)` | `'outline'` moves a frame during an edge drag and lays the window out once on release. After *Snap-resize modifier*, a section **Outline resizing**: an edge or corner drag in outline mode moves a 2 px frame on the window's new box, clamped as the resize would be; the window and its content are laid out once on release; Escape cancels; `setResizeFps` caps live frames only; moving a window by its header is unaffected.
- **[`docs/components/Body.md`](packages/lib/docs/components/Body.md#L66).** After *Context menu*, a section **Resize mode**: `await Body.init({ layoutManager: Fit(), resizeMode: 'outline' })` makes every `Split`, resizable `Accordion` and window drag outline-first — including the splits and float windows a `Dock` builds — unless one sets its own `resizeMode`; `Body.getInstance().setResizeMode(mode)` changes it later, from the next drag. Add a *Notes* bullet: "**Resize mode** — gutter and window-edge drags lay out live by default; pass `resizeMode: 'outline'` for an outline and one layout on release."
- **[`docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md#L42).** After *pauseLayout / resumeLayout*, a section **Outline resizing**: what a live drag costs per frame (the whole subtree beside the gutter re-lays out; 25–60 ms per frame on the QA shells); what `resizeMode: 'outline'` does (one outline write per frame, one layout on release), and how to turn it on app-wide; what it does not cover (the OS window frame under Tauri, table column resize, a window moved by its header, which already only translates). In *Compositor-layer hints*, add a bullet: "**Resize outline** — set when an outline drag starts; the outline is removed when it ends."
- **[`docs/concepts/theming.md:118`](packages/lib/docs/concepts/theming.md#L118).** In the list of places the accent blue marks position, after "the [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator) bar", add "the outline an `outline` resize drag draws".
- **[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L191),** *Added*:
  - *Core*: "**`resizeMode` — live or outline resizing.** `Body.init({ resizeMode })` and `Body.setResizeMode(mode)` set the app-wide mode for gutter and window-edge drags; `'outline'` moves an outline and lays out once on release, `'live'` (the default) keeps today's behaviour. The `ResizeMode` type is exported from `core`."
  - *Layouts*: "**`Split` and `Accordion` take `resizeMode`**, with `getResizeMode()` / `setResizeMode(mode | null)`; a manager with none follows the app-wide mode."
  - *Overlay*: "**`Window` and `TabWindow` take `resizeMode`**, the same pair, for edge and corner drags."
  - *Changed*: add an *Overlay* subsection after *Layouts* with "**A window edge drag applies its last pointer position synchronously on release**, as a `Split` gutter drag always has, rather than on the next animation frame."
- **No migration note.** Nothing is renamed or removed from the public surface; the default mode keeps today's behaviour.
- **[`packages/qa/README.md`](packages/qa/README.md#L190).** URL-parameter table: a row `resize=live|outline` | sets the app-wide resize mode through `Body.setResizeMode` before the panel is built; a library build without it fails the run | none (the library's default, `live`). Drivers table ([:395](packages/qa/README.md#L395)): a `dragout` row — target as `drag`; per unit a `mousemove` on `document` `step` px along `axis`, always the same way; a `mousedown` at the element's centre first and a `mouseup` `units × step` px away last; every panel with a `drag` target also has `dragout`. Panel table: add `resizeOutline` (the resize outline, `null` unless an outline drag is on screen) to the *Geometry* column of `shell-deep`, `shell-shallow` and `windows`.

---

## Potential Challenges

- **Escape inside a modal `Dialog` also closes the dialog.** `LayerManager`'s viewport `keydown` runs in the same dispatch, and one viewport listener cannot stop another. Accept it: the dialog's disposal tears the drag down too, and Escape already closes a dialog mid-drag today.
- **The outline is disposed inside its own `keydown` listener.** `Event.purgeComponent` only deletes map entries, which is safe while `baseViewportListener` iterates. R8's second Escape pins it.
- **The app-wide default is module state.** It survives `DOM.reset()`. Every test file that sets it resets it in `afterEach`.
- **Live mode's calls must not change.** Keep `onGutterDrag`'s three reads before the resolve step, `onDrag`'s four bound reads in `pairBounds` in today's order, and the window's setters inside the width and height strategies. The live A/B's work gate would show any drift.
- **The live apply hook must call `this.onDrag(...)` at call time.** `Split.test.ts` spies `onDrag` on the instance after construction.
- **`setTranslate` rounds the written transform to whole pixels.** Tests read `getTranslateX()` / `getTranslateY()`, which keep the exact value.
- **A layout mid-outline-drag** (the viewport resized) leaves the outline where it was. The release still commits through the live path from the drag's origin, as a live drag's next frame would.
- **`Component.ts` is shared with other open plans.** The change is two visibility words, so any rebase is trivial.

---

## Critical Files

- [`overlay/AbstractWindow.ts:230-327`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L230) — `PerFrameCoalescer`, the buffer the session is built on; [:2114-2262](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2114) — the edge-resize path; [:2360-2408](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2360) — the header move, the precedent for a compositor-only drag committed on release; [:2857-2916](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2857) — `fadeRectSwap`, lay out once on landing.
- [`layout/Split.ts:1292-1458`](packages/lib/src/typescript/lib/layout/Split.ts#L1292) — the drag path; [:1715-1740](packages/lib/src/typescript/lib/layout/Split.ts#L1715) — `detach`; [:1920-1945](packages/lib/src/typescript/lib/layout/Split.ts#L1920) — the gutter wiring.
- [`layout/Accordion.ts:1876-2102`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1876) — the gutter drag; [:1714-1810](packages/lib/src/typescript/lib/layout/Accordion.ts#L1714) — `layoutSections`; [:1179-1230](packages/lib/src/typescript/lib/layout/Accordion.ts#L1179) — `detach`.
- [`core/PointerDrag.ts`](packages/lib/src/typescript/lib/core/PointerDrag.ts), [`core/PendingPointerDrags.ts`](packages/lib/src/typescript/lib/core/PendingPointerDrags.ts), [`core/Component.ts:1139-1175`](packages/lib/src/typescript/lib/core/Component.ts#L1139) — the handle's drag chrome and its teardown (C39).
- [`overlay/DragFeedback.ts`](packages/lib/src/typescript/lib/overlay/DragFeedback.ts), [`overlay/ReorderIndicator.ts`](packages/lib/src/typescript/lib/overlay/ReorderIndicator.ts), [`overlay/DragGhost.ts`](packages/lib/src/typescript/lib/overlay/DragGhost.ts) — drag-time overlay components: mounting, z-index, lifetime.
- [`component/container/ScrollStrip.ts:89-121`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L89) — a module-private component with class-tier chrome.
- [`core/Body.ts:15-33, :108-208`](packages/lib/src/typescript/lib/core/Body.ts#L108) — `nativeContextMenu`, the app-wide switch precedent.
- [`core/LayerManager.ts:812-845`](packages/lib/src/typescript/lib/core/LayerManager.ts#L812) — the window-blur filter and the Escape listener.
- [`tests/overlay/AbstractWindow.resizeFpsCoalescing.test.ts`](packages/lib/tests/overlay/AbstractWindow.resizeFpsCoalescing.test.ts), [`tests/component/layout/Split.test.ts:1270-1345`](packages/lib/tests/component/layout/Split.test.ts#L1270), [`tests/component/layout/Accordion.resizable.test.ts`](packages/lib/tests/component/layout/Accordion.resizable.test.ts), [`tests/overlay/LayerManager.test.ts:724-756`](packages/lib/tests/overlay/LayerManager.test.ts#L724) — the frame capture, the drag-driving and the Escape dispatch to copy.
- [`packages/qa/src/harness/drivers.ts:161-195`](packages/qa/src/harness/drivers.ts#L161), [`src/mount.ts`](packages/qa/src/mount.ts), [`src/harness/probes.ts`](packages/qa/src/harness/probes.ts), [`src/builders/shell.ts`](packages/qa/src/builders/shell.ts), [`src/panels/windows.ts`](packages/qa/src/panels/windows.ts) — the drag driver, the mount, the geometry probe and the panels.
- [`plans/split-collapse-static-participants.md`](plans/split-collapse-static-participants.md) — the plan beside this one in `Split.ts`, and the shape of its A/B.
- [`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md), [`00-agenda.md`](plans/research/render-review-2026-09-15/00-agenda.md) Decision 2, [`98-wave2-rejustification.md`](plans/research/render-review-2026-09-15/98-wave2-rejustification.md) Part 3.

---

## Non-Goals

- **Escape in live mode.** Undoing a layout already applied needs a per-owner snapshot, and would change the default mode's behaviour.
- **Table column resize, a window moved by its header, the OS window frame under Tauri, scrollbar thumbs, and `Border`'s gutters.** Column resize stays live (agenda); a header move already only translates; the OS frame is not the library's drag; a thumb drag is not a resize; `Border`'s gutters cannot be dragged.
- **Keyboard resizing and `role="separator"` for gutters and window borders.** Neither exists today; *Keyboard, collapse and ARIA are unchanged* records the rule a later plan should follow.
- **A `Dock`-level option and a dedicated theme token.** Both are the rejected alternatives in *Architecture Decisions*.
- **Touch drags on gutters.** `SplitGutter` reads `clientX` / `clientY` from a `MouseEvent`, so a touch drag does not work today in either mode.
- **Precedence between a drag's Escape and `LayerManager`'s.**
- **G12 F06.3 and F06.4, and the rest of F06.10** (unifying `Split`'s and `Accordion`'s clamp and weight rules). Only the buffer is shared here.

---

## Notes

[^api-choice]: How the library exposes behavioural defaults was searched for first. `core/ComponentDefaults.ts`, which the agenda named, is an internal per-class frozen defaults cache with no consumer setter, so it cannot carry an app-wide choice. The consumer-facing precedents are `Body.init`'s page-wide `nativeContextMenu` — a behaviour switch set once at bootstrap — and `Dock.setTabOptions`, a container forwarding settings to what it builds. An option on each owner alone would make an app set the mode on every split, accordion and window, including the ones `Dock` builds, which the app cannot reach. The app-wide default lets Loom opt in with one line. Resolving "own mode, else app-wide" in the getter follows ARCHITECTURE.md's *Class-level defaults must survive the getter*.

[^no-dock-option]: A `Dock`-level option needs `resizeMode` threaded to `Dock.compileLayout` (Dock.ts:833), `DockRegion`'s edge split (DockRegion.ts:480), `LayoutSerialization`'s restore (LayoutSerialization.ts:549) and every float window `Dock` creates, plus a setter that walks the existing regions, as `setTabOptions` does. It avoids module state but reaches only `Dock`'s own pieces, so an app's explorer `Split` or `Accordion` still needs its own option. It can be added later on top of the options this plan adds, without changing them.

[^body-not-options]: A layout manager has to read the app-wide mode at drag start. Reading it from `Body._options` would need `Body.getInstance()`, which constructs the page singleton — theme, font face and listeners included — from inside a layout manager, and in any test that builds a split without `Body`. The value therefore lives in `core/ResizeDrag.ts`, written only through `Body.setResizeMode`, as `core/PendingPointerDrags.ts` holds state that `PointerDrag` and `Component` share. ARCHITECTURE.md's "options bag is the cache" rule governs setters that write the DOM; this one writes none.

[^default-live]: Most applications show content reflowing while a divider moves, and every existing consumer expects it. Outline mode trades that reflow for frame time, which is the consumer's choice to make. The agenda recommended `"live"` for the same reason. The W3.0 figures measure what an app gains by opting in, not a defect in live mode, so they do not argue for changing the default.

[^seam-home]: The rejustification (98, Part 3) placed the flag after G12's extraction of a shared drag-frame helper. No plan extracts it — `split-collapse-static-participants` leaves the drag path to this plan — so this plan does. The helper lives in `core/`, not `layout/`, because the third owner, `AbstractWindow`, is in `overlay/`. `PerFrameCoalescer` already had the whole contract slice 06 proposed for a `RafDragBuffer` — schedule, flush, cancel, and an optional fps cap — so it is moved, not rewritten. The agenda also suggested `core/PointerDrag.ts` as the seam, but that module only suppresses pointer events and pins the cursor; the per-frame layout never passes through it (W3.0 status pass), so it cannot hold the mode.

[^shared-resolve]: Live frames keep identical calls so the live arm of the A/B can show flat work and identical geometry. The outline preview reads its bounds — the two panes' minima and maxima, the open sections' bounds, the window's chrome floor — once, at the press. The real layout does not change during an outline drag, so these cannot change unless content changes mid-drag. Even then the release, which re-reads them through the live path, lands correctly; only the outline could be off for that one drag.

[^accordion-shadow]: Probe run 2026-09-22 under the throwaway probe runner, against the library source of `feature/w3-0-results` (identical to `master`'s library). The scene was the five-section accordion of *Expected Behaviour*: a closed section between open ones, a resize-pinned section, and `_resizeFactor` 0.702 after the container resize. Its middle gutter was dragged through 18 positions with reversals and chain spills. Replaying `onGutterDrag`'s distribution on a shadow array, with no layout between frames, matched live mode's per-frame heights to 1e-13 px — the residue of the probe reading them back through `_resizeSizes`, which the plan's shadow does not do. Section minima and maxima were identical in every frame.

[^window-strategy]: `applyResizeFrame`'s eight-way switch lives once, in `resolveResizeFrame`, which takes how to size each axis. Live passes `setWidth(w).getWidth()`, so each frame makes today's setter calls in today's order, plus a same-value `setX` / `setY` that returns at its guard. The preview passes a pure floor-then-clamp: the chrome floor `AbstractWindow.setWidth` applies, read once at the press, then `Component`'s own clamp, made protected for this. So the preview is the width `setWidth` would commit. Two copies of the switch was the alternative; one copy cannot drift. Routing live frames through a pure resolver followed by `setWidth` was rejected: it adds a `chromeMinSize()` — two counted `getPreferredSize` calls — per axis per frame, changing live mode's work.

[^outline-look]: The agenda's constraint (Decision 2, item 4) is a 1–2 px border on its own pre-promoted layer, moved with `setTranslate`, one apply per frame, with no rule write, no forced read and no blur or large translucent fill — the fix for `DragGhost`'s un-composited, box-shadowed box moved by `left` / `top`. The gutter's line is as wide as `Split`'s visual gutter, so the release looks like the gutter itself arriving. A window's frame changes size every frame on an edge drag; resizing an empty bordered box is a small repaint, and its position still moves by translate. Two other shapes were considered: the real gutter translated, and a "frame-only live resize" of the window with its body's layout paused. The first leaves the window without an outline, and a translated gutter can pass under a pane added after it. The second needs `pauseLayout` on the body and still lays out the window's chrome every frame.

[^class-tier]: `border` is a hoistable `StyleBag` field, so `ownClassStyleDefaults` puts it in one shared `.ResizeOutline` class rule, written once per page. `pointer-events`, `z-index` and `will-change` are inline setters. So an outline writes no stylesheet rule at a drag's start or on any frame; in WebKitGTK every rule write restyles the whole document. The outline also returns `false` from `clampsToContentSize()`, as `Panel` and `Container` do: its owner sizes it every frame, it has no content, and the content-derived clamp would cost two size-hint reads per frame.

[^token-reuse]: ARCHITECTURE.md's drag colours reserve bright blue for "it lands here", and `--ts-ui-drag-reorder-color` is that bright mark's token: `ReorderIndicator`'s bar, which `TabBar`'s insertion bar already reuses (TabBar.ts:356). A new `drag.resizeOutline.color` key would need the `Theme` interface, all three themes and the theming table, for a colour that must match this one anyway.

[^z-index]: A component writes no `z-index: 0` (Component.ts:7032 writes only a non-zero value), so most components form no stacking context, and a descendant's z-index — `TabBar`'s strip parts use 1 and 2 — competes in the page's context. `DragFeedback` and `ReorderIndicator` meet the same problem with `LayerManager.Band.Window - 1`: above all page content, below every window. Inside a window, the window's own z-index makes it a stacking context, so the outline of a split inside a window stays inside that window. A window's outline cannot be the window's child, because the window clips with `overflow: hidden` and a growing outline would be cut off. It is the window's sibling at the document root instead, at the window's z-index and later in DOM order: above its own window, below any window stacked higher.

[^escape-scope]: `DragManager` binds no Escape itself; its recipe tells apps to wire `DragManager.cancel`. The agenda adopted "Escape restores and commits nothing" for this flag, and an outline drag makes that simple: nothing has been applied yet. The listener exists only while an outline is on screen, so it only meets keys pressed mid-drag. The blur filter mirrors `LayerManager.onWindowBlur` (LayerManager.ts:812-818): viewport listeners run in the capture phase, so the blur of whatever element had focus before the press arrives too, and must not cancel.

[^gesture-stays]: The handle — the gutter or the border — owns the pointer drag and its document chrome; the session does not. Ending the gesture from the cancel path would need each owner to reach back into its handle, and would end a gesture whose button is still held. While the button is held nothing else on the page can be used anyway, and the release ends the drag exactly as today. After a window blur the release may never arrive; then, as in live mode today, the next click's release ends the drag.

[^no-pause]: `collapsed-panes-leave-render-tree` rejected `pauseLayout` for three reasons (`00-agenda.md`, *The pauseLayout hazard*): it is a public boolean other code can read, `resumeLayout` runs a synchronous layout, and widgets read `isLayoutPaused()` for behaviour other than layout. None of the three arises, because nothing is paused. The release's one layout is synchronous by design, but it runs through the owner's normal drag apply path, the same one live mode runs every frame. `window-large-resize-fade`'s glide (AbstractWindow.ts:2857-2916) is the precedent for laying out once when motion lands; it pauses the body host only because its chrome keeps moving, which an outline drag does not need.

[^aria-rule]: `SplitGutter.ts`, `WindowBorder.ts` and `CollapseButton.ts` contain no `getAria()`, `role` or `keydown` handling. In WAI-ARIA's window-splitter pattern, `aria-valuenow` reports the current position; under outline mode the panes' position changes only at release, so that is when the value should change.

[^window-flush]: Left to its animation frame, the window's last buffered move could land a frame or more after the release, since the fps cap re-arms when frames arrive just inside its period. Flushing is what `Split` and `Accordion` do (Split.ts:1449-1458, Accordion.ts:2086-2102), and outline mode needs the flush to commit at release. One test changes because of it: a flush reaches `AbstractWindow.doLayout`, which throws on a window with no element (probed), so `AbstractWindow.resizable.test.ts`'s 'lets onResize through' renders its window first. A real border drag always has a rendered window. In the A/B, `we`'s live arm may read up to +1% work: the release frame now lands inside the drag phase's counting window.

[^scope-collapse]: That plan's footprint in `Split.ts` is two comment blocks — `setPaneCollapsed`'s JSDoc (:439-442) and the comment above its participants (:485-489) — beside `CollapseSupport.ts` and `Border.ts`. Its *Scope* leaves "every drag method (`Split.onDrag`, `scheduleDrag`) … unchanged, which leaves the later `drag-resize-outline-mode` plan a clean `Split` drag path". The two plans can land in either order. Both list `Split.ts`, `Split.md`, `performance.md`, the changelog and the QA README under `touches-shared`.

[^qa-additions]: A same-session A/B needs the mode chosen per run, and the base (`wt`) arm's library has no `setResizeMode`. A parameter the old build silently ignored — `resizeMode` passed to `Body.init`, say — would let a mis-wired run measure live mode under an outline name, so `resize=` fails loudly instead. The `drag` driver's triangle wave ends where it started, so an outline release there commits a no-op; `dragout` ends 40 × 3 = 120 px away, which makes the resting-geometry gate prove the commit lands where live mode does. `idle` is a page-wide target, so the phase after it can sample the resting layout. The outline label turns "the outline tracks the live position" into an in-engine reading. `resizeOutline` is named so because both shells already have an `outline` label (the Outline list).

[^fps-outline]: `setResizeFps` caps layout passes per second ("Throttle resize-driven layout", Window.md). An outline frame runs no layout, so capping it would only make the outline lag the pointer.

[^travel-check]: The probe samples geometry after each frame's drag flush, so base unit k and outline unit k both reflect moves 0 to k−1. Every reference grows one pixel per pixel of pointer travel: W3.0's samples show `sidebar` 280 → 283 and `editor0` 921 → 924 → 927. The 95% threshold absorbs a base frame the window's fps cap deferred, which the outline never waits for; a wrong clamp, sign or axis misses most units.

[^readings]: The W3.0 figures are its plain arms: MiniBrowser, 2026-09-22, lib `83cfb0d7` (the 96 record and the raw `w3s1-*.json`). Absolutes drift 8–14% between sessions (`00-baseline.md`), so the gates compare each cell with its own base arms. Outline work is one live frame of work at the release plus the bounds read at the press, over 150 units — about base ÷ 150, or 0.7%; 2% leaves room. Outline applies are one outline write per frame plus the release's applies over 150 units. The base's per-frame stylesheet-rule writes (6 on `sdh`, 9 on `sds`) happen only in the release. The Δms column restates W3.0's counter-only bound — an outline frame is an idle frame plus one composited move — as drag average minus idle average.

[^probe]: Probes run 2026-09-22 under the throwaway probe runner, against the library source of `feature/w3-0-results`, driving today's live path. Split: `lhs` 140 at +40, 250 at the clamp, 70 at −30, gutter 67, `rhs` 74, 0, 326, 300, sizes px 70 and ratio 1. Accordion: before and after heights, gutter boxes and `getSectionSizes()` as listed in A2. Window: the six W2 rows, and a chrome floor of 192×34 against an explicit minimum of 186×200. The same probes confirmed that a synchronous flush throws on a window with no element and runs on a rendered one.
