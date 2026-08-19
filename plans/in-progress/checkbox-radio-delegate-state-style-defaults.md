---
depends-on: [checkbox-radio-delegate-static-style-defaults, state-chrome-isolation-generalization]
---

# Checkbox / RadioButton Delegate State Style Defaults — Implementation Plan

## Overview

[`checkbox-radio-delegate-static-style-defaults.md`](checkbox-radio-delegate-static-style-defaults.md) gives `Checkbox`'s `_box` and `RadioButton`'s `_ring` their own small classes, `CheckboxBox` and `RadioButtonRing`, and hoists their *static* size/cursor properties onto a shared class rule. It deliberately leaves `backgroundColor` and `border` untouched, because `Checkbox.applySelected` / `RadioButton.applySelected` rewrite them on every checked/selected transition — `_box`'s three-way (unchecked / checked / indeterminate) and `_ring`'s boolean (unselected / selected) — and today every one of those writes lands on the delegate's own bare `#id` rule, duplicated across every instance in whichever state it currently holds.

This plan closes that gap using the same mechanism `Button`'s `.pressed` and (once `state-chrome-isolation-generalization` lands) `ToggleButton`'s `.selected` already use: a `createStateStyleRule` class-tier rule per non-resting state, plus a `getRestingExclusionSuffixes()` override so the resting write doesn't compete with it on CSS specificity. `CheckboxBox` gets two state rules (`.selected`, `.indeterminate`); `RadioButtonRing` gets one (`.selected`). The resting value moves into `_default<Name>Options` alongside the static properties the sibling plan already put there — and, unlike a naive port of the state mechanism, the resting value needs **no runtime write at all** once it is a class default: see `## Architecture Decisions`.

**`border` only partially dedupes.** `RESTING_ISOLATION_KEYS` — the fixed set of properties `getRestingExclusionSuffixes()` isolates — is `backgroundColor` / `backgroundImage` / `boxShadow` only; border longhands are deliberately excluded, matching `Button`'s and (once migrated) `ToggleButton`'s own border handling. The resting (unchecked/unselected) border still gets full dedup, for a different reason explained below. The two active states' border stays a genuine per-instance write, exactly like `Button`'s `.pressed` border does today.

This plan also moves the state-to-visual mapping out of `Checkbox` / `RadioButton` and into `CheckboxBox` / `RadioButtonRing` themselves — each delegate gains one `applyState(...)` method that owns its own class-toggling and CSS writes, so `Checkbox.applySelected` / `RadioButton.applySelected` stop poking the delegate's setters directly.

---

## Architecture Decisions

### `getRestingExclusionSuffixes()` and `createStateStyleRule` are the established mechanism — used here even though this delegate could arguably do without the isolation half

`state-chrome-isolation-generalization`'s own `## Non-Goals` names `Checkbox.ts` / `RadioButton.ts` directly as needing this mechanism, once their delegates have distinct class identity. This plan follows that mechanism exactly as `ToggleButton` will use it, rather than inventing a lighter-weight variant.[^isolation-arguably-unneeded]

### `CheckboxBox` registers both state suffixes together; `RadioButtonRing` registers one

`getRestingExclusionSuffixes()` returns every suffix a class's resting chrome must stay isolated from, all at once — not "whichever one is currently active". For `CheckboxBox`'s three-way state this means both non-resting suffixes together:

```typescript
protected override getRestingExclusionSuffixes(): readonly string[] {
    return [".selected", ".indeterminate"];
}
```

This produces the instance-tier resting selector `#id:not(.selected):not(.indeterminate)` — it matches only when *neither* toggle class is present, which is exactly `_box`'s resting state (the two are mutually exclusive by construction: `applyState` never sets both). `RadioButtonRing` has only one non-resting state, so it registers one suffix: `return [".selected"];` — no `:not(:hover)` companion, because neither delegate has any hover-state CSS to disambiguate from (unlike `Button`/`ToggleButton`, which need `:not(:hover)` specifically because they *do*).

| State | CSS classes on the delegate's element | Where `backgroundColor` is declared | Where border is declared |
|---|---|---|---|
| resting (unchecked / unselected) | none | `.CheckboxBox` / `.RadioButtonRing` class rule | Same class rule |
| checked / selected | `.selected` | `#id.selected`, deduping to `.CheckboxBox.selected` / `.RadioButtonRing.selected` once ≥2 default instances exist | `#id.selected`, written directly every time — border is not in the state's resolved bag, so it is never skipped |
| indeterminate (`CheckboxBox` only) | `.indeterminate` | `#id.indeterminate`, deduping to `.CheckboxBox.indeterminate` | `#id.indeterminate`, written directly every time |

### The resting value needs no runtime write — `applyState`'s resting branch only toggles the CSS classes off

This is the one place this plan does **not** mechanically copy `Button`'s pattern. `Button`'s pre-isolation `.pressed` and resting writes shared the *same* `#id` selector, which is exactly why `component-chrome-base-tier-hoisting` had to make every hoisted write "clear on match, never skip" — a later matching write must overwrite an earlier deviating one queued on that same rule. `_box` / `_ring`'s active-state writes never touch that rule at all: `this.selectedStyleRule.setMany(...)` / `this.indeterminateStyleRule.setMany(...)` write through `createStateStyleRule`'s own `StyleRule`, scoped to the distinct selector `#id.selected` / `#id.indeterminate` — a different CSSOM rule object from `_box`'s own base `_styleRule` (`#id`, or `#id:not(.selected):not(.indeterminate)` once isolated). Toggling `.selected` off does not touch that separate rule's *content* — it just stops matching it. The base rule is therefore written **at most once**, at construction (via the always-dispatched `border` and the folding-getter-read `backgroundColor`, both already resolved from `_default<Name>Options`), and never again for the lifetime of the instance — no runtime call can ever leave a stale value on it, because no runtime call ever writes to it after construction.[^why-no-resting-write] `applyState`'s resting branch is therefore just the class-toggle-off; it calls neither `setBackgroundColor` nor `setBorder`.

### The literal declaration bags live once, as module constants — mirroring `ToggleButton`'s own precedent

`ToggleButton`'s `TOGGLE_SELECTED_DECLARATIONS` ([ToggleButton.ts:26-30](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L26-L30)) is a single frozen module constant, read by both the constructor's dispatch and (once `state-chrome-isolation-generalization` lands) `getSelectedClassDeclarations()`. `CheckboxBox` / `RadioButtonRing` follow the identical shape: `CHECKBOX_SELECTED_DECLARATIONS`, `CHECKBOX_INDETERMINATE_DECLARATIONS`, `RADIO_SELECTED_DECLARATIONS` — each a frozen `Record<string, string>` read by both the resolver method and `applyState`, so the literal is written once, not duplicated between "what the class rule declares" and "what gets written on transition".

### `getSelectedClassDeclarations()` / `getIndeterminateClassDeclarations()` stay named methods, even with no subclass to override them

`Button.getPressedClassDeclarations()` / (once migrated) `ToggleButton.getSelectedClassDeclarations()` are overridable methods specifically because `TabButton` needs to override `ToggleButton`'s version with its own tokens — a real subclass relationship. Neither `CheckboxBox` nor `RadioButtonRing` has, or will have, a subclass (both are module-private, single-call-site delegates — confirmed via `grep -rn 'extends CheckboxBox\|extends RadioButtonRing' packages/lib/src`, zero matches), so nothing here actually needs override dispatch. This plan keeps the method anyway, wrapped in the identical thunk shape (`() => this.getSelectedClassDeclarations()`) `createStateStyleRule` expects from every other caller — matching the established resolver shape exactly costs one small method and keeps the code recognizable against `Button`'s/`ToggleButton`'s version, rather than introducing a cosmetic one-off variant for no real saving.

### The state-to-visual mapping moves into the delegate; `Checkbox`/`RadioButton` stop writing the delegate's chrome directly

`CheckboxBox` gains one method, `applyState(selected: boolean, indeterminate: boolean): void`, that toggles its own `.selected`/`.indeterminate` classes and writes background + border for whichever active state applies. `RadioButtonRing` gains the boolean equivalent, `applyState(selected: boolean): void`. `Checkbox.applySelected` / `RadioButton.applySelected` call these instead of computing fill/border literals and calling `_box.setBackgroundColor(...)` / `_box.setBorder(...)` directly. This also shrinks `Checkbox.applySelected` from a 24-line method to 3 lines (aria + delegate + sibling-opacity), since fill/border computation is now the delegate's own concern.

### `_box` / `_ring`'s field types narrow from the sibling plan's `Component` to the concrete delegate class

`checkbox-radio-delegate-static-style-defaults.md` explicitly keeps `_box: Component` / `_ring: Component` (its Internal Structure: "nothing outside the constructor needs the narrower type"). This plan is exactly the case that changes that: `Checkbox.applySelected` now calls `this._box.applyState(...)`, a method that exists only on `CheckboxBox`, not on `Component`. The field declarations narrow to `_box: CheckboxBox` and `_ring: RadioButtonRing`.

### Border stays out of `getSelectedClassDeclarations()` / `getIndeterminateClassDeclarations()`

Matching `Button.getPressedClassDeclarations()` and (once migrated) `ToggleButton.getSelectedClassDeclarations()`, the two resolvers declare only `backgroundColor` — never border keys. `state-chrome-isolation-generalization`'s own Architecture Decisions fix `RESTING_ISOLATION_KEYS` at exactly `backgroundColor` / `backgroundImage` / `boxShadow`, not per-component-configurable; widening it to include border is out of scope for that plan and therefore out of scope here too. Because the resolved bag never declares a border key, `StateStyleRule.setMany`'s comparison never matches for border, so every state-transition border write reaches `#id.selected` / `#id.indeterminate` for real, every time — the same "always written, never deduped" shape `Button`'s own `.pressed` border already has.

---

## Public API

Every member below is a plain (unmarked, module-private-class-scoped) or `protected` method — none of it is consumer-visible, since `CheckboxBox` / `RadioButtonRing` are never exported.

```typescript
// component/input/Checkbox.ts

class CheckboxBox extends Component {
    /** Applies the checked/indeterminate visual state. Called by `Checkbox.applySelected`. */
    applyState(selected: boolean, indeterminate: boolean): void;

    protected getSelectedClassDeclarations():      Record<string, string | null>;
    protected getIndeterminateClassDeclarations(): Record<string, string | null>;
    protected override getRestingExclusionSuffixes(): readonly string[]; // [".selected", ".indeterminate"]
    protected override render(): Handle;
}
```

```typescript
// component/input/RadioButton.ts

class RadioButtonRing extends Component {
    /** Applies the selected visual state. Called by `RadioButton.applySelected`. */
    applyState(selected: boolean): void;

    protected getSelectedClassDeclarations(): Record<string, string | null>;
    protected override getRestingExclusionSuffixes(): readonly string[]; // [".selected"]
    protected override render(): Handle;
}
```

`Checkbox._box` narrows from `Component` to `CheckboxBox`; `RadioButton._ring` narrows from `Component` to `RadioButtonRing`. Both remain `private`. No change to any public `Checkbox` / `RadioButton` member.

---

## Internal Structure

### `component/input/Checkbox.ts` — `_defaultCheckboxBoxOptions`, extended, and the two declaration constants

```typescript
const _defaultCheckboxBoxOptions: Partial<ComponentOptions> = {
    preferredSize:   { width: 16, height: 16 },
    minSize:         { width: 16, height: 16 },
    maxSize:         { width: 16, height: 16 },
    cursor:          "pointer",
    backgroundColor: "var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
};

/** `_box`'s checked-state declarations. Read by both `getSelectedClassDeclarations` and `applyState` — one source of truth, mirroring `ToggleButton`'s `TOGGLE_SELECTED_DECLARATIONS`. */
const CHECKBOX_SELECTED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))",
    border:          "1px solid var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))",
});

/** `_box`'s indeterminate-state declarations. Same shape as `CHECKBOX_SELECTED_DECLARATIONS`. */
const CHECKBOX_INDETERMINATE_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-checkbox-bg-indeterminate, rgb(160, 160, 160))",
    border:          "1px solid var(--ts-ui-checkbox-bg-indeterminate, rgb(160, 160, 160))",
});
```

### `component/input/Checkbox.ts` — `CheckboxBox`, extended

```typescript
class CheckboxBox extends Component {
    private _selected:      boolean = false;
    private _indeterminate: boolean = false;

    private declare _selectedStyleRule?: StateStyleRule;
    private get selectedStyleRule(): StateStyleRule {
        return this._selectedStyleRule ??= this.createStateStyleRule(".selected", () => this.getSelectedClassDeclarations());
    }

    private declare _indeterminateStyleRule?: StateStyleRule;
    private get indeterminateStyleRule(): StateStyleRule {
        return this._indeterminateStyleRule ??= this.createStateStyleRule(".indeterminate", () => this.getIndeterminateClassDeclarations());
    }

    constructor() {
        super(undefined, _defaultCheckboxBoxOptions);
    }

    protected getSelectedClassDeclarations(): Record<string, string | null> {
        return { backgroundColor: CHECKBOX_SELECTED_DECLARATIONS.backgroundColor };
    }

    protected getIndeterminateClassDeclarations(): Record<string, string | null> {
        return { backgroundColor: CHECKBOX_INDETERMINATE_DECLARATIONS.backgroundColor };
    }

    /**
     * `_box`'s own resting chrome must stay isolated from both non-resting
     * states — see plans/checkbox-radio-delegate-state-style-defaults.md.
     */
    protected override getRestingExclusionSuffixes(): readonly string[] {
        return [".selected", ".indeterminate"];
    }

    /**
     * Applies the checked/indeterminate visual state: toggles the CSS state
     * classes and, for a non-resting state, writes background + border
     * through the matching state-tier rule. The resting branch writes
     * nothing — `_box`'s base rule is never touched after construction (its
     * `backgroundColor`/`border` come from `_defaultCheckboxBoxOptions`
     * alone), so there is nothing to restore when a non-resting class is
     * removed; see this plan's Architecture Decisions.
     */
    applyState(selected: boolean, indeterminate: boolean): void {
        this._selected      = selected;
        this._indeterminate = indeterminate;

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { toggleClass: { selected, indeterminate } });
        }

        if (indeterminate) {
            this.indeterminateStyleRule.setMany({
                backgroundColor: CHECKBOX_INDETERMINATE_DECLARATIONS.backgroundColor,
                ...borderToStyle({ border: CHECKBOX_INDETERMINATE_DECLARATIONS.border }),
            });
        } else if (selected) {
            this.selectedStyleRule.setMany({
                backgroundColor: CHECKBOX_SELECTED_DECLARATIONS.backgroundColor,
                ...borderToStyle({ border: CHECKBOX_SELECTED_DECLARATIONS.border }),
            });
        }
    }

    /** Re-applies the cached state classes at render, for a state set before mount. */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this._selected, indeterminate: this._indeterminate } });
        return element;
    }
}
```

New imports needed in `Checkbox.ts`: `DOM` and `type { Handle }` from `~/core/DOM.js`; `type { StateStyleRule }` from `~/core/ClassStyleRules.js`; `borderToStyle` from `~/primitive/Border.js`.

### `component/input/Checkbox.ts` — `applySelected`, before → after

```typescript
// Before (Checkbox.ts:372-395):
private applySelected(selected: boolean, indeterminate: boolean): void {
    if (indeterminate) {
        this.getAria().setChecked("mixed");
    } else {
        this.getAria().setChecked(selected);
    }

    const fill = indeterminate
        ? "var(--ts-ui-checkbox-bg-indeterminate, rgb(160, 160, 160))"
        : selected
            ? "var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))"
            : "var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))";
    const border = selected || indeterminate
        ? "1px solid " + (indeterminate
            ? "var(--ts-ui-checkbox-bg-indeterminate, rgb(160, 160, 160))"
            : "var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))")
        : "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))";

    this._box.setBackgroundColor(fill);
    this._box.setBorder(border);

    this._check.setOpacity(selected && !indeterminate ? 1 : 0);
    this._dash.setOpacity(indeterminate ? 1 : 0);
}
```

```typescript
// After:
private applySelected(selected: boolean, indeterminate: boolean): void {
    if (indeterminate) {
        this.getAria().setChecked("mixed");
    } else {
        this.getAria().setChecked(selected);
    }

    this._box.applyState(selected, indeterminate);

    this._check.setOpacity(selected && !indeterminate ? 1 : 0);
    this._dash.setOpacity(indeterminate ? 1 : 0);
}
```

The `_box: Component` field declaration ([Checkbox.ts:54](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L54)) narrows to `_box: CheckboxBox`.

### `component/input/Checkbox.ts` — constructor's `_box` block, before → after (building on the sibling plan's result)

```typescript
// After the sibling plan, before this plan:
this._box = new CheckboxBox();
this._box.setSize({ width: 16, height: 16 });
this._box.setBackgroundColor("var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
this._box.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");
```

```typescript
// After this plan — backgroundColor/border are now the class default,
// established automatically at construction (border via the always-dispatch
// chrome group, backgroundColor via the folding getter), so the explicit
// calls are redundant.
this._box = new CheckboxBox();
this._box.setSize({ width: 16, height: 16 });
this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");
```

### `component/input/RadioButton.ts` — mirrors `Checkbox.ts` exactly

```typescript
const _defaultRadioButtonRingOptions: Partial<ComponentOptions> = {
    preferredSize:   { width: 16, height: 16 },
    minSize:         { width: 16, height: 16 },
    maxSize:         { width: 16, height: 16 },
    cursor:          "pointer",
    backgroundColor: "var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
};

/** `_ring`'s selected-state declarations. Read by both `getSelectedClassDeclarations` and `applyState`. */
const RADIO_SELECTED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))",
    border:          "1px solid var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))",
});

class RadioButtonRing extends Component {
    private _selected: boolean = false;

    private declare _selectedStyleRule?: StateStyleRule;
    private get selectedStyleRule(): StateStyleRule {
        return this._selectedStyleRule ??= this.createStateStyleRule(".selected", () => this.getSelectedClassDeclarations());
    }

    constructor() {
        super(undefined, _defaultRadioButtonRingOptions);
    }

    protected getSelectedClassDeclarations(): Record<string, string | null> {
        return { backgroundColor: RADIO_SELECTED_DECLARATIONS.backgroundColor };
    }

    protected override getRestingExclusionSuffixes(): readonly string[] {
        return [".selected"];
    }

    /** See `CheckboxBox.applyState`'s doc comment — identical reasoning, one state instead of two. */
    applyState(selected: boolean): void {
        this._selected = selected;

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { toggleClass: { selected } });
        }

        if (selected) {
            this.selectedStyleRule.setMany({
                backgroundColor: RADIO_SELECTED_DECLARATIONS.backgroundColor,
                ...borderToStyle({ border: RADIO_SELECTED_DECLARATIONS.border }),
            });
        }
    }

    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this._selected } });
        return element;
    }
}
```

`RadioButton.applySelected`, before → after:

```typescript
// Before (RadioButton.ts:338-349):
private applySelected(selected: boolean): void {
    this.getAria().setChecked(selected);

    this._ring.setBackgroundColor(selected
        ? "var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))"
        : "var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
    this._ring.setBorder(selected
        ? "1px solid var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))"
        : "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");

    this._dot.setOpacity(selected ? 1 : 0);
}
```

```typescript
// After:
private applySelected(selected: boolean): void {
    this.getAria().setChecked(selected);

    this._ring.applyState(selected);

    this._dot.setOpacity(selected ? 1 : 0);
}
```

`_ring: Component` narrows to `_ring: RadioButtonRing`. The constructor's `_ring` block loses its `setBackgroundColor`/`setBorder` calls the same way `Checkbox`'s does; `setBorderRadius("50%")` stays.

---

## Ordered Implementation Steps

1. **Confirm dependencies are in place.** `grep -n 'getRestingExclusionSuffixes\|createStateStyleRule' packages/lib/src/typescript/lib/core/Component.ts` — both must exist (from `state-chrome-isolation-generalization`); `grep -n 'class CheckboxBox\|class RadioButtonRing' packages/lib/src/typescript/lib/component/input/Checkbox.ts packages/lib/src/typescript/lib/component/input/RadioButton.ts` — both must exist (from `checkbox-radio-delegate-static-style-defaults`). Do not proceed if either is missing.

2. **`Checkbox.ts` — extend `_defaultCheckboxBoxOptions`, add the two declaration constants, extend `CheckboxBox`.** Add `backgroundColor` / `border` to the defaults constant, add `CHECKBOX_SELECTED_DECLARATIONS` / `CHECKBOX_INDETERMINATE_DECLARATIONS`, and add the members shown in `## Internal Structure` (`applyState`, the two resolver methods, `getRestingExclusionSuffixes`, the two `StateStyleRule` getters, `render`). Add the four new imports (`DOM`, `type Handle` from `~/core/DOM.js`; `type StateStyleRule` from `~/core/ClassStyleRules.js`; `borderToStyle` from `~/primitive/Border.js`).
   *Check:* `npm run typecheck` passes.

3. **`Checkbox.ts` — rewrite `applySelected` and narrow `_box`'s field type.** Replace the method body and the `_box: Component` declaration exactly as shown. Remove the constructor's now-redundant `_box.setBackgroundColor(...)` / `_box.setBorder(...)` calls.
   *Check:* `npm run typecheck` passes. `grep -n 'setBackgroundColor\|\.setBorder(' packages/lib/src/typescript/lib/component/input/Checkbox.ts` — zero matches anywhere in the file: `applyState`'s active-state branches write through `selectedStyleRule.setMany` / `indeterminateStyleRule.setMany`, never `setBackgroundColor`/`setBorder` directly, and the resting branch calls neither.

4. **`RadioButton.ts` — mirror steps 2-3.** Extend `_defaultRadioButtonRingOptions`, add `RADIO_SELECTED_DECLARATIONS`, extend `RadioButtonRing`; rewrite `applySelected`; narrow `_ring`'s field type; remove the constructor's redundant calls; add the same four imports.
   *Check:* `npm run typecheck` passes. `grep -n 'setBackgroundColor\|\.setBorder(' packages/lib/src/typescript/lib/component/input/RadioButton.ts` — zero matches, same reasoning as step 3.

5. **New test file `tests/component/input/Checkbox.stateClassHoisting.test.ts`.** Cover `## Expected Behaviour` rows 1-5, following `tests/component/button/ToggleButton.selectedClassHoisting.test.ts` / `tests/component/button/TabButton.stateClassHoisting.test.ts`'s conventions (`_ruleCacheHas` from `~/core/StyleTarget`, `declarationsDuring`/`idSelector` copied from `ClassChromeRules.test.ts`).
   *Check:* `npx vitest run tests/component/input/Checkbox.stateClassHoisting.test.ts` — passes.

6. **New test file `tests/component/input/RadioButton.stateClassHoisting.test.ts`.** Cover rows 6-8, same conventions.
   *Check:* `npx vitest run tests/component/input/RadioButton.stateClassHoisting.test.ts` — passes.

7. **Run `Checkbox.test.ts` / `RadioButton.test.ts` unmodified.** These exercise `setSelected`/`setIndeterminate` transitions already; they must keep passing with no edits, since this plan changes `applySelected`'s implementation but not its observable behaviour.
   *Check:* `npx vitest run tests/component/input/Checkbox.test.ts tests/component/input/RadioButton.test.ts` — all green, zero diff to either file.

8. **`next.md` — add the changelog bullet.** See `## Documentation Impact`.
   *Check:* `npm run docs:api` finishes with zero warnings.

9. **Full verification.** See `## Verification`.

10. **Verify live in a browser.** Non-negotiable — see `## Verification`. Every plan in this mechanism's lineage (`hoist-button-tabbar-state-chrome-rules`, `button-resting-chrome-state-isolation`, `state-style-rule-auto-dedup`) shipped at least one regression the offline harness missed.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Create | `packages/lib/tests/component/input/Checkbox.stateClassHoisting.test.ts` |
| Create | `packages/lib/tests/component/input/RadioButton.stateClassHoisting.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-8 are unit-testable against the recording DOM sink. Rows 9-11 need a live browser (CSS cascade resolution).

| # | Case | Expected |
|---|---|---|
| 1 | A second, default-styled `Checkbox` is set `selected` after a first `Checkbox` has already been selected once (warming the class rule) | No `backgroundColor` write on the second instance's own `#id.selected` rule; `_ruleCacheHas('.CheckboxBox.selected')` is `true` |
| 2 | Same, for `setIndeterminate(true)` | No `backgroundColor` write on `#id.indeterminate`; `_ruleCacheHas('.CheckboxBox.indeterminate')` is `true` |
| 3 | A `Checkbox`'s border, at each of resting / checked / indeterminate | Resting: zero border writes anywhere for this instance (relies entirely on the `.CheckboxBox` class rule established at construction). Checked/indeterminate: all four `border-*` longhands present on `#id.selected` / `#id.indeterminate` every time — never skipped |
| 4 | A `Checkbox` checked then returned to unchecked | Across the whole sequence, `_box`'s base rule (`#id` for border, `#id:not(.selected):not(.indeterminate)` for `backgroundColor`) receives **zero** writes after construction — the checked-state write only ever touched `#id.selected`, so there is nothing to restore when the class is removed |
| 5 | `new Checkbox({ selected: true })`, never mounted until `getElement(true)` is called later | `_box`'s element carries the `.selected` class once rendered (proves the `render()` re-assert, not just the construction-time `applyState` call which no-ops pre-mount) |
| 6 | A second, default-styled `RadioButton` selected after a first has been (warming the class rule) | No `backgroundColor` write on the second instance's `#id.selected`; `_ruleCacheHas('.RadioButtonRing.selected')` is `true` |
| 7 | A `RadioButton`'s border, at resting / selected | Same shape as row 3: zero writes at resting; selected always writes all four longhands directly |
| 8 | `new RadioButton("x", { selected: true })`, never mounted until later | `_ring`'s element carries `.selected` once rendered |
| 9 | Demo app: a `Checkbox` cycled unchecked → checked → indeterminate → unchecked | Each state's background/border is visually correct with no flash of a stale colour |
| 10 | Demo app: several `Checkbox`/`RadioButton` instances in different states on the same screen | Each shows its own correct state independently — the shared class rules never leak one instance's state onto another's |
| 11 | Style Audit panel, on a tab with several checked/indeterminate checkboxes and selected radio buttons | The `background-color` portion of the previously-reported duplicate-body rows is gone for every state; the border portion is gone for the resting state and unchanged (still duplicated, by design) for checked/indeterminate/selected |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants (all expect zero matches — confirms neither file writes `backgroundColor`/`border` through the ordinary setters anywhere, including inside the delegate classes' own methods; every write goes through `selectedStyleRule`/`indeterminateStyleRule`'s `setMany`, or not at all for the resting case):

```
grep -n 'setBackgroundColor\|\.setBorder(' packages/lib/src/typescript/lib/component/input/Checkbox.ts
grep -n 'setBackgroundColor\|\.setBorder(' packages/lib/src/typescript/lib/component/input/RadioButton.ts
```

**Manual browser verification (rows 9-11) is required.** Start a dev server on a spare port from *this worktree*, open `#/inputs`, exercise `Checkbox` (unchecked/checked/indeterminate, including rapid transitions) and `RadioButton` (unselected/selected, within a `ButtonGroup`), and confirm computed styles match at each state with no stale colour. Then open `#/style-audit` and confirm row 11.

---

## Documentation Impact

No exported symbol changes — `CheckboxBox` / `RadioButtonRing` stay module-private. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, directly after the entry the sibling plan adds:

> **`Checkbox`'s checked/indeterminate and `RadioButton`'s selected background now dedupe across instances of the same class, the same way `Button`'s `.pressed` chrome already does.** The resting (unchecked/unselected) border also no longer duplicates per instance. The checked/indeterminate/selected border still writes per instance — matching `Button`'s own `.pressed` border, this property is not part of the dedup mechanism. No consumer action needed; nothing changes visually.

---

## Potential Challenges

- **A future consumer customizing an individual `Checkbox`/`RadioButton`'s box/ring colour.** No such public API exists today (`_box`/`_ring` are private, with no `setBoxBackgroundColor`-style passthrough) — if one is ever added, it changes the "resting is a pure construction constant" premise this plan's `applyState` design relies on, and would need its own re-derivation of whether a resting write is still unnecessary.
- **Forgetting the `render()` re-assert.** Without it, a `Checkbox`/`RadioButton` constructed already-selected shows no `.selected` class until some *other* code path happens to call `applyState` again post-mount — row 5/8 exist specifically to catch this.
- **A future edit adding a *third* write path to `_box`'s base rule** (e.g. a hypothetical per-instance override setter) would reintroduce the "clear on match, never skip" hazard `applyState`'s resting branch currently avoids by never writing at all. If that ever happens, the new write path — not `applyState` — is responsible for using `reconcileRuleDeclaration`'s clear-on-match semantics (already automatic through the ordinary `setBackgroundColor`/`setBorder` setters).

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | The file being changed — `CheckboxBox` (added by the sibling plan, extended here), `applySelected` (372-395) |
| `packages/lib/src/typescript/lib/component/input/RadioButton.ts` | Same, for `RadioButtonRing` / `applySelected` (338-349) |
| `plans/checkbox-radio-delegate-static-style-defaults.md` | Prerequisite — creates `CheckboxBox`/`RadioButtonRing` and their static defaults this plan extends |
| `plans/state-chrome-isolation-generalization.md` | Prerequisite — `getRestingExclusionSuffixes()`, `createStateStyleRule`, `RESTING_ISOLATION_KEYS`; its own `ToggleButton` migration (Internal Structure) is the shape this plan's resolver methods and `TOGGLE_SELECTED_DECLARATIONS`-style module constant mirror |
| `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` | The live precedent for `render()`'s toggle-class re-assert (line 293-297), `setSelected`'s live toggle (177-188), and `TOGGLE_SELECTED_DECLARATIONS` (26-30) — the module-constant pattern this plan's declaration constants copy |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `getPressedClassDeclarations()` — the precedent for excluding border from a state resolver |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `StateStyleRule` (386) — what `createStateStyleRule` returns and what `applyState` calls |
| `packages/lib/tests/component/button/ToggleButton.selectedClassHoisting.test.ts`, `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` | Test conventions this plan's two new test files mirror |

---

## Non-Goals

- **Widening `RESTING_ISOLATION_KEYS` to include border.** Fixed by `state-chrome-isolation-generalization`, not per-component configurable; out of scope for both plans.
- **A public API for customizing an individual `Checkbox`/`RadioButton`'s box/ring colour.** Does not exist today; not added here.
- **`Toggle.ts`'s `_track`/`_thumb`.** Same scope boundary as the sibling plan — not touched.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^isolation-arguably-unneeded]: A closer look suggests the isolation half may not be strictly load-bearing for these two delegates specifically: `_box`/`_ring` expose no public API letting a consumer customize an individual instance's resting colour, and the hazard `getRestingExclusionSuffixes()` guards against — a per-instance resting deviation on bare `#id` (1,0,0) outranking a *deduped-away* class-tier state rule — needs exactly that kind of deviation to exist. Without it, the state-tier write alone (landing on `#id.selected`, specificity (1,1,0), which already beats bare `#id`'s (1,0,0) by class-count regardless of isolation) may be sufficient on its own. This plan uses the established mechanism anyway: every state-rule addition in this codebase so far (`Button`, and `ToggleButton` once migrated) pairs a state rule with resting isolation, so doing one without the other would be a novel partial pattern, not a proven one — and this mechanism's own history (every plan in its lineage shipped at least one live-only-catchable regression) is a reason to prefer the boring, precedented path over a locally-argued shortcut, not a reason to skip it. The cost of including it is one method override with no measurable downside.

[^why-no-resting-write]: This is the one point in this plan's design that required the most care, because the naive port of `Button`'s pattern (an unconditional resting write, "clear on match, never skip") is *wrong* here, not merely unnecessary. `Button`'s pre-isolation `.pressed`/resting writes shared one selector (bare `#id`), which is exactly the scenario `component-chrome-base-tier-hoisting`'s "clear on match" rule exists for: a later matching write must overwrite an earlier deviating one queued on the *same* rule object, or the earlier value survives in the dirty bag. `_box`/`_ring`'s design never creates that scenario, because the active-state write and the resting write target *different* `StyleRule` objects from the start (`#id.selected` / `#id.indeterminate` via `createStateStyleRule`, versus `#id` / `#id:not(...)` via the ordinary chrome setters) — so there is no shared dirty bag for a stale value to survive in. Concretely: `_box`'s base rule's `backgroundColor`/`border` declarations are populated exactly once, when `CheckboxBox`'s own constructor runs (`border` via `Component.applyChromeOptions`'s always-dispatch, `backgroundColor` via the folding `getBackgroundColor()` read at first render) — no code path in this plan calls `setBackgroundColor`/`setBorder` on `_box`/`_ring` again after that, for any state, ever. An unconditional resting-branch write would therefore be redundant on every call (it would always re-assert the exact value already there), not incorrect — but adding it back would misstate *why* it's needed, since the actual justification (overwriting a stale value on a shared selector) does not apply to this design. Row 4 of `## Expected Behaviour` is the regression check: it asserts zero writes to the base rule across a full checked→unchecked cycle, which would fail immediately if a future edit reintroduced an unconditional resting write believing it were required.
