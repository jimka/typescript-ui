# Scroll Content Frame — Implementation Plan

## Overview

Introduce a container-scoped **content frame**: a lazily-created, id-less, listener-less wrapper `<div>` interposed between a container's element and its children. When a container's children overflow its inner rect, the frame is created, all child elements are re-parented into it, and it is sized explicitly to the full content extent (`leadingInset + childrenExtent + trailingInset`) on each axis. The host `Panel`'s native `overflow: auto` then scrolls the oversized frame, so the scroll extent is deterministic and BOTH the leading and trailing insets are reserved — fixing the reported HBox/VBox trailing-inset loss under overflow.

The mechanism mirrors the existing per-child clip-frame at container scope. `Component.setClipFrame`/`clearClipFrame` ([Component.ts:607](../src/typescript/lib/core/Component.ts#L607), [Component.ts:654](../src/typescript/lib/core/Component.ts#L654)) already lazily create a wrapper, re-parent ONE element into it, and tear it down on the non-clipped path; `Grid.doLayout` drives that per-child ([Grid.ts:797](../src/typescript/lib/layout/Grid.ts#L797), [Grid.ts:800](../src/typescript/lib/layout/Grid.ts#L800)). This plan adds the parallel `Component.setContentFrame`/`clearContentFrame` pair (wrapping ALL children, no `overflow:hidden`, sized to content) and has `HBox`/`VBox` drive it through a shared `LayoutManager.reserveContentFrame` helper layered on top of — not replacing — their existing spill branch (placement stays byte-identical; the frame is purely additive).

This plan adopts the content frame in **`HBox` and `VBox` only**. `Card`/`Accordion`/`Split`/`Grid` keep their existing spill branches and are listed as a `## Non-Goals` follow-up. The new Component API is additive and does not alter the non-adopting managers.

Root cause of the trailing-inset bug (verified live): in [HBox.doLayout](../src/typescript/lib/layout/HBox.ts#L397) and [VBox.doLayout](../src/typescript/lib/layout/VBox.ts#L386), children are placed from `getContentInsets().getLeft()/getTop()` (leading inset explicit). The trailing inset is only the empty region left by `getInnerSize` ([Component.ts:1931](../src/typescript/lib/core/Component.ts#L1931)) subtracting both perimeter bands — which holds only while children fit. On overflow the spill branch inflates the working size to `computeTotalMinSize()` ([HBox.ts:417](../src/typescript/lib/layout/HBox.ts#L417), [VBox.ts:405](../src/typescript/lib/layout/VBox.ts#L405)) — which adds NO insets — so children spill to exactly the last child's far edge and the host's `scrollWidth`/`scrollHeight` ends there. Measured: trailing gap = 0 on both axes. The host's scroll extent over absolutely-positioned children is driven ONLY by the children's boxes (container `padding-bottom` and last-child `margin-bottom` each contributed 0 to `scrollHeight`); reserving the trailing inset therefore REQUIRES a real sized element reaching that coordinate — which the content frame is.

---

## Architecture Decisions

### Component owns the DOM lifecycle; layout managers only drive it

`setContentFrame(width, height)` / `clearContentFrame()` live on `Component`, exactly mirroring `setClipFrame`/`clearClipFrame`. The re-parenting, lazy creation, and teardown are well-tested in ONE place; `HBox`/`VBox` merely decide whether to call them and with what size — the same division of labour `Grid` already uses for the per-child clip frame. This keeps the manager change surgical (a size computation plus one call) and avoids duplicating fragile DOM-move code per manager.

### Shared frame primitive — clip and content frames build on one helper pair

`clipFrame` and `contentFrame` are opposites in intent (clip one child to its cell with `overflow:hidden` vs. expose all children for scrolling with no clip) but share one fiddly primitive: lazily create an id-less, listener-less `<div>`, attach an `InlineStyle` buffer, apply a base `position:absolute`, and on teardown remove the node and replace the spent style buffer. That shared mechanism — where the subtle bugs live (the buffer re-attach after teardown, the no-id/no-listener guarantee) — is extracted into a private helper pair on `Component`:

- `private createFrame(style: InlineStyle, base): HTMLElement` — `createElement("div")`, `style.attach(frame)`, apply `position:absolute` plus the caller's `base` overrides (clip passes `{ overflow: "hidden" }`, content passes `{ left: "0px", top: "0px" }`), return the frame.
- `private disposeFrame(frame: HTMLElement): InlineStyle` — `frame.remove()` and return a fresh `InlineStyle` for the caller to assign back to its buffer field.

What the helper deliberately does NOT own is the **re-parent topology**, because clip and content differ structurally: `clipFrame` wraps **this component's own element**, inserting the frame at the element's slot in its *parent*; `contentFrame` wraps **this component's children**, appending the frame inside *this* element. Each method keeps its own short reparent/un-reparent, but both route creation and teardown through the shared pair. Crucially, `setClipFrame`/`clearClipFrame` are **refactored onto the same helpers in this change** — the clip path is not left as a parallel copy — so the existing `Grid` clip behaviour must be regression-tested (it is; see Verification).

### Frame at padding-box origin (0,0) — no child coordinate change

The frame is `position: absolute; left: 0; top: 0`, carrying no border/padding/insets of its own. Because the framework absolutely-positions children and a child's containing block is its parent's padding box, parking the frame at the container's padding-box origin keeps every child's existing `left`/`top` valid inside the frame — `getX`/`getY`/drag math are untouched. The frame is a pure geometric box sized to `(width, height)`; the trailing inset is reserved by making `width`/`height` = `leadingInset + childrenExtent + trailingInset`, so the frame's far edge sits `trailingInset` past the last child.

### Child-host indirection via a private accessor

A private `getChildHost()` returns `this._contentFrame ?? this.getElement()`. `addComponent` ([Component.ts:3313](../src/typescript/lib/core/Component.ts#L3313)), `insertComponent` ([Component.ts:3366](../src/typescript/lib/core/Component.ts#L3366)), and the DOM-insert paths route appends/inserts through it so a child added while the frame is active lands inside the frame, not behind it. This is the symmetric partner to the existing `getAttachNode()` ([Component.ts:687](../src/typescript/lib/core/Component.ts#L687)): `getAttachNode` answers "what node does THIS component occupy in its parent" (frame-aware on the child side); `getChildHost` answers "where do MY children attach" (frame-aware on the parent side). `removeComponent` calls `component.removeElement()` ([Component.ts:3398](../src/typescript/lib/core/Component.ts#L3398)), which uses `element.remove()` and is parent-agnostic — no change needed there.

### Re-parent the outermost child node (clip-frame coexistence)

When `setContentFrame` re-parents children, it must move each child's **outermost** node — its clip frame when one is active, else its element — not its bare element. `Component` already encodes this notion as the private `getAttachNode()`. To let the container move a child by its outermost node, add a tiny package-private helper the container can call per child (e.g. a `protected getOuterElement()` returning `this._clipFrame ?? this.getElement()`, or reuse `getAttachNode` by widening it to `protected`). The content frame and per-child clip frame thus nest correctly: container frame → child clip frame → child element. This matters for `Grid` children specifically, but `Grid` is not adopting the content frame in this plan, so the coexistence requirement applies only if a future manager nests them; we still implement the move-by-outer-node correctly so the API is safe.

### Keep-once-created: resize, don't thrash

When a container hovers near the fit↔overflow boundary (e.g. during a drag-resize), tearing down and rebuilding the frame would re-home N child elements every frame. Decision: **once created, keep the frame and just resize it; only `clearContentFrame` when the layout determines the container genuinely fits** (content extent ≤ inner size on BOTH axes). `setContentFrame` is idempotent (resize the existing frame, like `setClipFrame`). This trades a single extra wrapper div in the steady fit-state-after-overflow for avoiding repeated N-element re-parents. Teardown still happens — it is not "create once forever" — but only on a real fit, not on every sub-pixel oscillation. (Grid's teardown-on-fit is cheap because it moves one element; for the whole child set the asymmetry justifies the difference.)

### Scroll/focus preservation around re-parent

Creating or destroying the frame re-parents the child set, which can reset the host `Panel`'s `scrollTop`/`scrollLeft`. `setContentFrame`/`clearContentFrame` save the host element's `scrollLeft`/`scrollTop` before the re-parent and restore them after. `appendChild`/`insertBefore` MOVE nodes (they do not clone), so a focused `<input>` among the children keeps focus across the move in all target browsers — no focus guard is required; this is noted rather than coded. (Restoring scroll position is on the same element whose `overflow` produces the scrollbar — the container element itself.)

### Listeners and event delegation across the interposed frame

The content frame adds one DOM level between the container element and its children, so this change is as much about the **event path** as the layout. Three rules the implementation must hold, and the verification must exercise:

1. **The frame is transparent to delegation.** The framework delegates by walking an event's ancestor chain and matching each element's `id` against registered component ids — the same mechanism `addSubtreeListener` relies on, and the reason the clip frame already works ([Event.ts](../src/typescript/lib/core/Event.ts)). The content frame MUST carry no `id` and no listeners so the walk skips straight over it. This is not new *in kind* — `clipFrame` already interposes an id-less frame between a child and its container and delegation survives — but `contentFrame` does it for *every* child at once, so it must be verified, not assumed.
2. **Re-parenting must not drop listeners.** `appendChild`/`insertBefore` MOVE nodes; listeners bound to a child's element (or its descendants) travel with the node and are NOT lost. The implementation must *move* nodes, never clone or re-create them, and must not tear down and rebuild any child's element when entering/leaving the frame. After a frame create or teardown, every child's own click/hover/focus/keyboard/drag handlers must still fire.
3. **No code may assume children are DIRECT DOM children of the container element.** With the frame active a child's `parentNode` is the frame, not the container element. Any logic that does `child.parentElement === containerEl`, iterates `containerEl.children`, uses a `:scope > *` selector, or indexes `childNodes` to correlate DOM with `getComponents()` will silently break. This MUST be audited before adopting the frame (see the audit step in Ordered Implementation Steps), because a wrong assumption here surfaces as "clicks/hovers stop working *only when the panel overflows*" — a state-dependent regression that escapes a quick smoke test.

---

## Public API (TypeScript Signatures)

New public methods on `Component` (mirroring `setClipFrame`/`clearClipFrame`), and one private accessor + private field/style buffer:

```ts
class Component {
    // Runtime-only state, off the options bag (mirrors _clipFrame/_clipFrameStyle).
    private _contentFrame:      HTMLElement | null;   // = null
    private _contentFrameStyle: InlineStyle;          // = new InlineStyle()

    /**
     * Wraps this container's children in a content frame sized to (width, height)
     * and re-parents all child nodes into it. Idempotent: resizes an existing
     * frame. No-op when the element is not in the DOM.
     */
    setContentFrame(width: number, height: number): this;

    /**
     * Removes the content frame, re-parenting children back to the element at the
     * frame's former position. No-op when no frame is active.
     */
    clearContentFrame(): this;

    /** Node new children attach to: the content frame when active, else the element. */
    private getChildHost(): HTMLElement | null | undefined;  // = this._contentFrame ?? this.getElement()

    /** Widen from private to protected so a parent can move a child by its outermost node. */
    protected getAttachNode(): HTMLElement | null | undefined;  // already exists at L687, currently private

    // Shared frame primitive — both setClipFrame and setContentFrame build on these.
    private createFrame(style: InlineStyle, base: Record<string, string>): HTMLElement;
    private disposeFrame(frame: HTMLElement): InlineStyle;  // frame.remove() + returns a fresh buffer
}
```

No `XOptions` field and no typed setter pair beyond these — `_contentFrame` is runtime-derived DOM state (like `_clipFrame`), never a declarative input, so it stays off `ComponentOptions` and follows the "runtime-only state" precedent documented at [Component.ts:245-253](../src/typescript/lib/core/Component.ts#L245).

`setClipFrame`/`clearClipFrame` keep their existing **public signatures**; only their bodies are refactored onto `createFrame`/`disposeFrame` — no API change, no behaviour change.

No *public* manager API changes. `setOverflowing`/`isOverflowingX`/`isOverflowingY` on `LayoutManager` ([LayoutManager.ts:122](../src/typescript/lib/layout/LayoutManager.ts#L122)) are unchanged. One new `protected reserveContentFrame(): this` is added to `LayoutManager` (internal, not part of the public surface) for the adopting box layouts to call.

---

## Internal Structure

### Shared frame helpers (new — both frame pairs route through these)

```
private createFrame(style: InlineStyle, base: Record<string, string>): HTMLElement {
    const frame = document.createElement("div");   // no id, no listeners — transparent to id-based subtree delegation
    style.attach(frame);
    style.setMany({ position: "absolute", ...base });
    return frame;
}

private disposeFrame(frame: HTMLElement): InlineStyle {
    frame.remove();
    return new InlineStyle();   // the spent buffer was bound to the removed frame; caller assigns this back
}
```

`setClipFrame`/`clearClipFrame` are refactored onto these: clip's create becomes `this._clipFrame = this.createFrame(this._clipFrameStyle, { overflow: "hidden" })` (then it inserts the frame at its element's slot in the parent and moves its own element in), and clip's teardown becomes `this._clipFrameStyle = this.disposeFrame(frame)` (after moving its element back out). The reparent topology stays in each method; only the create/teardown primitive is shared. The frame element created here carries **no id and no event listeners** — the single most important invariant for event delegation (see Architecture Decisions).

### `setContentFrame` body shape (mirrors `setClipFrame` at [Component.ts:607](../src/typescript/lib/core/Component.ts#L607))

```
const element = this.getElement();         // no force-create arg (deferred-DOM discipline)
if (!element) return this;                 // no-op when detached

if (!this._contentFrame) {
    const scrollLeft = element.scrollLeft; // preserve host scroll across re-parent
    const scrollTop  = element.scrollTop;

    this._contentFrame = this.createFrame(this._contentFrameStyle, { left: "0px", top: "0px" });
    const frame = this._contentFrame;

    // Move each child's OUTERMOST node (clip frame if any, else element) into the frame.
    for (const child of this._components) {
        const node = child.getAttachNode();   // now protected
        if (node) frame.appendChild(node);
    }

    element.appendChild(frame);

    element.scrollLeft = scrollLeft;
    element.scrollTop  = scrollTop;
}

this._contentFrameStyle.setMany({ width: width + "px", height: height + "px" });
return this;
```

Note: NO `overflow: hidden` on the frame (unlike the clip frame) — the frame is meant to be larger than the container so the host scrolls it. The frame has no id and no listeners, so subtree event delegation (which keys off element ids while walking ancestors) routes through it unaffected — same property the clip frame relies on.

### `clearContentFrame` body shape (mirrors `clearClipFrame` at [Component.ts:654](../src/typescript/lib/core/Component.ts#L654))

```
const frame = this._contentFrame;
if (!frame) return this;                   // no-op on the fit path (call unconditionally)

const element = this.getElement();
if (element) {
    const scrollLeft = element.scrollLeft;
    const scrollTop  = element.scrollTop;

    for (const child of this._components) {
        const node = child.getAttachNode();
        if (node) element.appendChild(node);  // back onto the element, after the frame's old slot
    }

    element.scrollLeft = scrollLeft;          // 0 once content fits, but harmless
    element.scrollTop  = scrollTop;
}

this._contentFrameStyle = this.disposeFrame(frame);  // frame.remove() + fresh buffer
this._contentFrame = null;
return this;
```

### Shared drive: `LayoutManager.reserveContentFrame()` (measure committed children)

Rather than each box layout recomputing the children's extent per-mode (preferred vs equal, weight cells, baseline) — which is fragile — the drive is a single shared `protected` helper on `LayoutManager` that runs AFTER the placement loop and measures each child's already-committed bounds (`getX`/`getY`/`getWidth`/`getHeight`). This works because the frame parks at the padding-box origin `(0,0)`: a child's coordinates are identical whether it sits in the frame or directly under the element, so wrapping the children **after** they are positioned never moves them. The chicken-and-egg of "frame must exist before placement" therefore dissolves — placement runs first, the helper wraps afterward.

```
protected reserveContentFrame(): this {
    const container = this.getContainer();
    if (!container) return this;

    const inner      = container.getInnerSize();
    const components = container.getComponents();
    if (!inner || components.length === 0) { container.clearContentFrame(); return this; }

    const insets = container.getContentInsets();
    let farRight  = insets.getLeft();
    let farBottom = insets.getTop();
    for (const c of components) {
        farRight  = Math.max(farRight,  c.getX() + c.getWidth());
        farBottom = Math.max(farBottom, c.getY() + c.getHeight());
    }

    const overflowX = this.isOverflowingX() && farRight  - insets.getLeft() > inner.width;
    const overflowY = this.isOverflowingY() && farBottom - insets.getTop()  > inner.height;

    if (overflowX || overflowY) {
        container.setContentFrame(farRight + insets.getRight(), farBottom + insets.getBottom());
    } else {
        container.clearContentFrame();
    }
    return this;
}
```

`farRight`/`farBottom` already include the leading inset (children are placed from `getContentInsets`), so `+ insets.getRight()`/`+ insets.getBottom()` reserves the trailing inset symmetrically. On the non-overflow axis the term lands at or inside the client edge (a zero/within-bounds frame extent), so it never spawns a spurious scrollbar.

### Box layouts keep their spill branch and just call the helper

The existing universal-scroll spill branch in `HBox`/`VBox` is **kept unchanged** — it still computes `containerSize` for placement, so child sizing/positioning under overflow is byte-identical to before (lowest-risk). The content frame is purely additive: after placement, the children (which the spill logic let overflow) are wrapped in a frame sized to their measured extent + trailing inset, and the host scrolls the frame instead of the loose children. Each box layout adds one line — `this.reserveContentFrame();` — at the end of every placement branch:

- `HBox.doLayout`: before the equal+stretching `return` ([HBox.ts:467](../src/typescript/lib/layout/HBox.ts#L467)), before the equal non-stretching `return` ([HBox.ts:516](../src/typescript/lib/layout/HBox.ts#L516)), and at the preferred-mode tail. Three call sites.
- `VBox.doLayout`: before the equal `return` ([VBox.ts:450](../src/typescript/lib/layout/VBox.ts#L450)) and at the preferred-mode tail. Two call sites.

Non-adopting managers (`Card`/`Accordion`/`Split`/`Grid`) simply never call `reserveContentFrame`, so they are untouched.

---

## Ordered Implementation Steps

1. **`Component.ts` — fields.** Add `private _contentFrame: HTMLElement | null = null;` and `private _contentFrameStyle: InlineStyle = new InlineStyle();` next to `_clipFrame`/`_clipFrameStyle` ([Component.ts:252](../src/typescript/lib/core/Component.ts#L252)), with the same "runtime-only, off the options bag" comment.
2. **`Component.ts` — shared frame primitive + clip refactor.** Add `private createFrame(style, base)` and `private disposeFrame(frame)` per _Shared frame helpers_. Then refactor `setClipFrame` ([Component.ts:607](../src/typescript/lib/core/Component.ts#L607)) and `clearClipFrame` ([Component.ts:654](../src/typescript/lib/core/Component.ts#L654)) to route creation/teardown through them (clip passes `{ overflow: "hidden" }`; teardown assigns `this._clipFrameStyle = this.disposeFrame(frame)`). Public signatures and observable behaviour stay identical — this is a pure internal de-duplication, and its only risk is the `Grid` clip path, which step 11 re-verifies.
3. **`Component.ts` — widen `getAttachNode` to `protected`** ([Component.ts:687](../src/typescript/lib/core/Component.ts#L687)) so a container can move a child by its outermost node. Keep its body and JSDoc; update the access modifier only.
4. **`Component.ts` — `getChildHost()`.** Add `private getChildHost(): HTMLElement | null | undefined { return this._contentFrame ?? this.getElement(); }` with JSDoc, placed near `getAttachNode`.
5. **`Component.ts` — `setContentFrame`/`clearContentFrame`.** Add both public methods after `clearClipFrame` ([Component.ts:675](../src/typescript/lib/core/Component.ts#L675)), bodies per _Internal Structure_ (built on `createFrame`/`disposeFrame`), full JSDoc with `@category` inherited from the class. No `overflow:hidden`; preserve `scrollLeft`/`scrollTop`; move outermost nodes. The frame carries no id and no listeners.
6. **`Component.ts` — route appends through `getChildHost`.** In `addComponent` change `element.appendChild(compElement)` ([Component.ts:3313](../src/typescript/lib/core/Component.ts#L3313)) to `(this.getChildHost() ?? element).appendChild(compElement)`. In `insertComponent` change the `element.insertBefore(...)` target ([Component.ts:3366](../src/typescript/lib/core/Component.ts#L3366)) likewise to the child host. Verify `removeComponent`/`removeAllComponents` need no change (they call `component.removeElement()` which uses `element.remove()`, parent-agnostic — confirmed at [Component.ts:569](../src/typescript/lib/core/Component.ts#L569)).
7. **`Component.ts` — teardown on element removal.** In `removeElement` ([Component.ts:569](../src/typescript/lib/core/Component.ts#L569)) it already calls `clearClipFrame()`; add `clearContentFrame()` alongside so a removed container doesn't orphan its frame.
8. **`LayoutManager.ts` — shared `reserveContentFrame()` helper.** Add the `protected reserveContentFrame(): this` per _Shared drive_ (after `setOverflowing`): it reads each child's committed `getX`/`getY`/`getWidth`/`getHeight`, decides per-axis overflow against `getInnerSize`, and calls `container.setContentFrame(...)` / `clearContentFrame()`. Lives on the base so both box layouts share it; non-adopting managers never call it.
9. **`HBox.ts` / `VBox.ts` — call the helper.** Leave each manager's spill branch **unchanged** (placement stays byte-identical). Add `this.reserveContentFrame();` at the end of every placement branch: HBox before the equal+stretching `return` ([HBox.ts:467](../src/typescript/lib/layout/HBox.ts#L467)), before the equal non-stretching `return` ([HBox.ts:516](../src/typescript/lib/layout/HBox.ts#L516)), and at the preferred tail; VBox before the equal `return` ([VBox.ts:450](../src/typescript/lib/layout/VBox.ts#L450)) and at the preferred tail. The helper runs AFTER placement, relying on the frame's `(0,0)` origin so wrapping doesn't move already-positioned children.
10. **Event-delegation / direct-child audit (BLOCKING — do before declaring done).** With the frame interposing a level, audit for code that assumes a component's element is a *direct* DOM child of its container element: `grep -rn "parentElement\|parentNode\|\.children\b\|childNodes\|:scope >" src/typescript/lib/core/Event.ts src/typescript/lib/core/Component.ts src/typescript/lib/layout/`. For each hit, confirm it does not break when the child is a grandchild (under the frame). Read the subtree-listener matcher in [Event.ts](../src/typescript/lib/core/Event.ts) and confirm it walks the FULL ancestor chain by id (so the id-less frame is skipped, not treated as a boundary) and any drag/drop or hit-test target resolution tolerates the extra hop. Listeners must be preserved by node *move* (never clone/rebuild a child element when entering/leaving the frame).
11. **Regression checkpoint — spill kept, frame additive.** The spill branch in `HBox`/`VBox` is intentionally retained (placement unchanged); the content frame is layered on top via `reserveContentFrame`. `grep -n "reserveContentFrame" src/typescript/lib/layout/*.ts` — expect 1 definition in `LayoutManager.ts`, 3 calls in `HBox.ts`, 2 calls in `VBox.ts`. `grep -n "containerSize = {" src/typescript/lib/layout/Card.ts src/typescript/lib/layout/Accordion.ts src/typescript/lib/layout/Split.ts` — non-adopters untouched.
12. **`npm run typecheck`** — expect clean.
13. **Manual verification** per `## Verification` — including the Grid clip-frame non-regression (step 2's refactor) and the event-delegation exercises (step 10).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` |
| Modify | `src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `src/typescript/lib/layout/HBox.ts` |
| Modify | `src/typescript/lib/layout/VBox.ts` |

No files created or deleted. (Demo sources `RowPanel.ts`, `ColumnPanel.ts`, `HBoxPanel.ts`, `VBoxPanel.ts` under `src/typescript/` are used for verification only, not edited.)

---

## Verification

- **Typecheck:** `npm run typecheck` clean.
- **Demo:** `npm run dev` → http://localhost:8015. Inspect the Row, Column, HBox, VBox tabs (sources `RowPanel.ts` / `ColumnPanel.ts` / `HBoxPanel.ts` / `VBoxPanel.ts`); all overflow at the default viewport because the List's min-height forces it.
- **Primary invariant (Chrome DevTools, per overflowing panel):** the gap between the last child's far edge and the scroll extent on the overflow axis equals the trailing inset (4px), matching the leading inset. Pre-fix it is 0.
  - VBox/Row: `el.scrollHeight - (lastChild.offsetTop + lastChild.offsetHeight) === 4`.
  - HBox/Column: `el.scrollWidth - (lastChild.offsetLeft + lastChild.offsetWidth) === 4`.
  - Leading still reserved: `firstChild.offsetTop === 4` (VBox/Row) / `offsetLeft === 4` (HBox/Column).
- **Deterministic extent:** the host scroll extent equals the frame size, i.e. `el.firstElementChild` is the frame and `frame.offsetWidth/offsetHeight === el.scrollWidth/scrollHeight`; the page still scrolls.
- **Fit case:** resize the viewport large so the panel fits — `clearContentFrame` fires, no wrapper div under the container element, no scrollbar, child geometry identical to pre-fix (`firstChild.offsetTop === 4`, last child bottom == content box minus trailing inset).
- **Scroll preservation:** slowly drag-resize across the fit↔overflow threshold; the panel's `scrollTop` is preserved across the transition (no jump to 0 on frame create/destroy).
- **Focus preservation:** focus an input among the children, cross the threshold; focus is retained (node move, not clone).
- **Event delegation under the frame (must test in the frame-active state):** on each overflowing panel, click and hover every interactive child (button, checkbox, combobox, list rows, slider, text field) and confirm its handler fires; tab/keyboard into an input and confirm key events work; exercise any drag affordance. Then resize so the panel fits (frame cleared) and repeat — handler behaviour MUST be identical with and without the frame. This is the regression that a layout-only smoke test would miss.
- **Listener preservation across re-parent:** attach is by node move, so a handler bound before the first overflow must still fire after the frame is created, and again after it is torn down on a later fit. Verify a child whose handler was wired at construction still responds in both states.
- **Grid clip-frame non-regression:** the Grid demo still clips oversized cells. This now also guards step 2's refactor — `setClipFrame`/`clearClipFrame` were rerouted through the shared `createFrame`/`disposeFrame`, so confirm clipping, re-layout on resize, and `clearClipFrame` on the non-clipped path all still work. Container frame + child clip frame nest correctly if exercised.
- **Theme toggle:** toggle light/dark on an overflowing panel — no regression (frame is transparent, no theme tokens).
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning), confirming the two new public methods render in the generated `Component` page.

---

## Documentation Impact

`setContentFrame`/`clearContentFrame` are new **public** `Component` methods, parallel to the public `setClipFrame`/`clearClipFrame`. Per `_shared/docs-conventions.md`:

- `Component` is already exported from the `core` barrel; no new barrel entry. The two methods auto-render into the generated `docs/api/core/classes/Component.md` from their JSDoc — give each a full JSDoc block (description, `@param`, `@returns`, `@remarks`); `@category` is inherited from the class (Core), so no per-method `@category` is needed (matches `setClipFrame`).
- No new curated page or sidebar entry — this is a mechanism on an existing class, not a new class/layout. If `docs/concepts/layout-system.md` or `docs/concepts/sizing.md` describes how overflow scrolling reserves space (the old "children spill past the inner rect" model), update that prose to the content-frame model; otherwise no concept-page change. Verify during implementation.
- JSDoc cross-bucket references: the new methods reference only same-bucket symbols (`setClipFrame`, `getInnerSize`, `getContentInsets`), so `{@link …}` is correct; no `[`Foo`](/api/…)` form needed.
- Run `npm run docs:build` and confirm 0 errors / 0 link warnings.

---

## Potential Challenges

- **Inset double-counting in the extent math** — `getInnerSize` already subtracts both perimeter bands (insets + border + padding) while `getContentInsets` returns insets + padding (border excluded); derive `contentW/contentH` so each inset is added exactly once. Mitigation: compute `childrenExtent` from the same per-mode formula the placement loop uses, then add `getContentInsets` on both sides; never mix in `getInnerSize` for the extent.
- **Frame must exist before placement** — child `left`/`top` resolve against the frame's containing block. Mitigation: hoist `setContentFrame`/`clearContentFrame` above the equal/preferred branches and both early returns.
- **Thrash near the fit↔overflow boundary** — mitigated by keep-once-created-resize (only `clearContentFrame` on a genuine fit), avoiding N-element re-parents per drag frame.
- **`Panel._scrollbarGutter` measurement** — `measureScrollbarGutter` ([Panel.ts:295](../src/typescript/lib/core/Panel.ts#L295)) reads `el.scrollHeight > el.clientHeight` on the container element. With the oversized frame inside, `scrollHeight` reflects the frame's box, so the comparison still detects overflow correctly. Mitigation: verify in the demo that the scrollbar gutter still reserves space (the gutter cascade still fires) — no code change expected, but called out as a verification item.
- **Event delegation across the interposed level** — the frame becomes a new ancestor in every child's bubble/capture path and changes each child's `parentNode`. Mitigation: keep the frame id-less and listener-free so the id-walk delegation skips it (validated by the existing clip frame), move (never clone) nodes so listeners survive, and run the step 10 audit for any `parentElement === containerEl` / `containerEl.children` / `:scope >` direct-child assumptions. This is the highest-risk part of the change precisely because it only manifests in the overflow state.
- **Deferred-DOM / super-cascade trap** — `_contentFrame`/`_contentFrameStyle` are plain field initializers like `_clipFrame`/`_clipFrameStyle` (assigned at declaration, not written by a cascade-time setter), so they need neither `declare` nor a constructor-body assignment; `setContentFrame` uses `getElement()` with NO force-create arg and no-ops when detached, exactly like `setClipFrame`.
- **`InlineStyle` re-attach after teardown** — `clearContentFrame` replaces `_contentFrameStyle` with a fresh `InlineStyle` (the old buffer was attached to the removed frame), matching `clearClipFrame`'s `_clipFrameStyle = new InlineStyle()` at [Component.ts:672](../src/typescript/lib/core/Component.ts#L672).

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `setClipFrame`/`clearClipFrame` (L607/L654) to mirror, `getAttachNode` (L687) to widen, `addComponent`/`insertComponent` (L3287/L3332) to route, `removeElement` (L569) for teardown, `getContentInsets` (L1196)/`getInnerSize` (L1931)/`getPerimiterSize` (L2046) for the extent math, runtime-state field comment (L245).
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) — `doLayout` (L397), spill branch (L417), `computeTotalMinSize` (L342), equal-mode early returns (L467/L516).
- [`src/typescript/lib/layout/VBox.ts`](../src/typescript/lib/layout/VBox.ts) — `doLayout` (L386), spill branch (L405), `computeTotalMinSize` (L331), equal-mode early return (L450).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `setOverflowing`/`isOverflowingX/Y` (L122–L157), `commitBounds`/`placeComponent` (L338).
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — the subtree-listener delegation that walks the ancestor chain by id; read before adopting the frame to confirm the id-less frame is skipped (not treated as a boundary) and that the step 10 audit has no direct-child assumptions to fix.
- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — clip-frame drive (L792–L802), the precedent pattern.
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — `getInnerSize` gutter subtraction (L237), `measureScrollbarGutter` (L295), `setAutoScroll`→`setOverflowing` forwarding (L150–L186).

---

## Non-Goals

- **`Card`/`Accordion`/`Split`/`Grid` adoption** — deferred to a follow-up. They keep their existing spill branches ([Card.ts:301](../src/typescript/lib/layout/Card.ts#L301), [Accordion.ts:553](../src/typescript/lib/layout/Accordion.ts#L553), [Split.ts:284](../src/typescript/lib/layout/Split.ts#L284)). The transitional mix of spill-based (those four) and frame-based (`HBox`/`VBox`) managers is intentional; the new Component API is additive and does not break the non-adopting managers. Reason: regression risk — `Split` gutters, `Accordion` headers, and `Card` single-child swapping each interact with overflow differently and warrant their own validation.
- **Removing `computeTotalMinSize` / `setOverflowing` / `isOverflowing`** — still used by the non-adopting managers and (for `computeTotalMinSize`) reused by the adopters to compute children extent; not dead, do not delete.
- **A theme token or CSS class for the frame** — the frame is a transparent geometric box with inline styles only; no token, no class, no `Theme.ts` change.
- **Configurable / declarative content-frame opt-in** — there is no `ComponentOptions.contentFrame`; the frame is purely layout-driven runtime state, mirroring the clip frame.
