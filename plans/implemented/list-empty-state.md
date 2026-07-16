# List Empty State + Size-Constraint Cleanup — Implementation Plan

## Overview

Three coupled changes to the `typescript-ui` library, plus a downstream simplification in the `sqladmin` app.

**Library (`typescript-ui`)** — all in [`src/typescript/lib/component/list/AbstractSelectableList.ts`](src/typescript/lib/component/list/AbstractSelectableList.ts) (inherited by `List` and `MultiSelectList`):
- **(A) Opt-in empty state.** New `emptyText` / `emptyComponent` options render a placeholder *inside the list's own scroll area* (`_innerPanel`'s `VBox`) whenever the item set is empty, so an "empty" list is not empty at the layout level.
- **(B) Remove the `clampsToContentSize()` override.** After the row-max fix (below) it is inert for any populated or placeholder-filled list; dropping it lets the `Component` default (`true`) apply.
- **(C) Formalize default size constraints.** Keep a `100×100` default `minSize` but only when the caller did not supply a `minSize` option (fix the current unconditional clobber); leave `maxSize` unbounded (already the class default).

**Precondition already applied in the working tree.** The `SelectableListRow` constructor's `setMaxSize(UNBOUNDED, ROW_HEIGHT_PX)` line ([AbstractSelectableList.ts:275](src/typescript/lib/component/list/AbstractSelectableList.ts#L275) on committed `HEAD`) and the `clampsToContentSize()` override ([AbstractSelectableList.ts:724](src/typescript/lib/component/list/AbstractSelectableList.ts#L724)) have **already been removed** in the uncommitted main-tree edit. The steps below are written idempotently ("ensure removed") so they are correct whether executed against committed `HEAD` (both present) or the current working tree (both gone). The plan still formalizes both removals and adds a breadcrumb comment at the row.

**Consumer (`sqladmin`, repo root `/home/jika/typescript/sqladmin`, worktree `/home/jika/typescript/sqladmin/.worktrees/explorer-resizable-sections`)** — [`frontend/src/shell/QueriesView.ts`](../../../sqladmin/.worktrees/explorer-resizable-sections/frontend/src/shell/QueriesView.ts): rewrite `buildSection` to hold **one** `List` for the section's life, pass `config.empty` as the list's `emptyText`, and delete the hand-rolled hint/list swap-and-rebuild plus its `list: List | null` null-threading and the now-unused `hintText` helper.

---

## Background / Root Cause

The `sqladmin` `explorer-resizable-sections` branch exposed the bug: the Queries rail's resizable accordion gutter was unusable and a short Recent list crushed the Saved list. Chain:

1. Each `SelectableListRow` set `setMaxSize(UNBOUNDED, ROW_HEIGHT_PX)`. `UNBOUNDED === Number.MAX_SAFE_INTEGER` ([Size.ts:18](src/typescript/lib/primitive/Size.ts#L18)), so the row's **width** max was already the unbounded sentinel; only the **height** (`ROW_HEIGHT_PX = 22`) was a genuine cap. The row is already pinned to 22px by its `preferredSize` ([AbstractSelectableList.ts:274](src/typescript/lib/component/list/AbstractSelectableList.ts#L274)), so the height cap did nothing for the row's own layout.
2. `VBox.aggregateMaxSize` ([BoxLayout.ts:292](src/typescript/lib/layout/BoxLayout.ts#L292)) **sums** per-child height maxes on its main axis, so `N` rows capped at 22px each produced a *finite* list content max (`≈ N×22`).
3. `Component.getMaxSize()` ([Component.ts:2482](src/typescript/lib/core/Component.ts#L2482)) returns the tighter (`Math.min`) of the component's own max and the layout manager's max, so the list reported that finite content max.
4. The accordion's resizable distribution `distributeWithinConstraints` ([Accordion.ts:2180](src/typescript/lib/layout/Accordion.ts#L2180)) clamps each open section to `[getMinSize.height, getMaxSize.height]`. For a short list the content max (`hi`) fell **below** the section's intended min floor (`lo`) — a min > max inversion — and the `share > hi` branch pinned the section to `hi`, crushing it and freezing the drag gutter.

**Removing the row's `setMaxSize`** (already done) makes each row report an *unbounded* max (the `Component` default `maxSize` is `{UNBOUNDED, UNBOUNDED}` — [Component.ts:432](src/typescript/lib/core/Component.ts#L432)), so any **populated** list's `VBox` main axis saturates to unbounded and the list grows/fills/drags freely.

**The `clampsToContentSize()` override** existed for the same reason as the row cap. `clampsToContentSize` is consulted only in `Component.clampWidth`/`clampHeight` ([Component.ts:2880](src/typescript/lib/core/Component.ts#L2880) / [Component.ts:2943](src/typescript/lib/core/Component.ts#L2943)): when `true`, `setWidth`/`setHeight` clamp the committed size to the merged content-derived `getMinSize`/`getMaxSize`; when `false`, only to the component's own explicit constraints. The list overrode it to `false` so the finite content max couldn't clamp the committed height below its allocated region. Note `AbstractInput extends Component` **directly** ([AbstractInput.ts:55](src/typescript/lib/component/input/AbstractInput.ts#L55)) — not `Container`/`Panel` — so the list does **not** inherit the `false` from `Container`; its override was genuinely load-bearing, not redundant. After the row fix it is **inert for any populated or placeholder-filled list** (their content max is unbounded, so nothing clamps). The one residual case it still affected — a genuinely empty list (0 rows) whose empty `VBox` reports a finite `≈insets` max — is exactly what the opt-in empty state now fills.

**`Cell`'s** `clampsToContentSize()` override ([Cell.ts:106](src/typescript/lib/component/table/cell/Cell.ts#L106)) is for a *legitimately* capped child (`BooleanCell`'s 16×16 checkbox) and **must stay**. Only the **list** override is removed.

---

## Architecture Decisions

### Placeholder lives inside `_innerPanel`, filled via a `weight` constraint

The empty placeholder is added as a child of the list's inner scroll panel `_innerPanel` ([AbstractSelectableList.ts:675](src/typescript/lib/component/list/AbstractSelectableList.ts#L675)) — the same `VBox` the rows live in — so an "empty" list has a real child and is not empty at the layout level. It is added with `addComponent(placeholder, { weight: 1 })`: the inner `VBox` already runs `stretching: true` (fills the cross axis / width), and a single `weight: 1` child absorbs all leftover **main-axis** (height) space, so the placeholder visually fills the scroll area (matching `sqladmin`'s prior "text fills the entire space"). The `weight` pattern is the framework idiom for a filling child (see [VideoPlayer.ts:624](src/typescript/lib/component/display/VideoPlayer.ts#L624), [NumberSpinner.ts:123](src/typescript/lib/component/input/NumberSpinner.ts#L123)).

The load-bearing property, though, is the **max**: a placeholder child reporting an *unbounded* max makes `VBox.aggregateMaxSize` saturate the list's content max to unbounded, so an empty+placeholder list grows and drag-resizes exactly like a populated one. A plain `Text` reports an unbounded max (it overrides `getMinSize`/`getPreferredSize` but **not** `getMaxSize`, so it inherits the `Component` default unbounded max), so the default `emptyText` placeholder satisfies this for free.

### Surface: `emptyText` (sugar) + `emptyComponent` (primitive)

Two options, mutually exclusive, `emptyComponent` winning when both are set:
- `emptyText?: string` — the ergonomic 90% case (the `sqladmin` consumer needs exactly this). Builds a muted, horizontally-centered single-line `Text`.
- `emptyComponent?: () => Component` — a thin factory hook for richer empty states (icon + message + call-to-action) so a consumer is not forced to subclass or reach past the API. It reuses the same one-slot machinery — one option field, one setter, one branch in the builder — so it adds no coordination, only a documented escape hatch. Rejected: `emptyText` only (too limiting for the common icon+text empty state); a full `EmptyState` component (over-built — composition of existing `Text`/`Panel` already covers it, per ARCHITECTURE.md *Compose before specializing*).

The placeholder is built **lazily and cached** in a single `_emptyPlaceholder` field: constructed on first need, then added/removed from `_innerPanel` across empty↔populated transitions without rebuild or disposal. This sidesteps repeated `Text` theme-listener churn and the `dispose()`-on-removal question. If neither option is set, the placeholder is **never built** — an opted-out empty list has no placeholder child (requirement: respect opt-out).

### Muted color from the list-scoped theme token

The default `Text` placeholder's foreground uses `var(--ts-ui-list-row-disabled-color, rgb(170, 170, 170))` — the existing list-context muted token ([Theme.ts:1096](src/typescript/lib/core/Theme.ts#L1096), value `rgb(170, 170, 170)` in both shipped themes). This keeps the placeholder theme-reactive and library-owned rather than hardcoding a gray. (The `sqladmin` consumer previously used its own `MUTED_TEXT_COLOR = rgb(140,140,140)`; the slightly different shade is acceptable and now centrally themed.)

### Default `minSize` becomes overridable; `maxSize` stays unbounded

`setMinSize(100, 100)` at [AbstractSelectableList.ts:682](src/typescript/lib/component/list/AbstractSelectableList.ts#L682) runs in the constructor body *after* `super()` applied options, so it currently **clobbers** any caller-supplied `minSize`. Guard it: apply the `100×100` default only when the caller passed no `minSize` — detectable via `this._options.minSize === undefined`, because `Component.applyOptions` writes `_options.minSize` only when the option is present ([Component.ts:506](src/typescript/lib/core/Component.ts#L506)); the class default `{0,0}` lives in `_defaultOptions`, not `_options`. `maxSize` is already unbounded via `_defaultAbstractSelectableListOptions` ([AbstractSelectableList.ts:130](src/typescript/lib/component/list/AbstractSelectableList.ts#L130)); leave it. Net: the list grows from `minSize` to unbounded.

### Intentional trade-off — max behavior across three cases (both axes)

With the row cap gone, `clampsToContentSize` back to the default `true`, and the empty state opt-in:

| Case | Content max (H and W) | Committed-size behavior |
|---|---|---|
| **Populated** (≥1 row) | Each row reports unbounded max → `VBox` saturates both axes → **unbounded** | Grows/fills/drags freely from `minSize`. |
| **Empty + placeholder** (fills) | Placeholder child reports unbounded max → **unbounded** | Grows freely, same as populated. |
| **Empty + no placeholder** (opt-out) | Empty `VBox` → main axis `≈` perimeter insets, cross axis `≈` perimeter → **finite (`≈` insets)** | With `clampsToContentSize` default `true`, `clampHeight` first caps to the finite content max then floors at `minSize` (min applied last, so min wins on the min>max inversion) → **sits at its `minSize`, cannot stretch beyond it.** |

The opt-out empty case is the only behavior change, and it is **preferable**: an empty box at its `minSize` beats a huge blank scroll region. It only affects a list that opted out of the empty state entirely.

### No new architecture-rule violations

New options follow the three DOM-write rules: `emptyText`/`emptyComponent` are consumer-configurable, cached in `_options`, dispatched by `applyOptions`, and exposed via typed setters. They carry no CSS/DOM write of their own (they add/remove a child component), so no `setElement*` seam is involved. `Text` is imported from `~/component/input/Text.js` — no import cycle (`Text` does not import the list module).

---

## Public API

Added to [`AbstractSelectableList.ts`](src/typescript/lib/component/list/AbstractSelectableList.ts); inherited unchanged by `List` and `MultiSelectList` (no edits to `List.ts` / `MultiSelectList.ts`).

```typescript
// On AbstractSelectableListOptions:
interface AbstractSelectableListOptions extends AbstractInputOptions {
    // ...existing...
    /** Muted placeholder text shown inside the scroll area when the list is empty. */
    emptyText?:      string;
    /**
     * Factory for a custom empty-state placeholder, shown inside the scroll area
     * when the list is empty. Takes precedence over `emptyText`. The returned
     * component should report an unbounded max (the Component default) so the
     * empty list still fills and drag-resizes.
     */
    emptyComponent?: () => Component;
}

// On AbstractSelectableList<TValue, TOptions>:
setEmptyText(text: string | null): this;
getEmptyText(): string | null;
setEmptyComponent(factory: (() => Component) | null): this;
getEmptyComponent(): (() => Component) | null;

// Internal:
protected syncEmptyPlaceholder(): void;   // toggles the placeholder against _items.length
private   buildEmptyPlaceholder(): Component;
```

Backing state (new private fields on `AbstractSelectableList`):
```typescript
/** Cached placeholder instance (built lazily on first empty state); null until needed. */
private _emptyPlaceholder: Component | null = null;
/** Whether _emptyPlaceholder is currently a child of _innerPanel. */
private _placeholderAttached: boolean = false;
```
`emptyText` / `emptyComponent` are stored in `_options` (the options bag is the cache); the setters re-run `syncEmptyPlaceholder()`.

---

## Internal Structure

`buildEmptyPlaceholder()` (called once per configured empty state, cached):
```typescript
private buildEmptyPlaceholder(): Component {
    const factory = this._options.emptyComponent;
    if (factory) {
        return factory();
    }

    // Muted, centered single-line hint using the list-scoped disabled token.
    const text = new Text(this._options.emptyText ?? "", { textAlign: "center" });
    text.setForegroundColor("var(--ts-ui-list-row-disabled-color, rgb(170, 170, 170))");

    return text;
}
```

`syncEmptyPlaceholder()` (called at the tail of `syncRows`, from the setters, and once in the constructor after the empty-state options dispatch):
```typescript
protected syncEmptyPlaceholder(): void {
    const configured = this._options.emptyComponent !== undefined || this._options.emptyText !== undefined;
    const wants      = configured && this._items.length === 0;

    if (wants) {
        if (!this._emptyPlaceholder) {
            this._emptyPlaceholder = this.buildEmptyPlaceholder();
        }

        if (!this._placeholderAttached) {
            // weight: 1 makes the single child absorb all leftover main-axis
            // height so the placeholder fills the scroll area; the inner VBox's
            // stretching:true fills the width.
            this._innerPanel.addComponent(this._emptyPlaceholder, { weight: 1 });
            this._placeholderAttached = true;
        }
    } else if (this._placeholderAttached && this._emptyPlaceholder) {
        this._innerPanel.removeComponent(this._emptyPlaceholder);
        this._placeholderAttached = false;
    }
}
```

`setEmptyText` / `setEmptyComponent` write `_options`, drop any cached placeholder so the next show rebuilds it, then re-sync:
```typescript
setEmptyText(text: string | null): this {
    this._options.emptyText = text ?? undefined;
    this.resetEmptyPlaceholder();   // detach + null _emptyPlaceholder
    this.syncEmptyPlaceholder();
    return this;
}
```
(`setEmptyComponent` mirrors it for `_options.emptyComponent`. `resetEmptyPlaceholder()` removes the current placeholder from `_innerPanel` if attached and nulls `_emptyPlaceholder` so a config change rebuilds.)

---

## Ordered Implementation Steps

### Part A — `typescript-ui` library (`src/typescript/lib/component/list/AbstractSelectableList.ts`)

1. **Import `Text`.** Add `import { Text } from "~/component/input/Text.js";` alongside the existing imports (top of file). `Component` is already imported.

2. **Add the options.** In `AbstractSelectableListOptions` (~[L83](src/typescript/lib/component/list/AbstractSelectableList.ts#L83)) add the `emptyText?: string` and `emptyComponent?: () => Component` fields with the JSDoc from *Public API*.

3. **Add backing fields.** In the `AbstractSelectableList` class body (near the other private fields, ~[L623](src/typescript/lib/component/list/AbstractSelectableList.ts#L623)) add `_emptyPlaceholder` and `_placeholderAttached` per *Public API*.

4. **Ensure the row height cap is removed + add the breadcrumb.** In the `SelectableListRow` constructor, ensure the `this.setMaxSize(Number.MAX_SAFE_INTEGER, ROW_HEIGHT_PX);` line is **removed** (it is already gone in the working tree; remove it if executing against committed `HEAD`). Immediately after `this.setPreferredSize(0, ROW_HEIGHT_PX);` (~[L274](src/typescript/lib/component/list/AbstractSelectableList.ts#L274)) add a breadcrumb comment:
   ```typescript
   // Do NOT cap the row's max height. A finite per-row height max makes the
   // list's VBox sum to a finite content max (VBox.aggregateMaxSize), which
   // shrink-wraps the whole list to its content and breaks stretch/scroll and
   // the accordion's resizable drag. The row is already pinned to ROW_HEIGHT_PX
   // by its preferredSize above; leave its max unbounded (the Component default).
   ```
   - Checkpoint: `grep -n 'setMaxSize' src/typescript/lib/component/list/AbstractSelectableList.ts` — expect **zero** matches.

5. **Ensure the `clampsToContentSize()` override is removed.** Delete the `protected clampsToContentSize(): boolean { return false; }` method and its JSDoc (~[L712–725](src/typescript/lib/component/list/AbstractSelectableList.ts#L724)) if present (already removed in the working tree).
   - Checkpoint: `grep -n 'clampsToContentSize' src/typescript/lib/component/list/AbstractSelectableList.ts` — expect **zero** matches.

6. **Make the default `minSize` overridable.** Replace the unconditional `this.setMinSize(100, 100);` (~[L682](src/typescript/lib/component/list/AbstractSelectableList.ts#L682)) with a guard:
   ```typescript
   // Default floor, but let a caller-supplied minSize option win. _options.minSize
   // is set by the super() cascade only when the caller passed one (the class
   // default {0,0} lives in _defaultOptions), so its presence means "caller set it".
   if (this._options.minSize === undefined) {
       this.setMinSize(100, 100);   // 100×100 keeps a short empty/placeholder list a usable size
   }
   ```

7. **Store the new options in `applyOptions`.** In `applyOptions` (~[L755](src/typescript/lib/component/list/AbstractSelectableList.ts#L755)), after the existing pure `_options` writes, add:
   ```typescript
   if (options.emptyText      !== undefined) this._options.emptyText      = options.emptyText;
   if (options.emptyComponent !== undefined) this._options.emptyComponent = options.emptyComponent;
   ```

8. **Add the placeholder methods.** Add `syncEmptyPlaceholder` (protected), `buildEmptyPlaceholder` (private), `resetEmptyPlaceholder` (private), and the `setEmptyText` / `getEmptyText` / `setEmptyComponent` / `getEmptyComponent` accessors per *Internal Structure* and *Public API*, with full JSDoc per CODE_CONVENTIONS.md.

9. **Toggle from `syncRows`.** At the end of `syncRows` (~[L1244](src/typescript/lib/component/list/AbstractSelectableList.ts#L1244), after the add/remove reconciliation) call `this.syncEmptyPlaceholder();`. This covers `setItems` / `addItem` / `refreshFromStore` / `setRendererFactory` (all route through `syncRows` inside a `pauseLayout`/`resumeLayout` block, so any transient placeholder/row coexistence never renders).

10. **Dispatch the empty-state options at construction.** In the constructor, **after** the existing `items` / `store` dispatch block (~[L699–709](src/typescript/lib/component/list/AbstractSelectableList.ts#L699)) — so a list built *with* items correctly shows no placeholder — add:
    ```typescript
    if (this._options.emptyText !== undefined || this._options.emptyComponent !== undefined) {
        this.syncEmptyPlaceholder();
    }
    ```
    (Needed because a list constructed empty-with-`emptyText` and no `items`/`store` never calls `syncRows` during construction.)

### Part B — `sqladmin` consumer (`frontend/src/shell/QueriesView.ts`, repo root `/home/jika/typescript/sqladmin`)

Read the file first: [`frontend/src/shell/QueriesView.ts`](../../../sqladmin/.worktrees/explorer-resizable-sections/frontend/src/shell/QueriesView.ts).

11. **Rewrite `buildSection`** (~L194–271) to hold one `List` for the section's life:
    - Build the list **once**, before `refresh`: `const list = buildList(config.empty);` (see step 12), then `wireRow(list, () => rows, config, menu);`, `list.on("change", syncTools);`, `host.addComponent(list);`.
    - Replace `refresh` body with:
      ```typescript
      const refresh = (): void => {
          rows = config.rows();
          list.setItems(rows.map(row => ({ key: row.key, label: row.label, glyph: "terminal", tooltip: row.sql })));
          syncTools();
      };
      ```
      Delete the `host.removeAllComponents()`, the `rows.length === 0` branch (hint swap), the `list = null` / rebuild, and the manual `host.doLayout()` calls.
    - Delete `let list: List | null = null;` (~L206) — `list` is now a `const`, never null.
    - `syncTools` (~L238): `const on = list.getSelectedIndex() >= 0;` (drop the `list !== null &&`).
    - `focusList` (~L248): drop the `if (!list) { return; }` guard; `const target = list;`.

12. **Fold `emptyText` into `buildList`** (~L337). Change its signature to `buildList(emptyText: string): List`, pass `emptyText` in the `List` options, and **remove** the internal `list.setItems(...)` call (items are now set by `refresh`). The `preferredSize: { width: 0, height: 0 }` and `rendererFactory` stay unchanged (the list's default `minSize` is unaffected — the section's `host` still supplies the `SECTION_MIN_HEIGHT` floor).

13. **Update `wireRow`** (~L282) to read live rows: change the second parameter to `getRows: () => QueryRow[]` and index via `getRows()[index]` in all three handlers (dblclick, keydown, contextmenu). (`selectedRow`'s callers already close over the live `rows` variable, so `selectedRow` only needs its `list: List | null` narrowed to `list: List` — step 14.)

14. **Drop the null types.** `selectedRow(list: List, rows: QueryRow[])` (~L322): remove `| null` and the `?.` (`const index = list.getSelectedIndex();`). Update `Section.host`'s doc comment (~L176) — it no longer "swaps between the list and the empty hint".

15. **Remove `hintText` and now-dead imports.** Delete `hintText` (~L383–389). Remove `import { Text } ...` (L27) and `MUTED_TEXT_COLOR` from the theme import (L40) — both were used *only* by `hintText`.
    - Checkpoint: `grep -n 'hintText\|MUTED_TEXT_COLOR\|List | null\|list = null' frontend/src/shell/QueriesView.ts` — expect **zero** matches. `grep -n '\bText\b' frontend/src/shell/QueriesView.ts` — expect zero matches (no other `Text` use).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `typescript-ui`: `src/typescript/lib/component/list/AbstractSelectableList.ts` (options, fields, empty-state methods, minSize guard, breadcrumb; ensure row `setMaxSize` + `clampsToContentSize` override removed) |
| Modify | `typescript-ui`: `tests/component/list/List.test.ts` (or a new sibling) — unit tests per *Expected Behaviour* |
| Modify | `typescript-ui`: `tests/component/list/RegionFill.test.ts` — **drift, see below**: flip the `still reports the content-derived getMaxSize` case (L132–143, asserts `288`) to expect `UNBOUNDED`, and refresh the header rationale (L23–30) + that test's name. The 7 region-fill cases stay green (fill now comes from rows reporting unbounded max, not from `clampsToContentSize`-decoupled reporting). |
| Modify | `sqladmin`: `frontend/src/shell/QueriesView.ts` (single-list rewrite; drop hint swap, null-guards, `hintText`, unused imports) |

No files created or deleted. `List.ts` / `MultiSelectList.ts` are **not** touched (options inherited).

### Drift — `RegionFill.test.ts` reverses a prior tested decision

`RegionFill.test.ts` was added when `clampsToContentSize() === false` was introduced as the region-fill fix. It encodes that design: rows stay capped → a populated list keeps reporting a *finite* content max (`CONTENT_HEIGHT_13 = 288`), and `clampsToContentSize=false` decouples the self-clamp so the list still fills its region. Test #7 (`still reports the content-derived getMaxSize`, L132–143) asserts that finite report explicitly.

This plan reverses the *mechanism*: uncap the rows (populated content max → `UNBOUNDED`) and drop `clampsToContentSize`. Region-fill is preserved (verified case-by-case: 7 of 8 tests still pass), but test #7 fails by design — reporting a finite content max is the exact behavior that caused the accordion crush this plan fixes. Test #7 must flip to `UNBOUNDED`; the other cases stay as regression guards under the new mechanism.

---

## Expected Behaviour

**Unit-testable (offline harness — construct via `new _List({...})`, no render):**

1. **Populated list → unbounded content max.** `new _List({ items: ['a','b'] })` → `list.getMaxSize().height === UNBOUNDED` and `.width === UNBOUNDED`.
2. **`emptyText` on an empty list → placeholder child present + unbounded max.** `new _List({ emptyText: 'None' })` → `_innerPanel` has exactly one child, it is a `Text`, its `getMaxSize().height === UNBOUNDED`, and `list.getMaxSize().height === UNBOUNDED`. (Widen `_innerPanel` to public via a `TestList` subclass, as `List.test.ts` already does for protected members.)
3. **Opt-out (no empty option) → no placeholder child.** `new _List({})` → `_innerPanel` has **zero** children; `list.getMaxSize().height` is finite (`< UNBOUNDED`).
4. **Placeholder toggles with items.** Construct `new _List({ emptyText: 'None' })` (1 child) → `setItems(['a'])` → `_innerPanel` children are rows only, no placeholder → `setItems([])` → placeholder present again.
5. **`emptyComponent` precedence.** `new _List({ emptyText: 'x', emptyComponent: () => new _Text('y') })` empty → the child is the factory's component, not the `emptyText` `Text`.
6. **Caller `minSize` overrides the default.** `new _List({ minSize: { width: 40, height: 30 } })` → `list.getMinSizeConstraint()` is `{40,30}` (not `100×100`); `new _List({})` → `getMinSizeConstraint()` is `{100,100}`.
7. **Existing list behavior preserved.** All current `List.test.ts` / `MultiSelectList.test.ts` cases still pass (setItems keying, selection, type-ahead, store binding, context-menu/dblclick, tooltips).

**Manual (UI / geometry / drag — not offline-testable):**

8. Queries rail, both sections populated (Saved + Recent): drag the gutter both directions — each section resizes smoothly, neither crushes the other, gutter never freezes.
9. An empty section (e.g. no saved queries) shows the muted centered placeholder filling the section body; dragging the gutter still grows/shrinks that section (placeholder fills, no min>max crush).
10. Selecting/keyboard/double-click/context-menu behave as before on a populated section; an empty section's placeholder is inert (no selection, no keyboard action).
11. Database and Roles rails (other `Accordion`/list users) still behave — no regression from the `clampsToContentSize`/minSize change.
12. `typescript-ui` demo panels using `List`/`MultiSelectList` — `SplitPanel`, `LayoutTestPanel`, `BorderPanel`, `AccordionDemoPanel`, `MiscPanel` (glyph list), `MultiSelectListPanel` — render with correct sizing; verify any that construct an initially-empty list without `emptyText` sit at min (expected) rather than mis-stretching, and populated ones fill/scroll as before.

---

## Verification

**Library (`typescript-ui`):**
- `npm run typecheck` (or the repo's TS check) — clean.
- `npm test` (vitest) — new tests 1–7 above pass; full list suite green.
- Grep invariants (from steps 4, 5): zero `setMaxSize` and zero `clampsToContentSize` matches in `AbstractSelectableList.ts`.
- `npm run docs:build` (TypeDoc) — zero warnings (new public `emptyText`/`emptyComponent` + setters carry JSDoc; per CODE_CONVENTIONS.md, no `{@link}` to `private`/`protected` symbols).
- **`npm run build:lib`** — required so the change reaches consumers; `sqladmin` imports the built, symlinked `dist/lib`, so a plain `npm run build` (app bundle) does **not** update the library artifact.

**Consumer (`sqladmin`):**
- `npm run typecheck` in `frontend/` — clean (confirms the null-guard removals type-check).
- Grep invariants (step 15): zero `hintText` / `MUTED_TEXT_COLOR` / `List | null` / `list = null` / bare `Text` matches in `QueriesView.ts`.
- Drive the app (log in via Host `sqladmin-db` per the app's login flow) and exercise the Queries rail per manual cases 8–10; confirm Database/Roles rails (case 11) unaffected.

**Order:** library typecheck+tests → `build:lib` → consumer typecheck → drive app. (In a worktree, run backend/pytest and frontend checks per the repo's worktree notes; ensure `node_modules` is symlinked to the main tree for the `sqladmin` frontend.)

---

## Potential Challenges

- **Opt-out empty demos may visibly change.** A demo that constructs `new List()` and leaves it empty (no `emptyText`) now sits at its `minSize` instead of stretching to fill its region (the documented trade-off). Mitigation: confirm the demo panels in manual case 12 all populate items promptly; if any intentionally shows a blank list, give it an `emptyText`.
- **Placeholder membership tracking.** Reconciling the placeholder via the `_placeholderAttached` boolean (not `getComponents().includes`) avoids double-add/double-remove. Mitigation: the single `syncEmptyPlaceholder` is the only mutator of `_placeholderAttached`, called from `syncRows`, the setters, and the constructor.
- **`wireRow` reading stale rows.** With a single long-lived list, handlers must read the *current* `rows`, not a construction-time snapshot. Mitigation: pass `() => rows` (step 13) so handlers index the live array after each `refresh` reassigns it.
- **Constructor ordering.** The empty-state dispatch must come *after* the `items`/`store` dispatch so a list built with items shows no placeholder. Mitigation: step 10 places it last.
- **`Text` theme listener.** The cached placeholder `Text` is built once and never disposed while the list lives (removed/re-added, not rebuilt), so its `ThemeManager` subscription is not leaked per toggle. A runtime `setEmptyText` rebuilds via `resetEmptyPlaceholder`; the discarded `Text`'s listener persists until GC — acceptable for a rare runtime reconfig.

---

## Critical Files

- [`src/typescript/lib/component/list/AbstractSelectableList.ts`](src/typescript/lib/component/list/AbstractSelectableList.ts) — the class being changed; `_innerPanel` build (L675), `syncRows` (L1205), constructor dispatch (L648–710), row ctor (L265).
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `clampsToContentSize` default (L2866), `clampWidth`/`clampHeight` (L2880/L2943), `getMaxSize`/`getMinSize` (L2482/L2440), default options (L427–433).
- [`src/typescript/lib/layout/BoxLayout.ts`](src/typescript/lib/layout/BoxLayout.ts) — `aggregateMaxSize` (L292), the sum-of-child-maxes contract.
- [`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts) — `distributeWithinConstraints` (L2180), the min>max crush this fixes.
- [`src/typescript/lib/component/input/Text.ts`](src/typescript/lib/component/input/Text.ts) — placeholder building block (no `getMaxSize` override → unbounded max).
- [`src/typescript/lib/component/table/cell/Cell.ts`](src/typescript/lib/component/table/cell/Cell.ts) — the `clampsToContentSize` override that **must stay** (do not touch).
- [`tests/component/list/List.test.ts`](tests/component/list/List.test.ts) — test harness patterns (`TestList` white-box widening).
- `sqladmin`: `frontend/src/shell/QueriesView.ts` — the consumer rewrite; `ARCHITECTURE.md` *Size constraints* for the sizing contract.

---

## Non-Goals

- No change to `List.ts` / `MultiSelectList.ts` (empty-state options inherited from the abstract base).
- No change to `Cell`'s `clampsToContentSize()` override (a legitimately-capped child; out of scope).
- No new `EmptyState` component — `emptyText`/`emptyComponent` compose existing `Text`/`Component`, per ARCHITECTURE.md *Compose before specializing*.
- No vertical-centering refinement of the default placeholder text beyond `weight`-based fill + horizontal centering (matches the prior consumer look).
