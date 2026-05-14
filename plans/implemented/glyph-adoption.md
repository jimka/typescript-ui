# Glyph Adoption — Replace FontAwesome and Add Icon Slots Across Components

## Overview

This plan adopts the `Glyph` component built in [embedded-glyph.md](embedded-glyph.md) at every site in the library where an icon belongs. It also retires FontAwesome — the script tags, the peer dependency, the asset tree, and the `FontAwesomeIcon` class — after the last call site has been migrated.

The sites covered:

1. **`WindowHeader`** — two slots: an existing right-side close icon (currently FontAwesome `times`) and a new left-side title icon shown to the left of the header text.
2. **`Button` family** — `Button`, `ToggleButton`, `TabCloseButton`. Optional leading glyph beside the text label.
3. **`MenuBarButton`** — optional leading glyph slot.
4. **`TreeRow`** — replace the raw Unicode `▶`/`▼` toggle characters with `Glyph` instances ([TreeRow.ts:98](../src/typescript/lib/component/tree/TreeRow.ts#L98)). The `Glyph` looks the character up in the registry itself; `TreeRow` never sees the raw Unicode character.
5. **Table cells** — a new read-only `Glyph` cell type plus matching renderer.
6. **`IconText` composite** — a small new component combining a `Glyph` with a `Text` label.
7. **`IconLabel` composite** — sibling of `IconText` that pairs a `Glyph` with a `<label>` ([Label.ts](../src/typescript/lib/component/input/Label.ts)), for icons attached to form-control labels.

Adoption proceeds component-by-component. Each conversion stands on its own and is independently reviewable; FontAwesome removal is the last step and only runs once every call site is off it.

Prerequisite: [embedded-glyph.md](embedded-glyph.md) is complete. `Glyph`, `Glyphs.ts` (with `times`, `arrow-right`, `arrow-down`), and the `display` index export already exist.

---

## Architecture Decisions

### Optional slot exposed two ways: setter **and** options bag

Every component that gains a glyph slot exposes it through **both** a setter (e.g. `Button#setGlyph(name | null)`) **and** a `glyph?: string` field in its options bag. Existing constructors stay backward-compatible (no new positional parameter); the options-bag entry is processed through `applyOptions`, matching the project's existing convention for optional construction-time properties.

For components that currently have **no** options bag (today: [MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts)), this plan adds one. The constructor gains an optional trailing `options?: MenuBarButtonOptions` argument; existing positional call sites continue to work unchanged.

### Layout: glyph left of text, single horizontal flow

Where a component has both a glyph and text (Button, MenuBarButton, IconText), the glyph sits to the left of the text with a small fixed gap (8px). Both Button and MenuBarButton currently lay out a single text child; switching to a horizontal arrangement with optional glyph is a localised layout change in each class. No new layout manager is introduced — use the existing layout primitives (`Flow`, manual positioning in `doLayout()`, etc.) the way each component already does.

### `IconText` and `IconLabel` are small public composites, not base classes

Two parallel composites live in `display/`:

- **`IconText`** — `Glyph + Text` in a horizontal box. For ad-hoc icon-with-text needs (a status line, a toolbar caption, anything not tied to a form control).
- **`IconLabel`** — `Glyph + Label` in a horizontal box. For form-control labels with an icon: the inner `Label` requires a `forId` and emits a `<label for="...">` element, so the resulting HTML is `[Glyph] <label for="…">text</label>` and clicking either the glyph or the text still focuses the associated control (the surrounding component delegates click through to the label).

The two are deliberately separate components rather than one parameterised composite, because `Label` carries the mandatory `forId` constraint and `Text` does not — folding them into one component would force a runtime branch on whether `forId` was supplied. Two short classes are clearer than one with two modes.

Implementing Button and MenuBarButton in terms of `IconText` is **out of scope** — those components already handle their own text and adding a glyph there is a localised change. Refactoring them onto `IconText` would touch their public API more than the user asked for.

### Tree toggles become `Glyph`, not `Text`

[TreeRow.ts](../src/typescript/lib/component/tree/TreeRow.ts) currently holds the toggle as a `Text` field and calls `setText("▶")`. Convert it to a real `Glyph`: the field type changes from `Text` to `Glyph | null`, and `setRowData` swaps in a fresh `Glyph("arrow-down")` / `Glyph("arrow-right")` instance (or `null` for leaves) instead of mutating text.

`TreeRow` must never know the underlying character — it asks the registry for the glyph by name. That is the whole point of the registry: one source of truth for "what arrow do we use". If a theme later wants chevrons or filled triangles, the change happens in one place (the registry, or an SVG entry replacing the char entry) without TreeRow caring.

The cost is one DOM mutation per expand/collapse instead of a `textContent` write. Expansion is user-driven and not on a perf hot path; the cost is acceptable. If profiling later shows it matters for bulk expand-all, revisit by caching two `Glyph` instances per row and toggling visibility — still without TreeRow handling characters directly.

### New table cell type: `Glyph` (read-only)

Table cells live in [src/typescript/lib/component/table/cell/](../src/typescript/lib/component/table/cell/). The new cell mirrors the simplest existing one ([String.ts](../src/typescript/lib/component/table/cell/String.ts), 41 lines):

- A `Glyph`-cell that takes a glyph **name** from the row data and renders the corresponding `Glyph`.
- A matching renderer in [cell/renderer/](../src/typescript/lib/component/table/cell/renderer/).
- Read-only only. No editor counterpart. Editing a glyph by typing into a cell is not a use case.

### FontAwesome removal is the final step

The script tags, peer dependency, `FontAwesomeIcon` class, and asset tree all go away in one final pass once every other step has merged. A grep for `fontawesome|FontAwesome|fa-` must return zero matches before this step runs.

---

## Public API (TypeScript Signatures)

### `Button` (and subclasses)

```typescript
export interface ButtonOptions extends ComponentOptions {
    text?:   string;
    glyph?:  string | null;     // new — registry name; null clears
    // ...existing options
}

class Button extends Component {
    setGlyph(name: string | null): this;
    getGlyph(): Glyph | null;
    // ...existing methods
}
```

`ToggleButton` and `TabCloseButton` inherit the slot from `Button`. `TabCloseButton`'s constructor seeds it with `"times"` so it ships an X icon by default.

### `WindowHeader`

```typescript
export interface WindowHeaderOptions extends HeaderOptions {
    closeable?: boolean;
    glyph?:     string | null;   // new — title icon shown left of header text
}

class WindowHeader extends Header {
    setGlyph(name: string | null): this;
    getGlyph(): Glyph | null;
    // ...existing methods (incl. addExitButtonListener, setActive)
}
```

The title-icon slot is owned by `WindowHeader`, not the base `Header`. Plain `Header` instances do not gain an icon slot in this plan — adding it there can be a follow-up if a non-window use case appears.

### `MenuBarButton`

```typescript
export interface MenuBarButtonOptions extends ComponentOptions {
    glyph?: string | null;
}

class MenuBarButton extends Component {
    constructor(text: string, onClick: () => void, onHover: () => void, options?: MenuBarButtonOptions);
    setGlyph(name: string | null): this;
    getGlyph(): Glyph | null;
    // ...existing methods
}
```

The constructor gains a trailing optional `options` parameter; existing 3-arg call sites continue to compile.

### `IconText` — `src/typescript/lib/component/display/IconText.ts`

```typescript
export interface IconTextOptions extends ComponentOptions {
    glyph?: string;
    text?:  string;
    gap?:   number;          // px between glyph and text, default 8
}

export class IconText extends Component {
    constructor(glyph: string, text: string, options?: IconTextOptions);
    setGlyph(name: string): this;
    setText(text: string): this;
    setGap(px: number): this;
    getGlyphComponent(): Glyph;
    getTextComponent(): Text;
}
```

Placed in `display` (sibling of `Glyph`, `Header`, `Image`).

### `IconLabel` — `src/typescript/lib/component/display/IconLabel.ts`

```typescript
export interface IconLabelOptions extends ComponentOptions {
    glyph?: string;
    text?:  string;
    forId?: string;
    gap?:   number;          // px between glyph and label, default 8
}

export class IconLabel extends Component {
    constructor(glyph: string, text: string, forId: string, options?: IconLabelOptions);
    setGlyph(name: string): this;
    setText(text: string): this;
    setForId(id: string): this;
    setGap(px: number): this;
    getGlyphComponent(): Glyph;
    getLabelComponent(): Label;
}
```

Also placed in `display`. The `forId` constructor argument is mandatory (mirrors [Label](../src/typescript/lib/component/input/Label.ts)'s requirement) — `IconLabel` is specifically for icons attached to form-control labels. For label-less icon-with-text, use `IconText` instead.

Cross-bucket import note: `IconLabel` lives in `display` but pulls `Label` from `input`. Per [CLAUDE.md](../CLAUDE.md) cross-bucket linking rules, JSDoc references in `IconLabel.ts` to `Label` must use the markdown form (`[\`Label\`](/api/component/input/classes/Label)`), not `{@link Label}`.

### Table cells

```typescript
// src/typescript/lib/component/table/cell/Glyph.ts
export class GlyphCell extends Cell { /* ... */ }

// src/typescript/lib/component/table/cell/renderer/Glyph.ts
export class GlyphCellRenderer extends CellRenderer { /* ... */ }
```

Naming matches the existing `String.ts`, `Number.ts`, etc. siblings. Exported from [cell/index.ts](../src/typescript/lib/component/table/cell/) (verify the exact path during implementation — there is currently a top-level `cell/index.ts` plus subdirectory exports to mirror).

### `TreeRow` (internal)

No public API change. The `_toggle` field changes from `Text` to `Glyph`. Public accessor `getToggle()` returns `Glyph` instead of `Text` — a breaking signature change, but the prior return type was already an internal-leaning detail; callers that introspect `getToggle()` are unlikely outside the library. Document the change in a CHANGELOG note.

---

## Ordered Implementation Steps

The steps are ordered so that the project compiles and renders correctly after each one. FontAwesome is not removed until step 8.

### Step 1 — Convert `WindowHeader`'s close icon, then add a title-icon slot

Two sub-steps in one file. Keep them in this order so the project compiles after each.

**1a — Replace the FontAwesome close icon.** [src/typescript/lib/component/container/WindowHeader.ts:42](../src/typescript/lib/component/container/WindowHeader.ts#L42):

```diff
- import { FontAwesomeIcon } from "~/component/display/FontAwesomeIcon.js";
+ import { Glyph } from "~/component/display/Glyph.js";
  ...
- let fontAwesomeIcon = new FontAwesomeIcon("fas", "times");
- fontAwesomeIcon.setPointerEvents("none");
- this.exitButton.addComponent(fontAwesomeIcon, { fill: FillType.NONE });
+ let glyph = new Glyph("times");
+ glyph.setPointerEvents("none");
+ this.exitButton.addComponent(glyph, { fill: FillType.NONE });
```

Update the class docstring at [WindowHeader.ts:22](../src/typescript/lib/component/container/WindowHeader.ts#L22): "Font Awesome 'times' exit button" → "embedded `times` glyph close button and an optional title icon".

**1b — Add the title-icon slot.**

- Extend `WindowHeaderOptions` with `glyph?: string | null;`.
- Add a private field: `private _titleGlyph: Glyph | null = null;`.
- Add public methods `setGlyph(name: string | null): this` and `getGlyph(): Glyph | null`.
- `setGlyph(name)` constructs a `Glyph(name)` and adds it with `placement: Placement.WEST` (mirror the existing east placement of the close button). `setGlyph(null)` removes the previous title-glyph child if any. Setting twice replaces.
- Extend `applyOptions(options)` to handle `options.glyph`.

The base [Header](../src/typescript/lib/component/display/Header.ts) is **not** modified — the slot is `WindowHeader`-specific. This avoids changing Header's API contract for callers who use it standalone.

Verify: dev-server smoke test — open a window, click the X, confirm `addExitButtonListener` still fires. Then construct `new WindowHeader("Settings", { glyph: "times" })` (or any registry entry) and confirm the icon appears west of the title text and the close button stays east. Theme the foreground colour and confirm the title icon recolours.

### Step 2 — Add glyph slot to `Button`

[src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts):

The current constructor lays out a single `Text` child via a `Fit` layout manager. To support an optional left-side glyph:

- Keep `Fit` for the text-only case (no slot occupied → no visual change).
- When `setGlyph(name)` is called with a non-null name: switch the internal layout to a horizontal arrangement that holds `[glyph, text]` with an 8px gap, centred. Use the existing layout primitives — pick whichever one is already the idiomatic choice for "two items, left-aligned, vertically centred" in this codebase (likely `Flow` or manual `doLayout()`; choose during implementation by looking at how other multi-child components in `button/` and `display/` solve this).
- When `setGlyph(null)` is called: remove the glyph child, restore the `Fit` layout, re-centre the text.

Fields added: `private _glyph: Glyph | null = null;`.

Constructor option: `glyph?: string` in `ButtonOptions`. `applyOptions` calls `setGlyph(options.glyph)` when present.

Verify: build the project, render `new Button("Save")` (no glyph — unchanged) and `new Button("Save", { glyph: "times" })` (glyph + text) side by side in the dev server. The original-style button must be pixel-identical to its current rendering.

### Step 3 — `ToggleButton` and `TabCloseButton` inherit, seed defaults

`ToggleButton` automatically inherits `setGlyph` from `Button`. No code change needed unless its options bag intercepts `glyph`.

[TabCloseButton.ts](../src/typescript/lib/component/button/TabCloseButton.ts): in the constructor, after `super(...)`, call `this.setGlyph("times")`. If the class currently constructs its own icon via FontAwesome, replace that block. Inspect during implementation.

Verify: the tab close affordance still shows an X.

### Step 4 — Add glyph slot and options bag to `MenuBarButton`

[src/typescript/lib/component/menubar/MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts):

Currently `doLayout()` positions a single `Text` with horizontal padding ([MenuBarButton.ts:98](../src/typescript/lib/component/menubar/MenuBarButton.ts#L98)) and the class has no options bag. Extend:

- Add `MenuBarButtonOptions extends ComponentOptions { glyph?: string | null; }`.
- Add optional trailing constructor parameter `options?: MenuBarButtonOptions`. Existing 3-arg call sites compile unchanged.
- Add `protected applyOptions(options: MenuBarButtonOptions): this` that calls `super.applyOptions(options)` and dispatches `options.glyph` to `setGlyph`.
- At constructor tail, mirror the `Button` pattern: `if (this.constructor === _MenuBarButton && options) { this.applyOptions(options); }`.
- Add `private _glyph: Glyph | null = null;`.
- Add `setGlyph(name: string | null): this` that adds/removes the child, recomputes preferred size, and triggers a re-layout. Add `getGlyph(): Glyph | null`.
- In `doLayout()`: when `_glyph` is set, position it at `x = pad`, then position `_text` at `x = pad + glyphWidth + gap`. When `_glyph` is null, fall back to the existing single-child layout.
- The constructor's hard-coded `setPreferredSize(text.length * 7 + 24, 28)` ignores a glyph (none at construction). `setGlyph` re-runs the preferred-size calculation including glyph width + gap; `setGlyph(null)` reverts.

Verify: `new MenuBarButton("File", onClick, onHover)` is visually unchanged. `new MenuBarButton("File", onClick, onHover, { glyph: "arrow-down" })` renders the icon to the left of the label, and `setGlyph(null)` removes it cleanly.

### Step 5 — Convert `TreeRow` toggle to `Glyph`

[src/typescript/lib/component/tree/TreeRow.ts](../src/typescript/lib/component/tree/TreeRow.ts):

- Change the `_toggle` field type from `Text` to `Glyph | null`.
- In the constructor: don't construct a default `_toggle`; leave it `null` until `setRowData` decides whether the row needs one.
- In `setRowData` (line 98): instead of `this._toggle.setText(...)`, remove the previous toggle child (if any) and add a new `Glyph` with name `"arrow-down"` (expanded), `"arrow-right"` (collapsed), or none (leaf).
- `getToggle()` now returns `Glyph | null`.
- `layoutChildren()` and `init()` must handle the null case.

Verify: tree expand/collapse still works; arrow direction matches state; theme `--ts-ui-text-color` changes the arrow colour.

Performance note: each toggle change now adds + removes a DOM child instead of mutating `textContent`. This is fine for user-driven expansion. If profiling shows it matters for bulk expand-all operations, revisit by caching two `Glyph` instances per row and toggling `visible` instead.

### Step 6 — Add `IconText` composite

`src/typescript/lib/component/display/IconText.ts`

- Extends `Component`. Constructor takes `(glyph: string, text: string, options?: IconTextOptions)`.
- Lays out a `Glyph` left + `Text` right with a configurable gap (default 8px).
- Use the same horizontal-layout approach picked in Step 2 — keep the two consistent so the same icon-with-text visual spec is honoured in both `Button` and standalone `IconText`.
- Setters: `setGlyph(name)`, `setText(text)`, `setGap(px)`. Getters: `getGlyphComponent()`, `getTextComponent()`.
- Callable export pattern (`_IconText` + `IconTextCallable`).
- Export from [display/index.ts](../src/typescript/lib/component/display/index.ts).

Verify: render `new IconText("times", "Close")` in the dev server; both children visible, vertically centred, 8px apart.

### Step 7 — Add `IconLabel` composite

`src/typescript/lib/component/display/IconLabel.ts`

- Sibling of `IconText`; same horizontal-layout approach, same default gap.
- Constructor `(glyph: string, text: string, forId: string, options?: IconLabelOptions)`. The `forId` is mandatory (forwarded to the inner [Label](../src/typescript/lib/component/input/Label.ts) which throws on empty).
- Inner children: a `Glyph` and a `Label(text, forId)`.
- Setters: `setGlyph`, `setText`, `setForId`, `setGap`. Getters: `getGlyphComponent`, `getLabelComponent`.
- Callable export pattern; export from [display/index.ts](../src/typescript/lib/component/display/index.ts).
- Cross-bucket import: `Label` lives in `~/component/input/Label.js`. The JSDoc reference to `Label` inside `IconLabel.ts` uses the markdown link form (`[\`Label\`](/api/component/input/classes/Label)`), per [CLAUDE.md](../CLAUDE.md).

Verify: `const field = new TextField(); panel.addComponent(field); panel.addComponent(new IconLabel("times", "Email:", field.getId()));` — clicking either the glyph area or the label text focuses the field (the `<label for="…">` association still works because the inner element is a real `<label>`).

### Step 8 — Add `Glyph` table cell + renderer

- `src/typescript/lib/component/table/cell/Glyph.ts` — a `Cell` subclass that takes a glyph name from row data (via the standard cell-data flow; mirror `String.ts`'s pattern) and renders a `Glyph` component as its content.
- `src/typescript/lib/component/table/cell/renderer/Glyph.ts` — the matching renderer; mirror `String.ts`'s renderer counterpart.
- Wire into the table cell type registry. Inspect [Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) and the existing cells to find the exact registration site.
- Read-only. No editor counterpart in `cell/editor/`.

Verify: define a column with the glyph cell type, supply a row with `{ icon: "times" }`, render the table, confirm the icon shows in the right column and follows `currentColor`.

### Step 9 — Retire FontAwesome

Run only after Steps 1-8 are merged.

- Delete [src/typescript/lib/component/display/FontAwesomeIcon.ts](../src/typescript/lib/component/display/FontAwesomeIcon.ts).
- Remove the `FontAwesomeIcon` and `FontAwesomeIconOptions` exports from [src/typescript/lib/component/display/index.ts](../src/typescript/lib/component/display/index.ts).
- Delete the script tags:
  - [index.html:4](../index.html#L4): `<script src="/Base/script/fontawesome/js/all.js"></script>`.
  - [src/resources/index.html:3](../src/resources/index.html#L3): `<script src="Base/script/fontawesome/js/all.js"></script>`.
- Delete the FontAwesome peer dependency from [package.json:39-46](../package.json#L39-L46): remove the `peerDependencies` and `peerDependenciesMeta` blocks (both exist solely for FontAwesome).
- Delete the asset tree: [src/resources/Base/script/fontawesome/](../src/resources/Base/script/fontawesome/) (CSS, JS, SVGs, sprites, webfonts, metadata, scss).

Before deleting the asset tree, confirm:
```
grep -rn "fontawesome\|font-awesome\|FontAwesome\|fa-" src/ index.html package.json
```
Expected: zero matches (outside `graphify-out/` cache, which refreshes via `graphify update . --directed`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/display/IconText.ts` |
| Create | `src/typescript/lib/component/display/IconLabel.ts` |
| Create | `src/typescript/lib/component/table/cell/Glyph.ts` |
| Create | `src/typescript/lib/component/table/cell/renderer/Glyph.ts` |
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` (close-icon swap + title-icon slot + options bag) |
| Modify | `src/typescript/lib/component/button/Button.ts` |
| Modify | `src/typescript/lib/component/button/TabCloseButton.ts` |
| Modify | `src/typescript/lib/component/menubar/MenuBarButton.ts` (adds options bag + glyph slot) |
| Modify | `src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | `src/typescript/lib/component/display/index.ts` (add `IconText`, `IconLabel`; remove `FontAwesomeIcon`) |
| Modify | `src/typescript/lib/component/table/cell/` index/registry (wire new cell type) |
| Modify | `index.html` (remove FA script) |
| Modify | `src/resources/index.html` (remove FA script) |
| Modify | `package.json` (remove peer dep blocks) |
| Delete | `src/typescript/lib/component/display/FontAwesomeIcon.ts` |
| Delete | `src/resources/Base/script/fontawesome/` (directory) |

---

## Verification

Per-step verification is described inline above. Final end-of-plan verification:

1. **Type check:**
   ```
   npm run typecheck
   ```

2. **Grep is clean:**
   ```
   grep -rn "FontAwesome\|fontawesome\|fa-" src/ index.html package.json
   ```
   Expected: zero matches.

3. **Library build:**
   ```
   npm run build:lib
   ```
   Inspect `dist/lib/*` — should contain no FontAwesome strings; should contain `Glyph`, `IconText`, and the new cell type.

4. **Docs build is clean:**
   ```
   npm run docs:build
   ```
   Zero errors, zero new link warnings.

5. **Dev-server smoke test:**
   ```
   npm run dev
   ```
   Walk through:
   - A `WindowHeader` close button renders the X.
   - A `WindowHeader({ glyph: "times" })` renders the title icon west of the title text and the close button stays east.
   - A `Button({ glyph: "times", text: "Close" })` renders glyph + text. A `Button("Save")` with no glyph option renders unchanged.
   - A `TabCloseButton` renders an X.
   - A `MenuBarButton("File", onClick, onHover)` renders unchanged. The same with a trailing `{ glyph: "arrow-down" }` options bag renders glyph + label.
   - A `Tree` expands/collapses with arrows; `TreeRow` source contains zero raw `▶`/`▼` characters.
   - An `IconText("times", "Close")` renders.
   - An `IconLabel("times", "Email:", field.getId())` renders, and clicking either glyph or text focuses the field.
   - A `Table` with a glyph cell renders the icon.

6. **Theme integration:** Toggle `--ts-ui-text-color`. Every glyph above must recolour with surrounding text.

7. **Layout regression check** (per [CLAUDE.md](../CLAUDE.md)): the existing `WindowHeader` close button bounds must be unchanged. Buttons without a glyph (the common case) must render pixel-identical to their pre-change appearance. Compare screenshots before and after, or measure widths.

8. **Refresh the knowledge graph:**
   ```
   graphify update . --directed
   ```

---

## Critical Files

- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — Step 2 is the largest single change; the layout switch must keep the no-glyph case visually identical.
- [src/typescript/lib/component/tree/TreeRow.ts](../src/typescript/lib/component/tree/TreeRow.ts) — `getToggle()` return type changes; check whether any external code reads it.
- [src/typescript/lib/component/table/cell/Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) and siblings — pattern for the new cell type.
- [src/typescript/lib/component/container/WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts) — the existing FontAwesome call site; first migration.
- [src/typescript/lib/component/display/FontAwesomeIcon.ts](../src/typescript/lib/component/display/FontAwesomeIcon.ts) — deleted in Step 8.

---

## Non-Goals

- **No List/ComboBox row icons.** Those depend on the upcoming data-binding work tracked in the Upcoming feature work memory. Add a glyph slot to list/combo rows when the binding API lands.
- **No `Window` minimize/maximize/restore buttons.** Those don't exist yet; adding the controls is a separate feature. When they do exist, they get `Glyph` slots automatically because they'll use `Button`.
- **No sort indicators on table headers.** The table `Header` doesn't have a sort-arrow slot today. Adding one is a feature, not an adoption — out of scope here.
- **No ProgressBar / ProgressSpinner / PaginationBar glyph slots.** Add when there's a concrete UX requirement.
- **No editor-side glyph cell.** Read-only only.
- **No re-platforming of `Button` onto `IconText`.** They share a visual spec but stay implementation-independent.
- **No `Glyph` size-aware char rendering.** Carried over from [embedded-glyph.md](embedded-glyph.md) — if a site needs a Unicode glyph at non-default size, it sets `font-size` on the `Glyph` instance directly.
- **No deprecated `FontAwesomeIcon` alias.** Single internal call site (`WindowHeader`); clean removal in Step 8.
