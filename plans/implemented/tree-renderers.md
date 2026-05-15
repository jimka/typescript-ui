# Tree Custom Cell Renderers — Implementation Plan

## Overview

The Tree component currently renders every visible row identically: an expand/collapse toggle glyph followed by a plain text label. This plan introduces a pluggable `TreeNodeRenderer` system that lets consumers supply custom `Component`-based renderers for row content.

The virtual scroll pool in `Tree` recycles a fixed set of `TreeRow` instances. The renderer system must work within that constraint: a renderer is created once per pool slot and rebound (via `update()`) when the slot is remapped to a different node.

---

## Codebase reality check (2026-05-15)

The original plan was written against an outdated source layout (`Base/…`) and referenced classes that do not exist in this codebase. The plan below has been rewritten to match the current reality:

- Source root is `src/typescript/lib/`, not `Base/`. All new files live under `src/typescript/lib/component/tree/`.
- There is no project-wide `index.ts`. Exports go in the per-subpath barrel `src/typescript/lib/component/tree/index.ts`.
- The icon primitive is [`Glyph`](src/typescript/lib/component/display/Glyph.ts) — not `FontAwesomeIcon`. Glyph names are immutable (the SVG variant references a sprite via `<use href="#…">`), so changing the icon means constructing a new Glyph (the existing `TreeRow` already does this for the expand/collapse arrow).
- The current `TreeRow.setRowData` takes `(node, depth, hasChildren, expanded, siblingCount, posInSet)`. The `selected` flag is added as a 7th parameter — `siblingCount`/`posInSet` stay because they drive ARIA `setSetSize`/`setPosInSet`.
- The current `TreeRow.layoutChildren` takes `(rowHeight, indentPx)`; the row's pixel width comes from `this.getWidth()` (set by `Tree._positionRows` before calling layoutChildren). The signature stays as-is.
- `TreeRow.getContentWidth(indentPx)` is consumed by `Tree._bindAndMeasure` to size the horizontal scroll extent. It currently uses `_nodeLabel.getPreferredSize().width`. The renderer must provide an equivalent `getContentWidth()`.
- The current `_nodeLabel` is constructed with `clearInsets()` + `setAutoMeasure(false)` and an explicit `measure()` call after `setText`. The default renderer must replicate this so measurement results match exactly.
- `Tree` field declarations align colons vertically (a project convention); preserve that layout when adding `_rendererFactory`.
- TreeRow is wrapped in `callable()`. The abstract `TreeNodeRenderer` is not wrapped (matches `CellRenderer<T>` — also an abstract base, no callable). Concrete renderers (`LabelTreeNodeRenderer`, `IconLabelTreeNodeRenderer`) are also exported directly without callable, since they are constructed only via factory closures.

---

## Architecture Decisions

### Tree-specific API (not a copy of CellRenderer)

`CellRenderer<T>` receives a single typed scalar value (`setValue(t: T)`). A tree node renderer needs richer context: the node itself, its depth, its expansion state, and whether it is selected. The decision: define a standalone `TreeNodeRenderer` abstract class with a tree-specific `update(context: TreeNodeRenderContext)` method.

### The toggle stays in `TreeRow`'s jurisdiction

The expand/collapse toggle is structural chrome, not content. It must remain under `TreeRow`'s control so `Tree._handleClick` can still detect toggle clicks. The renderer controls only the content area to the right of the toggle.

### Renderer factory pattern — Tree owns it, TreeRow instantiates on demand

The `Tree` holds a renderer factory: `() => TreeNodeRenderer`. When the pool grows (a new `TreeRow` is created), `Tree` passes the current factory to `TreeRow`, which calls it exactly once to create its own renderer instance. This mirrors how `table/Body.ts` creates `new Row(...)` per pool slot and each `Row` creates cell renderers per field.

### Swapping factory replaces renderers in place (no pool teardown)

When `Tree.setRendererFactory()` is called after the pool already exists, each pool row's renderer is replaced via `TreeRow.setRenderer(factory())`. The pool itself, its DOM elements, and its bindings stay intact — we just clear `_boundIndices` so the next render pass rebinds and updates the new renderers. This avoids the cost and risk of tearing down DOM rows that are about to be recreated identically.

### No per-level renderer in the initial implementation

Per-level renderers would complicate pool management: a pool slot could be rebinding between depths, requiring renderer instance swaps mid-lifecycle. The initial implementation supports one renderer factory for the whole tree.

### Default renderer replaces the current inline label

The current `TreeRow._nodeLabel` (a `Text` span) is replaced by the built-in `LabelTreeNodeRenderer`. Behaviour, measurement, and visual output stay identical.

### Built-in renderers

- `LabelTreeNodeRenderer` — plain label, replicating current behaviour. Used as the default factory.
- `IconLabelTreeNodeRenderer` — a `Glyph` + `Text`. The glyph name is driven by a configurable callback `(node, context) => string`. If the resolved name changes, the renderer constructs a new `Glyph` (Glyph names are immutable by design).

---

## Public API (TypeScript Signatures)

### `TreeNodeRenderContext` (new file)

`src/typescript/lib/component/tree/TreeNodeRenderContext.ts`

```typescript
export interface TreeNodeRenderContext {
    node:        TreeNode;
    depth:       number;
    expanded:    boolean;
    selected:    boolean;
    hasChildren: boolean;
}
```

### `TreeNodeRenderer` (new file)

`src/typescript/lib/component/tree/TreeNodeRenderer.ts`

```typescript
export abstract class TreeNodeRenderer extends Component {
    constructor();

    abstract update(context: TreeNodeRenderContext): void;

    /**
     * Returns the natural content width this renderer would render at.
     * Used by Tree to compute horizontal scroll extent.
     */
    abstract getContentWidth(): number;

    /**
     * Positions internal children. Called by TreeRow.layoutChildren after the
     * renderer's own size has been set.
     */
    abstract layoutChildren(width: number, height: number): void;
}
```

### `LabelTreeNodeRenderer` (new file)

`src/typescript/lib/component/tree/renderer/Label.ts`

```typescript
export class LabelTreeNodeRenderer extends TreeNodeRenderer {
    constructor();
    getLabel(): Text;
    update(context: TreeNodeRenderContext): void;
    getContentWidth(): number;
    layoutChildren(width: number, height: number): void;
}
```

### `IconLabelTreeNodeRenderer` (new file)

`src/typescript/lib/component/tree/renderer/IconLabel.ts`

```typescript
export type IconLabelGlyphResolver = (node: TreeNode, context: TreeNodeRenderContext) => string;

export class IconLabelTreeNodeRenderer extends TreeNodeRenderer {
    constructor(glyphResolver?: IconLabelGlyphResolver);
    update(context: TreeNodeRenderContext): void;
    getContentWidth(): number;
    layoutChildren(width: number, height: number): void;
}
```

### Modified `TreeRow`

```typescript
// Constructor gains optional factory parameter.
constructor(rendererFactory?: () => TreeNodeRenderer);

// setRowData gains 'selected' parameter (7th); siblingCount/posInSet kept.
setRowData(
    node:         TreeNode,
    depth:        number,
    hasChildren:  boolean,
    expanded:     boolean,
    siblingCount: number,
    posInSet:     number,
    selected:     boolean,
): this;

// Existing layoutChildren signature is unchanged.
layoutChildren(rowHeight: number, indentPx: number): void;

// New API.
setRenderer(renderer: TreeNodeRenderer): this;
getRenderer(): TreeNodeRenderer;

// Removed.
// getNodeLabel(): Text;
```

### Modified `Tree`

```typescript
setRendererFactory(factory: () => TreeNodeRenderer): this;
getRendererFactory(): () => TreeNodeRenderer;
```

---

## Built-in renderer sketches

### `LabelTreeNodeRenderer`

```typescript
export class LabelTreeNodeRenderer extends TreeNodeRenderer {

    private _label: Text;

    constructor() {
        super();
        this.clearInsets();

        this._label = new Text();
        this._label.clearInsets();
        this._label.setAutoMeasure(false);
    }

    getLabel(): Text {
        return this._label;
    }

    update(context: TreeNodeRenderContext): void {
        this._label.setText(context.node.label);
        this._label.measure();
    }

    getContentWidth(): number {
        return this._label.getPreferredSize()?.width ?? 0;
    }

    layoutChildren(width: number, height: number): void {
        this._label.setAutoCommitStyle(false);
        this._label.setX(0);
        this._label.setY(0);
        this._label.setWidth(this.getContentWidth());
        this._label.setHeight(height);
        this._label.setLineHeight(height);
        this._label.setAutoCommitStyle(true);
    }

    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();
        if (el) {
            el.appendChild(this._label.getElement(true));
        }

        return this;
    }
}
```

### `IconLabelTreeNodeRenderer`

Because `Glyph` is immutable in `name`, the renderer constructs a new Glyph whenever the resolved name differs from the current one. This matches the pattern already used by `TreeRow` for the toggle arrow.

```typescript
const ICON_WIDTH = 20;
const ICON_SIZE  = 16;

export class IconLabelTreeNodeRenderer extends TreeNodeRenderer {

    private _icon:           Glyph;
    private _label:          Text;
    private _glyphResolver:  IconLabelGlyphResolver;
    private _currentGlyph:   string;

    constructor(glyphResolver: IconLabelGlyphResolver = () => "circle") {
        super();
        this.clearInsets();

        this._glyphResolver = glyphResolver;
        this._currentGlyph  = "circle";
        this._icon          = new Glyph(this._currentGlyph);
        this._label         = new Text();

        this._icon.clearInsets();
        this._label.clearInsets();
        this._label.setAutoMeasure(false);
    }

    update(context: TreeNodeRenderContext): void {
        const next = this._glyphResolver(context.node, context);

        if (next !== this._currentGlyph) {
            const el = this.getElement();
            if (el) {
                el.removeChild(this._icon.getElement(true));
            }

            this._icon = new Glyph(next);
            this._icon.clearInsets();
            this._currentGlyph = next;

            if (el) {
                el.insertBefore(this._icon.getElement(true), this._label.getElement(true));
            }
        }

        this._label.setText(context.node.label);
        this._label.measure();
    }

    getContentWidth(): number {
        return ICON_WIDTH + (this._label.getPreferredSize()?.width ?? 0);
    }

    layoutChildren(width: number, height: number): void {
        this._icon.setAutoCommitStyle(false);
        this._icon.setX(0);
        this._icon.setY(Math.max(0, (height - ICON_SIZE) / 2));
        this._icon.setWidth(ICON_SIZE);
        this._icon.setHeight(ICON_SIZE);
        this._icon.setAutoCommitStyle(true);

        this._label.setAutoCommitStyle(false);
        this._label.setX(ICON_WIDTH);
        this._label.setY(0);
        this._label.setWidth(Math.max(0, width - ICON_WIDTH));
        this._label.setHeight(height);
        this._label.setLineHeight(height);
        this._label.setAutoCommitStyle(true);
    }

    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();
        if (el) {
            el.appendChild(this._icon.getElement(true));
            el.appendChild(this._label.getElement(true));
        }

        return this;
    }
}
```

---

## Ordered Implementation Steps

### Step 1 — Define the data contract

Create `src/typescript/lib/component/tree/TreeNodeRenderContext.ts`. Interface only.

### Step 2 — Define the abstract base

Create `src/typescript/lib/component/tree/TreeNodeRenderer.ts` extending `Component`. Three abstract methods: `update`, `getContentWidth`, `layoutChildren`. No callable wrapping (abstract).

### Step 3 — Implement `LabelTreeNodeRenderer`

Create `src/typescript/lib/component/tree/renderer/Label.ts`. Must replicate the current visual output exactly (same `clearInsets()`, `setAutoMeasure(false)`, explicit `measure()` after `setText`).

### Step 4 — Modify `TreeRow`

1. Remove the `_nodeLabel: Text` field.
2. Add `_renderer: TreeNodeRenderer` field.
3. Constructor gains optional `rendererFactory?: () => TreeNodeRenderer` parameter; defaults to `() => new LabelTreeNodeRenderer()`.
4. In `init()`: replace the `_nodeLabel` append with `el.appendChild(this._renderer.getElement(true))`.
5. Add `setRenderer(renderer)`: remove current renderer's element from the row element, append the new one, store reference.
6. Add `getRenderer(): TreeNodeRenderer`.
7. `setRowData` gains a 7th parameter `selected: boolean`. Replace `this._nodeLabel.setText(node.label); this._nodeLabel.measure();` with `this._renderer.update({ node, depth, expanded, selected, hasChildren })`.
8. `layoutChildren`:
   - Toggle positioning unchanged.
   - Compute `labelX = indent + TOGGLE_WIDTH`; let `rowWidth = this.getWidth()`.
   - `setAutoCommitStyle(false)` on renderer, set X/Y/width/height, then `setAutoCommitStyle(true)`. Width = `Math.max(0, rowWidth - labelX)`, height = `rowHeight`.
   - Call `this._renderer.layoutChildren(rowWidth - labelX, rowHeight)`.
9. `getContentWidth(indentPx)` → `depth * indentPx + TOGGLE_WIDTH + this._renderer.getContentWidth()`.
10. Remove `getNodeLabel`.

### Step 5 — Modify `Tree`

1. Add `private _rendererFactory: () => TreeNodeRenderer = () => new LabelTreeNodeRenderer();` to the field declaration block, aligning the colon with the surrounding fields.
2. Add `setRendererFactory(factory): this` and `getRendererFactory(): () => TreeNodeRenderer`.
3. `setRendererFactory`:
   - Store factory.
   - For each row in `_rowPool`, call `row.setRenderer(factory())`.
   - `this._boundIndices.fill(-1)` (force rebind).
   - `this._invalidateGeom()`.
   - If element exists, `_renderWindow()`.
4. In `_growRowPool`, change `new TreeRow()` → `new TreeRow(this._rendererFactory)`.
5. In `_bindAndMeasure`, pass `selected = this._selectedNodes.has(flatRow.node)` as the 7th arg to `setRowData`.
6. `_updateSelectionStyle` continues to handle the row background highlight and `aria-selected` — it does not reach into renderer state.

### Step 6 — Implement `IconLabelTreeNodeRenderer`

Create `src/typescript/lib/component/tree/renderer/IconLabel.ts`. Uses `Glyph` (not FontAwesomeIcon). Default resolver returns `"circle"`. On glyph-name change, constructs a new Glyph and swaps it in (Glyph names are immutable).

### Step 7 — Update tree subpath barrel exports

Edit `src/typescript/lib/component/tree/index.ts` to add:

```typescript
export type { TreeNodeRenderContext }   from '~/component/tree/TreeNodeRenderContext.js';
export { TreeNodeRenderer }             from '~/component/tree/TreeNodeRenderer.js';
export { LabelTreeNodeRenderer }        from '~/component/tree/renderer/Label.js';
export { IconLabelTreeNodeRenderer }    from '~/component/tree/renderer/IconLabel.js';
export type { IconLabelGlyphResolver }  from '~/component/tree/renderer/IconLabel.js';
```

### Step 8 — Verify ARIA correctness

`setRowData` does NOT call `getAria().setSelected()` — that stays in `_updateSelectionStyle`. Structural ARIA (`level`, `expanded`, `setSize`, `posInSet`) stays in `setRowData`. Renderer code never touches row-level ARIA.

### Step 9 — Demo

Extend `MiscPanel.ts` to show the IconLabel renderer in addition to the default. A glyph resolver that picks `"folder"` for branches and `"file"` (or similar) for leaves is the canonical demo. Pick glyph names that exist in the registry.

### Step 10 — Regression pass

Verify:
- Default rendering is visually identical to before.
- `setRendererFactory` swaps renderers without DOM churn or layout glitches.
- Pool growth (scrolling a large tree) still works — new rows pick up the current factory.
- Keyboard navigation and click handling unaffected (toggle detection unchanged).
- Selection highlight still appears.
- `npm run docs:build` reports **0 errors and 0 link warnings**.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/typescript/lib/component/tree/TreeNodeRenderContext.ts` | Interface: node, depth, expanded, selected, hasChildren |
| `src/typescript/lib/component/tree/TreeNodeRenderer.ts` | Abstract `Component` subclass with `update`, `getContentWidth`, `layoutChildren` |
| `src/typescript/lib/component/tree/renderer/Label.ts` | Default text-label renderer |
| `src/typescript/lib/component/tree/renderer/IconLabel.ts` | Glyph + label renderer with per-node glyph resolver |

## Files to Modify

| File | Changes |
|---|---|
| `src/typescript/lib/component/tree/TreeRow.ts` | Remove `_nodeLabel`/`getNodeLabel`; add `_renderer`, `setRenderer`, `getRenderer`; constructor accepts factory; `setRowData` gains `selected`; `getContentWidth` delegates to renderer; `layoutChildren` sizes the renderer |
| `src/typescript/lib/component/tree/Tree.ts` | Add `_rendererFactory` field + getter/setter; pass factory to new `TreeRow`; pass `selected` to `setRowData` |
| `src/typescript/lib/component/tree/index.ts` | Export the four new symbols and the `IconLabelGlyphResolver` type |
| `src/typescript/MiscPanel.ts` | Add a second demo tree showcasing `IconLabelTreeNodeRenderer` |

---

## Critical Files

- `src/typescript/lib/component/tree/TreeRow.ts`
- `src/typescript/lib/component/tree/Tree.ts`
- `src/typescript/lib/component/tree/TreeNode.ts`
- `src/typescript/lib/component/display/Glyph.ts` (icon primitive)
- `src/typescript/lib/component/table/cell/renderer/CellRenderer.ts` (reference for renderer pattern)
- `src/typescript/lib/component/tree/index.ts` (barrel)

---

## Typed-setter / backing-field / options-bag convention

The toggle-baseline fix introduces two CSS rules on `Glyph` — `line-height` and (already-present) `text-align`. Per the project convention (see `.claude/skills/implement/SKILL.md` → "Three non-negotiable rules for every DOM write"), every DOM write must:

1. **Go through a specialized typed setter method**, including from inside constructors. No call site outside the setter (and its matching `clearX` / `removeX`) may use `setElementCSSRule` / `setElementCSSRules` / `setElementStyle` / `setElementAttribute` / `removeElementAttribute` directly.
2. **Cache the written value in a class instance variable**, so subsequent reads return the cached value rather than touching the DOM.
3. **Be exposed on the class's `XOptions` bag** and forwarded from the overridden `applyOptions(options)`, so the declarative construction-time API stays in lockstep with the imperative setter.

Concretely for this plan:

- Add `private _lineHeight: string | null = null;` and `private _textAlign: string | null = null;` to `Glyph`.
- Add `Glyph#setLineHeight(value: number | string)`: a number is written as `value + "px"`, a string is used verbatim (so the constructor's existing char-mode default of `"1"` — a unitless font-size multiplier — flows through the same setter). Companion getter `getLineHeight(): string | null`.
- Add `Glyph#setTextAlign(value: string)` and `getTextAlign(): string | null`.
- Replace the constructor's direct `setElementCSSRule("lineHeight", "1")` and `setElementCSSRule("textAlign", "center")` with `this.setLineHeight("1")` and `this.setTextAlign("center")`.
- Extend `GlyphOptions` with `lineHeight?: number | string` and `textAlign?: string`. Override `applyOptions(options)` to forward both to their setters after `super.applyOptions(options)`.
- `TreeRow.layoutChildren` calls `this._toggle.setLineHeight(rowHeight)` after sizing the toggle to vertically centre the char glyph within the row.
