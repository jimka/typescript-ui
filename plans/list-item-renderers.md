# List & ComboBox Item Renderers — Implementation Plan

## Overview

Add a renderer abstraction to the custom-list family (`List`, `MultiSelectList`) mirroring the framework's existing `CellRenderer` / `TreeNodeRenderer` hierarchies, then thread it through `ComboBox`'s dropdown (which embeds a `List`). Ship a default text renderer that reproduces today's plain-label rows exactly, and a concrete `GlyphListItemRenderer` that reads a per-item glyph field and paints a glyph beside the entry label.

Today a list row is a `CustomListRow` ([AbstractCustomList.ts:200](src/typescript/lib/component/list/AbstractCustomList.ts#L200)) — a bare `<div role="option">` whose label is written directly onto its own element via `DOM.sink.apply(el, { text })` in `setLabel` / `render`. There is no per-row sub-component and no renderer seam. The row pool is reconciled in `syncRows` ([AbstractCustomList.ts:957](src/typescript/lib/component/list/AbstractCustomList.ts#L957)); items are the plain `CustomListItem = { key, label }` shape ([AbstractCustomList.ts:24](src/typescript/lib/component/list/AbstractCustomList.ts#L24)). The `ComboBox` dropdown wraps one `List` ([ComboBox.ts:142](src/typescript/lib/component/input/ComboBox.ts#L142)) and forwards items/selection/store to it; the collapsed value is shown by a separate `ComboBoxLabel` span ([ComboBox.ts:354](src/typescript/lib/component/input/ComboBox.ts#L354)).

The design copies the `Tree` seam almost verbatim — `Tree._rendererFactory: () => TreeNodeRenderer` + `setRendererFactory` ([Tree.ts:109](src/typescript/lib/component/tree/Tree.ts#L109), [Tree.ts:437](src/typescript/lib/component/tree/Tree.ts#L437)), each `TreeRow` owning one `_renderer` appended straight into its DOM ([TreeRow.ts:258](src/typescript/lib/component/tree/TreeRow.ts#L258)) and rebound via `renderer.update(context)` + positioned via `renderer.layoutChildren(w, h)` ([TreeRow.ts:179](src/typescript/lib/component/tree/TreeRow.ts#L179), [TreeRow.ts:195](src/typescript/lib/component/tree/TreeRow.ts#L195)). The glyph renderer mirrors `IconLabelTreeNodeRenderer` (glyph + label) ([IconLabel.ts:51](src/typescript/lib/component/tree/renderer/IconLabel.ts#L51)) but sources its glyph from the item field rather than a resolver callback, matching how the table `GlyphRenderer` sources its glyph from the bound value ([Glyph.ts:43](src/typescript/lib/component/table/cell/renderer/Glyph.ts#L43)).

---

## Architecture Decisions

### Mirror `TreeRow` (direct DOM append + manual positioning), not `Fit` + `addComponent`

The row owns one `ListItemRenderer` and appends the renderer's element directly into the row DOM (`DOM.sink.appendChild`), rebinding it in the pool sync and positioning it from an overridden `CustomListRow.doLayout()`. This is chosen over giving the row a `Fit` layout and `addComponent`-ing the renderer because:

- It makes `ListItemRenderer`'s method surface (`update` + `layoutChildren`) **identical** to `TreeNodeRenderer`, so the two renderer systems read as one — the task's stated goal.
- Direct append means the renderer's children never propagate a content-derived preferred/min size up into the pooled row → VBox → list, so the list's current width negotiation and the row's `0×22` preferred / `MAX×22` max / zero content-min truncation behaviour are preserved untouched. A `Fit` child carrying a measured `Text` width would perturb the list's min-width.
- `GlyphListItemRenderer` must place a glyph beside text; `layoutChildren` expresses that directly, whereas a single `Fit` cell cannot.

This follows ARCHITECTURE.md *Positioning is always absolute* ("Override `doLayout` on the owning component" for one-off arrangements), the same carve-out `TreeRow` and `ComboBox` already use.

### The renderer factory **is** on the options bag (diverges from `Tree`, deliberately)

`Tree` exposes `setRendererFactory` as a setter only, with no `TreeOptions.rendererFactory` field. The list family builds its **row pool at construction** from the `items` option (the constructor late-dispatch block calls `setItems` → `syncRows` → builds rows), so a construction-time factory is needed for custom rows (e.g. glyph rows) to paint on **first** render without a post-construction renderer swap. Per CODE_CONVENTIONS.md *Construction* ("configure through the options bag at instantiation") and the plan-skill Public-API rule, the factory is routed as a full option → setter → backing-field triple (named in *Public API*). The setter is dispatched from the constructor body **before** the `items` / `store` dispatch so the pool is built with the right factory.

### `ListItemRenderer` carries only `update` + `layoutChildren` — no `getContentWidth`

`TreeNodeRenderer` also declares `getContentWidth` because `Tree` computes a horizontal scroll extent. The list's inner panel is `autoScroll: "y"` only and stretches rows to full width, so no horizontal extent is ever read. Adding `getContentWidth` would be speculative surface (Behavioural guideline 2), so it is omitted.

### The collapsed `ComboBox` label renders through the same factory

The collapsed control shows the selected entry via a `ListItemRenderer` built from the **same** `rendererFactory` the dropdown list uses, so a `GlyphListItemRenderer` paints the selected entry's glyph on the collapsed control exactly as it appears in the dropdown row. `ComboBoxLabel` is **refactored to delegate to a renderer, not replaced**: today it is a `<span>` that caches `_text` and writes it straight onto its own element in `setLabel` / `render` ([ComboBox.ts:354](src/typescript/lib/component/input/ComboBox.ts#L354)); it becomes a thin host that owns one `ListItemRenderer`, appends the renderer's element in `init()`, and rebinds it via `renderer.update({ item, index })` on every selection change — the same host-shape as `CustomListRow`. Keeping `ComboBoxLabel` as the positioned child means `ComboBox.doLayout`'s label+caret arrangement ([ComboBox.ts:656](src/typescript/lib/component/input/ComboBox.ts#L656)) stays intact; only the label's *content* mechanism changes, and the label's own `doLayout` forwards its box to `renderer.layoutChildren` so the collapsed glyph/text is positioned identically to a dropdown row.

Refactor over replace because `ComboBox` already constructs, holds, and positions `_label` as a `Component` child; swapping its internals preserves every `_label.set*` call site (`setLineHeight` in `doLayout`) and the caret layout, whereas replacing it would ripple through construction and layout. The **empty / no-selection** state feeds the renderer a blank item (`{ key: "", label: "" }`) so `LabelListItemRenderer` shows empty text and `GlyphListItemRenderer` shows no glyph — reproducing today's empty-label behaviour (`computeLabel` returns `""` when nothing is selected — [ComboBox.ts:831](src/typescript/lib/component/input/ComboBox.ts#L831)). **Re-render on selection change** is automatic: every commit path (`setValue`, `setSelectedIndex`, `setItems`, `autoSelectFirstIfEmpty`, `onStoreRefresh`) already funnels through `refreshLabel` ([ComboBox.ts:846](src/typescript/lib/component/input/ComboBox.ts#L846)), which is rewritten to resolve the selected `CustomListItem` + index and call `_label.setItem(item, index)` (feeding the blank item when nothing is selected).

### Per-item glyph source: a `glyph` field on `CustomListItem`, plus a store `glyphField`

Array-supplied items carry the glyph on the item (`CustomListItem.glyph?: string`); store-bound items resolve it from a `ModelRecord` field named by a new `glyphField` option, exactly mirroring how `displayField` / `valueField` already map record fields to `label` / `key` in `refreshFromStore` ([AbstractCustomList.ts:902](src/typescript/lib/component/list/AbstractCustomList.ts#L902)). This keeps presentation data on the item/record, not on the component, per ARCHITECTURE.md *Keep presentation state out of data Models* (the glyph name is domain data the caller supplies, not view state).

---

## Public API

New symbols (all under `~/component/list/`), each `callable()`-wrapped where it is a concrete `Component` subclass:

```typescript
// component/list/ListItemRenderContext.ts
export interface ListItemRenderContext {
    item:  CustomListItem;   // the bound item ({ key, label, glyph? })
    index: number;           // zero-based row index
}

// component/list/ListItemRenderer.ts  (abstract, NOT callable-wrapped — mirrors TreeNodeRenderer)
export abstract class ListItemRenderer extends Component {
    abstract update(context: ListItemRenderContext): void;
    abstract layoutChildren(width: number, height: number): void;
}

// component/list/renderer/Label.ts  (default; mirrors LabelTreeNodeRenderer)
export class LabelListItemRenderer extends ListItemRenderer { /* single Text child */ }

// component/list/renderer/Glyph.ts  (mirrors IconLabelTreeNodeRenderer, glyph sourced from item.glyph)
export class GlyphListItemRenderer extends ListItemRenderer { /* Glyph + Text children */ }
```

New state-bearing property on `AbstractCustomList` (and inherited by `List` / `MultiSelectList`):

```typescript
// AbstractCustomListOptions
rendererFactory?: () => ListItemRenderer;   // option field
glyphField?:      string;                    // store-path glyph source

// AbstractCustomList
private _rendererFactory: () => ListItemRenderer = () => new LabelListItemRenderer();  // backing field (default)
setRendererFactory(factory: () => ListItemRenderer): this;   // swaps renderers on existing pool rows, resyncs
getRendererFactory(): () => ListItemRenderer;
// setStore gains an optional 4th param:
setStore(store: AbstractStore, displayField: string, valueField?: string, glyphField?: string): this;
```

Extended item shape:

```typescript
export interface CustomListItem {
    key:    string;
    label:  string;
    glyph?: string;   // NEW — registry glyph name, read by GlyphListItemRenderer
}
```

`ComboBox` surface additions (forward to the embedded list **and** the collapsed label):

```typescript
// ComboBoxOptions
rendererFactory?: () => ListItemRenderer;
glyphField?:      string;

// ComboBox
setRendererFactory(factory: () => ListItemRenderer): this;   // → dropdown list AND this._label (collapsed control)
getRendererFactory(): () => ListItemRenderer;
setStore(store, displayField, valueField?, glyphField?): this;  // widened to forward glyphField
```

`ComboBoxLabel` (internal, in `ComboBox.ts`) is refactored to host a renderer instead of writing text directly. `setLabel(text)` is replaced by an item-aware rebind:

```typescript
constructor(rendererFactory: () => ListItemRenderer);
setItem(item: CustomListItem, index: number): this;   // replaces setLabel; calls _renderer.update({ item, index })
setRenderer(renderer: ListItemRenderer): this;         // swaps the appended renderer element (mirrors CustomListRow.setRenderer)
setLineHeight(value: number | string): this;           // retained — ComboBox.doLayout still calls it
```

`CustomListRow` (internal) constructor gains the factory and swaps `setLabel` for an item-aware rebind:

```typescript
constructor(onClick: (index: number, event: MouseEvent) => void, index: number, rendererFactory: () => ListItemRenderer);
updateItem(item: CustomListItem, index: number): this;   // replaces setLabel; calls _renderer.update({ item, index })
setRenderer(renderer: ListItemRenderer): this;           // swaps the appended renderer element (mirrors TreeRow.setRenderer)
```

---

## Internal Structure

**`LabelListItemRenderer`** — one `Text` child built with `truncate: true` (its default; single-line clip + ellipsis, min-width capped at 100 so the row shrinks past natural width — [Text.ts:32](src/typescript/lib/component/input/Text.ts#L32)). `clearInsets()` on both renderer and `Text`. `update()` → `this._label.setText(context.item.label)`. `layoutChildren(width, height)` sizes the label to fill the box and sets `line-height = height` for vertical centring (verbatim from [Label.ts:80](src/typescript/lib/component/tree/renderer/Label.ts#L80)). `init()` appends the label element (mirrors [Label.ts:97](src/typescript/lib/component/tree/renderer/Label.ts#L97)).

**`GlyphListItemRenderer`** — `_icon: Glyph | null`, `_label: Text`, `_currentGlyph: string | null`. `update()` reads `context.item.glyph ?? null`; when the name changes it removes the old glyph element and, if the new name is non-null, constructs a fresh `Glyph(name)` (`Glyph` names are immutable, so rebuild-on-change is the established pattern — [IconLabel.ts:84](src/typescript/lib/component/tree/renderer/IconLabel.ts#L84), [Glyph.ts:43](src/typescript/lib/component/table/cell/renderer/Glyph.ts#L43)), `setPointerEvents("none")`, insert before the label. A falsy glyph leaves no icon and the label fills the row (matches the table `GlyphRenderer`'s render-blank-on-falsy contract). `update()` also sets the label text. `layoutChildren` places the icon (vertically centred, `ICON_SIZE` square) and the label to its right, reserving `ICON_WIDTH` only when an icon is present (mirrors [IconLabel.ts:124](src/typescript/lib/component/tree/renderer/IconLabel.ts#L124)).

**`CustomListRow`** — drop the `_text` field and the direct text write in `render()`; build `_renderer = rendererFactory()` in the constructor, append it in a new `init()` override (mirrors [TreeRow.ts:258](src/typescript/lib/component/tree/TreeRow.ts#L258)). `updateItem(item, index)` → `this._renderer.update({ item, index })`. Add a `doLayout()` override: after `super.doLayout()`, position the renderer to fill the row's inner (padding) box — `getWidth()`/`getHeight()` minus the row's `Insets(0,8,0,8)` padding — via `setAutoCommitStyle(false)` … `setX/setY/setWidth/setHeight` … `setAutoCommitStyle(true)`, then `this._renderer.layoutChildren(innerW, innerH)`. `setRenderer(next)` removes the old renderer element and appends the new one (mirrors [TreeRow.ts:86](src/typescript/lib/component/tree/TreeRow.ts#L86)); used by `setRendererFactory`.

**`AbstractCustomList.setRendererFactory`** — mirrors [Tree.ts:437](src/typescript/lib/component/tree/Tree.ts#L437): store the factory, call `row.setRenderer(factory())` on every existing pool row, then re-run `syncRows()` so each row's renderer receives a fresh `updateItem` before the next layout.

**`ComboBoxLabel`** — drop the `_text` field and the direct text write in `setLabel`/`render`; take the factory in the constructor, build `_renderer = rendererFactory()`, and append it in an `init()` override (host-shape identical to `CustomListRow`). `setItem(item, index)` → `this._renderer.update({ item, index })`. `setRenderer(next)` removes the old renderer element and appends the new one (used by `ComboBox.setRendererFactory` to re-skin the collapsed control in step with the dropdown). Add a `doLayout()` override that, after `super.doLayout()`, sizes the renderer to fill the label box and calls `this._renderer.layoutChildren(width, height)`; `setLineHeight` is retained (still called by `ComboBox.doLayout`) but now applies to the hosted renderer's element rather than a bare span — the `LabelListItemRenderer` already matches line-height to its box in `layoutChildren`, so the collapsed line stays centred. `ComboBox.computeLabel` becomes `computeSelectedItem(): { item: CustomListItem; index: number }`, returning the selected item and index (or the blank item `{ key: "", label: "" }` at index `-1` when nothing is selected); `refreshLabel` calls `this._label.setItem(item, index)`.

**`ComboBox` factory forwarding** — `setRendererFactory` writes `_options.rendererFactory`, then forwards to **both** `this._dropdown.getList().setRendererFactory(factory)` and `this._label.setRenderer(factory())`, and finally calls `refreshLabel()` so the collapsed control rebinds through the new renderer immediately. At construction, the same forwarding runs before the `items`/`store` late-dispatch (the `_label` is built with the factory up front, so first paint already uses it).

---

## Ordered Implementation Steps

1. **`component/list/ListItemRenderContext.ts`** — new interface (`item`, `index`), documented like `TreeNodeRenderContext`.
2. **`component/list/ListItemRenderer.ts`** — new abstract class extending `Component`, two abstract methods. Not `callable()`-wrapped (abstract).
3. **`component/list/renderer/Label.ts`** — `LabelListItemRenderer`, `callable()`-wrapped per ARCHITECTURE.md. Copy the `Text`/line-height logic from `LabelTreeNodeRenderer`.
4. **`component/list/renderer/Glyph.ts`** — `GlyphListItemRenderer`, `callable()`-wrapped. Reads `context.item.glyph`; rebuild-glyph-on-change; falsy → no icon. Register no glyphs here (caller registers via `Glyph.register`, as the table glyph cell renderer does).
5. **`AbstractCustomList.ts`** — (a) add `glyph?: string` to `CustomListItem`; (b) add `rendererFactory?` / `glyphField?` to `AbstractCustomListOptions`; (c) add `_rendererFactory` backing field + `setRendererFactory` / `getRendererFactory`; (d) capture both new options pure in `applyOptions`; (e) in the constructor late-dispatch block, call `setRendererFactory(this._options.rendererFactory)` **before** the `store` / `items` dispatch; (f) `setItems` / `addItem` carry `glyph` through the `{ key, label }` build; (g) widen `setStore` with `glyphField?`, write `_options.glyphField`, and have `refreshFromStore` set `glyph: glyphField ? String(record.get(glyphField)) : undefined`.
6. **`CustomListRow`** (in `AbstractCustomList.ts`) — constructor factory param, `_renderer` field, `init()` append, `updateItem` (replacing `setLabel`), `setRenderer`, `doLayout` override; remove `_text` / `setLabel` / `getLabel` / direct-text `render`. Update the two `syncRows` call sites (`row.setLabel(...)` → `row.updateItem(this._items[i], i)`; `new CustomListRow(cb, i)` → `new CustomListRow(cb, i, this._rendererFactory)`).
7. **`ComboBox.ts` — `ComboBoxLabel` refactor** — take a `rendererFactory` constructor arg, build `_renderer` from it, append in `init()`; replace `setLabel`/`_text`/direct-text `render` with `setItem(item, index)`; add `setRenderer` and a `doLayout` override forwarding to `renderer.layoutChildren`; retain `setLineHeight`.
8. **`ComboBox.ts` — surface wiring** — add `rendererFactory?` / `glyphField?` to `ComboBoxOptions`; capture pure in `applyOptions`. Build `_label = new ComboBoxLabel(this._options.rendererFactory ?? (() => new LabelListItemRenderer()))`. In the constructor, after `_dropdown` is built and **before** the `items`/`store` dispatch, forward `this._options.rendererFactory` to `this._dropdown.getList().setRendererFactory(...)` (the `_label` already holds it). Replace `computeLabel` with `computeSelectedItem` and rewrite `refreshLabel` to call `this._label.setItem(item, index)` (blank item at `-1` when nothing selected). Add `setRendererFactory` (forwards to inner list **and** `_label.setRenderer`, then `refreshLabel()`) / `getRendererFactory`; widen `setStore` to forward `glyphField` into `list.setStore(...)`.
9. **`component/list/index.ts`** — export `ListItemRenderer`, `LabelListItemRenderer`, `GlyphListItemRenderer`, and `type ListItemRenderContext`. (No tsconfig/vite/package subpath entry needed — these are re-exported through the existing `list` barrel exactly as the tree renderers are re-exported through `tree/index.ts`.)
10. **Regression checkpoint** — `grep -rn '\.setLabel(' src/typescript/lib/component/{list,input}/` → expect zero (both `CustomListRow` and `ComboBoxLabel` migrated off `setLabel`). `npx tsc --noEmit` clean.
11. **Tests** — steps in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/list/ListItemRenderContext.ts` |
| Create | `src/typescript/lib/component/list/ListItemRenderer.ts` |
| Create | `src/typescript/lib/component/list/renderer/Label.ts` |
| Create | `src/typescript/lib/component/list/renderer/Glyph.ts` |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` (item shape, options, factory, `CustomListRow`, store glyph) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (forward factory + glyphField to inner list; refactor `ComboBoxLabel` to render the collapsed control via the renderer) |
| Modify | `src/typescript/lib/component/list/index.ts` (barrel exports) |
| Create | `tests/component/list/renderer.test.ts` |
| Modify | `tests/component/list/List.test.ts` (factory swap + glyph field, if not in the new file) |
| Modify | `docs/components/List.md`, `docs/components/ComboBox.md`, `docs/components/MultiSelectList.md` |

---

## Expected Behaviour

Unit-testable (offline DOM harness — each renderer mints a `Text`/`Glyph` element on construction, so `installTestDOM` covers them, mirroring [renderer.test.ts](tests/component/table/cell/renderer.test.ts)):

- **`LabelListItemRenderer.update`** sets the label to `context.item.label`; a subsequent `update` with a different item replaces the text. Read via the label child's `getText()`.
- **`GlyphListItemRenderer`** with `item.glyph` set adds exactly one `Glyph` child; a falsy/absent `glyph` leaves zero glyph children (label only); re-updating with the same glyph name is idempotent (same `Glyph` instance retained); a different name swaps the instance; clearing (`glyph` → undefined) removes the child. These mirror the `GlyphRenderer add/remove/idempotent` block in [renderer.test.ts:176](tests/component/table/cell/renderer.test.ts#L176), asserting on `getComponents().length` and the private `_icon`.
- **`CustomListItem.glyph` round-trips** through `setItems([{ key, label, glyph }])`, `setItemsArray`, and `addItem` — `getItems()[i].glyph` equals the input.
- **Store `glyphField`** — after `setStore(store, display, value, "iconName")` and a `load`, each item's `glyph` equals `String(record.get("iconName"))`.
- **`setRendererFactory`** on a populated list replaces every pool row's renderer (assert the row's `_renderer instanceof` the new type) and leaves the item array/selection intact.
- **Default preservation** — a `List` constructed with no `rendererFactory` yields rows whose renderer is a `LabelListItemRenderer` and whose label text equals the item label (no regression vs. the old direct-text row).
- **`ComboBox` forwarding** — `new ComboBox({ rendererFactory })` makes the embedded `getList().getRendererFactory()` return that factory **and** builds `_label` with it; `setRendererFactory` on the combo updates both the inner list and the collapsed label (assert `_label`'s `_renderer instanceof` the new type).
- **Collapsed label rebind** — after `setValue(key)` / `setSelectedIndex(i)`, the collapsed `_label`'s renderer has been `update`d with the selected `CustomListItem` (assert the label renderer's label child `getText()` equals the selected item's label; with a `GlyphListItemRenderer` factory, assert the selected item's `glyph` produced one `Glyph` child on `_label`).
- **Empty / no-selection** — with nothing selected (`getSelectedIndex() === -1`), the collapsed `_label` renderer was fed the blank item: `LabelListItemRenderer` label child renders `""`; a `GlyphListItemRenderer` collapsed label has zero glyph children.
- **Re-render on change** — selecting a different entry re-runs `refreshLabel` → `_label.setItem`, so the collapsed renderer's bound label/glyph switches to the new entry (assert across two successive `setSelectedIndex` calls).

Manual / visual verification (not exercisable by the offline harness — glyph paint, geometry, focus, dropdown overlay):

- Glyph rows paint the icon beside the label, vertically centred, in both a standalone `List` and inside an open `ComboBox` dropdown.
- Long labels still truncate with an ellipsis; the selection wash / hover / focus outline still cover the full row.
- The collapsed `ComboBox` control shows the selected entry's glyph beside its label (with a `GlyphListItemRenderer` factory), matching the dropdown row; the caret still sits flush-right and the row height/baseline are unchanged.
- Selecting a different dropdown entry updates the collapsed glyph + label; opening the combo with nothing selected shows a blank collapsed control (no stray glyph).
- Row height and baseline are unchanged next to sibling fields.

---

## Verification

- `npx tsc --noEmit` — clean.
- `grep -rn '\.setLabel(' src/typescript/lib/component/{list,input}/` — zero matches (both `CustomListRow` and `ComboBoxLabel` migrated off `setLabel`).
- `npm test -- tests/component/list/` — new renderer tests + existing `List` / `MultiSelectList` suites green (the latter proves no regression in pool sync, selection, keyboard, type-ahead).
- `npm run docs:build` — zero warnings (guards the JSDoc `{@link}` rule for the new exported symbols).
- Manual smoke in the demo app (`npm run dev`, http://localhost:8015): a `List` and a `ComboBox` each configured with `rendererFactory: () => new GlyphListItemRenderer()` and items carrying `glyph`, plus a store-bound `ComboBox` using `glyphField`. Confirm the visual behaviours above — including the glyph on the **collapsed** ComboBox control, the switch on selection, and the blank collapsed state before any selection — with F12 open.

---

## Documentation Impact

- New exported symbols surface through `component/list/index.ts`; TypeDoc auto-generates `/api/component/list/...` pages for `ListItemRenderer`, `LabelListItemRenderer`, `GlyphListItemRenderer`, and the `ListItemRenderContext` interface. Follow the tree-renderer precedent (`tree/index.ts` exports `TreeNodeRenderer` / `LabelTreeNodeRenderer` / `IconLabelTreeNodeRenderer`).
- `docs/components/List.md` — add a "Renderers" section: the default label renderer, `setRendererFactory`, the `glyph` item field, and a `GlyphListItemRenderer` example (register the glyph first via `Glyph.register`).
- `docs/components/ComboBox.md` — document `rendererFactory` / `glyphField` forwarding and that the collapsed control renders the selected entry through the same renderer (glyph shows on the collapsed value), with the blank-when-unselected behaviour.
- `docs/components/MultiSelectList.md` — note that it inherits `setRendererFactory` / the `glyph` field from `AbstractCustomList`.
- Per CODE_CONVENTIONS.md, a public symbol's JSDoc may only `{@link}` other public symbols — reference `CustomListItem` and `Glyph` (both exported) freely, but describe `CustomListRow` (internal) in prose.

---

## Potential Challenges

- **Super-cascade field trap** — `_rendererFactory` keeps a field-initializer default and is written only by `setRendererFactory` dispatched from the constructor *body* (after `super()`), so it needs no `declare`; confirm the late-dispatch order puts `setRendererFactory` before `setItems` so first-paint rows use the caller's factory. (CODE_CONVENTIONS.md *Fields written during the `super()` cascade*.)
- **`default-options-fallback.test.ts` registry** — `rendererFactory` / `glyphField` are dispatched via the constructor late-block, not a folding getter, so they don't need a default-resolution registry row; verify none of the new getters return a class default that the `?? null` trap would drop.
- **Row padding vs. renderer box** — the renderer must be positioned inside the row's `Insets(0,8,0,8)` padding so labels keep their 8px gutter; read the padding in `CustomListRow.doLayout` rather than hard-coding 8 (document the constant's origin if inlined).
- **Ellipsis** — rely on the child `Text`'s `truncate: true` for clipping; do **not** re-add cosmetic overflow CSS on the row (ARCHITECTURE.md *No cosmetic insets*). The `.CustomListRow` rule's text properties become inert once text lives in the child, but leaving them is harmless and out of scope to remove.
- **`commitBounds` / stale DOM** — `CustomListRow.doLayout` positions children; if it reads any geometry it must `commitElementStyle()` first (per the `commitbounds_autocommit_stale_dom` memory). The planned `doLayout` only writes setters, so this shouldn't bite — flag if measurement is added.

---

## Critical Files

- `src/typescript/lib/component/list/AbstractCustomList.ts` — the row pool, `CustomListRow`, item shape, store binding (the heart of the change).
- `src/typescript/lib/component/tree/TreeRow.ts`, `tree/Tree.ts`, `tree/TreeNodeRenderer.ts`, `tree/renderer/Label.ts`, `tree/renderer/IconLabel.ts` — the mirrored seam (factory, per-row renderer, direct-append, glyph-on-change).
- `src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`, `table/cell/renderer/Glyph.ts` — the renderer-hierarchy conventions and the per-value glyph sourcing to match.
- `src/typescript/lib/component/input/ComboBox.ts` — dropdown → inner `List` forwarding, and `ComboBoxLabel` (the collapsed control) + `computeLabel`/`refreshLabel`/`doLayout` that the label refactor touches.
- `src/typescript/lib/component/display/Glyph.ts` — the real glyph API (`new Glyph(name)`, `setPointerEvents`, immutable name).
- `src/typescript/lib/component/input/Text.ts` — the `truncate` behaviour the default renderer depends on.
- `tests/component/table/cell/renderer.test.ts` — the test pattern to copy.

---

## Non-Goals

- **A caller-supplied glyph resolver function** — deliberately excluded per the settled decision; the glyph comes from the item/record field only. (`IconLabelTreeNodeRenderer`'s resolver-callback shape is intentionally *not* copied.)
- **`getContentWidth` / horizontal scroll extent** — the list never reads one; omitted from the renderer surface.
- **Re-skinning `MultiSelectList` presentation** beyond inheriting the shared factory — no multi-select-specific renderer is added.
- **Removing the now-inert text CSS from `.CustomListRow`** — out of scope (surgical-changes rule).
