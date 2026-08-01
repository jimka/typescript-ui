# Bordered Component Content-Box Layout — Implementation Plan

## Overview

A component that overrides `doLayout` to place its own children is supposed to place them inside its **content box**. Eleven such methods place children against the component's **border box** instead, so a child overflows by the border width and the component's `overflow: hidden` clips it. On the demo app's BindingPanel (`#/binding`) that is visible today on `AutoCompleteField`, `DateField`, `TimeField`, `DateTimeField` and `SelectableListRow` — ten instances, each overflowing by exactly its border.

What the user sees is a clipped picker glyph: a `TimeField`'s clock icon fills its button edge to edge, the button overhangs the field's content box by the 1px border, and the field clips it.

The framework already has a documented rule. A child's containing block is its parent's *padding box*, so a layout manager sizes children to [`getInnerSize()`](packages/lib/src/typescript/lib/core/Component.ts#L2921) and offsets their origin by [`getContentInsets()`](packages/lib/src/typescript/lib/core/Component.ts#L2004) — inset plus padding, border excluded. [`Fit.doLayout`](packages/lib/src/typescript/lib/layout/Fit.ts#L232) is the canonical implementation and `docs/concepts/sizing.md:106` is the written rule. Eleven hand-written `doLayout` methods, spread over nine source files, ignore it.

**Every one of the eleven is in scope, including the ones that look harmless today.** This library ships compiled to third parties who never run its test suite. A component that lays children out against its border box but happens to carry no border under *this* repo's theme is not harmless — it breaks the moment a consumer themes a border onto it, in their build, with nothing on their side to catch it.

This plan adds one accessor for the content rectangle, routes all eleven methods through it, fixes the three size-report bugs that would otherwise re-create the overflow through a child's own min-size clamp, and pins the whole class of defect with offline tests that cannot pass on unfixed code.

---

## Architecture Decisions

### There are two causes, not one

**Cause 1 — the child area is computed from the border box.** Eleven `doLayout` overrides read `this.getWidth()` / `this.getHeight()` (or, in one case, a fixed height constant) and place children from `(0, 0)`. The border is never subtracted. The full list is in `## The eleven call sites`.

**Cause 2 — the border is invisible to the framework's box math.** `SelectableListRow`'s 1px separator is painted by the shared `.SelectableListRow` class rule ([AbstractSelectableList.ts:222](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L222)). [`Component.getBorderSize`](packages/lib/src/typescript/lib/core/Component.ts#L2950) returns zeros whenever the private `_border` field is unset, so the row's otherwise-correct `doLayout` computes a 22px content box for a 21px one.[^row-measurement]

### One accessor for the child rectangle: `Component.getContentBounds()`

Add a public `getContentBounds()` returning `{ x, y, width, height }` — origin from `getContentInsets()`, size from `getInnerSize()`. Every one of the eleven methods calls it instead of assembling the pair by hand.[^why-accessor]

### A border shrinks the content box; it never moves the origin

This is the rule the accessor encodes, and it is also the test oracle and the blast-radius bound. The origin comes from `getContentInsets()`, which excludes the border, because the child's containing block already starts inside the border. Only the size shrinks.

| component state | `getContentBounds()` at outer box `W × H` |
|---|---|
| no border, no insets, no padding | `{ 0, 0, W, H }` |
| 2px border, no insets, no padding | `{ 0, 0, W - 4, H - 4 }` |
| 2px border, 3px padding, no insets | `{ 3, 3, W - 10, H - 10 }` |

Two consequences the plan leans on:

1. **Zero border is an exact no-op.** Seven of the eleven sites — numbers 4 to 10 in `## The eleven call sites` — have no insets and no padding of their own (measured), so routing them through the accessor cannot move a single pixel while their border is zero.
2. **Laying out at `W × H` with a `b`-px border must produce the same child rectangles as laying out at `(W - 2b) × (H - 2b)` with no border.** That equivalence is the regression guard.[^equivalence-oracle]

### A border the layout must account for is declared through `setBorder`

`SelectableListRow`'s separator moves out of the shared class rule and into a `setBorder({ borderBottom: … })` call in the row constructor. `getBorderSize()` is left as it is.[^no-getbordersize-change]

The rule this establishes, and the one the verification step greps for: **a `border` / `border<Side>` property in a module-level `StyleRule` bag is only allowed on a pseudo-element selector**, where it paints no box for the framework to measure. `.List:focus::after` ([AbstractSelectableList.ts:201](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L201)) is the legitimate shape.

### A component that measures its own content reports that content plus its own perimeter

Sizing a child to the content box is not enough on its own: `Component.setWidth` / `setHeight` clamp to the child's own minimum, so a component that reports a size too small for its content gets the overflow straight back through the clamp. [`Fit.computeSize`](packages/lib/src/typescript/lib/layout/Fit.ts#L117) is the precedent: child size plus container perimeter.

Three sites need it, and only three — the ones whose content is measured text that must not be squeezed:

- **`AutoCompleteField`** mirrors its inner `TextField`'s sizes verbatim and never adds its own 1px border.
- **`TextField`** caches its one-line box height at construction and never recomputes it when its border changes, so the inner field of an `AutoCompleteField` keeps claiming a height that includes a border it no longer has.
- **`Tooltip.show`** sizes the tooltip to `widestLine + H_PADDING`, which leaves the text 2px short once the 1px border is honoured — the last word could wrap.

The `AutoCompleteField` pair leaves its reported height unchanged at a bare `TextField`'s height:[^autocomplete-pair]

| | inner `TextField` reports | `AutoCompleteField` reports |
|---|---|---|
| today | 24 (stale — includes a border it no longer has) | 24 (mirrored; own border ignored) |
| after | 22 | 24 (= 22 + own 2px border) |

Everywhere else, a component whose outer box is a fixed constant keeps that constant and simply gives its children the smaller content box. That is what a border-box border means, and re-deriving every fixed outer size from its border is a much larger change than this plan.[^no-size-report-elsewhere]

### `overflow` is not touched anywhere

`overflow: hidden` is the framework's deliberate diagnostic for exactly this defect. No component's overflow, and no `<svg>`'s overflow, changes in this plan. The fix is to stop the children overflowing.

---

## The eleven call sites

`insets` / `padding` are the component's own, read from a live instance under the offline harness. `border` is what `getBorderSize()` resolves to today.

| # | Method | Own insets / padding | Border today | Status today |
|---|---|---|---|---|
| 1 | `AbstractPickerField.doLayout` ([AbstractPickerField.ts:208](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L208)) | padding 3 all round | 1px all round | **clips** — covers `DateField`, `TimeField`, `DateTimeField` |
| 2 | `AutoCompleteField.doLayout` ([AutoCompleteField.ts:231](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L231)) | none | 1px all round | **clips** |
| 3 | `ComboBox.doLayout` ([ComboBox.ts:749](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L749)) | insets 3 / 6 | 1px all round | reads `getInsets()` where the contract says `getContentInsets()`[^combobox-note] |
| 4 | `ComboBoxLabel.doLayout` ([ComboBox.ts:491](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L491)) | none | none | hands its own border box to `layoutChildren` |
| 5 | `DialogTitleBar.doLayout` ([Dialog.ts:334](packages/lib/src/typescript/lib/overlay/Dialog.ts#L334)) | none | declares `borderBottom: 1px solid var(--ts-ui-dialog-border)` | latent[^dialog-border] |
| 6 | `DialogButtonRow.doLayout` ([Dialog.ts:436](packages/lib/src/typescript/lib/overlay/Dialog.ts#L436)) | none | declares `borderTop: 1px solid var(--ts-ui-dialog-border)` | latent[^dialog-border] |
| 7 | `Tooltip.doLayout` ([Tooltip.ts:619](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L619)) | none | 1px all round — the declaration carries a literal fallback, so it resolves under any theme | 1px asymmetry, no clip[^unmeasured] |
| 8 | `DragGhost.doLayout` ([DragGhost.ts:119](packages/lib/src/typescript/lib/overlay/DragGhost.ts#L119)) | none | `1px solid var(--ts-ui-drag-ghost-border)`, no literal fallback | latent[^unmeasured] |
| 9 | `MenuItem.doLayout` ([MenuItem.ts:469](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L469)) | none | none | latent[^unmeasured] |
| 10 | `TreeCellRenderer.doLayout` ([TreeCell.ts:238](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L238)) | none (zeroed in the constructor) | none | latent[^unmeasured] |
| 11 | `SelectableListRow.doLayout` ([AbstractSelectableList.ts:528](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L528)) | padding 8 left / right | 1px bottom, invisible to `getBorderSize()` | **clips** (cause 2) |

Sites 4 – 10 have neither insets nor padding, so for them the fix is a pure border subtraction and a no-op at zero border.

---

## Public API

```typescript
class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {
    /** The rectangle this component's children are laid out into. */
    getContentBounds(): { x: number; y: number; width: number; height: number } | null;
}
```

Returns `null` when the component has no element yet, mirroring `getInnerSize()` so existing `if (!inner) return this;` guards keep their shape.

---

## Implementation

`Component.getContentBounds`, placed directly after `getInnerSize` ([Component.ts:2936](packages/lib/src/typescript/lib/core/Component.ts#L2936)):

```typescript
getContentBounds(): { x: number; y: number; width: number; height: number } | null {
    const inner = this.getInnerSize();

    if (!inner) {
        return null;
    }

    const contentInsets = this.getContentInsets();

    return {
        x:      contentInsets.getLeft(),
        y:      contentInsets.getTop(),
        width:  inner.width,
        height: inner.height,
    };
}
```

### The mechanical transform

Every one of the eleven methods gets the same treatment:

1. Take `const box = this.getContentBounds();` at the top of the body, after the existing `super.doLayout()` call.
2. Return early (`if (!box) { return this; }`) — **except** in `TreeCellRenderer.doLayout`, which calls `super.doLayout()` *last*; an early return there would skip it. That one method uses `const box = this.getContentBounds() ?? { x: 0, y: 0, width: 0, height: 0 };` instead, preserving today's `getWidth() || 0` fallback behaviour.
3. Replace every `this.getWidth()` with `box.width` and every `this.getHeight()` with `box.height`.
4. Add `box.x` to every child `setX(…)` argument and `box.y` to every child `setY(…)`.
5. Leave the component's own constants (`PICKER_BUTTON_WIDTH_PX`, `TITLE_H_PAD`, `LABEL_INSET`, `TOGGLE_WIDTH`, …) exactly as they are — they are offsets *within* the content box.

Three sites need more than the mechanical transform:

- **`MenuItem.doLayout`** uses a constant, `const H = MenuItem.HEIGHT;`, for every child height instead of reading its own height. Replace `H` with `box.height` throughout the body, including the icon-centring expression `Math.floor((H - size.height) / 2)`. With no border and the `Menu`'s `VBox` handing each item its 24px preferred height, `box.height` is 24 — the same number `H` is today. Leave the construction-time `centerInHeight(MenuItem.HEIGHT)` calls alone.[^menuitem-center]
- **`ComboBox.doLayout`** already reads `getInnerSize()`; replace the `const insets = this.getInsets()` read and the `innerLeft` / `innerTop` locals with `box.x` / `box.y`, and `inner.width` / `inner.height` with `box.width` / `box.height`.
- **`Tooltip`** needs its `show()` sizing updated alongside its `doLayout` — see below.

### `AbstractPickerField.doLayout`

```typescript
doLayout(): this {
    super.doLayout();

    const box = this.getContentBounds();

    if (!box) {
        return this;
    }

    const inputWidth = Math.max(0, box.width - PICKER_BUTTON_WIDTH_PX);

    this._input.setX(box.x);
    this._input.setY(box.y);
    this._input.setWidth(inputWidth);
    this._input.setHeight(box.height);

    this._button.setX(box.x + inputWidth);
    this._button.setY(box.y);
    this._button.setWidth(PICKER_BUTTON_WIDTH_PX);
    this._button.setHeight(box.height);

    // Keep the existing trailing `this._button.doLayout()` and its comment.
    this._button.doLayout();

    return this;
}
```

### `AutoCompleteField.syncSizeFromTextField`

`saturate` comes from `~/primitive/Size.js`:

```typescript
private syncSizeFromTextField(): void {
    const perimeter  = this.getPerimeterSize();
    const horizontal = perimeter.left + perimeter.right;
    const vertical   = perimeter.top  + perimeter.bottom;

    const pref = this._textField.getPreferredSize();
    const max  = this._textField.getMaxSize();
    const min  = this._textField.getMinSize();

    if (pref) {
        this.setPreferredSize({ width: pref.width + horizontal, height: pref.height + vertical });
    }

    if (max) {
        this.setMaxSize({ width: saturate(max.width + horizontal), height: saturate(max.height + vertical) });
    }

    if (min) {
        // Min width stays mirrored: the inner field pins min-width 0 on purpose
        // so the composite stays horizontally flexible.
        this.setMinSize({ width: min.width, height: min.height + vertical });
    }
}
```

### `TextField.setBorder`

```typescript
setBorder(options: BorderOptions | string): this {
    super.setBorder(options);
    this.updateHeight();

    return this;
}
```

### `Tooltip.show` sizing

Inside `show()` ([Tooltip.ts:202](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L202)), read the instance's own perimeter once and add it to the outer box, so the text still gets `widestLine` pixels inside the border:

```typescript
const perimeter = inst.getPerimeterSize();
const chromeW   = perimeter.left + perimeter.right;
const chromeH   = perimeter.top  + perimeter.bottom;
```

- `tooltipWidth` becomes `Math.min(Tooltip.MAX_WIDTH, widestLine + Tooltip.H_PADDING + chromeW)` — `MAX_WIDTH` stays an *outer* cap.
- the wrap test becomes `widestLine + Tooltip.H_PADDING + chromeW > Tooltip.MAX_WIDTH`, and `availTextWidth` becomes `tooltipWidth - Tooltip.H_PADDING - chromeW`.
- `tooltipHeight` gains `+ chromeH`, added after the single-line `ITEM_HEIGHT` floor so the floor keeps meaning "one line of text".

---

## Ordered Implementation Steps

1. **Add `getContentBounds()`** to `packages/lib/src/typescript/lib/core/Component.ts` after `getInnerSize` (body above). JSDoc it: what the rectangle is, that the origin excludes the border because the containing block is the padding box, and that it returns `null` before the element exists. Link only `{@link getInnerSize}` / `{@link getContentInsets}` (both public). This step adds no behaviour — it goes first only so the tests in step 2 compile.
2. **Write the failing tests** in a new file `packages/lib/tests/component/content-box-containment.test.ts`, per `## Test design` and `## Expected Behaviour`. Expect red on the bordered cases and green on the zero-border cases.
3. **Fix `AbstractPickerField.doLayout`** (body above). Update its JSDoc, which currently says the input is laid out "flush left" and the button "flush right" — both are now relative to the content box.
4. **Fix `AutoCompleteField.doLayout`** by the mechanical transform. Update the two JSDoc blocks that assert the child sits at `(0, 0)` filling the component — `doLayout`'s summary and `getBaseline`'s `@remarks`.
5. **Fix `AutoCompleteField.syncSizeFromTextField`** (body above); add the `saturate` import from `~/primitive/Size.js`. Leave the two call sites alone: the constructor already calls it after `_textField.setBorder("none")`, and the theme subscription already runs after the inner field's own (the child is constructed first, and theme listeners fire in registration order), so the mirrored numbers are current in both.
6. **Add the `TextField.setBorder` override** (body above); import `BorderOptions` from `~/primitive/Border.js`. The override fires during the `super()` cascade, because `_defaultTextInputOptions` carries a `border` — that is safe, and the constructor's own trailing `updateHeight()` re-runs with the final insets and padding anyway.
7. **Fix both `doLayout` methods in `ComboBox.ts`** — `ComboBoxLabel.doLayout` (line 491) by the mechanical transform, and `ComboBox.doLayout` (line 749) as described under *The mechanical transform*.
8. **Fix both `doLayout` methods in `Dialog.ts`** — `DialogTitleBar` (line 334) and `DialogButtonRow` (line 436), mechanical transform.
9. **Fix `Tooltip`** — `doLayout` (line 619) by the mechanical transform, plus the `show()` sizing above.
10. **Fix `DragGhost.doLayout`** (line 119), mechanical transform.
11. **Fix `MenuItem.doLayout`** (line 469), including the `H` → `box.height` substitution.
12. **Fix `TreeCellRenderer.doLayout`** (line 238) — mechanical transform with the **no early return** exception; `super.doLayout()` stays the last statement.
13. **Fix `SelectableListRow`**: delete the `borderBottom` entry from the `SelectableListRow` `StyleRule` bag ([AbstractSelectableList.ts:222](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L222)) and add to the row constructor:
    ```typescript
    // Declared through the typed setter rather than the shared class rule so
    // getBorderSize() sees the 1px the separator takes out of the row's content
    // box; a class-rule border is invisible to the framework's box math.
    this.setBorder({ borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)" });
    ```
    Then apply the mechanical transform to `SelectableListRow.doLayout` (line 528), replacing the `getPerimeterSize()` origin with `box.x` / `box.y` and passing `box.width, box.height` to `layoutChildren`. Update the two comments describing the separator as living in the class rule (the module styling doc block near line 168 and the class doc block near line 261).
14. **Green check:** `npx vitest run tests/component/content-box-containment.test.ts` from `packages/lib`.
15. **Regression check:** `npx vitest run` from `packages/lib` — the whole suite. Watch `tests/component/input/single-line-min-height.test.ts` (asserts `AutoCompleteField` min-height equals preferred height and min-width is 0 — both still hold) and the `Dialog`, `Menu`, `Tooltip`, `Tree` and table suites, which pin geometry on components this plan touches.
16. **Docs:** add `getContentBounds()` to the "Inner size vs outer size" section of `packages/lib/docs/concepts/sizing.md` (after the existing `getContentInsets()` sentence at line 106) as the one-call form of the pair, and state that a component overriding `doLayout` must lay children out inside it.
17. **Changelog:** in `packages/lib/docs/reference/changelog.md`, one entry in the `### Fixed` block under `## 0.4.0` (line 169) describing the clipped-child fix and naming the affected components, and one in that heading's `### Added` block for `Component.getContentBounds()`.
18. **Grep checks** (from the repo root, all expecting zero hits):
    - `grep -rn "getPerimeterSize()" packages/lib/src/typescript/lib/component/list/` — the row no longer uses the perimeter as an origin.
    - `grep -rn -A 18 "new StyleRule({" packages/lib/src/typescript/lib --include=*.ts | grep -E "border(Top|Right|Bottom|Left)?: " | grep -v borderRadius | grep -v "::after"` — no class-rule border on a real element box. `component/display/Markdown.ts` and `component/editor/editorTheme.ts` are expected hits and are **not** in scope: they style inner HTML content (`blockquote`, `table`, `pre`), not framework `Component` boxes.
    - For each of the eleven methods, confirm no `this.getWidth()` / `this.getHeight()` remains inside the `doLayout` body.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/DragGhost.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Create | `packages/lib/tests/component/content-box-containment.test.ts` |
| Modify | `packages/lib/docs/concepts/sizing.md` |
| Modify | `packages/lib/docs/reference/changelog.md` |

---

## Test design

Three harness requirements, all load-bearing:

- **`CONFIG.themeVars` must be `{ '--ts-ui-input-border': '1px solid rgb(200, 200, 200)' }`.** With the `{}` every other suite uses, `var(--ts-ui-input-border)` resolves to nothing, the input border measures 0, and the picker cases pass vacuously.
- **Components must stay detached** — `component.getElement(true)` and nothing else, as in [tests/component/layout/Fit.test.ts](packages/lib/tests/component/layout/Fit.test.ts). The modelled DOM source reports `0px` border widths for *connected* elements; the pre-attach estimate path is what resolves a border offline.
- **Every case opens with an assertion on `getBorderSize()`,** so a harness change can never silently disarm it.

Two shared helpers carry every case:

```typescript
/** Every child's rectangle lies inside the parent's content box. */
function expectChildrenInsideContentBox(parent: Component, children: Component[]): void

/**
 * Laying out at (w, h) with a `border`-px border produces exactly the child
 * rectangles that laying out at (w - 2*border, h - 2*border) with no border
 * produces. Builds two independent instances via `make`.
 */
function expectBorderOnlyShrinks(
    make: () => Component,
    childrenOf: (c: Component) => Component[],
    w: number,
    h: number,
    border: number,
): void
```

`expectBorderOnlyShrinks` is the guard, and it is what makes the latent cases non-vacuous. Use `border = 2`, with `setBorder("2px solid black")` on the bordered instance and `setBorder("none")` on the unbordered one — a literal `2px` needs no theme variable, and an even number keeps the halved centring arithmetic exact.

On unfixed code the bordered run sizes children to the full `w × h` while the unbordered run sizes them to `(w-4) × (h-4)`, so the two disagree and the case is **red**. After the fix both compute the same content box and the case is **green**. The unbordered run on its own is the byte-identical no-op proof: it produces the same numbers before and after the fix for every component with no insets and no padding (sites 4 – 10).

Roster — one case per entry, laid out at its preferred size where it has one:

| Component | How to build it | Children to check |
|---|---|---|
| `DateField`, `TimeField`, `DateTimeField` | `new X()` | `field.getComponents()` (input, button) |
| `AutoCompleteField` | `new AutoCompleteField()` | `field.getComponents()` |
| `ComboBox` | `new ComboBox()` | `combo.getComponents()` (label, caret) |
| `ComboBoxLabel` | `(combo as any)._label` | `[(label as any)._renderer]` |
| `DialogTitleBar` | `(new Dialog({ title: 'T', message: 'm', buttons: [{ text: 'OK', result: 'ok' }] }) as any)._titleBar`, size 300 × its preferred height (36) | `[_titleText, _closeButton]` |
| `DialogButtonRow` | the same dialog's `._buttonRow`, size 300 × its preferred height (52) | `(row as any)._buttons` |
| `Tooltip` | `Tooltip.show('hello', 10, 10)`, then `(Tooltip as any).instance` — the constructor is private | `[(inst as any)._text]` |
| `DragGhost` | `new DragGhost('drag me', 100, 30)` — a label argument is required or `_label` is null | `[(ghost as any)._label]` |
| `MenuItem` | `new MenuItem({ title: 'File', shortcut: 'Ctrl+F' }, () => {}, () => {})`, size 200 × 24 | `[_titleText, _shortcutText]`, skipping nulls |
| `TreeCellRenderer` | `new TreeCellRenderer(new StringRenderer())`, size 150 × 22 | `[(tc as any)._delegate]` |
| `SelectableListRow` | `new _List()` + `setItems([…])`, then `(list as any)._rowPool[0]` | `[(row as any)._renderer]` — the renderer is appended directly, so it is *not* in `getComponents()` |

Private-field access via `as any` follows [tests/component/list/renderer.test.ts](packages/lib/tests/component/list/renderer.test.ts), which already reaches `_rowPool[i]._renderer`.

---

## Expected Behaviour

Values below were read from live instances under the offline harness with the test font; the picker figures match the browser's (a `TimeField` reports a 140 × 24 preferred size in both). Every case is unit-testable unless marked.

**1 — Picker fields lay out inside the content box.** A `TimeField` sized 200 × 24 has insets 0, padding 3, border 1, so its content box is `(3, 3, 192, 16)`:

| child | x | y | width | height |
|---|---|---|---|---|
| `PickerInput` | 3 | 3 | 168 | 16 |
| `PickerButton` | 171 | 3 | 24 | 16 |

Today the same field produces `PickerInput (0, 0, 176, 24)` and `PickerButton (176, 0, 24, 24)` — a right edge of 200 against a 198px padding box.

**2 — The same holds for `DateField` (preferred width 160) and `DateTimeField` (preferred width 200)** at their preferred size: the input starts at the content-box origin and the button's right edge equals the content box's right edge.

**3 — `AutoCompleteField` fills its content box exactly.** At 200 × 24 (border 1, no insets, no padding) the inner `TextField` is `(0, 0, 198, 22)`.

**4 — `AutoCompleteField`'s reported height still equals a bare `TextField`'s.** `new AutoCompleteField().getPreferredSize()!.height === new TextField().getPreferredSize()!.height` (24 offline). Its min-height equals its preferred height; its min-width stays 0.

**5 — `TextField`'s one-line box tracks its border.** `new TextField()` reports preferred height `h`; after `setBorder("none")` it reports `h - 2`.

**6 — The list row reserves its separator.** In a `List` sized 200 × 100 with two items, row 0 reports `getBorderSize().bottom === 1`, its content box is `(8, 0, 182, 21)`, and its renderer is `(8, 0, 182, 21)` — one pixel shorter than the 22px row. The label's line height follows the height it is given, so the text stays centred.

**7 — `ComboBox` is unchanged at zero padding.** At 280 × 24 with its 1px border and insets 3 / 6, the label is `(6, 3, 246, 16)` and the caret `(258, 4, 14, 14)` — identical before and after, because `getContentInsets()` equals `getInsets()` while `ComboBox` declares no padding. Setting a padding on a `ComboBox` shifts both children by it; before the fix it did not.

**8 — Every routed component satisfies the shrink equivalence.** For each roster entry: children laid out at `(w, h)` with a 2px border are rectangle-for-rectangle identical to children laid out at `(w-4, h-4)` with no border. Three worked cases, all red on unfixed code:

| Component | child today | child after |
|---|---|---|
| `DragGhost` label, outer 100 × 30, 2px border | `(6, 6, 88, 18)` | `(6, 6, 84, 14)` |
| `MenuItem` title, outer 200 × 24, 2px border | height 24 | height 20 |
| `TreeCellRenderer` delegate, outer 150 × 22, 2px border | `(20, 0, 130, 22)` | `(20, 0, 126, 18)` |

**9 — Zero-border components are untouched.** For sites 4 – 10, which have no insets and no padding, the unbordered run produces the same child rectangles before and after the change. This is an assertion, not a claim: it is the second half of every `expectBorderOnlyShrinks` case.

**10 — A tooltip's text keeps its measured width.** After `Tooltip.show('hello', …)`, the text child is as wide as it is today; the tooltip's own outer box is 2px wider and 2px taller, absorbing its border. The text never has to wrap earlier than before.

**11 — Manual, in the user's own browser at 125% display scaling.** Run `npm run dev`, open `#/binding`. The `DateField` / `TimeField` / `DateTimeField` clock and calendar glyphs show no clipped right or bottom edge; the four fields still sit on a common row line; the list rows still show their separators and their labels are not clipped. This check must be done at 125% — at device-pixel-ratio 1.0 the one-pixel sliver can round away and a broken build looks fine.

**12 — Manual, the touched overlays and menus.** Open a dialog, a context menu, a tooltip, a tree table and a drag ghost in the demo app and confirm nothing moved. These carry no resolved border under the current theme, so the expected result is "no visible change at all" — any shift means the transform was applied wrongly.

**13 — Deliberate visual changes to confirm while you are there.** The picker fields' text and glyph button now sit 3px inside the border rather than flush against it, which is the 3px padding those fields already declare and matches how `ComboBox` insets its caret. The glyph button is the height of the content box instead of the full field.

---

## Verification

- `npm run build:lib` from the repo root — typecheck clean.
- `npx vitest run` from `packages/lib` — full suite green.
- `npx vitest run tests/component/content-box-containment.test.ts` — red at step 2, green after step 13.
- `npm run docs:api` from `packages/lib` — zero warnings (the new public method's JSDoc must not `{@link}` a private or protected symbol).
- The three greps in step 18.
- `grep -rn "overflow" packages/lib/src/typescript/lib/component/input/ packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts packages/lib/src/typescript/lib/overlay/` — unchanged from the base branch; this plan relaxes no clip.
- The manual passes in Expected Behaviour cases 11 – 13.

**Bounding the blast radius.** Eleven methods change, but only five components can move a pixel under the current theme: the three picker fields, `AutoCompleteField`, and `SelectableListRow` — each enumerated above with its before and after numbers. The rest are protected by two facts, both asserted rather than assumed: they have no insets and no padding (so `getContentBounds()` is exactly `{0, 0, width, height}` at zero border), and the unbordered half of every shrink-equivalence case pins their child rectangles to today's values. `Tooltip` is the one component that grows: 2px in each dimension, so its text keeps the width it measures.

---

## Documentation Impact

- `Component.getContentBounds()` is public, so TypeDoc picks it up from the existing `Component` page automatically; no barrel or sidebar change is needed.
- `packages/lib/docs/concepts/sizing.md` — the "Inner size vs outer size" section already states the padding-box rule; add the accessor as its one-call form and the instruction for `doLayout` overrides.
- `packages/lib/docs/reference/changelog.md` — `### Added` and `### Fixed` under `## 0.4.0`.
- No page references a renamed or removed symbol; nothing else to sweep.

---

## Potential Challenges

- **Offline borders are fragile.** The modelled DOM source returns `0px` from `getBorderWidths`, so a *connected* component measures no border at all; only the pre-attach estimate resolves a `var(...)` border, and only when `themeVars` supplies it. Mitigation: keep test components detached, prefer an explicit `setBorder("2px solid black")` in the guard, and assert the measured border in every case.
- **The offline estimate can be more optimistic than the browser.** `1px solid var(--undefined)` estimates to 1px offline (the leading `1px` parses) but computes to 0 in Chrome, because the invalid `var()` drops the whole declaration. The two `Dialog` bars are in exactly that state. Mitigation: the guard sets its own literal border rather than relying on the declared one, so each case measures what it intends to.
- **`TextField.setBorder` fires inside the `super()` cascade.** `updateHeight` reads insets, padding and border and writes only size hints, so an early call is harmless and the constructor's trailing `updateHeight()` overwrites it. Do not "optimise" that existing call away.
- **A min-size clamp can re-create an overflow.** A child whose minimum exceeds the content box is clamped back up and spills again — `DialogButtonRow`'s buttons have a 30px minimum, which fits its 52px row but not an arbitrarily squeezed one. Mitigation: lay each roster entry out at its preferred size, and treat a containment failure at preferred size as a genuine size-report bug to report, not to paper over.
- **A very narrow picker field still clips.** The button column is a fixed 24px while the field's min-width is 0, so a field squeezed below the column plus its chrome overflows. That is the documented behaviour for a component given less than it needs (ARCHITECTURE.md, size-constraint rule 7) and the min-width of 0 is pinned by an existing test.
- **`MenuItem`'s construction-time text centring stays border-blind.** `centerInHeight(MenuItem.HEIGHT)` runs in the constructor against the outer height; on a bordered item the optical centring is off by half the vertical border. It is an optical offset, not a clip, and correcting it needs a border-change hook like `TextField`'s. Out of scope, recorded here so it is not mistaken for a regression.

---

## Critical Files

- [packages/lib/src/typescript/lib/layout/Fit.ts:117](packages/lib/src/typescript/lib/layout/Fit.ts#L117) and [:208](packages/lib/src/typescript/lib/layout/Fit.ts#L208) — the precedent for both halves of this plan: child size plus container perimeter in `computeSize`, and `getInnerSize()` + `getContentInsets()` in `doLayout`.
- [packages/lib/src/typescript/lib/core/Component.ts:2921](packages/lib/src/typescript/lib/core/Component.ts#L2921) (`getInnerSize`), [:2950](packages/lib/src/typescript/lib/core/Component.ts#L2950) (`getBorderSize`), [:3036](packages/lib/src/typescript/lib/core/Component.ts#L3036) (`getPerimeterSize`), [:2004](packages/lib/src/typescript/lib/core/Component.ts#L2004) (`getContentInsets`).
- [packages/lib/docs/concepts/sizing.md:102](packages/lib/docs/concepts/sizing.md#L102) — the written contract this plan enforces.
- [packages/lib/src/typescript/lib/primitive/Size.ts:42](packages/lib/src/typescript/lib/primitive/Size.ts#L42) — `saturate`, for the max-size addition.
- The eleven methods listed in `## The eleven call sites` — read each body before transforming it; four are not a straight substitution (`MenuItem`, `ComboBox`, `Tooltip`, `TreeCellRenderer` — see the exceptions under *The mechanical transform*).
- [packages/lib/tests/component/layout/Fit.test.ts](packages/lib/tests/component/layout/Fit.test.ts) and [packages/lib/tests/component/input/single-line-min-height.test.ts](packages/lib/tests/component/input/single-line-min-height.test.ts) — the harness shape and the cross-class roster shape for the new suite.

---

## Non-Goals

- **Making `getBorderSize()` see class-rule borders.** Rejected; see the footnote under *A border the layout must account for is declared through `setBorder`*.
- **Changing any layout manager.** `Fit`, `Card`, `Border`, `Grid`, `Split` and `Table` already compute the pair correctly. They keep calling `getInnerSize()` + `getContentInsets()`; converting them to `getContentBounds()` is churn with no behaviour change.
- **Re-deriving fixed outer sizes from the border.** A component whose outer height is a constant (`MenuItem.HEIGHT`, `BUTTON_HEIGHT`, `ROW_HEIGHT_PX`) keeps that constant; only its content box shrinks. The three text-measuring exceptions are named under *A component that measures its own content reports that content plus its own perimeter*.
- **`FieldSet`'s legend clearance.** `FieldSet` overrides `getPerimeterSize` to reserve the legend band, which `getContentInsets` does not know about. `FieldSet` lays out through a manager and is unaffected by this plan; leave it alone.
- **`Slider.doLayout` and `AbstractChart.doLayout`.** Neither uses the border box: `Slider` reads `getInnerSize()` with a bare `(0, 0)` origin, and `AbstractChart` reads `getInnerSize()` with a `getPerimeterSize()` origin. Both are insets-and-origin gaps rather than the border-box pattern this plan removes, and neither is on the eleven-site list.
- **A lint rule.** A rule banning `getWidth()` inside a `doLayout` override would misfire on the many legitimate uses (a component reading its own committed size). The shrink-equivalence guard carries the rule instead, and a twelfth occurrence of the pattern fails it as soon as the component joins the roster.
- **Relaxing `overflow` anywhere.**

---

## Notes

[^row-measurement]: Measured offline, with the row's border still in the class rule: `getBorderSize()` returns all zeros, `getInnerSize()` reports height 22 for a 22px row, and the renderer is laid out 22px tall. In the browser the same row has `clientHeight` 21 and `scrollHeight` 22.

[^why-accessor]: The pair is public and could simply be repeated at each site — but thirteen hand-written implementations exist in the framework and not one of them is written the way the layout managers write it. Nine read `getWidth()` / `getHeight()` at `(0, 0)`. Two use `getPerimeterSize()` as the origin, which double-counts the border on any side that has one (`SelectableListRow`, `AbstractChart`). One reads `getInnerSize()` with a bare `(0, 0)` origin (`Slider`). One reads `getInnerSize()` with `getInsets()` rather than `getContentInsets()` (`ComboBox`, correct only while it declares no padding). A rule that is re-derived at thirteen call sites and written correctly at none of them is a missing accessor. It also gives the guard test and the docs a single name for the rectangle. The accessor is public rather than protected because its other natural caller is a layout manager, which is not a subclass — matching `getInnerSize()` and `getContentInsets()`, which are public for the same reason.

[^equivalence-oracle]: The equivalence holds because the origin is border-independent: `getContentBounds().x` is `getContentInsets().getLeft()`, which counts insets and padding but not the border. So adding a border of `b` shrinks `width` and `height` by `2b` and leaves `x` and `y` alone — exactly what shrinking the outer box by `2b` does. It is a stronger oracle than containment, because it fails for a component that under-fills its content box as well as for one that overflows, and it needs no per-component expected numbers.

[^no-getbordersize-change]: Dropping `getBorderSize()`'s `if (!this._border) return zeros` fast path would make every class-rule and theme border visible to the box math at once, shrinking the inner rectangle of an unknown number of components framework-wide — the blast radius the plan is asked to bound. Worse, the offline harness cannot see it either way: `ModelledDOMSource.getBorderWidths` returns `0px`, and the pre-attach estimate reads `_border`, which is exactly the field the short-circuit tests. So the change would ship unverifiable geometry shifts. The narrow fix — declare the border through the typed setter, which ARCHITECTURE.md requires for every style write anyway — fixes the one real site, is visible offline, and leaves the fast path honest, because with `setBorder` the field is set.

[^autocomplete-pair]: The inner `TextField` is constructed with the themed 1px border and computes its one-line box height (24) in its constructor; `AutoCompleteField` then calls `setBorder("none")` on it, which never re-runs that computation. So the child keeps claiming 24 for a box that now needs 22, and the composite mirrors the stale 24 while ignoring its own 1px border. Fixing only the mirroring would make the field 26px tall — 2px taller than every other field in the row. Fixing only the staleness would make it 22px tall and re-create the overflow. The pair keeps it at 24 and makes both numbers honest.

[^no-size-report-elsewhere]: The three exceptions all measure text and then size a box around it, so shrinking the box by the border squeezes measured content and can wrap or ellipsize it. A `MenuItem` or a `DialogButtonRow`, by contrast, has an outer height chosen as a design constant; a consumer who themes a border onto one is choosing to spend 2px of that constant on the border, which is what a border-box border means everywhere else in CSS. Auditing every fixed outer size in the framework for border-awareness is separate work and would balloon this plan's blast radius for no present-day defect.

[^combobox-note]: `ComboBox` declares insets and no padding, so `getInsets()` and `getContentInsets()` return the same values and the routed version is numerically identical today — measured: label `(6, 3, 246, 16)`, caret `(258, 4, 14, 14)` at 280 × 24 both ways. The live sweep that prompted this widening measured the caret about 2px right of where the content box permits; the offline model puts it exactly on the content-box edge, so that residue is not reproduced here and is not what the routing fixes. What the routing does fix is the `getInsets()`-instead-of-`getContentInsets()` read, which breaks the moment a consumer sets a padding on a `ComboBox`, and `ComboBoxLabel` handing its own border box to `layoutChildren`.

[^dialog-border]: Both bars declare a 1px side border against `--ts-ui-dialog-border`, which no current theme defines and which carries no literal fallback — so Chrome drops the whole declaration and measures 0. The offline estimate parses the leading `1px` and reports 1 instead. Either way the children are placed against the border box, and the guard's own literal border is what the test measures.

[^menuitem-center]: `centerInHeight` runs once at construction and writes a text line-height; making it border-aware needs the same `setBorder` hook `TextField` gets in this plan. Adding that hook to `MenuItem` would change the rendered line-height of every menu item in a themed build for a half-pixel optical gain, which is not worth bundling into a fix about clipped children.

[^unmeasured]: "Latent" here means the pattern is present and no border resolves under this repo's current theme. For sites 8 – 10 that status comes from reading the code and from an offline instance, not from a live browser measurement of a rendered component — none of them was on screen during the sweep. Treat the classification as provisional; what is certain is that each one lays children out against its border box, which is a defect for any consumer who themes a border onto it.
