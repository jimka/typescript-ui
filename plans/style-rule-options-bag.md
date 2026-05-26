# StyleRule Options Bag — Implementation Plan

## Overview

Every `StyleRule` is constructed and then poked imperatively. The 21 module-level shared rules ([`SortPriorityBadge.ts:32`](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L32), [`ResizeHandle.ts:33`](../src/typescript/lib/component/table/cell/ResizeHandle.ts#L33), [`AccordionIndicator.ts:31`](../src/typescript/lib/component/container/AccordionIndicator.ts#L31), the four `ComboBox` rules at [`ComboBox.ts:299-333`](../src/typescript/lib/component/input/ComboBox.ts#L299), the four `PickerColumn` rules at [`PickerColumn.ts:22-44`](../src/typescript/lib/component/input/PickerColumn.ts#L22), the five `AbstractCalendarDropdown` rules at [`AbstractCalendarDropdown.ts:81-115`](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L81), the six `AbstractCustomList` rules at [`AbstractCustomList.ts:93-134`](../src/typescript/lib/component/list/AbstractCustomList.ts#L93), the three `Glyph` animation rules at [`Glyph.ts:74-86`](../src/typescript/lib/component/display/Glyph.ts#L74), `Header`'s `HeaderCellGlyph` rule at [`Header.ts:48`](../src/typescript/lib/component/table/cell/Header.ts#L48)) all follow an identical three-line ritual: construct, `setMany({...})`, `ensure()`. The three per-id construction sites at [`AutoCompleteItem.ts:48`](../src/typescript/lib/component/input/AutoCompleteItem.ts#L48), [`MenuBarButton.ts:80`](../src/typescript/lib/component/menubar/MenuBarButton.ts#L80), and [`Header.ts:111`](../src/typescript/lib/component/table/cell/Header.ts#L111) follow the same shape with a single `set()` write.

This plan widens [`StyleRule`'s constructor at `StyleTarget.ts:251`](../src/typescript/lib/core/StyleTarget.ts#L251) to accept an optional `styles: Record<string, string | null>` field in its config bag, plus an optional `materialize: boolean` flag (defaulting to `true`) that auto-runs `ensure()` once the constructor returns. The ritual collapses to a single `new StyleRule({ scope, name, styles: { ... } })` call. The redesigned [`stylerule-constructor-redesign.md`](implemented/stylerule-constructor-redesign.md) plan introduced the scope-discriminated bag; this is its follow-on, finishing the same simplification arc by absorbing the rule body.

A second, narrower change collapses the **per-component** state-rule pattern. [Component](../src/typescript/lib/core/Component.ts#L155) gains a `styleRules?: ComponentStyleRuleSpec[]` field on [`ComponentOptions`](../src/typescript/lib/core/Component.ts#L80) (alongside `border`, `padding`, `attributes`, `components`). [`applyOptions` at `Component.ts:330`](../src/typescript/lib/core/Component.ts#L330) routes each entry through the existing `createStyleRule(suffix)` builder and dispatches its styles. This covers the three "I want a `:hover` rule on this component" call sites currently spelling `new StyleRule({ scope: "component", name: this.getId() + ":hover" })` by hand in [`AutoCompleteItem.ts:48`](../src/typescript/lib/component/input/AutoCompleteItem.ts#L48), [`MenuBarButton.ts:80`](../src/typescript/lib/component/menubar/MenuBarButton.ts#L80), and [`Header.ts:111`](../src/typescript/lib/component/table/cell/Header.ts#L111), and it offers a declarative path for the lazy-getter `:active`/`:hover`/`.selected` rules in [`Button.ts:99,108`](../src/typescript/lib/component/button/Button.ts#L99), [`ToggleButton.ts:33`](../src/typescript/lib/component/button/ToggleButton.ts#L33), [`WindowBorder.ts:67`](../src/typescript/lib/component/container/WindowBorder.ts#L67), [`AccordionIndicator.ts:82`](../src/typescript/lib/component/container/AccordionIndicator.ts#L82). The lazy getters in `Button` / `ToggleButton` / `WindowBorder` stay imperative because they mutate the rule from runtime setters (`setForegroundColor`, `setBorder`, the snap-target boxShadow flicker) — `applyOptions`-style declaration suits static state-rule bodies only.

---

## Architecture Decisions

### `StyleRule` stays a class — the options bag widens, the class shape is unchanged

`StyleRule` keeps its identity as a deferred-write buffer over `CSSStyleRule`; it is not turned into a plain config type. The reason: `set` / `setMany` / `queue` / `flush` / `ensure` remain the live mutation surface used after construction by [`Button.ts:336,406,…`](../src/typescript/lib/component/button/Button.ts#L336) (writes a per-id `:active` rule's `backgroundColor` from `setBackgroundColor`), [`AccordionIndicator.ts:83`](../src/typescript/lib/component/container/AccordionIndicator.ts#L83), [`WindowBorder.ts:85`](../src/typescript/lib/component/container/WindowBorder.ts#L85), and Component's own [`applyStyle` at `Component.ts:2781`](../src/typescript/lib/core/Component.ts#L2781) (the per-id `_styleRule` is written to every render). Stripping the class would force those call sites onto raw `CSSStyleRule.style.X = …` writes, re-opening the architectural seam [ARCHITECTURE.md "CSS writes go through `StyleRule` / `InlineStyle`"](../ARCHITECTURE.md#css-writes-go-through-stylerule--inlinestyle) closed.

The widened constructor is purely additive at the field level. The existing `{ scope, name }` shape continues to compile (the two new fields are optional). Everything inside `StyleRule` past the constructor — `set`, `setMany`, `queue`, `queueMany`, `ensure`, `flush`, `isMaterialized`, `ensureKeyframes` — is unchanged.

### `styles` field auto-flushes via `setMany` from the constructor body

```typescript
constructor(spec: StyleRuleSpec) {
    super();
    const selector = _selectorOf(spec);
    this._factory  = () => _getCSSRule(selector) ?? _createCSSRule(selector);

    if (spec.styles) {
        this.setMany(spec.styles);
    }
    if (spec.materialize !== false) {
        this.ensure();
    }
}
```

The two-step `setMany(...) + ensure()` ritual is now one step. `setMany` writes into `_dirty` because the target is still null at that point; `ensure()` then materialises the `CSSStyleRule` and the `materialize()` base call drains `_dirty` onto the live rule's `style`. Net DOM effect is byte-identical to the current `new StyleRule(...); setMany(...); ensure();` ordering, just expressed once.

`materialize: false` is the escape hatch for owners who deliberately defer `ensure()` (today there are zero such call sites — every shared rule currently calls `ensure()` immediately after `setMany`; component-scope rules call `ensure()` either immediately or via the deferred-style-rules render path in `applyStyle` for `createStyleRule`-allocated state rules). The flag exists so that **Component's two internal sites** — the per-id `_styleRule` at [`Component.ts:209`](../src/typescript/lib/core/Component.ts#L209) and `createStyleRule` at [`Component.ts:457`](../src/typescript/lib/core/Component.ts#L457) — can keep their construction-time-cheap, render-time-materialised contract intact. Those two sites pass `materialize: false` and rely on `applyStyle` to call `ensure()` later.

### `ComponentOptions.styleRules` declares per-component state rules

`ComponentOptions` gains `styleRules?: ComponentStyleRuleSpec[]`. Each entry is `{ suffix: string; styles: Record<string, string | null> }`. `applyOptions` iterates the array, calls the existing `createStyleRule(suffix)` builder to fetch (or allocate) the wrapper, and dispatches via `setMany`. The render-time materialisation already wired into [`applyStyle` at `Component.ts:2923`](../src/typescript/lib/core/Component.ts#L2923) (the loop that calls `ensure()` on every value of `_deferredStyleRules`) flushes them onto the stylesheet automatically — no separate `ensure()` call needed.

This is the cleanest fit because `createStyleRule` is *already* the dedupe-by-suffix builder Component owns; the new option just bridges from the bag to that builder. The two construction-time imperative call sites — `new StyleRule({ scope: "component", name: this.getId() + ":hover" })` in `AutoCompleteItem` / `MenuBarButton` and the parallel `:active` site in `Header` — convert directly: each becomes one entry in `super({ styleRules: [...] })` (or a post-super `applyOptions` write for files that need it).

The lazy getters in `Button` (`pressedStyleRule` / `hoverStyleRule`) and `ToggleButton` (`selectedStyleRule`) and `WindowBorder` (`snapTargetStyleRule`) and `AccordionIndicator` (the `.expanded` rule) **stay imperative**. Those rules are mutated *after* construction by runtime setters (`Button#setForegroundColor` writes `pressedStyleRule.set("color", v)`, `WindowBorder#setSnapTarget` toggles the `boxShadow` flicker, etc.), so the options bag is the wrong surface — the bag describes initial state, not a live mutation channel. The plan **does not** widen those into options entries.

### Existing imperative API is kept — no shim, no removal

The constructor's existing `{ scope, name }` shape is a strict subset of the new spec — adding two optional fields preserves source compatibility for every existing call site. `set`, `setMany`, `queue`, `queueMany`, `flush`, `ensure`, `isMaterialized`, `ensureKeyframes` all stay. The migration adopts the new ergonomic for every in-tree call site, but the imperative API itself is not deprecated.

Rationale: the imperative API is used *after* construction by Component's render pipeline and the lazy `:active`/`:hover` getters. Removing it would force those sites onto a separate mechanism for no gain. [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) favours clean breaks for **surface that no caller needs anymore**; here every imperative method has live, design-justified callers. The new options-bag fields are the *preferred* path for declarative construction; the imperative API remains for live mutation.

### Internal Component sites pass `materialize: false`

`Component`'s per-id `_styleRule` field initialiser at [`Component.ts:209`](../src/typescript/lib/core/Component.ts#L209) and the `createStyleRule` allocation at [`Component.ts:457`](../src/typescript/lib/core/Component.ts#L457) both intentionally defer `ensure()` to render time — the field initialiser fires during construction (before any element exists) and stylesheet insertion is delayed until `applyStyle` runs. Both convert to pass `materialize: false` so the new constructor does not auto-flush:

```typescript
private _styleRule: StyleRule = new StyleRule({
    scope:       "component",
    name:        this.getId(),
    materialize: false,
});
```

The render-time `_styleRule.ensure()` inside `applyStyle` (currently at the bottom of `applyStyle` via the `_deferredStyleRules` loop and the `ensureCSSRule()` call earlier) is unchanged.

### `styleRules` entries dispatched by `applyOptions` use `createStyleRule`, not bare `new StyleRule`

`createStyleRule(suffix)` already dedupes by selector suffix (the `_deferredStyleRules` map at [`Component.ts:455`](../src/typescript/lib/core/Component.ts#L455)) and registers the rule for render-time materialisation. The `applyOptions` dispatch goes through that same builder so the dedupe-and-defer machinery is preserved:

```typescript
if (opts.styleRules !== undefined) {
    for (const spec of opts.styleRules) {
        this.createStyleRule(spec.suffix).setMany(spec.styles);
    }
}
```

The bag never lets a caller bypass the builder. This matters because [`applyStyle` at `Component.ts:2923`](../src/typescript/lib/core/Component.ts#L2923) is the single render-time materialisation point — a bag entry that allocated through bare `new StyleRule(...)` would skip the `_deferredStyleRules` registration and flush at construction-time, which would force-insert the stylesheet rule before the element exists. (No harm in itself, but it violates the "construction stays JS-only" rule from [ARCHITECTURE.md "Defer DOM work to render time"](../ARCHITECTURE.md#defer-dom-work-to-render-time).)

---

## Public API (TypeScript Signatures)

### `StyleRuleSpec` — widened constructor config

```typescript
// src/typescript/lib/core/StyleTarget.ts

/**
 * Scope discriminator for the StyleRule constructor.
 *
 * - `class`     → ".Name"   (leading "." prepended)
 * - `component` → "#name"   (leading "#" prepended)
 * - `selector`  →  verbatim selector text
 */
export type StyleRuleScope =
    | { scope: "class";     name: string }
    | { scope: "component"; name: string }
    | { scope: "selector";  name: string };

/**
 * Construction config for a StyleRule. Combines a {@link StyleRuleScope}
 * (selector shape) with optional initial CSS body and an optional
 * defer-flush flag.
 *
 * - `styles`      → applied via setMany at construction time. Omit for
 *                   imperative builders that write later via `set`.
 * - `materialize` → defaults to true. Set to false to skip the auto
 *                   `ensure()` call (used by Component's internal
 *                   deferred-style rules).
 */
export type StyleRuleSpec = StyleRuleScope & {
    styles?:      Record<string, string | null>;
    materialize?: boolean;
};
```

### `StyleRule` — widened constructor only

```typescript
class StyleRule extends StyleTarget<CSSStyleRule> {
    constructor(spec: StyleRuleSpec);

    // Unchanged: set, setMany, queue, queueMany, flush, ensure, isMaterialized,
    // and the static ensureKeyframes.
}
```

The class members past the constructor are *not* touched. Existing inherited surface (`set`, `setMany`, `queue`, `queueMany`, `flush`, `ensure`, `isMaterialized` from `StyleTarget`; plus `ensureKeyframes` static on `StyleRule`) keeps its current signatures byte-for-byte.

### `ComponentStyleRuleSpec` — declarative per-component state rule

```typescript
// src/typescript/lib/core/Component.ts

/**
 * Declarative spec for a per-component state rule. Each entry creates (or
 * fetches) a StyleRule whose selector is `#<id><suffix>` (e.g. `#cmp-12:hover`,
 * `#cmp-12.selected`) and applies the given style body.
 *
 * `suffix` must be unique per component — it is the dedupe key inside the
 * Component's `_deferredStyleRules` map.
 */
export interface ComponentStyleRuleSpec {
    suffix: string;
    styles: Record<string, string | null>;
}
```

### `ComponentOptions` — adds `styleRules`

```typescript
export interface ComponentOptions {
    // ... existing fields ...
    styleRules?: ComponentStyleRuleSpec[];
}
```

The field is dispatched by `applyOptions` near the other "structural" forwarders (`attributes`, `components`):

```typescript
protected applyOptions(options: TOptions): this {
    // ... existing dispatches ...

    if (opts.styleRules !== undefined) {
        for (const spec of opts.styleRules) {
            this.createStyleRule(spec.suffix).setMany(spec.styles);
        }
    }

    if (opts.components !== undefined) this.addComponents(opts.components);

    return this;
}
```

No `_styleRules` backing field on `Component` — `_deferredStyleRules` (the existing map at [`Component.ts:218`](../src/typescript/lib/core/Component.ts#L218)) is already the cache, and `createStyleRule` is already the typed setter into it. The options-bag entry is *not* round-tripped onto `_options.styleRules` because the rule wrapper is the canonical cache; storing the spec separately would create a stale-copy hazard. (Compare [`opts.attributes`](../src/typescript/lib/core/Component.ts#L360), which *is* stashed on `_options.attributes` because `init()` needs to replay it after element creation. State rules have no equivalent replay — `_deferredStyleRules` lives across the element lifecycle.)

---

## Internal Structure

### Canonical migration of a module-level class rule

```typescript
// Before (SortPriorityBadge.ts:32-44):
function ensureSortBadgeClassRule(): void {
    if (_classRule) return;

    const rule = new StyleRule({ scope: "class", name: "SortPriorityBadge" });
    rule.setMany({
        position:      "absolute",
        top:           "2px",
        right:         "8px",
        fontSize:      "var(--ts-ui-sort-badge-font-size,10px)",
        lineHeight:    "1",
        borderRadius:  "3px",
        padding:       "1px 3px",
        pointerEvents: "none",
    });
    rule.ensure();

    _classRule = rule;
}

// After:
function ensureSortBadgeClassRule(): void {
    if (_classRule) return;

    _classRule = new StyleRule({
        scope:  "class",
        name:   "SortPriorityBadge",
        styles: {
            position:      "absolute",
            top:           "2px",
            right:         "8px",
            fontSize:      "var(--ts-ui-sort-badge-font-size,10px)",
            lineHeight:    "1",
            borderRadius:  "3px",
            padding:       "1px 3px",
            pointerEvents: "none",
        },
    });
}
```

Net: lose three lines (the local `const rule`, the `setMany(...)` block boundary, and `rule.ensure()`), gain one comma. The IIFE/`ensureXClassRule()` guard remains — it serves to keep the work module-local and hot-reload-idempotent, not to gate `ensure()`.

### Canonical migration of a per-id state rule via the options bag

```typescript
// Before (MenuBarButton.ts:80-83):
constructor(text: string, onClick: () => void, onHover: () => void, options?: MenuBarButtonOptions) {
    super(options, _defaultMenuBarButtonOptions);

    // ...
    this._hoverRule = new StyleRule({ scope: "component", name: this.getId() + ":hover" });
    this._hoverRule.set("backgroundColor",
        "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))");
    this._hoverRule.ensure();
    // ...
}

// After: the rule is declared as an option on the super() call. The private
// _hoverRule field disappears entirely — nothing else in MenuBarButton reads
// it, so the only reason it existed was to dodge the construct-then-mutate
// dance.
constructor(text: string, onClick: () => void, onHover: () => void, options?: MenuBarButtonOptions) {
    super({
        ...options,
        styleRules: [
            ...(options?.styleRules ?? []),
            {
                suffix: ":hover",
                styles: {
                    backgroundColor: "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))",
                },
            },
        ],
    }, _defaultMenuBarButtonOptions);

    // ...
}
```

Same pattern for [`AutoCompleteItem.ts:48-51`](../src/typescript/lib/component/input/AutoCompleteItem.ts#L48) (the `_hoverCSSRule` field collapses to a bag entry; the field declaration at line 32 is deleted) and [`Header.ts:111-114`](../src/typescript/lib/component/table/cell/Header.ts#L111) (the local `activeRule` const collapses to a bag entry).

### Component's two internal sites — `materialize: false`

```typescript
// Component.ts:209 (private field initialiser):
private _styleRule: StyleRule = new StyleRule({
    scope:       "component",
    name:        this.getId(),
    materialize: false,
});

// Component.ts:457 (createStyleRule body):
protected createStyleRule(selectorSuffix: string): StyleRule {
    let rule = this._deferredStyleRules.get(selectorSuffix);
    if (!rule) {
        rule = new StyleRule({
            scope:       "component",
            name:        this.getId() + selectorSuffix,
            materialize: false,
        });
        this._deferredStyleRules.set(selectorSuffix, rule);
    }

    return rule;
}
```

No `styles` field on either of these — they're allocated empty and written through later by Component's render pipeline (`applyStyle` writes into `_styleRule`; subclass setters write into the deferred rules through the lazy getter).

---

## Ordered Implementation Steps

Each step ends with a verification gate.

1. **Edit `src/typescript/lib/core/StyleTarget.ts`** — introduce the `StyleRuleSpec` type (intersection of `StyleRuleScope` and `{ styles?, materialize? }`). Widen the `StyleRule` constructor parameter type from `StyleRuleScope` to `StyleRuleSpec`. Inside the constructor, after the existing `_factory` assignment, add `if (spec.styles) this.setMany(spec.styles);` then `if (spec.materialize !== false) this.ensure();`. Update the constructor JSDoc to document both new fields. **Verify:** `npx tsc --noEmit` succeeds — every existing call site still compiles because `StyleRuleScope` is a strict subset of `StyleRuleSpec`.

2. **Edit `src/typescript/lib/core/Component.ts`** — convert the two internal `new StyleRule(...)` sites at lines 209 (`_styleRule` initialiser) and 457 (`createStyleRule` body) to pass `materialize: false`. **Verify:** `npx tsc --noEmit` → 0 errors. Run the framework dev app (`npm run dev` → `http://localhost:8015`) and confirm any one component renders with its `#id { ... }` rule applied to the live element (e.g. a button shows its background).

3. **Edit `src/typescript/lib/core/Component.ts`** — add the `ComponentStyleRuleSpec` interface declaration (above `ComponentOptions`). Add `styleRules?: ComponentStyleRuleSpec[]` to `ComponentOptions`. In `applyOptions`, add the dispatch block right before the existing `if (opts.components !== undefined)` (so structural-style options stay grouped near the end). **Verify:** `npx tsc --noEmit` → 0 errors. Write a one-line smoke test inline (a temporary `<button>`-styled component with `{ styleRules: [{ suffix: ":hover", styles: { backgroundColor: "red" } }] }`) and confirm the rule materialises in DevTools.

4. **Migrate every module-level shared rule to `styles` in the constructor**. Each file follows the same mechanical pattern from `## Internal Structure` above. The full list (count: 24 rule entries across 12 files — verified via `grep -rn "new StyleRule" src/typescript/`):
   - `src/typescript/lib/component/table/cell/SortPriorityBadge.ts:32` (1 rule)
   - `src/typescript/lib/component/table/cell/ResizeHandle.ts:33` (1 rule)
   - `src/typescript/lib/component/table/cell/Header.ts:48` (1 rule — `HeaderCellGlyph`)
   - `src/typescript/lib/component/container/AccordionIndicator.ts:31` (1 rule)
   - `src/typescript/lib/component/display/Glyph.ts:74,79,84` (3 rules)
   - `src/typescript/lib/component/input/ComboBox.ts:299,306,316,333` (4 rules)
   - `src/typescript/lib/component/input/PickerColumn.ts:22,30,34,44` (4 rules)
   - `src/typescript/lib/component/input/AbstractCalendarDropdown.ts:81,85,94,105,112` (5 rules)
   - `src/typescript/lib/component/list/AbstractCustomList.ts:93,100,104,120,125,132` (6 rules)

   For each: replace `const rule = new StyleRule({ scope, name }); rule.setMany({...}); rule.ensure();` with `const rule = new StyleRule({ scope, name, styles: {...} });` (or fold straight into `_classRule =` where the local `const` was just a temporary). The `setMany` body becomes the `styles:` object verbatim. The `ensure()` call is removed (auto-flushed by the constructor).

   **Verify per file:** `grep -nE "setMany|\.ensure\(\)" <file>` → 0 matches for the migrated rules (`setMany` may still appear in unrelated code; the count drops by the number of migrated rules in that file). Smoke-test the affected components in the dev app (see step 9 for the full smoke list).

5. **Migrate the three per-id construction-time rules onto `styleRules`**:
   - `src/typescript/lib/component/input/AutoCompleteItem.ts:48-51` — delete the `_hoverCSSRule` field declaration (line 32) and the construction-time `new StyleRule(...) + set + ensure` triplet at lines 48-51. Replace with a `styleRules: [{ suffix: ":hover", styles: {...} }]` entry forwarded into the existing `super()` call (currently `super();` at line 43 — change to `super({ styleRules: [...] });`).
   - `src/typescript/lib/component/menubar/MenuBarButton.ts:80-83` — delete the `_hoverRule` field declaration (line 59) and the construction-time rule at lines 80-83. Replace with a `styleRules:` entry forwarded into the existing `super(options, _defaultMenuBarButtonOptions)` call (line 74). Merge with any caller-provided `options.styleRules` per the canonical migration pattern above.
   - `src/typescript/lib/component/table/cell/Header.ts:111-114` — replace the local `activeRule` const block with a `styleRules:` entry on the `super("th")` call (line 97). The `super("th")` is `super({ tag: "th" })` after forwarding through the upstream class — confirm by reading the parent class signature and use the right call shape.

   **Verify per file:** `grep -n "new StyleRule" <file>` → 0 matches. Smoke-test: `AutoCompleteField` dropdown items highlight on hover; `MenuBarButton` highlights on hover; table header cells show the `:active` pressed shadow on click.

6. **Typecheck the full tree**: `npx tsc --noEmit` → 0 errors.

7. **`npm run docs:build`** → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

8. **Run the existing test suite**: `npm test` → all green.

9. **Smoke verification** at `http://localhost:8015`:
   - **Module-level class rules (step 4):** `MiscPanel` slow table (resize handles, sort badges, header glyph), `Accordion` chevron expand/collapse, `ComboBox` row hover + label/caret layout, `PickerColumn` cells (open a `TimeField` dropdown), `AbstractCalendarDropdown` day grid + nav buttons (open a `DateField` dropdown), `AbstractCustomList` row hover/selected/focused (a `List` or `MultiSelectList` instance), `Glyph` spin/pulse/beat animations.
   - **Per-id state rules (step 5):** `AutoCompleteField` items highlight on hover, `MenuBar` buttons highlight on hover, table header cells show the pressed shadow on click.
   - **Component internals (step 2):** every component still renders with its `#id { ... }` rule applied — implicit, since `_styleRule.ensure()` runs from `applyStyle` exactly as before.

10. **Final grep gate**: `grep -rnE 'new StyleRule\b.*\)\s*;\s*$' src/typescript/ | wc -l` — count drops to the two Component internal sites (lines 209 and 457) plus any imperative builders that the plan deliberately did *not* migrate (`Button` / `ToggleButton` / `WindowBorder` / `AccordionIndicator`'s lazy `:active`/`:hover`/`.selected`/`.expanded` getters which use `createStyleRule`, **not** `new StyleRule` directly — so they don't appear in the grep). Read the remaining hits and confirm each is either an internal Component site or has a documented imperative-mutation reason.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `src/typescript/lib/core/StyleTarget.ts` — new `StyleRuleSpec` type, widened constructor |
| Modify | `src/typescript/lib/core/Component.ts` — `ComponentStyleRuleSpec` interface, `ComponentOptions.styleRules` field, `applyOptions` dispatch, two internal `materialize: false` sites |
| Modify | `src/typescript/lib/core/index.ts` — re-export `StyleRuleSpec` (and verify `StyleRuleScope` is still exported) and `ComponentStyleRuleSpec` |
| Modify | `src/typescript/lib/component/table/cell/SortPriorityBadge.ts` |
| Modify | `src/typescript/lib/component/table/cell/ResizeHandle.ts` |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` — `HeaderCellGlyph` class rule + the `:active` per-id rule via `styleRules` |
| Modify | `src/typescript/lib/component/container/AccordionIndicator.ts` |
| Modify | `src/typescript/lib/component/display/Glyph.ts` — 3 class rules |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` — 4 rules |
| Modify | `src/typescript/lib/component/input/PickerColumn.ts` — 4 rules |
| Modify | `src/typescript/lib/component/input/AbstractCalendarDropdown.ts` — 5 rules |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` — 6 rules |
| Modify | `src/typescript/lib/component/input/AutoCompleteItem.ts` — `_hoverCSSRule` field deleted; `:hover` migrates to `styleRules` |
| Modify | `src/typescript/lib/component/menubar/MenuBarButton.ts` — `_hoverRule` field deleted; `:hover` migrates to `styleRules` |

14 modifies, 0 creates, 0 deletes.

---

## Verification

- `npx tsc --noEmit` → **0 errors**.
- `npm test` → all green.
- `grep -rnE "\.setMany\(\{" src/typescript/lib/component/ src/typescript/lib/core/Component.ts | grep -v "_border.toStyle\|InlineStyle\|_styleRule\." | wc -l` → 0 (every `setMany({...})` against a freshly-constructed `StyleRule` is folded into the constructor; the remaining hits are `Border.toStyle()` flushes onto `_styleRule` inside Component's `applyStyle` and unrelated InlineStyle uses).
- `grep -rnE "new StyleRule\b.*\}\s*\)\s*;\s*$" src/typescript/lib/component/` → 0 module-level construction sites with no `styles` field (every shared rule should now be a constructor-fold; check by eye that anything matching has `styles:` on a prior line in the same call).
- `npm run docs:build` → 0 errors, 0 link warnings.
- Manual smoke per step 9 in light and dark themes.

---

## Documentation Impact

- **`core` barrel** ([src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) lines 37-38): re-export `StyleRuleSpec` alongside the existing `StyleRuleScope`. Re-export `ComponentStyleRuleSpec` alongside `ComponentOptions` (verify the existing export shape and match it).
- **TypeDoc bundle (`docs/api/core/`)**: the regenerated build picks up `StyleRuleSpec` and `ComponentStyleRuleSpec` automatically. Confirm both land under `docs/api/core/type-aliases/` (or `interfaces/` for `ComponentStyleRuleSpec`) after `docs:build`.
- **Curated `docs/core/StyleRule.md`** (verify file exists): if a curated page exists, add a short "Construction with inline styles" snippet showing the new constructor shape. If no curated page exists, skip — the API page is auto-generated.
- **Curated `docs/core/Component.md`** (verify): the new `styleRules` option deserves a one-paragraph mention in the curated page's `## Options` section if such a section exists. Otherwise no curated edit.
- **Recipes**: not required — the new shape is a constructor convenience, not a new pattern. `docs/recipes/*` updates are not in scope unless a new recipe is genuinely worth a page.
- **Cross-bucket JSDoc links**: `StyleRule` and `Component` are both in the `core` bucket, so existing `{@link StyleRule}` references stay valid. No cross-bucket renames.

---

## Potential Challenges

- **`setMany` writes into `_dirty` only when `_target` is null** ([`StyleTarget.ts:30-36`](../src/typescript/lib/core/StyleTarget.ts#L30)). Inside the new constructor, `setMany` runs *before* `ensure()`, so `_target` is still null — `setMany` queues into `_dirty`. Then `ensure()` runs `materialize` which flushes `_dirty` onto the live rule. Net behaviour matches the current `setMany(...) + ensure()` ordering. **Mitigation:** none needed — this is the same code path the current call sites use, just expressed once.
- **Auto-`ensure()` vs construction-time DOM work**. The framework's "construction stays JS-only" rule ([ARCHITECTURE.md "Defer DOM work to render time"](../ARCHITECTURE.md#defer-dom-work-to-render-time)) means `ensure()` from a constructor *would* violate the rule for any per-component construction. **Mitigation:** the `materialize: false` flag preserves the existing deferral for the two Component internal sites, which are the only places where `new StyleRule` runs from a component constructor. Module-level shared rules (which auto-ensure under the new default) already call `ensure()` at module load today — no behaviour change.
- **`AutoCompleteItem` / `MenuBarButton` super-call shape**. Both currently call `super()` (no options) and then construct their per-id `:hover` rule. The migration changes the `super()` call to `super({ styleRules: [...] })`. That changes the ComponentOptions cascade — verify by reading the parent class's `applyOptions` to confirm `styleRules` doesn't collide with any pre-existing field in those subclasses.
- **`Header.ts:97` super call**. `Header` extends a renderer-host class; its `super("th")` form may need to become `super({ tag: "th", styleRules: [...] })` instead. Read the parent's constructor signature carefully — if it accepts only `(tag: string)`, the per-id rule has to stay imperative (just folded into the new `styles` constructor field). **Mitigation:** if the super-call can't carry the bag, leave the `:active` rule as a per-id `new StyleRule({ scope: "component", name: this.getId() + ":active", styles: {...} })` call (just the constructor-fold half of the simplification, no `styleRules` bag).
- **Order of `styleRules` dispatch in `applyOptions`**. Subclass overrides call `super.applyOptions(options)` first, then dispatch their own setters. If a subclass setter mutates a rule that `super.applyOptions` allocated via `styleRules`, the subclass setter sees the wrapper from `_deferredStyleRules` (because `createStyleRule` dedupes by suffix). **No mitigation needed** — the dedupe map *is* the contract, but a reviewer should confirm none of the migrated subclasses (`AutoCompleteItem`, `MenuBarButton`, `Header`) write to the same suffix from a setter.
- **Caller-merged `styleRules`**. When a subclass wants to add a rule on top of a caller-provided `options.styleRules`, the merge has to be spelled out (`styleRules: [...(options?.styleRules ?? []), { ... }]`). This is mildly ceremonial but matches the existing pattern for other array fields (`components`). Document the merge idiom in the JSDoc on `ComponentOptions.styleRules`.

---

## Critical Files

- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — destination of the constructor widening. Read the constructor body, the inherited `setMany` / `materialize` flow, and the `_dirty`-bag mechanics before editing.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `_styleRule` field initialiser (line 209), `createStyleRule` builder (line 454-462), `_deferredStyleRules` map (line 218, init at 264, materialised at 2923), `applyOptions` (line 330-380), `ComponentOptions` (line 80-103).
- [plans/implemented/stylerule-constructor-redesign.md](implemented/stylerule-constructor-redesign.md) — the predecessor that introduced the discriminated `StyleRuleScope`. This plan extends the same line of reasoning to the rule body.
- [ARCHITECTURE.md "CSS writes go through `StyleRule` / `InlineStyle`"](../ARCHITECTURE.md#css-writes-go-through-stylerule--inlinestyle) and [ARCHITECTURE.md "Defer DOM work to render time"](../ARCHITECTURE.md#defer-dom-work-to-render-time) — the two architectural rules this plan respects (no raw `CSSStyleRule.style.X` writes; construction stays JS-only via `materialize: false`).
- [src/typescript/lib/component/table/cell/SortPriorityBadge.ts](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts), [ResizeHandle.ts](../src/typescript/lib/component/table/cell/ResizeHandle.ts), [AccordionIndicator.ts](../src/typescript/lib/component/container/AccordionIndicator.ts) — the canonical module-level class-rule patterns. Read one before doing the batch migration in step 4.
- [src/typescript/lib/component/input/AutoCompleteItem.ts](../src/typescript/lib/component/input/AutoCompleteItem.ts), [MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts), [Header.ts](../src/typescript/lib/component/table/cell/Header.ts) — the three per-id construction-time sites migrating onto `styleRules`. Read each before step 5 to confirm super-call shapes.

---

## Non-Goals

- **Touching `InlineStyle`'s API**. `InlineStyle` already accepts inline writes via `setMany` and attaches to an element via `attach`. No widening needed — its construction pattern is already declarative (the only caller, `Theme.ts`, writes three lines).
- **Migrating the lazy-getter state rules in `Button`, `ToggleButton`, `WindowBorder`, `AccordionIndicator` to `styleRules`**. Those rules are mutated by runtime setters (`setForegroundColor`, `setBorder`, `setSnapTarget`), so a static options-bag declaration is the wrong surface. The lazy getter pattern stays. If a future plan finds a way to declaratively describe runtime-mutated rules, that's a separate change.
- **Removing the imperative `set` / `setMany` / `queue` / `ensure` API on `StyleRule`**. Those methods have live, design-justified callers (Component's `applyStyle`, the lazy getters, `Theme`'s root-element inline writes). The new options-bag fields are *additive*.
- **Adding a `styleRules` bag to module-level shared rules**. Module-level rules are not per-component, so they don't belong on `ComponentOptions`. The constructor's `styles` field is their declarative surface; that's sufficient.
- **Renaming `StyleRule`, `StyleRuleScope`, or the existing inherited `set` / `setMany`**. Out of scope. Only the constructor surface widens.
- **Adding a `keyframes` arm to `StyleRuleScope`**. `StyleRule.ensureKeyframes` is already a static; no consumer asked for a scope arm.
- **Auto-materialising the per-component `_styleRule` from the constructor**. Component's two internal sites pass `materialize: false` for the same architectural reason ("construction stays JS-only") that motivated the existing deferral. Auto-materialising would force-insert the stylesheet rule before the element exists.
