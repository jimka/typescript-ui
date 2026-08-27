---
depends-on: []
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Style Group Removal — Implementation Plan

## Overview

`styleGroup` is a CSS tier between the class tier and the trait tier: many instances of the *same* concrete class opt into one caller-chosen token (`new Button({ styleGroup: "warning-demo" })`) and share one generated `.ClassName--<token>` rule. The first instance to render fixes the shared content; every later member compares against it and falls back to its own `#id` rule on a genuine difference.

The library has exactly one production call site left: `TableHeaderMenuButton` puts its menu glyph into the `"table-header-menu-glyph"` token ([`packages/lib/src/typescript/lib/component/table/Header.ts:150`](packages/lib/src/typescript/lib/component/table/Header.ts#L150)). That site does not need a self-correcting cache — its size comes from two compile-time constants — so it moves onto a declared `StyleTrait`, the same mechanism `SpinButton` and `TabButton` already use for their own glyph sizing.

This plan then deletes the whole `styleGroup` mechanism: the public `ComponentOptions.styleGroup` field with `getStyleGroup`/`setStyleGroup`, the `_groupLayer` per-render cache and its place in the layer stack, `ensureStyleGroupRule` / `styleGroupClassSuffix` / `_groupBags` in [`core/ClassStyleRules.ts:1133-1236`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1133), the demo section built around it, and the tests that cover it. Removing a public, JSDoc'd API is a breaking change; the package is pre-1.0 and the mechanism has no consumer migration path to preserve, so the removal is clean — no shim, no no-op stubs.[^why-remove]

---

## Architecture Decisions

### `TableHeaderMenuButton`'s glyph moves onto a declared `StyleTrait`

Replace `this.getGlyph()?.setStyleGroup("table-header-menu-glyph")` with `this.getGlyph()?.setStyleTrait(TABLE_HEADER_MENU_GLYPH_TRAIT)`, mirroring [`SpinButton.ts:141`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L141) and [`TabButton.ts:344`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L344), which made the same swap in [`plans/implemented/glyph-icon-trait-dedup.md`](implemented/glyph-icon-trait-dedup.md). Instance-level opt-in (`setStyleTrait`), not class-level (`ownStyleTraits`), for the same reason that plan gave: the glyph is a `ButtonIconGlyph`, the class every Button-family leading icon goes through, so a class-level opt-in would hand this size to every other leading icon in the app.[^instance-not-class]

The `this.pinGlyphSize(...)` call on the line above stays. It is not redundant with the trait: `pinGlyphSize` also sets `Button`'s `_glyphSizePinned` flag, which is the authoritative opt-out that stops `_syncGlyphSize` re-tracking the glyph to the title's line height on a theme change.[^pin-stays]

### The trait constant is declared in `Header.ts`, not `core/StyleTraits.ts`

The three existing traits live in [`core/StyleTraits.ts`](packages/lib/src/typescript/lib/core/StyleTraits.ts) because each is shared by two or more unrelated classes. This one has a single owner, and it derives its size from `TRACK_WIDTH` (exported from `component/container/Scrollbar.ts`) and `MENU_BUTTON_CHROME_PX` (module-private to `Header.ts`). Declaring it in `core/StyleTraits.ts` would make a `core/` module import from `component/`, a direction only `core/Panel.ts` takes today.[^local-placement]

### The trait derives its size from `TRACK_WIDTH`, not a frozen literal

`GLYPH_XS_INK_TRAIT` and `GLYPH_MD_INK_TRAIT` hardcode `8` and `14` because their real source is `ThemeManager.getResolvedScale()`, which a module-level constant cannot call. This trait has no such problem: both of its inputs are plain module constants evaluated at import time, so the declaration computes `Math.max(1, TRACK_WIDTH - MENU_BUTTON_CHROME_PX)` directly and stays in lockstep with the `pinGlyphSize` call that uses the same expression.

| Input | Value | Source |
|---|---|---|
| `TRACK_WIDTH` | `12` | [`Scrollbar.ts:51`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L51) |
| `MENU_BUTTON_CHROME_PX` | `4` | [`Header.ts:45`](packages/lib/src/typescript/lib/component/table/Header.ts#L45) |
| `MENU_BUTTON_GLYPH_PX` | `8` | `Math.max(1, 12 - 4)` |

### The demo section is deleted, not rebuilt on a trait

[`StyleAuditPanel.ts:27-47`](packages/lib/src/typescript/StyleAuditPanel.ts#L27) builds five "Grouped" and three "Ungrouped" buttons to manufacture shared-vs-unshared rules for the embedded audit view. Those eight buttons go, along with the explanatory `Text` and the "Shared Instance Style Groups" heading. The panel keeps its title and the `StyleAuditView` itself, which scans the whole app's real stylesheet and needs no manufactured input.[^demo-delete]

### `_owners` stays; only the group-exclusive machinery goes

The `_owners` name-collision registry ([`ClassStyleRules.ts:168`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L168)) is shared by the class, class-state, shared-state, and trait tiers — nine call sites besides the two inside `ensureStyleGroupRule`. Only `_groupBags`, `styleGroupClassSuffix`, and `ensureStyleGroupRule` are group-exclusive. `resolveInstanceStyleDeclarations` ([`Component.ts:307-333`](packages/lib/src/typescript/lib/core/Component.ts#L307)) is also group-exclusive — its single caller is the `ensureStyleGroupRule` call this plan deletes — so it goes too.

---

## Public API

Three exported, JSDoc'd members are removed from `Component` and its options bag. Nothing replaces them.

```typescript
// removed from ComponentOptions
styleGroup?: string | null;

// removed from Component
getStyleGroup(): string | null;
setStyleGroup(group: string | null): this;
```

`ensureStyleGroupRule` and `styleGroupClassSuffix` are exported from `core/ClassStyleRules.ts` but not re-exported from `core/index.ts`, so they are internal and their removal is not consumer-visible.

The generated CSS class `ClassName--<token>` and the CSS rule `.ClassName--<token>` disappear with them. A consumer stylesheet selector targeting `.ButtonIconGlyph--table-header-menu-glyph` no longer matches; `.ts-ui-component.ts-ui-trait-table-header-menu-glyph` matches the same element instead.

---

## Internal Structure

### `component/table/Header.ts` — the replacement trait

Add after `MENU_BUTTON_CHROME_PX` ([line 45](packages/lib/src/typescript/lib/component/table/Header.ts#L45)):

```typescript
/**
 * The menu button's glyph edge, in px — the vertical-scrollbar reservation
 * band (`TRACK_WIDTH`) minus the button's own compact insets. Both inputs are
 * module constants, so this is fixed at import time.
 */
const MENU_BUTTON_GLYPH_PX = Math.max(1, TRACK_WIDTH - MENU_BUTTON_CHROME_PX);

/**
 * The min/max square-size pair every table header's menu icon shares, so all
 * of them use one CSS rule instead of each repeating the same size on its own
 * `#id` rule. `TableHeaderMenuButton` is the only owner, and the size derives
 * from constants declared in this file and in `Scrollbar.ts`, so the trait is
 * declared here rather than in `core/StyleTraits.ts` (which would make a
 * `core/` module import from `component/`). Deliberately *not* folded into
 * `GLYPH_XS_INK_TRAIT` despite resolving to the same 8px today: that trait
 * tracks the theme's `glyphXs` icon step, while this one tracks a fixed
 * scrollbar track width — see plans/implemented/glyph-icon-host-box-migration.md.
 */
const TABLE_HEADER_MENU_GLYPH_TRAIT: StyleTrait = {
    name: "table-header-menu-glyph",
    declarations: {
        minSize: { width: MENU_BUTTON_GLYPH_PX, height: MENU_BUTTON_GLYPH_PX },
        maxSize: { width: MENU_BUTTON_GLYPH_PX, height: MENU_BUTTON_GLYPH_PX },
    },
};
```

Widen the existing type import at [line 25](packages/lib/src/typescript/lib/component/table/Header.ts#L25) to `import type { StyleBag, StyleStateSpec, StyleTrait } from "~/core/ClassStyleRules.js";`.

Replace `TableHeaderMenuButton`'s constructor lines 144-150:

```typescript
        this.pinGlyphSize(MENU_BUTTON_GLYPH_PX);
        // `pinGlyphSize` sets Button's `_glyphSizePinned` opt-out so a theme
        // change never re-tracks this glyph to the title line height; the
        // trait publishes the size as one shared CSS rule across every table.
        this.getGlyph()?.setStyleTrait(TABLE_HEADER_MENU_GLYPH_TRAIT);
```

The trait's generated selector is `.ts-ui-component.ts-ui-trait-table-header-menu-glyph`.

---

## Ordered Implementation Steps

Steps 1-3 move the one call site onto its replacement while `styleGroup` still exists, so the tree typechecks and tests pass at every step. Steps 4-8 then delete the mechanism.

1. **`packages/lib/src/typescript/lib/component/table/Header.ts`** — add `MENU_BUTTON_GLYPH_PX` and `TABLE_HEADER_MENU_GLYPH_TRAIT`, widen the `ClassStyleRules.js` type import, and replace the constructor's `pinGlyphSize` + `setStyleGroup` pair per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'setStyleGroup' packages/lib/src/typescript/lib/component/table/Header.ts` — expect zero matches.

2. **`packages/lib/tests/component/table/HeaderMenuButton.test.ts`** — update the block at lines 259-304: the leading comment (259-263) names the trait instead of the styleGroup token and cites this plan; the `it(...)` description at line 287 says "shared `.ts-ui-component.ts-ui-trait-table-header-menu-glyph` trait rule" instead of the group rule; the assertion at line 303 becomes `expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-table-header-menu-glyph')).toBe(true);`. Add one assertion in the same test: `expect(_ruleCacheHas('.ButtonIconGlyph--table-header-menu-glyph')).toBe(false);`. The four `toBeUndefined()` size assertions are unchanged.
   *Check:* from `packages/lib`, `npx vitest run tests/component/table/HeaderMenuButton.test.ts` — green.

3. **Confirm the tier swap is real.** Temporarily comment out the new `setStyleTrait` line in `Header.ts`; the step-2 test must fail on the trait-rule assertion. Restore the line.

4. **`packages/lib/src/typescript/StyleAuditPanel.ts`** — delete the `new Header("Shared Instance Style Groups")` line, the explanatory `Text`, the `styleGroupDemoRow` loop and its `addComponent` call (lines 27-47). Drop the now-unused `Component`, `HBox`, `Text`, and `Button` imports. Trim the class JSDoc's second sentence so it no longer describes the removed scaffolding.
   *Check:* `npm run typecheck`; `npm run lint`.

5. **`packages/lib/src/typescript/lib/core/Component.ts`** — remove, in this order:
   - `ensureStyleGroupRule` and `styleGroupClassSuffix` from the import at line 26.
   - The `styleGroup` field and its JSDoc, lines 163-168.
   - `resolveInstanceStyleDeclarations` and its JSDoc, lines 307-333.
   - The `_groupLayer` field and its comment, lines 571-575.
   - The `if (options.styleGroup !== undefined) …` dispatch line, 820.
   - `getStyleGroup` and `setStyleGroup` with their JSDoc, lines 1969-2005.
   - `if (this._groupLayer) layers.push(this._groupLayer);` in `styleLayers()` (line 5178) and in `layersBelowInstance()` (line 5232).
   - The three-line group resolution in `applyStyle`, lines 6075-6078.
   - In `init()`: the `const group = …` read, the `groupClass` computation and its comment (lines 7156-7162), and the `...groupClass,` spread inside the `addClass` array at line 7188.

   Then fix every prose reference to the removed tier in the same file: the `_instanceTraitLayer` comment's "like `_groupLayer`" (580), the `_resolvedCache` comment's "or `setStyleGroup`" (602), `setStyleTrait`'s "like `setStyleGroup`, it does not itself validate" (2014), `styleLayers()`'s "then its `styleGroup` (if any)" (5147), `layersBelowInstance()`'s "group (if any), then class" and "above group and class" (5213, 5219), `resolveStyleValue`'s "instance, then group, then class" (5332), `resolveStateStyleValue`'s "(instance, group, class)" (5504), `flushStyleBag`'s "below the instance layer (group, then class)" (5545), and the "class/group-default-only value" comment (5589).
   *Check:* `npm run typecheck`. `grep -n 'roup' packages/lib/src/typescript/lib/core/Component.ts` — exactly one match should survive, the unrelated `destroy()` comment reading "grouped here to keep both eager-teardown".

6. **`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`** — delete the block at lines 1133-1236 (`_groupBags`, `styleGroupClassSuffix`, `ensureStyleGroupRule`, including their comments and JSDoc). Keep `_owners` — it is shared with four other tiers. Then fix the two remaining prose references: `getClassStyleDefaults`'s export note (211-213) no longer mentions `resolveInstanceStyleDeclarations` or `ensureStyleGroupRule` — say instead that it is exported so `core/Component.ts` can resolve a class's own default bag directly; `StyleLayer`'s doc (475) lists "instance, meta-class, class" without "group"; and `ensureTraitStyleRule`'s "Mirrors {@link ensureStyleGroupRule}'s cache/insert shape" (1368) becomes "Mirrors {@link ensureClassStateRule}'s cache/insert shape".
   *Check:* `npm run typecheck`. `grep -in 'stylegroup\|_groupbags' packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — expect zero matches.

7. **`packages/lib/src/typescript/lib/core/StyleTraits.ts`** — in `GLYPH_XS_INK_TRAIT`'s doc comment (line 35), replace "replacing the two separate `styleGroup` tokens (`"spin-glyph"`, `"tab-close-glyph"`)" with "replacing the two separate per-owner tokens `spin-glyph` and `tab-close-glyph` that `plans/implemented/glyph-icon-size-dedup.md` gave them". The mechanism named there no longer exists.
   *Check:* `npm run typecheck`.

8. **Tests.**
   - Delete `packages/lib/tests/core/StyleGroupRules.test.ts` entirely (262 lines, every case is group-specific).
   - `packages/lib/tests/core/StyleLayers.test.ts`: delete `it('row 1: the group layer is scanned before the class layer', …)` (lines 44-75, plus the blank line 76 after it); drop the file header comment's final clause "and a `styleGroup` construction-time option to seed the group layer" (line 11); reword row 3's description (line 93) to `'row 3: styleLayers() returns exactly the instance and class layers'` and drop the leading "with no styleGroup". Rows 2 and 3 keep their bodies unchanged.
   - `packages/lib/tests/core/StyleTraitRules.test.ts`: both comment references to `StyleGroupRules.test.ts` (lines 14 and 58) point at a deleted file — retarget both to `ClassStyleRules.test.ts`, which is where `declarationsDuring` and the module-state caveat originate.

   *Check:* from `packages/lib`, `npx vitest run tests/core/` — green.

9. **`packages/lib/docs/reference/changelog/next.md`** — add the breaking-change entry and amend the stale glyph bullet, per `## Documentation Impact`.

10. **`ARCHITECTURE.md`** — line 154 reads "the per-key dedup against the class/group tier happens later, at flush time". Change "class/group tier" to "class tier". No other line in the file mentions a group tier (lines 85 and 212 use "group" in unrelated senses — drag-feedback colour tiers and the chrome property group).
    *Check:* `grep -n 'group tier\|class/group' ARCHITECTURE.md` — expect zero matches.

11. **Repo-wide regression grep.** From the repo root:
    ```
    grep -rn 'styleGroup\|StyleGroup\|_groupLayer\|_groupBags\|ensureStyleGroupRule\|styleGroupClassSuffix\|groupClass' \
      packages ARCHITECTURE.md CODE_CONVENTIONS.md CLAUDE.md \
      --exclude-dir=node_modules --exclude-dir=dist
    ```
    Expect matches only in `packages/lib/docs/reference/changelog/` — the released `0.7.0.md` page (a historical record, never edited) and the two `next.md` entries step 9 writes. `packages/lib/llms.txt` has no `styleGroup` hit today; confirm it still has none.

12. **Full verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/StyleTraits.ts` |
| Modify | `packages/lib/src/typescript/StyleAuditPanel.ts` |
| Modify | `packages/lib/tests/component/table/HeaderMenuButton.test.ts` |
| Modify | `packages/lib/tests/core/StyleLayers.test.ts` |
| Modify | `packages/lib/tests/core/StyleTraitRules.test.ts` |
| Delete | `packages/lib/tests/core/StyleGroupRules.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `ARCHITECTURE.md` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink. Row 7 is a compile-time check. Row 8 needs a browser.

| # | Case | Expected |
|---|---|---|
| 1 | A second table's header menu-button glyph renders after a first table's has already rendered | Its own `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight`; `_ruleCacheHas('.ts-ui-component.ts-ui-trait-table-header-menu-glyph')` is `true` |
| 2 | The same case, checking the retired selector | `_ruleCacheHas('.ButtonIconGlyph--table-header-menu-glyph')` is `false` |
| 3 | `table.getHeader().getMenuButton().getGlyph()!.getMinSizeConstraint()` | `{ width: 8, height: 8 }` — unchanged; only the tier supplying it changes |
| 4 | A rendered header menu-button glyph's DOM class list | Contains `ts-ui-trait-table-header-menu-glyph`; contains no token ending in `--table-header-menu-glyph` |
| 5 | `styleLayers()` on a plain `Component` subclass with no traits and no active states | Returns exactly two layers, instance then class (`StyleLayers.test.ts` row 3, unchanged) |
| 6 | Constructing and rendering a `TableHeaderMenuButton` | Does not throw. `ButtonIconGlyph` declares no `ownStyleStates`, so its top-priority unguarded state is `Component`'s `.undisplayed` (`{ displayed: false }` → `display`), which shares no CSS property with the trait's `minSize`/`maxSize` — `traitTopStateConflictKeys` returns empty |
| 7 | `new Component({ styleGroup: "x" })`, `c.getStyleGroup()`, `c.setStyleGroup("x")` anywhere in `packages/lib` | Compile error — `npm run typecheck` fails. Verified by the absence of any such call, not by a test |
| 8 | Manual — a table header's menu icon in the live app, and the Style Audit demo tab | The icon renders at 8×8 in the same position as before; the Style Audit tab shows its title and the audit view, with no button row; the audit's results list no `.ButtonIconGlyph--table-header-menu-glyph` and no `.Button--warning-demo` row |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api
```

`npm run docs:api` matters more than usual here: `ensureTraitStyleRule`'s JSDoc contains a `{@link ensureStyleGroupRule}` reference that becomes unresolvable, and typedoc reports an unresolved link as a warning. Step 6 retargets it. The run currently finishes with one pre-existing, unrelated warning (`component/diagram.DiagramEdgeLayer.setEdges` → `Component.onFirstLayout`); this change must not add a second.

Grep invariants — step 11's repo-wide grep, plus the per-step greps in steps 1, 5, 6, and 10.

**Manual browser verification (row 8) is required.** The offline harness records style writes; it does not run a CSS cascade, and it does not render the Style Audit demo tab.

- Start a dev server on a spare port from this worktree (symlink `node_modules` to the repo root first if this worktree has none), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Open the Table demo tab. Read computed `width`/`height` on the header's menu icon — both `8px` — and confirm its class list carries `ts-ui-trait-table-header-menu-glyph`.
- Open the Style Audit tab. Confirm it renders the title and the audit view with no button row above it, and that Refresh produces no row naming `ButtonIconGlyph--table-header-menu-glyph` or `Button--warning-demo`.

---

## Documentation Impact

No doc page outside the changelog mentions `styleGroup` — verified by `grep -rn -i 'stylegroup' packages/lib/docs/ --include=*.md`, which returns hits only under `reference/changelog/`. `packages/lib/llms.txt` has no hit. The API reference is generated by typedoc from the source, so removing the three members updates it automatically.

**`packages/lib/docs/reference/changelog/next.md`** — two edits.

First, append to `## Breaking changes` → `### Core` (after the `DOMSource.getRuleCssText()` paragraph, before the theme-scale paragraph), following the shape `0.6.0.md` and `0.4.0.md` use for a removed member — statement, reason, who is affected:

> `ComponentOptions.styleGroup` is removed, together with `Component.getStyleGroup()` and `Component.setStyleGroup()`. The option let several instances of one concrete class share a generated `.ClassName--<token>` CSS rule, with the first instance to render fixing the shared content. Nothing in the library used it any more: its last consumer, a table header's menu icon, now declares its size as a shared `StyleTrait` instead, which publishes one rule for every owner without depending on render order. The `.ClassName--<token>` DOM class and its CSS rule are gone with it — a consumer stylesheet selector targeting one no longer matches. There is no replacement option and no migration shim: for instances of one class that should look alike, declare a `StyleTrait` and pass it as `styleTrait`, or give them a subclass with its own class defaults. This is a deliberate pre-1.0 cut of an unused mechanism, not an oversight.

Second, amend the stale glyph bullet at [line 516](packages/lib/docs/reference/changelog/next.md#L516), whose last-but-one sentence currently claims the header menu icon is "still on its own `.ButtonIconGlyph--table-header-menu-glyph` `styleGroup` rule". Replace that sentence with:

> A table's header menu icon shares one CSS rule of its own — `.ts-ui-component.ts-ui-trait-table-header-menu-glyph` — kept separate from the `glyphXs` trait because its size comes from a fixed scrollbar track width, not a named icon step.

`packages/lib/docs/reference/changelog/0.7.0.md` announced `ComponentOptions.styleGroup` as an addition. That page is a released record and is **not** edited; the `next.md` entry is what tells a reader the feature was withdrawn.

---

## Potential Challenges

- **`_owners` looks group-specific at the two call sites being deleted, but is shared by four other tiers.** Deleting it breaks the class, class-state, shared-state, and trait tiers' collision checks. Mitigation: step 6 names it explicitly as a keep, and the surviving call sites are listed in `## Architecture Decisions`.
- **`{@link ensureStyleGroupRule}` in `ensureTraitStyleRule`'s JSDoc breaks the docs build, not the typecheck.** A tree that typechecks and tests green can still fail `npm run docs:api`. Mitigation: step 6 retargets the link, and `## Verification` calls the docs run out.
- **The trait's declared 8×8 is byte-identical to `GLYPH_XS_INK_TRAIT`'s, so two CSS rules carry the same body.** That duplication exists today too (a group rule and a trait rule with identical bodies), so this plan does not make it worse. Merging the two is deliberately out of scope — see `## Non-Goals`.
- **Module state in `ClassStyleRules.ts` survives `DOM.reset()` within a test file.** The rewritten `HeaderMenuButton.test.ts` case asserts `_ruleCacheHas('.ButtonIconGlyph--table-header-menu-glyph')` is `false`; that holds because no code can create the rule any more, not because of test ordering.

---

## Critical Files

| File | Why |
|---|---|
| [`plans/implemented/glyph-icon-trait-dedup.md`](implemented/glyph-icon-trait-dedup.md) | The precedent this plan's step 1 mirrors — the exact `setStyleGroup` → `setStyleTrait` swap, why instance-level opt-in is right for a `ButtonIconGlyph`, and the state-conflict check |
| [`plans/implemented/glyph-icon-host-box-migration.md`](implemented/glyph-icon-host-box-migration.md) | Why `TRACK_WIDTH` stays a fixed pixel constant and why the header menu glyph is not an icon-scale consumer — the reason its trait must stay separate from `GLYPH_XS_INK_TRAIT` |
| [`packages/lib/src/typescript/lib/core/StyleTraits.ts`](packages/lib/src/typescript/lib/core/StyleTraits.ts) | The `StyleTrait` shape the new constant copies |
| [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `_owners` (168) and its nine non-group call sites; `ensureTraitStyleRule` (1376) and `traitTopStateConflictKeys` (1438) — the conflict check row 6 relies on |
| [`packages/lib/src/typescript/lib/component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) | `_glyphSizePinned` (508), `_syncGlyphSize` (1689) and `pinGlyphSize` (1835) — why the pin call stays; `ownStyleStates` (394) — why a `backgroundColor` trait on a `Button` would throw |
| [`packages/lib/tests/component/table/HeaderMenuButton.test.ts`](packages/lib/tests/component/table/HeaderMenuButton.test.ts) | The two-table seeding pattern the rewritten test keeps (259-304) |

---

## Non-Goals

- **Merging the new trait into `GLYPH_XS_INK_TRAIT`.** Both resolve to 8px today, by coincidence of a scrollbar track width and a theme icon step. `glyph-icon-host-box-migration.md` investigated and rejected coupling the two design axes; nothing here reopens that.
- **Deleting `plans/implemented/shared-instance-style-groups.md`.** Implemented plans are a historical record of what was built and why, including work later withdrawn.
- **Editing `packages/lib/docs/reference/changelog/0.7.0.md`.** A released changelog page is never rewritten; `next.md` carries the withdrawal.
- **A deprecation shim, no-op stubs, or a compatibility layer for `styleGroup`.** Explicitly ruled out — see `## Overview`.
- **Adding a general "several instances of one class share a rule" replacement.** The trait tier already covers the case that had a real owner. Nothing else in the library needs the first-instance-wins comparison the group tier provided.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^why-remove]: `styleGroup` shipped in the 0.7.0 changelog as a public feature, is demonstrated in the demo app, and has a dedicated test file — the usual reasons to keep an API. The project owner overrode all three: the package is pre-1.0, and public-API status, test coverage, and a changelog entry are not by themselves reasons to keep a mechanism the library does not use. Its one remaining production consumer is better served by the trait tier, which publishes one rule per declared trait with no dependence on render order. The removal is therefore total: no deprecation window, no no-op methods, no re-export kept alive. A consumer who somehow depends on it gets a compile error naming the removed member, which is a clearer signal than a silently inert setter.

[^instance-not-class]: `Button.setGlyph` constructs a `ButtonIconGlyph` for every Button-family leading icon — a plain `Button`, `PickerButton`, `MenuButton`, `WindowControlButton`, and the two `glyphXs` consumers. Declaring `ownStyleTraits` on `ButtonIconGlyph` would size all of them at 8px. Only this one instance opts in, exactly as `SpinButton.ts:141` and `TabButton.ts:344` do for theirs.

[^pin-stays]: `Button._syncGlyphSize` ([Button.ts:1689](packages/lib/src/typescript/lib/component/button/Button.ts#L1689)) re-sizes the leading glyph to the title's rounded line height on every `recomputePreferredSize`, and returns early only when `_glyphSizePinned` is `true` ([:1696](packages/lib/src/typescript/lib/component/button/Button.ts#L1696)). `pinGlyphSize` ([:1835](packages/lib/src/typescript/lib/component/button/Button.ts#L1835)) is the only writer of that flag, and it also calls `setPreferredSize` — which `Glyph` forwards to `setMinSize`/`setMaxSize`, producing the authored instance value the trait tier dedups against. A trait alone sets no flag, so dropping the `pinGlyphSize` call would let the first theme change grow the icon to the (hidden) label's line height.

[^local-placement]: `glyph-icon-trait-dedup.md` put its two constants in `core/StyleTraits.ts` because each is shared across classes with no useful common ancestor, and both derive from `ThemeManager`, which `core/` may import. Neither condition holds here. `core/StyleTraits.ts` currently imports only `type { StyleTrait }`; pulling in `TRACK_WIDTH` would give a `core/` module a runtime dependency on `component/container/Scrollbar.ts`, and `MENU_BUTTON_CHROME_PX` is module-private to `Header.ts` and would have to be exported or duplicated as a literal. A locally-declared trait costs nothing — `ensureTraitStyleRule` keys its cache on the `StyleTrait` object's own identity, not on where it was written.

[^demo-delete]: A trait-based replacement was considered and rejected on two grounds. First, it demonstrates nothing: a trait's content is declared up front, so "five buttons share one rule" is true by construction, whereas the group demo's point was the first-instance-wins-then-compare behaviour that no longer exists. Second, it does not even work on a `Button`: `ensureTraitLayer` throws when a trait's declared property collides with the class's own top-priority unguarded declared state, and `Button.ownStyleStates`'s `.pressed` entry ([Button.ts:394-411](packages/lib/src/typescript/lib/component/button/Button.ts#L394)) resolves `foregroundColor`/`backgroundColor`/`backgroundImage`/`shadow` — so the demo's `backgroundColor: "#b58900"` would throw at first render. Forcing the demo onto some other, contrived property to dodge that is worse than having no demo section. `StyleAuditView` reads the real stylesheet the rest of the demo app builds, so it has plenty to report without manufactured input.
