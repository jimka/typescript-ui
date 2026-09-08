---
touches-shared:
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/component/button/TabButton.ts
---

# Tab Modified Glyph — Implementation Plan

## Overview

A downstream consumer (Loom, a desktop editor built on this library) needs a persistent "unsaved
changes" dot on a tab that survives label truncation. Today the closest tool is
[`Tab.setTabName`](packages/lib/src/typescript/lib/layout/Tab.ts#L1228) — a consumer wanting a
dirty marker has to bake it into the label text itself, which a truncating label can silently
swallow. Nothing paints a fixed decoration in a tab's content row except the leading identity
glyph, which the tab's own [`TabButton`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L159)
already positions so it never truncates.

This plan adds a boolean modified toggle at the same three layers the existing glyph, italic and
busy toggles already run through: `Tab.setTabModified(content, modified)` →
`TabBar.setEntryModified(id, modified)` → `TabButton.setModified(modified)`, each with a matching
read. `TabButton.setModified` is the one genuinely new mechanism: it adds a small filled `circle`
[`Glyph`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L224) as a real child of the
button's content row (`_content`, an `HBox`), trailing the label — mirroring
[`SplitButton`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L86)'s fixed
trailing chevron. Only the label shrinks under `HBox` layout, so the dot is never clipped.

---

## Architecture Decisions

### Three-layer delegation, mirroring `setTabItalic` / `setEntryItalic`

`Tab.setTabModified` resolves the tab by content component and delegates to a new
`TabBar.setEntryModified`, which resolves the cell by its owner-minted id and writes to that
cell's `TabButton`. This is the exact shape
[`Tab.setTabItalic`](packages/lib/src/typescript/lib/layout/Tab.ts#L1359) /
[`TabBar.setEntryItalic`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1587)
already establish for "toggle one visual aspect of a built tab, view-only, not written to
`LayoutConstraints`" — closer than the busy pair, whose `Tab`-level setter routes through a
private `setEntryBusy(entry, busy)` helper solely to dedupe redundant writes and fire a
`"busychange"` event.[^why-italic-not-busy] The modified flag needs neither, so it takes
`setTabItalic`'s simpler direct-call shape: `this._bar.setEntryModified(entry.id, modified)`.

### The dot is a real content-row child, mirroring `SplitButton`'s trailing chevron

`SplitButton` keeps its dropdown chevron as a permanent child of `_content` (`Button`'s `HBox`
content row), added once in the constructor and re-appended by an
[`_afterRebuildContentRow`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L223)
override after every content-row rebuild. Only the label (`Text`, `truncate: true`) shrinks when
the row is too narrow; every other child keeps its full preferred size. The modified dot follows
the same shape — a `circle` glyph appended to `_content` after the label — with one difference
from the chevron: it is **toggled** in and out of `_content` via
`addComponent`/`removeComponent` rather than staying permanently attached, since a clean tab's
label should get the row's full width back rather than always reserving blank space for a hidden
dot. `TabButton` currently has no `_afterRebuildContentRow` override; this plan adds one, mirroring
`SplitButton`'s.

The dot is sized to `ThemeManager.getResolvedScale().glyphXs` — the same scale token
[`TabButton.buildCloseButton`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L343)
already uses for the close ✕'s icon — and colored with `--ts-ui-tab-indicator-color`, the CSS
variable [`TabBar`'s active-tab underline](packages/lib/src/typescript/lib/component/container/TabBar.ts#L242)
already paints with and [`TabButton`'s own busy wash](packages/lib/src/typescript/lib/component/button/TabButton.ts#L67)
already falls back to; the variable itself is registered from `theme.tab.indicator.color`
([Theme.ts:1071](packages/lib/src/typescript/lib/core/Theme.ts#L1071)). No new CSS variable and no
new `StyleRule`/class-rule registration: `Glyph`'s existing rendering already covers a fixed-size,
fixed-color SVG glyph with no further styling.

Unlike the busy wash, the dot gets no dedicated override token of its own (`setBusy`'s wash reads
`--ts-ui-tab-busy-color`, falling back to `--ts-ui-tab-indicator-color`). The addition stays
minimal: a consumer who wants a distinct modified-dot color can still reach it by overriding
`--ts-ui-tab-indicator-color`, at the cost of also moving the active-tab underline and the
busy-wash fallback.[^no-dedicated-token]

### `circle` is already a registered-elsewhere solid glyph

[`glyphs/solid/circle.ts`](packages/lib/src/typescript/lib/glyphs/solid/circle.ts) is a plain
filled disc (`name: "circle"`) already shipped in the glyph set and already registered eagerly by
[`RadioButton.ts:13-17`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L13) for
its own selection dot, with the comment "Idempotent registration: makes the `"circle"` glyph
available." `Glyph.register` is a `Map.set` keyed by name
([Glyphs.ts:67-68](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L67)), so a second
`Glyph.register(circle)` call from `TabButton.ts` is a safe, precedented no-op when `RadioButton`
is also loaded, following the exact "idempotent registration" pattern
[`TabCloseButton.ts:10`](packages/lib/src/typescript/lib/component/button/TabCloseButton.ts#L10)
and [`SplitButton.ts:16`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L16)
already use for their own first-registration case.

### The dot must be explicitly disposed, not left to child recursion

A toggled `_content` child is not the same disposal case as a permanent one. `SplitButton._chevron`
is added once and never removed, so it is always present in `_content`'s own children when
`SplitButton` is torn down, and the base
[`Component.destructor()`](packages/lib/src/typescript/lib/core/Component.ts#L990)'s own child
recursion (it walks `this._components` recursively — `TabButton` never passes through a `Container`
subclass, since it extends `ToggleButton` → `Button` → `Component` directly) reaches it that way.
The modified dot is different: `setModified(false)` detaches it from `_content` via
`removeComponent`, which is explicitly **detach-only** — it "does not call
[`dispose`](packages/lib/src/typescript/lib/core/Component.ts#L6701)" — so a tab that was dirty at
least once, then saved clean, then closed, has a `_modifiedGlyph` instance that is not a member of
any component's `_components` array at teardown time. `Component.destructor()`'s recursion never
finds it, and it leaks (its DOM element, its per-instance stylesheet rule, its tracked theme
subscriptions).

This is the same failure this repo already fixed once, for
[`_closeButton`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L210): see
`TabButton.styleRuleDisposal.test.ts`'s header comment, which names the bug and cites
`plans/implemented/table-toolbar-button-residual-leak.md`.[^dispose-correction] The fix there was
the same shape [`Button.setGlyph`](packages/lib/src/typescript/lib/component/button/Button.ts#L1766)
/ [`clearGlyph`](packages/lib/src/typescript/lib/component/button/Button.ts#L1805) already use for
their own replaced/removed glyph — "the rebuild only detaches, so dispose explicitly" — and it is
the fix this plan applies to `_modifiedGlyph`: `TabButton.destructor()` gets a third explicit
`this._modifiedGlyph?.dispose();` line, unconditionally, alongside `_closeButton` and
`_busyIndicator`. Calling `dispose()` on an already-attached child before `super.destructor()`
reaches it a second time through `_content`'s own recursion is safe — both `dispose()` and
`destructor()` are documented idempotent, "a harmless no-op" on a second call
([Component.ts:966-969](packages/lib/src/typescript/lib/core/Component.ts#L966)).

### No extra relayout call is needed in `setModified`

`Button`'s content-mutating setters (`setGlyph`, `clearGlyph`) call `this.recomputePreferredSize()`
explicitly after rebuilding the row. `setModified` does not need to: `Component.addComponent` /
`removeComponent` on `_content` already "wires preferred-size change propagation, and triggers
layout" and explicitly notify `_content`'s own parent — `removeComponent`'s doc comment states
"losing a child changes this container's own preferred size, so notify the parent to relayout and
re-measure"
([Component.ts:6704-6719](packages/lib/src/typescript/lib/core/Component.ts#L6704)), and
`addComponent` does the symmetric notification on add
([Component.ts:6531](packages/lib/src/typescript/lib/core/Component.ts#L6531)). Since `_content`
is `TabButton`'s own registered child, that notification reaches `TabButton`, and since `Button`'s
`getPreferredSize()` derives its size live from its `Fit` layout manager reading `_content` on
every call — `recomputePreferredSize`'s own written value "isn't read back for sizing... the call
stands in for the parent-relayout notification + dedupe"
([Button.ts:2394-2397](packages/lib/src/typescript/lib/component/button/Button.ts#L2394)) — the
ancestor strip is already correctly notified with no further call. `setGlyph`/`clearGlyph` call
`recomputePreferredSize()` for a different, glyph-specific reason: `_syncGlyphSize()`
re-synchronises the leading glyph's box to the title's line height, which does not apply to the
fixed-size trailing dot.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/layout/Tab.ts — new
setTabModified(content: Component, modified: boolean): boolean;
isTabModified(content: Component): boolean;
```

```typescript
// packages/lib/src/typescript/lib/component/container/TabBar.ts — new
setEntryModified(id: string, modified: boolean): this;
isEntryModified(id: string): boolean;
```

```typescript
// packages/lib/src/typescript/lib/component/button/TabButton.ts — new
setModified(modified: boolean): this;
isModified(): boolean;
```

No new options-bag field on any of the three classes (runtime state, not configuration — matching
`_busy`/`isBusy`, which carries none either), no new export, and no new CSS variable: all three
classes are already exported from their entry points, and the dot reuses
`--ts-ui-tab-indicator-color`.

---

## Implementation

`TabButton.ts` — two new fields, beside `_busy`/`_busyIndicator`
([lines 216-217](packages/lib/src/typescript/lib/component/button/TabButton.ts#L216)):

```typescript
// Whether this tab is marked modified (unsaved changes). Runtime state, not
// configuration, so it carries no options-bag field — matching `_busy`.
private _modified: boolean = false;

// The trailing "unsaved changes" dot, built lazily on the first
// setModified(true) and reused thereafter, matching `_busyIndicator`. Added
// to and removed from `_content` directly (not merely shown/hidden) so a
// clean tab's label keeps the full row width instead of always reserving
// blank space for a dot it isn't showing.
private _modifiedGlyph: Glyph | null = null;
```

Two new imports and a module-level registration, placed after the existing import block
([lines 1-13](packages/lib/src/typescript/lib/component/button/TabButton.ts#L1)), mirroring
`TabCloseButton.ts`'s and `SplitButton.ts`'s exact placement — before the `TabButtonOptions`
interface, not interleaved with the busy-indicator constants below it:

```typescript
import { Glyph } from "~/component/display/Glyph.js";
import { circle } from "~/glyphs/solid/circle.js";

// Idempotent registration — see RadioButton.ts's own registration of this
// same glyph for its selection dot.
Glyph.register(circle);

/** Registry name of the trailing "unsaved changes" dot — a plain filled disc. */
const MODIFIED_GLYPH = "circle";
```

`setModified` / `isModified`, placed after `isBusy`
([line 429](packages/lib/src/typescript/lib/component/button/TabButton.ts#L429)):

```typescript
/**
 * Shows or hides the trailing "unsaved changes" dot in the tab's content
 * row, after the label. Unlike the busy overlay, this is a real row child,
 * not an absolute overlay: only the label truncates when the tab narrows
 * (`Text`'s own ellipsis), so the dot — like the leading glyph — always
 * keeps its full size and is never clipped away.
 *
 * @param modified - True to show the dot, false to hide it.
 *
 * @returns This button, for method chaining.
 */
setModified(modified: boolean): this {
    if (this._modified === modified) {
        return this;
    }

    this._modified = modified;

    if (!this._modifiedGlyph) {
        if (!modified) {
            return this;
        }

        this._modifiedGlyph = new Glyph(MODIFIED_GLYPH);

        const dotSize = ThemeManager.getResolvedScale().glyphXs;

        this._modifiedGlyph.setPreferredSize({ width: dotSize, height: dotSize });
        this._modifiedGlyph.setForegroundColor("var(--ts-ui-tab-indicator-color, #1a73e8)");
    }

    if (modified) {
        this._content.addComponent(this._modifiedGlyph);
    } else {
        this._content.removeComponent(this._modifiedGlyph);
    }

    return this;
}

/**
 * Reports whether the trailing "unsaved changes" dot is currently shown.
 *
 * @returns True when this tab is marked modified.
 */
isModified(): boolean {
    return this._modified;
}
```

`_afterRebuildContentRow`, added once as a new protected override, placed directly after
`isModified` — mirroring `SplitButton`'s override
([SplitButton.ts:212-227](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L212))
exactly, including its guard shape:

```typescript
/**
 * Re-appends the modified dot after a content-row rebuild, mirroring
 * `SplitButton`'s own override for its trailing chevron — `_rebuildContentRow`
 * empties `_content` wholesale on any label/glyph/writing-mode change (e.g. a
 * cross-type Save As calling `setGlyph`), which would otherwise silently
 * drop the dot until the next explicit `setModified` call.
 *
 * @remarks Guarded on both `_modified` and `_modifiedGlyph`: a clean tab (or
 * one that has never been marked modified) must not gain a dot it was never
 * asked to show.
 */
protected override _afterRebuildContentRow(): void {
    if (this._modified && this._modifiedGlyph) {
        this._content.addComponent(this._modifiedGlyph);
    }
}
```

`destructor`, extended with a third explicit disposal
([lines 279-284](packages/lib/src/typescript/lib/component/button/TabButton.ts#L279)) — the JSDoc
above it is rewritten, since "raw-appended... so `super.destructor()`'s child recursion cannot
reach them" no longer describes all three cases (see `## Architecture Decisions`):

```typescript
/**
 * Disposes the overlaid close button, busy indicator, and modified dot, then
 * runs the inherited teardown. The close button and busy indicator are
 * raw-appended onto this button's own element rather than registered via
 * `addComponent` (see `buildCloseButton`'s doc comment), so `Component`'s own
 * child-disposal recursion cannot reach them. The modified dot *is* a
 * registered `_content` child, but only while shown — `setModified(false)`
 * detaches it (`removeComponent` is detach-only), so a clean tab that was
 * dirty at least once still has an undisposed instance the recursion would
 * never find. All three are disposed explicitly for that reason; a
 * currently-attached dot being disposed twice (here, then again via
 * `_content`'s own recursion inside `super.destructor()`) is a documented
 * no-op.
 */
protected destructor(): void {
    this._closeButton?.dispose();
    this._busyIndicator?.dispose();
    this._modifiedGlyph?.dispose();

    super.destructor();
}
```

`TabBar.ts` — `setEntryModified` / `isEntryModified`, placed after `isEntryBusy`
([lines 1654-1656](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1654)), mirroring
`setEntryBusy`/`isEntryBusy`'s exact shape:

```typescript
/**
 * Shows or hides the cell with `id`'s trailing "unsaved changes" dot. No-op
 * for an unknown id.
 *
 * @param id - The cell id whose modified state changed.
 * @param modified - True to show the dot, false to hide it.
 *
 * @returns This tab strip, for method chaining.
 */
setEntryModified(id: string, modified: boolean): this {
    this.entryById(id)?.button.setModified(modified);

    return this;
}

/**
 * Reports whether the cell with `id`'s modified dot is currently shown.
 *
 * @param id - The cell id to query.
 *
 * @returns True when the cell is modified; false for an unknown id.
 */
isEntryModified(id: string): boolean {
    return this.entryById(id)?.button.isModified() ?? false;
}
```

`Tab.ts` — `setTabModified` / `isTabModified`, placed after `isTabBusy`
([lines 1416-1420](packages/lib/src/typescript/lib/layout/Tab.ts#L1416)), mirroring
`setTabItalic`/`isTabItalic`'s exact shape (view-only, not written to `LayoutConstraints`):

```typescript
/**
 * Shows or hides the trailing "unsaved changes" dot on the tab hosting
 * `content`. Nothing else about the tab changes.
 *
 * @param content - The content component whose tab to mark.
 * @param modified - True to show the dot, false to hide it.
 *
 * @returns `true` when a matching tab was found, `false` otherwise.
 *
 * @remarks
 * A lazy tab whose factory has not run yet has no content component to key
 * on, so this returns `false` for it. {@link TabBar.setEntryModified} reaches
 * such a cell directly, by its owner-minted id.
 *
 * The flag is view-only: it is not written to the tab's `LayoutConstraints`,
 * so it does not survive a tear-off, a re-dock, or a saved layout.
 */
setTabModified(content: Component, modified: boolean): boolean {
    const entry = this._contents.find(e => e.component === content);

    if (!entry) {
        return false;
    }

    this._bar.setEntryModified(entry.id, modified);
    this.getContainer()?.scheduleLayout();

    return true;
}

/**
 * Reports whether the tab hosting `content` currently shows the modified dot.
 *
 * @param content - The content component whose tab to query.
 *
 * @returns `true` when that tab's dot is shown; `false` when no tab matches.
 */
isTabModified(content: Component): boolean {
    const entry = this._contents.find(e => e.component === content);

    return entry ? this._bar.isEntryModified(entry.id) : false;
}
```

---

## Ordered Implementation Steps

Steps proceed bottom-up through the delegation chain — `TabButton` first, since `TabBar` calls
into it; `TabBar` next, since `Tab` calls into it; `Tab` last — and each class's own implementation
is immediately followed by its own tests, so a class's behaviour is pinned before the next class is
built on top of it. `npm run test` runs `typecheck:test` before vitest, so a test naming a method
that does not exist yet fails fast as a type error, not a silently-skipped assertion.

1. **`packages/lib/src/typescript/lib/component/button/TabButton.ts`** — add the two imports, the
   `Glyph.register(circle)` call, and the `MODIFIED_GLYPH` constant (bodies in `## Implementation`)
   after the existing import block, before the `TabButtonOptions` interface
   ([line 13](packages/lib/src/typescript/lib/component/button/TabButton.ts#L13)).
2. **Same file** — add the `_modified` / `_modifiedGlyph` fields after `_busyIndicator`
   ([line 217](packages/lib/src/typescript/lib/component/button/TabButton.ts#L217)).
3. **Same file** — add `setModified` / `isModified` after `isBusy`
   ([line 429](packages/lib/src/typescript/lib/component/button/TabButton.ts#L429)), and
   `_afterRebuildContentRow` directly after them (new methods, per `## Implementation`).
4. **Same file** — replace `destructor`'s body and JSDoc
   ([lines 273-284](packages/lib/src/typescript/lib/component/button/TabButton.ts#L273)) with the
   version in `## Implementation` (adds the `this._modifiedGlyph?.dispose();` line).
5. **`packages/lib/tests/component/button/TabButton.test.ts`** — add a
   `describe('TabButton modified indicator', …)` block directly after the existing `describe('TabButton
   busy overlay', …)` block
   ([closes at line 174](packages/lib/tests/component/button/TabButton.test.ts#L174)), covering
   rows 1-6 of `## Expected Behaviour`. Add a local helper reaching `_content`'s live children,
   mirroring the file's existing `appendCountOnto` helper shape:
   ```typescript
   /** Reaches TabButton's protected `_content` row, the same private-surface-reach pattern SplitButton.test.ts uses for `_chevron`. */
   function contentChildren(btn: TabButton): unknown[] {
       return (btn as unknown as { _content: { getComponents(): unknown[] } })._content.getComponents();
   }
   ```
   *Check:* from `packages/lib`, `npx vitest run tests/component/button/TabButton.test.ts`.
6. **`packages/lib/tests/component/button/TabButton.styleRuleDisposal.test.ts`** — add a third `it`
   to the existing `describe` block, covering row 7 of `## Expected Behaviour`: build a `TabButton`,
   call `setModified(true)` then `setModified(false)` (dot built, then detached but not disposed),
   capture `_ruleCacheKeys()` before `destructor()`, call `destroy(button)`, and assert no key
   containing the modified glyph's id survives. Follow the existing test's warm-up-pass shape (a
   throwaway `TabButton` cycled through the same sequence first, so any process-global rule stays
   out of the diff).
   *Check:* from `packages/lib`, `npx vitest run tests/component/button/TabButton.styleRuleDisposal.test.ts`.
7. **`packages/lib/src/typescript/lib/component/container/TabBar.ts`** — insert `setEntryModified`
   and `isEntryModified` (bodies in `## Implementation`) between `isEntryBusy`'s closing brace
   ([line 1656](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1656)) and
   `getEntryButtonId`'s JSDoc
   ([line 1658](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1658)).
8. **`packages/lib/tests/component/container/TabBar.test.ts`** — add a new
   `describe('TabBar modified state', …)` block directly after the existing `describe('TabBar busy
   state', …)` block
   ([closes at line 238](packages/lib/tests/component/container/TabBar.test.ts#L238)), covering
   rows 8-10 of `## Expected Behaviour`, using the file's existing `threeEntryBar` helper.
   *Check:* from `packages/lib`, `npx vitest run tests/component/container/TabBar.test.ts`.
9. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — insert `setTabModified` and
   `isTabModified` (bodies in `## Implementation`) between `isTabBusy`'s closing brace
   ([line 1420](packages/lib/src/typescript/lib/layout/Tab.ts#L1420)) and the `"dockrequested"`
   handler's JSDoc ([line 1422](packages/lib/src/typescript/lib/layout/Tab.ts#L1422)).
10. **`packages/lib/tests/layout/Tab.tabModified.test.ts`** *(new)* — copy
    `packages/lib/tests/layout/Tab.tabItalic.test.ts`'s scaffolding verbatim (`CONFIG`, `hostTab`,
    `barEntries`, the `afterEach` teardown) and cover rows 11-16 of `## Expected Behaviour`, one
    `it` per row, continuing that file's numbering from 18 (so cases 19-24), matching how
    `Tab.tabItalic.test.ts` itself continued `Tab.tabGlyph.test.ts`'s 1-12 with 13-18.
    *Check:* from `packages/lib`, `npx vitest run tests/layout/Tab.tabModified.test.ts`.
11. **`packages/lib/src/typescript/TabDemoPanel.ts`** — add
    `const toggleModifiedBtn = new Button("Toggle Modified");` plus
    `toolbar.addComponent(toggleModifiedBtn);` immediately after the existing `toggleItalicBtn` pair
    ([line 55](packages/lib/src/typescript/TabDemoPanel.ts#L55)), and wire it beside that button's
    handler ([line 344](packages/lib/src/typescript/TabDemoPanel.ts#L344)) as the exact analogue:
    read `getActiveContent()`, and when non-null call
    `setTabModified(content, !isTabModified(content))`. This is the surface the manual rows in
    `## Expected Behaviour` use.
12. **Documentation** — the four file edits in `## Documentation Impact`.
13. **Whole-repo checks** — `npm run typecheck`, `npm run test`, `npm run lint`, `npm run docs:api`
    (must finish with zero warnings). Then
    `grep -rn 'setEntryModified\|setTabModified\|isEntryModified\|isTabModified\|_modifiedGlyph' packages/lib/src packages/lib/tests packages/lib/docs`
    and confirm every hit is one this plan asked for.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/TabDemoPanel.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Create | `packages/lib/tests/layout/Tab.tabModified.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/components/TabBar.md` |
| Modify | `packages/lib/docs/components/TabButton.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable — `TabButton`:

1. A fresh `TabButton` defaults to `isModified()` false, with no dot in `_content`'s children.
2. `setModified(true)` sets `isModified()` true, is chainable, and adds exactly one child to
   `_content`.
3. `setModified(true)` called twice adds exactly one dot — the second call is a no-op guarded by
   `this._modified === modified`.
4. `setModified(true)` then `setModified(false)` clears `isModified()` and removes the dot from
   `_content`'s children (`contentChildren(btn)` shrinks back to its baseline count).
5. `setModified(true)` again after step 4 reuses the same `Glyph` instance rather than building a
   new one — capture the instance after the first `setModified(true)`, and assert identity after
   the show/hide/show cycle.
6. Calling `_afterRebuildContentRow` (indirectly, via any `Button` content-row rebuild — e.g.
   `setGlyph`) while `isModified()` is true leaves the dot present afterward; while false, adds
   nothing.

Unit-testable — `TabButton` disposal (row 7 belongs in `TabButton.styleRuleDisposal.test.ts`,
rows 1-6 above in `TabButton.test.ts`):

7. `destructor()` after a `setModified(true)` → `setModified(false)` cycle (dot built, then
   detached, never disposed by the detach) leaves no trace of the dot's stylesheet rule —
   mirroring the existing close-button regression test's before/after `_ruleCacheKeys()` diff.
   `destructor()` on a `TabButton` never marked modified is unaffected (no throw, nothing to
   dispose).

Unit-testable — `TabBar`:

8. `setEntryModified(id, true)` makes `isEntryModified(id)` true; `setEntryModified(id, false)`
   makes it false again.
9. `setEntryModified` on an unknown id is a no-op, returns the bar, and `isEntryModified` on that
   id is false.
10. `isEntryModified` is false for a cell never marked modified, and false again after
    `removeBarEntry`.

Unit-testable — `Tab`:

11. `setTabModified(content, true)` returns `true` for a tab-hosted content component, and
    `isTabModified(content)` is then `true`.
12. `setTabModified(content, false)` returns `true` and `isTabModified(content)` returns to
    `false`.
13. `setTabModified` on a component that was never added returns `false`, `isTabModified` on it is
    `false`, and the existing tab's own `isModified()` stays `false`.
14. `setTabModified` marks the owning container's layout dirty (`host.isLayoutDirty()` is `true`
    afterward), matching case 16 of `Tab.tabItalic.test.ts`.
15. `setTabModified` leaves the tab's `LayoutConstraints` untouched — for a tab added with no
    constraints, `getLayoutConstraints(content)` is still `undefined` afterward.
16. `setTabName` after `setTabModified` keeps the dot shown: the relabel writes text, not the
    modified flag.

Manual verification — the demo panel's *Toggle Modified* button (the offline test harness has no
rendered-pixel assertions, so the dot's actual paint, size, and truncation survival need eyes):

17. The active tab shows a small filled dot trailing its label, in the strip's accent color;
    nothing else about the tab changes — same fill, same leading glyph, same close ✕, same
    position.
18. Set the demo's width-mode combo to `"fixed"` with a narrow width (or shrink the window with
    `"content"` mode active) so the active tab's label truncates: the dot stays fully visible,
    immediately after the truncated text.
19. Toggling off removes the dot with no leftover blank gap.
20. A tab that is both italic (*Toggle Italic*) and modified shows both at once, with no visual
    clash.
21. Modified survives a content-row rebuild on the same tab — toggle the dot on, then use a
    control that swaps the tab's leading glyph or writing mode (e.g. the orientation controls): the
    dot is still present afterward, re-appended by `_afterRebuildContentRow`.
22. Both themes render the dot identically (no theme-specific token beyond the shared indicator
    color).

---

## Verification

- `npm run typecheck` and `npm run test` from the repo root — the latter runs `typecheck:test` plus
  the whole vitest suite.
- `npm run lint` — no new findings; this plan adds no raw DOM access and places its new child only
  through `addComponent`/`removeComponent`.
- `npm run docs:api` — must finish with zero warnings.
- Single-file runs while iterating, from `packages/lib`:
  `npx vitest run tests/component/button/TabButton.test.ts`,
  `npx vitest run tests/component/button/TabButton.styleRuleDisposal.test.ts`,
  `npx vitest run tests/component/container/TabBar.test.ts`,
  `npx vitest run tests/layout/Tab.tabModified.test.ts`.
- Manual: `npm run dev`, open the **Tab** demo panel, add two or three tabs, and walk rows 17-22
  above with *Toggle Modified*.

---

## Documentation Impact

- **`packages/lib/docs/layouts/Tab.md`** — extend the *Renaming, re-iconing and italicising a tab*
  section (its heading is at [line 77](packages/lib/docs/layouts/Tab.md#L77)) with a paragraph and
  snippet for `setTabModified(content, modified)` / `isTabModified(content)`, placed after the
  italic paragraph ([ends at line 105](packages/lib/docs/layouts/Tab.md#L105)) and before *## Selecting
  a tab* ([line 107](packages/lib/docs/layouts/Tab.md#L107)). Rename the heading to *Renaming,
  re-iconing, italicising and marking a tab modified*, continuing the same pattern
  `tab-label-styling.md` used when it added italicising. State plainly that the flag is view-only,
  like the italic flag and unlike `setTabGlyph`.
- **`packages/lib/docs/components/TabBar.md`** — add one row to the *Cell lifecycle* table, directly
  under the `setEntryItalic` row ([line 63](packages/lib/docs/components/TabBar.md#L63)):
  `` | `setEntryModified(id, modified)` / `isEntryModified(id)` | Show or hide a cell's trailing "unsaved changes" dot, or read the flag back. View-only, like `setEntryItalic`. | ``.
- **`packages/lib/docs/components/TabButton.md`** — add a new `## Modified indicator` section
  directly after `## Busy state`
  ([ends at line 26](packages/lib/docs/components/TabButton.md#L26)), before `## Notes`
  ([line 28](packages/lib/docs/components/TabButton.md#L28)): document `setModified(true)` /
  `isModified()`, state that the dot is a real content-row child (not an overlay), so it is never
  clipped by truncation, and that its color reads `--ts-ui-tab-indicator-color`.
- **`packages/lib/docs/reference/changelog/next.md`** — currently reset to empty (post-0.9.0
  release), so this plan creates its first two sections rather than appending to existing ones,
  mirroring `0.9.0.md`'s own heading shape (`## Added` › `### Components` / `### Layouts`):
  - `## Added` › `### Components` — `TabBar.setEntryModified(id, modified)` /
    `isEntryModified(id)`, and `TabButton.setModified(modified)` / `isModified()` as the button-level
    mechanism they run through.
  - `## Added` › `### Layouts` — `Tab.setTabModified(content, modified)` / `isTabModified(content)`,
    stating the flag is view-only, matching `setTabItalic`.
- No page is added, so `packages/docs/src/content/pages.ts` needs no edit — `/layouts/Tab`,
  `/components/TabBar`, and `/components/TabButton` are already registered.
- `packages/lib/llms.txt` is generated (`npm run docs:llms`) and indexes components, not methods —
  do not hand-edit it.

---

## Potential Challenges

- **A default-styled `Glyph`'s per-instance rule might dedupe to nothing**, making the disposal
  regression test (row 7) vacuous. Unlikely here: `setForegroundColor` and `setPreferredSize` are
  both explicit per-instance writes with no class-tier default on a bare `Glyph` to dedupe against,
  matching why the close-button disposal test needed to force a deviation
  (`setPressedForegroundColor('red')`) but a default-styled `TabCloseButton` would not have. Step 6
  confirms the rule really materialises before asserting it is gone.
- **The `_afterRebuildContentRow` guard must check both `_modified` and `_modifiedGlyph`.** A tab
  that has never been marked modified has neither set; checking only `_modifiedGlyph` (which stays
  non-null after the first build even while hidden) would wrongly re-show a hidden dot on every
  content-row rebuild.
- **Double-dispose safety is a documented framework contract, not an assumption this plan
  introduces.** `Component.dispose()`/`destructor()`'s own JSDoc states a second call is "a
  harmless no-op" — row 7's regression test is the concrete proof for this specific case, not a new
  requirement on the framework.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) —
  `setTabItalic`/`isTabItalic` (1359-1383) and `setTabBusy`/`isTabBusy` (1397-1420), the two shapes
  `setTabModified`/`isTabModified` mirror; the insertion point is directly after `isTabBusy`.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) —
  `setEntryItalic`/`isEntryItalic` (1587-1607), `setEntryBusy`/`isEntryBusy` (1641-1656 — the
  insertion point), `BarEntry` (199-215, `button: TabButton` at 201), and `computeTabButtonInsets`
  (2050-2077, the close-✕ gutter reservation — a different mechanism from the content-row dot, not
  something this plan needs to touch or extend).
- [`packages/lib/src/typescript/lib/component/button/TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts) —
  `_busy`/`_busyIndicator` (212-217) and `setBusy`/`isBusy` (386-429), the lazy-build-and-toggle
  precedent; `buildCloseButton` (319-352), the `ThemeManager.getResolvedScale()` sizing precedent;
  `destructor` (273-284), which this plan extends.
- [`packages/lib/src/typescript/lib/component/button/SplitButton.ts`](packages/lib/src/typescript/lib/component/button/SplitButton.ts) —
  `_chevron` (88-97), its construction and `_content.addComponent` call (139-156), and
  `_afterRebuildContentRow` (223-227) — the precedent this plan's content-row glyph and its rebuild
  hook mirror. Note `_chevron` is a *permanent* child (never removed), unlike `_modifiedGlyph`; see
  `## Architecture Decisions`.
- [`packages/lib/src/typescript/lib/component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) —
  `_content` (441), `_rebuildContentRow` (1576-1682, calls `_afterRebuildContentRow` at 1681) and
  the `_afterRebuildContentRow` hook itself (1693); `setGlyph`/`clearGlyph` (1766-1819), the
  "detach-then-dispose-explicitly" precedent this plan's destructor fix follows.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) —
  `destructor`'s own child-disposal recursion (990-1049, recursion at 1041-1048),
  `removeComponent`/`removeAllComponents` (6704-6738, both explicitly detach-only), and
  `dispose()`/`destructor()`'s documented double-call idempotency (966-969, 983-988).
- [`packages/lib/tests/component/button/TabButton.styleRuleDisposal.test.ts`](packages/lib/tests/component/button/TabButton.styleRuleDisposal.test.ts) —
  the exact prior fix for this same bug class on `_closeButton` (see
  `plans/implemented/table-toolbar-button-residual-leak.md`), and the `_ruleCacheKeys()`
  before/after diffing pattern this plan's new disposal test reuses.
- [`plans/implemented/tab-label-styling.md`](plans/implemented/tab-label-styling.md) — the direct
  precedent for this plan's three-layer shape, its `## Expected Behaviour` row numbering, its
  `## Documentation Impact` structure (including the `next.md` changelog section shape), and its
  `Tab.tabItalic.test.ts` file this plan's own new test file copies.
- [`packages/lib/tests/layout/Tab.tabItalic.test.ts`](packages/lib/tests/layout/Tab.tabItalic.test.ts) —
  the scaffolding (`CONFIG`, `hostTab`, `barEntries`) `Tab.tabModified.test.ts` copies verbatim.

---

## Non-Goals

- **No close-button hover-swap.** A VS Code-style ✕-becomes-dot-on-dirty affordance was
  investigated by the consumer's own plan and rejected: the library's `:hover` state-tier mechanism
  extracts only a `StyleBag` (colors, borders, shadows), never a glyph's identity, and the only API
  that swaps a glyph (`Button.setGlyph`) rebuilds the content row and recomputes preferred size on
  every call — too expensive to drive from `mouseenter`/`mouseleave` across a tab strip. This plan
  builds only the content-row dot; the close button is completely untouched.
- **No dedicated `--ts-ui-tab-modified-color` override token.** The dot reuses
  `--ts-ui-tab-indicator-color` directly rather than getting its own token with a fallback, unlike
  the busy wash's `--ts-ui-tab-busy-color`. See `## Architecture Decisions`.
- **No `LayoutConstraints` field, no serialization.** The modified flag lives on the live tab button
  only, exactly like the italic flag — a tear-off or re-dock rebuilds the tab clean.
- **No changes to `computeTabButtonInsets` or any other strip layout math.** The dot is a `_content`
  row child, not an overlay competing for the close-✕ gutter; it needs no new inset reservation.

---

## Notes

[^why-italic-not-busy]: `Tab.setTabBusy` routes through a private `setEntryBusy(entry, busy)`
    helper ([Tab.ts:1835-1842](packages/lib/src/typescript/lib/layout/Tab.ts#L1835)) rather than
    calling `this._bar.setEntryBusy(entry.id, busy)` directly, the way `setTabItalic` calls
    `this._bar.setEntryItalic` directly. That helper exists for two busy-specific reasons neither
    the italic flag nor the modified flag needs: it short-circuits a redundant write
    (`if (this._bar.isEntryBusy(entry.id) === busy) { return; }`) and fires a `"busychange"` event
    exactly once per real transition — machinery shared with the deferred/lazy-tab loading state
    machine, which also drives busy through the same helper. `setTabModified` has no event to fire
    and no state machine to share a dedupe point with (`TabButton.setModified` already dedupes
    redundant writes on its own `_modified === modified` check), so it takes `setTabItalic`'s
    simpler direct-call shape instead.

[^no-dedicated-token]: A dedicated `--ts-ui-tab-modified-color` (with a fallback to
    `--ts-ui-tab-indicator-color`, mirroring `--ts-ui-tab-busy-color`) was considered, since it
    would match the busy wash's own precedent exactly. It is left out because the addendum this
    plan formalizes specifies the plain `--ts-ui-tab-indicator-color` reference directly, and
    introducing a new theme token is a larger surface (a `Theme.ts` registration, a docs mention,
    a changelog entry of its own) than this minimal addition needs. A consumer who later wants a
    distinct modified-dot color without touching the underline or busy fallback can prompt a
    follow-up plan to add the token then.

[^dispose-correction]: The Loom-side addendum this plan formalizes explicitly instructed the
    opposite: "**Do not** add `_modifiedGlyph` to the existing `destructor` override," reasoning
    that since `_modifiedGlyph` is "added via `_content.addComponent(...)`... it is a real
    registered child and `Container`'s own child-disposal recursion already reaches it through
    `super.destructor()`." That reasoning holds only while the dot is currently attached. It misses
    two things verified against this repo's actual code: first, `TabButton` never passes through a
    `Container` subclass at all (it extends `ToggleButton` → `Button` → `Component` directly), so
    the recursion in question is `Component.destructor()`'s own, not `Container`'s; second, and
    more importantly, `setModified(false)` detaches the dot from `_content` via `removeComponent`,
    which the framework's own doc comment states is explicitly detach-only ("does not call
    {@link dispose}"). A tab that was dirty, then saved clean, then closed has a `_modifiedGlyph`
    that is not a member of any component's `_components` array at that moment, so no recursion —
    `Container`'s or `Component`'s — ever reaches it. `Button.setGlyph`/`clearGlyph`'s own doc
    comments already name this exact trap for a toggled content-row glyph ("the rebuild only
    detaches, so dispose explicitly... or every swap strands its element and its per-instance
    stylesheet rule"), and this repo has already paid for the same mistake once, on `_closeButton`
    (`plans/implemented/table-toolbar-button-residual-leak.md`, evidenced by
    `TabButton.styleRuleDisposal.test.ts`'s existence). This plan disposes `_modifiedGlyph`
    unconditionally in `destructor()` instead.
