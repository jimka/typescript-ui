# Dock Tear-Off Produces a TabWindow by Default — Implementation Plan

## Overview

Today, tearing a tab off a `Dock` region always produces a bare ordinary header `Window`: [`Dock.wireRegion`](../src/typescript/lib/core/Dock.ts#L559) forces every region's `Tab` into `"bare"` detach mode at [Dock.ts:575](../src/typescript/lib/core/Dock.ts#L575), so the dock's sweep can adopt the float into a re-dockable mini-dock region tree. A `TabPanel`, by contrast, leaves `Tab`'s default `"strip"` mode in place, so a no-Shift tear-off yields a self-contained `TabWindow` and a Shift tear-off yields a bare `Window` ([`Tab.detachTabToWindow`](../src/typescript/lib/layout/Tab.ts#L1729), `useStrip = !forceBare && this._detachWindowMode === "strip"` at [Tab.ts:1731](../src/typescript/lib/layout/Tab.ts#L1731)).

This change makes the `Dock` match the `TabPanel`: **no-Shift dock tear-off → `TabWindow`** (self-contained floating tabbed window), **Shift-held dock tear-off → bare `Window`** that the sweep adopts into a re-dockable, edge-splittable mini-dock (the current default, now gated behind Shift).

The shift/strip machinery in `Tab`/`TabBar` is already correct and is **not touched**. Two surgical edits in [`Dock.ts`](../src/typescript/lib/core/Dock.ts) do the whole job: stop forcing `"bare"` mode, and skip `TabWindow` floats in the sweep so it only adopts the Shift-torn bare `Window` floats.

---

## Architecture Decisions

### Drop the forced `"bare"` override — don't re-set `"strip"`

[`wireRegion`](../src/typescript/lib/core/Dock.ts#L559) calls `(manager as Tab).setDetachWindowMode("bare")` once per region (guarded by `tabWired`). `Tab`'s field already defaults to `"strip"` ([Tab.ts:292](../src/typescript/lib/layout/Tab.ts#L292)), so the line is **removed entirely** rather than changed to `setDetachWindowMode("strip")`. Re-setting the default would be redundant noise that misrepresents the dock as configuring something it isn't; deleting it lets the region keep the framework default, which is exactly the desired behaviour. The `tabWired` one-shot guard is unaffected (it still gates `setReorderable` and the `"empty"`/`"detached"` subscriptions).

### Skip `TabWindow` floats in `ownedFloatWindows`, not in `adoptFloat`

The sweep must now handle two float kinds:

- **bare `Window`** (Shift tear-off, or a restored mini-dock tree): adopt and wire exactly as today.
- **`TabWindow`** (default tear-off): self-contained — its interior *is* a `Tab` with `closeHostWindowWhenEmpty` true ([TabWindow.ts:84](../src/typescript/lib/core/TabWindow.ts#L84)), it is re-dockable via its own tab DnD, and it closes itself when emptied. The sweep must leave it completely alone.

If a `TabWindow` reached [`adoptFloat`](../src/typescript/lib/core/Dock.ts#L530), `windowContent(win)` would return the identity frame (a `TabWindow` reports every child as content — `isChromeComponent` returns `false` at [TabWindow.ts:299](../src/typescript/lib/core/TabWindow.ts#L299)). That frame is **not** a region container ([`isRegionContainer`](../src/typescript/lib/core/Dock.ts#L728) is true only for `Split`/`Tab` regions), so `adoptFloat` would wrap it in a fresh `Tab` region and `moveComponent` it **out of the `TabWindow`'s own internal strip** — emptying that strip, tripping its `closeHostWindowWhenEmpty` auto-close, and nesting a Tab inside the window's Tab (the "tabs in tabs" hazard the user explicitly wants avoided).

The fix is to **exclude `TabWindow` floats at the source**, in [`ownedFloatWindows`](../src/typescript/lib/core/Dock.ts#L476), so they never reach `adoptFloat`, `wireRegion`, or `teardownVanished`. Filtering here (rather than an early-return in `adoptFloat`) keeps `runSweep`'s `floatRegions` list containing only genuine, wired mini-dock regions — which is precisely what `teardownVanished` seeds its reachable set from. An early-return in `adoptFloat` returning `null` would also work for adoption, but would leave the intent ("these windows are not part of the dock's region tree") split across two methods; the single-source filter is cleaner and matches the method's existing documented contract ("the floats torn off from this dock" — a `TabWindow` is *not* a dock float, it is an independent tabbed window).

### Discriminate with `instanceof TabWindow`

`Dock` already imports `AbstractWindow`. Add a `TabWindow` import and test `win instanceof TabWindow`. This is the cleanest and most honest discriminator: a content-shape check cannot distinguish a `TabWindow` from a fresh bare `Window` — both hold a single non-region identity frame as content right after tear-off — so shape is ambiguous exactly where it matters. `Dock` uses `regionKind`/`isRegionContainer` string-class checks for *layout managers* to dodge an import cycle, but `TabWindow` is a concrete window class with no cycle back to `Dock`, so `instanceof` is appropriate and unambiguous here. (`Tab.detachTabToWindow` itself already imports and `new`s both `Window` and `TabWindow` directly — [Tab.ts:8-9](../src/typescript/lib/layout/Tab.ts#L8) — so this is consistent with how the codebase already treats these classes.)

### `teardownVanished` needs no change

A `TabWindow`'s internal `Tab` region is never passed to [`wireRegion`](../src/typescript/lib/core/Dock.ts#L559) (it is neither the in-dock root nor an adopted float region), so it never enters `_wiring`. [`teardownVanished`](../src/typescript/lib/core/Dock.ts#L685) only iterates `_wiring`, so it never touches a `TabWindow`'s coordinator (there isn't one). Excluding `TabWindow` floats from `floatRegions` therefore leaves `teardownVanished` correct: the reachable set is seeded from the in-dock root plus the bare-`Window` mini-dock regions, exactly as before — the only floats that ever had wiring.

### The `"detached"` → sweep wiring stays correct

Each wired Tab region still fires `"detached"` on the source strip after any tear-off, scheduling a sweep ([Dock.ts:580](../src/typescript/lib/core/Dock.ts#L580)). For a default (`TabWindow`) tear-off that sweep is now a **no-op for the float** (filtered out) but still correctly prunes/adopts the source side: `pruneRegion` ([Dock.ts:603](../src/typescript/lib/core/Dock.ts#L603)) removes an emptied source region, and any Shift-torn bare floats are still adopted in the same sweep. The Shift-torn bare-`Window` path is thus preserved **byte-for-byte** in behaviour.

### Re-dock works unchanged

A `TabWindow`'s tabs are reorderable/draggable and register in `tabDragRegistry` like any tab. Dragging one onto a dock region hits [`DockRegion`'s `onDrop`](../src/typescript/lib/layout/DockRegion.ts#L96), which resolves the dragged content via `tabDragRegistry.get(componentId)` and `dockAsTab`/`splitOnEdge`-moves the identity frame into the dock. The frame leaving empties the `TabWindow`'s strip, whose `closeHostWindowWhenEmpty` closes the now-empty float. No `Dock` code is needed for re-dock; it already works for the existing `TabPanel`→`TabWindow`→re-dock flow. This is confirmed in scope as already-working, not new work.

---

## Implementation

The two edits, both in [`Dock.ts`](../src/typescript/lib/core/Dock.ts):

**1. Add the import** (alongside the existing `AbstractWindow` import near [Dock.ts:5](../src/typescript/lib/core/Dock.ts#L5)):

```ts
import { TabWindow } from "~/core/TabWindow.js";
```

**2. Filter `TabWindow` floats out of `ownedFloatWindows`** — add a clause to the existing predicate:

```ts
private ownedFloatWindows(): AbstractWindow[] {
    const frames = [...this._frames.values()];

    return AbstractWindow.getOpenWindows().filter(win =>
        !(win instanceof TabWindow) &&
        !this.windowContains(win, this) &&
        frames.some(frame => this.windowContains(win, frame)));
}
```

A `TabWindow` is a self-contained tabbed window, re-dockable via its own tab DnD; it is never an adoptable dock float, so the sweep ignores it. (Update the method's JSDoc to state this exclusion.)

**3. Remove the forced `"bare"` override** in `wireRegion` ([Dock.ts:572-575](../src/typescript/lib/core/Dock.ts#L572)) — delete the `setDetachWindowMode("bare")` call and its three-line comment, leaving the region on `Tab`'s default `"strip"` mode so a no-Shift tear-off produces a `TabWindow` and a Shift tear-off a bare adoptable `Window`. The surrounding `setReorderable`/`on("empty")`/`on("detached")` lines and the `tabWired = true` latch stay.

---

## Ordered Implementation Steps

1. **Add the `TabWindow` import** to [`Dock.ts`](../src/typescript/lib/core/Dock.ts) → verify: `grep -n 'import { TabWindow }' src/typescript/lib/core/Dock.ts` returns one line.
2. **Add the `!(win instanceof TabWindow)` clause** to `ownedFloatWindows` and update its JSDoc → verify: typecheck clean.
3. **Delete `setDetachWindowMode("bare")`** and its comment from `wireRegion` → verify: `grep -n 'setDetachWindowMode' src/typescript/lib/core/Dock.ts` returns zero matches.
4. **Typecheck** → `npm run typecheck` (0 errors).
5. **Manual smoke test** per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`src/typescript/lib/core/Dock.ts`](../src/typescript/lib/core/Dock.ts) — import `TabWindow`; filter `TabWindow` floats in `ownedFloatWindows`; drop the `"bare"` override in `wireRegion`. |

---

## Verification

**Typecheck:** `npm run typecheck` — 0 errors.

**Grep invariants:**
- `grep -n 'setDetachWindowMode' src/typescript/lib/core/Dock.ts` — expect zero matches (the only call site is removed).
- `grep -n 'instanceof TabWindow' src/typescript/lib/core/Dock.ts` — expect one match (the new sweep filter).

**Demo screen:** the **Dock demo** in [`MiscPanel.ts`](../src/typescript/MiscPanel.ts#L646) — click the **"Dockable layout (Dock)"** button to open the dock window (a horizontal split: Explorer/Search tab group, Editor, VBox). Run via `npm run dev` (app on http://localhost:8015). Scope DevTools queries to `.MiscPanel .Dock` to avoid measuring an unrelated component.

**Manual smoke test:**

1. **No-Shift tear-off → `TabWindow`.** Drag the "Explorer" tab out of the dock and release. Expect a headerless `TabWindow` (tab strip as its chrome, no title-bar header), holding the panel as its single tab — identical to tearing a tab off a `TabPanel`. It is **not** edge-splittable as a mini-dock (no `DockRegion` overlay on its body); it is a self-contained tabbed window.
2. **Shift tear-off → bare adoptable `Window`.** Hold **Shift** and drag "Search" out. Expect an ordinary header `Window` that **is** a mini-dock: hovering another dragged dock tab over its body shows the edge/centre `DockRegion` overlay, and dropping on an edge splits it. This is the pre-change default, now Shift-gated, and must behave exactly as it did before.
3. **Re-dock (both float kinds).** Drag the `TabWindow`'s tab back onto a dock region (centre → adds as a tab; edge → splits). Expect the frame to re-home into the dock and the emptied `TabWindow` to auto-close. Repeat dragging a tab out of the Shift-torn bare mini-dock back into the main dock — it should re-dock and, when emptied, the bare float closes via `closeFloatIfEmpty`/`closeHostWindowWhenEmpty`.
4. **No "tabs in tabs".** After a no-Shift tear-off, confirm the `TabWindow`'s interior is a single flat `Tab` (no nested Tab region created by the sweep) — i.e. its strip retains its tab and the window does not auto-close on the next animation frame.
5. **Save/Restore.** With one Shift-torn bare mini-dock float open, click **Save layout**, rearrange, then **Restore layout** — the bare mini-dock tree round-trips as before. (A default `TabWindow` float is a standalone window outside the dock's region tree and is not expected to be captured by the dock's serialization, matching `TabPanel` semantics — out of scope to change.)

---

## Potential Challenges

- **A `TabWindow` float emptied by re-dock must close cleanly, not via the dock sweep.** Closure is owned by the `TabWindow`'s own `closeHostWindowWhenEmpty` ([TabWindow.ts:84](../src/typescript/lib/core/TabWindow.ts#L84)); the sweep never sees it. Mitigation: smoke test step 3 confirms the `TabWindow` auto-closes on re-dock.
- **Restored bare mini-dock floats must still be adopted.** A restored float's content is already a region container (`isRegionContainer` true), so `adoptFloat` returns it unchanged and the `!(win instanceof TabWindow)` filter passes it through (a restored mini-dock is a plain `Window`, not a `TabWindow`). Mitigation: smoke test step 5.

---

## Critical Files

- [`src/typescript/lib/core/Dock.ts`](../src/typescript/lib/core/Dock.ts) — the only file changed; read `runSweep`, `ownedFloatWindows`, `adoptFloat`, `wireRegion`, `teardownVanished`.
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `detachTabToWindow` (`useStrip` decision, [Tab.ts:1729](../src/typescript/lib/layout/Tab.ts#L1729)), `_detachWindowMode` default (`"strip"`, [Tab.ts:292](../src/typescript/lib/layout/Tab.ts#L292)), `setDetachWindowMode` ([Tab.ts:711](../src/typescript/lib/layout/Tab.ts#L711)). Read-only — confirms the strip/shift machinery is already correct.
- [`src/typescript/lib/core/TabWindow.ts`](../src/typescript/lib/core/TabWindow.ts) — confirms a `TabWindow`'s interior is a self-closing `Tab` and `isChromeComponent` returns `false`.
- [`src/typescript/lib/layout/DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts) — `onDrop` re-dock path ([DockRegion.ts:96](../src/typescript/lib/layout/DockRegion.ts#L96)); read-only confirmation that re-dock needs no change.
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts#L646) — the Dock demo screen used for verification.

---

## Non-Goals

- **No changes to `Tab`/`TabBar`/`TabWindow`/`Window`.** The shift/strip/`forceBare` machinery is already correct; this plan only changes which mode the `Dock` leaves its regions in and how its sweep treats the two float kinds.
- **No serialization change** to capture default `TabWindow` floats in `getLayoutState` — they are standalone tabbed windows outside the dock's region tree, matching `TabPanel` semantics. The user asked only to change the tear-off window *type*.
- **No new public API or options.** No new `DockOptions` field; the behaviour is the framework default, not a configurable toggle.
- **No broad dock redesign.** Strictly the tear-off window type and the sweep's two-float-kind handling.
