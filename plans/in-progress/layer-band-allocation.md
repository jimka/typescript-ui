# Layer Band Allocation — Implementation Plan

## Overview

`LayerManager` stamps every overlay with `band + counter`, where the counter is
one module-wide number that only ever rises
([`core/LayerManager.ts:175`](packages/lib/src/typescript/lib/core/LayerManager.ts#L175),
[`:227`](packages/lib/src/typescript/lib/core/LayerManager.ts#L227)). Two
defects follow from that. A raise spends a stamp exactly as a registration does,
so an ordinary window climbs out of the Window band and paints over pinned
windows, popovers and dropdowns after a few hundred clicks (**C30**). And a
surface that is not a registered layer cannot sit above a band by holding a
literal: `Notification`'s `Z_INDEX = 10002`
([`overlay/Notification.ts:117`](packages/lib/src/typescript/lib/overlay/Notification.ts#L117))
is overtaken by the Dropdown band after three registrations anywhere in the
session, and a toast then renders behind every open menu for the rest of that
session (**C31**).

This plan bounds the allocator and then gives `Notification` a real band
constant. It also fixes an unrelated defect in the same file: `Notification`
promises the bottom-right corner of the viewport but registers no `resize`
listener, so live toasts sit at the old corner until the next show or dismissal
(**C33**).[^c33-scope]

The change is confined to
[`core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts)
and
[`overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts).
It changes one documented contract — a raise of an already-topmost layer no
longer re-stamps it — and updates the four existing tests that read the old
behaviour.[^contract-change]

---

## Architecture Decisions

### The counter becomes per-band, and renormalises instead of growing forever

Each band keeps its own ascending counter. When the next stamp would reach the
base of the band above, that band's live layers are re-stamped `base + 1 …
base + n` in their current order and the counter restarts from `n`. A band can
then never climb into its neighbour, however long the session runs.[^why-renormalise]

| Band | Base | Highest stamp it can reach |
|---|---|---|
| `Window` | 9000 | 9399 |
| `PinnedWindow` | 9400 | 9799 |
| `Popover` | 9800 | 9999 |
| `Dropdown` | 10000 | 10499 |
| `Notification` | 10500 | not allocated from — a fixed stamp |
| `Dialog` | 11000 | 11999 |
| `Tooltip` | 12000 | not allocated from — a fixed stamp |

Per-band counters alone do **not** close C31: the Dropdown band would still
reach 10003 and overtake the 10002 literal. Renormalisation is what puts a
ceiling under a fixed constant placed above the band.

### A raise that would move nothing spends nothing

`bringToFront` re-stamps only when some layer in the same band, outside the
raised subtree, carries a higher stamp. It marks the layer active either way.
The precedent is one method below it: `setBand` already refuses to spend a
stamp on a move into the band the layer is already in
([`core/LayerManager.ts:421`](packages/lib/src/typescript/lib/core/LayerManager.ts#L421)).[^why-early-return]

### `register` reports the stamp it allocates

`register` calls the layer's `onZIndexChanged` hook with the stamp it just
assigned, so every stamp the manager allocates is reported exactly once. This
is a prerequisite for the early return, not a tidy-up: `AbstractWindow` writes
its element's z-index only from that hook
([`overlay/AbstractWindow.ts:1042-1044`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1042)),
and today relies on the raise in `show()`
([`:825`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L825)) to
produce it.[^register-notifies]

### `Notification` gets a band constant, not a layer registration

`Band.Notification = 10500` is added between `Dropdown` and `Dialog`, and
`Notification`'s constructor stamps itself with it. The toast is still not a
registered layer. The precedent is `Band.Tooltip`, a band constant for a
surface that never joins the layer tree, consumed the same way at
[`overlay/Tooltip.ts:159`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L159).[^cheap-variant]

### C30 lands before C31, in one code commit

The band constant is only durable once the allocator is bounded, so the
allocator change comes first. Neither half delivers the outcome — overlays that
stack correctly for a whole session — on its own, so they are one functionality
and one code commit.[^commit-shape]

### The toast's `resize` listener is owned by a private static sentinel

`Notification.restack` is static, so the listener is installed once for the
whole stack rather than once per toast. A private static `Component` owns it,
mirroring `LayerManager`'s module-level `_listenerOwner`
([`core/LayerManager.ts:146`](packages/lib/src/typescript/lib/core/LayerManager.ts#L146),
installed at
[`:711-718`](packages/lib/src/typescript/lib/core/LayerManager.ts#L711),
removed at
[`:721-728`](packages/lib/src/typescript/lib/core/LayerManager.ts#L721)). The
listener is installed when a toast joins the active stack, and removed when the
stack empties.[^static-owner]

The handler calls `restack()` on the raw event, with no per-frame coalescing —
that is what every other viewport `resize` handler in the library does, and
`restack` does less work than any of them.[^no-coalescing]

---

## Public API

One new band constant. Nothing else in the public surface changes.

```typescript
export namespace LayerManager {
    export const Band: {
        readonly Window:       number;  // 9000
        readonly PinnedWindow: number;  // 9400
        readonly Popover:      number;  // 9800
        readonly Dropdown:     number;  // 10000
        readonly Notification: number;  // 10500  — new
        readonly Dialog:       number;  // 11000
        readonly Tooltip:      number;  // 12000
    };
}
```

`Notification.Z_INDEX` is a `private static readonly` field and is deleted; it
was never part of the public surface.

---

## Internal Structure

### The allocator

Replaces the single `let _zCounter: number = 0;` at
[`core/LayerManager.ts:175`](packages/lib/src/typescript/lib/core/LayerManager.ts#L175).
Both allocation sites — `register`
([`:227`](packages/lib/src/typescript/lib/core/LayerManager.ts#L227)) and
`restampSubtree`
([`:458`](packages/lib/src/typescript/lib/core/LayerManager.ts#L458)) — route
through `nextStamp`.

```typescript
// Ascending list of every band base, so a band's ceiling is the next base up.
// Adding a band narrows its predecessor's headroom automatically, which is
// why stamps renormalise rather than relying on the size of the gap.
const _bandBases: readonly number[] = [
    Z_BAND_WINDOW, Z_BAND_PINNED_WINDOW, Z_BAND_POPOVER,
    Z_BAND_DROPDOWN, Z_BAND_NOTIFICATION, Z_BAND_DIALOG, Z_BAND_TOOLTIP,
];

// Headroom assumed for a band base above every listed one, or between two of
// them: a surface is free to return any number from getBand().
const FALLBACK_BAND_HEADROOM: number = 200;

// Ascending counter per band base. Combined with the base to stamp z.
const _counterByBand: Map<number, number> = new Map();
```

```typescript
function bandCeiling(band: number): number {
    for (const base of _bandBases) {
        if (base > band) {
            return base;
        }
    }

    return band + FALLBACK_BAND_HEADROOM;
}

function nextStamp(band: number): number {
    let counter = (_counterByBand.get(band) ?? 0) + 1;

    if (band + counter >= bandCeiling(band)) {
        counter = renormaliseBand(band) + 1;
    }

    _counterByBand.set(band, counter);

    return band + counter;
}

function renormaliseBand(band: number): number {
    const nodes = _stack.filter(n => n.band === band).sort((a, b) => a.zIndex - b.zIndex);

    for (let i = 0; i < nodes.length; i++) {
        const zIndex = band + i + 1;

        if (nodes[i].zIndex !== zIndex) {
            nodes[i].zIndex = zIndex;
            nodes[i].layer.onZIndexChanged?.(zIndex);
        }
    }

    return nodes.length;
}
```

### The raise guard

```typescript
function isDescendantOf(node: LayerNode, ancestor: LayerNode): boolean {
    for (let p = node.parent; p !== null; p = p.parent) {
        if (p === ancestor) {
            return true;
        }
    }

    return false;
}

function isTopOfBand(node: LayerNode): boolean {
    for (const other of _stack) {
        if (other.band === node.band
            && other.zIndex > node.zIndex
            && !isDescendantOf(other, node)) {
            return false;
        }
    }

    return true;
}
```

`bringToFront` becomes:

```typescript
export function bringToFront(layer: DismissableLayer): void {
    const node = _nodeByLayer.get(layer);

    if (!node) {
        return;
    }

    if (!isTopOfBand(node)) {
        restampSubtree(node);
    }

    markActive(layer);
}
```

### Worked stamps

Window band, counter starting at 0:

| Call | Counter before | Stamp spent | Resulting z | Why |
|---|---|---|---|---|
| `register(winA)` (Window band) | 0 | 1 | 9001 | first allocation in the band |
| `register(winB)` (Window band) | 1 | 2 | 9002 | registers later, so it lands above `winA` |
| `bringToFront(winB)` | 2 | none | 9002 | `winB` is already the top of its band |
| `bringToFront(winA)` | 2 | 3 | 9003 | `winB` outranks `winA`, so the raise moves it |
| `register(menu)` opened from `winA` | 3 | 4 | 9004 | inherits `winA`'s band, so it draws the Window counter |
| `bringToFront(winA)` | 4 | none | 9003 | `winA`'s subtree (`winA`, `menu`) is already on top |

Renormalisation, same band with three live layers:

| Counter before | Stamp asked for | Result |
|---|---|---|
| 398 | 399 | `9000 + 399 = 9399` — below the 9400 ceiling, allocated as-is |
| 399 | 400 | `9400` would reach `PinnedWindow`, so the band renormalises first: its three live layers become 9001, 9002, 9003 in their current order, the counter becomes 3, and the caller gets 9004 |

Toast against an open dropdown, after any three registrations in the session:

| | Dropdown's stamp | Toast's z | Paints on top |
|---|---|---|---|
| today | 10004 | 10002 | the dropdown — wrong |
| after | at most 10499 | 10500 | the toast |

---

## Ordered Implementation Steps

Steps 1-9 are C30 and C31, one code commit. Steps 10-14 are C33, a second code
commit. Steps 15-17 are documentation. Step 18 is the QA panel.

### C30 + C31 — `core/LayerManager.ts` and the toast's band

1. **Add the band constant.** In
   [`core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts),
   after `Z_BAND_DROPDOWN`
   ([`:130`](packages/lib/src/typescript/lib/core/LayerManager.ts#L130)), add
   `const Z_BAND_NOTIFICATION: number = 10500;` with a comment in the shape of
   `Z_BAND_PINNED_WINDOW`'s
   ([`:125-128`](packages/lib/src/typescript/lib/core/LayerManager.ts#L125)):
   it sits midway in the Dropdown→Dialog gap so a toast floats over open
   pickers and menus but stays under the modal detail dialog a toast can open,
   and it halves the headroom that gap gave the Dropdown band.

2. **Rewrite the band comment.** The paragraph at
   [`:118-122`](packages/lib/src/typescript/lib/core/LayerManager.ts#L118)
   claims the gaps leave headroom for a counter that "is not reset, on the
   assumption a single session opens far fewer than 200 unrelated layers in the
   same band before a reload". Replace it: each band has its own counter, and a
   counter that would reach the next base renormalises its band instead, so the
   gap bounds how many layers may be *open at once* in a band rather than how
   many may be opened over a session. Say that a band holding more layers at
   once than its gap allows would still overflow, and that no code guards
   against it — the narrowest gap is the Popover band's 199.

3. **Add `Notification` to `Band`.** Insert `Notification: Z_BAND_NOTIFICATION,`
   between `Dropdown` and `Dialog`
   ([`:193-194`](packages/lib/src/typescript/lib/core/LayerManager.ts#L193)).
   Reword the doc comment at
   [`:182-188`](packages/lib/src/typescript/lib/core/LayerManager.ts#L182) — it
   says "The five z-index bands a surface returns from `getBand()`", which is
   already wrong (there are six, and `Tooltip` is not a `getBand()` value).
   State instead that the object carries every band base, that a registered
   layer returns one of them from `getBand()` (keep the existing
   `{@link DismissableLayer.getBand}` reference), and that `Notification` and
   `Tooltip` are exposed for surfaces that stamp themselves without joining the
   layer tree.

4. **Replace the counter.** Swap `let _zCounter: number = 0;`
   ([`:175`](packages/lib/src/typescript/lib/core/LayerManager.ts#L175)) for
   the `_counterByBand` map, and add `_bandBases`, `FALLBACK_BAND_HEADROOM`,
   `bandCeiling`, `nextStamp` and `renormaliseBand` exactly as
   *Internal Structure* gives them. Put `_bandBases` and
   `FALLBACK_BAND_HEADROOM` at module scope beside the band constants;
   `_counterByBand` and the three functions go inside the namespace where
   `_zCounter` was, since `renormaliseBand` reads `_stack`.

5. **Route both allocation sites.** In `register`
   ([`:227`](packages/lib/src/typescript/lib/core/LayerManager.ts#L227)) write
   `const zIndex = nextStamp(band);`. In `restampSubtree`
   ([`:458`](packages/lib/src/typescript/lib/core/LayerManager.ts#L458)) write
   `n.zIndex = nextStamp(n.band);`.
   Check: `grep -n '_zCounter' packages/lib/src/typescript/lib/core/LayerManager.ts` — expect zero matches.

6. **Report the register-time stamp.** At the end of `register`, after the
   `installListeners()` block
   ([`:238-240`](packages/lib/src/typescript/lib/core/LayerManager.ts#L238)),
   add `layer.onZIndexChanged?.(zIndex);`. Extend `register`'s JSDoc to say the
   allocated stamp is reported through that hook, the same way a re-stamp is.

7. **Add the raise guard.** Add `isDescendantOf` and `isTopOfBand` next to
   `restampSubtree`, and rewrite `bringToFront`
   ([`:398-407`](packages/lib/src/typescript/lib/core/LayerManager.ts#L398)) as
   *Internal Structure* gives it. Update its JSDoc: a raise re-stamps only when
   the layer's subtree is not already on top of its band, and marks the layer
   active either way.

8. **Stamp the toast from the band.** In
   [`overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts),
   delete the `Z_INDEX` field and its comment
   ([`:111-117`](packages/lib/src/typescript/lib/overlay/Notification.ts#L111))
   and change the constructor's
   [`:174`](packages/lib/src/typescript/lib/overlay/Notification.ts#L174) to
   `this.setZIndex(LayerManager.Band.Notification);`, matching
   [`overlay/Tooltip.ts:159`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L159).
   `LayerManager` is already imported
   ([`:5`](packages/lib/src/typescript/lib/overlay/Notification.ts#L5)).
   Check: `grep -rn '10002' packages/lib/src/typescript/lib/` — expect zero matches.

9. **Update the four tests the new contract invalidates**, in
   [`tests/overlay/LayerManager.test.ts`](packages/lib/tests/overlay/LayerManager.test.ts).
   Nothing in the `bringToFront` block at
   [`:176-232`](packages/lib/tests/overlay/LayerManager.test.ts#L176) changes —
   every test there raises a layer that has a peer above it, so all four keep
   passing. What changes is:

   - [`:259-267`](packages/lib/tests/overlay/LayerManager.test.ts#L259), the
     same-band `setBand` no-op: call `layer.onZIndexChanged.mockClear()` after
     `register` before asserting the `setBand` reports nothing, since `register`
     now reports the stamp it allocated.
   - The three parentage tests at
     [`:297-334`](packages/lib/tests/overlay/LayerManager.test.ts#L297),
     [`:336-362`](packages/lib/tests/overlay/LayerManager.test.ts#L336) and
     [`:364-392`](packages/lib/tests/overlay/LayerManager.test.ts#L364). Each
     raises a candidate parent and asks whether the nested layer was notified.
     Both halves of that probe stop discriminating: `register` now notifies
     every layer, and a raise of a layer already alone at the top of its band
     notifies nobody. Rewrite each as follows, and update its comment to say
     what the probe now reads.

     1. Register one extra root **in the band of the layer being raised, after
        the nested layer**, so the raise genuinely moves something. That is a
        second `Band.Window` root in all three tests. For the negative half,
        give the unrelated layer a same-band peer too, so raising it is also a
        real raise: a second `PinnedWindow` layer in tests one and three, and a
        second `Band.Dropdown` root beside the drawer in test two.
     2. Replace the `onZIndexChanged` mock assertions with `getZIndex`
        comparisons. Positive half: after raising the true parent, the nested
        layer's z is above the extra same-band peer's. Negative half: read the
        nested layer's z before raising the unrelated layer and assert it is
        unchanged afterwards.

   The rewritten probe is stronger than the original: it checks where the
   nested layer landed, not merely that something fired.

### C33 — the toast's viewport listener

10. **Add the listener owner and flag.** In `Notification`, beside
    `activeNotifications`
    ([`:119`](packages/lib/src/typescript/lib/overlay/Notification.ts#L119)),
    add:

    ```typescript
    // Owner for the viewport `resize` listener that keeps live toasts in the
    // corner. `Event.addViewportListener` binds a listener to a `Component`,
    // but the handler is static — one for the whole stack, not one per toast —
    // so a single stable sentinel owns it, mirroring `LayerManager`'s listener
    // owner. Installed with the first live toast, removed with the last.
    private static readonly resizeListenerOwner: Component = new Component();
    private static resizeListenerInstalled: boolean = false;
    ```

11. **Add the handler and the install/remove pair.** Next to `restack`
    ([`:605-619`](packages/lib/src/typescript/lib/overlay/Notification.ts#L605)),
    add three private statics: `onViewportResize()`, whose whole body is
    `Notification.restack();`; `installResizeListener()`, which returns early
    when `resizeListenerInstalled`, otherwise calls
    `Event.addViewportListener(Notification.resizeListenerOwner, "resize", Notification.onViewportResize)`
    and sets the flag; and `uninstallResizeListener()`, the mirror image using
    `Event.removeViewportListener`. Pass `Notification.onViewportResize` as a
    named static method reference, not an inline arrow — see
    [ARCHITECTURE.md](ARCHITECTURE.md), *Listeners must reference a named
    function*. `Event` is already imported
    ([`:4`](packages/lib/src/typescript/lib/overlay/Notification.ts#L4)).

12. **Install on the first toast.** In `show`, after
    `Notification.activeNotifications.push(n)`
    ([`:266`](packages/lib/src/typescript/lib/overlay/Notification.ts#L266)),
    call `Notification.installResizeListener();`.

13. **Remove with the last toast.** In `finishDismiss`, after
    `Notification.restack()`
    ([`:598`](packages/lib/src/typescript/lib/overlay/Notification.ts#L598)),
    and inside `destructor`'s list-leave block after its own `restack()`
    ([`:676-679`](packages/lib/src/typescript/lib/overlay/Notification.ts#L676)),
    add:

    ```typescript
    if (Notification.activeNotifications.length === 0) {
        Notification.uninstallResizeListener();
    }
    ```

    Check: `grep -c 'uninstallResizeListener' packages/lib/src/typescript/lib/overlay/Notification.ts` — expect 3 (the definition and two call sites).

14. **Amend the `Notification` test file's scope note, and add the resize
    file.** In
    [`tests/overlay/Notification.test.ts`](packages/lib/tests/overlay/Notification.test.ts),
    the header at
    [`:1-11`](packages/lib/tests/overlay/Notification.test.ts#L1) scopes
    stacking and `restack` out as needing a real-DOM harness. Narrow it: what
    genuinely stays out is auto-dismiss and the entrance animation; a toast's
    stamp and its committed x/y are ordinary `Component` getters over modelled
    state, and the file already drives `Notification.show` offline
    ([`:72-78`](packages/lib/tests/overlay/Notification.test.ts#L72)). The z
    cases (Expected Behaviour rows 11-13) go in that file. The resize cases
    (rows 14-16) go in a **new**
    `packages/lib/tests/overlay/Notification.resize.test.ts`, for the reason
    [`tests/dom/viewport-consume.test.ts:16-23`](packages/lib/tests/dom/viewport-consume.test.ts#L16)
    records: `Event`'s viewport listener map is module-level and survives
    `DOM.reset()`, so a second resize case in a file that already installed one
    would never receive a dispatch. That file drives a resize by mutating the
    config object it passed to `installTestDOM` — `getViewportSize` reads it
    live
    ([`tests/dom/TestDOM.ts:1162-1164`](packages/lib/tests/dom/TestDOM.ts#L1162))
    — and then dispatching:

    ```typescript
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(DOM.source.getWindow(), 'resize'));
    ```

### Documentation

15. **`docs/concepts/layering.md`.** Add `Notification | 10500` and
    `Tooltip | 12000` to the band table
    ([`:62-68`](packages/lib/docs/concepts/layering.md#L62)) with one sentence
    saying those two are stamped by surfaces that are not registered layers.
    Rewrite the allocator sentence at
    [`:74-77`](packages/lib/docs/concepts/layering.md#L74): the manager assigns
    `z = band + counter` from a counter **per band**, renormalises a band's
    live stamps when its counter would reach the next base, and re-stamps on
    `bringToFront` only when the raised subtree is not already on top of its
    band. Correct the closing sentence at
    [`:130-132`](packages/lib/docs/concepts/layering.md#L130): `Menu` is on the
    manager now, and `Tooltip` / `Notification` portal without registering but
    take their z from `Band.Tooltip` / `Band.Notification`.

16. **`docs/components/Notification.md`.** Under *Behavior*
    ([`:25-37`](packages/lib/docs/components/Notification.md#L25)), add a
    bullet saying the stack follows the viewport: toasts re-stack to the new
    bottom-right corner when the window is resized.

17. **`docs/reference/changelog/next.md`.** One entry under
    `## Added` → `### Core` ([`:206`](packages/lib/docs/reference/changelog/next.md#L206))
    for `LayerManager.Band.Notification`; one under
    `## Fixed` → `### Core` ([`:315`](packages/lib/docs/reference/changelog/next.md#L315))
    for the per-band, renormalising allocator and the raise guard (say plainly
    that a raise of an already-topmost layer no longer re-stamps, and that
    `register` now reports its stamp through `onZIndexChanged`); and two under
    `## Fixed` → `### Overlay` ([`:955`](packages/lib/docs/reference/changelog/next.md#L955))
    for the toast's band and for the resize re-stack. No consumer action is
    needed for any of them.

### QA panel

18. **`packages/qa/src/panels/windows.ts`.** In `build`
    ([`:147`](packages/qa/src/panels/windows.ts#L147)), add one pinned window
    that overlaps window 0, and show one persistent toast in `afterMount`
    ([`:172-188`](packages/qa/src/panels/windows.ts#L172)):

    - a `Window('Pinned', { x, y, width, height, alwaysOnTop: true })` placed
      to overlap window 0 — reuse the `WINDOW_*` constants
      ([`:24-31`](packages/qa/src/panels/windows.ts#L24)) with a small offset —
      shown in the same loop as `bare` and `c25`
      ([`:175-177`](packages/qa/src/panels/windows.ts#L175)). Pass
      `alwaysOnTop` in the options bag rather than calling `setAlwaysOnTop`
      after `show()`: `getBand()` then already returns `Band.PinnedWindow` when
      `show()` registers the window, and construction-time configuration is
      what [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) asks for. It is **not**
      added to the `click` target list, so it never raises;
    - `Notification.show('Stacking witness', 'info', 0)` — duration `0` keeps
      it alive for the whole run — imported from
      `@jimka/typescript-ui/overlay` alongside `Dialog` and `Window`
      ([`:7`](packages/qa/src/panels/windows.ts#L7));
    - `pinned` added to `geometry`
      ([`:189`](packages/qa/src/panels/windows.ts#L189));
    - the `description` string
      ([`:53`](packages/qa/src/panels/windows.ts#L53)) extended with the two
      findings it now reproduces, in the shape the existing C25 clause uses:
      C30 (an ordinary window's stamp climbs past the pinned band, so after
      about 400 clicks the clicked windows paint over the pinned one) and C33
      (a live toast adds one `getViewportSize` per viewport unit once it
      re-stacks on resize, and none before).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/tests/overlay/LayerManager.test.ts` |
| Modify | `packages/lib/tests/overlay/Notification.test.ts` |
| Create | `packages/lib/tests/overlay/Notification.resize.test.ts` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/components/Notification.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/qa/src/panels/windows.ts` |

---

## Expected Behaviour

Every row below is unit-testable offline unless marked otherwise. The
`LayerManager` rows go in
[`tests/overlay/LayerManager.test.ts`](packages/lib/tests/overlay/LayerManager.test.ts);
the toast's z goes in
[`tests/overlay/Notification.test.ts`](packages/lib/tests/overlay/Notification.test.ts);
the resize rows go in a new
`tests/overlay/Notification.resize.test.ts`.[^separate-resize-file]

### The allocator

1. `register` calls the layer's `onZIndexChanged` with the stamp it assigned. A
   second `register` of the same layer is still a no-op and reports nothing.
2. A raise of a layer that is **not** on top of its band re-stamps it above its
   prior z, above its band peers, and reports the new stamp — the existing
   contract, unchanged.
3. A raise of a layer whose subtree **is** already on top of its band spends no
   stamp and reports nothing: with one registered layer, `getZIndex` is
   unchanged across two raises and `onZIndexChanged` is called exactly once (by
   `register`).
4. A raise of an already-topmost layer still marks it active, and still
   deactivates whichever layer was active before.
5. Raising a parent re-stamps its descendant layers with it, and they stay
   above it — the existing contract, unchanged.
6. Raises alternating between two Window-band layers, 5,000 of them, leave
   both below `Band.PinnedWindow`. Alternating matters: raising the same layer
   twice in a row is a no-op under row 3, so it would allocate nothing. (Today
   the pair crosses `Band.PinnedWindow` at raise 400.)
7. Those 5,000 raises do not move another band: a `Popover`-band layer
   registered afterwards is stamped `Band.Popover + 1`.
8. Renormalisation preserves order. After those 5,000 alternating raises, the
   layer raised last is still above the other, and a third Window-band layer
   registered first and never raised is still below both.
9. `setBand` into the band the layer already occupies is still a no-op —
   `onZIndexChanged` is not called *again* after the register-time report.
10. `bringToFront` and `setBand` on an unregistered layer stay no-ops.

### The toast

11. `Band.Notification` is strictly greater than `Band.Dropdown` and strictly
    less than `Band.Dialog`.
12. A toast's `getZIndex()` is `Band.Notification`.
13. After registering 20 `Dropdown`-band layers, a toast's z is greater than
    every one of their `getZIndex()` values.
14. A viewport `resize` moves every live toast, with no `show` or dismiss in
    between. With the modelled viewport changed from 1280×800 to 1000×600, the
    single live toast moves from `x = 944, y = 720` to `x = 664, y = 520`
    (`x = width − 320 − 16`, `y = height − 16 − 64`).
15. Showing the first toast adds exactly one viewport listener
    (`Event.listenerCounts().viewport` rises by 1); showing a second adds none.
16. Dismissing the last toast removes it again (`Event.listenerCounts().viewport`
    returns to its pre-toast value). Disposing the last toast directly, without
    a dismiss, removes it too.

### Manual only

17. **Visual, C30.** After a long run of clicks cycling across several
    windows' headers, a pinned (always-on-top) window still paints over all of
    them. Today the clicked windows rise above the pinned one partway through.
18. **Visual, C31.** A toast shown while a menu or picker is open paints over
    it, at any point in a session.

---

## Verification

Automated, from the repository root:

```sh
npm run typecheck        # 0 errors (use this, not a bare tsc -p packages/lib/tsconfig.json)
npm run lint
npm run test
npm run docs:api         # must finish with zero warnings
npm -w packages/qa run typecheck
```

Grep invariants:

```sh
grep -rn '_zCounter' packages/lib/src/typescript/lib/          # zero matches
grep -rn '10002' packages/lib/src/typescript/lib/              # zero matches
grep -c 'nextStamp' packages/lib/src/typescript/lib/core/LayerManager.ts   # 3: definition + 2 call sites
```

**Manual, and only with the user's explicit go-ahead.** Every `packages/qa` run
opens a full-screen window on the user's desktop. **Do not start one, and do not
leave an agent to start one, unattended.** The recipe, when the user asks for
it, is the two-arm comparison in
[packages/qa/README.md](packages/qa/README.md): build this branch and the base
commit as separate arms, then run the same panel against each and diff the
reports.

| Panel and parameters | What it shows |
|---|---|
| `windows`, `drive=click:1200` | C30. On the base arm, window 0's stamp crosses `Band.PinnedWindow` around click 400 and the window paints over the pinned window for the rest of the run; on this branch it never does. The check is what is on screen at the end of the run — the geometry probe records rectangles only, so there is no z-index counter to read. |
| `windows`, `seam=1` (its default `viewport` drive) | C33. `seam.source.getViewportSize` per viewport unit is one higher on this branch than on the base arm: the live toast's `restack` now runs on resize, where before nothing answered the event. |

`windows` is **not** a witness for C31: showing the bug needs a dropdown open
over the bottom-right corner, which the panel has no element for. C31 is proved
by Expected Behaviour rows 11-13, which compare the stamps directly — a
stronger check than a screenshot.

---

## Documentation Impact

`LayerManager.Band` is exported from `@jimka/typescript-ui/core` and rendered by
TypeDoc, so the new `Notification` key appears in the API docs without further
work. The hand-written pages that must change are listed as steps 15-17:
[`docs/concepts/layering.md`](packages/lib/docs/concepts/layering.md) (the band
table and the allocator description),
[`docs/components/Notification.md`](packages/lib/docs/components/Notification.md)
(the *Behavior* list) and
[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).

`grep -rln 'Z_INDEX' packages/lib/docs/` returns nothing, so no page names the
deleted constant.

---

## Potential Challenges

- **Renormalisation can fire in the middle of a `restampSubtree` walk.** Nodes
  the walk has already stamped are compacted along with everyone else,
  preserving their order, and the walk then continues above the compacted top —
  so the raised subtree still ends on top, in order. The only visible
  consequence is that one node may be reported twice in that pass, which
  `Component.setZIndex`'s equality guard
  ([`core/Component.ts:2403-2406`](packages/lib/src/typescript/lib/core/Component.ts#L2403))
  absorbs.
- **A band with more simultaneously open layers than it has headroom would
  still overflow.** Renormalisation bounds z by how many layers are open *at
  once*, so the narrowest band — Popover's 199 — would need 199 popovers on
  screen together. Do not add code for it; step 2 records it in the comment
  instead.
- **Four existing tests read the behaviour this plan changes**, and none
  of them is in the `bringToFront` block the record pointed at. Step 9 names
  each one and how to rewrite it; do not work around them by weakening the
  guard.
- **A test that shows a toast leaves the module-level `resize` registration
  behind.** `Event`'s viewport listener map is module-level and `DOM.reset()`
  does not clear it, so a second resize test in the same file would never
  receive a dispatch. That is why the resize behaviour gets its own test file —
  the same reasoning
  [`tests/dom/viewport-consume.test.ts:16-23`](packages/lib/tests/dom/viewport-consume.test.ts#L16)
  records for itself.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts) | The allocator. `setBand:421` is the precedent for the raise guard; `_listenerOwner:146` with `:711-728` is the precedent for C33's static listener; `Z_BAND_TOOLTIP:132-136` is the precedent for a band constant for a non-layer surface. |
| [`packages/lib/src/typescript/lib/overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts) | Both the toast's stamp and its missing resize listener. |
| [`packages/lib/src/typescript/lib/overlay/Tooltip.ts`](packages/lib/src/typescript/lib/overlay/Tooltip.ts) | `:159` consumes `Band.Tooltip` exactly as `Notification` will consume `Band.Notification`. |
| [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts) | `:954` / `:1235` — the per-instance viewport `resize` add/remove pair, and `onViewportResize:1218`, the handler shape C33 mirrors. |
| [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) | `:502` is the raise-on-any-mousedown gesture that burns the counter; `:818` / `:825` is the register-then-raise sequence that makes step 6 necessary; `:1042-1044` is the only writer of a window's element z-index. |
| [`packages/lib/tests/overlay/LayerManager.test.ts`](packages/lib/tests/overlay/LayerManager.test.ts) | The four tests this plan changes, and the stub layer they all build on. |
| [`packages/lib/tests/dom/viewport-consume.test.ts`](packages/lib/tests/dom/viewport-consume.test.ts) | How a viewport event is dispatched offline, and why such a test gets its own file. |
| [`packages/qa/README.md`](packages/qa/README.md) | The panel contract and the run rules, including the never-run-unattended rule. |

---

## Non-Goals

- **Registering `Notification` as a layer.** The toast is not dismissable, has
  no anchor and never opens anything; a band constant is what it needs.
- **Folding `Menu`, `Tooltip` or `Notification` into the layer tree.** Out of
  scope for a stacking fix, and each is its own decision.
- **`Notification.doLayout`'s constant geometry and its forced close-button
  layout** (F11.12), and **the toast's subtree hover listeners** (F11.10). Both
  live in this file and neither is a stacking or lifecycle bug.
- **Coalescing viewport `resize` work.** No handler in the library coalesces
  today; introducing a per-frame coalescer for the cheapest of them would be a
  new pattern for no measured gain.
- **A z-index channel in the QA geometry probe.** The probe records rectangles,
  and adding a field to it would be a harness change carried by a library bug
  fix.

---

## Notes

[^c33-scope]: C33 shares a file with C31 and nothing else — it is a
    viewport-listener lifecycle bug, not a stacking one, so file locality is
    the only thing arguing for keeping them together. That is enough, because
    the rule at stake governs *commits*, not plans: the `commit` skill's test
    is "would each piece make sense on its own branch?", and C33 would. So it
    rides in this plan and gets its own code commit and its own docs commit.
    Splitting it into a second plan would mean two branches editing
    `Notification.ts`, a conflict for no gain.

[^contract-change]: `bringToFront`'s JSDoc
    ([`core/LayerManager.ts:390-397`](packages/lib/src/typescript/lib/core/LayerManager.ts#L390))
    promises a re-stamp on every call, and
    [`tests/overlay/LayerManager.test.ts:176-232`](packages/lib/tests/overlay/LayerManager.test.ts#L176)
    was read as pinning that. Re-reading the block says otherwise: every test
    in it raises a layer that has a peer above it, so all four keep passing
    unchanged, and the assertions that actually break are elsewhere in the file
    (step 9). This was checked line by line rather than taken from the record,
    because the record's location for it is wrong.

[^why-renormalise]: Three designs were weighed. Per-band counters alone were
    rejected: the Window→PinnedWindow gap is 400, so a Window-band layer still
    crosses into the pinned band after 400 raises, and the Dropdown band still
    reaches 10003 and overtakes a 10002 literal. Deriving z densely from the
    stack position was rejected because it needs `bringToFront` to move the
    node's subtree to the end of `_stack`, and `_stack` order is what
    `resolveParent` falls back on — a rule
    [`tests/overlay/LayerManager.test.ts:364-392`](packages/lib/tests/overlay/LayerManager.test.ts#L364)
    pins deliberately ("falls back to the last-registered layer, not whichever
    peer currently paints in front"). Lazy renormalisation keeps `_stack`
    untouched, costs one O(band) pass per few hundred allocations, and bounds z
    by how many layers are open at once rather than by how many have ever been
    opened.

[^why-early-return]: The guard is not needed for the counter any more —
    renormalisation bounds it either way — but the redundant work is real.
    `AbstractWindow` raises on **any** `mousedown` anywhere in the window
    ([`overlay/AbstractWindow.ts:502`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L502)),
    so every click in the already-front window walks its layer subtree and
    reports a new stamp to the window and to any menu or dropdown open inside
    it. Probe P4 in
    [`11-overlay-popups-layers-animation.md`](plans/research/render-review-2026-09-15/11-overlay-popups-layers-animation.md)
    measured the sole-layer case: `z after register 10204, after 2 redundant
    raises 10206`. Without the guard, renormalisation would also run on a
    schedule set by how often the user clicks rather than by how many layers
    exist.

[^register-notifies]: Two ways to keep a window's first z-index write were
    considered. Having `AbstractWindow.show` call
    `this.setZIndex(LayerManager.getZIndex(this))` after registering is local
    and changes no contract, but it leaves the manager with two allocation
    paths that behave differently, and leaves every other surface reading the
    stamp back by hand — which is what `AnimatedDropdown` already does at show
    time. Reporting from `register` makes one rule: the manager reports a stamp
    exactly when it assigns one. The extra reports are harmless — every
    `onZIndexChanged` implementation in the library is a `setZIndex` call
    (`AbstractWindow:1042`, `AnimatedDropdown:298`, `Menu:1193`,
    `Drawer:739`), and `Component.setZIndex` returns early on an unchanged
    value.

[^cheap-variant]: The alternative was registering the toast as a `"manual"`
    layer so it draws a counter stamp and outranks live dropdowns rather than
    just the Dropdown band's base. It was rejected: `Notification` implements
    none of `DismissableLayer`, so registering it means a new
    `getLayerElement` / `getDismissMode` surface plus unregister discipline in
    `finishDismiss` and `destructor` — new machinery whose only benefit,
    outranking a high dropdown stamp, renormalisation already guarantees by
    holding the Dropdown band at 10499 or below. Multiple toasts do not need
    distinct stamps either; they stack by position and never overlap.

[^commit-shape]: The branch ships as: code (C30 + C31) → docs → code (C33) →
    docs → tooling (`packages/qa/src/panels/windows.ts`). C30 and C31 are one
    code commit because C31 alone is not durable — a band constant above an
    unbounded counter is the same defect one number higher — so it would not
    make sense on its own branch, which is the `commit` skill's split test. The
    QA panel is a private workspace package that is not shipped to consumers,
    so its change is tooling and stands alone.

[^static-owner]: A per-instance listener was rejected: `restack` is static and
    repositions the whole stack, so N toasts would install N listeners that
    each do the same work N times. The sentinel is a `private static readonly
    Component` rather than a module-level `const`, because the handler calls
    `Notification.restack()`, which is private and unreachable from a
    module-scope function. Constructing a `Component` at class-definition time
    is safe: `LayerManager` already constructs one at module scope, and
    `tests/unit/import-without-dom.test.ts` imports `./overlay` with the
    production seams and passes.

[^no-coalescing]: The slice report suggested coalescing through `rAF`. Every
    viewport `resize` handler in the library runs on the raw event —
    `Dialog:1218`, `AbstractWindow:3045`, `Popover`, `Drawer`, `Rail`,
    `Markdown` — and the only coalescer that exists, `PerFrameCoalescer`, is
    private to `AbstractWindow.ts:238`. `restack` reads the viewport once and
    writes two guarded setters per live toast, less than any of those handlers
    does. Coalescing would mean lifting a private helper into shared code for
    the cheapest handler in the set.

[^separate-resize-file]: The existing file's header scopes stacking,
    auto-dismiss and `restack` out together as "not assertable offline — needs
    a real-DOM harness". Only the last two parts of that still hold. The offline
    harness models `getViewportSize` from the config object the test itself
    passes in, dispatches a window-level event through `DOM.sink.dispatchEvent`,
    and lets a toast be reached through the static active stack — which the file
    already does. What it does not model is rAF (a recorded no-op) or a real
    timer wall-clock, which is what leaves the entrance animation and
    auto-dismiss out. The scope note is therefore narrowed, not deleted.

---

## Implementation Notes

**The `docs:api` bar is no *new* warnings, not zero.** *Verification* asks for
`npm run docs:api` to "finish with zero warnings". The repository's start point
(`54d9b6c3`) already emits 14, every one of them a `{@link}` from a public
symbol to an excluded internal in files this plan does not touch. The bar
applied was therefore that the count and the warning list both stay exactly
what they were: both do, 14 and identical line for line.

**The `onZIndexChanged` JSDoc was rewritten on the interface and on three of
its four implementors.** Step 6 names only `register`'s JSDoc, but the hook's
interface comment called itself an "optional re-stamp hook" called "when
`bringToFront` re-allocates the layer" — a description `register` reporting
its own stamp makes false. It now says the manager calls it with every z-index
it assigns, and names the four sources (register, a raise, `setBand`, a band
compaction). `AbstractWindow`, `Menu` and `AnimatedDropdown` each repeated the
old claim in their own override's JSDoc and say the same thing now;
`AbstractWindow`'s is the one that mattered most, since after step 6 the hook
is the *only* writer of a window's first z-index. `Drawer`'s ("when the drawer
is re-stamped") was already generic enough to stay true.

**Expected Behaviour row 16 gained one assertion.** As the plan words it, the
case asserts only that the listener count returns to its pre-toast value —
which was already true before the implementation existed, because nothing
installed a listener to return from. The case now also asserts the count rose
by one while the toast was live, so it fails for the right reason first and
still pins the removal afterwards.

**`packages/qa/README.md`'s `windows` row was updated too**, though step 18
names only the panel file. Two of that row's columns describe what the panel
*builds* and which geometry labels it offers, and both went stale the moment
the panel gained a pinned window, a toast and a `geometry.pinned` label; they
now match. Its *Reproduces* and *Validated* columns are deliberately left
alone: *The symptom rule* records a finding there only once a run has shown
its symptom, and no run was made — see below.

**`FALLBACK_BAND_HEADROOM`'s comment does not repeat the plan's wording.**
*Internal Structure* describes the fallback as the headroom for a base "above
every listed one, or between two of them", but `bandCeiling` returns the first
listed base greater than `band`, so a base *between* two listed ones is bounded
by the next listed base like any other and never reaches the fallback at all.
The comment and the JSDoc say what the code does instead.

**Three `LayerManager` cases were added beyond the Expected Behaviour rows.**
Rows 6-8 read `getZIndex` alone, which leaves two properties of the compaction
unpinned: that it renumbers a band in stacking order rather than registration
order (row 8 names this, but a 5,000-raise run ends with the raised layer on
top either way, so it cannot tell the two apart), and that it reports each
moved stamp through `onZIndexChanged` — the half without which a compaction
silently desynchronises every surface from the stamp it now holds. The third
is `bandCeiling`'s fallback: *Internal Structure* specifies it and it is
reachable from any `getBand()` above `Band.Tooltip`, but no row covers it, so
nothing would have run that branch. All three are now driven deterministically
— two layers, one raised over the other, a band spent down to its last stamp,
and a third layer's registration to trip the ceiling — and each was confirmed
to fail when the line it pins is removed.

**Nothing was run under `packages/qa`.** Every run opens a full-screen window
on the user's desktop, so neither the `windows, drive=click:1200` arm for C30
nor the `windows, seam=1` arm for C33 was started, and Expected Behaviour rows
17 and 18 (the two visual checks) are unverified. What *is* verified offline is
every other Expected Behaviour row, rows 1-16, by the tests named against them.
The library was built in the worktree (`npm run build:lib`) only so that
`packages/qa`'s own unit tests could resolve the package; they pass, 244 of
them, and no panel was mounted.
