# updateHeight Width-Clobbering Fix — Implementation Plan

## Overview

[`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) found a real instance of its clobbering bug in six input classes but deferred it, naming it a different fix shape from the rest of that plan: `TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, and `AbstractPickerField` each have a `private`/`protected` `updateHeight()` that unconditionally calls `setPreferredSize` / `setMaxSize` / `setMinSize` with a hardcoded width. It runs once at the end of the constructor — after `super()` has already dispatched a caller-supplied `preferredSize` / `minSize` / `maxSize` — and again on every theme change via `this.subscribeTheme(() => this.updateHeight())`, discarding the caller's width both times. [`plans/setter-clobbering-followup-orientation.md`](plans/setter-clobbering-followup-orientation.md) confirms this exact follow-up already has its own worktree; this plan is that follow-up.

The standard fix from the precedent plan — seed a static literal into `_default<Class>Options`, delete the imperative call — cannot apply here: the literal is a *height*, and height must keep changing on every theme change as font size shifts, so it can never be pre-baked into a static default. The fix instead rewrites each `updateHeight()` to preserve whatever width is already resolved — the caller's override, or the class default the first time nothing was supplied — and overwrite only the height component. `TextField` already has this shape nearby, in `setBorder()`'s own re-pin of preferred/min/max height after a border change ([`TextField.ts:93-114`](packages/lib/src/typescript/lib/component/input/TextField.ts#L93-L114)); this plan generalises it to `updateHeight()` in all six classes, and to construction time as well as runtime.

All six classes are read in full below — they are not byte-identical copies. `NumberSpinner`'s width fallback is `120`, not `200`; `AbstractPickerField`'s comes from the abstract `getPreferredWidth()` hook (160 / 140 / 200 for `DateField` / `TimeField` / `DateTimeField`); `ComboBox`'s method is `protected`, the rest `private`. `NumberSpinner` measures its *inner* `TextField`'s padding, not its own. None of the six has any other read-back logic nearby — `TextField.setBorder()` is the only existing precedent in this file group, and no other of the six subclasses adds anything like it.

---

## Architecture Decisions

### Read back the raw size *constraint*, not the merged getter

Each rewritten `updateHeight()` reads `this.getPreferredSizeConstraint()?.width`, `this.getMinSizeConstraint()?.width`, and `this.getMaxSizeConstraint()?.width` — not `getPreferredSize()` / `getMinSize()` / `getMaxSize()`. The `*Constraint()` accessors return exactly the caller/setter value with no layout-manager involvement ([`Component.ts:2740-2744,2869-2882`](packages/lib/src/typescript/lib/core/Component.ts#L2740-L2744)); the merged getters fold in whatever the component's `LayoutManager` reports.[^merged-getter-risk] For five of the six classes the two are numerically identical today (they use the default `Absolute` manager, whose unset min/max are the `Math.max`/`Math.min` identity elements), but `NumberSpinner` sets an explicit `HBox` ([`NumberSpinner.ts:123-126`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L123-L126)) whose `getMinSize()` folds in a real, non-zero width from the up/down button column. Using the constraint accessor everywhere is one uniform technique instead of a `NumberSpinner`-specific carve-out, and it matches two existing precedents that read back a size for the same reason: [`Glyph.ts:645-659`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L645-L659) and [`ListItem.ts:186`](packages/lib/src/typescript/lib/component/list/ListItem.ts#L186).

### Construction-time read-back is safe: `applyOptions` dispatches size options before `updateHeight` ever runs

`Component.applyOptions` dispatches `preferredSize` / `minSize` / `maxSize` unconditionally when present ([`Component.ts:613-615`](packages/lib/src/typescript/lib/core/Component.ts#L613-L615)), and this runs inside `super()` — before any of the six classes' own constructor bodies call `this.updateHeight()` for the first time. `TextInput.applyOptions` and `AbstractInput.applyOptions` (the two shared bases behind these six classes) both call `super.applyOptions(options)` first, and `ComboBox` / `NumberSpinner` / `AbstractPickerField`'s own `applyOptions` overrides do too — none of the three intercepts `preferredSize` / `minSize` / `maxSize` before the base runs.[^ordering-confirmed] So the very first `updateHeight()` call already sees a caller-supplied width through the constraint accessor; there's no "first-call always sees null" special case to guard against.

### Height stays fully re-derived; width is the only preserved axis

If a caller passes `minSize: { width: 50, height: 999 }`, the `999` is still discarded on every call — only the `width` survives. This matches the framework's line-box model: the single-line height is a computed, non-configurable property of every field in this group, and the caller-facing knob is the width. This is unchanged from today's (buggy) behaviour for height and is not a new limitation this plan introduces.

### No `_default<Class>Options` bag changes

None of the six classes seeds `preferredSize` / `minSize` / `maxSize` in its `_default*Options` bag today, and this plan doesn't add one. The fallback literal (`200`, `120`, or `getPreferredWidth()`) stays inline in `updateHeight()` exactly as it is today — promoting it to a bag entry would need a placeholder height that violates the same "can't pre-bake a theme-reactive value" reasoning the precedent plan used to defer this bug in the first place, and would require a new row in the default-resolution registry ([`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s "Class-level defaults must survive the getter") for a value nothing outside `updateHeight()` would ever read.

---

## Internal Structure

The shared shape, applied to all six `updateHeight()` methods (width fallback and height-measurement inputs vary — see the table below):

```typescript
private updateHeight(): void {           // visibility and name vary — see table
    const h = Util.singleLineBoxHeight(/* per-class inputs, unchanged */);

    const width = this.getPreferredSizeConstraint()?.width ?? <WIDTH_FALLBACK>;
    this.setPreferredSize({ width, height: h });

    const maxWidth = this.getMaxSizeConstraint()?.width ?? <MAX_FALLBACK>;
    this.setMaxSize({ width: maxWidth, height: h });

    // Min-height pinned to the single-line box so the field can't be
    // vertically compressed below one line; min-width preserves whatever
    // was already resolved (a caller override, or 0 by default) instead of
    // re-asserting a literal on every call.
    const minWidth = this.getMinSizeConstraint()?.width ?? 0;
    this.setMinSize({ width: minWidth, height: h });
}
```

Per-class specifics:

| File | Method | Visibility | `<WIDTH_FALLBACK>` | `<MAX_FALLBACK>` | Height-measurement inputs (unchanged) |
|---|---|---|---|---|---|
| [`TextField.ts:64-73`](packages/lib/src/typescript/lib/component/input/TextField.ts#L64-L73) | `updateHeight` | `private` | `200` | `Number.MAX_SAFE_INTEGER` | `this.getInsets(), this.getPadding(), this.getBorderSize()` |
| [`PasswordField.ts:75-84`](packages/lib/src/typescript/lib/component/input/PasswordField.ts#L75-L84) | `updateHeight` | `private` | `200` | `Number.MAX_SAFE_INTEGER` | same as `TextField` |
| [`UsernameField.ts:74-83`](packages/lib/src/typescript/lib/component/input/UsernameField.ts#L74-L83) | `updateHeight` | `private` | `200` | `Number.MAX_SAFE_INTEGER` | same as `TextField` |
| [`ComboBox.ts:735-744`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L735-L744) | `updateHeight` | `protected` | `200` | `Number.MAX_SAFE_INTEGER` | same as `TextField` |
| [`NumberSpinner.ts:196-207`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L196-L207) | `updateHeight` | `private` | `120` | `UNBOUNDED` (already imported) | `this.getInsets(), this._input.getPadding(), this.getBorderSize()` — **inner input's** padding |
| [`AbstractPickerField.ts:252-261`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L252-L261) | `updateHeight` | `protected` | `this.getPreferredWidth()` | `Number.MAX_SAFE_INTEGER` | same as `TextField` |

`AbstractPickerField.getPreferredWidth()` is an abstract method returning a static per-subclass literal (`DateField` 160, `TimeField` 140, `DateTimeField` 200 — [`DateField.ts:144-146`](packages/lib/src/typescript/lib/component/input/DateField.ts#L144-L146), [`TimeField.ts:170-172`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L170-L172), [`DateTimeField.ts:167-169`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L167-L169)); calling it from the base's `updateHeight()` during construction is safe because it's a prototype method with no field dependency, not a value written by a constructor cascade. None of the three concrete subclasses overrides `updateHeight()` — the fix at the base class covers all three.

---

## Ordered Implementation Steps

Run `npm test` (in `packages/lib`) after Steps 1-3, again after Steps 4-6, and again after Step 7.

### Step 1 — `TextField.ts`

Replace lines 64-73 with:

```typescript
    private updateHeight(): void {
        const h = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());

        const width = this.getPreferredSizeConstraint()?.width ?? 200;
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? Number.MAX_SAFE_INTEGER;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }
```

Append one sentence to the method's `@remarks` (lines 58-62), after "...adjustments propagate to the layout hint automatically.": "Width is read back from the already-resolved constraint — a caller override, or the class default on the very first call — so only the height component changes on a theme change; `setBorder` below uses the same read-back technique for a border change."

**Verification checkpoint:** `grep -n "setPreferredSize({ width: 200\|setMaxSize({ width: Number.MAX_SAFE_INTEGER, height: h }" packages/lib/src/typescript/lib/component/input/TextField.ts` — zero matches (the literal `200` and the unconditional max no longer appear).

### Step 2 — `PasswordField.ts`

Replace lines 75-84 with:

```typescript
    private updateHeight(): void {
        const h = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());

        const width = this.getPreferredSizeConstraint()?.width ?? 200;
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? Number.MAX_SAFE_INTEGER;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }
```

Append one sentence to the method's `@remarks` (lines 69-73), after "...adjustments propagate to the layout hint automatically.": "Width is read back from the already-resolved constraint — a caller override, or the class default on the very first call — so only the height component changes on a theme change, mirroring `TextField.setBorder`'s own read-back technique."

**Verification checkpoint:** `grep -n "setPreferredSize({ width: 200" packages/lib/src/typescript/lib/component/input/PasswordField.ts` — zero matches.

### Step 3 — `UsernameField.ts`

Replace lines 74-83 with:

```typescript
    private updateHeight(): void {
        const h = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());

        const width = this.getPreferredSizeConstraint()?.width ?? 200;
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? Number.MAX_SAFE_INTEGER;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }
```

Append one sentence to the method's `@remarks` (lines 68-72), after "...adjustments propagate to the layout hint automatically.": "Width is read back from the already-resolved constraint — a caller override, or the class default on the very first call — so only the height component changes on a theme change, mirroring `TextField.setBorder`'s own read-back technique."

**Verification checkpoint:** `grep -n "setPreferredSize({ width: 200" packages/lib/src/typescript/lib/component/input/UsernameField.ts` — zero matches.

### Step 4 — `ComboBox.ts`

Replace lines 735-744 (the `protected updateHeight()`) with:

```typescript
    protected updateHeight(): void {
        const h = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());

        const width = this.getPreferredSizeConstraint()?.width ?? 200;
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? Number.MAX_SAFE_INTEGER;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }
```

Append one sentence to the method's `@remarks` (lines 729-733), after "...without a UA `<input>` probe.": "Width is read back from the already-resolved constraint — a caller override, or the class default on the very first call — so only the height component changes on a theme change, mirroring `TextField.setBorder`'s own read-back technique."

**Verification checkpoint:** `grep -n "setPreferredSize({ width: 200" packages/lib/src/typescript/lib/component/input/ComboBox.ts` — zero matches.

### Step 5 — `NumberSpinner.ts`

Replace lines 196-207 with:

```typescript
    private updateHeight(): void {
        // Reads the *inner* input's padding (not the spinner's own, which is
        // zero) so the spinner matches a standalone TextField's height.
        const h = Util.singleLineBoxHeight(this.getInsets(), this._input.getPadding(), this.getBorderSize());

        const width = this.getPreferredSizeConstraint()?.width ?? 120;
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? UNBOUNDED;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }
```

Append to the method's `@remarks` (lines 189-194): "Width is read back from the already-resolved constraint — a caller override, or the class default on the very first call — so only the height component changes on a theme change, mirroring `TextField.setBorder`'s own read-back technique. The *constraint* accessors are used rather than the merged `getMinSize()` / `getMaxSize()` because this component's own `HBox` layout manager folds a real, non-zero derived width into the merged getters (the up/down button column); reading the raw constraint avoids feeding that derived width back into the explicit `minSize`/`maxSize` on the next call."

**Verification checkpoint:** `grep -n "setPreferredSize({ width: 120" packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` — zero matches. `npx vitest run single-line-min-height` (in `packages/lib`) — the existing "NumberSpinner: the height-only pin doesn't touch its composite min-width floor" case still passes (this plan's fallback is only consulted when the constraint is null, which is never true for `minSize` after the first `updateHeight()` call).

### Step 6 — `AbstractPickerField.ts`

Replace lines 252-261 with:

```typescript
    protected updateHeight(): void {
        const h = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());

        const width = this.getPreferredSizeConstraint()?.width ?? this.getPreferredWidth();
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? Number.MAX_SAFE_INTEGER;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }
```

Change the doc summary (lines 242-244) from "...this field's own chrome; preferred width comes from the subclass-supplied {@link getPreferredWidth}." to "...this field's own chrome; preferred width comes from the already-resolved constraint, falling back to the subclass-supplied {@link getPreferredWidth} on the very first call." Append one sentence to the `@remarks` (lines 246-250), after "...the root's chrome (not the inner input's) governs the box.": "Width is read back from the already-resolved constraint — a caller override, or {@link getPreferredWidth}'s value on the very first call — so only the height component changes on a theme change, mirroring `TextField.setBorder`'s own read-back technique."

**Verification checkpoint:** `grep -n "setPreferredSize({ width: this.getPreferredWidth()" packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` — zero matches (the unconditional call is gone; `getPreferredWidth()` now appears only as the `??` fallback).

### Step 7 — Tests

Create `packages/lib/tests/component/input/single-line-width-preservation.test.ts`:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Regression coverage for the updateHeight()/updateSize() width-clobbering fix
// (plans/setter-clobbering-followup-updateheight.md): TextField, PasswordField,
// UsernameField, ComboBox, NumberSpinner, and every AbstractPickerField
// subclass (DateField stands in here — the fix lives entirely in the shared
// base, so TimeField/DateTimeField exercise the identical code path) used to
// overwrite a caller-supplied preferredSize/minSize/maxSize width with a
// hardcoded literal, both at construction and on every theme change. Kept in
// its own file, like `TextThemeReflow.test.ts` / `TreeFontReflow.test.ts`,
// because `ThemeManager.setTheme` synchronously fires every listener still
// registered in the process.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextField } from '~/component/input/TextField';
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { ComboBox } from '~/component/input/ComboBox';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { DateField } from '~/component/input/DateField';
import { DOM } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

type SizedField = {
    getPreferredSize(): { width: number; height: number } | null;
};

const FIELDS: [string, number, () => SizedField, (size: { width: number; height: number }) => SizedField][] = [
    ['TextField',     200, () => new TextField(),     size => new TextField({ preferredSize: size })],
    ['PasswordField', 200, () => new PasswordField(), size => new PasswordField({ preferredSize: size })],
    ['UsernameField', 200, () => new UsernameField(), size => new UsernameField({ preferredSize: size })],
    ['ComboBox',      200, () => new ComboBox(),      size => new ComboBox({ preferredSize: size })],
    ['NumberSpinner', 120, () => new NumberSpinner(), size => new NumberSpinner({ preferredSize: size })],
    ['DateField',     160, () => new DateField(),     size => new DateField({ preferredSize: size })],
];

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => {
    ThemeManager.setTheme(ModernTheme);
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Single-line inputs — caller-supplied width survives updateHeight', () => {
    for (const [name, defaultWidth, makeDefault, makeOverride] of FIELDS) {
        it(`${name}: keeps the class default width (${defaultWidth}) when the caller passes nothing`, () => {
            expect(makeDefault().getPreferredSize()!.width).toBe(defaultWidth);
        });

        it(`${name}: a caller-supplied preferredSize width survives construction`, () => {
            const field = makeOverride({ width: 321, height: 999 });

            expect(field.getPreferredSize()!.width).toBe(321);
            // Height is still recomputed, never adopted from the caller.
            expect(field.getPreferredSize()!.height).not.toBe(999);
        });

        it(`${name}: a caller-supplied preferredSize width survives a theme change`, () => {
            const field = makeOverride({ width: 321, height: 999 });

            ThemeManager.setTheme(ThemeManager.getTheme());

            expect(field.getPreferredSize()!.width).toBe(321);
        });

        it(`${name}: height still recomputes on a theme change when no explicit size was given`, () => {
            const field  = makeDefault();
            const before = field.getPreferredSize()!.height;

            const originalGetThemeVar = DOM.source.getThemeVar.bind(DOM.source);
            vi.spyOn(DOM.source, 'getThemeVar').mockImplementation(
                (varName: string) => varName === '--ts-ui-font-size' ? '40px' : originalGetThemeVar(varName)
            );
            ThemeManager.setTheme(ThemeManager.getTheme());

            const after = field.getPreferredSize()!.height;

            expect(after).toBeGreaterThan(before);
            expect(field.getPreferredSize()!.width).toBe(defaultWidth);
        });
    }
});

describe('TextField — minSize/maxSize width also survives (preferredSize above covers the shared code path)', () => {
    it('a caller-supplied minSize width survives construction and a theme change', () => {
        const field = new TextField({ minSize: { width: 50, height: 10 } });

        expect(field.getMinSize()!.width).toBe(50);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(field.getMinSize()!.width).toBe(50);
    });

    it('a caller-supplied maxSize width survives construction and a theme change', () => {
        const field = new TextField({ maxSize: { width: 500, height: 10 } });

        expect(field.getMaxSize()!.width).toBe(500);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(field.getMaxSize()!.width).toBe(500);
    });
});

describe('NumberSpinner — the HBox-derived min-width floor is unaffected', () => {
    it('getMinSize().width still reflects the up/down button column after a theme change', () => {
        // Pins this plan's "read the constraint, not the merged getter"
        // decision: feeding the merged `getMinSize()` back into `setMinSize`
        // would bake this component's own layout-derived floor into the
        // explicit constraint, growing on every theme change.
        const spinner = new NumberSpinner();
        const before  = spinner.getMinSize()!.width;

        expect(before).toBeGreaterThan(0);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(spinner.getMinSize()!.width).toBe(before);
    });
});
```

**Verification checkpoint:** `npx vitest run single-line-width-preservation` (in `packages/lib`) — every case passes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/TextField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/PasswordField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/UsernameField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Create | `packages/lib/tests/component/input/single-line-width-preservation.test.ts` |

---

## Expected Behaviour

All cases are unit-testable **(U)** via the offline `installTestDOM` harness already used by `single-line-min-height.test.ts` and `TextThemeReflow.test.ts`.

1. **Default width unchanged when the caller passes nothing (U).** `new TextField().getPreferredSize()!.width === 200`; same for `PasswordField`, `UsernameField`, `ComboBox`; `new NumberSpinner().getPreferredSize()!.width === 120`; `new DateField().getPreferredSize()!.width === 160` (`TimeField` 140, `DateTimeField` 200 — not re-tested individually since the code path is shared, see `## Architecture Decisions`).
2. **Caller-supplied `preferredSize` width survives construction (U).** `new TextField({ preferredSize: { width: 321, height: 999 } }).getPreferredSize()!.width === 321`, and the height is **not** `999` — it's still the freshly computed single-line box height. Same for the other five classes.
3. **Caller-supplied `preferredSize` width survives a theme change (U).** After construction with an explicit width, calling `ThemeManager.setTheme(ThemeManager.getTheme())` (fires every `subscribeTheme` listener, per [`Theme.ts:1406-1410`](packages/lib/src/typescript/lib/core/Theme.ts#L1406-L1410)) leaves `getPreferredSize()!.width` unchanged at the caller's value.
4. **Caller-supplied `minSize`/`maxSize` width also survives, not just `preferredSize` (U).** `new TextField({ minSize: { width: 50, height: 10 } }).getMinSize()!.width === 50`, before and after a theme change; same for `maxSize`.
5. **Height still recomputes on a theme change when no explicit size was given (U).** For a field built with no options, mocking `DOM.source.getThemeVar("--ts-ui-font-size")` to a larger value and then firing a theme change increases `getPreferredSize()!.height` while `width` stays at the class default. This is the case a naive "just short-circuit on caller override" fix would get wrong by *never* recomputing height again.
6. **`NumberSpinner`'s HBox-derived min-width floor survives a theme change unchanged (U).** `new NumberSpinner().getMinSize()!.width` is content-derived (from the up/down button column, already pinned by `single-line-min-height.test.ts`) and stays exactly the same value after `ThemeManager.setTheme(ThemeManager.getTheme())` — it must not grow, which is what would happen if `updateHeight()` fed the *merged* `getMinSize()` back into `setMinSize()` instead of the raw constraint.

---

## Verification

- `npm run typecheck` (in `packages/lib`) — no signature changes anywhere; `updateHeight()` keeps its existing visibility and `(): void` shape in all six classes.
- `npm run test` (in `packages/lib`) — full suite green, including the new `single-line-width-preservation.test.ts` and the pre-existing `single-line-min-height.test.ts` (must still pass unmodified — Step 5's checkpoint calls this out specifically for `NumberSpinner`).
- Grep invariants (final pass, combining the per-step checks above):
  ```
  grep -rn "setPreferredSize({ width: 200\|setPreferredSize({ width: 120\|setPreferredSize({ width: this.getPreferredWidth()" packages/lib/src/typescript/lib/component/input/TextField.ts packages/lib/src/typescript/lib/component/input/PasswordField.ts packages/lib/src/typescript/lib/component/input/UsernameField.ts packages/lib/src/typescript/lib/component/input/ComboBox.ts packages/lib/src/typescript/lib/component/input/NumberSpinner.ts packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts
  ```
  — zero matches (every unconditional literal-width call site is gone).
- Manual smoke (no automated coverage of rendered layout): open the app (`npm run dev`) and confirm a `TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, `DateField`, `TimeField`, and `DateTimeField` built with no explicit width still render at their existing default widths under Modern, Dark, and Classic themes — this is a regression check, nothing should look different from before this plan.
- `npm run docs:api` (in `packages/lib`) is not required — `updateHeight()` is `private`/`protected` in every one of the six classes, already excluded from generated docs; only its doc comment prose changes, not its exported shape.

---

## Documentation Impact

No public API changes — `updateHeight()` is private or protected in all six classes and was never part of the generated docs surface.

A changelog entry will still be needed once this ships, since consumer-visible behaviour changes (a previously-ignored `preferredSize`/`minSize`/`maxSize` width option on these six input classes now works). That belongs in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md), continuing the `### Component defaults` entry the precedent plan started and the sibling follow-ups (`setter-clobbering-followup-orientation.md`, `setter-clobbering-followup-scrollbar-touchaction.md`) have been extending. This is for whoever runs `/implement`, not a required step of this plan.

---

## Potential Challenges

- **Mistaking `getPreferredSize()` for `getPreferredSizeConstraint()`.** The two are numerically identical for five of the six classes (default `Absolute` layout manager), so a version of this fix using the merged getters would pass every test except the `NumberSpinner` min-width regression in Step 5/7 — easy to miss without that specific check. Mitigation: Step 5's and Step 7's `NumberSpinner` checkpoints exist specifically to catch this.
- **The mocked `getThemeVar` in Step 7's test 5 must fall back to the real implementation for every var name it isn't overriding**, or unrelated theme-driven rendering elsewhere in the same field's construction could see an unexpected empty string. The test snippet above captures `originalGetThemeVar` before installing the mock and delegates to it for every other variable name.
- **`AbstractPickerField`'s fix touches three concrete subclasses through one shared method.** `DateField`/`TimeField`/`DateTimeField` don't override `updateHeight()`, so Step 6 alone covers all three — but their own `formatValue`/`parseRaw`/value-round-trip test suites are unrelated and must stay green; the full `npm test` run after Step 6 covers this.

---

## Critical Files

- [`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) — names this exact deferred bug and the reason it needs a different fix shape (see its `## Architecture Decisions` and `## Non-Goals`).
- [`packages/lib/src/typescript/lib/component/input/TextField.ts:93-114`](packages/lib/src/typescript/lib/component/input/TextField.ts#L93-L114) (`setBorder`) — the read-back-and-preserve shape this plan generalises to `updateHeight()` and to construction time.
- [`packages/lib/src/typescript/lib/component/display/Glyph.ts:645-659`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L645-L659) and [`packages/lib/src/typescript/lib/component/list/ListItem.ts:186`](packages/lib/src/typescript/lib/component/list/ListItem.ts#L186) — the existing precedent for reading `getPreferredSizeConstraint()` specifically to avoid layout-manager-derived contamination.
- [`packages/lib/src/typescript/lib/core/Component.ts:613-615`](packages/lib/src/typescript/lib/core/Component.ts#L613-L615) (`applyOptions`'s size dispatch), [`:2740-2744,2869-2882`](packages/lib/src/typescript/lib/core/Component.ts#L2740-L2744) (`getPreferredSizeConstraint`/`getMinSizeConstraint`/`getMaxSizeConstraint`), [`:2928-2930,2969-2971`](packages/lib/src/typescript/lib/core/Component.ts#L2928-L2930) (the merged `getMinSize`/`getMaxSize`, showing the `Math.max`/`Math.min` fold with the layout manager) — the mechanism every decision in this plan relies on.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:47-49`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L47-L49) (`_defaultMinSize`/`_defaultMaxSize` identity-element defaults) and [`packages/lib/src/typescript/lib/component/input/NumberSpinner.ts:123-126`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L123-L126) (the `HBox` that breaks the identity) — confirms exactly why `NumberSpinner` is the one class where the merged-vs-constraint distinction is live.
- [`packages/lib/tests/component/input/single-line-min-height.test.ts`](packages/lib/tests/component/input/single-line-min-height.test.ts) — the existing sizing regression suite this plan must not break, and the table-driven pattern Step 7's new file mirrors.
- [`packages/lib/tests/component/input/TextThemeReflow.test.ts`](packages/lib/tests/component/input/TextThemeReflow.test.ts) and [`packages/lib/tests/component/tree/TreeFontReflow.test.ts`](packages/lib/tests/component/tree/TreeFontReflow.test.ts) — the established pattern for driving and verifying a real reflow through `ThemeManager.setTheme`, and the convention of isolating these tests in their own file.
- [`plans/setter-clobbering-followup-orientation.md`](plans/setter-clobbering-followup-orientation.md) — the sibling follow-up plan from the same audit; its `## Non-Goals` names this plan's worktree explicitly.

---

## Non-Goals

- **Not making height caller-overridable.** A caller-supplied height in `preferredSize`/`minSize`/`maxSize` is still discarded on every `updateHeight()` call, both before and after this plan — height is a computed, theme-reactive property of every field in this group, not a configuration knob. See `## Architecture Decisions`.
- **Not touching `AutoCompleteField`.** It has no `updateHeight()` — its `syncSizeFromTextField()` already reads back its inner `TextField`'s preferred/min/max size and adds its own perimeter, an unrelated (and already-correct) composite-sizing method, not a clobbering site.
- **Not adding a `_default<Class>Options` entry for `preferredSize`/`minSize`/`maxSize`.** See `## Architecture Decisions`.
- **Not fixing `Slider`'s orientation-conditional `preferredSize`/`maxSize`, `ToolBar`'s orientation-driven `border`, or `Scrollbar`'s `setTouchAction`.** These are the other two deferred items from the precedent audit, covered by the separate sibling plans `setter-clobbering-followup-orientation.md` and `setter-clobbering-followup-scrollbar-touchaction.md`.
- **No component's default width or height changes** when nobody customises `preferredSize`/`minSize`/`maxSize`. Every case in `## Expected Behaviour`'s default rows keeps today's values (200 / 200 / 200 / 200 / 120 / 160 / 140 / 200).

---

## Notes

[^merged-getter-risk]: `Component.getMinSize()` / `getMaxSize()` always merge the component's own constraint with `this.getLayoutManager().getMinSize()` / `getMaxSize()` via `Math.max` / `Math.min` ([`Component.ts:2928-2930,2969-2971`](packages/lib/src/typescript/lib/core/Component.ts#L2928-L2930)) — unconditionally, unlike `getPreferredSize()`, which only consults the layout manager when no explicit constraint is set. For a component on the default `Absolute` layout manager, this merge is a no-op: `LayoutManager`'s base `_defaultMinSize` is `{0,0}` and `_defaultMaxSize` is `{UNBOUNDED,UNBOUNDED}` ([`LayoutManager.ts:47-49`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L47-L49)), the identity elements for `Math.max`/`Math.min` respectively, so the merged result equals the raw constraint exactly. `NumberSpinner` breaks this: its explicit `HBox` ([`NumberSpinner.ts:123-126`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L123-L126)) derives a real minimum width from its `_input` (weight 1) and `_btnBox` (containing two fixed-width `SpinButton`s) children, confirmed non-zero by the existing test `single-line-min-height.test.ts`'s "NumberSpinner: the height-only pin doesn't touch its composite min-width floor". If `updateHeight()` read back the *merged* `getMinSize()` instead of the raw constraint, the first post-construction call would write that HBox-derived width into `_options.minSize` directly — permanently baking a layout-manager-derived value into the explicit constraint, which no longer tracks the children if they change, and which a subsequent read-back would re-absorb on every further theme change. Reading `getMinSizeConstraint()` (and the parallel `getMaxSizeConstraint()`, `getPreferredSizeConstraint()`) sidesteps this for all six classes uniformly, rather than writing a `NumberSpinner`-specific exception into an otherwise-shared technique.

[^ordering-confirmed]: Verified by reading each class's `applyOptions` chain: `TextField` and `PasswordField`/`UsernameField` don't override `applyOptions` at all (inherited straight from `TextInput.applyOptions`, [`TextInput.ts:149-150`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L149-L150), which calls `super.applyOptions(options)` first). `AbstractInput.applyOptions` ([`AbstractInput.ts:233-234`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L233-L234)) does the same. `ComboBox.applyOptions` ([`ComboBox.ts:707-708`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L707-L708)), `NumberSpinner.applyOptions` ([`NumberSpinner.ts:163-164`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L163-L164)), and `AbstractPickerField.applyOptions` ([`AbstractPickerField.ts:194-195`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L194-L195)) each call `super.applyOptions(options)` as their first line, before doing any class-specific work — none of the three inspects or removes `preferredSize`/`minSize`/`maxSize` before the base dispatch runs. Grepping `setPreferredSize\|setMinSize\|setMaxSize` in `TextInput.ts` and `AbstractInput.ts` finds no other write to these fields that could run between `super()`'s dispatch and the subclass's own `this.updateHeight()` call.
