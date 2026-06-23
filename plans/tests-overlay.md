# Overlay Subsystem Test Coverage — Implementation Plan

## Overview

This plan adds Vitest coverage for `src/typescript/lib/overlay/` (~19 files) plus the core
[`LayerManager`](../src/typescript/lib/core/LayerManager.ts) that overlays drive. These are DOM-heavy,
stateful components with positioning math — unlike the pure-layout work already covered under
[`tests/component/layout/`](../tests/component/layout/). The tests run on the offline DOM harness
[`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) via `installTestDOM(...)` under the
`// @vitest-environment jsdom` pragma, using the `~/...` import alias as the existing suites do
([`tests/component/layout/Anchor.test.ts`](../tests/component/layout/Anchor.test.ts) is the closest template).

The dominant constraint is the harness's read/write seam, and the plan is built around it. The modelled
read source ([`ModelledDOMSource`](../tests/dom/TestDOM.ts#L310)) answers component geometry from committed
layout state (`getViewportRect`), but returns a **zero rect** for arbitrary elements
([`getElementRect`](../tests/dom/TestDOM.ts#L352) → `makeRect(0,0,0,0)`), `[]` for
[`elementsFromPoint`](../tests/dom/TestDOM.ts#L563), `false` for [`contains`](../tests/dom/TestDOM.ts#L453),
and the recording write sink ([`RecordingDOMSink`](../tests/dom/TestDOM.ts#L123)) **records** `dispatchEvent`
without invoking any listener. Therefore real event choreography and anchor-element geometry are off-limits
offline; pure positioning math, state machines, and selection models that take explicit numeric inputs are
the high-value targets.

This is a **test-authoring** plan: it adds only files under `tests/`, touching no `src/`.

---

## Methodology — Assert the contract, never the current output

This is the single most important rule for every target below, stated once here and repeated per target.

- **Derive each expectation from the documented contract** (the JSDoc / type union / method comment), not
  from what the code currently returns. Write the assertion you believe *should* hold, then run it.
- **On divergence, STOP and investigate** whether the bug is in your expectation or in the code. Read the
  call chain; do not silently rewrite the assertion to match observed output.
- **Surface a real divergence with `it.fails(...)`** plus a comment explaining the contract clause the code
  violates and the file:line of the suspect logic. Never delete or weaken a test to make a suite green, and
  never golden-snapshot whatever the code happens to emit.
- **Assert structural / relational invariants, not pixel goldens.** Prefer "the resolved placement is
  `"top"`", "stack order is `[a, b]`", "the `selection` event fired once with button `b`", "`focusedIndex`
  wrapped to 0 skipping the separator" — over exact x/y geometry. Where a coordinate *is* the contract
  (e.g. a viewport clamp flooring to 0), assert the relation (`x >= 0`, `x === vp.width - w - margin`), not a
  magic constant copied from the source.

A shared `CONFIG` object (rootMountOffset `{0,0}`, viewport `{1280,800}`, `scrollBarWidth 15`, the baked
`font-metrics.test-font.json`, empty `themeVars`) and an `afterEach(() => DOM.reset())` mirror
`Anchor.test.ts`. Bracket access (`(obj as any).privateMethod(...)`) reaches private positioning helpers —
TypeScript permits it and it keeps the test honest to the real algorithm rather than a re-implementation.

---

## Triage — value per test

The harness seam splits the subsystem cleanly. Targets are ranked by how much real, contract-derived behaviour
can be asserted offline without re-implementing the algorithm in the test.

### Tier 1 — High value (pure logic / explicit-input math; assert fully)

| Target | What is testable offline | Why it is reachable |
|---|---|---|
| `LayerManager` | register/unregister stack order, band-based z-stamp ordering, nested-vs-root parenting, `bringToFront` re-stamp + `onZIndexChanged`/`onActivate` callbacks, `getTopLayer`, dismiss-mode dispatch via the **internal** `handleOutside` snapshot walk, Escape skipping `manual` | Pure tree/stack state; the only DOM touch is `contains` (false offline) and listener install, both side-effect-free for the state assertions. Drive dismissal with fake `DismissableLayer` stubs whose `getDismissMode`/`getLayerElement`/`requestClose` are plain functions. |
| `Popover.resolvePlacement` | `"auto"` picks the side with most space; explicit side honoured when it fits; explicit side **flips to opposite** + warns when it overflows; "fits" pool vs "most-space" fallback | Private method takes **explicit** `(anchorRect, width, height, vp)` args — bypass the zero `getElementRect` by passing a synthetic `Rect`. Bracket-access it. |
| `Tooltip.show` | width = `min(MAX_WIDTH, widestLine + H_PADDING)`; multi-line height = `lineCount*perLine + V_PADDING`; single-line height floored to `ITEM_HEIGHT + V_PADDING`; clamp `x/y` to `>= 0` and `<= vp - size`; line-count derivation when text exceeds `MAX_WIDTH` | `show(text, x, y)` takes explicit coords; text width/height come from the baked-font `measureText`/`measureTextWidth`, which the modelled source backs. No anchor rect involved. |
| `Menu.placeVertically` | grows down from `growTop` when content fits below or room-below ≥ room-above; flips up against `anchorTop` otherwise, returning `anchorTop - min(total, roomAbove)`; height-clamp side-effect | Private, all-numeric inputs `(growTop, anchorTop, totalHeight, viewportHeight)`. Bracket-access it; assert returned top **and** the `getMaxSize().height` clamp it applied. |
| `Menu` focus navigation | `focusNext`/`focusPrev` wrap around and **skip separators**; `activateFocused` no-ops on disabled/separator/out-of-range; `getFocusedIndex`; mode-guard throws (`assertRebuildMode`/`assertPersistentMode`) | Persistent-mode `Menu([...], onClose)` builds items in the constructor (no DOM needed for the index math). Use configs mixing items, `{separator:true}`, and a disabled item. |
| `ButtonGroup` selection model | mutual exclusivity (selecting one deselects siblings); `selection` event fires once with the initiator; re-selecting the already-selected initiator re-selects it (the `!isSelected` branch); `addButtons` flattening; `removeButton` unregister; RadioButton members get the shared `radioName` | `setSelected`/`isSelected` are pure state. The `on("action")` trigger is a DOM `click` the harness won't dispatch, so drive selection by bracket-accessing the private `updateButtonStates(button)` — the same method the action listener calls. Assert the model effect, not the event plumbing. |

### Tier 2 — Moderate value (state transitions with a thin DOM dependency)

| Target | What is testable | Caveat |
|---|---|---|
| `Popover` open/close lifecycle | `isOpen()` false→true on `show()`→false on `hide()`; `show()` with no anchor warns and is a no-op; `hide()` while closed is a no-op; `setPlacement`/`getPlacement`, `setDismissOn`/`getDismissOn`, `showArrow` round-trips; `getDismissMode` maps 1:1 onto `LayerDismissMode`; `getBand` = `Band.Popover`; `requestClose` runs `hide` | `show()` calls `getElement(true)`, `LayerManager.register`, and `_reposition` (which reads the zero anchor rect → would `hide()` on the `width===0 && height===0` guard). **Test `show()` by attaching a real component anchor** whose committed geometry the oracle *can* report via `getViewportRect`? No — `_reposition` uses `getElementRect(handle)`, not `getViewportRect(component)`, so the anchor reads zero and the popover self-closes. Scope Tier-2 Popover to the **non-positioning** lifecycle/getter-setter contract and the `resolvePlacement` unit (Tier 1); do **not** assert post-`show` coordinates. |
| `Notification` | enqueue/dismiss/auto-dismiss-timer state, stacking order of the queue, max-visible cap | Read the source first to confirm which state is DOM-free; assert the queue model, not rendered offsets. |
| `Dialog` | `getDismissMode()` returns `"modal"`; `getBand()` = `Band.Dialog`; open/close `isOpen`-style flag; `requestClose` honouring modal semantics | Modal layers are DOM-light for these getters; defer focus-trap and backdrop geometry. |
| `Drawer` | edge/side option round-trips, open/close state flag, `getDismissMode`/`getBand` | Slide transform geometry is animation-driven — assert the resolved side + open flag, not transform px. |
| `ReorderIndicator` / `DragFeedback` / `DragGhost` / `DropZoneOverlay` | constructor defaults (z-index band, height, pointer-events), `setInsertionY` centring (`y - BAR_HALF`), `attachTo` width-mirror & idempotent re-attach guard, `detach` | Small, mostly pure. `attachTo` reads `target.getWidth()` (committed state — fine) and `getParentElement` (zero offline, so the idempotency early-return won't trigger — assert the first attach, note the guard is unverifiable offline). |
| `RailHandle` / `windowControls` / `Dock` / `Rail` selection-state slices | enumerate per-file; pick only the DOM-free state setters/getters and any pure geometry helper | These are large window-management files; cherry-pick verifiable units, do not attempt full coverage. |

### Tier 3 — Low value offline (honestly scoped out; document why)

| Target | Why deferred |
|---|---|
| `DragManager` move/drop/drag-start state machine | Entry is `onSourceMouseDown` via `addMouseDownSubtreeListener` + viewport `mousemove`/`mouseup`; the harness **records** `dispatchEvent` without invoking listeners, so the gesture cannot be driven. `pickDropTarget` depends on `elementsFromPoint` (returns `[]`), so drop-target hit-testing is structurally untestable offline. **Only** `isDragging()` (false at rest), `cancel()` no-op when idle, and `makeDragSource`/`makeDropTarget` registry-add + teardown closure are assertable. Cover those; flag the rest as needing a real-DOM (jsdom-event or browser) harness in `## Non-Goals`. |
| `AbstractWindow` / `Window` / `TabWindow` drag-resize choreography | 2430-line `AbstractWindow`; resize/move depends on pointer events + `getElementRect`. Cover only DOM-free getters/setters and `LayerManager` integration getters (`getBand` = `Band.Window`, `isLayerRoot` = true, `getDismissMode` = `"manual"`). Defer the choreography. |
| Animation timing, fade re-entrancy, real focus trapping | Driven by `Animation`/`requestAnimationFrame` (the sink records rAF as a no-op returning 0) and real focus, neither modelled offline. |

---

## Per-target test specifications

Each subsection lists the file to create, the contract clauses to assert, and the harness mechanics that make
them reachable. Methodology rule applies to every one: assert the contract, surface divergence with
`it.fails`.

### `tests/overlay/LayerManager.test.ts`

`LayerManager` is a module-singleton namespace, so **state leaks between tests** — every test must
`unregister` every layer it registered (an `afterEach` that drains by re-registering nothing and calling
`unregister` on a tracked set). The cleanest fixture is a `fakeLayer(opts)` factory returning a
`DismissableLayer` stub: `getLayerElement` returns a minted handle (or `null`), `getDismissMode` returns a
chosen mode, `requestClose` is a `vi.fn()`, and optional `onActivate`/`onZIndexChanged`/`getBand`/`isLayerRoot`.

Contract assertions:
- `register` pushes onto the stack; `getTopLayer()` returns the last registered.
- Duplicate `register(layer)` is a no-op (no double-push) — assert `getTopLayer` unchanged and the second
  call does not bump `getZIndex`.
- z-stamp ordering: two peers in the same band get **ascending** `getZIndex` in register order; a
  `getBand` → `Band.Window` peer stamps below a `Band.Dialog` peer.
- Nested vs root: a layer **without** `isLayerRoot` registered while another is topmost inherits the topmost's
  band (assert same band base) and lands above it (higher z). A layer **with** `isLayerRoot: true` registers
  as a root (its own band).
- `bringToFront(layer)` re-stamps the layer's subtree from a fresh counter run (assert new z > old z and
  `onZIndexChanged` was called with it) and marks it active (`onActivate(true)` on the raised layer,
  `onActivate(false)` on the previously-active).
- `unregister` pops, unlinks from parent's children, and clears active if it was active.
- Dismiss dispatch via the internal `handleOutside`: because `contains` is false offline, **every** target is
  "outside" — assert that a `"click-outside"`/`"blur"` layer's `requestClose` fires on an outside pointer pass,
  a `"manual"`/`"modal"` layer's does not, a `"modal"` layer **shields** lower layers (their `requestClose`
  does not fire), and the `focusOnly` pass acts only on `"blur"`. Reaching `handleOutside` may require
  bracket-access into the namespace's private function or driving it through `onPointerDown` — confirm which
  is exported-enough; if neither is reachable, assert dismissal through whatever public seam exists and note
  the limit. Escape via `onKeyDown` skips `"manual"` and closes the topmost non-manual.

### `tests/overlay/Popover.test.ts`

- **Placement unit (Tier 1):** bracket-access `resolvePlacement(anchor, width, height, vp)` with synthetic
  `Rect`s. Cases: centred anchor in a roomy viewport with `"auto"` → side with most space; anchor pinned to
  the bottom edge with `"auto"` → `"top"`; explicit `"top"` that fits → `"top"`; explicit `"top"` with no room
  above → `"bottom"` (and assert the `console.warn` fired via `vi.spyOn(console,'warn')`); a viewport where no
  side fits → the most-absolute-space side. Build the synthetic `Rect` with the `makeRect`-style derived edges
  (`top/left/right/bottom`) so `resolvePlacement`'s `anchor.bottom`/`anchor.right` reads are valid.
- **Lifecycle/getters (Tier 2):** `isOpen` false initially; `show()` with no anchor warns + stays closed
  (`isOpen()===false`); `setPlacement/getPlacement`, `setDismissOn/getDismissOn`, `setShowArrow/isShowArrow`,
  `setTitle/getTitle/clearTitle`, `setBody/getBody`, `addAction`/`clearActions` round-trips; `getDismissMode`
  returns the `dismissOn` value; `getBand` === `LayerManager.Band.Popover`; `getDismissMode` union maps 1:1
  onto `LayerDismissMode`. Do **not** assert post-`show` x/y (anchor reads zero → self-close).

### `tests/overlay/Tooltip.test.ts`

`Tooltip` is a singleton with static state (`instance`, `showTimer`, `dismissing`) — `DOM.reset()` does not
clear it, so guard against cross-test bleed (the instance persists; assert via fresh `show` calls and clear
`showTimer` in teardown). Use `vi.useFakeTimers()` if any test touches the 500ms `attach` delay (scope that to
one test; most assert `show` directly).
- Short label: width === `min(MAX_WIDTH, widestLine + H_PADDING)` (derive `widestLine` from the baked font, not
  a magic number — measure the same string with `Util.measureTextWidth` in the test, or assert the relation).
- Single line: height === `max(lineCount*perLine + V_PADDING, ITEM_HEIGHT + V_PADDING)`.
- Multi-line (`"a\nb\nc"`): width hugs the widest line; height tracks 3 lines.
- Over-wide text (a string whose width exceeds `MAX_WIDTH`): width caps at `MAX_WIDTH`; `lineCount` derives from
  the wrapped `measureText({maxWidth})` height — assert `> split-count`.
- Clamp: `show(text, -100, -100)` floors x and y to `>= 0`; `show(text, hugeX, hugeY)` clamps to
  `vp.width - width` / `vp.height - height`. Assert the relations, not constants.

### `tests/overlay/Menu.test.ts`

- **Mode guards:** `new Menu()` (rebuild) → `open`/`close`/`focusNext`/`getFocusedIndex` throw with the
  documented message; `new Menu([...], onClose)` (persistent) → `show`/`hide`/`setMenuWidth`/`toggleFor` throw.
- **`placeVertically` (Tier 1):** bracket-access with numeric inputs. Content fits below → returns `growTop`,
  clamps max-height to `roomBelow`. Content overflows below **and** more room above → returns
  `anchorTop - min(total, roomAbove)`, clamps to `roomAbove`. Room-below ≥ room-above tie → grows down. Assert
  both the returned top **and** `getMaxSize().height`.
- **Focus navigation (persistent):** build configs `[item, {separator:true}, item, disabled-item]`. `focusNext`
  from -1 lands on 0; from the last item wraps to 0; lands past a separator (skips index 1). `focusPrev`
  mirrors. `activateFocused` invokes the item's action when enabled, no-ops on separator/disabled/out-of-range
  (assert via a `vi.fn()` action). `getFocusedIndex` reflects the moves.
- Note: `show()`/`open()` clamp math (the `left`/`top`/`available` computation, lines 211-217) is reachable
  with explicit `x/y` and the modelled `getViewportSize`, but it also touches `getElement(true)`/`fadeIn`/
  `appendChild`. Attempt one `show()` clamp assertion (left/top floored to `VIEWPORT_MARGIN`, capped to
  `vp - width - margin`); if the fade/layout path throws offline, drop to asserting the documented clamp via a
  smaller seam and note it.

### `tests/overlay/ButtonGroup.test.ts`

Construct `RadioButton`/`ToggleButton` members (no `getElement` needed for state). Drive selection by
bracket-accessing `updateButtonStates(button)` — the exact method the (un-dispatchable) `on("action")` listener
calls.
- Selecting an unselected button selects it and **deselects every sibling**; `selection` fires once with that
  button (`on("selection", fn)` + `vi.fn()`).
- Re-running `updateButtonStates` on the already-selected initiator hits the `!isSelected` false branch and
  leaves siblings deselected (the initiator stays selected).
- `addButtons(a, [b, c], d)` flattens nested arrays; `getButtons()` returns all four widened to `Component`.
- `removeButton` drops the member (and, when a container/`RovingTabIndex` was wired, unregisters it).
- RadioButton members receive the shared `radioName` (`getRadioName()` === the group id) after `addButton`.

### `tests/overlay/DragManager.test.ts` (narrow)

Only the DOM-free surface (per Tier 3): `isDragging()` is false at rest; `cancel()` is a no-op when idle
(does not throw, leaves `isDragging()` false); `makeDragSource`/`makeDropTarget` add to the registry and return
a teardown closure that, when called, removes the registration (assert via a second `makeDragSource` on the
same component id behaving as a fresh registration, or by confirming teardown is a stable function). A leading
comment must state that move/drop choreography is untestable offline (recorded-not-invoked events +
`elementsFromPoint` → `[]`) and points to `## Non-Goals`.

### `tests/overlay/overlay-primitives.test.ts` (ReorderIndicator / DragFeedback / DragGhost / DropZoneOverlay)

Constructor-default and pure-helper assertions, one `describe` per class:
- `ReorderIndicator`: z-index === `Band.Window - 1`, height === `BAR_HEIGHT`, pointer-events none;
  `setInsertionY(y)` → `getY() === y - 1`; `attachTo(target)` mirrors `target.getWidth()` and sets x to 0.
- `DragFeedback`/`DragGhost`/`DropZoneOverlay`: read each source first; assert documented constructor defaults
  and any pure setter (`setValid` tint flag, ghost offset, zone side). Skip the DOM-attach paths.

### Tier-2 stubs to fill after reading the source

`tests/overlay/Notification.test.ts`, `tests/overlay/Dialog.test.ts`, `tests/overlay/Drawer.test.ts` — each
gets the LayerManager-integration getters (`getBand`, `getDismissMode`, `isLayerRoot` where present) plus the
DOM-free state flags the source exposes. Read the file before writing; assert only what the seam supports.

---

## Architecture Decisions

### Mirror the existing harness fixture verbatim

Reuse the `CONFIG` shape, the `import fontMetrics from '../../dom/font-metrics.test-font.json'` line, the
`installTestDOM(CONFIG)` + `afterEach(() => DOM.reset())` pattern, and `// @vitest-environment jsdom` exactly
as [`Anchor.test.ts`](../tests/component/layout/Anchor.test.ts) does. New overlay tests live under a new
`tests/overlay/` directory (sibling to `tests/component/`), keeping the layout suites untouched.

### Bracket-access private positioning helpers rather than re-implement them

`resolvePlacement`, `placeVertically`, and `updateButtonStates` are private. Testing them directly via
`(instance as any).method(...)` asserts the **real** algorithm against synthetic inputs, which is exactly the
seam the harness leaves open (explicit numeric args bypass the zero `getElementRect`). Re-deriving the math in
the test would only assert the test's own copy. This is a test-only convention, not a source change.

### Fake `DismissableLayer` stubs for LayerManager

`LayerManager` reasons over the `DismissableLayer` *interface*, not concrete overlays. Plain stub objects
(`{ getLayerElement, getDismissMode, requestClose, ... }`) exercise the full tree/stack/dismiss logic without
dragging in `Popover`/`Window` construction, and let a test assert callback invocation with `vi.fn()`.

### Reset module-singleton state defensively

`LayerManager` (module stack), `DragManager` (module registries + `activeSession`), and `Tooltip` (static
instance/timers) hold state `DOM.reset()` does not clear. Each suite's `afterEach` must drain its own
registrations / cancel timers so order-dependent failures don't appear. Where the module exposes no public
drain, unregister/cancel every entity the test created.

---

## Ordered Implementation Steps

1. Create `tests/overlay/` and `tests/overlay/LayerManager.test.ts` (Tier 1, highest value, pure logic). Verify:
   `npx vitest run tests/overlay/LayerManager.test.ts` green (or `it.fails` for any genuine contract divergence,
   commented).
2. `tests/overlay/Popover.test.ts` — `resolvePlacement` unit + lifecycle/getters. Verify suite runs; confirm no
   post-`show` coordinate assertions slipped in.
3. `tests/overlay/Tooltip.test.ts` — `show` sizing + clamp. Verify; clear `showTimer` in teardown.
4. `tests/overlay/Menu.test.ts` — mode guards + `placeVertically` + focus navigation. Verify.
5. `tests/overlay/ButtonGroup.test.ts` — selection model via `updateButtonStates`. Verify.
6. `tests/overlay/overlay-primitives.test.ts` — constructor defaults + pure helpers. Verify.
7. `tests/overlay/DragManager.test.ts` — narrow registry/idle surface with the scoping comment. Verify.
8. Tier-2 stubs (`Notification`/`Dialog`/`Drawer`) after reading each source. Verify.
9. Full run: `npx vitest run tests/overlay/` — all green, every `it.fails` annotated with the contract clause
   and suspect file:line.

Each step is independent (separate files); land and verify one before the next.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `tests/overlay/LayerManager.test.ts` |
| Create | `tests/overlay/Popover.test.ts` |
| Create | `tests/overlay/Tooltip.test.ts` |
| Create | `tests/overlay/Menu.test.ts` |
| Create | `tests/overlay/ButtonGroup.test.ts` |
| Create | `tests/overlay/overlay-primitives.test.ts` |
| Create | `tests/overlay/DragManager.test.ts` |
| Create | `tests/overlay/Notification.test.ts` |
| Create | `tests/overlay/Dialog.test.ts` |
| Create | `tests/overlay/Drawer.test.ts` |

No `src/` files change.

---

## Verification

- `npx vitest run tests/overlay/` — every suite passes; each `it.fails` carries a comment naming the violated
  contract clause and the suspect source `file:line`.
- `npx vitest run` — the whole repo suite stays green (no shared-singleton bleed from the new suites into
  existing tests, especially `LayerManager`/`Tooltip` static state).
- Spot-check: grep the new files for golden geometry constants copied from source
  (`grep -rn 'toBe([0-9]' tests/overlay/`) — every numeric assertion should be a derived relation or a
  documented contract constant (`BAR_HEIGHT`, `VIEWPORT_MARGIN`), not a magic positioning px.
- Confirm no new file imports from `src/` outside the `~/...` alias and that each carries the
  `// @vitest-environment jsdom` pragma.

---

## Potential Challenges

- **Singleton state bleed** — `LayerManager`/`DragManager`/`Tooltip` persist across tests; mitigate with
  draining `afterEach`s that undo every registration/timer the test created.
- **`handleOutside` reachability** — it is a private namespace function; if neither it nor `onPointerDown` is
  reachable for a focused dismiss test, assert dismissal through the nearest public seam and document the gap
  rather than forcing access.
- **Tooltip fake timers** — only the `attach` 500ms-delay test needs `vi.useFakeTimers()`; isolate it so
  real-timer `show` tests aren't affected.
- **`Menu.show()` offline fragility** — the full `show()` path touches `fadeIn`/layout/`appendChild`; if it
  throws offline, fall back to asserting the documented clamp through `placeVertically` + the explicit clamp
  formula and note the limitation in-file.
- **`Popover.show()` self-close** — `_reposition` reads the zero `getElementRect`, tripping the
  `width===0 && height===0` guard that calls `hide()`; do not assert open-state geometry after `show`.

---

## Critical Files

- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — the seam: what `getElementRect` (zero),
  `elementsFromPoint` (`[]`), `contains` (false), `measureText` (baked), `dispatchEvent` (recorded, not
  invoked), and `getViewportSize` actually return offline.
- [`tests/component/layout/Anchor.test.ts`](../tests/component/layout/Anchor.test.ts) — the fixture template
  (CONFIG, `installTestDOM`, `afterEach DOM.reset`, `// @vitest-environment jsdom`).
- [`src/typescript/lib/core/LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — the
  `DismissableLayer` contract, band constants, and `handleOutside` dismiss logic.
- [`src/typescript/lib/overlay/Popover.ts`](../src/typescript/lib/overlay/Popover.ts#L691) —
  `resolvePlacement` and the dismiss-mode mapping.
- [`src/typescript/lib/overlay/Tooltip.ts`](../src/typescript/lib/overlay/Tooltip.ts#L142) — `show` sizing /
  clamp math.
- [`src/typescript/lib/overlay/Menu.ts`](../src/typescript/lib/overlay/Menu.ts#L657) — `placeVertically`,
  focus navigation, mode guards.
- [`src/typescript/lib/overlay/ButtonGroup.ts`](../src/typescript/lib/overlay/ButtonGroup.ts#L78) —
  `updateButtonStates` selection model.
- [`src/typescript/lib/overlay/DragManager.ts`](../src/typescript/lib/overlay/DragManager.ts) — the
  event-driven surface that is **not** testable offline (justifies the Tier-3 scoping).

---

## Non-Goals

- **DragManager gesture choreography** (drag-start threshold, ghost follow, target enter/leave, drop) — needs a
  real-event harness; the offline sink records `dispatchEvent` without invoking listeners and `elementsFromPoint`
  returns `[]`. Out of scope until a jsdom-event or browser harness exists.
- **Anchor-relative positioning through the public `show()` path** (Popover/Menu/Window) — `getElementRect`
  returns zero offline, so post-show coordinates are meaningless. The positioning *math* is covered via the
  private helpers with synthetic rects instead.
- **Window/AbstractWindow/TabWindow drag-resize and snap-docking choreography** — pointer-driven; only the
  DOM-free getters and LayerManager-integration hooks are covered.
- **Animation timing, fade re-entrancy, focus trapping** — driven by `Animation`/rAF (recorded as no-ops) and
  real focus, neither modelled offline.
- **Golden DOM-geometry snapshots** — explicitly rejected by the methodology; assert structural/relational
  invariants only.
