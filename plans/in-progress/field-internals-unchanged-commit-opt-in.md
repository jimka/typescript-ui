---
depends-on: [unchanged-commit-opt-ins-forms]
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Row.ts
  - packages/lib/docs/concepts/layout-system.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Unchanged-Commit Opt-Ins, Stage 4: the Field Internals — Implementation Plan

## Overview

Stage 3 ([`plans/implemented/unchanged-commit-opt-ins-forms.md`](plans/implemented/unchanged-commit-opt-ins-forms.md)) opted ten form-control classes into the unchanged-commit layout skip and measured the result in the engine: every opted-in class's `doLayout@` counter reached zero, and two form phases won −1.57 ms (−37%) and −2.11 ms (−35%). Its measurement notes record what is left: seven `doLayout@` counters stay live on `ffq` and nine on `fnq`, and the four they name are all *inside* a field — `PickerButton` 0.2 per unit, `ButtonIconGlyph` 0.2, `ButtonLabelText` 0.2, `PickerInput` 0.1.

This plan takes those internals. Eleven classes opt in, and the two places a field lays a child out by hand and then forces that child's pass — [`AbstractPickerField.doLayout`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L249) and [`ComboBox.doLayout`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L925) — place through [`Component.applyBounds`](packages/lib/src/typescript/lib/core/Component.ts#L4456) instead, so the gate decides. Measured offline against the QA app's own `form-flat` scene, a settled field's **own** pass falls from 10 `doLayout` calls to 1 for a `DateField` or `TimeField`, 5 to 1 for a `ComboBox`, 11 to 2 for a `NumberSpinner`, and 4/3/4 to 1 for a `Checkbox`, `Toggle` and `Slider` — geometry byte-identical in every arm.[^ladder]

This plan also fixes the defect stage 3's library-wide scan found and deferred: [`Row.doLayout`](packages/lib/src/typescript/lib/component/table/Row.ts#L1003) returns without calling `super.doLayout()`, so a `Row` never records that a pass ran and never drains an `onFirstLayout` callback. `Row` gets the base call and **not** an opt-in, because nothing ever commits a row through the gate.[^row]

---

## Architecture Decisions

### What this stage cuts is a field's own pass, not a settled form pass

A settled form pass already stops at the field grid — stage 3 closed that. What stage 4 removes is the work *inside* a field, on the passes a field really runs: its own writes, a resize, a rebind, a theme switch. On the settled `ffq` unit itself these opt-ins change nothing, and the plan does not claim they do.[^what-changes]

### The four named counters are all inside `AbstractPickerField.doLayout`

The four counters stage 3 named stand in the ratio 2 : 2 : 2 : 1, and that is exactly the census of one settled picker field's own pass — measured offline as `PickerButton` 2, `ButtonIconGlyph` 2, `ButtonLabelText` 2, `PickerInput` 1, plus the button's inner plain `Component` 2 and the field itself 1, for the ten calls slice 17's F17.1 already recorded.[^shape]

| Per one settled `DateField.doLayout()` | Shipped today | After this plan |
|---|---|---|
| `DateField` | 1 | 1 |
| `PickerInput` | 1 | 0 |
| `PickerButton` | 2 | 0 |
| the button's inner `Component` | 2 | 0 |
| `ButtonIconGlyph` | 2 | 0 |
| `ButtonLabelText` | 2 | 0 |
| **total** | **10** | **1** |

### The two forced child passes become `applyBounds`

`AbstractPickerField.doLayout` writes its input's and button's rectangles with four raw setters each and then calls `this._button.doLayout()` unconditionally; `ComboBox.doLayout` does the same for its label. Both hand-placed rectangles go through `applyBounds`, which writes the identical four setters and then lays the child out only when the rectangle changed or the child cannot skip.[^applybounds] The precedent is the table: [`component/table/Body.ts:1474`](packages/lib/src/typescript/lib/component/table/Body.ts#L1474), [`component/table/Header.ts:1629`](packages/lib/src/typescript/lib/component/table/Header.ts#L1629) and [`layout/Table.ts:389`](packages/lib/src/typescript/lib/layout/Table.ts#L389) all hand-place a child this way, and the table's cells are stage 1's opt-in.

An ungated `doLayout()` call is the one thing no gate can withhold, so this conversion is what the opt-ins need to engage — and it must land in the same change as them.[^together]

### Eleven internals opt in; four more would change nothing

None of the eleven has a library subclass, so each returns `true`, as stage 3's eight do.

| Class | File | What its own pass places |
|---|---|---|
| `PickerInput` | [`component/input/PickerInput.ts:33`](packages/lib/src/typescript/lib/component/input/PickerInput.ts#L33) | nothing — an `<input>` with no children |
| `PickerButton` | [`component/input/PickerButton.ts:59`](packages/lib/src/typescript/lib/component/input/PickerButton.ts#L59) | its content row, in a `Fit`, at its own inner rect |
| `ComboBoxLabel` | [`component/input/ComboBox.ts:439`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L439) | its hosted renderer, sized to its own content box |
| `ComboBoxCaret` | [`component/input/ComboBox.ts:686`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L686) | its chevron glyph, at the square size fixed in its constructor |
| `CheckboxBox` | [`component/input/Checkbox.ts:92`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L92) | the check glyph and the dash, at sizes pinned at construction |
| `ToggleTrack` | [`component/input/Toggle.ts:71`](packages/lib/src/typescript/lib/component/input/Toggle.ts#L71) | its thumb, at the size pinned at construction |
| `SliderTrack` | [`component/input/Slider.ts:65`](packages/lib/src/typescript/lib/component/input/Slider.ts#L65) | the active fill, which `Slider.doLayout` places by hand anyway |
| `SliderThumb` | [`component/input/Slider.ts:104`](packages/lib/src/typescript/lib/component/input/Slider.ts#L104) | nothing — no children |
| `NumberSpinnerField` | [`component/input/NumberSpinner.ts:100`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L100) | nothing — an `<input>` with no children |
| `SpinButtonUp` | [`component/input/NumberSpinner.ts:129`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L129) | its content row, in a `Fit` |
| `SpinButtonDown` | [`component/input/NumberSpinner.ts:149`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L149) | its content row, in a `Fit` |

Four more inner parts were measured and left out: `CheckboxCheckGlyph`, `CheckboxDash`, `ToggleThumb` and `SliderActiveTrack`. Each sits under a part that skips first, so its own gate is never asked and opting it in changes no count in either drive measured.[^dead-leaves] `ComboBoxCaretGlyph` is left out for a different reason: its x and y were never assigned, so `NaN !== NaN` makes every commit of it report a change for ever and the gate can never engage.[^nan-glyph]

### `Row.doLayout` gets its base call and no opt-in

`Row.doLayout` becomes `return super.doLayout();`. `Row` does **not** opt in: a row is raw-appended into the scroller's rows container and positioned by [`VirtualRowView.positionRow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L427)'s own setters, never committed through `commitBounds` or `applyBounds`, so `canSkipUnchangedLayout` would never be consulted.[^row]

### `Button`'s own parts stay out

`ButtonIconGlyph` and `ButtonLabelText` keep the default. Their counters reach zero on the form cells anyway, because the picker button above them is withheld whole — so the two classes every button in the library shares stay with the `Button` stage that stage 2 named.[^button-parts]

---

## Public API

No symbol is added or removed, and no signature changes. Eleven classes gain a protected override:

```ts
// component/input/PickerInput.ts
class PickerInput extends TextInput<TextInputOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
// component/input/PickerButton.ts
class PickerButton extends Button {
    protected canSkipUnchangedLayout(): boolean;   // true
}
// component/input/ComboBox.ts — both file-local
class ComboBoxLabel extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class ComboBoxCaret extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}
// component/input/Checkbox.ts — file-local
class CheckboxBox extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}
// component/input/Toggle.ts — file-local
class ToggleTrack extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}
// component/input/Slider.ts — both file-local
class SliderTrack extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class SliderThumb extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}
// component/input/NumberSpinner.ts — all three file-local
class NumberSpinnerField extends TextField {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class SpinButtonUp extends SpinButton {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class SpinButtonDown extends SpinButton {
    protected canSkipUnchangedLayout(): boolean;   // true
}
```

Three method bodies change behind unchanged signatures:

```ts
abstract class AbstractPickerField<TValue, TDropdown, TOptions> extends AbstractInput<TValue | null, TOptions> {
    doLayout(): this;   // places both children through applyBounds; no forced button pass
}
class ComboBox<TOptions extends ComboBoxOptions = ComboBoxOptions> extends AbstractInput<string, TOptions> {
    doLayout(): this;   // places label and caret through applyBounds; no forced label pass
}
class Row extends Component {
    doLayout(): this;   // now `return super.doLayout();`
}
```

`NumberSpinnerField` extends `TextField`, whose gate is the exact-class form, so the override is what opts it in; the base's `Object.getPrototypeOf(this) === TextField.prototype` returns `false` for it.

---

## Internal Structure

`AbstractPickerField.doLayout`'s new tail. `super.doLayout()`, the content-box read and the `inputWidth` arithmetic are unchanged; the eight raw setters and the forced `this._button.doLayout()` become two `applyBounds` calls:

```ts
    const inputWidth = Math.max(0, box.width - PICKER_BUTTON_WIDTH_PX);

    // `applyBounds` writes the same x / y / width / height and then lays the
    // child out only when the rectangle moved or the child cannot skip — the
    // shape `Body.renderWindow` uses for a table cell. It replaces the forced
    // `_button.doLayout()` this method used to end with: a resize still
    // re-centres the button's glyph, because a resize is exactly the case
    // where the rectangle changed.
    this._input.applyBounds(box.x, box.y, inputWidth, box.height);
    this._button.applyBounds(box.x + inputWidth, box.y, PICKER_BUTTON_WIDTH_PX, box.height);

    return this;
```

`ComboBox.doLayout`'s new tail. `setLineHeight` stays ahead of the placement, so a pass that does run sees the new line height:

```ts
    const labelW = Math.max(0, box.width - caretSize - gap);
    const caretX = box.x + labelW + gap;
    const caretY = box.y + Math.max(0, (box.height - caretSize) / 2);

    // `lineHeight` equals the label's height so the single line of label text
    // vertically centers without `display: flex` on the parent. Written before
    // the placement, so a pass the placement does run reads the new value.
    this._label.setLineHeight(box.height);

    // As in `AbstractPickerField.doLayout`: the placement lays the child out
    // only when it moved. A renderer rebind that moves nothing is reached
    // through `ComboBoxLabel.setItem`'s `invalidateLayout()` instead, which
    // marks the label and every opted-in ancestor.
    this._label.applyBounds(box.x, box.y, labelW, box.height);
    this._caret.applyBounds(caretX, caretY, caretSize, caretSize);

    return this;
```

`Row.doLayout`'s whole body:

```ts
    doLayout(): this {
        // Cell placement is driven by the Body's renderWindow, so the pass the
        // base runs over this row's own `Absolute` manager re-commits every
        // cell at the rectangle it already holds and `Cell`'s opt-in withholds
        // each one. The base call is still needed: it is the only place the
        // layout-dirty flag is cleared, the text-metrics generation recorded
        // and an `onFirstLayout` callback drained.
        return super.doLayout();
    }
```

Each override carries a doc comment in the shape of [`Checkbox.canSkipUnchangedLayout`'s](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L629): what opts in, each of this class's own layout inputs and how a change to it reaches a pass, and the remaining caveat. The per-class lists are in *Addendum: Writer Audit*.

---

## Ordered Implementation Steps

Work test-first: step 1 writes the cases, and each must fail before the change it covers lands.

1. **Create `packages/lib/tests/core/UnchangedCommitFieldInternals.test.ts`** with E1–E12 from *Expected Behaviour*. Copy `makeConfig()`, `widenFont()`, `install()`, `flushFrame()`, `track()`, `flatten()`, `visualX()`/`visualY()`, `geometryOf()`, `makeRoot()`, `settle()`, `makeFormScene()`, `labelFor()`, `comboLabelText()`, `comboRendererGeometry()`, `comboIconFound()` and `innerInput()` from [`tests/core/UnchangedCommitFormOptIns.test.ts`](packages/lib/tests/core/UnchangedCommitFormOptIns.test.ts) — that file already builds the scene these cases need. The eleven prototypes are not all importable, so reach each through a live instance in the scene: `Object.getPrototypeOf(dateField.getComponents()[0])` for `PickerInput`, `[1]` for `PickerButton`, and so on down the tree in *Addendum: The field subtrees*. The `afterEach` disposes every root and calls `ThemeManager.setTheme(ModernTheme)`, as stage 3's file does. Check: run the file — **E1, E2, E5, E7, E8, E11 fail**; E3, E4, E6, E9, E10, E12 pass, because they guard behaviour that already works and must stay green.

2. **`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` — `doLayout`** ([:249](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L249)). Replace the tail with *Internal Structure*'s, deleting the eight raw setters and the `this._button.doLayout()` call at [:275](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L275) together with the comment above it. Update the method's doc comment: the placement is committed through `applyBounds`, so a resize re-lays the button out and an unchanged pass does not.

3. **`packages/lib/src/typescript/lib/component/input/ComboBox.ts` — `doLayout`** ([:925](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L925)). Replace the tail with *Internal Structure*'s, deleting the eight raw setters and the `this._label.doLayout()` call at [:952](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L952). Leave `ComboBoxLabel.setItem`'s `invalidateLayout()` ([:486](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L486)) exactly as it is — it is what reaches the label when nothing moved.

4. **The eleven opt-ins**, each with the doc comment *Internal Structure* describes and the inputs from *Addendum: Writer Audit*:
   - `component/input/PickerInput.ts` ([class :33](packages/lib/src/typescript/lib/component/input/PickerInput.ts#L33)) and `component/input/PickerButton.ts` ([class :59](packages/lib/src/typescript/lib/component/input/PickerButton.ts#L59)): the only member each class gains besides its constructor.
   - `component/input/ComboBox.ts`: on `ComboBoxLabel` ([:439](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L439)), after its `doLayout` ([:619](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L619)); on `ComboBoxCaret` ([:686](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L686)), after `getGlyph`.
   - `component/input/Checkbox.ts`: on `CheckboxBox` ([:92](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L92)), after `render`.
   - `component/input/Toggle.ts`: on `ToggleTrack` ([:71](packages/lib/src/typescript/lib/component/input/Toggle.ts#L71)), after `render`.
   - `component/input/Slider.ts`: on `SliderTrack` ([:65](packages/lib/src/typescript/lib/component/input/Slider.ts#L65)) and `SliderThumb` ([:104](packages/lib/src/typescript/lib/component/input/Slider.ts#L104)).
   - `component/input/NumberSpinner.ts`: on `NumberSpinnerField` ([:100](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L100)), `SpinButtonUp` ([:129](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L129)) and `SpinButtonDown` ([:149](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L149)).
   - Check: `grep -rn 'protected canSkipUnchangedLayout' packages/lib/src` lists **29** lines — the base, stage 1's three, stage 2's four, stage 3's ten, and these eleven. `npm test` green, with E1, E2, E5, E7, E8 and E11 now passing.

5. **Create `packages/lib/tests/component/table/RowLayoutPass.test.ts`** with E13. Copy the `CONFIG`, `track`, `beforeEach`/`afterEach` and `makeTable` helpers from [`tests/component/table/CellLayoutSkip.test.ts`](packages/lib/tests/component/table/CellLayoutSkip.test.ts#L23). Check: E13's dirty-flag and first-layout-drain clauses fail; its geometry, no-cell-lays-out and gate clauses already pass.

6. **`packages/lib/src/typescript/lib/component/table/Row.ts` — `doLayout`** ([:1003](packages/lib/src/typescript/lib/component/table/Row.ts#L1003)). Replace `return this;` with `return super.doLayout();` and the doc comment with *Internal Structure*'s. Check: E13 passes; `npx vitest run tests/component/table` is green.

7. **Documentation**, per *Documentation Impact*.

8. **Run *Verification*'s offline checks.** Stop there. The in-engine A/B is the user's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/UnchangedCommitFieldInternals.test.ts` |
| Create | `packages/lib/tests/component/table/RowLayoutPass.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/PickerInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/PickerButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Toggle.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` — the only file the sibling plan `table-body-visible-records-memo` comes near; that plan touches `component/table/Body.ts`, which this plan does not open |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/docs/components/ComboBox.md` |
| Modify | `packages/lib/docs/components/DateField.md` |
| Modify | `packages/lib/docs/components/TimeField.md` |
| Modify | `packages/lib/docs/components/DateTimeField.md` |
| Modify | `packages/lib/docs/components/NumberSpinner.md` |
| Modify | `packages/lib/docs/components/SpinButton.md` |
| Modify | `packages/lib/docs/components/Checkbox.md` |
| Modify | `packages/lib/docs/components/Toggle.md` |
| Modify | `packages/lib/docs/components/Slider.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` — every plan in flight adds bullets here, including the sibling `table-body-visible-records-memo`, which says the same; the conflict is textual, not semantic. Add bullets, never rewrite neighbours |
| Modify | `packages/lib/docs/reference/migration/next.md` — shared, as above |

---

## Expected Behaviour

E1–E13 are unit-testable under the modelled DOM. "Settled" means the scene was laid out four times at its box, with a frame flushed after each. A "position" is the visual one, `getX() + getTranslateX()` and `getY() + getTranslateY()`, as `geometryOf` reads it. "Forced off" means the same scene with `canSkipUnchangedLayout` spied to `false` on all eleven new prototypes. E14 is in-engine only.

**The form scene** is stage 3's `makeFormScene()` unchanged: a rendered `Container` root with `Fit` at 800×600, over a `Panel` with `VBox({ stretching: true })`, over a `LabeledGrid({ columns: 2 })` holding one field of each kind plus an undecorated ninth `TextField`.

**E1. Who opts in.** On the settled form scene, `canSkipUnchangedCommit()` is:

| Instance, reached through its field | Answer |
|---|---|
| `dateField.getComponents()[0]` (`PickerInput`), `[1]` (`PickerButton`) | `true` |
| `comboBox.getComponents()[0]` (`ComboBoxLabel`), `[1]` (`ComboBoxCaret`) | `true` |
| `checkbox.getComponents()[0]` (`CheckboxBox`) | `true` |
| `toggle.getComponents()[0]` (`ToggleTrack`) | `true` |
| `slider.getComponents()[0]` (`SliderTrack`), `[1]` (`SliderThumb`) | `true` |
| `numberSpinner.getComponents()[0]` (`NumberSpinnerField`) | `true` |
| `numberSpinner.getComponents()[1].getComponents()[0]` and `[1]` (`SpinButtonUp`, `SpinButtonDown`) | `true` |
| `comboBox.getComponents()[1].getComponents()[0]` (`ComboBoxCaretGlyph`) | `false` |
| `checkbox.getComponents()[0].getComponents()[0]` and `[1]` (`CheckboxCheckGlyph`, `CheckboxDash`) | `false` |
| `toggle.getComponents()[0].getComponents()[0]` (`ToggleThumb`) | `false` |
| `slider.getComponents()[0].getComponents()[0]` (`SliderActiveTrack`) | `false` |
| `dateField.getComponents()[1].getComponents()[0]` (the button's content row, a plain `Component`) | `false` |

**E2. A settled picker field's own pass reaches nothing below it.** On the settled form scene, `dateField.doLayout()` calls `doLayout` on the `DateField` and on **nothing else** — not the `PickerInput`, the `PickerButton`, the button's content row, its `ButtonIconGlyph` or its `ButtonLabelText`. Every rectangle in the field's subtree is identical before and after. Forced off, each of those five classes lays out at least once, at the same rectangles. Before this plan the opted-in arm makes ten `doLayout` calls. The same holds for `timeField`.

**E3. A picker field still tracks a resize.** From the settled form scene, `root.setWidth(600)`, `root.doLayout()`, `flushFrame()`: the `PickerInput` is narrower than before and the `PickerButton`'s x moved left by the same amount, while the button keeps its 24-pixel width. Both `doLayout` calls ran, because both rectangles moved — this is the case the conversion must not withhold. Restoring 800 and laying out again returns every rectangle in the scene to its settled value.

**E4. A picker field's own writes still show.** From the settled form scene, each write followed by `flushFrame()`: `dateField.setValue(new Date(2026, 8, 19))` leaves the inner input's value `"2026-09-19"`, and `(dateField.getComponents()[1] as PickerButton).setGlyph('xmark')` leaves the button's glyph rectangle inside the button's inner rect and equal to the rectangle it held before the swap, since the glyph's size does not depend on its name.

**E5. A settled combo box's own pass reaches nothing below it.** On the settled form scene, `comboBox.doLayout()` calls `doLayout` on the `ComboBox` alone — not the `ComboBoxLabel`, the `ComboBoxCaret` or the caret glyph — and every rectangle is unchanged. Forced off, the label and the caret both lay out, at the same rectangles. Before this plan the opted-in arm makes five `doLayout` calls.

**E6. The renderer closure still reaches the label.** Stage 3's two-arm renderer case, re-run against the new placement: a `ComboBox` over a two-record store with a `GlyphListItemRenderer`, settled; `setSelectedIndex` onto the record that carries a glyph; then `grid.invalidateLayout()` and `root.doLayout()`. The renderer's icon and label rectangles are real numbers and equal the opt-ins-off arm's, and `comboIconFound` is `true` first. The same for `setRendererFactory`.

**E7. A settled number spinner's own pass stops at its spin column.** On the settled form scene, `numberSpinner.doLayout()` calls `doLayout` on the `NumberSpinner` and on its spin column (a plain `Component`) only — not the `NumberSpinnerField`, either spin button, or any `ButtonIconGlyph` or `ButtonLabelText`. Every rectangle is unchanged. Before this plan the opted-in arm makes eleven `doLayout` calls.

**E8. A settled checkbox, toggle and slider reach nothing below them.** On the settled form scene, `checkbox.doLayout()`, `toggle.doLayout()` and `slider.doLayout()` each call `doLayout` on that control alone, and leave every rectangle unchanged. Before this plan the counts are four, three and four.

**E9. A slider's own writes still move its parts.** On the settled form scene: `slider.setValue(75)` then `flushFrame()` moves the thumb's x right of its 50-value position and widens the active fill; `slider.setMax(200)` then `flushFrame()` moves both back; `slider.setOrientation("vertical")` then `flushFrame()` swaps the track's axes. The parts' opt-ins must not stop this — `Slider.doLayout` places them with raw setters, not through a commit.

**E10. A toggle's and a checkbox's value write still show.** On the settled form scene, `toggle.setValue(true)` then `flushFrame()` leaves the thumb's transform `translateX(16px)`; `checkbox.setSelected(true)` then `flushFrame()` takes the check glyph's opacity from 0 to 1.

**E11. A theme switch lays every opted-in internal out once.** On the settled form scene, `ThemeManager.setTheme(t)` where `t` is a `ModernTheme` clone at a larger font size, built as [`tests/component/table/HeaderThemeReflow.test.ts`](packages/lib/tests/component/table/HeaderThemeReflow.test.ts#L68) builds `paddedTheme`, then `flushFrame()`. One instance of each of the eleven classes, reached as in E1, has `doLayout` called at least once during that flush, and the following `root.doLayout()` lays out none of them again.

**E12. A settled form pass is unchanged.** On the settled form scene, `grid.invalidateLayout()` then `root.doLayout()` calls `doLayout` on the root, the `Panel` and the `LabeledGrid` and on nothing else — the same three as before this plan, which is what pins that the `applyBounds` conversions cost nothing on a settled pass.

**E13. `Row` records the pass it ran, and still does not opt in.** On a rendered `Table` over a 40-record store at 300×200, settled, with `row` the first pooled row — `(table.getBody() as any)._rowPool[0]`, as [`CellLayoutSkip.test.ts`](packages/lib/tests/component/table/CellLayoutSkip.test.ts#L98)'s `pooledBodyCells` reaches them:
- `row.isLayoutDirty()` is `false` after `row.doLayout()`, and the whole table's geometry is unchanged across ten further `row.doLayout()` calls. Before the change `isLayoutDirty()` stays `true` for ever.
- No `Cell` in the row lays out during those calls — the base pass re-commits each cell at the rectangle it already holds and stage 1's `Cell` opt-in withholds it.
- An `onFirstLayout` callback registered on a **detached** row fires on that row's first connected pass. Before the change it never fires.
- `row.canSkipUnchangedCommit()` is `false` even on a settled row, because `Row` keeps the default gate.

**E14. In-engine (manual, the user's).** The cell list in *Verification*.

---

## Verification

From `packages/lib` (implementer):

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint` — clean.
- `npm test` — green, with E1–E13 and every stage-1, stage-2 and stage-3 case in `UnchangedCommitSkip.test.ts`, `UnchangedCommitOptIns.test.ts`, `UnchangedCommitFormOptIns.test.ts`, `ComponentBounds.test.ts`, `CellLayoutSkip.test.ts`, `HeaderColumnWindow.test.ts` and `RowCellCache.test.ts`.
- `npm run build:lib`, then `(cd ../qa && npm test)` — the QA panels still mount under jsdom. This opens no window.
- `npm run docs:api` — the 14 pre-existing warnings and no new one. `npm run docs:llms:check` — clean.
- `grep -rn 'protected canSkipUnchangedLayout' src` — 29 lines.
- `grep -rn '_button.doLayout()\|_label.doLayout()' src/typescript/lib/component/input` — zero matches.
- Mutation checks, one at a time, each reverted:

| Mutation | Cases that must fail |
|---|---|
| `AbstractPickerField.doLayout` back to raw setters plus `_button.doLayout()` | E2 |
| `ComboBox.doLayout` back to raw setters plus `_label.doLayout()` | E5 |
| `ComboBoxLabel.setItem`'s `invalidateLayout()` removed | E6 |
| `PickerInput`'s gate → `false` | E1's row, E2 |
| `PickerButton`'s gate → `false` | E1's row, E2 |
| `ComboBoxLabel`'s gate → `false` | E1's row, E5 |
| `ComboBoxCaret`'s gate → `false` | E1's row, E5 |
| `CheckboxBox`'s gate → `false` | E1's row, E8 |
| `ToggleTrack`'s gate → `false` | E1's row, E8 |
| `SliderTrack`'s gate → `false` | E1's row, E8 |
| `SliderThumb`'s gate → `false` | E1's row, E8 |
| `NumberSpinnerField`'s gate → `false` | E1's row, E7 |
| `SpinButtonUp`'s or `SpinButtonDown`'s gate → `false` | E1's row, E7 |
| `Row.doLayout` back to `return this;` | E13's dirty-flag and drain clauses |
| `Row` given `canSkipUnchangedLayout(): boolean { return true; }` | E13's last clause |

**In-engine A/B — the acceptance gate. The user runs it, never the implementer.** Every run opens a full-screen MiniBrowser window. Build the arms and read each cell exactly as stage 3's *Verification* does: `wt` is the library at this branch's fork point, `main` is this branch with `packages/lib` built, five runs per cell as `wt-a, main-1, wt-b, main-2, wt-c`, `work=1&seam=1&geom=1` on every run, read with `python3 packages/qa/bin/qa-table.py packages/qa/results g4f-<cell>- --work`.

**Scored cells.** A field's own pass is the unit in the first two, which is where the whole of this stage lands.

| Cell | Query | Expectation |
|---|---|---|
| `ffd` | `panel=form-flat&passes=date&drive=passes` | M24's `doLayout` sum falls from **10 to 1**; `doLayout@PickerInput`, `@PickerButton`, `@ButtonIconGlyph`, `@ButtonLabelText` and the plain `@Component` all reach **0**; `@DateField` unchanged at 1 per unit |
| `ffc` | `panel=form-flat&passes=combo&drive=passes` | `doLayout` sum falls from **5 to 1**; `@ComboBoxLabel`, `@ComboBoxCaret`, `@ComboBoxCaretGlyph` reach **0**; M25's `seam.sink.apply` may fall — record the new figure |
| `ffr` | `panel=form-flat&drive=resize` | offline the pass falls **444 → 228** `doLayout` per unit (−48.6%); read the engine's own ratio and record it |
| `fnr` | `panel=form-nested&drive=resize` | as `ffr` |
| `ffq` | `panel=form-flat&passes=form&drive=passes` | the four residual counters stage 3 named reach **0**; `@DateField` and `@TimeField` may stay non-zero; **the clock is expected flat** |
| `fnq` | `panel=form-nested&passes=form&drive=passes` | as `ffq`, and `@Component`, `@ButtonIconGlyph`, `@ButtonLabelText` keep the 1 per unit the inspector's own header menu button costs |
| `tr` | `panel=table-rows&drive=passes` | within bracket of `wt`; no counter moves — `Row.doLayout` is not reached on a settled pass |

**Gate-only cells.** No work or time expectation; read for geometry and for the pinned counters named.

| Cell | Query | Read |
|---|---|---|
| `ffh` | `panel=form-flat&passes=header&drive=passes` | unchanged — the header grid holds plain `TextField`s only |
| `ffy` | `panel=form-flat&type=text&drive=type` | `geometry.tooltip` keeps its rectangle (C21 stays fixed) |
| `ffz` | `panel=form-flat&type=date&drive=type` | C23's partial-date behaviour unchanged; geometry `=` |
| `ffu` | `panel=form-flat&drive=update` | `checkbox.action` and `slider.action` stay 0 (C40 stays fixed) |
| `ffk` | `panel=form-flat&click=toggle&drive=click` | `checkbox.action` 0.50 per unit, as before |
| `ffb` | `panel=form-flat&click=combo&drive=click` | geometry `=`; the combo's own `apply` counters unchanged |
| `ffp` | `panel=form-flat&drive=pan` | `slider.action` unchanged; geometry `=` |
| `trc` | `panel=table-rows&update=filter&drive=update` | geometry `=` — the `Row` base call meets a rebind |
| `tn` | `panel=tree-nodes&drive=passes` | geometry `=` |
| `sdq`, `ssq` | `panel=shell-deep&drive=passes`, `panel=shell-shallow&drive=passes` | geometry `=`; no counter moves |
| `cdq` | `panel=chart-dashboard&drive=passes` | geometry `=` |
| `wq` | `panel=windows&drive=passes` | geometry `=` |

**Pass criteria:**

1. `geom` is `=` for every run of all 20 cells. A cell whose three `wt` runs disagree is unstable and is re-run.
2. `ffd` reads a `doLayout` sum of 1 per unit and `ffc` a sum of 1; every engagement counter listed for them reaches 0.
3. No scored cell reads `regress`.
4. `ffr`, `fnr` and `ffc`'s M25 are recorded with their new figures. A flat clock on any cell is not a failure: this stage ships on the work criterion under the standing rule.[^standing-rule]

A geometry `DIFF` anywhere stops the plan until the writer behind it is found and closed. Narrowing the opt-in list until the symptom goes away is not a fix — that is stage 1's rule. Record the readings in this plan's *Implementation Notes*.

---

## Documentation Impact

- **[`docs/concepts/layout-system.md`](packages/lib/docs/concepts/layout-system.md#L31), *The write is diffed*.** Extend the opted-in list with the eleven internals, grouped as "and the parts those controls are built from", naming [`PickerInput`](/api/component/input/classes/PickerInput) and [`PickerButton`](/api/component/input/classes/PickerButton) with API links and the nine file-local classes in plain code spans (they have no API page). Add one sentence: a field that places a child by hand now commits it through `applyBounds`, so the hand placement is diffed like any other and no longer forces a pass. Do not link `canSkipUnchangedCommit` — it is `@internal`.
- **`docs/components/DateField.md`, `TimeField.md`, `DateTimeField.md`, `ComboBox.md`, `NumberSpinner.md`, `Checkbox.md`, `Toggle.md`, `Slider.md`.** Extend each page's existing `## Notes` bullet about the unchanged-commit skip with one sentence: the control's own inner parts are not re-laid-out either when the control is re-committed where it already sits, and what still lays them out (the control's own writes, a resize, a theme switch). `DateTimeField.md` gains the bullet even though the field itself does not opt in, because its inner input and button now do.
- **`docs/components/SpinButton.md`.** One `## Notes` bullet: a `NumberSpinner`'s two spin buttons are not re-laid-out at an unchanged rectangle; a bare `SpinButton` a consumer builds keeps the default.
- **`docs/reference/changelog/next.md`.**
  - *Changed → Components*: one bullet for the eleven opt-ins; one for `AbstractPickerField.doLayout` and `ComboBox.doLayout` placing through `applyBounds` instead of forcing a child pass, stating the consumer-facing fact — a hand-placed child is laid out when its rectangle moved, and a subclass overriding either `doLayout` must keep that shape.
  - *Fixed → Components*: one bullet for `Row.doLayout` calling `super.doLayout()`, naming the drain — an `onFirstLayout` callback on a table row now fires.
- **`docs/reference/migration/next.md`.** Add a `### The controls' inner parts opt in too` subsection under the existing *A `Panel` re-committed at its own rectangle is not re-laid-out* section ([:315](packages/lib/docs/reference/migration/next.md#L315)), in the same *What changed and why* / *Who needs to act* shape. *Who needs to act*: a consumer that subclasses `AbstractPickerField` or `ComboBox` and overrides `doLayout`, or that reaches into a control's inner parts and changes their intrinsic size without `setPreferredSize` or `notifyIntrinsicSizeChanged`.
- **`packages/qa/README.md`'s `form-flat` and `form-nested` rows.** After the in-engine run, record the new `ffd`, `ffc`, `ffr` and `fnr` figures and the re-measured M24 and M25 readings. This is the user's step, not the implementer's.
- **No export, barrel, `llms.txt` or sidebar change.** Every override is `protected`, and no class becomes newly public.

---

## Potential Challenges

- **The two `applyBounds` conversions are worthless — and slightly costly — without the opt-ins.** With the gates off, `applyBounds` lays the child out on every pass exactly as the forced call did, and adds one pass for the picker's input, which had no forced call. Land steps 2, 3 and 4 in one change.
- **`applyBounds`'s "changed" test ignores the translate; `commitBounds`'s does not.** A child carrying a leftover translate could have its pass withheld while sitting somewhere other than its written rectangle. Nothing gives these children a translate today, and `super.doLayout()`'s own `Absolute` commit folds any translate back to zero before the hand placement runs, so the case does not arise — but a future manager that moves them must not leave one.
- **The picker button's preferred size equals the rectangle the field hands it.** `PICKER_BUTTON_WIDTH_PX` is 24 and the button's content-derived preferred width resolves to 24 under the shipped theme, so `super.doLayout()`'s `Absolute` commit reports unchanged. Under a theme where they diverge the button takes one extra pass per field pass — a smaller cost than today's unconditional pass, and E2 still holds because it asserts the opted-in arm's count, not the mechanism.
- **`Row`'s base call costs an `Absolute` pass over the row's cells whenever a row is scheduled.** `Row.addComponent` reaches `Component.insertComponent`, which calls `scheduleLayout()` on the row, and that happens on a column-window change or pool growth, not on a vertical rebind (`Row.setData` binds the cells already there) — so the cost is bounded to those passes, and each cell's commit reports unchanged and is withheld by stage 1's `Cell` opt-in. E13 pins the geometry and the withholding; `trc` reads it in the engine.
- **Nine of the eleven classes are file-local and cannot be imported by a test.** Reach each through a live instance's prototype, as step 1 describes. `vi.spyOn(Object.getPrototypeOf(instance), 'canSkipUnchangedLayout')` is the same idiom stage 3's forced-off arm uses on an imported prototype.
- **`ComboBoxCaretGlyph`'s rectangle contains `NaN`.** A test that digests the caret's subtree geometry will read `NaN,NaN,14,14`, which compares equal as a string and is unchanged by this plan. Do not try to fix it here.

---

## Critical Files

- [`plans/implemented/unchanged-commit-opt-ins-forms.md`](plans/implemented/unchanged-commit-opt-ins-forms.md) — stage 3's decisions, its writer audit, and its `## Implementation Notes`, which are the authoritative measurement and supersede that plan's Overview figures.
- [`plans/implemented/unchanged-commit-opt-ins.md`](plans/implemented/unchanged-commit-opt-ins.md) and [`plans/implemented/unchanged-commit-skip-staged.md`](plans/implemented/unchanged-commit-skip-staged.md) — stage 2's closure shape and stage 1's contract.
- [`core/Component.ts:4456`](packages/lib/src/typescript/lib/core/Component.ts#L4456) `applyBounds`, [`:4479`](packages/lib/src/typescript/lib/core/Component.ts#L4479) `canSkipUnchangedLayout`, [`:4507`](packages/lib/src/typescript/lib/core/Component.ts#L4507) `canSkipUnchangedCommit`, [`:4531`](packages/lib/src/typescript/lib/core/Component.ts#L4531) `markPassOwedAbove`, [`:7951`](packages/lib/src/typescript/lib/core/Component.ts#L7951) `doLayout`, [`:8092`](packages/lib/src/typescript/lib/core/Component.ts#L8092) `invalidateLayout`. Also [`:263-316`](packages/lib/src/typescript/lib/core/Component.ts#L263), the batched flush, which gives a scheduled descendant its own top-level pass whenever an ancestor may withhold the commit — that is why scheduling a `Button`'s content row is safe under an opted-in `PickerButton`.
- [`component/table/Body.ts:1420`](packages/lib/src/typescript/lib/component/table/Body.ts#L1420) and [`:1474`](packages/lib/src/typescript/lib/component/table/Body.ts#L1474), [`component/table/Header.ts:1629`](packages/lib/src/typescript/lib/component/table/Header.ts#L1629) and [`layout/Table.ts:389`](packages/lib/src/typescript/lib/layout/Table.ts#L389) — the `applyBounds` hand-placement precedent the two conversions mirror, and how a row's cells are placed.
- [`component/shared/VirtualRowView.ts:251`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L251) `growRowPool` and [`:427`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L427) `positionRow` — a row is raw-appended and positioned with raw setters, which is why `Row` does not opt in.
- [`component/input/Checkbox.ts:593-631`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L593) — the override doc-comment shape every new override copies.
- [`component/button/Button.ts:782-805`](packages/lib/src/typescript/lib/component/button/Button.ts#L782) and [`:1652`](packages/lib/src/typescript/lib/component/button/Button.ts#L1652) `_rebuildContentRow` — what a `PickerButton`'s or `SpinButton`'s pass places, and what rebuilds it.
- [`tests/core/UnchangedCommitFormOptIns.test.ts`](packages/lib/tests/core/UnchangedCommitFormOptIns.test.ts) — the form-scene fixture and every helper step 1 copies.
- [`tests/component/table/CellLayoutSkip.test.ts:23-91`](packages/lib/tests/component/table/CellLayoutSkip.test.ts#L23) — the `makeTable` fixture step 5 copies.
- [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L896) — *Judged again: render time first, work second, complexity last*, the rule this plan ships under.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), *Size constraints: who is responsible for what* — a withheld pass must never leave a child placed against a rectangle it no longer holds.

---

## Non-Goals

- **`ButtonIconGlyph` and `ButtonLabelText`.** `Button`'s own parts, shared by every button in the library. Their form-cell counters reach zero through the picker button's skip, so nothing here needs them; they stay with the `Button` stage.
- **`TableHeaderMenuButton`.** It is what `fnq`'s remaining `@Component`, `@ButtonIconGlyph` and `@ButtonLabelText` 1-per-unit counters are, because `layout/Table.ts` commits it through `applyBounds` and it never opted in. Also a `Button` subclass, also the `Button` stage.
- **`CheckboxCheckGlyph`, `CheckboxDash`, `ToggleThumb`, `SliderActiveTrack`.** Measured to change no count in either drive, because each sits under a part that skips first.
- **`ComboBoxCaretGlyph`, and its never-assigned position.** Its commit reports a change for ever, so the gate cannot engage; fixing the `NaN` is a separate change with its own blast radius.
- **Opting `Row` in**, and `Table`, `TableBody`, `TreeBody` and `TreeRow`. No commit of a row goes through the gate, and the rest of the table is unaudited.
- **Why a settled picker field lays out at all on an `ffq` unit.** The offline model does not reproduce it, this plan does not identify it, and `doLayout@DateField` and `@TimeField` may stay non-zero after this stage.[^unexplained-trigger]
- **`AbstractPickerField`, `AbstractInput`, `AbstractBooleanInput`, `SpinButton`, `Button` as opt-in points.** An abstract or widely subclassed base would opt in classes this plan did not audit; the concrete parts opt in instead.
- **Flipping the base default.** Each opt-in is still bought with an audit.

---

## Addendum: The measured ladder

**Method.** The QA app's `form-flat` builder was rebuilt against the library's modelled DOM at its default 64 fields — a one-column header grid of eight `TextField`s and a two-column `LabeledGrid` of eight of each field kind, in a `Panel({ autoScroll: 'y', layoutManager: VBox({ stretching: true }) })` under a rendered `Fit` root at 800×600 — settled with eight passes and a frame flush after each. `Component.prototype.doLayout` was then wrapped to count calls by constructor name over ten units, and every component's visual rectangle digested before and after. Each opt-in was modelled by spying `canSkipUnchangedLayout` to `true` on the live prototype; the two `applyBounds` conversions were modelled by replacing the two `doLayout` bodies on their prototypes. No source file was edited.

**A settled field's own pass**, `doLayout` calls per pass. Geometry was `=` against the shipped arm in every row.

| Field | Shipped | + the eleven opt-ins | + the two `applyBounds` conversions | What is left |
|---|---|---|---|---|
| `TextField` | 1 | 1 | 1 | the field; it has no registered children |
| `ComboBox` | 5 | 2 | **1** | the field |
| `DateField` | 10 | 5 | **1** | the field |
| `TimeField` | 10 | 5 | **1** | the field |
| `NumberSpinner` | 11 | 2 | **2** | the field and its spin column, a plain `Component` |
| `Checkbox` | 4 | 1 | **1** | the field |
| `Toggle` | 3 | 1 | **1** | the field |
| `Slider` | 4 | 1 | **1** | the field |
| one of each | **48** | 18 | **9** | −81% |

**Every opt-in earns its place.** With the conversions in and the other ten gates on, dropping one gate at a time:

| Dropped | Effect |
|---|---|
| `PickerButton` | `DateField` and `TimeField` 1 → 9 |
| `PickerInput` | `DateField` and `TimeField` 1 → 3 |
| `ComboBoxCaret` | `ComboBox` 1 → 5 |
| `ComboBoxLabel` | `ComboBox` 1 → 3 |
| `SpinButtonUp` | `NumberSpinner` 2 → 6 |
| `SpinButtonDown` | `NumberSpinner` 2 → 6 |
| `NumberSpinnerField` | `NumberSpinner` 2 → 3 |
| `CheckboxBox` | `Checkbox` 1 → 2 |
| `ToggleTrack` | `Toggle` 1 → 2 |
| `SliderTrack` | `Slider` 1 → 2 |
| `SliderThumb` | `Slider` 1 → 2 |
| `CheckboxCheckGlyph`, `CheckboxDash`, `ToggleThumb`, `SliderActiveTrack` | **no change** — left out |

**The two whole-scene drives.**

| Drive | Shipped | This plan | Geometry |
|---|---|---|---|
| `scroller.doLayout()` per unit, nothing invalidated (`ffq`'s shape) | 1.0 `doLayout`/unit | 1.0 | `=` |
| `grid.invalidateLayout()` then `scroller.doLayout()` per unit | 2.0 | 2.0 | `=` |
| the root's width alternating 780 / 800 per unit (`drive=resize`'s shape) | **444** | **228** | `=` |

A resize round trip restores every rectangle in the scene to its settled value.

**What the offline model does not reproduce.** On the settled `ffq` drive it runs one `doLayout` per unit — the driver's own call on the `Panel` — and nothing beneath it, before or after this plan. So the four counters stage 3 measured live on `ffq` come from picker-field passes the model does not trigger. What the model does establish is that every one of those calls is inside `AbstractPickerField.doLayout`, and that this plan removes all of them.

---

## Addendum: The field subtrees

The registered children a test reaches by index, as the settled scene builds them. `·` separates siblings, `→` descends.

```
TextField          (no children)
ComboBox           ComboBoxLabel · ComboBoxCaret → ComboBoxCaretGlyph
DateField          PickerInput · PickerButton → Component → (ButtonIconGlyph · ButtonLabelText)
TimeField          as DateField
NumberSpinner      NumberSpinnerField · Component → (SpinButtonUp · SpinButtonDown)
                     each SpinButton → Component → (ButtonIconGlyph · ButtonLabelText)
Checkbox           CheckboxBox → (CheckboxCheckGlyph · CheckboxDash)
Toggle             ToggleTrack → ToggleThumb
Slider             SliderTrack → SliderActiveTrack · SliderThumb
```

A `ComboBox`'s hosted renderer and the `Text` inside it are raw-appended rather than registered, so neither is reachable through `getComponents()`; stage 3's `comboLabelText()` and `comboRendererGeometry()` helpers confine the `any` hop that reaches them.

---

## Addendum: Writer Audit

What each opted-in class's own pass reads, and how a change to it reaches a pass. The generic writers stage 1 and stage 2 established apply to all eleven: adding, inserting, removing or moving a child, `setInsets` / `clearInsets`, `setLayoutManager`, `sortComponents`, `setLayoutConstraints`, a child's `setDisplayed`, padding, border and `removeAllComponents` each mark the layout owed; a descendant's `invalidateLayout`, first-layout drain or size-stable move marks every opted-in ancestor; and a theme switch or font swap re-measures through the text-metrics condition in `canSkipUnchangedCommit`.

**`PickerInput`** and **`NumberSpinnerField`.** Both are `<input>` leaves with no registered children, so their own pass places nothing — the same argument that made a plain `Text` safe in stage 3. Their text, value, placeholder, read-only and enabled state are attribute writes. `NumberSpinnerField`'s box height comes from `AbstractInput.applySingleLineBox` → `setPreferredSize`, which relays to its parent.

**`PickerButton`**, **`SpinButtonUp`** and **`SpinButtonDown`.** Each is a `Button`: a `Fit` over one content row, placed at the button's own inner rect. `setText`, `setGlyph`, `clearGlyph`, `setDescription`, the flat and compact insets and a writing-mode change all go through `Button._rebuildContentRow`, which empties and refills the content row — child changes that schedule the row itself — and then recomputes the button's own preferred size, which relays upward. A scheduled content row gets its own top-level pass even under a skipping button, because the batched flush stops walking up at the first ancestor that may withhold a commit. `SpinButton` additionally re-reads its own size from the theme on every theme change, through `updateSize` → `applySingleLineBox`, and pins its chevron so no later pass re-tracks it.

**`ComboBoxLabel`.** Its pass sizes the hosted renderer to its own content box and calls the renderer's `layoutChildren`. The renderer is raw-appended, so that pass is the only thing that places it — which is why stage 3's closure exists: `setItem` calls `invalidateLayout()`, marking the label and the opted-in `ComboBox` above it, so the rebind is placed by the next pass that reaches the field. `setLineHeight` is written by `ComboBox.doLayout` from the label's own height, so it cannot change while the rectangle holds still.

**`ComboBoxCaret`.** Its pass places one chevron glyph at the square size read from the theme once, in the caret's own constructor, and never rewritten. `ComboBox.setCaretOpen` rotates the glyph with a CSS transform and transition; neither is a layout input.

**`CheckboxBox`.** Its pass places the check glyph and the dash at sizes pinned at construction. `applyState` swaps CSS classes on already-placed children.

**`ToggleTrack`.** Its pass places one thumb at the size pinned at construction. `applySelected` swaps a CSS class; `Toggle.applyValue` writes the thumb's transform. Neither is a layout input.

**`SliderTrack`** and **`SliderThumb`.** `Slider.doLayout` places the track, the active fill and the thumb with raw setters from its own content box, the value and the range, and routes every write that changes any of them through `applyValue` or `applyOrientation`, both of which call `scheduleLayout()`. The track's own pass would re-place the active fill at the rectangle the slider already gave it; the thumb has no children at all.

**The one remaining caveat, as for every class opted in since stage 1.** A custom component whose intrinsic size changes without `setPreferredSize` or `notifyIntrinsicSizeChanged` is not re-flowed inside an opted-in ancestor until that ancestor moves or something schedules it.

---

## Notes

[^ladder]: The full method, the per-field ladder, the one-gate-at-a-time attribution and the two whole-scene drives are in *Addendum: The measured ladder*. Every arm's geometry was digested against the shipped arm's and matched exactly, including across a resize round trip.

[^row]: Three things follow from the missing base call, and only the third is about the skip. `Component.doLayout` is the only place the layout-dirty flag is cleared, the text-metrics generation recorded and an `onFirstLayout` queue drained — so a `Row` reports `isLayoutDirty()` `true` for its whole life and a callback registered on one never fires. That drain is the live consumer-visible defect, the same one stage 3 recorded when `Slider` got its base call. The skip half is moot: `growRowPool` raw-appends each row's element into the scroller's rows container rather than `addComponent`-ing it, and `positionRow` writes the row's x, translate, width and height with raw setters, so no layout manager ever commits a row and `Row.canSkipUnchangedLayout` would never be consulted. Adding the base call is also free where `Slider`'s was not: measured on a rendered 40-record table, a settled pass costs five `doLayout` calls before and after the change, because the `Body` never calls `Row.doLayout` on a settled pass at all. What the base call does cost is an `Absolute` pass over the row's cells whenever a row *is* scheduled, which `Row.addComponent` does on a column-window change or pool growth; each cell's commit then reports unchanged and stage 1's `Cell` opt-in withholds it, and the geometry was identical in every arm.

[^what-changes]: Stage 3's own in-engine reading is why this is stated so plainly. It measured the whole `doLayout` family at 2.8 → 1.1 per unit on a form phase while the size-query families — roughly 95% of the pass — fell only 20–43%, and the offline model reproduces the structural half of that: on the settled `ffq` drive, before and after this plan, exactly one `doLayout` runs per unit. So a settled form pass has no room left for this stage to take. The cells where it lands are the ones whose unit *is* a field's own pass, `ffd` and `ffc`, and the resize drive. Under the standing rule that is enough on its own; see `[^standing-rule]`.

[^shape]: Stage 3's notes name four of the seven counters live on `ffq`; this plan claims those four and the plain `Component` share inside the picker button, and nothing about the remainder, which includes the driver's own call on the scrolling `Panel` and the two picker fields' own counters. Measured offline on the settled `form-flat` scene: one `dateField.doLayout()` makes ten `doLayout` calls — `DateField` 1, `PickerInput` 1, `PickerButton` 2, the button's inner plain `Component` 2, `ButtonIconGlyph` 2, `ButtonLabelText` 2. `PickerButton` is two because `AbstractPickerField.doLayout` reaches it twice: once through `super.doLayout()`'s `Absolute` commit and once through the explicit `this._button.doLayout()` at the end, and each of those walks the button's whole content row. The ten calls are the same ten slice 17's F17.1 recorded for a closed picker field ("8 apply, 10 doLayout, 125 size hints"), which is the independent confirmation that the model matches the engine here. Stage 3's note reads the residual the other way round — that the internals "drag their parents with them, which is exactly why `DateField` and `TimeField` are the two of the ten that never reach 0". The dependency runs the other way: every one of those calls is *inside* the field's pass, so they are live because the field lays out, not the reverse. What makes the field lay out is not identified — see `[^unexplained-trigger]`.

[^applybounds]: `applyBounds` calls the private `writeBounds`, whose body is `setX`, `setY`, `setWidth`, `setHeight` in exactly the order both hand-placement sites already write them, and then lays the child out when the committed rectangle changed or `canSkipUnchangedCommit()` is `false`. So the conversion changes no write and no write order; it replaces "always recurse" with "recurse when it moved or the child cannot skip", and adds the batching window `commitBounds` also opens. Two alternatives were dropped. Guarding the existing forced call by hand (`if (changed) this._button.doLayout()`) would duplicate the gate's four conditions at the call site and miss the dirty-flag and text-metrics halves. Removing the forced call outright and relying on `super.doLayout()`'s `Absolute` commit would leave the button laid out against its pre-resize rectangle, which is the defect the forced call was added to fix.

[^together]: The conversions alone, with the gates off, cost slightly more than today: `applyBounds` lays the child out whenever `canSkipUnchangedCommit()` is `false`, which is every pass for a class that has not opted in, and the picker's input gains a pass it never had (today it has no forced call, only the `Absolute` commit). The gates alone leave `PickerButton` at one pass per field pass, because the explicit `doLayout()` call is ungated — measured as the 5 in the ladder's middle column. Only together do they reach 1. This is the same ordering constraint stage 3 had between `commitBounds`'s new rule, `Slider.doLayout` and its ten opt-ins.

[^dead-leaves]: Each of the four sits under a part that this plan opts in, so on any pass where the parent's rectangle held still the parent skips and the leaf is never committed at all. Measured both ways: with the eleven gates on and the two conversions in, adding a gate to `CheckboxCheckGlyph`, `CheckboxDash`, `ToggleThumb` or `SliderActiveTrack` changes no count in the settled-field drive and none in the resize drive either (444 → 228 with and without them). They would each save at most one pass on a resize of a control whose graphic is size-clamped and therefore never resizes. CLAUDE.md's simplicity rule decides it: no code for a scenario that cannot arise. Stage 3 made the same call for `ComboBoxLabel.setRenderer`'s closure after the same kind of mutation run.

[^nan-glyph]: `ComboBoxCaret`'s `Absolute` manager places its glyph at the glyph's own `getX()`/`getY()`, which no setter has ever assigned, so both are the "never assigned" `NaN` seed. `commitBounds` takes its slow path (`positionKnown` is `false`), writes `setX(NaN)`, and then reads `component.getX() !== beforeX` — `NaN !== NaN` is `true`, so every commit of that glyph reports a change and no gate on it could ever engage. The glyph renders correctly because CSS centres it inside the square caret box; its committed rectangle is simply never used. Left as found: the caret above it skips, so nothing reaches the glyph on a settled pass, and assigning it a real position is a visual change with its own blast radius.

[^button-parts]: `ButtonIconGlyph` and `ButtonLabelText` are file-local to `component/button/Button.ts` and are parts of all 17 button classes — toolbar buttons, tab buttons, menu buttons, window controls. Opting them in here would stake the whole library's buttons on an audit of a form's needs, which is why stage 2 named a `Button` stage and stage 3 kept them out of it. Nothing is lost: measured, the eleven opt-ins plus the two conversions take both counters to zero on a picker field's own pass, because the button above them is withheld whole. On `fnq` a 1-per-unit remainder stays, and it is the inspector's own `TableHeaderMenuButton`, which `layout/Table.ts` commits through `applyBounds` — also the `Button` stage's.

[^unexplained-trigger]: On the settled `ffq` drive the offline model runs one `doLayout` per unit and never enters a field, so it cannot say why the engine enters one. Candidates the model does not carry are real text metrics, the scrolling panel's own overflow recalculation and a size-stable move folding a translate back somewhere above the fields — a fold-back marks every opted-in ancestor, which would let one settled pass reach a field. Finding it needs an in-engine run, which this plan does not do. The consequence for the A/B's expectations is stated rather than hidden: `doLayout@DateField` and `@TimeField` are not predicted to reach zero, and a reading where they stay non-zero while the four internal counters reach zero is a pass, not a failure.

[^standing-rule]: The agenda's *Judged again: render time first, work second, complexity last* (2026-09-26) sets the rule: render performance is the primary priority and reduced work secondary, but a work reduction with a flat clock is still worth shipping unless it costs considerable code complexity. This stage is eleven protected one-line overrides with their doc comments, two hand-placement sites converted to the `applyBounds` call the table already uses, and one missing `super.doLayout()` restored — no new state, no new abstraction, no second code path. The work reduction is measured and large where it lands (a picker field's own pass 10 → 1, a resize pass 444 → 228 per unit). The clock is expected flat on the settled form cells and unmeasured on `ffd`, `ffc` and the resize cells until the user's A/B runs.

---

## Implementation Notes

**Steps 1 to 4 and 7 landed as written. Steps 5 and 6 — the `Row.doLayout` base
call and its test — were implemented, found to corrupt cell geometry, and
reverted; `Row.ts` is untouched on this branch.** That is the one prescribed item
this branch does not deliver, and the section *Why the `Row` half was reverted*
below is the whole account. Everything that follows about the eleven opt-ins and
the two `applyBounds` conversions stands.

For the opt-in half, the plan's own prediction of which cases fail before the
change held exactly: E1's
opts-in-with-`true` clause, E2 (both fields), E5, E7, E8 (all three controls) and
E11 were red on the unchanged tree; E3, E4, E6, E9, E10 and E12 were green before
it and stayed green. The per-field ladder the plan measured offline is now pinned
by the test suite rather than modelled — E2, E5, E7 and E8 assert the opted-in
census exactly (`{ DateField: 1 }`, `{ ComboBox: 1 }`,
`{ NumberSpinner: 1, Component: 1 }`, `{ Checkbox: 1 }`, `{ Toggle: 1 }`,
`{ Slider: 1 }`) against the shipped 10, 5, 11, 4, 3 and 4, all six confirmed
against the live tree before the change.

### One prescribed verification was vacuous: E11's second clause

**E11's second clause, as the plan wrote it, could not have caught a
regression.** The plan says: after the theme switch, "the following
`root.doLayout()` lays out none of them again". Mutation-tested with
`PickerButton`'s gate stubbed to `false`, that assertion stays **green** — a
settled `root.doLayout()` stops at the `LabeledGrid`, because every control above
the eleven internals opted in at stage 3 and is settled again by the end of the
theme flush, so the pass never reaches an internal whatever these eleven gates
answer. The clause is satisfied by the pass not descending, not by the gates
engaging.

The case now drives each of the seven controls' **own** passes instead, which is
what puts the eleven gates on the path. That version goes red under all eleven
gate flips *and* under both `applyBounds` reverts — it is the single most
sensitive case in the file. The substitution is marked in a comment at the call
site.

The other eight prescribed mutations were all confirmed live, one at a time, each
reverted: `AbstractPickerField.doLayout` back to raw setters plus
`_button.doLayout()` reddens E2 (and E3 and E11); `ComboBox.doLayout` back
reddens E5 (and E11); removing `ComboBoxLabel.setItem`'s `invalidateLayout()`
reddens E6 (and stage 3's own closure case); each of the eleven gate flips
reddens E1's row plus the pass case the plan names for it. Fourteen mutations,
fourteen reds, no silent pass. The two `Row` mutations the plan lists were also
confirmed red against E13 while that half was on the branch; they no longer apply,
since it was reverted.

### Why the `Row` half was reverted

The plan's steps 5 and 6 were implemented as written — `Row.doLayout` became
`return super.doLayout();` and `tests/component/table/RowLayoutPass.test.ts`
covered E13 — and the audit then showed the change **corrupts cell geometry**. It
is reverted rather than patched, because the premise it rests on is the plan's,
and fixing it is a library design decision no plan has taken.

**What the plan assumed.** `[^row]` and *Internal Structure* both say the base
pass "re-commits every cell at the rectangle it already holds", so "each cell's
commit reports unchanged and stage 1's `Cell` opt-in withholds it", and that "the
geometry was identical in every arm".

**What actually happens.** A `Row` runs the default `Absolute` manager, and
`Absolute.doLayout` (`packages/lib/src/typescript/lib/layout/Absolute.ts:52`)
places each child at `preferredSize ?? size` — it never re-commits the rectangle
the child already holds. Where a cell's `getPreferredSize()` is `null` the
fallback makes that a no-op, which is why a string or number column shows nothing
and why the plan's own measurement ("a settled pass costs five `doLayout` calls
before and after") saw nothing. A `BooleanCell` reports `{ width: 20, height: 16 }`.
Measured on a rendered 40-record table with one `boolean` column, the body's
render window places that cell at 33×20 and the restored base pass shrinks it to
**20×16**. The `Cell` opt-in cannot withhold it, because the commit genuinely
changes the rectangle.

**And it is reachable, not theoretical.** A row is parentless — `growRowPool`
raw-appends its element — so `flushPendingLayouts` gives it a top-level pass
whenever anything schedules it, which `Row.addComponent` does on exactly the
column-window change and pool growth the plan's *Potential Challenges* names as
the base call's cost. Measured: `row.scheduleLayout()` plus one frame takes the
boolean cell to 20×16, where it stays until the body next re-places the window.
So a narrower, shorter cell background and selection band render in between.

**Why not fix it here.** Every candidate — giving `Row` a manager that places
nothing, making `Cell` report no preferred size, or finding another way for a row
to record its pass without its manager re-placing cells — is a library design
choice with its own blast radius, and the plan sanctions none of them. Under
`worker.md`'s *Deviating from the plan*, a broken assumption is a stop-and-ask,
not something to re-plan around mid-implementation. Reverting leaves the
pre-existing defect exactly as it was before this branch — a row still reports
`isLayoutDirty()` `true` for life and still never drains an `onFirstLayout`
callback — which is no worse than the start point, and keeps this branch free of
a regression it would otherwise ship. The agenda entry is corrected to record what
the next attempt has to solve, rather than marked resolved.

**E13 is therefore not covered by a test**, since the behaviour it describes is
not on this branch. Its own first implementation was also vacuous, which is worth
recording for whoever takes this next: the plan says "the whole table's geometry
is unchanged", a table's geometry reads naturally as a walk from the table, and
such a walk reaches neither the pooled row nor its cells — the same raw-append
that keeps `Row` out of the opt-in. A digest for this behaviour has to reach
through `_rowPool`, and it should prove it can see the cells rather than assume
it.

### Mechanism claims inherited from the plan that were wrong

Each was copied from the plan's *Addendum: Writer Audit* or its
*Documentation Impact* formula, and each was corrected after the audit probed the
real behaviour on a settled scene. They are collected here because the pattern
matters more than any one of them: this plan's prose about *why* a skip is safe
was in several places a plausible mechanism rather than the real one.

- **`setText` and `setGlyph` do not "go through the content-row rebuild".**
  `Button.setGlyph` on a button that already has a glyph **renames it in place and
  returns** (`component/button/Button.ts:1843`) — no rebuild, no preferred-size
  recompute — which is sound because a glyph's box never depends on its name.
  `Button.setText` writes the label's text and calls `recomputePreferredSize`
  (`:1189`), also without a rebuild. What does rebuild the row is `clearGlyph`,
  the *first* `setGlyph`, `setDescription` / `clearDescription`, `setShowText`,
  `setShowDescription`, `setDescriptionUnderGlyph` and a writing-mode change; the
  flat and compact insets are not among them and instead mark the layout owed as
  any inset write does. The safety conclusion is unchanged — a rename moves
  nothing and every other path relays — but the stated mechanism was not the real
  one. Corrected in `PickerButton`'s and `SpinButtonDown`'s overrides,
  `docs/components/SpinButton.md` and the changelog bullet.
- **"The control's own writes, a resize and a theme switch each still lay the
  parts out" is false for most of the controls.** Measured on the settled scene,
  one isolated case per write: `checkbox.setSelected`, `toggle.setValue`,
  `dateField.setValue`, `numberSpinner.setValue` and `comboBox.setValue` lay out
  **nothing** in the control's subtree — which is the whole reason the opt-in is
  safe, not a gap — and `checkbox.setLabel` and `slider.setValue` lay out only the
  control itself. A resize reaches the `ComboBox`'s label and caret, the picker
  fields' input and button, and the spinner's inner field, but **not**
  `CheckboxBox`, `ToggleTrack`, `SliderTrack` or `SliderThumb`: a checkbox and a
  toggle are pinned to the size their own children need so their rectangles do not
  track the cell, and a slider writes its track's and thumb's rectangles with
  plain setters rather than through a commit. Only the theme switch holds for all
  eleven. The seven affected control pages now say what is actually true per
  control; `Slider.md`'s sentence already did and was left alone.
- **"A control that places one of its own children by hand commits it through
  `applyBounds`" over-generalises.** Only `AbstractPickerField` and `ComboBox`
  were converted; `Slider` still hand-places its track, fill and thumb with plain
  setters (`component/input/Slider.ts:553`) and is in the same opted-in list, so
  the concept page's sentence was false for it. It now names the two converted
  sites and states that a control which hand-places without recursing — a slider —
  is unchanged, because it never forced those passes to begin with.
- **"A resize moves the inner field but not the fixed-width spin column" was the
  wrong reason.** Measured, a resize's spinner census is
  `{ NumberSpinner: 1, NumberSpinnerField: 1, Component: 1 }` — the spin column
  moves with the field and *is* laid out. The conclusion held (neither button is
  re-laid-out) but the mechanism is that the column's own width is fixed, so it
  hands each button back the rectangle it already held.
- **"Each sits under a part that is withheld first" did not scope.** True of
  `CheckboxCheckGlyph`, `CheckboxDash`, `ToggleThumb`, `SliderActiveTrack` and
  `ComboBoxCaretGlyph`; false of a bare `SpinButton`, and false of
  `ButtonIconGlyph` / `ButtonLabelText` in any button other than these controls'
  own. The changelog bullet now splits the two groups, as the migration note
  already did.
- **The migration note told `ComboBox` subclassers to do something impossible.**
  `ComboBox._label` and `_caret` are `private` (`component/input/ComboBox.ts:835`),
  so no subclass can place them; only `AbstractPickerField`'s `_input` and
  `_button` are `protected`. The *Who needs to act* paragraph now says so.

### Three plan details that did not survive contact

- **E4's `setGlyph('xmark')` is not runnable.** `Glyph`'s registry starts empty
  but for four `unicode-*` char entries, and each glyph is registered by the
  module that needs it — `DateField.ts` registers `calendar`, `TimeField.ts`
  `clock`. `xmark` is never registered anywhere in the library, and
  `Glyph.setGlyphName` throws `Unknown glyph: xmark` rather than degrading. The
  case swaps to `clock` instead, which the scene's own `TimeField` registers.
- **The *Addendum: The field subtrees* diagram mis-draws the slider.** It reads
  `Slider  SliderTrack → SliderActiveTrack · SliderThumb`, which puts the thumb
  under the track. E1's own table has it right and stage 3's test file already
  relied on the right shape: `slider.getComponents()` is
  `[SliderTrack, SliderThumb]`, and `SliderActiveTrack` is the track's only
  child. The addressing follows E1. Every index in E1's table was confirmed
  against the live scene, and the test file asserts each reached instance's class
  name, so a future change to a control's child order fails loudly instead of
  silently testing the wrong object.
- **The `grep` check in *Verification* cannot reach zero as written.** Both new
  comments name the call they replaced, so
  `grep -rn '_button.doLayout()\|_label.doLayout()' src/typescript/lib/component/input`
  reports two *comment* lines. The code-only form,
  `grep -rnE '^\s*this\._(button|label)\.doLayout\(\)' src/typescript/lib/component/input`,
  returns zero. `grep -rn 'protected canSkipUnchangedLayout' src` reports 29, as
  prescribed.

### One file outside the plan's list had to change

`packages/lib/tests/core/UnchangedCommitFormOptIns.test.ts` (stage 3's suite).
Its E7 forced-off arm asserts that **every** component in the grid is laid out,
which held only while nothing in the scene skipped; the eleven new opt-ins
withhold the internals, so that arm went red. Its `optedInPrototypes()` helper now
returns stage 4's eleven prototypes as well as stage 3's ten, harvested through
throwaway controls because nine of the eleven are file-local and unimportable.
The alternative — narrowing the assertion to the fields — would have given up a
regression guard that proves the whole subtree is reachable on that pass, so the
list grew instead. The plan did not anticipate this; the edit rides in the code
commit, as a fix the functionality itself requires.

### The open question the plan flagged is still open, and stays open here

The plan's *Non-Goals* and the agenda's *Stage 4 may not close stage 3's
residual* both ask whether `doLayout@DateField` and `@TimeField` reach zero.
**They do not, and this stage does not make them.** What is measured offline, and
now pinned, is narrower and should not be read as more:

- Every call *inside* a settled picker field's own pass is gone. The census is
  `{ DateField: 1 }` — not just `PickerInput` and `PickerButton` at zero, but
  `ButtonIconGlyph`, `ButtonLabelText` and the button's inner plain `Component`
  too, because the button above them is withheld whole. That is stronger than
  the agenda entry feared: the two `Button` internals being out of scope costs
  nothing on a picker field's own pass, so **no stage 5 is implied by this
  cell**. The `fnq` remainder the agenda mentions is `TableHeaderMenuButton`,
  already in this plan's *Non-Goals*.
- The field's **own** call is untouched and was never in scope. Whether it still
  runs on a settled `ffq` unit depends on what makes a settled picker field lay
  out in-engine, which `[^unexplained-trigger]` records as unidentified and which
  the offline model does not reproduce. So the `ffq` / `fnq` reading of
  `@DateField` and `@TimeField` is unresolved, and resolving it needs the
  in-engine A/B.

Stated plainly, so no later reader takes a zero this code does not reach: stage 4
closes the four counters stage 3 named, on the drive where a field's own pass is
the unit; it does not close `@DateField` and `@TimeField`, and it does not
explain them.

### What was not measured, and why

- **The in-engine A/B is untouched.** Every cell in *Verification*'s table opens
  a full-screen MiniBrowser window on the user's desktop, which this run is
  forbidden to do. All 20 scored and gate-only cells, the `packages/qa/README.md`
  `form-flat` / `form-nested` figures, and the re-measured M24 / M25 readings are
  the user's step. Nothing here should be read as an in-engine result.
- **The resize ladder (444 → 228 `doLayout` per unit) was not re-derived.** That
  figure comes from the plan's own modelled ablation, which this run did not
  rebuild. E3 pins the behavioural half instead — a narrowed root really does
  move both picker children and lay both out, the button keeps its 24-pixel
  column, and a round trip back to 800 restores every rectangle in the scene to
  its settled value.
- **One *Potential Challenges* worry did not arise.** The plan warns that under a
  theme where the picker button's content-derived preferred width diverges from
  `PICKER_BUTTON_WIDTH_PX` the button would take one extra pass per field pass.
  E11 settles the scene under a `ModernTheme` clone at a 20px font and then drives
  each control's own pass asserting that no internal lays out, which it does —
  so the two still agree at that font size.

### Offline verification, as run

`npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint`
— all clean. `npm test` from the repo root — green, with the start point's
516 files / 8664 tests plus this branch's one new file and its 21 cases (the
figures were 518 / 8689 before the `Row` half was reverted, which took a file and
four cases with it).
`npm run docs:api` — 0 errors and 14 warnings, the pre-existing set unchanged.
`npm run docs:llms:check` — clean. `npm run build:lib` then `packages/qa`'s own
`npm test` — 448 / 453, which is the start point's figure exactly: the five red
cases are phase 6's four `A11` / `A12` ablation counters and the `P16
scroll-panes` witness, all about `Panel`'s scroll-metrics skip and none reachable
from this change.
