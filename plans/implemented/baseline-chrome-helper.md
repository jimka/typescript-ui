# Baseline Chrome Helper — Refactor Plan

## Overview

Several `getBaseline()` overrides repeat the same chrome-wrapping arithmetic. Extract it into a single protected helper on `Component` so subclasses no longer hand-write the formula.

The current pattern, repeated across composite components ([Button.ts:100](../src/typescript/Base/component/Button.ts#L100), [Header.ts:91](../src/typescript/Base/component/Header.ts#L91), [RadioButton.ts:69](../src/typescript/Base/component/RadioButton.ts#L69), and the same shape inside `NumberSpinner` and `AutoCompleteField`):

```typescript
return this.getInsets().getTop() + this.getBorderSize().top + childBaseline;
```

CSS-rendered leaves do the equivalent with CSS padding instead of framework insets ([TextInput.ts:35-40](../src/typescript/Base/component/TextInput.ts#L35-L40), [ComboBox.ts:82-84](../src/typescript/Base/component/ComboBox.ts#L82-L84)):

```typescript
return this.getBorderSize().top + paddingTop + Util.measureInputBaseline();
```

Both cases are instances of the same formula:

```
outerBaseline = insets.top + border.top + paddingTop + innerBaseline
```

Composites have `padding=0`; leaves have `insets=0` (default). One helper covers both.

---

## Architecture Decisions

### Helper on `Component`, not on the layout manager

The user originally asked whether this should live on the layout manager. It shouldn't:

- Layout managers already add the **parent's** `insets` at placement time. The chrome being added inside `getBaseline` is the **child's own** chrome — the offset from the child's outer top to its inner content. That is intrinsic to the child.
- Moving it to the layout manager would require children to expose a separate `getInnerBaseline()` API and would force the layout to query each child's `getInsets()`, `getBorderSize()`, and `getPadding()` directly. Same arithmetic, split across two layers, with child internals exposed to layout code.

A protected helper on `Component` keeps composition local to the component.

### Helper, not auto-wrap in `Component.getBaseline`

Auto-wrapping a stored `baseline` field inside `Component.getBaseline` was considered and rejected:

- Composite-delegating components compute their inner baseline from a child whose value can change (theme/font updates). They would need a second mechanism (delegate field or a re-sync hook) to keep the stored baseline current.
- Subclasses that override `getBaseline` directly (`ProgressBar`'s fixed-from-bottom math, `TextArea`/`List` returning `null`) would need to opt out of the auto-wrap.

A helper that subclasses *call* from their existing override is less magical and matches the codebase's style (similar to `setElementCSSRule`, `getBorderSize`, etc.).

### Keep the `null` short-circuit in the helper

All five sites currently include `if (childBaseline === null) return null;`. The helper centralises that check so subclasses just write `return this.wrapInnerBaseline(inner);`.

### `Padding` is included; `Insets` is included

Both contribute to where the inner content visually sits relative to the outer top — `Padding` via CSS, `Insets` via framework layout. Existing call sites use one or the other (never both), so unifying them in the helper is safe and incidentally fixes a latent inaccuracy: a `Text` component with explicit `Padding` would today report a baseline that ignores the padding. Through the helper that becomes correct without changing `Text`.

---

## Public API (TypeScript Signatures)

### `Component`

```typescript
/**
 * Wraps a chrome-relative inner baseline with this component's outer chrome.
 *
 * @param inner - The baseline measured from the inner content top (inside
 *                border, padding, and framework insets), or `null` when the
 *                component has no meaningful baseline.
 * @returns The visual baseline measured from the component's outer top, or
 *          `null` when `inner` is `null`.
 *
 * @remarks Adds `insets.top + border.top + padding.top` to `inner`. Use when
 * implementing `getBaseline()` on a composite component (delegating to a child)
 * or a CSS-rendered leaf (delegating to `Util.measureInputBaseline()`).
 */
protected wrapInnerBaseline(inner: number | null): number | null;
```

No other public API changes.

---

## Implementation Steps

### 1. Add the helper to `Component`

[src/typescript/Base/Component.ts](../src/typescript/Base/Component.ts) — add the helper near `getBaseline()`:

```typescript
protected wrapInnerBaseline(inner: number | null): number | null {
    if (inner === null) {
        return null;
    }

    const padding    = this.getPadding();
    const paddingTop = padding ? padding.getTop() : 0;

    return this.getInsets().getTop()
         + this.getBorderSize().top
         + paddingTop
         + inner;
}
```

### 2. Migrate composite-delegating overrides

For each of the following, replace the body of `getBaseline()` with a single line calling `wrapInnerBaseline(child.getBaseline())`:

- [Button.ts:94-101](../src/typescript/Base/component/Button.ts#L94-L101) — delegates to `this.text`
- [Header.ts:85-92](../src/typescript/Base/component/Header.ts#L85-L92) — delegates to `this.text`
- [RadioButton.ts:63-70](../src/typescript/Base/component/RadioButton.ts#L63-L70) — delegates to `this.label`
- [NumberSpinner.ts](../src/typescript/Base/component/NumberSpinner.ts) — delegates to its inner `TextField`
- [AutoCompleteField.ts:154-161](../src/typescript/Base/component/AutoCompleteField.ts#L154-L161) — delegates to `this.textField`
- [MenuItem.ts](../src/typescript/Base/component/MenuItem.ts) — verify it follows the same pattern; migrate if so
- [AutoCompleteItem.ts](../src/typescript/Base/component/AutoCompleteItem.ts) — same

Final form:

```typescript
getBaseline(): number | null {
    return this.wrapInnerBaseline(this.text.getBaseline());
}
```

### 3. Migrate CSS-rendered leaf overrides

- [TextInput.ts:35-40](../src/typescript/Base/component/TextInput.ts#L35-L40)
- [DateField.ts](../src/typescript/Base/component/DateField.ts) — same pattern as `TextInput`
- [TimeField.ts](../src/typescript/Base/component/TimeField.ts) — same pattern as `TextInput`

Final form:

```typescript
getBaseline(): number | null {
    return this.wrapInnerBaseline(Util.measureInputBaseline());
}
```

The helper supplies `border.top + paddingTop + insets.top` (insets is 0 by default for these). The current code adds `border.top + paddingTop` explicitly; equivalent output.

### 4. Migrate the empirical-offset variant

[ComboBox.ts:82-84](../src/typescript/Base/component/ComboBox.ts#L82-L84) keeps its `+1` empirical offset by folding it into the inner argument:

```typescript
getBaseline(): number | null {
    return this.wrapInnerBaseline(1 + Util.measureInputBaseline());
}
```

### 5. Leave alone

- [ProgressBar.ts:75-79](../src/typescript/Base/component/ProgressBar.ts#L75-L79) — `size.height - 2` is fixed-from-bottom math; helper isn't a fit. Keep the override as-is.
- [TextArea.ts:42-44](../src/typescript/Base/component/TextArea.ts#L42-L44) and [List.ts:44-46](../src/typescript/Base/component/List.ts#L44-L46) — return `null` directly. No change.
- `Text` does not override `getBaseline()`; it calls `setBaseline(measured.baseline)` and `Component`'s default getter returns the stored field. No change. (Note: if a future caller sets `Padding` on a `Text` instance, the existing `Component.getBaseline()` would not pick it up. That bug is out of scope here; flag it in a follow-up if it bites.)

---

## Verification

### Visual / functional

The refactor must be a no-op visually. Verify on the existing demo panels:

- [HBoxPanel.ts](../src/typescript/HBoxPanel.ts) — exercises mixed text/input/button/radio rows
- [BindingPanel.ts](../src/typescript/BindingPanel.ts) — exercises ComboBox, TextField, Checkbox, DateField, TimeField alongside `Text` labels
- [MiscPanel.ts](../src/typescript/MiscPanel.ts) — exercises NumberSpinner, RadioButton, ProgressBar, ProgressSpinner alongside `Text` labels
- [ComplexUIPanel.ts](../src/typescript/ComplexUIPanel.ts) — broader composite mix
- [GridPanel.ts](../src/typescript/GridPanel.ts) and [ColumnPanel.ts](../src/typescript/ColumnPanel.ts) — verify baseline alignment in non-stretching mode is unaffected

For each panel: run `npm run dev`, open in a browser, and visually confirm baseline alignment is unchanged. Toggle the active theme to a 50px font (or any test theme) and confirm baselines still align across components.

### Build / docs

- `npx tsc --noEmit` — should report no new errors (the two pre-existing `Window.ts` / `table/Table.ts` unused-import errors are unrelated).
- `npm run docs:build` — should report no new errors. (Same caveat about pre-existing errors.)

No documentation changes are required: `getBaseline()` is part of the layout protocol, the helper is `protected`, and no public API surface changes.

---

## Out of scope

- Fixing the latent `Text` + `Padding` baseline inaccuracy (separate concern; unobserved in practice).
- Resolving the residual ±1–2px font-size-dependent baseline noise documented at the end of the [baseline-alignment plan](implemented/baseline-alignment.md).
- Changing anything about the layout managers themselves.
