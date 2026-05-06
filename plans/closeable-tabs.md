# Closeable Tabs — Implementation Plan

## Overview

Adds closeable tab support to the existing `Tab` layout manager. The feature introduces a `CloseButton` component, extends `LayoutConstraints` with a `closeable` flag, restructures how the tab toolbar is populated (each tab slot becomes an HBox wrapper containing a `ToggleButton` and an optional `CloseButton`), and provides a `setOnTabClose` callback API on `Tab`.

---

## Architecture Decisions

### `TabEntry` as a private bookkeeping interface

The `Tab` class maintains one `TabEntry` per child component:

```typescript
interface TabEntry {
    wrapper     : Component;     // HBox container added to the toolbar
    button      : ToggleButton;  // the tab label button
    closeButton?: CloseButton;   // present only when closeable === true
}
```

`this.tabs` is retyped from `Array<Component>` to `Array<TabEntry>`. Every place that reads `this.tabs[i]` as a `ToggleButton` must be updated to read `this.tabs[i].button`.

### Wrapper Component uses HBox layout

Each `TabEntry.wrapper` is a `Component` configured with an `HBox` layout manager. The `ToggleButton` is always the first child; the `CloseButton` is appended only when `constraints.closeable === true`. The wrapper is what gets added to the toolbar — not the button directly.

The wrapper has zero insets, transparent background, no border, no shadow, and inherits height from the toolbar's own `setPreferredSize(0, 30)`.

### `CloseButton extends Button`

Minimal subclass of `Button`. Renders a small "×" label, suppresses all default `Button` decorations (gradient background, ridge border, shadow), and applies compact sizing. Lives in `Base/component/CloseButton.ts`.

### `closeable` field on `LayoutConstraints`

A single optional boolean `closeable?: boolean` added to `LayoutConstraints`. Defaults to `undefined` (falsy), meaning tabs are not closeable by default.

### `setOnTabClose` — notification-only callback

`Tab` exposes `setOnTabClose(callback: (component: Component) => void)`. The callback receives the content `Component` being removed. Close always proceeds regardless of what the callback does (notification-only, not a guard).

### Active-tab selection after close

`closeTab(entry)` removes the entry from `this.tabs`, removes the wrapper from the toolbar, and removes the content component from the container. Then: prefer the left neighbor; if none, the right (now at the same index after splice); if no tabs remain, `selectedTabIndex = 0` with a guard in `getVisibleComponent`.

### `CloseButton` NOT added to `ButtonGroup`

Only the `ToggleButton` (tab label button) is added to the `ButtonGroup`. The `CloseButton` is a plain `Button`.

---

## Public API (TypeScript Signatures)

### `CloseButton` (new file)

```typescript
export class CloseButton extends Button {
    constructor();
}
```

No additional public methods. Callers use `addActionListener` to attach click handlers.

### `LayoutConstraints` (modified)

```typescript
export class LayoutConstraints {
    // ...existing fields...
    closeable?: boolean;  // NEW
}
```

### `Tab` (modified — public surface only)

```typescript
export class Tab extends LayoutManager {
    // All existing public methods — unchanged signatures.

    // NEW:
    setOnTabClose(callback: (component: Component) => void): void;
}
```

`closeTab` and `selectNextTab` are private methods.

---

## Ordered Implementation Steps

### Step 1 — Add `closeable` to `LayoutConstraints`

`Base/layout/LayoutConstraints.ts`: add `closeable?: boolean;` after the existing `data?: any` field.

### Step 2 — Create `CloseButton`

`Base/component/CloseButton.ts`:

- `constructor()` calls `super("×")`.
- Reset visual decorations: `setBackgroundColor("transparent")`, `setBackgroundImage(null)`, no border, no shadow, `setBorderRadius("2px")`, `setPreferredSize(16, 16)`, `setInsets(new Insets(0, 0, 0, 0))`.
- `setForegroundColor("var(--ts-ui-close-button-fg, #555)")`.

### Step 3 — Refactor `Tab` internals

`Base/layout/Tab.ts`:

#### 3a. Add imports

```typescript
import { HBox }        from "./HBox.js";
import { CloseButton } from "../component/CloseButton.js";
```

#### 3b. Add `TabEntry` interface (module scope, unexported)

```typescript
interface TabEntry {
    wrapper     : Component;
    button      : ToggleButton;
    closeButton?: CloseButton;
}
```

#### 3c. Retype fields

- `private tabs: Array<TabEntry>` (was `Array<Component>`)
- `private onTabClose: ((component: Component) => void) | null = null;`

#### 3d. Update `onTabPressed`

```typescript
onTabPressed(tab: Component): void {
    const idx = this.tabs.findIndex(entry => entry.button === tab);
    if (idx >= 0) {
        this.selectedTabIndex = idx;
    }
    this.doLayout();
}
```

#### 3e. Rewrite `createTab`

1. Create `tabButton = new ToggleButton(name)` and apply existing styling.
2. Wire `tabButton.addActionListener(() => this.onTabPressed(tabButton))`.
3. Create `wrapper = new Component()`, set `new HBox()` as layout manager (componentSpacing: 0, insets: 0).
4. `wrapper.addComponent(tabButton)`.
5. If `constraints?.closeable`:
   - Create `closeButton = new CloseButton()`.
   - `closeButton.addActionListener(() => this.closeTab(entry))`.
   - `wrapper.addComponent(closeButton)`.
6. Build `entry: TabEntry = { wrapper, button: tabButton, closeButton }`.
7. `this.tabs.push(entry)`.
8. `this.buttonGroup.addButton(tabButton)`.
9. `this.toolbar.addComponent(wrapper)` ← was `addComponent(tabButton)`.
10. Set ARIA roles on `tabButton` and `component` as before.

#### 3f. Update `doLayout`

ARIA loop must now reference `this.tabs[i].button`:
```typescript
this.tabs[i].button.getAria().setSelected(i === this.selectedTabIndex);
```

#### 3g. Update `onToolbarKeyDown`

```typescript
const newTab = this.tabs[newIdx].button;
this.tabs.forEach(entry => entry.button.setSelected(false));
newTab.setSelected(true);
this.onTabPressed(newTab);
newTab.focus();
```

#### 3h. Add `setOnTabClose`

```typescript
setOnTabClose(callback: (component: Component) => void): void {
    this.onTabClose = callback;
}
```

#### 3i. Add private `closeTab`

```typescript
private closeTab(entry: TabEntry): void {
    const container = this.getContainer();
    if (!container) { return; }

    const entryIndex = this.tabs.indexOf(entry);
    if (entryIndex < 0) { return; }

    const components = container.getComponents();
    const contentComponent = components[entryIndex];

    this.buttonGroup.removeButton(entry.button);
    this.tabs.splice(entryIndex, 1);
    this.toolbar.removeComponent(entry.wrapper);
    container.removeComponent(contentComponent);

    if (this.onTabClose && contentComponent) {
        this.onTabClose(contentComponent);
    }

    this.selectNextTab(entryIndex);
    this.doLayout();
}
```

#### 3j. Add private `selectNextTab`

```typescript
private selectNextTab(closedIndex: number): void {
    const count = this.tabs.length;

    if (count === 0) {
        this.selectedTabIndex = 0;
        return;
    }

    const newIndex = closedIndex > 0 ? closedIndex - 1 : 0;
    this.selectedTabIndex = newIndex;

    this.tabs.forEach(e => e.button.setSelected(false));
    this.tabs[newIndex].button.setSelected(true);
}
```

### Step 4 — Export `CloseButton` from `index.ts`

Add in the "Components — buttons" section:

```typescript
export { CloseButton } from './component/CloseButton.js';
```

### Step 5 — Fix `ButtonGroup.removeButton` splice

`Base/ButtonGroup.ts`: confirm `this.buttons.splice(idx, 1)` (not `splice(idx)` which removes to end). Fix if needed.

---

## Potential Challenges

**`onTabPressed` lookup**: after refactor, `tabs` holds `TabEntry` objects so `indexOf` no longer works. Use `findIndex(entry => entry.button === tab)`.

**HBox wrapper height**: the toolbar has `setPreferredSize(0, 30)`. The wrapper's HBox will size its children. `CloseButton` has `setPreferredSize(16, 16)` and will be vertically centered by HBox at its preferred height. No special handling needed.

**`selectedTabIndex` consistency after removal**: `selectNextTab` picks `closedIndex - 1` when possible (left neighbor, index unchanged) or `0` when the leftmost tab was closed. The index is always valid for the post-splice array.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `Base/component/CloseButton.ts` |
| Modify | `Base/layout/Tab.ts` |
| Modify | `Base/layout/LayoutConstraints.ts` |
| Modify | `Base/index.ts` |
| Fix bug | `Base/ButtonGroup.ts` (splice off-by-one) |

---

## Critical Files

- `src/typescript/Base/layout/Tab.ts`
- `src/typescript/Base/component/CloseButton.ts`
- `src/typescript/Base/layout/LayoutConstraints.ts`
- `src/typescript/Base/ButtonGroup.ts`
- `src/typescript/Base/index.ts`
