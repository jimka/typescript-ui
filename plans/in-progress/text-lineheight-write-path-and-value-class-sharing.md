---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Text `lineHeight` Write-Path Fix and Value-Class Sharing — Implementation Plan

## Overview

The in-app Style Audit panel (`#/style-audit`) found `SelectableText`'s `line-height` declaration duplicated across hundreds of table cells (four distinct duplicate-body rows: 276/18.26 KB, 110/9.26 KB, 36/2.32 KB, 14/2.03 KB). [`Text.setLineHeight()`](packages/lib/src/typescript/lib/component/input/Text.ts#L1121) writes through the raw, unconditional `this.setElementCSSRule("lineHeight", ...)`, and [`CellRenderer.doLayout()`](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L105-L124) calls it on every layout pass, syncing each cell's embedded `SelectableText` line-height to the cell's own pixel height so single-line text sits vertically centred. Every `String`/`Number`/`Time`/`Combo`/`Date`/`DateTime` cell renderer does this (they all embed a `SelectableText`), and most rows in a table share the same row height, so hundreds of `SelectableText` instances end up writing the *identical* numeric pixel value (e.g. `"22px"`) to their own separate `#id` rule.

This is a different problem from the two findings in [`component-borderradius-visibility-write-path-cleanup.md`](component-borderradius-visibility-write-path-cleanup.md), found in the same audit sweep. Those two are a dead render-phase write and a property that needs to join the existing reconciled-write-path mechanism — in both cases a *static* class-level comparison value already exists or is addable. `lineHeight`'s numeric-pixel mode has no such value: [`Text`'s class-level default](packages/lib/src/typescript/lib/component/input/Text.ts#L1391-L1409) is the theme-derived `ADDITIVE_LINE_HEIGHT_RULE` (`"calc(1em + var(--ts-ui-line-padding, 2px))"`), never a specific pixel number — a table's row height is a runtime, per-table value, not a class constant. Duplication here comes from many *sibling instances* coincidentally resolving the same value, not from an instance repeating its own class's default — the class-tier hoisting mechanism (`ensureClassStyleRule`) has no way to help, because it compares an instance's value against its *class's* default, not against other instances.

This plan has two independent-but-co-located parts, both in [`component/input/Text.ts`](packages/lib/src/typescript/lib/component/input/Text.ts):

1. **The CSS-var/theme-revert path** (`setLineHeight(cssVarName)`, `centerInHeight(null)`) already has a real class-tier comparison value to dedupe against (the `ADDITIVE_LINE_HEIGHT_RULE` above) — it just needs to join the existing reconciled-write-path mechanism, the same fix shape as `component-borderradius-visibility-write-path-cleanup.md`'s `visibility` half.
2. **The numeric-pixel path** (`setLineHeight(px: number)`, the dominant byte cost) needs a new-to-this-property mechanism: a value-derived shared class rule, so every `Text`-family instance across the whole app that resolves the same pixel line-height shares one rule instead of each writing its own. This reuses the framework's *existing* state-tier machinery (`Component.createStateStyleRule` / `ensureClassStateRule`) rather than inventing a new one — see `## Architecture Decisions`.

Both parts are needed together: part 2's shared rule only saves bytes if the render-phase font-declaration write also stops unconditionally re-deriving `lineHeight` on every `applyStyle()` pass. That render-phase change (`## Architecture Decisions`) is one edit that serves both parts at once — it lets part 1's CSS-var/theme mode dedupe via the clear-on-match path, and it is what stops part 2's numeric-pixel mode from ever being reintroduced by a later render. Splitting the two parts into separate plans would leave one incomplete without the other.

---

## Architecture Decisions

### Numeric-pixel sharing reuses `createStateStyleRule`, keyed by a value-derived suffix instead of a named state

[`ensureClassStateRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L289) already implements exactly what this needs: a `.ClassName<suffix>` rule shared across every instance of `ctor` that requests the same `(ctor, suffix)` pair, with the *first* caller's declarations winning and every later caller with an identical value writing nothing to its own instance rule. Nothing in its contract requires `suffix` to be a fixed, named state — its own doc comment describes the parameter generically ("the selector suffix, verbatim... matching whatever the instance rule's own `createStyleRule(suffix)` call uses"), not as "must be `.pressed`-shaped." This plan's only divergence from every existing caller (`Button`'s `.pressed`, `ToggleButton`'s `.selected`, `CheckboxBox`'s `.selected`/`.indeterminate`) is that the suffix is *computed from the value being written* — `.lh18px` for `"18px"` — rather than being one of a small, fixed, class-author-chosen set. This still satisfies the mechanism's actual requirement (a stable, verbatim CSS selector suffix); see `## Internal Structure` for the exact derivation.

Investigated and rejected: a brand-new value-keyed shared-rule mechanism in `ClassStyleRules.ts`, parallel to `ensureStyleGroupRule` in the drafted (not yet implemented) [`shared-instance-style-groups.md`](shared-instance-style-groups.md). That plan's own Architecture Decisions explicitly reject a content-addressed (value-keyed, no caller token) cache for its general case, because canonicalizing an arbitrary chrome-property bag (`BorderOptions`-shaped values, multi-field bags) is genuinely hard and risks silently coupling two call sites that happen to produce the same value by coincidence. Neither objection applies here: `lineHeight`'s numeric mode is a single scalar CSS length string with no canonicalization ambiguity, and every call site that would share a value (`CellRenderer.doLayout`, `IconLabel`, list/tree row renderers) *wants* to share whenever the resolved pixel height genuinely matches — there is no "coincidence" risk to guard against. Reusing the already-implemented state-tier mechanism needs no new core code at all, only a new way of calling it from `Text.ts`; a parallel value-keyed mechanism would duplicate `ensureClassStateRule`'s cache/collision/insertion logic for no benefit. `shared-instance-style-groups.md` itself is also not a fit even if it existed: its `styleGroup` resolves once, permanently, at an instance's first render, but `setLineHeight` is called repeatedly over an instance's life as row heights change — this plan's approach re-resolves the shared rule on every call instead.

### The DOM class token, not `#id`, is what points an instance at its shared rule — the caller manages add/remove, matching `CheckboxBox.applyState`'s precedent exactly

`StateStyleRule.set()`/`.setMany()` only decide whether *this instance's own* suffixed rule (`#id.lh18px`) needs a real declaration or can stay empty — they never touch the element's class list. The existing state-tier callers (`CheckboxBox.applyState`, `RadioButtonRing.applyState` — see [`checkbox-radio-delegate-state-style-defaults.md`](plans/implemented/checkbox-radio-delegate-state-style-defaults.md)) are each responsible for `DOM.sink.apply(element, { toggleClass: {...} })` themselves. This plan follows the identical division of responsibility, generalized from toggling a fixed boolean set of classes to adding/removing one *dynamically-named* class: `DOM.sink.apply` already supports `removeClass`/`addClass` (applied in that order) for exactly this shape — no toggle-by-name primitive is needed since only one value-class is ever active on an instance at a time.

An instance therefore needs to remember which token it currently carries, to remove the old one when the value changes (`Text` gains a private `_lineHeightValueClass: string | null` field) and to re-apply it if a value was set before the element existed — mirroring `CheckboxBox.render()`'s re-assert (see the cited plan's row 5).

### The render-phase font-declaration write skips `lineHeight` entirely while in numeric-pixel mode

[`Text.applyStyle()`](packages/lib/src/typescript/lib/component/input/Text.ts#L1425) currently re-derives every font/text declaration on each render pass, including `lineHeight` via `this.writeFontDeclaration("lineHeight", this._lineHeightCSSRule ?? (lineHeight !== null ? `${lineHeight}px` : null))` ([Text.ts:1441](packages/lib/src/typescript/lib/component/input/Text.ts#L1441)). `writeFontDeclaration` calls the skip-based `writeRuleDeclaration`, which compares against the class-tier `ADDITIVE_LINE_HEIGHT_RULE` — a numeric pixel value never matches that, so this line *always* writes the pixel value for real to `#id`, on *every* `applyStyle()` pass, regardless of the value-class mechanism above. An `#id` rule (specificity `1,0,0`) always outranks a `.ClassName.lh18px` class-pair rule (`0,2,0`) — so if `applyStyle()` ever re-runs after `setLineHeight(number)` was called (e.g. from `sync()` or `setId()`), this line would silently reintroduce the exact per-instance duplicate this plan removes, even though the shared rule and DOM class both still exist and are both correct. The fix is to only reconcile `lineHeight` here when `_lineHeightCSSRule` is non-null (CSS-var/theme mode) — in numeric-pixel mode, `setLineHeight`'s own write (via the value-class mechanism) is already the sole owner of this element's `line-height`, and needs no render-phase help.

### `touches-shared` on `Text.ts`, not `depends-on` — no design dependency on `class-hierarchy-cascade.md`

The drafted (not yet implemented) [`class-hierarchy-cascade.md`](class-hierarchy-cascade.md) also edits `Text.ts`, adding a `protected static readonly ownClassStyleDefaults` field near the top of the class. That edit and every edit in this plan touch different, non-overlapping regions of the file (a new static field near the top vs. `setLineHeight`/`centerInHeight`/`applyStyle`/a new `render()` override further down) and neither plan's design depends on the other's mechanism — this plan never reads `ownClassStyleDefaults`, and that plan never touches `lineHeight`. Implementing both in separate worktrees at the same time risks a textual merge conflict, though, hence `touches-shared` rather than `depends-on`, matching the same reasoning `reconciled-write-path-widening.md` used for its own overlap with `state-chrome-isolation-generalization.md`.

### Every Text-family class gets its own shared rule per value — no cross-class sharing

`ensureClassStateRule` keys its cache by the concrete constructor, so `.SelectableText.lh18px` and `.Label.lh18px` are independent rules even though both classes might resolve `"18px"` at the same time (e.g. `list/renderer/Label.ts` and `list/renderer/Glyph.ts` both call `.setLineHeight(box.height)` on their own `Label`-embedding renderers). This matches every other tier in this codebase's three-tier CSS system, which has never shared a rule across two different concrete classes, and needs no special-casing.

---

## Public API

No public signature changes. `applyLineHeightValueClass`/`clearLineHeightValueClass` are new `private` methods; `render()` is a new `protected` override (an existing `Component` hook, not a new API surface); `_lineHeightValueClass` is a new `private` field. `excludeProtected`/normal privacy rules already keep all of this out of generated docs.

---

## Internal Structure

### `component/input/Text.ts` — new private field, placed beside `_lineHeightCSSVar`/`_lineHeightCSSRule`

```typescript
private _lineHeightCSSVar : string | null = null;
private _lineHeightCSSRule: string | null = ADDITIVE_LINE_HEIGHT_RULE;
// Tracks the DOM class token currently pointing this instance at its shared
// numeric-pixel value rule (e.g. "lh18px"), or null when in CSS-var/theme
// mode. See applyLineHeightValueClass / clearLineHeightValueClass.
private _lineHeightValueClass: string | null = null;
```

No `declare` needed: `setLineHeight` is dispatched from `Text`'s own constructor body, *after* `super()` returns — by which point this field's initializer has already run (see `Text.ts:161-163`; the existing `_lineHeightCSSVar`/`_lineHeightCSSRule` fields rely on the identical ordering, per the comment at [Text.ts:149-156](packages/lib/src/typescript/lib/component/input/Text.ts#L149-L156)).

### `component/input/Text.ts` — `applyLineHeightValueClass` / `clearLineHeightValueClass`, placed near `setLineHeight`

```typescript
/**
 * Points this instance at the shared `.ClassName.lh<value>` rule for
 * `pxValue`, so every instance of this concrete class that resolves the same
 * pixel line-height shares one rule instead of each writing its own `#id`
 * declaration. Removes the previously-applied token first, if this instance
 * already carried a different one. Reuses `createStateStyleRule` /
 * `ensureClassStateRule` — the state tier's existing shared-rule-per-suffix
 * mechanism — with a value-derived suffix instead of a fixed named state;
 * see `## Architecture Decisions`.
 *
 * @param pxValue - The exact CSS length string being applied (e.g. `"18px"`),
 *   used both as the declared value and, sanitized, as the class token.
 */
private applyLineHeightValueClass(pxValue: string): void {
    const token = "lh" + pxValue.replace(/[^a-zA-Z0-9]/g, "_");

    this.createStateStyleRule("." + token, () => ({ lineHeight: pxValue }))
        .setMany({ lineHeight: pxValue });

    const element = this.getElement();
    if (element) {
        const removeClass = (this._lineHeightValueClass && this._lineHeightValueClass !== token)
            ? [this._lineHeightValueClass]
            : [];
        DOM.sink.apply(element, { removeClass, addClass: [token] });
    }

    this._lineHeightValueClass = token;
}

/**
 * Reverts to the class-tier default: removes any value-class token this
 * instance currently carries. Called when switching out of numeric-pixel
 * mode (`setLineHeight`'s string branch, `centerInHeight(null)`).
 */
private clearLineHeightValueClass(): void {
    if (!this._lineHeightValueClass) {
        return;
    }

    const element = this.getElement();
    if (element) {
        DOM.sink.apply(element, { removeClass: [this._lineHeightValueClass] });
    }

    this._lineHeightValueClass = null;
}
```

`DOM.sink.apply`'s `removeClass` is applied before `addClass` ([`core/DOM.ts:128`](packages/lib/src/typescript/lib/core/DOM.ts#L128)), so passing both in one call is safe even when the old and new token happen to differ only by the value (there is no window where both or neither are present). No new imports needed: `DOM` and `Handle` are already imported in `Text.ts`.

### `component/input/Text.ts` — `setLineHeight` / `centerInHeight`, before → after

```typescript
// Before (Text.ts:1121-1151):
setLineHeight(value: number | string): this {
    if (typeof value === 'number') {
        if (this._options.lineHeight === value && this._lineHeightCSSVar === null && this._lineHeightCSSRule === null) {
            return this;
        }

        this._options.lineHeight = value as TOptions["lineHeight"];
        this._lineHeightCSSVar    = null;
        this._lineHeightCSSRule   = null;
        this.setElementCSSRule("lineHeight", value + "px");
    } else {
        this._lineHeightCSSVar    = value;
        this._lineHeightCSSRule   = `var(${value}, ${ADDITIVE_LINE_HEIGHT_RULE})`;
        this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
        this.setElementCSSRule("lineHeight", this._lineHeightCSSRule);
    }

    this._measurementDirty = true;
    (this.getParentComponent() ?? this).scheduleLayout();

    return this;
}
```

```typescript
// After — only the two write lines change:
setLineHeight(value: number | string): this {
    if (typeof value === 'number') {
        if (this._options.lineHeight === value && this._lineHeightCSSVar === null && this._lineHeightCSSRule === null) {
            return this;
        }

        this._options.lineHeight = value as TOptions["lineHeight"];
        this._lineHeightCSSVar    = null;
        this._lineHeightCSSRule   = null;
        this.applyLineHeightValueClass(value + "px");                        // was: this.setElementCSSRule("lineHeight", value + "px");
    } else {
        this.clearLineHeightValueClass();
        this._lineHeightCSSVar    = value;
        this._lineHeightCSSRule   = `var(${value}, ${ADDITIVE_LINE_HEIGHT_RULE})`;
        this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
        this.setReconciledCSSRules({ lineHeight: this._lineHeightCSSRule }); // was: this.setElementCSSRule("lineHeight", this._lineHeightCSSRule);
    }

    this._measurementDirty = true;
    (this.getParentComponent() ?? this).scheduleLayout();

    return this;
}
```

```typescript
// Before (Text.ts:1169-1183), the px === null branch only:
if (px === null) {
    this._lineHeightCSSVar   = null;
    this._lineHeightCSSRule  = ADDITIVE_LINE_HEIGHT_RULE;
    this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
    this.setElementCSSRule("lineHeight", this._lineHeightCSSRule);

    this._measurementDirty = true;
    (this.getParentComponent() ?? this).scheduleLayout();

    return this;
}
```

```typescript
// After:
if (px === null) {
    this.clearLineHeightValueClass();
    this._lineHeightCSSVar   = null;
    this._lineHeightCSSRule  = ADDITIVE_LINE_HEIGHT_RULE;
    this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
    this.setReconciledCSSRules({ lineHeight: this._lineHeightCSSRule });   // was: this.setElementCSSRule(...)

    this._measurementDirty = true;
    (this.getParentComponent() ?? this).scheduleLayout();

    return this;
}
```

`setReconciledCSSRules` is `protected` on `Component` ([Component.ts:4872](packages/lib/src/typescript/lib/core/Component.ts#L4872)), already accessible from `Text`. Per its own doc comment it is inert before first render (`_inheritedStyleBag` still null) — a pre-render call queues the value unconditionally, exactly like every other `reconciled-write-path-widening.md`-migrated setter; the first render's `applyStyle()` phase (below) then re-derives it correctly.

### `component/input/Text.ts` — `applyStyle()`, the `lineHeight` line

```typescript
// Before (Text.ts:1428-1441):
const fontSize   = this.getFontSize();
const lineHeight = this.getLineHeight();

this.writeFontDeclaration("fontFamily",     this.getFontFamily());
this.writeFontDeclaration("textAlign",      this.getTextAlign());
this.writeFontDeclaration("textShadow",     this.getTextShadow());
this.writeFontDeclaration("fontKerning",    this.getFontKerning());
this.writeFontDeclaration("fontSize",       this._fontSizeCSSRule   ?? (fontSize !== null ? `${fontSize}px` : null));
this.writeFontDeclaration("fontSizeAdjust", this.getFontSizeAdjust());
this.writeFontDeclaration("fontStretch",    this.getFontStretch());
this.writeFontDeclaration("fontStyle",      this.getFontStyle());
this.writeFontDeclaration("fontVariant",    this.getFontVariant());
this.writeFontDeclaration("fontWeight",     this.getFontWeight());
this.writeFontDeclaration("lineHeight",     this._lineHeightCSSRule ?? (lineHeight !== null ? `${lineHeight}px` : null));
```

```typescript
// After — the `lineHeight` local is gone (no other use in this method) and
// its write line is replaced with a mode-gated reconcile:
const fontSize = this.getFontSize();

this.writeFontDeclaration("fontFamily",     this.getFontFamily());
this.writeFontDeclaration("textAlign",      this.getTextAlign());
this.writeFontDeclaration("textShadow",     this.getTextShadow());
this.writeFontDeclaration("fontKerning",    this.getFontKerning());
this.writeFontDeclaration("fontSize",       this._fontSizeCSSRule   ?? (fontSize !== null ? `${fontSize}px` : null));
this.writeFontDeclaration("fontSizeAdjust", this.getFontSizeAdjust());
this.writeFontDeclaration("fontStretch",    this.getFontStretch());
this.writeFontDeclaration("fontStyle",      this.getFontStyle());
this.writeFontDeclaration("fontVariant",    this.getFontVariant());
this.writeFontDeclaration("fontWeight",     this.getFontWeight());
// lineHeight is not routed through writeFontDeclaration: in numeric-pixel
// mode (_lineHeightCSSRule === null) applyLineHeightValueClass already owns
// this element's line-height via the shared value-class rule, and a
// render-phase write here would reintroduce a per-instance #id declaration
// that always wins the cascade over that shared rule (see
// `## Architecture Decisions`). In CSS-var/theme mode, reconcile normally.
if (this._lineHeightCSSRule) {
    this.reconcileRuleDeclaration("lineHeight", this._lineHeightCSSRule);
}
```

### `component/input/Text.ts` — new `render()` override, placed near `applyStyle()`

```typescript
/**
 * Re-applies a pending numeric-pixel value-class token at first render, for
 * a `setLineHeight(px)` call made before the element existed — mirrors
 * `CheckboxBox.render()`'s re-assert (see
 * plans/implemented/checkbox-radio-delegate-state-style-defaults.md).
 */
protected render(): Handle {
    const element = super.render();

    if (this._lineHeightValueClass) {
        DOM.sink.apply(element, { addClass: [this._lineHeightValueClass] });
    }

    return element;
}
```

`Label.render()` ([`component/input/Label.ts:86`](packages/lib/src/typescript/lib/component/input/Label.ts#L86)) already calls `super.render()` first, so this new override composes correctly through the existing chain (`Label.render()` → this new `Text.render()` → `Component.render()`) with no change needed in `Label.ts`.

---

## Ordered Implementation Steps

1. **Write the new mechanism tests first.** Create `packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts`, following `TextClassStyleHoisting.test.ts`'s conventions (`declarationsDuring`/`idSelector` copied locally, `installTestDOM`/`DOM.reset()` per test) plus `_ruleCacheHas` imported from `~/core/StyleTarget` (the established import, per `checkbox-radio-delegate-state-style-defaults.md`'s test files). Cover `## Expected Behaviour` rows 1-7.
   *Check:* `npx vitest run tests/component/input/TextLineHeightValueClassSharing.test.ts` — every case fails for the expected reason (the mechanism doesn't exist yet).

2. **`component/input/Text.ts` — add `_lineHeightValueClass` and the two new private methods.** Per `## Internal Structure`. No other line changes yet.
   *Check:* `npm run typecheck`.

3. **`component/input/Text.ts` — rewrite `setLineHeight` and `centerInHeight`'s `px === null` branch.** Per `## Internal Structure`'s before/after. Change only the lines shown; leave the idempotency guard, `_measurementDirty`, and `scheduleLayout()` calls untouched.
   *Check:* `npm run typecheck`. `grep -n 'this.setElementCSSRule("lineHeight"' packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches.

4. **`component/input/Text.ts` — gate `applyStyle()`'s `lineHeight` write and remove the now-unused `lineHeight` local.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'this.writeFontDeclaration("lineHeight"' packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches.

5. **`component/input/Text.ts` — add the `render()` override.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

6. **Run the new test file.** `npx vitest run tests/component/input/TextLineHeightValueClassSharing.test.ts` — all green.

7. **Update six pre-existing `TextClassStyleHoisting.test.ts` tests.** Import `_ruleCacheHas` from `~/core/StyleTarget` into that file. Three tests assert the old numeric-`lineHeight`-on-`#id` behaviour directly; three more loop over `SKIPPABLE_FONT_KEYS` (which includes `lineHeight`) on a `#id` rule that already materialises for an unrelated reason (`textOverflow`, `marginLeft`, or a `fontSize` deviation) — under the old skip-based `writeRuleDeclaration`, a matching `lineHeight` was never queued at all, so it read `undefined`; under the new clear-on-match `reconcileRuleDeclaration`, a matching `lineHeight` is queued as an explicit removal, so it now reads `null` on any `#id` rule that materialises for some other reason. Leave every other test in the file untouched — they cover `fontSize`/`textAlign`/`textOverflow`/`fontWeight` in isolation, none of which this plan touches, and their `#id` rules either never materialise or never assert on `lineHeight`.

   **The three tests exercising `lineHeight` directly:**

   - **`'a constructor-time numeric lineHeight is honoured by both the getter and the render'`** ([TextClassStyleHoisting.test.ts:237-245](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L237-L245)): change `expect(declarations.lineHeight).toBe('30px');` to `expect(declarations.lineHeight).toBeUndefined();` and add `expect(_ruleCacheHas('.Text.lh30px')).toBe(true);`. Rename the test to `'a constructor-time numeric lineHeight is honoured by the getter and a shared value-class rule, not #id'`.

   - **`'a pre-render setLineHeight call is honoured at render, tracking the exact px value'`** ([:273-297](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L273-L297)): for both `cellText1`/`decl1` (18px) and `cellText2`/`decl2` (24px), change `expect(decl{1,2}.lineHeight).toBe('{18,24}px');` to `expect(decl{1,2}.lineHeight).toBeUndefined();` and add `expect(_ruleCacheHas('.Text.lh18px')).toBe(true);` / `expect(_ruleCacheHas('.Text.lh24px')).toBe(true);` respectively. Leave both tests' existing `for (const key of SKIPPABLE_FONT_KEYS) { if (key === 'lineHeight') continue; ... }` loops untouched — they already exclude `lineHeight` and check the other ten keys, unaffected by this plan. Rename to `'a pre-render setLineHeight call is honoured via a shared value-class rule, tracking the exact px value'`.

   - **`'a second applyStyle pass on the same instance re-derives lineHeight, leaving the other eleven still absent'`** ([:311-330](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L311-L330)): this test's original premise (a second `applyStyle()` pass must re-derive a changed `lineHeight`) no longer holds — numeric-pixel mode is no longer re-derived by `applyStyle()` at all (see `## Architecture Decisions`). Replace its body, using `40`/`46` instead of the original `18`/`24` so this test's shared value-class rules are its own and its assertions don't depend on whether the previous bullet's test already warmed `.Text.lh18px`/`.Text.lh24px`: after `setLineHeight(40)` + render (assert `decl1.lineHeight` is `toBeUndefined()`, `_ruleCacheHas('.Text.lh40px')` is `true`, and — preserving the original test's regression guard — the existing `for (const key of SKIPPABLE_FONT_KEYS) { if (key === 'lineHeight') continue; expect(decl1[key]).toBeUndefined(); }` loop still passes), call `cellText.setLineHeight(46)` and assert the `apply` write toggling `_lineHeightValueClass` occurred — `sink.writes.find((w: any) => w.op === 'apply' && (w.args[1] as { addClass?: unknown }).addClass)`'s `addClass` array contains `'lh46px'` and its `removeClass` array contains `'lh40px'`, following `Checkbox.stateClassHoisting.test.ts`'s `toggleWrite`-lookup idiom ([tests/component/input/Checkbox.stateClassHoisting.test.ts:187-192](packages/lib/tests/component/input/Checkbox.stateClassHoisting.test.ts#L187-L192)) adapted to `addClass`/`removeClass` instead of `toggleClass`. Then call `cellText.applyStyle(cellText.getElement()!)` directly (the original test's second-pass stress case) and assert `declarationsDuring`'s captured `lineHeight` for that pass is `toBeUndefined()`, again keeping the ten-other-keys loop — proving a later `applyStyle()` re-run does not reintroduce a stale `#id` declaration now that `lineHeight` is render-phase-skipped in numeric mode. Rename to `'setLineHeight changing value mid-lifetime swaps the value-class token; a later applyStyle pass does not reintroduce a stale #id declaration'`.

   **The three tests that loop over `SKIPPABLE_FONT_KEYS` on an already-materialised `#id` rule:**

   - **`'a fresh Text with no font/text setter called writes none of the eleven skippable declarations to its own #id rule'`** ([:126-135](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L126-L135)): `#id` materialises here because `textOverflow` always writes for real (the documented `setTruncate` exception, unaffected by this plan). Change the loop to skip `lineHeight` and add an explicit check for it:
     ```typescript
     for (const key of SKIPPABLE_FONT_KEYS) {
         if (key === 'lineHeight') continue;
         expect(declarations[key]).toBeUndefined();
     }
     expect(declarations.lineHeight).toBeNull();
     ```
     Rename to `'a fresh Text with no font/text setter called writes none of the ten skippable declarations to its own #id rule (lineHeight queues an explicit removal)'`.

   - **`"Legend's #id rule is not empty even though the eleven skippable font declarations are all skipped"`** ([:257-271](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L257-L271)): `#id` materialises because `Legend`'s own `applyStyle` override always re-asserts `marginLeft`. Same fix as above — skip `lineHeight` in the loop, assert `expect(declarations.lineHeight).toBeNull();` separately. Rename to `"Legend's #id rule is not empty even though the ten skippable font declarations are all skipped (lineHeight queues an explicit removal)"`.

   - **`'a custom fontSize CSS var diverges from the class default and keeps writing to #id'`** ([:332-344](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L332-L344)): `#id` materialises because the custom `fontSize` genuinely deviates. The existing loop already skips `fontSize`; also skip `lineHeight` and assert it separately:
     ```typescript
     for (const key of SKIPPABLE_FONT_KEYS) {
         if (key === 'fontSize' || key === 'lineHeight') continue;
         expect(declarations[key]).toBeUndefined();
     }
     expect(declarations.lineHeight).toBeNull();
     ```
     No rename needed — the test's name doesn't claim anything about `lineHeight` specifically.

   *Check:* `npx vitest run tests/component/input/TextClassStyleHoisting.test.ts` — all green, including the six updated cases and every untouched case in the file.

8. **Run the full suite and sweep for any other pre-existing test pinned to the old behaviour.** `npx vitest run --no-file-parallelism` from `packages/lib`. `grep -rln "setLineHeight\|centerInHeight" packages/lib/tests` (listed in `## Critical Files`) is the starting point — `TextThemeReflow.test.ts` calls `getLineHeight()` only (unaffected: this plan never changes that getter) but is worth a quick read to confirm.

9. **Add the changelog entry.** See `## Documentation Impact`.

10. **Full verification.** See `## Verification`.

11. **Verify live in a browser.** Non-negotiable — see `## Verification`. Every plan in the state-tier mechanism's lineage has shipped at least one regression the offline suite missed, and this plan is the first caller to use that mechanism with a *dynamic* suffix.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-7 are unit-testable against the recording DOM sink, in the new `TextLineHeightValueClassSharing.test.ts`. Rows 8-9 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | Two separate, already-rendered `SelectableText` instances both call `setLineHeight(18)` | Neither writes a `lineHeight` declaration to its own `#id` rule; both elements carry DOM class `lh18px`; `_ruleCacheHas('.SelectableText.lh18px')` is `true` |
| 2 | A rendered `SelectableText` calls `setLineHeight(18)` then `setLineHeight(24)` | The element's `lh18px` class is removed and `lh24px` added (one `apply` write with both `removeClass: ['lh18px']` and `addClass: ['lh24px']`); the instance's own `#id` rule carries no `lineHeight` declaration at either point; `_ruleCacheHas('.SelectableText.lh24px')` is `true` |
| 3 | A rendered `SelectableText` calls `setLineHeight(18)` then `setLineHeight('--my-var')` (switch to CSS-var mode) | The `lh18px` class is removed (`removeClass: ['lh18px']`, no `addClass`); `#id`'s rule carries a real `lineHeight: var(--my-var, calc(1em + var(--ts-ui-line-padding, 2px)))` declaration (does not match the class-tier default, so it is a genuine per-instance write, unchanged from today) |
| 4 | A rendered `Text` calls `centerInHeight(28)` then `centerInHeight(null)` | First call behaves like row 1 (`lh28px` class, shared rule, no `#id` write); the revert call removes `lh28px` and writes `lineHeight` via `setReconciledCSSRules` — since the reverted value exactly matches the class-tier `ADDITIVE_LINE_HEIGHT_RULE` default, this queues a **removal**. `#id` already materialises regardless of this plan (the always-written `textOverflow` declaration forces it, confirmed by the existing, unmodified `'a fresh Text still writes textOverflow to #id'` test), so `declarationsDuring`'s captured write shows `lineHeight: null`, not an absent key — see row 5 |
| 5 | A fresh `new Text('x')`, never touching `lineHeight`, rendered | `.Text`'s (or the concrete subclass's) class rule carries `line-height: calc(1em + var(--ts-ui-line-padding, 2px))`. `#id` already materialises regardless (the always-written `textOverflow` declaration forces it), so `declarationsDuring`'s captured write shows `lineHeight: null` — an explicit removal via `reconcileRuleDeclaration`, not a real value — rather than omitting the key entirely; the rendered CSS still carries no `line-height` property on `#id`, so the visual output is unaffected by this plan (see the `TextClassStyleHoisting.test.ts` updates in `## Ordered Implementation Steps`, step 7, for the exact assertion shape) |
| 6 | `setLineHeight(22)` called on a `Text` instance *before* it is ever mounted (`getElement()` returns nothing yet), then `getElement(true)` | No `apply` write happens before mount (nothing to add a class to yet); the newly-created element carries DOM class `lh22px` once rendered (via the new `render()` override) |
| 7 | Two different concrete Text-family classes (e.g. `SelectableText` and `Label`) each independently resolve `setLineHeight(22)` | Two independent rules, `.SelectableText.lh22px` and `.Label.lh22px` — no cross-class sharing, keyed by concrete constructor exactly like every other state-tier rule |
| 8 | Manual — live app: open `#/misc`, "Show window with table (slow)!" and "Show window with wide table (45 columns)!", then `#/style-audit` | The large `SelectableText` duplicate-body rows for `line-height` are gone or greatly reduced; every cell's text is still vertically centred, no visual change |
| 9 | Manual — live app: `#/inputs` (`PaginationBar`, `AbstractCalendarDropdown`), a `Dialog`/`Notification` (`centerInHeight`-driven title text), a tree/list view (`IconLabel`, list renderers) | Every line-height-dependent layout renders identically to before this plan; no console errors |

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
grep -n 'this.setElementCSSRule("lineHeight"' packages/lib/src/typescript/lib/component/input/Text.ts   # zero matches
grep -n 'this.writeFontDeclaration("lineHeight"' packages/lib/src/typescript/lib/component/input/Text.ts # zero matches
```

**Manual browser verification (rows 8-9) is required.** The offline harness records writes; it does not run a CSS cascade, and the Style Audit panel's byte counts can only be confirmed live. Start a dev server on a spare port from *this worktree*, not the user's existing one. Open the Misc tab's "Show window with table (slow)!" and "Show window with wide table (45 columns)!" first (per this finding's own discovery path), then `#/style-audit`; separately exercise `#/inputs`, a `Dialog`/`Notification`, and a tree/list view, reading computed styles rather than relying on screenshots.

---

## Documentation Impact

No exported symbol changes — `setLineHeight`, `centerInHeight`, and `getLineHeight` keep their existing public signatures; every new member is `private` or a `protected` override of an existing `Component` hook. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`:

> **`Text`'s numeric-pixel `setLineHeight`/`centerInHeight` (used by table cell renderers, tree/list rows, and other row-height-synced text) now shares one CSS rule across every instance that resolves the same pixel value, instead of each instance writing its own.** The CSS-variable and theme-revert forms of `setLineHeight`/`centerInHeight` now also dedupe against the class-tier default the same way other hoisted properties do. No consumer action needed; nothing changes visually.

---

## Potential Challenges

- **A future `Text` subclass overriding `applyStyle()` without calling `super.applyStyle()`** would silently lose the CSS-var/theme-mode `lineHeight` reconcile — not a new risk this plan introduces (every other font declaration in the method has the identical dependency on `super.applyStyle()` being called), but worth noting since this plan touches that method.
- **A caller cycles a `Text` instance through many distinct pixel values over its lifetime** (unusual — `CellRenderer.doLayout`'s early-return guard already skips a same-value re-call) would accumulate one `_deferredStyleRules` entry per distinct value on that instance, via `createStyleRule`'s own per-suffix cache. Bounded in practice by how many distinct row heights an app actually uses; not a leak in any meaningful sense (mirrors the existing, unbounded-in-theory growth of `_deferredStyleRules` for `styleRules` option entries).
- **This plan is the first caller of `createStateStyleRule` with a dynamically-computed suffix rather than one of a small, fixed set.** Treat the mandatory browser verification as the primary defect-finding step, matching every other plan in this mechanism's lineage.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/Text.ts` | Every line this plan touches: field declarations (119-120), `getClassStyleDefaults` (1391, `font.lineHeight` — untouched, the comparison value this plan relies on), `setLineHeight` (1121), `centerInHeight` (1169), `writeFontDeclaration` (1414, untouched), `applyStyle` (1425) |
| `packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts` | `doLayout` (105) — the dominant real-world call site this plan optimizes, unchanged by this plan (it keeps calling `setLineHeight(h)` exactly as today) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStateRule` (289) — the mechanism this plan reuses, unchanged |
| `packages/lib/src/typescript/lib/core/Component.ts` | `createStateStyleRule` (1046), `createStyleRule` (1018), `setReconciledCSSRules` (4872), `reconcileRuleDeclaration` (4856) — all reused unchanged |
| `plans/implemented/checkbox-radio-delegate-state-style-defaults.md` | Direct precedent for the caller-owns-class-toggling division of responsibility (`CheckboxBox.applyState`) and the `render()` re-assert-for-pre-mount-writes pattern this plan copies |
| `plans/shared-instance-style-groups.md` | Drafted, not implemented; investigated and found not to fit — its Architecture Decisions' rejection of content-addressing for its *general*, multi-field case is why this plan's narrower, single-scalar case is safe to content-address via a value-derived suffix instead |
| `plans/class-hierarchy-cascade.md` | Drafted, not implemented; also edits `Text.ts` (a new static field near the top of the class) — read to confirm the non-overlapping-region reasoning this plan's `touches-shared` decision relies on |
| `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` | Six pre-existing tests this plan must update: three exercise `lineHeight` directly (constructor-time numeric, pre-render `setLineHeight`, second-`applyStyle`-pass), three loop over `SKIPPABLE_FONT_KEYS` on a `#id` rule that materialises for an unrelated reason and need `lineHeight` carved out of the loop — see step 7 |
| `packages/lib/tests/component/input/Checkbox.stateClassHoisting.test.ts` | `toggleWrite`-lookup idiom (187-192) this plan's updated third test adapts for `addClass`/`removeClass` |

---

## Non-Goals

- **`Glyph.setLineHeight()` / `ComboBox.setLineHeight()`.** Independent implementations (`Glyph extends Component`, not `Text`; `ComboBox` has its own unrelated field), found while investigating this finding but out of scope — noted in `component-borderradius-visibility-write-path-cleanup.md`'s Non-Goals too.
- **A general-purpose value-keyed shared-rule mechanism in `ClassStyleRules.ts`.** Investigated and rejected in favor of reusing `createStateStyleRule` directly — see `## Architecture Decisions`.
- **Changing `CellRenderer.doLayout()` or any other `setLineHeight`/`centerInHeight` call site.** Every caller keeps working exactly as today; this plan is entirely inside `Text.ts`.
- **`shared-instance-style-groups.md`.** Investigated and found not to fit this problem's shape (wrong tier, wrong lifecycle) — see `## Architecture Decisions`. Not implemented or depended on by this plan.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

- **`## Internal Structure`'s new `render()` override could not be added as written — `Text.ts` already has a `protected render()` override** (undocumented in the plan's Critical Files/Internal Structure), which sets the element's `textContent` via `DOM.sink.apply(element, { text: ... })` after calling `super.render()`. Adding a second `render()` method would be a duplicate-implementation compile error, and the plan's own reasoning for the override's placement ("`Label.render()` ... composes correctly through the existing chain: `Label.render()` → this new `Text.render()` → `Component.render()`") already presumed a single `Text.render()` in that chain — so the fix is a same-shape merge, not a design change: the value-class re-apply (`if (this._lineHeightValueClass) { DOM.sink.apply(element, { addClass: [this._lineHeightValueClass] }); }`) was added into the body of the existing `render()`, after the `textContent` write, rather than as a separate method. The resulting call chain (`Label.render()` → `Text.render()` → `Component.render()`) and the re-apply behaviour itself are exactly what the plan specified; only the placement (existing method body vs. a new method) differs.
- **An audit round found a regression `## Internal Structure`'s "after" block for `setLineHeight` (`:156-179`, "only the two write lines change") did not account for: entering numeric-pixel mode never reconciled a real `lineHeight` declaration a prior CSS-var/theme-mode write (or the `ensureClassStyleRule` name-collision opt-out's first-render write) could have left on `#id`.** `#id`'s `(1,0,0)` specificity always outranks the new shared `.ClassName.lh<value>` rule's `(0,2,0)`, so that stale declaration would silently keep winning the cascade over the new pixel value — reachable in-library via `Header.ts`'s `this._text.setLineHeight(this._options.lineHeight)` (typed `number | string`). The fix adds one line to `setLineHeight`'s numeric branch: `this.setReconciledCSSRules({ lineHeight: null })`, gated on `_lineHeightCSSRule !== null` *before* this call (i.e. only when the previous mode could have left a real `#id` declaration — CSS-var mode, or the initial default additive-rule state) so a same-mode numeric-to-numeric value change (the `CellRenderer.doLayout` hot path this plan exists to optimise) queues nothing extra. This changes the plan's own numeric-mode contract for a *first* transition into numeric mode: entering it now reconciles `#id`'s `lineHeight` to an explicit `null` removal rather than leaving the key untouched, so `## Expected Behaviour` rows 1, 2 and 4's "neither/never writes a `lineHeight` declaration to its own `#id` rule" is narrower than actual behaviour — the first numeric call after construction, after render with no prior `lineHeight` setter, or after `centerInHeight(null)` queues an explicit removal (`declarations.lineHeight` is `null`, not absent); a second numeric call while already in numeric mode queues nothing (matches the plan as written). Step 7's literal `expect(declarations.lineHeight).toBeUndefined();` assertions for the constructor-time, pre-render, and mid-lifetime numeric tests were updated to `toBeNull()` to match; a new regression test (CSS-var → numeric) was added to `TextLineHeightValueClassSharing.test.ts` pinning the fixed behaviour directly.
- **`## Verification`'s mandatory live-browser step (rows 8-9) was run**, from a dev server started in this worktree on a spare port, against the "Show window with table (slow)!" window and `#/style-audit`, plus `#/inputs`-equivalent demo buttons for `PaginationBar` (`Show window with paginated table!`), a `Dialog`, a tree view (`Show tree component (icon renderer)`), and `AbstractCalendarDropdown` (the date-field calendar toggle). Findings: every checked `SelectableText`/`Text` element carries the expected shared `lh<value>px` class with the correct computed `line-height` (e.g. 128 table-cell text elements resolved to just 4 distinct `.lh*` class rules); each such element's own `#id` rule declares no `line-height` at all (confirmed via `getComputedStyle`/stylesheet inspection, not just the recording sink); the Style Audit panel's large `SelectableText`/`Text`-attributed duplicate-body rows carrying a `line-height` declaration are gone from the top of its (wastedKB-sorted) list — the two Text-family rows that remain there (`{ white-space: nowrap; text-overflow: ellipsis; }` and `{ white-space: nowrap; text-overflow: ellipsis; text-align: right; }`) carry no `line-height` property; every exercised layout renders identically to before, with vertical centring intact; no console errors were observed in any of the above.
