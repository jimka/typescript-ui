---
depends-on: []
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# FieldDecorator Pointer Tooltip — Implementation Plan

## Overview

A pointer can never show `FieldDecorator`'s validation-error tooltip. `showError` attaches the tooltip to the decorator ([`FieldDecorator.ts:72`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L72)). The decorator zeroes its insets and fits its field to its whole box ([`:34-38`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L34)), so the field covers the decorator exactly. `Tooltip.attach` registers its hover listeners with `Event.addListener` ([`Tooltip.ts:443-446`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L443)), and `Event` calls those only for an event whose target is the component's own element ([`Event.ts:274-293`](packages/lib/src/typescript/lib/core/Event.ts#L274)). A pointer over a decorated field always targets the field's element or an element inside the field, never the decorator's. So resting the pointer on an invalid field never says why it is invalid, although `showError`'s JSDoc promises a tooltip "that appears on hover". An offline probe on `master` confirmed this for ten field types.[^verified]

The fix adds a **covering attachment** to `Tooltip`: a tooltip attachment that is armed by hovering anywhere inside its component, children included, and that takes precedence over any tooltip attached to a component inside it. `FieldDecorator.showError` uses it. Separately, a component's `mouseout` stops hiding a tooltip that another component owns. That is the rule `Tooltip.detach` has followed since C21, the fix in [`tooltip-picker-and-serialization-fixes.md`](plans/implemented/tooltip-picker-and-serialization-fixes.md) that made `detach` act only on what its own component owns.

The change touches [`overlay/Tooltip.ts`](packages/lib/src/typescript/lib/overlay/Tooltip.ts) and [`validation/FieldDecorator.ts`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts), one existing and one new test file, the `Tooltip` guide page and the changelog. No public signature changes; `Tooltip` gains one `@internal` static.

---

## Architecture Decisions

### The fix lives in `Tooltip`; `FieldDecorator` opts in

`Tooltip` gains `attachCovering(component, text, colors?)`, marked `@internal`. `FieldDecorator.showError` calls it in place of `attach`. Every other tooltip host keeps `attach` exactly as it is.[^where] No other wrapper in the library puts a tooltip on itself over a child that fills it, so `FieldDecorator` is the only caller.[^other-wrappers]

### A covering attachment listens on its component's whole subtree

`attachCovering` registers the same four hover listeners as `attach` (`mouseover`, `mousemove`, `mouseout`, `mousedown`), through `Event.addSubtreeListener` instead of `Event.addListener`. Its `mouseover` and `mouseout` ignore a move whose `relatedTarget` is inside the component, because moving between two parts of a field is neither a new hover nor a leave. This mirrors `SplitGutter`'s hover wiring, which faces the same problem with its chevron child: subtree listeners at [`SplitGutter.ts:222-231`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L222), each handler filtering on `relatedTarget` through `containsEventTarget` ([`:674-740`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L674)).[^precedent]

The covering listeners are registered against the attached component, the same place `attach` has always registered its own.[^cross-component]

### Over its area, a covering tooltip beats any tooltip attached inside it

When the pointer rests on a decorated field in error, the error is shown, even if the field (or one of its parts) carries a tooltip of its own. Once the error is cleared, the field's own tooltip shows again.[^error-wins]

| Pointer rests on | Tooltips attached | Shown |
|---|---|---|
| a decorated `TextField` in error | the decorator's error | the error |
| the same field | the error, plus `Tooltip.attach(field, hint)` (a `LabeledGrid` description, say) | the error |
| the same field, error cleared | the field's hint | the hint |
| a decorated `DateField`'s input or picker button, in error | the error, plus a hint attached to the `DateField` | the error |

This precedence relies on dispatch order. `Event` runs exact-target listeners before it walks from the target up through subtree listeners, so a field's `attach` handler always runs before the decorator's covering one in the same dispatch. The covering `mouseover` therefore first cancels a hover delay that a component inside it armed, then arms its own.

### Leaving hides only the leaving component's own tooltip

`attach`'s `mouseout` handler calls `Tooltip.hide()` only when the tooltip is the component's own. "Own" means one of the two things `detach` checks: the running hover delay was armed by this component (`pendingId`), or the tooltip on screen is anchored to this component's element (`activeElement`). The covering attachment's `mouseout` applies the same test.[^leave-ownership]

| Tooltip state | Pointer leaves | Before | After |
|---|---|---|---|
| on screen for A | B's element | A's tooltip fades out | A's tooltip stays |
| A's hover delay running | B's element | A's delay is cancelled | A's delay keeps running |
| on screen for A | A's element | fades out | fades out |

### C21's ownership model is kept

`detach` still acts only on what the detaching component owns. `pendingId` always names whoever armed the live timer: when a covering `mouseover` takes over, it cancels the other component's delay (clearing `pendingId`) and then arms its own (setting it to the decorator's id). A later `detach` of the field can therefore never cancel the error's delay, and the decorator's `clearError` still cancels or hides its own.[^c21]

### Accessibility and keyboard focus are out of scope

Today the error is not exposed to assistive technology at all: no `aria-invalid`, no `aria-describedby` or `aria-errormessage`, and no `role` on the tooltip. Keyboard focus does not reveal it either. This plan leaves both as they are; they need their own design.[^a11y]

---

## Public API

No public signature changes. One static is added, excluded from the API docs by `@internal`:

```ts
// overlay/Tooltip.ts, class Tooltip
/** @internal */
static attachCovering(component: Component, text: string, colors?: TooltipColors): void;
```

Private additions to `Tooltip`, all static:

```ts
private static _attachWith(component: Component, text: string, colors: TooltipColors | undefined, covering: boolean): void;
private static _owns(component: Component): boolean;
private static _containsTarget(component: Component, target: EventTarget | null): boolean;
private static _claimCoveringHover(component: Component, e: MouseEvent): boolean;
private static _addHoverListeners(component: Component, att: TooltipAttachment): void;
private static _removeHoverListeners(component: Component, att: TooltipAttachment): void;
```

---

## Internal Structure

Everything up to the test fixture is in `packages/lib/src/typescript/lib/overlay/Tooltip.ts`.

**`TooltipAttachment`** ([`:31-39`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L31)) gains `covering`, and `mouseoutFn` now takes the event:

```ts
/** Internal record of a component's tooltip attachment. */
interface TooltipAttachment {
    text        : string;
    colors      : TooltipColors | undefined;
    // `attachCovering`'s: listens on the component's whole subtree and takes
    // precedence over any attachment inside it. `attach`'s listen on the
    // component's own element only.
    covering    : boolean;
    mouseoverFn : (e: MouseEvent) => void;
    mousemoveFn : (e: MouseEvent) => void;
    mouseoutFn  : (e: MouseEvent) => void;
    mousedownFn : () => void;
}
```

**`attach`** ([`:395-460`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L395)) keeps its JSDoc and delegates. Its body moves, almost unchanged, into `_attachWith`. `attachCovering` sits right after `attach`:

```ts
static attach(component: Component, text: string, colors?: TooltipColors): void {
    Tooltip._attachWith(component, text, colors, false);
}

/**
 * Wires a tooltip that covers `component`'s whole rendered area: hovering any
 * element inside `component` arms it, not only `component`'s own element, and
 * over that area it takes precedence over a tooltip attached to a component
 * inside it. Meant for a wrapper whose child fills it and takes the pointer —
 * `FieldDecorator`'s validation error, whose field covers the decorator's
 * whole box. Replaced, detached and torn down like an `attach` attachment.
 *
 * @param component - The wrapper to attach hover behaviour to.
 * @param text - The tooltip text to display.
 * @param colors - Optional color overrides applied while this tooltip is visible.
 *
 * @internal
 */
static attachCovering(component: Component, text: string, colors?: TooltipColors): void {
    Tooltip._attachWith(component, text, colors, true);
}
```

**`_attachWith`** is the old `attach` body under a new signature, with three changes, marked `// NEW` below. Everything marked `unchanged` is copied verbatim from `attach`, comments included. `_attachWith` must keep calling `Tooltip.detach(component)` by the class name.

```ts
/**
 * The body `attach` and `attachCovering` share: replaces any attachment
 * `component` already has, builds its four hover listeners, registers them
 * and records the attachment.
 *
 * @param component - The component to attach hover behaviour to.
 * @param text - The tooltip text to display.
 * @param colors - Optional color overrides applied while this tooltip is visible.
 * @param covering - `true` for `attachCovering`'s subtree-wide attachment.
 */
private static _attachWith(component: Component, text: string, colors: TooltipColors | undefined, covering: boolean): void {
    Tooltip.detach(component);

    let cursorX = 0;
    let cursorY = 0;

    const mouseoverFn = (e: MouseEvent): void => {
        // NEW: a covering attachment first claims the hover, and ignores a
        // move between two elements inside its component.
        if (covering && !Tooltip._claimCoveringHover(component, e)) {
            return;
        }

        if (Tooltip.showTimer !== null) {
            return;
        }

        // …unchanged: record the cursor, set `showTimer` (the 500 ms
        // `setTimeout` calling `Tooltip.show`), set `pendingId`.
    };

    const mousemoveFn = /* unchanged */;

    // NEW: leaving hides the tooltip only when it is this component's own —
    // the rule `detach` follows. A covering attachment also ignores a move
    // between two elements inside it, which is not a leave.
    const mouseoutFn = (e: MouseEvent): void => {
        if (covering && Tooltip._containsTarget(component, e.relatedTarget)) {
            return;
        }

        if (Tooltip._owns(component)) {
            Tooltip.hide();
        }
    };

    const mousedownFn = /* unchanged, with its comment */;

    // NEW: one record, registered through the helper so the listener kind
    // follows `covering`.
    const attachment: TooltipAttachment = {
        text, colors, covering, mouseoverFn, mousemoveFn, mouseoutFn, mousedownFn,
    };

    Tooltip._addHoverListeners(component, attachment);
    Tooltip.attachments.set(component.getId(), attachment);

    // …unchanged: the auto-detach-on-teardown block (`teardownWired`).
}
```

**`detach`** ([`:470-503`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L470)): its four `Event.removeListener` lines (`:478-481`) become one call. Nothing else in `detach` changes.

```ts
Tooltip._removeHoverListeners(component, att);
```

**New private helpers**, placed after `_cancelPendingShow` (`:510-517`):

```ts
/**
 * Whether the tooltip is `component`'s own: the hover delay `component`
 * armed is running, or the tooltip is on screen anchored to `component`'s
 * element. The two tests `detach` applies, joined.
 *
 * @param component - The component to test.
 * @returns `true` when `component` owns the pending or visible tooltip.
 */
private static _owns(component: Component): boolean {
    if (Tooltip.pendingId === component.getId()) {
        return true;
    }

    // `?? null` for the reason `detach` gives: a never-rendered component's
    // element lookup misses with `null`, which must not match the equally
    // null anchor of a tooltip nobody is showing.
    const element = component.getElement() ?? null;

    return element !== null && Tooltip.activeElement === element;
}

/**
 * Whether `target` — a mouse event's `relatedTarget` — is `component`'s
 * element or inside it, so the pointer moved within `component` rather than
 * across its edge. Mirrors `SplitGutter`'s `containsEventTarget`.
 *
 * @param component - The component whose element is tested.
 * @param target - The related target to test.
 * @returns `true` when `target` lies inside `component`'s element.
 */
private static _containsTarget(component: Component, target: EventTarget | null): boolean {
    const element = component.getElement();

    if (!element || !DOM.source.isNode(target)) {
        return false;
    }

    return DOM.source.contains(element, DOM.source.intern(target));
}

/**
 * The covering half of an attachment's `mouseover`. Cancels a hover delay
 * that a component inside `component` armed earlier in this same dispatch —
 * exact-target listeners run before the subtree walk reaches `component`,
 * and the covering tooltip takes precedence over theirs — and tells a real
 * enter from a move between two elements inside `component`.
 *
 * @param component - The covering attachment's component.
 * @param e - The `mouseover` event.
 * @returns `true` when the pointer has just entered `component`, so its hover delay should be armed.
 */
private static _claimCoveringHover(component: Component, e: MouseEvent): boolean {
    if (Tooltip.pendingId !== null && Tooltip.pendingId !== component.getId()) {
        Tooltip._cancelPendingShow();
    }

    return !Tooltip._containsTarget(component, e.relatedTarget);
}

/**
 * Registers an attachment's four hover listeners on `component`: on its own
 * element for `attach`, on its whole subtree for `attachCovering`.
 *
 * @param component - The attached component.
 * @param att - The attachment whose listeners to register.
 */
private static _addHoverListeners(component: Component, att: TooltipAttachment): void {
    if (att.covering) {
        Event.addSubtreeListener(component, "mouseover", att.mouseoverFn);
        Event.addSubtreeListener(component, "mousemove", att.mousemoveFn);
        Event.addSubtreeListener(component, "mouseout",  att.mouseoutFn);
        Event.addSubtreeListener(component, "mousedown", { button: "any", handler: att.mousedownFn });

        return;
    }

    Event.addListener(component, "mouseover", att.mouseoverFn);
    Event.addListener(component, "mousemove", att.mousemoveFn);
    Event.addListener(component, "mouseout",  att.mouseoutFn);
    Event.addListener(component, "mousedown", { button: "any", handler: att.mousedownFn });
}
```

`_removeHoverListeners(component, att)` is the mirror image, with the same JSDoc shape: `Event.removeSubtreeListener` for a covering attachment, `Event.removeListener` otherwise, passing `att.mousedownFn` itself (not a registration object) for `"mousedown"`, as `detach` does today. Write both branches out as above: `Event.addListener` and `Event.addSubtreeListener` are overloaded, so a `cond ? a : b` function reference does not typecheck.

**The new test file's fixture.** `packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts` dispatches real events through `Event`'s window-level handler, aimed at the element `DOM.source.elementsFromPoint` returns on top. Its helpers and hooks:

```ts
const HOVER_DELAY_MS   = 500;  // mirrors attach's setTimeout delay
const FADE_SETTLE_MS   = 500;  // past the 100 ms fade and its fallback timer
const DECORATOR_WIDTH  = 200;  // any width that gives each field part a non-empty box
const DECORATOR_HEIGHT = 24;   // room for a single-line field; a field with a lower maximum clamps it
const EDGE_INSET_PX    = 1;    // a point just inside an element's edge, outside its inner parts
const CURSOR_PX        = 10;   // any in-viewport pointer position; no test reads the tooltip's placement

let root: Component;
let showSpy: MockInstance;

function mountDecorated(field: Component, y = 0): FieldDecorator {
    root.addComponent(field);

    const decorator = new FieldDecorator(field, root);

    decorator.setY(y);
    decorator.setWidth(DECORATOR_WIDTH);
    decorator.setHeight(DECORATOR_HEIGHT);
    decorator.doLayout();
    field.doLayout();

    return decorator;
}

// What the pointer hits: the topmost element at a point.
function hitAt(x: number, y: number): Handle { return DOM.source.elementsFromPoint(x, y)[0]; }
function hitCentre(c: Component): Handle        { /* hitAt(rect centre) */ }
function hitInsideLeftEdge(c: Component): Handle { /* hitAt(rect.x + EDGE_INSET_PX, vertical centre) */ }
function hitInsideCorner(c: Component): Handle   { /* hitAt(rect.x + EDGE_INSET_PX, rect.y + EDGE_INSET_PX) */ }
// rect = DOM.source.getElementRect(c.getElement()!)

function pointer(type: string, target: Handle, from: Handle): void {
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(target, type, { clientX: CURSOR_PX, clientY: CURSOR_PX, relatedTarget: from }));
}
function outside(): Handle { return DOM.source.getDocumentElement(); }
function shownTexts(): string[] { return showSpy.mock.calls.map((call) => call[0] as string); }

beforeEach(() => {
    installTestDOM(CONFIG);
    vi.useFakeTimers();
    root = new Component({});
    root.getElement(true);
    showSpy = vi.spyOn(Tooltip, 'show');
});

afterEach(() => {
    Tooltip.hide();
    vi.advanceTimersByTime(FADE_SETTLE_MS);
    root.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    // then the same `Tooltip` static resets as Tooltip.test.ts's ownership
    // describe (:351-363): showTimer, instance, watching, activeElement,
    // pendingId, dismissing, attachments.clear(); then DOM.reset().
});
```

Write each helper out in full with a one-line JSDoc. `CONFIG` is the usual block from [`FieldDecorator.test.ts:13-19`](packages/lib/tests/unit/validation/FieldDecorator.test.ts#L13). Start the file with a header comment that says three things. It dispatches real events because only those exercise `Event`'s subtree walk. It disposes `root` after each test, because `Event`'s installed-listener bookkeeping outlives `DOM.reset()` ([`Link.test.ts:6-12`](packages/lib/tests/component/input/Link.test.ts#L6)). And the modelled hit test ignores `pointer-events`, so every target is taken where no pointer-transparent element sits on top, and asserted before use.

---

## Ordered Implementation Steps

Every line number is `master` at `7698328e`. Run commands from `packages/lib` unless a step says otherwise.

### Code commit — the covering attachment and leave ownership

1. **Write the new test file first.** Create `packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts` with the fixture in *Internal Structure* and one `it` per row of *Expected Behaviour* table A, numbered as there and named for its expectation (e.g. `'1. resting on a decorated text field shows its error'`). Constants: `ERROR = 'Too long'`, `HINT = 'What goes here'`. For a `DateField`, `field.getComponents()` returns `[input, pickerButton]`. Before each dispatch, assert that the target is the expected element, e.g. `expect(hitCentre(decorator)).toBe(field.getElement())`.

2. **Extend `packages/lib/tests/overlay/Tooltip.test.ts`.**
   - After `showFor` (`:341-344`), add a helper with a one-line JSDoc: `function leave(component: Component): void` that calls `(Tooltip as any).attachments.get(component.getId()).mouseoutFn({ relatedTarget: null })`, which is the pointer leaving the component's own element for somewhere outside it.
   - At the end of `describe('Tooltip.detach — ownership')`, after case 11 (`:520-528`), add cases 12–14 from *Expected Behaviour* table B. Use the describe's own `twoAttached`, `hoverOver` and `showFor`.

3. **Check the tests fail for the right reason.** `npx vitest run tests/unit/validation tests/overlay/Tooltip.test.ts`. Expected failures, and no others: table A cases 1–5, 7–10 and 12; table B cases 12 and 13. Table A cases 6 and 11, table B case 14, and every existing case pass.

4. **`Tooltip.ts`: `TooltipAttachment`** (`:31-39`). Replace it with the interface in *Internal Structure*.

5. **`Tooltip.ts`: helpers.** Add `_owns`, `_containsTarget`, `_claimCoveringHover`, `_addHoverListeners` and `_removeHoverListeners` after `_cancelPendingShow` (`:510-517`), as shown in *Internal Structure*.

6. **`Tooltip.ts`: `attach`** (`:378-460`).
   - In `attach`'s JSDoc (`:378-394`), insert this paragraph before "Calling `attach` on a component that already has an attachment replaces it.": *Leaving the component hides the tooltip only when it is this component's own — on screen for it, or still waiting out the hover delay it armed. A tooltip another component owns is left alone.*
   - Turn the method under that JSDoc into `_attachWith`: give it `_attachWith`'s JSDoc and signature from *Internal Structure*, then make the three `// NEW` changes shown there.
   - Between `attach`'s JSDoc and `_attachWith`, write the new one-line `attach` and then `attachCovering` with its JSDoc, as shown in *Internal Structure*.

7. **`Tooltip.ts`: `detach`.** Replace its four `Event.removeListener` lines (`:478-481`) with `Tooltip._removeHoverListeners(component, att);`.
   *Check:* `grep -nE "Event\.(add|remove)(Subtree)?Listener\(component" src/typescript/lib/overlay/Tooltip.ts` lists exactly 16 lines, all inside `_addHoverListeners` and `_removeHoverListeners`.

8. **`FieldDecorator.ts`: `showError`** (`:59-79`).
   - Change `Tooltip.attach(this, message, {` to `Tooltip.attachCovering(this, message, {`. The colors object stays as it is.
   - Replace the JSDoc's first paragraph with: *Applies a red validation-error outline to this decorator and attaches an error tooltip that appears when the pointer rests anywhere on the decorated field. The field fills the decorator, so the tooltip listens on the decorator's whole subtree rather than on its own element; over the field it takes precedence over a tooltip attached to the field itself.* Keep the `outline` paragraph and `@param`. Do not `{@link}` `attachCovering`: it is `@internal`.
   *Check:* `grep -n "Tooltip\.attach(" src/typescript/lib/validation/FieldDecorator.ts` returns nothing.

9. **Run the tests again.** The command from step 3 passes in full. Then, from the repo root: `npm run typecheck`, `npm run lint`, `npm test`.

10. **Commit (code).** Stage `Tooltip.ts`, `FieldDecorator.ts`, `Tooltip.test.ts` and the new test file. Suggested title: *Show FieldDecorator's error tooltip wherever the pointer rests on the field*.

### Documentation commit

11. **`packages/lib/docs/components/Tooltip.md`.** In `## Notes`, after the bullet that begins "`detach()` acts only on the detaching component's own tooltip", add:

    > - Leaving a component hides the tooltip only when it is that component's — on screen for it, or still waiting out the hover delay it armed. A tooltip another component owns is left alone, by the same rule as `detach()`.

12. **`packages/lib/docs/reference/changelog/next.md`** (shared: edit it last, keep the diff to this one bullet). Under `## Fixed` → `### Overlay`, insert this bullet directly after the one that begins `- **Detaching one component's tooltip no longer dismisses another` (`:1257-1266`), with a blank line on each side:

    ```
    - **A validation error's tooltip now appears when the pointer rests on the
      invalid field.** `FieldDecorator.showError` attached its tooltip to the
      decorator, whose field fills its whole box, and a tooltip only listened
      for the pointer over its host's own element — so the pointer always
      landed on the field and the error never showed. The error now appears
      from anywhere over the field, including a `DateField`'s input and picker
      button, and there it takes precedence over a tooltip attached to the
      field itself, such as a `LabeledGrid` description. Leaving a component
      now also hides the tooltip only when it is that component's, the rule
      `Tooltip.detach()` already follows, so moving between a field's parts no
      longer dismisses the error on screen. No consumer action is needed.
    ```

13. **Commit (docs).** Suggested title: *Document the decorator's covering error tooltip and leave ownership*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/src/typescript/lib/validation/FieldDecorator.ts` |
| Create | `packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts` |
| Modify | `packages/lib/tests/overlay/Tooltip.test.ts` |
| Modify | `packages/lib/docs/components/Tooltip.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below derives from the contract: a pointer resting on the invalid field shows why it is invalid. "The hit at" a point is the topmost element `DOM.source.elementsFromPoint` returns there, which is what a pointer at that point targets. "Enter" is a `mouseover` on the named target with `relatedTarget` = the document element. "Wait" advances fake timers 500 ms. "Shown" is the list of texts passed to `Tooltip.show`, in order. "Anchor" is `(Tooltip as any).activeElement`. "Dismissing" is `(Tooltip as any).dismissing`. Each table was run offline against `master` and against a prototype of this design before the plan was written.[^prototype]

**Table A — `FieldDecorator.pointerTooltip.test.ts`** (unit; real events through `Event`)

| # | Field and setup | Pointer | Expect | On `master` |
|---|---|---|---|---|
| 1 | `TextField`; `showError(ERROR)` | enter the hit at the decorator's centre (assert: the field's element); wait | shown `[ERROR]`; anchor = the decorator's element | fails |
| 2 | `DateField`; `showError(ERROR)` | enter the hit at the input's centre (assert: the input's element); wait | shown `[ERROR]` | fails |
| 3 | as 2 | as 2; then `mouseout` on the input with `relatedTarget` = the button, and `mouseover` on the button from the input, where the button is `hitInsideLeftEdge(pickerButton)` (assert: the button's element); wait | shown still `[ERROR]`; not dismissing; anchor = the decorator's element | fails |
| 4 | as 1 | as 1; then `mouseout` on the field's element to `outside()` | dismissing; anchor `null` | fails |
| 5 | `TextField`; `Tooltip.attach(field, HINT)`, then `showError(ERROR)` | as 1 | shown `[ERROR]` | fails (shows `HINT`) |
| 6 | `TextField`; `Tooltip.attach(field, HINT)`, `showError(ERROR)`, `clearError()` | as 1 | shown `[HINT]` | passes |
| 7 | `DateField`; `Tooltip.attach(field, HINT)`, then `showError(ERROR)` | enter the input; wait; input → edge → input, where the edge is `hitInsideCorner(field)` (assert: the `DateField`'s own element), each crossing a `mouseout` then a `mouseover` with matching `relatedTarget`s; wait | shown `[ERROR]`; not dismissing; anchor = the decorator's element | fails |
| 8 | two `TextField`s, the second decorator at `y = 2 * DECORATOR_HEIGHT`; `showError` on both | enter the first; wait; then the second decorator's `showError('Other, again')` and `clearError()` | not dismissing; anchor = the first decorator's element | fails |
| 9 | as 8 | enter the first, no wait; then the second decorator's `showError('Other, again')` | `pendingId` = the first decorator's id; after a wait, shown `[ERROR]` | fails |
| 10 | as 1 | as 1; then `clearError()` | dismissing; anchor `null` | fails |
| 11 | `TextField`; `showError(ERROR)`, `clearError()` | enter; wait | shown `[]` | passes |
| 12 | as 2 | as 2; then a `mousedown` with `button: 0, buttons: 1` on the input; then the input → button crossing of case 3; wait | dismissing right after the press; shown still `[ERROR]`, so the error stays hidden until the pointer leaves the field | fails |

Cases 8 and 9 are C21's two halves, now reached by a pointer. Case 7 is the one that needs leave ownership.

**Table B — `Tooltip.test.ts`, `describe('Tooltip.detach — ownership')`** (unit; the stored closures, as the describe already drives them)

| # | Setup (`twoAttached()`) | Action | Expect | On `master` |
|---|---|---|---|---|
| 12 | `showFor(a)` | `leave(b)` | not dismissing; anchor = A's element | fails |
| 13 | `hoverOver(a)` | `leave(b)` | `showTimer` not `null`; `pendingId` = A's id | fails |
| 14 | `showFor(a)` | `leave(a)` | dismissing; anchor `null` | passes |

**Manual — user-run only.** Each of these opens a browser window. The implementer must not run them. Record them in `## Implementation Notes` as owed to the user.

- **M1.** Library demo app, *Binding* tab: empty the name field so its `required` rule fails, then rest the pointer on the field. The red error tooltip appears after about half a second, and fades when the pointer moves off.
- **M2.** Same tab: empty the birth date, rest the pointer on the date text, then move it onto the calendar button. The error appears over the text and stays up across the move.
- **M3.** The hand-run C21 check in [`tooltip-picker-and-serialization-fixes.md:695`](plans/implemented/tooltip-picker-and-serialization-fixes.md#L695), on the QA app's `form-flat`, as amended in *Consequences for doc-and-qa-record-drift* below.

---

## Verification

1. `npx vitest run tests/unit/validation tests/overlay/Tooltip.test.ts` (in `packages/lib`): all green.
2. From the repo root: `npm run typecheck`, 0 errors; `npm run lint`, no new findings; `npm test`, all green.
3. `npm run build:lib && npm -w packages/qa run test` from the repo root: all green. The QA tests run under jsdom against the built library.
4. `npm run docs:api`: no warnings beyond the 14 `master` already emits. `npm run docs:llms:check`: passes.
5. The grep checks in steps 7 and 8.
6. M1–M3: owed to the user.

---

## Documentation Impact

- No export changes. `attachCovering` is `@internal`, so TypeDoc (`excludeInternal: true`) leaves it out, and no public JSDoc may `{@link}` it.
- `FieldDecorator`'s API page regenerates from `showError`'s new JSDoc (step 8).
- [`docs/components/Tooltip.md`](packages/lib/docs/components/Tooltip.md) gains the leave-ownership note (step 11). Its *Attach to a raw element* section stays true: `attach` still matches only its host's own element.
- `changelog/next.md`: one *Fixed → Overlay* entry (step 12). No migration note, because nothing breaks.

---

## Potential Challenges

- **Events vanish in later tests.** `Event` keeps its installed window listeners across `DOM.reset()`. The new file's `afterEach` disposes `root`, which drops every registration and uninstalls them.
- **The modelled hit test ignores `pointer-events`.** It would report a button's glyph where a real pointer hits the button. Pick points where no pointer-transparent element is on top (1 px inside the button's left edge, left of its glyph), and assert each target first.
- **A fade left running leaks into the next test.** `afterEach` hides the tooltip and runs the fade out under fake timers before switching to real ones.
- **Spies replace statics by name.** The new tests spy on `Tooltip.show`, which the hover timer calls by name. `doc-and-qa-record-drift`'s case 5 spies on `Tooltip.detach`, which `_attachWith` must keep calling by name.
- **A nearer listener could stop the walk.** A listener that returns a stop disposition for `mouseover` or `mouseout` on an element inside the decorator would end `Event`'s subtree walk before the decorator. No field class registers one today; the checked classes were `TextInput`, the picker fields, `NumberSpinner`/`SpinButton`, `Checkbox`, `Toggle`, `Slider` and `ComboBox`.
- **Pointer moves cost an ancestor walk while an error is attached.** A subtree `mousemove` registration makes `Event` walk from every `mousemove` target to the root, as a chart already does. The render-review campaign's G20 `event-dispatch-and-registrants` group targets that walk's cost.

---

## Critical Files

| File | Why |
|---|---|
| [`overlay/Tooltip.ts:31-39`, `:378-517`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L378) | `TooltipAttachment`, `attach`, `detach` and `_cancelPendingShow`: every edit site |
| [`overlay/Tooltip.ts:84-90`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L84) | `pendingId`, C21's ownership pointer |
| [`validation/FieldDecorator.ts`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts) | `showError` / `clearError`, and the zero-inset `Fit` that makes the field cover the decorator |
| [`core/Event.ts:248-348`](packages/lib/src/typescript/lib/core/Event.ts#L248) | `baseListener`: exact-target listeners first (`:274-293`), then the subtree walk from the target up (`:296-347`), the order the precedence rule relies on |
| [`core/Event.ts:596-667`](packages/lib/src/typescript/lib/core/Event.ts#L596) | `addSubtreeListener` / `removeSubtreeListener` |
| [`component/container/SplitGutter.ts:222-231`, `:674-740`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L222) | The precedent: subtree hover listeners filtered by `relatedTarget` |
| [`tests/overlay/Tooltip.test.ts:317-529`](packages/lib/tests/overlay/Tooltip.test.ts#L317) | `hoverOver`, `showFor` and the ownership cases the new cases extend |
| [`tests/component/container/SplitGutter.hoverSubtreeRouting.test.ts`](packages/lib/tests/component/container/SplitGutter.hoverSubtreeRouting.test.ts) | Real-event dispatch through the window-capture path, in the same shape the new test uses |
| [`tests/dom/TestDOM.ts:1472-1500`, `:1642-1680`](packages/lib/tests/dom/TestDOM.ts#L1472) | `elementsFromPoint` (paint order, no `pointer-events` model) and `makeEvent` |
| [`plans/implemented/tooltip-picker-and-serialization-fixes.md`](plans/implemented/tooltip-picker-and-serialization-fixes.md) | C21's ownership decisions this plan extends to `mouseout` |

---

## Non-Goals

- **Accessibility and keyboard focus.** No `aria-invalid`, no `aria-describedby`/`aria-errormessage`, no tooltip `role`, no reveal on focus.[^a11y]
- **`Tooltip.attach` on composite fields.** A tooltip attached to a `DateField`, `TimeField`, `NumberSpinner` or `Toggle` still never arms over the parts that cover the field's own element, and a `Checkbox`'s tooltip never arms over its box. `LabeledGrid`'s field descriptions hit this. That needs a subtree mode where the nearest tooltip wins, which is the opposite rule to the covering one.[^where]
- **A public covering or subtree option.** `attachCovering` stays `@internal` until a second caller exists.
- **`attachToElement` and `detachElement`.** Their native listeners and unconditional leave `hide()` are unchanged. `HeaderCell` and `ParentHeader` are never inside a decorator.
- **Replacing a tooltip already on screen.** If `showError` runs while the field's own tooltip is on screen under a still pointer, that tooltip stays until the pointer leaves and re-enters.
- **Re-attach on every keystroke.** `showError` re-attaches, which dismisses the decorator's own visible error. That is C21's rule (`Tooltip.test.ts` case 8) and is unchanged.
- **The render-review campaign's G19 `tooltip-hover-path` group.** `attach`'s per-call closures, its always-on `mousemove` and its missing unchanged-text early return are performance work for G19, which must carry the covering mode along.

---

## Consequences for doc-and-qa-record-drift

Once this plan has landed, `plans/doc-and-qa-record-drift.md` changes as follows.

1. **Frontmatter.** Add `depends-on: [field-decorator-pointer-tooltip]`.
2. **The C21 target aims at the field.** In *Internal Structure*, `tooltipOwnershipTarget`'s `const ownerElement = elementFor(tools, owner.decorator, panel);` becomes `const fieldElement = elementFor(tools, owner.field, panel);`, and `hoverCentre(tools, ownerElement)` becomes `hoverCentre(tools, fieldElement)`. The `<input>` is what a pointer resting on the field hits, and the decorator's covering error tooltip now hears the `mouseover` through its subtree. `fireMouse`'s default `relatedTarget` of `null` reads as a fresh enter. The target's JSDoc "then hovers the first one's decorator" becomes "then hovers the first field", and the unit table's row 0 reads "`mouseover` on the first field". The target stays a `call` target rather than the `hover` driver: the hover and the keystroke must still share one phase, the reason the `type` driver was rejected. That plan's Expected Behaviour cases 1–6 are unchanged.
3. **Decision, overview and non-goals.**
   - The decision *The hover goes to the decorator's own element* becomes *The hover goes to the first field's own element* and states point 2. Its second paragraph ("This defect is not fixed here…") and the footnote `[^decorator-covered]` are deleted.
   - The Overview paragraph that begins "Item 4 turned up a library defect" becomes one sentence: the C21 target hovers the field as a pointer would, which reaches the error tooltip since `field-decorator-pointer-tooltip`.
   - The Non-Goals bullet "No fix for `FieldDecorator`'s unreachable tooltip" is deleted. So is the parenthetical "(including the tooltip plan's hand-run C21 row, which the defect above makes impossible to perform)".
   - The Critical Files row for `FieldDecorator.ts` reads "`showError` / `clearError`, which attach and detach the decorator's covering error tooltip".
4. **README wording (steps 5d and 6).**
   - Step 5d's "See *C21's witness hovers the decorator*" becomes "See *C21's witness hovers the field*".
   - Step 6's paragraph is retitled **C21's witness hovers the field.**
   - In that paragraph, "It then sends one `mouseover`, with no button held, to the first field's `FieldDecorator`." becomes "It then sends one `mouseover`, with no button held, to the first field's own `<input>`, the element a pointer resting on the field hits."
   - Everything from "The `mouseover` goes to the decorator's element because no pointer can reach it" through "until it is fixed nobody can run this check by hand." is deleted. The sentences that follow stay.
5. **Agenda (step 16) and its commit title (step 18).**
   - Drop the third bullet (*`FieldDecorator`'s error tooltip never shows under a pointer*). `master` `7698328e` already lists the defect under *Found while planning phase 2's follow-ups (2026-09-21)* as "fixed by `field-decorator-pointer-tooltip`".
   - Append, at the end of that same section, the two gaps this plan leaves open: (a) *`FieldDecorator`'s error is invisible to assistive technology* — no `aria-invalid`, no `aria-describedby`/`aria-errormessage`, no tooltip `role`, and focus does not reveal it; the fix needs a persistent message element per decorator and `Aria` setters the library lacks. (b) *`Tooltip.attach` never arms over a composite field's parts* — `DateField`, `TimeField`, `NumberSpinner` and `Toggle` over their inputs, buttons or track, and `Checkbox` over its box; `LabeledGrid`'s field descriptions hit this, and the fix needs a nearest-tooltip-wins subtree mode, not the decorator's covering one. Mark each "open, a non-goal of `field-decorator-pointer-tooltip`".
   - Step 18's suggested title becomes *Record Loom's retired harness, two fixes and the decorator fix's open gaps*.
6. **The hand-run C21 check becomes performable.** Resting the pointer on the first decorated text field now shows its error tooltip after 500 ms, so the row at `tooltip-picker-and-serialization-fixes.md:695` can be run as written. Once the tooltip is up, the tester must not click, because a press dismisses it. They must also not type in the first field again, because its own re-attach dismisses it too. So focus must already be in the second field when the pointer comes to rest: fill the first field before the second, or move focus with the keyboard. The implemented plan is a dated record and stays unedited.

---

## Notes

[^verified]: Offline, with the modelled DOM (`installTestDOM`) on `master` `f0d95ef8`. Each field was wrapped in a `FieldDecorator` 200 px wide, laid out, and sampled on a 4 px grid with `DOM.source.elementsFromPoint`. The decorator's own element was the top hit at none of the sample points for `TextField`, `PasswordField`, `TextArea`, `DateField`, `TimeField`, `ComboBox`, `NumberSpinner`, `Checkbox`, `Toggle` and `Slider`. A `mouseover` dispatched on a decorated `TextField`'s `<input>` left `Tooltip.pendingId` `null`; the same event on the decorator's element armed it. The modelled hit test ignores `pointer-events`, so the source was read for what a real engine hits. A text field's own `<input>` takes the pointer. `DateField` and `TimeField` hand it to their input and picker button, `NumberSpinner` to its inner input and spin buttons, `Toggle` to its track and `Checkbox` to its box. `ComboBox` and `Slider` take it on their own element, because their parts are pointer-transparent. In no case is the decorator's element hit.

[^where]: Four other placements were rejected.
    - **Attach the error to the field.** A composite's parts cover its own element, so `DateField`, `TimeField`, `NumberSpinner`, `Toggle` and `Checkbox` would stay broken. The library's own *Binding* demo validates a `DateField` and a `TimeField`. It would also collide with the field's own attachment: `attach` keeps one attachment per component and replaces it, so `showError` would erase a `LabeledGrid` description and `clearError`'s `detach` would delete it for good.
    - **Make every `attach` listen on its subtree.** That also fixes composites, but it changes every tooltip host, and nested hosts need the opposite precedence: the nearest tooltip wins. That rule has its own edge cases. With `relatedTarget` filtering, an outer host's delay can fire while the pointer is on an inner host, and the outer tooltip does not come back when the pointer returns to the outer host's own area; `SplitGutter`'s gutter and chevron are such a pair. Without the filter, every move between two children restarts the delay. And a subtree `mousemove` would walk the ancestor chain on every pointer move in every app with a text button.
    - **`attachToElement`.** It takes no colors. It is keyed by a rendered element, while `showError` can run before render. It uses native listeners outside the `Event` API, and its own timer outside `pendingId`. And `detachElement` leaves a visible tooltip on screen, so `clearError` would leave the error up.
    - **`FieldDecorator` drives `Tooltip.show`/`hide` itself**, as `AbstractChart` does. That duplicates the hover delay, cannot apply the error colors (`_applyColors` is private), and bypasses C21's `pendingId`.

    `attachCovering` is `@internal` because it has one caller. Its precedence suits a wrapper, not the general composite case, which needs the nearest-wins rule. The pre-1.0 rule is not to publish API without a real external use.

[^other-wrappers]: Surveyed on `master`. `Component.replaceComponent` has one caller, `FieldDecorator`. The other components that fit a child to their whole box with a zero-inset `Fit` are `Button`, `AbstractSelectableList` and `Dialog`. `Button` makes its content pointer-transparent (`Button.ts:791-800`), so its own element takes the pointer. `AbstractSelectableList` attaches tooltips to its rows, whose renderers are pointer-transparent (`AbstractSelectableList.ts:422-433`). `Dialog` carries no tooltip. Among the other `Tooltip.attach` hosts, `SplitGutter` gives its chevron its own attachment (`SplitGutter.ts:469-473`), and `TabBar`, `TablePanel` and `TreeTablePanel` attach to `Button`s. `HeaderCell` and `ParentHeader` use `attachToElement`, whose native listeners already hear their children. The one related case is `LabeledGrid`, which attaches a description to whatever field it is given; a composite field covers its own element, which is the non-goal on composite fields.

[^precedent]: `SplitGutter`'s comment at `:222-229` names the same defect: a hit-testable child means `addListener` never sees the events that target it. The same subtree-plus-`relatedTarget` shape is in `Accordion`'s header hover (`layout/Accordion.ts:851`, `:877`, `:1470-1471`), `AbstractChart.handlePointerOut` (`component/chart/AbstractChart.ts:881-890`) and `Button._isInsideTarget` (`component/button/Button.ts:600-604`). ARCHITECTURE.md's *Hover detection uses `mouseover` / `mouseout`* prescribes filtering on `relatedTarget` for enter/leave semantics.

[^cross-component]: ARCHITECTURE.md reserves `Event` calls against another component for listening on self, with one named carve-out for cell editors. `Tooltip.attach` has always registered against the component it is handed: it wires hover on its caller's behalf, and here the caller is the decorator attaching to itself. `attachCovering` registers at that same site through the subtree form of the same API, so it adds no new kind of cross-component listening.

[^error-wins]: The error is state the user must act on, and it exists only while the field is invalid; a field's own tooltip is a static hint. `LabeledGrid` attaches its description to the label as well as the field, so the hint stays reachable on the label. Within one dispatch, the field's `attach` handler arms first whenever no delay is running, and the covering handler then cancels it and arms the error. While the error is on screen no timer runs, so the field's handler can still arm on a crossing onto the field's own element (a `DateField`'s 3 px edge); the covering handler cancels that too and treats the move as internal. Nested covering attachments do not occur: `FieldDecorator` is the only caller, and no decorator wraps another.

[^leave-ownership]: Case 7 of table A needs this. Without it, when the pointer crosses from a `DateField`'s own 3 px edge onto its input, the field's own tooltip's `mouseout` calls `hide()` and dismisses the error. The next `mouseover` is internal to the decorator, so the error stays gone. With the prototype's leave made unconditional again, case 7 and table B cases 12–13 failed and nothing else did. For existing hosts nothing changes: an `attach` host's own leave still hides its own tooltip. A host only sees a tooltip it does not own when a covering attachment contains it, or when a caller has used `Tooltip.show` directly.

[^c21]: The C21 plan (`plans/implemented/tooltip-picker-and-serialization-fixes.md`, *C21 — `detach` acts only on what the detaching component owns* and *the pending show gets its own ownership pointer*) made `detach` cancel only its own pending show and hide only its own anchor. A covering takeover never leaves a timer running under someone else's `pendingId`, because `_cancelPendingShow` clears the timer and `pendingId` together before the arm sets both again. Table A cases 8 and 9 pin C21's two halves through the covering path.

[^a11y]: Two separate designs, neither needed to fix the pointer.
    - **Exposure to assistive technology** needs `aria-invalid` on the field's focusable element, and `aria-describedby` or `aria-errormessage` pointing at an element that holds the message for as long as the field is invalid. `Aria` (`core/Aria.ts`) has neither setter. The tooltip is one shared element that exists only while shown and is removed after its fade, so it cannot be that element. For a composite the focusable element is an inner part (a `DateField`'s input), which the decorator has no API to reach.
    - **Reveal on keyboard focus** needs a tooltip placed against an element: `Tooltip.show` places it at a pointer position. It also needs a decision for every tooltip host, not only for errors.

[^prototype]: The prototype replaced `Tooltip.attach`, `Tooltip.detach` and `FieldDecorator.showError` at run time through a throwaway vitest setup file, so no source file was edited. Table A as specified here: `master` failed cases 1–5, 7–10 and 12 and passed 6 and 11; the prototype passed all twelve. Table B: `master` failed 12 and 13; the prototype passed all three. The whole `packages/lib` suite (484 files) passed with the prototype applied, and the new test file typechecks under `tsconfig.test.json`.

---

## Implementation Notes

- **Manual checks owed to the user.** M1, M2 and M3 from *Expected Behaviour* each open a browser window, so the implementer did not run them. They remain for the user: the *Binding* tab's name field (M1) and birth date (M2) in the library demo app, and the hand-run C21 check on the QA app's `form-flat` (M3), performed as *Consequences for doc-and-qa-record-drift* point 6 describes.
- **Four test helpers beyond the fixture's list.** `FieldDecorator.pointerTooltip.test.ts` adds `enter(target)` (a `mouseover` from `outside()`), `cross(from, to)` (the `mouseout`/`mouseover` pair with matching `relatedTarget`s that cases 3, 7 and 12 describe), `press(target)` (case 12's `mousedown` with `button: 0, buttons: 1`, which `pointer` has no fields for) and, inside the `describe`, `twoDecorated()` for the shared setup of cases 8 and 9. Each is a one-line JSDoc'd wrapper over the fixture the plan specifies; no expectation changed. `showSpy` is typed `MockInstance<typeof Tooltip.show>` rather than a bare `MockInstance`, so `call[0]` stays typed.
- **Return types on the two rewritten closures.** `_attachWith`'s `mouseoverFn` and `mouseoutFn` carry `: void`, as *Internal Structure* writes them; `mousemoveFn` and `mousedownFn` are copied verbatim, without one, as the plan's "unchanged" asks.
- **Verification.** Step 3's run failed exactly table A cases 1–5, 7–10 and 12 and table B cases 12 and 13, each on its behavioural assertion rather than a hit-target check. After the change: typecheck and lint clean, `npm test` 483 files / 8036 tests green, `build:lib` plus `packages/qa`'s 246 jsdom tests green, `docs:api` at the same 14 warnings as the base, `docs:llms:check` passing, and both grep checks as specified (16 `Event` lines, all in the two helpers; no `Tooltip.attach(` in `FieldDecorator.ts`).
