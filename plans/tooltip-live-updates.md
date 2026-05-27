# Tooltip Live Updates — Implementation Plan

## Overview

Today `Tooltip.attachToElement(element, text)` ([Tooltip.ts:310](../src/typescript/lib/core/Tooltip.ts#L310)) and `Tooltip.attach(component, text)` ([Tooltip.ts:216](../src/typescript/lib/core/Tooltip.ts#L216)) both capture the `text` argument in a hover-listener closure. Once installed, the listener forever reads the original `text` value — even if the caller later wants to change the tooltip on the same element.

The visible symptom: `HeaderCell.setTooltip(text)` ([cell/Header.ts:325](../src/typescript/lib/component/table/cell/Header.ts#L325)) and `ParentHeaderCell.setTooltip(text)` ([cell/ParentHeader.ts:102](../src/typescript/lib/component/table/cell/ParentHeader.ts#L102)) only take effect when called **before** the cell's `init()` runs. Any `setTooltip` call afterwards mutates the cached `_tooltipText` field but the live tooltip text is frozen at whatever `Tooltip.attachToElement` saw at install time.

Make `Tooltip.attach` and `Tooltip.attachToElement` re-attachable: a fresh `attach` / `attachToElement` call for the same target detaches the previous attachment and installs a new one with the new text. Then `HeaderCell.setTooltip` / `ParentHeaderCell.setTooltip` (and any other consumer) calls the attach method again on the cached element, replacing the stale closure.

---

## Architecture Decisions

### Re-attach on every `setTooltip` — don't introduce a separate `setText` mutator

`Tooltip.attach` already documents the re-attach semantics for component-keyed bindings: *"Calling `attach` on a component that already has an attachment replaces it"* ([Tooltip.ts:210](../src/typescript/lib/core/Tooltip.ts#L210)). The component-keyed `attach` uses a per-component-id `attachments` Map ([Tooltip.ts:55](../src/typescript/lib/core/Tooltip.ts#L55)) for the detach. Mirror that pattern for `attachToElement`: a per-element WeakMap of attachments keyed by `HTMLElement` reference, with the same detach-before-attach behaviour.

Rejected alternative: expose `Tooltip.setText(target, text)` as a separate mutator. Adds an API axis; the cleaner shape is *"calling attach again replaces"*, and the existing `attach` already promises that — making `attachToElement` match is a consistency win.

### `setTooltip` re-attaches when the element exists

`Cell.setTooltip(text)` in the table family caches the text in a private field and *also* runs `Tooltip.attachToElement(el, text)` from `init`. After the fix, every `setTooltip` call additionally re-runs `attachToElement` against the cached element when one is present. Pre-init calls fall back to the existing init-time attach.

### Component-keyed `attach` (mouseover/mouseout listeners on a `Component`)

`Tooltip.attach` uses `Event.addListener(component, …)`, which is keyed by component id in the Event dispatcher. The existing `Tooltip.detach(component)` already cleanly removes the listeners. The fix here is just: document the existing re-attach contract more loudly, and ensure no caller leaks. No code change.

### Element-keyed `attachToElement` (mouseover/mouseout listeners on a raw `HTMLElement`)

`attachToElement` uses raw `element.addEventListener` with a fresh inline closure ([Tooltip.ts:315](../src/typescript/lib/core/Tooltip.ts#L315), [Tooltip.ts:329](../src/typescript/lib/core/Tooltip.ts#L329), [Tooltip.ts:334](../src/typescript/lib/core/Tooltip.ts#L334)) and never tracks the handler references — so today there's no way to remove them. The plan adds a private static `elementAttachments: WeakMap<HTMLElement, ElementTooltipAttachment>` paralleling the component-keyed Map, plus a private `detachElement(element)` to remove the listeners cleanly. `attachToElement` calls `detachElement(element)` at the top, then installs fresh listeners.

Using a `WeakMap` avoids the GC concern of holding HTMLElement strong references for the lifetime of the page.

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

`Tooltip.attach(component, text, colors?)` and `Tooltip.attachToElement(element, text)` signatures are unchanged. Behavioural change only: a subsequent call for the same target replaces the previous binding.

### `HeaderCell.setTooltip` / `ParentHeaderCell.setTooltip`

Signature unchanged. JSDoc loses the "construction-time only" caveat — the setter now applies after init too.

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
}

static attachToElement(element: HTMLElement, text: string): void {
    Tooltip.detachElement(element);

    // …same closures as today, but storing them in `att` for later detach.
    // On mid-hover update (att exists when attachToElement is called and the
    // tooltip is currently visible), re-run Tooltip.show with the new text.
}
```

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

Applies to both `HeaderCell.setTooltip` ([cell/Header.ts:325](../src/typescript/lib/component/table/cell/Header.ts#L325)) and `ParentHeaderCell.setTooltip` ([cell/ParentHeader.ts:102](../src/typescript/lib/component/table/cell/ParentHeader.ts#L102)).

---

## Ordered Implementation Steps

1. **`Tooltip.ts`** — add `elementAttachments: WeakMap<HTMLElement, ElementTooltipAttachment>` and the `ElementTooltipAttachment` interface; rewrite `attachToElement` to store the handler triple in the map and call `detachElement` at the top; add public static `detachElement(element)`; track per-attachment `showTimer` so detach can cancel a pending show.
2. **`Tooltip.ts`** — mid-hover update path: when `attachToElement` is called for an element whose tooltip is currently on screen, call `Tooltip.show(newText, lastCursorX, lastCursorY)` immediately so the visible tooltip text updates without requiring a re-hover. "Currently on screen" is tracked by a new `Tooltip.activeElement: HTMLElement | null` static, set in the `mouseover` show callback and cleared in `mouseout`.
3. **`cell/Header.ts`** — `setTooltip` re-runs `Tooltip.attachToElement(el, text)` when `getElement()` is non-null. Same for `cell/ParentHeader.ts`. Drop the "construction-time only" JSDoc caveats from both.
4. **Verification** — manual smoke: a HeaderCell whose tooltip is updated mid-page-life shows the new text on next hover; updating while hovered shows the new text immediately.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Tooltip.ts` — add `elementAttachments`, `detachElement`, rewrite `attachToElement`, add mid-hover update path. |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` — `setTooltip` re-attaches when element exists; JSDoc loses the construction-time caveat. |
| Modify | `src/typescript/lib/component/table/cell/ParentHeader.ts` — same shape. |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` clean.
- **Docs build:** `npm run docs:build` 0 errors and 0 new link warnings (typedoc's "unsupported TypeScript version" notice + the existing 5-warning baseline are acceptable).
- **Manual smoke:**
  - Set a tooltip on a header cell at construction → hover → see tooltip A.
  - After render, call `cell.setTooltip('B')` → hover again → see tooltip B (not A).
  - Hover a cell to show tooltip A on screen → without leaving the cell, call `cell.setTooltip('B')` → tooltip immediately re-renders as B.
  - Confirm no listener leaks: re-attaching 100 times on the same element does not accumulate handlers (the count stays at 3 — one each for mouseover, mousemove, mouseout).

---

## Potential Challenges

- **Listener leak today.** `attachToElement` already leaks listeners on every call when the same element is reused — there is no detach path. The new `WeakMap` indirectly fixes this regression too.
- **WeakMap + element removal.** Elements removed from the DOM stay in the WeakMap until GC. Acceptable — no-op detach if the caller never re-attaches; GC reclaims when the element is dereferenced.
- **`Tooltip.activeElement` tracking.** A second `attachToElement` call against a *different* element doesn't clear the first one's `activeElement` — the first element still owns its `mouseout` handler, which clears `activeElement` when the cursor leaves. Verify the cursor-out → second-attach sequence doesn't leak the `activeElement` reference.
- **The component-keyed `attach` path also has the same closure-capture issue.** Today `Tooltip.attach(component, text)` already re-attaches via `Tooltip.detach(component)` at the top ([Tooltip.ts:217](../src/typescript/lib/core/Tooltip.ts#L217)) — but the listener closure still captures the *old* `text`. The fix mirrors the element path: re-running `attach` with new text replaces. Test that a `Tooltip.attach(comp, 'A'); Tooltip.attach(comp, 'B')` sequence shows 'B' on hover.

---

## Critical Files

- [`src/typescript/lib/core/Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts) — the file under modification. Read end-to-end before editing; the component-keyed `attach` already implements the re-attach pattern this plan generalises.
- [`src/typescript/lib/component/table/cell/Header.ts`](../src/typescript/lib/component/table/cell/Header.ts) — `setTooltip` caller; mirror in `ParentHeader.ts`.
- [`src/typescript/lib/component/table/cell/ParentHeader.ts`](../src/typescript/lib/component/table/cell/ParentHeader.ts) — same `setTooltip` shape.
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — read `addListener` / `removeListener` semantics; the WeakMap approach is the element-keyed equivalent of the Event module's per-id Map.

---

## Non-Goals

- **Tooltip styling overhaul.** Per-component colour overrides already exist on `Tooltip.attach(component, text, colors?)`. Out of scope.
- **Tooltip positioning relative to anchor element (vs cursor).** Today the tooltip anchors to the cursor; a future plan can add an "anchor to element rect" mode. Out of scope here.
- **Replace `attachToElement` raw `element.addEventListener` with `Event.addListener`.** The framework's `Event` dispatcher matches by component id, not raw element id. The raw path is the documented escape hatch ([Tooltip.ts:299-306](../src/typescript/lib/core/Tooltip.ts#L299-L306)) — keep it. Just track the handlers so we can detach.
- **Convert the component-keyed `attach` to use the `WeakMap` form.** The existing per-id Map is the right shape for `Component`-keyed bindings (component instances have stable ids). Don't change what works.
