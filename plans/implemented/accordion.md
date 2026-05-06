# Accordion Layout Manager — Implementation Plan

## Overview

The Accordion is a vertical layout manager that stacks sections, each with a clickable header and a collapsible content panel. Sections can be open or closed; a `singleOpen` mode forces at most one section open at a time. Animation uses a CSS `height` transition with `overflow: hidden` on a wrapper component — not `setVisible(false)` — so the component participates correctly in the layout model without becoming layout-invisible.

The design follows the `Tab` layout's precedent: the layout manager owns internally-created header components (not exposed through `container.getComponents()`), appends them directly to the container's DOM element, and positions content components manually in `doLayout`.

---

## Architecture Decisions

### `Accordion extends LayoutManager` (not Component)

Consistent with `Tab`, `HBox`, `VBox`, `Card`. The container component is whatever the user provides. The layout manager owns the visual chrome (headers). `container.getComponents()` returns only content panels — headers are invisible to parent size calculations and other layout managers.

### `AccordionHeader extends Button` (not ToggleButton)

Open/closed state is tracked in the `Accordion` instance, not in the header button. `ToggleButton` couples visual selected-state to internal boolean. Since `Accordion` is the authority on open/closed state (especially in `singleOpen` mode), an ordinary `Button` is cleaner. The indicator icon is updated programmatically by `header.setExpanded(bool)`.

### `AccordionConstraints extends LayoutConstraints`

Adds:
- `label: string` — header text
- `initiallyOpen?: boolean` — whether the section starts expanded

### Animation via CSS height transition

The content panel is wrapped in an intermediate "panel wrapper" `Component` with `overflow: hidden` and a CSS `transition` on `height`. Setting `height: 0` collapses it; restoring the content height expands it. This avoids `setVisible(false)` (which sets `visibility: hidden` but still occupies space) and `setDisplayed(false)` (which breaks animation).

Transitioning from pixel height to `0` and back animates correctly. The content component's `getPreferredSize()` provides the target height — no DOM measurement needed.

### Open/closed state array

`Accordion` maintains `private openState: boolean[]` indexed parallel to `container.getComponents()`. New entries are appended in `doLayout` as sections are added (lazy initialisation, same pattern as `Tab`'s `tabs` array).

---

## Public API (TypeScript Signatures)

### `AccordionConstraints`

```typescript
export class AccordionConstraints extends LayoutConstraints {
    label: string;
    initiallyOpen?: boolean;
    constructor(label: string, initiallyOpen?: boolean);
}
```

### `AccordionHeader`

```typescript
export class AccordionHeader extends Button {
    constructor(label: string);
    getIndicator(): Component;
    setExpanded(expanded: boolean): void;
    isExpanded(): boolean;
}
```

The indicator is a CSS-only `span` inside the header that rotates via a CSS class toggle `expanded` on its element.

### `Accordion`

```typescript
export type SectionToggleCallback = (index: number, open: boolean) => void;

export class Accordion extends LayoutManager {
    isSingleOpen(): boolean;
    setSingleOpen(value: boolean): void;

    getHeaderHeight(): number;
    setHeaderHeight(height: number): void;

    getAnimationDuration(): number;
    setAnimationDuration(ms: number): void;

    openSection(index: number): void;
    closeSection(index: number): void;
    isSectionOpen(index: number): boolean;

    setOnSectionToggle(callback: SectionToggleCallback | null): void;

    attach(container: Component): void;
    detach(): void;

    getPreferredSize(): Size | null;
    getMinSize(): Size | null;
    getMaxSize(): Size | null;

    doLayout(): void;
}
```

---

## Theme Tokens

```typescript
accordion: {
    header: {
        background: string;
        border    : string;
        color     : string;
    };
    panel: {
        border: string;
    };
    indicator: {
        color: string;
    };
};
```

| CSS Custom Property | Light Default | Dark Default |
|---|---|---|
| `--ts-ui-accordion-header-bg` | `linear-gradient(rgb(230,230,230),rgb(210,210,210))` | `linear-gradient(rgb(60,60,60),rgb(45,45,45))` |
| `--ts-ui-accordion-header-border` | `rgb(190,190,190)` | `rgb(80,80,80)` |
| `--ts-ui-accordion-header-color` | inherits `--ts-ui-text-color` | inherits `--ts-ui-text-color` |
| `--ts-ui-accordion-panel-border` | `rgb(210,210,210)` | `rgb(70,70,70)` |
| `--ts-ui-accordion-indicator-color` | `rgb(100,100,100)` | `rgb(160,160,160)` |

---

## Ordered Implementation Steps

### Step 1 — Create `AccordionConstraints`

`Base/layout/AccordionConstraints.ts`. Extends `LayoutConstraints`. Adds `label: string` and `initiallyOpen?: boolean`. No other logic.

### Step 2 — Create `AccordionHeader`

`Base/component/AccordionHeader.ts`. Extends `Button`.

- Override `Button` default styles: flat appearance, no box shadow, solid bottom border via `var(--ts-ui-accordion-header-border)`.
- Create an indicator `Component` (a styled `<span>`) positioned at the right side of the header; added as a child via `addComponent`.
- `setExpanded(bool)`: toggles CSS class `expanded` on the indicator element, which a CSS rule rotates via `transform: rotate(90deg)`.
- `isExpanded()`: returns current boolean.

`AccordionHeader` does NOT manage open/closed state — it only manages the visual indicator.

### Step 3 — Create `Accordion` layout manager

`Base/layout/Accordion.ts`.

**Private fields:**
```typescript
private headers: AccordionHeader[];
private panelWrappers: Component[];
private openState: boolean[];
private singleOpen: boolean;
private headerHeight: number;
private animationDuration: number;
private onSectionToggleCallback: SectionToggleCallback | null;
```

**`attach(container)`:** Call `super.attach(container)`. Headers and panel wrappers are created lazily in `doLayout`.

**`detach()`:** Call `super.detach()`. Remove all header and panel wrapper elements from the DOM.

**Private `createSection(component, index)`:**
1. Read `AccordionConstraints` via `this.getLayoutConstraints(component) as AccordionConstraints`.
2. Create `AccordionHeader` with `constraints.label`.
3. Style header: full container width, `headerHeight` px tall, absolute position.
4. Wire click: `Event.addListener(header, 'click', () => this.onHeaderClicked(index))`.
5. Create panel wrapper `Component`, set `overflow: hidden`, `position: absolute`.
6. Apply CSS transition inline: `element.style.transition = 'height ${animationDuration}ms ease'`.
7. Append header element and panel wrapper element directly to `container.getElement()` (NOT via `addComponent`).
8. Set initial open state from `constraints.initiallyOpen ?? false`.
9. Set `header.setExpanded(openState[i])`.
10. Set ARIA: `header.getAria().setRole('button')`, `panelWrapper.getAria().setRole('region')`.

**`doLayout()`:**
- For each component at index `i >= this.headers.length`: call `createSection(component, i)`.
- Walk sections: compute y = sum of header heights and open panel heights so far.
- Position each header: `setX(insets.left)`, `setY(y)`, `setWidth(containerWidth)`, `setHeight(headerHeight)`.
- Panel wrapper height: `openState[i] ? component.getPreferredSize()?.height ?? defaultContentHeight : 0`.
- Position panel wrapper: `setX(insets.left)`, `setY(y + headerHeight)`, `setWidth(containerWidth)`, `setHeight(panelHeight)`.
- Inside panel wrapper, position content component at `(0, 0, containerWidth, panelHeight)`.
- Advance `y += headerHeight + panelHeight`.

**`onHeaderClicked(index)`:**
1. If `singleOpen` and opening: call `closeSection(i)` for all `i !== index`.
2. Toggle `openState[index]`.
3. Update `header.setExpanded(openState[index])` and ARIA `aria-expanded`.
4. Fire `onSectionToggleCallback`.
5. Call `doLayout()`.

**`openSection(index)` / `closeSection(index)`:**
- Validate bounds, set `openState[index]`, update header indicator and ARIA, fire callback, call `doLayout()`.

**`getPreferredSize()`:** Sum all header heights plus preferred heights of open sections.

**`getMinSize()`:** Sum of all header heights (headers always visible) plus perimeter.

### Step 4 — Animation

The CSS `transition` on the panel wrapper's `height` handles animation automatically when `setHeight()` is called. `getPreferredSize()` on the content component provides pixel heights — no `height: auto` animation problem.

### Step 5 — Theme integration

Add `accordion` block to `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars()`.

### Step 6 — Export from `index.ts`

```typescript
export { Accordion }            from './layout/Accordion.js';
export { AccordionConstraints } from './layout/AccordionConstraints.js';
export { AccordionHeader }      from './component/AccordionHeader.js';
export type { SectionToggleCallback } from './layout/Accordion.js';
```

### Step 7 — Extend `Aria.ts`

Add `'button'` and `'region'` to the `AriaRole` union if not already present.

---

## Key Challenges

**Content component positioning inside panel wrapper:** Panel wrappers are appended directly to the container's DOM element. Content components are in `container.getComponents()`. In `doLayout`, position content components at `(0, 0)` inside the wrapper by calling `component.setX(0)`, `component.setY(0)`, `component.setWidth(containerWidth)`, `component.setHeight(panelHeight)` directly — not via `placeComponent` which uses container-relative coordinates.

**`getLayoutConstraints` cast:** Returns `LayoutConstraints | undefined`. Cast to `AccordionConstraints` with a runtime guard.

**`addComponent` parent guard:** Panel wrappers are created internally and appended to DOM directly — they never go through `addComponent`. Content components ARE added via `container.addComponent` by the user and get `_parent` set correctly.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `Base/layout/AccordionConstraints.ts` |
| Create | `Base/layout/Accordion.ts` |
| Create | `Base/component/AccordionHeader.ts` |
| Modify | `Base/Theme.ts` |
| Modify | `Base/index.ts` |
| Modify | `Base/Aria.ts` (add `'button'`, `'region'` to `AriaRole`) |

---

## Critical Files

- `src/typescript/Base/layout/Tab.ts` — primary structural reference; the `attach`/`detach`/`doLayout` pattern is the direct template
- `src/typescript/Base/layout/LayoutManager.ts` — `placeComponent`, `getLayoutConstraints`, `setLayoutConstraints`
- `src/typescript/Base/Theme.ts`
- `src/typescript/Base/component/Button.ts`
- `src/typescript/Base/index.ts`
