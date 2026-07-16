# Overlay Edge Flip — Implementation Plan

## Overview

Three user-reported placement bugs share one root cause: **an anchored overlay that cannot be placed as intended is slid (clamped) into the viewport instead of being re-placed against the anchor's opposite edge.** A slid overlay lands on top of the thing it was anchored to — the trigger, or the cursor.

- **Report 1 (horizontal):** a rect-anchored menu aligns its left edge to the trigger's left; when that overflows, [`Menu.ts:63`](src/typescript/lib/overlay/Menu.ts#L63) pushes it left rather than re-aligning its **right** edge to the trigger's **right**.
- **Report 2:** tooltips can open under the cursor — [`Tooltip.ts:227`](src/typescript/lib/overlay/Tooltip.ts#L227) offsets by `CURSOR_OFFSET` then clamps on both axes; near an edge the clamp drags the tooltip back over the cursor.
- **Report 3:** context menus can open under the cursor — the `kind: "pointer"` branch of [`Menu.ts:53`](src/typescript/lib/overlay/Menu.ts#L53) clamps on both axes.

The fix adds **one** new primitive to [`core/OverlayPosition.ts`](src/typescript/lib/core/OverlayPosition.ts) (`positionAligned` — fixed-size *alignment* flip), promotes the existing private `flipAxis` to a module export renamed `positionAdjacent` (fixed-size *adjacency* flip), routes every clamping call site through the flip primitives, and **deletes `clampIntoViewport`**, which is orphaned by the change.

A fourth, unreported instance of the same defect is fixed: [`positionAnchored`](src/typescript/lib/core/OverlayPosition.ts#L159)'s cross axis (used by [`AnimatedDropdown.placeAnchored`](src/typescript/lib/core/AnimatedDropdown.ts#L361)).

---

## Architecture Decisions

### Report 1's vertical half **already works** — do not "fix" it

Verified against the shipped code. Report 1 asks: *"if the menu's top edge is unable to sit flush with the rect's bottom edge, place the menu so that the menu's bottom edge sits flush with the rect's top edge."* That is exactly the flip branch of [`positionFlexibleAnchored`](src/typescript/lib/core/OverlayPosition.ts#L126):

```
return { start: nearEdge - Math.min(extent, roomNear), available: roomNear };
```

With `extent <= roomNear`, `start + extent === nearEdge === rect.top` — the menu's bottom is flush with the trigger's top. `Menu.ts:58` already calls it for the rect-anchored path, and `tests/overlay/Menu.test.ts:601` already asserts `menu.getY() + menu.getHeight() === 772` for a trigger flush at the viewport bottom. **The vertical complaint is satisfied; only report 1's horizontal half is a real bug.** No vertical work is in scope for `toggleFor`.

### There are two distinct flip geometries, and they are not the same operation

This is the load-bearing insight; the primitive set follows from it.

- **ADJACENCY flip.** The element's near edge meets the anchor's **far** edge (a dropdown below its button). Flipped, the element's far edge meets the anchor's **near** edge. The two anchor edges *differ*; the element never overlaps the anchor. This is `flipAxis` (fixed-size) and `positionFlexibleAnchored` (size-flexible).
- **ALIGNMENT flip.** The element's left edge **aligns with** the anchor's left edge — it *overlaps* the anchor (a dropdown's cross axis). Flipped, the element's right edge aligns with the anchor's right edge. **No such primitive exists.** This is report 1's real content.

Alignment is **fixed-size**, never size-flexible: a menu has a natural width and does not scroll horizontally, so unlike `positionFlexibleAnchored` it returns a coordinate with no `available`.

### The two geometries **collapse** for a zero-size anchor — which is why report 3 needs no new concept

Verified algebraically against the shipped bodies. Set `nearEdge === farEdge === p` (a cursor is a degenerate zero-size rect):

| Primitive | Unflipped | Flipped |
| --- | --- | --- |
| `flipAxis` (adjacency, `gap = 0`) | `farEdge + 0 = p` | `nearEdge - extent - 0 = p - extent` |
| `positionFlexibleAnchored` (adjacency) | `farEdge = p` | `nearEdge - min(extent, roomNear) = p - min(…)` |
| `positionAligned` (alignment, new) | `nearEdge = p` | `farEdge - extent = p - extent` |

All three agree: **grow down-right from the point; otherwise end at the point.** That is native context-menu behaviour. So report 3 is fixed by routing the pointer branch through the *same* flip primitives with a zero-size rect — no pointer-specific geometry.

### The `MenuAnchor` union collapses entirely — there is ONE placement path

Because of the collapse above, `resolvePlacement` needs no `kind` discriminant. `MenuAnchor`, `{kind:"pointer"}`, and `{kind:"rect"}` are **deleted**; `showAnchored` takes a plain `Rect`, and `show(x, y, …)` builds a zero-size `Rect` at the cursor. One body serves both:

- **vertical** → `positionFlexibleAnchored` (the menu caps its height and scrolls — size-flexible),
- **horizontal** → `positionAligned` (the menu has a natural width and does not scroll — fixed-size).

This is the stronger simplification and it deletes compensation rather than adding more. It is chosen deliberately over constructing the degenerate rect only at the call site while keeping the union.

### This **supersedes** a Non-Goal of the shipped `menu-anchored-placement` plan — recorded, not silently diverged

`plans/implemented/menu-anchored-placement.md` deliberately listed *"Changing pointer-anchored `show(x, y, …)` semantics — right-click context menus stay cursor-anchored and clamp-not-flip"* as a Non-Goal, and its Architecture Decisions state `show()` is *"unchanged in signature and behaviour"*.

**Report 3 contradicts that, and report 3 wins.** New evidence from driving the real app: clamp-not-flip is precisely what puts a context menu under the cursor. `show()`'s **signature** is still unchanged; its **placement behaviour** changes from clamp to flip. Do **not** edit the shipped plan — this section is the record of the reversal.

The shipped plan's *other* `show()` Non-Goal — that **`show(x, y, [])` still mounts an empty panel** — is **preserved**. That asymmetry lives in `toggleFor`'s empty-list suppression, which is independent of placement. Its regression test (`tests/overlay/Menu.test.ts:708`) must stay green untouched.

### `available` must come from the primitive, never be re-derived — the flipped-pointer case

`resolvePlacement` returns `available` for the caller's height cap and scrollbar gutter. The pointer branch currently derives it as `vp.height - p.y - VIEWPORT_MARGIN` **from the already-clamped `p.y`**, which measures the wrong side. The canonical break:

> A 60-item context menu right-clicked at `y = 790` in an 800px viewport. `positionFlexibleAnchored(790, 790, ~1200, 800, 4)` → `roomFar = 6`, `roomNear = 786` → flips: `start = 790 - min(1200, 786) = 4`, `available = 786`. The menu spans `[4, 790]`, capped at 786, bottom exactly at the cursor.
>
> Re-deriving from `start` would give `800 - 4 - 4 = 792 > 786`, rendering the menu 792 tall spanning `[4, 796]` — **back under the cursor.** This is the trap; `positionFlexibleAnchored` returns `available` precisely to close it.

`positionAligned` returns no `available`: the horizontal axis is fixed-size and caps nothing.

### The tooltip is fixed-size on **both** axes — it uses `positionAdjacent`, not `positionFlexibleAnchored`

`Tooltip.ts:220-221` sets an explicit `setWidth`/`setHeight` before placing; the height is derived from the resolved line count and is never capped or scrolled. It is fixed-size on both axes → the fixed-size primitive, with **no `available`**.

**It needs ADJACENCY, not alignment.** A tooltip must sit *beside* the cursor, not overlap it. And it needs no rect inflation: `flipAxis` **already has a `gap` parameter**, and `gap` *is* `CURSOR_OFFSET`:

```
positionAdjacent(x, x, w, vp.width, CURSOR_OFFSET)
  unflipped → farEdge + gap        = x + 14      // today's `x + Tooltip.CURSOR_OFFSET`
  flipped   → nearEdge - w - gap   = x - w - 14  // right edge 14px left of the cursor
```

**The unflipped case is bit-identical to today**, not shifted by a pixel: today is `clampAxis(x + 14, w, vp.width, 0)`, and `clampAxis` is the identity exactly when `x + 14 + w <= vp.width` — the same condition as `flipAxis`'s far branch. Modelling the anchor as an inflated square rect and using `positionAligned` would be **wrong** (it would place the tooltip's left edge at `x - 14`, i.e. *under* the cursor). Use the `gap`; do not inflate.

### The cursor point is clamped into the viewport at the two cursor entry points

`positionAdjacent` and `positionFlexibleAnchored` guarantee an on-screen result **only when the anchor's edges lie inside `[0, viewportExtent]`** (proof for `flipAxis`: the far branch returns `x + gap` under the condition `extent <= vpExtent - x - gap`; the near branch returns `x - extent - gap >= 0` under `extent <= x - gap`; the fits-neither branch returns `max(0, vpExtent - extent)` or `0`). `clampIntoViewport` provided that guarantee for free today, and `Tooltip`'s existing tests pin it (`tests/overlay/Tooltip.test.ts:154`).

So `Menu.show` and `Tooltip.show` — both public and both taking raw coordinates — clamp the incoming point into the viewport before building the anchor. This preserves existing defensive behaviour rather than adding speculative handling. **Do not clamp in `showAnchored`**: a real trigger rect may legitimately extend past the viewport (see `tests/overlay/Menu.test.ts:665`, whose rect has `right: 1290` in a 1280px viewport), and clamping it would corrupt the far-align.

### `clampIntoViewport` is **deleted**

After this change it has **zero** consumers (verified exhaustively: its only three call sites are `Menu.ts:53`, `Menu.ts:63`, `Tooltip.ts:227`, and all three move). Nothing legitimately clamps-without-flipping against an anchor any more — anchor-relative clamping *is* the defect. It is orphaned by our own change, so CLAUDE.md §3 ("Remove functions that YOUR changes made unused") applies: delete it, and its `describe('clampIntoViewport')` block at `tests/overlay/OverlayPosition.test.ts:133`.

The private `clampAxis` **stays** — it remains the terminal fallback inside `positionAligned` (fits-neither) and `positionAnchored`. Clamping is still the right answer when *no* placement fits; it is only wrong as a *substitute* for a flip.

### `positionAnchored` **does** adopt the cross-axis alignment flip — on evidence

Its cross axis uses `clampAxis(anchorRect.left, …)`: literally report 1's defect. Its only consumer is `AnimatedDropdown.placeAnchored` (`AnimatedDropdown.ts:361`). Evidence gathered on whether the flip can ever fire there:

| Subclass | Width | Flip observable? |
| --- | --- | --- |
| `AutoCompleteDropdown.ts:145` | `setWidth(rect.width)` | No — left-align ≡ right-align |
| `ComboBox.ts:242` | computed `dropdownW`, may exceed the anchor | **Yes** |
| `TimePickerDropdown.ts:105` | fixed `PANEL_WIDTH` | **Yes** |
| `AbstractCalendarDropdown.ts:647` | fixed `getPanelWidth()` | **Yes** |

Three of four can differ from the anchor width, so a date/time picker near the right viewport edge is pushed left today instead of right-aligning to its input. **Include it.** It is a one-line change using a primitive we are adding anyway, and leaving it would give the library two contradictory cross-axis policies for the same concept (a dropdown under a trigger): `Menu` flips, `AnimatedDropdown` clamps. That inconsistency costs more than the surgical-change budget it spends. `positionAnchored`'s signature and its `margin` parameter are unchanged.

Only **one** existing assertion changes (`tests/overlay/OverlayPosition.test.ts:78`, `842 → 840`), and the new value is the feature: the panel's right edge lands flush with the anchor's right (990) instead of 2px past it at the margin bound (992). Verified: the two `positionAnchored — placeAnchored regression` legacy-parity tests (lines 172-215) still pass — their anchors sit far from the right edge, so near-align wins in both.

### `Popover` is **not** an instance of this defect — leave it alone

`Popover.ts:672` clamps its position, but its cross axis is **centre-aligned with an arrow that tracks the clamp** (`Popover.ts:849`). A centred, arrow-bearing popover *should* slide rather than flip, because the arrow re-points at the anchor and the compensation is visible and correct. Different geometry; correctly excluded. `Dialog`, `AbstractWindow`, `Notification`, and `DialogBackdrop` place relative to the **viewport**, not an anchor, so the defect cannot arise. This audit is exhaustive.

### Naming: `flipAxis` → `positionAdjacent`

`flipAxis` is being promoted from module-private to module-exported (Tooltip needs it), which is the right moment to give it a name that sits beside its siblings. The resulting set names the two geometries directly:

| Symbol | Geometry | Size | Returns |
| --- | --- | --- | --- |
| `positionAdjacent` (renamed `flipAxis`) | adjacency | fixed | `number` |
| `positionAligned` (**new**) | alignment | fixed | `number` |
| `positionFlexibleAnchored` (unchanged) | adjacency | flexible | `FlexiblePlacement` |
| `positionAnchored` (composite) | adjacency (primary) + alignment (cross) | fixed | `{x, y}` |

`positionFlexibleAnchored` keeps its shipped name despite being "flexible adjacency" — it merged days ago (`8c71717d`) and renaming it is churn for no reader benefit.

### `OverlayPosition` is not on the public API surface — a finding that shrinks Documentation Impact

Verified: `src/typescript/lib/core/index.ts` does **not** re-export `OverlayPosition`, `package.json`'s `exports` map only exposes barrel subpaths (`./core` → `dist/lib/core.es.js` = `core/index.ts`), `typedoc.json`'s entry points are the barrels, and `docs/api/core/functions/` **does not exist**. So `positionAnchored`, `clampIntoViewport`, and `positionFlexibleAnchored` are **library-internal despite the `export` keyword and their `@category Core` tags** — unreachable by a consumer, absent from `docs/`, `llms.txt`, and sqladmin.

Consequences the implementer must not get wrong:
- Deleting `clampIntoViewport` breaks **no** consumer and **no** doc page. It is not a public API removal.
- No new doc page, sidebar entry, `docs/components/index.md` row, or `llms.txt` regeneration is needed for `positionAligned`.
- Tag the new/renamed symbols `@category Core` for consistency with their siblings, but know the tag renders nowhere.
- **Do not "fix" the barrel gap by exporting `OverlayPosition` from `core/index.ts`.** That would publish four functions as documented public API — a separate, deliberate decision. See *Non-Goals*.

The real documentation impact is the **behavioural** prose for `Menu` and the demo, which is public. See *Documentation Impact*.

---

## Public API

```typescript
// src/typescript/lib/core/OverlayPosition.ts — NEW export

/**
 * Chooses a top-left coordinate on the cross axis for a **fixed-size** element
 * that ALIGNS WITH (and overlaps) its anchor rather than sitting beside it.
 * ...
 *
 * @category Core
 */
export function positionAligned(
    nearEdge:       number,
    farEdge:        number,
    extent:         number,
    viewportExtent: number,
    margin:         number,
): number;
```

```typescript
// src/typescript/lib/core/OverlayPosition.ts — RENAMED + promoted to a module export
// (was the module-private `flipAxis`; signature and body unchanged)

export function positionAdjacent(
    nearEdge:       number,
    farEdge:        number,
    extent:         number,
    viewportExtent: number,
    gap:            number,
): number;
```

```typescript
// src/typescript/lib/core/OverlayPosition.ts — DELETED (zero consumers after this change)
// export function clampIntoViewport(...): { x: number; y: number };
```

```typescript
// UNCHANGED signatures — behaviour changes only:
//   Menu.show(x, y, configs, onClose?, excludeEl?)   flips instead of clamping (report 3)
//   Tooltip.show(text, x, y)                          flips instead of clamping (report 2)
//   positionAnchored(anchorRect, size, viewport, opts) cross axis aligns-and-flips
```

`Menu.toggleFor`'s signature is unchanged.

---

## Internal Structure

### `positionAligned` (new, `core/OverlayPosition.ts`)

Place it directly after `positionAdjacent` (the renamed `flipAxis`) and before `clampAxis`.

```typescript
export function positionAligned(
    nearEdge: number, farEdge: number, extent: number, viewportExtent: number, margin: number,
): number {
    // Preferred: the element's near edge aligns with the anchor's near edge.
    if (nearEdge >= margin && nearEdge + extent <= viewportExtent - margin) {
        return nearEdge;
    }

    // Flipped: the element's FAR edge aligns with the anchor's far edge. Note this
    // is alignment, not adjacency — the element overlaps the anchor either way; only
    // which pair of edges is made flush changes.
    const farStart = farEdge - extent;

    if (farStart >= margin && farStart + extent <= viewportExtent - margin) {
        return farStart;
    }

    // Neither alignment fits on-screen (an anchor whose own far edge is off-viewport,
    // or an element wider than the viewport): fall back to the clamp. Clamping is the
    // right answer when NO placement fits — it is only wrong as a substitute for a flip.
    return clampAxis(nearEdge, extent, viewportExtent, margin);
}
```

The `nearEdge >= margin` guard on the first branch is load-bearing: without it, an anchor at `left = 0` would place the element flush at 0, 4px tighter than today's clamp. With it, the near-align is rejected, the far-align fails, and `clampAxis` returns `margin` — matching today exactly.

The doc comment must state: this is **alignment**, not adjacency (the element overlaps the anchor); it is **fixed-size** and returns no `available` (contrast `positionFlexibleAnchored`); `margin` binds on **this** axis; and the `clampAxis` fallback is the no-placement-fits case, not a flip substitute.

### `positionAdjacent` — mechanical rename of `flipAxis`

Add `export`, rename `flipAxis` → `positionAdjacent`, add `@category Core`. Update its two call sites inside `positionAnchored` (lines 164, 170) and the `{@link flipAxis}` reference in `positionFlexibleAnchored`'s doc comment (line 104) → `{@link positionAdjacent}`. **Body unchanged** — its existing tests, including the legacy-parity regressions, must pass untouched.

### `positionAnchored` — cross axis adopts the alignment flip

Two lines change:

```typescript
if (opts.axis === "vertical") {
    const y = positionAdjacent(anchorRect.top, anchorRect.bottom, size.height, viewport.height, gap);
    const x = positionAligned(anchorRect.left, anchorRect.right, size.width, viewport.width, margin);   // was clampAxis(anchorRect.left, …)

    return { x, y };
}

const x = positionAdjacent(anchorRect.left, anchorRect.right, size.width, viewport.width, gap);
const y = positionAligned(anchorRect.top, anchorRect.bottom, size.height, viewport.height, margin);     // was clampAxis(anchorRect.top, …)

return { x, y };
```

Update its doc comment (line 148): *"on the cross axis it aligns to the anchor's near edge and clamps into the viewport"* → *"on the cross axis it aligns to the anchor's near edge, flipping to align with the anchor's far edge when the near alignment overflows, and clamping only when neither alignment fits."*

### `Menu` — the anchor union collapses

Delete `MenuAnchor` (`Menu.ts:34-36`). `MenuPlacement` stays. Add the degenerate-rect helper and rewrite `resolvePlacement` to a single body:

```typescript
/**
 * A zero-size rect at a cursor point. A cursor is a degenerate anchor: with
 * `left === right` and `top === bottom`, the adjacency and alignment flips
 * collapse to the same operation — grow down-right from the point, or end at it.
 * That is native context-menu behaviour, so a pointer needs no separate path.
 */
function pointRect(x: number, y: number): Rect {
    return { x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
}

/**
 * Resolves a rebuild-mode panel's placement against `anchorRect` at `size`.
 * Vertically the panel is size-flexible (it caps its height and scrolls), so it
 * grows below the anchor and flips to end at the anchor's top when the room below
 * is short. Horizontally it is fixed-size (a natural width, no horizontal scroll),
 * so its left edge aligns with the anchor's left and flips to align its right edge
 * with the anchor's right when the left alignment overflows.
 *
 * @param anchorRect - The trigger rect, or a zero-size rect at the cursor.
 * @param size - The panel's current width/height to place.
 * @param vp - The viewport size to flip/clamp within.
 * @returns The resolved top-left coordinate and the vertical room available there.
 */
function resolvePlacement(anchorRect: Rect, size: Size, vp: Size): MenuPlacement {
    const v = positionFlexibleAnchored(anchorRect.top, anchorRect.bottom, size.height, vp.height, VIEWPORT_MARGIN);
    const x = positionAligned(anchorRect.left, anchorRect.right, size.width, vp.width, VIEWPORT_MARGIN);

    // `available` is the room on the side the panel actually landed on — never
    // re-derive it from `v.start`, which measures the wrong side for a flipped panel
    // and lets an over-tall menu grow back across the cursor.
    return { x, y: v.start, available: v.available };
}
```

`Menu.ts:7` drops `clampIntoViewport` from its import and adds `positionAligned`.

### `Menu.show` — build the degenerate anchor

```typescript
show(x: number, y: number, configs: MenuItemConfig[], onClose?: () => void, excludeEl?: Handle | null): this {
    this.assertRebuildMode("show");

    // The placement primitives only guarantee an on-screen result for an anchor
    // inside the viewport. A cursor from a real event always is; show() is public,
    // so pin it here rather than in showAnchored, which also takes real trigger
    // rects that may legitimately extend past a viewport edge.
    const vp = DOM.source.getViewportSize();

    return this.showAnchored(
        pointRect(Util.clamp(x, 0, vp.width), Util.clamp(y, 0, vp.height)),
        configs, onClose ?? null, excludeEl ?? null,
    );
}
```

Add `Util` to `Menu.ts`'s imports (`~/core/Util.js`). `showAnchored`'s parameter becomes `anchorRect: Rect`; **its body is otherwise untouched** — both `resolvePlacement` calls (the natural-width first pass for `available`, and the second pass after the gutter widening) keep their existing shape and comments. The first-pass comment ("Width does not affect the vertical placement") remains true: vertical goes through `positionFlexibleAnchored`, which reads only `size.height`.

`toggleFor` forwards `anchorRect` directly instead of `{ kind: "rect", rect: anchorRect }`. Its empty-list suppression and branch order are **unchanged** — do not touch them.

### `Tooltip.show` — flip on both axes

Replace `Tooltip.ts:225-235`:

```typescript
// Clamp the cursor into the viewport first: the flip primitive only guarantees an
// on-screen result for an in-viewport anchor, and show() is public.
const cx = Util.clamp(x, 0, vp.width);
const cy = Util.clamp(y, 0, vp.height);

// Sit CURSOR_OFFSET past the cursor, flipping to sit CURSOR_OFFSET *before* it when
// there is no room past — so the tooltip can never land under the cursor. The offset
// is the primitive's `gap`; no viewport margin, since the tooltip may sit flush
// against an edge.
inst.setX(positionAdjacent(cx, cx, tooltipWidth,  vp.width,  Tooltip.CURSOR_OFFSET));
inst.setY(positionAdjacent(cy, cy, tooltipHeight, vp.height, Tooltip.CURSOR_OFFSET));
```

`Tooltip.ts:7` swaps `clampIntoViewport` for `positionAdjacent`. `Util` is already imported (`Tooltip.ts` uses `Util.measureTextWidth`).

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/OverlayPosition.ts`** — rename `flipAxis` → `positionAdjacent`, add `export` and `@category Core`. Update its two call sites in `positionAnchored` (lines 164, 170) and the `{@link flipAxis}` in `positionFlexibleAnchored`'s doc (line 104). **Body unchanged.** → `npm run typecheck`.
2. **`OverlayPosition.ts`** — add `positionAligned` per *Internal Structure*, after `positionAdjacent`, with full JSDoc. Do not touch `positionFlexibleAnchored` or `clampAxis`.
3. **`tests/overlay/OverlayPosition.test.ts`** — add `describe('positionAligned')` per *Expected Behaviour* §1, following the file's `rect()` / `size()` idiom. → `npx vitest run tests/overlay/OverlayPosition.test.ts`.
4. **`OverlayPosition.ts`** — swap `positionAnchored`'s two cross-axis `clampAxis` calls for `positionAligned` and update its doc comment per *Internal Structure*.
5. **`tests/overlay/OverlayPosition.test.ts:78`** — update the sole affected assertion: `expect(p.x).toBe(842)` → `toBe(840)`, and rewrite its comment to name the flip (*"x right-aligns to the anchor's right edge (990 − 150 = 840), rather than being pushed to the margin bound at 842"*). Rename the test from `'clamps the cross axis into [margin, viewport - size - margin]'` to `'right-aligns the cross axis to the anchor when the near alignment overflows'`. → the two `placeAnchored regression` tests (172-215) and the other three cross-axis tests (111, 124, 86) must pass **untouched** — verified they do.
6. **`src/typescript/lib/overlay/Menu.ts`** — delete the `MenuAnchor` type (34-36); add `pointRect`; rewrite `resolvePlacement` to the single body in *Internal Structure*. Update the import at line 7: drop `clampIntoViewport`, add `positionAligned`; add `import { Util } from "~/core/Util.js";`.
7. **`Menu.ts`** — change `showAnchored`'s first parameter to `anchorRect: Rect` and update its JSDoc (drop the "clamped for a pointer, flip-aware for a rect" split — there is one path now). Rewrite `show` per *Internal Structure*. Update `toggleFor`'s forward to pass `anchorRect` directly; **do not touch its branch order or empty-list check**.
8. **`Menu.ts`** — update `show`'s JSDoc: *"The menu is clamped to the visible viewport so it never overflows any edge"* → *"The menu grows down-right from the cursor; when there is no room it flips so its bottom / right edge ends at the cursor, never covering it. A menu taller than the room on the side it lands on is capped there and scrolls."* Update `toggleFor`'s JSDoc prose that reads *"Plain `show` … clamp (never flip)"* — both paths flip now; the remaining distinction is the toggle identity, the opener exclusion, and the empty-list suppression.
9. **Checkpoint:** `grep -rn 'MenuAnchor\|kind: "pointer"\|kind: "rect"' src/` — **expect zero matches**.
10. **`src/typescript/lib/overlay/Tooltip.ts`** — replace the placement block per *Internal Structure*; swap the line-7 import.
11. **`OverlayPosition.ts`** — **delete `clampIntoViewport`** and its doc comment. → `grep -rn 'clampIntoViewport' src/ tests/ docs/` — **expect zero matches** after step 12.
12. **`tests/overlay/OverlayPosition.test.ts`** — delete the `describe('clampIntoViewport')` block (line 133) and drop `clampIntoViewport` from the line-2 import. Its two surviving concerns are covered elsewhere: the pin-to-margin case by `positionAligned` §1 case 5, and the general clamp by `positionAnchored`'s cross-axis tests.
13. **Checkpoint:** `npm run typecheck && npm run typecheck:test`.
14. **`tests/overlay/Menu.test.ts:217`** — update `'pins a viewport-overflowing menu at the margin and caps its height to scroll'` per *Expected Behaviour* §3: `expect(menu.getY()).toBe(VIEWPORT_MARGIN)` → `toBe(100)`, add `expect(menu.getMaxSize()!.height).toBe(696)`, and rename it to `'grows a viewport-overflowing menu down from the cursor and caps its height to scroll'`. Rewrite its comment: the top no longer pins at the margin — it stays at the cursor and the room *below the cursor* is the cap.
14a. **Drift found during implementation, not in the original plan:** `describe('Menu show(x, y, …) — pointer-anchored regression', …)` (added by the already-shipped `menu-anchored-placement` plan, commit `896565de`, which the plan author did not have visibility into) contains a second copy of the exact same `show(100, 100, [60 items])` scenario analyzed above, titled `'a long menu still pins to the margin and caps its height (unchanged from before the flip path)'`. It asserts the same now-superseded clamp behavior (`getY() === VIEWPORT_MARGIN`) and must be updated identically: `toBe(VIEWPORT_MARGIN)` → `toBe(100)`, add `expect(menu.getMaxSize()!.height).toBe(696)`, rename to drop the now-false "unchanged from before the flip path" claim. Its sibling test in the same block, `'a short menu places its top at the cursor y — never flipped above it'` (`show(100, 100, [2 items])`), fits far (696 room > small height) and needs **no change**.
15. **`tests/overlay/Menu.test.ts`** — add `describe('Menu pointer-anchored show — edge flip')` per *Expected Behaviour* §3.
16. **`tests/overlay/Menu.test.ts`** — add the report-1 horizontal case to the existing `describe('Menu rect-anchored toggleFor')` block per *Expected Behaviour* §2. The block's six existing tests must pass **untouched** — including `'clamps the horizontal position without affecting the flipped vertical position'` (line 659), verified: its rect's `right: 1290` is off-viewport, so the far-align cannot fit and the `clampAxis` fallback still returns 1156.
17. **`tests/overlay/Tooltip.test.ts:165`** — update `'clamps x and y to viewport - size for huge coordinates'` per *Expected Behaviour* §4: expectations become `CONFIG.viewport.width - w - 14` and `CONFIG.viewport.height - h - 14`; rename to `'flips a tooltip at the far viewport corner so it ends CURSOR_OFFSET before the cursor'`; mirror `CURSOR_OFFSET = 14` as a documented contract constant next to the existing `H_PADDING` / `MAX_WIDTH` mirrors (line 20). The `'clamps x and y to >= 0 for negative coordinates'` test (line 154) passes **untouched** — verified: the cursor clamps to `(0, 0)`, so the tooltip lands at `(14, 14)`.
18. **`tests/overlay/Tooltip.test.ts`** — add the report-2 cases per *Expected Behaviour* §4.
19. **`src/typescript/MiscPanel.ts:641-654`** — update the `tallContextMenu` block's comment and the button's `Tooltip.attach` text, which currently promise a clamp (*"shows the menu clamp to the available room and scroll"* / *"Right-click near the screen edge to see the menu clamp and scroll"*). They now describe the flip. This is prose only — **no logic change**.
20. **Docs** — apply *Documentation Impact* in full.
21. **Checkpoint:** `npm run lint && npm test && npm run docs:build` (docs must finish with zero warnings).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/core/OverlayPosition.ts` |
| Modify | `src/typescript/lib/overlay/Menu.ts` |
| Modify | `src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `src/typescript/MiscPanel.ts` (comment + tooltip prose only) |
| Modify | `tests/overlay/OverlayPosition.test.ts` |
| Modify | `tests/overlay/Menu.test.ts` |
| Modify | `tests/overlay/Tooltip.test.ts` |
| Modify | `docs/components/Menu.md` |
| Modify | `docs/components/Tooltip.md` |

No new files. `src/typescript/lib/core/AnimatedDropdown.ts` carries **no logic change** — it consumes `positionAnchored` unchanged and inherits the cross-axis flip. **Correction found by audit:** its `placeAnchored` JSDoc and inline comment described the cross axis as clamp-only, which this plan's own cross-axis change (see *Architecture Decisions*) made stale; that prose was fixed as a same-branch audit-fix commit (JSDoc/comment only, zero behaviour change), so the file is touched after all — just never for logic.

---

## Expected Behaviour

`installTestDOM` models viewport size, element rects, and the scrollbar width offline, so **all placement below is unit-testable**; only pixel rendering and real pointer gestures need eyes.

### §1 `positionAligned` — unit-testable (pure, no DOM)

`viewportExtent = 1280`, `extent = 120`. Enumerated per the three cases of the axis:

| Case | Input (`near`, `far`, `margin`) | Expected | Why |
| --- | --- | --- | --- |
| **fits-far** (near alignment fits) | `(200, 300, 4)` | `200` | left edges flush |
| **doesn't-fit-far, fits-near** (flip) | `(1200, 1270, 4)` | `1150` | right edges flush at 1270 — **report 1's fix** |
| **fits-neither**: anchor's far edge is off-viewport | `(1270, 1290, 4)` | `1156` | `clampAxis` fallback = `1280 − 120 − 4`; pins today's behaviour |
| **fits-neither**: near alignment violates the margin | `(0, 100, 4)` | `4` | near rejected by the `>= margin` guard, far (`−20`) rejected, clamp → margin |
| **fits-neither**: element wider than the viewport (`extent = 1400`) | `(200, 300, 4)` | `4` | clamp pins at the margin; caller's overflow carries |
| **zero-size anchor**, room to the right | `(500, 500, 4)` | `500` | collapse: grows right from the point |
| **zero-size anchor** at the right edge | `(1270, 1270, 4)` | `1150` | collapse: right edge lands **on** the cursor — **report 3's horizontal fix** |
| `margin = 0` (the `positionAnchored` default) | `(1200, 1270, 0)` | `1150` | flip is margin-independent |

Invariant to assert: for any in-viewport anchor, the result is always in `[margin, max(margin, viewportExtent − extent − margin)]`.

### §2 `Menu.toggleFor` rect-anchored — unit-testable (`installTestDOM`, `viewport: 1280×800`)

**The six existing tests in `describe('Menu rect-anchored toggleFor')` (lines 598-691) must pass untouched.** In particular line 601 already asserts report 1's *vertical* half (`menu.getY() + menu.getHeight() === 772`) — it works today and must keep working.

One new case (report 1's horizontal half):

- **The menu right-aligns to a trigger near the right edge:** `trigger = rect(1200, 100, 1270, 124)`, one item → `menu.getX() + menu.getWidth() === 1270` (flush with `trigger.right`), and `menu.getX() === 1270 - menu.getWidth()`. Today it is pushed to `1280 - width - 4`. This is the report-1 regression test.
- **A trigger with room to its right still left-aligns:** `trigger = rect(100, 100, 200, 124)` → `menu.getX() === 100`.

### §3 `Menu.show` pointer-anchored — unit-testable; **behaviour changes** (report 3)

| Case | Call (items) | Expected | Note |
| --- | --- | --- | --- |
| fits-far both axes | `show(100, 100, [2 items])` | `x === 100`, `y === 100` | unchanged |
| **vertical fits-neither-far, flips** | `show(100, 790, [2 items])` | `y + height === 790` (bottom **at** the cursor), `y < 790` | report 3, vertical |
| **horizontal flips** | `show(1270, 100, [{text:'A'}])` | `x + width === 1270` (right edge **at** the cursor) | report 3, horizontal |
| **vertical fits-neither-side** (the `available` trap) | `show(100, 790, [60 items])` | `y === 4`, `getMaxSize()!.height === 786`, `y + height <= 790` | **fails if `available` is re-derived** — re-derivation gives 792, spanning `[4, 796]` back over the cursor |
| tie: cursor above the midpoint, over-tall | `show(100, 100, [60 items])` | `y === 100`, `getMaxSize()!.height === 696` | **UPDATES `Menu.test.ts:217`** (was `y === 4`): `roomFar (696) >= roomNear (96)` → stays below the cursor and scrolls |
| out-of-viewport cursor | `show(-100, -100, [2 items])` | `x === VIEWPORT_MARGIN` (4), `y === 0` | cursor clamps to `(0,0)`; **correction found during implementation:** the table originally said `x === 0`, but `positionAligned`'s own `nearEdge >= margin` guard (§1 case 4, this same plan) rejects a near-align at `nearEdge = 0 < margin = 4`, and the far-align is off-viewport too, so it falls to the `clampAxis` fallback and pins at the margin (4) — matching old-code parity (`clampIntoViewport(-100, -100, …)` also pinned to the margin). `y === 0` is correct as written: `positionFlexibleAnchored` returns `farEdge` directly when it fits far, with no margin floor on the coordinate itself. |
| **the canonical repro** | `show(1270, 790, [60 items])` | `x + width === 1270`, `y === 4`, `getMaxSize()!.height === 786`, `y + height === 790` | both axes end at the cursor; cursor uncovered |

**Must stay green untouched:** the four gutter tests (`Menu.test.ts:512-595`) — verified: `show(10, 10, …)` in a 120px viewport now yields `y = 10, available = 106` instead of `y = 4, available = 112`; every gutter assertion still holds. And `show(0, 0, [])` still mounts an empty panel (`Menu.test.ts:708`) — the shipped asymmetry is preserved.

### §4 `Tooltip.show` — unit-testable; **behaviour changes** (report 2)

`viewport: 1280×800`, `CURSOR_OFFSET = 14`, no viewport margin. `w`/`h` are the resolved tooltip size.

| Case | Call | Expected |
| --- | --- | --- |
| fits-far both axes | `show('Hello', 100, 100)` | `x === 114`, `y === 114` — **bit-identical to today** |
| **horizontal flips** | `show('Hello', 1270, 100)` | `x === 1270 - w - 14` (right edge 14px left of the cursor) |
| **vertical flips** | `show('Hello', 100, 790)` | `y === 790 - h - 14` |
| **both flip** | `show('Hello', 99999, 99999)` | `x === 1280 - w - 14`, `y === 800 - h - 14` — **UPDATES `Tooltip.test.ts:165`** (was `1280 - w`, `800 - h`); the cursor clamps to `(1280, 800)`, then both axes flip |
| out-of-viewport, negative | `show('Hello', -100, -100)` | `x === 14`, `y === 14` — the existing `>= 0` test at line 154 passes **untouched** |

**Correction found in review, after the branch was implemented as specified above:** the plan's `positionAdjacent(cx, cx, …)` anchors on the pointer *hotspot* as a zero-size point, so the single `gap = CURSOR_OFFSET` is measured from the hotspot on both sides. But the cursor glyph hangs **down and to the right** of its hotspot — nothing sits above the tip, and only a few px reach left of it. A symmetric gap around that asymmetric glyph reads wrong on screen: the unflipped tooltip looks flush with the cursor (14px from the hotspot ≈ 1-2px past the glyph's right edge) while the flipped one stands off it by nearly the full 14px, and a tooltip flipped above the cursor leaves 14px of dead space over the pointer's tip.

The fix keeps `positionAdjacent` untouched and instead passes it the cursor's **clearance box** rather than a point — the primitive already takes `nearEdge`/`farEdge` separately, which is exactly the mechanism for a side-dependent gap; this plan simply collapsed them. `CURSOR_OFFSET` is replaced by `CURSOR_LEFT = 4`, `CURSOR_RIGHT = 12`, `CURSOR_UP = 0`, `CURSOR_DOWN = 12`, `CURSOR_GAP = 2`. The unflipped placement stays **bit-identical** (`12 + 2 = 14`); the flipped sides tighten to `w + 6` left of the cursor and `h + 2` above it. Note `CURSOR_DOWN` is deliberately shorter than the real ~24px glyph: these are clearance, not glyph metrics, so an unflipped tooltip keeps sitting alongside the pointer's lower half rather than being pushed clear of it. The §4 rows above hold with `14` → `6` (horizontal flips) and `14` → `2` (vertical flips); the fits-far and negative rows are unchanged, as is the invariant below.

**The report-2 invariant** — assert as a property over a grid of in-viewport cursor positions (e.g. `x ∈ {0, 320, 640, 960, 1279}` × `y ∈ {0, 200, 400, 600, 799}`) with a short single-line tooltip: the cursor point is **never** inside `[x, x+w] × [y, y+h]`.

Documented limitation (do **not** try to fix): the invariant holds only while the tooltip fits on at least one side of an axis. Horizontally that is guaranteed — `MAX_WIDTH = 300` and a viewport ≥ 628px wide means one side always fits. Vertically the height is unbounded, so a tooltip taller than roughly half the viewport falls into `positionAdjacent`'s fits-neither branch and saturates on-screen — exactly as it does today. Note this in the JSDoc; don't add a height cap.

### §5 `positionAnchored` cross axis — unit-testable

- **`tests/overlay/OverlayPosition.test.ts:78` changes `842 → 840`** (see step 5). This is the AnimatedDropdown fix.
- Untouched and verified to still pass: the two `placeAnchored regression` legacy-parity tests (172-215); `'clamps the cross axis into the viewport'` (111, still 246 — the anchor's far edge overflows so the flip cannot fit); `'pins the cross axis to margin when the element is wider than the viewport'` (124, still 4); `'grows right … cross axis aligns to the anchor's top edge'` (86, still 100).

### §6 Manual verification (needs a browser)

- **Report 3, canonical (consuming app, `/home/jika/typescript/sqladmin`):** Structure panel, expand all accordion sections, position a table header at the very bottom of the viewport, right-click as far right as possible. The menu must open with its **bottom-right corner at the cursor**, never under it. The library-side call site is `Table.ts:740` (`this._columnContextMenu.show(x, y, items)`). Requires `npm run build:lib` in this repo first — sqladmin consumes the built `dist/lib`.
- **Report 3, library demo (`npm run dev`, *Misc* panel):** the *"Right-click for a tall (scrolling) menu"* button (`MiscPanel.ts:653`). Scroll it to the bottom of the viewport and right-click near its bottom edge — the menu's bottom must land on the cursor and scroll, rather than jumping to the top margin and covering the cursor. **Caveat:** the button lives in `leftColumn`, so it cannot reach the right viewport edge; narrow the window until it can, or use the sqladmin repro, to exercise the horizontal flip.
- **Report 2:** hover *"Hover over me for a tooltip"* (`MiscPanel.ts:662`) near the right and bottom viewport edges — the tooltip must flip up-left and never sit under the cursor.
- **Report 1:** a `SplitButton` chevron or `MenuButton` near the right viewport edge — its menu's right edge must land flush with the button's right edge.
- **AnimatedDropdown:** open a `DatePicker` / `TimePicker` / `ComboBox` whose input sits near the right viewport edge — the panel must right-align to the input rather than being nudged off it.
- The fade-in must play from the flipped position (no jump), and `scrollToBottomOnShow` must still land at the bottom of a flipped, clamped menu.

---

## Verification

1. `npm run typecheck && npm run typecheck:test` — clean.
2. `grep -rn 'clampIntoViewport' src/ tests/ docs/` — **zero matches**.
3. `grep -rn 'MenuAnchor\|kind: "pointer"\|kind: "rect"' src/` — **zero matches**.
4. `grep -rn 'flipAxis' src/ tests/` — **zero matches** (renamed to `positionAdjacent`).
5. `grep -rn 'positionAligned' src/typescript/lib/` — **exactly 4 *semantic* hits**: the definition, the two `positionAnchored` cross-axis call sites, and `Menu.resolvePlacement`. **Correction found during implementation/audit:** the literal grep returns **5 lines**, not 4 — `Menu.ts` needs an `import { positionAligned, … }` line to use the exported symbol, and that import line also contains the string, in addition to its one call site. The plan's count only tallied definition/call sites and forgot the import; the actual usage is exactly the 4 sites named above, with zero functional discrepancy.
6. `npm run lint` — clean (the `no-raw-dom` rule has an empty baseline).
7. `npm test` — all green, including §1-§5 and every "untouched" test named above.
8. `npm run docs:build` — zero TypeDoc warnings. `positionAligned` / `positionAdjacent` / `resolvePlacement` / `pointRect` / `showAnchored` are all internal (not barrel-exported), so public JSDoc must **describe** them in prose and never `{@link}` them (CODE_CONVENTIONS: *Don't `{@link}` internal symbols from public JSDoc*).
9. **Manual smoke:** per *Expected Behaviour* §6.

---

## Documentation Impact

Narrow by design — see *Architecture Decisions → `OverlayPosition` is not on the public API surface*. `positionAligned`, `positionAdjacent`, and the deleted `clampIntoViewport` are **not** reachable by consumers, **not** in `docs/`, `llms.txt`, or sqladmin, and **not** rendered by TypeDoc (whose entry points are the barrels; `core/index.ts` does not re-export `OverlayPosition`). **No new doc page, no sidebar entry, no `docs/components/index.md` row, no `scripts/llms/manifest.data.mjs` row, and no `llms.txt` regeneration.**

What does change is **behavioural prose for symbols that are public**:

- **`docs/components/Menu.md:74`** (the `## Notes` placement bullet) currently reads: *"Pointer-anchored `show()` grows downward from the cursor and clamps into the viewport — it never flips. `toggleFor()` and persistent-mode menus grow downward from the anchor and flip upward when there is more room above."* Both halves are now wrong. Replace with a single unified statement: every rebuild-mode menu grows **down-right** from its anchor — the trigger's bottom-left corner for `toggleFor()`, the cursor for `show()` — and flips per axis when the room runs short: vertically its bottom ends at the anchor's top; horizontally its right edge aligns with the anchor's right. A cursor is a zero-size anchor, so a context menu near the bottom-right edge ends **at** the cursor and never covers it. Keep the existing sentences about the height cap / scroll and the resize-time clamp.
- **`docs/components/Menu.md:31`** (the `toggleFor` paragraph) contains *"The anchored form opens below `anchorRect` and **flips above it** when the room below is short — unlike `show()`, which only ever clamps into the viewport."* The `show()` contrast is now false — drop that clause and add the horizontal flip to the `toggleFor` description. The remaining `toggleFor`-vs-`show()` distinctions (toggle identity, opener exclusion, empty-list suppression) are unaffected and stay exactly as written.
- **`docs/components/Tooltip.md`** documents no placement behaviour today (verified: no clamp/flip/offset prose). Add one sentence to its intro: the tooltip appears offset down-right of the cursor and flips to up-left near a viewport edge, so it never covers the pointer.
- **`docs/components/MenuButton.md:37`** and **`docs/components/NotificationHistoryButton.md:13`** already describe the vertical flip correctly and need **no change** — the vertical behaviour they document is exactly what already works.
- **Source JSDoc** on the public `Menu.show`, `Menu.toggleFor`, and `Tooltip.show` per *Ordered Implementation Steps* 8 and 10.

---

## Potential Challenges

- **Re-deriving `available` from `start`.** The single highest-value trap; it silently un-fixes report 3 for long menus. Mitigation: the §3 "`available` trap" test, plus the comment in `resolvePlacement`.
- **Reaching for `positionAligned` for the tooltip.** It would place the tooltip's left edge at the cursor — under it. The tooltip needs *adjacency* with `gap = CURSOR_OFFSET`. Mitigation: the §4 report-2 grid invariant fails loudly.
- **Dropping the cursor clamp in `show`/`Tooltip.show` as "impossible-scenario handling".** It preserves tested defensive behaviour and satisfies the primitives' in-viewport precondition. Mitigation: `Tooltip.test.ts:154` (`>= 0`) fails without it.
- **Clamping the anchor in `showAnchored` instead of the cursor in `show`.** It would corrupt the far-align for a trigger rect legitimately extending past a viewport edge. Mitigation: `Menu.test.ts:659`, whose rect has `right: 1290` in a 1280px viewport.
- **Dropping `positionAligned`'s `nearEdge >= margin` guard** as a redundant tidy-up. Without it an anchor at `left = 0` places the panel 4px tighter than the margin. Mitigation: §1 case 4.
- **"Fixing" the barrel gap** by exporting `OverlayPosition` from `core/index.ts` while touching it. That publishes four functions as documented public API and would make the `clampIntoViewport` deletion a real API break. Mitigation: *Non-Goals*; the `grep` invariants do not ask for it.
- **Renaming `positionFlexibleAnchored`** for symmetry with the new names. It shipped days ago at `8c71717d`; leave it. Mitigation: named in *Architecture Decisions*.

---

## Critical Files

- [`src/typescript/lib/core/OverlayPosition.ts`](src/typescript/lib/core/OverlayPosition.ts) — `flipAxis` (44), `clampAxis` (82), `positionFlexibleAnchored` (126), `positionAnchored` (159), `clampIntoViewport` (193).
- [`src/typescript/lib/overlay/Menu.ts`](src/typescript/lib/overlay/Menu.ts) — `VIEWPORT_MARGIN` (31), `MenuAnchor` (34), `resolvePlacement` (51), `show` (224), `showAnchored` (243), the geometry block (289-317), `toggleFor` (378), `placeVertically` (844, **unchanged**).
- [`src/typescript/lib/overlay/Tooltip.ts`](src/typescript/lib/overlay/Tooltip.ts) — the sizing + placement block (189-235), `CURSOR_OFFSET` (105).
- [`src/typescript/lib/core/AnimatedDropdown.ts`](src/typescript/lib/core/AnimatedDropdown.ts) — `placeAnchored` (354-367); no logic edit needed, but its stale clamp-only doc comment was corrected (see *Files to Create / Modify / Delete*).
- [`plans/implemented/menu-anchored-placement.md`](plans/implemented/menu-anchored-placement.md) — the shipped plan this extends. **Read it; do not edit it.**
- [`tests/overlay/OverlayPosition.test.ts`](tests/overlay/OverlayPosition.test.ts) — the pure-primitive test idiom (`rect()` / `size()` helpers).
- [`tests/overlay/Menu.test.ts`](tests/overlay/Menu.test.ts) — `CONFIG` / `installTestDOM`, the gutter and `toggleFor` suites the change must keep green.
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — the `{@link}`-internal-symbols docs-build constraint.
- [`CLAUDE.md`](CLAUDE.md) — Simplicity First, Surgical Changes.

---

## Non-Goals

- **Exporting `OverlayPosition` from `core/index.ts`.** It would newly publish four functions as documented public API and turn the `clampIntoViewport` deletion into a real API break. Whether these primitives *should* be public is a separate, deliberate decision.
- **Renaming `positionFlexibleAnchored`.** Merged at `8c71717d`; churn for no reader benefit.
- **Changing `Menu.placeVertically` or persistent-mode (`MenuBar`) placement.** It already delegates to `positionFlexibleAnchored` and is correct. Its cross axis is owned by `MenuBar`, not `resolvePlacement`.
- **Changing `show(x, y, [])`'s empty-panel behaviour**, or `toggleFor`'s empty-list suppression and branch order. Deliberate, shipped, tested, and orthogonal to placement.
- **Changing `Popover`.** Its clamp is arrow-compensated and correct — a different geometry, not this defect.
- **Adding a `gap` to `positionFlexibleAnchored`,** or a height cap to `Tooltip`. No caller needs either; the tooltip's fits-neither-vertically case is a documented limitation, unchanged from today.
- **Migrating sqladmin.** No consumer-facing signature changes, so nothing to migrate — the app inherits the fix from `Table.ts:740` after a library `npm run build:lib`.

### Scope

This is **one** plan, correctly. All three reports plus the fourth latent instance resolve to the same function pair in `OverlayPosition.ts`, and the entire value is the unification — the collapse of `MenuAnchor` and the deletion of `clampIntoViewport` are only reachable once all callers move together. Splitting would have separate implementers redesigning the same primitives, and a partial migration would leave `clampIntoViewport` alive with one consumer, forfeiting the simplification. The evidence supports the single-plan judgement.
