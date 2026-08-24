# AbstractInput Height Dedup — Implementation Plan

## Overview

A Style Audit capture shows the `AbstractInput` text-control family (`TextField`, `PasswordField`, `UsernameField`, `ComboBox`, the picker fields, `NumberSpinner`, `AutoCompleteField`) producing three distinct per-instance CSS rule shapes for `min-height`/`max-height`, even though the family only renders **two** real heights: 24px (bordered fields) and 22px (the two borderless inner fields). This plan collapses that to two rows — one per real height — by fixing two independent, unrelated causes of the duplication.

**Cause 1 — a CSS property ordering split.** [`TextField.setBorder`](packages/lib/src/typescript/lib/component/input/TextField.ts#L112) recomputes the field's preferred/min/max height on every border change, and — uniquely among its siblings — is invoked once automatically during construction, before the field has ever computed a real size. At that moment its `min` and `max` guards behave asymmetrically, causing every `TextField`-rooted instance to write `min-height` before `max-height` on its own `#id` rule, while every sibling that doesn't override `setBorder` writes `max-height` first. A rule's declaration order is fixed by the order its properties are first written, so this produces two textually different 24px rules for one visual height. Verified below; the fix is not the simple two-line swap it might look like at first glance.

**Cause 2 — a genuine, missed CSS dedup.** [`NumberSpinner`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L113-121)'s inner field and [`AutoCompleteField`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L114-117)'s inner field each strip their border/radius/outline with the identical three-call recipe (`setBorder("none")`, `setBorderRadius("0")`, `setOutline("none")`), and each write lands on that instance's own `#id` rule because no class in either chain declares those values as a class-tier default. This also happens to be the direct cause of their 22px height (`Util.singleLineBoxHeight` loses the ~1px top+bottom border once it's stripped), so this is the family's second, genuinely-distinct height.

Both fixes are same-behavior, CSS-shape-only changes — verified end to end in this worktree (typecheck clean, full 5316-test suite green) before being reverted, since this plan produces no source diff.

---

## Architecture Decisions

### `TextField.setBorder` skips its whole height recompute until a real preferred size exists

Nest the existing `if (max...)`/`if (min...)` blocks inside the existing `if (pref)` block, keeping their bodies and each other's relative order unchanged:

```typescript
if (pref) {
    this.setPreferredSize({ width: pref.width, height: h });

    if (max && !isUnbounded(max.height)) {
        this.setMaxSize({ width: max.width, height: h });
    }

    if (min) {
        this.setMinSize({ width: min.width, height: h });
    }
}
```

`TextField.setBorder` is invoked once automatically during every instance's construction — before `updateHeight()` has ever run — because `Component.applyChromeOptions` unconditionally dispatches `this.setBorder(...)` for the class's default border. This nesting makes that one premature invocation a complete no-op, so the field's first-ever `setMinSize`/`setMaxSize` write always comes from `updateHeight()` itself — the same call every sibling's first write already comes from, in the same `max`-then-`min` order.[^root-cause]

### `NumberSpinner`'s and `AutoCompleteField`'s inner fields hoist their chrome recipe onto their own class tier

`NumberSpinnerField` ([`NumberSpinner.ts:78`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L78)) already exists as a module-private `TextField` subclass (added by `plans/implemented/text-input-class-tier-migration.md` for its `textAlign` deviation). It gains `border`/`borderRadius`/`outline` as further class-tier deviations, and `NumberSpinner`'s constructor drops the three imperative setter calls. `AutoCompleteField` gets a new, equivalent module-private subclass, `AutoCompleteTextField`, since no dedicated inner-field class exists there today.

This follows the codebase's established "one class per owner" shape for this exact bug (a chrome value duplicated across every instance of one owner, fixed by a module-private subclass carrying the value as a class-tier default) rather than one class shared between `NumberSpinner` and `AutoCompleteField` — even though their recipes are byte-identical — matching the precedent plan's own rejection of a shared class for two internal call sites.[^one-class-per-owner]

---

## Internal Structure

### `component/input/TextField.ts` — `setBorder`

Current body (lines 112-133):

```typescript
setBorder(options: BorderOptions | string): this {
    super.setBorder(options);

    const h    = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());
    const pref = this.getPreferredSize();
    const min  = this.getMinSize();
    const max  = this.getMaxSize();

    if (pref) {
        this.setPreferredSize({ width: pref.width, height: h });
    }

    if (min) {
        this.setMinSize({ width: min.width, height: h });
    }

    if (max && !isUnbounded(max.height)) {
        this.setMaxSize({ width: max.width, height: h });
    }

    return this;
}
```

Replace the three `if` blocks (keep everything above them — `super.setBorder`, the `h`/`pref`/`min`/`max` reads — unchanged) with the nested form from `## Architecture Decisions` above. No import changes; `isUnbounded` is already imported.

Add one sentence to the method's existing `@remarks` JSDoc block, after "...leaves an *unbounded* maximum unbounded.":

```
All three writes now share one gate: before this field's own `updateHeight`
has ever run (the one automatic call during construction, dispatched by
`Component.applyChromeOptions` before the constructor body runs), `pref` is
still `null` and the whole recompute is skipped, so this field's first-ever
size write always comes from `updateHeight` itself — in the same order every
sibling class already uses.
```

### `component/input/NumberSpinner.ts`

Current (lines 68-82):

```typescript
const NUMBER_SPINNER_TEXT_ALIGN = "right";

/**
 * The inner numeric field of a {@link NumberSpinner} — right-aligned by
 * convention, so the alignment is a class default shared by every spinner in
 * the app rather than an imperative per-instance write. The `font` bag spreads
 * `TextInput`'s own and overrides only `textAlign`; the hierarchy walk is a
 * shallow merge, so declaring `textAlign` alone would replace the inherited
 * font bag wholesale.
 */
class NumberSpinnerField extends TextField {
    protected static readonly ownClassStyleDefaults: StyleBag = {
        font: { ...TextInput.ownClassStyleDefaults.font, textAlign: NUMBER_SPINNER_TEXT_ALIGN },
    };
}
```

Replace with:

```typescript
const NUMBER_SPINNER_TEXT_ALIGN = "right";

// Chrome deviation shared by every NumberSpinner's inner field: borderless
// and square-cornered so the outer NumberSpinner's own border reads as the
// control's only edge, and no browser-default focus ring — the outer
// NumberSpinner's `:focus-within::after` rule shows the framework focus
// indicator instead, and the `.NumberSpinner .TextField:focus` rule at
// module top separately suppresses the inner box-shadow that would otherwise
// paint a stripe between the text and the spin-button column.
// `Partial<TextFieldOptions>`-typed (not `StyleBag`) so it can double as the
// constructor's `subclassDefaults` forward, per ARCHITECTURE.md's "Class-
// level defaults must survive the getter" — without that forward, `_options`
// never sees these values and a pre-render `getBorder()`/`getOutline()` would
// answer the inherited `TextInput` default instead.
const NUMBER_SPINNER_FIELD_CHROME: Partial<TextFieldOptions> = {
    border:       "none",
    borderRadius: "0",
    outline:      "none",
};

/**
 * The inner numeric field of a {@link NumberSpinner} — right-aligned and
 * chromeless by convention, so both are class defaults shared by every
 * spinner in the app rather than imperative per-instance writes. The `font`
 * bag spreads `TextInput`'s own and overrides only `textAlign`; the hierarchy
 * walk is a shallow merge, so declaring `textAlign` alone would replace the
 * inherited font bag wholesale.
 */
class NumberSpinnerField extends TextField {
    protected static readonly ownClassStyleDefaults: StyleBag = {
        ...NUMBER_SPINNER_FIELD_CHROME,
        font: { ...TextInput.ownClassStyleDefaults.font, textAlign: NUMBER_SPINNER_TEXT_ALIGN },
    };

    constructor() {
        super(undefined, NUMBER_SPINNER_FIELD_CHROME);
    }
}
```

Add `TextFieldOptions` to the existing `TextField` import (line 6): `import { TextField, TextFieldOptions } from "~/component/input/TextField.js";`.

In `NumberSpinner`'s constructor (lines 113-122), delete the three now-redundant setter calls and their comment, keeping construction + the text write:

```typescript
this._input = new NumberSpinnerField();
this._input.setText(this.formatValue(0));
```

### `component/input/AutoCompleteField.ts`

Add a new module-private class alongside the existing module-top `registerFocusWithinRing` call (after line 17), and widen the `TextField` import:

```typescript
import { TextField, TextFieldOptions } from "~/component/input/TextField.js";
// ...
import type { StyleBag } from "~/core/ClassStyleRules.js";

// Focus ring highlighting the composite root whenever the inner TextField is
// focused (the helper appends the focus pseudo-element).
registerFocusWithinRing(".AutoCompleteField");

// Chrome deviation shared by every AutoCompleteField's inner field: the
// composite root (below) owns the visible border, so the inner field is
// borderless and square-cornered, with no browser-default focus ring (the
// composite's own `:focus-within` ring, wired by `registerFocusWithinRing`
// above, shows instead). `Partial<TextFieldOptions>`-typed (not `StyleBag`)
// so it can double as the constructor's `subclassDefaults` forward, per
// ARCHITECTURE.md's "Class-level defaults must survive the getter" — without
// that forward, `_options` never sees these values and a pre-render
// `getBorder()`/`getOutline()` would answer the inherited `TextInput`
// default instead.
const AUTOCOMPLETE_FIELD_CHROME: Partial<TextFieldOptions> = {
    border:       "none",
    borderRadius: "0",
    outline:      "none",
};

/**
 * The inner text field of an {@link AutoCompleteField} — borderless and
 * chromeless by convention, so the composite root's own border reads as the
 * control's only edge.
 */
class AutoCompleteTextField extends TextField {
    protected static readonly ownClassStyleDefaults: StyleBag = AUTOCOMPLETE_FIELD_CHROME;

    constructor() {
        super(undefined, AUTOCOMPLETE_FIELD_CHROME);
    }
}
```

In `AutoCompleteField`'s constructor (lines 114-117), replace the four lines with one:

```typescript
this._textField = new AutoCompleteTextField();
```

`private _textField: TextField;` (line 93) stays typed as `TextField` — unchanged, same pattern as `NumberSpinner._input`.

### `packages/lib/tests/component/input/TextInputClassTier.test.ts`

Widen the import block (after the existing `NumberEditor` import) with the four newly-exercised classes:

```typescript
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { ComboBox } from '~/component/input/ComboBox';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
```

Replace row 5's expectation (the existing `it('row 5: ...')` block, [`TextInputClassTier.test.ts:142-155`](packages/lib/tests/component/input/TextInputClassTier.test.ts#L142)) — only the first `expect(...)` line changes, everything else in that test is unchanged:

```typescript
expect(realDeclarations(classDeclarations)).toEqual({
    textAlign:    'right',
    borderTop:    'none',
    borderRight:  'none',
    borderBottom: 'none',
    borderLeft:   'none',
    borderRadius: '0',
    outline:      'none',
});
```

Add four new tests inside the existing `describe('TextInput class-tier style migration', ...)` block, after row 8 (the file's last existing test):

```typescript
it('every single-line AbstractInput leaf writes maxHeight before minHeight on its own #id rule', () => {
    const sink = DOM.sink as RecordingDOMSink;

    const leaves: Array<[string, () => { getElement(createIfMissing?: boolean): unknown; getId(): string }]> = [
        ['TextField',                     () => new TextField()],
        ['PasswordField',                 () => new PasswordField()],
        ['UsernameField',                 () => new UsernameField()],
        ['ComboBox',                      () => new ComboBox()],
        ['DateField',                     () => new DateField()],
        ['NumberSpinner inner field',     () => (new NumberSpinner() as any)._input],
        ['AutoCompleteField inner field', () => (new AutoCompleteField() as any)._textField],
    ];

    for (const [label, make] of leaves) {
        (make() as any).getElement(true); // throwaway, primes this class's shared rule

        const instance = make() as any;
        const declarations = declarationsDuring(sink, idSelector(instance), () => instance.getElement(true));
        const heightOrder  = Object.keys(realDeclarations(declarations))
            .filter((k) => k === 'minHeight' || k === 'maxHeight');

        expect(heightOrder, label).toEqual(['maxHeight', 'minHeight']);
    }
});

it('a new .AutoCompleteTextField class rule carries the borderless chrome, and AutoCompleteField\'s inner field has none of it on its own #id rule', () => {
    const sink = DOM.sink as RecordingDOMSink;

    // First-ever AutoCompleteField construction+render in this file: captures
    // .AutoCompleteTextField's one-time content write — see the file banner.
    const primer = new AutoCompleteField();
    const classDeclarations = declarationsDuring(sink, '.AutoCompleteTextField', () => primer.getElement(true));
    expect(realDeclarations(classDeclarations)).toEqual({
        borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
        borderRadius: '0',
        outline: 'none',
    });

    const field = new AutoCompleteField();
    const textField = (field as any)._textField;
    const idDeclarations = declarationsDuring(sink, idSelector(textField), () => field.getElement(true));
    expect(realDeclarations(idDeclarations).borderTop).toBeUndefined();
    expect(realDeclarations(idDeclarations).borderRadius).toBeUndefined();
    expect(realDeclarations(idDeclarations).outline).toBeUndefined();
});

it('an unrendered NumberSpinner inner field resolves border/borderRadius/outline from the class tier with no CSS involved (regression guard — already true before this plan, via the imperative setter)', () => {
    const input = (new NumberSpinner() as any)._input;
    expect(input.getBorder()).toEqual({ border: 'none' });
    expect(input.getBorderRadius()).toBe('0');
    expect(input.getOutline()).toBe('none');
});

it('an unrendered AutoCompleteField inner field resolves border/borderRadius/outline from the class tier with no CSS involved', () => {
    const field = (new AutoCompleteField() as any)._textField;
    expect(field.getBorder()).toEqual({ border: 'none' });
    expect(field.getBorderRadius()).toBe('0');
    expect(field.getOutline()).toBe('none');
});
```

Row 3 of `## Expected Behaviour` (no real chrome declaration on `NumberSpinner`'s own inner-field `#id` rule) needs no new test — it's the second half of the now-updated row 5 test above, mirroring how the existing row 5 test already checked `idDeclarations.textAlign` after checking the class rule; add the matching three lines there too:

```typescript
const idDeclarations = declarationsDuring(sink, idSelector(input), () => spinner.getElement(true));
expect(idDeclarations.textAlign).toBeUndefined();
expect(realDeclarations(idDeclarations).borderTop).toBeUndefined();
expect(realDeclarations(idDeclarations).borderRadius).toBeUndefined();
expect(realDeclarations(idDeclarations).outline).toBeUndefined();
```

---

## Ordered Implementation Steps

1. **Write the dedup tests first**, in `packages/lib/tests/component/input/TextInputClassTier.test.ts` per `## Internal Structure` above (widened imports, the updated row 5, and the four new tests), plus the six registry rows in `default-options-fallback.test.ts` from `## Expected Behaviour` row 9.
   *Check:* `npx vitest run tests/component/input/TextInputClassTier.test.ts tests/component/default-options-fallback.test.ts` from `packages/lib`. Rows 1-5 fail (the source hasn't changed yet): the new ordering test (row 1), the modified `NumberSpinnerField`-rule test (rows 2+3, one test block), and the new `AutoCompleteTextField`-rule test (rows 4+5, one test block). Rows 6-9 **pass already** — they're regression guards, not red-first cases, because the current imperative `setBorder("none")`/`setBorderRadius("0")`/`setOutline("none")` calls already make those getters answer correctly today; only *where* the value comes from changes. See `## Expected Behaviour`'s own note on this.

2. **`component/input/TextField.ts`** — apply the `setBorder` fix and JSDoc addition from `## Internal Structure`.
   *Check:* `npm run typecheck`.

3. **`component/input/NumberSpinner.ts`** — add `NUMBER_SPINNER_FIELD_CHROME`, widen `ownClassStyleDefaults`, add the constructor, widen the `TextField` import, delete the three setter calls from `NumberSpinner`'s own constructor.
   *Check:* `npm run typecheck`. `grep -n '_input.setBorder\|_input.setBorderRadius\|_input.setOutline' packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` — zero matches.

4. **`component/input/AutoCompleteField.ts`** — add `AUTOCOMPLETE_FIELD_CHROME` and `AutoCompleteTextField`, widen the `TextField` import, add the `StyleBag` type import, replace the four-line construction with one.
   *Check:* `npm run typecheck`. `grep -n '_textField.setBorder\|_textField.setBorderRadius\|_textField.setOutline' packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` — zero matches.

5. **Re-run step 1's tests** — all green: `npx vitest run tests/component/input/TextInputClassTier.test.ts tests/component/default-options-fallback.test.ts`.

6. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. Expected: every test green with no edits to any file outside `## Files to Create / Modify / Delete` — confirmed against this exact diff in this worktree before this plan was written.[^suite-green]

7. **Add the changelog entry** — see `## Documentation Impact`.

8. **Verify live in a browser** — see `## Verification`. Not reachable offline (the offline harness records CSS writes; it doesn't render a Style Audit capture).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/TextField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` |
| Modify | `packages/lib/tests/component/input/TextInputClassTier.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-9 are unit-testable against the recording DOM sink, in `TextInputClassTier.test.ts`; each measures a *second* instance after a first throwaway has primed the shared class rule, matching that file's own established convention. Row 10 needs a live browser.

Rows 1, 2, 3, 4, 5 are genuine red-first cases: today the ordering test fails (`TextField`'s rule writes `minHeight` before `maxHeight`) and the two class-rule-content checks fail (`.NumberSpinnerField` doesn't yet carry the chrome keys, `.AutoCompleteTextField` doesn't exist yet). Rows 6, 7, 8, 9 pass **before this plan's changes too** — the current imperative `setBorder("none")`/`setBorderRadius("0")`/`setOutline("none")` calls already cache those values onto the instance's own style layer, so the getters already answer correctly; only *which layer* supplies the value moves, from instance to class tier. They're regression guards, the same role rows 7-8 played in the precedent plan.

| # | Case | Expected |
|---|---|---|
| 1 | A `TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `DateField`, `NumberSpinner`'s inner field, and `AutoCompleteField`'s inner field each render | Each instance's own `#id` rule writes `maxHeight` before `minHeight` — identical relative order across all seven |
| 2 | The `.NumberSpinnerField` shared class rule, after any `NumberSpinner` has rendered | Exactly `{ textAlign: "right", borderTop: "none", borderRight: "none", borderBottom: "none", borderLeft: "none", borderRadius: "0", outline: "none" }` — the existing `textAlign` entry plus the three new chrome keys |
| 3 | `NumberSpinner`'s inner field renders | No real `border`/`borderRadius`/`outline` declaration on its own `#id` rule (the class rule from row 2 supplies them) |
| 4 | A new `.AutoCompleteTextField` shared class rule, after any `AutoCompleteField` has rendered | Exactly `{ borderTop: "none", borderRight: "none", borderBottom: "none", borderLeft: "none", borderRadius: "0", outline: "none" }` |
| 5 | `AutoCompleteField`'s inner field renders | No real `border`/`borderRadius`/`outline` declaration on its own `#id` rule |
| 6 | `getBorder()`/`getBorderRadius()`/`getOutline()` on an **unrendered** `NumberSpinner._input` | `{ border: "none" }`, `"0"`, `"none"` — resolved from the class tier, no CSS involved (regression guard, see above) |
| 7 | `getBorder()`/`getBorderRadius()`/`getOutline()` on an **unrendered** `AutoCompleteField._textField` | `{ border: "none" }`, `"0"`, `"none"` (regression guard) |
| 8 | `getTextAlign()` on `NumberSpinner._input` (pre- and post-fix) | Still `"right"` — unchanged; already covered by the file's existing row 7 test, no new code needed |
| 9 | The `default-resolution registry` in `default-options-fallback.test.ts` | New rows for `NumberSpinner._input` and `AutoCompleteField._textField`'s `border`/`borderRadius`/`outline` all resolve to the class default on a bare construction (regression guard, see above) |
| 10 | Manual — `#/style-audit`, Refresh, with every `#/baseline`-style demo row and `#/misc`'s slow-table window already visited | The `AbstractInput`-family min/max-height duplication collapses from three rows to two (one per real height: 24px, 22px); total per-instance rule count drops further from the chrome dedup |

Row 9's exact registry additions (append after the existing `'NumberSpinner _input textAlign'` row, [`default-options-fallback.test.ts:276`](packages/lib/tests/component/default-options-fallback.test.ts#L276)):

```typescript
{ label: 'NumberSpinner _input border',            resolve: () => (new NumberSpinner() as any)._input.getBorder(),            expected: { border: 'none' } },
{ label: 'NumberSpinner _input borderRadius',       resolve: () => (new NumberSpinner() as any)._input.getBorderRadius(),      expected: '0' },
{ label: 'NumberSpinner _input outline',            resolve: () => (new NumberSpinner() as any)._input.getOutline(),           expected: 'none' },
{ label: 'AutoCompleteField _textField border',       resolve: () => (new AutoCompleteField() as any)._textField.getBorder(),       expected: { border: 'none' } },
{ label: 'AutoCompleteField _textField borderRadius', resolve: () => (new AutoCompleteField() as any)._textField.getBorderRadius(), expected: '0' },
{ label: 'AutoCompleteField _textField outline',      resolve: () => (new AutoCompleteField() as any)._textField.getOutline(),      expected: 'none' },
```

`AutoCompleteField` needs its own import added to that file: `import { AutoCompleteField } from '~/component/input/AutoCompleteField';`.

---

## Verification

```
npm run typecheck
npm test
npm run lint
```

Grep invariants, all expecting zero matches:

```
grep -n '_input.setBorder\|_input.setBorderRadius\|_input.setOutline' packages/lib/src/typescript/lib/component/input/NumberSpinner.ts
grep -n '_textField.setBorder\|_textField.setBorderRadius\|_textField.setOutline' packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts
```

**Manual browser verification (row 10) is required.** Start a dev server on a spare port from *this worktree* — confirm with `readlink /proc/<pid>/cwd` that it resolves here, not the main tree or another worktree. Open `#/style-audit`, click Refresh, after visiting a screen with a representative set of `AbstractInput` controls on it (a `TextField`, `PasswordField`/`UsernameField`, `ComboBox`, a picker field, `NumberSpinner`, `AutoCompleteField`) — confirm the family's `min-height`/`max-height` duplicate-rule rows drop from three to two, and that every affected control's rendered height and focus/border chrome look unchanged from before (this plan changes no visual output, only which CSS rule supplies it).

---

## Documentation Impact

No exported symbol changes — nothing for `npm run docs:api` to pick up. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, appended at the end of the file (after the existing "triangle glyph inside a `Scrollbar`'s arrow buttons" bullet, itself the last entry under the second `## Changed` → `### Components` list):

> **`TextField` and every class built on it no longer duplicate their `min-height`/`max-height` CSS declarations in two different property orders.** Every `AbstractInput` text control's own CSS rule now writes `max-height` before `min-height`, matching `PasswordField`/`UsernameField`/`ComboBox`/the picker fields, which already did. `NumberSpinner`'s and `AutoCompleteField`'s inner fields also no longer repeat their borderless chrome (`border: none`, `border-radius: 0`, `outline: none`) on every instance's own rule — it now comes from one shared class rule each (`.NumberSpinnerField`, and a new `.AutoCompleteTextField`). Nothing changes visually; only which CSS rule supplies each declaration. No consumer action is needed.

---

## Potential Challenges

- **A subclass that later customises `NumberSpinnerField`'s or `AutoCompleteTextField`'s `font` bag without spreading the existing one would silently drop the chrome deviation too**, since `ownClassStyleDefaults` is one shallow-merged object per class (`## Architecture Decisions` in `text-input-class-tier-migration.md` already flags this same trap for `font` alone). Mitigated by `## Expected Behaviour` rows 2/4, which fail loudly (wrong declaration count) if this happens.
- **`NUMBER_SPINNER_FIELD_CHROME`/`AUTOCOMPLETE_FIELD_CHROME` must be forwarded as the constructor's `subclassDefaults`, not just referenced by `ownClassStyleDefaults`.** Skipping the constructor forward would still produce a correct CSS rule but a wrong pre-render `getBorder()`/`getBorderRadius()`/`getOutline()` (falling back to the inherited `TextInput` default instead) — this is exactly the trap ARCHITECTURE.md's "Class-level defaults must survive the getter" section describes, and rows 6/7 (plus the registry rows) exist specifically to catch it. Verified directly in this worktree: without the constructor forward, the pre-render getters return the wrong value even though the CSS rule is right.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/TextField.ts` | `setBorder`'s current body — the method being fixed |
| `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` | `NumberSpinnerField` — the existing precedent this plan extends, and the constructor call site being simplified |
| `packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` | The second borderless-inner-field owner, and where the new `AutoCompleteTextField` is added |
| `packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts` | `NumberEditorField` — confirms the "one class per owner" precedent this plan follows, and (via its different chrome recipe) why it stays out of scope |
| `packages/lib/src/typescript/lib/component/table/cell/editor/String.ts` | Confirms `StringEditor`'s inner field uses a different chrome recipe than the two owners this plan touches |
| `packages/lib/src/typescript/lib/core/Component.ts` | Read: `applyOptions`/`applyChromeOptions` (lines 727-825, why `setBorder` fires once automatically during construction), `mergeConstraintSize`/`getMinSize`/`getMaxSize` (lines 3107-3193, why `getMinSize` never returns `null` but `getMaxSize`'s height starts `UNBOUNDED`), `writeStyle`/`flushStyleBag` (lines 5004-5386, why CSS property order is fixed at first insertion) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | Read: `resolveDeclarations` (lines 200-258, confirms `border`/`borderRadius`/`outline` are legitimate class-tier keys, unlike `padding`) |
| `packages/lib/tests/component/input/TextInputClassTier.test.ts` | The test file this plan extends — existing `declarationsDuring`/`idSelector`/`realDeclarations` helpers and row 5 (the assertion `## Ordered Implementation Steps` step 1 changes) |
| `plans/implemented/text-input-class-tier-migration.md` | The precedent plan: `NumberSpinnerField`'s origin, the "one class per owner" decision and its rejected-alternative footnote, and the Non-Goals this plan picks up |
| `ARCHITECTURE.md` | "Class-level defaults must survive the getter" and "Constructors forward `subclassDefaults`" — the two rules the chrome-dedup fix must satisfy |

---

## Non-Goals

- **The 24px/22px height *values* stay per-instance**, not hoisted to a static class default. `Util.singleLineBoxHeight` reads live theme font metrics, so the number is theme-dependent, not a static literal a class-tier `StyleBag` default could express. A real fix needs a "value-keyed shared rule" mechanism — computed once per distinct resolved value, shared across every instance that resolves to it — which doesn't exist in this codebase yet; the precedent plan already flagged this as its own future follow-on. This plan only collapses the *property-order* split (three CSS shapes down to two) and the *chrome* duplication (fully removable, since border/radius/outline are static) — it does not, and cannot, make the 24px and 22px rows become one row.
- **`NumberEditor`'s and `StringEditor`'s inner fields** (`component/table/cell/editor/Number.ts`, `String.ts`) keep their own hand-rolled chrome. Confirmed by reading both: they use `setBorder({ border: "0px solid transparent" })` (not `"none"`), add `setShadow(...)` and `clearPadding()`, and override `setMaxSize` to stay unbounded — a genuinely different bag from `NumberSpinner`'s/`AutoCompleteField`'s, already flagged as out of scope by the precedent plan's own Non-Goals.
- **`ComboBoxDropdown`'s and `AutoCompleteDropdown`'s inner `List.setBorder("none")`/`setBorderRadius("0")` calls** (`ComboBox.ts:186-187`, `AutoCompleteDropdown.ts:118-119`). Confirmed by grep: neither pairs with a `setOutline("none")` call, and `List` is not an `AbstractInput`/`TextInput` family member — different component, different recipe, unrelated to this plan's height audit finding.
- **`PickerInput`'s per-instance `padding` declaration** and the underlying **min/max-height value-sharing mechanism** — both already Non-Goals of the precedent plan, unaffected by this one.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

**The plan's prescribed declaration order for the two `AutoCompleteTextField`-related tests in `## Internal Structure`'s `TextInputClassTier.test.ts` section had to be swapped.** As written, the plan places `'every single-line AbstractInput leaf writes maxHeight before minHeight...'` immediately before `'a new .AutoCompleteTextField class rule carries the borderless chrome...'`. The leaf-ordering test's own loop constructs an `AutoCompleteField` and calls `getElement(true)` on its inner field as one of its seven leaves — which, per this file's own memoization banner, consumes `.AutoCompleteTextField`'s one-time class-rule content write, since it is a brand-new class with no earlier constructor+render anywhere in the file. Running the tests in the plan's literal order left the dedicated `.AutoCompleteTextField` class-rule test observing an empty declarations map (the content had already been written and flushed during the leaf-ordering test that ran first), failing with `expected {} to deeply equal { borderTop: 'none', ... }`. The fix was to swap the two tests' declaration order — the `.AutoCompleteTextField` class-rule test now runs first (immediately after row 8), so it captures the one-time write, and the leaf-ordering test follows; the leaf-ordering test itself doesn't depend on class-rule content, so the swap has no other effect. This was empirically confirmed: the reordered suite is fully green (220/220 in the two files, 5318/5318 for the full suite), and the same failure reproduces if the order is reverted. `.NumberSpinnerField` needed no such fix because the existing row 5 test (which already primes it) runs earlier in the file, well before the new leaf-ordering test.

**Row 10's manual browser verification (`## Ordered Implementation Steps` step 8) was run and confirms the plan's claim.** A dev server was started from this worktree on a spare port (8123), confirmed via `readlink /proc/<pid>/cwd` to resolve here, not the main tree. After visiting `#/baseline` (a `TextField`, `ComboBox`, `AutoCompleteField`, `DateField`, `TimeField`, `DateTimeField`, and `NumberSpinner` all render there) and opening `#/style-audit` → Refresh, the `AbstractInput`-family plain min/max-height rows are exactly two: `{ max-height: 24px; min-height: 24px; }` (component: `AbstractInput, ComboBox, NumberSpinner`, count 17) and `{ max-height: 22px; min-height: 22px; }` (component: `AbstractInput`, count 6) — down from the pre-fix three shapes. (`AutoCompleteField`'s own composite-root row, which bundles its border declarations together with the same 24px height in one larger body, is a separate, unrelated shape both before and after this plan — it was never one of the three duplicate height-only shapes the audit flagged.) A screenshot of the `#/baseline` row's rendered controls confirmed no visible height, border, or focus-chrome regression.

---

## Notes

[^root-cause]: Confirmed by direct empirical testing in this worktree (a Recording-DOM-sink probe against `#id` rule writes, since a hand-trace alone risks getting the exact mechanism wrong — which is what happened on the first pass here).

    `Component.applyChromeOptions` (`Component.ts:815-825`) is called from `applyOptions`, itself called from inside `Component`'s own constructor — i.e. during every `TextInput`-family instance's `super()` cascade, before the concrete leaf class's own constructor body has run. It reads `border` from the caller's options or the class default (`TextInput`'s own default is always set, `var(--ts-ui-input-border)`), and when defined — always, for this family — calls `this.setBorder(border)`. Virtual dispatch means this reaches `TextField.setBorder`'s override, not the plain `Component.setBorder`, for `TextField` and anything built on it (`NumberSpinnerField`, `NumberEditorField`, and any bare `new TextField()`).

    At that moment, `getPreferredSize()` is still `null` (nothing has computed it yet), so `TextField.setBorder`'s `if (pref)` guard is false pre-fix too — but `getMinSize()` and `getMaxSize()` (`Component.ts:3136-3193`) both route through `mergeConstraintSize` (`Component.ts:3107-3129`), which **never returns `null`** despite its declared `Size | null` return type — it always falls back to a concrete `Size` (`{0, 0}` for min, `{UNBOUNDED, UNBOUNDED}` for max). So pre-fix, `if (min)` is vacuously true and fires a real, premature `setMinSize` write, while `if (max && !isUnbounded(max.height))` correctly stays false (the max fallback height literally *is* `UNBOUNDED`) and skips. That one-sided asymmetry — not the textual order of the two `if` blocks — is what makes `min-height` the first size-constraint key ever queued into the instance's pending CSS-key set, which `flushStyleBag` (`Component.ts:5284-5386`) later replays onto the rule in that fixed order.

    This was verified two ways. First, a probe rendering a bare `TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `DateField`, `NumberSpinner`'s inner field, and `AutoCompleteField`'s inner field showed the first five/consistent group writing `maxWidth, maxHeight, minWidth, minHeight` and the `TextField`-rooted ones writing `minWidth, minHeight, ..., maxWidth, maxHeight` — exactly the family split the audit reported. Second, and more importantly: naively swapping the source order of the `if (min)`/`if (max...)` blocks (the fix a shallow read of the bug suggests) was applied and re-tested — it made **no difference at all**, because on the one call that matters (the premature, pre-`updateHeight` one) only the `min` branch is ever true regardless of which is written first in the source; reordering two branches doesn't change which one fires. Gating both behind `if (pref)` — verified against the same probe — produced identical ordering across all seven cases, with identical final values, and the full 5316-test suite green.

[^one-class-per-owner]: `text-input-class-tier-migration.md`'s own `[^one-class-per-owner]` footnote rejected a single shared field class for `NumberSpinner` and `NumberEditor`'s `textAlign` deviation, for the same reason that applies here: it would add a new export for two internal call sites, where the codebase's precedent (`NumberSpinnerField`/`NumberEditorField` themselves, `CheckboxCheckGlyph`/`RadioButtonDot`) is one small module-private class per owner even when the fix shape repeats. `AutoCompleteTextField` costs one more four-line class and one more one-declaration shared rule; the alternative (a shared base both owners extend) would create a class with no direct owner-specific reason to exist beyond "these two happened to want the same three CSS values today."

[^suite-green]: The exact diff in `## Internal Structure` was applied in this worktree, then reverted before this plan was written. `npx tsc --noEmit -p .` from `packages/lib` reported the identical error set with and without the diff (all pre-existing, in unrelated files — none in `TextField.ts`/`NumberSpinner.ts`/`AutoCompleteField.ts`). `npx vitest run --no-file-parallelism` reported exactly one failure: the existing row 5 in `TextInputClassTier.test.ts`, which asserts `.NumberSpinnerField`'s class rule content and needs the update `## Ordered Implementation Steps` step 1 and `## Expected Behaviour` row 2 specify (it previously asserted the rule held only `{ textAlign: "right" }`; it now correctly holds the three chrome keys too). Every other file — 5307 of 5308 tests before adding this plan's own new rows — passed unmodified.
