# Cell Value Null Round-Trip — Implementation Plan

## Overview

Standardise every typed renderer + editor pair in the table cell stack to cache a private `_value: T | null` field, preserve `null`/`undefined` through every round-trip, and emit a clean empty display when the cell carries no value. The `Date`, `Time`, `DateTime` pair already follow this shape and are the template; `Number`, `String`, `Glyph`, and `Boolean` reconstruct their value from DOM text on `getValue()` and silently coerce missing values to `0`, `""`, or `false` on the commit path.

The fix targets [`Cell.commitEdit`](../src/typescript/lib/component/table/cell/Cell.ts#L198-L212)'s observation contract: it reads `editor.getValue()`, hands the result to the renderer and to `_onCommit?.(value)`, which is what writes back into `ModelRecord.set(field, newValue)` from [`Row` line 98](../src/typescript/lib/component/table/Row.ts#L98). Whatever the editor returns is what the record stores — so the editor must distinguish "user typed empty" from "user typed `0`".

The visible bug ("undefined" string in number cells) was already patched in the affected renderers' `setValue` methods. The remaining bug is the silent coercion on `getValue()`. This plan does not touch `Cell.commitEdit`, the model schema, or `ColumnConfig`; it changes only the typed renderer + editor pairs.

---

## Architecture Decisions

### `null` is the canonical "no value" sentinel

Both `null` and `undefined` arrive at `cell.setValue` from `record.get(fieldName)` ([Row.ts:65,95,164](../src/typescript/lib/component/table/Row.ts#L65)). The renderer normalises both to `null` in its private `_value` field, mirroring the `DateRenderer` pattern (`this._value = value ?? null` at [renderer/Date.ts:31](../src/typescript/lib/component/table/cell/renderer/Date.ts#L31)). `getValue()` always returns `T | null`; callers receive `null` whenever the cell is empty regardless of which absent-value form was originally supplied. Consumers that depend on the difference can preserve it at the model layer — not the cell layer.

### Widen the generic parameter to `T | null`

`NumberRenderer extends CellRenderer<Number>` becomes `CellRenderer<Number | null>`. Same for `StringRenderer`, `StringEditor`, `NumberEditor`, `GlyphRenderer`, `BooleanEditor`. This matches `DateRenderer extends CellRenderer<Date | null>` and lets `getValue` declare its real return type. The widening is upward-compatible: consumers already pass `record.get(field)` which is typed `any`, and [`Cell<T>`](../src/typescript/lib/component/table/cell/Cell.ts#L25) carries the same `T` through both renderer and editor, so `Cell<Number>` becomes `Cell<Number | null>` at the cell subclasses — see [`NumberCell.setValue`](../src/typescript/lib/component/table/cell/Number.ts#L38) and [`StringCell.setValue`](../src/typescript/lib/component/table/cell/String.ts#L38). The `BooleanCell`, `NumberCell`, `StringCell`, `GlyphCell` wrappers widen by the same step.

### Boolean tri-state renders indeterminate for null

`Checkbox` already supports indeterminate via [`setIndeterminate(value)`](../src/typescript/lib/component/input/Checkbox.ts#L274). `BooleanEditor.setValue(null)` calls `_checkBox.setIndeterminate(true)`; `setValue(true)` / `setValue(false)` clears indeterminate and selects accordingly. `getValue()` returns `null` while indeterminate, `true`/`false` otherwise. User interaction (click) clears indeterminate via the existing `setSelected` path at [Checkbox.ts:215-225](../src/typescript/lib/component/input/Checkbox.ts#L215) — after the first interaction the cell holds a concrete boolean.

This is consistent with the existing `Checkbox` semantics ("WAI-ARIA: user click from mixed first clears the indeterminate") and means `BooleanCell.setOnCommit`'s callback at [Boolean.ts:40-42](../src/typescript/lib/component/table/cell/Boolean.ts#L40) starts receiving `true`/`false`, never `null`, because the indeterminate state is read-only output until the user interacts. The wider `T | null` lives in the renderer cache only.

### Empty input commits `null`

When the user clears a `NumberEditor` and presses Enter, `getValue()` returns `null`. The current `Number(this._textField.getText())` returning `0` for `""` is the bug being fixed. Same for `StringEditor`: empty-string input commits as `null`. Documented as part of the editor JSDoc.

This loses the literal-empty-string round-trip (typing `""` into a previously-`""` cell could commit `null`), but the cells offer no UI to distinguish those cases anyway — empty input is empty input. Consumers who must preserve `""` distinct from `null` should not use `StringEditor`'s default behaviour.

### Number normalisation: `NaN` and unparseable text become `null`

`NumberEditor.getValue()`'s current `Number(this._textField.getText())` returns `NaN` for non-numeric text. NaN never equals itself and is a poor round-trip token. The new implementation parses the text and returns `null` when either empty or NaN; otherwise the parsed `number`.

### `_value` field stays private — no structural compatibility break

The structural-compatibility comment at [CellRenderer.ts:22-26](../src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L22) warns that private members shared between `CellRenderer` and `CellEditor` would break the `BooleanCell` cast (which uses one `BooleanEditor` instance as both renderer and editor). Private TypeScript fields **do not appear in structural types** (they are compared nominally), so adding `private _value: T | null` to subclasses on either side does not affect compatibility between the two base classes. The base classes themselves are not changed; the field lives on the concrete subclass.

`DateRenderer` already proves this pattern works — it carries `private _value: Date | null` and compiles cleanly today.

### `getContentX` mirror unaffected

`getContentX()` is a public method already mirrored across `CellRenderer` and `CellEditor`. Adding private `_value` fields on subclasses does not change the public surface and so does not interfere with the mirror.

### `TreeCellRenderer` propagates unchanged

[`TreeCellRenderer.getValue` / `setValue`](../src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L132-L145) forward to the wrapped delegate. The delegate is one of the renderers we're updating, so `null`/`undefined` semantics propagate automatically. The tree renderer's generic parameter is `T`, written by `Row` at the `wrapRenderer` call ([Row.ts:120](../src/typescript/lib/component/table/Row.ts#L120)) where the delegate is `CellRenderer<any>` — no type change required.

### `HeaderCell` and `DefaultCell` excluded

[`HeaderCell`](../src/typescript/lib/component/table/cell/Header.ts) text comes from the column name, never `null`. `DefaultCell` is the fallback for unknown field types and not part of this round-trip contract. Both stay as-is.

### Editor pool sees no API change

[`CellEditorPool.register`](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L70) takes a factory returning `CellEditor<unknown>`. The factories already produce editors whose `T` is independent — `Number | null` instead of `Number` is invisible to the pool.

---

## Public API (TypeScript Signatures)

### Renderers

```ts
class NumberRenderer extends CellRenderer<Number | null> {
    getValue(): Number | null;
    setValue(value: Number | null): this;
}

class StringRenderer extends CellRenderer<String | null> {
    getValue(): String | null;
    setValue(value: String | null): this;
    getText(): Text;          // unchanged
}

class GlyphRenderer extends CellRenderer<String | null> {
    getValue(): String | null;
    setValue(value: String | null): this;
}
```

### Editors

```ts
class NumberEditor extends CellEditor<Number | null> {
    getValue(): Number | null;
    setValue(value: Number | null): this;
    focus(): this;            // unchanged
}

class StringEditor extends CellEditor<String | null> {
    getValue(): String | null;
    setValue(value: String | null): this;
    focus(): this;            // unchanged
}

class BooleanEditor extends CellEditor<Boolean | null> {
    getValue(): Boolean | null;
    setValue(value: Boolean | null): this;
    toggle(): this;           // unchanged — still commits true/false
    setOnChange(fn: (value: Boolean | null) => void): void;
}
```

### Cells

```ts
class NumberCell  extends Cell<Number | null>  { setValue(value: Number | null):  this; }
class StringCell  extends Cell<String | null>  { setValue(value: String | null):  this; }
class BooleanCell extends Cell<Boolean | null> {
    setValue(value: Boolean | null): this;
    setOnCommit(fn: (value: Boolean | null) => void): void;
}
class GlyphCell   extends Cell<String | null>  { /* inherits Cell<T>.setValue */ }
```

No new typed setters — no new public DOM property is added.

---

## Internal Structure

Cite the `DateRenderer` body as the verbatim template for the four renderers (the formatting call differs per type; the structure is identical):

```ts
class XRenderer extends CellRenderer<X | null> {
    private _text:  Text     = new Text();
    private _value: X | null = null;

    constructor() {
        super();
        this._text.setText("");
        this._text.setPointerEvents("none");
        this._text.setAutoMeasure(false);
        this.addComponent(this._text);
    }

    getValue(): X | null {
        return this._value;
    }

    setValue(value: X | null): this {
        this._value = value ?? null;
        this._text.setText(this._value === null ? "" : this.format(this._value));
        return this;
    }
}
```

For `GlyphRenderer` substitute the glyph-swap logic that already lives at [renderer/Glyph.ts:37-57](../src/typescript/lib/component/table/cell/renderer/Glyph.ts#L37); cache `_value: String | null = null` instead of `_name: String = ""`, treat any falsy input as `null`, and remove the glyph child when `_value === null`.

For the editors (`NumberEditor`, `StringEditor`), cache `_value: T | null` and update it on every input event the same way `DateEditor.onInput` does ([editor/Date.ts:178-189](../src/typescript/lib/component/table/cell/editor/Date.ts#L178)):

```ts
private _value: X | null = null;

constructor() {
    super();
    // existing event wiring …

    Event.addListener(this._textField, "input", () => this.onInput());
}

private onInput(): void {
    const raw = this._textField.getText();
    if (!raw) { this._value = null; return; }
    /* parse raw → set this._value, or null on parse failure */
}

getValue(): X | null {
    return this._value;
}

setValue(value: X | null): this {
    this._value = value ?? null;
    this._textField.setText(this._value === null ? "" : String(this._value));
    return this;
}
```

For `BooleanEditor`:

```ts
private _value: Boolean | null = null;

constructor() {
    super();
    this._checkBox.setIndeterminate(true);
    this.addComponent(this._checkBox);

    this._checkBox.addActionListener(() => {
        this._value = this._checkBox.isSelected();
        this._onChange?.(this._value);
    });
}

getValue(): Boolean | null {
    return this._value;
}

setValue(value: Boolean | null): this {
    this._value = value ?? null;
    if (this._value === null) {
        this._checkBox.setIndeterminate(true);
    } else {
        this._checkBox.setIndeterminate(false);
        this._checkBox.setSelected(this._value as boolean);
    }
    return this;
}

toggle(): this {
    // user-initiated toggle: clears indeterminate, commits concrete boolean
    const next = !this._checkBox.isSelected();
    this._checkBox.setIndeterminate(false);
    this._checkBox.setSelected(next);
    this._value = next;
    this._onChange?.(this._value);
    return this;
}
```

The `_checkBox.addActionListener` callback already fires on click; clicking a mixed-state checkbox transitions to selected via `Checkbox`'s own logic at [Checkbox.ts:172-177](../src/typescript/lib/component/input/Checkbox.ts#L172), so `isSelected()` returns the right value when the listener reads it.

---

## Ordered Implementation Steps

1. **`NumberRenderer`** ([renderer/Number.ts](../src/typescript/lib/component/table/cell/renderer/Number.ts)) — widen generic to `Number | null`; add `private _value: Number | null = null`; rewrite `getValue` to return `_value`; rewrite `setValue` to cache `value ?? null` and set the text to `""` when null. Update JSDoc to declare the null contract.

2. **`NumberEditor`** ([editor/Number.ts](../src/typescript/lib/component/table/cell/editor/Number.ts)) — widen generic; add `_value`; wire an `input` listener that parses the text field into `_value` (`""` → `null`, `NaN` → `null`, otherwise the number); rewrite `getValue` / `setValue` to match.

3. **`StringRenderer`** ([renderer/String.ts](../src/typescript/lib/component/table/cell/renderer/String.ts)) — same shape as step 1, generic `String | null`. Cache `_value`; `getValue()` returns `_value`; `setValue` writes `_value ?? null` and renders `""` when null. The `getText()` accessor returning the `Text` child stays unchanged.

4. **`StringEditor`** ([editor/String.ts](../src/typescript/lib/component/table/cell/editor/String.ts)) — widen generic; add `_value` cache and `input` listener; empty text commits `null`.

5. **`GlyphRenderer`** ([renderer/Glyph.ts](../src/typescript/lib/component/table/cell/renderer/Glyph.ts)) — widen generic to `String | null`; rename internal `_name` to `_value: String | null` (or keep both — `_name` is currently `String`, never exposed publicly; renaming is cleaner). Treat falsy input as `null`; remove the glyph child component when null.

6. **`BooleanEditor`** ([editor/Boolean.ts](../src/typescript/lib/component/table/cell/editor/Boolean.ts)) — widen generic to `Boolean | null`; add `_value: Boolean | null`; rewrite `setValue` to use `setIndeterminate(true)` for null, otherwise clear indeterminate and call `setSelected`; rewrite `getValue` to return `_value`; update `_checkBox.addActionListener` to set `_value = isSelected()` and forward; update `toggle` accordingly. Widen `setOnChange`'s callback signature.

7. **Cell subclasses** — widen generics on [`NumberCell`](../src/typescript/lib/component/table/cell/Number.ts), [`StringCell`](../src/typescript/lib/component/table/cell/String.ts), [`BooleanCell`](../src/typescript/lib/component/table/cell/Boolean.ts), and [`GlyphCell`](../src/typescript/lib/component/table/cell/Glyph.ts) to match their renderer. Update the `setValue` parameter types and `setOnCommit` callback type on `BooleanCell`.

8. **Typecheck checkpoint** — `npx tsc --noEmit -p tsconfig.lib.json`. Expect 0 errors. Any `Cell<T>` call-site error here means a consumer was assuming the narrower type; the only known site is `Row.ts:95,164` which passes `any` and is unaffected.

9. **Docs checkpoint** — `npm run docs:build`. Expect 0 errors. The "unsupported TypeScript version" warning is the lone acceptable warning. Verify no new link warnings (5-warning baseline maximum).

10. **Manual smoke verification** — launch the dev server, drive the "Show window with table!" demo as documented in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/cell/renderer/Number.ts` |
| Modify | `src/typescript/lib/component/table/cell/renderer/String.ts` |
| Modify | `src/typescript/lib/component/table/cell/renderer/Glyph.ts` |
| Modify | `src/typescript/lib/component/table/cell/editor/Number.ts` |
| Modify | `src/typescript/lib/component/table/cell/editor/String.ts` |
| Modify | `src/typescript/lib/component/table/cell/editor/Boolean.ts` |
| Modify | `src/typescript/lib/component/table/cell/Number.ts` |
| Modify | `src/typescript/lib/component/table/cell/String.ts` |
| Modify | `src/typescript/lib/component/table/cell/Boolean.ts` |
| Modify | `src/typescript/lib/component/table/cell/Glyph.ts` |
| Modify | `docs/recipes/custom-cell.md` — update example to show `T \| null` and the null-commit contract |

No deletions. No new files. The renderer/editor/cell base classes and `Cell.commitEdit` stay untouched.

---

## Verification

- `npx tsc --noEmit -p tsconfig.lib.json` — 0 errors.
- `npm run docs:build` — 0 errors and 0 link warnings beyond typedoc's "unsupported TypeScript version" notice.
- **Demo:** open the MiscPanel app at http://localhost:8015 → "Show window with table!" (the button wired at [MiscPanel.ts:195-218](../src/typescript/MiscPanel.ts#L195-L218)). The dataset already contains rows where `col3` (number) is undefined and `col2` (boolean) is undefined.
- **Number round-trip:**
    - Empty `col3` cell renders blank (no `"0"`, no `"undefined"`).
    - Double-click an empty cell → editor opens with a blank input.
    - Press Enter without typing → `record.get('col3')` is still `null`/`undefined`; store dirty flag stays false on that row.
    - Type "42", Enter → cell displays `42`, record stores `42`.
    - Type "42", then clear with Backspace, Enter → record stores `null`.
- **Boolean tri-state:**
    - Empty `col2` cell renders as the indeterminate checkbox (horizontal bar).
    - Click the checkbox → transitions to checked; `record.get('col2')` is `true`; subsequent clicks toggle between `true`/`false` (no return to indeterminate, matching Checkbox's existing behaviour).
    - 100 hide/show cycles of the window with no interaction on the row do not flip the dirty flag.
- **String round-trip:** distinguish or normalise — verify the recipes doc reflects whichever rule was chosen. Default: empty input commits `null`.
- **Glyph round-trip:** A row whose glyph field is undefined renders an empty cell (no glyph component child). `getValue()` returns `null`.

---

## Documentation Impact

- **JSDoc** on every modified renderer/editor/cell `getValue`/`setValue` describing the `null` contract.
- **`docs/recipes/custom-cell.md`** — update the `CurrencyRenderer` and `CurrencyEditor` examples to widen the generic to `number | null` and explicitly handle the null branch in `setValue` and `getValue`. The "Lifecycle hooks" section gains a one-line note: "Empty input commits `null`; consumers must read the bound field as `T | null`."
- **No barrel changes** — every modified class is already exported from [`component/table/index.ts`](../src/typescript/lib/component/table/index.ts).
- **No sidebar changes** — no new pages.
- **Cross-bucket links** — none changed; the affected classes link only inside the `component/table` bucket via `{@link …}` and that still resolves.

---

## Potential Challenges

- **`BooleanCell.setOnCommit` callback signature widening** breaks any consumer that registered `(value: Boolean) => void`. Mitigation: search-grep `setOnCommit` call sites; the only one inside the framework is in [`Row.ts:96-102`](../src/typescript/lib/component/table/Row.ts#L96), which uses `newValue` untyped — safe.
- **Indeterminate state confusion** — a user clicking a mixed-state checkbox sees it become checked even if their intent was "set to false". Mitigation: documented behaviour (matches WAI-ARIA mixed-state semantics already implemented in `Checkbox`); a second click goes to unchecked.
- **`StringEditor` empty-string round-trip loss** — distinguishing `""` from `null` is intentionally dropped (see Architecture Decisions). Mitigation: documented in the recipes page and in the editor's JSDoc.
- **`NaN` from `NumberEditor`** — old code silently returned `NaN` for unparseable text; the new code returns `null`. Mitigation: this is strictly safer (NaN never equals itself, so the old behaviour silently dirtied records). Documented in JSDoc.

---

## Critical Files

- [`src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`](../src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) — base class and the structural-compatibility note.
- [`src/typescript/lib/component/table/cell/editor/CellEditor.ts`](../src/typescript/lib/component/table/cell/editor/CellEditor.ts) — sister base.
- [`src/typescript/lib/component/table/cell/renderer/Date.ts`](../src/typescript/lib/component/table/cell/renderer/Date.ts) — verbatim template.
- [`src/typescript/lib/component/table/cell/Cell.ts`](../src/typescript/lib/component/table/cell/Cell.ts) — `commitEdit` reads what `editor.getValue()` returns; do not change.
- [`src/typescript/lib/component/table/Row.ts`](../src/typescript/lib/component/table/Row.ts) — how cells receive and commit values.
- [`src/typescript/lib/component/input/Checkbox.ts`](../src/typescript/lib/component/input/Checkbox.ts) — `setIndeterminate`, `setSelected`, mixed-state click semantics at lines 172-177.

---

## Non-Goals

- Changing `Cell.commitEdit`, `Cell<T>`, `CellRenderer<T>` / `CellEditor<T>` base-class signatures.
- Adding a `nullable` flag to `ColumnConfig` — the cell stack always tolerates null.
- Adding new `Field.getType()` types or model schema fields.
- Preserving the distinction between `""` and `null` in `StringEditor` — see Architecture Decisions.
- Touching `HeaderCell`, `DefaultCell`, `ParentHeaderCell`, or `SortPriorityBadge` — they do not participate in the typed-value round-trip.
- Touching the `Date`/`Time`/`DateTime` pair — they already implement the target pattern.
