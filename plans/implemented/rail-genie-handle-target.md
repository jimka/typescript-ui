# Rail Genie Targets Its Own Handle — Implementation Plan

## Overview

When a floating window is minimized into a [`Rail`](packages/lib/src/typescript/lib/overlay/Rail.ts), it plays a "genie" animation that scales and fades the window into the rail. The transform is built by [`railGenieTransform`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2028) and replayed in reverse by [`animateRailExpand`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2094).

Today every window animates to the rail's **corner**, no matter where that window's handle sits in the rail's handle stack. The transform sets only the *cross-axis* component of the target (the rail edge) and leaves the *main-axis* component — the position along the rail — at `0`. A rail stacks its handles along the main axis, so the window should animate to its own handle's along-rail offset, not `0`.

This plan adds one public method to `Rail` that reports a window's handle offset along the rail, and rewrites `railGenieTransform` to place the main-axis target at that offset for all four edges. The cross-axis and scale logic are unchanged. No new files.

---

## Architecture Decisions

### The window asks the rail for the offset — it does not reach into rail internals

`railGenieTransform` gains the handle offset by calling a new public `Rail.handleMainAxisOffset(window)`, exactly as it already calls `rail.getEdge()` and `rail.getThickness()`.[^ask-the-rail] The rail owns its handle layout; the window owns the genie. Neither reaches past the other's public surface.

### Predict the append slot when the handle does not exist yet

At collapse time the window's handle **has not been created**: `animateRailCollapse` computes the transform first, and the handle is created only in the collapse's `onDone` callback, which fires `"minimize"` → `Rail.showWindowHandle` after the animation finishes.[^collapse-ordering] So `handleMainAxisOffset` must *predict* where the handle will land. It appends last, so its offset is the trailing edge of the current last handle plus one inter-handle gap (or `0` for an empty rail). On the reverse (expand) path the handle still exists, so the method reads its actual laid-out position. One method, two branches, so `railGenieTransform` stays the single source of truth for both directions.[^single-source]

This mirrors the built-in dock-minimize path, which already predicts a per-window position along an edge: [`computeDockSlotIndex`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2134) counts the minimized windows ahead of this one and [`computeDockRect`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2008) turns that index into an `x` along the bottom edge. The rail case diverges in one respect, stated because pattern-conformance requires it: the dock uses a **uniform** slot width (`slotIndex * (dockWidth + gap)`), but rail handles are content-sized [`Button`](packages/lib/src/typescript/lib/overlay/RailHandle.ts)s of **varying** main-axis extent, so a uniform `index * extent` would point at the wrong spot for handles with longer titles. The rail method therefore reads the handles' actual laid-out geometry instead of assuming a fixed extent.[^why-measure]

### Coordinate space: the rail's main-axis viewport origin is `0`

`railGenieTransform` translates the window's own top-left (`cur.x` / `cur.y`, viewport coordinates), so the offset must be a viewport coordinate too. A rail's main-axis origin is always `0` in the viewport — WEST/EAST rails rest at `y = 0` and NORTH/SOUTH rails at `x = 0` (see [`restingRect`](packages/lib/src/typescript/lib/overlay/Rail.ts#L1161)) — so a handle's rail-relative main-axis offset (its `getY()` on a vertical rail, `getX()` on a horizontal one) already **is** its viewport main-axis offset, to within the rail's 1px border.[^one-px] `handleMainAxisOffset` returns that value directly; no rail-origin term is added.

---

## Public API

```typescript
// Rail.ts — new public method
/**
 * Returns the main-axis viewport offset of a registered window's rail handle —
 * where the genie animation should aim. When the handle exists (restore, or an
 * already-minimized window) this is its laid-out position; when it does not yet
 * exist (the collapse genie runs before the handle is created) this is the
 * predicted append slot: after the last existing handle plus one gap, or 0 for
 * an empty rail. Main axis is Y for a vertical (WEST/EAST) rail, X for a
 * horizontal (NORTH/SOUTH) one; the rail's main-axis viewport origin is 0.
 */
handleMainAxisOffset(window: AbstractWindow): number
```

No new state, no options field, no backing field — the value is derived live from the handles, so nothing is cached (per ARCHITECTURE.md, derived state stays off the options bag).

---

## Implementation

### `Rail.handleMainAxisOffset` (new)

```typescript
handleMainAxisOffset(window: AbstractWindow): number {
    const vertical   = this.isVertical();
    const mainPos    = (c: Component): number => vertical ? c.getY() : c.getX();
    const mainExtent = (c: Component): number => vertical ? c.getHeight() : c.getWidth();

    // Restore path (and an already-minimized window): the handle exists — its
    // laid-out main-axis position is the target directly.
    const handle = this._windows.get(window)?.handle ?? null;
    if (handle !== null) {
        return mainPos(handle);
    }

    // Collapse path: the handle is created after this runs, appended last.
    // Predict its slot from the current last handle's trailing edge + gap.
    const handles = this.getComponents();
    if (handles.length === 0) {
        return 0;
    }

    const last = handles[handles.length - 1];

    return mainPos(last) + mainExtent(last) + this.handleSpacing();
}

private handleSpacing(): number {
    const lm = this.getLayoutManager();

    return lm instanceof BoxLayout ? lm.getComponentSpacing() : 0;
}
```

`getComponents()` returns only the handles: the collapse chevron is a raw child appended through `DOM.sink.appendChild` in `mount`, never `addComponent`, so it is absent from the child list. Requires a new value import `import { BoxLayout } from "~/layout/BoxLayout.js";` and — since the bodies name `Component` — confirming `Component` is imported (it already is, line 3).

### `AbstractWindow.railGenieTransform` (rewrite of the switch)

Compute the offset once, then set the main-axis target for every edge while keeping the existing cross-axis assignments:

```typescript
const mainOffset = rail.handleMainAxisOffset(this);

let targetX = 0;
let targetY = 0;

switch (rail.getEdge()) {
    case Placement.EAST:
        targetX = DOM.source.getViewportSize().width - thickness;
        targetY = mainOffset;

        break;

    case Placement.WEST:
        targetY = mainOffset;

        break;

    case Placement.SOUTH:
        targetX = mainOffset;
        targetY = DOM.source.getViewportSize().height - thickness;

        break;

    case Placement.NORTH:
        targetX = mainOffset;

        break;

    default:
        targetY = mainOffset;

        break;
}
```

The rest of the method (thickness, `cur`, `scale`, `tx = targetX - cur.x`, `ty = targetY - cur.y`, the returned `translate(...) scale(...)`) is unchanged.

### Edge → target, worked

Main axis is the along-rail direction; `off` is `handleMainAxisOffset(this)`. Cross-axis values are exactly today's; only the main-axis column changes from a constant `0` to `off`.

| Edge  | Orientation | Main axis | `targetX`             | `targetY`              |
|-------|-------------|-----------|-----------------------|------------------------|
| WEST  | vertical    | Y         | `0`                   | `off`                  |
| EAST  | vertical    | Y         | `vpWidth - thickness` | `off`                  |
| NORTH | horizontal  | X         | `off`                 | `0`                    |
| SOUTH | horizontal  | X         | `off`                 | `vpHeight - thickness` |

Second handle on a WEST rail, first handle 30px tall, 5px gap → `off = 0 + 30 + 5 = 35` → `targetY = 35`, `targetX = 0`: the window flies to the left edge, 35px down — onto its handle — instead of the top-left corner.

---

## Ordered Implementation Steps

1. **`Rail.ts` — import `BoxLayout`.** Add `import { BoxLayout } from "~/layout/BoxLayout.js";` beside the existing `HBox` / `VBox` imports. Verify: `grep -n 'BoxLayout' Rail.ts` shows the import.
2. **`Rail.ts` — add `handleSpacing` (private) and `handleMainAxisOffset` (public)** per *Implementation*, placed near the other geometry helpers (`isVertical`, `restingRect`). `AbstractWindow` is already imported as a type (line 18); `Component` is imported (line 3).
3. **`AbstractWindow.ts` — rewrite the `railGenieTransform` switch** per *Implementation*: compute `mainOffset` before the switch, assign the main-axis target in every branch (including `default`). Leave scale, `cur`, and the `translate`/`scale` return untouched.
4. **Typecheck:** `npm --prefix packages/lib run typecheck` (or the repo's typecheck script) — expect no errors.
5. **Write the offline transform-string tests** (see *Expected Behaviour* / *Verification*) in `packages/lib/tests/overlay/Rail.test.ts` and make them pass.
6. **Full check:** run the lib test suite; then the manual smoke test.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `packages/lib/src/typescript/lib/overlay/Rail.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/tests/overlay/Rail.test.ts` |

---

## Expected Behaviour

`railGenieTransform` is private and returns a string; the string is pure geometry and is unit-testable offline by casting the window to reach the method. `handleMainAxisOffset` is public and directly testable. The genie *playback* is visual and stays manual-verify.

Handles are created synchronously without running the genie by registering an **already-minimized** window: `registerWindow` (reached via `AbstractWindow.setRail`) calls `showWindowHandle` immediately when `window.isMinimized()` is true.[^sync-handles] The setup per case: `installTestDOM`, mount the rail, give each window a rect, `window.minimize()` then `window.setRail(rail)` to seed its handle, then `rail.flushLayout()` so handle positions commit before the assertion.[^flush]

Unit-testable (offline transform string / offset):

1. **Single handle targets the corner (offset 0).** One window minimized into a WEST rail: `handleMainAxisOffset` returns `0`; the transform's `translate` main-axis (Y) target resolves to `0 - cur.y`. This is the one case the old code already got right.
2. **Nth handle targets its own offset, not 0 — restore path.** Three windows minimized into a WEST rail (three handles laid out). For the third window `handleMainAxisOffset` equals that handle's `getY()` (> 0), and `railGenieTransform` puts `targetY` there — not at `0`.
3. **Collapse path predicts the append slot.** Two windows minimized (two handles), a third window attached but **not** minimized (no handle yet). `handleMainAxisOffset(third)` equals `lastHandle.getY() + lastHandle.getHeight() + spacing`, i.e. below both existing handles — the slot the third handle will occupy.
4. **EAST keeps the cross-axis, gains the main-axis.** On an EAST rail the Nth window's transform has `targetX = viewportWidth - thickness` (unchanged) **and** `targetY = handleOffset` (new).
5. **NORTH / SOUTH move along X.** On a SOUTH rail the Nth window's transform has `targetX = handleOffset` and `targetY = viewportHeight - thickness`; on NORTH, `targetX = handleOffset` and `targetY = 0`.
6. **Empty rail returns 0.** `handleMainAxisOffset` on a window whose rail has no handles returns `0` (no throw).

Manual-verify (visual, not offline-exercisable):

7. **Each window genies to its own handle.** Minimize two or three windows into one rail (dev server, `npm run dev`): each window shrinks toward its own handle in the stack, not all toward the corner. Restore each: it grows back out of its own handle. Repeat on all four edges.

---

## Verification

- **Typecheck** clean.
- **Unit tests** for cases 1–6 in `packages/lib/tests/overlay/Rail.test.ts`, following the drive-through-layout-then-read-private-state pattern of the existing geometry tests (e.g. `packages/lib/tests/component/layout/Tab.dockraise.test.ts`). Cast the window to reach `railGenieTransform`; call `rail.handleMainAxisOffset(window)` directly for the offset cases. Assert on the parsed `translate(tx, ty)` numbers.
- **`grep -n 'targetY = 0' AbstractWindow.ts`** around `railGenieTransform` — expect the main-axis target to be `mainOffset` in every branch, no lingering `0` main-axis assignment.
- **Manual smoke test** case 7 on the dev server, all four edges, with two or three windows.
- **`npm run docs:build`** — the new `handleMainAxisOffset` JSDoc must not `{@link}` any private/internal symbol (it doesn't); expect zero warnings.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — `railGenieTransform` (2028), `animateRailCollapse` (2070), `animateRailExpand` (2094), the minimize state branch (1008, 1033), and the dock precedent `computeDockRect` (2008) / `computeDockSlotIndex` (2134).
- [`packages/lib/src/typescript/lib/overlay/Rail.ts`](packages/lib/src/typescript/lib/overlay/Rail.ts) — handle layout (`mount` installs `VBox`/`HBox`, 787), `showWindowHandle` (1042), `registerWindow` (983), `restingRect` (1161), `getThickness` (402), `isVertical` (1148).
- [`packages/lib/src/typescript/lib/overlay/RailHandle.ts`](packages/lib/src/typescript/lib/overlay/RailHandle.ts) — handles are content-sized `Button`s (variable main-axis extent).
- [`packages/lib/src/typescript/lib/layout/BoxLayout.ts`](packages/lib/src/typescript/lib/layout/BoxLayout.ts) — `getComponentSpacing` (167), default spacing `5` (110).
- [`packages/lib/tests/overlay/Rail.test.ts`](packages/lib/tests/overlay/Rail.test.ts) — existing suite; its header note that genie geometry is manual-verify is superseded for the transform-string cases.

---

## Non-Goals

- **No change to handle ordering or the collapse/expand animation feel** — only the target coordinate moves.
- **No exact viewport composition of the rail's 1px border** — the main-axis offset is accurate to within the rail's border, imperceptible in the animation.[^one-px]
- **Collapsed-rail exactness is not pursued.** When the rail is collapsed its handles are hidden and `getThickness` returns the collapsed strip width; a genie played into a collapsed rail targets the last laid-out handle geometry, an accepted approximation.
- **No uniform-slot model** — rejected because rail handles vary in size (see [^why-measure]).

---

## Notes

[^ask-the-rail]: `railGenieTransform` already holds `const rail = this._rail as Rail` and calls `rail.getThickness()` / `rail.getEdge()`; `handleMainAxisOffset` is one more query on the same public surface. The alternative — the window walking the rail's `_windows` map or child handles itself — is barred by ARCHITECTURE.md ("a component must not reach into another component's internals"). `Rail` is imported into `AbstractWindow` as a type only (line 18); the method is invoked on the runtime instance in the `_rail` field, so no import change is needed.

[^collapse-ordering]: In `setWindowState` the rail-minimize branch (line 1033) calls `animateRailCollapse(onDone)`, whose `to` style is `railGenieTransform()` computed synchronously (line 2082). The handle is created only when `onDone` runs `this.emit("minimize")` (line 1041) → `Rail.registerWindow`'s `onMinimize` → `showWindowHandle` (line 1042), which `addComponent`s the handle. `onDone` fires on animation completion, after the transform was built. So at collapse-transform time the window has no handle and the offset must be predicted. On restore, `animateRailExpand` is called at line 1010 *before* `emit("restore")` (line 1071) removes the handle, so there the handle is still present and its position is read directly.

[^single-source]: Both `animateRailCollapse` (line 2082) and `animateRailExpand` (line 2103) use `railGenieTransform()` as their collapsed keyframe, so the collapse and its reverse must agree on the target. Putting the present/absent branch inside `handleMainAxisOffset` keeps `railGenieTransform` a single builder both call, rather than splitting into collapse-specific and expand-specific transforms that could drift apart.

[^why-measure]: A `RailHandle` is a chromeless `Button` whose main-axis extent is its content size — longer titles make taller (vertical rail) or wider (horizontal rail) handles, and rotated-text orientations (`vertical-cw` / `vertical-ccw`) vary it further. A uniform `index * (extent + gap)` — the dock's model, valid there because every dock slot is one fixed `dockWidth` — would misplace the target whenever handles differ in size. Reading each handle's laid-out `getY`/`getHeight` (or `getX`/`getWidth`) uses the layout manager's actual output, so the target follows the real stack. It also avoids re-deriving `VBox`/`HBox` placement math in a second place. The cost is that the predict-append branch reads committed geometry, so it needs a laid-out rail — true in production (prior handles were laid out frames earlier) and forced in tests via `flushLayout`.

[^one-px]: A child's `getY()` / `getX()` is measured from its parent's content box, which sits one border-width (the rail's 1px divider) inside the rail's border box. The rail's border box rests at viewport main-axis `0`, so the handle's viewport main-axis position is its `getY`/`getX` plus ~1px. The genie is a scale-and-fade into a handle; a 1px difference in the landing point is invisible, and the existing cross-axis code already treats the rail edge as exact without a border term.

[^sync-handles]: `registerWindow` (line 983) ends with `if (window.isMinimized()) { this.showWindowHandle(window); }`, and `AbstractWindow.setWindowState` sets `this._options.windowState = state` (line 1003) before any animation, so `isMinimized()` is true synchronously after `minimize()`. Thus `window.minimize()` then `window.setRail(rail)` seeds the handle with no genie playback — the offline test never depends on animation completion (the test DOM reports `prefers-reduced-motion: false`, so `Animation.play` would otherwise complete asynchronously).

[^flush]: `scheduleLayout` (Component.ts line 5152) defers to an animation frame; `flushLayout` is its synchronous escape hatch (noted at Component.ts line 5149). Handle positions (`getY`/`getX`) are only committed after a layout pass, so the test calls `rail.flushLayout()` after seeding handles and before reading the transform.

---

## Implementation Notes

### Follow-up: centre the window along the handle's length (not just its offset)

After the original fix landed, the window still minimized to the **leading corner** of its handle rather than the handle's centre along the rail. This follow-up centres it along the handle's length, on user request. The cross axis is deliberately left alone — the scaled window already fits the rail thickness, and adding a cross-axis shift would push it half outside the rail.

- New public `Rail.handleMainAxisExtent(window)` reports the handle's main-axis length: measured when the handle exists (restore, or an already-minimized window), predicted from the current last handle on the collapse path (siblings run close in size), and `0` for an empty rail (no sample) — where the caller keeps the window at the slot's leading edge.
- `railGenieTransform` now aims the window's own centre at the handle's centre: `mainTarget = mainOffset + (handleExtent − scaledMain) / 2`, where `scaledMain` is the shrunken window's main-axis size. When `handleExtent` is `0` it falls back to `mainOffset`.
- The offline tests assert the true contract — the window's scaled main-axis centre coincides with the handle's centre — by reading the parsed transform, the window's live `getRect()`, and the measured handle geometry, never the implementation's own formula.
- Limitation: the very first minimize into an empty rail has no handle to sample, so that one window stays at the slot's leading edge; every subsequent minimize and every restore centres. The collapse-path prediction is exact only when the new handle matches its predecessor's length.
