# Layout System Overhaul — Implementation Plan

## Overview

Four interlocked concerns in the layout stack are addressed together because they touch the same files and the same `doLayout` / render seam:

1. **Universal scroll, triggered by minSize.** Today `Panel.setAutoScroll` ([Panel.ts:124](../src/typescript/lib/core/Panel.ts#L124), shipped via [plans/implemented/panel-auto-scroll.md](implemented/panel-auto-scroll.md)) flips `overflow-x`/`overflow-y` on the Panel's own element. That works only when the *contained* layout manager places a child larger than the host's inner rect — which today only `Absolute` (via the upcoming [plans/layout-manager-place-component-split.md](layout-manager-place-component-split.md) split) does. Every other manager (`HBox`, `VBox`, `Row`, `Column`, `Grid`, `Border`, `Card`, `Fit`, `Tab`, `Accordion`, `Split`) hard-clamps children to the cell via [`LayoutManager.placeComponent`](../src/typescript/lib/layout/LayoutManager.ts#L126), so the host element never overflows and the scrollbar never appears. **The fix:** each layout manager honours an opt-in per-axis `overflowing` flag. The contract is `minSize`-driven: a manager always tries to lay out within the host's `innerSize`; if even the children's *minSize total* exceeds `innerSize` on that axis (HBox.width = sum of children minWidth; VBox.height = sum of children minHeight; Card/Fit.width = visible child's minWidth; ...) and overflow is enabled, the manager lays out at the minSize total and lets the host overflow, producing scrollbars. With overflow disabled (the default), the existing clamp-and-clip behavior wins.

2. **Remove HTML/CSS layout primitives.** The framework already positions every laid-out child via absolute `left`/`top`/`width`/`height` written by `LayoutManager.commitBounds` (proposed in [plans/layout-manager-place-component-split.md](layout-manager-place-component-split.md)). What remains: five sites where `display: flex` (or implicit flow layout) handles intra-component layout — [ComboBox.ts:247](../src/typescript/lib/component/input/ComboBox.ts#L247), [ComboBox.ts:436](../src/typescript/lib/component/input/ComboBox.ts#L436), [DateField.ts:140](../src/typescript/lib/component/input/DateField.ts#L140), [DateTimeField.ts:139](../src/typescript/lib/component/input/DateTimeField.ts#L139), [TimeField.ts:141](../src/typescript/lib/component/input/TimeField.ts#L141). Goal: every child position is computed by a layout manager and committed via `setX/setY/setWidth/setHeight`; the only display values remaining are `block` (the framework default) and the Component-default `position: absolute`.

3. **`TabPanel` / `AccordionPanel` framework Panel subclasses.** Today [`AccordionPanel`](../src/typescript/AccordionPanel.ts) and [`TabPanel`](../src/typescript/TabPanel.ts) are **demo screens** under `src/typescript/`, not framework classes — they live next to `MiscPanel`, `BindingPanel`, etc. (see Community 4 of [graphify-out/GRAPH_REPORT.md](../graphify-out/GRAPH_REPORT.md#community-4)). The framework only exposes the bare layout managers ([`Tab`](../src/typescript/lib/layout/Tab.ts), [`Accordion`](../src/typescript/lib/layout/Accordion.ts)) — callers wire `new Panel({ layoutManager: new Tab() })` themselves and re-implement keyboard wiring, ARIA, close hooks each time. Introduce framework-side `TabPanel` and `AccordionPanel` as `Panel` subclasses that ship that chrome, while keeping the bare `new Panel({ layoutManager: new Tab() })` path working unchanged.

4. **`setLayoutManager` debug attribute + rename `Component.setAttribute` → `setDataAttribute`.** [Component.ts:3148](../src/typescript/lib/core/Component.ts#L3148) already mirrors the manager's class name via `this.setAttribute("layout", layoutManager.getClassName())` — but the attribute is being written as the non-standard `layout=` rather than the conventional `data-layout=`. The brief's "not surfacing in HTML" reading is the same finding from the consumer side: DevTools surfaces `data-*` natively but lints `layout=` as invalid HTML, so users scanning the inspector miss it. The fix is part of a broader reframing: `Component.setAttribute` / `getAttribute` / `delAttribute` are renamed to `setDataAttribute` / `getDataAttribute` / `delDataAttribute`, signal data-only intent at the API level, and auto-prepend `data-` to the key. Behavioral HTML attributes that the browser interprets natively (`placeholder`, `readonly`, `maxlength`, `inputmode`, `autocomplete`, `rows`, `cols`, `wrap`, `type`, `name`, `selected`) migrate to the already-existing direct-write `Component.setElementAttribute`. ARIA stays self-contained on its own [`Aria`](../src/typescript/lib/core/Aria.ts) class. The rename is self-enforcing: any leftover `setAttribute` caller after the migration surfaces as a typecheck error.

The four concerns share one ordering constraint: universal scroll depends on the `resolveBounds` / `commitBounds` split landing first ([plans/layout-manager-place-component-split.md](layout-manager-place-component-split.md)), because the new "let children overflow" mode is a `commitBounds`-direct path in each manager. This plan therefore assumes that prerequisite plan is implemented; do not start this one until that one is in `plans/implemented/`.

---

## Architecture Decisions

### Universal scroll: per-manager `overflowing` flag, triggered when children's minSize total exceeds host innerSize

Reject the "single seam in `LayoutManager`" alternative. Each manager already computes its layout from its children's `getMinSize` / `getPreferredSize` — the question of *whether* the layout's working size is allowed to grow past `innerSize` is a per-manager policy, not a per-call switch. Add three methods on `LayoutManager`: `setOverflowing(x: boolean, y: boolean): void`, `isOverflowingX(): boolean`, `isOverflowingY(): boolean` (default both `false`). Each `doLayout` consults the flags up front and, when true, may extend its working size past the host's `innerSize` along that axis — at which point the host's CSS `overflow: auto` (driven by `Panel.setAutoScroll`) renders scrollbars.

**The contract is minSize-driven.** A manager always tries to fit children within `innerSize` first. Each axis has a "minSize total" derived from the children:

- `HBox` / `Row`: width = sum of `child.getMinSize().width`; height = max of `child.getMinSize().height`.
- `VBox` / `Column`: height = sum; width = max.
- `Grid`: width = sum of per-column min; height = sum of per-row min.
- `Border`: width = max(west + center + east); height = sum(north, center, south).
- `Card` / `Fit`: max of currently-visible child's minSize on each axis.
- `Tab`: width = max(toolbar.preferredWidth, content-child.minWidth); height = toolbar.preferredHeight + content-child.minHeight.
- `Accordion`: width = max section width; height N/A (suppressed — see next decision).
- `Split`: per-pane user-set sizes are the minSize floor; the sum is the "total" along the split axis.

The per-axis decision in `doLayout`:

```
workingWidth  = isOverflowingX() ? Math.max(innerWidth,  totalMinWidth)  : innerWidth;
workingHeight = isOverflowingY() ? Math.max(innerHeight, totalMinHeight) : innerHeight;
```

The manager then runs its existing layout logic against `workingWidth` / `workingHeight`. If `workingSize > innerSize`, the children placed at the trailing edge land past the host's inner rect — the host overflows and scrolls. If `isOverflowing*` is false, behaviour is unchanged from today (children clamp to `innerSize`; oversized content clips silently — same as before this plan).

The flag is *driven by the host*, not configured per manager. `Panel.setAutoScroll` sets `this._layoutManager?.setOverflowing(x, y)` whenever `autoScroll` changes. This keeps the "is this Panel scrollable" decision at the `Panel` level (where it already lives) and the "implement minSize-driven overflow in your `doLayout`" responsibility on the manager (where it has to live anyway). The flag is **per-axis** — `autoScroll: "x"` lets children overflow horizontally only.

### `Accordion` suppresses vertical overflow to keep the height animation coherent

`Accordion.doLayout` stacks sections vertically and animates section heights. Horizontal overflow is coherent (wide content scrolls inside a section); vertical overflow conflicts with the height animation. Decision: `Accordion` honours `overflowing.x` but ignores `overflowing.y` — sections animate to their preferred height in either case, regardless of total minSize-vs-innerSize.

### `Card`, `Fit`, `Tab` honour both axes; `Tab` toolbar always stays fixed

`Card` / `Fit` are single-visible-child managers — the working size is just `max(innerSize, visibleChild.minSize)`. `Tab` reserves a toolbar strip at the top and the content area below; the toolbar always renders at the container's full width (its own [`ToolBar`](../src/typescript/lib/component/container/ToolBar.ts) overflow mode handles long tab lists internally — see Non-Goals). The minSize check applies to the content area's single visible child.

### `Split` honours overflow unconditionally because the user explicitly sized the pane

`Split` stores per-pane sizes in `_sizes` and resizes via the gutter — those sizes are user intent. If the user dragged a pane smaller than its content's minSize, scrolling is the only way to recover. `Split` treats its own per-pane sizes as the "minSize" along the split axis; the cross-axis follows the contained component's minSize as usual.

### Remove `display: flex` from `ComboBox`, `DateField`, `DateTimeField`, `TimeField` by routing through `HBox`

All five sites have the same shape: a text input on the left, a glyph button on the right, currently arranged via `display: flex` on the wrapping component. Each is already a `Component` subclass that calls `setLayoutManager(...)` for its outer arrangement but uses inline flexbox for the input + button row. Replace the inline flex with an `HBox`-laid wrapper component (the same pattern [`Tab`'s `TabEntry.wrapper`](../src/typescript/lib/layout/Tab.ts#L85) uses for the per-tab `ToggleButton` + `CloseButton`). The button's `setX`/`setY` become responsibilities of `HBox.doLayout`, not the browser.

This is a behavioural no-op for the visible result — `HBox` is already absolute-positioning every other site in the framework — but it removes the last `display: flex` callers from the codebase.

### `TabPanel` extends `Panel`, owns the `Tab` layout manager and chrome wiring

A subclass, not a flag. The `Tab` layout manager already owns its own toolbar and `ButtonGroup` ([Tab.ts:85-87](../src/typescript/lib/layout/Tab.ts#L85)); `TabPanel` is a thin Panel that constructs `new Tab(...)` in its constructor, dispatches `addTab(component, label, options?)` to the manager's tab-creation path, and exposes the manager's existing public surface (`addLazyTab`, `setOnTabClose`) as Panel methods. The bare `new Panel({ layoutManager: new Tab() })` path keeps working — TabPanel is the convenience entry point, not a replacement.

Same shape for `AccordionPanel`: extends `Panel`, constructs `new Accordion(...)` internally, exposes `addSection(component, label, initiallyOpen?)`, `openSection(index)`, `closeSection(index)`, `setSingleOpen(boolean)` — all forwarded to the wrapped `Accordion` instance.

What TabPanel/AccordionPanel **own** over a bare Panel + manager:
- **Construction shape.** `new TabPanel({ tabs: [{ label, component }, ...] })` vs the four-line bare-Panel form.
- **Type-narrowed `addTab` / `addSection` methods.** The bare Panel exposes only `addComponent(component, constraints?)`; TabPanel exposes `addTab(component: Component, label: string, options?: { closeable?: boolean })` which builds the right `LayoutConstraints` internally.
- **Forwarded keyboard / ARIA hooks.** Today's `Tab` layout manager wires `onToolbarKeyDown` and ARIA `tablist` role on its internal toolbar ([Tab.ts:163-165](../src/typescript/lib/layout/Tab.ts#L163)). The wiring stays on `Tab` — TabPanel doesn't duplicate it.
- **Close-button hook.** `TabPanel.setOnTabClose(callback)` forwards to `Tab.setOnTabClose`. Saves callers from `(panel.getLayoutManager() as Tab).setOnTabClose(...)`.

The two existing demo files (`src/typescript/AccordionPanel.ts`, `src/typescript/TabPanel.ts`) are **renamed** (see Files section) so the framework names are free. The demos keep their structure but become `AccordionDemoPanel` / `TabDemoPanel` — consistent with the other demo classes in Community 4.

### Rename `setAttribute` → `setDataAttribute`; behavioral HTML attributes migrate to `setElementAttribute`

`Component.setAttribute` / `getAttribute` / `delAttribute` are renamed to `setDataAttribute` / `getDataAttribute` / `delDataAttribute`. The method name now signals the data-only intent at the call site, instead of relying on a silent auto-prefix. The new methods still prepend `data-` to the key — a caller writes `setDataAttribute("layout", "HBox")` and gets `data-layout="HBox"` on the DOM. A key passed already prefixed (`"data-layout"`) is accepted unchanged — defensive idempotence.

The rename is preferred over an in-place auto-prefix on `setAttribute` for two reasons:
1. **Clarity at the call site.** `setDataAttribute("layout", ...)` reads as "set a data attribute named layout"; `setAttribute("layout", ...)` reads as "set the attribute named layout" — which is no longer what the method does after the prefix-in-place fix.
2. **Self-enforcing audit.** After the rename, any residual `setAttribute` caller surfaces as a typecheck error. The migration of behavioral HTML attribute callers becomes mechanical: the compiler tells us where they are.

The `_attributes` cache and DOM mirror behaviour at [Component.ts:713-724](../src/typescript/lib/core/Component.ts#L713) stay; only the method name and the DOM key change. The `_attributes` map key is the post-prefix `data-…` form, so `getDataAttribute(...)` symmetrically prepends.

Behavioral HTML attributes — those the browser interprets natively to drive form/element behaviour — migrate to the direct-to-DOM writer [`Component.setElementAttribute`](../src/typescript/lib/core/Component.ts), which already exists (called by `setAttribute` today at [Component.ts:721](../src/typescript/lib/core/Component.ts#L721)). `setElementAttribute` writes straight to `this.getElement()` without caching in `_attributes` — fine for HTML attributes the DOM persists on the element across the framework's lifecycle.

Audited callers to migrate to `setElementAttribute`:

| File | Line | Attribute(s) |
| --- | --- | --- |
| [TextInput.ts](../src/typescript/lib/component/input/TextInput.ts) | 102, 148, 270, 311, 337 | `inputmode`, `autocomplete`, `placeholder`, `readonly`, `maxlength` |
| [TextArea.ts](../src/typescript/lib/component/input/TextArea.ts) | 103, 142, 181 | `rows`, `cols`, `wrap` |
| [Input.ts](../src/typescript/lib/component/input/Input.ts) | 79, 102 | `type`, `name` |
| [Option.ts](../src/typescript/lib/component/input/Option.ts) | 117 | `selected` |
| [TextInputCellEditor.ts](../src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts) | 38, 53, 68 | `type`, `inputmode`, `autocomplete` |

ARIA attributes are unaffected: the [`Aria`](../src/typescript/lib/core/Aria.ts) class is self-contained — its internal `setAttribute(key, value)` (used by lines 143, 163, 184, … through 540) is a class method on `Aria`, not on `Component`. Verify during implementation that `Aria` writes the `aria-` prefix itself (it must, since today's calls pass `"live"`, `"sort"`, etc.); if Aria currently routes through `Component.setAttribute` for the DOM write, switch that internal hop to `Component.setElementAttribute` (after the rename, there's no `Component.setAttribute` to call anyway, so this audit is forced).

`setLayoutManager` after this change writes `data-layout` automatically:

```typescript
// Component.ts:3148 — caller spells just "layout"; the data- prefix is auto-applied:
this.setDataAttribute("layout", layoutManager.getClassName().replace(/^_/, ""));
```

The `^_` strip handles the `callable()`-wrapped class-name case where `constructor.name` from [BaseObject.ts:44](../src/typescript/lib/core/BaseObject.ts#L44) returns `_HBox` rather than `HBox`. Verify empirically during implementation; if the Proxy's `name` reflects the unwrapped name, the strip is a no-op.

### No backwards-compat shims

The framework is internal; call-sites change in lockstep with this plan. `layout=` → `data-layout=` is the only DOM-attribute-name change in the plan; no consumer reads it. `TabPanel` / `AccordionPanel` are net-new public symbols. The five `display: flex` removals are intra-component implementation details. The `isOverflowing` / `setOverflowing` addition on `LayoutManager` is `protected` (used by `Panel` + each manager's `doLayout`); not part of the public API.

### Performance: the MiscPanel slow-table benchmark must remain unaffected

The slow-table benchmark stresses `Table` rendering with F12 open ([MEMORY.md → Perf benchmark](.~/.claude/projects/-home-jika-typescript-typescript/memory/project_perf_benchmark.md)). `Table` ([component/container/](../src/typescript/lib/component/container/)) uses [`VirtualScroller`](../src/typescript/lib/component/container/VirtualScroller.ts) and the framework's own [`Scrollbar`](../src/typescript/lib/component/container/Scrollbar.ts), not `Panel.setAutoScroll`. None of this plan's changes touch `Table`, `VirtualScroller`, or `Scrollbar`. The `isOverflowing` check is one branch per `doLayout` pass per manager — negligible. Verification step #6 below re-runs the benchmark.

---

## Public API (TypeScript Signatures)

### `LayoutManager` (modified)

```typescript
export abstract class LayoutManager extends BaseObject {
    // existing fields + methods unchanged …

    private _overflowing: { x: boolean; y: boolean } = { x: false, y: false };

    /**
     * Returns whether this layout manager is in "let children overflow" mode
     * on the named axis. Default `false` on both axes.
     */
    protected isOverflowingX(): boolean;
    protected isOverflowingY(): boolean;

    /**
     * Called by the host `Panel` when its `autoScroll` mode changes. Subclasses
     * read the resulting state via `isOverflowingX` / `isOverflowingY` in their
     * `doLayout`. Triggers a re-layout.
     */
    setOverflowing(x: boolean, y: boolean): void;
}
```

### `Panel` (modified)

`setAutoScroll` ([Panel.ts:124](../src/typescript/lib/core/Panel.ts#L124)) gains a forwarding side-effect:

```typescript
setAutoScroll(mode: AutoScrollMode): this {
    // existing body + scrollbar-gutter handling …

    const x = mode === "auto" || mode === "x" || mode === "both";
    const y = mode === "auto" || mode === "y" || mode === "both";

    this.getLayoutManager()?.setOverflowing(x, y);

    return this;
}
```

The `setLayoutManager` ([Component.ts:3136](../src/typescript/lib/core/Component.ts#L3136)) override (added on `Panel`) re-applies the current `autoScroll` to the new manager so swapping managers preserves scroll behaviour:

```typescript
setLayoutManager(layoutManager: LayoutManager): this {
    super.setLayoutManager(layoutManager);
    this.setAutoScroll(this._autoScroll);
    return this;
}
```

### `TabPanel` (new)

```typescript
import { Panel, PanelOptions } from "~/core/Panel.js";
import { Tab, TabOptions, OnTabCloseCallback } from "~/layout/Tab.js";
import { Component } from "~/core/Component.js";

export interface TabEntryConfig {
    label:      string;
    component:  Component;
    closeable?: boolean;
}

export interface TabPanelOptions extends PanelOptions {
    tabs?:        TabEntryConfig[];
    onTabClose?:  OnTabCloseCallback;
}

class TabPanel<TOptions extends TabPanelOptions = TabPanelOptions> extends Panel<TOptions> {
    constructor(options?: TOptions);
    addTab(component: Component, label: string, options?: { closeable?: boolean }): this;
    addLazyTab(factory: () => Component, label: string, options?: { closeable?: boolean }): this;
    setOnTabClose(callback: OnTabCloseCallback): this;

    /** Typed access to the internally-owned `Tab` manager. */
    protected getTabManager(): Tab;
}
```

`TabPanel` is exported through `callable()` per the convention at [CLAUDE.md](../CLAUDE.md).

### `AccordionPanel` (new)

```typescript
import { Panel, PanelOptions } from "~/core/Panel.js";
import { Accordion, AccordionOptions, SectionToggleCallback } from "~/layout/Accordion.js";
import { Component } from "~/core/Component.js";

export interface AccordionSectionConfig {
    label:           string;
    component:       Component;
    initiallyOpen?:  boolean;
}

export interface AccordionPanelOptions extends PanelOptions {
    sections?:        AccordionSectionConfig[];
    singleOpen?:      boolean;
    onSectionToggle?: SectionToggleCallback;
}

class AccordionPanel<TOptions extends AccordionPanelOptions = AccordionPanelOptions> extends Panel<TOptions> {
    constructor(options?: TOptions);
    addSection(component: Component, label: string, initiallyOpen?: boolean): this;
    openSection(index: number):  this;
    closeSection(index: number): this;
    isSectionOpen(index: number): boolean;
    setSingleOpen(value: boolean): this;
    isSingleOpen(): boolean;

    /** Typed access to the internally-owned `Accordion` manager. */
    protected getAccordionManager(): Accordion;
}
```

Both classes follow the `Panel` cached-options pattern from [plans/implemented/panel-auto-scroll.md](implemented/panel-auto-scroll.md): the options bag is the cache (`this._options.tabs`, `this._options.sections`); `applyOptions` dispatches the config arrays to per-entry setters via `super.applyOptions(options)` first.

---

## Internal Structure

### `LayoutManager.setOverflowing`

```typescript
setOverflowing(x: boolean, y: boolean): void {
    if (this._overflowing.x === x && this._overflowing.y === y) {
        return;
    }

    this._overflowing = { x, y };

    this.getContainer()?.doLayout();
}
```

### Per-manager `doLayout` adoption pattern

The change is at the top of `doLayout`, where the manager establishes the working size used for its existing distribution logic. Each manager computes its minSize total along the relevant axis (see the per-manager table in Architecture Decisions) and inflates the working size only when its `isOverflowing*` flag is on AND the minSize total exceeds the host's `innerSize`:

```typescript
doLayout(): void {
    const inner = this.getContainer().getInnerSize();          // existing helper
    const totalMin = this.computeTotalMinSize();               // per-manager (HBox: sum/max; etc.)

    const workingWidth  = this.isOverflowingX()
        ? Math.max(inner.width,  totalMin.width)
        : inner.width;
    const workingHeight = this.isOverflowingY()
        ? Math.max(inner.height, totalMin.height)
        : inner.height;

    // Existing distribution logic runs against (workingWidth, workingHeight)
    // instead of (inner.width, inner.height). Children are placed via
    // commitBounds (from layout-manager-place-component-split.md) without
    // post-clamping.
    this.distributeChildren(workingWidth, workingHeight);
}
```

The existing per-child clamp (today's `placeComponent`) stays — it operates within the working size, not against `innerSize`. With overflow disabled, `working == inner` and behaviour matches today. With overflow enabled and minSize ≤ inner, `working == inner` and the manager lays out within inner as today. With overflow enabled and minSize > inner, `working == totalMin` and trailing children land past `innerSize`, causing the host to scroll.

`computeTotalMinSize` is a small per-manager helper, not a `LayoutManager` base-class method — each manager's geometry is too different to share an implementation. HBox sums children minWidth and maxes minHeight; VBox does the inverse; Grid sums per-column-min and per-row-min; Border has its 5-region calculation; Card/Fit pick the visible child; Tab adds the toolbar's preferred size to the content area's minSize; Split sums the per-pane `_sizes`.

Adoption is incremental — each manager picks up the pattern in step order below. Until a manager adopts the pattern, its `Panel` host's `setAutoScroll` works only if the child happens to overflow some other way (e.g. via a fixed `preferredSize` already larger than `innerSize`).

### Removing `display: flex` from input components

Each of the five sites (`ComboBox`, `DateField`, `DateTimeField`, `TimeField`) currently writes inline `display: flex` on the wrapper. The pattern after the change:

```typescript
// Constructor of e.g. DateField:
const inputRow = new Component();   // was: a div with display: flex
inputRow.setLayoutManager(new HBox({ componentSpacing: 0 }));

inputRow.addComponent(this._textInput);
inputRow.addComponent(this._button);

this.addComponent(inputRow);
```

The HBox sizes the text input at the input row's full width minus the button's preferred width, and positions the button on the right via the same `commitBounds` path every other HBox child uses. The visible result is identical; the implementation no longer touches the browser's flex algorithm.

### `setDataAttribute` (renamed) and `setLayoutManager` site

```typescript
// Component.ts:713 — current:
setAttribute(key: string, value: string): this {
    if (value === null) { this.delAttribute(key); return this; }
    this._attributes.set(key, value);
    this.setElementAttribute(key, value);
    return this;
}

// After (renamed + prefix):
setDataAttribute(key: string, value: string): this {
    if (value === null) { this.delDataAttribute(key); return this; }
    const dataKey = key.startsWith("data-") ? key : `data-${key}`;
    this._attributes.set(dataKey, value);
    this.setElementAttribute(dataKey, value);
    return this;
}
```

`getDataAttribute(key)` and `delDataAttribute(key)` apply the same prefix transform to stay symmetric. `setElementAttribute` is unchanged — it remains the direct-to-DOM, no-cache path that behavioral HTML attributes route through after the migration.

```typescript
// Component.ts:3148 — caller after the change:
this.setDataAttribute("layout", layoutManager.getClassName().replace(/^_/, ""));
// DOM result: data-layout="HBox"
```

The `^_` strip handles the underscored-alias case from callable wrapping (`_HBox` → `HBox`). Verify during implementation that the strip is needed; if the `callable()` Proxy's `name` reflects the unwrapped name, the strip is a no-op but harmless.

### Behavioral-attribute caller migration (representative)

```typescript
// TextInput.ts:270 — current:
this.setAttribute("placeholder", value);

// After:
this.setElementAttribute("placeholder", value);
```

The remaining call sites in the audit table follow the same one-line rewrite. `setElementAttribute` is already used elsewhere in the framework for direct DOM writes — no new API.

### `TabPanel` constructor

```typescript
constructor(options?: TOptions) {
    super(options);
    this.setLayoutManager(new Tab());

    if (options?.tabs) {
        for (const tab of options.tabs) {
            this.addTab(tab.component, tab.label, { closeable: tab.closeable });
        }
    }

    if (options?.onTabClose) {
        this.setOnTabClose(options.onTabClose);
    }
}

addTab(component: Component, label: string, options?: { closeable?: boolean }): this {
    const constraints = new LayoutConstraints();
    constraints.label     = label;       // existing field on Tab's constraints
    constraints.closeable = options?.closeable ?? false;  // shipped in `closeable-tabs.md`

    this.addComponent(component, constraints);

    return this;
}

protected getTabManager(): Tab {
    return this.getLayoutManager() as Tab;
}
```

`AccordionPanel` follows the same shape against `Accordion` + `AccordionConstraints`.

---

## Ordered Implementation Steps

The order keeps the framework buildable at every checkpoint. Steps 1–3 (the `setAttribute` reframing) are the most independent and lowest-risk — they can ship in isolation if the rest stalls. Steps 4–5 (`display: flex` removal) are independent of everything else. Steps 6–11 (universal scroll) depend on the [layout-manager-place-component-split.md](layout-manager-place-component-split.md) prerequisite landing. Steps 12–15 (TabPanel/AccordionPanel) only need the prerequisite for the `commitBounds` path in steps 13–14; they can happen in parallel with 8–11.

1. **Migrate behavioral-attribute callers from `setAttribute` to `setElementAttribute`.** Apply the audited table from the Architecture Decision to [TextInput.ts](../src/typescript/lib/component/input/TextInput.ts) (5 sites), [TextArea.ts](../src/typescript/lib/component/input/TextArea.ts) (3 sites), [Input.ts](../src/typescript/lib/component/input/Input.ts) (2 sites), [Option.ts](../src/typescript/lib/component/input/Option.ts) (1 site), [TextInputCellEditor.ts](../src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts) (3 sites). This step is a no-op for runtime behavior — `setAttribute` and `setElementAttribute` write the same DOM today. Verify: `npm run typecheck` clean; relevant demos (TextInput, TextArea, ComboBox internals) visually identical.

2. **Audit `Aria` class — verify it writes the `aria-` prefix internally and uses `setElementAttribute` for the DOM write (not `Component.setAttribute`).** If `Aria` currently bottoms out in `Component.setAttribute`, switch that internal call to `Component.setElementAttribute`. After step 3 there will be no `Component.setAttribute` to bottom out in, so this switch is forced. Verify: typecheck clean; an existing ARIA-using demo (e.g. Table with row selection) still emits correct `aria-selected="true"` etc. in DevTools.

3. **Rename `Component.setAttribute` / `getAttribute` / `delAttribute` → `setDataAttribute` / `getDataAttribute` / `delDataAttribute`; add the `data-` auto-prefix; update `setLayoutManager`.** Edit [Component.ts:713](../src/typescript/lib/core/Component.ts#L713) — rename the trio of methods and have them prepend `data-` (skip if the key already starts with `data-`). Edit [Component.ts:3148](../src/typescript/lib/core/Component.ts#L3148) to spell `setDataAttribute("layout", ...)` and strip a leading `_` from `getClassName()`. **The rename is self-auditing**: any remaining `Component.setAttribute` caller in the codebase is now a typecheck error and must be migrated to `setElementAttribute` (behavior) or `setDataAttribute` (data). Resolve every typecheck error this way before moving on. Verify: `npm run typecheck` clean; load any demo page; in DevTools confirm the root of every Panel carries `data-layout="<ManagerName>"` (no stray `layout=` attribute, no `data-data-…` from double-prefixing); ARIA-using demos still emit `aria-…` (not `data-aria-…`).

4. **Remove `display: flex` from `ComboBox`.** Both sites at [ComboBox.ts:247](../src/typescript/lib/component/input/ComboBox.ts#L247) and [ComboBox.ts:436](../src/typescript/lib/component/input/ComboBox.ts#L436). Replace inline `display: flex` wrapper with an `HBox`-laid sub-`Component`. Verify: ComboBox demo screen visually identical; typecheck clean.

5. **Remove `display: flex` from `DateField`, `DateTimeField`, `TimeField`.** [DateField.ts:140](../src/typescript/lib/component/input/DateField.ts#L140), [DateTimeField.ts:139](../src/typescript/lib/component/input/DateTimeField.ts#L139), [TimeField.ts:141](../src/typescript/lib/component/input/TimeField.ts#L141). Same pattern as step 4. Verify: each field's demo screen visually identical; typecheck clean; `grep -rn 'display:\s*flex\|display:flex' src/typescript/lib --include='*.ts'` returns zero matches.

6. **Add `isOverflowingX` / `isOverflowingY` / `setOverflowing` to `LayoutManager`.** Edit [LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts). The new methods are `protected`; the `_overflowing` field is `private`. Verify: typecheck clean; no existing manager subclass breaks (they all default to `false` and ignore the new methods).

7. **Wire `Panel.setAutoScroll` → `LayoutManager.setOverflowing` and override `Panel.setLayoutManager`.** Edit [Panel.ts](../src/typescript/lib/core/Panel.ts). Verify: existing `MiscPanel` autoScroll demo still works (the `Absolute`-laid case from [plans/layout-manager-place-component-split.md](layout-manager-place-component-split.md) — `Absolute` doesn't yet honour `isOverflowing*`, but the demo already commits children past the inner rect so scrolling works regardless).

8. **Adopt the minSize-driven overflow pattern in `HBox`, `VBox`, `Row`, `Column`.** Apply the per-manager pattern from "Internal Structure" above. Each manager grows a `computeTotalMinSize` helper (HBox/Row: sum-width, max-height; VBox/Column: max-width, sum-height). Per the prerequisite plan's caller inventory, the relevant `placeComponent` calls are at: [HBox.ts:330](../src/typescript/lib/layout/HBox.ts#L330), [VBox.ts:283](../src/typescript/lib/layout/VBox.ts#L283), [Row.ts:217](../src/typescript/lib/layout/Row.ts#L217), [Column.ts:270](../src/typescript/lib/layout/Column.ts#L270) and [Column.ts:319](../src/typescript/lib/layout/Column.ts#L319). Verify: in `MiscPanel`, wrap an HBox-laid Panel in `autoScroll: "auto"` with three children each carrying `setMinSize({ width: 400, height: 50 })` inside a host narrower than 1200px — horizontal scrollbar appears; with `setMinSize({ width: 100, ... })` the same children fit and no scrollbar appears. Rerun MiscPanel slow-table benchmark with F12 open, confirm no perceptible regression.

9. **Adopt the overflow pattern in `Grid`, `Border`, `Fit`.** [Grid.ts:362](../src/typescript/lib/layout/Grid.ts#L362) and [Grid.ts:429](../src/typescript/lib/layout/Grid.ts#L429); the five `Border` placement sites [Border.ts:383, 409, 427, 454, 465](../src/typescript/lib/layout/Border.ts#L383); [Fit.ts:236](../src/typescript/lib/layout/Fit.ts#L236). Each manager grows its own `computeTotalMinSize` shape (Grid: sum per-column-min / per-row-min; Border: 5-region calc; Fit: visible-child minSize). Verify: each manager's demo screen accepts a host `autoScroll: "auto"` and shows scrollbars when children's combined minSize exceeds the host's inner rect.

10. **Adopt the overflow pattern in `Card`, `Tab`, `Split`.** [Card.ts:279](../src/typescript/lib/layout/Card.ts#L279); [Tab.ts:616](../src/typescript/lib/layout/Tab.ts#L616) (content area only — toolbar stays); [Split.ts:193](../src/typescript/lib/layout/Split.ts#L193). `Card` and `Tab` use the visible-child minSize; `Split` uses the per-pane `_sizes` sum along the split axis. Verify: each demo screen accepts a host `autoScroll: "auto"`; `Tab`'s toolbar never scrolls regardless of mode; a `Split` pane dragged below its content's minSize scrolls.

11. **Adopt the overflow pattern in `Accordion`, x-axis only.** [Accordion.ts:486](../src/typescript/lib/layout/Accordion.ts#L486) and [Accordion.ts:508](../src/typescript/lib/layout/Accordion.ts#L508) — content-component placement inside the wrapper. Honour `isOverflowingX` only (per the decision above); ignore `isOverflowingY` to keep height animation coherent. Verify: AccordionPanel demo with `autoScroll: "x"` scrolls wide-minWidth content within an open section; with `autoScroll: "y"` the section height still animates.

12. **Rename demo files.** Rename `src/typescript/AccordionPanel.ts` → `src/typescript/AccordionDemoPanel.ts` and `src/typescript/TabPanel.ts` → `src/typescript/TabDemoPanel.ts`. Update imports + lazy-tab labels in [main.ts:17-18, 45-46](../src/typescript/main.ts#L17). Rename the classes inside each file to match. Verify: app runs; the "Accordion" and "Tab" lazy tabs render the demo screens; `grep -rn 'AccordionPanel\|TabPanel' src/typescript --include='*.ts'` shows zero residual references outside the new framework files.

13. **Create framework `TabPanel`.** New file `src/typescript/lib/component/container/TabPanel.ts`. Constructor + `addTab` + `addLazyTab` + `setOnTabClose` + `getTabManager`. Wrap with `callable()`. Re-export from [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) (the curated subpath barrel for container components). Verify: `import { TabPanel } from "@jimka/typescript-ui/component/container"` resolves; typecheck clean.

14. **Create framework `AccordionPanel`.** New file `src/typescript/lib/component/container/AccordionPanel.ts`. Constructor + `addSection` + `openSection` + `closeSection` + `isSectionOpen` + `setSingleOpen` + `isSingleOpen` + `getAccordionManager`. Wrap with `callable()`. Re-export from the container barrel. Verify: typecheck clean.

15. **Demo refresh.** Update the renamed `AccordionDemoPanel` and `TabDemoPanel` to *also* exercise the new framework classes — add a side-by-side section showing `new AccordionPanel({ sections: [...] })` next to the existing `new Component().setLayoutManager(new Accordion())` form. Verify: both forms render identically.

16. **`npm run docs:build` — 0 errors, 0 link warnings.** Typedoc's pre-existing "unsupported TypeScript version" notice is the only acceptable warning.

17. **`graphify update .`** — refresh the knowledge graph.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — rename `setAttribute`/`getAttribute`/`delAttribute` → `setDataAttribute`/`getDataAttribute`/`delDataAttribute`; the new trio auto-prepends `data-`. `setLayoutManager` updated to call `setDataAttribute("layout", ...)` and strip leading `_` from class name. |
| Modify | [src/typescript/lib/core/Aria.ts](../src/typescript/lib/core/Aria.ts) — verify internal `setAttribute` writes `aria-` prefix; if it bottoms out in `Component.setAttribute`, switch to `Component.setElementAttribute` to avoid double-prefix. |
| Modify | [src/typescript/lib/component/input/TextInput.ts](../src/typescript/lib/component/input/TextInput.ts), [TextArea.ts](../src/typescript/lib/component/input/TextArea.ts), [Input.ts](../src/typescript/lib/component/input/Input.ts), [Option.ts](../src/typescript/lib/component/input/Option.ts), [TextInputCellEditor.ts](../src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts) — migrate behavioral-attribute callers from `setAttribute` to `setElementAttribute`. |
| Modify | [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — `setAutoScroll` forwards to `LayoutManager.setOverflowing`; `setLayoutManager` override re-applies. |
| Modify | [src/typescript/lib/layout/LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts) — add `_overflowing` field, `isOverflowingX`, `isOverflowingY`, `setOverflowing`. |
| Modify | [src/typescript/lib/layout/HBox.ts](../src/typescript/lib/layout/HBox.ts), [VBox.ts](../src/typescript/lib/layout/VBox.ts), [Row.ts](../src/typescript/lib/layout/Row.ts), [Column.ts](../src/typescript/lib/layout/Column.ts), [Grid.ts](../src/typescript/lib/layout/Grid.ts), [Border.ts](../src/typescript/lib/layout/Border.ts), [Fit.ts](../src/typescript/lib/layout/Fit.ts), [Card.ts](../src/typescript/lib/layout/Card.ts), [Tab.ts](../src/typescript/lib/layout/Tab.ts), [Split.ts](../src/typescript/lib/layout/Split.ts), [Accordion.ts](../src/typescript/lib/layout/Accordion.ts) — adopt the minSize-driven overflow pattern in `doLayout`; each grows a `computeTotalMinSize` helper sized to its geometry. |
| Modify | [src/typescript/lib/component/input/ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts) — replace `display: flex` wrapper with `HBox`. |
| Modify | [src/typescript/lib/component/input/DateField.ts](../src/typescript/lib/component/input/DateField.ts), [DateTimeField.ts](../src/typescript/lib/component/input/DateTimeField.ts), [TimeField.ts](../src/typescript/lib/component/input/TimeField.ts) — same. |
| Create | `src/typescript/lib/component/container/TabPanel.ts` — framework Panel subclass wrapping `Tab`. |
| Create | `src/typescript/lib/component/container/AccordionPanel.ts` — framework Panel subclass wrapping `Accordion`. |
| Modify | `src/typescript/lib/component/container/index.ts` — re-export `TabPanel`, `TabPanelOptions`, `TabEntryConfig`, `AccordionPanel`, `AccordionPanelOptions`, `AccordionSectionConfig`. |
| Rename | `src/typescript/AccordionPanel.ts` → `src/typescript/AccordionDemoPanel.ts` (rename inner class too). |
| Rename | `src/typescript/TabPanel.ts` → `src/typescript/TabDemoPanel.ts` (rename inner class too). |
| Modify | [src/typescript/main.ts](../src/typescript/main.ts) — update demo imports and `addLazyTab` factories. |

No deletions outright; the two demo file renames preserve content.

---

## Verification

- `npm run typecheck` — clean.
- `grep -rn 'display:\s*flex\|display:flex\|display:\s*grid\|display:grid\|display:\s*inline-block' src/typescript/lib --include='*.ts'` — zero matches.
- Inspect any rendered `Panel` in DevTools: the host element carries `data-layout="<ManagerName>"` (no `layout=` attribute, no `data-data-…` double-prefix).
- Inspect a `TextInput` in DevTools: the underlying `<input>` carries `placeholder="…"`, `readonly`, `maxlength="…"` (not `data-placeholder`, etc.) — confirms the behavioral-attribute migration. Repeat for `TextArea` (`rows`, `cols`, `wrap`).
- Inspect any ARIA-using component (e.g. a Table row) in DevTools: ARIA attrs render as `aria-selected="true"` etc. (not `data-aria-…`, not `data-selected`).
- MiscPanel autoScroll demo ([MiscPanel.ts:746](../src/typescript/MiscPanel.ts#L746)) — toggle through the five autoScroll modes for each layout manager subdemo: scrollbars appear ONLY when children's combined minSize exceeds the host's inner rect on the corresponding axis; with children whose minSize fits, no scrollbar regardless of autoScroll mode.
- Manual minSize-trigger smoke: an HBox with three children carrying `setMinSize({ width: 400, height: 50 })` inside a Panel of `setWidth(800)` and `autoScroll: "auto"` — horizontal scrollbar appears. Resize the Panel to `setWidth(1500)` — scrollbar disappears.
- MiscPanel slow-table benchmark with F12 open — frame timing within the established "decently fast" band; rerun the same scenario the user uses to gauge perf regressions ([MEMORY.md → project_perf_benchmark.md](.~/.claude/projects/-home-jika-typescript-typescript/memory/project_perf_benchmark.md)).
- `import { TabPanel, AccordionPanel } from "@jimka/typescript-ui/component/container"` resolves and both render in a smoke demo screen.
- The pre-existing demo screens at the renamed paths (`AccordionDemoPanel`, `TabDemoPanel`) still render under their "Accordion" / "Tab" tabs in `main.ts`.
- `npm run docs:build` — 0 errors, 0 link warnings.
- `graphify update .` — runs to completion; `AccordionPanel` and `TabPanel` appear in the graph as members of the container community (not Community 4's demo community).

---

## Documentation Impact

- **New public symbols:** `TabPanel`, `AccordionPanel`, plus their `*Options` and `*Config` interfaces, are re-exported from the `component/container` subpath barrel ([src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts)). The curated doc page under [docs/component/container/](../docs/component/container/) (verify the exact path during implementation) gains entries for both; update the catalog `index.md` and the sidebar in [docs/.vitepress/config.mts](../docs/.vitepress/config.mts).
- **JSDoc cross-bucket references:** `TabPanel` references `Tab` (same `layout` bucket via `~/layout/Tab.js`) and `Panel` (cross-bucket — `core`). Use ``[`Panel`](/api/core/classes/Panel)`` markdown links for `Panel`; same-bucket references to `Tab` / `Accordion` stay as `{@link}`. Cross-bucket rule per [CLAUDE.md](../CLAUDE.md) and [.claude/skills/_shared/docs-conventions.md](../.claude/skills/_shared/docs-conventions.md).
- **No renames or removals of existing public symbols.** The demo file renames (`AccordionPanel` → `AccordionDemoPanel`) are intra-`src/typescript/` and never exported.
- **`data-layout` attribute is debug-only, not documented.** No doc page change for the attribute rename.

---

## Potential Challenges

- **Overflow on `Accordion` cross-axis.** The decision is `Accordion` honours `isOverflowingX` only. Verify the height animation still works correctly when the section content's preferred width exceeds the section's allocated width — the wrapper's `overflow: hidden` ([Accordion.ts:427](../src/typescript/lib/layout/Accordion.ts#L427)) currently masks horizontal overflow; this plan does not change that. Mitigation: the AccordionPanel demo gains an explicit "wide content" section to exercise this path.
- **`Tab` toolbar must stay non-scrolling when content is.** The toolbar at [Tab.ts:602-605](../src/typescript/lib/layout/Tab.ts#L602) is placed via direct `setX/Y/Width/Height` calls on `this._toolbar`, not via `placeComponent`. The overflow pattern adoption only touches the content-area `placeComponent` at line 616. Mitigation: the Tab demo gains a "long tab list" case to confirm the toolbar still uses its own internal `ToolBar` overflow mechanism (per [ToolBar.ts](../src/typescript/lib/component/container/ToolBar.ts)) rather than spilling into the parent's scroll region.
- **`callable()` proxy and `getClassName()`.** Implementation step 3 may discover `getClassName()` returns the proxy's own name (`Cls.name` — which is the original class's `name` since `Proxy` reflects the target's properties). If so, the `^_` strip in the rename is a no-op. Mitigation: confirm empirically before deciding whether to keep the strip; if removed, the JSDoc on `setLayoutManager` should still note the caller contract.

- **`Aria` double-prefix risk.** If [Aria.ts](../src/typescript/lib/core/Aria.ts) currently routes its internal `setAttribute("live", value)` through `Component.setAttribute`, the rename in step 3 would (a) break it at compile-time because `Component.setAttribute` no longer exists, and (b) if naïvely switched to `setDataAttribute`, would turn `aria-live` into `data-aria-live` on the DOM. Step 2 audits this explicitly and switches Aria's internal write to `Component.setElementAttribute`. Verification grep: `grep -rn 'data-aria-' src/ docs/` after step 3 — zero matches.

- **`_attributes` cache key change.** After the rename + prefix lands, the `_attributes` map keys are the post-prefix `data-…` form. Any code that introspects `_attributes` directly (none found in the audit, but verify) must be updated. The public `getDataAttribute(key)` API stays symmetric — it also prepends, so callers see the un-prefixed key.

- **External code referencing the old method names.** Within the framework this is enforced by the typecheck. Outside the framework (consumer code, demos under `src/typescript/`), the audit must check `grep -rn '\.setAttribute(\|\.getAttribute(\|\.delAttribute(' src/typescript --include='*.ts'` and rewrite any caller that operates on a framework `Component` rather than a raw DOM element. Calls on raw DOM elements (e.g. `svg.setAttribute(...)` inside `Glyph.ts`, [`Glyphs.ts`](../src/typescript/lib/component/display/Glyphs.ts)) are unaffected — they're the native DOM method, not the renamed framework method.

- **Behavioral attrs and the `_attributes` cache.** The migrated callers (TextInput's `placeholder`, etc.) no longer cache in `_attributes`. If the framework ever destroys and recreates the underlying DOM element, the attribute is lost. Verify during step 1 that `Component`'s element is single-create per instance — search for `removeChild`/`replaceChild` on `this._element` or equivalent. If recreation is possible, the migration needs a different home (e.g. an internal `_htmlAttributes` map flushed at render the same way `_attributes` is).
- **Re-applying `autoScroll` on `setLayoutManager`.** The `Panel.setLayoutManager` override re-applies the current `autoScroll` to the new manager. If the application toggles managers mid-render the second `doLayout` call may run before the new manager's `attach()` completes. Mitigation: `Panel.setLayoutManager` calls `super.setLayoutManager(layoutManager)` first (which runs `attach`), then `setAutoScroll(...)` — the order is correct, but worth confirming during implementation.
- **`Split` overflowing unconditionally.** A `Split` host with `autoScroll: "none"` and an oversized pane will now clip (existing behaviour) — but a `Split` with `autoScroll: "auto"` will scroll. Verify: the SplitGutter drag still snaps to the pane's actual rendered size, not its overflowed content size.
- **Demo file rename collides with no imports.** `grep -rn 'AccordionPanel\|TabPanel' src/typescript --include='*.ts'` before step 10 enumerates every reference; after the rename + framework class addition, only the new framework imports remain.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `setLayoutManager` at line 3136; `setAttribute` cache + DOM-flush at lines 713-724 and 3288; `setElementAttribute` is the direct-DOM writer that behavioral attributes migrate to.
- [src/typescript/lib/core/Aria.ts](../src/typescript/lib/core/Aria.ts) — must be audited so its DOM write doesn't double-prefix via the new auto-`data-` path.
- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — host of `setAutoScroll`; needs `setLayoutManager` override.
- [src/typescript/lib/core/BaseObject.ts](../src/typescript/lib/core/BaseObject.ts) — `getClassName` definition (line 44).
- [src/typescript/lib/core/Callable.ts](../src/typescript/lib/core/Callable.ts) — Proxy behaviour around `constructor.name`.
- [src/typescript/lib/layout/LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts) — adds `isOverflowing*` / `setOverflowing`; `placeComponent` / `commitBounds` from the prerequisite plan are the seam.
- Every layout manager listed in [plans/layout-manager-place-component-split.md](layout-manager-place-component-split.md)'s caller inventory.
- [plans/layout-manager-place-component-split.md](layout-manager-place-component-split.md) — prerequisite; `commitBounds` is the seam this plan calls.
- [plans/implemented/panel-auto-scroll.md](implemented/panel-auto-scroll.md) — `setAutoScroll` precedent; this plan extends it.
- [plans/implemented/accordion.md](implemented/accordion.md), [plans/implemented/closeable-tabs.md](implemented/closeable-tabs.md) — `Accordion` / `Tab` manager shape that `AccordionPanel` / `TabPanel` wrap.
- [src/typescript/AccordionPanel.ts](../src/typescript/AccordionPanel.ts), [TabPanel.ts](../src/typescript/TabPanel.ts) — demo files to rename.
- [src/typescript/main.ts](../src/typescript/main.ts) — demo `addLazyTab` registrations.
- [graphify-out/GRAPH_REPORT.md](../graphify-out/GRAPH_REPORT.md) — Community 4 (demo panels), 21 (Accordion), 41 (Tab), 51 (Card), 52 (Column), 59 (Row), 30 (BaseObject layout constraints).

---

## Non-Goals

- **Themed native scrollbars on Panel.** Same non-goal as [plans/implemented/panel-auto-scroll.md](implemented/panel-auto-scroll.md); native CSS overflow uses browser chrome. The custom [`Scrollbar`](../src/typescript/lib/component/container/Scrollbar.ts) stays out of `Panel`.
- **Arrow buttons on Panel scrollbars.** [plans/scrollbar-arrow-buttons.md](scrollbar-arrow-buttons.md) targets the custom `Scrollbar`; it does not flow through to native overflow.
- **Programmatic scroll API on Panel.** No `setScrollX` / `setScrollY` / `scrollIntoView`. Callers reach for `getElement().scrollTop` if needed.
- **Per-component overflow control bypassing the manager.** A child can't tell its parent's layout manager "let me overflow you" — the parent owns the policy. If a future use case demands per-child overrides, add `overflow?: { x: boolean; y: boolean }` to `LayoutConstraints` then; not now.
- **Removing the `Tab` toolbar's internal `ToolBar` overflow handling.** [ToolBar.ts](../src/typescript/lib/component/container/ToolBar.ts) has its own overflow mode for long tab lists. That stays.
- **Migrating `Table` / `Tree` / `VirtualScroller`'s custom `Scrollbar` to `Panel.setAutoScroll`.** They have different requirements (transform-driven virtual lists). Out of scope.
- **A `setLayout(...)` alias for `setLayoutManager(...)`.** The brief uses both names; the actual setter is `setLayoutManager`. Renaming or aliasing is speculative configurability and not part of this plan.
