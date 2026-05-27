# Tooltip Live Updates — Implementation Plan

## Overview

Today `Tooltip.attachToElement(element, text)` ([Tooltip.ts:310](../src/typescript/lib/core/Tooltip.ts#L310)) and `Tooltip.attach(component, text)` ([Tooltip.ts:216](../src/typescript/lib/core/Tooltip.ts#L216)) both capture the `text` argument in a hover-listener closure. Once installed, the listener forever reads the original `text` value — even if the caller later wants to change the tooltip on the same target.

The visible symptom: `HeaderCell.setTooltip(text)` ([cell/Header.ts:325](../src/typescript/lib/component/table/cell/Header.ts#L325)) and `ParentHeaderCell.setTooltip(text)` ([cell/ParentHeader.ts:110](../src/typescript/lib/component/table/cell/ParentHeader.ts#L110)) only take effect when called **before** the cell's `init()` runs ([cell/Header.ts:140](../src/typescript/lib/component/table/cell/Header.ts#L140), [cell/ParentHeader.ts:151](../src/typescript/lib/component/table/cell/ParentHeader.ts#L151)). Any `setTooltip` call afterwards mutates the cached `_tooltipText` field but the live tooltip text is frozen at whatever `Tooltip.attachToElement` saw at install time.

The only callers of `setTooltip` today are `rebuildCells` and `rebuildParentCells` in [`table/Header.ts:292`](../src/typescript/lib/component/table/Header.ts#L292) and [`table/Header.ts:352`](../src/typescript/lib/component/table/Header.ts#L352) — both pre-init, so the bug is latent. Refresh exists to unblock future post-init consumers and to plug the listener leak `attachToElement` has today (every call wires three fresh handlers with no detach path).

Make `Tooltip.attach` and `Tooltip.attachToElement` re-attachable: a fresh `attach` / `attachToElement` call for the same target detaches the previous attachment and installs a new one with the new text. Then `HeaderCell.setTooltip` / `ParentHeaderCell.setTooltip` (and any other consumer) calls the attach method again on the cached element, replacing the stale closure.

---

## Architecture Decisions

### Re-attach on every `setTooltip` — don't introduce a separate `setText` mutator

`Tooltip.attach` already documents the re-attach semantics for component-keyed bindings: *"Calling `attach` on a component that already has an attachment replaces it"* ([Tooltip.ts:210](../src/typescript/lib/core/Tooltip.ts#L210)). The component-keyed `attach` uses a per-component-id `attachments` Map ([Tooltip.ts:55](../src/typescript/lib/core/Tooltip.ts#L55)) for the detach. Mirror that pattern for `attachToElement`: a per-element WeakMap of attachments keyed by `HTMLElement` reference, with the same detach-before-attach behaviour.

Rejected alternative: expose `Tooltip.setText(target, text)` as a separate mutator. Adds an API axis; the cleaner shape is *"calling attach again replaces"*, and the existing `attach` already promises that — making `attachToElement` match is a consistency win.

### `setTooltip` re-attaches when the element exists

`HeaderCell.setTooltip(text)` / `ParentHeaderCell.setTooltip(text)` cache the text in a private field and `init()` runs `Tooltip.attachToElement(el, text)` from the cached value. After the fix, every `setTooltip` call additionally re-runs `attachToElement` against the cached element when one is present. Pre-init calls fall back to the existing init-time attach.

### Component-keyed `attach` (mouseover/mouseout listeners on a `Component`)

`Tooltip.attach` ([Tooltip.ts:216](../src/typescript/lib/core/Tooltip.ts#L216)) calls `Tooltip.detach(component)` at the top ([Tooltip.ts:217](../src/typescript/lib/core/Tooltip.ts#L217)) and uses `Event.addListener(component, …)` keyed by component id ([Tooltip.ts:246-248](../src/typescript/lib/core/Tooltip.ts#L246-L248)). The detach path ([Tooltip.ts:261](../src/typescript/lib/core/Tooltip.ts#L261)) cleanly removes the listeners. The text-capture closure however still freezes the original `text` value, so a second `Tooltip.attach(comp, 'B')` correctly *replaces* the listener set — meaning the bug class also affects `attach`, but is fixed automatically by the re-attach-on-each-call shape that already exists. No code change for `attach` itself; only documentation.

### Element-keyed `attachToElement` (mouseover/mouseout listeners on a raw `HTMLElement`)

`attachToElement` uses raw `element.addEventListener` with a fresh inline closure ([Tooltip.ts:315](../src/typescript/lib/core/Tooltip.ts#L315), [Tooltip.ts:329](../src/typescript/lib/core/Tooltip.ts#L329), [Tooltip.ts:334](../src/typescript/lib/core/Tooltip.ts#L334)) and never tracks the handler references — so today there's no way to remove them. The plan adds a private static `elementAttachments: WeakMap<HTMLElement, ElementTooltipAttachment>` paralleling the component-keyed Map, plus a private `detachElement(element)` to remove the listeners cleanly. `attachToElement` calls `detachElement(element)` at the top, then installs fresh listeners.

Using a `WeakMap` avoids the GC concern of holding HTMLElement strong references for the lifetime of the page.

### Handler references must be named, not inline

[ARCHITECTURE.md line 11](../ARCHITECTURE.md) requires that *"The handler argument must always be a reference to a named function… The rule applies equally to the raw `addEventListener` escape hatches above."* The current `attachToElement` violates this with three inline arrow expressions. The refactor must replace them with named locals (or methods) so they're removable via `removeEventListener`, grep-able for audits, and named in stack traces. Naming them as locals is sufficient — they don't need to be methods because each attachment owns its own closed-over state (`cursorX`, `cursorY`, `showTimer`, `text`).

### Mid-hover update behaviour

When a tooltip is currently visible for an element and the caller swaps the text mid-hover:

- Cancel any pending show timer.
- If the tooltip is already on screen, call `Tooltip.show(newText, x, y)` immediately so the visible text updates without a re-hover.
- Track "currently shown for this element" so the mid-hover update path knows whether to re-show.

This matches the natural mental model: change the text, see the change.

---

## Public API (TypeScript Signatures)

### `Tooltip` (additions)

```typescript
export class Tooltip extends Component {
    // existing static methods unchanged in signature

    /**
     * Removes an `attachToElement` binding installed on a raw HTMLElement.
     * Idempotent — calling on an unattached element is a no-op.
     */
    static detachElement(element: HTMLElement): void;
}
```

`Tooltip.attach(component, text, colors?)` ([Tooltip.ts:216](../src/typescript/lib/core/Tooltip.ts#L216)) and `Tooltip.attachToElement(element, text)` ([Tooltip.ts:310](../src/typescript/lib/core/Tooltip.ts#L310)) signatures are unchanged. Behavioural change only: a subsequent call for the same target replaces the previous binding.

### `HeaderCell.setTooltip` / `ParentHeaderCell.setTooltip`

Signature unchanged. JSDoc loses the "construction-time only" caveat on `ParentHeaderCell.setTooltip` ([cell/ParentHeader.ts:104-106](../src/typescript/lib/component/table/cell/ParentHeader.ts#L104-L106)) — the setter now applies after init too.

---

## Internal Structure

### `attachToElement` rewritten

```typescript
interface ElementTooltipAttachment {
    text       : string;
    mouseoverFn: (e: MouseEvent) => void;
    mousemoveFn: (e: MouseEvent) => void;
    mouseoutFn : () => void;
    showTimer  : ReturnType<typeof setTimeout> | null;
}

private static elementAttachments: WeakMap<HTMLElement, ElementTooltipAttachment> = new WeakMap();
private static activeElement     : HTMLElement | null                              = null;

static detachElement(element: HTMLElement): void {
    const att = Tooltip.elementAttachments.get(element);
    if (!att) {
        return;
    }
    element.removeEventListener("mouseover", att.mouseoverFn);
    element.removeEventListener("mousemove", att.mousemoveFn);
    element.removeEventListener("mouseout",  att.mouseoutFn);
    if (att.showTimer !== null) {
        clearTimeout(att.showTimer);
    }
    Tooltip.elementAttachments.delete(element);
    if (Tooltip.activeElement === element) {
        Tooltip.activeElement = null;
    }
}

static attachToElement(element: HTMLElement, text: string): void {
    Tooltip.detachElement(element);

    let cursorX = 0;
    let cursorY = 0;
    const att: ElementTooltipAttachment = {
        text,
        showTimer  : null,
        mouseoverFn: function onMouseOver(e: MouseEvent) { /* … */ },
        mousemoveFn: function onMouseMove(e: MouseEvent) { /* … */ },
        mouseoutFn : function onMouseOut() { /* … */ },
    };

    element.addEventListener("mouseover", att.mouseoverFn);
    element.addEventListener("mousemove", att.mousemoveFn);
    element.addEventListener("mouseout",  att.mouseoutFn);

    Tooltip.elementAttachments.set(element, att);

    // Mid-hover update: if this element is currently the active hover target,
    // re-render the visible tooltip with the new text at the last cursor coords.
    if (Tooltip.activeElement === element) {
        Tooltip.show(text, /* lastCursorX */ 0, /* lastCursorY */ 0);
    }
}
```

The `mouseoverFn` body sets `Tooltip.activeElement = element` inside the show timer; `mouseoutFn` clears it.

### `Cell.setTooltip` re-attach

```typescript
setTooltip(text: string): this {
    this._tooltipText = text;

    const el = this.getElement();
    if (el) {
        Tooltip.attachToElement(el, text);
    }

    return this;
}
```

Applies to both `HeaderCell.setTooltip` ([cell/Header.ts:325](../src/typescript/lib/component/table/cell/Header.ts#L325)) and `ParentHeaderCell.setTooltip` ([cell/ParentHeader.ts:110](../src/typescript/lib/component/table/cell/ParentHeader.ts#L110)).

---

## Ordered Implementation Steps

1. **`Tooltip.ts`** — add the `ElementTooltipAttachment` interface and the `elementAttachments: WeakMap<HTMLElement, ElementTooltipAttachment>` static field; add `activeElement: HTMLElement | null` static; rewrite `attachToElement` ([Tooltip.ts:310](../src/typescript/lib/core/Tooltip.ts#L310)) to name the handler locals, store them in the map, and call `detachElement` at the top. The new `showTimer` lives on the attachment record so `detachElement` can cancel a pending show.
2. **`Tooltip.ts`** — add public static `detachElement(element)`; it removes the three listeners, clears the pending timer, deletes the map entry, and clears `activeElement` if it pointed at this element.
3. **`Tooltip.ts`** — mid-hover update path: at the bottom of `attachToElement`, if the just-attached element equals `Tooltip.activeElement`, call `Tooltip.show(text, lastCursorX, lastCursorY)` so the visible tooltip text updates without a re-hover. The last cursor coords must be kept on the attachment record (write them from `mousemoveFn`).
4. **`cell/Header.ts`** — `setTooltip` ([cell/Header.ts:325](../src/typescript/lib/component/table/cell/Header.ts#L325)) re-runs `Tooltip.attachToElement(el, text)` when `getElement()` is non-null.
5. **`cell/ParentHeader.ts`** — same shape on `setTooltip` ([cell/ParentHeader.ts:110](../src/typescript/lib/component/table/cell/ParentHeader.ts#L110)). Drop the "Construction-time only" caveat from the JSDoc ([cell/ParentHeader.ts:104-106](../src/typescript/lib/component/table/cell/ParentHeader.ts#L104-L106)).
6. **Verification** — manual smoke (see `## Verification` below); `npx tsc --noEmit` clean; `npm run docs:build` clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Tooltip.ts` — add `ElementTooltipAttachment`, `elementAttachments`, `activeElement`, `detachElement`; rewrite `attachToElement` with named handler locals, detach-then-attach, and mid-hover update. |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` — `setTooltip` re-attaches when element exists. |
| Modify | `src/typescript/lib/component/table/cell/ParentHeader.ts` — `setTooltip` re-attaches when element exists; JSDoc drops the construction-time caveat. |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` clean.
- **Docs build:** `npm run docs:build` 0 errors and 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Grep invariant:** `grep -n 'addEventListener' src/typescript/lib/core/Tooltip.ts` — only the three named-handler installs in `attachToElement` (no inline-arrow handlers; ARCHITECTURE.md line 11 compliance).
- **Manual smoke** (in `MiscPanel`'s table area, which already exercises HeaderCell tooltips via `Header.rebuildCells` at [`table/Header.ts:292`](../src/typescript/lib/component/table/Header.ts#L292)):
  - Set a tooltip on a header cell at construction → hover → see tooltip A.
  - After render, call `cell.setTooltip('B')` → hover again → see tooltip B (not A).
  - Hover a cell to show tooltip A on screen → without leaving the cell, call `cell.setTooltip('B')` → tooltip immediately re-renders as B.
  - Confirm no listener leaks: re-attaching 100 times on the same element does not accumulate handlers (DevTools "Event Listeners" pane shows three — one each for mouseover, mousemove, mouseout).
  - `Tooltip.attach(comp, 'A'); Tooltip.attach(comp, 'B')` → hover shows 'B' (confirms the component-keyed path was already correct).

---

## Documentation Impact

- `Tooltip` lives in `src/typescript/lib/core/Tooltip.ts` and is re-exported via `src/typescript/lib/core/index.ts` (the curated `core` barrel). Adding `detachElement` doesn't change the export surface — typedoc will pick up the new static method from the class.
- Curated docs page: `docs/core/tooltip.md` (or whatever `docs/core/index.md` catalogs as the Tooltip entry). Verify the page describes the re-attach contract for `attachToElement` (matching the existing one for `attach`) and mentions `detachElement` if a section enumerates lifecycle methods.
- No new cross-bucket links required; the change is internal to the `core` bucket.

---

## Potential Challenges

- **Listener leak today.** `attachToElement` already leaks listeners on every call when the same element is reused — there is no detach path. The new `WeakMap` indirectly fixes this regression too.
- **Named-handler refactor surface.** Today's three inline arrow handlers ([Tooltip.ts:315, 329, 334](../src/typescript/lib/core/Tooltip.ts#L315)) close over the same `cursorX` / `cursorY` / `showTimer` locals. Hoisting them to named function expressions on the attachment record requires moving that shared state onto the record too — straightforward but every read/write must move with it.
- **WeakMap + element removal.** Elements removed from the DOM stay in the WeakMap until GC. Acceptable — no-op detach if the caller never re-attaches; GC reclaims when the element is dereferenced.
- **`Tooltip.activeElement` tracking.** A second `attachToElement` call against a *different* element doesn't clear the first one's `activeElement` — the first element still owns its `mouseout` handler, which clears `activeElement` when the cursor leaves. Verify the cursor-out → second-attach sequence doesn't leak the `activeElement` reference.
- **Last-cursor coords for mid-hover refresh.** Only `mousemoveFn` knows the latest coords. Store `lastX` / `lastY` on the attachment record so `attachToElement`'s re-show path has values to feed `Tooltip.show`. If no move has fired yet, fall back to `0, 0` — the cursor must have entered to make this element active, and `mouseoverFn` fires before `mousemoveFn` in practice, so the timer-completed show already used real coords.

---

## Critical Files

- [`src/typescript/lib/core/Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts) — the file under modification. Read end-to-end before editing; the component-keyed `attach` ([Tooltip.ts:216](../src/typescript/lib/core/Tooltip.ts#L216)) and `detach` ([Tooltip.ts:261](../src/typescript/lib/core/Tooltip.ts#L261)) pair is the pattern this plan generalises.
- [`src/typescript/lib/component/table/cell/Header.ts`](../src/typescript/lib/component/table/cell/Header.ts) — `setTooltip` caller and `init` ([cell/Header.ts:140](../src/typescript/lib/component/table/cell/Header.ts#L140)) currently calls `Tooltip.attachToElement` at line 166.
- [`src/typescript/lib/component/table/cell/ParentHeader.ts`](../src/typescript/lib/component/table/cell/ParentHeader.ts) — same `setTooltip` shape; `init` ([cell/ParentHeader.ts:151](../src/typescript/lib/component/table/cell/ParentHeader.ts#L151)) calls `attachToElement` at line 163.
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — read `addListener` / `removeListener` semantics; the WeakMap approach is the element-keyed equivalent of the Event module's per-id Map.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) lines 7-11 — the raw-`addEventListener` rule (escape hatch, named handlers) the refactor must satisfy.

---

## Non-Goals

- **Tooltip styling overhaul.** Per-component colour overrides already exist on `Tooltip.attach(component, text, colors?)`. Out of scope.
- **Tooltip positioning relative to anchor element (vs cursor).** Today the tooltip anchors to the cursor; a future plan can add an "anchor to element rect" mode. Out of scope here.
- **Replace `attachToElement` raw `element.addEventListener` with `Event.addListener`.** The framework's `Event` dispatcher matches by component id, not raw element id. The raw path is the documented escape hatch ([Tooltip.ts:299-306](../src/typescript/lib/core/Tooltip.ts#L299-L306)) — keep it. Just track the handlers so we can detach.
- **Convert the component-keyed `attach` to use the `WeakMap` form.** The existing per-id Map is the right shape for `Component`-keyed bindings (component instances have stable ids). Don't change what works.
- **Refactor other raw-`addEventListener` sites in `Tooltip.ts`.** There are none beyond `attachToElement`; nothing else to sweep.
