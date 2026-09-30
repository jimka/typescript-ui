---
touches-shared:
  - packages/lib/src/typescript/lib/core/LayerManager.ts
  - packages/lib/src/typescript/lib/overlay/Dialog.ts
  - packages/lib/tests/overlay/LayerManager.test.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Modal Layer Band Integrity — Implementation Plan

## Overview

A modal `Dialog` can render — and stay clickable — *beneath* a non-modal overlay. Modality rests only on the dialog's backdrop being the topmost hit target. There is no `inert` and no page-wide pointer block, so a surface painted above the backdrop receives clicks, and focus that moves into it escapes the dialog's Tab trap. This plan makes the stacking guarantee explicit: **a modal layer's backdrop always has a strictly higher z-index than every non-modal surface.**

Two declarations cause the defect:

1. [`LayerManager.bandFor`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L236) always gives a nested layer its opener's band. `Dialog` declares neither `isLayerRoot()` nor `getAnchorElement()`, so [`resolveParent`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L654) links it under the last-registered layer. Its own [`getBand()`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1464) (`Band.Dialog`, 11000) is therefore ignored whenever any layer is already open. The backdrop follows it down, because [`Dialog.open`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L933) stamps the backdrop at `panelZ - 1`.
2. [`Drawer`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L729) is a layer root with no `getBand()`, so [`register`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L326)'s `?? Z_BAND_DROPDOWN` puts every drawer in the Dropdown band (10000), above windows and popovers.

The fix adds one optional hook to `DismissableLayer`, a new `Band.Drawer`, and a `getBand()` on `Drawer`. It touches `LayerManager.ts`, `Dialog.ts`, `Drawer.ts`, the four in-page drag overlays that sit "just below the lowest band", their tests, and the layering docs.

---

## Architecture Decisions

### Verified defect — the table below was re-measured on `master`

Stamps read offline under the modelled node DOM with the real `Dialog`, `Drawer` and `Window` classes (one open order per test, so each starts from an empty stack).[^measured]

| Open order | Drawer | Window | Dialog panel | Dialog backdrop | Backdrop above every non-modal? |
|---|---|---|---|---|---|
| Drawer, Window, Dialog | 10001 | 9001 | 9002 | 9001 | **no** — below the drawer, tied with the window |
| Drawer, Dialog | 10002 | — | 10003 | 10002 | **no** — exact tie with the drawer |
| Dialog, Drawer | 10004 | — | 11001 | 11000 | yes |
| Window, Drawer, Dialog | 10005 | 9003 | 10006 | 10005 | **no** — exact tie with the drawer |
| Dialog alone | — | — | 11002 | 11001 | n/a |
| Window, Dialog | — | 9004 | 9005 | 9004 | **no** — exact tie with its own opener window |

The last row is not in the original report. It is the commonest case: any dialog opened while one window is open lands in the Window band. It sits below every pinned window, every root popover, and every toast.

An exact tie resolves only by DOM insertion order. Every "above" assertion in this plan is therefore a strict inequality.

### A modal layer keeps its own band through a new optional hook — `keepsOwnBand`

`DismissableLayer` gains an optional `keepsOwnBand?(): boolean`. When it returns `true`, `bandFor` uses the layer's own `getBand()` even though the layer has a parent. The parent link itself is unchanged. `Dialog` returns `true`.[^hook-shape]

This mirrors the existing optional-hook style on the same interface: [`getBand?`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L85) and [`isLayerRoot?`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L96) are both optional methods whose absence means "do the default", read with `?.()` inside `register`. `keepsOwnBand` separates the two things `isLayerRoot` currently couples — tree parent and band — for a layer that needs a different band but the same parent.

| Layer registering | Parent | `keepsOwnBand()` | Band used |
|---|---|---|---|
| Dialog, opened while a Window is open | the Window | `true` | Dialog (11000) |
| Menu (Dropdown band) anchored inside a Window | the Window | omitted | Window (inherited) |
| Menu anchored inside that Dialog | the Dialog | omitted | Dialog (inherited) |
| Window (root) | none | — | its own |

Rejected alternatives: `Dialog.isLayerRoot(): true`, `bandFor = Math.max(parent.band, ownBand)`, and keying the band on `getDismissMode() === "modal"`.[^rejected]

### `setBand` migrates only layers that inherit their band

[`restampSubtree`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L552) moves every descendant into the new band when `setBand` is called. With `keepsOwnBand`, a descendant's band is recomputed with `bandFor(parent, layer)` instead. The walk is parent-first, so each child sees its parent's already-migrated band.[^setband]

| `setBand(window, PinnedWindow)` subtree | Band before | Band after |
|---|---|---|
| Window (the target) | Window | PinnedWindow |
| Menu opened from the Window | Window | PinnedWindow |
| Dialog opened from the Window (`keepsOwnBand`) | Dialog | Dialog |
| Menu opened from that Dialog | Dialog | Dialog |

### `Band.Drawer` = 8950, midway between the Rail (8900) and Window (9000)

A new `Z_BAND_DRAWER` constant sits midway in the 100-wide gap between [`RAIL_Z_INDEX`](../packages/lib/src/typescript/lib/overlay/Rail.ts#L147) and `Z_BAND_WINDOW`. It is listed in `_bandBases`, which leaves 49 stamps of headroom for drawers open at the same time.[^drawer-value]

The band follows the declared-band pattern (`AbstractWindow`, `Popover`, `Menu`, `AnimatedDropdown` return a `Band` value from `getBand()`), not Rail's hard-stamp. `Rail` hard-stamps because it is not a `DismissableLayer`. `Drawer` is one.

### A modal `Drawer` uses `Band.Dialog`; a non-modal one uses `Band.Drawer`

`Drawer.getBand()` returns `isModal() ? LayerManager.Band.Dialog : LayerManager.Band.Drawer`. `isModal()` is only read at `open()` (see the `@remarks` on [`setModal`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L268)), so the band is stable while the drawer is open.[^modal-drawer]

This refines the decision "Drawer gets `Band.Drawer`" for modal drawers only. Without it, a modal drawer's scrim would drop from 10000 to 8950, below every window and popover. That is today's defect in a new form, and it would be a regression: today a modal drawer's scrim covers windows.

| Surface | Band | Its scrim is above |
|---|---|---|
| Non-modal Drawer | Drawer (8950) | — (no scrim); the drawer panel is above the Rail and below windows |
| Modal Drawer | Dialog (11000) | every window, popover, dropdown, toast, non-modal drawer |
| Dialog | Dialog (11000) | the same |

### In-page drag outlines follow the lowest band down to `Band.Drawer - 1`

[`DragFeedback`](../packages/lib/src/typescript/lib/overlay/DragFeedback.ts#L19), [`ReorderIndicator`](../packages/lib/src/typescript/lib/overlay/ReorderIndicator.ts#L16), [`DropZoneOverlay`](../packages/lib/src/typescript/lib/overlay/DropZoneOverlay.ts#L103) and [`IN_PAGE_OUTLINE_Z_INDEX`](../packages/lib/src/typescript/lib/core/ResizeDrag.ts#L94) are documented as "just below the lowest `LayerManager` band". Each changes from `Band.Window - 1` to `Band.Drawer - 1` (8949). This keeps every relationship they have today: above the Rail and page content, below drawers and windows.[^outlines]

### No separate `Notification` case

`Notification` stamps a fixed `Band.Notification` (10500). It outranked a demoted dialog only because the dialog fell below 10500. Once a dialog always stamps at or above `Band.Dialog + 1`, the existing pin that `Notification < Dialog` ([`Notification.test.ts:153-160`](../packages/lib/tests/overlay/Notification.test.ts#L153)) settles it. The "Window, Dialog" and "Dialog alone" integration rows also assert `backdrop > Band.Notification`, so the symptom has a failing-today assertion without its own test.

### Modality defence-in-depth goes in a separate plan

This plan does not change `Dialog`'s Tab trap. Making it recapture focus that has left the dialog belongs in its own plan.[^defence]

---

## Public API

```typescript
// core/LayerManager.ts
export interface DismissableLayer {
    // …existing members unchanged…

    /**
     * Optional band-precedence hint. Returns `true` for a nested layer that
     * must stack in its own getBand() band instead of inheriting its opener's —
     * a modal dialog, whose backdrop has to cover every non-modal surface
     * whatever it was opened from. The layer still links under its opener, so
     * activation and cross-portal containment are unchanged; only its band
     * differs. Layers opened from it inherit its band as usual. Ignored for a
     * root layer, which always uses its own band.
     */
    keepsOwnBand?(): boolean;
}

export namespace LayerManager {
    export const Band: {
        readonly Drawer:       8950;   // NEW — first entry
        readonly Window:       9000;
        readonly PinnedWindow: 9400;
        readonly Popover:      9800;
        readonly Dropdown:     10000;
        readonly Notification: 10500;
        readonly Dialog:       11000;
        readonly Tooltip:      12000;
    };
}

// overlay/Dialog.ts
class Dialog extends Component implements DismissableLayer {
    keepsOwnBand(): boolean;   // always true
}

// overlay/Drawer.ts
class Drawer extends Component<DrawerOptions> implements DismissableLayer {
    getBand(): number;         // isModal() ? Band.Dialog : Band.Drawer
}
```

No new options-bag fields: both methods return fixed or derived values, not consumer configuration.

---

## Implementation

`LayerManager.ts` — `bandFor` takes the layer, not a pre-read band:

```typescript
function bandFor(parent: LayerNode | null, layer: DismissableLayer): number {
    if (parent && !layer.keepsOwnBand?.()) {
        return parent.band;
    }

    return layer.getBand?.() ?? Z_BAND_DROPDOWN;
}
```

`register` (line 326) becomes `const band = bandFor(parent, layer);`.

`restampSubtree`'s walk (line 563) replaces `n.band = band;` with:

```typescript
if (band !== undefined) {
    n.band = n === node ? band : bandFor(n.parent, n.layer);
}
```

---

## Ordered Implementation Steps

Work test-first. Steps 1 and 3 must go red before steps 2, 4 and 5 make them green.

1. **`packages/lib/tests/overlay/LayerManager.test.ts` — factory and new cases.**
   - Add `keepsOwnBand?: boolean` to `FakeLayerOpts` (line 25). In `fakeLayer` (line 36), next to the `isRoot` branch, add `if (opts.keepsOwnBand !== undefined) { layer.keepsOwnBand = () => opts.keepsOwnBand!; }`.
   - Add a `describe('keepsOwnBand', …)` block after `'nested vs root parenting'` holding cases LM-1 to LM-5 from *Expected Behaviour*.
   - Do not register any `Band.Popover` layer in the new cases. `'leaves a neighbouring band untouched across that run'` (line 393) needs the Popover counter at zero.
   - Retarget the three existing tests listed under *Expected Behaviour → Retargeted tests*.
   - Run `npx vitest run tests/overlay/LayerManager.test.ts` from `packages/lib`. Expect LM-1, LM-4 and LM-5 red. LM-2 and LM-3 already pass and are mutation guards; the retargeted tests stay green.
2. **`packages/lib/src/typescript/lib/core/LayerManager.ts`.**
   - Add the `keepsOwnBand?(): boolean` member after `isLayerRoot?` (line 96), with the JSDoc from *Public API*.
   - `getBand?` JSDoc (lines 79-84): change the ordering to `(Drawer < Window < Popover < dropdown < Dialog)`. Change the last sentence to: "A nested layer inherits its opener's band unless it returns `true` from {@link DismissableLayer.keepsOwnBand}, so this matters for top-level registrations and for such layers."
   - Band comment block (lines 114-129): prepend `Drawer 8950  <` to the ordering line (118). Change "the narrowest gap is the Popover band's 199" to "the narrowest gap is the Drawer band's 49".
   - Add `Z_BAND_DRAWER: number = 8950;` above `Z_BAND_WINDOW` (line 130). Give it a comment in the style of `Z_BAND_PINNED_WINDOW`'s. It covers non-modal drawers, above the Rail's fixed 8900 and below every window; it sits midway in the 100-wide Rail→Window gap; and its 49 stamps bound how many drawers can be open at once, which is far more than an app opens.
   - `_bandBases` (line 155): add `Z_BAND_DRAWER` as the first entry.
   - `FALLBACK_BAND_HEADROOM` comment (lines 160-165): replace "200 matches the narrowest gap the listed bases leave, so an unlisted band is bounded no more loosely than a listed one" with "200 matches the Popover band's gap, the narrowest among the bands a surface may share with arbitrarily many peers; the Drawer band's narrower gap is sized for the few drawers an app opens at once". Keep the value at 200.
   - `Band` object (line 220): add `Drawer: Z_BAND_DRAWER,` as the first entry and keep the column alignment.
   - `bandFor` (lines 230-238): apply the *Implementation* body. Update its JSDoc: "…an unrelated peer, or a nested layer that keeps its own band (see {@link DismissableLayer.keepsOwnBand}), uses its own surface-type band."
   - `register` (line 326): `const band = bandFor(parent, layer);`.
   - `setBand` JSDoc (line 520): change "(and every layer opened from it)" to "(and every layer opened from it that inherits its band — a layer that keeps its own band stays in it, along with the layers opened from that layer)".
   - `restampSubtree` (line 563): apply the *Implementation* change. In its JSDoc, change "also moves every node into it" to "moves the target node into it and recomputes each descendant's band from its (already moved) parent".
   - Run step 1's command: all green. Run `npm run typecheck` from the repo root.
3. **Create `packages/lib/tests/overlay/ModalLayerBand.test.ts`** holding cases INT-1 to INT-9.
   - Copy `CONFIG` and the imports from `Drawer.test.ts`. Import `_Dialog as Dialog` from `~/overlay/Dialog`, `_Window as Window` from `~/overlay/Window`, `Drawer` from `~/overlay/Drawer` and `Rail` from `~/overlay/Rail`. Import `makeEvent` alongside `installTestDOM`.
   - Keep a `live: DismissableLayer[]` list. `afterEach` unregisters each entry in reverse with `LayerManager.unregister`, clears the list, and calls `DOM.reset()` (the drain pattern of `LayerManager.test.ts:142-150`).
   - Open surfaces with `new Drawer({ modal }).open()`, `new Window({ title: 'w' }).show()` and `void new Dialog({ title: 'T', message: 'M' }).show()`. Push each onto `live`.
   - Read z with `getZIndex()`. For scrims, read `(dialog as any)._backdrop.getZIndex()` and `(drawer as any)._backdrop.getZIndex()`, with a one-line comment that no public accessor exposes the scrim (precedent: `Dialog.test.ts:916`).
   - Put each open order in its own `it`, so each starts from an empty stack.
   - Run it: INT-1, 2, 4, 5 and 7 red. INT-3, 6, 8 and 9 pass today and are mutation guards.
4. **`packages/lib/src/typescript/lib/overlay/Dialog.ts`.** After `getBand()` (line 1466), add `keepsOwnBand(): boolean { return true; }`. Its JSDoc says: "A dialog is modal, so it stacks in the Dialog band whatever it was opened from — its backdrop must cover every non-modal surface — while still linking under its opener, so the opener stays active while the dialog is used."
5. **`packages/lib/src/typescript/lib/overlay/Drawer.ts`.** After `isLayerRoot()` (line 731), add `getBand(): number { return this.isModal() ? LayerManager.Band.Dialog : LayerManager.Band.Drawer; }`. Its JSDoc says: "Returns the drawer's z-index band: the Drawer band for a non-modal drawer — above the Rail, below every window — and the Dialog band for a modal one, so its scrim covers every non-modal surface like a dialog's backdrop. Read at `open()`, like `isModal()`." Run step 3's file: all green.
6. **Getter round-trips**, following `Dialog.test.ts:125` and `Popover.test.ts:207`:
   - `packages/lib/tests/overlay/Dialog.test.ts`: in `'Dialog (LayerManager integration getters)'`, add `it('keepsOwnBand() is true', …)`.
   - `packages/lib/tests/overlay/Drawer.test.ts`: add `it('getBand() is the Drawer band when non-modal and the Dialog band when modal', …)`.
7. **In-page drag outlines.** In each of the following, change `LayerManager.Band.Window - 1` to `LayerManager.Band.Drawer - 1`. Reword its comment from "the lowest `LayerManager` band (the `Window` band)" to "the lowest `LayerManager` band (the Drawer band)". Keep "never paints over a floating window". Add "or an open drawer" where the comment lists what it must not paint over.
   - `packages/lib/src/typescript/lib/overlay/DragFeedback.ts` (lines 9-19; the text "`Band.Window - 1` avoids" at line 16 becomes "`Band.Drawer - 1` avoids")
   - `packages/lib/src/typescript/lib/overlay/ReorderIndicator.ts` (lines 9-16)
   - `packages/lib/src/typescript/lib/overlay/DropZoneOverlay.ts` (lines 95-103)
   - `packages/lib/src/typescript/lib/core/ResizeDrag.ts` (lines 89-94)

   Then in `packages/lib/tests/overlay/overlay-primitives.test.ts`, change lines 41, 82 and 162 to `toBe(LayerManager.Band.Drawer - 1)`, and rename the three tests (lines 36, 77, 157) from "below the Window band" to "below the Drawer band". Check: `grep -rn 'Band.Window - 1' packages/lib/src packages/lib/tests` finds zero matches.
8. **`packages/lib/src/typescript/lib/overlay/Rail.ts`.** In the `RAIL_Z_INDEX` comment (lines 139-146), change "just below the window band (`Z_BAND_WINDOW = 9000` in `LayerManager`)" to "just below the lowest layer band (`Z_BAND_DRAWER = 8950` in `LayerManager`)". Change "windows, popovers, and dialogs still stack above" to "drawers, windows, popovers, and dialogs still stack above". In the class JSDoc (line 246), change "just below the window band" to "just below the drawer band". The value stays 8900.
9. **Docs** — see *Documentation Impact*. Then run the full *Verification* list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Drawer.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Rail.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/DragFeedback.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/ReorderIndicator.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/DropZoneOverlay.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ResizeDrag.ts` |
| Modify | `packages/lib/tests/overlay/LayerManager.test.ts` |
| Create | `packages/lib/tests/overlay/ModalLayerBand.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/tests/overlay/Drawer.test.ts` |
| Modify | `packages/lib/tests/overlay/overlay-primitives.test.ts` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/components/Drawer.md` |
| Modify | `packages/lib/docs/components/Rail.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit-testable offline. Each lists the **mutation it exists to kill**. Before trusting a case, apply its mutation, see it go red, and revert.[^mutate-prove] Every cross-surface comparison is strict (`toBeGreaterThan` / `toBeLessThan`), never `…OrEqual`. On today's code, rows INT-2, INT-4 and INT-5 are exact ties, which an `OrEqual` assertion would pass.

### `LayerManager.test.ts` — the hook on fake layers

| # | Setup | Assert | Kills |
|---|---|---|---|
| LM-1 | `opener` = Window-band root; `child` = `{ band: Dialog, keepsOwnBand: true }` | `z(child) > Band.Dialog` and `z(child) < Band.Tooltip` | `bandFor` ignoring the hook (today's code) |
| LM-2 | as LM-1; append a `probe` element into `child.getLayerElement()` with `DOM.sink.appendChild` | `LayerManager.containsAcrossLayers(opener, probe) === true` | `register` implementing the hook by dropping the parent (`parent = null` when `keepsOwnBand()` is true) |
| LM-3 | `opener` = Window-band root; `child` = `{ band: Dropdown, keepsOwnBand: false }` | `z(child) >= Band.Window`, `z(child) < Band.PinnedWindow`, `z(child) > z(opener)` | reading the hook by presence (`layer.keepsOwnBand !== undefined`) instead of calling it |
| LM-4 | `root` = Window-band root; `keeper` = `{ band: Dialog, keepsOwnBand: true }`; `inner` = `{}` (registered after `keeper`, so it links under it); then `setBand(root, PinnedWindow)` | `z(root) >= Band.PinnedWindow`; `z(keeper) > Band.Dialog`; `z(inner) > Band.Dialog` and `z(inner) > z(keeper)` | `restampSubtree` moving every node (today's code) → `keeper` red; a per-node rule `keepsOwnBand ? n.band : band` → `inner` red |
| LM-5 | `opener` = Window-band root; `keeper` = `{ band: Dialog, keepsOwnBand: true }`; `inner` = `{ band: Dropdown }` (a menu opened inside the dialog) | `z(inner) > z(keeper)` and `z(inner) > Band.Dialog` | "children of a keeper keep their own band too" (`bandFor` returns own band when `parent.layer.keepsOwnBand?.()`) → `inner` stamps in Dropdown (10000), below `keeper` |

### `ModalLayerBand.test.ts` — the consequence on the real classes

`bd(d)` is the dialog's backdrop z. `scrim(dr)` is a modal drawer's scrim z.

| # | Open order | Assert | Fails today? | Kills |
|---|---|---|---|---|
| INT-1 | Drawer, Window, Dialog | `bd > z(drawer)`; `bd > z(window)`; `z(dialog) > bd` | yes (9001 < 10001) | M-hook, M-dialog |
| INT-2 | Drawer, Dialog | `bd > z(drawer)`; `z(dialog) > bd` | yes (tie) | M-hook, M-dialog |
| INT-3 | Dialog, Drawer | `bd > z(drawer)` | no | `Band.Drawer` placed at or above `Band.Dialog` |
| INT-4 | Window, Drawer, Dialog | `bd > z(window)`; `bd > z(drawer)` | yes (tie) | M-hook, M-dialog |
| INT-5 | Window, Dialog | `bd > z(window)`; `bd > Band.Notification` | yes (tie; 9004 < 10500) | M-hook, M-dialog; the Notification symptom |
| INT-6 | Dialog alone | `z(dialog) > bd`; `bd > Band.Notification` | no | `Dialog.getBand()` returning anything below Notification |
| INT-7 | Window, Drawer (non-modal); also `new Rail()` | `z(drawer) < z(window)`; `z(drawer) > rail.getZIndex()` | yes (10001 > 9001) | `Drawer.getBand` missing (Dropdown default); `Band.Drawer >= Band.Window`; `Band.Drawer` below the Rail's 8900 |
| INT-8 | modal Drawer, Window | `scrim > z(window)`; `z(drawer) > scrim` | no today; **yes after a naive fix** | `Drawer.getBand` returning `Band.Drawer` for modal drawers |
| INT-9 | Window (fake, below), then Dialog — activation | see below | no | M-sever |

INT-8 is marked "fails today? no", but it is still required: it is the case that fails if step 5 ignores `isModal()`. Also run it in the reverse order (Window, then modal Drawer) with the same assertions.

INT-9 proves that the parent edge still carries activation. Use a fake Window-band root `win` with `onActivate: vi.fn()`, `getBand: () => LayerManager.Band.Window`, `isLayerRoot: () => true`, `getDismissMode: () => 'manual'` and its own element from `DOM.sink.createElement('div')`, plus a real `Dialog`. Dispatch presses with `DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(target, 'pointerdown') as unknown as Event)` (the route the Escape tests use in `LayerManager.test.ts:734-745`).

1. Register `win` and call `LayerManager.bringToFront(win)`.
2. **Harness control:** press on an unparented element. Expect `win.onActivate` last called with `false`. This proves presses reach the manager; without it, step 5 could pass because nothing was dispatched.
3. `bringToFront(win)` again. Expect last call `true`.
4. Open the dialog, and append a `probe` into `dialog.getLayerElement()`.
5. Press on `probe`. Expect `win.onActivate` last called with `true`. With the parent severed, the manager marks the dialog active and calls `win.onActivate(false)`.

This sequence was checked on `master`: it passes, and forcing `isLayerRoot = () => true` on the dialog turns step 5 red.

Mutation keys: **M-hook** is `bandFor` ignoring `keepsOwnBand`. **M-dialog** is `Dialog.keepsOwnBand` removed or returning `false`. **M-sever** is `Dialog.isLayerRoot(): true`, or `register` dropping the parent when the hook is true.

### Getter round-trips (step 6)

| Case | Assert |
|---|---|
| `new Dialog(…).keepsOwnBand()` | `true` |
| `new Drawer({ modal: false }).getBand()` | `LayerManager.Band.Drawer` |
| `new Drawer({ modal: true }).getBand()` | `LayerManager.Band.Dialog` |

These follow the existing `getBand() is the X band` precedent. The consequence cases above are the real guard; these only localise a failure.

### Retargeted tests

- **`'a non-root layer inherits the topmost layer band and lands above it'`** (`LayerManager.test.ts:234-249`). Today its child is `{ band: Band.Dialog }`, the modal-dialog shape this plan stops inheriting. Change the child to `{ band: LayerManager.Band.Dropdown }`, a menu opened inside a window. Replace the weak `Math.floor(z / 1000)` equality (9000 and 9400 floor alike) with `z(child) >= Band.Window` and `z(child) < Band.PinnedWindow`, and keep `z(child) > z(opener)`. Update the comment to "ignoring its own Dropdown band". *Why it still earns its place:* it pins the default contract — a layer that omits `keepsOwnBand` inherits — which LM-3 covers only for an explicit `false`. Together with LM-3 it kills `bandFor = Math.max(parent.band, ownBand)`, since that mutation lifts the child to 10000.
- **`'an anchor-less nested layer falls back to the last-registered layer…'`** (`:630-673`). Its fake is already band-less, so it passes after the fix; only its comment "(e.g. a Dialog)" (line 642) becomes false. Give `nested` an explicit `{ band: LayerManager.Band.Dropdown }`, and change the comment to "(e.g. a Menu opened with no anchor element)". *Why it still earns its place:* it is the only case that pins the last-registered fallback against the frontmost-by-z rule for an anchor-less layer.
- **`'a layer whose anchor lives inside a window links under that window, not an unrelated root (a drawer)…'`** (`:590-628`). Its premise comment (lines 592-594) says a drawer defaults to the Dropdown band above Window, which is no longer true of `Drawer`. Give both `drawer` and `drawerPeer` an explicit `band: LayerManager.Band.Dropdown`. Rename "(a drawer)" to "(a higher-band root)" in the title and the variable names (`higherRoot`, `higherPeer`). Change the comment to "an unrelated root in a band above Window". *Why it still earns its place:* it is the second-root-band parentage case whose opener is an unrelated higher band, not a pinned window.

---

## Verification

From `packages/lib` (never with a bare `--root`):

- `npx vitest run tests/overlay/LayerManager.test.ts tests/overlay/ModalLayerBand.test.ts tests/overlay/Dialog.test.ts tests/overlay/Drawer.test.ts tests/overlay/overlay-primitives.test.ts tests/overlay/Notification.test.ts tests/core/ResizeDrag.test.ts`. The first four were 101 passed on `master`. Expect 101 plus the new cases, with no failures.
- **Mutation pass** — apply each and confirm the named case goes red, then revert:

  | Mutation | Must turn red |
  |---|---|
  | `bandFor` body back to `parent ? parent.band : ownBand` | LM-1, LM-4, LM-5, INT-1, 2, 4, 5 |
  | `bandFor` → `parent ? Math.max(parent.band, own) : own` | retargeted inheritance test (`:234`), LM-3 |
  | `register`: `parent = layer.isLayerRoot?.() \|\| layer.keepsOwnBand?.() ? null : …` | LM-2, INT-9 |
  | `bandFor` checks `layer.keepsOwnBand !== undefined` | LM-3 |
  | `restampSubtree` back to `n.band = band` | LM-4 (`keeper`) |
  | `restampSubtree` → `n.band = n.layer.keepsOwnBand?.() ? n.band : band` | LM-4 (`inner`) |
  | `bandFor` returns own band when `parent.layer.keepsOwnBand?.()` | LM-5 |
  | delete `Dialog.keepsOwnBand` | INT-1, 2, 4, 5 |
  | delete `Drawer.getBand` | INT-7 |
  | `Drawer.getBand` → always `Band.Drawer` | INT-8 |
  | `Z_BAND_DRAWER = 9000` | INT-7 |
  | `Z_BAND_DRAWER = 8850` | INT-7 |
  | `Z_BAND_DRAWER = 11500` | INT-3 |
  | `Dialog.getBand` → `Band.Dropdown` | INT-6 |

- `npm test` from the repo root (typecheck of tests plus the full suite).
- `npm run typecheck` and `npm run lint` from the repo root.
- `npm run docs:api`: zero warnings. `keepsOwnBand`'s JSDoc may link only public symbols.
- `npm run docs:llms:check`: clean.
- `grep -rn 'Band.Window - 1' packages/lib/src packages/lib/tests` finds zero matches.
- **Manual (by eye, only if the user asks; do not launch a window yourself):** in the docs app, open a non-modal Drawer, then a Dialog. The drawer is dimmed under the backdrop and a click on it does nothing.

---

## Documentation Impact

- `packages/lib/docs/concepts/layering.md`:
  - Band table (lines 62-70): add a first row `| Drawer | 8950 |`.
  - Lines 75-77: after "a nested layer **inherits its opener's band**", add: "— unless it returns `true` from `keepsOwnBand()`. A `Dialog` does, so a modal backdrop always stacks above every non-modal surface whatever the dialog was opened from. It still links under its opener, so activation and containment are unchanged."
  - Lines 77-79 (`setBand`): add "a descendant that keeps its own band stays in it".
  - The `"modal"` bullet (lines 100-102): append "Modal surfaces — `Dialog` and a modal `Drawer` — stack in the Dialog band."
- `packages/lib/docs/components/Drawer.md`, *Modal vs. non-modal* table (lines 37-42): add a row `| Stacking | Dialog band — above windows, popovers, menus and toasts | Drawer band — above the Rail, below windows |`.
- `packages/lib/docs/components/Rail.md` line 5: "so windows, popovers, and dialogs still stack above it" → "so drawers, windows, popovers, and dialogs still stack above it".
- `packages/lib/docs/reference/changelog/next.md`: add sections in the release pages' order (`## Changed`, then the existing `## Added`, then `## Fixed`), creating each heading only if absent:
  - `## Changed` → `### Overlay`: **A non-modal `Drawer` now stacks below windows, and a modal one in the Dialog band.** A non-modal drawer used to take the Dropdown band (10000), above every window and popover. It now takes the new `Band.Drawer` (8950), above the `Rail` and below windows. A modal drawer takes `Band.Dialog`, so its scrim now also covers toasts. In-page drag outlines moved from `Band.Window - 1` to `Band.Drawer - 1`, which keeps them under an open drawer as before. No consumer action is needed unless an app relied on a non-modal drawer covering a window.
  - `## Added` → `### Core`: **`LayerManager.Band` gains `Drawer`** (8950, between the `Rail`'s fixed 8900 and `Window`). **`DismissableLayer` gains an optional `keepsOwnBand()`** for a nested layer that must stack in its own band while staying linked under its opener.
  - `## Fixed` → `### Overlay`: **A modal `Dialog` is no longer drawn beneath — and left clickable under — another overlay.** A dialog opened while any layer was open inherited that layer's band. Opened from a window, it sat below pinned windows, popovers and toasts, with its backdrop tied with the window. Opened with a drawer open, its backdrop sat under or tied with the drawer, which then took clicks and focus. A dialog now always stacks in the Dialog band. No consumer action is needed.
- `llms.txt` is generated. Neither `Drawer`'s nor `Dialog`'s class summary changes, so `docs:llms:check` only confirms that.

---

## Potential Challenges

- **An unmerged branch overlaps four of these files.** `feature/dialog-escape-releases-tab-owner` (not part of the eight-branch stack) changes `LayerManager.ts` (the `DismissableLayer` interface and `onKeyDown`), `Dialog.ts` (`requestClose`, lines 1446-1470, next to `getBand`), `LayerManager.test.ts` (`fakeLayer`, around line 42) and `Dialog.test.ts`. Whichever merges second must resolve the conflict by keeping both hunks. The two sets of changes do not overlap in meaning.
- **File-wide band counters in `LayerManager.test.ts`.** Stamps persist across the file's tests. Assert relative order, never absolute stamps, and keep `Band.Popover` out of the new cases (see step 1).
- **A page-anchored dropdown opened while a non-modal Drawer is the last-registered layer now inherits `Band.Drawer`, not `Band.Dropdown`.** It still paints above the drawer and the page. A window overlapping it would now cover it, which is the same last-registered fallback a window already gets today. Leave it; see *Non-Goals*.
- **Drawer band headroom is 49 layers open at once.** A 50th simultaneous drawer would climb into 9000. The comment added in step 2 documents the bound, and no app opens that many drawers.
- **Toasts go under a modal drawer's scrim**, as they already do under a dialog's backdrop. The changelog entry states this.

---

## Critical Files

- [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts): `DismissableLayer` (lines 40-97, the optional-hook precedent), band constants and `_bandBases` (114-166), `Band` (220), `bandFor` (236), `register` (320), `setBand` / `restampSubtree` (519-575), `resolveParent` (654), `activatableAncestor` (714), `handleOutside` (736).
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts): `open()` (918-960), the `DismissableLayer` block (1415-1466).
- [`overlay/Drawer.ts`](../packages/lib/src/typescript/lib/overlay/Drawer.ts): `open()` (339-360), `setModal` (268), `openBackdrop` (587), `isLayerRoot` / `onZIndexChanged` (729-745).
- [`overlay/AbstractWindow.ts`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L981): `getBand()` / `isLayerRoot()` / `setAlwaysOnTop` (the declared-band and `setBand` precedent), `onActivate` (928).
- [`overlay/Rail.ts:147`](../packages/lib/src/typescript/lib/overlay/Rail.ts#L147): the hard-stamped 8900 that `Band.Drawer` sits above.
- [`tests/overlay/LayerManager.test.ts`](../packages/lib/tests/overlay/LayerManager.test.ts): `fakeLayer` (36-62), drain (142-150), the Escape dispatch route (734-745).
- [`tests/overlay/Dialog.test.ts:916`](../packages/lib/tests/overlay/Dialog.test.ts#L916): the white-box backdrop read precedent.

---

## Non-Goals

- **Focus recapture in `Dialog`'s Tab trap.** This is defence-in-depth for modality that does not depend on stacking. It belongs in its own plan.[^defence]
- **`Dialog` does not implement `onZIndexChanged`.** When its opener is raised or the Dialog band is compacted, the dialog's layer-tree stamp moves but its element does not. The element stays in the Dialog band, above every non-modal surface, so this plan's guarantee holds. The modal-versus-modal edge (a compaction after ~1000 dialog opens in one session reorders stacked dialogs) was already there before this change and is a separate fix.
- **A stacked dialog's backdrop ties with the dialog beneath it** (`panelZ - 1` equals the previous Dialog-band stamp) and wins by DOM order. This is modal-versus-modal and already present today.
- **The last-registered fallback parenting an anchor-less layer under an unrelated peer** (for example, a dialog opened from a window after a drawer registered links under the drawer, so a click in it deactivates the window). This is a separate parentage fix; after this plan it no longer affects stacking.
- **`DialogBackdrop`'s constructor `setZIndex(10100)`** ([`DialogBackdrop.ts:49`](../packages/lib/src/typescript/lib/component/container/DialogBackdrop.ts#L49)) is always overwritten and is left alone.

---

## Notes

[^measured]: Measured on `master` (`d812b18e`) with a throwaway vitest file that opened the real `Drawer`, `Window` and `Dialog` in each order, one order per `it`, and read `getZIndex()` from each and from the dialog's private `_backdrop`. The first five rows match the prior investigation's table exactly. Every cited line in the brief was re-checked. All hold except `AbstractWindow.onActivate`, which is at line 928, not 934. The `LayerManager`/`Dialog`/`Drawer` baseline is 101 passed.

[^hook-shape]: The hook keeps the tree edge and changes only the band. Three things read the edge. `activatableAncestor` lets a click inside the dialog keep its opener window active. `containsAcrossLayers` treats the dialog as inside its opener. `restampSubtree` re-stamps the dialog when its opener is raised. Only the band assignment needs to differ for a modal layer. The name `keepsOwnBand` says what the manager does with it, the same way `isLayerRoot` does, and says nothing about modality. That leaves the hook usable by any future layer that must not be demoted by its opener.

[^rejected]: **`Dialog.isLayerRoot(): true`** needs no manager change but severs the parent link. `activatableAncestor` then finds no `onActivate` ancestor (only `AbstractWindow` implements it), so every click inside a dialog opened from a window calls `markActive(dialog)`, which calls `window.onActivate(false)` and darkens the owning window's title bar. This was confirmed offline: INT-9's sequence with `isLayerRoot = () => true` ends in `onActivate(false)`. **`bandFor = Math.max(parent.band, ownBand)`** lifts every nested layer whose own band is higher than its opener's. A `Menu` (`Band.Dropdown`, 10000) anchored in a background window would jump above every window, including the one in front of its opener, which is what the anchor-resolution tests at `LayerManager.test.ts:538-588` exist to prevent. **Keying the band on `getDismissMode() === "modal"`** adds no API, but `LayerDismissMode` is documented as governing dismissal only (`LayerManager.ts:8-23`). Folding stacking into it would couple two policies a future surface may want separately, for example a modal sheet scoped to one window that should stay in the window band.

[^setband]: `AbstractWindow.setAlwaysOnTop` calls `setBand`. Without this change, pinning a window while a dialog it opened is up would move the dialog's layer-tree node into `PinnedWindow`. The dialog's element keeps its old z, because `Dialog` has no `onZIndexChanged`. But any menu later opened from inside the dialog would inherit the node's `PinnedWindow` band and paint beneath the dialog panel. Recomputing each descendant's band with `bandFor(parent, layer)`, parent first, is the same rule `register` uses. The two paths cannot disagree.

[^drawer-value]: The existing bands place a new family midway in the gap it splits: `PinnedWindow` at 9400 splits Window→Popover (800), and `Notification` at 10500 splits Dropdown→Dialog (1000). Both comments say so. 8950 is the midpoint of Rail→Window. Listing it in `_bandBases` changes no other band's ceiling, because a band's ceiling is the next base *above* it and nothing sits below 8950. Its own ceiling becomes 9000, so stamps run 8951-8999. A base of 8900 would also work, since its first stamp is 8901, but it would share the Rail's number and read as a collision. 8910 would give more headroom that no app needs.

[^modal-drawer]: The brief's settled decision is that `Drawer` gets a new `Band.Drawer` between Rail and Window. It was framed around the defect's non-modal drawer. Applied to a modal drawer as well, it would make the modal drawer's scrim (stamped at `panelZ - 1` in `Drawer.openBackdrop`) fall below every window, pinned window and root popover. Those would paint above the scrim and take clicks. That breaks the invariant this plan establishes, and it regresses today's behaviour: measured on `master`, a modal drawer opened before a window stamps 10007 against the window's 9009. Routing modal drawers to `Band.Dialog` keeps that. Two modal surfaces then share a band and stack by open order, like two dialogs do today. This is the one place the plan goes beyond the brief's decision, and the closing summary flags it for the user.

[^outlines]: These four overlays live in ordinary app content, which forms no stacking context, so their z competes at the document root. At `Band.Window - 1` (8999) they would paint over an open non-modal drawer (8951-8999) when drawing a target on page content under it. Today the drawer (10000+) covers them. Moving them to `Band.Drawer - 1` (8949) keeps them below every drawer and window and still above the Rail (8900), exactly as now. Their documented rule, "just below the lowest band", then stays literally true. Split, Accordion and Table pass `IN_PAGE_OUTLINE_Z_INDEX` into their own in-flow outlines, so they follow automatically. `tests/core/ResizeDrag.test.ts` reads the constant, not a literal, and needs no change.

[^defence]: The idea is to make the Tab trap refocus the dialog's first focusable when Tab is pressed with focus outside the dialog, so a future stacking mistake would degrade to a paint bug. It does not belong here, for three reasons. **It would not deliver that degradation:** pointer input still reaches whatever paints above the backdrop, so a stacking mistake would remain an input escape by mouse. The guarantee that really does not depend on stacking is `inert` on everything outside the modal subtree. That is a larger design, because layers opened *from* the dialog are portaled siblings on `documentElement` and must stay live, so it needs `LayerManager` to orchestrate it. **It is a different contract with a different harness:** focus and keyboard routing, not z-order, tested through `setQuerySelectorAllResult` and focus seams rather than `getZIndex()`. **It would collide:** the unmerged `feature/dialog-escape-releases-tab-owner` rewrites the same Tab trap into a new `onTab` method. After this plan, none of the library's own surfaces can paint above a modal backdrop, so the remaining risk is a consumer's hand-set z-index. A focused follow-up plan (an `inert`-based modality guard owned by `LayerManager`) is the right vehicle.

[^mutate-prove]: The library's last campaign shipped twelve prescribed verifications that could not fail. The shapes to avoid here: a `>=` that ties satisfy (INT-2, 4, 5); a case list covering one arm (INT-8 covers the modal arm that the non-modal INT-7 cannot); a call-count assertion standing in for a consequence (LM-2 and INT-9 assert containment and the opener's final active state, not that a hook was called); an existing assertion made vacuous by the fix (the three retargeted tests); and a mutation no case kills (the table in *Verification* maps every mutation to at least one red case). INT-9's harness control (step 2) is there so a dispatch that never reaches the manager cannot pass step 5 vacuously.
