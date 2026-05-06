# Form Validation System — Implementation Plan

## Overview

The validation system for this TypeScript UI framework is **substantially already implemented**. The codebase already contains a working implementation of the core design decisions. This plan documents what already exists and specifies what genuinely remains to be built — the `Form` class and the class-based `ValidationRule<T>` interface with built-in rule classes.

---

## What Already Exists (Do Not Re-implement)

| Artifact | File | Status |
|---|---|---|
| `TooltipColors` interface | `Base/Tooltip.ts` | Complete |
| `Tooltip.attach(component, text, colors?)` | `Base/Tooltip.ts` | Complete |
| `Tooltip.detach(component)` | `Base/Tooltip.ts` | Complete |
| `FieldDecorator` (Fit layout, outline, tooltip) | `Base/validation/FieldDecorator.ts` | Complete |
| `ValidationRule` discriminated union type | `Base/validation/ValidationRule.ts` | Complete |
| `FieldValidationConfig` interface | `Base/validation/ValidationRule.ts` | Complete |
| `FieldValidationResult` interface | `Base/validation/ValidationResult.ts` | Complete |
| `applyRule()` pure function | `Base/validation/Validator.ts` | Complete |
| `Binding.addValidation()` | `Base/Binding.ts` | Complete |
| `Binding.validate()` | `Base/Binding.ts` | Complete |
| `Binding.setValidateOnChange()` | `Base/Binding.ts` | Complete |
| `Theme.validation.error.*` tokens | `Base/Theme.ts` | Complete |
| CSS variable mapping in `themeToVars()` | `Base/Theme.ts` | Complete |
| `DefaultTheme` and `DarkTheme` validation values | `Base/Theme.ts` | Complete |
| Index exports for validation types | `Base/index.ts` | Complete |

---

## What Remains to Be Built

The `Form` class and a class-based `ValidationRule<T>` interface with concrete rule classes. The current codebase uses a discriminated union type `ValidationRule` (not a generic interface with a `validate()` method) and validation is integrated into `Binding`, not a standalone `Form`. The class-based API is an **additive layer** coexisting with the existing union-type rules and `Binding`-based validation.

---

## Architecture Decisions

### `ValidationRule<T>` as Interface, Not Union Type Replacement

The new class-based `IValidationRule<T>` interface lives in a separate file and is the contract that `Form` and built-in rule classes use. `Form` calls `rule.validate(value)` directly without involving `applyRule()`. This preserves the existing Binding-based validation path.

### `Form` is Independent of `Binding`

`Form` is a standalone coordinator that operates on raw `Bindable<T>` components and `FieldDecorator` instances. For simple, record-free forms use `Form`; for `ModelRecord`-bound forms use `Binding`.

### `FieldDecorator` Construction Inside `Form`

`Form` creates `FieldDecorator` instances lazily on first validation failure, exactly as `Binding._validateField()` already does. Once created, the decorator persists (it is not removed when the error clears — only `clearError()` is called), avoiding layout flicker.

### Error Display: Tooltip Not Label

Errors are shown via `Tooltip.attach(this, message, colors)` where colors come from `var(--ts-ui-validation-error-tooltip-*)`. `FieldDecorator` uses a `Fit` layout (no Label child). No extra vertical space is consumed.

---

## Public API (TypeScript Signatures)

### `IValidationRule<T>` — new file

```typescript
// Base/validation/IValidationRule.ts
export interface IValidationRule<T> {
    validate(value: T): string | null;
}
```

### Built-in Rule Classes — new files

```typescript
// Base/validation/rules/Required.ts
export class Required implements IValidationRule<unknown> {
    constructor(message?: string);
    validate(value: unknown): string | null;
}

// Base/validation/rules/MinLength.ts
export class MinLength implements IValidationRule<string> {
    constructor(min: number, message?: string);
    validate(value: string): string | null;
}

// Base/validation/rules/MaxLength.ts
export class MaxLength implements IValidationRule<string> {
    constructor(max: number, message?: string);
    validate(value: string): string | null;
}

// Base/validation/rules/Pattern.ts
export class Pattern implements IValidationRule<string> {
    constructor(pattern: RegExp, message?: string);
    validate(value: string): string | null;
}

// Base/validation/rules/Range.ts
export class Range implements IValidationRule<number> {
    constructor(min: number, max: number, message?: string);
    validate(value: number): string | null;
}
```

### `Form` Class — new file

```typescript
// Base/validation/Form.ts
export class Form {
    addField<T>(
        name: string,
        bindable: Bindable<T>,
        component: Component,
        ...rules: IValidationRule<T>[]
    ): this;

    removeField(name: string): this;

    /** Runs all rules; applies/clears FieldDecorator error state. Returns true if all pass. */
    validate(): boolean;

    clearErrors(): void;

    getValues(): Record<string, unknown>;
}
```

---

## Theme Tokens

Already fully defined. No changes required to `Theme.ts`.

| CSS Variable | DefaultTheme | DarkTheme |
|---|---|---|
| `--ts-ui-validation-error-border` | `rgb(200, 50, 50)` | `rgb(220, 80, 80)` |
| `--ts-ui-validation-error-tooltip-bg` | `rgb(180, 30, 30)` | `rgb(160, 30, 30)` |
| `--ts-ui-validation-error-tooltip-color` | `rgb(255, 255, 255)` | `rgb(255, 220, 220)` |
| `--ts-ui-validation-error-tooltip-border` | `rgb(140, 20, 20)` | `rgb(120, 20, 20)` |

---

## Ordered Implementation Steps

### Step 1 — Create `IValidationRule<T>` Interface

Create `Base/validation/IValidationRule.ts`. Returns `null` for passing, non-empty string for failure.

### Step 2 — Create Built-in Rule Classes

Create `Base/validation/rules/` directory with five files:

- **`Required`**: empty check — `null`, `undefined`, or whitespace-only string. Default message: `'This field is required.'`
- **`MinLength`**: coerce to string, fail if `str.length < min`. Default: `` `Minimum length is ${min} characters.` ``
- **`MaxLength`**: fail if `str.length > max`. Default: `` `Maximum length is ${max} characters.` ``
- **`Pattern`**: `this.pattern.lastIndex = 0; return this.pattern.test(str)` (reset lastIndex to guard against stateful `g` flag). Default: `'Value does not match the required format.'`
- **`Range`**: coerce to number, fail on `isNaN` or out of bounds. Default: `` `Value must be between ${min} and ${max}.` ``

### Step 3 — Create `Form` Class

Create `Base/validation/Form.ts`. Internal `FieldEntry` interface: `{ bindable, component, rules, decorator }`.

- `validate()`: iterates fields, calls each rule's `validate(bindable.getValue())` in order (short-circuit on first failure), calls `decorator.showError(message)` or `decorator.clearError()`.
- Decorator created lazily on first validation failure via `new FieldDecorator(component, component.getParentComponent())`. If `getParentComponent()` returns `null`, log a warning and skip decoration.
- `getValues()`: `Object.fromEntries([...this.fields].map(([name, e]) => [name, e.bindable.getValue()]))`.
- `addField()` with duplicate name replaces the entry (clearing old decorator first).

### Step 4 — Update `index.ts` Exports

Add in the existing `// Validation` section:

```typescript
export type { IValidationRule } from './validation/IValidationRule.js';
export { Form }      from './validation/Form.js';
export { Required }  from './validation/rules/Required.js';
export { MinLength } from './validation/rules/MinLength.js';
export { MaxLength } from './validation/rules/MaxLength.js';
export { Pattern }   from './validation/rules/Pattern.js';
export { Range }     from './validation/rules/Range.js';
```

### Step 5 — Verify No Other Changes Needed

`Tooltip.ts`, `Theme.ts`, `FieldDecorator.ts`, `ValidationRule.ts`, `Validator.ts`, and `Binding.ts` all require **zero modifications**.

---

## Potential Challenges

**`Fit` layout single-child constraint**: `Fit.doLayout()` throws if the container has more than one component. Never add a second child to `FieldDecorator`.

**Decorator stickiness**: once created, `FieldDecorator` stays in the parent for the `Form`'s lifetime. Only `clearError()` is called to hide the error — the decorator is not removed.

**`Pattern` `g` flag**: always reset `lastIndex` to 0 before `test()` to prevent alternating false results.

**`getParentComponent()` timing**: if called before the field is added to a parent, skip decoration and warn.

---

## Files to Create or Modify

| Action | File |
|---|---|
| Create | `Base/validation/IValidationRule.ts` |
| Create | `Base/validation/Form.ts` |
| Create | `Base/validation/rules/Required.ts` |
| Create | `Base/validation/rules/MinLength.ts` |
| Create | `Base/validation/rules/MaxLength.ts` |
| Create | `Base/validation/rules/Pattern.ts` |
| Create | `Base/validation/rules/Range.ts` |
| Modify | `Base/index.ts` (add 7 export lines) |

### Confirmed Unchanged

`Base/Tooltip.ts`, `Base/Theme.ts`, `Base/validation/FieldDecorator.ts`, `Base/validation/ValidationRule.ts`, `Base/validation/ValidationResult.ts`, `Base/validation/Validator.ts`, `Base/Binding.ts`

---

## Critical Files

- `src/typescript/Base/validation/Form.ts`
- `src/typescript/Base/validation/IValidationRule.ts`
- `src/typescript/Base/validation/FieldDecorator.ts`
- `src/typescript/Base/Binding.ts`
- `src/typescript/Base/index.ts`
