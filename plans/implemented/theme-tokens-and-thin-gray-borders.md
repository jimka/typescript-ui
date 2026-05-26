# Theme Tokens & Thin-Gray Borders — Implementation Plan

## Overview

Unify the border styling of every text-bearing input control (`TextInput` and its picker-field family, `ComboBox`, and the calendar / time / date-time dropdown panels) and the `FieldSet` container under a single set of **theme-managed** border tokens, and add a dedicated **selection-indicator** token whose default is `1px dashed rgb(120, 170, 240)`. The hardcoded `BorderStyle.SOLID` + `width: 1` + `var(--ts-ui-autocomplete-border, ...)` literals currently scattered across nine call sites ([DateField.ts:36](../src/typescript/lib/component/input/DateField.ts#L36), [TimeField.ts:34](../src/typescript/lib/component/input/TimeField.ts#L34), [DateTimeField.ts:38](../src/typescript/lib/component/input/DateTimeField.ts#L38), [AbstractCalendarDropdown.ts:506](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L506), [TimePickerDropdown.ts:67](../src/typescript/lib/component/input/TimePickerDropdown.ts#L67), [ComboBox.ts:75](../src/typescript/lib/component/input/ComboBox.ts#L75), [ComboBox.ts:127](../src/typescript/lib/component/input/ComboBox.ts#L127), [AutoCompleteDropdown.ts:28](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L28), [FieldSet.ts:27](../src/typescript/lib/component/container/FieldSet.ts#L27)) become a single CSS-variable shorthand consumed via `setBorder(string)` ([Component.ts:1169](../src/typescript/lib/core/Component.ts#L1169)).

`TextInput` itself currently sets *no* border ([TextInput.ts:34-38](../src/typescript/lib/component/input/TextInput.ts#L34-L38) — it only writes `backgroundColor` + `borderRadius`). Joining it onto the unified token gives every editable text surface in the framework a consistent thin-gray edge with one theme switch.

The selection-indicator token reuses the existing `AbstractCustomList` `.CustomListRow.focused` outline pattern ([AbstractCustomList.ts:133](../src/typescript/lib/component/list/AbstractCustomList.ts#L133) — `outline: 1px dashed var(--ts-ui-list-row-focus-ring, ...)`) and the table `_updateFocusStyle` outline ([Body.ts:801](../src/typescript/lib/component/table/Body.ts#L801)), but lifts the style + width + colour combination into one shared token (`indicator.selection`) so themes can re-skin every "focused/selected" outline at once. The default colour matches the dark-theme `form.focusRing` (`rgb(120, 170, 240)`); existing per-surface tokens (`list.row.focusRing`, `form.focusRing`) stay as colour-only escape hatches for sites that already differentiate.

---

## Architecture Decisions

### One shared CSS shorthand for the border, not three separate width / style / colour tokens

The picker fields and dropdowns currently inline a `BorderOptions` literal (`{ style: SOLID, width: 1, color: var(...) }`) per call site. Splitting that into three tokens (`input.border.style`, `input.border.width`, `input.border.color`) would force every consumer to reconstruct the `BorderOptions` bag from three theme reads — and `BorderOptions.style` is a `BorderStyle` enum, not a CSS string, which doesn't round-trip through a CSS custom property.

Instead, the new token is a complete CSS border shorthand string (`"1px solid rgb(160, 160, 160)"`) consumed via `setBorder(string)` ([Component.ts:1169](../src/typescript/lib/core/Component.ts#L1169)). The setter already resolves a `var(--…)` reference to the underlying shorthand at write time (line 1170-1179), so the per-side `Border` cache stays populated for layout maths. One token, one consumer line — and the theme retains full control of all three axes.

### Reuse `theme.input.background` as the bucket; add `input.border` + `input.borderHover` siblings

`Theme.input` exists today with a single `background` field ([Theme.ts:72-74](../src/typescript/lib/core/Theme.ts#L72-L74)) and emits `--ts-ui-input-bg`. The new tokens land in the same bucket:

```
theme.input = {
    background    : string;            // existing
    border        : string;            // NEW — full CSS shorthand
    borderHover   : string;            // NEW — full CSS shorthand
};
```

The `--ts-ui-input-bg` / `--ts-ui-input-border` / `--ts-ui-input-border-hover` triple lives together in the same section of `themeToVars` so a theme author finds them as one group. `theme.form.border` (a colour-only token used by `Checkbox` / `RadioButton` / `Slider`) is deliberately left alone — those surfaces compose their own shorthand inline and the colour-only token is the right shape for that.

### Selection indicator is a dedicated top-level `theme.indicator` bucket

The selection-indicator default (`1px dashed rgb(120, 170, 240)`) does not belong under `input.*`, `form.*`, or `list.*` — it is a cross-cutting affordance used by lists (`.CustomListRow.focused`), tables (`_updateFocusStyle` writes `outline: 2px solid var(--ts-ui-focus-ring, ...)`), and any future surface that wants the same "focused cell" mark. Putting it under `indicator.selection` mirrors how `theme.glyph` lives at the top level even though every component uses it.

```
theme.indicator = {
    selection: string;        // NEW — full CSS outline shorthand
};
```

Emits one variable, `--ts-ui-indicator-selection`. The setter call site is `setOutline("var(--ts-ui-indicator-selection)")` or a raw `outline` write inside a `StyleRule.set(...)` — both seam through the existing typed setter / `StyleRule` infrastructure.

### Default colour is `rgb(120, 170, 240)` for *both* themes

Per the brief, the selection-indicator default is `1px dashed rgb(120, 170, 240)` — the dark-theme blue. This is *intentional* and produces visible blue under both backgrounds (the colour reads as bright accent against either white or dark gray). It matches the existing dark-theme `form.focusRing` ([Theme.ts:714](../src/typescript/lib/core/Theme.ts#L714)). The light-theme `form.focusRing` (`rgb(30, 100, 200)`) stays as the *colour-only* fallback for sites that still consume `--ts-ui-focus-ring` directly (`AbstractCustomList` `:focus` ring, `Body._updateFocusStyle`).

### `FieldSet` stops using `GROOVE` — joins the unified thin-gray default

`FieldSet` currently sets `{ style: BorderStyle.GROOVE, width: 1, color: var(--ts-ui-border-color, black) }` ([FieldSet.ts:27](../src/typescript/lib/component/container/FieldSet.ts#L27)). The 3D-bevel `groove` style is a legacy HTML look that clashes with every other surface in the framework. Switching to `var(--ts-ui-input-border)` gives FieldSet the same thin-gray edge as its inputs — and the `<legend>` notch still renders correctly because the browser's notch carve-out works for any `border-style` keyword.

### `PickerButton` stays unaltered

`PickerButton` explicitly clears its border ([PickerButton.ts:22](../src/typescript/lib/component/input/PickerButton.ts#L22)) because it sits *inside* the picker field's own border. Adding a thin-gray border to it would double-draw the right edge. The plan touches the field wrapper, not its glyph button.

### `setInvalid` keeps writing a full `BorderOptions` literal

`AbstractPickerField.setInvalid` ([AbstractPickerField.ts:393-408](../src/typescript/lib/component/input/AbstractPickerField.ts#L393-L408)) toggles between `setBorder(BorderOptions)` (red validation border) and `setBorder(this.getDefaultBorder())`. The `getDefaultBorder()` hook returns a `BorderOptions`, not a string. Two ways to integrate:

1. Change `getDefaultBorder` to return `string` and pass it through `setBorder(string)`. Simpler — the new token is exactly the shorthand string.
2. Keep `getDefaultBorder` returning `BorderOptions` and construct the bag from the token at runtime.

Option 1 is chosen because it matches the new direction (string-shorthand-from-token everywhere) and lets each subclass collapse `getDefaultBorder()` to a single-line return.

### Consumer-facing API surface stays unchanged

This plan exposes zero new public typed setters. Every change is *internal*: the `_defaultXxxOptions` literals collapse to a string, `getDefaultBorder` flips its return type from `BorderOptions` to `string` (still `protected abstract`), and `Theme` gains three fields (`input.border`, `input.borderHover`, `indicator.selection`) plus three CSS variables. No consumer-visible API moves — CODE_CONVENTIONS.md's typed-setter rules ([CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)) do not trigger because no new component property is exposed.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-input-border` | `1px solid rgb(160, 160, 160)` | `1px solid rgb(110, 110, 110)` | Thin-gray default border for `TextInput`, the three picker fields, `ComboBox`, the picker dropdown panels, the autocomplete dropdown, and `FieldSet`. Colour matches the existing `form.border` value for parity with custom controls. |
| `--ts-ui-input-border-hover` | `1px solid rgb(120, 120, 120)` | `1px solid rgb(150, 150, 150)` | Optional hover-state shorthand; not consumed by Step 1 (no hover state is added in this plan), but provisioned now so a follow-up doesn't have to re-touch `Theme.ts`. |
| `--ts-ui-indicator-selection` | `1px dashed rgb(120, 170, 240)` | `1px dashed rgb(120, 170, 240)` | Default selection / focused-cell indicator. The blue is the same in both themes — chosen because the colour reads against both white and dark backgrounds and is the existing dark-theme `form.focusRing` value. |

Bucket layout inside `Theme`:

```typescript
input: {
    background : string;   // existing
    border     : string;   // NEW
    borderHover: string;   // NEW
};

indicator: {              // NEW top-level bucket
    selection: string;    // NEW
};
```

`themeToVars` ([Theme.ts:939](../src/typescript/lib/core/Theme.ts#L939)) gets three new entries — added under the existing `'--ts-ui-input-bg'` line and a fresh `--ts-ui-indicator-*` block placed between `--ts-ui-list-row-separator` and `--ts-ui-dropdown-fade-duration`. Both `DefaultTheme` and `DarkTheme` get the three new fields populated.

---

## Ordered Implementation Steps

### Step 1 — Extend `Theme.ts` with the new tokens

[Theme.ts](../src/typescript/lib/core/Theme.ts):

1. Add `border` and `borderHover` to the `Theme.input` interface (line 72-74).
2. Add a new top-level `indicator` interface block: `indicator: { selection: string }`.
3. Populate `DefaultTheme.input` with the light defaults from the table above (line 440).
4. Populate `DefaultTheme` with `indicator: { selection: '1px dashed rgb(120, 170, 240)' }` (between `dropdown` and `picker` blocks).
5. Populate `DarkTheme.input` with the dark defaults from the table above (line 707).
6. Populate `DarkTheme` with the same `indicator` block (line 896 area).
7. Add three entries to `themeToVars` (line 939-1115): `--ts-ui-input-border`, `--ts-ui-input-border-hover`, `--ts-ui-indicator-selection`.

**Verification checkpoint:** `grep -n "indicator" src/typescript/lib/core/Theme.ts | wc -l` reports at least 6 hits (interface, two themes, themeToVars, plus comments).

### Step 2 — Switch every input/dropdown default to `setBorder("var(--ts-ui-input-border)")`

Per-file changes, in surveyed order:

| File | Line | Old | New |
|---|---|---|---|
| [TextInput.ts](../src/typescript/lib/component/input/TextInput.ts) | 34-38 | (no border) | Add `border: "var(--ts-ui-input-border)"` to `_defaultTextInputOptions`. |
| [ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts) | 75 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts) | 127 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [DateField.ts](../src/typescript/lib/component/input/DateField.ts) | 36 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [TimeField.ts](../src/typescript/lib/component/input/TimeField.ts) | 34 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [DateTimeField.ts](../src/typescript/lib/component/input/DateTimeField.ts) | 38 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [AbstractCalendarDropdown.ts](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts) | 506 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [TimePickerDropdown.ts](../src/typescript/lib/component/input/TimePickerDropdown.ts) | 67 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [AutoCompleteDropdown.ts](../src/typescript/lib/component/input/AutoCompleteDropdown.ts) | 28 | `BorderOptions` literal | `border: "var(--ts-ui-input-border)"` |
| [FieldSet.ts](../src/typescript/lib/component/container/FieldSet.ts) | 27 | `GROOVE` literal | `border: "var(--ts-ui-input-border)"` |

Remove the now-unused `BorderStyle` import from each file where the `BorderOptions` literal was the only consumer. `AbstractPickerField.ts` still imports `BorderStyle` for `setInvalid` — keep it.

**Verification checkpoint:** `grep -rn "BorderStyle.SOLID, width: 1" src/typescript/lib/component/input/ src/typescript/lib/component/container/` returns zero matches (the literal is gone). `grep -rn "var(--ts-ui-input-border" src/typescript/lib` returns the 10 new sites listed above.

### Step 3 — Flip `getDefaultBorder()` from `BorderOptions` to `string`

[AbstractPickerField.ts](../src/typescript/lib/component/input/AbstractPickerField.ts):

- Line 165: change `protected abstract getDefaultBorder(): BorderOptions;` to `protected abstract getDefaultBorder(): string;`.
- Line 406: `this.setBorder(this.getDefaultBorder())` — no call-site change needed (`setBorder` already accepts string).
- Line 10: drop the unused `BorderOptions` import.

Concrete subclasses:

- [DateField.ts:191](../src/typescript/lib/component/input/DateField.ts#L191): `getDefaultBorder(): string { return "var(--ts-ui-input-border)"; }`. Drop `BorderOptions` import.
- [TimeField.ts:218](../src/typescript/lib/component/input/TimeField.ts#L218): same shape.
- [DateTimeField.ts:210](../src/typescript/lib/component/input/DateTimeField.ts#L210): same shape.

**Verification checkpoint:** `npm run build` typechecks cleanly. `grep -rn "BorderOptions" src/typescript/lib/component/input/` returns no matches.

### Step 4 — Wire the new `--ts-ui-indicator-selection` token into existing selection-indicator sites

The token is provisioned in Step 1; this step plugs it into the two sites that already paint a focus/selection outline:

- [AbstractCustomList.ts:133](../src/typescript/lib/component/list/AbstractCustomList.ts#L133): change `outline` value from `"1px dashed var(--ts-ui-list-row-focus-ring, rgb(30, 100, 200))"` to `"var(--ts-ui-indicator-selection, 1px dashed rgb(120, 170, 240))"`. The colour-only `--ts-ui-list-row-focus-ring` token stays in `Theme.list.row` and is still consumed by line 101 (the `.List:focus` surface ring) — no behaviour change there.
- [Body.ts:801](../src/typescript/lib/component/table/Body.ts#L801): the focused-cell outline currently reads `"2px solid var(--ts-ui-focus-ring, ...)"`. The token's purpose is a heavier surface ring (it stays at 2 px solid, not 1 px dashed) — **do not touch this site**. The selection-indicator token is for cell-level / row-level dashed marks; the table's bold 2-px ring is a separate visual idiom. Flag in `## Architecture Decisions` if anyone questions it.

**Verification checkpoint:** `grep -rn "var(--ts-ui-indicator-selection" src/typescript/lib` returns one match (the `AbstractCustomList` rule).

### Step 5 — Documentation

Update `docs/concepts/theming.md` token table:

- Add three rows under the "Form / inputs" section: `input.border` → `--ts-ui-input-border`, `input.borderHover` → `--ts-ui-input-border-hover`, `indicator.selection` → `--ts-ui-indicator-selection`.
- Cross-link the rows from `docs/components/text-field.md`, `docs/components/combo-box.md`, `docs/components/date-field.md`, `docs/components/time-field.md`, `docs/components/date-time-field.md`, `docs/components/field-set.md` (whichever pages exist — verify with `ls docs/components/`).

**Verification checkpoint:** `npm run docs:build` reports 0 errors and 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/lib/component/input/TextInput.ts` |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `src/typescript/lib/component/input/DateField.ts` |
| Modify | `src/typescript/lib/component/input/TimeField.ts` |
| Modify | `src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | `src/typescript/lib/component/input/AbstractCalendarDropdown.ts` |
| Modify | `src/typescript/lib/component/input/TimePickerDropdown.ts` |
| Modify | `src/typescript/lib/component/input/AutoCompleteDropdown.ts` |
| Modify | `src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `src/typescript/lib/component/container/FieldSet.ts` |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` |
| Modify | `docs/concepts/theming.md` |

No files are created or deleted.

---

## Verification

- `npm run build` typechecks cleanly (Step 3 flips a generic-return-type signature; if any sub-subclass mis-typed, this surfaces here).
- `grep -rn "BorderStyle.SOLID, width: 1" src/typescript/lib/component/input/ src/typescript/lib/component/container/` returns zero matches.
- `grep -rn "BorderStyle.GROOVE" src/typescript/lib/` returns zero matches (FieldSet was the lone GROOVE site).
- `grep -rn "var(--ts-ui-input-border" src/typescript/lib` returns the 10 expected sites (Step 2).
- `grep -rn "var(--ts-ui-indicator-selection" src/typescript/lib` returns one site (Step 4 — `AbstractCustomList`).
- Manual smoke: open the `Input` demo screen (`npm run dev`, navigate to the inputs panel) under both themes. Every input field (TextField, PasswordField, DateField, TimeField, DateTimeField, ComboBox) shows the same thin gray edge. FieldSet shows a thin gray border with a notched legend. The `List` demo shows a 1-px dashed blue (`rgb(120, 170, 240)`) outline on the focused row in both themes.
- Theme toggle: invoke `ThemeManager.setTheme(DarkTheme)` from the dev console; every border re-skins from gray-160 to gray-110 in one frame (no full re-render needed, CSS variable cascade).
- `npm run docs:build` — 0 errors and 0 link warnings.

---

## Documentation Impact

- **No new public symbol**: the changes are internal — `getDefaultBorder()` is `protected abstract`, the new `Theme.input.border` / `Theme.input.borderHover` / `Theme.indicator.selection` fields are existing-shape extensions of the `Theme` interface that already lives in the `core` barrel.
- **Theming page** — `docs/concepts/theming.md` gets the three new token rows (Step 5).
- **JSDoc** — the new fields in the `Theme` interface get a brief `@remarks` describing the shorthand contract ("complete CSS border/outline shorthand string, consumed via `setBorder(string)` / `outline: var(...)`").

---

## Critical Files

- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — where the new tokens live.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) lines 1169-1191 — confirm `setBorder` string-with-`var(...)` path.
- [src/typescript/lib/primitive/Border.ts](../src/typescript/lib/primitive/Border.ts) — `Border.fromString` parses the resolved shorthand into a per-side cache for layout reads.
- [src/typescript/lib/component/input/AbstractPickerField.ts](../src/typescript/lib/component/input/AbstractPickerField.ts) lines 165 and 393-408 — `getDefaultBorder` signature flip + `setInvalid` integration.
- [src/typescript/lib/component/list/AbstractCustomList.ts](../src/typescript/lib/component/list/AbstractCustomList.ts) lines 92-135 — module-level `StyleRule` block where the selection-indicator token is consumed.

---

## Non-Goals

- **Not redesigning unrelated component borders.** `Button` / `ToggleButton`, `Slider`, `Checkbox`, `RadioButton`, the menu surfaces (`MenuBar`, `MenuItem`, `MenuSeparator`, `ContextMenu`), `Scrollbar`, `Tooltip`, `Popover`, `Window`, `Table` and its `Header` / `Footer`, `Notification`, `Dialog`, `Accordion`, `Tab` — all keep their current borders untouched. The plan is strictly the listed inputs plus `FieldSet`.
- **Not introducing a hover-state border on the listed inputs.** The `input.borderHover` token is provisioned in `Theme.ts` so a follow-up plan can wire `:hover` rules without touching the theme file again, but no `:hover` rule is added here.
- **Not unifying the existing colour-only border tokens.** `theme.form.border`, `theme.autoComplete.border`, `theme.border.color`, `theme.list.border`, `theme.menuBar.border`, etc. all remain — they have legitimate consumers (the custom form controls, the autocomplete dropdown chrome that has its own shadow recipe, surfaces other than the listed inputs). Consolidating those is a separate, much larger refactor.
- **Not adding new typed setters on `Component`.** No `setInputBorder`, no `setSelectionIndicator` — the existing `setBorder(string)` / `setOutline(string)` / `StyleRule.set("outline", ...)` paths are already the right shape. CODE_CONVENTIONS.md's typed-setter rule does not trigger because no new component property is introduced.
- **Not touching `Body._updateFocusStyle` table cell outline.** It's a heavier 2-px solid ring intentionally distinct from the 1-px dashed selection mark; the new token covers the dashed family only.
