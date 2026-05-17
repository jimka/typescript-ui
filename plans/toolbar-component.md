# ToolBar Component — Implementation Plan

## Overview

A `ToolBar` is a horizontal (or vertical) strip of related controls — Buttons, ToggleButtons, ButtonGroups, ComboBoxes, ToolBarSeparators — that sits at the top (or side) of a panel, window, or document. Think text-editor "Bold/Italic/Underline" bar or a file-manager "Cut/Copy/Paste" bar.

This plan adds `ToolBar` and `ToolBarSeparator` under `src/typescript/lib/component/menubar/` alongside the existing [`MenuBar`](../src/typescript/lib/component/menubar/MenuBar.ts) family. `ToolBar extends Panel` ([Panel.ts:39](../src/typescript/lib/core/Panel.ts#L39)) so it inherits the 4-px default insets and the standard `ComponentOptions` cascade. Layout is an [`HBox`](../src/typescript/lib/layout/HBox.ts) by default, swapped to [`VBox`](../src/typescript/lib/layout/VBox.ts) when `orientation === "vertical"`. Keyboard a11y reuses [`RovingTabIndex`](../src/typescript/lib/core/RovingTabIndex.ts) — the same mechanism [`ButtonGroup`](../src/typescript/lib/core/ButtonGroup.ts#L158-L178) wires up for its toggle-button arrow-key navigation. Theme tokens live in [`Theme.ts`](../src/typescript/lib/core/Theme.ts), with a new `toolBar` section added to the four canonical blocks (`Theme`, `DefaultTheme`, `DarkTheme`, `themeToVars`).

The `ToolBar` itself is layout-passive — it does not declare where it sits in its parent. The parent (Panel/Window/Document) chooses placement.

---

## Architecture Decisions

### `ToolBar extends Panel` — inherit the 4-px breathing room, override layout

[`Panel`](../src/typescript/lib/core/Panel.ts#L39) already gives the right default for grouped UI: 4-px insets on all sides, no chrome of its own beyond what the subclass paints. The chrome (background, bottom-border, gap between children) is layered on top in the `ToolBar` constructor via `setBackgroundColor`/`setElementCSSRule`/`HBox.setComponentSpacing`, mirroring the [`MenuBar` chrome installation](../src/typescript/lib/component/menubar/MenuBar.ts#L59-L64) pattern. Extending `Component` directly was rejected: it would require re-deriving the inset cascade that `Panel` already nails.

### Default `HBox` layout, swap to `VBox` on orientation change

A single `setOrientation("horizontal"|"vertical")` setter calls `setLayoutManager(new HBox(...))` or `setLayoutManager(new VBox(...))` ([Component.ts:2652-2666](../src/typescript/lib/core/Component.ts#L2652-L2666)) — which already correctly `detach()`es the old manager and `attach()`es the new one, so no manual cleanup. Spacing is copied from the old manager onto the new one so the gap token is preserved across orientation swaps. Both managers ship with `spacing` and `stretching` options ([HBox.ts:13-16](../src/typescript/lib/layout/HBox.ts#L13-L16)), so the wiring is symmetric.

Re-using a single manager and pivoting its loop in `doLayout` was rejected — `HBox` and `VBox` diverge too far on baseline metrics, weight math, and stretching semantics to share a body cleanly.

### Children are not type-restricted

A `ToolBar` is an HBox with theme chrome — anything that fits in the bar fits as a child: `Button`, `ToggleButton`, `ButtonGroup.getButtons()`, `ComboBox`, `TextField`, `Glyph`, `ToolBarSeparator`, plain `Component` spacers. No `addToolBarItem(item: ToolBarItem)` API; callers use the inherited `addComponent(component: Component)` / `addComponents(...)`. This matches how [`MenuBar`](../src/typescript/lib/component/menubar/MenuBar.ts) is populated (it just calls `addComponent` on each child button).

There is no `Spacer` class in the library today (grep confirms zero matches under `src/`). Callers needing a flexible-width gap can use a plain `new Component()` with a `weight` layout constraint, the same pattern HBox already honours ([HBox.ts:241-256](../src/typescript/lib/layout/HBox.ts#L241-L256)). Out of scope for this plan; flagged in Non-Goals.

### `ToolBarSeparator` mirrors `MenuSeparator`

[`MenuSeparator`](../src/typescript/lib/component/container/MenuSeparator.ts) is a thin horizontal rule (9 px height, top border) parameterised on a CSS-var prefix. `ToolBarSeparator` follows the same recipe but inverts orientation: thin **vertical** line by default (for horizontal toolbars), thin **horizontal** line when the parent toolbar is vertical. The constructor accepts an `orientation: "vertical"|"horizontal"` argument with default `"vertical"` (matching the default horizontal `ToolBar`). The parent `ToolBar.setOrientation` does **not** auto-flip child separators — callers either rebuild children or use the appropriate constructor. Reason: an auto-flip would require the toolbar to walk children on every orientation change and special-case the separator class, leaking knowledge of `ToolBarSeparator` into `ToolBar`. Manual recreation is simpler and keeps the separator independent of its parent.

### Overflow handling — `"clip"` for v1; `"menu"` deferred

When children don't fit, the v1 default `"clip"` simply lets `HBox` size the toolbar past its allotted width and rely on the parent's clipping (`overflow: hidden` is the framework default on `Component`). `"menu"` mode — render a trailing "≫" affordance that opens a dropdown of the overflowed children — adds a measurement pass after every layout and a managed `Menu` instance; deferred to a follow-up plan to keep v1 scope tight. The setter is still landed (with both values typed) so callers can opt in to `"menu"` once the implementation arrives; for v1 the `"menu"` branch can be wired to behave like `"clip"` with a `// TODO` marker, or it can throw — preference is to no-op silently so demos using `"menu"` don't break when the feature lands.

### A11y — `role="toolbar"`, `aria-orientation`, RovingTabIndex for arrow keys

ARIA spec: a toolbar has `role="toolbar"` with `aria-orientation` reflecting horizontal/vertical. Children are not given individual roles (they keep their own — Button = `button`, etc.). Keyboard nav uses arrow keys to move focus between focusable children: Left/Right for horizontal, Up/Down for vertical. Reuse [`RovingTabIndex`](../src/typescript/lib/core/RovingTabIndex.ts) — same mechanism `ButtonGroup` uses ([ButtonGroup.ts:158-178](../src/typescript/lib/core/ButtonGroup.ts#L158-L178)). The toolbar registers an `Event.addSubtreeListener` on itself for `keydown`, dispatches to the roving index by orientation.

Focusable-child registration is automatic: `addComponent` is overridden to push the new child into the roving index when it is focusable. The rule for "focusable" is "any `Component` whose tabindex is `>= 0`" — read via `child.getAria().getTabIndex()`. `ToolBarSeparator` sets its tabindex to `-1` explicitly so the roving index skips it. Non-focusable children (Glyph, plain Component spacers) also have `-1` by default. First focusable child added gets `tabindex=0`, the rest `-1` — the `RovingTabIndex.add` API already enforces this ([RovingTabIndex.ts:50-57](../src/typescript/lib/core/RovingTabIndex.ts#L50-L57)).

### Compact mode — reduced gap + zero internal padding

`setCompact(true)` does two things: writes the `HBox`/`VBox` spacing to `0` and replaces the panel insets with `(2, 2, 2, 2)`. Reverting (`setCompact(false)`) restores `--ts-ui-toolbar-padding` / `--ts-ui-toolbar-gap`. No new CSS rule needed.

### Out of scope — sticky / dockable / floating

A `ToolBar` is a layout-passive component; the parent decides where it sits. Sticky toolbars (fixed position at the top of a scroll container), dockable toolbars (drag to relocate), and floating/torn-off toolbars are explicit Non-Goals — they require coordination with the parent's layout that does not belong inside `ToolBar`.

### Co-locate with `MenuBar`, not under `container/`

`MenuBar` and `ToolBar` are sister concepts — both are top-of-window strips, both use `HBox`, both expose `aria-orientation` semantics in a way the rest of `container/` does not. Co-locating under `src/typescript/lib/component/menubar/` keeps the navigation-strip components in one bucket and mirrors how the export site (`docs/components/`) already groups them ("Menus" section in [config.mts:104-110](../docs/.vitepress/config.mts#L104-L110)). The bucket would be more honestly named `bars/` but renaming the existing folder is out of scope; sidebar will get a new "Toolbar" section.

`ToolBarSeparator` also goes into `component/menubar/` for the same reason — sibling to `ToolBar`, not to `MenuSeparator`. The cross-bucket reference cost from `MenuSeparator`'s docs to `ToolBarSeparator`'s docs is one markdown link, paid once.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/component/menubar/ToolBar.ts

export type ToolBarOrientation = "horizontal" | "vertical";
export type ToolBarOverflow    = "clip" | "menu";

export interface ToolBarOptions extends PanelOptions {
    orientation?: ToolBarOrientation;
    compact?:     boolean;
    overflow?:    ToolBarOverflow;
}

class ToolBar extends Panel<ToolBarOptions> {
    constructor(options?: ToolBarOptions);

    /** @internal Applies the ToolBar-specific options after super.applyOptions. */
    protected applyOptions(options: ToolBarOptions): this;

    setOrientation(value: ToolBarOrientation): this;
    getOrientation(): ToolBarOrientation;

    setCompact(value: boolean): this;
    isCompact(): boolean;

    setOverflow(value: ToolBarOverflow): this;
    getOverflow(): ToolBarOverflow;
}

// Callable wrapper (project convention; mirrors Panel.ts:58-63)
const ToolBarCallable = callable(ToolBar);
type  ToolBarCallable = ToolBar;
export { ToolBar as _ToolBar, ToolBarCallable as ToolBar };
```

**Cached backing fields:**
- `_orientation: ToolBarOrientation` — current layout direction.
- `_compact: boolean` — current compact-mode flag.
- `_overflowMode: ToolBarOverflow` — current overflow strategy.
- `_rovingTabIndex: RovingTabIndex` — keyboard-nav group; constructed once.
- `_onKeyDown: (e: KeyboardEvent) => void` — subtree keydown handler, kept as a field so it can be removed in `dispose()`.

**Setter routing:**
- `setOrientation` writes `_orientation`, swaps to the new layout manager (preserving spacing), updates `aria-orientation`, no `doLayout()` call needed — `setLayoutManager` already triggers attach which schedules layout.
- `setCompact` writes `_compact`, toggles between `(4,4,4,4)` and `(2,2,2,2)` insets, sets the layout-manager spacing to `0` or the gap-token resolved value, calls `doLayout()`.
- `setOverflow` writes `_overflowMode`. v1 `"clip"` is a no-op beyond the cached field; `"menu"` is reserved for a follow-up.

```typescript
// src/typescript/lib/component/menubar/ToolBarSeparator.ts

export type ToolBarSeparatorOrientation = "vertical" | "horizontal";

export interface ToolBarSeparatorOptions extends ComponentOptions {
    orientation?: ToolBarSeparatorOrientation;
}

class ToolBarSeparator extends Component<ToolBarSeparatorOptions> {
    /** Fixed pixel thickness of the separator rule. */
    static readonly THICKNESS: number;  // 9, matches MenuSeparator.HEIGHT

    constructor(options?: ToolBarSeparatorOptions);
}

const ToolBarSeparatorCallable = callable(ToolBarSeparator);
type  ToolBarSeparatorCallable = ToolBarSeparator;
export { ToolBarSeparator as _ToolBarSeparator, ToolBarSeparatorCallable as ToolBarSeparator };
```

---

## Theme Tokens

Add a `toolBar` section to the `Theme` interface ([Theme.ts:135-155](../src/typescript/lib/core/Theme.ts#L135-L155) — sit it right after `menuBar`). Values to `DefaultTheme` (around [Theme.ts:332-352](../src/typescript/lib/core/Theme.ts#L332-L352)) and `DarkTheme` (around [Theme.ts:486-506](../src/typescript/lib/core/Theme.ts#L486-L506)). Var names to `themeToVars` (around [Theme.ts:641-653](../src/typescript/lib/core/Theme.ts#L641-L653)).

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-toolbar-bg` | `rgb(245, 245, 245)` | `rgb(40, 40, 40)` | Toolbar background; slightly distinct from panel content so the bar reads as its own surface. |
| `--ts-ui-toolbar-border` | `rgb(220, 220, 220)` | `rgb(70, 70, 70)` | Bottom border (horizontal) or right border (vertical). |
| `--ts-ui-toolbar-padding` | `4px` | `4px` | Outer inset for the toolbar. Falls back to the inherited Panel inset; theme-driven so dense apps can override. |
| `--ts-ui-toolbar-gap` | `4px` | `4px` | Spacing between child controls. Passed to `HBox`/`VBox.setComponentSpacing`. |
| `--ts-ui-toolbar-separator-color` | `rgb(220, 220, 220)` | `rgb(70, 70, 70)` | `ToolBarSeparator` rule colour. |

Theme-interface block to add:

```typescript
toolBar: {
    background    : string;
    border        : string;
    padding       : string;
    gap           : string;
    separatorColor: string;
};
```

`padding` and `gap` are encoded as strings so they can carry `px` natively and pass straight to `setElementCSSRule` / `getComputedStyle` reads without coercion. The numeric values used by `HBox.setComponentSpacing` (a `number`) are resolved at runtime via `parseInt(getComputedStyle(this.getElement()).getPropertyValue("--ts-ui-toolbar-gap"), 10) || 4`, with the literal `4` as a safe fallback for unmeasured/detached states. Same trick as the `Animation` duration parsing already in the codebase.

---

## Internal Structure

```
ToolBar (extends Panel)
├── DOM: <div role="toolbar" aria-orientation="horizontal">
├── Layout: HBox (default) or VBox
├── Insets: (4,4,4,4) default; (2,2,2,2) when compact
├── Background: var(--ts-ui-toolbar-bg)
├── Border: 1px solid var(--ts-ui-toolbar-border) on the trailing edge (bottom for horizontal, right for vertical)
└── Children: arbitrary Components, registered with RovingTabIndex if focusable

ToolBarSeparator (extends Component)
├── DOM: <div role="separator" aria-orientation="vertical">
├── Vertical: 1×N rule using border-left, with horizontal margin
└── Horizontal: N×1 rule using border-top, with vertical margin (when used inside a vertical toolbar)
```

`ToolBar.setOrientation` body sketch:

```typescript
setOrientation(value: ToolBarOrientation): this {
    if (value === this._orientation) return this;

    const oldLM  = this.getLayoutManager() as HBox | VBox;
    const gap    = oldLM.getComponentSpacing();
    const newLM  = value === "horizontal" ? new HBox() : new VBox();
    newLM.setComponentSpacing(gap);
    newLM.setStretching(false);

    this.setLayoutManager(newLM);
    this._orientation = value;

    this.getAria().setAttribute("aria-orientation", value);
    this.setElementCSSRule(
        value === "horizontal" ? "borderBottom" : "borderRight",
        "1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))"
    );
    // Clear the opposite-edge border if we just flipped.
    this.setElementCSSRule(
        value === "horizontal" ? "borderRight" : "borderBottom",
        "none"
    );

    return this;
}
```

`ToolBar.addComponent` override (one-line auto-registration):

```typescript
override addComponent(component: Component): this {
    super.addComponent(component);
    if (component.getAria().getTabIndex() >= 0) {
        this._rovingTabIndex.add(component);
    }
    return this;
}
```

Keydown subtree listener — wired once in the constructor:

```typescript
Event.addSubtreeListener(this, "keydown", (e: KeyboardEvent) => {
    const isHoriz = this._orientation === "horizontal";
    const fwd     = isHoriz ? "ArrowRight" : "ArrowDown";
    const back    = isHoriz ? "ArrowLeft"  : "ArrowUp";

    if (e.key === fwd) {
        e.preventDefault();
        this._rovingTabIndex.moveNext();
    } else if (e.key === back) {
        e.preventDefault();
        this._rovingTabIndex.movePrev();
    }
});
```

---

## Ordered Implementation Steps

1. **Add `toolBar` block to `Theme.ts`** ([Theme.ts:135-155](../src/typescript/lib/core/Theme.ts#L135-L155) for the interface, [Theme.ts:332-352](../src/typescript/lib/core/Theme.ts#L332-L352) for `DefaultTheme`, [Theme.ts:486-506](../src/typescript/lib/core/Theme.ts#L486-L506) for `DarkTheme`, [Theme.ts:641-653](../src/typescript/lib/core/Theme.ts#L641-L653) for `themeToVars`). Must come first so the components compile against the var fallbacks.

2. **Create `src/typescript/lib/component/menubar/ToolBarSeparator.ts`.** Mirror [`MenuSeparator.ts`](../src/typescript/lib/component/container/MenuSeparator.ts): export the class, a `_default…Options` const, an `applyOptions` override if needed, and a `callable()` wrapper. Implement orientation via a switch on `options.orientation`: `"vertical"` uses `borderLeft` + horizontal margin and `preferredSize(THICKNESS, 0)`; `"horizontal"` uses `borderTop` + vertical margin and `preferredSize(0, THICKNESS)`. Set `role="separator"` and `aria-orientation` accordingly. ARIA tabindex stays at the default (`-1`-equivalent — separators are not focusable).

3. **Create `src/typescript/lib/component/menubar/ToolBar.ts`.** Class declaration `class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Panel<TOptions>` to participate in the `Panel<TOptions>` generic chain ([Panel.ts:39](../src/typescript/lib/core/Panel.ts#L39)). Constructor body order:
   - `super({ ..._defaultToolBarOptions, ...(options ?? {}) })` — defaults: `orientation: "horizontal"`, `compact: false`, `overflow: "clip"`.
   - Construct the default `HBox`, set `componentSpacing` to the resolved `--ts-ui-toolbar-gap` (or fallback `4`), `setStretching(false)`. `this.setLayoutManager(hbox)`.
   - Install chrome: `setBackgroundColor("var(--ts-ui-toolbar-bg, rgb(245, 245, 245))")`, `setElementCSSRule("borderBottom", ...)`.
   - Construct `_rovingTabIndex = new RovingTabIndex()`.
   - Set ARIA: `role="toolbar"`, `aria-orientation="horizontal"`, `tabindex=0` on the root so the toolbar participates in document tab order (matching [`MenuBar` ARIA wiring](../src/typescript/lib/component/menubar/MenuBar.ts#L66-L68)).
   - Wire the `keydown` subtree listener (kept as `this._onKeyDown`).
   - Dispatch deferred options via `applyOptions` if the option bag overrides any default (orientation, compact, overflow).

4. **Implement `applyOptions(options: ToolBarOptions): this`.** Call `super.applyOptions(options)`, then dispatch `setOrientation`, `setCompact`, `setOverflow` only when the bag carries a value (the `!== undefined` guard pattern from [`HBox.applyOptions`](../src/typescript/lib/layout/HBox.ts#L44-L54)).

5. **Implement the four setter pairs.** `setOrientation` / `getOrientation` (swap layout manager, flip border edge, update aria-orientation), `setCompact` / `isCompact` (insets + spacing toggle), `setOverflow` / `getOverflow` (cache the field, no-op the `"menu"` branch for v1 with a `// TODO: menu overflow` comment). Each setter returns `this`.

6. **Override `addComponent` for roving-tabindex auto-registration.** Single line of book-keeping after `super.addComponent`. Mirror in `removeComponent` if it exists on `Component` (check; if not present, the auto-registration is add-only for v1).

7. **Export from `src/typescript/lib/component/menubar/index.ts`.** Add four lines:
   ```typescript
   export { ToolBar } from '~/component/menubar/ToolBar.js';
   export type { ToolBarOptions, ToolBarOrientation, ToolBarOverflow } from '~/component/menubar/ToolBar.js';
   export { ToolBarSeparator } from '~/component/menubar/ToolBarSeparator.js';
   export type { ToolBarSeparatorOptions, ToolBarSeparatorOrientation } from '~/component/menubar/ToolBarSeparator.js';
   ```

8. **JSDoc.** Every JSDoc reference to a cross-bucket class (`Panel`, `Component`, `HBox`, `VBox`, `Button`, `ToggleButton`, `Glyph`, `RovingTabIndex`) uses the markdown form `[\`Foo\`](/api/<bucket>/classes/Foo)` per CLAUDE.md. References to `ToolBarSeparator` from inside `ToolBar` (same bucket) use `{@link ToolBarSeparator}`. Self-references use bare backticks.

9. **Demo.** Add a `ToolBarPanel` to whichever demo screen the implementer chooses (consistent with how the menu-bar plan added a demo). Populate with: a `ButtonGroup` of three `ToggleButton`s (Bold/Italic/Underline), a `ToolBarSeparator`, three plain `Button`s (Cut/Copy/Paste), a flexible `Component` with `weight: 1`, and a `ComboBox` on the trailing edge. Register the demo in `src/typescript/main.ts`. Verify at `http://localhost:8015`: horizontal layout, arrow-key nav between buttons, theme toggle leaves chrome consistent.

10. **`grep -rn 'ToolBarSeparator\|ToolBar\b' src/typescript/lib/` — expect matches only in the new files, `Theme.ts`, and `menubar/index.ts`.** Cheap regression check.

11. **`npm run docs:build` — 0 errors, 0 link warnings** (lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice). The cross-bucket JSDoc links from `ToolBar`/`ToolBarSeparator` must resolve.

12. **`graphify update .`** to refresh the knowledge graph.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/menubar/ToolBar.ts` |
| Create | `src/typescript/lib/component/menubar/ToolBarSeparator.ts` |
| Modify | `src/typescript/lib/component/menubar/index.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `docs/.vitepress/config.mts` (new "Toolbar" sidebar group) |
| Create | `docs/components/ToolBar.md` |
| Create | `docs/components/ToolBarSeparator.md` |
| Modify | `docs/components/index.md` (catalog entry) |
| Modify | `src/typescript/main.ts` (register demo) |
| Create | `src/typescript/demo/ToolBarPanel.ts` (or chosen demo file) |

---

## Verification

- `npx tsc --noEmit` produces no new errors above the baseline.
- `npx vite build` succeeds.
- Manual smoke at `http://localhost:8015` (ToolBarPanel demo):
  - Horizontal toolbar with Buttons, ToggleButtons, ButtonGroup, ToolBarSeparator, ComboBox renders with the toolbar background distinct from the surrounding panel and a thin bottom border.
  - Tab focus enters the toolbar at the first focusable child; Left/Right arrow keys cycle focus through focusable children, skipping the separator.
  - `setOrientation("vertical")` flips the strip to a single column with a right-edge border; arrow keys switch to Up/Down. `aria-orientation` updates in the inspector.
  - `setCompact(true)` reduces the inset and the gap visibly; `setCompact(false)` restores them.
  - Theme toggle (light ↔ dark) repaints toolbar bg, border, and separator colour without layout shift.
- `grep -rn 'role="toolbar"' src/typescript/lib/` — expect exactly one match (`ToolBar.ts`).
- `grep -rn 'aria-orientation' src/typescript/lib/component/menubar/` — expect matches in `ToolBar.ts` and `ToolBarSeparator.ts`.
- `npm run docs:build` — 0 errors and 0 link warnings (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice).
- `graphify update .` to refresh the knowledge graph.

---

## Documentation Impact

- **Per-subpath barrel:** `ToolBar`, `ToolBarSeparator`, `ToolBarOptions`, `ToolBarOrientation`, `ToolBarOverflow`, `ToolBarSeparatorOptions`, `ToolBarSeparatorOrientation` are exported from `src/typescript/lib/component/menubar/index.ts` (the existing menubar barrel — see [its current contents](../src/typescript/lib/component/menubar/index.ts)).
- **Curated docs pages:** new `docs/components/ToolBar.md` and `docs/components/ToolBarSeparator.md`. Pattern to mirror: [`docs/components/MenuBar.md`](../docs/components/MenuBar.md) and [`docs/components/MenuSeparator.md`](../docs/components/MenuSeparator.md). Add both to the components catalog at `docs/components/index.md`.
- **Sidebar:** add a new "Toolbar" group to [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts#L104-L110), positioned **before** the existing "Menus" group (toolbars are the more common entry point):
  ```ts
  { text: 'Toolbar', collapsed: false, items: [
      { text: 'ToolBar',          link: '/components/ToolBar' },
      { text: 'ToolBarSeparator', link: '/components/ToolBarSeparator' },
  ] },
  ```
- **Cross-bucket JSDoc:** every reference from `ToolBar` or `ToolBarSeparator` JSDoc to a class outside `component/menubar/` uses the markdown link form per CLAUDE.md — `[\`Panel\`](/api/core/classes/Panel)`, `[\`Component\`](/api/core/classes/Component)`, `[\`HBox\`](/api/layout/classes/HBox)`, `[\`VBox\`](/api/layout/classes/VBox)`, `[\`Button\`](/api/component/button/classes/Button)`, `[\`ToggleButton\`](/api/component/button/classes/ToggleButton)`, `[\`Glyph\`](/api/component/display/classes/Glyph)`, `[\`RovingTabIndex\`](/api/core/classes/RovingTabIndex)`. `{@link ToolBarSeparator}` from `ToolBar` is fine (same bucket).

---

## Potential Challenges

- **`RovingTabIndex.add` snapshots focusability at insertion time.** A child whose `tabindex` changes after `addComponent` (e.g. a disabled button later re-enabled) won't be retroactively added to the roving group. Mitigation: document the limitation in `ToolBar` JSDoc; if this bites in practice, add a `refreshFocusOrder()` setter in a follow-up.
- **Layout-manager swap during a re-layout.** If a caller toggles orientation while a child is mid-`doLayout`, `setLayoutManager` will detach and reattach — `Component.setLayoutManager` already handles this ([Component.ts:2652-2666](../src/typescript/lib/core/Component.ts#L2652-L2666)) so no extra guard is needed; just rely on the existing safety.
- **CSS-var gap parsing at construction time.** When the toolbar is constructed before its element is attached to the DOM, `getComputedStyle` returns empty strings for custom properties. Mitigation: fall back to the literal `4` and resolve from CSS again on first `doLayout`. Or skip the read entirely and hard-code `4` in the JS, relying on the `--ts-ui-toolbar-gap` variable for visual-only theming via direct CSS rules; this is the simpler path and matches how `MENU_BAR_BUTTON_HEIGHT` is encoded as a literal ([MenuBarButton.ts:41](../src/typescript/lib/component/menubar/MenuBarButton.ts#L41)). Prefer the hard-coded literal for v1.
- **`addSubtreeListener` matches descendants, not the toolbar root.** A child Button that handles its own `keydown` (e.g. Space to activate) won't be blocked by the toolbar's arrow-key handler — different keys. Confirmed via the `ButtonGroup.setContainer` pattern ([ButtonGroup.ts:167-175](../src/typescript/lib/core/ButtonGroup.ts#L167-L175)) which works the same way without interference.
- **`Panel<TOptions>` generic chain.** `ToolBar` must thread its options type through the `Panel<TOptions extends PanelOptions = PanelOptions>` generic ([Panel.ts:39](../src/typescript/lib/core/Panel.ts#L39)). Match the existing pattern exactly: `class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Panel<TOptions>`. Skipping the generic compiles in trivial usage but breaks subclasses.

---

## Critical Files

- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — parent class; the `<TOptions>` generic and the `_defaultPanelOptions` cascade pattern must be followed exactly.
- [src/typescript/lib/component/menubar/MenuBar.ts](../src/typescript/lib/component/menubar/MenuBar.ts) — closest sibling component; mirrors HBox layout, theme-driven chrome, and ARIA roles.
- [src/typescript/lib/component/menubar/MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts) — the options-cascade + `applyOptions` pattern to mirror for `ToolBarOptions` dispatching.
- [src/typescript/lib/component/container/MenuSeparator.ts](../src/typescript/lib/component/container/MenuSeparator.ts) — the structural template for `ToolBarSeparator`; the CSS-var-prefix trick is the analogue of toolbar's separator-color token.
- [src/typescript/lib/core/RovingTabIndex.ts](../src/typescript/lib/core/RovingTabIndex.ts) — keyboard-nav primitive; semantics of `add` / `moveNext` / `movePrev` are the contract.
- [src/typescript/lib/core/ButtonGroup.ts:158-178](../src/typescript/lib/core/ButtonGroup.ts#L158-L178) — `setContainer` is the canonical `addSubtreeListener` + roving-tabindex wiring pattern to mirror.
- [src/typescript/lib/layout/HBox.ts](../src/typescript/lib/layout/HBox.ts) and [src/typescript/lib/layout/VBox.ts](../src/typescript/lib/layout/VBox.ts) — `setComponentSpacing` and `setStretching` are the two settings preserved across orientation swaps.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — four blocks to edit in lockstep: `Theme` interface, `DefaultTheme`, `DarkTheme`, `themeToVars`.
- [src/typescript/lib/component/menubar/index.ts](../src/typescript/lib/component/menubar/index.ts) — barrel for the new exports.
- [docs/.vitepress/config.mts:104-110](../docs/.vitepress/config.mts#L104-L110) — sidebar group adjacent to the new "Toolbar" group.
- [plans/implemented/menu-bar.md](implemented/menu-bar.md) — original sister-component plan; tone and depth to mirror.

---

## Non-Goals

- **Overflow `"menu"` mode.** The setter is landed for forward-compat but `"menu"` resolves to `"clip"` behaviour in v1. A follow-up plan can implement the "≫" dropdown affordance.
- **Sticky / dockable / floating / torn-off toolbars.** A toolbar is layout-passive — the parent decides placement. Sticky-on-scroll, draggable-to-relocate, and float-as-window features all require coordination with the parent container's layout and are out of scope.
- **`Spacer` component.** Callers needing a flexible-width gap can use a plain `new Component()` with a `weight: 1` layout constraint (the HBox/VBox weight system already supports this — [HBox.ts:241-256](../src/typescript/lib/layout/HBox.ts#L241-L256)). Introducing a dedicated `Spacer` class is a separate decision that touches more than just the toolbar.
- **Auto-flipping child separators on `setOrientation`.** Callers rebuild or pre-configure children when flipping orientation. Auto-flip would leak `ToolBarSeparator` knowledge into `ToolBar`.
- **`addToolBarItem(item: ToolBarItem)` typed-item API.** The toolbar accepts any `Component`; no restrictive item type. Restricting children to a `ToolBarItem` union would force callers to wrap arbitrary inputs (TextField, ComboBox, etc.) in adapter types for no gain.
- **Per-child overflow priority.** `"menu"` mode (when it lands) will overflow trailing children first; no per-child `priority` setter in v1.
