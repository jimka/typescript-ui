# Tree Custom Cell Renderers — Implementation Plan

## Overview

The Tree component currently renders every visible row identically: an expand/collapse toggle icon followed by a plain text label. This plan introduces a pluggable `TreeNodeRenderer` system that lets consumers supply custom `Component`-based renderers for row content.

The virtual scroll pool in `Tree` recycles a fixed set of `TreeRow` instances. The renderer system must work within that constraint: a renderer is created once per pool slot and rebound (via `update()`) when the slot is remapped to a different node.

---

## Architecture Decisions

### Tree-specific API (not a copy of CellRenderer)

`CellRenderer<T>` receives a single typed scalar value (`setValue(t: T)`). A tree node renderer needs richer context: the node itself, its depth, its expansion state, and whether it is selected. The decision: define a standalone `TreeNodeRenderer` abstract class with a tree-specific `update(context: TreeNodeRenderContext)` method.

### The toggle stays in `TreeRow`'s jurisdiction

The expand/collapse toggle is structural chrome, not content. It must remain under `TreeRow`'s control so `Tree._handleClick` can still detect toggle clicks. The renderer controls only the content area to the right of the toggle.

### Renderer factory pattern — Tree owns it, TreeRow instantiates on demand

The `Tree` holds a renderer factory: `() => TreeNodeRenderer`. When the pool grows (a new `TreeRow` is created), `Tree` passes the current factory to `TreeRow`, which calls it exactly once to create its own renderer instance.

This mirrors how `table/Body.ts` creates `new Row(...)` per pool slot and each `Row` creates cell renderers per field.

### No per-level renderer in the initial implementation

Per-level renderers would complicate pool management: a pool slot could be rebinding between depths, requiring renderer instance swaps mid-lifecycle. The initial implementation supports one renderer factory for the whole tree, covering 90% of use cases. Per-level support can be added later using `Map<number, () => TreeNodeRenderer>`.

### Default renderer replaces the current inline label

The current `TreeRow._nodeLabel` (a `Text` span) becomes the built-in `LabelTreeNodeRenderer`. This keeps existing visual behaviour as the default while making it trivially replaceable.

### Built-in renderers

- `LabelTreeNodeRenderer` — plain label, replicating current behaviour. Used as the default factory.
- `IconLabelTreeNodeRenderer` — a FontAwesomeIcon + Label. The icon class is driven by a configurable callback `(node: TreeNode, context: TreeNodeRenderContext) => { type: string; name: string }`.

### Renderer layout driven by `TreeRow.layoutChildren`

`TreeRow` currently positions children via manual DOM manipulation (not via `addComponent`). The renderer follows the same pattern: its root element is positioned by `TreeRow.layoutChildren`. The renderer's internal layout uses its own `layoutChildren` method.

---

## Public API (TypeScript Signatures)

### `TreeNodeRenderContext` (new file)

```typescript
// Base/component/tree/TreeNodeRenderContext.ts
export interface TreeNodeRenderContext {
    /** The node being rendered. */
    node: TreeNode;
    /** Zero-based depth level (0 = root). */
    depth: number;
    /** True if the node is currently expanded. */
    expanded: boolean;
    /** True if the node is currently selected. */
    selected: boolean;
    /** True if the node has one or more children. */
    hasChildren: boolean;
}
```

### `TreeNodeRenderer` (new file)

```typescript
// Base/component/tree/TreeNodeRenderer.ts
export abstract class TreeNodeRenderer extends Component {
    constructor();

    /**
     * Rebinds this renderer to new node data.
     * Called every time the owning pool slot is mapped to a different node,
     * or when selection/expansion state changes for the currently bound node.
     */
    abstract update(context: TreeNodeRenderContext): void;

    /**
     * Positions the renderer's internal children within the given dimensions.
     * Called by TreeRow.layoutChildren after the overall renderer element is sized.
     */
    layoutChildren(width: number, height: number): void;
}
```

### `LabelTreeNodeRenderer` (new file)

```typescript
// Base/component/tree/renderer/Label.ts
export class LabelTreeNodeRenderer extends TreeNodeRenderer {
    constructor();
    getLabel(): Text;
    update(context: TreeNodeRenderContext): void;
    layoutChildren(width: number, height: number): void;
}
```

### `IconLabelTreeNodeRenderer` (new file)

```typescript
// Base/component/tree/renderer/IconLabel.ts
export class IconLabelTreeNodeRenderer extends TreeNodeRenderer {
    /**
     * @param iconResolver - Callback that resolves the FontAwesome icon type and name for a node.
     *                       Defaults to () => ({ type: 'fas', name: 'circle' }).
     */
    constructor(
        iconResolver?: (node: TreeNode, context: TreeNodeRenderContext) => { type: string; name: string }
    );
    update(context: TreeNodeRenderContext): void;
    layoutChildren(width: number, height: number): void;
}
```

### Modified `TreeRow`

```typescript
// Additional/modified members in TreeRow

// Constructor gains factory parameter
constructor(rendererFactory?: () => TreeNodeRenderer);

// setRowData gains 'selected' parameter and delegates to renderer.update()
setRowData(
    node: TreeNode,
    depth: number,
    hasChildren: boolean,
    expanded: boolean,
    selected: boolean
): void;

// Replaces the current renderer; swaps DOM element
setRenderer(renderer: TreeNodeRenderer): void;

// Returns the current renderer instance
getRenderer(): TreeNodeRenderer;
```

### Modified `Tree`

```typescript
// New public API on Tree

/**
 * Sets the renderer factory used to create one renderer instance per pool slot.
 * Calling this after nodes are loaded clears the pool so new renderers are
 * instantiated on the next render pass.
 *
 * @param factory - Zero-argument function returning a new TreeNodeRenderer.
 *                  Defaults to () => new LabelTreeNodeRenderer().
 */
setRendererFactory(factory: () => TreeNodeRenderer): void;

getRendererFactory(): () => TreeNodeRenderer;
```

---

## Built-in Renderers

| Class | File | Description |
|---|---|---|
| `LabelTreeNodeRenderer` | `renderer/Label.ts` | Plain `<span>` label. Default renderer. Replicates current behaviour exactly. |
| `IconLabelTreeNodeRenderer` | `renderer/IconLabel.ts` | FontAwesome icon + label. Icon class resolved per-node by caller-supplied callback. |

### `LabelTreeNodeRenderer` implementation sketch

```typescript
export class LabelTreeNodeRenderer extends TreeNodeRenderer {
    private _label: Text;

    constructor() {
        super();
        this.setInsets(null);
        this._label = new Text("span");
        this._label.setInsets(null);
    }

    update(context: TreeNodeRenderContext): void {
        this._label.setText(context.node.label);
    }

    protected init(element?: HTMLElement): void {
        super.init(element);
        const el = element || this.getElement();
        if (el) { el.appendChild(this._label.getElement(true)); }
    }

    layoutChildren(width: number, height: number): void {
        this._label.setX(0);
        this._label.setY(0);
        this._label.setWidth(width);
        this._label.setHeight(height);
    }
}
```

### `IconLabelTreeNodeRenderer` implementation sketch

```typescript
const ICON_WIDTH = 20;

export class IconLabelTreeNodeRenderer extends TreeNodeRenderer {
    private _icon: FontAwesomeIcon;
    private _label: Text;
    private _iconResolver: (node: TreeNode, context: TreeNodeRenderContext) => { type: string; name: string };

    constructor(iconResolver = () => ({ type: 'fas', name: 'circle' })) {
        super();
        this.setInsets(null);
        this._iconResolver = iconResolver;
        this._icon  = new FontAwesomeIcon('fas', 'circle');
        this._label = new Text('span');
        this._label.setInsets(null);
    }

    update(context: TreeNodeRenderContext): void {
        const { type, name } = this._iconResolver(context.node, context);
        const el = this._icon.getElement();
        if (el) {
            el.className = '';
            el.classList.add(type, `fa-${name}`);
        }
        this._label.setText(context.node.label);
    }

    protected init(element?: HTMLElement): void {
        super.init(element);
        const el = element || this.getElement();
        if (el) {
            el.appendChild(this._icon.getElement(true));
            el.appendChild(this._label.getElement(true));
        }
    }

    layoutChildren(width: number, height: number): void {
        this._icon.setX(0);
        this._icon.setY(Math.max(0, (height - 16) / 2));
        this._icon.setWidth(ICON_WIDTH);
        this._icon.setHeight(16);

        this._label.setX(ICON_WIDTH);
        this._label.setY(0);
        this._label.setWidth(Math.max(0, width - ICON_WIDTH));
        this._label.setHeight(height);
    }
}
```

---

## Ordered Implementation Steps

### Step 1 — Define the data contract

Create `Base/component/tree/TreeNodeRenderContext.ts` (interface only). No existing files change.

### Step 2 — Define the abstract base

Create `Base/component/tree/TreeNodeRenderer.ts` extending `Component`. Import `TreeNodeRenderContext`. Verify it compiles independently.

### Step 3 — Implement `LabelTreeNodeRenderer`

Create `Base/component/tree/renderer/Label.ts`. Must replicate the visual output of the current `TreeRow._nodeLabel` exactly. Verify the tree still looks identical after swapping.

### Step 4 — Modify `TreeRow` to use a renderer

1. Remove the `_nodeLabel: Text` field.
2. Add `_renderer: TreeNodeRenderer`, defaulting to `new LabelTreeNodeRenderer()`.
3. Constructor gains optional `rendererFactory: () => TreeNodeRenderer` parameter.
4. In `init()`: replace `el.appendChild(this._nodeLabel.getElement(true))` with `el.appendChild(this._renderer.getElement(true))`.
5. Add `setRenderer(renderer: TreeNodeRenderer)`: detach old renderer element, append new, store reference.
6. Update `setRowData(node, depth, hasChildren, expanded, selected)`:
   - Remove `this._nodeLabel.setText(node.label)`.
   - Call `this._renderer.update({ node, depth, expanded, selected, hasChildren })`.
   - ARIA updates remain unchanged.
7. Update `layoutChildren(rowWidth, rowHeight, indentPx)`:
   - Keep toggle positioning unchanged.
   - Replace `_nodeLabel` sizing with:
     ```typescript
     const labelX = (depth * indentPx) + TOGGLE_WIDTH;
     this._renderer.setX(labelX);
     this._renderer.setY(0);
     this._renderer.setWidth(rowWidth - labelX);
     this._renderer.setHeight(rowHeight);
     this._renderer.layoutChildren(rowWidth - labelX, rowHeight);
     ```
8. Remove `getNodeLabel()`. Add `getRenderer(): TreeNodeRenderer`.

### Step 5 — Modify `Tree` to pass `selected` state and own the factory

1. Add `private _rendererFactory: () => TreeNodeRenderer = () => new LabelTreeNodeRenderer()`.
2. Add `setRendererFactory(factory)` / `getRendererFactory()`.
3. `setRendererFactory`: store factory, then clear pool (`_rowPool = []`, `_boundIndices.fill(-1)`) so new renderers are instantiated on next `_renderWindow()`.
4. Pass `this._rendererFactory` into `new TreeRow(this._rendererFactory)` when growing the pool.
5. In `_renderWindow`, pass `selected` to `row.setRowData(...)`: `this._selectedNodes.has(flatRow.node)`.
6. `_updateSelectionStyle` remains for setting the row background highlight (structural, not content). It should NOT reach into the renderer.

### Step 6 — Implement `IconLabelTreeNodeRenderer`

Create `Base/component/tree/renderer/IconLabel.ts`. The `FontAwesomeIcon` component applies classes in `render()`. In `update()`, manipulate `classList` directly on the already-existing element — this is safe because the renderer is always initialised before `update()` is called.

### Step 7 — Update `index.ts` exports

```typescript
export type { TreeNodeRenderContext } from './component/tree/TreeNodeRenderContext.js';
export { TreeNodeRenderer }           from './component/tree/TreeNodeRenderer.js';
export { LabelTreeNodeRenderer }      from './component/tree/renderer/Label.js';
export { IconLabelTreeNodeRenderer }  from './component/tree/renderer/IconLabel.js';
```

### Step 8 — Verify ARIA correctness

`setRowData` should NOT call `getAria().setSelected()` — that stays in `_updateSelectionStyle`. `setRowData` only calls `_renderer.update(context)` and updates structural ARIA attributes (level, expanded). This keeps a clean separation between structural ARIA and renderer content.

### Step 9 — Regression pass

Verify:
- Pool growth (scrolling a large tree) still works — new rows receive the factory.
- `setNodes()` after `setRendererFactory()` does not re-clear the pool unnecessarily.
- Keyboard navigation and click handling are unaffected (toggle detection unchanged).
- Selection highlight still appears (background-color on the row element via `_updateSelectionStyle`).

---

## Files to Create

| File | Purpose |
|---|---|
| `Base/component/tree/TreeNodeRenderContext.ts` | Interface: node, depth, expanded, selected, hasChildren |
| `Base/component/tree/TreeNodeRenderer.ts` | Abstract `Component` subclass with abstract `update(context)` |
| `Base/component/tree/renderer/Label.ts` | Default text label renderer |
| `Base/component/tree/renderer/IconLabel.ts` | Icon + label renderer with per-node icon resolver |

## Files to Modify

| File | Changes |
|---|---|
| `Base/component/tree/TreeRow.ts` | Remove `_nodeLabel`; add `_renderer`; update `init`, `setRowData`, `layoutChildren`, constructor; add `setRenderer`, `getRenderer` |
| `Base/component/tree/Tree.ts` | Add `_rendererFactory` field + getter/setter; pass factory to new `TreeRow`; pass `selected` to `setRowData`; add `_clearPool` helper |
| `Base/index.ts` | Export the four new symbols |

---

## Critical Files

- `src/typescript/Base/component/tree/TreeRow.ts`
- `src/typescript/Base/component/tree/Tree.ts`
- `src/typescript/Base/component/table/cell/renderer/CellRenderer.ts` (reference for pattern)
- `src/typescript/Base/index.ts`
