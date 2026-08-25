# Glyph Icon Size Dedup — Implementation Plan

## Overview

The Style Audit panel (`#/style-audit`, `packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`) reports two duplicate-rule groups for bare `Glyph` instances' `minSize`/`maxSize` — fixed square icon sizes repeated on every instance's own `#id` rule instead of one shared class rule. A capture taken during this plan's own investigation, after visiting a handful of demo screens, showed these as the two largest dedup opportunities in the whole audit: 45 instances / 3.14&nbsp;KB for `{ min-width: 14px; min-height: 14px; max-width: 14px; max-height: 14px; }`, and 20 instances / 1.28&nbsp;KB for the same shape at 8px.[^live-audit] `plans/implemented/glyph-preferredsize-reconciled-write-path.md` already fixed the same class of bug for `CheckboxCheckGlyph`/`RadioButtonDot` and explicitly named these two remaining groups as follow-up work needing "a dedicated subclass per call site... a separate, larger change." This plan is that follow-up, plus a second, different mechanism for the 8px group.

Both groups trace to **bare `Glyph` instances with no dedicated subclass to hang a class default on** — but for two structurally different reasons, requiring two different fixes:

- **The 14px group** comes from three independent owners, each constructing a plain `new Glyph(name)` and sizing it to a value that happens to resolve to 14px under the shipped theme: `Button.setGlyph` ([Button.ts:1685-1686](packages/lib/src/typescript/lib/component/button/Button.ts#L1685)), `ComboBoxCaret`'s own chevron field ([ComboBox.ts:547](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L547)), and `WindowHeader.setGlyph` ([WindowHeader.ts:259](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L259)). Each gets its own dedicated `Glyph` subclass with a `minSize`/`maxSize` class default, mirroring `CheckboxCheckGlyph`/`RadioButtonDot`/`ScrollArrowGlyph`.
- **The 8px group** comes from three independent owners that all size their icon via the *same* `Button.pinGlyphSize(px)` ([Button.ts:1786](packages/lib/src/typescript/lib/component/button/Button.ts#L1786)) — `SpinButton` ([SpinButton.ts:118](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L118)), `TabButton`'s close-button chevron ([TabButton.ts:342](packages/lib/src/typescript/lib/component/button/TabButton.ts#L342)), and `TableHeader`'s reserved-band menu button ([table/Header.ts:231](packages/lib/src/typescript/lib/component/table/Header.ts#L231)) — using three unrelated formulas that only coincidentally agree on 8 today. Because all three route through one generic `Button`-hosted glyph field, a class default would silently apply to all three even after one formula changes independently. This group uses the `styleGroup` mechanism (`plans/implemented/shared-instance-style-groups.md`) instead: each owner opts its own glyph into its own token, so the three stay independently overridable while each still dedupes its own instances onto one shared rule.

---

## Architecture Decisions

### 14px group: three dedicated `Glyph` subclasses, same shape as the existing precedent

`ButtonIconGlyph` (in `Button.ts`), `ComboBoxCaretGlyph` (in `ComboBox.ts`), and `WindowHeaderTitleGlyph` (in `WindowHeader.ts`) each replace a bare `new Glyph(...)` call with a small subclass carrying a `minSize`/`maxSize` class default of `{width:14,height:14}`, exactly mirroring `CheckboxCheckGlyph`/`RadioButtonDot`'s `_default<Name>Options` bag forwarded through the constructor's `subclassDefaults` parameter — not the `ownClassStyleDefaults` hierarchy mechanism, for the same reason that plan's `^why-not-hierarchy` footnote already rejected it for a `Glyph` subclass.[^why-subclassdefaults]

All three are worth fixing in this one plan, not just the dominant one. A live per-owner attribution captured during this plan's investigation (walking up from every rendered 14px `.Glyph` element to its nearest classed ancestor) found `Button`-family owners at roughly 72% of the group's instances, `ComboBoxCaret` at roughly 17%, and `WindowHeader` at roughly 9%[^live-attribution] — `Button` clearly dominates, but the other two are not negligible, and each fix is the same small, mechanical, well-precedented shape.

### `Button.setGlyph` covers every Button-family leaf, not just plain `Button`

`ButtonIconGlyph` is constructed inside `Button.setGlyph`, the single construction site every `Button` subclass funnels through (directly, or via an options-bag `glyph` field dispatched from `applyOptions`). This transparently covers `PickerButton`, `MenuButton` (and `NotificationHistoryButton`), a selected `TabButton`'s own leading glyph, and — via `overlay/windowControls.ts`'s `WindowControlButton`/`WindowLeadGlyphButton` factories, both of which construct with a `{ glyph }` option — every `WindowHeader`/`TabWindow` control button and `TabWindow`'s own leading icon. None of those files need a change.

### 8px group: `styleGroup`, not a class default — confirmed, not just assumed

`styleGroup` (shipped in `plans/implemented/shared-instance-style-groups.md`) already resolves `minSize`/`maxSize` as eligible keys — `Component.ts`'s `resolveInstanceStyleDeclarations` ([Component.ts:316-329](packages/lib/src/typescript/lib/core/Component.ts#L316)) includes both — and is already keyed per `(concrete class, token)` pair, never globally (`ensureStyleGroupRule`'s `_groupBags: Map<Function, Map<string, StyleLayer | null>>`, [ClassStyleRules.ts:1068](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1068)). Both properties were verified directly against this branch's shipped code, not assumed from the plan that added `styleGroup`. This confirms the mechanism fits: each of the three 8px owners calls `.getGlyph()?.setStyleGroup("<own-token>")` once, right after its existing `pinGlyphSize(8)` call, so its own instances dedupe onto their own shared rule without asserting a value none of the other two owners actually computes.

### Three separate tokens, not one shared token

Each of the three 8px owners gets its *own* `styleGroup` token (`"spin-glyph"`, `"tab-close-glyph"`, `"table-header-menu-glyph"`) rather than one shared token across all three. A shared token would still be *safe* — `styleGroup`'s render-time comparison falls back to a real per-instance write the moment an instance's resolved value stops matching the group's cached content, the same self-correcting behaviour a class default lacks — but it would make which owner's formula "won" the shared rule's content depend on construction order, and would produce one illegible `.ButtonIconGlyph--icon-8` rule instead of three self-explanatory ones. This mirrors `shared-instance-style-groups.md`'s own reasoning for choosing an explicit token over content-addressing in the first place (debuggability, no incidental cross-call-site coupling).[^shared-token-considered]

### The 14px fix lands first — it changes the 8px group's own concrete class

`SpinButton`, `TabButton`'s close button, and `TableHeader`'s menu button all get their glyph from `Button.setGlyph`, the same construction site `ButtonIconGlyph` replaces. Once that lands, every one of their glyphs is a `ButtonIconGlyph` instance, not a bare `Glyph` — so the 8px group's generated rules are `.ButtonIconGlyph--spin-glyph` etc., not `.Glyph--spin-glyph`. `## Ordered Implementation Steps` does the 14px group first for this reason; doing them in the other order still works (the group mechanism reads `this.constructor` dynamically at render time) but would make the `## Expected Behaviour` selectors below wrong until the 14px step lands.

### Named constants prevent the class default and the imperative call drifting apart

Each of the three 14px subclasses' `minSize`/`maxSize` class default and its owning component's own imperative `setPreferredSize` re-pin (`Button._syncGlyphSize`, `ComboBoxCaret`'s constructor, `WindowHeader.updatePreferredSize`/`setGlyph`) read from one shared local constant, mirroring `glyph-preferredsize-reconciled-write-path.md`'s `CHECKBOX_CHECK_SIZE`/`RADIO_DOT_SIZE` pattern — so a future change to one site can't silently diverge from the other.

---

## Internal Structure

### `component/button/Button.ts` — `ButtonIconGlyph`

Inserted between the existing `ButtonLabelText` class and the `Button` class's own doc comment ([Button.ts:301-303](packages/lib/src/typescript/lib/component/button/Button.ts#L301)):

```typescript
// The square size Button._syncGlyphSize's line-height auto-track resolves to
// under the shipped default theme (root font.size 14px, button.font.size
// -2px -> 12px, font.linePadding 2px -> 14px). A pinned icon, or an instance
// under a theme that resolves a different line height, still writes its own
// real per-instance size — this default is a hint the render-time
// reconciliation checks against, not a hard override.
const BUTTON_ICON_GLYPH_SIZE = { width: 14, height: 14 };

const _defaultButtonIconGlyphOptions: Partial<GlyphOptions> = {
    minSize: BUTTON_ICON_GLYPH_SIZE,
    maxSize: BUTTON_ICON_GLYPH_SIZE,
};

/**
 * The leading glyph inside a {@link Button}'s content row. `minSize`/
 * `maxSize` are a class default matching the size `_syncGlyphSize`'s
 * line-height auto-track resolves to under the shipped theme, so every
 * unpinned Button icon shares one `.ButtonIconGlyph` CSS rule instead of
 * repeating it. A pinned icon (`pinGlyphSize`) still writes its own real
 * size, which reconciles against this default the same way any per-instance
 * deviation does.
 */
class ButtonIconGlyph extends Glyph {
    constructor(name: string) {
        super(name, undefined, _defaultButtonIconGlyphOptions);
    }
}
```

`setGlyph` ([Button.ts:1685-1686](packages/lib/src/typescript/lib/component/button/Button.ts#L1685)) changes only its first line:

```typescript
setGlyph(name: string): this {
    const glyph = new ButtonIconGlyph(name);
```

`_syncGlyphSize`'s doc comment ([Button.ts:1624-1642](packages/lib/src/typescript/lib/component/button/Button.ts#L1624)) has one now-inaccurate clause — "instead of the Glyph's static 16×16 default" describes `Glyph`'s own base default, but the glyph `_syncGlyphSize` actually sizes is now a `ButtonIconGlyph`, whose own class default is 14×14, not 16×16. Change that clause to "instead of `ButtonIconGlyph`'s static 14×14 class default." `setGlyph`'s own doc comment ([Button.ts:1671-1684](packages/lib/src/typescript/lib/component/button/Button.ts#L1671)) gets one added sentence in its `@remarks`, after the existing "a consumer can override..." sentence: "The glyph is a dedicated `ButtonIconGlyph` (not a bare `Glyph`), so every unpinned icon's `minSize`/`maxSize` shares one `.ButtonIconGlyph` CSS rule instead of each carrying its own."

The import at [Button.ts:11](packages/lib/src/typescript/lib/component/button/Button.ts#L11) widens from `import { Glyph } from "~/component/display/Glyph.js";` to `import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";`.

### `component/input/ComboBox.ts` — `ComboBoxCaretGlyph`

Inserted immediately before the `ComboBoxCaret` class ([ComboBox.ts:546](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L546)):

```typescript
// ComboBoxCaret's own ink size — Util.lineHeightPx({ linePadding: false }),
// the root theme font size with no additive leading. Shared with
// ComboBoxCaret's own constructor below so the class default and the
// imperative re-pin can never drift apart.
const COMBOBOX_CARET_GLYPH_SIZE = { width: 14, height: 14 };

const _defaultComboBoxCaretGlyphOptions: Partial<GlyphOptions> = {
    minSize: COMBOBOX_CARET_GLYPH_SIZE,
    maxSize: COMBOBOX_CARET_GLYPH_SIZE,
};

/**
 * The chevron glyph inside a {@link ComboBoxCaret}. `minSize`/`maxSize` are
 * a class default matching the caret's own ink size, so every ComboBox's
 * chevron shares one `.ComboBoxCaretGlyph` CSS rule instead of repeating it.
 */
class ComboBoxCaretGlyph extends Glyph {
    constructor() {
        super("chevron-down", undefined, _defaultComboBoxCaretGlyphOptions);
    }
}
```

`ComboBoxCaret`'s field ([ComboBox.ts:547](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L547)) changes from `private _glyph: Glyph = new Glyph("chevron-down");` to `private _glyph: Glyph = new ComboBoxCaretGlyph();`. The constructor's own `this._glyph.setPreferredSize({ width: this._size, height: this._size });` ([ComboBox.ts:565](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L565)) is unchanged — it stays the authoritative per-instance re-pin the class default reconciles against.

The import at [ComboBox.ts:19](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L19) widens the same way, to `import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";`.

### `component/container/WindowHeader.ts` — `WindowHeaderTitleGlyph`

Inserted right before the `WindowHeader` class's own doc comment ([WindowHeader.ts:47-48](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L47), directly after the `WindowHeaderOptions` interface):

```typescript
// The title glyph's ink size — ThemeManager.getResolvedScale().titleGlyph,
// which is the root theme font size under the shipped default theme
// (titleGlyph's scale token is 1). Shared with WindowHeader's own
// constructor/updatePreferredSize re-pins so the class default and the
// imperative calls can never drift apart.
const WINDOW_HEADER_TITLE_GLYPH_SIZE = { width: 14, height: 14 };

const _defaultWindowHeaderTitleGlyphOptions: Partial<GlyphOptions> = {
    minSize: WINDOW_HEADER_TITLE_GLYPH_SIZE,
    maxSize: WINDOW_HEADER_TITLE_GLYPH_SIZE,
};

/**
 * The leading icon inside a {@link WindowHeader}'s title row. `minSize`/
 * `maxSize` are a class default matching the title-glyph ink size under the
 * shipped theme, so every window's title icon shares one
 * `.WindowHeaderTitleGlyph` CSS rule instead of repeating it.
 */
class WindowHeaderTitleGlyph extends Glyph {
    constructor(name: string) {
        super(name, undefined, _defaultWindowHeaderTitleGlyphOptions);
    }
}
```

`setGlyph` ([WindowHeader.ts:247-259](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L247)) changes only its `const glyph = new Glyph(name);` line ([WindowHeader.ts:259](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L259)) to `const glyph = new WindowHeaderTitleGlyph(name);`. Nothing else in `setGlyph`, `updatePreferredSize`, or `resolveTitleGlyphInk` changes — the existing `glyph.setPreferredSize({ width: ink, height: ink })` calls stay the authoritative per-instance re-pin.

The import at [WindowHeader.ts:9](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L9) widens from `import { Glyph } from "~/component/display/Glyph.js";` to `import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";`.

### 8px group — one line at each of three call sites

`component/input/SpinButton.ts`, right after the existing `this.pinGlyphSize(8);` ([SpinButton.ts:118](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L118)):

```typescript
this.getGlyph()?.setStyleGroup("spin-glyph");
```

`component/button/TabButton.ts`, inside `buildCloseButton`, right after `closeButton.pinGlyphSize(closeScale.tabCloseGlyph);` ([TabButton.ts:342](packages/lib/src/typescript/lib/component/button/TabButton.ts#L342)):

```typescript
closeButton.getGlyph()?.setStyleGroup("tab-close-glyph");
```

`component/table/Header.ts`, inside `TableHeader`'s constructor, right after `this._menuButton.pinGlyphSize(glyphPx);` ([table/Header.ts:231](packages/lib/src/typescript/lib/component/table/Header.ts#L231)):

```typescript
this._menuButton.getGlyph()?.setStyleGroup("table-header-menu-glyph");
```

No changes to `TabBar.ts`'s `positionCloseButtons` ([TabBar.ts:2547](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2547)) — it re-applies `pinGlyphSize` on every layout pass to the *same* close-button instance `TabButton.buildCloseButton` already created and grouped, so the group membership set once at construction persists automatically.

---

## Ordered Implementation Steps

### Part A — 14px group

1. **`packages/lib/tests/component/button/Button.test.ts`** — add a new `describe('ButtonIconGlyph style hoisting', ...)` block after the existing `ButtonLabelText style hoisting` block, with its own copied `idSelector`/`declarationsDuring` helpers (same shape as the existing block, lines 384-414), and one test: construct `new Button({ glyph: 'unicode-arrow-up', text: 'Save' })`, capture declarations written to its glyph's own `#id` rule during `btn.getElement(true)`, assert `minWidth`/`minHeight`/`maxWidth`/`maxHeight` are all `undefined`, and assert `_ruleCacheHas('.ButtonIconGlyph')` is `true`.
   *Check:* `npx vitest run tests/component/button/Button.test.ts` from `packages/lib` — the new case fails (source not yet changed).

2. **`packages/lib/tests/component/input/ComboBox.test.ts`** — add a sibling case to the existing `'row 4'` test ([ComboBox.test.ts:271-283](packages/lib/tests/component/input/ComboBox.test.ts#L271)), reusing its already-defined `idSelector`/`declarationsDuring`/`_ruleCacheHas`: construct `new ComboBox() as any`, reach `combo._caret.getGlyph()` (not `combo._caret` itself — that's the outer container, already deduped), capture declarations during `combo.getElement(true)`, assert all four size keys `undefined`, assert `_ruleCacheHas('.ComboBoxCaretGlyph')` is `true`.
   *Check:* `npx vitest run tests/component/input/ComboBox.test.ts` — the new case fails.

3. **Create `packages/lib/tests/component/container/WindowHeader.test.ts`** — no existing test file covers `WindowHeader` today. Follow `Button.test.ts`'s file shape (own `CONFIG`, `beforeEach`/`afterEach`, copied `idSelector`/`declarationsDuring`). One test: construct `new WindowHeader('Title')` (its default title icon applies since no `glyph` option is passed — [WindowHeader.ts:148-149](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L148)), capture declarations written to `header.getGlyph()!`'s own `#id` rule during `header.getElement(true)`, assert all four size keys `undefined`, assert `_ruleCacheHas('.WindowHeaderTitleGlyph')` is `true`.
   *Check:* `npx vitest run tests/component/container/WindowHeader.test.ts` — fails (class doesn't exist yet).

4. **`packages/lib/tests/component/default-options-fallback.test.ts`** — add `import { WindowHeader } from '~/component/container/WindowHeader';` near the other `component/container/` imports, and three new registry rows near the existing `'ComboBoxCaret minSize'`/`'Glyph minSize'` rows:
   ```typescript
   { label: 'ButtonIconGlyph minSize',        resolve: () => new Button({ glyph: 'unicode-arrow-up' }).getGlyph()!.getMinSizeConstraint(), expected: { width: 14, height: 14 } },
   { label: 'ComboBoxCaretGlyph minSize',     resolve: () => (new ComboBox() as any)._caret.getGlyph().getMinSizeConstraint(),               expected: { width: 14, height: 14 } },
   { label: 'WindowHeaderTitleGlyph minSize', resolve: () => new WindowHeader('Title').getGlyph()!.getMinSizeConstraint(),                    expected: { width: 14, height: 14 } },
   ```
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — the three new rows fail.

5. **`packages/lib/src/typescript/lib/component/button/Button.ts`** — add `ButtonIconGlyph` and widen the `Glyph` import, per `## Internal Structure`.
   *Check:* `npm run typecheck`.

6. **`packages/lib/src/typescript/lib/component/button/Button.ts`** — change `setGlyph`'s `new Glyph(name)` to `new ButtonIconGlyph(name)`, and make the two doc-comment edits (`_syncGlyphSize`'s stale "16×16" clause, `setGlyph`'s added `@remarks` sentence), per `## Internal Structure`.
   *Check:* `npm run typecheck`; re-run step 1's test — green.

7. **`packages/lib/src/typescript/lib/component/input/ComboBox.ts`** — add `ComboBoxCaretGlyph`, widen the `Glyph` import, and change `ComboBoxCaret`'s field initializer to `new ComboBoxCaretGlyph()`, per `## Internal Structure`.
   *Check:* `npm run typecheck`; re-run step 2's test — green.

8. **`packages/lib/src/typescript/lib/component/container/WindowHeader.ts`** — add `WindowHeaderTitleGlyph`, widen the `Glyph` import, and change `setGlyph`'s `new Glyph(name)` to `new WindowHeaderTitleGlyph(name)`, per `## Internal Structure`.
   *Check:* `npm run typecheck`; re-run step 3's test — green.

9. **Re-run step 4's test file.** `npx vitest run tests/component/default-options-fallback.test.ts` — all three new rows green.

10. **`grep -rn "new Glyph(" packages/lib/src/typescript/lib/component/button/Button.ts packages/lib/src/typescript/lib/component/input/ComboBox.ts packages/lib/src/typescript/lib/component/container/WindowHeader.ts`** — expect zero matches (each site now constructs its own dedicated subclass instead).

### Part B — 8px group

11. **`packages/lib/tests/component/input/SpinButton.test.ts`** — add a new `describe('SpinButton chevron glyph style hoisting', ...)` block after the existing `'SpinButton class-hierarchy cascade'` block, with its own local `DOM_CONFIG`/`sink`/`beforeEach`/`afterEach`/`idSelector` (reusing the file's already-module-level `declarationsDuring`). One test: render a first `new SpinButton('▲')` to seed the group, then construct a second `new SpinButton('▼')`, capture declarations written to its glyph's own `#id` rule during the second instance's `getElement(true)`, assert all four size keys `undefined`, assert `_ruleCacheHas('.ButtonIconGlyph--spin-glyph')` is `true`.
    *Check:* `npx vitest run tests/component/input/SpinButton.test.ts` — the new case fails (source not yet changed).

12. **`packages/lib/tests/component/button/TabButton.test.ts`** — add `import { _ruleCacheHas } from '~/core/StyleTarget';`, then a new `describe('TabButton close-button glyph style hoisting', ...)` block reusing the file's existing module-level `sink`, with a local `idSelector` and a local `declarationsFor(writes, selector)` helper (**not** `declarationsDuring` — `TabButton.buildCloseButton` renders the close button eagerly during the outer `TabButton`'s own construction via an explicit `closeButton.getElement(true)` call, not lazily at the outer button's own render, so the capture window has to wrap the *construction* itself; copy the exact shape from `TabCloseButton.classStyleHoisting.test.ts`'s own `secondStart`/`secondWrites` pattern). One test: render a first `new TabButton('Warmup', { closeable: true }).getElement(true)` to seed the group, capture `sink.writes` from just before constructing a second `new TabButton('A', { closeable: true })`, reach `second.getCloseButton()!.getGlyph()!`, assert all four size keys `undefined` in the captured writes for that glyph's `#id` selector, assert `_ruleCacheHas('.ButtonIconGlyph--tab-close-glyph')` is `true`.
    *Check:* `npx vitest run tests/component/button/TabButton.test.ts` — the new case fails.

13. **`packages/lib/tests/component/table/HeaderMenuButton.test.ts`** — add `import { RecordingDOMSink } from '../../dom/TestDOM';` (alongside the existing `installTestDOM`/`makeEvent` import) and `import { _ruleCacheHas } from '~/core/StyleTarget';`, then a new test inside (or after) the existing `'TableHeader menu button'` describe block: capture `const sink = installTestDOM(CONFIG);` locally, render a first `layOut(makeTable())` to seed the group, capture `sink.writes` from just before building a second `layOut(makeTable())`, reach `table.getHeader().getMenuButton().getGlyph()!`, assert all four size keys `undefined` for that glyph's `#id` selector (add a local `idSelector`/`declarationsFor` pair, same shape as step 12's), assert `_ruleCacheHas('.ButtonIconGlyph--table-header-menu-glyph')` is `true`.
    *Check:* `npx vitest run tests/component/table/HeaderMenuButton.test.ts` — the new case fails.

14. **`packages/lib/src/typescript/lib/component/input/SpinButton.ts`** — add the one-line `this.getGlyph()?.setStyleGroup("spin-glyph");` per `## Internal Structure`.
    *Check:* `npm run typecheck`; re-run step 11's test — green.

15. **`packages/lib/src/typescript/lib/component/button/TabButton.ts`** — add the one-line `closeButton.getGlyph()?.setStyleGroup("tab-close-glyph");` per `## Internal Structure`.
    *Check:* `npm run typecheck`; re-run step 12's test — green.

16. **`packages/lib/src/typescript/lib/component/table/Header.ts`** — add the one-line `this._menuButton.getGlyph()?.setStyleGroup("table-header-menu-glyph");` per `## Internal Structure`.
    *Check:* `npm run typecheck`; re-run step 13's test — green.

### Final

17. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib` — all green. No test file other than the ones touched/added in steps 1-4 and 11-13 should need any change — grep for any other test asserting a literal `'Glyph'` concrete-class name reached via `Button`/`ComboBoxCaret`/`WindowHeader`/`SpinButton`/`TabButton`/`TableHeader` first if anything unexpected fails.[^no-other-tests]

18. **Add the changelog entry.** See `## Documentation Impact`.

19. **Full verification.** See `## Verification`.

20. **Verify live in a browser, and record the Style Audit before/after.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/tests/component/button/Button.test.ts` |
| Modify | `packages/lib/tests/component/input/ComboBox.test.ts` |
| Create | `packages/lib/tests/component/container/WindowHeader.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/component/input/SpinButton.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.test.ts` |
| Modify | `packages/lib/tests/component/table/HeaderMenuButton.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-9 are unit-testable against the recording DOM sink (the cases steps 1-4 and 11-13 add). Rows 10-11 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | A `Button`'s unpinned leading glyph (e.g. `new Button({ glyph: 'unicode-arrow-up' })`) renders | Its `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight` — all four match `.ButtonIconGlyph`'s class default |
| 2 | A `ComboBox`'s caret chevron renders | Same — its `#id` rule carries no size declaration; `.ComboBoxCaretGlyph` exists |
| 3 | A `WindowHeader`'s (default or explicit) title glyph renders | Same; `.WindowHeaderTitleGlyph` exists |
| 4 | `new Button({glyph:'unicode-arrow-up'}).getGlyph()!.getMinSizeConstraint()` / `(new ComboBox() as any)._caret.getGlyph().getMinSizeConstraint()` / `new WindowHeader('Title').getGlyph()!.getMinSizeConstraint()` | All three `{width:14,height:14}` — unchanged from before this plan; only what gets *written to the stylesheet* changes |
| 5 | A second `SpinButton` chevron renders, after a first has already rendered | Its `#id` rule carries no size declaration; `.ButtonIconGlyph--spin-glyph` carries `{minWidth:"8px",...}` |
| 6 | A second closeable `TabButton`'s close-button glyph renders, after a first has already rendered | Same; `.ButtonIconGlyph--tab-close-glyph` |
| 7 | A second `TableHeader`'s menu-button glyph renders, after a first has already rendered | Same; `.ButtonIconGlyph--table-header-menu-glyph` |
| 8 | A `Button` with a *pinned* glyph at some other size (`pinGlyphSize(20)`, no `styleGroup` call) | Still writes a real per-instance `#id` deviation from `.ButtonIconGlyph`'s 14×14 default — unaffected by this plan, matches today's behaviour for any class-default mismatch |
| 9 | A `SpinButton` chevron under a hypothetical future theme where `pinGlyphSize(8)`'s caller-side formula would resolve to something other than 8 | Still renders correctly — that instance's real resolved value no longer matches `.ButtonIconGlyph--spin-glyph`'s cached content, so it falls back to a real per-instance `#id` write, the same self-correcting behaviour any `styleGroup`/class-default mismatch already has |
| 10 | Manual — live app, `#/style-audit`, after visiting screens with icon buttons, ComboBoxes, a window with a title glyph, NumberSpinner controls, closeable tabs, and a table (for its header menu button), then Refresh | The `{min-width:14px;...}` and `{min-width:8px;...}` bare-`Glyph`-only duplicate-rule rows are gone (or contain only glyphs this plan doesn't cover, if any exist); new rows may appear grouped under `ButtonIconGlyph`, `ComboBoxCaretGlyph`, `WindowHeaderTitleGlyph` only if some *other* deviation still forces a per-instance rule |
| 11 | Manual — same screens | Every icon, chevron, title glyph, spinner arrow, tab close ✕, and table header menu icon renders at its existing size and position, unchanged from before this plan |

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
grep -rn "new Glyph(" packages/lib/src/typescript/lib/component/button/Button.ts packages/lib/src/typescript/lib/component/input/ComboBox.ts packages/lib/src/typescript/lib/component/container/WindowHeader.ts
# expect zero matches

grep -n 'setStyleGroup("spin-glyph")' packages/lib/src/typescript/lib/component/input/SpinButton.ts
grep -n 'setStyleGroup("tab-close-glyph")' packages/lib/src/typescript/lib/component/button/TabButton.ts
grep -n 'setStyleGroup("table-header-menu-glyph")' packages/lib/src/typescript/lib/component/table/Header.ts
# each: exactly one match
```

**Manual browser verification (rows 10-11) is required.** The offline harness records writes; it does not run a CSS cascade or reflect the Style Audit panel's own dedup grouping.

- Start a dev server on a spare port from *this worktree* (symlink `node_modules` to the repo root first if this worktree doesn't already have one), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Reproduce this plan's own before-measurement first, against the unmodified code: navigate to `#/misc`, click "Show window with table (slow)!", "Show window with wide table (45 columns)!", "Show window with title glyph", "Dockable layout (Dock)", and "Show window with tree table!", then the "Tab" tab, then "Style Audit", then "Refresh". This plan's own run (before the fix, on a similar but not identical set of open screens) found rows `45 | 3.14 KB | Glyph | plain | {min-width:14px;min-height:14px;max-width:14px;max-height:14px;}` and `20 | 1.28 KB | Glyph | plain | {min-width:8px;min-height:8px;max-width:8px;max-height:8px;}`, out of a 506-rule / 390-per-instance total.
- Apply the fix, restart the dev server, repeat the identical navigation, and re-check the panel. Both rows should be gone (or reduced to only genuinely-deviating instances, per row 8/9 above) — confirm qualitatively (rows disappear or shrink), not against an exact byte count, since the panel accumulates whichever screens were visited and counts will differ run to run.
- Read **computed styles** on a `Button` icon, a `ComboBox` chevron, a `WindowHeader` title icon, a `NumberSpinner`'s arrows, a closeable tab's ✕, and a table's header menu icon — confirming each still renders at its existing size, unchanged.

---

## Documentation Impact

No exported symbol changes: `ButtonIconGlyph`, `ComboBoxCaretGlyph`, and `WindowHeaderTitleGlyph` are module-private, matching `CheckboxCheckGlyph`/`RadioButtonDot`/`ScrollArrowGlyph`. `Button`/`ComboBox`/`WindowHeader`/`SpinButton`/`TabButton`/`TableHeader`'s public constructors, options, and getters/setters keep their existing signatures — `getGlyph()` on each still returns a `Glyph` (a subclass instance satisfies that type). No API page, barrel, or sidebar entry changes; `npm run docs:api` must still finish with zero warnings.

One new bullet appended to the end of the last `## Changed` → `### Components` list in `packages/lib/docs/reference/changelog/next.md`:

> **`Button`'s leading icon, a `ComboBox`'s chevron, and a `WindowHeader`'s title icon no longer repeat their fixed size on every instance's own CSS rule; a `NumberSpinner`'s arrows, a closeable tab's ✕, and a table's header menu icon no longer repeat theirs either.** The first three now share one class-level rule each (`.ButtonIconGlyph`, `.ComboBoxCaretGlyph`, `.WindowHeaderTitleGlyph`); the second three now use the `styleGroup` mechanism to share a rule per owner (`.ButtonIconGlyph--spin-glyph`, `.ButtonIconGlyph--tab-close-glyph`, `.ButtonIconGlyph--table-header-menu-glyph`) rather than a class default, since the three compute their shared 8px size from unrelated formulas that only coincidentally agree today. Nothing changes visually. No consumer action is needed.

---

## Potential Challenges

- **Six files change for what is conceptually two fixes.** Each of the six call sites needs its own edit because each constructs (or sizes) a genuinely independent glyph. Mitigated the same way the precedent plan was: each subclass/call-site keeps its own named size constant colocated with both its use sites.
- **`TabButton.buildCloseButton` renders its close button eagerly at construction, not at the outer button's first render.** A test written against the usual "wrap `getElement(true)` in a capture window" shape would silently pass on stale (empty) data. `## Ordered Implementation Steps` step 12 calls this out explicitly and points at the existing `TabCloseButton.classStyleHoisting.test.ts` test that already handles it correctly, to copy from.
- **A `styleGroup` token's cached content is seeded by whichever instance renders first in a given process** (browser session or test file) and never re-resolves later — the same limitation `styleGroup` already has for any consumer, not new here. If `SpinButton`'s hardcoded `8` and `TabButton`'s theme-scale-derived `tabCloseGlyph` ever diverge from each other's numeric value, nothing breaks: they use separate tokens, so neither's group rule is affected by the other regardless.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `_syncGlyphSize` (1643), `setGlyph` (1685), `pinGlyphSize` (1786) — the three methods whose interaction this plan's whole 14px/8px split rests on |
| `packages/lib/src/typescript/lib/component/input/ComboBox.ts` | `ComboBoxCaret` (546) — the container's own already-deduped size (`subclassDefaults`) vs. its un-deduped inner glyph, the exact distinction this plan's fix targets |
| `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` | `setGlyph` (247), the default-title-icon guard (148) — confirms every `WindowHeader` gets a title glyph unless explicitly cleared |
| `packages/lib/src/typescript/lib/component/input/SpinButton.ts`, `packages/lib/src/typescript/lib/component/button/TabButton.ts`, `packages/lib/src/typescript/lib/component/table/Header.ts` | The three independent 8px formulas (hardcoded `8`, `ThemeManager.getResolvedScale().tabCloseGlyph`, `TRACK_WIDTH - MENU_BUTTON_CHROME_PX`) that motivate `styleGroup` over a class default |
| `packages/lib/src/typescript/lib/core/Component.ts` | `resolveInstanceStyleDeclarations` (316), `setStyleGroup`/`getStyleGroup` (1872, 1896) — confirms `minSize`/`maxSize` are eligible `styleGroup` keys |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureStyleGroupRule`, `_groupBags` (1068) — confirms the group cache is keyed per `(concrete class, token)`, never globally |
| `plans/implemented/glyph-preferredsize-reconciled-write-path.md` | The direct precedent for the 14px group's mechanism (`CheckboxCheckGlyph`/`RadioButtonDot`'s `_default<Name>Options` bag shape) and its `^why-not-hierarchy` footnote, which this plan's subclasses also follow |
| `plans/implemented/shared-instance-style-groups.md` | The `styleGroup` mechanism this plan's 8px fix is the first production consumer of |
| `plans/implemented/glyph-class-tier-migration.md` | Nearby precedent for a `Glyph`-family fix in the same session; read for contrast — that plan's font-size/line-height/text-align fix needed a `getClassStyleDefaults()` override specifically, which this plan's pure `minSize`/`maxSize` fix does not (mirrors that plan's own `ScrollArrowGlyph` `minSize`/`maxSize` handling, which used the same simple `subclassDefaults` shape this plan uses throughout) |
| `packages/lib/tests/component/button/TabCloseButton.classStyleHoisting.test.ts` | The precedent for capturing writes across an *eager*, construction-time render — the shape step 12's new test must copy |

---

## Non-Goals

- **A generic cross-component icon-size utility class.** There is no single semantic "8px icon" or "14px icon" concept — the values converge by coincidence of independently-chosen theme tokens and constants, not shared design intent. Each owner keeps its own subclass or `styleGroup` token.
- **A class-tier default for the 8px group.** Investigated and rejected — see `## Architecture Decisions`. `styleGroup` is the mechanism.
- **Any other bare-`Glyph` duplicate-rule group the Style Audit might show at some other size** (e.g. a char-mode glyph with its own `font-size`). Out of scope; this plan covers exactly the two groups named in its brief.
- **Changes to `Button.pinGlyphSize`'s own signature** (e.g. adding an optional `styleGroup` parameter). Each of the three 8px call sites calls `.getGlyph()?.setStyleGroup(...)` separately instead, per this plan's own investigation brief.
- **`overlay/windowControls.ts`, `TabWindow`, `PickerButton`, `MenuButton`, `ToggleButton`/`TabButton`'s own leading-glyph option.** All transparently covered by the `Button.setGlyph` fix with no file changes — see `## Architecture Decisions`.
- **`TabBar.ts`.** Its `positionCloseButtons` re-applies `pinGlyphSize` to an already-grouped instance; no change needed.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

- **`ButtonIconGlyph` and `WindowHeaderTitleGlyph` forward a `subclassDefaults` parameter, not called for by `## Internal Structure`.** Both take a `name: string` constructor parameter, so the project's `local/require-subclass-defaults` ESLint rule (ARCHITECTURE.md's "Constructors forward `subclassDefaults`") flagged their plain `super(name, undefined, _default<Name>Options)` call as a dead end no subclass could seed a default through. Each constructor now also accepts `subclassDefaults?: Partial<GlyphOptions>` and spreads it over the class constant, mirroring `ScrollArrowGlyph`'s existing shape (`Scrollbar.ts`). `ComboBoxCaretGlyph` was unaffected — its zero-parameter constructor is the rule's explicitly documented exemption (a fixed-configuration leaf with no options bag to widen).
- **Live browser verification (Ordered Implementation Steps 20) completed.** A dev server was started from this worktree on a spare port (`readlink /proc/<pid>/cwd` confirmed it served this worktree's own `packages/lib`), driven via `chrome-devtools` in an isolated browser context to avoid a separate concurrent session sharing the same browser instance. After visiting `#/misc` → the five window-opening buttons this plan's own investigation used → the `Tab` tab → `Style Audit` → Refresh, the panel reported zero rows attributed to `Glyph` (bare or otherwise) and zero `min-width: 14px`/`min-width: 8px` duplicate-rule bodies — both groups this plan targets are gone. Computed sizes were also checked directly: a `Button` icon and a `WindowHeader` title icon each `14×14` under `.ButtonIconGlyph`/`.WindowHeaderTitleGlyph`, a `ComboBox` chevron `14×14` under `.ComboBoxCaretGlyph`, and a `SpinButton` arrow, a closeable tab's ✕, and a `TableHeader` menu icon each `8×8` under `.ButtonIconGlyph--spin-glyph`/`--tab-close-glyph`/`--table-header-menu-glyph` respectively — all unchanged from their pre-fix sizes.
- **Step 4's `ButtonIconGlyph minSize` registry row is `{width:16,height:16}`, not the `{width:14,height:14}` `## Expected Behaviour` row 4 claims.** An independent audit round caught that this row had been silently dropped rather than added; adding it exactly as specified failed (`AssertionError: expected {16,16} to deeply equal {14,14}`). Root cause, confirmed by reading `Glyph.applyOptions` (`Glyph.ts:652-666`): a `subclassDefaults`-forwarded `minSize`/`maxSize` is re-pinned to `getPreferredSizeConstraint()` (the base `Glyph`'s own `preferredSize` default, 16×16) unconditionally during construction — a pre-existing characteristic already shared by `CheckboxCheckGlyph`/`RadioButtonDot`/`ScrollArrowGlyph` (confirmed against the existing `ScrollArrowGlyph minSize`/`Glyph minSize` registry rows), not a regression this plan introduced. `ComboBoxCaretGlyph`/`WindowHeaderTitleGlyph` still read back 14×14 immediately because their owners' constructors unconditionally re-pin the real size synchronously; `ButtonIconGlyph`'s owner (`Button._syncGlyphSize`) only re-pins once `Text.getLineHeight()` can measure real metrics, which this DOM-less registry harness never provides. The row now asserts the actual `{16,16}` value with an explanatory comment, rather than silently omitting it. This also surfaced two related comments (`COMBOBOX_CARET_GLYPH_SIZE` in `ComboBox.ts`, `WINDOW_HEADER_TITLE_GLYPH_SIZE` in `WindowHeader.ts`) that claimed the constant is "shared with the imperative re-pin ... so the two can never drift apart" — false for both (each owner independently recomputes the value; only `ButtonIconGlyph`'s own comment, which never made this claim, was accurate) — reworded to match `BUTTON_ICON_GLYPH_SIZE`'s honest "hint the render-time reconciliation checks against" phrasing.
- **`_syncGlyphSize`'s doc comment (`Button.ts`) inherited a second, related inaccuracy from `## Internal Structure`'s literal text (plan line 87-89), caught in a second audit round.** It claimed the method syncs the glyph "instead of `ButtonIconGlyph`'s static 14×14 class default" — but per the previous bullet, an un-synced `ButtonIconGlyph` instance is 16×16, not 14×14; `ButtonIconGlyph`'s 14×14 only exists as the shared `.ButtonIconGlyph` CSS class-rule default the rendered value reconciles against, not as this instance's own pre-sync size. Reworded to state the un-synced 16×16 default explicitly and clarify the class-rule/instance-default distinction.
- **Step 1's `ButtonIconGlyph style hoisting` test (`Button.test.ts`) needed a themed DOM sink override plus `Util.invalidateTextMetricsCache()`, not called for by `## Ordered Implementation Steps` step 1's literal text, caught in a third audit round.** The outer `describe` blocks' default harness config leaves `--ts-ui-button-font-size` unset, so `Button`'s label falls back to its CSS rule's own literal fallback (`BUTTON_LABEL_FONT_SIZE_RULE`, `Button.ts:271`, `var(--ts-ui-button-font-size, 14px)`) instead of the shipped theme's derived 12px; `_syncGlyphSize` (`Button.ts:1681`) would then sync the glyph to 16px (14px + 2px line-padding), which does not match `.ButtonIconGlyph`'s 14×14 class default and would fail the test as a real per-instance deviation. The test installs a second sink with the shipped theme's resolved button font-size (`installTestDOM({ ...CONFIG, themeVars: { '--ts-ui-button-font-size': '12px' } })`) and calls `Util.invalidateTextMetricsCache()` before constructing the `Button`, so it exercises the real themed value `.ButtonIconGlyph`'s class default targets — the same pattern `dom/baseline.test.ts` already uses for a themed metrics test. A harness quirk, not a real behavioural deviation; the test itself already carries this explanation as an inline comment.

---

## Notes

[^live-audit]: Captured live during this plan's investigation: a dev server was started from a scratch worktree (confirmed via `readlink /proc/<pid>/cwd`), and the `#/style-audit` panel was driven via `chrome-devtools` after visiting `#/misc` → "Show window with table (slow)!" → "Show window with wide table (45 columns)!" → "Show window with title glyph" → "Dockable layout (Dock)" → "Show window with tree table!" → the "Tab" tab, then Refresh. The panel reported (among other rows) `45 | 3.14 KB | Glyph | plain | {min-width:14px;min-height:14px;max-width:14px;max-height:14px;}` and `20 | 1.28 KB | Glyph | plain | {min-width:8px;min-height:8px;max-width:8px;max-height:8px;}`, out of a 506-rule / 390-per-instance total — the two single largest "estimated dedupeable size" contributors in the whole capture. Exact counts depend on which screens are open and will differ run to run; the qualitative finding (these are the two largest bare-`Glyph` duplicate groups) is what matters, not the specific numbers.

[^live-attribution]: From the same browser session: `document.querySelectorAll('.Glyph')` was evaluated in-page, filtered to elements whose computed `min-width` was `14px`, and each was walked up to its nearest classed ancestor. Result: `{"Button":15,"Button.MenuButton.NotificationHistoryButton":1,"ComboBoxCaret":8,"Button.PickerButton":3,"Button.ToggleButton.TabButton.selected":1,"Button.flat":1,"WindowHeader":4,"Button.WindowControlButton":12}` — 33 of 46 elements (72%) under a `Button`-family ancestor, 8 (17%) under `ComboBoxCaret`, 4 (9%) under `WindowHeader`. The equivalent 8px sweep found `{"Button.SpinButton":10,"Button.TabCloseButton":8,"Button.flat":3}` — the `Button.flat` entries are `TableHeader`'s `flat:true` menu button (confirmed by reading `table/Header.ts`'s own `flat: true` construction option), one per open table.

[^why-subclassdefaults]: `glyph-preferredsize-reconciled-write-path.md`'s `^why-not-hierarchy` footnote rejected `ownClassStyleDefaults` for a `Glyph` subclass because `ensureClassStyleRule`'s hierarchy walk switches a class's *entire ancestor chain* onto the hierarchy mechanism the moment *any* level declares `ownClassStyleDefaults`, which would silently change how `Glyph`'s *other* subclasses resolve their own defaults too. The same reasoning applies here: `ButtonIconGlyph`/`ComboBoxCaretGlyph`/`WindowHeaderTitleGlyph` are leaves with no subclasses of their own, so the specific hazard (widening the *base* class) doesn't directly apply — but there is no positive reason to prefer it either, since none of the three needs the hierarchy walk's cascade-with-ancestors behaviour, and the plain `subclassDefaults` shape is what every existing `Glyph` subclass (`CheckboxCheckGlyph`, `RadioButtonDot`, `ScrollArrowGlyph`'s own `minSize`/`maxSize`) already uses successfully for exactly this kind of static default.

[^shared-token-considered]: A single shared token across all three 8px owners was considered and rejected for legibility and debuggability, not correctness — `styleGroup`'s per-instance comparison means a shared token would still render correctly even if the three owners' formulas later diverge (whichever owner's instance renders first seeds the group; any later instance whose real value no longer matches falls back to its own `#id` write). It was rejected because `shared-instance-style-groups.md`'s own `## Architecture Decisions` gives the identical reasoning for choosing an explicit per-purpose token over a value-derived one in the first place: a token-keyed rule's selector should say what it *is* (`.ButtonIconGlyph--tab-close-glyph`), not merely what value it happens to hold today, and two owners sharing a token by coincidence of an equal value — rather than by a stated design decision to share — is the same "silent cross-call-site coupling" risk that plan's decision explicitly avoided.

[^no-other-tests]: A search across `packages/lib/tests/` for any test asserting a literal `'Glyph'` DOM class, `getClassName()`, or `constructor.name` reached via `Button`, `ComboBoxCaret`, `WindowHeader`, `SpinButton`, `TabButton`, or `TableHeader` found none — every existing test in this area either asserts on the *owning* component's own rule (`TabButton.styleRuleDisposal.test.ts`, `TabCloseButton.classStyleHoisting.test.ts`) or on JS-level getters unaffected by this plan (`getGlyphName()`, `getPreferredSize()` on the owning button, `HeaderMenuButton.test.ts`'s existing `getGlyph()!.getPreferredSize()!.width` check). No existing test needs updating beyond the files listed in `## Files to Create / Modify / Delete`.
