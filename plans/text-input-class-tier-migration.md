---
touches-shared:
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/docs/reference/changelog/next.md
---

# TextInput Class-Tier Style Migration — Implementation Plan

## Overview

[`TextInput`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L107)'s constructor writes its font baseline — `font-family`, `font-size`, `line-height` — through `this.setElementCSSRules({...})`. That method ([`Component.ts:1721`](packages/lib/src/typescript/lib/core/Component.ts#L1721)) queues straight onto the component's own `#id` CSS rule, bypassing the class tier entirely — so every `TextField`, `PasswordField`, `UsernameField`, `TextArea`, and `PickerInput` on screen carries its own byte-identical copy of those three declarations. Such a bypass is not a missed comparison that happens to fail; the write has no comparison step at all, and no number of instances can ever make it share a rule.

Two more raw writes in the same family have the same shape. [`TextInput.setTextAlign`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L449) calls `setElementCSSRule("textAlign", align)`; two owners pass it the constant `"right"` for an inner field the caller never sees — [`NumberSpinner`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L96) and [`NumberEditor`](packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L52). And [`TextArea`](packages/lib/src/typescript/lib/component/input/TextArea.ts#L88)'s constructor writes `setElementCSSRules({ resize: "none" })`, the same value on every instance.

This plan routes each of those onto a mechanism the codebase already uses for class-uniform declarations: the hierarchy-aware class tier (`ownClassStyleDefaults`, [ARCHITECTURE.md](ARCHITECTURE.md) *The class tier is hierarchy-aware*) for the font triple and the two right-aligned fields, and a module-level shared class rule for `resize`. No core file changes except one stale doc comment in [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L78).

---

## Architecture Decisions

### The font triple becomes `TextInput.ownClassStyleDefaults.font`

`TextInput` already declares `ownClassStyleDefaults` ([`TextInput.ts:95`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L95)), so it is already a participating class in the hierarchy walk. It gains a `font` sub-bag carrying the same three values the constructor writes today, and the constructor's `setElementCSSRules` call is deleted. [`resolveDeclarations`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L241) turns `font` into CSS for *any* class, not only `Text`-derived ones — nothing about the font path is `Text`-specific.[^font-not-text-specific]

The direct precedent is [`Text.ownClassStyleDefaults`](packages/lib/src/typescript/lib/component/input/Text.ts#L126), which is exactly this shape: a `StyleBag` whose only content is a `font` sub-bag of CSS-ready strings.

### `TextInput` gains `Text`'s `getClassStyleDefaults()` override

The class-tier CSS rule and the pre-render getters read the `font` bag through two different paths, and both must see it. The CSS rule comes from the static `ownClassStyleDefaults` chain; a getter called before first render resolves through [`styleLayers()`](packages/lib/src/typescript/lib/core/Component.ts#L4869), whose class-tier fallback is `getClassStyleDefaults()`. `TextInput` therefore overrides `getClassStyleDefaults()` to graft the same `font` bag on, copying [`Text.getClassStyleDefaults`](packages/lib/src/typescript/lib/component/input/Text.ts#L1453) line for line.[^virtual-dispatch]

### `setTextAlign` writes through `writeStyle`, and each right-aligned owner gets its own field subclass

`TextInput.setTextAlign` changes from a raw `setElementCSSRule` to `this.writeStyle({ font: { textAlign: align } })`, and `getTextAlign()` from `this._options.textAlign ?? null` to `this.resolveFontValue("textAlign")` — the exact pair [`Text`](packages/lib/src/typescript/lib/component/input/Text.ts#L853) already uses. That puts the property on the layered path, where a value matching a lower tier is deduped at flush.

Moving `setTextAlign` alone does not remove any duplicate: nothing in the `TextInput` chain declares a `textAlign` default, so an instance write still has nothing to match against. The two owners that pass a constant each get a module-private `TextField` subclass declaring `textAlign` as a class default, so their instances share one rule and write nothing per instance. This mirrors [`NumberRendererText`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts) — same bug, same fix, one class per owner.[^one-class-per-owner]

Each subclass's `font` bag must spread `TextInput.ownClassStyleDefaults.font` and override only `textAlign`. [`mergeClassStyleDefaults`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L463) is shallow, so a bare `{ textAlign: "right" }` would replace the parent's whole `font` sub-value and un-dedupe `fontFamily`/`fontSize`/`lineHeight` for those instances.

### `styleGroup` cannot carry any of this

[`resolveInstanceStyleDeclarations`](packages/lib/src/typescript/lib/core/Component.ts#L308) — the bag a `styleGroup` shares — reads ten getters, none of them a font getter, and its own comment names `font` among the fields a `styleGroup` does not cover. A `styleGroup` token can never match on `textAlign`, `fontFamily`, `fontSize`, or `lineHeight`.[^stylegroup-settled]

### `TextArea`'s `resize: none` moves to a module-level shared class rule

`resize` has no `StyleBag` key, so the class tier cannot express it. A module-level `new StyleRule({ scope: "class", name: "TextArea", styles: { resize: "none" } })` supplies it once for every instance. Two `StyleRule` objects built for the same selector share one underlying `CSSStyleRule` ([`StyleTarget.ts:185`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L185)), so this rule and the `.TextArea` rule the hierarchy walk generates merge into one, declaring disjoint keys. [`ComboBox.ts:355`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L355) already relies on exactly that overlap.

### What each rule supplies, after the change

| Element | `font-size` from | `text-align` from | `resize` from |
|---|---|---|---|
| `TextField` | `.TextInput` | nothing (browser default) | — |
| `TextArea` | `.TextInput` | nothing (browser default) | `.TextArea` |
| `NumberSpinner`'s inner field | `.TextInput` | `.NumberSpinnerField` | — |
| `NumberEditor`'s inner field | `.TextInput` | `.NumberEditorField` | — |
| a `TextField` after `setTextAlign("center")` | `.TextInput` | its own `#id` rule | — |

---

## Public API

No signature changes. Two behaviours visible through existing getters change:

```typescript
// component/input/TextInput.ts — unchanged signatures, new resolution source
getTextAlign(): string | null;          // now resolves instance → group → class,
                                        // not only this instance's own _options
setTextAlign(align: string | null): this;
clearTextAlign(): this;
```

`getTextAlign()` on a class that declares a `textAlign` class default now reports that default instead of `null`. No shipped `TextInput` subclass declares one today, so every existing class answers exactly as before; the two new subclasses this plan adds answer `"right"`, which is also what they answered before (their owners called `setTextAlign("right")` imperatively).

`clearTextAlign()` on such a class now reverts to the class default rather than removing alignment entirely. That matches `clearCursor` / `clearBackgroundColor` and every other layered `clearX`.

`TextInputOptions.textAlign` is unchanged as an option; its value now lands in the instance style layer instead of `_options`.

---

## Internal Structure

### `component/input/TextInput.ts`

Add two module constants below `_defaultTextInputOptions` ([`TextInput.ts:70-75`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L70)):

```typescript
// The font baseline every text control shares. `line-height` renders the
// input's single line at the same px line box every text control measures
// against (`Util.lineHeightPx`), so the input doesn't inherit the UA
// `line-height: normal` and its baseline coincides with a `Text`/`Label` in
// the same row.
const TEXT_INPUT_FONT: TextStyleBag = {
    fontFamily: "var(--ts-ui-font-family, sans-serif)",
    fontSize:   "var(--ts-ui-font-size, 14px)",
    lineHeight: "calc(1em + var(--ts-ui-line-padding, 2px))",
};

// `_defaultTextInputOptions` is a `Partial<TextInputOptions>` and cannot carry
// a `font` key; the class tier's own bag adds it here, so the CSS rule and the
// getters read one source.
const _textInputClassStyleDefaults: StyleBag = {
    ..._defaultTextInputOptions,
    font: TEXT_INPUT_FONT,
};
```

Replace the static field and add the override:

```typescript
protected static readonly ownClassStyleDefaults: StyleBag = _textInputClassStyleDefaults;

/**
 * Supplies the class-level font defaults `ClassStyleRules.ts` cannot see in
 * `_defaultOptions` — `TextInputOptions` has no `font` field. Prefers
 * `ownClassStyleDefaults` off `this.constructor` (virtual dispatch) so a
 * subclass whose own bag is a complete font bag is reflected here, and falls
 * back to this class's own bag otherwise. Mirrors `Text.getClassStyleDefaults`.
 */
protected getClassStyleDefaults(): StyleBag {
    return {
        ...super.getClassStyleDefaults(),
        font: (this.constructor as typeof TextInput).ownClassStyleDefaults.font ?? TEXT_INPUT_FONT,
    };
}
```

Delete the whole `this.setElementCSSRules({ fontFamily … lineHeight … });` block and its comment from the constructor ([`TextInput.ts:103-115`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L103)). Change the import on [line 5](packages/lib/src/typescript/lib/component/input/TextInput.ts#L5) to `import type { StyleBag, TextStyleBag } from "~/core/ClassStyleRules.js";`.

Rewrite the two accessors ([`TextInput.ts:434`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L434) and [`449`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L449)):

```typescript
getTextAlign(): string | null {
    return this.resolveFontValue("textAlign");
}

setTextAlign(align: string | null): this {
    this.writeStyle({ font: { textAlign: align } });

    return this;
}
```

`clearTextAlign()` keeps its body (`return this.setTextAlign(null);`). Keep all three JSDoc blocks, with two wording updates: `getTextAlign`'s `@returns` becomes "The CSS text-align string, or `null` when neither this instance nor its class declares one", and `clearTextAlign`'s description gains "reverting to the class-tier default when this class declares one".

### `component/input/NumberSpinner.ts`

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

Module-private: not exported, not wrapped in `callable()` — the same treatment `NumberRendererText` and `CheckboxBox` get. In the constructor ([`NumberSpinner.ts:95-96`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L95)) replace `this._input = new TextField();` with `this._input = new NumberSpinnerField();` and delete the `this._input.setTextAlign("right");` line. The field stays declared as `TextField`. Add the imports:

```typescript
import { TextInput } from "~/component/input/TextInput.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
```

### `component/table/cell/editor/Number.ts`

The identical shape, with `NUMBER_EDITOR_TEXT_ALIGN` / `NumberEditorField`. Change the field initializer ([`Number.ts:22`](packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L22)) to `= new NumberEditorField();` and delete `this._textField.setTextAlign("right");` ([line 52](packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L52)). Same two imports.

### `component/input/TextArea.ts`

Delete the `this.setElementCSSRules({ resize: "none" });` call and its comment ([`TextArea.ts:83-88`](packages/lib/src/typescript/lib/component/input/TextArea.ts#L83)). Add above the class:

```typescript
// The `<textarea>` corner grip is the only user-resize affordance on any of
// these components. Pin `resize: none` once, on the shared class rule, so the
// area can never be drag-resized. There is no accompanying option or setter —
// non-resizability is immutable by design. This rule and the `.TextArea` rule
// the class-tier hierarchy walk generates share one underlying CSSStyleRule
// and declare disjoint keys.
(() => {
    new StyleRule({ scope: "class", name: "TextArea", styles: { resize: "none" } });
})();
```

Add `import { StyleRule } from "~/core/StyleTarget.js";`.

### `core/ClassStyleRules.ts` — one doc comment

[`TextStyleBag`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L78)'s comment ends "Only `Text.getClassStyleDefaults()` ever sets `font`." That stops being true. Replace that sentence with: "`Text.getClassStyleDefaults()` and `TextInput.getClassStyleDefaults()` are the two methods that set `font`." Leave the rest of the comment — its warning about flat same-named options is still correct and is why `TextInput`'s own flat `textAlign` option cannot leak into this bag.

---

## Ordered Implementation Steps

1. **Write the dedup tests first**, in a new `packages/lib/tests/component/input/TextInputClassTier.test.ts`. Copy the `declarationsDuring` / `idSelector` helpers from [`tests/core/ClassHierarchyCascade.test.ts:56-81`](packages/lib/tests/core/ClassHierarchyCascade.test.ts#L56). Cover `## Expected Behaviour` rows 1-8.
   *Check:* `npx vitest run tests/component/input/TextInputClassTier.test.ts` from `packages/lib` — rows 1-6 fail, because each component still writes those declarations to its own `#id` rule. Rows 7 and 8 pass already; they are regression guards on behaviour this plan must not change, not red-first cases.

2. **`component/input/TextInput.ts`** — add `TEXT_INPUT_FONT` and `_textInputClassStyleDefaults`, repoint `ownClassStyleDefaults`, add the `getClassStyleDefaults()` override, delete the constructor's `setElementCSSRules` block, widen the type import.
   *Check:* `npm run typecheck`. `grep -n 'setElementCSSRules' packages/lib/src/typescript/lib/component/input/TextInput.ts` — zero matches.

3. **`component/input/TextInput.ts`** — rewrite `getTextAlign` and `setTextAlign` per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'setElementCSSRule' packages/lib/src/typescript/lib/component/input/TextInput.ts` — zero matches. `grep -rn '_options.textAlign' packages/lib/src/typescript/lib` — zero matches.

4. **`component/input/NumberSpinner.ts`** — add `NUMBER_SPINNER_TEXT_ALIGN` and `NumberSpinnerField`, swap the construction, delete the `setTextAlign` call, add the two imports. Leave `setBorder` / `setBorderRadius` / `setOutline` alone (see `## Non-Goals`).
   *Check:* `npm run typecheck`. `grep -n '\.setTextAlign(' packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` — zero matches.

5. **`component/table/cell/editor/Number.ts`** — the same, with `NUMBER_EDITOR_TEXT_ALIGN` / `NumberEditorField`.
   *Check:* `npm run typecheck`. `grep -n '\.setTextAlign(' packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts` — zero matches.

6. **`component/input/TextArea.ts`** — move `resize: none` to the module-level rule, add the `StyleRule` import.
   *Check:* `npm run typecheck`. `grep -n 'setElementCSSRules' packages/lib/src/typescript/lib/component/input/TextArea.ts` — zero matches.

7. **Re-run step 1's tests.** `npx vitest run tests/component/input/TextInputClassTier.test.ts` — all green.

8. **Add the two default-resolution registry rows** to [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), after the existing `'TextField padding'` row ([line 273](packages/lib/tests/component/default-options-fallback.test.ts#L273)). ARCHITECTURE.md's *Class-level defaults must survive the getter* requires a row for every class that defaults a field:
   ```typescript
   { label: 'NumberSpinner _input textAlign', resolve: () => (new NumberSpinner() as any)._input.getTextAlign(), expected: 'right' },
   { label: 'NumberEditor _textField textAlign', resolve: () => (new NumberEditor() as any)._textField.getTextAlign(), expected: 'right' },
   ```
   Add the two imports alongside the existing `TextField` one ([line 22](packages/lib/tests/component/default-options-fallback.test.ts#L22)).
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — green.

9. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. This is expected to pass with **no edits to any existing test** — that was confirmed against the exact code this plan specifies.[^suite-green] Treat any failure as a genuine regression to investigate, not a test to update.

10. **Correct the `TextStyleBag` doc comment** in `core/ClassStyleRules.ts` per `## Internal Structure`.

11. **Add the changelog entry.** See `## Documentation Impact`.

12. **Verify live in a browser.** Non-negotiable — see `## Verification`. Rows 9-12 of `## Expected Behaviour` are not reachable offline.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/input/TextInputClassTier.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextArea.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-8 are unit-testable against the recording DOM sink. Each measures a *second* instance, after a first throwaway has primed the shared rules — the same priming shape [`CellTextSelection.test.ts`](packages/lib/tests/component/table/CellTextSelection.test.ts) uses. Rows 9-12 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | A `TextField` renders | Its `#id` rule's real (non-`null`) declarations are exactly `minHeight` and `maxHeight` — no `fontFamily`, `fontSize`, or `lineHeight` |
| 2 | A `TextArea` renders | Its `#id` rule carries **no** real declaration at all |
| 3 | The `.TextInput` shared rule, after any text input has rendered | Carries `fontFamily: var(--ts-ui-font-family, sans-serif)`, `fontSize: var(--ts-ui-font-size, 14px)`, and `lineHeight: calc(1em + var(--ts-ui-line-padding, 2px))`, alongside its existing background/border/radius declarations |
| 4 | A `PickerInput` inside a `DateField` renders | Its `#id` rule's only real declaration is `padding: 0px 3px 0px 3px` (see `## Non-Goals`) |
| 5 | `NumberSpinner`'s inner field renders | No `textAlign` declaration on its `#id` rule; the `.NumberSpinnerField` shared rule exists and its body is exactly `{ textAlign: "right" }` |
| 6 | `NumberEditor`'s inner field renders | No `textAlign` declaration on its `#id` rule; `.NumberEditorField`'s body is exactly `{ textAlign: "right" }` |
| 7 | `getTextAlign()` on an unrendered `NumberSpinner._input`, `NumberEditor._textField`, and a bare `new TextField()` | `"right"`, `"right"`, `null` — unchanged from before this plan |
| 8 | `new TextField().setTextAlign("center")`, then render | A real `textAlign: center` declaration on that instance's own `#id` rule — a genuine per-instance override still wins |
| 9 | Manual — `#/baseline`, whose demo row holds a `Text`, `Label`, `TextField`, `TextArea`, `DateField`, `TimeField`, and `NumberSpinner` side by side ([`BaselinePanel.ts:63-84`](packages/lib/src/typescript/BaselinePanel.ts#L63)) | Font family, size, and line box read identically to before, and every control's text baseline still lines up with the `Text` and `Label` at the start of the row |
| 10 | Manual — the `TextArea` in that same row | Still shows no drag-resize grip in its bottom-right corner |
| 11 | Manual — `#/misc` → "Show window with table (slow)!", double-click a `col3` (typed `number`) cell to open its editor | The editor's text is still right-aligned |
| 12 | Manual — `#/style-audit`, Refresh, with `#/baseline` already visited | The `TextInput` / `{ font-family … font-size … line-height … }` duplicate-rule row is gone; total per-instance rule count drops |

Row 10 is the one behaviour whose CSS moves to a rule created at module import. The offline harness clears its rule cache between test files while a module body runs once per process, so the `.TextArea { resize: none }` half cannot be asserted offline — only row 2's dedup half can. The browser check is what covers it.

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants, all expecting zero matches:

```
grep -n 'setElementCSSRule'  packages/lib/src/typescript/lib/component/input/TextInput.ts
grep -n 'setElementCSSRules' packages/lib/src/typescript/lib/component/input/TextArea.ts
grep -n '\.setTextAlign('    packages/lib/src/typescript/lib/component/input/NumberSpinner.ts
grep -n '\.setTextAlign('    packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts
grep -rn '_options.textAlign' packages/lib/src/typescript/lib
```

**Manual browser verification (rows 9-12) is required.** The offline harness records writes; it does not run a CSS cascade, and row 10's declaration is unreachable there at all. Start a dev server on a spare port from *this worktree* — confirm with `readlink /proc/<pid>/cwd` that it resolves here, not the main tree or another worktree. Exercise `#/baseline` (rows 9-10), `#/misc`'s slow-table window (row 11), and `#/style-audit` (row 12), and read **computed styles**, not screenshots, for `font-family` / `font-size` / `line-height` on at least a `TextField`, a `TextArea`, and a picker field's inner input.

---

## Documentation Impact

No exported symbol changes: `NumberSpinnerField` and `NumberEditorField` are module-private, and `getTextAlign` / `setTextAlign` / `clearTextAlign` keep their signatures. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under the second `## Changed` → `### Components` list, appended after that list's last bullet (currently the `TableHeader` sort-indicator entry, at the end of the file):

> **`TextField`, `TextArea`, `PasswordField`, `UsernameField`, and the picker fields' inner input no longer repeat their font declarations on every instance's own CSS rule.** `font-family`, `font-size`, and `line-height` now come from one shared `.TextInput` rule. Nothing changes visually. Two consumer-visible consequences for `getTextAlign()` on a text input: it now resolves the class-tier default when its class declares one (no built-in class did before, so every existing class answers as it did), and `clearTextAlign()` on such a class reverts to that default rather than removing alignment entirely — matching `clearCursor` and every other layered `clearX`.

Run `npm run docs:api` — zero warnings.

---

## Potential Challenges

- **The `font` sub-bag is replaced wholesale, not deep-merged.** A subclass that declares `font` without spreading `TextInput.ownClassStyleDefaults.font` silently un-dedupes `fontFamily`/`fontSize`/`lineHeight` for its own instances. Mitigated by giving both subclasses' exact code in `## Internal Structure`; row 5/6 of `## Expected Behaviour` catches a mistake, because the generated rule body would carry four declarations instead of one.
- **No other `TextInput` subclass may declare `font` without the spread.** `TextField`, `PasswordField`, `UsernameField`, `TextArea`, and `PickerInput` all set `ownClassStyleDefaults` to a `Partial<...Options>` bag with no `font` key, so the shallow merge passes `TextInput`'s bag straight through untouched. `grep -rn 'font:' packages/lib/src/typescript/lib/component/input/*.ts` should hit only `Text.ts` (a different chain, whose own `font` bag is unaffected by this plan) plus the new `NumberSpinnerField`.
- **`_options.textAlign` stops being written.** Step 3's grep is the guard; the option itself stays in `TextInputOptions` and still reaches `setTextAlign` through `applyOptions`.
- **`{ ..._defaultTextInputOptions, font: TEXT_INPUT_FONT }` carries `tag`, which is not a `StyleBag` key.** TypeScript accepts it (verified against this project's own `tsc`), and `resolveDeclarations` ignores any key it doesn't recognise — the same tolerance every other `ownClassStyleDefaults` assignment already relies on.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/Text.ts` | The precedent this plan copies: `ownClassStyleDefaults`' `font` bag (126-141), `getClassStyleDefaults()` (1453-1458), and `getTextAlign`/`setTextAlign` (853-868) |
| `packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` | `NumberRendererText` — the live, working "one owner, one module-private subclass carrying a font deviation" class the two new subclasses mirror |
| `plans/implemented/number-renderer-align-stylegroup.md` | Same bug, same family of fix; its Architecture Decisions settle why `styleGroup` cannot carry `textAlign` and why the `font` spread is mandatory |
| `plans/implemented/class-hierarchy-cascade.md` | The mechanism `ownClassStyleDefaults` belongs to, and why the read is own-property-checked |
| `plans/implemented/layered-style-bag.md` | The `writeStyle` / `flushStyleBag` / `styleLayers` layering `setTextAlign` moves onto |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | Read except for one comment: `StyleBag`/`TextStyleBag` (40-93), `resolveDeclarations`' `font` block (241-253), `mergeClassStyleDefaults` (463-465), `resolveClassLevel` (520-570), `ensureStyleGroupRule` (1110-1166) |
| `packages/lib/src/typescript/lib/core/Component.ts` | Read only: `resolveInstanceStyleDeclarations` (308-321, why `styleGroup` excludes `font`), `setElementCSSRule(s)` (1721-1750, the bypass being removed), `styleLayers` (4869-4887), `writeStyle` (4983-5003), `resolveFontValue` (5104-5125), `flushStyleBag` (5263-5365) |
| `packages/lib/src/typescript/lib/core/StyleTarget.ts` | Read only: the `_ruleCache` handshake (185-218) that lets `TextArea`'s module-level rule and its generated class rule share one `CSSStyleRule` |
| `packages/lib/src/typescript/lib/component/input/ComboBox.ts` | Its module-level `scope: "class"` rules (355-375) — the in-family precedent for a class-uniform declaration the `StyleBag` cannot express |
| `ARCHITECTURE.md` | *The class tier is hierarchy-aware* (296) and *Class-level defaults must survive the getter* (205) — the two rules this plan is bound by |
| `packages/lib/tests/core/ClassHierarchyCascade.test.ts` | The `declarationsDuring` / `idSelector` helpers the new test file copies |

---

## Non-Goals

- **`PickerInput`'s `padding: 0px 3px 0px 3px`** ([`AbstractPickerField.ts:106`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L106)), the one real declaration left on that component's own rule. The class tier cannot express it: `resolveDeclarations` never reads `defaults.padding` at all, so a `padding` class default produces no CSS today. Teaching it to would start emitting `padding` for every class that already declares one — `TextField`, `AbstractPickerField`, and others — which is a rendering change, not a dedup. That is its own plan.[^padding-gap]
- **The `min-height` / `max-height` pairs** on `TextField`, `PasswordField`, `UsernameField`, `NumberSpinner`, `DateField`, `ComboBox`, and `Slider`. These come from each class's `updateHeight()` (e.g. [`TextField.ts:77`](packages/lib/src/typescript/lib/component/input/TextField.ts#L77)), which derives the box from `Util.singleLineBoxHeight(insets, padding, borderSize)` and re-fires on every theme change. They are not construction-time constants, they differ per class and per composing parent (22px, 24px, 16px all appear), and they are written through `setMinSize`/`setMaxSize`, which drive layout as well as CSS. Sharing them needs a value-keyed rule at the `Component` sizing level, not a class default.
- **The borderless-inner-field chrome** — `setBorder`/`setBorderRadius`/`setOutline`/`setShadow` on `NumberSpinner`'s, `AutoCompleteField`'s, `NumberEditor`'s, and `StringEditor`'s inner fields. These already flow through `writeStyle` and the layered comparison; they duplicate only because no class tier declares those values. That is a missed-dedup case, not the bypass this plan fixes, and the four owners' bags are not identical.
- **`ComboBoxLabel.setLineHeight`** ([`ComboBox.ts:477`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L477)). Driven from `ComboBox.doLayout` with a measured box height, so its value is per-instance by contract, and `ComboBoxLabel` is a plain `Component`, not part of the `AbstractInput` family.
- **`PickerButton`'s chrome** (`border`/`box-shadow`/`background-image`/`background-color` on every instance). It comes from `Button`'s `chromeless: true` path, which is Button-family meta-class work covered by a separate plan.
- **Widening `styleGroup` to cover `font`.** Settled against in `number-renderer-align-stylegroup.md`; re-deciding it is out of scope here.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^font-not-text-specific]: `resolveDeclarations` handles `font` in a plain, class-agnostic block ([`ClassStyleRules.ts:241-253`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L241)) — twelve `if (font?.X) declarations.X = font.X` lines with no reference to `Text` or to any measurement wiring. `TextStyleBag`'s own comment says only that `Text` is the only class that *currently* sets `font`, and warns that `Glyph`/`TabBar`/`TextInput` each declare flat, differently-typed `fontSize`/`lineHeight`/`textAlign` *options* — which is a reason to keep the bag namespaced under `font`, not a reason a non-`Text` class can't use it. `TextInput`'s only overlapping flat option is `textAlign`, and `StyleBag` has no flat `textAlign` key, so nothing can leak either way. This was checked by applying the change and probing the recorded rule writes: `.TextInput` picks up the three declarations and every subclass's `#id` rule loses them.

[^virtual-dispatch]: Without the override, the CSS rule would be correct but a pre-render `getTextAlign()` would not: `styleLayers()` falls back to `{ authored: this.getClassStyleDefaults(), resolved: {} }` until `applyStyle` seeds the real class layer, and `Component.getClassStyleDefaults()` returns `_defaultOptions`, which has no `font` key. The `(this.constructor as typeof TextInput)` read is deliberate — a plain `TextInput.ownClassStyleDefaults` read would ignore a subclass's own font bag, and `NumberSpinnerField`/`NumberEditorField` depend on being seen. Verified: with the override in place, `getTextAlign()` on an unrendered `NumberSpinner._input` returns `"right"` and on a bare `TextField` returns `null`, both matching pre-change behaviour.

[^one-class-per-owner]: `NumberSpinner` and `NumberEditor` could instead share one exported right-aligned field class. That was rejected: it would add a new public export for two internal call sites, and this codebase's precedent is one module-private class per owner even when the fix shape repeats — `NumberRendererText` for `NumberRenderer`, and `CheckboxCheckGlyph` (12×12) / `RadioButtonDot` (8×8) as a dedicated class each for their own owners. Two rules of one declaration each is the whole cost; the dedup that matters is across instances of one owner, and both get it.

[^stylegroup-settled]: `number-renderer-align-stylegroup.md`'s *`styleGroup` does not cover `textAlign`* decision established this from the shipped code, and `resolveInstanceStyleDeclarations` is unchanged since: it reads `getBackgroundColor`, `getBorder`, `getCursor`, `getForegroundColor`, `getOutline`, `getUserSelect`, `getShadow`, `getMinSizeConstraint`, `getMaxSizeConstraint`, `getOverflow`, and nothing else. Its own doc comment lists `font` among the fields "a `styleGroup` does not cover".

[^suite-green]: The exact code in `## Internal Structure` was applied in this worktree, measured, and reverted before this plan was written. `npx tsc --noEmit -p .` reported no error in any of the four touched files (the only errors present are pre-existing, in unrelated files). `npx vitest run --no-file-parallelism` from `packages/lib` reported 337 files / 5218 tests passing, with no test file edited. A recording-sink probe confirmed every row of `## Expected Behaviour` 1-8, including the two generated rule bodies (`.NumberSpinnerField` and `.NumberEditorField` each exactly `{"textAlign":"right"}`) and `.TextInput`'s full body. The change was reverted afterwards; the worktree carries no source diff.

[^padding-gap]: Confirmed by probe rather than inference. `_defaultTextFieldOptions.padding` is `Insets(3,3,3,3)` and `_defaultPickerFieldOptions.padding` is `Insets(3,3,3,3)`, yet neither a rendered `TextField` nor a rendered `DateField` writes any `padding` declaration anywhere — class defaults are a pure getter fallback (`Component`'s constructor dispatches only caller-supplied options), and `resolveDeclarations` has no `padding` branch. `PickerInput` gets a real declaration only because `AbstractPickerField` calls `setPadding` explicitly, which routes through `writeStyle` into the instance layer. So the property is layout-bearing at the class tier and CSS-bearing only at the instance tier, and closing that gap changes what renders for classes well outside this plan's scope.
