# HeaderCell — Decompose Helpers Into Components — Implementation Plan

## Overview

[HeaderCell](../src/typescript/lib/component/table/cell/Header.ts) currently builds three helper DOM elements directly in `init()` and assigns multi-line `style.cssText` blobs to each one:
- a resize-drag handle `<div>` at [Header.ts:91-99](../src/typescript/lib/component/table/cell/Header.ts#L91-L99),
- a multi-sort priority badge `<span>` at [Header.ts:101-110](../src/typescript/lib/component/table/cell/Header.ts#L101-L110),
- a side-loaded `Glyph` element whose `cssText` is set at [Header.ts:180-185](../src/typescript/lib/component/table/cell/Header.ts#L180-L185).

This violates three CLAUDE.md rules at once: *one DOM element per class*, *attributes and styles go through typed setters*, and *defer DOM work to render time*. It also makes the helpers untestable in isolation, hard-codes presentation that should live in `Theme.ts`, and forces `init()` to re-implement event-routing logic that `Event.addListener` already gives us for free.

This plan extracts the resize handle and priority badge into dedicated `Component` subclasses, retires every `style.cssText` / inline-`style` assignment in [Header.ts](../src/typescript/lib/component/table/cell/Header.ts), and routes the side-loaded glyph's presentation through `Component` setters plus one shared CSS class rule. New theme tokens cover the resize-handle visuals and the sort-badge palette so dark-mode flipping works without inline fallbacks. The glyph stays *side-loaded* (not added through the Cell's `Card` layout manager) because the overlay position is decoration, not layout; the badge and handle follow the same convention.

---

## Architecture Decisions

### Extract `ResizeHandle` as its own `Component` subclass

Today the resize handle is a raw `<div>` that owns a `mousedown` listener, a stop-propagation `click` listener, and an inline gradient background that doubles as a 2-px visual indicator. It is a Component in everything but name. Extracting it into `src/typescript/lib/component/table/cell/ResizeHandle.ts` lets us:
- Use [`Event.addListener`](../src/typescript/lib/core/Event.ts) for the mousedown + click handlers instead of `el.addEventListener` (CLAUDE.md framework-rule: *Component listeners go through `Event.addListener`*).
- Express the static box (`position:absolute`, `top:0`, `right:0`, `width:5px`, `height:100%`, `z-index:1`) once as a shared class rule registered via [`CSS.createClassRule`](../src/typescript/lib/core/CSS.ts#L137), not per instance.
- Express the cursor + gradient through typed setters (`setCursor`, `setBackgroundImage`) on the per-instance `#id` style rule.
- Expose a clean callback API (`setOnDragStart`, `setOnDragMove`, `setOnDragEnd`) so HeaderCell owns the drag logic without poking into the handle's DOM.

`HeaderCell` keeps the drag bookkeeping (the `_isDragging` flag that suppresses the synthetic post-drag click, the `Event.addViewportListener` for mousemove/mouseup) because that state straddles the handle and the click-to-sort listener on the `<th>` itself.

### Extract `SortPriorityBadge` as its own `Component` subclass

Same shape, same justification. New file `src/typescript/lib/component/table/cell/SortPriorityBadge.ts`. The badge owns:
- A shared `.SortPriorityBadge` class rule for the absolute-positioned box (`position:absolute`, `top:2px`, `right:8px`, `font-size:10px`, `line-height:1`, `border-radius:3px`, `padding:1px 3px`, `pointer-events:none`).
- A typed `setPriority(value: number | null): this` that shows / hides the badge and writes the text content. Hidden state uses `setVisible(false)` (framework setter), not raw `display:none`.
- Background and foreground via `setBackgroundColor` / `setForegroundColor` once at construction with the new theme tokens (no inline `var(--ts-ui-sort-badge-bg, …)` fallbacks).

`HeaderCell` drops the `_priorityBadge: HTMLSpanElement | null` field and replaces it with `_priorityBadge: SortPriorityBadge`. The `setSortState` body collapses to `this._priorityBadge.setPriority(priority)`.

### Route the side-loaded glyph through Component setters

The header glyph is decoration on the `<th>`, not a layout child — it must stay overlay-positioned and outside the cell's `Card` layout manager so it does not collide with the renderer. But the *presentation* of that overlay can go through setters:

| Inline today | Replacement |
|---|---|
| `position:absolute` | `glyph.setPosition(Position.ABSOLUTE)` |
| `transform:translateY(-50%)` | `glyph.setTransform("translateY(-50%)")` |
| `width:16px;height:16px` | `glyph.setSize(GLYPH_W, GLYPH_H)` (numbers → px via `setWidth`/`setHeight`) |
| `color:var(--ts-ui-table-header-glyph-color, currentColor)` | `glyph.setForegroundColor("var(--ts-ui-table-header-glyph-color, currentColor)")` |
| `pointer-events:none` | `glyph.setPointerEvents("none")` |
| `left:var(--ts-ui-table-header-glyph-gap, 4px); top:50%` | one shared `.HeaderCellGlyph` class rule (`left`, `top` aren't on Component's typed-setter surface and percentage values don't fit `setX/setY`'s number signature — see *Potential Challenges*) |

The `.HeaderCellGlyph` rule is registered once at module load via `CSS.createClassRule` and applied to the side-loaded glyph element via `glyph.addCSSClass("HeaderCellGlyph")` (or the framework's equivalent — see [Critical Files](#critical-files) for confirmation). This leaves no `style.cssText` writes inside `_mountHeaderGlyph` at all.

### New theme tokens for handle + badge

The badge and handle are presentation; their colours and key dimensions belong in `Theme.ts`. The badge uses `--ts-ui-sort-badge-bg` and `--ts-ui-sort-badge-color`, which are *referenced* inline today but not declared on the `Theme` interface — they live as bare `var(..., fallback)` strings inside `style.cssText`. The handle's gradient bakes opacity-0.2 black directly into the source, no token at all. Add proper theme entries for both, matching the precedent already set by the table-header-glyph tokens (which were wired through `theme.table.header.glyph.{gap, color}` at [Theme.ts:629-630](../src/typescript/lib/core/Theme.ts#L629-L630)).

### Filename collision: `SortPriorityBadge`, not `Badge`

`Badge` is a name with cross-bucket collision risk (component/display, primitive, etc.). Spell it out — `SortPriorityBadge` — so JSDoc references and the future curated-page rename stay unambiguous (CLAUDE.md *name-collision symbols* rule). Same precedent set by [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts) avoiding the bare `Header`.

---

## Public API (TypeScript Signatures)

### `ResizeHandle` (new)

```typescript
// src/typescript/lib/component/table/cell/ResizeHandle.ts
import { Component, ComponentOptions } from "~/core/Component.js";

export interface ResizeHandleOptions extends ComponentOptions {
    onDragStart?: (event: MouseEvent) => void;
    onDragMove?:  (delta: number)     => void;
    onDragEnd?:   ()                  => void;
}

export class ResizeHandle extends Component<ResizeHandleOptions> {
    constructor(options?: ResizeHandleOptions);

    setOnDragStart(fn: (event: MouseEvent) => void): this;
    setOnDragMove (fn: (delta: number)     => void): this;
    setOnDragEnd  (fn: ()                  => void): this;
}
```

Backing fields (declared with `declare` to dodge the `useDefineForClassFields` super-cascade trap — see `feedback_class_field_super_trap` memory):

```typescript
declare private _onDragStart: ((e: MouseEvent) => void) | null;
declare private _onDragMove:  ((delta: number) => void) | null;
declare private _onDragEnd:   (() => void)              | null;
```

Internally: `setCursor("ew-resize")`, `setBackgroundImage("linear-gradient(...)")` (built from the new tokens), `setZIndex(1)`. Calls `Event.addListener(this, "mousedown", e => this._onDragStart?.(e))` and `Event.addListener(this, "click", e => e.stopPropagation())` in `init()`. The shared `.ResizeHandle` CSS class — registered once at module load via `CSS.createClassRule` — holds the layout (`position`, `top`, `right`, `width`, `height`).

### `SortPriorityBadge` (new)

```typescript
// src/typescript/lib/component/table/cell/SortPriorityBadge.ts
import { Component, ComponentOptions } from "~/core/Component.js";

export interface SortPriorityBadgeOptions extends ComponentOptions {
    priority?: number | null;
}

export class SortPriorityBadge extends Component<SortPriorityBadgeOptions> {
    constructor(options?: SortPriorityBadgeOptions);

    setPriority(value: number | null): this;
    getPriority(): number | null;
    clearPriority(): this;
}
```

`setPriority(null)` or `setPriority(p < 2)` calls `setVisible(false)`. `setPriority(p >= 2)` calls `setVisible(true)` and writes the text content via the existing `Text`-like API on Component (or a private `_textContent` field flushed in `render()`). Backing field declared with `declare`. Shared `.SortPriorityBadge` class rule holds the static box geometry.

### `HeaderCell` changes

Constructor signature, `setHeaderGlyph` / `getHeaderGlyph` / `clearHeaderGlyph`, `setSortState` / `getSortState` / `clearSortState`, `setOnSortClick`, `setOnContextMenu`, `setOnResizeDrag`, `setTooltip` / `getTooltip` all retain their current signatures. Internal fields change:

```typescript
// Was:
private _priorityBadge: HTMLSpanElement | null = null;
private _headerGlyphInstance: Glyph | null = null;

// Becomes:
declare private _resizeHandle:  ResizeHandle;
declare private _priorityBadge: SortPriorityBadge;
declare private _headerGlyphInstance: Glyph | null;
```

`_resizeHandle` and `_priorityBadge` are constructed in the HeaderCell constructor (after `super("th")`) and added to the cell via `addComponent`. `_headerGlyphInstance` remains side-loaded (`el.appendChild(glyph.getElement(true))`) because the overlay must live outside the Cell's `Card` layout manager.

`init()` no longer creates DOM nodes itself. It still wires the click + contextmenu listeners on the `<th>` and calls `_mountHeaderGlyph(el)` when `_headerGlyph` is set (the [Phase-5 fix](../src/typescript/lib/component/table/cell/Header.ts#L117-L119) for the `getElement()` returning `undefined` during init stays).

---

## Theme Tokens

| CSS Custom Property                       | Light Default                                                      | Dark Default                                                       | Purpose                                                          |
|-------------------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------|------------------------------------------------------------------|
| `--ts-ui-table-resize-handle-width`       | `5px`                                                              | `5px`                                                              | Hit area / visible width.                                        |
| `--ts-ui-table-resize-handle-color`       | `rgba(0,0,0,0.2)`                                                  | `rgba(255,255,255,0.25)`                                           | Indicator gradient solid colour.                                 |
| `--ts-ui-table-resize-handle-cursor`      | `ew-resize`                                                        | `ew-resize`                                                        | Cursor shown over the handle.                                    |
| `--ts-ui-sort-badge-bg`                   | `rgba(0,0,0,0.15)`                                                 | `rgba(255,255,255,0.2)`                                            | Multi-sort priority badge background.                            |
| `--ts-ui-sort-badge-color`                | `inherit`                                                          | `inherit`                                                          | Multi-sort priority badge text colour.                           |
| `--ts-ui-sort-badge-font-size`            | `10px`                                                             | `10px`                                                             | Badge text size.                                                 |

Add a `table.resizeHandle` block and a `table.sortBadge` block on the `Theme` interface in [Theme.ts](../src/typescript/lib/core/Theme.ts). Mirror entries in `DefaultTheme`, `DarkTheme`, and `themeToVars()`. All four sites need an edit (interface + two themes + mapper).

`--ts-ui-table-header-glyph-gap` and `--ts-ui-table-header-glyph-color` are already wired ([Theme.ts:629-630](../src/typescript/lib/core/Theme.ts#L629-L630)); the only change there is moving the `var(...)` references from inline `cssText` into the shared `.HeaderCellGlyph` class rule body.

---

## Internal Structure

### `.ResizeHandle` class rule (registered once at module load)

```typescript
// ResizeHandle.ts
let _classRuleInjected = false;

function ensureResizeHandleClassRule(): void {
    if (_classRuleInjected) {
        return;
    }

    _classRuleInjected = true;

    const rule = CSS.createClassRule("ResizeHandle");

    if (rule) {
        rule.style.cssText =
            "position:absolute;top:0;right:0;" +
            "width:var(--ts-ui-table-resize-handle-width,5px);" +
            "height:100%;z-index:1;";
    }
}
```

### `.SortPriorityBadge` class rule (same pattern)

```typescript
function ensureSortBadgeClassRule(): void {
    if (_classRuleInjected) {
        return;
    }

    _classRuleInjected = true;

    const rule = CSS.createClassRule("SortPriorityBadge");

    if (rule) {
        rule.style.cssText =
            "position:absolute;top:2px;right:8px;" +
            "font-size:var(--ts-ui-sort-badge-font-size,10px);" +
            "line-height:1;border-radius:3px;padding:1px 3px;" +
            "pointer-events:none;";
    }
}
```

### `.HeaderCellGlyph` class rule

```typescript
// in Header.ts (or its own module if reused)
function ensureHeaderCellGlyphClassRule(): void {
    if (_classRuleInjected) {
        return;
    }

    _classRuleInjected = true;

    const rule = CSS.createClassRule("HeaderCellGlyph");

    if (rule) {
        rule.style.cssText =
            "position:absolute;" +
            "left:var(--ts-ui-table-header-glyph-gap,4px);" +
            "top:50%;";
    }
}
```

The remaining glyph attributes (`transform`, `width`, `height`, `color`, `pointer-events`) go through Component setters on the `Glyph` instance — see *Public API* table.

---

## Ordered Implementation Steps

1. **Add the new theme tokens.** Edit [Theme.ts](../src/typescript/lib/core/Theme.ts) — four sites (interface, `DefaultTheme`, `DarkTheme`, `themeToVars`). Add `table.resizeHandle` and `table.sortBadge` blocks. **Verify:** `grep -n 'resize-handle\|sort-badge' src/typescript/lib/core/Theme.ts` returns hits in all four blocks.

2. **Write `ResizeHandle.ts`.** Create [src/typescript/lib/component/table/cell/ResizeHandle.ts](../src/typescript/lib/component/table/cell/ResizeHandle.ts). Module-level `ensureResizeHandleClassRule()`. Constructor calls it once. `setCursor`, `setBackgroundImage` (gradient built from the new tokens), `setZIndex(1)` in constructor. `init()` adds the `mousedown` + `click` listeners via `Event.addListener`. Callbacks stored in `declare`d backing fields, fired by the listeners. **Verify:** `npx tsc --noEmit` clean; visit the slow-table demo and confirm the handle still appears at the right edge and starts a drag on `mousedown`.

3. **Write `SortPriorityBadge.ts`.** Same shape as `ResizeHandle`. `setPriority` toggles visibility and writes text content; below-2 priorities collapse to invisible. **Verify:** unit-smoke via the existing multi-sort demo on `MiscPanel`'s table — click `Score`, then shift-click `Joined`, then shift-click `Active`. The 2nd and 3rd badges show "2" and "3" respectively; the 1st-priority sort shows no badge.

4. **Rewire `HeaderCell` constructor** to instantiate `ResizeHandle` and `SortPriorityBadge` as Component members. Add them via `addComponent(handle)` and `addComponent(badge)` so they participate in the framework's render lifecycle (even though they paint outside the renderer's space — both have `position:absolute` so they don't disturb the `Card` layout). Move drag-flag bookkeeping to lambdas wired into the handle's `setOnDragStart` / `setOnDragMove` / `setOnDragEnd` callbacks. Drop the `_priorityBadge: HTMLSpanElement` field. **Verify:** `grep -n 'document.createElement\|style.cssText' src/typescript/lib/component/table/cell/Header.ts` returns zero matches.

5. **Refactor `_mountHeaderGlyph`.** Replace the `gEl.style.cssText = …` block with Component setters on the new `Glyph` instance (`setPosition`, `setTransform`, `setSize`, `setForegroundColor`, `setPointerEvents`) plus a single `glyph.addCSSClass("HeaderCellGlyph")` to pick up the shared `.HeaderCellGlyph` class rule. Module-level `ensureHeaderCellGlyphClassRule()` runs on first mount. **Verify:** `grep -n 'cssText' src/typescript/lib/component/table/cell/Header.ts` returns zero matches.

6. **Confirm the offset math still works.** The renderer's left inset is `16 + 4 + themePad`; the `16` is now the value passed to `glyph.setSize(16, 16)` and the `4` is the default fallback inside `--ts-ui-table-header-glyph-gap`. Extract them as named constants (e.g. `const GLYPH_W = 16; const GLYPH_GAP = 4;`) in Header.ts so the magic numbers are explicit.

7. **`npm run typecheck` + `npm run build:lib` + `npm run docs:build`.** All clean; `docs:build` reports 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

8. **Manual demo verification.** Open `http://localhost:8015`, click *Show window with table (column spec)*. Confirm:
   - Name column shows the `xmark` glyph at 16×16, left-aligned with the cell's left padding.
   - Renderer text is shifted right to clear the glyph; no overlap.
   - Drag the right edge of any column — resize works, sort doesn't fire afterwards (the `_isDragging` suppression survived the refactor).
   - Shift-click multiple columns to multi-sort; priority badges 2 / 3 / … appear at top-right of each.
   - Theme-toggle to dark mode (the framework's theme switcher) — handle gradient, badge background, glyph colour all flip.

9. **`graphify update . --directed`.** Refresh the graph; commit `graphify-out/**` as its own commit.

---

## Files to Create / Modify / Delete

| Action | File                                                                                                                               |
|--------|------------------------------------------------------------------------------------------------------------------------------------|
| Create | `src/typescript/lib/component/table/cell/ResizeHandle.ts`                                                                          |
| Create | `src/typescript/lib/component/table/cell/SortPriorityBadge.ts`                                                                     |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` — drop raw `<div>` / `<span>` construction; use the new Components; rewrite `_mountHeaderGlyph`. |
| Modify | `src/typescript/lib/core/Theme.ts` — new `table.resizeHandle` and `table.sortBadge` blocks across four sites.                      |

No deletions. No public API surface changes from `HeaderCell` (signatures preserved). The two new helpers stay *internal* to the table bucket — re-exported only if a downstream consumer needs to compose them; default posture is to not export.

---

## Verification

- `grep -n 'style.cssText' src/typescript/lib/component/table/cell/Header.ts` → 0 matches.
- `grep -n 'document.createElement' src/typescript/lib/component/table/cell/Header.ts` → 0 matches.
- `grep -rn 'ts-ui-sort-badge-\|ts-ui-table-resize-handle-' src/typescript/lib/core/Theme.ts` → 4 hits per token (interface + two themes + mapper).
- `npm run typecheck` clean for `src/typescript/lib/`.
- `npm run build:lib` clean.
- `npm run docs:build` — 0 errors, 0 link warnings.
- Manual demo per step 8.
- `graphify update . --directed` succeeds; new `ResizeHandle` and `SortPriorityBadge` nodes appear in `graphify-out/GRAPH_REPORT.md`.

---

## Documentation Impact

The two new helpers are internal table-bucket components. They live under `src/typescript/lib/component/table/cell/` alongside `Default.ts`, `Boolean.ts`, etc., none of which are individually documented in `docs/`. Default posture: don't add curated pages. If a future consumer needs to compose them, re-export from [src/typescript/lib/component/table/index.ts](../src/typescript/lib/component/table/index.ts) and add an entry to the table catalog at that point.

`HeaderCell`'s public API signatures don't change — typedoc-generated pages refresh without manual edits. Verify by running `npm run docs:build` and checking that `docs/api/component/table/classes/HeaderCell.md` still lists `setSortState`, `clearSortState`, `setHeaderGlyph`, `setTooltip`, etc.

---

## Potential Challenges

- **No `setLeft` / `setTop` setter accepting CSS strings.** `setX(n: number)` and `setY(n: number)` write `n + "px"`, which forecloses `top:50%`. Mitigation: bake the percentage values into the shared class rules, not into instance setters. The class rule is set once at module load, so it satisfies the "no per-instance inline style" goal without needing a new typed setter.
- **`addCSSClass` may not exist on `Component`.** If it does not, the cleanest path is to add it as a new typed method on `Component.ts` (under "All attributes and styles go through typed setters") with a paired `removeCSSClass` / `clearCSSClasses`. Alternatively use the existing pattern from `Glyph.setAnimated` — register the rule via `CSS.createClassRule` and apply the class via `element.classList.add` *during render* (not in the setter). The setter sets a `_extraClass: string | null` field; render-time hook adds it to the element. This keeps the typed-setter contract intact.
- **Card layout placement of the two new sub-components.** Adding `ResizeHandle` and `SortPriorityBadge` via `addComponent` puts them inside the `Card` layout. Card stacks all children at the same offset; both helpers carry `position:absolute` and override layout placement, so they "escape" the Card flow. Verify in step 8 that the renderer's text isn't pushed down by the helpers occupying layout space — if it is, the helpers need to render with `setIncludedInLayout(false)` (or equivalent — check the framework for an exclude-from-layout API; if missing it's a separate concern outside this plan).
- **Theme-token cascade through subclasses.** `ResizeHandle.setBackgroundImage` writes a `linear-gradient` string. If the token defaults are CSS custom properties, the gradient must use them as `var(--token, fallback)` inside the gradient string. Confirmed pattern in [popover-component.md:128-156](popover-component.md) — same approach.
- **The badge's text content needs a typed-setter route too.** Setting raw `textContent` violates the same rule as `style.cssText`. The framework has a `Text` component used elsewhere; the badge can embed a `Text` child or expose its own `setText` method that buffers and writes during `render()` (matching the pattern in [`Text.ts`](../src/typescript/lib/component/input/Text.ts)).

---

## Critical Files

- [src/typescript/lib/component/table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts) — the file under refactor.
- [src/typescript/lib/component/table/cell/Default.ts](../src/typescript/lib/component/table/cell/Default.ts) — parent class; renderer/editor wiring.
- [src/typescript/lib/component/table/cell/Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) — sets `Card` layout manager at [Cell.ts:38](../src/typescript/lib/component/table/cell/Cell.ts#L38); important for understanding why ResizeHandle and SortPriorityBadge must use absolute positioning.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — the setter surface (`setCursor`, `setBackgroundImage`, `setForegroundColor`, `setBackgroundColor`, `setPosition`, `setTransform`, `setPointerEvents`, `setZIndex`, `setVisible`, `setWidth`, `setHeight`, `setSize`). Confirm `addCSSClass` exists or add it.
- [src/typescript/lib/core/CSS.ts](../src/typescript/lib/core/CSS.ts) — `createClassRule(name)` and `getMainStyle()`; pattern reused from `Glyph.setAnimated`'s keyframe + class-rule injection.
- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — `Event.addListener` / `Event.addViewportListener`.
- [src/typescript/lib/primitive/Position.ts](../src/typescript/lib/primitive/Position.ts) — enum used by `setPosition`.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — token wiring, four sites; existing precedent at lines 629-630 for `table.header.glyph` tokens.
- [feedback_class_field_super_trap](../../../../home/jika/.claude/projects/-home-jika-typescript-typescript/memory/feedback_class_field_super_trap.md) — memory note: declare-style backing fields, not `=` initializers, on Components whose setters dispatch through `applyOptions`.

---

## Non-Goals

- **Replacing the `Card` layout manager** on Cell. The overlay model (handle + badge + glyph all sitting outside the renderer's flow) is intentional; switching to a Border or HBox layout would break the renderer's full-width assumption.
- **Adding `setLeft` / `setTop` to `Component.ts`.** Percentage values for absolute-positioned overlays live in class rules in this codebase; introducing string-accepting positional setters is a bigger framework decision than one refactor should make.
- **Public-API change for HeaderCell.** All public method signatures stay byte-identical. Only internals change.
- **Reusing `ResizeHandle` outside `<th>`.** It's table-specific for now (the gradient orientation assumes the handle is on the right edge of its parent). A general-purpose Split-style handle is a separate plan.
- **Theme-aware glyph default fallbacks.** The existing `var(--ts-ui-table-header-glyph-color, currentColor)` fallback is preserved verbatim — no change to the glyph's colour-resolution rule.
- **Replacing `setTimeout(…, 0)`** at [Header.ts:341](../src/typescript/lib/component/table/cell/Header.ts#L341) for the drag-flag reset. That's a separate ordering concern.
