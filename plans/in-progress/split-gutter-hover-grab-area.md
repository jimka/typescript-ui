# SplitGutter Hover-Proximity Highlight and Widened Grab Area — Implementation Plan

## Overview

`SplitGutter` ([packages/lib/src/typescript/lib/component/container/SplitGutter.ts](packages/lib/src/typescript/lib/component/container/SplitGutter.ts)) is the divider component shared by two layout managers: `Split` ([packages/lib/src/typescript/lib/layout/Split.ts](packages/lib/src/typescript/lib/layout/Split.ts)), which uses it as a **draggable** resize handle between panes, and `Border` ([packages/lib/src/typescript/lib/layout/Border.ts](packages/lib/src/typescript/lib/layout/Border.ts)), which uses it as a **fixed** collapse-strip track. Today, a gutter's real DOM box is both its visual footprint and its entire hit-test target — 4px wide (`GUTTER_SIZE`, [Split.ts:29](packages/lib/src/typescript/lib/layout/Split.ts#L29)), and, for `Split`, fully transparent in its normal divider state (`expandedBackground: "transparent"`, [Split.ts:1492](packages/lib/src/typescript/lib/layout/Split.ts#L1492)) — so a `Split` divider is both slim and invisible until the mouse happens to land exactly on it.

This plan widens a **movable** gutter's real hit box beyond its 4px visual footprint, overlapping into both neighbouring panes' edge pixels without moving or resizing those panes, and fades in a blue highlight across that widened box on hover — mirroring VS Code's sash. `Border`'s fixed, non-draggable tracks are unaffected; see below for why.

---

## Architecture Decisions

### Widen the real element; no new child, no visual-chrome trick

`Split.doLayout()` gives a movable gutter a real box wider than `GUTTER_SIZE`, centred on the same boundary line; the neighbouring panes' own positions and sizes are untouched. No second DOM element is added.[^resizehandle-precedent]

### Scope to movable, non-opaque gutters only — `Border`'s fixed track does not participate

Hit-widening and the hover fade both activate only when `gutter.isMovable() && !gutter.isOpaque()` — precisely the condition `SplitGutter.applyCursor()` ([SplitGutter.ts:618](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L618)) already uses to decide whether to show the resize cursor. `Border` always constructs its gutters with `movable: false` ([Border.ts:384](packages/lib/src/typescript/lib/layout/Border.ts#L384)), so its fixed inner-edge tracks and collapsed strips are untouched by this change — no edits to `Border.ts` at all.[^border-scoping]

### Fixed, symmetric overhang — no dynamic clamping

The hit box grows by a fixed `GUTTER_HIT_OVERHANG = 3` px on each side of the main axis, every `doLayout` pass, regardless of how small a neighbouring pane currently is.[^overhang-value] No per-neighbour clamping is added.[^no-clamping]

### No new construction options

Hit-widening and the hover fade are unconditional behaviour for every movable gutter — no new field on `SplitOptions` or `SplitGutterOptions`. This mirrors `GUTTER_SIZE` itself, already a fixed, non-configurable constant; nothing in the request asks for per-instance control.

### Binary hover-in-widened-box, not continuous distance

The fade triggers on ordinary `mouseover`/`mouseout` of the gutter's own (now widened) element. There is no separate proximity/distance sampling.[^binary-hover]

### A new theme token, drawing on the existing blue accent

A new token, `gutter.hoverBackground` / `--ts-ui-gutter-hover-bg`, drives the wash. It defaults to a faint tint of the same blue accent hue selection and focus already use, per [ARCHITECTURE.md](ARCHITECTURE.md)'s "Drag-and-drop feedback colours" section — but it is its own token, not a reuse of a drag-feedback or selection token, since this affordance fires with no drag in progress and no selection involved.

### Re-assert the transition on every hover edge, not once

`onMouseOver`/`onMouseOut` each call `this.setTransition(...)` immediately before toggling `.hover`, rather than setting the transition once (in the constructor, or via `applyCursor`'s existing call sites).[^transition-clobber]

---

## Public API

`Theme`'s `gutter` block gains one new required field (every concrete theme must supply it, enforced by the type checker):

```typescript
// packages/lib/src/typescript/lib/core/Theme.ts
gutter: {
    background: string;
    /** Wash painted across a movable SplitGutter's widened hit box on hover. */
    hoverBackground: string;
};
```

No other exported symbol, option, or method signature changes.

---

## Internal Structure

### `Split.ts` — widened placement

```typescript
// Near GUTTER_SIZE (Split.ts:29)
// Extra px a movable gutter's real hit box extends past its GUTTER_SIZE
// visual footprint on each side (so its total hit width is GUTTER_SIZE +
// 2 × GUTTER_HIT_OVERHANG = 10px). Chosen to match CollapseButton's own
// GRIP_ACROSS (10px) — see SplitGutter.ts's `.hover` state.
const GUTTER_HIT_OVERHANG = 3;
```

Inside `doLayout()`'s expanded-divider branch ([Split.ts:1593-1618](packages/lib/src/typescript/lib/layout/Split.ts#L1593-L1618)), replace the unconditional `gutter.setX(x); gutter.setY(y);` plus the `GUTTER_SIZE`-only width/height writes with an overhang computed from live `isMovable()`:

```typescript
const overhang = gutter.isMovable() ? GUTTER_HIT_OVERHANG : 0;

if (horizontal) {
    gutter.setX(x - overhang);
    gutter.setY(y);
    gutter.setWidth(GUTTER_SIZE + 2 * overhang);
    gutter.setHeight(crossSize);

    x += GUTTER_SIZE;
} else {
    gutter.setX(x);
    gutter.setY(y - overhang);
    gutter.setWidth(crossSize);
    gutter.setHeight(GUTTER_SIZE + 2 * overhang);

    y += GUTTER_SIZE;
}
```

`x`/`y` still advance by exactly `GUTTER_SIZE` — pane geometry is untouched.

Worked example, horizontal split, boundary at `x = 200`:

| Gutter state | Real box (x, width) | Next pane starts at |
|---|---|---|
| Movable (today, before this plan) | `x=200, width=4` | `204` |
| Movable (after this plan) | `x=197, width=10` | `204` (unchanged) |
| Locked (`setMovable(false)`) | `x=200, width=4` | `204` |

A gutter always sits strictly between two real panes — there is no "container edge" case where a widened box would have nothing to overlap into.

### `Split.ts` — keep the "Lock gutter" toggle live

`isMovable()` is read fresh every `doLayout` pass, and every `setOpaque` call already happens from inside a `doLayout`/`placeGutterAsStrip` pass, so the opaque case is automatically current. The one runtime `setMovable` call outside construction is the "Lock gutter" context-menu row ([Split.ts:1131-1139](packages/lib/src/typescript/lib/layout/Split.ts#L1131-L1139)), which today changes only the cursor (no relayout needed for that). Since hit-box width now also depends on `isMovable()`, that row must trigger a relayout so the widened box doesn't go stale after a lock/unlock:

```typescript
row.on("action", () => {
    gutter.setMovable(!gutter.isMovable());
    container.scheduleLayout();
});
```

### `SplitGutter.ts` — hover state

```typescript
// After OPAQUE_DECLARATIONS
/** Mirrors Checkbox's crossfade and Scrollbar's arrow fade (both 120ms ease-out). */
const HOVER_FADE_DURATION_MS = 120;

/** `.hover`'s wash, read by `ownStyleStates`' `.hover` entry below. */
const HOVER_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-gutter-hover-bg, rgba(30, 100, 200, 0.3))",
};
```

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    { selector: ".opaque", extract: (): StyleBag => OPAQUE_DECLARATIONS },
    { selector: ".hover",  extract: (): StyleBag => HOVER_DECLARATIONS },
];
```

Constructor, right after the existing `Event.addListener(this, 'mousedown', this.onDragStart);` ([SplitGutter.ts:200](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L200)):

```typescript
Event.addListener(this, "mouseover", this.onMouseOver);
Event.addListener(this, "mouseout",  this.onMouseOut);
```

New methods (public, matching the visibility of the existing `onDragStart`/`onDrag`/`onDragStop` — placed after `applyCursor()`, [SplitGutter.ts:624](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L624)):

```typescript
onMouseOver(evnt: MouseEvent): void {
    if (!this._movable || this._opaque || this.containsEventTarget(evnt.relatedTarget)) {
        return;
    }

    this.applyHoverTransition();
    this.setStyleState(".hover", true);
}

onMouseOut(evnt: MouseEvent): void {
    if (this.containsEventTarget(evnt.relatedTarget)) {
        return;
    }

    this.applyHoverTransition();
    this.setStyleState(".hover", false);
}

private applyHoverTransition(): void {
    this.setTransition(Animation.isReducedMotion() ? "none" : `background-color ${HOVER_FADE_DURATION_MS}ms ease-out`);
}

private containsEventTarget(target: EventTarget | null): boolean {
    const element = this.getElement();

    if (!element || !DOM.source.isNode(target)) {
        return false;
    }

    return DOM.source.contains(element, DOM.source.intern(target));
}
```

Add `import { Animation } from "~/core/Animation.js";` alongside the existing imports.

Worked example for `containsEventTarget` — the rule that decides whether a boundary crossing onto the chevron child counts as a real leave/enter:

| Movement | Fires | `target` | `relatedTarget` | Descendant? | Result |
|---|---|---|---|---|---|
| Pane → gutter body | `mouseover` | gutter | pane | no | `.hover` on |
| Gutter body → chevron | `mouseout` | gutter | chevron | yes | ignored, stays hovered |
| Chevron → gutter body | `mouseover` | gutter | chevron | yes | ignored (already hovered) |
| Gutter (or chevron) → pane | `mouseout` | gutter | pane | no | `.hover` off |

---

## Ordered Implementation Steps

1. **`Split.ts`** — add `GUTTER_HIT_OVERHANG = 3` near `GUTTER_SIZE` ([Split.ts:29](packages/lib/src/typescript/lib/layout/Split.ts#L29)).
   Check: `grep -n GUTTER_HIT_OVERHANG packages/lib/src/typescript/lib/layout/Split.ts` shows the declaration.
2. **`Split.ts`** — in `doLayout()`'s expanded-divider branch ([Split.ts:1593-1618](packages/lib/src/typescript/lib/layout/Split.ts#L1593-L1618)), replace the `gutter.setX/setY/setWidth/setHeight` calls with the overhang-aware version above.
   Check: `npm run typecheck` passes; pane widths in the existing `packages/lib/tests/component/layout/Split.test.ts` suite are unchanged (they assert pane geometry, not gutter geometry).
3. **`Split.ts`** — in `openGutterMenu`'s "Lock gutter" row ([Split.ts:1131-1139](packages/lib/src/typescript/lib/layout/Split.ts#L1131-L1139)), add `container.scheduleLayout();` after the `setMovable` call.
   Check: `grep -n "Lock gutter" -A3 packages/lib/src/typescript/lib/layout/Split.ts` shows the new line.
4. **`SplitGutter.ts`** — add the `Animation` import, `HOVER_FADE_DURATION_MS`, and `HOVER_DECLARATIONS` constants after `OPAQUE_DECLARATIONS` ([SplitGutter.ts:94](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L94)).
5. **`SplitGutter.ts`** — add the `.hover` entry to `ownStyleStates` ([SplitGutter.ts:121-126](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L121-L126)), after `.opaque`.
6. **`SplitGutter.ts`** — wire the two `Event.addListener` calls in the constructor, right after the existing `mousedown` registration ([SplitGutter.ts:200](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L200)).
7. **`SplitGutter.ts`** — add `onMouseOver`, `onMouseOut`, `applyHoverTransition`, `containsEventTarget` after `applyCursor()` ([SplitGutter.ts:624](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L624)).
   Check: `npm run typecheck` passes.
8. **`Theme.ts`** — add `hoverBackground: string;` to the `gutter` interface block ([Theme.ts:236-238](packages/lib/src/typescript/lib/core/Theme.ts#L236-L238)), and `'--ts-ui-gutter-hover-bg': theme.gutter.hoverBackground,` right after the existing `'--ts-ui-gutter-bg'` mapping ([Theme.ts:1050](packages/lib/src/typescript/lib/core/Theme.ts#L1050)).
   Check: `npm run typecheck` — this alone will fail until step 9 is done, since every concrete theme must now supply `hoverBackground`.
9. **`ModernTheme.ts`, `ClassicTheme.ts`, `DarkTheme.ts`** — add `hoverBackground` to each `gutter: {...}` literal ([ModernTheme.ts:93](packages/lib/src/typescript/lib/core/themes/ModernTheme.ts#L93), [ClassicTheme.ts:93](packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts#L93), [DarkTheme.ts:91](packages/lib/src/typescript/lib/core/themes/DarkTheme.ts#L91)): `'rgba(30, 100, 200, 0.3)'` for Modern/Classic, a Dark-appropriate equivalent (e.g. `'rgba(120, 170, 240, 0.3)'`, matching Dark's own `selectedBackground` hue at [DarkTheme.ts:81](packages/lib/src/typescript/lib/core/themes/DarkTheme.ts#L81)).
   Check: `npm run typecheck` passes clean.
10. **New test file** `packages/lib/tests/component/layout/Split.gutterHitBox.test.ts` — hit-box geometry (see Expected Behaviour).
11. **New test file** `packages/lib/tests/component/container/SplitGutter.hover.test.ts` — hover-state wiring/gating (see Expected Behaviour).
12. **`packages/lib/docs/concepts/theming.md`** — add a row for `gutter.hoverBackground` / `--ts-ui-gutter-hover-bg` near the existing `gutter.background` row ([theming.md:64](packages/lib/docs/concepts/theming.md#L64)).
13. **`packages/lib/docs/layouts/Split.md`** — extend the existing gutter-theming note ([Split.md:194](packages/lib/docs/layouts/Split.md#L194)) with one sentence on the widened grab area and hover highlight.
14. Run the full verification pass (below).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `packages/lib/docs/concepts/theming.md` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Create | `packages/lib/tests/component/layout/Split.gutterHitBox.test.ts` |
| Create | `packages/lib/tests/component/container/SplitGutter.hover.test.ts` |

`Border.ts` is deliberately not in this list — see Architecture Decisions.

---

## Expected Behaviour

**Offline-testable (hit-box geometry, layout math, style-state wiring):**

1. In a 2+ pane horizontal `Split`, a movable, non-opaque gutter's box after `doLayout()` is centred on the same boundary the two panes abut — `gutter.getX() + gutter.getWidth() / 2` equals `leadingPane.getX() + leadingPane.getWidth()` — and is wider than the plain 4px divider (`gutter.getWidth() > 4`). Both panes' own `getX()`/`getWidth()` are byte-for-byte what they'd be without this change: derive the expected boundary from the panes' own reported geometry (matching the existing `Split.test.ts` convention of not hardcoding the gutter constant), not from a hardcoded `GUTTER_HIT_OVERHANG` literal.
2. Same split, vertical orientation: the same relationship holds on `y`/`height`, with `crossSize` (width) unaffected.
3. A gutter locked via `gutter.setMovable(false)` followed by `container.doLayout()` reports `width === GUTTER_SIZE` exactly (no overhang).
4. After collapsing a pane via `split.setPaneCollapsedImmediate(index, true)` followed by `container.doLayout()`, the serving gutter's width is exactly `COLLAPSE_STRIP_SIZE` regardless of `isMovable()` — the widening code path lives only in the expanded-divider branch, never in `placeGutterAsStrip`.
5. `gutter.onMouseOver({ relatedTarget: null } as MouseEvent)` on a movable, non-opaque gutter sets `gutter.isStyleState(".hover")` to `true`.
6. The same call on a locked gutter (`gutter.setMovable(false)` first) or an opaque one (`gutter.setOpaque(true)` first) leaves `.hover` `false`.
7. `gutter.onMouseOut({ relatedTarget: <a Handle inside the gutter's own chevron> } as MouseEvent)` after a prior `onMouseOver` leaves `.hover` `true` (ignored — see the `containsEventTarget` worked example).
8. `gutter.onMouseOut({ relatedTarget: null } as MouseEvent)` after a prior `onMouseOver` sets `.hover` to `false`.
9. Locking a gutter live (`gutter.setMovable(false); container.scheduleLayout(); container.doLayout();`) shrinks its box back to `GUTTER_SIZE` on the very next layout — no stale widened box.

**Manual-verify only (visual fade, real hover feel — offline harness cannot render CSS transitions or real mouse proximity):**

10. In the running app (`packages/docs/src/demos/split-panes.ts` demo, served via `npm run docs:dev`), hovering within a few pixels of a pane divider (not exactly on the old 4px line) fades in a blue wash smoothly, and mousing away fades it back out.
11. Starting a drag and moving the mouse well outside the ~10px hit box keeps the highlight visible for the whole drag (a side effect of `PointerDrag.ts`'s existing `pointer-events: none` suppression on every element outside the document root during a drag — see the transition-clobber footnote); it clears correctly on mouseup once the pointer next moves.
12. Double-clicking the chevron still collapses/restores correctly, and the highlight does not visibly break during the collapse/restore animation.
13. A locked gutter (via the "Lock gutter" context-menu item) shows no highlight and reverts to the plain 4px hit area.

---

## Verification

- `npm run typecheck` — also confirms every concrete theme supplies `gutter.hoverBackground`.
- `npm run lint`
- `npm run test`, with particular attention to (all should stay green with no edits needed):
  - `packages/lib/tests/component/container/SplitGutter.movable.test.ts`
  - `packages/lib/tests/component/container/SplitGutter.classStyleHoisting.test.ts`
  - `packages/lib/tests/component/container/SplitGutter.tooltip.test.ts`
  - `packages/lib/tests/component/container/leaves.smoke.test.ts`
  - `packages/lib/tests/component/layout/Split.test.ts`
  - `packages/lib/tests/component/layout/Split.gutterMenu.test.ts` — exercises the "Lock gutter" row directly (its `'Lock gutter toggles gutter.isMovable() and reflects it checked on re-open'` case), the row this plan adds a `scheduleLayout()` call to
  - the two new test files added in Ordered Implementation Steps 10-11
- `npm run docs:api` — the `Theme` interface's new field is a plain `string`, not a JSDoc `{@link}`, so this should finish with zero new warnings.
- Manual smoke test per Expected Behaviour items 10-13, using the Chrome DevTools MCP tools if available in the session.

---

## Documentation Impact

- [`packages/lib/docs/concepts/theming.md`](packages/lib/docs/concepts/theming.md) — add a `gutter.hoverBackground` / `--ts-ui-gutter-hover-bg` row next to the existing `gutter.background` row ([theming.md:64](packages/lib/docs/concepts/theming.md#L64)).
- [`packages/lib/docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md) — extend the one-line gutter-theming note ([Split.md:194](packages/lib/docs/layouts/Split.md#L194)) to mention the widened grab area and hover highlight.
- No API reference pages need new entries beyond what `typedoc` picks up automatically from the `Theme` interface's new field and its doc comment.

---

## Potential Challenges

- **Z-order**: the widened hit box only correctly overlaps a neighbouring pane if the gutter paints above it. Gutters are appended to the container element after the panes ([Split.ts:1517](packages/lib/src/typescript/lib/layout/Split.ts#L1517)), so default DOM-order stacking already puts them on top; a pane that explicitly sets its own `z-index` higher than the gutter's (gutters set none today) could locally invert this. Mitigation: not needed for the default case; if a real app hits this, the fix is a `setZIndex` on the gutter, not a redesign.
- **Transition churn during rapid collapse/restore**: `CollapseSupport.primeCollapse` briefly overwrites and then clears every gutter's `transition` in a `Split` whenever any pane collapses or restores. If this happens to coincide with a hover fade in progress on an unrelated gutter, that fade's duration can briefly read as the collapse's 200ms instead of 120ms. Mitigation: cosmetically negligible (both are sub-second colour fades); the re-assert-on-every-hover-edge design (see Notes) already prevents the fade from being lost entirely, which is the failure mode that matters.

---

## Critical Files

- [packages/lib/src/typescript/lib/layout/Split.ts](packages/lib/src/typescript/lib/layout/Split.ts) — `doLayout`, `GUTTER_SIZE`, `openGutterMenu`.
- [packages/lib/src/typescript/lib/component/container/SplitGutter.ts](packages/lib/src/typescript/lib/component/container/SplitGutter.ts) — `ownStyleStates`, `applyCursor`, `onDragStart`/`onDrag`/`onDragStop` (the method-visibility precedent).
- [packages/lib/src/typescript/lib/layout/Border.ts](packages/lib/src/typescript/lib/layout/Border.ts) — `ensureGutter` ([Border.ts:374-397](packages/lib/src/typescript/lib/layout/Border.ts#L374-L397)), confirming `movable: false` is why it needs no changes.
- [packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts) — the codebase's existing "hit box wider than visual chrome" precedent.
- [packages/lib/src/typescript/lib/component/container/CollapseButton.ts](packages/lib/src/typescript/lib/component/container/CollapseButton.ts) — `GRIP_ACROSS`, and the "button overflows its thin host gutter" precedent.
- [packages/lib/src/typescript/lib/component/container/Scrollbar.ts](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) — `ScrollbarThumb`'s `.hover` `ownStyleStates` entry and `applyHoverState`; `ScrollArrowButton`'s fade duration constant.
- [packages/lib/src/typescript/lib/component/input/Checkbox.ts](packages/lib/src/typescript/lib/component/input/Checkbox.ts) — the `setTransition("...120ms ease-out")` crossfade idiom.
- [packages/lib/src/typescript/lib/layout/CollapseSupport.ts](packages/lib/src/typescript/lib/layout/CollapseSupport.ts) — `primeCollapse`, the source of the transition-clobber interaction this plan designs around.
- [packages/lib/src/typescript/lib/core/PointerDrag.ts](packages/lib/src/typescript/lib/core/PointerDrag.ts) — `beginPointerDrag`'s `pointer-events: none` suppression, why the highlight persists through a drag for free.
- [ARCHITECTURE.md](ARCHITECTURE.md) — "Hover detection uses mouseover / mouseout", "Drag-and-drop feedback colours", "Component CSS tiers and state-rule dedup", "One DOM element per class".
- [packages/lib/tests/component/container/SplitGutter.movable.test.ts](packages/lib/tests/component/container/SplitGutter.movable.test.ts) — the offline test-harness pattern to mirror.
- [packages/lib/tests/component/layout/Split.test.ts](packages/lib/tests/component/layout/Split.test.ts) — its "deeper gutter geometry is a Non-Goal here" scoping note (line 3), which is why the new geometry tests get their own file.
- [packages/lib/tests/component/layout/Split.gutterMenu.test.ts](packages/lib/tests/component/layout/Split.gutterMenu.test.ts) — `hostSplit`/`probe`/`openMenuFor` helpers and the existing "Lock gutter" coverage the `scheduleLayout()` addition must keep passing.

---

## Non-Goals

- `Border`'s fixed, non-draggable inner-edge tracks and collapse strips — not a resize handle, so the "hard to grab" complaint doesn't apply, and no changes are made to `Border.ts`.
- A continuous, distance-based proximity fade (sampling pointer distance from the divider line) — the widened hit box's own bounds already act as the "near" tolerance band.
- Any new construction option to configure the overhang width, fade duration, or fade colour beyond the theme token — matches `GUTTER_SIZE`'s own non-configurable precedent.
- Dynamic per-neighbour clamping of the overhang against a squeezed pane's current size — a fixed, always-symmetric overhang is used instead; see Notes.
- Any change to drag behaviour, cursor logic, or the collapse/restore animation beyond the transition-timing interaction already accounted for.

---

## Notes

[^resizehandle-precedent]: `ResizeHandle` ([packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts:42-52](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L42-L52)) already ships a "hit box wider than what's visually painted" component — a 5px-wide drag target with only its rightmost 1px painted, via a `backgroundImage` gradient. It was investigated as a candidate mechanism but doesn't transfer directly: its resting state has a real, always-visible 1px line that the gradient has to *preserve* inside the wider box. `SplitGutter`'s resting divider state carries no visible chrome at all — both `Split` ([Split.ts:1492](packages/lib/src/typescript/lib/layout/Split.ts#L1492)) and `Border` ([Border.ts:386](packages/lib/src/typescript/lib/layout/Border.ts#L386)) construct it with `expandedBackground: "transparent"` — so there is nothing to preserve, and the whole box can just be widened outright with no gradient. A raw non-interactive overlay child (the "resize-handle div" carve-out `ARCHITECTURE.md`'s "One DOM element per class" section names) was also considered and rejected: it would need its own sizing/pointer-events bookkeeping for no benefit over resizing the one element `SplitGutter` already owns.

[^border-scoping]: `Border`'s track exists to host the collapse chevron and, once collapsed, to render as a real opaque strip — neither of those is a resize gesture. The chevron already has an adequate, independent hit target: `CollapseButton` documents that it "overflows its thin host gutter so it stays clickable" ([CollapseButton.ts:83-84](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L83-L84)). Gating on live `isMovable()`/`isOpaque()` (rather than "is this a `Split` gutter") also means a `Split` gutter locked at runtime via "Lock gutter" is treated identically to a `Border` track, with no special-casing by owning manager.

[^overhang-value]: `GUTTER_HIT_OVERHANG = 3` makes the total hit width `GUTTER_SIZE + 2 × 3 = 10px`, matching `CollapseButton.GRIP_ACROSS` ([CollapseButton.ts:16](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L16)) exactly. The chevron already occupies a 10px-across footprint, overflowing the plain 4px gutter by 3px on each side; widening the gutter's own hit box to the same 10px brings the drag target's thickness up to what the chevron already visually occupies, rather than introducing an unrelated number.

[^no-clamping]: A pane whose current main-axis extent is smaller than `2 × GUTTER_HIT_OVERHANG` could have its entire exposed area covered by its two flanking gutters' hit zones. Dynamic clamping (capping each side's overhang to half the adjacent pane's live size) was considered and rejected for two reasons. First, `Split.computeMainAxisSizes` reports a *collapsed* pane's size as `0` even when that pane is actually visible as an `COLLAPSE_STRIP_SIZE`-wide (18px) strip served by a *different* gutter — so a naive size lookup would under- or over-clamp next to a collapsed neighbour. Second, asymmetric per-side clamping would shift the gutter's visual centre, and `CollapseButton` centres itself on its host via a CSS percentage transform ([CollapseButton.ts:97-102](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L97-L102)) — an off-centre gutter box would visibly de-centre the chevron. A fixed, always-symmetric overhang avoids both problems. The degenerate case (a near-zero-width pane briefly unclickable directly) is accepted, matching how the framework already tolerates other degenerate tiny-size layouts without special-casing (`ARCHITECTURE.md`, "Size constraints: who is responsible for what", rule 7).

[^binary-hover]: VS Code's own sash affordance reads the same way in practice: its hit area is simply wider than its rendered line, and hovering that wider area is what triggers the highlight — there is no independently-sampled pointer-to-line distance driving a continuous fade. Every existing hover idiom in this codebase (`Scrollbar`'s `.hover` state; `ARCHITECTURE.md`'s "Hover detection uses mouseover / mouseout") is likewise binary. Continuous distance tracking would require a new mousemove-based proximity mechanic with no precedent anywhere in the framework, for no behavioural gain the widened hit box doesn't already provide.

[^transition-clobber]: `CollapseSupport.primeCollapse` ([CollapseSupport.ts:132-175](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L132-L175)) writes a `background-color` transition to **every** gutter participating in a `Split`'s collapse/restore pass ([CollapseSupport.ts:459-469](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L459-L469): "the rest carry the transition harmlessly"), then clears it (`setTransition(null)`) once the pass settles. A transition set once — at construction, or from `applyCursor`'s existing call sites (`setMovable`, `setOpaque`, `render`) — would be silently wiped by the next unrelated pane's collapse or restore anywhere in the same `Split`, permanently losing the hover fade for every gutter in it until something else happened to re-trigger the setup. Re-asserting the transition fresh on every `onMouseOver`/`onMouseOut` call makes the fade immune to this at the cost of one extra cheap buffered `setTransition` write per hover edge. A residual, cosmetically negligible timing overlap (a fade briefly running at the collapse's 200ms instead of 120ms if the two coincide exactly) is accepted — see Potential Challenges.
