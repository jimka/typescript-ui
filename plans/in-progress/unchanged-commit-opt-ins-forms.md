---
depends-on: [unchanged-commit-opt-ins]
touches-shared:
  - packages/lib/src/typescript/lib/layout/LayoutManager.ts
  - packages/lib/src/typescript/lib/component/input/Slider.ts
  - packages/lib/docs/concepts/layout-system.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Unchanged-Commit Opt-Ins, Stage 3: the Form Panels — Implementation Plan

## Overview

Stage 1 put the unchanged-commit skip behind the protected opt-in [`Component.canSkipUnchangedLayout`](packages/lib/src/typescript/lib/core/Component.ts#L4479) and opted in `MenuBar`, `ToolBar` and the table's cells. Stage 2 opted in `Panel` (the class itself), `LabeledGrid`, `Header` / `WindowHeader` and `StatusBar`, and closed every placement input those classes had that changed a layout while scheduling nothing. Measured in-engine, stage 2 removed 96–97% of a settled *shell* pass but only 3.5% (`fnq`) and 7.4% (`ffq`) of a settled *form* pass.[^why-forms-missed]

This plan takes the form panels. It opts in the ten classes a form's fields are built from — `Text`, `TextField`, `ComboBox`, `DateField`, `TimeField`, `NumberSpinner`, `Checkbox`, `Toggle`, `Slider` and `FieldDecorator` — and closes the two things that stop those opt-ins working:

- [`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L596) decides "the rectangle changed" by comparing the **request** with the child's current box. A child whose own `maxSize` clamps the request therefore reports a change on every pass forever. `Checkbox` (16×16) and `Toggle` (36×20) in a stretched grid cell are exactly that. The fix is to read "changed" from the child's committed rectangle before versus after the write — the rule [`Component.writeBounds`](packages/lib/src/typescript/lib/core/Component.ts#L4555) already uses for `applyBounds`.
- [`Slider.doLayout`](packages/lib/src/typescript/lib/component/input/Slider.ts#L445) never calls `super.doLayout()`, so it never records that a pass ran. Every `Slider` is permanently "owes a pass" and can never skip.

Measured offline on the QA app's own `form-flat` and `form-nested` builders, the three changes together take a settled form pass from 9,452 to **3,197** work units (`ffq`, −66%) and from 11,135 to **4,887** (`fnq`, −56%), with every rectangle unchanged. That is the whole ceiling for `ffq` and within 3% of it for `fnq`.[^measurement]

---

## Architecture Decisions

### The remaining work is in the fields, not in their containers

A container cannot skip while anything beneath it owes a pass, and a form's field grid always owes one. The fields themselves can skip individually under a container that must lay out, and that is where the work is: of the 426 `doLayout` calls a settled `form-flat` pass makes today, 424 are the fields, their inner parts and the row labels.[^where-the-work-is]

### `commitBounds` reads "changed" from the committed rectangle

Replace the request-versus-current test with a before-versus-after test on the child's own box. This is the rule `Component.writeBounds` already applies for [`applyBounds`](packages/lib/src/typescript/lib/core/Component.ts#L4456); `commitBounds` is the outlier.[^commit-rule]

| Child before | Request | Child after | Today | After this change |
|---|---|---|---|---|
| `687,64,16,16`, `maxSize` 16×16 | `687,64,585,16` | `687,64,16,16` | `changed` — the request differs | **unchanged** — the box did not move |
| `100,0,50,20` | `100,0,80,20` | `100,0,80,20` | `changed` | `changed` |
| `100,0,50,20` | `140,0,50,20` | `100,0,50,20`, translate `40,0` | `changed` | `changed` |
| `100,0,50,20`, height forced to 90 out of band | `100,0,50,20` | `100,0,50,20` | `changed` | `changed` — the write moved it back |

The decision whether to take the translate fast path keeps reading the request, so how a clamped child *moves* does not change.[^fast-path]

### `Slider.doLayout` opens with `super.doLayout()`

`Slider` places its track, active fill and thumb by hand and returns without calling the base. `Toggle.doLayout` ([:369](packages/lib/src/typescript/lib/component/input/Toggle.ts#L369)) and `AbstractPickerField.doLayout` ([:249](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L249)) do the same hand placement *after* calling the base, and that is the shape `Slider` takes.[^slider]

This change and the `Slider` opt-in must ship together: on its own it adds an `Absolute` pass over the slider's two registered children, worth +248 work units per `form-flat` pass. With `Slider` opted in the whole slider is withheld instead.

### Ten classes opt in; `Text` and `TextField` only as themselves

`Text` has eleven library subclasses and `TextField` has four, none audited here, so both use the exact-class gate `Panel` established ([`Panel.canSkipUnchangedLayout`](packages/lib/src/typescript/lib/core/Panel.ts#L610)). The other eight have no library subclass and return `true`.[^exact-class]

| Class | Gate | What its layout reads |
|---|---|---|
| `Text` | exact | nothing of its own — no `doLayout` override, no children |
| `TextField` | exact | its inherited container inputs only — no `doLayout` override |
| `ComboBox` | `true` | its content box and the caret's own square size |
| `DateField`, `TimeField` | `true` | their content box, through `AbstractPickerField.doLayout` |
| `NumberSpinner` | `true` | its inherited container inputs only |
| `Checkbox` | `true` | its inherited container inputs only |
| `Toggle` | `true` | its content box and its optional label's height |
| `Slider` | `true` | its content box, and `value` / `min` / `max` / `orientation` |
| `FieldDecorator` | `true` | its single child, in a `Fit`, with cleared insets |

Every write that changes one of those inputs already marks the component: the container inputs through stage 1's and stage 2's closures, and the rest through each class's own `scheduleLayout`. The full audit is in *Addendum: Writer Audit*.

### Classes that stay out

| Class | Why |
|---|---|
| `Label`, `Link`, `SelectableText`, `ButtonLabelText`, `PickerDay`, `PickerCell`, `Legend`, `ListItemMarkerText` and the other `Text` subclasses | Not audited. Each adds its own state; `ButtonLabelText` belongs to the `Button` stage. |
| `PasswordField`, `UsernameField`, `NumberSpinnerField`, `AutoCompleteTextField` | Not audited. A `NumberSpinnerField` is withheld anyway, because the `NumberSpinner` above it skips first. |
| `RadioButton`, `DateTimeField`, `FileField`, `TextArea`, `AutoCompleteField` | Not audited, and no measured cell needs them. |
| `PickerInput`, `PickerButton`, `ComboBoxLabel`, `ComboBoxCaret`, `CheckboxBox`, `ToggleTrack`, `SliderThumb` and the other inner parts | Withheld with the field above them. Opting them in separately buys nothing and multiplies the audit. |
| `LabeledFieldSet`, `FieldSet` | They are the containers that owe the pass, not the work inside it. |
| `Table`, `Row`, and the inspector's cells | `Table` has its own economy through `Cell`. Opting the table's own classes in changes `form-nested`'s geometry.[^table-breaks] |
| `Button` and its 16 subclasses | Stage 2's stated next stage, still unaudited. `ButtonIconGlyph` and `ButtonLabelText` are withheld here only because the field above them skips. |

---

## Public API

No symbol is added or removed. Ten classes gain a protected override:

```ts
class Text<TOptions extends TextOptions = TextOptions> extends Component<TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // Object.getPrototypeOf(this) === Text.prototype
}
class TextField<TOptions extends TextFieldOptions = TextFieldOptions> extends TextInput<TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // Object.getPrototypeOf(this) === TextField.prototype
}
class ComboBox<TOptions extends ComboBoxOptions = ComboBoxOptions> extends AbstractInput<string, TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class DateField extends AbstractPickerField<Date, DatePickerDropdown, DateFieldOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class TimeField extends AbstractPickerField<Date, TimePickerDropdown, TimeFieldOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class NumberSpinner extends AbstractInput<number, NumberSpinnerOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class Checkbox<TOptions extends CheckboxOptions = CheckboxOptions> extends AbstractBooleanInput<TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class Toggle<TOptions extends ToggleOptions = ToggleOptions> extends AbstractBooleanInput<TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class Slider<TOptions extends SliderOptions = SliderOptions> extends AbstractInput<number, TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
    doLayout(): this;                              // now opens with super.doLayout()
}
class FieldDecorator extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}
```

`LayoutManager.commitBounds` keeps its signature. Its documented behaviour changes in one sentence: the pass is withheld when the child's committed rectangle is the same after the write as before it, rather than when the request matched what the child already held.

---

## Internal Structure

The whole of `commitBounds` after the change. Only the four new `before*` reads, the `mayBeUnchanged` removal and the `changed` expression differ from today:

```ts
protected commitBounds(component: Component, x: number, y: number, width: number, height: number): void {
    component.setAutoCommitStyle(false);

    const beforeX          = component.getX();
    const beforeY          = component.getY();
    const beforeWidth      = component.getWidth();
    const beforeHeight     = component.getHeight();
    const beforeTranslateX = component.getTranslateX();
    const beforeTranslateY = component.getTranslateY();

    const sizeUnchanged     = beforeWidth === width && beforeHeight === height;
    const positionUnchanged = x === beforeX + beforeTranslateX && y === beforeY + beforeTranslateY;
    const transition        = component.getTransition();
    // The fast path writes `x - getX()` as a translate, so all four operands
    // must be real numbers. A child no layout manager ever positioned still
    // holds `getX()`/`getY()`'s "never assigned" NaN seed.
    const positionKnown = Number.isFinite(x) && Number.isFinite(y)
        && Number.isFinite(beforeX) && Number.isFinite(beforeY);
    const canFastPath = positionKnown && sizeUnchanged && !positionUnchanged
        && (transition === null || transition === "none");

    if (canFastPath) {
        component.setWillChange("transform");
        component.setTranslate(x - beforeX, y - beforeY);
        // The redundant pass that folds this translate back and releases the
        // promotion is owed on the container, so no skipping ancestor may
        // withhold it.
        component.markPassOwedAbove();
    } else {
        component.setX(x);
        component.setY(y);
        component.setTranslate(0, 0);
        component.setWillChange(null);
    }

    component.setWidth(width);
    component.setHeight(height);

    // "Moves nothing" is the committed rectangle before the write against the
    // committed rectangle after it — the rule `Component.writeBounds` applies
    // for `applyBounds`. Comparing the request instead would report a change
    // for ever on a child whose own maxSize clamps what it is handed.
    const changed = component.getX()          !== beforeX
                 || component.getY()          !== beforeY
                 || component.getWidth()      !== beforeWidth
                 || component.getHeight()     !== beforeHeight
                 || component.getTranslateX() !== beforeTranslateX
                 || component.getTranslateY() !== beforeTranslateY;

    if (changed || !component.canSkipUnchangedCommit()) {
        component.doLayout();
    }

    component.setAutoCommitStyle(true);
}
```

`Slider.doLayout`'s new first statement:

```ts
doLayout(): this {
    // Records that a pass ran — the dirty flag and the text-metrics
    // generation the unchanged-commit gate compares — and places the two
    // registered children at their own boxes before the hand placement
    // below overrides them, as `Toggle.doLayout` does.
    super.doLayout();

    const box = this.getContentBounds();
    // ... the existing body, unchanged ...
}
```

The exact-class overrides:

```ts
protected canSkipUnchangedLayout(): boolean {
    return Object.getPrototypeOf(this) === Text.prototype;
}
```

---

## Ordered Implementation Steps

Work test-first: step 1 writes the cases, and each must fail before the change it covers lands.

1. **Create `packages/lib/tests/core/UnchangedCommitFormOptIns.test.ts`** with every case in *Expected Behaviour* (E1–E13). Copy `makeHost()` ([:211](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L211)), `flatten()` and `geometryOf()` ([:428-445](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L428)) and `install()` / `flushFrame()` ([:552-572](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L552)) from `tests/core/UnchangedCommitSkip.test.ts`, and `makeConfig()` / `widenFont()` from [`tests/component/tree/TreeFontReflow.test.ts`](packages/lib/tests/component/tree/TreeFontReflow.test.ts#L37) for E12. The `afterEach` disposes every root it built and calls `ThemeManager.setTheme(ModernTheme)`, because `setTheme` fires every live listener in the process. The file header names this plan as the source of the case numbers. Check: run the file — **E1, E2, E5, E7, E9 and E13 fail**; E3, E4, E6, E8, E10, E11 and E12 pass, because they guard behaviour that already works and must stay green once the changes land.

2. **`packages/lib/src/typescript/lib/layout/LayoutManager.ts` — `commitBounds`** ([:596](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L596)). Replace the body with *Internal Structure*'s. Update the method's doc comment: the sentence beginning "'Moves nothing' is read back from the child after the setters ran" becomes the before-versus-after rule, and names the clamped-child case it fixes. Check: `npm test` — the whole suite is green. E2 and E4 now pass; E1, E5, E7, E9 and E13 still fail.[^suite-evidence]

3. **`packages/lib/tests/core/UnchangedCommitOptIns.test.ts` — stage 2's E2 control arm** (the assertion at [:441](packages/lib/tests/core/UnchangedCommitOptIns.test.ts#L441)). That case spies `canSkipUnchangedLayout` to `false` on the four stage-2 prototypes, to build a scene where nothing skips. Its scene also holds two `TextField`s and a `Text`, so it stops being a no-skip comparison the moment step 5 lands. Add `Text` and `TextField` to the spied list. Check: after step 5 the case's `doLayout` count is 13 again; before step 5 it is 13 either way.

4. **`packages/lib/src/typescript/lib/component/input/Slider.ts` — `doLayout`** ([:445](packages/lib/src/typescript/lib/component/input/Slider.ts#L445)). Add `super.doLayout();` as the first statement, with the comment from *Internal Structure*. Leave the rest of the body alone. Check: E5 and E6 pass; `npx vitest run tests/component/input/Slider*.test.ts` is green.

5. **The ten opt-ins.** Each override carries a doc comment in the shape of [`LabeledGrid.canSkipUnchangedLayout`'s](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L211): what opts in, each of this class's own layout inputs and how a change to it reaches a pass, and the remaining caveat. Copy the per-class lists from *Addendum: Writer Audit*.
   - `component/input/Text.ts` ([class :118](packages/lib/src/typescript/lib/component/input/Text.ts#L118)): the exact-class form, placed after `getPreferredSize`.
   - `component/input/TextField.ts` ([class :42](packages/lib/src/typescript/lib/component/input/TextField.ts#L42)): the exact-class form, after the last public method.
   - `component/input/ComboBox.ts` ([class :735](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L735)): `return true`, after `doLayout` ([:909](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L909)).
   - `component/input/DateField.ts` ([:48](packages/lib/src/typescript/lib/component/input/DateField.ts#L48)) and `component/input/TimeField.ts` ([:48](packages/lib/src/typescript/lib/component/input/TimeField.ts#L48)): `return true`. Each comment states that the opt-in is the concrete field's, not `AbstractPickerField`'s, so `DateTimeField` and `FileField` keep the default.
   - `component/input/NumberSpinner.ts` ([:168](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L168)), `component/input/Checkbox.ts` ([:244](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L244)), `component/input/Toggle.ts` ([:133](packages/lib/src/typescript/lib/component/input/Toggle.ts#L133)), `component/input/Slider.ts` ([:122](packages/lib/src/typescript/lib/component/input/Slider.ts#L122)): `return true`.
   - `validation/FieldDecorator.ts` ([:21](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L21)): `return true`, after `clearError`.
   - Check: `grep -rn 'protected canSkipUnchangedLayout' packages/lib/src` lists 18 lines — the base, stage 1's three, stage 2's four, and these ten.

6. **Documentation**, per *Documentation Impact*.

7. **Run *Verification*'s offline checks.** Stop there. The in-engine A/B is the user's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/UnchangedCommitFormOptIns.test.ts` |
| Modify | `packages/lib/tests/core/UnchangedCommitOptIns.test.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TimeField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Toggle.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/validation/FieldDecorator.ts` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/docs/components/Text.md` |
| Modify | `packages/lib/docs/components/TextField.md` |
| Modify | `packages/lib/docs/components/ComboBox.md` |
| Modify | `packages/lib/docs/components/DateField.md` |
| Modify | `packages/lib/docs/components/TimeField.md` |
| Modify | `packages/lib/docs/components/NumberSpinner.md` |
| Modify | `packages/lib/docs/components/Checkbox.md` |
| Modify | `packages/lib/docs/components/Toggle.md` |
| Modify | `packages/lib/docs/components/Slider.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

E1–E13 are unit-testable under the modelled DOM. "Settled" means the scene was laid out four times at its box. "Forced off" means the same scene with `canSkipUnchangedLayout` spied to `false` on all ten new prototypes. A "position" is the visual one, `getX() + getTranslateX()` and `getY() + getTranslateY()`, as `geometryOf` reads it. E14 is in-engine only.

**The form scene**, used by E7 and E9–E13: a rendered `Container` root with `Fit` at 800×600, holding a `Panel` with `VBox({ stretching: true })`, holding a `LabeledGrid({ columns: 2 })` with one field of each kind, added through `addField` with the titles `"A"`…`"H"`: `TextField`, `ComboBox` (over a two-record `MemoryStore`), `DateField`, `TimeField`, `NumberSpinner`, `Checkbox`, `Toggle`, `Slider({ min: 0, max: 100, value: 50 })`. The `TextField` is then wrapped in a `FieldDecorator`, as `packages/qa/src/builders/form.ts`'s `decorate` does.

**E1. Who opts in.** On a rendered, settled instance, `canSkipUnchangedCommit()` is:

| Instance | Answer |
|---|---|
| `new Text("A")`, `new TextField()` | `true` |
| `new ComboBox({ store })`, `new DateField()`, `new TimeField()`, `new NumberSpinner()` | `true` |
| `new Checkbox()`, `new Toggle()`, `new Slider()` | `true` |
| `new FieldDecorator(field, parent)` | `true` |
| `new Label("A")`, `new Link("A")`, `new SelectableText("A")` (`Text` subclasses) | `false` |
| `new PasswordField()`, `new UsernameField()` (`TextField` subclasses) | `false` |
| `new RadioButton()`, `new DateTimeField()`, `new TextArea()` | `false` |
| `new (class LocalText extends Text {})("A")` | `false` |

**E2. A clamped child that does not move is not laid out again.** A rendered `Container` with `VBox({ stretching: true, spacing: 0 })` and cleared insets, 400×200, over one `Checkbox`. After settling, the checkbox's box is 16×16 although the row is 400 wide. A second `root.doLayout()` calls `Checkbox.doLayout` **zero** times and leaves every rectangle equal to the first pass's. Forced off, it calls it once, with the same rectangles. Without step 2 the opted-in arm also calls it once.

**E3. A clamped child that moves is still laid out.** In E2's scene, add a second leaf of preferred height 30 above the checkbox, settle, then `leaf.setDisplayed(false)` and `root.doLayout()`. The checkbox's y is 0 (was 30) and `Checkbox.doLayout` ran.

**E4. A child resized out of band is laid out.** In E2's scene with the checkbox replaced by a plain `Text("Notes")`, which opts in and carries no `maxSize`: settle, then `text.setHeight(90)` directly, then `root.doLayout()`. The `Text` is back at the height the first pass gave it and `Text.doLayout` ran — the commit moved the box back, so it is not unchanged.

**E5. `Slider` records the pass it ran.** A rendered `Slider` under a `Fit` root, settled. `slider.isLayoutDirty()` is `false`. A second `root.doLayout()` calls `Slider.doLayout` zero times, and the track, active fill and thumb keep their rectangles. Before step 4 `isLayoutDirty()` reads `true` and the slider lays out on every pass.

**E6. A slider's own writes still move the thumb.** On E5's settled slider, `slider.setValue(100)` then `flushFrame()` moves the thumb's x right of its 50-value position. `slider.setMax(200)` then `flushFrame()` moves it back left. `slider.setOrientation("vertical")` then `flushFrame()` swaps the track's axes: its height becomes the slider's inner height and its width the 4-pixel track thickness.

**E7. A settled form pass stops at the fields.** Build the form scene and settle it. Then `grid.invalidateLayout()` and `root.doLayout()`. `doLayout` runs on the root, the `Panel` and the `LabeledGrid` and on **nothing else**: not on any of the eight fields, their inner parts, the eight label `Text`s or the `FieldDecorator`. Forced off, the same step lays out every component in the scene. Every rectangle is identical in both arms.

**E8. Each field's own content change still lays it out.** From the settled form scene, one row at a time, each followed by `flushFrame()`:

| Write | Then |
|---|---|
| `textField.setText("A much longer value than before")` | the field's `<input>` value is the new text and the field's preferred width grew |
| `comboBox.setValue(secondRecordId)` | the combo's label `Text` reads the second record's display value |
| `dateField.setValue(new Date(2026, 8, 19))` | the field's inner input's value is `"2026-09-19"` |
| `numberSpinner.setValue(42)` | the spinner's inner field reads `"42"` |
| `checkbox.setSelected(true)` | `checkbox.isSelected()` is `true` and its check glyph is painted |
| `toggle.setSelected(true)` | the thumb's transform is `translateX(16px)` |
| `slider.setValue(75)` | the thumb's x moved right |

**E9. A decorator's error state needs no pass.** On the settled form scene, `decorator.showError("Required")` leaves the decorated `TextField`'s rectangle unchanged and `decorator.canSkipUnchangedCommit()` `true`; the decorator's outline is set. `decorator.clearError()` clears the outline and again moves nothing. A following `root.doLayout()` lays out neither the decorator nor the field.

**E10. A label's text change still re-flows the grid.** On the settled form scene, the label `Text` for field `"A"` is fetched from the grid and given `setText("A very much longer label")`, then `flushFrame()`. The label is wider than before and every field's x moved right. This is the case the `Text` opt-in must not break: `Text.setText` schedules the label's *parent*, and the grid's pass re-places the columns.

**E11. A `Text` subclass inside the scene still lays out.** Add `grid.addFullWidthRow(new Label("Section"))` to the form scene, settle, then `grid.invalidateLayout()` and `root.doLayout()`. `Label.doLayout` ran, and the eight plain `Text` labels did not.

**E12. A web-font swap re-measures through the skip.** Take the form scene with a cloned font table. Settle. Double every advance (`widenFont`) and call `ThemeManager.setTheme(ThemeManager.getTheme())`, then `flushFrame()` and `root.doLayout()`. Every rectangle equals the forced-off arm's after the same steps, and at least one rectangle differs from before the swap.

**E13. A theme switch lays every opted-in component out once.** On the settled form scene, `ThemeManager.setTheme(t)` where `t` is a `ModernTheme` clone with a larger font size, built as [`tests/component/table/HeaderThemeReflow.test.ts`](packages/lib/tests/component/table/HeaderThemeReflow.test.ts#L68) builds `paddedTheme`, then `flushFrame()`. Every one of the ten opted-in instances has `doLayout` called at least once during that flush, and the following `root.doLayout()` lays out none of them again.

**E14. In-engine (manual, the user's).** The cell list in *Verification*. Geometry is `=` in every run of every cell, and the two form cells read the tabled work reductions.

---

## Verification

From `packages/lib` (implementer):

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint` — clean.
- `npm test` — green, with E1–E13 and every stage-1 and stage-2 case in `UnchangedCommitSkip.test.ts`, `UnchangedCommitOptIns.test.ts`, `ComponentBounds.test.ts`, `CellLayoutSkip.test.ts` and `HeaderColumnWindow.test.ts`. **The suite is not the gate.** All three changes applied at runtime over this checkout left 8,410 of 8,411 tests green; the one failure is the control arm step 3 repairs.[^suite-evidence]
- `npm run build:lib`, then `(cd ../qa && npm test)` — the QA panels still mount under jsdom. This opens no window.
- `npm run docs:api` — the 14 pre-existing warnings and no new one. `npm run docs:llms:check` — clean.
- `grep -rn 'protected canSkipUnchangedLayout' src` — 18 lines (step 5).
- Mutation checks, one at a time, each reverted: reverting step 2's `changed` expression fails E2; reverting step 4 fails E5; dropping any one opt-in fails its E1 row and E7; making `Text`'s or `TextField`'s gate `return true` fails E1's subclass rows.

**In-engine A/B — the acceptance gate. The user runs it, never the implementer.** Every run opens a full-screen MiniBrowser window.

Arms. `wt` is the library at the commit this branch forked from; `main` is this branch with `packages/lib` built. Build the base with the README recipe ([`packages/qa/README.md:86`](packages/qa/README.md#L86)), from the repository root:

```sh
git worktree add .worktrees/_g9f-base <base-sha> --detach
ln -sfn "$PWD/node_modules" .worktrees/_g9f-base/node_modules
(cd .worktrees/_g9f-base/packages/lib && npm run build:lib)
(cd packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g9f-base/packages/lib"
```

Run each cell as `wt-a, main-1, wt-b, main-2, wt-c`, with `work=1&seam=1&geom=1` on every run, exactly as stage 2's A/B did, and read each with `python3 packages/qa/bin/qa-table.py packages/qa/results g9f-<cell>- --work`. **bracket** is the largest `wt` average minus the smallest; **Δms** is the mean of the two `main` averages minus the mean of the three `wt` averages, a win below −bracket and a regress above +bracket.

**Scored cells.** The `main` column is the offline measurement's ratio applied to whatever the cell's own `wt` arm reads, because the base is a different commit from the one stage 2 measured against.

| Cell | Query | `main` work/u | Engagement (`wt` → `main`, per unit) |
|---|---|---|---|
| `ffq` | `panel=form-flat&passes=form&drive=passes` | **0.34 × `wt`** (−66%) | `doLayout@Text` 64 → 0, `@TextField` 8 → 0, `@ComboBox` 8 → 0, `@ComboBoxLabel` 16 → 0, `@ComboBoxCaret` 8 → 0, `@ComboBoxCaretGlyph` 8 → 0, `@DateField` 8 → 0, `@TimeField` 8 → 0, `@PickerInput` 16 → 0, `@PickerButton` 32 → 0, `@NumberSpinner` 8 → 0, `@NumberSpinnerField` 8 → 0, `@SpinButtonUp` 8 → 0, `@SpinButtonDown` 8 → 0, `@Checkbox` 8 → 0, `@CheckboxBox` 8 → 0, `@CheckboxCheckGlyph` 8 → 0, `@CheckboxDash` 8 → 0, `@Toggle` 8 → 0, `@ToggleTrack` 8 → 0, `@ToggleThumb` 8 → 0, `@FieldDecorator` 8 → 0, `@ButtonIconGlyph` 48 → 0, `@ButtonLabelText` 48 → 0, `@Component` 56 → 0; `@LabeledGrid` 1 and `@Panel` 1 unchanged |
| `fnq` | `panel=form-nested&passes=form&drive=passes` | **0.44 × `wt`** (−56%) | as `ffq`, except that the inspector's own header menu button stays: `@Component` 57 → 1, `@ButtonIconGlyph` 49 → 1, `@ButtonLabelText` 49 → 1. `@LabeledFieldSet` 8, `@LabeledGrid` 8, `@Panel` 2, `@Table` 1 and `@TableHeaderMenuButton` 1 unchanged |
| `ffh` | `panel=form-flat&passes=header&drive=passes` | below `wt` | M23's 160 size queries per header pass **unchanged**; `doLayout@Text` 8 → 0, `@TextField` 8 → 0 |
| `sdq` | `panel=shell-deep&drive=passes` | within bracket of `wt` | no counter moves — the shell already skips at `Panel` |
| `ssq` | `panel=shell-shallow&drive=passes` | within bracket of `wt` | as `sdq` |
| `sdr` | `panel=shell-deep&drive=resize` | within bracket of `wt` | as `sdq` |
| `ssr` | `panel=shell-shallow&drive=resize` | within bracket of `wt` | as `sdq` |
| `cdq` | `panel=chart-dashboard&drive=passes` | within bracket of `wt` | as `sdq` — the commit rule meets the chart's cells |

**Gate-only cells.** No work or time expectation; read for geometry and for the pinned counters named.

| Cell | Query | Read |
|---|---|---|
| `ffd` | `panel=form-flat&passes=date&drive=passes` | M24's `doLayout` sum falls from 10; record the new figure for the README |
| `ffc` | `panel=form-flat&passes=combo&drive=passes` | M25's `seam.sink.apply` 7 may fall; record the new figure |
| `ffy` | `panel=form-flat&type=text&drive=type` | `geometry.tooltip` keeps its rectangle (C21 stays fixed) |
| `ffu` | `panel=form-flat&drive=update` | `checkbox.action` and `slider.action` stay 0 (C40 stays fixed) |
| `ffp` | `panel=form-flat&drive=pan` | `slider.action` unchanged; geometry `=` |
| `ffk` | `panel=form-flat&click=toggle&drive=click` | `checkbox.action` 0.50 per unit, as before |
| `sdh` | `panel=shell-deep&drive=drag` | geometry `=` |
| `sd4m` | `panel=shell-deep&n=4&drive=theme:10` | geometry `=` |
| `ss4m` | `panel=shell-shallow&n=4&drive=theme:10` | geometry `=` |
| `tr` | `panel=table-rows&drive=passes` | geometry `=` — the commit rule meets `Cell` |
| `tn` | `panel=tree-nodes&drive=passes` | geometry `=` |
| `wq` | `panel=windows&drive=passes` | geometry `=` |

**Pass criteria:**

1. `geom` is `=` for every run of all 20 cells. A cell whose three `wt` runs disagree is unstable and is re-run.
2. `ffq` and `fnq` land within 10 percentage points of their tabled ratio, and every engagement counter listed for them reaches 0.
3. No scored cell reads `regress`. `ffq` and `fnq` read `win`.
4. `ffd` and `ffc` are recorded with their new figures; a fall is expected and is not a failure.

A geometry `DIFF` anywhere stops the plan until the writer behind it is found and closed. Narrowing the opt-in list until the symptom goes away is not a fix — that is stage 1's rule. Record the readings in this plan's *Implementation Notes*.

---

## Documentation Impact

- **[`docs/concepts/layout-system.md`](packages/lib/docs/concepts/layout-system.md#L31), *The write is diffed*.**
  - Replace "Whether the rectangle changed is read back from the child after its size setters ran rather than taken from the request, so a clamp that moves the box, or a box resized out of band since its last commit, still lays out" with the before-versus-after rule: the pass is withheld when the child's committed rectangle is the same after the write as before it, so a child whose own `maxSize` clamps the rectangle it is handed is not re-laid-out for that clamp alone, while a box resized out of band since its last commit still lays out because the write moves it back.
  - Extend the opted-in list with `Text` itself (not its subclasses), `TextField` itself (not its subclasses), `ComboBox`, `DateField`, `TimeField`, `NumberSpinner`, `Checkbox`, `Toggle`, `Slider` and `FieldDecorator`.
- **`docs/components/Text.md`, `TextField.md`, `ComboBox.md`, `DateField.md`, `TimeField.md`, `NumberSpinner.md`, `Checkbox.md`, `Toggle.md`, `Slider.md`.** Add a `## Notes` bullet in the shape of `LabeledGrid.md`'s: the component is not re-laid-out when re-committed at the rectangle it already holds, its own writers that still lay it out, and — for `Text` and `TextField` — that a subclass keeps the default until it overrides the gate itself.
- **`docs/reference/changelog/next.md`.**
  - *Changed → Layouts*: one bullet for `commitBounds`'s new "unchanged" rule.
  - *Changed → Components*: one bullet for the nine component opt-ins, and one for `Slider.doLayout` now recording its pass.
  - *Changed → Validation*: one bullet for `FieldDecorator`.
- **`docs/reference/migration/next.md`.** Extend stage 2's "A `Panel` re-committed at its own rectangle is not re-laid-out" section with the form controls, in the same *What changed and why* / *Who needs to act* shape. *Who needs to act*: code that changes a field's intrinsic size from outside the library without `setPreferredSize` or `notifyIntrinsicSizeChanged`, and relied on an unrelated later pass to pick it up.
- **`packages/qa/README.md`'s `form-flat` and `form-nested` rows.** After the in-engine run, record the new `ffq` / `fnq` figures and the re-measured M24 and M25 readings alongside the existing wave-3 entries. This is the user's step, not the implementer's.
- **No export, barrel, `llms.txt` or sidebar change.** The overrides are `protected` and render nowhere.

---

## Potential Challenges

- **The commit rule is global.** Every manager commits through `commitBounds`, so the change reaches `Cell`, `MenuBar`, `ToolBar`, `Panel`, `Header` and `StatusBar` as well. The offline suite and the shell, chart, table and tree cells in *Verification* are there to catch a regression it causes elsewhere.
- **`Slider.doLayout`'s new `super.doLayout()` runs an `Absolute` pass over the slider's two registered children before the hand placement.** `Absolute` places each at its current position with its preferred-or-current size, which for the track and thumb is where the slider puts them anyway; E5 and E6 pin that the geometry is unchanged.
- **The two changes in step 2 and step 4 cost work on their own.** Neither is a win until the matching opt-in lands, and step 4 costs 248 work units per `form-flat` pass until `Slider` opts in. Land steps 2, 4 and 5 in one change.
- **Exact-class gates and the `callable()` Proxy.** Compare `Object.getPrototypeOf(this)` with the class's `prototype`, as `Panel` does. `instanceof` would opt every subclass in and `new.target` is the Proxy.
- **Stage 2's E2 control arm.** It spies only the four stage-2 prototypes; left alone it fails as soon as `Text` opts in. Step 3 is not optional.
- **`docs:api` links.** `canSkipUnchangedCommit` and `markPassOwedAbove` are `@internal` and must be described in prose, not linked.

---

## Critical Files

- [`plans/implemented/unchanged-commit-opt-ins.md`](plans/implemented/unchanged-commit-opt-ins.md) — stage 2's decisions, its closures table, its writer audit and its *Implementation Notes*.
- [`plans/implemented/unchanged-commit-skip-staged.md`](plans/implemented/unchanged-commit-skip-staged.md) — the contract, and the owed-pass helper `markPassOwedAbove`.
- [`core/Component.ts:4456-4545`](packages/lib/src/typescript/lib/core/Component.ts#L4456) — `applyBounds`, `canSkipUnchangedLayout`, `canSkipUnchangedCommit`, `markPassOwedAbove`; [`:4555`](packages/lib/src/typescript/lib/core/Component.ts#L4555) `writeBounds`, the precedent for the new commit rule; [`:7951`](packages/lib/src/typescript/lib/core/Component.ts#L7951) `doLayout`, which records the dirty flag and the text-metrics generation.
- [`layout/LayoutManager.ts:596-646`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L596) — `commitBounds`.
- [`core/Panel.ts:610`](packages/lib/src/typescript/lib/core/Panel.ts#L610) and [`component/container/LabeledGrid.ts:211-234`](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L211) — the exact-class gate and the override doc-comment shape.
- [`component/input/Slider.ts:445-520`](packages/lib/src/typescript/lib/component/input/Slider.ts#L445) — `doLayout`; [`:690-748`](packages/lib/src/typescript/lib/component/input/Slider.ts#L690) `applyValue` / `applyOrientation`, which schedule the slider.
- [`component/input/Toggle.ts:369`](packages/lib/src/typescript/lib/component/input/Toggle.ts#L369) and [`component/input/AbstractPickerField.ts:249`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L249) — the `super.doLayout()`-then-place shape `Slider` adopts.
- [`validation/FieldDecorator.ts`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts) — the whole class; it is 100 lines.
- [`packages/qa/src/builders/form.ts`](packages/qa/src/builders/form.ts) — what `form-flat` and `form-nested` are built from, and the scene E7's fixture mirrors.
- [`plans/research/render-review-2026-09-15/97-w3-implementation-measurement.md`](plans/research/render-review-2026-09-15/97-w3-implementation-measurement.md#L152) — stage 2's in-engine reading on the two form cells.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), *Size constraints: who is responsible for what* — a withheld pass must never leave a child placed against a rectangle it no longer holds.

---

## Non-Goals

- **The `Button` family.** Still stage 2's stated next stage. Its glyphs and labels are withheld here only because the field above them skips; a toolbar button is untouched.
- **`Text`'s and `TextField`'s subclasses**, `RadioButton`, `DateTimeField`, `FileField`, `TextArea`, `AutoCompleteField`. Each needs its own audit and no measured cell needs it.
- **`AbstractPickerField`, `AbstractInput`, `AbstractBooleanInput` as opt-in points.** Opting in at an abstract base would opt in subclasses this plan did not audit; the concrete fields opt in instead.
- **`Table` and its rows and cells.** `Cell` already has its own economy, and opting the table's classes in changes `form-nested`'s geometry.
- **Making `Text` announce a re-measure upward**, and a gate in `TabBar.placeStrip`. Both remain stage 1's non-goals for the same reasons.
- **`Row.doLayout`'s missing `super.doLayout()`.** The same defect as `Slider`'s, in `component/table/Row.ts`. It is not on the form path and the table has its own layout economy, so it is left to whoever takes the table next.
- **Flipping the base default.** Each opt-in is still bought with an audit.

---

## Addendum: Where the settled form pass's work goes

**Method.** The QA app's `form-flat` and `form-nested` builders were rebuilt against the library's modelled DOM, mounted in a real `Body` with `Fit`, and settled. The engine's `passes` driver runs each unit as one synchronous `target.doLayout()` with no animation frame between units, and a settled form's field containers owe a pass on every one of them, so the probe marks the fields' own `LabeledGrid`s with `invalidateLayout()` before each measured pass. It then counts, over one pass, the six methods that make up nearly all of the harness's `work` count — `doLayout`, the three size hints, `beginSizeHintRecord` and `getLaidOutComponents` — and digests every component's visual rectangle.

The model tracks the engine closely. With the skip disabled entirely it reproduces the engine's pre-stage-1 `doLayout` census for `form-nested` exactly — `Text` 72, `TextField` 16, `LabeledGrid` 9 — and its work total to within 13%. With the shipped opt-ins it reproduces stage 2's measured engagement, `LabeledGrid` 9 → 8 and `TextField` 16 → 8, and `form-nested`'s work to within 1.4% of the wave tip's 11,290.

**Work per settled pass, by arm.** Geometry was compared with the skip-disabled arm in every row.

| Arm | `ffq` work | `ffq` `doLayout` | `fnq` work | `fnq` `doLayout` | geometry |
|---|---|---|---|---|---|
| skip disabled | 10,254 | 443 | 12,152 | 551 | `=` |
| shipped today | 9,452 | 426 | 11,135 | 447 | `=` |
| the ten opt-ins alone | 4,235 | 58 | 5,575 | 79 | `=` |
| the commit rule and the `Slider` fix alone | 9,700 | 450 | 11,383 | 471 | `=` |
| **all three — this plan** | **3,197** | **2** | **4,887** | **23** | `=` |
| every class opted in, with both fixes | 3,197 | 2 | 4,778 | 18 | **differs** on `fnq` |

**What each opt-in captures, on `ffq`, before the two fixes.** Each row is that class alone, against the 9,452 the shipped build costs. These single-class arms were measured with the inherited gate, so the `Text` and `TextField` rows are upper bounds for the exact-class form this plan ships: `Text`'s 228 includes the 48 `ButtonLabelText`s a plain-`Text` gate leaves out, and `TextField`'s 432 includes the eight `NumberSpinnerField`s. The rows overlap — a field withheld by its own opt-in withholds its parts too — so they do not sum to the set's total.

| Opt-in | Work avoided | What disappears with it |
|---|---|---|
| `DateField` + `TimeField` | 2,656 | the 16 `PickerInput`s, 32 `PickerButton`s and their glyphs and labels |
| `NumberSpinner` | 1,760 | its inner field, both spin buttons and their glyphs and labels |
| `ComboBox` | 560 | its label, caret and caret glyph |
| `TextField` | 432 | the eight plain text fields |
| `Text` | 228 | the 64 labels |
| `FieldDecorator` | 64 | the eight decorators |
| `Checkbox`, `Toggle`, `Slider` | **0** | nothing — they never skip without the two fixes |

`Checkbox` and `Toggle` are clamped by their own `maxSize` inside a stretched grid cell, so today's request-based test reports a change on every pass: a checkbox is handed 585×16 and commits 16×16, for ever. `Slider` never records that a pass ran, so it is permanently dirty. Those three are what the commit rule and the `Slider` fix unlock, and they are worth another 1,038 work units on `ffq` and 688 on `fnq` on top of the ten opt-ins.

**What is left.** After all three changes a settled `form-flat` pass runs two `doLayout` calls — the scrolling `Panel`'s and the grid's — and 3,195 other counted calls: the grid gathering its 128 children's preferred, minimum and maximum sizes, and the child lists that gathering walks. That gathering is `layout-size-read-economy`'s and the size-report groups' territory, not this gate's.

---

## Addendum: Writer Audit

What each opted-in class's layout reads, and how a change to it reaches a pass. "Relays" means the preferred-size relay (`setPreferredSize` → the parent's `scheduleLayout()` → every ancestor's). "Own pass" means the change queues the component or a descendant.

**Every class (the generic writers), as stage 1 and stage 2 established.** Adding, inserting, removing or moving a child schedules the container and relays. `setInsets` / `clearInsets`, `setLayoutManager`, `sortComponents`, `setLayoutConstraints`, a child's `setDisplayed`, the container's padding and border, `removeAllComponents` and the layout managers' configuration setters each mark the layout owed. A descendant's `invalidateLayout`, first-layout drain or size-stable move marks every opted-in ancestor. A theme switch or font swap re-measures through the text-metrics condition in `canSkipUnchangedCommit`.

**`Text` (a plain instance).** It has no `doLayout` override and no children, so its own pass places nothing; its default `Absolute` manager runs over an empty child list. Its text, font, writing mode, alignment and wrapping all schedule its *parent*, whose pass re-places it, and a width change re-measures a wrapping run inside `setWidth` before the parent reads the new preferred height. Nothing it can be told changes where its own pass would put anything.

**`TextField`.** No `doLayout` override: its inner `<input>` is DOM, not a child component. Its single-line box height is pushed through `AbstractInput.applySingleLineBox` → `setPreferredSize` (relays) on every theme change. Text, placeholder, read-only and enabled state are attribute writes.

**`ComboBox`.** `doLayout` reads the content box and `ComboBoxCaret.getCaretSize()`, and places the label and caret. The caret size is the field's text font size, which changes only with the theme, and that path re-measures. `setValue` and the store's changes write the label's text (own pass on the label, relay on a width change). The dropdown is an overlay, outside the field's own layout.

**`DateField` and `TimeField`.** `AbstractPickerField.doLayout` reads the content box alone and places the inner input and the picker button, then calls the button's own `doLayout` directly, so the button's gate cannot withhold it. `setValue`, typing and the picker's commit write the inner input's value. `updateHeight` goes through `applySingleLineBox` (relays). The dropdown is an overlay.

**`NumberSpinner`.** No `doLayout` override: its inner field and two spin buttons are laid out by its manager. `setValue`, `setMin`, `setMax` and `setStep` write the inner field's text (own pass, relay on a width change).

**`Checkbox`.** No `doLayout` override: its box, check glyph and dash are laid out by its manager. `setSelected` and the indeterminate state swap CSS classes on already-placed children.

**`Toggle`.** `doLayout` calls the base and then nudges an optional label by the track's centre offset. `setSelected` writes the thumb's transform and the track's class; neither is a layout input. A label's own text change schedules the toggle (own pass).

**`Slider`.** `doLayout` reads the content box, `value`, `min`, `max` and the orientation. `setValue`, `setMin`, `setMax` and `setStep` all route through `applyValue`, which calls `scheduleLayout()`. `setOrientation` routes through `applyOrientation`, which rewrites the preferred and maximum sizes and calls `scheduleLayout()`. After step 4 the pass is recorded, so the flag means what the gate reads it to mean.

**`FieldDecorator`.** A `Fit` over exactly one child, with cleared insets. `showError` and `clearError` write a CSS `outline` and attach or detach a tooltip; an outline renders outside the box model and takes no layout space, and a tooltip is an overlay. Its preferred size is copied from the field once, at construction, before it is added.

**The one remaining caveat, as for `MenuBar`, `ToolBar` and the stage-2 four.** A custom component whose intrinsic size changes without `setPreferredSize` or `notifyIntrinsicSizeChanged` is not re-flowed inside an opted-in ancestor until that ancestor moves or something schedules it.

---

## Notes

[^why-forms-missed]: Stage 2's plan predicted 84% on both form cells. That figure came from W3.0's `g09.all` ablation, which opted **every** class in, so it measured a ceiling nobody was going to ship. The classes stage 2 actually shipped are containers, and a container cannot skip while anything beneath it owes a pass. In a form the field grid always owes one, so stage 2's reach into a form pass was the header grid and nothing else: `doLayout@TextField` 16 → 8, `@Text` 72 → 64, `@LabeledGrid` 9 → 8. Stage 2's own *Implementation Notes* also record that `g09.all` now measures headroom over the shipped opt-ins rather than an absolute ceiling, because a class shipping its own override shadows the ablation's patched base gate. This plan therefore takes none of its numbers from `g09.all`; the offline probe in *Addendum: Where the settled form pass's work goes* measures each candidate set directly.

[^measurement]: The full method, the arm-by-arm table and the per-class attribution are in *Addendum: Where the settled form pass's work goes*. The model reproduces stage 2's measured in-engine engagement on both form panels and `form-nested`'s work total to within 1.4% of the wave tip's reading, which is what makes the ratios in *Verification* usable as expectations.

[^where-the-work-is]: A settled `form-flat` pass today runs `doLayout` on the scrolling `Panel`, the fields' `LabeledGrid` and 424 components inside the fields: 64 label `Text`s, eight of each field kind, and every inner part — 48 button icon glyphs, 48 button label texts, 32 picker buttons, 16 picker inputs, 16 combo labels, and the boxes, tracks, thumbs and glyphs of the boolean controls. The header grid is the only thing stage 2's opt-ins reach, and it is 17 of the 443 the unskipped pass runs. Opting the containers in further cannot help: the grid owes a pass on every unit, so it lays out whatever its gate says. Opting the fields in does help, because a child's commit is tested one child at a time — a container that must lay out still withholds every opted-in child it hands an unchanged rectangle.

[^commit-rule]: `Component.writeBounds`, which `applyBounds` and `setBounds` share, already reports "changed" as `this._left !== px || this._top !== py || this._width !== pw || this._height !== ph` — the committed rectangle before the write against the committed rectangle after it. `commitBounds` instead computes `mayBeUnchanged` from the request against the child's current box, and only then reads back. The two rules agree except when a setter clamps: `setWidth` clamps to the component's own `maxSize`, so a `Checkbox` handed 585×16 keeps 16×16 and `sizeUnchanged` is `false` on every pass for ever. Reading before against after answers the question the gate actually asks — did this child end up somewhere other than where it already was — and is strictly more accurate, since an out-of-band resize is still caught by the write moving the box back. Three alternatives were considered and dropped: comparing the request against the *clamped* request (needs the clamp arithmetic duplicated at the call site), caching the last committed request per child (per-instance state the staged design has avoided throughout), and leaving the rule alone and excluding `Checkbox` and `Toggle` from the opt-in list (leaves 1,038 work units per `ffq` pass on the table and leaves the same trap for every future fixed-size control).

[^fast-path]: `canFastPath` keeps the request-based `sizeUnchanged`, so a clamped child — whose request and box differ by definition — still never takes the translate fast path. Switching the fast path to the before-versus-after test would newly promote clamped children to a transform on every move, which is a separate change with its own paint and memory consequences and no measured cell asking for it.

[^slider]: `Component.doLayout` is the only place the dirty flag is cleared and the text-metrics generation recorded, and both are guarded on the component having an element. `Slider.doLayout` never reaches it, so `isLayoutDirty()` is `true` for every `Slider` for the whole life of the page, and `canSkipUnchangedCommit` returns `false` whatever the gate says. A library-wide scan found exactly two component classes whose `doLayout` never calls the base: `Slider` and `component/table/Row.ts`. Adding a protected "record the pass" helper on `Component` for the two of them was considered and dropped: `Toggle` and `AbstractPickerField` already show the shape — call the base, then place by hand — and a second way to record a pass is a second thing to keep in step with the gate. `Row` is left alone here because it is not on the form path and the table has its own economy.

[^exact-class]: `Text` is extended by `Label`, `Link`, `SelectableText`, `Legend`, `ButtonLabelText`, `ListItemMarkerText`, `PickerDayHeader`, `PickerMonthLabel`, `PickerDay`, `PickerColumnHeader` and `PickerCell`; `TextField` by `PasswordField`, `UsernameField`, `NumberSpinnerField` and `AutoCompleteTextField`. An inherited opt-in would make every one of them skip on the strength of an audit of the base alone, and `ButtonLabelText` in particular belongs to the `Button` stage. The exact-class check confines the claim to the class that was audited, exactly as `Panel`'s does, and a subclass opts in by overriding the gate after its own audit. The measured work needs nothing more: every label a form grid builds is a plain `Text` (`LabeledGrid.addField` constructs `new Text(title)`), and a `NumberSpinnerField` is withheld anyway because the `NumberSpinner` above it skips first. The other eight classes have no library subclass at all, so they return `true` and follow `MenuBar`, `ToolBar`, `LabeledGrid`, `Header` and `StatusBar`.

[^table-breaks]: The offline probe's "every class opted in" arm is the only arm whose geometry differs from the no-skip arm, and it differs only on `form-nested`, whose inspector is a `Table`. That arm is 109 work units cheaper than this plan's set on `fnq` and identical on `ffq`, so the table's classes are 2% of the cell for a broken rectangle. This plan's set holds geometry on both panels in every arm measured.

[^suite-evidence]: All three changes were applied to the prototypes at runtime over this checkout, through a scratch Vitest setup file that edited no source, and the whole suite was run: **8,410 of 8,411 tests green**. The single failure is `UnchangedCommitOptIns.test.ts`'s E2 control arm, which spies `canSkipUnchangedLayout` to `false` on the four stage-2 prototypes only and so stops being a no-skip arm once `Text` opts in — step 3 repairs it. The commit rule alone, with no opt-in and no `Slider` change, was also run against the whole suite and left **all 8,411 green**. A second apparent failure, `component/input/focusRing.test.ts`, was reproduced by a setup file that only *imports* the input modules and patches nothing, so it is an artefact of importing them before the test registers its capture, not a consequence of any change here.
