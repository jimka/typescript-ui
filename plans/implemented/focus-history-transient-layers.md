---
depends-on: [modal-dialog-focus-trap]
touches-shared:
  - packages/lib/src/typescript/lib/core/LayerManager.ts
  - packages/lib/src/typescript/lib/core/FocusHistory.ts
  - packages/lib/tests/overlay/LayerManager.modalFocus.test.ts
  - packages/lib/tests/unit/core/FocusHistory.test.ts
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/concepts/layering.md
  - packages/lib/docs/components/Dialog.md
  - packages/lib/docs/components/Drawer.md
  - packages/lib/docs/components/Menu.md
  - packages/lib/docs/reference/changelog/next.md
---

# Focus History Stops and Transient Layers — Implementation Plan

## Overview

[`FocusHistory`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L284) is the optional service behind `Alt+[` (back) and `Alt+]` (forward), its two *accelerators*. It keeps a *trail*: the list of elements keyboard focus has been on, oldest first. Each entry is a *stop*, and the *current stop* is the entry the trail's position points at. In the examples below a trail is written `[A, B*, C]`, with `*` on the current stop. Walking the trail *reveals* a stop before focusing it: the tab it lives in is selected, a collapsed region is expanded, and it is scrolled into view.

Today the trail records every focus move outside a table cell. That includes the panel of a context menu opened from the keyboard, and every control of a dialog, drawer, popover or dropdown. Measured in Chromium and under jsdom, this has four effects (full list in [Addendum: What the trail does today](#addendum-what-the-trail-does-today)):

- After a menu or dialog closes, its opener is in the trail twice, so one `Alt+[` press lands on the control focus is already on.
- Opening a menu or dialog drops the forward part of the trail.
- With a menu or dropdown open, `Alt+[` moves focus to another control of the page and leaves the menu or dropdown open.
- After a popup or drawer closes with focus inside it, `Alt+[` skips the control that opened it.

This plan changes what counts as a stop. Two terms from [`LayerManager`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L25) are used throughout. A *transient layer* is a registered layer that an outside click or focus move dismisses: its `getDismissMode()` is `"click-outside"` or `"blur"` (a menu, a dropdown, a popup panel, most popovers). A *modal layer* is one whose mode is `"modal"` (every `Dialog`, and a `Drawer` built with `modal: true`). A window, a non-modal drawer and a `"manual"` popover are neither.

After the change, only a control of the page, a window, a non-modal drawer or a `"manual"` popover is a stop. Nothing inside a transient or modal layer is recorded, and `Alt+[` / `Alt+]` do nothing while one is open. The change is in `core/FocusHistory.ts`, plus one new query on `LayerManager`. No component changes. SQLAdmin does not enable `FocusHistory` (no reference in its `frontend/src`), so no application change follows.

Line numbers in this plan are those of commit `27c9b7157`, the tip of `feature/scroll-reveal-geometry-fixes`.

---

## Architecture Decisions

### A stop is a place that stays — a transient or modal layer is not one

A focus move is recorded only when its target is a stop. The four tests below run in this order, in one new function `isHistoryStop(handle)`; the first that matches decides.[^why-not-record]

| # | The focused element… | Stop? |
|---|---|---|
| 1 | is `<body>` or `<html>` | no |
| 2 | is a table cell or inside one (today's rule, unchanged) | no |
| 3 | gets focus while any modal layer is open | no |
| 4 | is inside a transient layer | no |
| — | anything else | yes |

Worked cases:

| Focus lands on | Stop? | Rule |
|---|---|---|
| a button on the page | yes | — |
| a field in a non-modal `Window`, a non-modal `Drawer`, or a `Popover` with `dismissOn: "manual"` | yes | — |
| a button on the page while a mouse-opened menu or a dropdown is open elsewhere | yes | — (the button is not inside the layer) |
| the panel of a context `Menu` opened from the keyboard | no | 4 |
| the `Apply` button inside a `PopupPanel`; a field in a `Popover` with `dismissOn: "click-outside"` or `"blur"` | no | 4 |
| a field in a `Dialog` or a modal `Drawer` | no | 3 |
| a row of a `ComboBox` dropdown opened inside a dialog | no | 3 |
| a table cell, or the editor inside one | no | 2 |
| `<body>`, read as the focused element when `enable()` runs with nothing focused | no | 1 |

This filter follows the one `FocusHistory` already has: [`isInTableCell`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L205), applied in [`onFocusIn`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L236) before `record`. `enable()` records the element that has focus when it is called, the *seed*; the seed goes through the same function.

### `LayerManager.isInTransientLayer(node)` is the test for rule 4

`LayerManager` gains one public query. It returns `true` when the registered layer whose own element contains `node` has dismiss mode `"click-outside"` or `"blur"`. Only that one layer is asked; the layer it was opened from plays no part.[^dismiss-mode]

The query mirrors [`LayerManager.isBehindModal`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L609): a public function that takes `Handle | null` and answers from the private layer tree. It is built on the private [`nodeOwning`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L772), which finds the layer an element lives in.[^own-query]

| Layer | Dismiss mode | `isInTransientLayer` for an element inside |
|---|---|---|
| `Menu`, `ComboBox` and picker dropdowns, `PopupPanel` | `"click-outside"` | `true` |
| `Popover` (default `"click-outside"`, or `"blur"`) | as configured | `true` |
| `Popover` with `dismissOn: "manual"`, `Window`, non-modal `Drawer` | `"manual"` | `false` |
| `Dialog`, modal `Drawer` | `"modal"` | `false` (rule 3 covers these) |
| a non-modal drawer opened from a menu row | `"manual"` | `false`: the menu it was opened from is not asked |

### Nothing inside a modal layer is a stop, and the trail is out of reach while one is open

While any modal layer is open, no focus move is recorded, `Alt+[` / `Alt+]` do nothing, and `back()` / `forward()` return `false` without moving or revealing anything. History made inside a modal therefore does not exist after the modal closes, and the trail is exactly as the modal found it.[^modal-off]

`back()` and `forward()` need no new code for the modal case. Every stop then lies behind the modal, and [`revealAndFocus`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L151) already passes such a stop without revealing it.

### `Alt+[` / `Alt+]` stand down while any modal or transient layer is open

The key handler asks [`LayerManager.hasActiveInputLayer()`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L584), which is `true` while any registered layer's mode is not `"manual"`. While it is `true` the handler returns without navigating and without consuming the key. This is the test [`SpatialNavigation`](../packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L246) uses to stand down, and it replaces today's `hasModalLayer()` test.[^stand-down]

| Open layers | `Alt+[` / `Alt+]` |
|---|---|
| none | walk the trail; key consumed |
| a non-modal window, a non-modal drawer, a `"manual"` popover | walk the trail; key consumed |
| a context menu (opened by key or by mouse), a `MenuBar` panel, a dropdown, a popup panel, a popover | nothing; key not consumed |
| a dialog or modal drawer, with or without a menu or dropdown open above it | nothing; key not consumed |

The functions `back()` and `forward()` are not held back by a transient layer. They walk as usual.[^api-not-gated]

### Closing a layer records nothing

No code is added for a layer closing. When focus returns to the control that opened the layer, that control is already the current stop, and [`record`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L124) ignores a repeat of the current stop. A control that is no stop itself, such as a table cell, is not recorded on the way back either. Because nothing was recorded while the layer was open, the forward part of the trail is still there.

| What happens | Trail before | Trail after |
|---|---|---|
| Shift+F10 on `B` opens a menu; `Escape`; focus returns to `B` | `[A, B*, C]` | `[A, B*, C]` |
| `Enter` on `B` opens a dialog; three `Tab`s inside; `Escape`; focus returns to `B` | `[A, B*, C]` | `[A, B*, C]` |
| A menu row's action focuses field `F` on the page | `[A, B*, C]` | `[A, B, F*]` |
| A `PopupPanel` opened from `B` is closed with focus inside it; focus drops to `<body>` | `[A, B*]` | `[A, B*]` |

### Going back starts at the current stop when focus has left it

`back()` first compares the focused element with the current stop. When they differ, the current stop is the first candidate, not the stop before it. `forward()` is unchanged: its first candidate is always the stop after the current one.[^current-stop]

| Trail | Focus is on | `back()` lands on | Trail after |
|---|---|---|---|
| `[A, B*]` | `B` | `A` | `[A*, B]` |
| `[A, B*]` | a table cell, or `<body>` | `B` | `[A, B*]` |
| `[A, B, D*]`, `D` since removed | `<body>` | `B` | `[A, B*]` |
| `[A*, B]` | a table cell | `A` | `[A*, B]` |

### A walk drops a stop that is gone and keeps one that only refuses focus

The rule is today's, and stays.[^keep-refusing]

| The stop's element… | A walk | The entry |
|---|---|---|
| has left the document, or its handle was released | passes it | is dropped |
| is hidden, disabled, or otherwise does not take focus after the reveal | passes it | is kept |
| is behind a modal layer | passes it without revealing it | is kept |

### Pruning merges a stop repeated next to itself

[`pruneStale`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L90) drops entries whose element is gone. It now also keeps only one of two neighbours that are the same element, which is what a dropped entry between two visits to one control leaves behind.[^collapse]

| Before pruning | After |
|---|---|
| `[A, X, A*]`, `X` gone | `[A*]` |
| `[A*, X, A, C]`, `X` gone | `[A*, C]` |
| `[A, B, A*]`, all live | unchanged |

### `canGoBack` and the `"change"` event describe the trail, not where focus is

Both keep their meaning: `canGoBack` is `true` when a stop exists before the current one. They do not account for the new rule that `back()` can return to the current stop. With a one-stop trail `[A*]` and focus in a table cell, `canGoBack()` is `false` and `back()` still moves focus to `A` and returns `true`.[^flags]

### No other focus mechanism changes

| Mechanism | What it does with focus | Effect on the trail |
|---|---|---|
| [`FocusTraversal`](../packages/lib/src/typescript/lib/core/FocusTraversal.ts) | moves focus itself on `Tab`, inside the topmost layer | each landing passes through `isHistoryStop` like any other |
| `SpatialNavigation` | moves focus on its chords; stands down while a non-`"manual"` layer is open | its landings are on the page or in a window, so they are stops |
| `LayerManager.containTab` | wraps `Tab` inside a modal layer | no stop: a modal is open |
| `Menu` keyboard session | the panel takes focus, returns it to its invoker, and takes it back if the invoker grabs it | the panel is no stop; the return repeats the current stop |
| `Menu.toggleFor`, `PopupPanel.toggleFor`, a `ComboBox` dropdown | the opener keeps focus | nothing to record; the accelerators stand down while the layer is open |
| `CellEditor.retainsFocus` | keeps a cell edit open while focus is in the editor's picker or menu | cells and their editors were never stops |

---

## Public API

`core/LayerManager.ts`, inside `export namespace LayerManager`. No barrel change: `LayerManager` is already exported from `core/index.ts`.

```typescript
/**
 * Returns whether `node` lies inside a transient layer: a registered layer
 * that an outside interaction dismisses, which is one whose dismiss mode is
 * `"click-outside"` or `"blur"` — a menu, a dropdown, a popover. A window or
 * a non-modal drawer (`"manual"`) is not transient, and neither is a modal
 * layer. Only the layer whose own element holds `node` is asked; the layer
 * it was opened from plays no part.
 *
 * @param node - The element to test.
 * @returns `true` when `node` is inside a transient layer; `false` for
 *   `null` and for an element inside no registered layer.
 */
export function isInTransientLayer(node: Handle | null): boolean;
```

`core/FocusHistory.ts`: no signature changes. The behaviour of `enable`, `back`, `forward` and the two accelerators changes as described above. `FocusHistoryOptions`, `FocusHistoryChange` and the `"change"` event are untouched.

---

## Internal Structure

### `core/LayerManager.ts`

Insert after `isBehindModal` (ends at [:617](../packages/lib/src/typescript/lib/core/LayerManager.ts#L617)) and before the JSDoc of `addBackgroundSurface` ([:619](../packages/lib/src/typescript/lib/core/LayerManager.ts#L619)). The JSDoc is the block under `## Public API`.

```typescript
export function isInTransientLayer(node: Handle | null): boolean {
    const owner = node === null ? null : nodeOwning(node);

    if (owner === null) {
        return false;
    }

    const mode = owner.layer.getDismissMode();

    return mode === "click-outside" || mode === "blur";
}
```

Do not touch `handleOutside`, which has the same two-mode test inline at [:984](../packages/lib/src/typescript/lib/core/LayerManager.ts#L984).

### `core/FocusHistory.ts`

New module-level function, placed after `isInTableCell` ([:215](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L215)):

```typescript
/**
 * Whether a focus move onto `handle` is a history stop: a place that stays.
 * `<body>` and `<html>` are what a browser reports when nothing has focus. A
 * table cell holds a position inside a widget, not a place. While a modal
 * layer is open, and inside a transient layer (a menu, a dropdown, a
 * popover), focus is on a surface that is gone once it closes.
 *
 * @param handle - The element focus moved to.
 * @returns True when the move belongs in the trail.
 */
function isHistoryStop(handle: Handle): boolean {
    const tag = DOM.source.getTagName(handle);

    if (tag === "BODY" || tag === "HTML") {
        return false;
    }

    const inCell = isInTableCell(handle);

    if (inCell) {
        return false;
    }

    const modalOpen = LayerManager.hasModalLayer();

    if (modalOpen) {
        return false;
    }

    return !LayerManager.isInTransientLayer(handle);
}
```

`<body>` and `<html>` are tested by tag name, not against `DOM.source.getBody()`.[^body-seed]

`onFocusIn`: replace the `isInTableCell` block ([:236–238](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L236)) with:

```typescript
    const stop = isHistoryStop(handle);

    if (!stop) {
        return;
    }
```

`enable`: replace the seed ([:307–311](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L307)) with:

```typescript
        const active = DOM.source.getActiveElement();

        if (active === null) {
            return;
        }

        const stop = isHistoryStop(active);

        if (stop) {
            record(active);
        }
```

`onKeyDown`: replace the modal test ([:264–268](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L264)) with:

```typescript
    const layerOpen = LayerManager.hasActiveInputLayer();

    if (layerOpen) {
        return;
    }
```

`pruneStale`: replace the loop body ([:95–103](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L95)) with:

```typescript
        const handle = _entries[i];
        const live   = isLiveHandle(handle);

        if (!live) {
            continue;
        }

        if (kept[kept.length - 1] !== handle) {
            kept.push(handle);
        }

        if (i <= _index) {
            newIndex = kept.length - 1;
        }
```

`navigate`: replace `let target = _index + direction;` ([:183](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L183)) with:

```typescript
    // Focus can be somewhere that is no stop: in a table cell, or on <body>
    // after the focused control was removed. Going back from there returns to
    // the current stop before it goes any further.
    const onCurrentStop = _index >= 0 && _entries[_index] === DOM.source.getActiveElement();
    let target = direction === -1 && !onCurrentStop ? _index : _index + direction;
```

`revealAndFocus`, `record`, `fireChange`, `disable`, `configure`, `canGoBack`, `canGoForward`, `clear`, `on` and `off` keep their bodies.

---

## Ordered Implementation Steps

1. **Baseline.** From `packages/lib`: `npx vitest run tests/unit/core/FocusHistory.test.ts tests/overlay/LayerManager.modalFocus.test.ts tests/overlay/LayerManager.test.ts tests/overlay/Menu.keyboardSession.test.ts tests/core/FocusTraversal.test.ts`. All must pass before any edit.

2. **`LayerManager` tests.** In [`tests/overlay/LayerManager.modalFocus.test.ts`](../packages/lib/tests/overlay/LayerManager.modalFocus.test.ts), append `describe('LayerManager.isInTransientLayer', …)` after the last `describe` ([:693](../packages/lib/tests/overlay/LayerManager.modalFocus.test.ts#L693)) with cases L1–L11. Use the file's `fakeLayer`, `register`, `unregister` and `child` helpers. Check: L1–L10 fail, because the member does not exist. L11 only reads dismiss modes and passes already.

3. **`LayerManager.isInTransientLayer`.** Add the function and its JSDoc to [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts) as given under `## Internal Structure`. Check: L1–L11 pass; `grep -rn "getLayerContaining\|getLayers" packages/lib/src` has zero hits (those names belong to another branch).

4. **`FocusHistory` test harness.** In [`tests/unit/core/FocusHistory.test.ts`](../packages/lib/tests/unit/core/FocusHistory.test.ts), add a module-level `const registered: DismissableLayer[] = []`, a `register(layer)` helper that calls `LayerManager.register` and pushes, and, in the existing `afterEach`, a reverse loop that calls `LayerManager.unregister` on each and empties the list — the pattern of [`LayerManager.modalFocus.test.ts:129`](../packages/lib/tests/overlay/LayerManager.modalFocus.test.ts#L129). Add a `layerWith(mode)` helper that returns `{ layer, element }`, where `element` is a `liveHandle()` and `layer` is a `DismissableLayer` whose `getLayerElement` returns it and whose `getDismissMode` returns `mode`. New cases use these; existing cases keep their inline register and unregister.

5. **`FocusHistory` tests.** In the same file:
   - Add cases S1–S13, K1–K4 and W1–W8 from `## Expected Behaviour`.
   - Replace the case "back() still walks between entries inside the modal layer" ([:518](../packages/lib/tests/unit/core/FocusHistory.test.ts#L518)) with S5.
   - In "disable() stops observing but preserves the trail" ([:544](../packages/lib/tests/unit/core/FocusHistory.test.ts#L544)), make the final assertion expect `b`, add a second `back()` that lands on `a`, and correct the comment above them (case W9).
   - Leave every other existing case as it is. Each must pass unchanged at the end, including "back() skips, without revealing, an entry behind the topmost modal layer" ([:480](../packages/lib/tests/unit/core/FocusHistory.test.ts#L480)).
   Check: the new cases fail.

6. **`FocusHistory` code.** Edit [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts) in this order, running the file's tests after each: add `isHistoryStop`; `onFocusIn`; `enable`; `onKeyDown`; `pruneStale`; `navigate`. Then update the comments:
   - `pruneStale`'s JSDoc: it also merges a stop repeated next to itself.
   - `navigate`'s JSDoc: going back starts at the current stop when focus is not on it.
   - `onFocusIn`'s JSDoc: records the element when it is a stop.
   - `onKeyDown`'s JSDoc: suppressed while any modal or transient layer is open, so the accelerator never pulls focus out of a menu, a dropdown or a dialog.
   - The namespace JSDoc ([:275](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L275)): it records the places focus has been — controls of the page, of a window and of a non-modal drawer — and nothing inside a menu, dropdown, popover, dialog or modal drawer.
   - `enable`'s JSDoc: the seed is skipped when the focused element is not a stop.
   - `back`'s JSDoc: returns focus to the current stop when focus has left it, otherwise to the stop before; returns `false` while a modal layer is open.
   - `forward`'s JSDoc: returns `false` while a modal layer is open.
   - `canGoBack`'s JSDoc: add that it describes the trail and is not `true` merely because focus has left the current stop.
   In public JSDoc (the namespace and its exported functions) describe `LayerManager` behaviour in prose or link only public members.
   Check: every case in the file passes. `grep -n "hasModalLayer\|hasActiveInputLayer\|isInTransientLayer\|isBehindModal" packages/lib/src/typescript/lib/core/FocusHistory.ts` shows each name on exactly one code line (comments aside).

7. **Mounted cases.** Create `packages/lib/tests/core/FocusHistoryLayers.test.ts` with cases J1–J4, following the setup under `## Verification`. Check: all pass.

8. **Docs and changelog.** Apply `## Documentation Impact`.

9. **Verification.** Run the commands and the manual cases under `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusHistory.ts` |
| Modify | `packages/lib/tests/overlay/LayerManager.modalFocus.test.ts` |
| Modify | `packages/lib/tests/unit/core/FocusHistory.test.ts` |
| Create | `packages/lib/tests/core/FocusHistoryLayers.test.ts` |
| Modify | `packages/lib/docs/recipes/focus-history.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/components/Drawer.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Trails are written `[A, B*, C]`. "Focus `X`" means the file's `focusIn(X)` helper: focus plus the `focusin` event. "A layer of mode `m`" is a fake `DismissableLayer` with its own element, registered with `LayerManager`; "inside it" means a handle appended to that element.

### `LayerManager.isInTransientLayer` (offline)

| # | Given | `isInTransientLayer(node)` |
|---|---|---|
| L1 | a registered `"click-outside"` layer; `node` is a child of its element | `true` |
| L2 | the same with a `"blur"` layer | `true` |
| L3 | the same with a `"manual"` layer | `false` |
| L4 | the same with a `"modal"` layer | `false` |
| L5 | a registered `"click-outside"` layer; `node` is the layer's own element | `true` |
| L6 | no layer contains `node`; and `node` is `null` | `false`; `false` |
| L7 | the layer of L1 after `unregister` | `false` |
| L8 | a `"click-outside"` layer `T`, then a `"manual"` layer `M` registered with no anchor (so it links under `T`); `node` inside `M` | `false` |
| L9 | a `"modal"` layer, then a `"click-outside"` layer registered under it; `node` inside the second | `true` |
| L10 | a registered `"click-outside"` layer whose `getLayerElement()` returns `null`; any `node` | `false`, and no throw |

One more case pins the modes the rule relies on. Each real layer is built, asked, and disposed; none is shown:

| # | Layer | `getDismissMode()` |
|---|---|---|
| L11 | `new Menu()`, `new PopupPanel()`, `new Popover()` | `"click-outside"` |
| | `new Popover({ dismissOn: "blur" })` | `"blur"` |
| | `new Popover({ dismissOn: "manual" })`, `new Window('W')`, `new Drawer()` | `"manual"` |
| | `new Dialog({ title: 'T', message: 'M' })`, `new Drawer({ modal: true })` | `"modal"` |

### What is recorded (offline)

| # | Given | Then |
|---|---|---|
| S1 | focus `A`; register a `"click-outside"` layer; focus `P` inside it | `canGoBack()` is `false`; after `unregister`, focus `B`: `back()` lands on `A` |
| S2 | the same with a `"blur"` layer | the same |
| S3 | focus `A`; register a `"manual"` layer; focus `M` inside it | `canGoBack()` is `true`; `back()` lands on `A` |
| S4 | focus `A`; register a `"modal"` layer; focus `D` inside it; focus `E`, an element in no layer | `canGoBack()` is `false` after each |
| S5 | register a `"modal"` layer; focus `D1` then `D2` inside it | `back()` returns `false`; focus stays on `D2` |
| S6 | focus `A`; register a `"modal"` layer, then a `"manual"` layer (it links under the modal); focus `M` inside the second | `canGoBack()` is `false`: `M` was not recorded |
| S7 | focus `A`, `B`, `C`; `back()` (trail `[A, B*, C]`); register a `"click-outside"` layer; focus `P` inside it; focus `B`; `unregister` | `canGoForward()` is `true`; `forward()` lands on `C` |
| S8 | the same with a `"modal"` layer, and with `unregister` before the focus on `B` | the same |
| S9 | focus `A`, `B`; register a `"click-outside"` layer; focus `P` inside it; focus `B`; `unregister` | one `back()` lands on `A`; then `canGoBack()` is `false` |
| S10 | a connected handle made with `DOM.sink.createElement('body')` has focus; `enable()`; focus `A` | `canGoBack()` is `false` |
| S11 | a `"modal"` layer is registered and a handle inside it has focus; `enable()`; `unregister`; focus `A` | `canGoBack()` is `false`. Repeat with a `"click-outside"` layer |
| S12 | a `"change"` listener; focus `A`; register a `"click-outside"` layer; focus `P` inside it | the listener ran once, for `A` |
| S13 | focus `A`, `B`; register a `"click-outside"` layer; focus `P` inside it; focus `F`, a new element in no layer | `F` is recorded: `back()` lands on `B` |

### The accelerators (offline)

`Alt+[` is the file's `keyDown({ code: 'BracketLeft', altKey: true })`.

| # | Given | Then |
|---|---|---|
| K1 | focus `A`, `B`; register a `"click-outside"` layer; `Alt+[` | `preventDefault` is not called; focus is on `B` |
| K2 | the same with a `"blur"` layer | the same |
| K3 | focus `A`, `B`; register a `"manual"` layer; `Alt+[` | `preventDefault` is called; focus is on `A` |
| K4 | K1, then `unregister`, then `Alt+[` | `preventDefault` is called; focus is on `A` |
| — | the two existing modal cases ([:417](../packages/lib/tests/unit/core/FocusHistory.test.ts#L417), [:446](../packages/lib/tests/unit/core/FocusHistory.test.ts#L446)) | pass unchanged |

### Walking (offline)

"Move focus to `X` silently" means `DOM.sink.focus(X)` with no `focusin` event, which models focus sitting on something that was not recorded.

| # | Given | Then |
|---|---|---|
| W1 | focus `A`, `B`; move focus silently to `X` | `back()` is `true` and lands on `B`; a second `back()` lands on `A` |
| W2 | focus `A`, `B`, `D`; disconnect `D`; move focus silently to `X` | `back()` lands on `B`, not `A` |
| W3 | focus `A`, `B`; `back()`; move focus silently to `X` | `forward()` lands on `B` |
| W4 | focus `A`; move focus silently to `X` | `canGoBack()` is `false`; `back()` is `true` and lands on `A` |
| W5 | focus `A`, `X`, `A`; disconnect `X` | `back()` is `false`; focus stays on `A`; `canGoBack()` is `false` |
| W6 | focus `A`, `X`, `A`, `C`; `back()` three times (focus on the first `A`); disconnect `X` | one `forward()` lands on `C` |
| W7 | focus `A`, `B`, `A` (all connected) | `back()` lands on `B`; a second lands on `A` |
| W8 | focus `A`, `B`; register a `"click-outside"` layer | `back()` is `true` and lands on `A` (the function is not held back) |
| W9 | the existing "disable() stops observing but preserves the trail" case, edited: trail `[A, B*]`, service disabled, focus on `C` | `canGoBack()` is `true`; `back()` lands on `B`; a second `back()` lands on `A` (today the first lands on `A`) |
| — | the existing cases for a stale entry ([:158](../packages/lib/tests/unit/core/FocusHistory.test.ts#L158)), an entry that refuses focus ([:179](../packages/lib/tests/unit/core/FocusHistory.test.ts#L179)) and an entry behind a modal ([:480](../packages/lib/tests/unit/core/FocusHistory.test.ts#L480)) | pass unchanged |

### Real menu and dialog (offline, jsdom)

These run real components against the real DOM under jsdom, where `element.focus()` fires `focusin`. They pin the order in which a layer registers, takes focus, unregisters and returns focus.

| # | Given | Then |
|---|---|---|
| J1 | buttons `A`, `B`, `C` mounted and a `Menu` built; `FocusHistory.enable()`; focus `A`, `B`, `C`; `back()` (focus on `B`); a keydown on `B`; `menu.show(…)` | the menu's element has focus; `canGoForward()` is still `true` |
| J2 | J1, then a keydown `Alt+[` on the focused element | `defaultPrevented` is `false`; the menu's element still has focus; `LayerManager.getTopLayer()` is the menu |
| J3 | J1, then a keydown `Escape` on the focused element | `B` has focus; no layer is open; `canGoForward()` is `true`; one `back()` lands on `A` |
| J4 | the same three buttons and `back()` (focus on `B`); `new Dialog({ title: 'T', message: 'M' }).show()`; run timers 500 ms; `hide('close')`; run timers 1000 ms | while open, focus is inside the dialog's element and `canGoForward()` is `true`; after closing, `B` has focus, `canGoForward()` is `true`, and one `back()` lands on `A` |

### Needs manual verification

What neither harness can show: a hidden or `inert` element refusing focus, the browser's own blur when a control goes inert, and real key presses. Run in Chromium on the demo's `#/misc` page (`npm run dev`, `http://localhost:8015/#/misc`); the demo enables `FocusHistory`. Give focus with `element.focus()` from the console, because a click would run the button's action. Press the keys for real.

| # | Setup | Do | Expect |
|---|---|---|---|
| MV1 | focus "Show diagnostics overlay", then "Right-click me for context menu" | Shift+F10; `Alt+[`; `Escape`; `Alt+[` | the menu opens with focus; the first `Alt+[` moves nothing and the menu stays open and focused; `Escape` returns focus to the button; the second `Alt+[` lands on "Show diagnostics overlay" |
| MV2 | focus "Show diagnostics overlay", "Right-click me for context menu", "Show window with table (slow)!"; `Alt+[` | Shift+F10; `Escape`; `Alt+]` | focus lands on "Show window with table (slow)!" |
| MV3 | focus "Right-click me for context menu", "Dialog — form (focus stays inside)", "Show window with table (slow)!"; `Alt+[` | `Enter`; `Tab` twice; `Alt+[`; `Escape`; `Alt+]`; `Alt+[` twice | the dialog opens; `Alt+[` moves nothing; `Escape` returns focus to the dialog button; `Alt+]` lands on "Show window with table (slow)!"; the two `Alt+[` land on the dialog button, then on "Right-click me for context menu" |
| MV4 | focus "Show diagnostics overlay", then "Filters (PopupPanel)" | `Enter`; `Alt+[`; focus the panel's `Apply` button from the console; `Escape`; `Alt+[` | the panel opens; the first `Alt+[` moves nothing and the panel stays open; after `Escape` nothing has focus; the second `Alt+[` lands on "Filters (PopupPanel)" |
| MV5 | focus "Show diagnostics overlay"; focus "Non-modal drawer (left)" and press `Enter`; focus the drawer's text field; click the drawer's `Close` button | `Alt+[` | lands on "Non-modal drawer (left)", not on "Show diagnostics overlay" |
| MV6 | focus a "Modal drawer from left" button and press `Enter`; `Tab` once | `Alt+[`; `Escape`; `Alt+[` | the first moves nothing; `Escape` returns focus to the button; the second lands on the stop before the button in one press |
| MV7 | "Dialog — form (focus stays inside)" open; Shift+F10 on its text field | `Alt+[` | nothing moves (unchanged) |
| MV8 | focus "Show diagnostics overlay"; open "Show window with wide table (45 columns)!" with `Enter`; focus the text field in the window; minimise the window; focus "Show window with table (slow)!" | `Alt+[` twice; restore the window; `Alt+]` twice | the two `Alt+[` land on the window's button and on "Show diagnostics overlay" (the hidden field is passed); after the restore the second `Alt+]` lands on the field (unchanged) |
| MV9 | window about 500 px high; click the first button of the left column | `Tab` until the column has scrolled; `Alt+[` once per `Tab` | every control on the way back is fully visible (the scroll-reveal plan's MV4, unchanged) |

---

## Verification

Where the cases go: L1–L11 in `tests/overlay/LayerManager.modalFocus.test.ts`; S, K and W in `tests/unit/core/FocusHistory.test.ts`; J1–J4 in the new `tests/core/FocusHistoryLayers.test.ts`.

Setup for `tests/core/FocusHistoryLayers.test.ts`, following [`tests/core/FocusTraversalCompositeWidgets.test.ts`](../packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts#L1):

- First line `// @vitest-environment jsdom`. Do not call `installTestDOM`.
- `beforeEach`: build a `Container`, add three `Button`s, mount it with `DOM.sink.appendChild(DOM.source.getBody(), host.getElement(true)!)`, call `getElement(true)` on each button, then `host.flushLayout()`.
- A button's real element is `document.getElementById(button.getId())`. Focus it with its own `focus()`.
- A key press is `new KeyboardEvent('keydown', { bubbles: true, cancelable: true, … })` dispatched on the element. For the menu's keyboard session, build the `Menu` **before** dispatching the key: `Menu`'s watch for the last input starts with the first menu built. Use `{ key: 'F10', shiftKey: true }` on `B`, then `menu.show(10, 10, [{ text: 'One' }, { text: 'Two' }])`. `Alt+[` is `{ code: 'BracketLeft', key: '[', altKey: true }`.
- J4: `vi.useFakeTimers()` at the start, `await vi.advanceTimersByTimeAsync(…)` for the waits, `vi.useRealTimers()` at the end.
- `afterEach`: `FocusHistory.disable()`, `FocusHistory.clear()`, dispose any menu the test built, `Menu._stopInputWatch()`, `Tooltip._stopPointerWatch()`, then `document.body.innerHTML = ''`.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/unit/core/FocusHistory.test.ts tests/core/FocusHistoryLayers.test.ts tests/overlay/LayerManager.modalFocus.test.ts tests/overlay/LayerManager.test.ts tests/overlay/Menu.keyboardSession.test.ts tests/overlay/Dialog.test.ts tests/overlay/Drawer.test.ts tests/overlay/Popover.test.ts tests/overlay/PopupPanel.test.ts tests/core/FocusTraversal.test.ts tests/unit/core/FocusReveal.test.ts tests/unit/core/SpatialNavigation.test.ts tests/unit/import-without-dom.test.ts`
4. `npm test`
5. `npm run lint`
6. `npm run docs:api`, `npm run docs:llms:check`
7. The MV cases.

Grep checks:

- `grep -rn "isInTransientLayer" packages/lib/src/typescript/lib` — the definition in `LayerManager.ts` and one call in `FocusHistory.ts`.
- `grep -n "LayerManager\.hasModalLayer()" packages/lib/src/typescript/lib/core/FocusHistory.ts` — one hit, in `isHistoryStop`.
- `grep -rn "getLayerContaining\|getLayers" packages/lib/src` — zero hits.

---

## Documentation Impact

`LayerManager` is exported from `core/index.ts`; the new member appears on its API page with no barrel or sidebar change.

- **[`docs/recipes/focus-history.md`](../packages/lib/docs/recipes/focus-history.md)**.
  - The opening sentence and "Once enabled, every element that receives keyboard focus is recorded" ([:17](../packages/lib/docs/recipes/focus-history.md#L17)): say the service records the *places* keyboard focus has been, and link to the new section.
  - New section `## What is recorded`, after `## Enable the service`. Give the stop rule as a short table: controls of the page, of a window, of a non-modal drawer and of a `dismissOn: "manual"` popover are recorded; a context menu, a dropdown, a popup panel, a popover, a dialog and a modal drawer are not, nor is a table cell. Say why in one sentence: those surfaces are gone once closed, so a stop inside one would lead nowhere.
  - The paragraph at [:46](../packages/lib/docs/recipes/focus-history.md#L46): replace the dialog example with "a control of a window that has since been closed". Add: a stop that is hidden or disabled is passed over and kept, so it works again once the control is back — the field of a minimised window, say.
  - Replace `## Modal dialogs` ([:61–65](../packages/lib/docs/recipes/focus-history.md#L61)) with `## Menus, dropdowns, popovers and dialogs`. Say: opening and closing one leaves the trail as it was, forward part included; `Alt+[` and `Alt+]` do nothing while one is open, and the key is left to the application; `back()` and `forward()` return `false` while a dialog or modal drawer is open, and are not held back by a menu or dropdown; a non-modal window or drawer does not suppress anything.
  - In `## Wire back/forward buttons`, add one paragraph: when focus has left the current stop — it is in a table cell, or the focused control was removed — `back()` returns to that stop first. `canGoBack` describes the trail only, so with a single stop it stays `false` there even though `back()` would move focus.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**. Edit only the closing paragraph ([:323](../packages/lib/docs/concepts/accessibility.md#L323)). Add before its first sentence: focus history records controls of the page, of windows and of non-modal drawers; a menu, dropdown, popover, dialog or modal drawer is never a stop, and the accelerators stand down while one is open. Leave the `## Testing` bullets and the `## Spatial focus navigation` section alone.[^merge]
- **[`docs/concepts/layering.md`](../packages/lib/docs/concepts/layering.md)**.
  - `## Dismiss modes` ([:98](../packages/lib/docs/concepts/layering.md#L98)): after the list of modes, add one sentence defining a *transient layer* as one whose mode is `"click-outside"` or `"blur"`.
  - The paragraph at [:239](../packages/lib/docs/concepts/layering.md#L239): add `LayerManager.isInTransientLayer(node)` (true when the layer `node` lives in is transient) and `LayerManager.hasActiveInputLayer()` (true while any layer is open that is not `"manual"`). Replace the last sentence with: `FocusTraversal` stands down on the first; `FocusHistory` records nothing while a modal is open or inside a transient layer, and its accelerators stand down on `hasActiveInputLayer()`, as `SpatialNavigation` does.
- **[`docs/components/Menu.md`](../packages/lib/docs/components/Menu.md)**. After the paragraph at [:122](../packages/lib/docs/components/Menu.md#L122), add a bullet to the list that follows: **Focus history does not see the menu.** The panel is not a stop, opening and closing the menu leaves the trail as it was, and `Alt+[` / `Alt+]` do nothing while any menu is open. Link to `/recipes/focus-history`.
- **[`docs/components/Dialog.md`](../packages/lib/docs/components/Dialog.md)**, `### Keyboard`. After the paragraph on focus return ([:166](../packages/lib/docs/components/Dialog.md#L166)), add: with focus history enabled, a dialog's controls are not recorded, `Alt+[` / `Alt+]` do nothing while the dialog is open, and the trail is as it was once the dialog has closed.
- **[`docs/components/Drawer.md`](../packages/lib/docs/components/Drawer.md)**, the table under `## Modal vs. non-modal` ([:35](../packages/lib/docs/components/Drawer.md#L35)). Add a row "Focus history": modal — its controls are not recorded and the accelerators are off while it is open; non-modal — its controls are recorded like the page's.
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)**.
  - `## Changed`: add a `### Core` subsection between `### Components` and `### Overlay` ([:127](../packages/lib/docs/reference/changelog/next.md#L127)) with one entry. **`FocusHistory` records places, not popups.** A control inside a context menu, dropdown, popup panel, popover, dialog or modal drawer is no longer a stop. `Alt+[` and `Alt+]` do nothing while any of those is open, and the key is not consumed. `back()` and `forward()` return `false` while a dialog or modal drawer is open. When focus has left the current stop, `back()` returns to that stop first. Consumer action: none, unless code relied on `back()` reaching a dialog's own controls.
  - `## Fixed` → `### Core` ([:439](../packages/lib/docs/reference/changelog/next.md#L439)), appended after the `Panel` entry ([:484](../packages/lib/docs/reference/changelog/next.md#L484)). **Focus history no longer stumbles over a menu or dialog that has closed.** Say what was wrong: the control that opened a keyboard-opened context menu or a dialog was left in the trail twice, so one `Alt+[` did nothing visible; opening either dropped the forward part of the trail; `Alt+[` with a menu or dropdown open moved focus to the page and left the menu or dropdown open; after a popup or drawer closed with focus inside it, `Alt+[` skipped the control that opened it; and `enable()` with nothing focused recorded `<body>`, so `canGoBack` reported `true` with nowhere to go. End with "No consumer action is needed."
  - `## Added` → `### Core` ([:213](../packages/lib/docs/reference/changelog/next.md#L213)), appended after the `Panel` entry ([:255](../packages/lib/docs/reference/changelog/next.md#L255)): **`LayerManager.isInTransientLayer(node)`** says whether an element lies inside a layer that an outside click or focus move dismisses.
- **Not edited:** `ARCHITECTURE.md` (no rule changes), `docs/components/Popover.md`, `PopupPanel.md`, `ComboBox.md`, `Window.md` (the focus history page covers them), `packages/lib/llms.txt` (it lists neither service nor query).

---

## Potential Challenges

- **A fake layer left registered.** `LayerManager` is a module singleton. A layer that outlives its test now stops every later test's recording or accelerator. Mitigation: step 4's draining `afterEach`.
- **A dropdown stays registered while it fades out** (120 ms), and a dialog while it animates out (150 ms). `Alt+[` pressed in that window does nothing. `SpatialNavigation` has the same window. Mitigation: none; do not add a closing test to `hasActiveInputLayer`.
- **A menu or popover unregisters before its fade ends.** For up to 120 ms its element is still in the document and no longer a transient layer. A focus move into it in that window would be recorded, and the entry is dropped by the next prune once the element is detached. It takes a focus move into a surface that is already fading out; do not add code for it.
- **`<body>` under the modelled test DOM.** `DOM.source.getBody()` mints a new handle on every call there, so an identity test never matches. Mitigation: `isHistoryStop` tests the tag name, and S10 builds its own `body` handle.
- **Merging with `feature/spatial-navigation-redesign`.** See the note.[^merge]
- **Sibling plans** drafted from the same commit (`dialog-aria-semantics`, `nested-scroll-reveal`, `tree-page-keys`) may edit `accessibility.md`, `Dialog.md` and `changelog/next.md`. This plan's edits there are whole new paragraphs or entries; keep both sides.

---

## Critical Files

- [`core/FocusHistory.ts`](../packages/lib/src/typescript/lib/core/FocusHistory.ts) — `pruneStale` (:90), `record` (:124), `revealAndFocus` (:151), `navigate` (:180), `isInTableCell` (:205, the precedent for a record-time filter), `onFocusIn` (:225), `onKeyDown` (:253), `enable` (:293).
- [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts) — `LayerDismissMode` (:25), `hasActiveInputLayer` (:584), `hasModalLayer` (:595), `isBehindModal` (:609, the precedent for the new query), `nodeOwning` (:772), `resolveParent` (:815, why a layer's parent is not a reliable sign of what it is).
- [`core/SpatialNavigation.ts`](../packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L241) — `claimedTier`, the precedent for standing down on `hasActiveInputLayer()`.
- [`core/Focusable.ts`](../packages/lib/src/typescript/lib/core/Focusable.ts#L46) — `isLiveHandle`.
- [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1374) — `takeKeyboardFocus`, `returnFocusToInvoker` (:1453): the menu registers before its panel takes focus and returns focus before it unregisters.
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L962) — `open` (registers, then focuses after the first layout) and the close path at :1399 (unregisters, then restores focus).
- [`tests/unit/core/FocusHistory.test.ts`](../packages/lib/tests/unit/core/FocusHistory.test.ts) — `liveHandle`, `focusIn`, `keyDown`, and the inline fake layers at :425 and :489.
- [`tests/overlay/LayerManager.modalFocus.test.ts`](../packages/lib/tests/overlay/LayerManager.modalFocus.test.ts) — `fakeLayer` (:41), `child` (:96), the draining `afterEach` (:129).
- [`tests/core/FocusTraversalCompositeWidgets.test.ts`](../packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts) — the jsdom recipe with real components.
- [`plans/implemented/modal-dialog-focus-trap.md`](implemented/modal-dialog-focus-trap.md) and [`plans/implemented/context-menu-keyboard-operation.md`](implemented/context-menu-keyboard-operation.md) — their `## Implementation Notes` record the advisories this plan closes. [`plans/implemented/focus-history-navigation.md`](implemented/focus-history-navigation.md) holds the "record everything" decision this plan replaces.

---

## Non-Goals

- **A trail of its own inside a modal.** Rejected.[^modal-off]
- **Closing a transient layer from `Alt+[`.** The accelerator stands down; `Escape` closes the layer.
- **Returning focus to the opener when a `PopupPanel`, `Popover` or non-modal `Drawer` closes.** Measured for a `PopupPanel` and a non-modal `Drawer`: each leaves focus on `<body>` when it closes with focus inside. `Popover.hide()` moves no focus either. That is a defect of those components, and with this plan `Alt+[` recovers from it in one press. A fix belongs in its own plan.
- **Re-opening a closed or minimised window to reach a stop inside it.** A hidden stop is passed over, as today. Teaching windows and drawers to reveal themselves is a `FocusRevealer` change.
- **Making `canGoBack` and `"change"` follow where focus is.** See the note.[^flags]
- **Passing over a stop that already has focus.** With a hidden stop between two visits to one control (`[A, H, A*]`, `H` hidden), `back()` still "lands" on the first `A` without a visible move. It needs a minimised window between two visits to the same control, and is left as it is.
- **Changing `FocusTraversal`, `SpatialNavigation`, `Menu`, `Dialog`, `Drawer`, `Popover` or any dropdown.** None needs it.
- **SQLAdmin.** It does not enable `FocusHistory`.
- **Using `LayerManager.getLayerContaining()` or `getLayers()`.** They exist only on the unmerged `feature/spatial-navigation-redesign`.[^own-query]

---

## Addendum: What the trail does today

Measured on commit `27c9b7157`, in Chromium with real key presses on the demo's `#/misc` page, and again under jsdom with a real `Menu` and `Dialog`.[^evidence] Capital letters are buttons of the page; `*` marks the current stop.

| # | Steps | Result today |
|---|---|---|
| 1 | Trail `[D, B*]`. Shift+F10 on `B`, `Escape` | Trail `[D, B, panel, B*]`; once the panel entry is pruned, `[D, B, B*]`. The first `Alt+[` leaves focus on `B`; the second reaches `D` |
| 2 | Trail `[D, B*, T]`. Shift+F10 on `B`, `Escape` | `canGoForward` is `false`: `T` is gone from the trail |
| 3 | Trail `[A, B*]`. Shift+F10 on `B`, then `Alt+[` with the menu open | `FocusHistory` focuses `B`, the menu takes focus back, so `B` counts as refusing; focus lands on `A`. The menu stays open with nothing focused in it |
| 4 | Trail `[D, B, G*, T]`, `G` a button that opens a form dialog. `Enter`, two `Tab`s, `Escape` | Forward part dropped on open. After closing: `[D, B, G, G*]`; the first `Alt+[` leaves focus on `G` |
| 5 | Dialog open: `Alt+[`; then `FocusHistory.back()` from code | The key does nothing. The function walks between the dialog's own controls and stops at the first one |
| 6 | Trail `[B, G, F*]`, `F` the "Filters (PopupPanel)" button. `Enter`, then `Alt+[` with the panel open | Focus moves to `G`; the panel stays open |
| 7 | The panel of 6 open, focus moved to its `Apply` button, `Escape` | The forward part is dropped when `Apply` takes focus. The panel is removed and focus drops to `<body>`. `Alt+[` then lands on `B`, skipping `G`, the last control focus was on |
| 8 | Trail `[D, R*]`, `R` opens a non-modal drawer. Focus the drawer's field, close the drawer | The drawer is removed; focus drops to `<body>`. `Alt+[` lands on `D`, skipping `R` |
| 9 | Trail `[D, W, field, T*]`, `field` inside a window. Minimise the window; `Alt+[` twice; restore; `Alt+]` twice | The hidden field is passed over both ways and reached again after the restore. Correct, and kept |
| 10 | Fresh page (the demo calls `enable()` with nothing focused); focus one button | `canGoBack()` and the `"change"` event report `true`; `back()` returns `false`. `<body>` is in the trail |

A stand-in for the new rules, run in the same page with real key presses, gave: case 1, one press reaches `D`; case 2, `T` kept; case 3, nothing moves and the menu keeps focus; case 4, trail unchanged by the dialog; case 5, both do nothing; case 6, nothing moves; case 7, `Alt+[` lands on `F`; case 8, `Alt+[` lands on `R`; case 10, nothing seeded. A modal drawer behaved like the dialog.

---

## Notes

[^why-not-record]: `plans/implemented/focus-history-navigation.md` chose "record everything, prune on navigate": a dialog's focus moves are real moves, and dead entries are dropped when a walk meets them. The measurements in the addendum show what that costs: a repeated opener, a lost forward trail, and a walk that pulls focus out of an open menu.
    Comparable history models leave transient UI out. A browser's history holds pages, not the menu or the dialog that was open on one. An editor's "navigate back" walks places in documents and does not return to a popup that has closed. The trail is the same kind of list: places a user can go back to. A surface that an outside click removes, or that blocks the application until it is answered, is not a place.
    Filtering at record time is also what the file already does for table cells.

[^dismiss-mode]: The dismiss mode is the layer system's own statement of how long a surface lasts: `"click-outside"` and `"blur"` layers are closed by the user's next interaction elsewhere, `"manual"` layers stay until their own close control is used. No DOM heuristic is involved.
    Only the owning layer is asked because a layer's parent in the tree is not a reliable sign of what the layer is. A layer with no anchor links under the last-registered layer (`resolveParent`). A non-modal drawer opened from a menu row's action registers while the menu is still open, links under the menu, and keeps that link after the menu has unregistered. Asking the parent chain would call that drawer transient for as long as it stays open.

[^own-query]: On commit `27c9b7157` no public `LayerManager` member tells which layer an element is in: `containsAcrossLayers` needs the layer, `getTopLayer` gives only the last one, and `isBehindModal` answers for modals only. `nodeOwning` is private.
    The unmerged `feature/spatial-navigation-redesign` adds `getLayerContaining(target)` (a public wrapper of `nodeOwning`) and `getLayers()`. This plan uses neither and adds no member with those names, so the two branches merge in either order. Once both are merged, `isInTransientLayer` could be written as `getLayerContaining(node)?.getDismissMode()` plus the mode test; that is an optional tidy-up, not part of this plan.

[^modal-off]: The alternative was a trail of its own for each modal: stops recorded inside it, `Alt+[` confined to them, the list thrown away on close. It was rejected for four reasons.
    A modal's controls do not outlive it: a `Dialog` and a `Drawer` remove their element when they close. So the entries could never be reachable afterwards, and would have to be discarded at close.
    The confined trail needs its own lifetime: one list per open modal, stacked for a dialog opened from a dialog, a way to learn that a modal has closed (`LayerManager` sends no such notice), and a rule for a dialog instance that is shown a second time.
    It buys little: stepping back among a handful of controls that `Tab` already reaches in a wrapped ring.
    And one rule — the trail holds places in the application, a modal is an interruption of it — is easier to document and to test than two trails.
    On the base commit `back()` and `forward()` walked between a modal's own controls. That behaviour came from `modal-dialog-focus-trap` and has not been released.

[^stand-down]: Measured (addendum, cases 3 and 6): with a keyboard-opened menu, or a popup panel, open, `Alt+[` moves focus to the page and the layer stays open, since a `"click-outside"` layer ignores focus moves. Standing down for every transient layer, focused or not, removes both and gives one rule. `SpatialNavigation` already stands down on exactly this test, so the two services agree.
    The key is not consumed while the service stands down. That is what the existing modal case does and what its test pins. A consequence on macOS: `Option+[` in a text field with a suggestion list open types a character, as it does in any application with no accelerator on that key.

[^api-not-gated]: A toolbar button wired to `back()` is the documented use. Its click closes an open dropdown through the pointer press, but a dropdown stays registered for the 120 ms of its fade. Holding the function back on `hasActiveInputLayer()` would make that click do nothing. While a modal is open the function finds every stop behind the modal and returns `false`, which needs no test of its own.

[^current-stop]: Measured (addendum, cases 7 and 8): after a popup panel or a non-modal drawer closes with focus inside it, focus is on `<body>` and the current stop is the control that opened it. `back()` went to the stop before that control, so the user never got back to where they had been. The same happens today from a table cell, which was never a stop.
    With the transient and modal filters there are more ways for focus to sit off the trail, so the walk has to handle it. "Back" then means: the last place you were.
    Two existing behaviours change with it. From a table cell, `Alt+[` now lands on the last recorded control and not the one before. And the existing test "disable() stops observing but preserves the trail" expects the old landing; W9 gives the new one.

[^keep-refusing]: Measured (addendum, case 9): a field in a minimised window is hidden but still in the document. It is passed over while hidden and reached again after the restore. Dropping a stop on its first refusal would lose it for good. A disabled button is the same case: it may be enabled again. Only an element that has left the document can never take focus again.
    The existing test "navigate skips an entry that cannot take focus, without dropping it from the trail" pins this and stays.

[^collapse]: With layers out of the trail, the repeats measured in the addendum no longer arise. One source is left: a stop in a window visited between two visits to the same page control, after the window has closed. Merging neighbours in `pruneStale` is three lines and is the fix the `context-menu-keyboard-operation` notes proposed.

[^flags]: Making the flags follow focus would mean firing `"change"` for focus moves that record nothing — every move inside a menu, a dialog or a table — and the flags would still be wrong after focus drops to `<body>`, which fires no event at all. The case that differs is narrow: a trail with one stop and focus off it. The existing table-cell test asserts `canGoBack()` is `false` in exactly that state, and keeps passing.

[^body-seed]: Measured (addendum, case 10). `enable()` records `document.activeElement`, which is `<body>` when nothing has focus. `<body>` never takes focus, so the entry is passed over on every walk and never pruned, and `canGoBack` reports `true` from the first real focus on.
    The tag name is used because the modelled test DOM returns a fresh handle from `getBody()` on each call, and because `isInTableCell` in the same file already identifies elements by tag.

[^merge]: A merge with `feature/spatial-navigation-redesign` is expected to conflict in one file. In `docs/reference/changelog/next.md` both branches add a `### Core` heading under `## Changed` at the same place: keep one heading and both sets of entries. Under `## Added` → `### Core` that branch's entries and this chain's entries follow the same older entry: keep both blocks.
    No conflict is expected elsewhere. In `core/LayerManager.ts` that branch inserts after `getTopLayer()` (:529) and this plan after `isBehindModal()` (:617). That branch edits `tests/overlay/LayerManager.test.ts`; this plan puts its cases in `LayerManager.modalFocus.test.ts` for that reason. In `docs/concepts/accessibility.md` that branch rewrites the spatial-navigation section; this plan edits only the page's last paragraph. Neither merge was run.

[^evidence]: No source file was changed to gather evidence. The Chromium runs used the worktree's demo on a spare port and real key presses through the browser's debugging interface; focus was given with `element.focus()`. The jsdom runs used a throwaway test file with real `Button`, `Menu` and `Dialog` components. The stand-in for the new rules was a script pasted into the page: it disabled the real service, mirrored the layer registry by wrapping `LayerManager.register` / `unregister`, and implemented the rules of this plan beside the real `LayerManager`, `FocusReveal`, `Menu`, `Dialog`, `PopupPanel` and `Drawer`. It is not the real code, so the offline cases above are still to be proven by the implementation.
    Kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/focus-history/`: `runtime-prototype.js`, `zz-focus-history-probe.test.ts`, `probe-out.log`.
    Not run: a popover, a `ComboBox` dropdown, a `MenuBar` panel, a menu opened with the mouse, and the two fade windows named under `## Potential Challenges`. Each is the same layer mode as a case that was run.

---

## Implementation Notes

Built on `feature/tree-page-keys` (`9a8bd01a7`), the tip of the chain `feature/context-menu-keyboard-operation` → `feature/table-tree-keyboard-context-menu` → `feature/modal-dialog-focus-trap` → `feature/list-scroll-index-into-view` → `feature/scroll-reveal-geometry-fixes` → `feature/dialog-aria-semantics` → `feature/tree-page-keys`. The plan's rules had only been run as a stand-in script. Every case below was written against the real `FocusHistory` before the code changed, and seen to fail first.

### Decided by the user on 2026-10-10

The first two were implemented as planned. Neither was tested against an alternative, so they were the plan's two open calls. Each item ends with the decision.

1. **`Alt+[` / `Alt+]` are disabled, not confined, while a modal or transient layer is open.** With a dialog, a modal drawer, a menu, a dropdown, a popup panel or a popover open, the two keys do nothing and are not consumed. Inside a dialog there is no trail to walk: its controls are not recorded, and `back()` / `forward()` return `false`. The alternative the plan rejected is a trail of its own per modal, thrown away on close. What a user loses: stepping back between a dialog's own fields with `Alt+[`. `Tab` still reaches them. A consequence seen in Chromium: with a `ComboBox` dropdown open and focus on the field, `Alt+[` is left to the browser, which does nothing with it on Linux; on macOS `Option+[` types a character into a text field. **Decision:** accepted as implemented.
2. **`canGoBack()` and the `"change"` event describe the trail, not where focus is.** With one stop `[A*]` and focus off it (in a cell editor, or on `<body>` after a popup closed), `canGoBack()` is `false` and `back()` still moves focus to `A` and returns `true` (case W4). A toolbar "back" button wired to `canGoBack` is therefore disabled in the one state where it would work. The plan documents this and does not fix it; the recipe page and `canGoBack`'s JSDoc say so. A fix would have to fire `"change"` on focus moves that record nothing. **Decision:** to be fixed. The plan is `plans/focus-history-can-go-back-follows-focus.md` on master.

A third call came out of the review, and is not as planned:

3. **`LayerManager.isBehindModal()` has no caller left in the library.** `FocusHistory`'s walk was its only user, and deviation 10 replaced that per-stop test with one test for the whole walk. The query is public API from `modal-dialog-focus-trap`, documented in `layering.md` and the changelog, has its own cases, and has not been released. It was left in place: removing another branch's public member is not this plan's to decide. Keep it as a query for applications, or drop it before the release. **Decision:** drop it. **Not carried out.** "No caller" holds on this branch only. The next branch in the stack, `feature/nested-scroll-reveal`, calls the query again: the scroll pass of `FocusReveal` (`scrollIfSettled`) asks it, so that a page behind a modal layer is not scrolled. The branches below this one, from `feature/modal-dialog-focus-trap` up to `feature/tree-page-keys`, call it from `FocusHistory`. So no branch of the stack can remove it without breaking a caller, and it is still in place at the end of the stack. Whether it is dropped, and what the scroll pass asks instead, is open again.

### What differed on the base

The plan was drafted on `27c9b7157`. `git diff 27c9b7157 HEAD` was empty for `core/FocusHistory.ts`, `core/LayerManager.ts`, `tests/unit/core/FocusHistory.test.ts` and `tests/overlay/LayerManager.modalFocus.test.ts`, so every source and test line number in the plan matched.

| File | What the newer base changed | Effect here |
|---|---|---|
| `docs/concepts/accessibility.md` | `dialog-aria-semantics` added `## Dialogs and windows`; `tree-page-keys` added `## Keys in trees, lists and tables` | the closing paragraph is at line 385, not 323; found by its text |
| `docs/components/Dialog.md` | a screen-reader section above `### Keyboard` | the focus-return paragraph is at line 178, not 166 |
| `docs/reference/changelog/next.md` | entries from both branches | `## Added` → `### Core` now ends with the `Aria` entry, not the `Panel` one; the new entry was appended after it. The other two were placed by heading |
| `plans/in-progress/` | the directory did not exist on the base | created for the move |

`dialog-aria-semantics` added no layer and changed no dismiss mode, and its hidden-`initialFocus` fallback only changes which control of a dialog takes focus, which is never recorded. `tree-page-keys` touches `Tree` only. Nothing in either changed what had to be done.

### Expected Behaviour rows

Every row held as written, with one adjustment to how a case is built:

- **J4 builds its dialog with an explicit button.** `new Dialog({ title: 'T', message: 'M' })` cannot be constructed under jsdom: the default button carries a glyph, placing a glyph measures the font on a canvas, and jsdom has no canvas (`ProductionDOMSource.measureFontMetrics` throws). The case passes `buttons: [{ text: 'OK', result: 'confirm' }]`. What the row asserts is unchanged. The planner's probe had used a glyph-less button too.

No row had to be bent, and one was strengthened: see deviation 7 for S13. Red state before the code change, kept in the run's notes: L1–L10 failed because the member did not exist, L11 passed; S3, K3, W3, W7 and W8 passed as pins of behaviour that stays; every other S, K and W case failed with the value the plan's addendum gives; J1–J4 failed against the old `FocusHistory.ts` and pass against the new one.

### Deviations from the plan

1. **The test file's teardown puts `maxSize` back.** Found while watching the new cases fail: W5 and W6 passed and W7 failed in the whole-file run, and the other way round alone. The existing case "bounds the trail at maxSize, keeping the newest entries" calls `enable({ maxSize: 2 })`, and `configure()` outlives `disable()` and `clear()`, so every later case in the file ran with a two-entry trail. The `afterEach` now calls `FocusHistory.configure({ maxSize: 50 })`. No existing expectation changed; the existing cases after it pass with either length.
2. **J4's teardown does not dispose the dialog.** A dialog destroys itself as it closes, and a second `dispose()` throws on a released handle. The case clears its reference once the dialog has closed; the teardown disposes only a dialog a failed case left open.
3. **The docs and the public JSDoc say "a control inside a table cell", not "a table cell".** A `Table` holds focus on its own body element for all its cells, and that element is a stop, as before. What rule 2 leaves out is a control inside a cell: a cell editor, an in-cell checkbox. Seen in Chromium: with focus on a table's body the trail gains it; with focus on an in-cell checkbox `Alt+[` returns to the table's body, then to the stop before. The rule itself is the plan's and is unchanged.
4. **Extra cases** beyond `## Expected Behaviour`: S10 also for `<html>`; `forward()` moves and reveals nothing while a modal is open; K1 and K2 also assert that propagation is not stopped; L7 asserts `true` before the unregister; L8 asserts that the manual layer did link under the transient one; J4 asserts that no modal layer is left.
5. **The recipe gives the "while open" rules as a table**, where the plan lists them as sentences, and `layering.md` lists the four queries as a list. Same content.
6. **No demo was added.** The demo enables `FocusHistory` at startup and its `#/misc` page already has a control for every layer the rule names. The plan changes no component.
7. **S13 also walks forward.** Found by the review. The row reads "`F` is recorded: `back()` lands on `B`", and since going back starts at the current stop, `back()` lands on `B` whether or not `F` was recorded. A version of `isHistoryStop` that refused every focus move while a transient layer was open passed the whole file. The case now also asserts that `forward()` returns to `F`, and that version fails it.
8. **The docs carve out the `dismissOn: "manual"` popover wherever they list what is not a stop.** Found by the review. The sentence the plan gives for `accessibility.md` says a popover is never a stop and that the accelerators stand down while one is open. Both are false for a manual popover (cases S3 and K3). The sentence there, the `## Changed` entry and the recipe's section on menus and dialogs now say "a popover that an outside click or focus move closes".
9. **More extra cases**, added after the review: `back()` from a current stop that is not the last one, which is the fourth row of the plan's "Going back" table, and `enable()` with focus on a control inside a table cell.
10. **`navigate` returns `false` while a modal layer is open, and `revealAndFocus` lost its per-stop test.** The plan says `back()` and `forward()` "need no new code for the modal case", because "every stop then lies behind the modal" and `revealAndFocus` already passes such a stop. Found by the review: the premise is false. A layer that keeps its element between two openings, as a `Drawer` does, can hold a stop recorded while it was no part of a modal. Opened again as a modal layer, or from one, that stop lies inside the modal's scope, where `isBehindModal` does not exclude it. Reproduced under jsdom with a real `Drawer`: opened non-modal, a control focused, closed, `setModal(true)`, opened again — `back()` returned `true`. Reproduced offline for a `"manual"` layer registered again under a different modal. Both break the decision that the functions return `false` without moving or revealing anything, and that the trail is as the modal found it.
    - `navigate` now asks `LayerManager.hasModalLayer()` once and returns `false`. Two offline cases were written first and failed with `true`.
    - The `isBehindModal` test in `revealAndFocus` could no longer be reached, so it was removed with the sentence of its JSDoc. The existing case "back() skips, without revealing, an entry behind the topmost modal layer" passes unchanged.
    - Two of the plan's checks read differently as a result: `hasModalLayer` is on two code lines of `FocusHistory.ts` (`isHistoryStop` and `navigate`), and `isBehindModal` on none. See also item 3 under *Decided by the user on 2026-10-10*.
    - The JSDoc of `back()` and `forward()`, the recipe and the changelog say what the plan says: `false` while a dialog or a modal drawer is open.
11. **The three older modal cases register through the draining helper.** The plan says existing cases keep their inline register and unregister. Found by the review: each unregisters on the last line of its body, so a failing assertion left a modal layer registered for every later case in the file, and under one faulty version of the code that made K1 and K2 pass for the wrong reason. They now call the file's `register`; their own `unregister` calls stay, and no expectation changed.
12. **Small things the last review asked for.** `Alt+]` has its own stand-down case for each transient mode, since K1–K4 press only `Alt+[` and a stand-down for the back chord alone passed the file. A case pins that `back()` to the current stop fires `"change"` once with the flags unchanged, and the recipe says so. The comments on the two older modal cases describe the walk as it now is; the title "back() skips, without revealing, an entry behind the topmost modal layer" was kept, because this plan refers to the case by it. Three JSDoc tags were added that step 6 does not list: `@param` on `revealAndFocus` and `navigate`, `@returns` on `canGoForward`.

### Existing tests whose expected value changed

| Test | Change | Why |
|---|---|---|
| "disable() stops observing but preserves the trail" | the first `back()` lands on `b`, and a second one on `a` | case W9, as the plan says: focus is on `c`, which was never recorded, so going back returns to the current stop first |
| "back() still walks between entries inside the modal layer" | replaced by S5: `back()` returns `false` and focus stays | step 5 of the plan. The case was added by `modal-dialog-focus-trap` and pinned behaviour that has not been released |

No other existing case's expectation changed. The `afterEach` of `FocusHistory.test.ts` gained the layer drain and the `maxSize` reset (deviation 1), and three older modal cases register through the drain (deviation 11).

### Verification that was run

Whole check set from `packages/lib`: `typecheck`, `typecheck:test`, `lint`, the whole vitest suite (556 files, 9758 passed, 2 todo), `docs:api` (no warnings), `docs:llms:check`, `build:lib`. Of the plan's grep checks, two hold and one reads differently: `isInTransientLayer` is defined once and called once, `getLayerContaining` / `getLayers` appear nowhere under `src`, and `LayerManager.hasModalLayer()` appears twice in `FocusHistory.ts`, not once (deviation 10).

Chromium on Linux through chrome-devtools, on this worktree's demo dev server (port 8093, its own Vite cache), page `#/misc`. Every key was a real, trusted key press; a capture listener recorded `code`, `altKey` and `defaultPrevented` for each. Focus was given with `element.focus()`. No console error or warning.

| Case | Result |
|---|---|
| fresh page | `enable()` seeded nothing; after the first focus `canGoBack()` is `false` |
| MV1 | Shift+F10 opens the menu with focus; `Alt+[` moves nothing, is not prevented, the menu stays open and focused; `Escape` returns focus to the button; one `Alt+[` lands on "Show diagnostics overlay" |
| MV2 | the forward part survives the menu: `Alt+]` lands on "Show window with table (slow)!" |
| MV3 | in the form dialog `Alt+[` moves nothing and is not prevented; `FocusHistory.back()` and `forward()` both return `false`; after `Escape`, `Alt+]` then two `Alt+[` land as the row says |
| MV4 | `Alt+[` moves nothing with the panel open; after `Escape` with focus on `Apply` focus is on `<body>`; `Alt+[` lands on "Filters (PopupPanel)" |
| MV5 | the drawer's `Close` took a real click; focus dropped to `<body>`; `Alt+[` lands on "Non-modal drawer (left)" |
| MV6 | modal drawer: `Alt+[` moves nothing; `Escape` returns focus; one `Alt+[` reaches the stop before the button |
| MV7 | menu over the form dialog: `Alt+[` moves nothing; with both closed, one `Alt+[` reaches the stop before the button |
| MV8 | the minimised window's field is passed both ways and reached after the restore; the keys walk with the window open |
| MV9 | page 1200 × 260, ten real `Tab`s, then ten `Alt+[`: every landing fully visible |
| a control since removed | window closed with focus in its field: `Alt+[` lands on the window's button, `Alt+]` on the stop after |
| a control since disabled | a button disabled by script is passed over and kept; enabled again, `Alt+]` lands on it |
| `ComboBox` dropdown | `Alt+[` moves nothing while it is open; `ArrowDown`, `Enter` pick a row; the trail is as it was, forward part included, no repeated stop |
| `Popover`, default dismiss | `Alt+[` moves nothing; its `OK` button, focused by script, is not recorded; `Escape` drops focus to `<body>`; `Alt+[` lands on the opener, `Alt+]` on the stop after |
| `Popover`, `dismissOn: "manual"` | its `Close` button is a stop; the keys walk with it open; closed, `Alt+[` lands on the opener |
| context menu opened by the mouse | opened with scripted `pointerdown` and `contextmenu` events, since the tool sends no right click; `Alt+[` moves nothing while it is open |
| a control inside a table cell | not recorded; `Alt+[` returns to the table's body, then to the window's button (deviation 3) |

MV1, MV3 and MV6 were run again in the same way on the final code, after the review's change to `navigate` (deviation 10), with the served `FocusHistory.ts` checked to be that version. Same results; in the dialog and in the modal drawer `FocusHistory.back()` returns `false`.

**Not run.** Firefox and WebKit: manual. A `MenuBar` panel, a nested dialog and the two fade windows under `## Potential Challenges`. The `verify` skill drives the SQLAdmin application, which was not to be run.

### Merging with `feature/spatial-navigation-redesign`

A dry-run merge (`git merge-tree`) of this branch with that one (`28eb38020`) conflicts in three files. The same three files, with the same number of conflict hunks, conflict when `feature/tree-page-keys` alone is merged with it, so this branch adds no new conflict. It adds text inside two hunks that already existed:

- `docs/reference/changelog/next.md`, `## Changed`: both sides add a `### Core` heading at the same place. Keep one heading and both sets of entries: this branch's `FocusHistory` entry and that branch's two `SpatialNavigation` entries.
- `docs/reference/changelog/next.md`, `## Added` → `### Core`: both sides append. Keep both blocks; this branch's `isInTransientLayer` entry is the last of the chain's block.
- `docs/concepts/accessibility.md`: the sentence that starts "The service stands down while a transient overlay", from `modal-dialog-focus-trap`. Resolution as that plan's notes say. This branch's edit to the page's last paragraph merges cleanly.
- `core/Panel.ts`: from `scroll-reveal-geometry-fixes`; this branch does not touch the file.

`core/LayerManager.ts` merges cleanly: `getLayerContaining()` and `getLayers()` land after `getTopLayer()`, `isInTransientLayer()` after `isBehindModal()`, and no name is shared. That branch does not touch `core/FocusHistory.ts`, either test file or the recipe. The merged tree was not type-checked or tested.

### SQLAdmin

Read, not run. `FocusHistory` appears nowhere in `/home/jika/typescript/sqladmin` outside `node_modules` and its plans: the application does not enable the service, so nothing changes for it. `LayerManager.isInTransientLayer` is new, so nothing there calls it.

### Left as they are

- **A `PopupPanel`, a `Popover` and a non-modal `Drawer` leave focus on `<body>` when they close with focus inside**, as the plan's non-goals say. Seen in Chromium for all three. One `Alt+[` now returns to the opener.
- **`back()` fires `"change"` when it returns to the current stop**, with the flags it already had: the position did not move. It is a navigation, and `on`'s JSDoc promises the event after every one. A listener that only sets button states is not affected. Pinned by a case and stated in the recipe (deviation 12).
- **`Alt+]` does nothing from `<body>` when the current stop is the last one**, and still consumes the key. Going forward always starts after the current stop.
- **A hidden stop between two visits to one control** still makes `back()` "land" on the control focus is already on, as the plan's non-goals say.
- **The two fade windows** (a dropdown still registered while it fades out, a menu already unregistered while its element is still in the document) are as the plan describes them. Neither was provoked.
- **`accessibility.md`'s spatial-navigation section still says "a transient overlay — an open dropdown, a modal dialog"**, while `layering.md` now defines a transient layer as one that is not modal. Noted by the review. The plan says to leave that section alone, and the sentence is the one that already conflicts with `feature/spatial-navigation-redesign`. Reword it when that merge is resolved.
- **The test of "is this mode transient" is written twice in `LayerManager.ts`**, in `isInTransientLayer` and inline in `handleOutside`, which the plan says not to touch. A shared private helper is a follow-up.
- **`FocusHistory.test.ts` repeats the default trail length, 50**, to put it back after the case that changes it. The module exports neither the constant nor a reset, and the plan adds no public member to `FocusHistory`.
- **`isHistoryStop` compares the tag name in upper case**, as `isInTableCell` beside it does and as the plan gives it. Other files compare against `DOM.source.getBody()` or lower-case the tag first.
