# Component Constructor Options — Implementation Plan

## Context

Most component classes today initialise to a fixed default state and require chained setter calls to configure them. A typical caller writes:

```typescript
const button = new Button("Save");
button.setEnabled(false);
button.setForegroundColor("white");
button.setBackgroundColor("var(--ts-ui-accent)");
button.setBorderRadius("8px");
panel.addComponent(button);
```

Six lines and four method calls just to construct a styled button. The ergonomic ceiling is also low: a callsite cannot describe the desired component as a single value, which makes wrapping, mapping, and templating awkward.

The framework already validates the options-object pattern in two places — [`AutoCompleteField`](../src/typescript/Base/component/AutoCompleteField.ts#L83) (`AutoCompleteFieldConfig`) and [`Border`](../src/typescript/Base/Border.ts#L24) (`BorderOptions`). This plan extends the same idea uniformly across every component so that the equivalent of the example above is:

```typescript
panel.addComponent(new Button("Save", {
    enabled        : false,
    foregroundColor: "white",
    backgroundColor: "var(--ts-ui-accent)",
    borderRadius   : "8px",
}));
```

The options object is **purely additive** — every existing positional call site continues to compile and behave identically. No migration is required of any consumer code.

---

## Architecture Decisions

### Positional first, options last (additive, never breaking)

Per existing `AutoCompleteField(config?)` precedent, every constructor accepts a final `options?: XxxOptions` parameter. Required positional args (e.g. [`Image(src)`](../src/typescript/Base/component/Image.ts#L17), [`Label(text, forId)`](../src/typescript/Base/component/Label.ts#L27)) stay positional. Constructors with optional positional args (e.g. `Button(text?)`, `ProgressBar(value?, indeterminate?)`) keep them too — the options object is appended.

```typescript
new Button();                                       // unchanged
new Button("Save");                                 // unchanged
new Button("Save", { enabled: false });             // new
new Image("/logo.svg", { borderRadius: "8px" });    // new
new Label("Name", "user-input", { fontWeight: "bold" }); // new
```

Rejected: a "replace" approach would force every demo, test, and downstream caller to migrate at once. Rejected: providing `options.text` as a parallel to the positional `text` arg — keeps two ways to do the same thing for no benefit.

### Hierarchical options interfaces mirror class inheritance

```
ComponentOptions
├── TextOptions              (Text → Label, Header, Legend, ...)
├── InputOptions             (Input)
│   ├── TextInputOptions     (TextInput → TextField → PasswordField)
│   ├── TextAreaOptions
│   ├── CheckboxOptions
│   └── SliderOptions
├── ButtonOptions            (Button → ToggleButton, SpinButton, TabCloseButton)
├── ComboBoxOptions
├── RadioButtonOptions
├── ProgressBarOptions
├── ImageOptions
├── DateFieldOptions / TimeFieldOptions
├── NumberSpinnerOptions
├── AbstractListOptions      (List, MultiSelectList, BulletedList, NumberedList)
├── AutoCompleteFieldOptions (renames AutoCompleteFieldConfig — see Migration)
└── ... (one per concrete component)
```

Every interface uses `?:` for every field and is consumed via nullish coalescing in `applyOptions`, matching the established AutoCompleteField pattern. A subclass interface adds *only* its new fields; inherited fields come for free via `extends`.

Rejected: flat per-component interfaces. Would duplicate ~25 Component-level fields across ~40 interfaces and force any new Component setter to be added in 40 places.

### One `applyOptions` method per class, called only by the leaf constructor

Each class declares a `protected applyOptions(options: XxxOptions): void` that:

1. Calls `super.applyOptions(options)` first (so derived classes can override parent decisions).
2. Reads its own added fields and dispatches to existing setters.

Constructors call `applyOptions` **at the end of their own body**, after all internal state and child components are initialised — and **only** in the leaf class. Intermediate base classes (`Component`, `Text`, `Input`, `TextInput`) accept and forward options for type purposes, but never call `applyOptions` on themselves when invoked via `super()`.

The pattern in practice:

```typescript
// Component.ts (root)
constructor(tag: string = "div", options?: ComponentOptions) {
    super();
    // ... existing init ...
    if (this.constructor === Component && options) {
        this.applyOptions(options);
    }
}
```

The `this.constructor === Component` guard ensures `applyOptions` runs only when `Component` is the leaf — i.e. instantiated directly. Subclasses' `super()` calls won't trigger it.

```typescript
// Button.ts (leaf)
constructor(text?: string, options?: ButtonOptions) {
    super("button");                  // do NOT pass options up — leaf applies them
    // ... existing button init creating this.text, pressed CSS rule, etc. ...
    if (text !== undefined) {
        this.text.setText(text);
    }
    if (options) {
        this.applyOptions(options);
    }
}

protected applyOptions(options: ButtonOptions): void {
    super.applyOptions(options);      // Component-level fields
    if (options.text                   !== undefined) this.text.setText(options.text);
    if (options.enabled                !== undefined) this.setEnabled(options.enabled);
    if (options.pressedBackgroundColor !== undefined) this.setPressedBackgroundColor(options.pressedBackgroundColor);
    // ... etc ...
}
```

TypeScript permits the parameter-narrowing override (`ComponentOptions` → `ButtonOptions`) because class methods are bivariant in their parameters. The leaf-only call rule is enforced by code review and convention; the cost of accidental double-application is benign (the same setters re-run with the same values).

Rejected: passing `options` up the chain via `super(tag, options)`. Would cause `Component`'s constructor to call `applyOptions` before the subclass body has run, so any option that targets a child component (`text` on `Button`, fields on composite components) would crash on undefined references.

Rejected: making `applyOptions` public. It's strictly an init helper; mid-life reconfiguration goes through the existing setters individually.

### Per-component judgement on which setters become options

Not every setter belongs in `XxxOptions`. The cut:

**Include** — properties commonly set at construction time, expressing visual identity, initial state, or behaviour:
- `setVisible`, `setEnabled`, `setSelected`, `setText`, `setValue`, `setItems`, …
- `setBackgroundColor`, `setForegroundColor`, `setBorder`, `setBorderRadius`, `setShadow`, …
- `setPreferredSize`, `setMinSize`, `setMaxSize`, `setPadding`, `setInsets`, …
- `setLayoutManager` (composition-defining), `setFontSize`, `setFontWeight`, …
- Pressed-state setters on `Button`, min/max/step on `Slider` and `NumberSpinner`, etc.

**Exclude** — low-level escape hatches and runtime-layout-only setters:
- `setElementCSSRule(s)`, `setElementStyle`, `setElementAttribute` (plumbing — but `attributes?: Record<string, string>` IS exposed on `ComponentOptions` for ergonomic batch setting)
- `setSize` (assigned by parent layout, not by caller)
- `setVerticalAlign` (rare; specialty)
- `setId` (exposed; users sometimes need predictable ids for testing)

Per-component field lists are documented in **Per-Component Options Coverage** below.

### Reuse existing value-shaped types — don't introduce parallel literal forms

`setBorder` already accepts `BorderOptions | string`; `border?: BorderOptions | string` in `ComponentOptions` reuses that exact union — no new types. `setPadding` accepts `Insets`; `padding?: Insets` matches. `setPreferredSize(w, h)` becomes `preferredSize?: Size` (the existing `Size` interface from [`Base/Size.ts`](../src/typescript/Base/Size.ts)).

This keeps the options surface congruent with existing setters and avoids gratuitous helper conversions inside `applyOptions`.

Rejected: ergonomic helpers like `padding?: number | Insets` (uniform shorthand). Saves four characters at one callsite, costs a normalisation branch in every component. Out of scope for this plan; can be added later as a helper at the `Insets` constructor instead.

### `AutoCompleteField` migration: rename + collapse

`AutoCompleteFieldConfig` becomes `AutoCompleteFieldOptions extends ComponentOptions`. Its existing fields (suggestions, store, displayField, minChars, debounceMs, maxSuggestions, placeholder, matchMode) merge with inherited Component-level fields. The old name is kept as a deprecated type alias to preserve backwards compatibility for one release:

```typescript
/** @deprecated Use AutoCompleteFieldOptions. */
export type AutoCompleteFieldConfig = AutoCompleteFieldOptions;
```

`Column` already accepts a `ColumnConfig` — that interface is data-binding metadata (`field`, `minWidth`, `maxWidth`, `hidden`, `showSeconds`), not a Component-styling object. It stays as-is and is *not* renamed. Column is a Cell-grid column descriptor, not a UI component constructor.

---

## Public API (TypeScript Signatures)

### `ComponentOptions` (root)

```typescript
export interface ComponentOptions {
    visible?         : boolean;
    displayed?       : boolean;
    zIndex?          : number;
    insets?          : Insets;
    padding?         : Insets;
    backgroundColor? : string | null;
    backgroundImage? : string | null;
    foregroundColor? : string | null;
    colorScheme?     : string;
    border?          : BorderOptions | string;
    borderRadius?    : string;
    shadow?          : string | null;
    outline?         : string | null;
    cursor?          : string;
    preferredSize?   : Size;
    minSize?         : Size;
    maxSize?         : Size;
    transform?       : string | null;
    opacity?         : number | null;
    position?        : Position;
    overflow?        : string;
    whiteSpace?      : string;
    pointerEvents?   : string;
    layoutManager?   : LayoutManager;
    id?              : string;
    attributes?      : Record<string, string>;
}
```

### `Component` constructor (revised)

```typescript
class Component extends BaseObject {
    constructor(tag: string = "div", options?: ComponentOptions);
    protected applyOptions(options: ComponentOptions): void;
}
```

### `TextOptions` + `Text`

```typescript
export interface TextOptions extends ComponentOptions {
    text?           : string;
    textAlign?      : string;
    textShadow?     : string;
    fontFamily?     : string;
    fontSize?       : number | string;   // matches setFontSize union
    fontWeight?     : string;
    fontStyle?      : string;
    fontVariant?    : string;
    fontStretch?    : string;
    fontKerning?    : string;
    fontSizeAdjust? : string;
    lineHeight?     : number | string;
    textOverflow?   : string;
}

class Text extends Component {
    constructor(text?: String, tag: string = "span", options?: TextOptions);
    protected applyOptions(options: TextOptions): void;
}
```

### `ButtonOptions` + `Button`

```typescript
export interface ButtonOptions extends ComponentOptions {
    text?                   : string;
    enabled?                : boolean;
    pressedBackgroundColor? : string | null;
    pressedBackgroundImage? : string | null;
    pressedForegroundColor? : string | null;
    pressedBorder?          : BorderOptions;
    pressedBorderRadius?    : string | null;
    pressedShadow?          : string | null;
}

class Button extends Component {
    constructor(text?: string, options?: ButtonOptions);
    protected applyOptions(options: ButtonOptions): void;
}
```

(Pattern repeats for every concrete component; full per-component field coverage is in the next section.)

---

## Per-Component Options Coverage

The table below enumerates the new options interface for each concrete component. Inherited fields (from `ComponentOptions` and intermediate parents) are implicit via `extends` and not repeated.

| Class | Options interface | Extends | Newly added fields |
|---|---|---|---|
| `Component` | `ComponentOptions` | — | (root — see above) |
| `Text` | `TextOptions` | `ComponentOptions` | text, textAlign, textShadow, fontFamily, fontSize, fontWeight, fontStyle, fontVariant, fontStretch, fontKerning, fontSizeAdjust, lineHeight, textOverflow |
| `Label` | `LabelOptions` | `TextOptions` | (none — Label is Text + required `forId` positional) |
| `Header` | `HeaderOptions` | `TextOptions` | (none) |
| `Legend` | `LegendOptions` | `TextOptions` | (none) |
| `Input` | `InputOptions` | `ComponentOptions` | name |
| `TextInput` | `TextInputOptions` | `InputOptions` | text, textAlign, placeholder, readOnly, maxLength |
| `TextField` | `TextFieldOptions` | `TextInputOptions` | (none — pattern carrier) |
| `PasswordField` | `PasswordFieldOptions` | `TextInputOptions` | (none) |
| `TextArea` | `TextAreaOptions` | `InputOptions` | text, rows, cols, wrap, placeholder, readOnly, maxLength |
| `Checkbox` | `CheckboxOptions` | `InputOptions` | selected, value, enabled |
| `Slider` | `SliderOptions` | `InputOptions` | minValue, maxValue, value, step |
| `Button` | `ButtonOptions` | `ComponentOptions` | text, enabled, pressedBackgroundColor, pressedBackgroundImage, pressedForegroundColor, pressedBorder, pressedBorderRadius, pressedShadow |
| `ToggleButton` | `ToggleButtonOptions` | `ButtonOptions` | selected |
| `SpinButton` | `SpinButtonOptions` | `ButtonOptions` | (none — symbol stays positional) |
| `TabCloseButton` | `TabCloseButtonOptions` | `ButtonOptions` | (none) |
| `ComboBox` | `ComboBoxOptions` | `ComponentOptions` | items, store, displayField, valueField, selectedIndex, value, selectedItem |
| `RadioButton` | `RadioButtonOptions` | `ComponentOptions` | text, radioName, selected, enabled |
| `ProgressBar` | `ProgressBarOptions` | `ComponentOptions` | value, indeterminate |
| `ProgressSpinner` | `ProgressSpinnerOptions` | `ComponentOptions` | spinnerSize |
| `Image` | `ImageOptions` | `ComponentOptions` | (none — src stays required positional) |
| `DateField` | `DateFieldOptions` | `ComponentOptions` | value, enabled |
| `TimeField` | `TimeFieldOptions` | `ComponentOptions` | value, enabled |
| `NumberSpinner` | `NumberSpinnerOptions` | `ComponentOptions` | value, min, max, step, precision, enabled |
| `AbstractListComponent` | `AbstractListOptions` | `ComponentOptions` | items, store, displayField, selectedIndex |
| `List` | `ListOptions` | `AbstractListOptions` | (none) |
| `MultiSelectList` | `MultiSelectListOptions` | `AbstractListOptions` | selectedIndices |
| `BulletedList` | `BulletedListOptions` | `AbstractListOptions` | itemStyle |
| `NumberedList` | `NumberedListOptions` | `AbstractListOptions` | itemStyle |
| `MenuItem` | `MenuItemOptions` | `ComponentOptions` | text, enabled, focused |
| `MenuSeparator` | `MenuSeparatorOptions` | `ComponentOptions` | (none) |
| `Option` | `OptionOptions` | `ComponentOptions` | text, value, selected, disabled |
| `AccordionHeader` | `AccordionHeaderOptions` | `ComponentOptions` | text, expanded |
| `FieldSet` | `FieldSetOptions` | `ComponentOptions` | legend |
| `PaginationBar` | `PaginationBarOptions` | `ComponentOptions` | pageSize, pageIndex, totalCount |
| `ListItem` | `ListItemOptions` | `ComponentOptions` | text |
| `AutoCompleteField` | `AutoCompleteFieldOptions` | `ComponentOptions` | suggestions, store, displayField, minChars, debounceMs, maxSuggestions, placeholder, matchMode |
| `AutoCompleteDropdown` | `AutoCompleteDropdownOptions` | `ComponentOptions` | maxItems |
| `AutoCompleteItem` | `AutoCompleteItemOptions` | `ComponentOptions` | text, highlighted |
| `FontAwesomeIcon` | `FontAwesomeIconOptions` | `ComponentOptions` | iconName, iconStyle |
| `SplitGutter` | `SplitGutterOptions` | `ComponentOptions` | orientation |
| `WindowBorder` | `WindowBorderOptions` | `ComponentOptions` | (none) |
| `WindowHeader` | `WindowHeaderOptions` | `ComponentOptions` | text, closeable |
| `DialogBackdrop` | `DialogBackdropOptions` | `ComponentOptions` | (none) |

A "(none)" row still gets an interface declared (`extends` only) so consumers and future maintainers have a stable type to widen.

---

## Ordered Implementation Steps

### Step 1 — Add `ComponentOptions` and `applyOptions` to [`Component.ts`](../src/typescript/Base/Component.ts)

Insert the `ComponentOptions` interface near the top of the file, alongside the existing `Style`, `PerimeterSize` exports. Modify the constructor signature to accept `options?: ComponentOptions`. Add the leaf-guard at the end of the constructor:

```typescript
if (this.constructor === Component && options) {
    this.applyOptions(options);
}
```

Add the `protected applyOptions(options: ComponentOptions): void` method dispatching to the existing setters listed in the interface. Use `if (options.X !== undefined)` rather than truthy checks so that `false`, `0`, and `null` propagate correctly.

### Step 2 — Apply pattern to `Text.ts` and `Input.ts`

[`Text.ts`](../src/typescript/Base/component/Text.ts): add `TextOptions extends ComponentOptions`, expand constructor to `(text?: String, tag: string = "span", options?: TextOptions)`, override `applyOptions` to call `super.applyOptions(options)` then dispatch the text/font fields. Use the same leaf-guard (`this.constructor === Text`) so `Text` instantiated directly applies options but subclasses don't double-apply.

[`Input.ts`](../src/typescript/Base/component/Input.ts): add `InputOptions extends ComponentOptions` with `name?: string`. Same constructor + override pattern.

### Step 3 — Mid-tier classes: `TextInput.ts`

[`TextInput.ts`](../src/typescript/Base/component/TextInput.ts): add `TextInputOptions extends InputOptions` with text/placeholder/readOnly/maxLength. Apply pattern.

### Step 4 — Leaf components (parallel-safe; each file is independent)

For each of the components in the **Per-Component Options Coverage** table, in this order — text inputs first because they have the most consumers, then state widgets, then containers/decorations:

1. `TextField`, `PasswordField`, `TextArea`
2. `Button`, `ToggleButton`, `SpinButton`, `TabCloseButton`
3. `Label`, `Header`, `Legend`
4. `Checkbox`, `Slider`, `RadioButton`
5. `ComboBox`, `List`, `MultiSelectList`, `BulletedList`, `NumberedList`, `AbstractListComponent`
6. `Image`, `DateField`, `TimeField`, `NumberSpinner`
7. `ProgressBar`, `ProgressSpinner`
8. `MenuItem`, `MenuSeparator`, `Option`
9. `AccordionHeader`, `FieldSet`, `PaginationBar`, `ListItem`
10. `AutoCompleteDropdown`, `AutoCompleteItem`, `FontAwesomeIcon`, `SplitGutter`, `WindowBorder`, `WindowHeader`, `DialogBackdrop`

For each: declare the options interface, add the trailing `options?` constructor param, append the `if (options) this.applyOptions(options);` line at the constructor's end, and write the `protected applyOptions` override that calls `super.applyOptions(options)` and dispatches the new fields.

For composite components whose options target an internal child (e.g. `Button.text` → `this.text.setText`, `RadioButton.text` → `this.label.setText`, `NumberSpinner.value` → `this._setValueSilent`), proxy the option to the appropriate child setter inside the override.

### Step 5 — `AutoCompleteField.ts` migration

In [`AutoCompleteField.ts`](../src/typescript/Base/component/AutoCompleteField.ts):

1. Rename `AutoCompleteFieldConfig` to `AutoCompleteFieldOptions` and have it `extends ComponentOptions`.
2. Add `export type AutoCompleteFieldConfig = AutoCompleteFieldOptions;` with a `@deprecated` JSDoc tag.
3. Rewrite the constructor to follow the standard pattern: process the AutoCompleteField-specific fields (suggestions, store, etc.) inline since they're consumed during init, then call `super.applyOptions(options)` for the inherited Component fields. The structure remains `constructor(options?: AutoCompleteFieldOptions)` — no positional args — so backwards compatibility is preserved.

### Step 6 — Verify exports in [`index.ts`](../src/typescript/Base/index.ts)

Add `export type { XxxOptions } from './component/Xxx.js';` next to each component's existing class export. The full list mirrors the **Per-Component Options Coverage** table.

Also add `export type { ComponentOptions } from './Component.js';` at the top of the Core exports block.

### Step 7 — Update documentation site examples

Update at least one example per major component category in the docs (`docs/` if present, or the wiki source) to use the new options style, so the recommended idiom is discoverable. Don't rewrite all examples — just enough to set the new norm.

### Step 8 — Run typecheck and verify zero call-site regressions

```bash
npm run build              # TypeScript compile
grep -rn "new Button("    src/ | wc -l    # baseline before
# After: same count, all callsites compile unchanged
```

Run the demo app and exercise each component family. The additive-only change should produce zero behavioural diffs for unmodified call sites.

### Step 9 — Refresh the knowledge graph

```bash
graphify update . --directed
```

Per `CLAUDE.md`'s graphify rules and saved memory.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/Base/Component.ts` |
| Modify | `src/typescript/Base/component/Text.ts` |
| Modify | `src/typescript/Base/component/Input.ts` |
| Modify | `src/typescript/Base/component/TextInput.ts` |
| Modify | `src/typescript/Base/component/TextField.ts` |
| Modify | `src/typescript/Base/component/PasswordField.ts` |
| Modify | `src/typescript/Base/component/TextArea.ts` |
| Modify | `src/typescript/Base/component/Button.ts` |
| Modify | `src/typescript/Base/component/ToggleButton.ts` |
| Modify | `src/typescript/Base/component/SpinButton.ts` |
| Modify | `src/typescript/Base/component/TabCloseButton.ts` |
| Modify | `src/typescript/Base/component/Label.ts` |
| Modify | `src/typescript/Base/component/Header.ts` |
| Modify | `src/typescript/Base/component/Legend.ts` |
| Modify | `src/typescript/Base/component/Checkbox.ts` |
| Modify | `src/typescript/Base/component/Slider.ts` |
| Modify | `src/typescript/Base/component/RadioButton.ts` |
| Modify | `src/typescript/Base/component/ComboBox.ts` |
| Modify | `src/typescript/Base/component/AbstractListComponent.ts` |
| Modify | `src/typescript/Base/component/List.ts` |
| Modify | `src/typescript/Base/component/MultiSelectList.ts` |
| Modify | `src/typescript/Base/component/BulletedList.ts` |
| Modify | `src/typescript/Base/component/NumberedList.ts` |
| Modify | `src/typescript/Base/component/Image.ts` |
| Modify | `src/typescript/Base/component/DateField.ts` |
| Modify | `src/typescript/Base/component/TimeField.ts` |
| Modify | `src/typescript/Base/component/NumberSpinner.ts` |
| Modify | `src/typescript/Base/component/ProgressBar.ts` |
| Modify | `src/typescript/Base/component/ProgressSpinner.ts` |
| Modify | `src/typescript/Base/component/MenuItem.ts` |
| Modify | `src/typescript/Base/component/MenuSeparator.ts` |
| Modify | `src/typescript/Base/component/Option.ts` |
| Modify | `src/typescript/Base/component/AccordionHeader.ts` |
| Modify | `src/typescript/Base/component/FieldSet.ts` |
| Modify | `src/typescript/Base/component/PaginationBar.ts` |
| Modify | `src/typescript/Base/component/ListItem.ts` |
| Modify | `src/typescript/Base/component/AutoCompleteField.ts` |
| Modify | `src/typescript/Base/component/AutoCompleteDropdown.ts` |
| Modify | `src/typescript/Base/component/AutoCompleteItem.ts` |
| Modify | `src/typescript/Base/component/FontAwesomeIcon.ts` |
| Modify | `src/typescript/Base/component/SplitGutter.ts` |
| Modify | `src/typescript/Base/component/WindowBorder.ts` |
| Modify | `src/typescript/Base/component/WindowHeader.ts` |
| Modify | `src/typescript/Base/component/DialogBackdrop.ts` |
| Modify | `src/typescript/Base/index.ts` |

---

## Verification

1. **Typecheck** — `npm run build` passes with zero new errors. The existing positional callsites continue to compile unchanged.
2. **Call-site invariance** — `grep -rn "new Button(" src/` (and equivalent for each component) returns the same count and lines as before. Any change to existing callsites is unintentional.
3. **Manual smoke test** — open the demo app and verify, for each component family, that a constructed-with-options instance and a constructed-then-set-via-setters instance render identically. Compare side-by-side in the demo window.
4. **Theme toggle** — toggle dark/light theme on a window containing options-constructed components. Theme tokens passed via options (e.g. `foregroundColor: "var(--ts-ui-text-color)"`) must respond.
5. **Layout regression** — confirm `setPreferredSize`/`setMinSize`/`setMaxSize` set via options correctly trigger `doLayout()` of the parent. Watch for components that render at NaN size — that indicates `applyOptions` ran before geometry init.
6. **AutoCompleteField backwards compat** — confirm `new AutoCompleteField({ suggestions: [...] })` works exactly as before (the rename is purely additive).
7. **Knowledge graph** — `graphify update . --directed` runs cleanly; no new orphan nodes.

---

## Potential Challenges

- **Constructor-time order dependencies**: a few components measure themselves or call `updateHeight()` during construction (`TextField`, `ComboBox`, `Slider`, `Text` via `calculateSize`). If `applyOptions` then sets `fontSize` or `text`, the existing setter implementations already trigger remeasure — so the second pass is correct. Mitigation: verify by adding console assertions on `measuredBaseline` for `Text` after each constructor variant.
- **Child component options leaking into `applyComponentOptions`**: e.g. setting `foregroundColor` on a `Button` should colour the button border/text, not the inner `Text` child — but `Component.setForegroundColor` already propagates via CSS inheritance, so this works without proxy logic. Only options that explicitly target inner children (text content, font properties on `Button`) need proxy code in the leaf override.
- **Bivariant override warnings**: TypeScript permits parameter-narrowing overrides on class methods even with `--strict`. If the project later enables `strictFunctionTypes` for arrow-property style or runs a stricter linter, the `applyOptions(opts: ButtonOptions)` override of `applyOptions(opts: ComponentOptions)` may flag. Mitigation: keep them as `protected` methods (not arrow-bound properties), which preserves bivariance.
- **`AutoCompleteFieldConfig` deprecation noise**: external consumers may currently import it. The aliased `export type` retains source compatibility; flag the deprecation in `npm-package.md` release notes when shipping.
- **`Slider` and `Checkbox` use `setSize` in their constructors today**. If a caller passes `preferredSize` via options, the option-driven call will overwrite the constructor's default — which is the desired behaviour. Verify by passing a non-default `preferredSize` to a `Checkbox` and confirming the rendered checkbox respects it.
- **`Image` preferred size is reactive to `naturalWidth/naturalHeight`**. Setting `preferredSize` via options will lock it. Document on `ImageOptions` that supplying `preferredSize` disables the natural-size auto-fit.

---

## Critical Files

Read these before starting implementation:

- [`src/typescript/Base/Component.ts`](../src/typescript/Base/Component.ts) — root constructor, all base setters, leaf-guard reference
- [`src/typescript/Base/component/AutoCompleteField.ts`](../src/typescript/Base/component/AutoCompleteField.ts) — established options-config pattern; the model to extend
- [`src/typescript/Base/Border.ts`](../src/typescript/Base/Border.ts) — `BorderOptions` structure (referenced from `ComponentOptions.border`)
- [`src/typescript/Base/Insets.ts`](../src/typescript/Base/Insets.ts) — `Insets` value-object passed to `padding`/`insets`
- [`src/typescript/Base/Size.ts`](../src/typescript/Base/Size.ts) — `Size` interface used by `preferredSize`/`minSize`/`maxSize`
- [`src/typescript/Base/component/Text.ts`](../src/typescript/Base/component/Text.ts) — the most central component (69 graph edges); test the pattern here first
- [`src/typescript/Base/component/Button.ts`](../src/typescript/Base/component/Button.ts) — the pattern's most-watched leaf example
- [`src/typescript/Base/index.ts`](../src/typescript/Base/index.ts) — export surface; every new options type needs to appear here

---

## Non-Goals

- **No setter-method changes.** The setter methods themselves stay byte-for-byte identical. This plan only adds an aggregate entry point.
- **No new value-shorthand types.** No `padding?: number` shorthand, no `border?: "1px solid red"` parsing — `border?: BorderOptions | string` already covers the string form. Other ergonomic helpers belong in a follow-up plan.
- **No options-from-options chaining** (e.g. `text?: TextOptions` on `Button` to deep-style the inner Text). Inner Text styling on composite components stays a post-construction concern via `getText().setFontSize(...)`. Adding nested options would balloon every interface and create confusing precedence rules.
- **No runtime reconfiguration via `applyOptions`.** It's a constructor-time helper. Mid-life updates use individual setters as today.
- **No demo/test rewrite.** The plan deliberately preserves all existing call sites. Migrating demos to the new style is opportunistic, not required (Step 7 covers a small representative sample only).
- **Container components in `containers/` and table sub-components** (Cell renderers/editors, tree renderers, menu-bar internals) are out of scope for this first pass. They have specialised constructors with framework-internal coupling; a second pass can extend the pattern there once the leaf-component pattern is bedded in.
