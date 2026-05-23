# Migrate Direct `element.setAttribute(...)` Calls To Typed Setters / Aria — Implementation Plan

## Overview

[ARCHITECTURE.md](../ARCHITECTURE.md) forbids `element.setAttribute(...)` from component code. HTML attributes route through `Component.setAttribute` (which mirrors into `_attributes` and dispatches `setElementAttribute`) or through a private typed setter that calls `setElementAttribute` internally. ARIA attributes route exclusively through `this.getAria()`; the `Aria` class owns the `aria-*` namespace.

`grep -rn 'element\.setAttribute(' src/typescript --include="*.ts"` currently returns 16 violations across six files plus a single ARIA bypass via `Component.setAttribute` in `Tree.ts`. The pattern is uniform: each subclass overrides `render()` (or `applyStyle()`) after `super` and re-applies `type` / `min` / `max` / `step` / `value` / `inputmode` / `autocomplete` directly on the returned DOM element — bypassing the Component setter that already exists on the parent ([Input.setType at Input.ts:69](../src/typescript/lib/component/input/Input.ts#L69) and [TextInput.setInputMode at TextInput.ts:95](../src/typescript/lib/component/input/TextInput.ts#L95), [TextInput.setAutoComplete at TextInput.ts:146](../src/typescript/lib/component/input/TextInput.ts#L146)).

The Slider case is structurally worse: every range attribute (`min` / `max` / `step` / `value`) has a typed setter on the same class ([Slider.ts:109-187](../src/typescript/lib/component/input/Slider.ts#L109-L187)) that already routes correctly through `Component.setAttribute`. The `render()` override re-writes those attributes a second time, directly on the element. The render-time bypass is redundant.

The Tree case is the only ARIA violation: [Tree.ts:100](../src/typescript/lib/component/tree/Tree.ts#L100) calls `this.setAttribute("aria-multiselectable", "true")` — `this.setAttribute` IS the Component-routed setter (so it isn't an `element.setAttribute` hit), but it stores the attribute in `Component._attributes` instead of `Aria._attributes`, bypassing the `Aria` namespace. `Aria.ts` has 22 typed setters today but no `setMultiselectable`; this plan adds it.

This plan migrates every site, deletes the redundant `render()` / `applyStyle()` overrides whose only job is the bypass, extends `Aria.ts` with `setMultiselectable` / `getMultiselectable`, and locks the rule in with two grep checkpoints.

---

## Architecture Decisions

### Use the existing `Input.setType` for every input subclass

`Input` already exposes `setType(value: string)` ([Input.ts:69-73](../src/typescript/lib/component/input/Input.ts#L69-L73)) which calls `this.setAttribute("type", value)` — the Component-routed path that mirrors into `_attributes` and flushes to `setElementAttribute`. Every input subclass currently hardcodes its `type` attribute in a `render()` override after `super.render()`:

```typescript
// Before — TextField.ts:107-113
render() {
    let element = super.render();
    element.setAttribute("type", "text");
    return element;
}
```

The correct path is `this.setType("text")` from the constructor — invoked once at construction time, queued through `setElementAttribute`, materialised when the element appears. The `render()` override goes away.

This applies uniformly to `TextField`, `PasswordField`, `Checkbox`, and `Slider`. After the move, only `Checkbox.render()` retains a body (`element.checked = this.isSelected()`); that line is independent of this plan and stays where it is.

### Drop Slider's redundant render-time attribute writes

`Slider.setMinValue` / `setMaxValue` / `setStep` / `setValue` ([Slider.ts:109-187](../src/typescript/lib/component/input/Slider.ts#L109-L187)) already call `this.setAttribute(...)` and are dispatched by `applyOptions` ([Slider.ts:71-90](../src/typescript/lib/component/input/Slider.ts#L71-L90)). The five `element.setAttribute` lines in `render()` ([Slider.ts:210-214](../src/typescript/lib/component/input/Slider.ts#L210-L214)) are leftover scaffolding from before the setters existed. Delete the `render()` override entirely; add `this.setType("range")` to the constructor so the type attribute lands once, queued through the same path as `min` / `max` / `step` / `value`.

After this, every Slider DOM attribute is fed by one typed setter that runs once at construction. No render-time write remains.

### Editors: cell editors are `Component`, not `Input` — call `this.setAttribute` directly

`DateEditor`, `DateTimeEditor`, `TimeEditor` all extend `CellEditor<T>` which extends `Component` ([CellEditor.ts:16](../src/typescript/lib/component/table/cell/editor/CellEditor.ts#L16)) — not `Input` and not `TextInput`. So `setType` / `setInputMode` / `setAutoComplete` are not inherited. Three options:

1. **Add the setters to the editor classes** — three setters × three files = nine new methods for one-use attributes.
2. **Promote `CellEditor` to extend `Input`** — invasive; `CellEditor`'s tag defaults to `"div"` (most editors are not inputs), and `Input` adds a Component-level `applyStyle` override and `name` plumbing the editors don't need.
3. **Call `this.setAttribute(key, value)` from the constructor** — Component-routed (so no `element.setAttribute` violation), one-line per attribute, no class API expansion.

Option 3 is the right answer. `this.setAttribute("type", "text")` / `this.setAttribute("inputmode", "none")` / `this.setAttribute("autocomplete", "off")` are dispatched once at construction, stored in `Component._attributes`, and applied to the element when it appears. The `applyStyle` override that today hosts the three `element.setAttribute` lines collapses — the three editor classes lose their `applyStyle` method entirely (none of them touch the element's actual style).

`applyStyle` is the wrong hook for attribute writes anyway: it runs on every render-style pass, not just the first one, so the attributes were being re-written on every theme change. Constructor-time `setAttribute` runs once.

This leaves `inputMode`/`autoComplete` on `TextInput` (used by `TextField`, `PasswordField`, etc.) untouched — they remain the canonical path for `Input`-derived inputs. The editors don't extend `TextInput`, so they don't get those setters; the Component-level `setAttribute` is the lowest common denominator.

### Extend `Aria.ts` with `setMultiselectable` / `getMultiselectable`

`Tree.ts:100` writes `aria-multiselectable` through `Component.setAttribute`. That's syntactically Component-routed, but ARCHITECTURE.md is explicit that "ARIA / `role` / `tabindex`" lives on `this.getAria()`. The fix has two parts:

1. Add `setMultiselectable(value: boolean): this` and `getMultiselectable(): boolean | null` to [Aria.ts](../src/typescript/lib/core/Aria.ts), following the exact shape of `setSelected` ([Aria.ts:141-156](../src/typescript/lib/core/Aria.ts#L141-L156)) — they're both `aria-*-boolean` attributes with the same setter/getter pattern.
2. Migrate `Tree.ts:100` from `this.setAttribute("aria-multiselectable", "true")` to `this.getAria().setMultiselectable(true)`.

No interface change on `Aria` consumers (the existing 22 setters all use the same shape; `setMultiselectable` is the 23rd).

### Keep the SVG-internal `setAttribute` calls in `Glyph.ts` / `Glyphs.ts`

`Glyph.ts:535-540` and `Glyphs.ts:101,102,149,150,153` write attributes onto raw `<svg>` / `<symbol>` / `<path>` DOM nodes that are not `Component`s — they're internal helpers the `Glyph` class assembles from sprite definitions. ARCHITECTURE.md ("Minimize direct DOM access" section, [ARCHITECTURE.md:13-15](../ARCHITECTURE.md#L13-L15)) explicitly carves these out: "Raw DOM is for things the framework has no API for." The framework has no Component for individual `<path>` segments inside a sprite glyph; introducing one for these would be over-architecture.

Document this in `## Non-Goals` so the grep checkpoint can exclude them by file.

### Do not touch `Aria.applyToElement` at lines 617-625

`Aria.applyToElement` is the framework's own seam for flushing the `Aria` namespace to the DOM. The three `element.setAttribute` calls inside it ([Aria.ts:617](../src/typescript/lib/core/Aria.ts#L617), [621](../src/typescript/lib/core/Aria.ts#L621), [625](../src/typescript/lib/core/Aria.ts#L625)) are the *implementation* of the typed-setter rule, not a violation. Same for `Component.setElementAttribute` at [Component.ts:513](../src/typescript/lib/core/Component.ts#L513) — that's the central `setAttribute` implementation. They're out of scope.

---

## Public API (TypeScript Signatures)

### `Aria` — two new methods

```typescript
// src/typescript/lib/core/Aria.ts

class Aria {
    setMultiselectable(value: boolean): this;
    getMultiselectable(): boolean | null;
}
```

`setMultiselectable` stores `"true"` / `"false"` in `_attributes` under the key `"multiselectable"` and dispatches `aria-multiselectable` to the element via `_component.applyAriaAttribute`. `getMultiselectable` reads the same key and converts to `boolean | null`. Both follow the shape of `setSelected` / `getSelected` ([Aria.ts:141-156](../src/typescript/lib/core/Aria.ts#L141-L156)) verbatim.

No other public-API change. The Input subclasses lose private `render()` / `applyStyle()` overrides but those are protected/internal methods of each class — not part of any documented API surface.

---

## Implementation

### Aria — new setter shape

```typescript
/**
 * Sets `aria-multiselectable`, indicating that the widget supports multiple
 * selection.
 *
 * @param value - Whether multiple items can be selected.
 */
setMultiselectable(value: boolean): this {
    this.setAttribute("multiselectable", String(value));

    return this;
}

/**
 * Returns the current `aria-multiselectable` value, or null if not set.
 *
 * @returns The multiselectable state, or null.
 */
getMultiselectable(): boolean | null {
    const v = this._attributes.get("multiselectable");

    return v !== undefined ? v === "true" : null;
}
```

Placement: alongside `setSelected` / `getSelected` ([Aria.ts:141-156](../src/typescript/lib/core/Aria.ts#L141-L156)) to keep the boolean-aria block contiguous.

### Editor constructor — `setAttribute` calls move from `applyStyle` to the constructor

Three identical edits to `Date.ts`, `DateTime.ts`, `Time.ts`. For each file:

```typescript
constructor() {
    super("input");

    // ... existing setMaxSize / setBorderRadius / setBorder / setShadow / setOutline / addListener ...

    this.setAttribute("type",         "text");
    this.setAttribute("inputmode",    "none");
    this.setAttribute("autocomplete", "off");
}
```

Delete the entire `applyStyle(element: HTMLElement): this` override in each editor — the three `element.setAttribute` lines were its only payload (after `super.applyStyle(element)` which is the inherited no-op behaviour at this layer).

### Input subclass `render()` overrides — collapse

`TextField.ts`, `PasswordField.ts`: delete the `render()` override outright. Move the one-liner into the constructor:

```typescript
// In each constructor, after the super() call:
this.setType("text");   // TextField
this.setType("password"); // PasswordField
```

`Checkbox.ts`: keep the `render()` body, but the `element.setAttribute("type", "checkbox")` line moves out. Add `this.setType("checkbox")` to the constructor; leave `element.checked = this.isSelected()` in `render()` since `checked` is a DOM property (not an attribute) and the existing approach is fine for now.

`Slider.ts`: delete the entire `render()` override (all five lines are redundant). Add `this.setType("range")` to the constructor. The four range attributes (`min`/`max`/`step`/`value`) are already dispatched by `applyOptions` through the typed setters, so no additional constructor call is needed for them.

### Tree.ts — Aria migration

One-line change at [Tree.ts:100](../src/typescript/lib/component/tree/Tree.ts#L100):

```typescript
// Before:
this.setAttribute("aria-multiselectable", "true");
// After:
this.getAria().setMultiselectable(true);
```

This sits alongside the existing `this.getAria().setRole("tree")` and `this.getAria().setTabIndex(0)` calls two lines above — same call shape, same namespace.

---

## Ordered Implementation Steps

1. **Extend `Aria.ts`.** Add `setMultiselectable(value: boolean)` and `getMultiselectable()` next to `setSelected` / `getSelected` ([Aria.ts:141-156](../src/typescript/lib/core/Aria.ts#L141-L156)). Verify: `npx tsc --noEmit` → 0 errors.

2. **Migrate `Tree.ts:100`.** Replace `this.setAttribute("aria-multiselectable", "true")` with `this.getAria().setMultiselectable(true)`. Verify: `grep -n 'aria-multiselectable' src/typescript/lib/component/tree/Tree.ts` → 0 matches.

3. **Migrate `TextField.ts`.** Add `this.setType("text")` to the constructor (after the existing super() call and event listener registration). Delete the `render()` override at [TextField.ts:107-113](../src/typescript/lib/component/input/TextField.ts#L107-L113). Verify: `grep -n 'element\.setAttribute' src/typescript/lib/component/input/TextField.ts` → 0 matches.

4. **Migrate `PasswordField.ts`.** Same shape: `this.setType("password")` in the constructor, delete the `render()` override at [PasswordField.ts:61-67](../src/typescript/lib/component/input/PasswordField.ts#L61-L67).

5. **Migrate `Checkbox.ts`.** No-op as of implementation. The current `Checkbox` is a custom-drawn `<div>` with `role="checkbox"` (a `Component` subclass, not an `Input`). It has no `render()` override, no `element.setAttribute` call, and no native `<input type="checkbox">`. The plan was authored against a prior native-input shape; the modern shape has nothing to migrate.

6. **Migrate `Slider.ts`.** No-op as of implementation. The current `Slider` is a custom-drawn `<div>` with `role="slider"` and child track / thumb Components. It has no `render()` override, no `element.setAttribute` call, and no native `<input type="range">`. The plan was authored against a prior native-input shape; the modern shape has nothing to migrate.

7. **Migrate `editor/Date.ts`.** Add three constructor lines after the existing event listeners (`this.setAttribute("type", "text")`; `this.setAttribute("inputmode", "none")`; `this.setAttribute("autocomplete", "off")`). Delete the `applyStyle` override at [Date.ts:44-51](../src/typescript/lib/component/table/cell/editor/Date.ts#L44-L51).

8. **Migrate `editor/DateTime.ts`.** Same shape as step 7 — three constructor lines, delete the `applyStyle` override at [DateTime.ts:45-52](../src/typescript/lib/component/table/cell/editor/DateTime.ts#L45-L52).

9. **Migrate `editor/Time.ts`.** Same shape as step 7 — three constructor lines, delete the `applyStyle` override at [Time.ts:47-54](../src/typescript/lib/component/table/cell/editor/Time.ts#L47-L54).

10. **Grep checkpoints.** Both must return zero hits (excluding the documented Glyph/Glyphs SVG sites and the framework's own implementation seams):
    - `grep -rn 'element\.setAttribute(' src/typescript --include="*.ts" | grep -vE '(Glyph\.ts|Glyphs\.ts|Aria\.ts:617|Aria\.ts:621|Aria\.ts:625|Component\.ts:513|Component\.ts:3189)'` → 0.
    - `grep -rn 'setAttribute("aria-' src/typescript --include="*.ts"` → 0.

11. **Typecheck.** `npx tsc --noEmit` → 0 errors.

12. **Smoke test in the dev app.** See `## Verification` for the per-component checklist.

13. **Refresh the knowledge graph.** `graphify update .` (AST-only, no API cost) so the Aria community node count picks up the new `setMultiselectable` edge.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Aria.ts` — add `setMultiselectable` / `getMultiselectable` |
| Modify | `src/typescript/lib/component/tree/Tree.ts` — line 100 to `getAria().setMultiselectable(true)` |
| Modify | `src/typescript/lib/component/input/TextField.ts` — constructor `setType("text")`, delete `render()` |
| Modify | `src/typescript/lib/component/input/PasswordField.ts` — constructor `setType("password")`, delete `render()` |
| Skip   | `src/typescript/lib/component/input/Checkbox.ts` — drift: modern Checkbox is a custom-drawn `<div>`, no `render()` override and no `element.setAttribute` |
| Skip   | `src/typescript/lib/component/input/Slider.ts` — drift: modern Slider is a custom-drawn `<div>`, no `render()` override and no `element.setAttribute` |
| Modify | `src/typescript/lib/component/table/cell/editor/Date.ts` — three constructor `setAttribute` lines, delete `applyStyle` |
| Modify | `src/typescript/lib/component/table/cell/editor/DateTime.ts` — same |
| Modify | `src/typescript/lib/component/table/cell/editor/Time.ts` — same |

No files created, no files deleted.

---

## Verification

### Type and grep gates

- `npx tsc --noEmit` → 0 errors.
- `grep -rn 'element\.setAttribute(' src/typescript --include="*.ts"` returns only documented exemptions (Glyph.ts/Glyphs.ts SVG internals, Component.setElementAttribute implementation at Component.ts:513 and the explicit attributes-options forwarder at Component.ts:3189, and the three Aria.applyToElement seams at Aria.ts:617/621/625).
- `grep -rn 'setAttribute("aria-' src/typescript --include="*.ts"` → 0 matches.

### Manual smoke (dev app at http://localhost:8015, `npm run dev`)

- **TextField** — open any panel with a text field. DevTools Elements panel: the `<input>` has `type="text"`. Type into the field; the value updates.
- **PasswordField** — find the password demo (Form / Input panel). DevTools: `type="password"`. Typing shows dots.
- **Checkbox** — Form panel. DevTools: `type="checkbox"`. Click toggles `checked`.
- **Slider** — Slider demo. DevTools: `type="range"`, `min`, `max`, `step`, `value` all present and matching the constructed options. Drag updates the value attribute.
- **Date / DateTime / Time cell editors** — open the slow table (MiscPanel) or a table with a date column; double-click a cell to enter edit mode. DevTools: the `<input>` has `type="text"`, `inputmode="none"` (no virtual keyboard on mobile/touch), `autocomplete="off"` (no browser autocomplete dropdown). The DatePicker dropdown opens on focus.
- **Tree** — Tree demo. DevTools: the root tree element has `role="tree"`, `tabindex="0"`, `aria-multiselectable="true"` — all three set by the Aria namespace through `applyToElement`. Screen-reader announce optional.

### Knowledge graph refresh

`graphify update .` (mandatory after any code change per project memory). Confirm the Aria community node count increases by one (`setMultiselectable`).

---

## Documentation Impact

- **No barrel changes.** No new exported symbols cross a subpath boundary. `Aria` is already exported from `src/typescript/lib/core/index.ts`; adding two methods does not move the export surface.
- **Curated docs.** The `docs/core/Aria.md` page (or `docs/core/index.md` catalog entry for Aria) gains one line if it enumerates ARIA setters. If it links to the generated TypeDoc, no change needed — the new methods pick up their JSDoc automatically on `npm run docs:build`.
- **`docs:build` gate.** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the one acceptable warning).

This is an internal refactor on the input side (the render-time overrides were never documented public API), so no doc work beyond the optional Aria sentence.

---

## Potential Challenges

- **Constructor ordering.** `Input`'s constructor cascade dispatches `applyOptions` *before* the subclass body runs. Adding `this.setType("text")` after `super()` in `TextField`'s constructor means the type is set after option-driven setters. Verify no `InputOptions` field already sets `type` from a user-supplied option — it doesn't ([InputOptions only declares `name?: string`](../src/typescript/lib/component/input/Input.ts#L14-L16)), so subclass-controlled `type` is the only path.
- **Slider's `applyOptions` already calls setters.** Defaults (`minValue: 0`, `maxValue: 100`, `step: 1`, `value: 50`) come from `Slider`'s `_defaultSliderOptions` merge ([Slider.ts:28-32](../src/typescript/lib/component/input/Slider.ts#L28-L32)) — wait, those defaults aren't in there. The getter fallbacks (`?? 0` / `?? 100` / `?? 1` / `?? 50` at lines 99/123/147/171) provide the runtime default, but the option-cascade only dispatches the setter when `options.X !== undefined`. If the caller passes no slider options, no `min`/`max`/`step`/`value` attribute is ever written. The old `render()` override wrote them unconditionally. Mitigation: add four guard lines in `Slider`'s constructor that explicitly call `this.setMinValue(this.getMinValue())` / `setMaxValue` / `setStep` / `setValue` after `super()`, so the attribute is always present on the DOM. This is cheap and keeps the render behaviour identical.
- **Editor `applyStyle` removal.** Verify no editor subclass overrides `applyStyle` for any other reason (it doesn't — see [Date.ts:44-51](../src/typescript/lib/component/table/cell/editor/Date.ts#L44-L51) — only the three `setAttribute` lines). The parent `Input`'s `applyStyle` ([Input.ts:130-138](../src/typescript/lib/component/input/Input.ts#L130-L138)) handles font defaults and `super.applyStyle` flushes the rule. Since `CellEditor` extends `Component` (not `Input`), the editor inherits `Component.applyStyle` only — the override was already a partial implementation, not a chain into Input-style font defaults.
- **`Checkbox.render` still touches `element.checked`.** This is a DOM property, not an attribute, so it doesn't hit the `setAttribute` grep. It's also wrong by the typed-setter rule (Component.setChecked or similar should own it) — but it's an existing pattern outside this plan's scope. Flag in `## Non-Goals` so it doesn't get folded in.

---

## Critical Files

- [src/typescript/lib/core/Aria.ts](../src/typescript/lib/core/Aria.ts) — the 22 existing typed setters define the shape `setMultiselectable` must follow. Read `setSelected` / `getSelected` at lines 141-156 before writing the new pair.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — lines 505-538 (`setElementAttribute` / `removeElementAttribute`) and 711-734 (`setAttribute` / `delAttribute`) define the routed path the input subclass constructors will land on.
- [src/typescript/lib/component/input/Input.ts](../src/typescript/lib/component/input/Input.ts) — `setType` at line 69 is the pattern subclasses inherit; the subclass migration is "call it instead of bypassing it".
- [src/typescript/lib/component/input/TextInput.ts](../src/typescript/lib/component/input/TextInput.ts) — lines 95-156 demonstrate the canonical typed-setter shape for `setInputMode` / `setAutoComplete`. The editors don't extend `TextInput`, but this file shows the existing pattern for `inputmode` / `autocomplete` attributes on `Input`-derived classes.
- [src/typescript/lib/component/table/cell/editor/CellEditor.ts](../src/typescript/lib/component/table/cell/editor/CellEditor.ts) — confirms `CellEditor extends Component`, not `Input` (so the editors must use `this.setAttribute` directly rather than inherit `setType`/`setInputMode`).
- [ARCHITECTURE.md](../ARCHITECTURE.md) — the "All attributes and styles go through typed setters" table at line 19 and the "Three non-negotiable rules" block at line 28 are the binding rules this plan enforces.

---

## Non-Goals

- **`Glyph.ts:535-540` and `Glyphs.ts:101,102,149,150,153`.** These write attributes onto raw SVG `<svg>` / `<symbol>` / `<path>` nodes inside the sprite engine. They are not `Component`s, and ARCHITECTURE.md exempts raw DOM helpers explicitly. Out of scope.
- **`Aria.applyToElement` at lines 617/621/625.** This is the framework implementation of the Aria namespace flush — the implementation of the rule, not a violation. Out of scope.
- **`Component.setElementAttribute` at line 513 and `Component.ts:3189`.** Framework-internal implementations of the typed-setter rule. Out of scope.
- **`Checkbox.render` still writes `element.checked`.** A DOM property write, not a `setAttribute` violation, but still a typed-setter shortcut that bypasses the proper `setChecked` / private backing field pattern. It is a separate refactor — separate plan if it surfaces.
- **`Input.applyStyle` font-family / font-size CSS rule writes.** Already covered by a sibling plan ([migrate-rule-style-to-stylerule.md](./migrate-rule-style-to-stylerule.md)). Don't duplicate the work here.
- **No new theme tokens.** This is a routing refactor; the rendered attributes / values are byte-for-byte identical.
- **No SVG-element typed-setter wrapper.** Out of scope; raw DOM is the documented exemption.
