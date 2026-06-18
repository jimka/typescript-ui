---
depends-on: [options-bag-listeners]
---

# Typed Listener Bags — Implementation Plan

## Overview

The just-shipped [`options-bag-listeners`](implemented/options-bag-listeners.md) feature made the construction-time `listeners` bag an **open** map: an arbitrary DOM-event key (`click`, `dblclick`) on any component routes through `Event.addListener`, while a host's declared custom keys route through `on()`. The open index signature means a typo (`clik`), a foreign component's event (`collapse` on a `Button`), or a never-firing DOM key all compile silently — the bag is not a faithful mirror of what the component actually exposes.

This plan makes the `listeners` bag a **pure, typed mirror of each component's `on()` surface**. A component's bag accepts EXACTLY the events its `on()` overloads accept — its `XEvent` union — each typed with the matching listener signature. Any other key is a COMPILE ERROR. Because every bag key is now an `on()` event, applying the bag collapses to one operation: `for (const key of Object.keys(bag)) this.on(key, bag[key])`. This is precisely the closed-bag + generic-key-iteration pattern the non-Component hosts ([`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts#L112), [`Tab`](../src/typescript/lib/layout/Tab.ts#L333), [`Accordion`](../src/typescript/lib/layout/Accordion.ts#L136), [`ButtonGroup`](../src/typescript/lib/core/ButtonGroup.ts#L60)) ALREADY use — they become the template, and the Component side converges on it.

This **partially reverts** the DOM-routing mechanism `options-bag-listeners` added to [`Component.ts`](../src/typescript/lib/core/Component.ts): the `ComponentListeners` type, the base `ComponentOptions.listeners` field, the `applyListenerOptions` DOM pass, and `customListenerKeys()` are all removed. The single `applyCustomListeners` helper survives (renamed `applyListeners`) as the one general dispatcher. Components with no `on()` (plain `Component`, `ToolBar`) get NO `listeners` option at all, so the invalid DOM-bag demo and docs the prior feature added are removed/rewritten.

---

## Architecture Decisions

### This plan deliberately reverts the `options-bag-listeners` DOM-routing mechanism

The prior feature's central premise — "one bag carries both DOM and custom events, for any component, with zero host code" — required an **open** value type (`ComponentListeners` with a `[event: string]` index signature) so every host bag stayed assignable to a base field. That feature's own `## Architecture Decisions` flagged the cost explicitly: *"a typo'd custom key is not a compile error… silently accepted and routed to `Event.addListener` as a DOM type that never fires."* It accepted that cost as "the price of a single unified field."

The confirmed design rejects that tradeoff. The value of the bag is that it mirrors `on()` — a closed union per component, so `new Button({ listeners: { clik: … } })` and `{ collapse: … }` and any raw DOM key are compile errors. Achieving that requires removing the open base field and the DOM pass, because:

- A **closed** per-host bag is no longer assignable to an open base `ComponentListeners` field in a way that catches errors — the only way to make typos fail is for each host to declare its own closed `listeners` field with no base intersection.
- With no base field, there is no shared DOM pass to route raw DOM keys; and since base `Component` has **no `on()` method** (verified — `on`/`off`/`emit` live only on hosts with a `ListenerBag` or a semantic shorthand), it should carry no `listeners` option at all.
- The DOM-name-collision machinery (`customListenerKeys()`, the "scroll wins its own name" split) exists only to disambiguate DOM keys from custom keys in one open bag. With no DOM keys in the bag, the collision cannot arise, so that apparatus is dead weight.

The reversion is surgical: it removes the type, the base field, the two split-routing members, and the per-host `customListenerKeys()` overrides; it keeps the one-line dispatch helper. This is consistent with ARCHITECTURE.md, which already specifies the bag as `listeners?: { [event]?: listener }` dispatched to `on(event, fn)` — the prior feature's open-DOM extension was the divergence; this plan returns to the documented shape.

### The bag is the component's `on()` surface, expressed as a closed interface

Each `on()`-bearing component declares `listeners?` in its own `XOptions` as a plain closed bag of exactly its own events, each typed to the listener that event's `on()` overload accepts. Examples:

```typescript
// CollapseButtonOptions
listeners?: { collapse?: () => void };

// ButtonOptions
listeners?: { action?: ClickListener };

// CheckboxOptions  (extends AbstractInputOptions's change/binding, adds action)
listeners?: { action?: () => void; change?: (value: boolean) => void; binding?: () => void };
```

There is no `ComponentListeners &` / `DomEventListeners &` intersection anymore. The bag's payload types come straight from each `on()` overload, so the compiler enforces both the **key set** (the `XEvent` union) and the **listener shape** per key.

### One general helper, `applyListeners(bag)`, replaces the DOM/custom split

`applyCustomListeners(listeners, customKeys)` becomes `applyListeners(bag)` — a single protected helper that iterates `Object.keys(bag)` and calls `(this as any).on(key, fn)` for each defined entry. No key set parameter (every key is an `on()` event now), no DOM branch. This is byte-for-byte the loop `AbstractStore`/`Tab`/`Accordion`/`ButtonGroup` already inline; centralising it on `Component` lets the 10 Component hosts call `this.applyListeners(options?.listeners)` once in their constructor body after `super()`.

The `(this as any).on(...)` cast stays for the same reason it existed: base `Component` has no `on`, so the helper is sound only when invoked by a host that defines one — and it is only ever called from host constructor bodies. The base never calls it.

**Timing unchanged.** The helper still runs from the constructor body after `super()` returns, because `on()` writes into a `ListenerBag` field that initialises after the `super()` cascade (CODE_CONVENTIONS.md, *Fields written during the `super()` cascade*; ARCHITECTURE.md *Event handling*). The deleted `applyListenerOptions` was the only thing that ran during `super()`, and it is gone.

### `action` is a per-leaf bag key, not an `AbstractInput` field

ARCHITECTURE.md's event section names the action-bearing controls: `Button`, `Checkbox`, `Slider`, `ComboBox`, `ToggleButton`, `List` (`AbstractCustomList`). Each exposes `on("action", …)` as a semantic DOM shorthand whose body calls `Event.addListener(this, <domType>, fn)` — so wiring `action` through the bag is just `this.on("action", fn)`, which the existing overload handles.

`action` is declared **per concrete leaf class**, NOT on `AbstractInputOptions`, because `AbstractInput` itself exposes no `on("action")` — only its concrete subclasses do, and `change`/`binding` (the genuinely shared inputs events) already live on `AbstractInputOptions`. Putting `action` on the shared base would offer it on hypothetical subclasses that don't expose it. So:

- `ButtonOptions` gains `listeners?: { action?: ClickListener }` (Button has no listeners wiring today — this adds it). `ToggleButton` and `SpinButton` extend `ButtonOptions`; `SpinButton` widens to add `tick`.
- `CheckboxOptions`, `SliderOptions`, `ComboBoxOptions`, `AbstractCustomListOptions` each add `action?` alongside the inherited `change`/`binding`.

**Note — `TextInput` and `RadioButton` also expose `on("action")`** ([`TextInput.ts:172`](../src/typescript/lib/component/input/TextInput.ts#L172), [`RadioButton.ts:313`](../src/typescript/lib/component/input/RadioButton.ts#L313)) though ARCHITECTURE.md's canonical list omits them. The rule is "the bag mirrors `on()`", so these two get `action?` in their bag too, for fidelity. The implementer adds `action` wherever an `on("action")` overload exists.

### Components with no `on()` get no `listeners` option

Plain `Component` and `ToolBar` expose no `on()` surface, so they carry no `listeners` field. The prior feature's `ToolBarPanel` demo wired a native `dblclick` through a Button's bag (`listeners: { dblclick: … }`); `dblclick` is not a Button `on()` event, so that is now a compile error and is removed. Consumers needing post-construction DOM listeners use `Event.addListener` directly, as before the prior feature.

### Non-Component hosts need no change beyond confirmation

`AbstractStore`, `Tab`, `Accordion`, `ButtonGroup` already declare closed bags and already iterate `Object.keys(listeners)` → `this.on(...)`. They are the template this plan converges the Component side onto; they require no edits. (`Tab`/`Accordion`/`ButtonGroup` cast `this.on` to the implementation signature inside the loop — the Component `applyListeners` helper uses the same `(this as any).on` cast.)

---

## Public API (TypeScript Signatures)

```typescript
// Component.ts — REMOVED:
//   export type ComponentListeners = …                       (delete)
//   ComponentOptions.listeners?: ComponentListeners;          (delete the field)
//   protected customListenerKeys(): readonly string[]         (delete)
//   protected applyListenerOptions(opts: TOptions): void      (delete + its call in applyOptions)

// Component.ts — KEPT, renamed and simplified:
/**
 * Wires a closed `listeners` bag via `this.on()`. A host with an `on()` surface
 * calls this once from its constructor body after `super()` returns (when its
 * `ListenerBag` exists). The base never calls it — base `Component` has no `on`.
 */
protected applyListeners(
    listeners: Record<string, ((...args: any[]) => void) | undefined> | undefined
): void;
```

Per-host `listeners` fields (each a closed bag, no intersection):

```typescript
// ButtonOptions               (Button.ts)            — NEW field
listeners?: { action?: ClickListener };

// SpinButtonOptions           (SpinButton.ts)        — drop ComponentListeners &
listeners?: { action?: ClickListener; tick?: () => void };

// ToggleButton uses inherited ButtonOptions.listeners ({ action?: ClickListener }) — no field needed unless it adds events

// AbstractInputOptions        (AbstractInput.ts)     — drop ComponentListeners &
listeners?: { change?: (value: any) => void; binding?: () => void };

// CheckboxOptions / SliderOptions / ComboBoxOptions / AbstractCustomListOptions / TextInputOptions / RadioButtonOptions — add action to the closed bag
listeners?: { action?: () => void; change?: (value: T) => void; binding?: () => void };

// CollapseButtonOptions       — listeners?: { collapse?: () => void };
// TreeOptions                 — listeners?: { selection?: …; loaderror?: … };
// WindowBorderOptions         — listeners?: { drag?: … };
// SplitGutterOptions          — listeners?: { dragstart?: …; drag?: …; collapse?: … };
// ScrollbarOptions            — listeners?: { scroll?: … };
// ResizeHandleOptions         — listeners?: { dragstart?: …; dragmove?: …; dragend?: … };
// TabBarOptions               — listeners?: { tabpressed?: …; reordered?: …; … };
// DrawerOptions               — listeners?: { open?: …; close?: …; beforeclose?: … };
```

The exact payload type per key must be copied from that event's `on()` overload signature — not invented. Where an existing host already had a closed sub-bag inside its `ComponentListeners & { … }` intersection, that sub-bag is the field (just remove the `ComponentListeners &` prefix).

---

## Internal Structure

New `applyListeners` body (replaces `applyCustomListeners` + deletes `applyListenerOptions`):

```typescript
protected applyListeners(
    listeners: Record<string, ((...args: any[]) => void) | undefined> | undefined
): void {
    if (!listeners) {
        return;
    }

    for (const event of Object.keys(listeners)) {
        const fn = listeners[event];

        if (fn) {
            (this as any).on(event, fn);
        }
    }
}
```

Host constructor call (replaces `this.applyCustomListeners(options?.listeners, this.customListenerKeys())`):

```typescript
// after super(), in the constructor body
this.applyListeners(options?.listeners);
```

Button gains this call at the end of its constructor body (it has none today); it routes `listeners.action` → `this.on("action", fn)` → `Event.addListener(this, "click", fn)`.

`applyOptions` loses its `this.applyListenerOptions(opts);` line ([`Component.ts:475`](../src/typescript/lib/core/Component.ts#L475)).

---

## Ordered Implementation Steps

1. **Strip the base mechanism** in [`Component.ts`](../src/typescript/lib/core/Component.ts): delete the `ComponentListeners` type (lines ~97–110), delete `ComponentOptions.listeners` (line ~163) and its JSDoc, delete `customListenerKeys()` (lines ~505–517), delete `applyListenerOptions` (lines ~519–550) and remove its call from `applyOptions` (line ~475). Rename `applyCustomListeners` → `applyListeners` with the single-arg signature above; update its JSDoc. Check whether the `Event` import (line 14) is still used elsewhere in the file (it is — chrome/other code uses `Event`); leave it.
   → verify: `grep -rn 'ComponentListeners\|applyListenerOptions\|customListenerKeys' src/typescript/lib` → zero matches (after step 4).

2. **Barrel.** Remove `ComponentListeners` from the `export type { … }` line in [`core/index.ts`](../src/typescript/lib/core/index.ts#L14).

3. **Migrate the 10 Component custom hosts.** For each: (a) change `listeners?: ComponentListeners & { … }` to the bare closed bag `listeners?: { … }`; (b) delete the `protected customListenerKeys()` override; (c) replace `this.applyCustomListeners(options?.listeners, this.customListenerKeys())` with `this.applyListeners(options?.listeners)`; (d) drop the now-unused `ComponentListeners` import (and the `Component`/`ComponentOptions` import only if they become unused — they won't). Hosts:
   - `Tree` ([Tree.ts](../src/typescript/lib/component/tree/Tree.ts)) — `{ selection?: …; loaderror?: … }`
   - `AbstractInput` ([AbstractInput.ts](../src/typescript/lib/component/input/AbstractInput.ts)) — `{ change?: (value: any) => void; binding?: () => void }`
   - `SpinButton` ([SpinButton.ts](../src/typescript/lib/component/input/SpinButton.ts)) — `{ action?: ClickListener; tick?: () => void }` (action from Button surface, tick from SpinButton)
   - `WindowBorder` — `{ drag?: … }`
   - `SplitGutter` — `{ dragstart?: …; drag?: …; collapse?: … }`
   - `CollapseButton` — `{ collapse?: () => void }`
   - `Scrollbar` — `{ scroll?: … }`
   - `ResizeHandle` — `{ dragstart?: …; dragmove?: …; dragend?: … }`
   - `TabBar` — `{ tabpressed?: …; reordered?: …; tabclose?: …; dockrequested?: …; tabdragstart?: …; tearoffrequested?: …; detached?: … }`
   - `Drawer` ([Drawer.ts](../src/typescript/lib/core/Drawer.ts)) — `{ open?: …; close?: …; beforeclose?: … }`

   Copy each key's payload type from the host's `on()` overloads. → verify after each: typecheck.

4. **Add `action` to the action controls' bags.** For `Button` ([Button.ts](../src/typescript/lib/component/button/Button.ts)): add `listeners?: { action?: ClickListener }` to `ButtonOptions`, and add `this.applyListeners(options?.listeners)` at the end of the constructor body (after `ThemeManager.onThemeChange(...)`). For `Checkbox`, `Slider`, `ComboBox`, `AbstractCustomList`, `TextInput`, `RadioButton`: add `action?` (typed to that class's `on("action")` listener) to the existing closed `listeners` bag. These extend `AbstractInput`, which now calls `applyListeners` — confirm `action` routes through `on("action")` there (it does; the helper iterates all keys). `ToggleButton` inherits `ButtonOptions.listeners` — no field needed unless it adds events; confirm it compiles.
   → verify: `new Button({ listeners: { action: () => {} } })` typechecks; `{ click: … }`, `{ clik: … }`, `{ collapse: … }` each error.

5. **Fix the `ToolBarPanel` demo.** In [`ToolBarPanel.ts`](../src/typescript/ToolBarPanel.ts): delete the `domBagButton` block (lines ~119–127), remove it from `looseBar.addComponents(...)` (line ~132), and excise the "Double-click me … `listeners` bag" clause from the class JSDoc (lines ~28–31). → verify: typecheck; `looseBar` still renders Cut/Copy.

6. **Update the `MiscPanel` demo (positive proof).** In [`MiscPanel.ts`](../src/typescript/MiscPanel.ts#L673), the `nonModalDrawerButton` currently wires `action` post-construction via `.on("action", …)`. Rewrite it to wire `action` through the `listeners` bag instead — `new Button("Non-modal drawer (left)", { listeners: { action: () => openDemoDrawer(Placement.WEST, false, "left") } })` — the live proof the typed `action` bag fires. (The prompt's "empty `listeners: {}`" reference predates a rebase; the button currently has none — convert its `.on` call.)
   → verify: clicking the button opens the non-modal drawer.

7. **Rewrite the docs section.** In [`docs/recipes/component-options.md`](../docs/recipes/component-options.md#L131): replace the "Wiring event listeners" section (lines 131–164). New copy: the bag mirrors each component's `on()` surface; only that component's own events are settable; unknown keys, typos, DOM event names, and another component's events are compile errors. Replace the `ToolBar({ listeners: { click, dblclick } })` and `SplitGutter` DOM examples with valid ones — e.g. `Button({ listeners: { action: () => … } })`, `Drawer({ listeners: { open, close } })`, `SplitGutter({ listeners: { drag, collapse } })` (all `on()` events). Remove the "DOM-event keys register through Event routing" framing and the "scroll wins its own name over the DOM collision" sentence (no collision exists now). Remove the `[ComponentListeners](/api/core/type-aliases/ComponentListeners)` link. → verify: `npm run docs:build`.

8. **Reversion sweep.** `grep -rn 'ComponentListeners\|applyListenerOptions\|customListenerKeys\|applyCustomListeners' src/typescript/lib` → zero matches. `grep -rn 'applyListeners' src/typescript/lib/core/Component.ts` → one definition. → verify.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (delete type/field/two split members + call; rename helper) |
| Modify | `src/typescript/lib/core/index.ts` (drop `ComponentListeners` export) |
| Modify | `src/typescript/lib/component/tree/Tree.ts` |
| Modify | `src/typescript/lib/component/input/AbstractInput.ts` |
| Modify | `src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `src/typescript/lib/component/input/Checkbox.ts` (add `action`) |
| Modify | `src/typescript/lib/component/input/Slider.ts` (add `action`) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (add `action`) |
| Modify | `src/typescript/lib/component/input/TextInput.ts` (add `action`) |
| Modify | `src/typescript/lib/component/input/RadioButton.ts` (add `action`) |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` (add `action`) |
| Modify | `src/typescript/lib/component/button/Button.ts` (add `listeners` field + constructor call) |
| Modify | `src/typescript/lib/component/button/ToggleButton.ts` (confirm inherits; add only if it has extra events) |
| Modify | `src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `src/typescript/lib/component/table/cell/ResizeHandle.ts` |
| Modify | `src/typescript/lib/component/container/TabBar.ts` |
| Modify | `src/typescript/lib/core/Drawer.ts` |
| Modify | `src/typescript/lib/core/Rail.ts` (drift: had a private `applyListeners` colliding with the new base helper — deleted it to inherit the shared one) |
| Modify | `src/typescript/ToolBarPanel.ts` (remove invalid `dblclick` demo + JSDoc) |
| Modify | `src/typescript/MiscPanel.ts` (wire `action` through the bag — positive demo) |
| Modify | `docs/recipes/component-options.md` (rewrite the listeners section) |

`AbstractStore.ts`, `Tab.ts`, `Accordion.ts`, `ButtonGroup.ts` are intentionally **not** modified — they are already the target shape.

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Compile-error guarantee (the point of this plan).** A throwaway snippet must each fail to compile:
  - `new Button({ listeners: { click: () => {} } })` — `click` is not a Button `on()` event.
  - `new Button({ listeners: { clik: () => {} } })` — typo.
  - `new Button({ listeners: { collapse: () => {} } })` — another component's event.
  Confirm each is a TS error, then delete the snippet.
- **Positive wiring fires:** `new Button({ listeners: { action } })` invokes `action` on click (the `MiscPanel` non-modal-drawer button is the live demo — clicking it opens the drawer).
- **No-`on()` components reject the field:** `new ToolBar({ listeners: { … } })` and `new Component({ listeners: { … } })` are compile errors (no `listeners` field exists).
- **Reversion complete:** `grep -rn 'ComponentListeners\|applyListenerOptions\|customListenerKeys' src/typescript/lib` → zero matches.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted). Confirm no dead link to the removed `ComponentListeners` type alias remains.
- **Demo screen:** ToolBar demo (`ToolBarPanel`) still renders without the dblclick button; Misc demo (`MiscPanel`) non-modal drawer button opens the drawer via its bag.

---

## Documentation Impact

- **Removed public symbol:** `ComponentListeners` (was exported from [`core/index.ts`](../src/typescript/lib/core/index.ts#L14)). Drop the export; after `docs:build`, its `docs/api/core/type-aliases/ComponentListeners` page disappears — confirm no page links to it (`grep -rln 'ComponentListeners' docs/` → only `component-options.md`, fixed in step 7).
- **New public field:** `ButtonOptions.listeners` (and `action` on the input bags). Same `core`/`component` barrels already export the option interfaces; no new barrel entries.
- **Recipe page:** [`docs/recipes/component-options.md`](../docs/recipes/component-options.md) "Wiring event listeners" rewritten (step 7). It stays in the sidebar/catalog (already listed).
- **JSDoc:** `applyListeners` JSDoc (same `core` bucket; `{@link}` fine). The per-host `listeners` JSDoc stays — just verify it no longer mentions "DOM-event keys" routing.

---

## Potential Challenges

- **`(this as any).on(event, fn)` cast.** Required because base `Component` has no `on`; the helper is only host-invoked. Same cast `Tab`/`Accordion`/`ButtonGroup` already use — sound.
- **Per-key payload types must come from `on()`, not be guessed.** Copy each listener type from the host's `on()` overload signature; a wrong type (e.g. `() => void` for an event whose `on()` passes a payload) would silently widen the bag's contract. Cross-check each.
- **`ToggleButton` inheriting `ButtonOptions.listeners`.** It exposes `on("action", ClickListener)` and extends `ButtonOptions`, so the inherited `{ action?: ClickListener }` is correct — but confirm `ToggleButton` actually calls `applyListeners` (via Button's constructor, which now does). If ToggleButton overrides the constructor without calling through, the bag would silently not wire — verify the constructor chain.
- **`AbstractInput` subclasses and `action` ordering.** `AbstractInput`'s constructor calls `applyListeners(options?.listeners)`; a leaf adds `action` to the bag but does NOT call `applyListeners` again, so `action` is wired by the base call iterating all keys. Confirm no leaf double-wires.
- **`Event` import in Component.ts.** Deleting `applyListenerOptions` removes one `Event.addListener` use; confirm `Event` is still imported-and-used elsewhere before removing the import (it is — leave it).

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — the mechanism to strip; `applyOptions`, the two split members, the type.
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts#L112) — the target template (closed bag + `Object.keys` → `this.on`).
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts#L333) — same template, with the `this.on` implementation-signature cast.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts#L1173) — `on("action")` overload; the constructor that gains the `applyListeners` call.
- [`src/typescript/lib/component/input/AbstractInput.ts`](../src/typescript/lib/component/input/AbstractInput.ts#L31) — shared `change`/`binding` bag; the `action` decision boundary.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — Event handling section: the `listeners?: { [event]?: listener }` shape and the `action` semantic-shorthand list this plan restores.
- [`docs/recipes/component-options.md`](../docs/recipes/component-options.md#L131) — the section to rewrite.

---

## Non-Goals

- **No `listeners` on plain `Component`, `ToolBar`, or any no-`on()` class.** They expose no event surface; raw DOM listeners go through `Event.addListener` post-construction as before.
- **No off-from-options or listener removal API.** Construction-time wiring only.
- **No new events.** The bag mirrors the *existing* `on()` surface of each component; this plan adds no `on()` overloads (only surfaces `action` in bags where the overload already exists).
- **No change to `AbstractStore` / `Tab` / `Accordion` / `ButtonGroup`.** Already the target shape.
