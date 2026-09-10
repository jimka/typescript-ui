# Dock Panel Tab Control — Implementation Plan

## Overview

`Dock` ([packages/lib/src/typescript/lib/overlay/Dock.ts](packages/lib/src/typescript/lib/overlay/Dock.ts)) manages panels by a stable id — `focusPanel(id)` and `removePanel(id)` are its two existing panel-id-keyed control methods. There is no way to relabel, re-icon, italicise, or mark a panel's tab modified by id, no way to configure a strip's presentation (tab width, scrolling) dock-wide, and no way to veto a user-initiated close. A downstream app, Loom, needs exactly these five things to move its own tab strip onto `Dock` — see its plan's `## Upstream Prerequisites` section (`/home/jika/typescript/loom/plans/dock-split-pane-editing.md:18-74`, for context only — this plan does not implement anything in that repo).

This plan adds four panel-id-keyed presentation setters, a bulk tab-strip options method, and a vetoable close event to `Dock`, built on the equivalent primitives `Tab` ([packages/lib/src/typescript/lib/layout/Tab.ts](packages/lib/src/typescript/lib/layout/Tab.ts)) and `AbstractWindow` ([packages/lib/src/typescript/lib/overlay/AbstractWindow.ts](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts)) already have or almost have. Two of `Tab`'s existing methods, `setTabItalic`/`setTabModified`, are explicitly documented today as **view-only** — they don't survive a tear-off, re-dock, or saved layout. This plan makes them durable, the same way `setTabGlyph` already is. It also fixes a real, independent bug: `setTabGlyph`, `setTabItalic`, and `setTabModified` all silently no-op when called on a tab added moments ago but not yet laid out (its strip cell doesn't exist yet) — reproducible today with no `Dock` involved at all: `tab.addComponent(x); tab.setTabGlyph(x, 'star')` returns `false` and writes nothing.

---

## Architecture Decisions

### A tab's title is durable through `Component.setName`, not `LayoutConstraints` — glyph/italic/modified are durable through `LayoutConstraints`

These are two different, already-established channels, and each new `Dock` method must use the one its `Tab` counterpart already uses:

| Field | Durable home | Why |
| --- | --- | --- |
| title | `Component.setName`/`getName()` | "The name travels with the component across re-parents (it lives on the component, not on a parent's layout constraint)."[^title-precedent] |
| glyph | `LayoutConstraints.glyph`, captured by `PanelNode.glyph` | Region-scoped; the component itself carries no glyph field.[^glyph-precedent] |
| italic / modified | New `LayoutConstraints.italic`/`.modified` fields, mirroring `glyph` | Same shape as glyph; currently missing (Decision 2). |

`Dock.setPanelTitle(id, title)` therefore never touches `LayoutConstraints` — it calls `frame.setName(title)` (durable by construction, since the identity frame instance is parked and re-homed rather than rebuilt across a tear-off, re-dock, or `setLayoutState`) plus a best-effort live update.

### `Tab.setTabGlyph`/`setTabItalic`/`setTabModified` are unified behind one durable-write helper that accepts a not-yet-celled tab

`Tab.applyTabGlyph` ([Tab.ts:1313-1338](packages/lib/src/typescript/lib/layout/Tab.ts#L1313)) already writes the glyph into the tab's `LayoutConstraints` — durable — but it does so only *after* confirming a strip cell exists (`this._contents.find(e => e.component === content)`), and returns `false` without writing anything when no cell exists yet. `Tab.setTabItalic`/`setTabModified` ([Tab.ts:1359](packages/lib/src/typescript/lib/layout/Tab.ts#L1359), [:1440](packages/lib/src/typescript/lib/layout/Tab.ts#L1440)) have the same cell-existence gate and never write to `LayoutConstraints` at all.

The fix separates two questions the current code conflates: "is `content` a child of this strip's container" (true the instant `addComponent`/`moveComponent` runs, before any layout pass) from "does its strip cell exist yet" (true only after `createTab` runs, on the next `doLayout`). The first question already has a precedent in this file — `stillMine` in the drag-detach handler: `this.getContainer()?.getComponents().includes(content) ?? false` ([Tab.ts:1572](packages/lib/src/typescript/lib/layout/Tab.ts#L1572)). A new private `Tab.applyDurableTabState` checks that first (returning `false` only for a genuinely foreign component), always writes the field into `LayoutConstraints` (creating one via `getLayoutConstraints`/`setLayoutConstraints` if needed — these are keyed by component id independent of cell existence, per `LayoutManager.getLayoutConstraints` ([LayoutManager.ts:625](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L625))), then *additionally* pushes the value onto the live `TabBar` cell only when one currently exists. `createTab`/`TabBar.createBarEntry` already read `constraints.glyph` when a cell is (re)built ([Tab.ts:1701-1705](packages/lib/src/typescript/lib/layout/Tab.ts#L1701), [TabBar.ts:1731-1746](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1731)) — extending that same read to `.italic`/`.modified` is what makes a write made before the cell exists take effect once it is. No `_pending*`-field-plus-`doLayout`-replay mechanism (the shape `Tab._pendingActiveContent` uses for a different problem, [Tab.ts:328-330](packages/lib/src/typescript/lib/layout/Tab.ts#L328)) is needed here, because these fields are exactly the kind of static per-tab data `createTab` already re-derives from constraints on every (re)build.

`setTabGlyph`/`clearTabGlyph`'s return value changes as a result: today they return `false` for a tab added but not yet laid out (an existing, reproducible bug); after this fix they return `true` for it, matching `setTabItalic`/`setTabModified`'s new behavior. `isTabItalic`/`isTabModified` gain a fallback to `getLayoutConstraints(content)?.italic`/`.modified` when no cell exists yet, so a value set before the cell exists reads back correctly instead of reporting `false`.

### `LayoutConstraints` gains `italic`/`modified`; `LayoutSerialization` captures and restores them exactly like `glyph`

`PanelNode` currently captures `glyph`, `tooltip`, `closeable`, `disposeOnClose` from a leaf's `LayoutConstraints` in `nodeFor` ([LayoutSerialization.ts:233-244](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L233)) and reconstructs them on restore in `constraintsFor` ([LayoutSerialization.ts:430-452](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L430)) — deliberately *excluding* `name`, because title identity rides on the component itself (see the decision above). `italic`/`modified` follow the same four fields' pattern exactly, added as two more optional fields alongside them. This is what makes `setTabItalic`/`setTabModified` survive a `getLayoutState()`/`setLayoutState()` round trip, closing the gap their current doc comments describe.

### `Dock`'s four new setters resolve their owning `Tab` from the frame's own parent, not by searching for its cell

`Dock.regionForFrame` (used by `focusPanel`/`removePanel`, [Dock.ts:1808-1816](packages/lib/src/typescript/lib/overlay/Dock.ts#L1808)) finds a frame's hosting region by searching for its *cell* (`indexOfContent(frame) >= 0`) — the same gate `Tab`'s own methods used to have, and just as unable to find a frame added moments ago. A new private `Dock.ownerTab(frame)` instead reads `frame.getParentComponent()?.getLayoutManager()`, the same `instanceof Tab` idiom `Dock.rootTab()` already uses ([Dock.ts:1017-1021](packages/lib/src/typescript/lib/overlay/Dock.ts#L1017)). Because `addPanel`/`addLazyPanel` call `region.moveComponent(content, …)` synchronously before returning ([Dock.ts:456](packages/lib/src/typescript/lib/overlay/Dock.ts#L456), [:505](packages/lib/src/typescript/lib/overlay/Dock.ts#L505)), a registered frame always already has a parent by the time any external caller can reach it by id — so `ownerTab` resolves correctly whether or not that parent's `Tab` has run a layout pass yet. `focusPanel`/`removePanel` are unchanged; they keep using `regionForFrame`, since accepting a not-yet-celled panel is only required for the four new setters (see `## Non-Goals`).

### `Dock`'s `beforeclose` and `AbstractWindow`'s new `beforeclose` mirror `Tab`'s existing `beforetabclose`/`TabCloseController` split, and reuse `TabCloseController` rather than a new type

`Tab` already splits a vetoable user-close from an unguarded programmatic one: `_onBarTabClose` ([Tab.ts:1130-1149](packages/lib/src/typescript/lib/layout/Tab.ts#L1130)) emits `"beforetabclose"` with a `TabCloseController` and checks `preventDefault()` before calling the shared `closeEntry`; the public `closeTab` ([Tab.ts:1235](packages/lib/src/typescript/lib/layout/Tab.ts#L1235)) calls `closeEntry` directly, unguarded. `Dock.removePanel` already routes through `closeTab` ([Dock.ts:1796](packages/lib/src/typescript/lib/overlay/Dock.ts#L1796)), so it is already on the unguarded side of that split — no change needed there.

The tiled-tab-✕ half of the requirement is a straight relay: `Dock` subscribes to each wired region's (and each `TabWindow`'s own) `"beforetabclose"` and re-emits `"beforeclose"`, forwarding the *same* `TabCloseController` `Tab` handed it.

The float-chrome-✕ half needs new library support: `AbstractWindow.requestClose()` today just calls `onExitAction()` unconditionally ([AbstractWindow.ts:882-884](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L882)) — there is no vetoable pre-close hook at the window level at all. `onExitAction()` is already the unguarded programmatic path (`LayoutSerialization.restoreLayout` calls it directly on every parked window, [LayoutSerialization.ts:625](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L625)), so this plan makes `requestClose()` the guarded one — the same `_onBarTabClose`/`closeTab` split, one level up. One existing call site is currently wired to the wrong half: `Window`'s header ✕ button calls `onExitAction()` directly ([Window.ts:84](packages/lib/src/typescript/lib/overlay/Window.ts#L84)), bypassing `requestClose()` entirely, while `TabWindow`'s close tool already calls `requestClose()` correctly ([TabWindow.ts:101](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L101)). Fixing `Window.ts:84` to call `requestClose()` is required for the float-chrome-✕ veto to actually reach a plain `Window` mini-dock's close button.[^requestclose-fix]

`Dock`'s own `"beforeclose"` reuses `TabCloseController` for its controller parameter rather than a new `DockCloseController` — the shape (`{ preventDefault(): void }`) is identical, and the new `WindowCloseController` this plan adds to `AbstractWindow` has the same shape too, so `Dock` can pass a float's `WindowCloseController` straight through to a `"beforeclose"` listener with no wrapping or casting.

### `Dock.setTabOptions`/`DockOptions.tabOptions` apply to every region, present and future; `reorderable`, `barVisible`, and `listeners` are never forwarded

`Dock.newTabRegion()` ([Dock.ts:769-771](packages/lib/src/typescript/lib/overlay/Dock.ts#L769)) is the one place every region's `Tab` gets constructed; storing the caller's options and merging them in there covers every future region for free. Covering *existing* regions needs a separate dispatch loop over `Dock.allTabRegions()` (already exists, [Dock.ts:1837-1860](packages/lib/src/typescript/lib/overlay/Dock.ts#L1837)) calling each field's own `Tab.setXxx` setter.

Three fields are excluded from what a caller's `TabOptions` can touch, because `Dock` owns them as invariants:

- **`reorderable`** — `wireRegion` force-sets `setReorderable(true)` on every region exactly once, at first wire ([Dock.ts:1289](packages/lib/src/typescript/lib/overlay/Dock.ts#L1289)); it is never re-asserted afterward, so a caller's `reorderable: false` passed through unfiltered would stick and silently break drag-and-drop.
- **`barVisible`** — `Dock` toggles this itself for the empty-state placeholder ([Dock.ts:961-1007](packages/lib/src/typescript/lib/overlay/Dock.ts#L961), `showEmptyState`/`hideEmptyState`), but only on the *root* region; forwarding a caller's `barVisible` would fight that reconciliation on the root and permanently hide the strip on every other region.
- **`listeners`** — a construction-time-only bag of per-instance event wiring; there is no sensible "apply the same listener bag to every region" operation, and `Dock` already owns each region's `Tab` event wiring itself.

All three are stripped once, at the `setTabOptions` boundary, so both the dispatch loop and the future-region merge are automatically safe.

---

## Public API

### `packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`

```typescript
export class LayoutConstraints {
    // … every existing field unchanged …

    /** Whether the tab's label is italicised. Read by the `Tab` manager into the button's font style; ignored by other layout managers. */
    italic?: boolean;

    /** Whether the tab shows the unsaved-changes badge. Read by the `Tab` manager into the button's modified dot; ignored by other layout managers. */
    modified?: boolean;
}
```

### `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`

```typescript
export interface PanelNode {
    // … every existing field unchanged …

    /** Captured from the leaf's {@link LayoutConstraints.italic}. */
    italic?: boolean;

    /** Captured from the leaf's {@link LayoutConstraints.modified}. */
    modified?: boolean;
}
```

### `packages/lib/src/typescript/lib/layout/Tab.ts`

No new exported symbols. `setTabGlyph`, `clearTabGlyph`, `setTabItalic`, `setTabModified`, `isTabItalic`, `isTabModified` keep their existing signatures; only their behavior changes (see Architecture Decisions and `## Expected Behaviour`).

### `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`

```typescript
export type WindowEvent = "minimize" | "restore" | "close" | "beforeclose" | "activate";

/** Controller handed to a `"beforeclose"` listener. Calling `preventDefault()` aborts the close. */
export interface WindowCloseController {
    preventDefault(): void;
}

abstract class AbstractWindow {
    /**
     * Advisory close request from the manager. Fires the vetoable `"beforeclose"`
     * first; a listener calling `preventDefault()` aborts the close. The
     * programmatic `onExitAction()` is not guarded by it.
     */
    requestClose(): void;

    on(event: "beforeclose", listener: (controller: WindowCloseController) => void): this;
    on(event: Exclude<WindowEvent, "beforeclose">, listener: () => void): this;

    off(event: "beforeclose", listener: (controller: WindowCloseController) => void): this;
    off(event: Exclude<WindowEvent, "beforeclose">, listener: () => void): this;
}
```

### `packages/lib/src/typescript/lib/overlay/Dock.ts`

```typescript
export interface DockOptions extends ContainerOptions {
    // … every existing field unchanged …

    /** Tab-strip presentation applied to every region this dock builds, now and later. Equivalent to calling `setTabOptions` right after construction. `reorderable`, `barVisible`, and `listeners` are ignored — see `Dock.setTabOptions`. */
    tabOptions?: TabOptions;

    listeners?: {
        // … every existing entry unchanged …
        beforeclose?: (event: DockPanelEvent, controller: TabCloseController) => void;
        dblclick?:    (event: DockPanelEvent) => void;
    };
}

export type DockEvent =
    "attach" | "detach" | "move" | "focus" | "close" | "beforeclose" | "dblclick" | "emptychange" | "exception";

class Dock extends Container<DockOptions> {
    /** Relabels panel `id`'s tab and tear-off window title. Durable — written onto the panel's own identity frame. Returns `true` when the panel is registered, `false` for an unknown id. */
    setPanelTitle(id: string, title: string): boolean;

    /** Replaces panel `id`'s tab glyph. Durable — survives a tear-off, a re-dock, and a `setLayoutState` restore. Accepts a panel whose tab cell has not been created yet. Returns `true` when the panel is registered, `false` for an unknown id. */
    setPanelGlyph(id: string, glyph: string): boolean;

    /** Italicises (or un-italicises) panel `id`'s tab label. Durable; accepts a not-yet-celled panel. Returns `true` when the panel is registered, `false` for an unknown id. */
    setPanelItalic(id: string, italic: boolean): boolean;

    /** Shows or hides the unsaved-changes dot on panel `id`'s tab. Durable; accepts a not-yet-celled panel. Returns `true` when the panel is registered, `false` for an unknown id. */
    setPanelModified(id: string, modified: boolean): boolean;

    /**
     * Applies `options` to every region this dock owns now, and stores it to
     * apply to every region it builds later. `reorderable`, `barVisible`, and
     * `listeners` are ignored (Dock-owned invariants — see Architecture Decisions).
     */
    setTabOptions(options: TabOptions): this;

    on(event: "attach" | "detach" | "move" | "close", listener: (event: DockPanelEvent) => void): this;
    on(event: "beforeclose", listener: (event: DockPanelEvent, controller: TabCloseController) => void): this;
    on(event: "dblclick", listener: (event: DockPanelEvent) => void): this;
    on(event: "focus", listener: (event: DockPanelEvent | null) => void): this;
    on(event: "emptychange", listener: (event: DockEmptyEvent) => void): this;
    on(event: "exception", listener: (event: DockExceptionEvent) => void): this;
    // off(...) mirrors on(...) exactly, as today.
}
```

`beforeclose` fires for a tab's ✕ (tiled or floated in a `TabWindow`) and a float window's chrome ✕; `removePanel(id)` stays the unguarded programmatic path, matching `Tab.closeTab`. `dblclick` fires when a tab button is double-clicked (mirrors `Tab`'s existing `"tabdblclick"`); it does not fire for a lazy tab whose content hasn't built yet, same limit as `Tab`'s event.

---

## Internal Structure

### `Tab.ts` — the unified durable-write helper

Replaces the current private `applyTabGlyph` ([Tab.ts:1313-1338](packages/lib/src/typescript/lib/layout/Tab.ts#L1313)):

```typescript
/**
 * Applies a presentation field to the tab hosting `content`: always durably,
 * into its `LayoutConstraints` (creating one if needed); additionally onto the
 * live `TabBar` cell when one currently exists. `content` need not have a
 * cell yet — `createTab`/`TabBar.createBarEntry` read the same constraints
 * fields when the cell is eventually built, so a write made before that still
 * takes effect once it is.
 *
 * @param content - The content component whose tab to update. Must already be
 *   a child of this strip's container (celled or not).
 * @param mutate - Writes the field onto `constraints`.
 * @param applyLive - Pushes the same value onto the live cell with id `entryId`.
 *
 * @returns `true` when `content` is a child of this strip; `false` when it is
 *   not a child at all.
 */
private applyDurableTabState(
    content: Component,
    mutate: (constraints: LayoutConstraints) => void,
    applyLive: (entryId: string) => void,
): boolean {
    if (!(this.getContainer()?.getComponents().includes(content) ?? false)) {
        return false;
    }

    let constraints = this.getLayoutConstraints(content);

    if (!constraints) {
        constraints = new LayoutConstraints();
        this.setLayoutConstraints(content, constraints);
    }

    mutate(constraints);

    const entry = this._contents.find(e => e.component === content);

    if (entry) {
        applyLive(entry.id);
        this.getContainer()?.scheduleLayout();
    }

    return true;
}
```

`setTabGlyph`/`clearTabGlyph`/`setTabItalic`/`setTabModified` each become a one-line call:

```typescript
setTabGlyph(content: Component, glyph: string): boolean {
    return this.applyDurableTabState(
        content,
        constraints => { constraints.glyph = glyph; },
        entryId => this._bar.setEntryGlyph(entryId, glyph),
    );
}

clearTabGlyph(content: Component): boolean {
    return this.applyDurableTabState(
        content,
        constraints => { constraints.glyph = null; },
        entryId => this._bar.clearEntryGlyph(entryId),
    );
}

setTabItalic(content: Component, italic: boolean): boolean {
    return this.applyDurableTabState(
        content,
        constraints => { constraints.italic = italic; },
        entryId => this._bar.setEntryItalic(entryId, italic),
    );
}

setTabModified(content: Component, modified: boolean): boolean {
    return this.applyDurableTabState(
        content,
        constraints => { constraints.modified = modified; },
        entryId => this._bar.setEntryModified(entryId, modified),
    );
}
```

`isTabItalic`/`isTabModified` gain the pending-cell fallback:

```typescript
isTabItalic(content: Component): boolean {
    const entry = this._contents.find(e => e.component === content);

    if (entry) {
        return this._bar.isEntryItalic(entry.id);
    }

    return this.getLayoutConstraints(content)?.italic ?? false;
}
```

(`isTabModified` is the same shape, reading `.modified` and `isEntryModified`.)

### `TabBar.ts` — seed italic/modified when a cell is built

`createBarEntry` ([TabBar.ts:1731](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1731)) already reads `constraints?.glyph`/`.closeable` at construction. Add, right after the existing `if (constraints?.tooltip) { … }` block:

```typescript
if (constraints?.italic) {
    tabButton.setFontStyle("italic");
}

if (constraints?.modified) {
    tabButton.setModified(true);
}
```

### `LayoutSerialization.ts` — capture and restore italic/modified

In `nodeFor`'s leaf branch ([LayoutSerialization.ts:237-244](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L237)), add `italic: constraints?.italic, modified: constraints?.modified` alongside `closeable`/`disposeOnClose`. In `constraintsFor` ([LayoutSerialization.ts:430-452](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L430)), widen the `carries` check with `|| node.italic !== undefined || node.modified !== undefined` and add `constraints.italic = node.italic; constraints.modified = node.modified;` alongside the existing four assignments.

### `AbstractWindow.ts` — the guarded `requestClose`

```typescript
requestClose(): void {
    let prevented = false;
    const controller: WindowCloseController = {
        preventDefault: (): void => { prevented = true; },
    };

    this.emit("beforeclose", controller);

    if (prevented) {
        return;
    }

    this.onExitAction();
}
```

`on`/`off`/`emit` become overloaded and variadic, the same shape `Tab.emit` already uses ([Tab.ts:2766-2778](packages/lib/src/typescript/lib/layout/Tab.ts#L2766)):

```typescript
on(event: "beforeclose", listener: (controller: WindowCloseController) => void): this;
on(event: Exclude<WindowEvent, "beforeclose">, listener: () => void): this;
on(event: WindowEvent, listener: Function): this {
    this._windowListeners.add(event, listener);

    return this;
}

// off(...) mirrors on(...) via this._windowListeners.remove(event, listener).

protected emit(event: "beforeclose", controller: WindowCloseController): void;
protected emit(event: Exclude<WindowEvent, "beforeclose">): void;
protected emit(event: WindowEvent, ...payload: unknown[]): void {
    this._windowListeners.fire(event, ...payload);
}
```

### `Dock.ts` — owner resolution, the four setters, `setTabOptions`

```typescript
/**
 * The `Tab` currently governing `frame`'s tab, resolved from `frame`'s own
 * parent container rather than searched for by cell — so it resolves even
 * before a layout pass has built the cell. `null` when `frame` has no parent
 * (mid-teardown) or its parent isn't `Tab`-managed (should not happen for a
 * registered Dock frame).
 */
private ownerTab(frame: Component): Tab | null {
    const manager = frame.getParentComponent()?.getLayoutManager();

    return manager instanceof Tab ? manager : null;
}

setPanelTitle(id: string, title: string): boolean {
    const frame = this._frames.get(id);

    if (!frame) {
        return false;
    }

    frame.setName(title);
    this.ownerTab(frame)?.setTabName(frame, title);

    return true;
}

setPanelGlyph(id: string, glyph: string): boolean {
    const frame = this._frames.get(id);

    return frame ? this.ownerTab(frame)?.setTabGlyph(frame, glyph) ?? false : false;
}

setPanelItalic(id: string, italic: boolean): boolean {
    const frame = this._frames.get(id);

    return frame ? this.ownerTab(frame)?.setTabItalic(frame, italic) ?? false : false;
}

setPanelModified(id: string, modified: boolean): boolean {
    const frame = this._frames.get(id);

    return frame ? this.ownerTab(frame)?.setTabModified(frame, modified) ?? false : false;
}
```

`setTabOptions` and its two application paths:

```typescript
// Presentation-only TabOptions applied to every region this dock builds, now
// and later. Never contains "reorderable" / "barVisible" / "listeners" — see
// Architecture Decisions. A plain initializer is safe: no cascade-dispatched
// setter touches it (see the constructor note below).
private _tabOptions: TabOptions = {};

setTabOptions(options: TabOptions): this {
    const { reorderable: _reorderable, barVisible: _barVisible, listeners: _listeners, ...forwarded } = options;

    this._tabOptions = forwarded;

    for (const region of this.allTabRegions()) {
        this.applyTabOptions(region.getLayoutManager() as Tab, forwarded);
    }

    return this;
}

private applyTabOptions(tab: Tab, options: TabOptions): void {
    if (options.widthMode !== undefined) tab.setWidthMode(options.widthMode);
    if (options.maxWidth !== undefined) tab.setMaxWidth(options.maxWidth);
    if (options.fixedWidth !== undefined) tab.setFixedWidth(options.fixedWidth);
    if (options.underBorderFullWidth !== undefined) tab.setUnderBorderFullWidth(options.underBorderFullWidth);
    if (options.side !== undefined) tab.setSide(options.side);
    if (options.align !== undefined) tab.setAlign(options.align);
    if (options.orientation !== undefined) tab.setOrientation(options.orientation);
    if (options.textAlign !== undefined) tab.setTextAlign(options.textAlign);
    if (options.scrollable !== undefined) tab.setScrollable(options.scrollable);
    if (options.compact !== undefined) tab.setCompact(options.compact);
    if (options.barIgnoreParentInsets !== undefined) tab.setBarIgnoreParentInsets(options.barIgnoreParentInsets);
    if (options.detachWindowMode !== undefined) tab.setDetachWindowMode(options.detachWindowMode);
}
```

`newTabRegion` merges `_tabOptions` under Dock's own defaults and over an unconditional `reorderable: true` floor:

```typescript
private newTabRegion(): Component {
    return new Container({
        layoutManager: new Tab({ compact: true, ...this._tabOptions, reorderable: true }),
    });
}
```

The constructor applies `options.tabOptions` in its body (after `super()`, alongside the existing `options?.layout` handling it already special-cases outside `applyOptions` — see [Dock.ts:300-314](packages/lib/src/typescript/lib/overlay/Dock.ts#L300)), *before* the first region is built, so even the dock's very first region picks it up:

```typescript
constructor(options?: DockOptions, subclassDefaults?: Partial<DockOptions>) {
    super(options, { layoutManager: new Fit(), ...subclassDefaults });

    if (options?.tabOptions) {
        this.setTabOptions(options.tabOptions);
    }

    const root = options?.layout ? this.compileLayout(options.layout) : this.newTabRegion();
    // … unchanged …
}
```

This mirrors the existing pattern exactly — `options?.layout` is handled the same way, outside `applyOptions`, precisely because `applyOptions` runs inside `super()` before the subclass's own field initializers (`_tabOptions = {}`) run; routing `tabOptions` through `applyOptions` instead would have that write silently reverted by the field initializer immediately afterward (the `super()`-cascade field trap CODE_CONVENTIONS.md documents).

### `Dock.ts` — the `beforeclose`/`dblclick` wiring

Two new handlers, alongside the existing `onPanelClosed`/`onPanelFocused`/`onPanelDetached`/`onPanelDocked`:

```typescript
private onPanelBeforeClose = (content: Component, controller: TabCloseController): void => {
    const id = content.getId();

    if (this._frames.get(id) !== content) {
        return;
    }

    this.emit("beforeclose", { id, content, window: this.hostForFrame(content, this.getRootRegion()) }, controller);
};

private onFloatBeforeClose = (window: AbstractWindow, controller: WindowCloseController): void => {
    for (const frame of this.framesInWindow(window)) {
        this.emit("beforeclose", { id: frame.getId(), content: frame, window }, controller);
    }
};

private onPanelDoubleClicked = (content: Component, _index: number): void => {
    const id = content.getId();

    if (this._frames.get(id) !== content) {
        return;
    }

    this.emit("dblclick", { id, content, window: this.hostForFrame(content, this.getRootRegion()) });
};
```

`onFloatBeforeClose` passes the *same* `WindowCloseController` to every frame in the window — `WindowCloseController` and `TabCloseController` are structurally identical, so no wrapping is needed, and calling `preventDefault()` from more than one frame's listener is harmless (it just sets the same flag twice).

Wired in `wireRegion` ([Dock.ts:1286-1305](packages/lib/src/typescript/lib/overlay/Dock.ts#L1286)), alongside the four existing `tab.on(...)` calls in that block:

```typescript
tab.on("beforetabclose", this.onPanelBeforeClose);
tab.on("tabdblclick",    this.onPanelDoubleClicked);
```

Wired in `subscribeFloatWindows` ([Dock.ts:1054-1079](packages/lib/src/typescript/lib/overlay/Dock.ts#L1054)) in two places: alongside the shared per-window `win.on("activate", …)`/`win.on("close", …)` pair, add `win.on("beforeclose", this.onFloatBeforeClose)`; alongside the `TabWindow`-only `tab.on(...)` block, add `tab.on("beforetabclose", this.onPanelBeforeClose)` and `tab.on("tabdblclick", this.onPanelDoubleClicked)`.

`emit`'s implementation signature becomes variadic, the same fix `AbstractWindow.emit` needs:

```typescript
protected emit(event: DockEvent, ...payload: unknown[]): void {
    this._listeners.fire(event, ...payload);
}
```

---

## Ordered Implementation Steps

1. **`LayoutConstraints.ts`** — add `italic?: boolean` and `modified?: boolean` fields, each with a doc comment mirroring `closeable`'s. No behavior change yet (nothing reads them).

2. **`LayoutSerialization.test.ts`** ([packages/lib/tests/component/layout/LayoutSerialization.test.ts](packages/lib/tests/component/layout/LayoutSerialization.test.ts)) — extend test `S1` ("a captured leaf round-trips its presentation and disposal constraints", line 107) to also set and assert `italic`/`modified`, and add a case mirroring `S2` confirming a state written without the new fields still restores. Run `npm test -- LayoutSerialization` — red (fields not yet captured).

3. **`LayoutSerialization.ts`** — extend `PanelNode`, `nodeFor`, `constraintsFor` per `## Internal Structure`. Run `npm test -- LayoutSerialization` — green.

4. **`TabBar.ts`** — add the two `if (constraints?.italic)`/`if (constraints?.modified)` lines to `createBarEntry` per `## Internal Structure`.

5. **`Tab.tabItalic.test.ts`** and **`Tab.tabModified.test.ts`** — rewrite the two tests that pin the *current* view-only behavior: `Tab.tabItalic.test.ts`'s test 17 ("setTabItalic leaves the tab's LayoutConstraints untouched", [line 109](packages/lib/tests/layout/Tab.tabItalic.test.ts#L109)) and `Tab.tabModified.test.ts`'s equivalent test 23, to assert the constraint *is* written (mirror `Tab.tabGlyph.test.ts`'s tests 11/12, [lines 157-184](packages/lib/tests/layout/Tab.tabGlyph.test.ts#L157)). Add to each file a new case: "setTabItalic/setTabModified on a tab added but not yet laid out still records durably and applies once the cell is created" — construct via `host.addComponent(content)` *without* calling `host.doLayout()` first, call the setter, assert it returns `true`, then call `host.doLayout()` and assert the live cell (`barEntries(tab)[0]`) shows the flag. Add a matching case to `Tab.tabGlyph.test.ts` for `setTabGlyph`/`clearTabGlyph`, and one for `isTabItalic`/`isTabModified` reading back correctly before the cell exists. Run `npm test -- Tab.tab` — red (the fix isn't in yet, and the two rewritten tests fail against current behavior).

6. **`Tab.ts`** — add `applyDurableTabState`, rewrite `setTabGlyph`/`clearTabGlyph`/`setTabItalic`/`setTabModified` through it, delete the old `applyTabGlyph`, and add the pending-cell fallback to `isTabItalic`/`isTabModified`, all per `## Internal Structure`. Run `npm test -- Tab.tab` — green. Run the full `Tab.*.test.ts` suite — nothing else regresses (in particular `Tab.renameAndVeto.test.ts`, which exercises `setTabName` — untouched by this step).

7. **`AbstractWindow.beforeClose.test.ts`** (new, under `packages/lib/tests/overlay/`) — write cases from `## Expected Behaviour` for `requestClose()`'s new veto, modelled on `Tab.renameAndVeto.test.ts`'s veto tests ([lines 109-154](packages/lib/tests/layout/Tab.renameAndVeto.test.ts#L109)). Run `npm test -- AbstractWindow.beforeClose` — red (module doesn't emit `beforeclose` yet).

8. **`AbstractWindow.ts`** — add `WindowCloseController`, widen `WindowEvent`, rewrite `requestClose()`, `on`/`off`/`emit` per `## Internal Structure`. Run `npm test -- AbstractWindow.beforeClose` — green. Run `npm test -- AbstractWindow.closeable` — still green (the existing "leaves the programmatic requestClose() path open on a non-closeable Window" test at [line 114](packages/lib/tests/overlay/AbstractWindow.closeable.test.ts#L114) attaches no `beforeclose` listener, so `requestClose()` proceeds exactly as before).

9. **`Window.ts`** — change the header exit-button listener at [line 84](packages/lib/src/typescript/lib/overlay/Window.ts#L84) from `() => this.onExitAction()` to `() => this.requestClose()`. Add a case to `AbstractWindow.beforeClose.test.ts` confirming a veto registered on a `Window` also stops its header ✕ (not just a direct `requestClose()` call). Run `npm test -- AbstractWindow` — green.

10. **`Dock.panelPresentation.test.ts`** (new, under `packages/lib/tests/overlay/`) — write cases from `## Expected Behaviour` for `setPanelTitle`/`setPanelGlyph`/`setPanelItalic`/`setPanelModified` (including the pending-cell case) and `setTabOptions`/`DockOptions.tabOptions` (including the three-excluded-fields case), modelled on `Dock.lifecycle.test.ts`'s harness (`mountDock`, `frameOf`, `rootTab`, `priv`). Run `npm test -- Dock.panelPresentation` — red.

11. **`Dock.beforeClose.test.ts`** (new, under `packages/lib/tests/overlay/`) — write cases for `"beforeclose"` (tiled tab ✕, float chrome ✕, `removePanel` unguarded) and `"dblclick"`, modelled on the same `Dock.lifecycle.test.ts` harness plus `driveBarClose`-style simulation from `Tab.renameAndVeto.test.ts`. Run `npm test -- Dock.beforeClose` — red.

12. **`Dock.ts`** — the full set of changes from `## Internal Structure`: `DockEvent`/`DockOptions` widened, `_tabOptions` field, constructor's `tabOptions` handling, `newTabRegion`'s merge, `setTabOptions`/`applyTabOptions`, `ownerTab`, the four `setPanel*` methods, `onPanelBeforeClose`/`onFloatBeforeClose`/`onPanelDoubleClicked` and their wiring in `wireRegion`/`subscribeFloatWindows`, the widened `on`/`off`/`emit` overloads and the now-variadic `emit` implementation. Run `npm test -- Dock` — every Dock test green, including `Dock.lifecycle.test.ts` (unaffected — its own events are untouched).

13. **`npm run typecheck`** — clean across the whole package.

14. **Documentation** — per `## Documentation Impact`.

15. **Run the whole `## Verification` list.**

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutConstraints.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Window.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/tests/layout/Tab.tabGlyph.test.ts` |
| Modify | `packages/lib/tests/layout/Tab.tabItalic.test.ts` |
| Modify | `packages/lib/tests/layout/Tab.tabModified.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.beforeClose.test.ts` |
| Create | `packages/lib/tests/overlay/Dock.panelPresentation.test.ts` |
| Create | `packages/lib/tests/overlay/Dock.beforeClose.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### `Tab` — durable writes (unit-testable, extending `Tab.tabGlyph.test.ts` / `Tab.tabItalic.test.ts` / `Tab.tabModified.test.ts`)

| Case | Expected |
| --- | --- |
| `setTabGlyph`/`setTabItalic`/`setTabModified` on a component added via `host.addComponent(content)` with `host.doLayout()` already called | Same as today: `true`, live cell updates immediately (regression-only, existing cases) |
| Same, but called *before* `host.doLayout()` (no cell yet) | Returns `true` (was `false` for glyph; unchanged-but-now-durable for italic/modified); `tab.getLayoutConstraints(content)` carries the value immediately |
| `host.doLayout()` called afterward | The live cell (`barEntries(tab)[0]`) now shows the glyph/italic/modified state, seeded from the constraint `createTab` reads |
| `setTabItalic`/`setTabModified` on any celled component | `tab.getLayoutConstraints(content)!.italic`/`.modified` reads back the written value (was `undefined` before this plan — the two tests asserting that must be rewritten, not just extended) |
| `isTabItalic`/`isTabModified` on a component with a value set but no cell yet | Returns the constraint value, not `false` |
| `setTabGlyph`/`setTabItalic`/`setTabModified` on a component never added to the strip at all | Returns `false`; no constraint is created (unchanged) |

### `LayoutSerialization` — italic/modified round-trip (unit-testable, extending `LayoutSerialization.test.ts`)

| Case | Expected |
| --- | --- |
| A leaf with `LayoutConstraints.italic = true, modified = true` | `nodeFor` captures `italic: true, modified: true` on its `PanelNode` |
| `restoreLayout` on a state carrying `italic`/`modified` | The re-homed leaf's `LayoutConstraints.italic`/`.modified` match |
| A state written before this plan (no `italic`/`modified` keys) | Restores with both `undefined` — no throw, no default `true` |

### `AbstractWindow` — `beforeclose` (unit-testable, new `AbstractWindow.beforeClose.test.ts`)

| Case | Expected |
| --- | --- |
| `win.on('beforeclose', c => c.preventDefault())`, then `win.requestClose()` | Window stays open; `"close"` never fires |
| No `beforeclose` listener, `win.requestClose()` | Window closes; `"close"` fires once (regression) |
| A veto, then `win.onExitAction()` called directly | Window closes anyway — the unguarded path ignores the veto |
| A `Window` built with a `beforeclose` veto registered, then its header exit button (reached via the `exitButton(win)` accessor `AbstractWindow.closeable.test.ts` already defines) actioned | Window stays open — proves the fix at `Window.ts:84` actually routes through the guarded path, not just a direct `requestClose()` call. Trigger the button through whatever mechanism the existing `Button`/`TabButton` tests use to fire `"action"` in this harness (e.g. `packages/lib/tests/component/button/`) — this plan does not prescribe it. |
| A non-closeable `Window` (`closeable: false`) with no `beforeclose` listener, `win.requestClose()` called directly | Still closes — `closeable` and `beforeclose` are independent (regression, per the existing `AbstractWindow.closeable.test.ts` case) |

### `Dock` — panel presentation (unit-testable, new `Dock.panelPresentation.test.ts`)

| Case | Expected |
| --- | --- |
| `dock.addPanel({...}); dock.setPanelTitle(id, 'New')` before `dock.doLayout()` | Returns `true`; `frameOf(dock, id).getName()` is `'New'` immediately |
| `dock.doLayout()` afterward | The live tab label reads `'New'` |
| `dock.setPanelGlyph(id, 'star')`/`setPanelItalic(id, true)`/`setPanelModified(id, true)` before `doLayout()` | Each returns `true`; after `doLayout()`, the live cell shows the glyph/italic/modified state |
| `dock.getLayoutState()` after a glyph/italic/modified write, `setLayoutState` onto a fresh dock with the same panel re-registered | The restored panel's tab shows the same glyph/italic/modified state |
| Any of the four setters called with an id never registered via `addPanel`/`addLazyPanel` | Returns `false` |
| `dock.setTabOptions({ widthMode: 'content', scrollable: true })` after a panel is already docked | The existing region's `Tab` reflects `widthMode`/`scrollable` immediately |
| A second panel added to a *new* region after `setTabOptions` | That region's `Tab` is built with the same options from construction |
| `new Dock({ tabOptions: { maxWidth: 200 } })` | The dock's first region's `Tab` has `maxWidth` 200 from construction |
| `dock.setTabOptions({ reorderable: false })` | Every region's `Tab` stays reorderable (the field is dropped, never forwarded) |

### `Dock` — `beforeclose`/`dblclick` (unit-testable, new `Dock.beforeClose.test.ts`)

| Case | Expected |
| --- | --- |
| A tiled panel's tab ✕ clicked (simulated via the region's bar, `driveBarClose`-style), with a `beforeclose` veto registered | The panel stays open; `"close"` never fires for it |
| Same, no veto | `"close"` fires once, panel removed |
| `dock.removePanel(id)` with a `beforeclose` listener registered that always vetoes | The panel closes anyway — `removePanel` never fires `"beforeclose"` |
| A panel torn off into a float, then that float's chrome ✕ closed, with a `beforeclose` veto on one of two panels in the float | The whole float stays open (the veto blocks the shared window close), neither panel's `"close"` fires |
| Same float-close case, no veto | Both panels' `"close"` fire, then the window's own `"close"` |
| A tiled panel's tab double-clicked (simulated via the bar) | `"dblclick"` fires once with that panel's `DockPanelEvent` |
| A lazy panel's tab double-clicked before its content has materialized | `"dblclick"` does not fire (mirrors `Tab`'s own `"tabdblclick"` limit) |

### Manual verification

None — every behavior above is exercised through the existing offline recording-sink/JS-only test harness (`installTestDOM`), the same way `Dock.lifecycle.test.ts` and `Tab.renameAndVeto.test.ts` already test drag, close, and event-payload behavior without a real browser.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — full suite green, including every file in `## Files to Create / Modify / Delete` and the untouched suites that exercise the same call paths (`Tab.renameAndVeto.test.ts`, `Dock.lifecycle.test.ts`, `Dock.closeDisposal.test.ts`, `AbstractWindow.closeable.test.ts`).
- `npm run docs:api` — zero TypeDoc warnings (checks every new/changed public JSDoc `{@link}`).
- `grep -rn "applyTabGlyph" packages/lib/src/` — zero matches (replaced by `applyDurableTabState`).
- `grep -rn "onExitAction()" packages/lib/src/typescript/lib/overlay/Window.ts` — the header-exit-button call site is gone; only `AbstractWindow.ts`'s own `requestClose`/`onExitAction` definitions and `LayoutSerialization.ts`'s programmatic teardown call remain across the package.

---

## Documentation Impact

### `packages/lib/docs/layouts/Tab.md`

In "## Renaming, re-iconing, italicising and marking a tab modified" ([lines 77-116](packages/lib/docs/layouts/Tab.md#L77)):
- Update the `setTabGlyph`/`clearTabGlyph` paragraph ([line 95](packages/lib/docs/layouts/Tab.md#L95)) to note both now also accept — and durably record — a tab added but not yet laid out.
- Replace the `setTabItalic` "view-only" sentence ([line 105](packages/lib/docs/layouts/Tab.md#L105)) with one stating it now writes to `LayoutConstraints` the same way `setTabGlyph` does, and survives a tear-off, re-dock, or restored layout.
- Replace the `setTabModified` "view-only" sentence ([line 115](packages/lib/docs/layouts/Tab.md#L115)) the same way.

### `packages/lib/docs/components/Dock.md`

- "## Panel lifecycle" ([lines 81-131](packages/lib/docs/components/Dock.md#L81)): add a `beforeclose` row to the events table, before `close`, firing when a tab's ✕ or a float's chrome ✕ is clicked, vetoable via `TabCloseController.preventDefault()`; note in the bullet list that `removePanel` does not fire it (mirroring `close`'s existing "never paired with a `detach`" bullet style). Add a `dblclick` row.
- "## Programmatic control" ([lines 145-159](packages/lib/docs/components/Dock.md#L145)): update "Two methods drive the lifecycle from code" (now six) and document `setPanelTitle`/`setPanelGlyph`/`setPanelItalic`/`setPanelModified`/`setTabOptions` alongside `focusPanel`/`removePanel`, each noting it accepts a panel whose tab cell doesn't exist yet.

### `packages/lib/docs/reference/changelog/next.md`

- Edit the existing `Tab.setTabModified` bullet ([lines 36-39](packages/lib/docs/reference/changelog/next.md#L36)) in place — it is unreleased, so this is a correction, not a changelog entry of its own: remove "the flag is view-only … does not survive" and state it is now durable.
- Under `## Added` › `### Overlay` (new subsection, following the precedent set by `0.4.1.md`'s "### Overlay" section): `Dock.setPanelTitle`/`setPanelGlyph`/`setPanelItalic`/`setPanelModified`, `Dock.setTabOptions`/`DockOptions.tabOptions`, `Dock`'s `"beforeclose"`/`"dblclick"` events, `AbstractWindow`'s `"beforeclose"` event and `WindowCloseController`.
- Under `## Changed` › `### Layouts`: `Tab.setTabItalic` is no longer view-only (this is a behavior change to an already-released 0.9.0 method).
- Under `## Fixed` › `### Layouts`: `Tab.setTabGlyph`/`clearTabGlyph` no longer silently drop a write made before the tab's strip cell exists.
- Under `## Fixed` › `### Overlay`: a `Window`'s header ✕ now goes through the same close path as `TabWindow`'s close tool, so it can be vetoed.

---

## Potential Challenges

- **`onFloatBeforeClose` fires once per frame in a multi-panel float.** A consumer's listener runs once per open file in a torn-off mini-dock, not once per window — intentional (mirrors `Dock`'s existing `onFloatClosed` fan-out, [Dock.ts:1646-1671](packages/lib/src/typescript/lib/overlay/Dock.ts#L1646)), but worth a doc callout so a listener assuming "one call per close gesture" isn't surprised.
- **`Escape`-dismissing a window now goes through the same veto.** `LayerManager`'s generic topmost-layer dismissal calls `target.requestClose()` polymorphically ([LayerManager.ts:693](packages/lib/src/typescript/lib/core/LayerManager.ts#L693)); for an `AbstractWindow` target this now honors `beforeclose` too. This is a free, correct consequence (not a regression — no existing listener exists to be surprised by it) and needs no code change, only awareness when writing the changelog entry.
- **`setTabOptions`'s excluded fields are silently dropped, not rejected.** A caller passing `reorderable`/`barVisible`/`listeners` gets no error — matching how `moveComponent`'s constraints-mismatch is "the caller's responsibility" elsewhere in this codebase, but still worth a one-line doc-comment callout on `setTabOptions` itself so it isn't mistaken for a bug.

---

## Critical Files

| File | Why |
| --- | --- |
| [`packages/lib/src/typescript/lib/overlay/Dock.ts`](packages/lib/src/typescript/lib/overlay/Dock.ts) | The class gaining five new methods, two new events, and one new option — read `addPanel`, `focusPanel`/`removePanel`/`regionForFrame`, `wireRegion`, `subscribeFloatWindows`, `newTabRegion`, `rootTab`, and the `on`/`off`/`emit` overloads in full. |
| [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) | `applyTabGlyph` (being replaced), `setTabItalic`/`setTabModified` (being made durable), `_onBarTabClose`/`closeTab` (the veto-split precedent), `createTab`/`stillMine` (the two mechanisms the fix reuses), `emit`'s variadic overload shape. |
| [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) | `createBarEntry` — where glyph is already seeded from constraints, and where italic/modified need the same seeding added. |
| [`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts) | The class gaining `italic`/`modified` — read the existing `glyph`/`closeable` fields' doc-comment style to match. |
| [`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) | `nodeFor`/`constraintsFor`/`PanelNode` — the exact round-trip shape `italic`/`modified` must follow, and the `name`-is-excluded precedent behind Decision 1. |
| [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) | `requestClose`/`onExitAction` (the split being introduced) and the current fixed-arity `on`/`off`/`emit` (being widened). |
| [`packages/lib/src/typescript/lib/overlay/Window.ts`](packages/lib/src/typescript/lib/overlay/Window.ts) | Line 84 — the header exit-button wiring that must change from `onExitAction()` to `requestClose()`. |
| [`packages/lib/src/typescript/lib/overlay/TabWindow.ts`](packages/lib/src/typescript/lib/overlay/TabWindow.ts) | Line 101 — confirms the close tool already calls `requestClose()` correctly (no change needed there). |
| [`packages/lib/tests/layout/Tab.tabGlyph.test.ts`](packages/lib/tests/layout/Tab.tabGlyph.test.ts), [`Tab.tabItalic.test.ts`](packages/lib/tests/layout/Tab.tabItalic.test.ts), [`Tab.tabModified.test.ts`](packages/lib/tests/layout/Tab.tabModified.test.ts), [`Tab.renameAndVeto.test.ts`](packages/lib/tests/layout/Tab.renameAndVeto.test.ts) | The exact test harness (`hostTab`, `barEntries`, `driveBarClose`) and the two tests (17, 23) that must be rewritten, not just extended. |
| [`packages/lib/tests/overlay/Dock.lifecycle.test.ts`](packages/lib/tests/overlay/Dock.lifecycle.test.ts) | The `Dock` test harness (`mountDock`, `captureRaf`/`flush`, `frameOf`, `rootTab`, `priv`) the new Dock test files should reuse. |
| [`packages/lib/tests/overlay/AbstractWindow.closeable.test.ts`](packages/lib/tests/overlay/AbstractWindow.closeable.test.ts) | The existing test (line 114) proving `requestClose()`'s contract with `closeable: false` must stay green — the closest existing coverage of the method being changed. |
| [`packages/lib/tests/component/layout/LayoutSerialization.test.ts`](packages/lib/tests/component/layout/LayoutSerialization.test.ts) | Test `S1` (line 107) — the exact round-trip case to extend for `italic`/`modified`. |
| [`packages/lib/docs/components/Dock.md`](packages/lib/docs/components/Dock.md), [`packages/lib/docs/layouts/Tab.md`](packages/lib/docs/layouts/Tab.md) | The prose this plan's changes require updating — see `## Documentation Impact`. |

---

## Non-Goals

- **`focusPanel`/`removePanel` accepting a not-yet-celled panel.** Only the four new/durable `setPanel*` writes need that; `focusPanel`/`removePanel` keep using `regionForFrame` unchanged. Nothing in the originating requirement asks for it, and activating or closing a panel with no cell yet has no well-defined UI action to perform.
- **A programmatic `Dock.splitPanel(id, edge)`.** Out of scope for this plan; unrelated to panel-tab presentation or the close lifecycle.
- **A `Dock`-level `"layoutchange"` event for gutter drags.** Unrelated to this plan's scope.
- **Extending `DockPanelSpec` with initial `italic`/`modified` values.** The four setters are runtime controls; `addPanel`'s declarative spec already has `glyph`/`tooltip`/`closeable` for construction-time presentation, and nothing in the originating requirement asks for more there.
- **Changing `Tab.setTabName`'s durability.** Title durability is solved entirely at the `Dock` layer via `Component.setName` (Decision 1); `Tab.setTabName`'s own behavior (relabels the live cell only) is unchanged.
- **A `TabOptions.listeners`-style construction bag for `AbstractWindow`'s new `"beforeclose"`.** `AbstractWindow`/`WindowOptions` has no declarative `listeners` bag for any of its existing events (`minimize`/`restore`/`close`/`activate`) today; adding one would be a wider, unrelated change to introduce for `beforeclose` alone.

---

## Notes

[^title-precedent]: `Component.setName`'s own doc comment ([Component.ts:1953-1968](packages/lib/src/typescript/lib/core/Component.ts#L1953)) states this explicitly, and `Dock.md`'s "id vs. title" table ([Dock.md:54-63](packages/lib/docs/components/Dock.md#L54)) already documents the same thing for `DockPanelSpec.title`: "title is free to change and survives a restore because it rides on the component, not on a per-container constraint." `setPanelTitle` is new plumbing onto an already-documented, already-correct channel — it does not change how title durability works, only exposes it by panel id.

[^glyph-precedent]: `LayoutSerialization.ts`'s `constraintsFor` doc comment ([LayoutSerialization.ts:419-425](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L419)) states the reverse for identity: "Identity rides on the component's own id …, not a constraint, so no `name` is stamped — that keeps the leaf's visible label (its component name) intact across a restore." Glyph has no such component-level home, which is why it needs `LayoutConstraints` at all.

[^requestclose-fix]: Without this fix, a `beforeclose` listener registered on a plain `Window` mini-dock would never see the window's own chrome ✕ close (only a direct `win.requestClose()` call, or `TabWindow`'s close tool). Verified by reading `Window.ts`'s constructor wiring directly (`this._header.addExitButtonListener(() => this.onExitAction());`) rather than assuming `requestClose()` was already the universal chrome-✕ path — it is not: `requestClose()` is the shared `DismissableLayer` interface method also implemented independently by `Menu`, `Popover`, `Drawer`, `Dialog`, and `AnimatedDropdown` ([LayerManager.ts:49](packages/lib/src/typescript/lib/core/LayerManager.ts#L49)), none of which this plan touches.
