# Table Cell Class-Style Defaults — Implementation Plan

## Overview

[`Cell`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) already declares one class-level style default: `foregroundColor`, in `_defaultCellOptions` at [Cell.ts:26](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L26). That bag feeds `Component.getClassStyleDefaults()`, which `ensureClassStyleRule` ([core/ClassStyleRules.ts:222](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L222)) turns into one shared `.ClassName` CSS rule per concrete cell class. A per-instance setter compares its value against that rule (`matchesClassStyle`) and skips writing its own `#id` declaration when it already matches — so every instance of, say, `StringCell` shares one `color` declaration instead of each carrying its own.

The same constructor also calls `this.setBackgroundColor(...)` and `this.setBorder(...)` imperatively, with literals identical to `foregroundColor`'s treatment, plus a `subscribeTheme` callback that re-runs `setBorder` on every theme change ([Cell.ts:70–73](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L70-L73)). None of the three is registered in `_defaultCellOptions`, so `getClassStyleDefaults()` never sees them and every cell instance duplicates the identical `background-color` and four `border-*` declarations onto its own `#id` rule. The in-app Style Audit panel (`packages/lib/src/typescript/StyleAuditPanel.ts`) reports this today as a single duplicate-body row spanning `HeaderCell`, `NumberCell`, and `StringCell` — 25 instances, 6.28 KB, with only a default-sized demo table open. Because the duplication is per *instance*, not per class, it scales directly with cell count: opening the Misc tab's "wide table (45 columns)" demo window alone grows the same row to 595 instances, 155.46 KB, and pulls in two more concrete subclasses that share the same inherited defect — `BooleanCell` and `DateCell` — confirmed live via the Style Audit panel before/after opening that window. Every one of the fourteen concrete `Cell` subclasses inherits this same unregistered-default gap; the fix below is verified against all fourteen (see the Architecture Decision below), not just the four observed in these two snapshots.

This plan moves `backgroundColor` and `border` into `_defaultCellOptions`, following the exact pattern already used for `foregroundColor`, and removes the now-redundant imperative writes that the class default supersedes. `ensureClassStyleRule` keys its shared rule per **concrete** constructor, not per common ancestor, so this does not collapse `HeaderCell` / `NumberCell` / `StringCell` / etc. onto one shared rule — each concrete subclass still gets its own `.HeaderCell`, `.NumberCell`, `.StringCell` rule. What collapses is the *per-instance* duplication within each class: 25 instances across 3 classes today, each carrying its own copy of the same declarations, becomes 3 shared class rules and zero per-instance copies.

---

## Architecture Decisions

### Fold `backgroundColor` and `border` into `_defaultCellOptions`, mirroring `foregroundColor`

Both fields get the same literal `Cell` already writes today, added to the existing bag rather than a new one. `PopupPanel` ([overlay/PopupPanel.ts:84-85](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L84-L85)) is the closest precedent for declaring `backgroundColor` and `border` together in a `subclassDefaults` bag with no matching imperative constructor call — the same shape this plan produces for `border`.[^popup-panel-precedent]

### Delete the constructor's explicit `setBorder` call — `applyChromeOptions` already performs it

`border` is one of the four chrome fields (`border`, `borderRadius`, `shadow`, `backgroundImage`) that `Component.applyChromeOptions` always-dispatches: `this._defaultOptions.border` feeds `this.setBorder(border)` unconditionally, called from `applyOptions`, which runs inside `super()` — before `Cell`'s own constructor body resumes. Once `border` is in `_defaultCellOptions`, `_border` is already set correctly by the time `Cell`'s constructor reaches its own `setBorder` line, making that line a literal duplicate call with the same value.[^chrome-group]

### Delete the `subscribeTheme` re-assertion of border

`Component.setBorder` registers its own generic per-instance theme subscription the first time it is ever called on an instance (`this.subscribeTheme(() => this._borderWidths = null)`, guarded by `_borderThemeSubscribed`). Since `applyChromeOptions`'s always-dispatch now calls `setBorder` during `super()`, that generic subscription is already active — it nulls `_borderWidths` on every theme change so the next layout pass remeasures. `Cell`'s own `subscribeTheme(() => this.setBorder(<same literal>))` therefore has nothing left to do: the declaration text never changes across a theme switch (it is a static `var()` reference — only its *resolved* value changes, invisibly to JS), so re-running `setBorder` with the identical literal cannot change what's written. It is dead weight once `border` is a real class default.

### Keep the constructor's explicit `setBackgroundColor` call

`backgroundColor` is **not** in the chrome group — `Component.applyOptions` dispatches it only when the caller passes it (`if (options.backgroundColor !== undefined) this.setBackgroundColor(...)`), so nothing auto-populates it from a class default at construction. Its dedup instead comes from the *render-time* fold: `Component.getBackgroundColor()` folds `_defaultOptions.backgroundColor` in whenever `_options.backgroundColor` is unset, and `applyBoxAndVisibilityStyles` reads through that getter every render, so the class default reaches the DOM even if the setter is never called — exactly like `foregroundColor` already works.

Deleting the call would therefore still dedup correctly at render time. It stays anyway, because `Cell._applyStateTint` ([Cell.ts:383-424](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L383-L424)) reads and writes `_options.backgroundColor` directly, bypassing `setBackgroundColor` entirely, for performance: it compares the newly-resolved tint against `_options.backgroundColor` and only performs a write (an inline style, not a stylesheet rule) when the value actually changed. If the constructor never sets `_options.backgroundColor`, that key stays absent until `_applyStateTint` first runs — and its very first invocation would then compare `undefined` against the resolved value, which is never equal, forcing a write even when the resolved value is the unchanged class default. Keeping the explicit call seeds `_options.backgroundColor` so that first comparison is a genuine equality check, matching today's behaviour.[^apply-state-tint]

### No concrete `Cell` subclass needs its own `getClassStyleDefaults()` override

Of the fourteen concrete `Cell` subclasses (`StringCell`, `DefaultCell`, `ComboCell`, `TimeCell`, `DateTimeCell`, `GlyphCell`, `DynamicCell`, `HeaderCell`, `ParentHeaderCell`, `NumberCell`, `GroupSeparatorCell`, `BooleanCell`, `DateCell`, `FilterCell` — `HeaderCell`, `ParentHeaderCell`, and `GroupSeparatorCell` reach `Cell` through `DefaultCell`), none overrides `border`. Three — `ParentHeaderCell` ([ParentHeader.ts:69](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L69)), `GroupSeparatorCell` ([GroupSeparator.ts:41](packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts#L41)), and `FilterCell` ([Filter.ts:116](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L116)) — call `setBackgroundColor` in their own constructor with a value that differs from `Cell`'s default (`ParentHeaderCell` and `GroupSeparatorCell` from a per-instance `color` constructor parameter; `FilterCell` with a fixed but different literal). None needs a `getClassStyleDefaults()` override: each is a distinct concrete class, so it gets its own `.ParentHeaderCell` / `.GroupSeparatorCell` / `.FilterCell` rule inheriting `Cell`'s unchanged `backgroundColor` default — but every instance's own explicit `setBackgroundColor` call writes a different value to `_options.backgroundColor`, so it never matches that inherited default and always wins on `#id` via CSS specificity, identically to today. This is the same "instance overrides an inherited default" relationship every other hoisted field already has; it is not a gap this plan needs to close.

---

## Internal Structure

`Cell.ts`'s class-default bag and its doc comment, extended to cover the two new fields:

```typescript
// Every cell resolves its text colour, resting background, and resting
// border to the same theme tokens, on every instance and every subclass, so
// they are class defaults rather than per-instance writes — which keeps
// these declarations on the shared `.Cell`-family class rule instead of
// each cell's own `#id` rule. A subclass that paints a different resting
// background (`ParentHeaderCell`, `GroupSeparatorCell`, `FilterCell`) sets
// it imperatively in its own constructor, which still wins on `#id` over
// this default.
const _defaultCellOptions: Partial<ComponentOptions> = {
    foregroundColor: 'var(--ts-ui-table-cell-color, inherit)',
    backgroundColor: 'var(--ts-ui-table-cell-bg, transparent)',
    border:          'var(--ts-ui-table-cell-border, none)',
};
```

The constructor region ([Cell.ts:68-75](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L68-L75)):

```typescript
        this.setInsets(new Insets(0, 0, 0, 0));

        // `border` is dispatched automatically from `_defaultCellOptions` by
        // `Component.applyChromeOptions`'s always-dispatch during `super()`
        // above, so `_border` is already set here — no explicit call needed.
        // `backgroundColor` is not in that always-dispatch group (its class
        // default is resolved lazily by `getBackgroundColor()`'s folding
        // getter instead), so it still needs this explicit call: it seeds
        // `_options.backgroundColor` for `_applyStateTint`'s equality guard
        // (`setReadOnly` / `setRequiredEmpty` / `setRangeSelected` /
        // `setBaseBackground`), which compares against the cached value
        // rather than reading through the folding getter.
        this.setBackgroundColor('var(--ts-ui-table-cell-bg, transparent)');

        this.addComponent(renderer, rendererConstraints);
```

The old `this.setBorder('var(--ts-ui-table-cell-border, none)');` line and the `this.subscribeTheme(() => this.setBorder('var(--ts-ui-table-cell-border, none)'));` line are both deleted; nothing else in the constructor changes.

---

## Ordered Implementation Steps

1. **`Cell.ts` — widen `_defaultCellOptions`.** Replace the bag and its comment at [Cell.ts:22-26](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L22-L26) with the version in `## Internal Structure`.
   *Check:* `npm run typecheck` passes.

2. **`Cell.ts` — remove the redundant `setBorder` call.** Delete `this.setBorder('var(--ts-ui-table-cell-border, none)');` at [Cell.ts:71](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L71). Add the comment shown in `## Internal Structure` above the remaining `setBackgroundColor` call, explaining why it stays while `setBorder` doesn't.
   *Check:* `grep -n "setBorder('var(--ts-ui-table-cell-border" packages/lib/src/typescript/lib/component/table/cell/Cell.ts` — zero matches.

3. **`Cell.ts` — remove the theme-change re-assertion.** Delete `this.subscribeTheme(() => this.setBorder('var(--ts-ui-table-cell-border, none)'));` at [Cell.ts:73](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L73) and the blank line it leaves behind, so `setBackgroundColor` is followed directly by `this.addComponent(renderer, rendererConstraints);`.
   *Check:* `npm run typecheck` passes.

4. **`Cell.test.ts` — add the regression test.** Add the test from `## Expected Behaviour` row 3 to the `describe('Cell background/cursor/outline state precedence', ...)` block in [Cell.test.ts](packages/lib/tests/component/table/cell/Cell.test.ts).
   *Check:* `npx vitest run tests/component/table/cell/Cell.test.ts` — new test passes; every existing test in the file still passes unmodified (none of them assert on `#id`-rule `backgroundColor` / `border-*` content, so none should change).

5. **`default-options-fallback.test.ts` — add the registry rows.** Per ARCHITECTURE.md's *Class-level defaults must survive the getter*, add two rows next to the existing `'StringCell foregroundColor'` row at [default-options-fallback.test.ts:400](packages/lib/tests/component/default-options-fallback.test.ts#L400):
   ```typescript
   { label: 'StringCell backgroundColor', resolve: () => new StringCell().getBackgroundColor(), expected: 'var(--ts-ui-table-cell-bg, transparent)' },
   { label: 'StringCell border',          resolve: () => new StringCell().getBorder(),           expected: { border: 'var(--ts-ui-table-cell-border, none)' } },
   ```
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — both new rows pass.

6. **`next.md` — add the changelog bullet.** See `## Documentation Impact`.
   *Check:* `npm run docs:api` finishes with zero warnings.

7. **Full verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/tests/component/table/cell/Cell.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

| # | Case | Expected | Testable |
|---|---|---|---|
| 1 | A fresh `StringCell` (or any concrete `Cell` subclass that doesn't override background/border) | `getBackgroundColor()` returns `'var(--ts-ui-table-cell-bg, transparent)'`; `getBorder()` returns `{ border: 'var(--ts-ui-table-cell-border, none)' }` | Unit — step 5's registry rows |
| 2 | A rendered, unmodified `Cell` instance | Its own `#id` rule carries no `backgroundColor`, `borderTop`, `borderRight`, `borderBottom`, or `borderLeft` declaration | Unit — new test below |
| 3 | The same rendered `Cell` | The shared `.Cell` class rule carries `backgroundColor: 'var(--ts-ui-table-cell-bg, transparent)'` and all four `border-*` longhands at `'var(--ts-ui-table-cell-border, none)'` | Manual — Style Audit panel (row 5 below); not unit-tested because `ensureClassStyleRule`'s per-constructor cache is process-lifetime, so only whichever test in a file first renders `Cell` would see the class-rule insertion write, making a same-file assertion order-dependent |
| 4 | `ParentHeaderCell`, `GroupSeparatorCell`, `FilterCell` — the three subclasses with their own resting background | Unchanged: each instance's `#id` rule still carries its own `background-color`, since it never matches its class's inherited (from `Cell`) default | Manual — visual spot-check; no existing automated test covers this and none is added, since behaviour is unchanged |
| 5 | The Style Audit panel's duplicate-body report, viewed on a table-containing tab (verify both with the default demo table and with the Misc tab's "wide table (45 columns)" window open, per the scale confirmed live in `## Overview`) | The row spanning `HeaderCell` / `NumberCell` / `StringCell` (25 instances, 6.28 KB with the default table) and its larger form once `BooleanCell` / `DateCell` join in (595 instances, 155.46 KB with the wide table open) are both gone; each concrete class may still appear as its own single-instance `.ClassName` rule, but no `#id`-scoped duplication remains for `background-color` / `border-*` | Manual |

New test for row 2, added inside `Cell.test.ts`'s existing `describe('Cell background/cursor/outline state precedence', ...)` block:

```typescript
it('a fresh cell writes no backgroundColor or border declaration to its own #id rule', () => {
    const sink         = DOM.sink as RecordingDOMSink;
    const cell         = editableCell();
    const cellSelector = '#' + cell.getId();

    const idRuleKeys = ruleStyleWrites(sink)
        .filter((w) => w.selector === cellSelector)
        .map((w) => w.key);

    expect(idRuleKeys).not.toContain('backgroundColor');
    expect(idRuleKeys).not.toContain('borderTop');
    expect(idRuleKeys).not.toContain('borderRight');
    expect(idRuleKeys).not.toContain('borderBottom');
    expect(idRuleKeys).not.toContain('borderLeft');
});
```

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariant (expects zero matches — confirms the redundant border writes are gone):

```
grep -n "setBorder('var(--ts-ui-table-cell-border" packages/lib/src/typescript/lib/component/table/cell/Cell.ts
```

**Manual verification (row 5 of `## Expected Behaviour`) is required.** The offline test harness records what gets written, not what a live stylesheet ends up containing per class. Start a dev server on a spare port from *this worktree* (not the user's existing one — a server started elsewhere resolves the library to a different tree), open the Style Audit demo panel (`#/style-audit`), switch to a tab containing a table, refresh, and confirm the `HeaderCell` / `NumberCell` / `StringCell` duplicate-body row is gone.

---

## Documentation Impact

No exported symbol changes — `_defaultCellOptions` is module-private and the two deleted lines are constructor-internal. The `background-color` / `border-*` hoisting *mechanism* is already documented in `next.md`'s existing `### Core` entry; what's missing is that `Cell` and its built-in subclasses now actually use it, which carries the same consumer-facing specificity caveat that entry describes (a consumer stylesheet targeting a cell class by selector now ties with the generated `.ClassName` rule instead of always losing to `#id`). Add one bullet to `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Table`, matching that section's existing bullet style:

> **Table cells no longer duplicate their resting background and border on every instance's own CSS rule.** `Cell` and its built-in subclasses (`StringCell`, `NumberCell`, `BooleanCell`, `DateCell`, `TimeCell`, `DateTimeCell`, `ComboCell`, `GlyphCell`, `DefaultCell`, `HeaderCell`, `DynamicCell`) now share both on their concrete class's own rule, the same way the text colour already did. Nothing changes visually; a cell that paints its own resting background (`FilterCell`, a grouped row's tint, a `ParentHeaderCell` / `GroupSeparatorCell` group colour) keeps its per-instance override exactly as before.

---

## Non-Goals

- **Collapsing `HeaderCell` / `NumberCell` / `StringCell` / etc. onto one shared CSS rule.** `ensureClassStyleRule` keys per concrete constructor; each class keeps its own `.ClassName` rule. This plan removes per-*instance* duplication within each class, not the count of class rules.
- **Giving `ParentHeaderCell`, `GroupSeparatorCell`, or `FilterCell` their own `getClassStyleDefaults()` override.** Their resting background differs from `Cell`'s default (per-instance for the first two, a fixed different literal for `FilterCell`), so it never matches and always wins via CSS specificity on `#id` — correct today, correct after this plan. Giving `FilterCell` its own class default (its literal is fixed, unlike the other two) would let its own instances dedup against each other, but that is a separate opportunity on a different class, not a defect this plan needs to fix.
- **Changes to `core/ClassStyleRules.ts` or `core/Component.ts`.** The hoisting mechanism this plan relies on already shipped in `component-chrome-base-tier-hoisting.md`; this plan only supplies data (`_defaultCellOptions`) to it.
- **Any change to rendered appearance.** Every value written is identical before and after; only which CSS rule carries it changes.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` | The file being changed: `_defaultCellOptions` (22-26), the constructor (58-97), `_applyStateTint` (383-424) |
| `packages/lib/src/typescript/lib/core/Component.ts` | `applyChromeOptions` (685-695) — the always-dispatch group border belongs to; `getBackgroundColor` (2161-2163) and `setBorder` (2406-2418) — why the two fields need different treatment; `applyBoxAndVisibilityStyles` (4858-4905) and `applyChromeStyles` (4987-5011) — the render-time reconcile that makes the dedup work |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStyleRule` (222-259) — confirms the per-concrete-constructor keying behind the Non-Goals note |
| `packages/lib/src/typescript/lib/overlay/PopupPanel.ts` | The precedent for declaring `backgroundColor` + `border` together via `subclassDefaults` with no matching imperative call |
| `plans/implemented/component-chrome-base-tier-hoisting.md` | The plan that shipped the hoisting mechanism this one supplies data to; its `## Architecture Decisions` explain the always-dispatch / clear-on-match design this plan depends on |
| `packages/lib/tests/component/table/cell/Cell.test.ts` | Existing background/cursor/outline precedence tests the new test sits beside; confirms none of them assert on `#id`-rule content |
| `packages/lib/tests/component/default-options-fallback.test.ts` | The mechanical registry ARCHITECTURE.md requires a row in |

---

## Notes

[^popup-panel-precedent]: `PopupPanel`'s constructor ([overlay/PopupPanel.ts:76-89](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L76-L89)) passes `backgroundColor` and `border` inline in the `subclassDefaults` object forwarded to `super()`, with zero matching `setBackgroundColor` / `setBorder` calls in its own constructor body — it relies entirely on the folding getter and the chrome-group always-dispatch. The `default-options-fallback.test.ts` registry already has rows proving this resolves correctly (`'PopupPanel backgroundColor'`, `'PopupPanel border'` at lines 370-371). `Cell` differs from this precedent only in keeping its own `setBackgroundColor` call, for the `_applyStateTint` reason given in its own decision above — `PopupPanel` has no equivalent direct-cache-write consumer to preserve.

[^chrome-group]: `border`, `borderRadius`, `shadow`, and `backgroundImage` are dispatched by `Component.applyChromeOptions` as `options.X ?? this._defaultOptions.X`, called unconditionally from `applyOptions`, itself called at the end of `Component`'s own constructor — i.e. during `super()`, before a subclass constructor body resumes. `backgroundColor` is dispatched separately, gated on `options.backgroundColor !== undefined` with no default fallback, so a class default for it is never dispatched through the setter — only ever read through the folding getter. This split is documented in ARCHITECTURE.md's *Class-level defaults must survive the getter* section and is why `border`'s explicit constructor call becomes redundant while `backgroundColor`'s conditionally does not.

[^apply-state-tint]: `_applyStateTint`'s own comment ([Cell.ts:390-398](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L390-L398)) explains it bypasses `setBackgroundColor` specifically because a pooled cell is rebound on every column-window recycle (`Row.setColumnWindow`, `Header`'s reconciler, `Body.applyReadOnlyState`), and routing that through the normal setter would re-materialise the cell's `#id` stylesheet rule on every recycle pass — the same cost `Row.updateVisualState` already avoids for rows. The guard this plan preserves (`this._options.backgroundColor !== background`) is what makes an unchanged recycle a no-op instead of a redundant inline-style write every time. This bypass write is also the one `component-chrome-base-tier-hoisting.md`'s footnote `[^only-chromeless]` already found and cleared as safe, on the (then-true) grounds that `Cell` had no chrome defaults for the field it was writing; this plan is what changes that precondition, and the analysis above confirms the bypass still behaves correctly once `backgroundColor` is a real class default, because the render-time reconcile (not the bypass write) is what decides what lands on `#id`.
