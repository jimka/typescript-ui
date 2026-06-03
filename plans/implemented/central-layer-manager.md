# Central LayerManager — Implementation Plan

## Overview

Four portaled-overlay subsystems each independently answer the same three questions — *is this stacked above its opener?* (z-index), *who is active?* (focus), and *did this interaction land inside my subtree, including portaled descendant layers?* (dismissal):

1. `AnimatedDropdown` carries a module-private layer stack (`_openLayers` / `_entryByLayer`) plus the recursive `isTargetInsideLayer` and `getTopLayer` at [AnimatedDropdown.ts:32-39](../src/typescript/lib/core/AnimatedDropdown.ts#L32), [:220-234](../src/typescript/lib/core/AnimatedDropdown.ts#L220) (push), [:284-303](../src/typescript/lib/core/AnimatedDropdown.ts#L284) (pop), and [:430-462](../src/typescript/lib/core/AnimatedDropdown.ts#L430). Hosts wire their own viewport-`pointerdown` dismiss — `AbstractPickerField` uses `isTargetInsideLayer` ([AbstractPickerField.ts:374-386](../src/typescript/lib/component/input/AbstractPickerField.ts#L374)), but `ComboBox` uses a naive `dropEl.contains(target)` ([ComboBox.ts:712-722](../src/typescript/lib/component/input/ComboBox.ts#L712)) and `AutoCompleteDropdown` uses `this.getElement().contains` ([AutoCompleteDropdown.ts:120-124](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L120)) — the latent dropdown-in-dropdown bug.
2. `Popover` owns its own `dismissOn: "click-outside" | "blur" | "manual"` modes ([Popover.ts:65](../src/typescript/lib/core/Popover.ts#L65), [:198-231](../src/typescript/lib/core/Popover.ts#L198), [:854-873](../src/typescript/lib/core/Popover.ts#L854)); `"blur"` breaks for a nested dropdown because the popover isn't on the dropdown stack.
3. `Dialog` portals a backdrop + panel, traps focus, and wires a viewport keydown ([Dialog.ts:635-656](../src/typescript/lib/core/Dialog.ts#L635), [:736-765](../src/typescript/lib/core/Dialog.ts#L736)), with a per-instance z counter from `DIALOG_BASE_Z = 10101` ([:396-399](../src/typescript/lib/core/Dialog.ts#L396)).
4. `Window` keeps a static `zIndexCounter` (9000-base) + `bringToFront()` + subtree `mousedown→bringToFront` + a bespoke `Window.deactivateIfOutside` viewport handler ([Window.ts:138-154](../src/typescript/lib/core/Window.ts#L138), [:247-248](../src/typescript/lib/core/Window.ts#L247), [:385-503](../src/typescript/lib/core/Window.ts#L385)). A dropdown opened inside a window portals to `documentElement`, so `deactivateIfOutside` reads it as "outside" and wrongly deactivates the window.

This plan introduces a core `LayerManager` (new file `src/typescript/lib/core/LayerManager.ts`) owning **one runtime layer tree** — push-on-show / link-under-current-topmost / pop-on-hide — and **one containment query** that works for both a pointer `target` and a focus `relatedTarget`. Each surface implements a small `DismissableLayer` interface and registers on show / unregisters on hide. The three responsibilities (stacking, activation, dismissal) ship as **separate phases** so the four subsystems keep working at every step. The end state collapses the cell-editor `retainsFocus(relatedTarget)` hook ([CellEditor.ts:67-69](../src/typescript/lib/component/table/cell/editor/CellEditor.ts#L67), [DateTime.ts:63-68](../src/typescript/lib/component/table/cell/editor/DateTime.ts#L63)) and its blur-commit guards ([CellEditorPool.ts:120-126](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L120), [Cell.ts:72](../src/typescript/lib/component/table/cell/Cell.ts#L72)) into a single "did focus leave my layer subtree?" question answered by the manager.

The relationship that matters — the runtime causal **"opened-from"** edge (which layer was topmost when this one opened) — is distinct from the static component hierarchy and changes per activation, so it lives in `LayerManager`, not in the component tree.

---

## Architecture Decisions

### Participation via an interface + registration calls, not a base class

The five surfaces have **four different superclasses** (`AnimatedDropdown extends Component`, `Popover extends Panel`, `Dialog extends Component`, `Window extends Panel`), so a shared base class is impossible without a disruptive re-parenting. A mixin would fight the `callable()` export wrapper and the `declare`-field super-cascade conventions this codebase leans on. The least-invasive fit is a structural **`DismissableLayer` interface** plus free functions `LayerManager.register(layer)` / `LayerManager.unregister(layer)` that each surface calls from its existing show/hide path. This mirrors the existing `Bindable` interface + `Binding` registration pattern already in `core`.

### A single namespace object, mirroring `Event` and `Animation`

`LayerManager` is a `export namespace LayerManager { … }` with module-private tree state and a single lazily-installed document-level listener set — structurally identical to `Event`'s `viewportListenerMap` + `baseViewportListener` ([Event.ts:134-154](../src/typescript/lib/core/Event.ts#L134)) and `Window`'s static-counter pattern. No instances; the tree is module state keyed by `WeakMap<DismissableLayer, LayerNode>`, generalizing today's `_entryByLayer`.

### One document-level listener set, installed on first register, removed on last unregister

Today each host installs its *own* `Event.addViewportListener(this, "pointerdown", …)`. `baseViewportListener` already funnels every registration of a type through one window-capture handler and calls `stopPropagation()` ([Event.ts:140](../src/typescript/lib/core/Event.ts#L140)), so N hosts still mean N callbacks fed the same event. The manager replaces all of them with exactly **one** `pointerdown`, **one** `focusin`, and **one** `keydown` listener (registered via `Event.addViewportListener` against a single private sentinel `Component`, exactly as `Window` does with `_viewportListenerOwner` at [Window.ts:29](../src/typescript/lib/core/Window.ts#L29)). The handler walks the stack top-down and dismisses only the layers whose own condition is met.

### `focusin` (document-level), not per-element `blur`/`focusout`

Native `blur.relatedTarget` / `focusout.relatedTarget` is unreliable across **sibling-rooted portals**: when focus jumps from a popover's input to a dropdown that is a *DOM sibling* (both children of `documentElement`), some browsers report `relatedTarget: null`. The manager instead listens to a single bubbling `focusin` on `document` and reads `event.target` (the element *receiving* focus, always populated) — then asks the tree whether that target is inside each open layer's subtree. This is the focus analogue of the pointer query and sidesteps the `relatedTarget`-null class of bugs that the per-surface `_onFocusOut` ([Popover.ts:213-231](../src/typescript/lib/core/Popover.ts#L213)) and `retainsFocus` paths currently wrestle with.

### Z-index allocated from a single ascending counter with reserved bands

Window's 9000-base, Popover's 9998, dropdowns' ~10050, and Dialog's 10101 are reconciled into one monotonic allocator with **bands** so relative order is preserved while nesting raises a child above its parent. The manager assigns `z = band_base + (++counter)` at register time and re-stamps on `bringToFront`. Because a nested layer registers *after* its opener, the ascending counter already places it above — no per-host math. Bands keep a Dialog above a Window above a Popover when they are unrelated peers (see Theme Tokens / constants below).

### `requestClose` is advisory; the surface owns teardown

The manager never detaches DOM or runs animations. It calls `layer.requestClose()` and the surface runs its existing `hideAnimated()` / `hide()` / `onExitAction()`, which in turn calls `LayerManager.unregister(this)`. This keeps each surface's bespoke fade/teardown (and the `_dismissing` re-entrancy guard at [AnimatedDropdown.ts:313-329](../src/typescript/lib/core/AnimatedDropdown.ts#L313)) untouched.

---

## Public API (TypeScript Signatures)

New file `src/typescript/lib/core/LayerManager.ts`:

```typescript
/** How a layer responds to an outside interaction. @category Core */
export type LayerDismissMode = "click-outside" | "blur" | "manual" | "modal";

/**
 * A portaled overlay surface that participates in the runtime layer tree.
 * Implemented by AnimatedDropdown, Popover, Dialog, and Window.
 * @category Core
 */
export interface DismissableLayer {
    /** The layer's root element (already mounted on documentElement). */
    getLayerElement(): HTMLElement | null;
    /** Dismiss policy consulted by the document-level interaction handlers. */
    getDismissMode(): LayerDismissMode;
    /** Advisory request to close; the surface runs its own teardown + unregister. */
    requestClose(): void;
    /**
     * Optional anchor element excluded from "outside" tests so the trigger
     * click that opened the layer does not immediately re-close it.
     */
    getAnchorElement?(): HTMLElement | null;
}

export namespace LayerManager {
    /** Push `layer` as a child of the current topmost layer, assign its z-index, install listeners on first call. */
    export function register(layer: DismissableLayer): void;

    /** Pop `layer` (and detach from its parent's child list); remove listeners on last call. */
    export function unregister(layer: DismissableLayer): void;

    /** True when `node` is inside `layer`'s own element OR any descendant layer's element. */
    export function containsAcrossLayers(layer: DismissableLayer, node: Node | null): boolean;

    /** The topmost currently-registered layer, or null. */
    export function getTopLayer(): DismissableLayer | null;

    /** Re-stamp `layer` (and its descendants) with fresh top-of-band z-indices and mark it active. */
    export function bringToFront(layer: DismissableLayer): void;

    /** Z-index currently assigned to `layer`, for surfaces that mirror it. */
    export function getZIndex(layer: DismissableLayer): number;
}
```

Internal node shape (module-private, generalizes today's `LayerEntry`):

```typescript
interface LayerNode {
    layer:    DismissableLayer;
    parent:   LayerNode | null;
    children: LayerNode[];
    zIndex:   number;
}
```

No new DOM property/setter is added to `Component`; the interface methods are implemented on the four existing surfaces using their current element/anchor accessors.

---

## Theme Tokens

No CSS custom properties. The z-index bands are plain module constants in `LayerManager.ts` (z-index is not themed anywhere today — `Theme.ts` carries no z-index tokens; the values are inline per class):

| Constant | Value | Replaces |
|---|---|---|
| `Z_BAND_WINDOW` | 9000 | `Window.zIndexCounter` base ([Window.ts:138](../src/typescript/lib/core/Window.ts#L138)) |
| `Z_BAND_POPOVER` | 9800 | `Popover.setZIndex(9998)` ([Popover.ts:187](../src/typescript/lib/core/Popover.ts#L187)) |
| `Z_BAND_DROPDOWN` | 10000 | `AnimatedDropdown` default `zIndex: 10050` ([AnimatedDropdown.ts:79](../src/typescript/lib/core/AnimatedDropdown.ts#L79)); also the explicit `zIndex: 10050` subclass overrides in `ComboBoxDropdown` ([ComboBox.ts:109](../src/typescript/lib/component/input/ComboBox.ts#L109)) and `_defaultAutoCompleteDropdownOptions` ([AutoCompleteDropdown.ts:26](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L26)), which must be dropped so the manager owns the stamp |
| `Z_BAND_DIALOG` | 11000 | `DIALOG_BASE_Z = 10101` ([Dialog.ts:394](../src/typescript/lib/core/Dialog.ts#L394)) |

> Drift note (verified against worktree baseline): cited line numbers drift by a few lines from the current source but every symbol, signature, and behaviour matches. `Popover`, `Window`, and `AutoCompleteDropdown` wire their existing dismiss listeners on `"mousedown"` (not `"pointerdown"`); only the three migrated dropdown hosts (`AbstractPickerField`, `ComboBox`, `DateTimeEditor`) use `"pointerdown"`, which is what the Phase-3 grep invariant targets. `Event.addViewportListener` takes no options argument and registers non-passive capture for non-PASSIVE types, so the manager's `pointerdown` / `keydown` handlers can `preventDefault`.

Within a band the per-register `++counter` keeps insertion order; a nested child inherits its parent's band but always lands above it because it registers later.

---

## Internal Structure

Document-level handler skeleton (one each, walking top-down):

```
onPointerDown(e):
  target = e.target
  for node in stack, top → bottom:
    if node.layer.getDismissMode() === "manual": continue
    if containsAcrossLayers(node.layer, target): break   // inside this or a descendant → stop, keep all
    if anchor?.contains(target): break                    // re-trigger click → keep
    node.layer.requestClose()                             // outside → close this top layer, re-loop

onFocusIn(e):     // same walk, only "blur"/"modal" modes act on it
onKeyDown(e):     // Escape → topmost non-manual layer.requestClose(); "modal" also traps Tab
```

`containsAcrossLayers` is `isTargetInsideLayer` ([AnimatedDropdown.ts:430-450](../src/typescript/lib/core/AnimatedDropdown.ts#L430)) lifted verbatim onto the new tree: plain `el.contains(node)` for the layer's own element, then recurse into `node.children`. This is the *only* place cross-portal hops are reasoned about; intra-layer containment stays plain `contains`.

---

## Ordered Implementation Steps

### Phase 0 — Scaffolding (no behavior change)
1. Create `src/typescript/lib/core/LayerManager.ts` with the namespace, `LayerNode` tree, `register`/`unregister`/`containsAcrossLayers`/`getTopLayer`/`getZIndex`/`bringToFront`, the z-band constants, and the three document listeners (installed on first `register`, removed on last `unregister`). Listeners initially **only manage z-index and the tree** — `requestClose` is wired but no surface implements a non-`manual` mode yet, so dismissal is still owned by each host. → verify: `npm run build` clean; nothing calls the manager yet.
2. Export `LayerManager`, `DismissableLayer`, `LayerDismissMode` from [`core/index.ts`](../src/typescript/lib/core/index.ts) with `@category Core`. → verify: `npm run docs:build` lands them under `docs/api/core/`.

### Phase 1 — Stacking order
3. `AnimatedDropdown`: implement `DismissableLayer` (`getLayerElement` → `getElement()`, `getDismissMode` → `"manual"` for now, `requestClose` → `hideAnimated()`). Replace the `_openLayers` push/pop ([:220-234](../src/typescript/lib/core/AnimatedDropdown.ts#L220), [:284-303](../src/typescript/lib/core/AnimatedDropdown.ts#L284)) with `LayerManager.register(this)` / `unregister(this)`; have `showAnimated` read `LayerManager.getZIndex(this)` into `setZIndex` instead of the static 10050. Keep `isTargetInsideLayer`/`getTopLayer` as thin static delegates to the manager (hosts and `DateTimeEditor` still call them) → verify: dropdown-in-dropdown and dropdown-in-picker still stack correctly; existing demo screens unchanged.
4. `Popover`: implement the interface, register/unregister in `show()`/`hide()` ([:489-538](../src/typescript/lib/core/Popover.ts#L489)), read z from the manager (Popover band) instead of `setZIndex(9998)`. `getAnchorElement` → `_anchorElement`. Dismiss mode still `"manual"` (its own listeners stay live this phase). → verify: popover still appears above windows, below dialogs.
5. `Window`: implement the interface; route `bringToFront` ([:493-503](../src/typescript/lib/core/Window.ts#L493)) through `LayerManager.bringToFront(this)` for the z-stamp, keeping the `_header.setActive` toggle local for now. Register/unregister in `show()`/`onExitAction()`. → verify: window raise-on-click and multi-window stacking unchanged; a dropdown opened *inside* a window now registers as the window's child and stacks above it.
6. `Dialog`: implement the interface, register/unregister in `open()`/`hide()` ([:635-656](../src/typescript/lib/core/Dialog.ts#L635), [:784-829](../src/typescript/lib/core/Dialog.ts#L784)), read z from the Dialog band instead of `DIALOG_BASE_Z`. → verify: stacked dialogs still ascend; backdrop still below panel.

### Phase 2 — Activation / focus
7. Switch the manager's `focusin` handler on. `Window` adopts `getDismissMode() === "blur"`-style activation: on `focusin`/`pointerdown` the manager marks the topmost containing layer active and tells the previously-active one to deactivate, via a new `onActivate(active: boolean)` optional interface method that `Window` maps to `_header.setActive`. Delete `Window.deactivateIfOutside` and the `_viewportListenerOwner` listener ([:142-154](../src/typescript/lib/core/Window.ts#L142), [:385-391](../src/typescript/lib/core/Window.ts#L385)); the subtree `mousedown→bringToFront` ([:248](../src/typescript/lib/core/Window.ts#L248)) stays (it is intra-window). → verify: clicking a dropdown opened inside a window no longer deactivates the window; clicking empty viewport still deactivates.

### Phase 3 — Dismissal (one surface at a time)
8. `AnimatedDropdown` hosts: flip `getDismissMode()` to `"click-outside"`. Delete each host's `_onViewportPointerDown` + its `Event.addViewportListener(this,"pointerdown",…)` wiring in `AbstractPickerField` ([:374-386](../src/typescript/lib/component/input/AbstractPickerField.ts#L374), [:507](../src/typescript/lib/component/input/AbstractPickerField.ts#L507), [:515](../src/typescript/lib/component/input/AbstractPickerField.ts#L515)), `ComboBox` ([:712-722](../src/typescript/lib/component/input/ComboBox.ts#L712), [:671](../src/typescript/lib/component/input/ComboBox.ts#L671), [:699](../src/typescript/lib/component/input/ComboBox.ts#L699)), and `AutoCompleteDropdown` ([:120-124](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L120), [:165](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L165), [:174](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L174)). The dropdown's `requestClose` calls the host-supplied close callback (pass a close thunk to the dropdown, or have the host register itself as the layer and forward). The ComboBox naive-`contains` bug is fixed for free. → verify: ComboBox-in-picker, picker-in-window, ComboBox-in-Dialog all stay open when the inner surface is clicked.
9. `Popover`: flip to `"click-outside"` / `"blur"` (map its existing `dismissOn`). Delete `_onViewportMouseDown`, `_onFocusOut`, `attachDismissListeners`, `detachDismissListeners` ([:198-231](../src/typescript/lib/core/Popover.ts#L198), [:854-873](../src/typescript/lib/core/Popover.ts#L854)); `getAnchorElement` already excludes the trigger. The `"blur"` mode now works for nested dropdowns because the dropdown is the popover's child in the tree. → verify: blur-dismiss popover with a ComboBox inside stays open while the ComboBox dropdown is used.
10. `Dialog`: flip to `"modal"`. The manager's keydown handler owns Escape; Dialog keeps its Tab focus-trap (modal mode signals the manager to *not* dismiss ancestors and to keep the backdrop). Remove the Escape branch from `onKeyDown` ([:737-740](../src/typescript/lib/core/Dialog.ts#L737)) but keep Tab trapping. `closeOnBackdrop` stays a Dialog concern (backdrop click → `requestClose`). → verify: Escape closes top dialog only; Tab still trapped; backdrop click still gated by `closeOnBackdrop`.
11. Cell-editor collapse: replace `DateTimeEditor.retainsFocus` ([DateTime.ts:63-68](../src/typescript/lib/component/table/cell/editor/DateTime.ts#L63)) body with `LayerManager.containsAcrossLayers(this._dropdown, relatedTarget)`, and delete its `_onViewportPointerDown` ([DateTime.ts:42](../src/typescript/lib/component/table/cell/editor/DateTime.ts#L42), [:227-240](../src/typescript/lib/component/table/cell/editor/DateTime.ts#L227)) now that the dropdown's own `"click-outside"` mode drives the commit. Keep the `retainsFocus` hook on `CellEditor` and its two call sites ([CellEditorPool.ts:121](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L121), [Cell.ts:73](../src/typescript/lib/component/table/cell/Cell.ts#L73)) — they still guard the *editor's own* blur — but they now delegate the cross-portal answer to the manager. → verify: DateTime cell editor commits on true outside click, stays open when the embedded time picker is used.
12. Remove the now-unused static delegates `AnimatedDropdown.isTargetInsideLayer` / `getTopLayer` if no caller remains (grep `isTargetInsideLayer` — expect zero outside `LayerManager` and any kept test). → verify: `grep -rn "isTargetInsideLayer" src/` returns only `LayerManager.ts`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/LayerManager.ts` |
| Modify | `src/typescript/lib/core/index.ts` (export) |
| Modify | `src/typescript/lib/core/AnimatedDropdown.ts` (register/z, drop `_openLayers`) |
| Modify | `src/typescript/lib/core/Popover.ts` (interface, drop own dismiss listeners) |
| Modify | `src/typescript/lib/core/Dialog.ts` (interface, modal mode, drop Escape) |
| Modify | `src/typescript/lib/core/Window.ts` (interface, drop `deactivateIfOutside`) |
| Modify | `src/typescript/lib/component/input/AbstractPickerField.ts` (drop viewport pointerdown) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (drop viewport pointerdown; fixes naive `contains`) |
| Modify | `src/typescript/lib/component/input/AutoCompleteDropdown.ts` (drop viewport mousedown) |
| Modify | `src/typescript/lib/component/table/cell/editor/DateTime.ts` (collapse `retainsFocus`, drop viewport pointerdown) |
| Modify | `src/typescript/lib/component/table/cell/editor/CellEditor.ts` (doc: `retainsFocus` delegates to manager) |

`SpinButton.ts` is **not** touched — it hosts no `AnimatedDropdown`; its viewport listeners are for mouse-up/leave during spin ([SpinButton.ts:110-111](../src/typescript/lib/component/input/SpinButton.ts#L110)).

---

## Verification

- **Typecheck / build:** `npm run build` clean after each phase.
- **Grep invariants:** after Phase 3, `grep -rn "_openLayers\|deactivateIfOutside\|isTargetInsideLayer" src/` returns nothing outside `LayerManager.ts`; `grep -rn "addViewportListener(this, \"pointerdown\"" src/` returns nothing in the migrated hosts.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc TS-version notice excepted).
- **Manual smoke (per surface, each must match today, then gain nesting):**
  - ComboBox standalone: open/close, outside-click dismiss, keyboard nav.
  - DateField/TimeField/DateTimeField picker: open, click inside calendar keeps open.
  - **Nesting:** ComboBox inside a picker dropdown; ComboBox inside a Popover (`dismissOn:"blur"`); a dropdown opened inside a Window (window stays active + dropdown above it); a dropdown inside a Dialog (Dialog stays open).
  - Window: raise-on-click, multi-window z-order, minimize/maximize, snap-resize, deactivate on empty-viewport click.
  - Dialog: stacked dialogs, Escape closes only the top, Tab trap, `closeOnBackdrop`.
  - DateTime cell editor in a table: commit on outside click, stay open while embedded time picker is used.
- **Demo screens:** the input gallery (ComboBox / picker fields), the Window demo, the Dialog demo, and the MiscPanel table (DateTime cell editor).

---

## Documentation Impact

- `LayerManager`, `DismissableLayer`, `LayerDismissMode` are new public Core symbols — export from [`core/index.ts`](../src/typescript/lib/core/index.ts), `@category Core`, confirm they land in `docs/api/core/index.md` after build.
- Add a curated concept page (e.g. `docs/concepts/layering.md` or extend an existing overlay concept page) describing the runtime layer tree and the three responsibilities; link it in `docs/.vitepress/config.mts` and the concepts `index.md`.
- Cross-bucket JSDoc: `AnimatedDropdown`/`Popover`/`Dialog`/`Window` (all in `core`) reference `LayerManager` with `{@link LayerManager}` (same bucket). The cell-editor docs in `component/table` reference it as `` [`LayerManager`](/api/core/namespaces/LayerManager) ``.
- `PopoverDismissMode` is retained as the public option type; note in its JSDoc that dismissal is now executed by `LayerManager`.

---

## Potential Challenges

- **`relatedTarget` null across sibling-rooted portals** — mitigated by listening to document-level `focusin` and reading the always-populated `event.target`, never `relatedTarget` (Architecture Decisions §focusin).
- **`_dismissing` re-entrancy guard** — left entirely inside `AnimatedDropdown.hideAnimated` ([:313-329](../src/typescript/lib/core/AnimatedDropdown.ts#L313)); the manager only calls `requestClose`, so a re-show mid-fade still cancels the deferred detach exactly as today. `register` guards against a duplicate push (the existing `!_entryByLayer.has(this)` check, ported to a `WeakMap` membership test).
- **Z-index reconciliation (9000 vs 10050 vs 10101)** — replaced by ascending bands; unrelated peers keep their relative order, nested children always rise above their opener because they register later within the parent's band.
- **Modal focus-trapping** — `"modal"` mode tells the manager to neither dismiss ancestors on outside interaction nor let focus escape; Dialog keeps its own Tab-cycling trap, the manager only owns Escape and stack ordering.
- **Listener install/teardown lifecycle** — modeled on `Window`'s `openWindows.size === 0` guard ([:385-391](../src/typescript/lib/core/Window.ts#L385)): install the three document listeners on the first `register`, remove on the last `unregister`, against one private sentinel `Component`.
- **`baseViewportListener` `stopPropagation`** — `Event`'s window-capture handler stops propagation ([Event.ts:140](../src/typescript/lib/core/Event.ts#L140)); registering the manager's listeners through `Event.addViewportListener` (not raw `document.addEventListener`) keeps them inside the same capture-phase funnel so ordering with surfaces' own remaining listeners (e.g. Window drag) is unchanged.
- **Order of `focusin` vs `pointerdown`** — a pointer-driven focus shift fires `pointerdown` then `focusin`; both walk the same tree and both treat "inside a descendant layer" as keep-open, so a double-fire cannot dismiss an ancestor of an active descendant.
- **Surfaces outside scope** — `Menu` ([Menu.ts:180](../src/typescript/lib/core/Menu.ts#L180)) and `Tooltip`/`Notification` also portal and wire viewport listeners but are **not** in the named migration; they keep their current behavior and can fold in later (noted in Non-Goals).

---

## Critical Files

- [`src/typescript/lib/core/AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts) — source of the tree logic being generalized (`_openLayers`, `isTargetInsideLayer`, push/pop, `_dismissing`).
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `addViewportListener`/`baseViewportListener` mechanics the single-listener-set rides on.
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — the `_viewportListenerOwner` sentinel + install/teardown lifecycle to copy.
- [`src/typescript/lib/core/Popover.ts`](../src/typescript/lib/core/Popover.ts), [`Dialog.ts`](../src/typescript/lib/core/Dialog.ts) — the other dismiss/focus models being unified.
- [`src/typescript/lib/component/input/AbstractPickerField.ts`](../src/typescript/lib/component/input/AbstractPickerField.ts) — the correct host pattern to generalize from.
- [`src/typescript/lib/component/table/cell/editor/DateTime.ts`](../src/typescript/lib/component/table/cell/editor/DateTime.ts), [`CellEditor.ts`](../src/typescript/lib/component/table/cell/editor/CellEditor.ts) — the `retainsFocus` end-state collapse.
- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — export surface (no root barrel; `core` subpath only).

---

## Non-Goals

- **`Menu`, `Tooltip`, `Notification`** are not migrated — they portal but fall outside the named five-surface scope; folding them in is a follow-on once the five are stable.
- **No animation/teardown changes** — the manager is advisory; every surface keeps its own fade, `_dismissing` guard, backdrop, and `destructor` flow.
- **No `Component`-level DOM property** — participation is interface + registration only; no new setter/getter/option triple is threaded through `Component`.
- **No z-index theming** — bands are module constants; z-index is not a themable token today and this plan does not make it one.
