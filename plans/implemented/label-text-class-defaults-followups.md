---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# Label Text Class-Default Follow-ups — Implementation Plan

## Overview

The live Style Audit panel (`#/style-audit`) reports two duplicate-rule groups whose shape matches the fix already shipped in [`checkboxbox-borderradius-hoist.md`](plans/implemented/checkboxbox-borderradius-hoist.md) and [`glyph-preferredsize-reconciled-write-path.md`](plans/implemented/glyph-preferredsize-reconciled-write-path.md): a plain, reusable component (there, `Glyph`/`CheckboxBox`; here, `Text`) styled with imperative setter calls from a composing parent's constructor, for values that never vary across any instance of the owning class.

1. **`Button`'s internal title label.** `Button`'s constructor ([`Button.ts:717-733`](packages/lib/src/typescript/lib/component/button/Button.ts#L717-L733)) constructs `this._text = new Text()` and then calls `this._text.setTextAlign("center")`, `this._text.setFontWeight("bold")`, and `this._text.setFontSize("--ts-ui-button-font-size")`. Every plain `Button` writes the identical `{ text-align: center; font-weight: bold; font-size: var(--ts-ui-button-font-size, 14px); }` body to its own `#id` rule.
2. **`HeaderCell`'s internal title label.** `HeaderCell`'s constructor ([`Header.ts:166-171`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L166-L171), table cell) calls `renderer.getText().setFontSize("--ts-ui-table-header-font-size")`, `.setFontWeight("bold")`, and `.setUserSelect("none")` on the renderer's inner `Text`. Every `HeaderCell` writes the identical `{ font-size: var(--ts-ui-table-header-font-size, 14px); font-weight: bold; user-select: none; }` body to that `Text`'s own `#id` rule. This is a *different* element from `HeaderCellRenderer`'s own `cursor`/`userSelect` (already deduped by `_defaultHeaderCellRendererOptions`, confirmed unaffected by this plan) — the duplicate here is entirely on the renderer's child label.

Both are fixed the same way the sibling plans fixed `CheckboxBox`/`CheckboxCheckGlyph`: a dedicated `Text` subclass (`ButtonLabelText` in `Button.ts`, `HeaderCellText` in `Header.ts`) carrying the fixed styling as its own class-tier default, so every instance shares one `.ButtonLabelText` / `.HeaderCellText` CSS rule instead of repeating it. Investigation (below) found this needs one additional piece neither sibling plan needed: `Text`'s `fontSize` setter queues a real, un-reconciled declaration at construction time that a plain class-default registration does not clean up, so each new class also needs a small `applySubclassStyles` override. `HeaderCellText` additionally needs a new `protected createText()` factory hook on `StringRenderer` (`component/table/cell/renderer/String.ts`) so `HeaderCellRenderer` can substitute it for the inherited `SelectableText`.

All three source edits, and the full mechanism, were verified directly against this branch: applied to a scratch copy of the three files, `npm run typecheck` and the full `vitest` suite (5125 tests) both passed with zero regressions, and a live dev server showed the `#/style-audit` panel losing both rows entirely, with `.ButtonLabelText { font-size: var(--ts-ui-button-font-size, 14px); font-weight: bold; text-align: center; }` and `.HeaderCellText { user-select: none; font-size: var(--ts-ui-table-header-font-size, 14px); font-weight: bold; }` the only place either declaration set now lives.[^live-verify]

---

## Architecture Decisions

### Both cases use a dedicated `Text` subclass with `ownClassStyleDefaults`, not a `styleGroup` token

`shared-instance-style-groups.md`'s `styleGroup` option is for a *caller* opting several separately-configured instances of one component into sharing a rule — the caller states the intent by passing a token. Neither case here has a caller in that sense: `Button`'s title styling and `HeaderCell`'s title styling are intrinsic to being a `Button` or a `HeaderCell` — no consumer ever chooses them, and they can never vary by instance. That is exactly the shape `CheckboxCheckGlyph`/`RadioButtonDot`/`Link`/`SelectableText` already solve with a dedicated subclass declaring its own `ownClassStyleDefaults`, so this plan follows that precedent rather than introducing a `styleGroup` token a caller would have no reason to type.[^styleGroup-considered]

### `textAlign` is not a strict constant on `Button`; `fontWeight`/`fontSize` are

`Button.setTextAlign(align)` ([`Button.ts:1157-1178`](packages/lib/src/typescript/lib/component/button/Button.ts#L1157-L1178)) is a public method that forwards to `this._text.setTextAlign(align)` — a consumer can change a button's title alignment at runtime. `Button` exposes no equivalent for `fontWeight` or `fontSize` — nothing outside `Button`'s own constructor ever touches those two. This does not change the fix: `Text.setTextAlign` is a plain, unreconciled setter (`this.setElementCSSRule("textAlign", align)`), so a real runtime call from `Button.setTextAlign` reaches `#id` exactly as it does today, deviation or not, regardless of what `ButtonLabelText`'s class default says — the class default only changes what an *untouched* instance's `applyStyle` pass resolves to. "Center" is `ButtonLabelText`'s own class default because it is what every `Button` starts with today; a caller that later calls `setTextAlign` still gets a real, correct `#id` override.

### The construction-time `setFontSize` call needs an `applySubclassStyles` override to actually dedupe

`Text.applyOptions`/its constructor defer a var-bound `fontSize`'s dispatch to the constructor *body*, gated on the caller having passed `options.fontSize` explicitly ([`Text.ts:172-194`](packages/lib/src/typescript/lib/component/input/Text.ts#L172-L194), comment: "Fields written during the `super()` cascade must use `declare`" in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)) — a `_defaultTextOptions`-style class default for `fontSize` is never dispatched through `setFontSize` on its own, unlike `textAlign`/`fontWeight` (which resolve purely through the folding getter, per `Text.getTextAlign()`/`getFontWeight()`). So `ButtonLabelText`/`HeaderCellText` must still call `this.setFontSize(...)` imperatively in their own constructor, exactly as `Button`/`HeaderCell` did before. That call runs before `applyStyle` has ever resolved a class-tier comparison bag for the new class (`_inheritedStyleBag` is `null` pre-render — the same `null`-bag gap `glyph-preferredsize-reconciled-write-path.md`'s `[^matches-class-style-null]` documents for `Glyph`), so it queues a real `fontSize` declaration into the `#id` rule's dirty bag via the setter's own `setElementCSSRule` call.

At render, `Text.applySubclassStyles()` ([`Text.ts:1523-1572`](packages/lib/src/typescript/lib/component/input/Text.ts#L1523-L1572)) re-derives `fontSize` too, but through `writeFontDeclaration` → `writeRuleDeclaration`, which on a match *skips* the write entirely rather than queuing a removal (unlike `lineHeight`/`textOverflow` in the same method, which use `reconcileRuleDeclaration` and so always queue, converting a match to an explicit `null`). A skip leaves whatever was queued earlier untouched — so the stale, real, construction-time `fontSize` value the setter call queued survives to `#id` even once a matching class default exists. This was confirmed empirically: a scratch `Text` subclass with only the class-default registration (no override) still wrote a real `fontSize` to its own `#id` rule after render, byte-identical to the value the shared class rule also carried — the rule was correct but redundant, not eliminated.

The fix is local to the two new classes, not a `Text.ts` change: each overrides `applySubclassStyles()` to call `super.applySubclassStyles()` and then `this.reconcileRuleDeclaration("fontSize", <the same literal the class default declares>)` — this second call always queues, and on a match (confirmed by the scratch test) overwrites the stale real value with a removal, exactly like `Text`'s own `lineHeight`/`textOverflow` fields already do for the identical reason. Verified: with this override, the scratch subclass's `#id` rule carried nothing at all.[^no-textts-change]

### `HeaderCellText` extends `SelectableText`, not `Text`, to preserve today's cursor

`StringRenderer`'s inner label is a `SelectableText` (`cursor: "text"`, `userSelect: "text"` — [`SelectableText.ts:19-22`](packages/lib/src/typescript/lib/component/input/SelectableText.ts#L19-L22)), and `HeaderCell`'s constructor has never overridden its cursor — only `userSelect`. `HeaderCellText extends SelectableText`, deviating only on `userSelect` (`"none"`, since a column title is chrome, not selectable data) and the font group, so `cursor` passes through unchanged at `"text"` — matching today's behaviour exactly rather than silently changing it. `ButtonLabelText`, by contrast, extends `Text` directly: `Button`'s label was never a `SelectableText` and never touched `cursor`/`userSelect` at all, and `Text`'s own class doc already names "a button label" as the canonical unselectable-chrome-text case.

### `HeaderCellRenderer` needs a `createText()` factory hook on `StringRenderer`

`StringRenderer._text` (the field `HeaderCellRenderer` inherits) is `private`, initialised inline to `new SelectableText()` ([`String.ts:22`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L22)) — a subclass cannot reassign a private field, and `setValue`/`getDisplayText` read `this._text` directly rather than through `getText()`, so `HeaderCellRenderer` cannot swap in a different label component after the fact either. `StringRenderer` gains a `protected createText(): Text { return new SelectableText(); }` method, and the field initialiser becomes `= this.createText()`; `HeaderCellRenderer` overrides it to `return new HeaderCellText();`. This mirrors this codebase's existing `protected createX(): Y` factory-hook shape (`Tree.createPoolRow`, `Body.createRow`, `DateField.createDropdown`) — the closest existing precedent for "let a subclass swap the concrete type of a child the base class constructs." No other class extends `StringRenderer` today (confirmed by `grep -rln "extends StringRenderer" packages/lib/src`), so the change is additive with zero blast radius on a plain `StringRenderer`.[^field-init-dispatch]

---

## Internal Structure

### `component/button/Button.ts` — new `ButtonLabelText`, placed immediately before the `Button` class

```typescript
const BUTTON_LABEL_FONT_SIZE_VAR = "--ts-ui-button-font-size";

// The CSS-ready form of BUTTON_LABEL_FONT_SIZE_VAR — its "14px" fallback is
// Text's own base font-size default (unmodified here), matching exactly
// what Text.setFontSize resolves the constructor's call below to.
const BUTTON_LABEL_FONT_SIZE_RULE = `var(${BUTTON_LABEL_FONT_SIZE_VAR}, 14px)`;

const _defaultButtonLabelTextOptions: Partial<TextOptions> = {
    textAlign:  "center",
    fontWeight: "bold",
};

/**
 * `Button`'s own title label. `textAlign`/`fontWeight` are class defaults,
 * resolved via the folding getter with no imperative dispatch needed.
 * `fontSize` still needs the explicit `setFontSize` call below — see
 * `## Architecture Decisions`. `Button.setTextAlign` can still change
 * `textAlign` at runtime (a genuine per-instance deviation, unaffected by
 * this class default); `fontWeight`/`fontSize` have no such runtime path
 * and stay fixed for the lifetime of the instance.
 */
class ButtonLabelText extends Text {
    protected static readonly ownClassStyleDefaults: ClassStyleDefaults = {
        font: {
            ...Text.ownClassStyleDefaults.font,
            textAlign:  "center",
            fontWeight: "bold",
            fontSize:   BUTTON_LABEL_FONT_SIZE_RULE,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultButtonLabelTextOptions);
        this.setFontSize(BUTTON_LABEL_FONT_SIZE_VAR);
    }

    /**
     * `setFontSize` above queues a real, un-reconciled `fontSize` declaration
     * before `.ButtonLabelText`'s class rule exists to compare it against
     * (see `## Architecture Decisions`). Re-queues it through the reconciled
     * path once the class rule is available, so the stale real value doesn't
     * survive to `#id` on a default-styled instance.
     */
    protected override applySubclassStyles(): void {
        super.applySubclassStyles();
        this.reconcileRuleDeclaration("fontSize", BUTTON_LABEL_FONT_SIZE_RULE);
    }
}
```

Import line 9 widens to `import { Text, TextOptions } from "~/component/input/Text.js";` (matching `Link.ts`'s identical mixed value+type import of the same module). `ClassStyleDefaults` is already imported ([`Button.ts:14`](packages/lib/src/typescript/lib/component/button/Button.ts#L14)).

Constructor — only the marked lines change ([`Button.ts:717`](packages/lib/src/typescript/lib/component/button/Button.ts#L717) and [`Button.ts:730-733`](packages/lib/src/typescript/lib/component/button/Button.ts#L730-L733)):

```typescript
        this._text        = new ButtonLabelText();   // ← was: new Text()
        this._titleColumn = new Component();
        ...
        this._text.setPointerEvents("none");
        // ← delete: this._text.setTextAlign("center");
        // ← delete: this._text.setFontWeight("bold");
        // ← delete: this._text.setFontSize("--ts-ui-button-font-size");
```

`private _text!: Text;` ([`Button.ts:271`](packages/lib/src/typescript/lib/component/button/Button.ts#L271)) stays typed `Text` — every existing use of `_text` (`setText`, `getText`, `setWritingMode`, `getLineHeight`, `getBaseline`, …) only needs `Text`'s surface, and `ButtonLabelText` is one.

### `component/table/cell/renderer/String.ts` — `createText()` factory hook

```typescript
class StringRenderer extends CellRenderer<String | null> {

    private _text:    Text          = this.createText();   // ← was: new SelectableText()
    private _value:   String | null = null;
    private _display: string        = "";

    constructor(subclassDefaults?: Partial<ComponentOptions>) {
        super({ ..._defaultStringRendererOptions, ...(subclassDefaults ?? {}) });

        this._text.setText("");
        this._text.setPointerEvents("none");
        this._text.setAutoMeasure(false);
        this.addComponent(this._text);

        // (comment unchanged)
    }

    /**
     * Constructs this renderer's text child. A subclass overrides this to
     * swap in a differently-styled `Text` subclass — e.g. `HeaderCellRenderer`
     * (component/table/cell/Header.ts), which needs header-specific
     * font-weight/font-size/user-select defaults — without duplicating the
     * rest of this constructor's setup.
     */
    protected createText(): Text {
        return new SelectableText();
    }

    getText(): Text {
        return this._text;
    }
    // ... rest of the class unchanged
}
```

No new imports — `Text`/`SelectableText` are already imported into this file.

### `component/table/cell/Header.ts` — new `HeaderCellText`, placed immediately before `HeaderCellRenderer`

```typescript
const HEADER_CELL_TEXT_FONT_SIZE_VAR = "--ts-ui-table-header-font-size";

// The CSS-ready form of HEADER_CELL_TEXT_FONT_SIZE_VAR — same reasoning as
// BUTTON_LABEL_FONT_SIZE_RULE above.
const HEADER_CELL_TEXT_FONT_SIZE_RULE = `var(${HEADER_CELL_TEXT_FONT_SIZE_VAR}, 14px)`;

const _defaultHeaderCellTextOptions: Partial<SelectableTextOptions> = {
    userSelect: "none",
    fontWeight: "bold",
};

/**
 * {@link HeaderCell}'s own title label. Extends `SelectableText` (not the
 * base `Text`) so it keeps the same `cursor: "text"` every table cell's
 * label already gets — `HeaderCell` has never overridden cursor for its
 * title, only `userSelect` — and deviates only on `userSelect` and the
 * bold/`--ts-ui-table-header-font-size` font. See
 * `## Architecture Decisions`.
 */
class HeaderCellText extends SelectableText {
    protected static readonly ownClassStyleDefaults: ClassStyleDefaults = {
        userSelect: "none",
        font: {
            ...Text.ownClassStyleDefaults.font,
            fontWeight: "bold",
            fontSize:   HEADER_CELL_TEXT_FONT_SIZE_RULE,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultHeaderCellTextOptions);
        this.setFontSize(HEADER_CELL_TEXT_FONT_SIZE_VAR);
    }

    /**
     * `setFontSize` above queues a real, un-reconciled `fontSize` declaration
     * before `.HeaderCellText`'s class rule exists to compare it against
     * (see `## Architecture Decisions`). Re-queues it through the reconciled
     * path once the class rule is available, so the stale real value doesn't
     * survive to `#id` on a default-styled instance.
     */
    protected override applySubclassStyles(): void {
        super.applySubclassStyles();
        this.reconcileRuleDeclaration("fontSize", HEADER_CELL_TEXT_FONT_SIZE_RULE);
    }
}
```

`HeaderCellRenderer` gains the override:

```typescript
class HeaderCellRenderer extends StringRenderer {
    constructor() {
        super(_defaultHeaderCellRendererOptions);
    }

    protected override createText(): Text {
        return new HeaderCellText();
    }
}
```

Imports widen: `import type { ClassStyleDefaults, StateStyleRule } from "~/core/ClassStyleRules.js";` (add `ClassStyleDefaults` alongside the already-imported `StateStyleRule`), plus two new lines — `import { Text } from "~/component/input/Text.js";` and `import { SelectableText, SelectableTextOptions } from "~/component/input/SelectableText.js";`.

`HeaderCell`'s constructor — only the marked lines change ([`Header.ts:166-171`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L166-L171)):

```typescript
        let renderer = this.getRenderer();
        renderer.getText().setText(text);
        // ← delete: renderer.getText().setFontSize("--ts-ui-table-header-font-size");
        // ← delete: renderer.getText().setFontWeight("bold");
        // ← delete: renderer.getText().setUserSelect("none");
```

---

## Ordered Implementation Steps

1. **`packages/lib/tests/component/button/Button.test.ts` — add a new `describe('ButtonLabelText style hoisting', ...)` block**, copying the local `idSelector`/`declarationsDuring` helpers from `packages/lib/tests/component/table/cell/Header.test.ts`'s existing `'HeaderCellRenderer static style hoisting'` block (lines 86-116) — this file duplicates the pair locally rather than sharing them, matching every other test file that uses this pattern (see `tests/component/input/TextClassStyleHoisting.test.ts`'s file-header comment for why). Add:
   ```typescript
   it("a rendered Button's _text carries no textAlign/fontWeight/fontSize declaration on its own #id rule", () => {
       const btn  = new Button('Save');
       const text = (btn as any)._text;

       const declarations = declarationsDuring(sink, idSelector(text), () => btn.getElement(true));

       expect(declarations.textAlign).toBeUndefined();
       expect(declarations.fontWeight).toBeUndefined();
       expect(declarations.fontSize).toBeUndefined();
   });

   it('the shared .ButtonLabelText class rule exists once a Button has rendered', () => {
       const btn = new Button('Save');
       btn.getElement(true);

       expect(_ruleCacheHas('.ButtonLabelText')).toBe(true);
   });
   ```
   Add `import { _ruleCacheHas } from '~/core/StyleTarget';` if not already present in this file (it currently is not).
   *Check:* `npx vitest run tests/component/button/Button.test.ts` from `packages/lib` — both new cases fail against the current, unfixed source (the first because `declarations.textAlign`/`fontWeight`/`fontSize` are real strings, not `undefined`; the second because `.ButtonLabelText` does not exist).

2. **`packages/lib/tests/component/table/cell/Header.test.ts` — add a new `describe('HeaderCellText style hoisting', ...)` block**, reusing this file's own existing local `idSelector`/`declarationsDuring` helpers (already present at lines 86-116, inside the `'HeaderCellRenderer static style hoisting'` block — copy them into the new block, since they are declared as block-local functions). This file has no module-level `sink` variable (unlike `Button.test.ts`) — every existing test that needs one reaches it via `const sink = DOM.sink as RecordingDOMSink;` locally, matching the pre-existing `'row 6'` test at line 119; the new test below does the same. Add:
   ```typescript
   it("a rendered HeaderCell's renderer text carries no fontWeight/fontSize/userSelect declaration on its own #id rule", () => {
       const sink = DOM.sink as RecordingDOMSink;
       const cell = new HeaderCell('Name', 'name');
       const text = cell.getRenderer().getText();

       const declarations = declarationsDuring(sink, idSelector(text), () => cell.getElement(true));

       expect(declarations.fontWeight).toBeUndefined();
       expect(declarations.fontSize).toBeUndefined();
       expect(declarations.userSelect).toBeUndefined();
   });

   it("the renderer text's cursor is unchanged (still 'text', inherited from SelectableText)", () => {
       const cell = new HeaderCell('Name', 'name');

       expect(cell.getRenderer().getText().getCursor()).toBe('text');
   });

   it('the shared .HeaderCellText class rule exists once a HeaderCell has rendered', () => {
       const cell = new HeaderCell('Name', 'name');
       cell.getElement(true);

       expect(_ruleCacheHas('.HeaderCellText')).toBe(true);
   });
   ```
   *Check:* `npx vitest run tests/component/table/cell/Header.test.ts` from `packages/lib` — the first and third cases fail against the current, unfixed source; the second passes both before and after (it pins existing, unaffected behaviour — see `## Architecture Decisions`).

3. **`packages/lib/tests/component/default-options-fallback.test.ts` — add four registry rows**, grouped with this file's existing per-component rows. Immediately after `'Button backgroundColor'` ([default-options-fallback.test.ts:281](packages/lib/tests/component/default-options-fallback.test.ts#L281)):
   ```typescript
   { label: 'Button _text textAlign',       resolve: () => (new Button() as any)._text.getTextAlign(),                  expected: 'center' },
   { label: 'Button _text fontWeight',      resolve: () => (new Button() as any)._text.getFontWeight(),                 expected: 'bold' },
   ```
   Immediately after the existing `'HeaderCellRenderer userSelect'` row ([default-options-fallback.test.ts:315](packages/lib/tests/component/default-options-fallback.test.ts#L315)):
   ```typescript
   { label: 'HeaderCell renderer text fontWeight', resolve: () => new HeaderCell('Name', 'name').getRenderer().getText().getFontWeight(), expected: 'bold' },
   { label: 'HeaderCell renderer text userSelect', resolve: () => new HeaderCell('Name', 'name').getRenderer().getText().getUserSelect(), expected: 'none' },
   ```
   `Button` and `HeaderCell` are already imported in this file. Per [ARCHITECTURE.md](ARCHITECTURE.md)'s "Class-level defaults must survive the getter" registry mandate, all four rows are expected to **pass immediately**, both before and after the source change — `getTextAlign()`/`getFontWeight()`/`getUserSelect()` already fold correctly today (the imperative setter calls already produce these values); the rows exist to guard the getters, not to prove the dedup.
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` from `packages/lib` — passes immediately (before the source change too).

4. **Apply the `StringRenderer.ts` factory-hook change.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

5. **Apply the `Header.ts` change: new `HeaderCellText`, `HeaderCellRenderer.createText()` override, delete the three imperative calls in `HeaderCell`'s constructor.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'renderer.getText().setFontSize\|renderer.getText().setFontWeight\|renderer.getText().setUserSelect' packages/lib/src/typescript/lib/component/table/cell/Header.ts` — zero matches.

6. **Apply the `Button.ts` change: new `ButtonLabelText`, swap the constructor's `new Text()` for `new ButtonLabelText()`, delete the three imperative calls.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'this._text.setTextAlign\|this._text.setFontWeight\|this._text.setFontSize' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches.

7. **Re-run the three test files touched in steps 1-3.** `npx vitest run tests/component/button/Button.test.ts tests/component/table/cell/Header.test.ts tests/component/default-options-fallback.test.ts` from `packages/lib` — all green now.

8. **Run the full suite for regressions elsewhere.** `npx vitest run --no-file-parallelism` from `packages/lib`. No other file references `ButtonLabelText`, `HeaderCellText`, or calls `createText()` on a `StringRenderer` (confirmed via `grep -rln "ButtonLabelText\|HeaderCellText\|\.createText(" packages/lib/tests`), so no further test files are expected to need changes — treat any other new failure as a genuine regression to investigate, not something to paper over.

9. **Add the changelog entry.** See `## Documentation Impact`.

10. **Full verification.** See `## Verification`.

11. **Verify live in a browser.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` |
| Modify | `packages/lib/tests/component/button/Button.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/Header.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

| # | Case | Expected | Testable |
|---|---|---|---|
| 1 | A default-styled `Button`'s `_text` renders for the first time | No `setRuleStyles` write reaches `_text`'s own `#id` rule for `textAlign`/`fontWeight`/`fontSize` — all three are absent keys, not explicit `null` removals | Unit (`Button.test.ts`) |
| 2 | Same, `HeaderCell`'s renderer text | No write for `fontWeight`/`fontSize`/`userSelect` on `#id`; `cursor` still resolves to `'text'`, unchanged from today | Unit (`Header.test.ts`) |
| 3 | `(new Button() as any)._text.getTextAlign()` / `.getFontWeight()` on a bare, unrendered instance | `'center'` / `'bold'` — unchanged before and after this plan | Unit (registry rows) |
| 4 | `new HeaderCell('Name','name').getRenderer().getText().getFontWeight()` / `.getUserSelect()` | `'bold'` / `'none'` — unchanged before and after this plan | Unit (registry rows) |
| 5 | `Button.setTextAlign('left')` called at runtime, after render | Writes `left` for real to that instance's own `#id` rule — a genuine per-instance deviation, unaffected by `ButtonLabelText`'s class default (see `## Architecture Decisions`) | Manual (or a future unit test — not required by this plan) |
| 6 | `.ButtonLabelText` shared class rule, after any `Button` has rendered | Body is exactly `{ text-align: center; font-weight: bold; font-size: var(--ts-ui-button-font-size, 14px); }` | Manual (Style Audit panel, or direct stylesheet inspection — class-rule content checks are order-sensitive across a test file's module-level cache, so this plan does not assert exact content in a unit test; existence alone is, via `_ruleCacheHas`) |
| 7 | `.HeaderCellText` shared class rule, after any `HeaderCell` has rendered | Body is exactly `{ user-select: none; font-size: var(--ts-ui-table-header-font-size, 14px); font-weight: bold; }` | Manual, same reasoning as row 6 |
| 8 | Style Audit panel (`#/style-audit`), after opening a table window with several header columns and several buttons | Neither the `Button` row (body `{ text-align: center; font-weight: bold; font-size: var(--ts-ui-button-font-size, 14px); }`) nor the `HeaderCell`/`Text` row (body `{ font-size: var(--ts-ui-table-header-font-size, 14px); font-weight: bold; user-select: none; }`) appears anywhere in the table | Manual |
| 9 | `HeaderCellRenderer`'s own `cursor: 'default'` / `userSelect: 'none'` (a *different*, already-deduped element — see `Header.test.ts`'s pre-existing `'row 6'`) | Unaffected — untouched by this plan | Unit (pre-existing, unmodified test) |
| 10 | Any rendered `Button` or `HeaderCell`, any theme | Title text visually identical (bold, centred/left-flush as before, sized per the same token) before and after — only which rule carries the declaration changes | Manual |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants:

```
grep -n 'this._text.setTextAlign\|this._text.setFontWeight\|this._text.setFontSize' packages/lib/src/typescript/lib/component/button/Button.ts   # zero matches
grep -n 'renderer.getText().setFontSize\|renderer.getText().setFontWeight\|renderer.getText().setUserSelect' packages/lib/src/typescript/lib/component/table/cell/Header.ts   # zero matches
```

**Manual browser verification (rows 5-10 of `## Expected Behaviour`) is required.** The offline harness records writes; it does not run a CSS cascade or reproduce the Style Audit panel's stylesheet scan. Start a dev server on a spare port from *this worktree*, not the user's existing one (`npx vite --port <spare> --strictPort` from `packages/lib`; confirm with `readlink /proc/<pid>/cwd` that it resolves to this worktree, and check `pgrep -af "vite --port <spare>"` first in case the port is already in use by an unrelated session). Navigate to a screen with several buttons and a table with header columns (`#/misc`'s "Show window with table (slow)!" reproduces both), then `#/style-audit`, and click "Refresh". Confirm neither duplicate-rule row (row 8's two bodies) appears, and that both title labels still render bold, correctly aligned/sized, with the header title still unselectable.

---

## Documentation Impact

No exported symbol changes — `ButtonLabelText` and `HeaderCellText` are module-private, `StringRenderer.createText()` is `protected` (excluded from public API docs per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s TypeDoc exclusion note), and `Button`'s/`HeaderCell`'s own public surfaces are untouched. One small, self-contained changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, added as a new bullet at the end of that list (after the existing `Text`/`setLineHeight` bullet, around [next.md:194-201](packages/lib/docs/reference/changelog/next.md#L194-L201)) — kept to one bullet and placed at the end specifically so this edit does not collide with the two sibling plans (`number-renderer-align-stylegroup`, `glyph-size-registration-gap-followups`) also editing this file in parallel:

> **`Button`'s and `HeaderCell`'s internal title labels no longer duplicate their fixed font styling on every instance's own CSS rule.** Each now shares one CSS rule (`.ButtonLabelText`, `.HeaderCellText`) across every `Button`/`HeaderCell` in the app for `text-align`/`font-weight`/`font-size` (`HeaderCell`'s label also for `user-select`). This is separate from `HeaderCellRenderer`'s own cursor/user-select, already deduped. Nothing changes visually; no consumer action needed.

---

## Potential Challenges

- **A construction-time `setFontSize` call queues a real value nothing else cleans up.** Mitigated by the `applySubclassStyles` override on both new classes (see `## Architecture Decisions`), verified empirically to produce a fully empty `#id` rule.
- **Reusing `_ruleCacheHas` across a test file whose earlier tests already constructed the same class.** `_ruleCacheHas('.ButtonLabelText')`/`.HeaderCellText'` only asserts existence, which is true regardless of which test first created it — this plan deliberately does not assert the class rule's exact declaration content in a unit test (see `## Expected Behaviour` rows 6-7), matching how the sibling plans defer that check to manual/live verification for the same module-state-ordering reason.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/button/Button.ts` | The file being changed: imports (3-19), `_defaultButtonOptions` (223-242), constructor `_text` construction and imperative calls (717-733) |
| `packages/lib/src/typescript/lib/component/table/cell/Header.ts` | The file being changed: imports (1-19), `_defaultHeaderCellRendererOptions`/`HeaderCellRenderer` (73-93), `HeaderCell`'s constructor (156-171) |
| `packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` | The file being changed: `_text` field and constructor (20-50) |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | Read, not modified — `_defaultTextOptions`/`ownClassStyleDefaults` (62-141), the constructor's `fontSize`/`lineHeight` deferred-dispatch comment (172-209), `getTextAlign`/`getFontWeight` folding getters (842-844, 1110-1112), `setFontSize` (982-1007), `applySubclassStyles` (1523-1572) — confirms exactly which fields need only a class default and which additionally need the `applySubclassStyles` override |
| `packages/lib/src/typescript/lib/component/input/SelectableText.ts` | The precedent `HeaderCellText` extends and mirrors — a `Text` subclass declaring a flat (non-font) `ownClassStyleDefaults` deviation |
| `packages/lib/src/typescript/lib/component/input/Link.ts` | Read, not modified — confirms the mixed `import { Text, TextOptions } from ...` shape and the `ownClassStyleDefaults` subclass-registration pattern for a class that deviates from `Text` |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | Read, not modified — `resolveDeclarations`'s `font` sub-bag handling (217-232), `mergeClassStyleDefaults`'s shallow-merge-per-field warning (321-326, meaning a subclass's `font` override must spread the parent's full font bag, not just its own deviating fields), `chainParticipates`/`resolveClassLevel` (342-431) |
| `packages/lib/src/typescript/lib/core/Component.ts` | Read, not modified — `writeRuleDeclaration` (skip-on-match, 4931-4937) vs `reconcileRuleDeclaration` (always-queue, 4945-4953) — the distinction the `applySubclassStyles` override exploits |
| `plans/implemented/checkboxbox-borderradius-hoist.md` | Direct precedent: move an imperative literal into a class-tier default, delete the call, for a value that turns out to stop the whole `#id` rule from materialising |
| `plans/implemented/glyph-preferredsize-reconciled-write-path.md` | Direct precedent: a delegate class registering `ownClassStyleDefaults` for a value whose write path needed independent verification (there: already reconciled; here: needed the extra override) — same investigation discipline, different outcome |
| `plans/implemented/shared-instance-style-groups.md` | Read to confirm `styleGroup`'s scope (caller-opted-in sharing) does not fit either case here — see `## Architecture Decisions` |
| `packages/lib/tests/component/table/cell/Header.test.ts` | `'HeaderCellRenderer static style hoisting'` describe block (85-147) — the `idSelector`/`declarationsDuring` helper shape this plan's new tests copy, and the pre-existing `'row 6'` test confirming the renderer's own cursor/userSelect (a different element) is unaffected |
| `packages/lib/tests/component/table/cell/renderer.test.ts` | Read, not modified — confirms no existing test constructs `StringRenderer` in a way the `createText()` factory-hook change would break |
| `packages/lib/tests/component/default-options-fallback.test.ts` | Registry to extend — `'HeaderCellRenderer cursor'`/`'HeaderCellRenderer userSelect'` rows (314-315) show the exact adjacent row shape |

---

## Non-Goals

- **`ParentHeaderCell`'s title label** (`packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts:55-61`). Found during investigation: an almost-identical shape (`renderer.getText().setFontSize("--ts-ui-table-header-font-size")`, `.setFontWeight("bold")`, `.setTextAlign("center")`, plus `renderer.getText().setUserSelect("none")`) — but `ParentHeaderCell extends DefaultCell` directly, using `DefaultCell`'s own default `StringRenderer` (not `HeaderCellRenderer`), and its resolved body additionally carries `text-align: center` (which `HeaderCell`'s own label never sets), so it is a *different* duplicate-rule group in the Style Audit panel, not covered by `HeaderCellText`. Not investigated further or touched here — the user's own report named only `HeaderCell`'s row.
- **`Button`'s `_description` subtitle label** (`Button.ts`'s `setDescription`, a separate lazily-created `Text`). Uses different CSS var names (`--ts-ui-button-description-font-size`, `--ts-ui-button-description-weight`) and also sets `foregroundColor` from `this._options.descriptionColor ?? "var(--ts-ui-button-description-fg, ...)"` — a value that *can* vary per instance via the `descriptionColor` option, so it is not a pure constant the way `_text`'s styling is. Not reported by the audit investigation this plan is based on; out of scope.
- **`component/display/Header.ts`'s own `this._text.setFontSize("--ts-ui-header-font-size")`** (a different, unrelated "Header" section-heading widget, not the table's `HeaderCell`). Confirmed live via this plan's own browser verification to still write real per-instance `#id` declarations for a *different* CSS var (`--ts-ui-header-font-size`) — same shape, but that widget's `fontSize` is also driven by a `this._options.fontSize` per-instance override path ([`display/Header.ts:113`](packages/lib/src/typescript/lib/component/display/Header.ts#L113)), meaning it is not a pure constant without further investigation. Out of scope.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^live-verify]: Verified via `chrome-devtools` MCP tools against `npx vite --port 8043 --strictPort` started from this worktree's `packages/lib` (confirmed via `readlink /proc/<pid>/cwd`). All three source edits (`Button.ts`, `Header.ts`, `String.ts`) were applied directly, `npm run typecheck` (exit 0, zero diagnostics) and `npx vitest run --no-file-parallelism` (5125/5125 passing, zero failures) were run via a sub-agent, then the app was driven live: `#/misc` → "Show window with table (slow)!" → "Style Audit" → "Refresh". A scan of every stylesheet rule on the page found zero `#id` rules containing `table-header-font-size` or `button-font-size` anywhere, and exactly the two expected class rules — `.ButtonLabelText { font-size: var(--ts-ui-button-font-size, 14px); font-weight: bold; text-align: center; }` and `.HeaderCellText { user-select: none; font-size: var(--ts-ui-table-header-font-size, 14px); font-weight: bold; }` (plus a `.HeaderCellText.lh20px` line-height value-class rule, an unrelated pre-existing mechanism picking up the new class name correctly). The five "Grouped"/"Ungrouped" demo buttons and the opened table's header row rendered visually unchanged. All three source edits were reverted after verification (this plan modifies no source, per the plan skill's own rule) — `git status` in the worktree is clean.

[^styleGroup-considered]: `styleGroup`'s own plan documents its scope explicitly: "many instances of the *same* class, all constructed with the *same explicit, non-default* style" sharing a rule the *caller* opts into via a token. Both cases in this plan are the opposite — the styling is the class's own permanent identity, never explicit per call site, which is precisely the case `shared-instance-style-groups.md`'s own `## Critical Files` table points at `checkbox-radio-delegate-static-style-defaults.md` "to understand why this plan's token mechanism is for the *non-subclass* case specifically, not a replacement for that pattern."

[^no-textts-change]: Confirmed directly: a scratch `Text` subclass in a throwaway test file, registering only `ownClassStyleDefaults.font.fontSize` (no override) and calling `setFontSize` in its constructor, still wrote a real `fontSize: "var(...)"` to its own `#id` rule after `getElement(true)` — matching the shared class rule's value byte-for-byte, but not eliminated. Adding the `applySubclassStyles` override (calling `this.reconcileRuleDeclaration("fontSize", ...)` after `super.applySubclassStyles()`) changed the recorded `#id` writes to a fully empty object — no `setRuleStyles` call for that selector at all. This confirms the fix is correctly scoped to the two new classes and needs no change to `Text.ts` itself; `Text.applySubclassStyles`'s existing `writeRuleDeclaration`-based handling of `fontSize` is unaffected and continues to behave exactly as it does today for every other `Text`/`Text`-family instance in the app (which never combine a matching class default with an explicit constructor-time `setFontSize` call, so the gap this plan works around has never been exercised before).

[^field-init-dispatch]: `StringRenderer`'s own field initializer (`private _text: Text = this.createText();`) runs, for `HeaderCellRenderer`, during `HeaderCellRenderer`'s `super()` call — before `HeaderCellRenderer`'s own constructor body executes, but *after* `this`'s prototype is already `HeaderCellRenderer.prototype` (a JS class instance's prototype is fixed before any `super()` call in the chain runs). Method dispatch (`this.createText()`) is always dynamic in JS, so `HeaderCellRenderer.prototype.createText` — not `StringRenderer.prototype.createText` — is what actually runs, even though the call site is textually inside `StringRenderer`'s own field initializer. Confirmed with an isolated three-level (`Base`/`Mid`/`Leaf`) scratch test mirroring this exact shape before writing this plan, and by the full `HeaderCellRenderer.createText()` override behaving correctly in the live verification above (`HeaderCellText`, not a bare `SelectableText`, ended up mounted).

## Implementation Notes

Step 6's grep invariant (`grep -n 'this._text.setTextAlign\|this._text.setFontWeight\|this._text.setFontSize' packages/lib/src/typescript/lib/component/button/Button.ts` — "zero matches") does not literally hold: one match remains, `Button.setTextAlign`'s own pre-existing forwarding call `this._text.setTextAlign(align)` (the public runtime-deviation path the plan's own `## Architecture Decisions` documents as intentionally untouched). That line already matched the same grep pattern before this plan's changes — confirmed against the pre-change source — so it is not new; the pattern was simply never precise enough to exclude it. The three constructor-only calls it was meant to catch are gone (confirmed via `git diff`), and `npm run typecheck`/the full test suite both pass. No functional change from what the plan intended.
