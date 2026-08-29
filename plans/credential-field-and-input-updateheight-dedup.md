# Credential-Field Presets, One Single-Line Box Writer, and Form's subclassDefaults — Implementation Plan

## Overview

`UsernameField` and `PasswordField` are copies of `TextField` rather than subclasses of it. All three declare the same four-key defaults bag ([`TextField.ts:24`](packages/lib/src/typescript/lib/component/input/TextField.ts#L24), [`UsernameField.ts:24`](packages/lib/src/typescript/lib/component/input/UsernameField.ts#L24), [`PasswordField.ts:27`](packages/lib/src/typescript/lib/component/input/PasswordField.ts#L27)) and the same `updateHeight()` body, and the two copies have drifted: neither carries `TextField`'s `setBorder` override ([`TextField.ts:120`](packages/lib/src/typescript/lib/component/input/TextField.ts#L120)), and neither calls `pinSingleLineBoxHeight` ([`TextField.ts:80`](packages/lib/src/typescript/lib/component/input/TextField.ts#L80)). This plan makes both extend `TextField`, which retires both copies and both drifts at once.

Four copies of that `updateHeight()` body survive the inheritance change — [`TextField.ts:77`](packages/lib/src/typescript/lib/component/input/TextField.ts#L77), [`ComboBox.ts:838`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L838), [`AbstractPickerField.ts:283`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L283), [`NumberSpinner.ts:278`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L278) — varying only in a default width and, for `NumberSpinner`, in which component's padding feeds the height. The four collapse onto one new protected helper next to the existing `pinSingleLineBoxHeight` on [`AbstractInput.ts:243`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L243).

Bringing `AbstractPickerField` onto that helper also gives it the `pinSingleLineBoxHeight` call it lacks today, so the last classes writing a per-instance `min-height`/`max-height` pair stop doing so. A fourth, unrelated item rides along: [`Form.ts:54`](packages/lib/src/typescript/lib/core/Form.ts#L54) drops the `subclassDefaults` parameter its own generic signature is designed to need.

---

## Architecture Decisions

### `UsernameField` and `PasswordField` become `TextField` presets

Both classes change from `extends TextInput<…>` to `extends TextField<…>`, drop their defaults constant, drop their `ownClassStyleDefaults` registration, and drop their `updateHeight` copy. They keep only what makes them distinct: the input `type`, the credential `name`/`autocomplete` seeding, and their own extra option. This is the shape three other `TextField` presets already use.[^preset-precedent]

### `TextField` becomes generic over its options bag

`TextField` gains `<TOptions extends TextFieldOptions = TextFieldOptions>` and passes it to `TextInput`, exactly as `TextInput` itself does over `TextInputOptions`. Without that type parameter, a subclass carrying its own option (`newPassword`, `email`) would have `this._options` typed as the parent's bag.[^generic-textfield]

### The shared box writer is `AbstractInput.applySingleLineBox(h, defaultWidth)`

`AbstractInput` is the nearest common ancestor of all four remaining callers and already hosts `pinSingleLineBoxHeight`. The helper takes the already-computed height and the first-call default width; each caller keeps its own one-line height expression, because the height's inputs differ per class.[^helper-shape]

`pinSingleLineBoxHeight` becomes `private`, since the new helper is its only caller and the ordering its doc comment warns about is now enforced in one place.[^pin-private]

### The StyleAudit duplicate-height bucket clears with no step of its own

The project's Style Audit only inspects `#id`-scoped rules ([`StyleAudit.ts:120`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L120)). Once `PasswordField`, `UsernameField` and the picker fields resolve their height through a shared `.ClassName.h<px>` rule instead of their own `#id` rule, their contribution to the duplicated `{ max-height: …; min-height: … }` bucket disappears and nothing replaces it.[^audit-scope]

A previous plan declined this extraction because it was tangential to that plan's own one-line-per-subclass fix. That reason does not apply to a plan whose whole subject is the duplication.[^prior-decline]

### `Form` gets a named defaults constant plus the forwarded parameter

`Form`'s inline `{ tag: "form" }` becomes `_defaultFormOptions`, and the constructor takes and spreads `subclassDefaults` over it — the shape `Panel` uses one level up ([`Panel.ts:111`](packages/lib/src/typescript/lib/core/Panel.ts#L111), [`Panel.ts:250`](packages/lib/src/typescript/lib/core/Panel.ts#L250)).[^form-constant]

---

## Public API

```typescript
// component/input/TextField.ts — now generic, mirroring TextInput
class TextField<TOptions extends TextFieldOptions = TextFieldOptions>
    extends TextInput<TOptions>
{
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>);
    setBorder(options: BorderOptions | string): this;   // unchanged
}

const TextFieldCallable = callable(TextField);
type TextFieldCallable<TOptions extends TextFieldOptions = TextFieldOptions> = TextField<TOptions>;
export {
    TextField         as _TextField,
    TextFieldCallable as TextField
};
```

```typescript
// component/input/PasswordField.ts
export interface PasswordFieldOptions extends TextFieldOptions {
    newPassword?: boolean;
}

class PasswordField extends TextField<PasswordFieldOptions> {
    constructor(options?: PasswordFieldOptions, subclassDefaults?: Partial<PasswordFieldOptions>);
}
```

```typescript
// component/input/UsernameField.ts
export interface UsernameFieldOptions extends TextFieldOptions {
    email?: boolean;
}

class UsernameField extends TextField<UsernameFieldOptions> {
    constructor(options?: UsernameFieldOptions, subclassDefaults?: Partial<UsernameFieldOptions>);
}
```

```typescript
// component/input/AbstractInput.ts
protected applySingleLineBox(h: number, defaultWidth: number): void;
private   pinSingleLineBoxHeight(h: number): void;   // was protected
```

```typescript
// core/Form.ts
class Form<TOptions extends FormOptions = FormOptions> extends Panel<TOptions> {
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>);
}
```

---

## Internal Structure

### `AbstractInput.applySingleLineBox`

Body is the current `TextField.updateHeight` tail verbatim, with `200` replaced by the parameter and `Number.MAX_SAFE_INTEGER` written as the already-imported `UNBOUNDED` (the same value — [`Size.ts:18`](packages/lib/src/typescript/lib/primitive/Size.ts#L18)):

```typescript
protected applySingleLineBox(h: number, defaultWidth: number): void {
    this.pinSingleLineBoxHeight(h);

    const width = this.getPreferredSizeConstraint()?.width ?? defaultWidth;
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

### What each caller passes

The four surviving `updateHeight` bodies become a single call each. This table is the whole of the difference between them:

| Caller | Height expression | `defaultWidth` |
|---|---|---|
| `TextField` | `Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize())` | `TEXT_FIELD_DEFAULT_WIDTH` (200) |
| `ComboBox` | `Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize())` | `COMBO_BOX_DEFAULT_WIDTH` (200) |
| `AbstractPickerField` | `Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize())` | `this.getPreferredWidth()` |
| `NumberSpinner` | `Util.singleLineBoxHeight(this.getInsets(), this._input.getPadding(), this.getBorderSize())` | `NUMBER_SPINNER_DEFAULT_WIDTH` (120) |

`AbstractPickerField.getPreferredWidth()` is the abstract per-field width hook ([`AbstractPickerField.ts:193`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L193)); each concrete picker returns a constant, so evaluating it on every call is free.

### Where the height rule lands, before and after

`pinSingleLineBoxHeight` publishes a shared rule named after the instance's **concrete class**, so each class gets its own selector even though the bodies coincide. "Value class" below means that shared `.ClassName.h<px>` rule; the alternative is a real `min-height`/`max-height` pair written to the instance's own `#id` rule.

| Class | Today | After |
|---|---|---|
| `TextField`, `ComboBox`, `NumberSpinner` | value class (`.TextField.h24px`, `.ComboBox.h24px`, `.NumberSpinner.h24px`) | unchanged |
| `PasswordField`, `UsernameField` | real pair on `#id` | `.PasswordField.h24px`, `.UsernameField.h24px` |
| `DateField`, `TimeField`, `DateTimeField` | real pair on `#id` | `.DateField.h24px`, `.TimeField.h24px`, `.DateTimeField.h24px` |

---

## Ordered Implementation Steps

### Phase 1 — `UsernameField` / `PasswordField` become `TextField` presets

1. **`packages/lib/src/typescript/lib/component/input/TextField.ts`** — make the class generic. Change the declaration to `class TextField<TOptions extends TextFieldOptions = TextFieldOptions> extends TextInput<TOptions>`, change the constructor signature to `constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>)`, and add the cast the generic bag needs: `super(options, { ..._defaultTextFieldOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>);` — the same cast [`TextInput.ts:122`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L122) uses. Leave `ownClassStyleDefaults`, `updateHeight` and `setBorder` untouched in this step.

2. **`packages/lib/src/typescript/lib/component/input/TextField.ts`** — update the export block's type alias to the generic form shown in `## Public API` (copy the shape from [`TextInput.ts:728`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L728)).

3. Run `npm -w packages/lib run typecheck`. Expect zero errors — every existing `TextField` reference is unparameterised and resolves through the default type argument.

4. **`packages/lib/src/typescript/lib/component/input/PasswordField.ts`** — rewrite as a preset:
   - `PasswordFieldOptions extends TextFieldOptions` (was `TextInputOptions`); keep `newPassword` and its comment.
   - Delete `_defaultPasswordFieldOptions` and the `ownClassStyleDefaults` field with its comment block.
   - `class PasswordField extends TextField<PasswordFieldOptions>`.
   - Constructor body becomes `super(options, subclassDefaults);` followed by the existing `setType("password")` / `setName` / `setAutoComplete` block, unchanged.
   - Delete `updateHeight` and the `updateHeight()` / `subscribeTheme(…)` calls — `TextField`'s constructor makes both.
   - Imports reduce to `TextField, TextFieldOptions` and `callable`. Remove `TextInput`, `Util`, `Insets`, `StyleBag`.
   - Update the class JSDoc's first line to say it is a `TextField` preset, matching `UsernameField`'s existing wording.

5. **`packages/lib/src/typescript/lib/component/input/UsernameField.ts`** — same rewrite: `UsernameFieldOptions extends TextFieldOptions`, keep `email`, delete `_defaultUsernameFieldOptions`, `ownClassStyleDefaults` and `updateHeight`, `class UsernameField extends TextField<UsernameFieldOptions>`, `super(options, subclassDefaults);`, same import reduction.

6. Run `npm -w packages/lib run typecheck` and `npm -w packages/lib run lint`. Expect zero errors — in particular no `local/require-subclass-defaults` report, because both constructors now forward a parameter.

7. **`packages/lib/tests/component/input/TextInputPaddingActivation.test.ts`** — rewrite the two credential cases. Neither class owns a `.ClassName` rule any more; the padding is delivered by `.TextField`. Replace each test's `.PasswordField` / `.UsernameField` rule-capture block with:
   ```typescript
   expect(declarations.padding).toBeUndefined();
   expect(_ruleCacheHas('.PasswordField')).toBe(false);   // .UsernameField in the second
   expect(_ruleCacheHas('.TextField')).toBe(true);
   expect(field.getPadding()?.getTop()).toBe(3);
   ```
   Rename each `it(…)` to say the padding now comes from `.TextField`. Do **not** assert a `setRuleStyles` write for `.TextField`: the first test in the file already materialised that rule and the module-level rule cache is not cleared between tests (see the file's own banner).

8. **`packages/lib/tests/component/input/TextInputClassTier.test.ts`** — in the `every single-line AbstractInput leaf writes its min-height/max-height pair per its opt-in status` case, change the `PasswordField` and `UsernameField` rows' expected key list from `['maxHeight', 'minHeight']` to `[]`, and update the comment above the table so it no longer names them as held back.

9. **`packages/lib/tests/component/input/CredentialFields.test.ts`** — add one case to the `PasswordField` block mirroring the existing `UsernameField` one: `it('renders type="password"', …)` asserting `lastSetAttr('type')` is `'password'`. This pins the ordering — `TextField`'s constructor sets `type="text"` first, the subclass body overwrites it.

10. **`packages/lib/tests/component/input/single-line-min-height.test.ts`** — add two cases asserting the inherited `setBorder` re-derives the box. For `PasswordField` and `UsernameField`: construct, record `getPreferredSize()!.height`, call `setBorder("2px solid red")`, then expect preferred, minimum and maximum height to each equal `Util.singleLineBoxHeight(field.getInsets(), field.getPadding(), field.getBorderSize())` recomputed after the change — 4 px more than the recorded height, since the class-default border resolves to 0 px against the test fixture's empty `themeVars` and the new one contributes 2 px top and bottom.

11. Run `npm -w packages/lib run test`. Everything green.

### Phase 2 — one single-line box writer

12. **`packages/lib/src/typescript/lib/component/input/AbstractInput.ts`** — add `applySingleLineBox` exactly as in `## Internal Structure`, placed directly above `pinSingleLineBoxHeight`, with JSDoc carrying the shared `@remarks` prose currently duplicated across the callers (the line box plus the component's own chrome; recomputed on every theme change; widths read back from the already-resolved constraint so only height moves). Change `pinSingleLineBoxHeight` from `protected` to `private`.

13. **`packages/lib/src/typescript/lib/component/input/TextField.ts`** — add `const TEXT_FIELD_DEFAULT_WIDTH = 200;` at module scope with a one-line comment ("preferred width on the very first call, before any caller constraint has been resolved"), and reduce `updateHeight`'s body to the single `this.applySingleLineBox(…)` call from the table. Trim its `@remarks` to what is still local (nothing class-specific remains beyond the reference to `setBorder` below it — keep that sentence).

14. **`packages/lib/src/typescript/lib/component/input/ComboBox.ts`** — add `const COMBO_BOX_DEFAULT_WIDTH = 200;` with the same comment and reduce `updateHeight` the same way.

15. **`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts`** — reduce `updateHeight` to `this.applySingleLineBox(Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize()), this.getPreferredWidth());`. This is the one call site that *gains* behaviour: it now pins the shared height rule, which it did not before.

16. **`packages/lib/src/typescript/lib/component/input/NumberSpinner.ts`** — add `const NUMBER_SPINNER_DEFAULT_WIDTH = 120;`, reduce `updateHeight` (keeping its existing inline comment about reading the inner input's padding), and **remove the now-unused `UNBOUNDED` import on line 12** — line 288 was its only use.

17. `grep -rn 'getMaxSizeConstraint' packages/lib/src/typescript/lib/component/input/` — expect exactly one match, inside `AbstractInput.applySingleLineBox`.

18. `grep -rn 'pinSingleLineBoxHeight' packages/lib/src/typescript/lib/` — expect exactly two matches, both in `AbstractInput.ts`.

19. Run `npm -w packages/lib run typecheck` and `npm -w packages/lib run lint`.

20. **`packages/lib/tests/component/input/TextInputClassTier.test.ts`** — change the `DateField` row's expected key list from `['maxHeight', 'minHeight']` to `[]` and finish updating the comment above the table: no leaf is held back any more.

21. Run `npm -w packages/lib run test`. The existing `single-line-width-preservation.test.ts` and `single-line-min-height.test.ts` suites are the regression net for this phase and must pass unchanged.

### Phase 3 — confirm the duplicate-height bucket is gone

22. **`packages/lib/tests/component/input/SingleLineHeightValueClassSharing.test.ts`** — extend the `row 3` case (three classes get three distinct class-keyed selectors, none writing a real height declaration to its own rule) to six classes by adding `PasswordField`, `UsernameField` and `DateField` to its list and imports. Keep the existing per-component read-back — do not assert the six resolve equal heights (they do not under the offline fixture, whose empty `themeVars` make the `TextInput` border contribute 0 while `NumberSpinner`'s literal border contributes 2px).

23. Run `npm -w packages/lib run test`.

24. Manual: start a dev server from this worktree (`npm run dev`, port 8015 — confirm the process's cwd with `readlink /proc/<pid>/cwd` before trusting it, since another server may already be serving a different tree). Visit `#/column` and `#/vbox` (the `LayoutTestPanel` routes that construct `PasswordField` / `UsernameField`) and `#/baseline` (the picker fields), then `#/style-audit`. The audit's duplicate list must no longer contain a row whose body is the bare `{ max-height: <n>px; min-height: <n>px; }` pair. Record the result in the plan's Implementation Notes.

### Phase 4 — `Form` forwards `subclassDefaults`

25. **`packages/lib/src/typescript/lib/core/Form.ts`** — add above the class:
    ```typescript
    /**
     * User-overridable defaults forwarded to `super` via the options bag. The
     * cascade in `Component`'s constructor dispatches each setter once with the
     * final value, so any field the caller supplied wins.
     */
    const _defaultFormOptions: Partial<FormOptions> = {
        tag: "form",
    };
    ```
    Change the constructor to `constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>)` with `super(options, { ..._defaultFormOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>);`. Document the new parameter in the constructor's JSDoc using the wording every sibling uses ("Per-subclass default bag layered over this class's defaults; subclasses forward their `_defaultXxxOptions` constant here").

26. **`packages/lib/tests/component/default-options-fallback.test.ts`** — add a row `{ label: 'Form tag', resolve: () => new Form().getTag(), expected: 'form' }` plus the `Form` import, per ARCHITECTURE.md's requirement that every class defaulting a field is registered.

27. **`packages/lib/tests/core/Form.test.ts`** — add a case: declare a local `class TestForm extends Form { constructor(o?: FormOptions) { super(o, { insets: new Insets(0, 0, 0, 0) }); } }` and assert `new TestForm().getInsets().getTop()` is `0` (the subclass default beat `Panel`'s 4) while `new TestForm().getTag()` is still `'form'` (the class's own default survived). The file already imports `_Form as Form`; add `FormOptions` from the same module and `Insets` from `~/primitive/Insets`.

28. Run `npm -w packages/lib run typecheck`, `npm -w packages/lib run lint`, `npm -w packages/lib run test:lint`, `npm -w packages/lib run test`.

### Phase 5 — documentation

29. **`packages/lib/docs/reference/changelog/next.md`** — add entries for the consumer-visible parts: `PasswordField` and `UsernameField` now extend `TextField` (so both inherit its runtime `setBorder` height re-derivation, and `UsernameField` gains the framework focus mark it was missing); `TextField` is now generic over its options bag; `Form`'s constructor accepts `subclassDefaults`.

30. Run `npm -w packages/lib run docs:llms` and commit the regenerated `packages/lib/llms.txt` — its `PasswordField` line is cut from that class's JSDoc, which step 4 edits.

31. Run `npm -w packages/lib run docs:api` — must finish with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/TextField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/PasswordField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/UsernameField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Form.ts` |
| Modify | `packages/lib/tests/component/input/TextInputPaddingActivation.test.ts` |
| Modify | `packages/lib/tests/component/input/TextInputClassTier.test.ts` |
| Modify | `packages/lib/tests/component/input/CredentialFields.test.ts` |
| Modify | `packages/lib/tests/component/input/single-line-min-height.test.ts` |
| Modify | `packages/lib/tests/component/input/SingleLineHeightValueClassSharing.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/core/Form.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |

---

## Expected Behaviour

Unit-testable unless marked otherwise.

**Credential fields as presets**

1. A rendered `PasswordField`'s element carries `TextField` in its class attribute, between `TextInput` and `PasswordField`; same for `UsernameField`.
2. `new PasswordField()` renders `type="password"` and `new UsernameField()` renders `type="text"`, even though `TextField`'s constructor writes `type="text"` first.
3. Every existing credential default still holds unchanged: `name`/`autocomplete` seeding, `email: true` → `"email"`, `newPassword: true` → `"new-password"`, and a caller-supplied `name`/`autoComplete` winning over each.
4. `new PasswordField().getPadding()!.getTop()` is `3`, and a rendered instance writes no real `padding` declaration to its own `#id` rule. Same for `UsernameField`.
5. No bare `.PasswordField` or `.UsernameField` rule is materialised — only each class's own `.ClassName.h<h>px` value rule from behaviour 12. `.TextField` is materialised, and carries the padding both classes resolve.
6. On a constructed `PasswordField`, `setBorder("2px solid red")` re-derives preferred, minimum and maximum height from the new border — 4 px more than before, against the test fixture whose class-default border resolves to 0 px. Same for `UsernameField`. (Before this plan neither had a `setBorder` override, so all three heights stayed stale.)
7. Manual: a focused `UsernameField` shows the framework's inset focus mark, matching a focused `TextField`. It previously showed the browser's own outline.

**One single-line box writer**

8. On a default instance of each of `TextField`, `ComboBox`, `NumberSpinner` and `DateField`, the three size constraints reported are unchanged from today: preferred `{ defaultWidth, h }`, maximum `{ UNBOUNDED, h }`, minimum `{ 0, h }`, with `defaultWidth` per the table in `## Internal Structure`.
9. A caller-supplied `preferredSize` / `minSize` / `maxSize` width still survives construction and a later theme change for every one of those classes.
10. `NumberSpinner`'s height still derives from its **inner** field's padding, not its own — its resolved height equals `Util.singleLineBoxHeight(spinner.getInsets(), innerField.getPadding(), spinner.getBorderSize())`.
11. A font-size theme change still moves every one of these classes to a new height and swaps its shared class token.

**Shared height rule coverage**

12. A rendered `PasswordField`, `UsernameField`, `DateField`, `TimeField` or `DateTimeField` writes no real `min-height`/`max-height` declaration to its own `#id` rule, and carries a `.ClassName.h<h>px` token instead — one distinct selector per concrete class.
13. Manual: after visiting `#/column`, `#/vbox` and `#/baseline`, the Style Audit at `#/style-audit` lists no duplicate row whose body is the bare `{ max-height: <n>px; min-height: <n>px; }` pair.

**`Form`**

14. `new Form().getTag()` is `'form'`.
15. A subclass that passes `{ insets: new Insets(0, 0, 0, 0) }` as `subclassDefaults` gets `getInsets().getTop() === 0` (beating `Panel`'s default of 4), while `getTag()` is still `'form'`.
16. `Form`'s existing behaviour is untouched: it renders a `<form>`, is a `Panel`, fires `onSubmit` exactly once with `preventDefault()` applied, and `requestSubmit()` on an unrendered form is a no-op.

---

## Verification

- `npm -w packages/lib run typecheck` and `npm -w packages/lib run typecheck:test` — zero errors.
- `npm -w packages/lib run lint` — zero errors; no new `local/require-subclass-defaults` or `local/forward-super-options` reports.
- `npm -w packages/lib run test:lint` — the ESLint rules' own suites still pass.
- `npm -w packages/lib run test` — the full suite, including the seven modified test files.
- `grep -rn 'pinSingleLineBoxHeight' packages/lib/src/typescript/lib/` — exactly two matches, both in `AbstractInput.ts`.
- `grep -rn '_defaultPasswordFieldOptions\|_defaultUsernameFieldOptions' packages/lib/` — zero matches.
- `npm -w packages/lib run docs:api` — finishes with zero warnings.
- Manual, against a dev server started from this worktree (port 8015; verify the serving process's cwd with `readlink /proc/<pid>/cwd` first): `#/column` and `#/vbox` for `PasswordField`/`UsernameField`, `#/baseline` and `#/misc` for `TextField`/`ComboBox`/`NumberSpinner`/the picker fields/`AutoCompleteField`, then `#/style-audit`. Check row heights and focus chrome are visually unchanged apart from behaviour 7, and that behaviour 13 holds.

---

## Documentation Impact

The consumer-facing prose already describes `UsernameField` as "a `TextField` preset" ([`docs/components/UsernameField.md`](packages/lib/docs/components/UsernameField.md)) and `PasswordField` as behaving like `TextField`, so no page needs rewording — the change makes the code match the docs. The generated API pages pick up the new base class automatically from TypeDoc.

`packages/lib/llms.txt` is generated from the classes' JSDoc, and its `PasswordField` line quotes the class comment step 4 edits, so it is regenerated (step 30) rather than hand-edited.

The only hand-written page to touch is [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md), per step 29.

---

## Potential Challenges

- **`TextField`'s constructor sets `type="text"` before the subclass body runs.** `PasswordField` overwrites it after `super()` returns, so the final attribute is correct, but the buffered write happens twice. Behaviour 2 pins the outcome.
- **The rule cache outlives `DOM.reset()`.** `TextInputPaddingActivation.test.ts` deliberately relies on capturing each `.ClassName` rule on its first-ever construction; the rewritten credential cases must assert cache membership, not a fresh `setRuleStyles` write (step 7).
- **`AbstractPickerField` is the only caller whose behaviour changes in Phase 2.** It gains the `pinSingleLineBoxHeight` call; the resolved sizes it reports must not move. `applySingleLineBox` publishes the shared rule *before* the three size writes, which is what keeps the flush from writing the height to `#id` instead.
- **The `UNBOUNDED` import in `NumberSpinner.ts` becomes an orphan.** TypeScript will not flag it; step 16 removes it explicitly.
- **`Form`'s `_defaultFormOptions` makes the file visible to `local/require-subclass-defaults`.** That rule only fires on a named `_default*Options` constant, so a half-done Phase 4 (constant added, parameter not forwarded) now fails lint rather than passing silently — which is the intent.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/input/TextInput.ts:107`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L107) and [`:728`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L728) — the generic-class and generic-callable-export shape `TextField` copies. Its module-level focus rule at [`:30`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L30) is what `UsernameField` starts matching.
- [`packages/lib/src/typescript/lib/component/input/NumberSpinner.ts:96`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L96), [`AutoCompleteField.ts:40`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L40), [`table/cell/editor/Number.ts:21`](packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L21) — the three existing `extends TextField` presets this plan follows.
- [`packages/lib/src/typescript/lib/component/input/AbstractInput.ts:243`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L243) — `pinSingleLineBoxHeight` and the ordering rule its `@remarks` states.
- [`packages/lib/src/typescript/lib/core/Panel.ts:111`](packages/lib/src/typescript/lib/core/Panel.ts#L111) and [`:250`](packages/lib/src/typescript/lib/core/Panel.ts#L250) — the named-constant-plus-forward idiom `Form` adopts.
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts:1026`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1026) — `getStyleClassChain`, which is why the credential fields' elements gain a `TextField` class token.
- [`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts:108`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L108) — the audit, and its `#id`-only scope.
- [`plans/implemented/abstractinput-height-value-class-mechanism.md`](plans/implemented/abstractinput-height-value-class-mechanism.md) — the plan whose Non-Goals held `PasswordField`, `UsernameField` and `AbstractPickerField` back, and whose Implementation Notes record the residue this plan clears.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Constructors forward `subclassDefaults`*, *Class-level defaults must survive the getter*, and *The class tier is hierarchy-aware* (which lists `TextField`/`PasswordField`/`UsernameField` among the classes registering their own deviation — a list Phase 1 shortens).

---

## Non-Goals

- **Editing ARCHITECTURE.md's class list.** Its *hierarchy-aware class tier* paragraph names `PasswordField`/`UsernameField` as `TextInput` deviators. Correcting that sentence is a documentation edit for whoever next revises that section, not part of this change.
- **The `.TextField:focus, .TextArea:focus, .PasswordField:focus` selector list.** `.PasswordField:focus` becomes redundant once the element carries a `TextField` class token, but the rule is harmless and removing it is unrelated cleanup.
- **`AbstractPickerField`'s invalid-border swap.** It exchanges one 1-px border for another, so the box height does not move; it does not need `TextField`'s `setBorder` treatment.
- **The other constructors that swallow `subclassDefaults`.** `DateField` and roughly forty siblings share the gap. `Form` is in scope only because it is a generic base class explicitly built for subclassing; a sweep is separate work.
- **A cross-class pool for the `.ClassName.h<px>` rules.** Five classes resolving 24 px still produce five identical rule bodies under five selectors. The Style Audit does not count them, and merging them across classes was argued and rejected in `abstractinput-height-value-class-mechanism.md`.
- **`TextArea` and `PickerInput`.** Both extend `TextInput` directly and are not single-line boxes; neither has an `updateHeight` to fold in.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^preset-precedent]: Three classes already extend `TextField` to make a preset: `NumberSpinnerField` ([`NumberSpinner.ts:96`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L96)), `AutoCompleteTextField` ([`AutoCompleteField.ts:40`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L40)) and `NumberEditorField` ([`table/cell/editor/Number.ts:21`](packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L21)). Each declares only its own deviation and inherits the height machinery. The copies are not a departure from a rule that existed when they were written: `UsernameField`/`PasswordField` were added on 2026-07-10, and the earliest of those three presets landed on 2026-08-23 (`2c421609`). They are simply the outlier now. Inheriting also fixes both drifts for free rather than by re-implementing: `setBorder`'s runtime height re-derivation, and the `pinSingleLineBoxHeight` call.

[^generic-textfield]: `PasswordFieldOptions` is assignable to `TextFieldOptions`, so `class PasswordField extends TextField` would compile against the non-generic parent — but `this._options` would then be typed `TextFieldOptions`, and the first future line reading `this._options.newPassword` would need a cast. The codebase's answer to "a subclass with its own options bag" is a generic parent: `Text<TOptions>` with `Link extends Text<LinkOptions>` ([`Text.ts:114`](packages/lib/src/typescript/lib/component/input/Text.ts#L114), [`Link.ts:144`](packages/lib/src/typescript/lib/component/input/Link.ts#L144)), and `TextInput<TOptions>` with `TextField extends TextInput<TextFieldOptions>` itself. The default type argument keeps every existing bare `TextField` annotation and `extends TextField` clause compiling untouched, which step 3 checks before any subclass changes.

[^helper-shape]: The three inputs to the height differ per class — `AbstractPickerField` and `NumberSpinner` read padding from different components, and each class has its own first-call default width — so a helper that computed the height itself would need a per-class hook for the padding source. That is more machinery than the one line it would remove. Passing the finished height and the default width leaves each caller a single self-explanatory statement and puts the twelve duplicated lines in one place. A variant that also took the padding component was considered and dropped: it makes three of the four callers pass `this`.

[^pin-private]: `pinSingleLineBoxHeight`'s `@remarks` warn that it must be called *before* the matching `setPreferredSize`/`setMaxSize`/`setMinSize` writes, because on an already-rendered component those setters flush immediately and a flush against the previous height's value class writes the new height to the instance's own rule, where it outranks the shared one permanently. Once `applySingleLineBox` is its only caller, that ordering is structural rather than a documented obligation on every future caller. Narrowing it to `private` is what makes it so.

[^audit-scope]: `auditStyleRules` skips every rule whose selector does not start with `#` ([`StyleAudit.ts:120`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L120)), so the shared `.ClassName.h<px>` rules this change adds are invisible to it — five classes resolving 24 px will produce five rules with identical bodies and the audit will count none of them. What disappears is real: `abstractinput-height-value-class-mechanism.md`'s Implementation Notes recorded that the surviving `{ max-height: 24px; min-height: 24px; }` bucket was contributed by `DateField`/`TimeField`/`DateTimeField` plus `PasswordField`/`UsernameField`, confirmed per-class rather than inferred from the bucket's label. Those are exactly the five classes Phases 1 and 2 opt in. Eligibility for the shared rule has no further gate — `setValueStyleState` publishes `.` + `this.constructor.name` + the token unconditionally, so calling the helper is the whole requirement; it does not depend on the class declaring `ownClassStyleDefaults`. (The audit labels the bucket `AbstractInput` because `buildComponentIndex` takes the *first* non-framework class token on the element, and the class chain is ordered ancestor-first.)

[^prior-decline]: `plans/implemented/input-min-height-and-labeledfieldset-rename.md`'s Non-Goals list reads "Refactoring the duplicated `updateHeight` bodies into a shared helper — out of scope; surgical per-subclass edits only." That plan's own goal was a one-line min-height fix per subclass, so the extraction was tangential to it and would have widened a narrow change. Nothing in the reason is about the extraction being wrong. This plan's scope is the duplication itself, and the helper's home (`AbstractInput`) is the same "don't centralize past `TextInput`" boundary that plan's Critical Files drew — `AbstractInput` sits above `TextInput`, and `ComboBox`/`NumberSpinner`/`AbstractPickerField` do not descend from `TextInput` at all, so the helper cannot live any lower.

[^form-constant]: The alternative is spreading into the existing inline literal — `super(options, { tag: "form", ...(subclassDefaults ?? {}) } as Partial<TOptions>)` — with no named constant. Naming it costs three lines and buys two things: it matches `Panel` one level up and every other component in the tree, and it brings the file inside `local/require-subclass-defaults`, whose scope is deliberately limited to constructors whose second `super()` argument names a `_default<Name>Options` constant. `Form` is invisible to that rule today, which is why it was not among the seventeen constructors fixed by `07a43746`, even though `Form.ts` predates that commit. Note the ordering follows ARCHITECTURE.md — the class's own defaults first, the subclass bag second — so a subclass could in principle override `tag` away from `"form"`; that would be the subclass's own bug, and inverting the order to prevent it would break the documented rule everywhere else.
