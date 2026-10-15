---
depends-on: [references-to-disposed-components]   # line numbers below were taken at its tip, 96a1884ff
touches-shared:
  - packages/lib/src/typescript/lib/core/LayerManager.ts
  - packages/lib/docs/concepts/layering.md
  - packages/lib/docs/reference/changelog/next.md                # edited by every branch
---

# Overlay Anchor Handles After Dispose — Implementation Plan

## Overview

An open overlay layer — a dropdown, a menu, a popover — remembers the *handle* of its anchor: the library's opaque id for the trigger element it was opened from. `LayerManager` asks each layer for that handle through `DismissableLayer.getAnchorElement` ([LayerManager.ts:63](packages/lib/src/typescript/lib/core/LayerManager.ts#L63)) and uses it in two places:

- `resolveParent` ([LayerManager.ts:864](packages/lib/src/typescript/lib/core/LayerManager.ts#L864)), when a layer registers, to find the open layer whose element contains the anchor.
- `handleOutside` ([LayerManager.ts:1025](packages/lib/src/typescript/lib/core/LayerManager.ts#L1025)), on every document `pointerdown` and `focusin`, so that a press on the trigger does not count as a press outside the layer.

Both pass the handle to `DOM.source.contains`. The production `contains` ([DOM.ts:3033](packages/lib/src/typescript/lib/core/DOM.ts#L3033)) resolves both of its handles, and resolving a *released* handle — one whose component was disposed — throws `DOM handle N is not registered`. `feature/references-to-disposed-components` fixed this for `Popover` alone, by making `Popover.getAnchorElement()` return `null` for a released anchor. Two other layers still hand the manager their stored handle unchecked:

| Layer | Stored anchor | Set by |
|---|---|---|
| `AnimatedDropdown` and every subclass (`ComboBoxDropdown`, the picker dropdowns, `AutoCompleteDropdown`, `PopupPanel`) | `_anchorElement`, returned by `getAnchorElement` ([AnimatedDropdown.ts:464](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L464)) | `setAnchorElement`, `PopupPanel.toggleFor` |
| `Menu`, both modes, and its submenus | `_excludedEl`, returned by `getAnchorElement` ([Menu.ts:1763](packages/lib/src/typescript/lib/overlay/Menu.ts#L1763)) | `show(…, excludeEl)`, `toggleFor`, `setExcludedElement` |

`Dialog`, `Drawer` and `AbstractWindow` implement no anchor getter. `DismissableLayer` is exported from `core`, so an application can write its own layer too.

When such an anchor is disposed while its layer is open, the layer stays registered. The next `pointerdown` or `focusin` anywhere on the page that lands outside the layer throws from `handleOutside`. The walk goes from the top layer down and the throw ends it, so no layer beneath the stale one is dismissed or activated by that press. A layer that registers with an anchor already released throws from `register` as soon as any other layer is open. One path inside the library reaches this: open a `Window`'s window menu from its title icon, then call `win.getHeader().clearGlyph()`, which disposes the icon ([WindowHeader.ts:324](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L324)). The other paths are application code that passes an opener it later disposes.

The fix is one private helper in `LayerManager.ts` that both call sites use. No public signature changes.

---

## Architecture Decisions

### The manager checks an anchor handle before it uses it

`LayerManager` gets a private `liveAnchorOf(layer)`. It returns `layer.getAnchorElement?.()`, or `null` when there is none or `DOM.source.isRegistered` says the handle has been released. `resolveParent` and `handleOutside` call it in place of `getAnchorElement`. No layer class changes.[^manager-guard]

This follows the library's rule for a remembered handle: the code that resolves a handle it did not create asks `isRegistered` first, as `Tooltip` does for its pointer target ([Tooltip.ts:902](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L902)) and `FocusReveal.isLive` does for a reveal target ([FocusReveal.ts:267](packages/lib/src/typescript/lib/core/FocusReveal.ts#L267)). The manager is that code here.[^precedent]

### A released anchor counts as no anchor

`liveAnchorOf` returns `null`, so both call sites take the path they already take for a layer without an anchor:

| Call site | Anchor live | Anchor released (after this plan) |
|---|---|---|
| `resolveParent` | links under the layer whose element contains the anchor | links under the last-registered reachable layer, the existing no-anchor fallback |
| `handleOutside` | a press inside the anchor is not "outside"; the walk stops | no exclusion: the layer is treated by its dismiss mode, and the walk continues to the layers below |

The released handle is not cleared from the layer. The manager does not own the layer's fields.[^no-clear]

### An open layer is not closed when its anchor is disposed

A dropdown or menu whose anchor is disposed stays open. It closes the way it always does: on the next press outside it, on Escape, or on a window blur. Each of those runs its normal `requestClose`, so the host's close handler or the menu's `onClose` fires. A press inside the layer still works, so an item can still be chosen. `Popover` keeps the behaviour the previous branch gave it: it closes the next time it needs the anchor's position.[^stay-open]

### The layers' anchor getters are left as they are

`AnimatedDropdown.getAnchorElement`, `Menu.getAnchorElement` and `Menu.getExcludedElement` keep returning the stored handle, released or not. `Popover.getAnchorElement` keeps its own `isRegistered` check, which its public JSDoc already promises.[^getters]

### The branch goes on the non-Markdown chain

The branch starts from `feature/references-to-disposed-components`, whose review found this defect. No unmerged branch in `.worktrees/` edits `core/LayerManager.ts` against that base.

---

## Decisions Awaiting Sign-off

| # | Change | Before | After | Recommendation |
|---|---|---|---|---|
| D1 | A dropdown or menu whose anchor is disposed while it is open | stays open; the next outside press or focus move throws, and no layer beneath it is dismissed by it | stays open; the next outside press, Escape or window blur closes it, and its `onClose` or close handler runs | Yes. It is how the layer closes with a live anchor. Closing it at once would need a release notice for a handle, which does not exist. |
| D2 | Any layer, including one an application writes, whose `getAnchorElement` returns a released handle | `register` and the outside-press walk throw | the handle is treated as no anchor | Yes. The interface never required a live handle, and the manager is the only reader. |
| D3 | `AnimatedDropdown.getAnchorElement()`, `Menu.getAnchorElement()`, `Menu.getExcludedElement()` | return the stored handle | unchanged | Leave them. Only `Popover`'s filters, and making the others match is a public change the bug does not need. |

None needs a migration note: no consumer code has to change.

---

## Internal Structure

### `LayerManager`

A new private function, placed directly before `nodeContains` ([LayerManager.ts:885](packages/lib/src/typescript/lib/core/LayerManager.ts#L885)):

```ts
    /**
     * Returns `layer`'s anchor element, or `null` when it has none or when
     * the anchor's element has been released since the layer stored it — its
     * component was disposed while the layer stayed open. Every read of a
     * released handle throws, and the outside-press walk below serves every
     * open layer, so one layer's stale anchor would stop the walk for all of
     * them. A released anchor is treated as no anchor.
     *
     * @param layer - The layer whose anchor is wanted.
     * @returns The anchor element, or `null`.
     */
    function liveAnchorOf(layer: DismissableLayer): Handle | null {
        const anchor = layer.getAnchorElement?.() ?? null;

        if (anchor === null) {
            return null;
        }

        const live = DOM.source.isRegistered(anchor);

        return live ? anchor : null;
    }
```

`resolveParent`, first line:

```ts
        const anchor = liveAnchorOf(layer);
```

`handleOutside`, the anchor read inside the loop:

```ts
            const anchor = liveAnchorOf(node.layer);
```

The JSDoc of `DismissableLayer.getAnchorElement` gains one paragraph after its existing text:

```ts
    /**
     * Optional anchor element excluded from "outside" tests so the trigger
     * click that opened the layer does not immediately re-close it.
     *
     * The manager reads it on every outside press and focus move. A handle
     * whose element has been released since — its component was disposed
     * while the layer stayed open — counts as no anchor, so an implementation
     * may return the handle it stored without checking it.
     */
```

### Test helpers

The new test file imports `describe`, `it`, `expect`, `beforeEach`, `afterEach`, `vi` and `type Mock` from `vitest`; `LayerManager` and `type DismissableLayer` from `~/core/LayerManager`; `AnimatedDropdown`, `Component`, `Menu`; `DOM`, `type Handle` and `type Rect` from `~/core/DOM`; `installTestDOM` and `makeEvent` from `../dom/TestDOM`; and the font metrics and `CONFIG` exactly as `tests/overlay/LayerManager.test.ts` declares them. It needs three helpers that the existing fixtures do not show:

```ts
/** Makes `DOM.source.contains` throw, as production's does, when either handle is released. */
function throwOnReleasedHandle(): void {
    const realContains = DOM.source.contains.bind(DOM.source);

    vi.spyOn(DOM.source, 'contains').mockImplementation((ancestor, node) => {
        const ancestorLive = DOM.source.isRegistered(ancestor);
        const nodeLive     = node === null || DOM.source.isRegistered(node);

        if (!ancestorLive || !nodeLive) {
            throw new Error('DOM handle is not registered');
        }

        return realContains(ancestor, node);
    });
}

/** Dispatches a `pointerdown` on a fresh element outside every layer and every anchor. */
function pressOutside(): void {
    const outside = DOM.sink.createElement('div');

    DOM.sink.appendChild(DOM.source.getDocumentElement(), outside);
    DOM.sink.dispatchEvent(outside, makeEvent(outside, 'pointerdown'));
}

// The manager is a module singleton; drain every layer, before and after, so
// a layer left by another case cannot be walked with a released element.
function drainLayers(): void {
    for (const layer of LayerManager.getLayers()) {
        LayerManager.unregister(layer);
    }
}
```

The `describe`'s hooks:

```ts
    beforeEach(() => {
        installTestDOM(CONFIG);
        drainLayers();
        throwOnReleasedHandle();
    });

    afterEach(() => {
        drainLayers();
        vi.restoreAllMocks();
        // A menu starts a viewport input watch that outlives it; left in
        // place, it keeps the window's pointerdown routing bound to the DOM
        // this case is about to discard, and the next case's press reaches
        // nothing.
        Menu._stopInputWatch();
        DOM.reset();
    });
```

The spy checks both arguments, unlike the `Popover` test L1, because `resolveParent` passes the anchor as the second one.

---

## Ordered Implementation Steps

Run every command from `packages/lib`, with one vitest process and `--maxWorkers=1` or `2`.

1. **Record the baseline.** `npx vitest run --maxWorkers=2 2>&1 | tail -6`; write the "Test Files" and "Tests" lines into the Implementation Notes.

2. **Write the tests.** Create `tests/overlay/LayerManager.anchorReleased.test.ts` with the helpers and hooks of `## Internal Structure`, a stub-layer builder, and cases H1–H5, M1, M2 and D1 of `## Expected Behaviour`. Run it: `npx vitest run tests/overlay/LayerManager.anchorReleased.test.ts --maxWorkers=1`. Seven cases fail with `DOM handle is not registered`; H5 passes.

3. **Add the guard.** In `src/typescript/lib/core/LayerManager.ts`: add `liveAnchorOf` before `nodeContains`, and replace the `getAnchorElement?.()` read in `resolveParent` (line 865) and in `handleOutside` (line 1025) with a call to it.
   - Check: `grep -n "getAnchorElement?.()" src/typescript/lib/core/LayerManager.ts` — one match, inside `liveAnchorOf`.
   - Run the step 2 file again: no failure.

4. **Interface JSDoc.** Add the paragraph of `## Internal Structure` to `DismissableLayer.getAnchorElement` (line 59).

5. **Documentation** (`## Documentation Impact`), then everything in `## Verification`. Compare the full run with step 1: the failed count is unchanged; one more test file, and eight more passed tests.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/overlay/LayerManager.anchorReleased.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit tests in `tests/overlay/LayerManager.anchorReleased.test.ts` unless marked manual.

**Fixtures.** A *stub layer* is a plain `DismissableLayer` object: its own `div` appended to the document element as its layer element, dismiss mode `"click-outside"`, `requestClose` a `vi.fn<() => boolean | void>()`, and optionally `getAnchorElement`, `getBand` and `isLayerRoot`. *Release* a handle with `DOM.sink.release(handle)`. A *mounted opener* is `new Component()` whose element is appended to the document element; disposing it releases that element. `TRIGGER_RECT` is any on-screen rect, for example (100, 100), 80 by 24, with `left`, `top`, `right` and `bottom` filled in.

In the cases that press, register the layer **before** releasing its anchor. Released first, `register` itself throws, and the case tests the wrong path.

| # | Steps | Required | Today |
|---|---|---|---|
| H1 | a stub layer with an anchor `div`; register; release the anchor; `pressOutside()` | no throw; `requestClose` called once | throws from `handleOutside` |
| H2 | register stub `lower` (no anchor), then stub `upper` with an anchor; release the anchor; `pressOutside()` | `upper.requestClose` and `lower.requestClose` each called once | throws; neither is called |
| H3 | a stub layer with an anchor; register; release the anchor; dispatch `focusin` on a fresh mounted `div` | no throw; `requestClose` not called (a `"click-outside"` layer ignores focus moves) | throws |
| H4 | register a stub root in `Band.Window`; release a fresh `div`; register a stub with that anchor and `Band.Dropdown` | no throw; its z-index is above the window's and below `Band.PinnedWindow` | `register` throws from `resolveParent` |
| H5 | control: a stub layer whose anchor is a mounted, live `div`; register; dispatch `pointerdown` on the anchor | `requestClose` not called | same |
| M1 | `new Menu()`; `toggleFor(opener element, TRIGGER_RECT, [{ text: 'A' }], onClose)` with a mounted opener; dispose the opener; `pressOutside()` | no throw; `onClose` called once; `LayerManager.getLayers()` does not contain the menu | throws; the menu stays registered |
| M2 | `new Menu([{ text: 'A' }], onClose)`; `setExcludedElement(bar element)` and `open(bar element)` with a mounted opener `bar`; dispose `bar`; `pressOutside()` | no throw; `onClose` called once | throws |
| D1 | `new AnimatedDropdown({ animated: false })`; `setAnchorElement(opener element)`; `showAnimated()`; dispose the opener; `pressOutside()` | no throw; `isOpen()` is `false`; `getLayers()` does not contain it | throws; stays open |

H4's z-index bounds show which layer it linked under: only a layer linked under the window inherits the window's band.

M1, M2 and D1 call `dispose()` on their menu or dropdown at the end.

### Manual

1. **Window menu.** In the demo, keep a reference to a `Window` in the console (`win`). Click its title icon to open the window menu, then run `win.getHeader().clearGlyph()`. Click on the page outside the menu. The menu closes and the console stays clean. Today the click throws `DOM handle … is not registered`.

---

## Verification

- `npx vitest run tests/overlay/LayerManager.anchorReleased.test.ts tests/overlay/LayerManager.test.ts tests/overlay/Popover.test.ts tests/overlay/Menu.test.ts tests/overlay/AnimatedDropdown.test.ts --maxWorkers=1` — no failure.
- `npx vitest run tests/overlay tests/core/FocusTraversal.test.ts tests/core/Body.modalInert.test.ts tests/unit/core/FocusHistory.test.ts --maxWorkers=2` — no failure.
- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — clean.
- `npm run test` — the failed count equals step 1's; one more file, eight more passed tests.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms:check` and `npm run build:lib` — succeed.
- `grep -n "getAnchorElement?.()" src/typescript/lib/core/LayerManager.ts` — one match, inside `liveAnchorOf`.
- The manual check.

---

## Documentation Impact

No public API changes.

`packages/lib/docs/concepts/layering.md`, in the paragraph that explains how `register` resolves the opener (lines 31–43), after the sentence ending "falls back to the last-registered layer — … since the user can open nothing from a layer that is inert.":

```markdown
An anchor whose component has been disposed while the layer stayed open
counts as no anchor, here and in the [dismiss modes](#dismiss-modes) below.
```

`packages/lib/docs/reference/changelog/next.md`, under `## Fixed` → `### Overlay`, as the last bullet, in that file's blank-line-separated style:

```markdown
- **A dropdown or menu whose trigger is disposed while it is open no longer
  breaks outside clicks.** Every later press or focus move outside it threw
  `DOM handle … is not registered`, and other open menus and dropdowns did
  not close on that press.
  This happened with a `Window`'s window menu after `clearGlyph()` on its
  header, and with any `Menu`, `PopupPanel` or other dropdown opened from a
  component the application disposed. The layer now stays open until the
  next outside press, Escape or window blur closes it as usual. No consumer
  action is needed.
```

---

## Potential Challenges

- **A press dispatched in a test can reach nothing.** A `Menu` starts a viewport input watch that is never removed, so after `DOM.reset()` it keeps the window's `pointerdown` routing bound to the discarded DOM. Without `Menu._stopInputWatch()` in `afterEach`, M2 and D1 pass or fail without the press reaching the manager. H1, H2, M1, M2 and D1 assert a close, so a press that reached nothing fails them.
- **Stray layers from other cases.** `LayerManager` is a module singleton. A layer left registered by an earlier case has an element released by `DOM.reset()`, and the throwing `contains` spy would throw on it. `drainLayers()` in both hooks prevents that.
- **`LayerManager.test.ts` says the outside-press walk cannot be reached offline** (line 1059). That comment predates `DOM.sink.dispatchEvent` reaching viewport listeners; the new file reaches it. Leave the comment (`## Non-Goals`).
- **Line numbers drift.** Find each site by the symbol named in the step. The numbers are from `96a1884ff`.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/LayerManager.ts](packages/lib/src/typescript/lib/core/LayerManager.ts) — `DismissableLayer.getAnchorElement` (59), `register` (413), `nodeOwning` (821), `resolveParent` (864), `nodeContains` (886), `handleOutside` (1002), `onPointerDown` / `onFocusIn` (1063, 1088).
- [packages/lib/src/typescript/lib/overlay/Tooltip.ts:902](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L902) — the precedent: a reader checks a handle it merely remembers before `contains` resolves it.
- [packages/lib/src/typescript/lib/overlay/Popover.ts:643](packages/lib/src/typescript/lib/overlay/Popover.ts#L643) — `getAnchorElement`, the per-layer check this plan does not copy.
- [packages/lib/src/typescript/lib/core/AnimatedDropdown.ts:464](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L464) and [packages/lib/src/typescript/lib/overlay/Menu.ts:1763](packages/lib/src/typescript/lib/overlay/Menu.ts#L1763) — the two getters the review named; read, not edited.
- [packages/lib/src/typescript/lib/overlay/Menu.ts:1325](packages/lib/src/typescript/lib/overlay/Menu.ts#L1325) — `_stopInputWatch`, needed by the test's `afterEach`.
- [packages/lib/tests/overlay/LayerManager.test.ts](packages/lib/tests/overlay/LayerManager.test.ts) — `fakeLayer` (38), the shape the stub layer follows.
- [packages/lib/tests/overlay/Popover.test.ts:627](packages/lib/tests/overlay/Popover.test.ts#L627) — test L1, the throwing-`contains` spy; the new file's helper checks both arguments instead of the first.
- [plans/implemented/references-to-disposed-components.md](plans/implemented/references-to-disposed-components.md) — its D2 and the Implementation Notes' follow-up entry this plan closes.

---

## Non-Goals

- **Making the test DOM's `contains` throw on a released handle.** It would let tests drop the spy; its effect on the rest of the suite is not known.
- **Closing a dropdown or menu the moment its anchor is disposed.** Sign-off D1.
- **Changing the anchor getters of `AnimatedDropdown` and `Menu`, or removing `Popover`'s check.** Sign-off D3.
- **Rewording the stale "Documented offline gap" comment in `LayerManager.test.ts`.** It is not this plan's code.
- **A released *layer* element.** `getLayerElement` returns the layer's own element, which is released only by the layer's own `dispose`, and every layer unregisters in its destructor (`ARCHITECTURE.md`, *Modal layers*). A throw there would point at a missing unregister, which should stay loud.

---

## Notes

[^manager-guard]: The alternative was the `Popover` shape: the same three lines in `AnimatedDropdown.getAnchorElement` and `Menu.getAnchorElement`. That leaves any other implementer exposed, and `DismissableLayer` is exported from `core/index.ts`, so an application's own layer is one. It also lets one layer's mistake break dismissal for every other open layer, because the walk is shared. One check in the manager covers every implementer, present and future, and the two call sites are the only places in the library that resolve an anchor: no other module calls `getAnchorElement`. The check costs one map lookup per open layer per press.

[^precedent]: Every `isRegistered` guard in the library sits at the site that resolves a handle it did not create: `Dialog.restorePreviousFocus`, `Drawer`, `AbstractWindow` (the previously focused element), `Menu`'s invoker checks, `Tooltip`'s anchor watch and pointer target, and `FocusReveal.isLive`. `Tooltip.ts:902` states the rule: `contains` "would resolve it and throw, which is the right answer for a handle a caller owns and the wrong one for a handle it merely remembers". The anchor belongs to neither the layer nor the manager, and the manager is the one that resolves it. `Popover`'s getter check, added in the previous branch's first review round, is the one guard placed in a getter rather than at the call that resolves the handle.

[^no-clear]: Clearing would mean the manager writing a layer's private field, or a new hook on the interface for it. Leaving the handle costs one `isRegistered` lookup per press while the layer stays open, and the layer forgets it at its next open: `toggleFor`, `show`, `setAnchorElement` and `setExcludedElement` each overwrite it.

[^stay-open]: The previous plan's D2 closed a `Popover` at the first moment it needed its anchor: its resize, scroll and layout handlers read the anchor's rect. `AnimatedDropdown` and `Menu` read their stored anchor nowhere except in the getter; neither repositions against it after opening. The first moment either needs the anchor is the manager's next outside press, and on that press a `"click-outside"` layer now closes. So the rule is the same — close when the anchor is next needed — and needs no new code. Closing at once was considered: the layer holds only a handle, and a handle has no release notification; the layer would have to be given the anchor's `Component` and subscribe to its `onDestroy`, which changes `setAnchorElement`, `toggleFor`, `show` and `setExcludedElement`, all public. Inside the library, every host that owns its dropdown or menu already disposes it in its own destructor before its element is released (`ComboBox`, `AbstractPickerField`, the date-time cell editor, `AutoCompleteField`, `PopupButton`, `MenuButton`, `SplitButton`, `ToolBar`, `MenuBar`, `AbstractWindow`), so the stale-anchor case is limited to an opener disposed on its own.

[^getters]: The bug is the manager's read, and the manager's check fixes it for every getter. Filtering the getters as well would change three public return values to fix nothing further, and `Menu.getExcludedElement` has no counterpart on `Popover` to stay consistent with. `Popover`'s check stays because its JSDoc and the changelog entry of the previous branch already promise `null` for a disposed anchor; removing it would be a second public change in the other direction.
