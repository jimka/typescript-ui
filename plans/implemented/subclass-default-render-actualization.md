# Subclass Default Render-Actualization — Implementation Plan

## Overview

The base-class refactor (commit `32f8a92`, `feature/default-options-pure-fallback`) made every *base* `Component` option field a pure lazy fallback: getters return `this._options.X ?? this._defaultOptions.X ?? <null>`, [`applyStyle`](../src/typescript/lib/core/Component.ts#L3849) re-reads each field through its getter at render, and [`applyOptions`](../src/typescript/lib/core/Component.ts#L423) dispatches **only** raw caller `options.X`. Class-level defaults never land in `_options`, so subclass guards of the form `if (this._options.X === undefined)` are honest.

That invariant stops at the base class. ~40 subclasses still open their `applyOptions` override with `const opts = { ...this._defaultOptions, ...options } as TOptions;` and then dispatch or stash the **merged** bag (`if (opts.X !== undefined) this.setX(opts.X)` or `this._options.X = opts.X`). The merge writes subclass class-level defaults into `_options` at construction — exactly the pollution the base refactor eliminated for base fields.

This plan extends the pure-fallback model to subclass fields: defaults stay only in `_defaultOptions`, getters/render-reads fall back to them, and `applyOptions` dispatches raw caller `options.X`. The success invariant is that `grep -rn "this._defaultOptions, \.\.\.options" src/typescript/lib --include=*.ts` returns **zero** non-comment matches, with the full suite (1196 tests on the base branch) green at every checkpoint.

The hard constraint is that most subclass setter effects are **construction-time imperative** (`setText`, `setOrientation`, `setStyle`, `setDirection`) and are *not* re-read at render — so naively switching `opts.X → options.X` drops the default (this broke `BulletedList`: its `itemStyle` default rode the merge into `setStyle`, and raw dispatch left `getStyle()` undefined). Each genuinely-defaulted subclass field therefore needs both (a) a getter/render-read that falls back to `_defaultOptions.X`, and (b) a render/init re-apply (or an always-dispatch-the-default seed) so the default actualizes lazily without ever entering `_options`.

The decisive simplifying finding: **for the large majority of merge sites the subclass-specific dispatched/stashed fields are NOT present in that class's `_default*Options` bag at all** (those bags carry only base/chrome fields — `cursor`, `padding`, `border`, `backgroundColor`, `insets`, `preferredSize`, etc.). For those fields `opts.X === options.X` already, so the rewrite is a pure no-op rename. Only a minority of classes genuinely default a subclass field and need real render-actualization or always-dispatch handling.

---

## Architecture Decisions

### Three field classifications drive every edit

Per dispatched/stashed field at each merge site, cross-reference the field name against that class's `_default*Options` literal (and any subclass that routes through it):

- **(i) Redundant — no-op rename.** The field is either a base/chrome field already handled by the base `applyOptions`/`applyChromeOptions`, **or** it is a subclass field that is *not* set in any contributing `_default*Options` bag. Either way `opts.X === options.X`. Switch `opts` → `options` (or `this._options.X = options.X`) verbatim. No getter or render change needed.

- **(ii) Render-actualizable.** The field IS defaulted in `_default*Options` AND its effect is re-applied at render through a getter (or `_options.X` read folded with a `_defaultOptions` fallback). Switch dispatch to raw `options.X`; ensure the getter falls back to `_defaultOptions.X`; ensure the render hook reads the getter (not `_options.X` bare). `Text` is already in this shape — its `applyStyle` re-reads every font getter.

- **(iii) Construction-only, must-always-dispatch.** The field IS defaulted AND its effect seeds a `declare`d backing field during the super-time cascade (the class-field super-cascade trap), so the setter MUST fire at construction or the field stays `undefined`; there is no render re-read. Resolve the default inline at the single dispatch and always call the setter: `this.setX(options.X ?? this._defaultOptions.X)`. This mirrors the established `Panel.setAutoScroll(opts.autoScroll ?? "none")` decision — already a derived read; only the source of the fallback changes from the merged bag to `_defaultOptions`.

### Chrome group is untouched

`applyChromeOptions` keeps dispatching `options.X ?? this._defaultOptions.X` for `border`, `borderRadius`, `shadow`, `backgroundImage`. Subclasses that default chrome (Button, NumberSpinner, TextInput, ComboBox, FieldSet, Rail, Drawer, AbstractWindow, ToolBar, …) rely on the base `applyChromeOptions` for those keys; their own `applyOptions` overrides never dispatch chrome. Button's `applyChromeOptions` override (which reads `opts` for its flat/chromeless gating and pressed/hover fields) is handled as its own careful step — its base chrome dispatch already delegates to `super.applyChromeOptions(opts)`, and the pressed/hover fields are not in `_defaultButtonOptions`'s dispatched-by-`applyOptions` set, so its `opts` reads convert to `options ?? _defaultOptions` only where a default actually exists (the pressed/hover/`flat`/`chromeless` defaults).

### Derived reads fold the default inline

Sites that read `opts.X` inside an expression rather than gating on it — `Panel`'s `opts.autoScroll ?? "none"` / `opts.scrollShadows ?? true`, `Spacer`'s `opts.width ?? 0` / `opts.height ?? w` — become `options.X ?? this._defaultOptions.X ?? <literal>`. For Panel/Spacer the `_default*Options` bags do **not** set those keys, so this is functionally a no-op rename, but it must still drop the `opts` merge.

### The cross-class `itemStyle` case is the canonical render-actualizable example

`AbstractListComponent` seeds `itemStyle` into `_defaultOptions` from its constructor `style` parameter (`BulletedList` passes `BulletedListItemStyle.DISC`, `NumberedList` passes its DECIMAL default). The merge is what currently makes `setStyle(DISC)` fire. This is classification (ii): `setStyle` calls `setElementCSSRule("list-style-type", …)` which queues into `_styleRule` and flushes lazily at render, so the *write* is render-deferred — but the *call* only happens via the merge. The fix: make `getStyle()` fall back to `_defaultOptions.itemStyle`, dispatch raw `options.itemStyle`, and add a render/init re-apply that calls `this.setStyle(this.getStyle())` when a style is resolved but no caller value was stored.

---

## Per-Field Inventory & Classification

Source: `grep -rln "this._defaultOptions, \.\.\.options" src/typescript/lib --include=*.ts` (53 hits; `core/Component.ts` excluded — its only hit is a JSDoc comment at line 337). For each file: dispatched/stashed fields, whether each appears in that class's `_default*Options`, and the classification.

### Class (iii) — must-always-dispatch (default present, `declare`d field seeded at cascade)

| File | Defaulted fields dispatched | Edit |
|---|---|---|
| [`core/Panel.ts`](../src/typescript/lib/core/Panel.ts#L164) | `autoScroll`, `scrollShadows` *(not in `_defaultPanelOptions`)* | already derived-read; drop merge → `options.X ?? this._defaultOptions.X ?? <lit>` |
| [`menubar/ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts#L186) | `orientation`, `compact`, `overflowSide`, `flat` (all in `_defaultToolBarOptions`); `overflow` (base) | always-dispatch each: `this.setX(options.X ?? this._defaultOptions.X)` |
| [`container/SplitGutter.ts`](../src/typescript/lib/component/container/SplitGutter.ts#L228) | `orientation`→`setDirection`, `collapsible`, `movable` (all defaulted) | always-dispatch; `_direction`/`_collapsible`/`_movable` are `declare`d |
| [`overlay/Rail.ts`](../src/typescript/lib/overlay/Rail.ts#L330) | `edge`, `orientation` (defaulted); `thickness`, `collapsed` (not defaulted → (i)) | always-dispatch the two defaulted; raw for the rest |
| [`overlay/Drawer.ts`](../src/typescript/lib/overlay/Drawer.ts#L213) | `edge`, `modal`, `size`, `durationMs` (all defaulted) | always-dispatch each |
| [`overlay/Popover.ts`](../src/typescript/lib/overlay/Popover.ts#L219) | `placement`, `dismissOn`, `showArrow` (defaulted); `title` (not) | always-dispatch the three; raw for `title` |
| [`core/AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts#L138) | `animated`, `durationMs`, `translatePx` (all defaulted); `visible` is base | always-dispatch each |

Each (iii) site: verify the setter's getter (or backing-field read used downstream) is internally consistent; the always-dispatch keeps the `declare`d field seeded so no separate getter fallback is required, but add one only if a getter is publicly relied upon while the field could be unseeded (none found in the audit — every (iii) setter writes its `declare`d field directly).

### Class (ii) — render-actualizable (default present, re-read at render)

| File | Defaulted field | Render hook |
|---|---|---|
| [`component/input/Text.ts`](../src/typescript/lib/component/input/Text.ts#L184) | `textAlign`, `fontSize`, `fontWeight`, `fontStyle`, `fontVariant`, `fontStretch`, `fontKerning`, `fontSizeAdjust` (all in `_defaultTextOptions`); `truncate` (defaulted, separate setter) | [`Text.applyStyle`](../src/typescript/lib/component/input/Text.ts#L1121) already re-reads every font getter; getters already fall back to `_defaultOptions` |
| [`list/AbstractListComponent.ts`](../src/typescript/lib/component/list/AbstractListComponent.ts#L58) | `itemStyle` (seeded from ctor `style` param → BulletedList/NumberedList) | add render/init re-apply (see Pattern) |
| [`display/IconLabel.ts`](../src/typescript/lib/component/display/IconLabel.ts#L111) | `gap` (=2) | ctor HBox seed + ctor guard (see §Guards) |
| [`display/IconText.ts`](../src/typescript/lib/component/display/IconText.ts#L100) | `gap` (=2) | ctor guard (see §Guards) |

`Text`'s `fontSize: 14` deserves a note: today the merge dispatches `setFontSize(14)`, which transiently nulls `_fontSizeCSSVar`/`_fontSizeCSSRule` before the field initializers restore the var binding (see the comment at [Text.ts#L126](../src/typescript/lib/component/input/Text.ts#L126)). Dropping that default dispatch *leaves the theme-var binding intact* — the desired reactive state — and `applyStyle` writes `_fontSizeCSSRule` (the var) at render. Measurement (`calculateSize`) already reads `getFontSize()`/`_fontSizeCSSRule`. This is behaviour-preserving for the default case but is **manual-visual-verify** (font rendering + theme swap), not just unit-checkable.

### Class (i) — redundant no-op rename (field absent from `_default*Options`, or base field)

Every remaining merge site. The dispatched/stashed subclass fields are **not** in the class's `_default*Options` (verified bag-by-bag), so `opts.X === options.X`:

`button/Button.ts` (text, description, glyph, enabled, compact, anchor, fill, chromeless, flat, pressed*/hover* — none defaulted except via chrome path), `button/SplitButton.ts` (menuItems), `button/ToggleButton.ts` (selected), `container/AccordionIndicator.ts` (expanded, character), `container/CollapseButton.ts` (direction), `container/FieldSet.ts` (legend), `container/MenuItem.ts` (text, enabled, focused), `container/Spacer.ts` (width, height, flexWeight, flex — derived reads), `container/StatusBar.ts` (message, defaultMessage), `container/WindowHeader.ts` (closeable, minimizable, maximizable, glyph), `display/Glyph.ts` (fontSize, lineHeight, textAlign, animationDuration, animation — `preferredSize` is the only Glyph default and it is *not* dispatched here, it rides the base preferred-size fold), `display/PaginationBar.ts` (pageSize, pageIndex), `display/ProgressBar.ts` (indeterminate, value), `display/ProgressSpinner.ts` (spinnerSize), `display/Header.ts` (see careful step), `input/AbstractCalendarDropdown.ts` (minDate, maxDate), `input/AbstractInput.ts` (enabled, readOnly), `input/AbstractPickerField.ts` (dropdownAnimated), `input/AutoCompleteField.ts` (suggestions, minChars, debounceMs, maxSuggestions, matchMode, placeholder, store, displayField), `input/Checkbox.ts` (selected, value, indeterminate, label, enabled, readOnly), `input/ComboBox.ts` (items, store, displayField, valueField, selectedIndex, value, selectedItem, dropdownAnimated, dropdownMinWidth), `input/DateField.ts` / `DateTimeField.ts` / `DateTimePickerDropdown.ts` (value, min/maxDate, showSeconds), `input/FileDropZone.ts` (promptText), `input/FileField.ts` (multiple, accept, buttonText), `input/NumberSpinner.ts` (min, max, step, precision, value, enabled), `input/RadioButton.ts` (selected, value, label, text, radioName, enabled, readOnly), `input/Slider.ts` (value, min, max, minValue, maxValue, step, largeStep, orientation, showTicks, enabled, readOnly), `input/TextArea.ts` (rows, cols, wrap), `input/TextInput.ts` (text, textAlign, placeholder, readOnly, enabled, maxLength, inputMode, autoComplete), `input/TimeField.ts` (showSeconds, value), `input/Toggle.ts` (value, label, enabled, readOnly), `list/AbstractCustomList.ts` (items, store, displayField, valueField), `list/List.ts` (selectedIndex, value, selectedItem), `list/ListItem.ts` (text), `list/MultiSelectList.ts` (selectedIndices), `overlay/AbstractWindow.ts` (headerText, glyph, contentFactory, onReady, x/y/width/height, closeable, minimizable, maximizable, maximizeBounds, windowState, snap*, constrainToViewport — see careful step: many ARE defaulted but stashed/read directly, treat as (i)/(ii) hybrid below), `overlay/RailHandle.ts` (selected), `table/cell/SortPriorityBadge.ts` (priority).

> Note on the stash form `this._options.X = opts.X`: these classes read `_options.X` back in their constructor body or render hook (e.g. [`Checkbox` ctor lines 126–147](../src/typescript/lib/component/input/Checkbox.ts#L126)). Because the field is not in `_defaultCheckboxOptions`, `_options.X` was only ever populated from a caller value anyway — the body's `if (this._options.X !== undefined)` guards keep working unchanged after the rename. **No getter/render change is needed for (i) stash sites.**

### `overlay/AbstractWindow.ts` — hybrid, treat as a careful step

`_defaultWindowOptions` DOES default `x/y/width/height`, `closeable/minimizable/maximizable/maximizeBounds/windowState`, `snapResizeEnabled/snapThreshold/snapModifier`, `constrainToViewport`. Two sub-cases:

- `x/y/width/height` → dispatched via real setters (`setX`/`setWidth`/…): **(iii) always-dispatch** `this.setX(options.x ?? this._defaultOptions.x)` (these seed geometry the window relies on at first render).
- `closeable/minimizable/maximizable/maximizeBounds/windowState` → **stashed** `this._options.X = opts.X`, then read by the header-build path. These are genuinely defaulted, so the stash must become a fallback read at the consuming site, OR keep an always-stash `this._options.X = options.X ?? this._defaultOptions.X` *only if* a downstream `_options.X === undefined` guard does not depend on the clean bag. Audit the read sites first; prefer making the **read** fall back (`this._options.closeable ?? this._defaultOptions.closeable`) so `_options` stays clean.
- `snap*`, `constrainToViewport` → dispatched via setters: **(iii) always-dispatch**.

This file is the highest-risk single change; give it its own checkpoint and verify window chrome (close/min/max buttons present), drag, snap, and viewport-constrain manually.

---

## Canonical Pattern (worked example: `AbstractListComponent.itemStyle`)

Current:

```typescript
protected applyOptions(options: AbstractListOptions<U>): this {
    super.applyOptions(options);
    const opts = { ...this._defaultOptions, ...options } as AbstractListOptions<U>;
    if (opts.itemStyle !== undefined) this.setStyle(opts.itemStyle);
    if (opts.selectedIndex !== undefined) this.setSelectedIndex(opts.selectedIndex, false);
    return this;
}
getStyle() { return this._style; }
```

Target (classification ii):

```typescript
protected applyOptions(options: AbstractListOptions<U>): this {
    super.applyOptions(options);
    // Raw caller dispatch only — the class default (DISC/DECIMAL, seeded into
    // `_defaultOptions.itemStyle` from the ctor `style` param) is actualised at
    // render via `getStyle()`'s fallback, never written into `_options`.
    if (options.itemStyle !== undefined) this.setStyle(options.itemStyle);
    if (options.selectedIndex !== undefined) this.setSelectedIndex(options.selectedIndex, false);
    return this;
}

// Getter now falls back to the class default.
getStyle(): U | undefined {
    return this._style ?? (this._defaultOptions.itemStyle as U | undefined);
}

// Render re-apply: actualise the resolved style if no setter ran. `setStyle`
// queues `list-style-type` into `_styleRule`, flushed by the base render path.
protected render() {
    const element = super.render();
    if (this._style === undefined) {
        const fallback = this._defaultOptions.itemStyle as U | undefined;
        if (fallback !== undefined) this.setStyle(fallback);
    }
    return element;
}
```

> Verify `AbstractListComponent` has (or can add) a `render()`/`init()` hook that runs after the element exists. If it already overrides `render`, fold the re-apply in; otherwise add a minimal override calling `super.render()` first. The re-apply must NOT write to `_options` (it calls `setStyle`, which writes `_style` only).

Worked example for classification (iii) (`ToolBar.orientation`):

```typescript
// before: const opts = {...}; if (opts.orientation !== undefined) this.setOrientation(opts.orientation);
// after — always dispatch, default resolved inline (mirrors Panel.setAutoScroll):
this.setOrientation(options.orientation ?? this._defaultOptions.orientation!);
this.setCompact(options.compact   ?? this._defaultOptions.compact!);
this.setFlat(options.flat         ?? this._defaultOptions.flat!);
this.setOverflowSide(options.overflowSide ?? this._defaultOptions.overflowSide!);
if (options.overflow !== undefined) this.setOverflow(options.overflow); // base field, raw
```

---

## Guard-∩-Default Fields To Make Honest

### `gap` — IconLabel / IconText (classification ii)

`_defaultIconLabelOptions.gap = 2` and `_defaultIconTextOptions.gap = 2`. After the rename, `_options.gap` is undefined unless the caller passed it, so every bare `this._options.gap` read must fold the default.

- **IconLabel ctor [line 76](../src/typescript/lib/component/display/IconLabel.ts#L76):** `new HBox({ spacing: this._options.gap })` → `new HBox({ spacing: this._options.gap ?? this._defaultOptions.gap })`.
- **IconLabel ctor [line 98](../src/typescript/lib/component/display/IconLabel.ts#L98):** the post-build `if (this._options.gap !== undefined) … setComponentSpacing(this._options.gap)` becomes unconditional with a folded value, since the HBox seed already covers the default — keep it minimal: drive both from `this._options.gap ?? this._defaultOptions.gap`. (The HBox seed alone actualizes the default; the guard only needs to push a *caller* override, so it can stay `!== undefined` on `_options.gap` — but the seed must fold the default. Choose the seed-folds approach to avoid a double-write.)
- **IconText ctor [line 81](../src/typescript/lib/component/display/IconText.ts#L81):** IconText seeds its HBox WITHOUT spacing and relies entirely on this guard. So it must become `(this.getLayoutManager() as HBox).setComponentSpacing(this._options.gap ?? this._defaultOptions.gap!)` unconditionally (the default 2 must always apply).
- **`applyOptions`** in both: `if (options.gap !== undefined) this._options.gap = options.gap;` (raw stash), same for `glyph`/`text`/`forId` which are not defaulted (the positional `?? glyph` fallbacks at IconLabel L84–86 already cover those).

### Header — pre-existing dead guards, own careful step

[`Header.ts`](../src/typescript/lib/component/display/Header.ts) extends `Container` and forwards font/text fields to a *child* `Text`. `_defaultHeaderOptions` sets only `insets`. Header's `applyOptions` stashes the merged bag into `_options`; because `fontWeight`/`fontSize`/`preferredSize` are **not** in `_defaultHeaderOptions`, the merge contributes nothing for them — so the rename of Header's `applyOptions` to raw `options.X` is classification (i) (a no-op for the stashed fields).

HOWEVER, the ctor guards at [lines 62, 65, 84](../src/typescript/lib/component/display/Header.ts#L62) (`if (this._options.fontWeight === undefined) this._text.setFontWeight("bold")`, `… fontSize … "--ts-ui-header-font-size"`, `… preferredSize … updatePreferredSize()`) are **already honest today** (they read Header's own `_options`, which only carries caller values for those keys). The rename does not change them. The risk flagged in the brief — that activating these guards changes Header's rendering — applies only if a prior merge was silently populating `_options.fontWeight/fontSize/preferredSize`; it is **not** (those keys are absent from `_defaultHeaderOptions`, and Container has no `applyOptions` override that would inject them). **Therefore Header is mechanically classification (i), but it must be visually verified** (header label bold + font size + height) precisely because the brief identified it as a suspected behaviour-change point — confirm with a screenshot before and after that the header renders identically.

If verification reveals the guards *were* dead-but-firing differently (e.g. a base font default leaking via `TextOptions` defaults that Header inherits through the `extends TextOptions` interface — note Header extends `Container`, not `Text`, so no `_defaultTextOptions` reaches it), escalate: that would mean Header never applied bold/header-size and relied on inherited CSS, and the change must preserve current pixels. The audit found no such leak (Header builds its own `Text` child which carries `_defaultTextOptions` independently), so the expected outcome is "identical render."

---

## Ordered Implementation Steps

Each batch ends with `npm test` (expect 1196 green) and the running grep count dropping. Comment cleanups happen in the batch that touches the file.

1. **Batch A — trivial no-op renames, stash form.** For every classification-(i) file whose `applyOptions` only does `this._options.X = opts.X` (Checkbox, Toggle, RadioButton, Slider, NumberSpinner, TimeField, DateField, DateTimeField, DateTimePickerDropdown, FileField, FileDropZone, AbstractInput, AbstractCalendarDropdown, ComboBox, List, AbstractCustomList, MultiSelectList, StatusBar, SortPriorityBadge): delete the `const opts = …` line, replace `opts.` with `options.` in the stash lines. → verify: `npm test`; `grep` count drops by the batch size.

2. **Batch B — trivial no-op renames, setter form.** Classification-(i) files dispatching real setters from `opts` (SplitButton, ToggleButton, AccordionIndicator, CollapseButton, FieldSet, MenuItem, PaginationBar, ProgressBar, ProgressSpinner, Glyph, TextArea, TextInput, AutoCompleteField, AbstractPickerField, WindowHeader, ListItem, RailHandle): same mechanical `opts.` → `options.` and drop the merge. Clean the FieldSet JSDoc comment ([FieldSet.ts#L22](../src/typescript/lib/component/container/FieldSet.ts#L22)). → verify: `npm test`.

3. **Batch C — derived-read renames.** Panel (`options.autoScroll ?? "none"`, `options.scrollShadows ?? true`) and Spacer (`options.width ?? 0`, `options.height ?? w`). Both `_default*Options` lack those keys → no-op, but drop the merge. → verify: `npm test`.

4. **Batch D — classification (iii) always-dispatch.** ToolBar, SplitGutter, Rail, Drawer, Popover, AnimatedDropdown. Convert each defaulted field to `this.setX(options.X ?? this._defaultOptions.X!)`; raw-dispatch the non-defaulted fields. → verify: `npm test`; manual smoke each (toolbar overflow/orientation, split gutter drag/collapse, rail edge, drawer open/edge/size, popover placement/arrow, animated dropdown timing).

5. **Batch E — classification (ii) render-actualizable.** AbstractListComponent (getter fallback + render re-apply, per Pattern), IconLabel & IconText (gap fold per §Guards). → verify: `npm test`; add the offline tests below; manual: bulleted list shows DISC, numbered list shows DECIMAL, icon rows show 2px gap.

6. **Batch F — Text.** Drop the merge; dispatch raw `options.X` for every font field; rely on existing `applyStyle` getter re-read (no getter change needed — they already fall back). Keep `truncate` dispatch raw. → verify: `npm test`; manual visual: default text renders at 14px/normal/left and re-flows on theme swap; a `fontWeight: "bold"` caller still bolds.

7. **Batch G — Header.** Rename to raw `options.X` (no-op for stashed font fields). Do NOT touch the ctor guards. → verify: `npm test`; **manual screenshot diff** of a Header before/after (bold label, header font size, bar height).

8. **Batch H — Button.** Rename `applyOptions` `opts.` → `options.` for the (i) stash/dispatch fields; in `applyChromeOptions` override, convert each `opts.X` to `options.X ?? this._defaultOptions.X` only for the defaulted pressed/hover/flat/chromeless fields, leaving `super.applyChromeOptions` to own border/borderRadius/shadow/backgroundImage. Preserve the `(this._options.flat ?? opts.flat)` / `(this._options.chromeless ?? opts.chromeless)` gates as `?? this._defaultOptions.X`. → verify: `npm test`; manual: resting/hover/pressed chrome, flat & chromeless variants.

9. **Batch I — AbstractWindow.** Per the hybrid step: always-dispatch `x/y/width/height` and `snap*`/`constrainToViewport` setters with inline default; convert the stashed defaulted fields (`closeable`/`minimizable`/`maximizable`/`maximizeBounds`/`windowState`) to clean-bag reads that fall back at the consuming header-build site; raw for the non-defaulted (`headerText`, `glyph`, `contentFactory`, `onReady`). → verify: `npm test`; manual: window chrome buttons, drag, snap, maximize-to-viewport, restore.

10. **Final invariant.** Clean the lone Component.ts JSDoc comment at [line 337](../src/typescript/lib/core/Component.ts#L337) (reword to describe raw-dispatch). Then:
    `grep -rn "this._defaultOptions, \.\.\.options" src/typescript/lib --include=*.ts` → **zero matches**.
    `npm test` → 1196 green. `npx tsc --noEmit` → clean. `npm run docs:build` → 0 errors / 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (JSDoc comment only) |
| Modify | `src/typescript/lib/core/Panel.ts` |
| Modify | `src/typescript/lib/core/AnimatedDropdown.ts` |
| Modify | `src/typescript/lib/component/input/Text.ts` |
| Modify | `src/typescript/lib/component/display/Header.ts` |
| Modify | `src/typescript/lib/component/display/IconLabel.ts` |
| Modify | `src/typescript/lib/component/display/IconText.ts` |
| Modify | `src/typescript/lib/component/display/Glyph.ts` |
| Modify | `src/typescript/lib/component/display/PaginationBar.ts` |
| Modify | `src/typescript/lib/component/display/ProgressBar.ts` |
| Modify | `src/typescript/lib/component/display/ProgressSpinner.ts` |
| Modify | `src/typescript/lib/component/list/AbstractListComponent.ts` |
| Modify | `src/typescript/lib/component/list/List.ts` |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` |
| Modify | `src/typescript/lib/component/list/MultiSelectList.ts` |
| Modify | `src/typescript/lib/component/list/ListItem.ts` |
| Modify | `src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `src/typescript/lib/component/button/Button.ts` |
| Modify | `src/typescript/lib/component/button/SplitButton.ts` |
| Modify | `src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `src/typescript/lib/component/container/Spacer.ts` |
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `src/typescript/lib/component/container/StatusBar.ts` |
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `src/typescript/lib/component/container/FieldSet.ts` (incl. JSDoc comment) |
| Modify | `src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `src/typescript/lib/component/container/AccordionIndicator.ts` |
| Modify | `src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `src/typescript/lib/component/input/Toggle.ts` |
| Modify | `src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `src/typescript/lib/component/input/Slider.ts` |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `src/typescript/lib/component/input/TextInput.ts` |
| Modify | `src/typescript/lib/component/input/TextArea.ts` |
| Modify | `src/typescript/lib/component/input/AbstractInput.ts` |
| Modify | `src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `src/typescript/lib/component/input/AbstractCalendarDropdown.ts` |
| Modify | `src/typescript/lib/component/input/AutoCompleteField.ts` |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `src/typescript/lib/component/input/DateField.ts` |
| Modify | `src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | `src/typescript/lib/component/input/DateTimePickerDropdown.ts` |
| Modify | `src/typescript/lib/component/input/TimeField.ts` |
| Modify | `src/typescript/lib/component/input/FileField.ts` |
| Modify | `src/typescript/lib/component/input/FileDropZone.ts` |
| Modify | `src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `src/typescript/lib/overlay/Drawer.ts` |
| Modify | `src/typescript/lib/overlay/Popover.ts` |
| Modify | `src/typescript/lib/overlay/Rail.ts` |
| Modify | `src/typescript/lib/overlay/RailHandle.ts` |
| Modify | `src/typescript/lib/component/table/cell/SortPriorityBadge.ts` |
| Modify | `tests/component/default-options-fallback.test.ts` (extend with subclass cases) |

---

## Expected Behaviour

Reuse the [`tests/component/default-options-fallback.test.ts`](../tests/component/default-options-fallback.test.ts) harness style: construct, cast to `any` for `_options`/private fields, `getElement(true)` to force render. Offline-unit-testable unless marked manual.

**Clean-bag invariant (offline, every batch):**
- For a default-only construction of each genuinely-defaulted class, the defaulted subclass key is `undefined` in `_options`:
  - `new BulletedList()._options.itemStyle` → `undefined`; `new IconText('x','y')._options.gap` → `undefined`; `new ToolBar()._options.orientation` → `undefined`; `new Drawer()._options.edge` → `undefined`; `new Popover()._options.placement` → `undefined`; `new SplitGutter('horizontal')._options.collapsible` → `undefined`; `new AnimatedDropdown()._options.durationMs` → `undefined`; `new Panel()._options.autoScroll` → `undefined`.

**Render-actualization (offline):**
- `BulletedList`: `getStyle()` returns `BulletedListItemStyle.DISC` with no caller value; after `getElement(true)`, the list-style-type CSS rule is `disc`. `NumberedList`: `decimal`.
- `BulletedList({ itemStyle: SQUARE })`: `getStyle()` → `SQUARE`; `_options.itemStyle` → `SQUARE` (caller value is explicit).
- `IconText('x','y')`: after render, the HBox component spacing is `2`. `IconText('x','y',{ gap: 8 })` → spacing `8`, `_options.gap` → `8`.
- `IconLabel('g','t','id')`: HBox spacing `2`. `IconLabel(..., { gap: 8 })` → `8`.

**Always-dispatch seeding (offline):**
- `new ToolBar()` (no options): `getOrientation()` → `"horizontal"`, `isCompact()`/`getFlat()` reflect the defaults (`true`), `_options.orientation` undefined.
- `new SplitGutter('vertical')`: `getDirection()` reflects the positional/default correctly and the `declare`d `_direction`/`_collapsible`/`_movable` are seeded (no `undefined`).
- `new Drawer()`: `getEdge()`/`getDrawerSize()`/duration reflect defaults; `_options.edge` undefined.
- `new AnimatedDropdown()`: animated/duration/translate getters reflect defaults; `_options` clean.

**Text (offline + manual):**
- Offline: `new Text('hi')` → `getFontSize()` resolves to `14` (or the bound var) via fallback; `_options.fontWeight` undefined; `getFontWeight()` → `"normal"`. After `getElement(true)`, `applyStyle` writes the font CSS rule from getters.
- Offline: `new Text('hi',{ fontWeight:'bold' })` → `_options.fontWeight === 'bold'`, `getFontWeight()` → `'bold'`.
- **Manual visual:** default Text renders 14px/normal/left; theme swap re-flows font size (the var binding stays intact); a caller bold still bolds.

**Header (manual visual, screenshot diff):** a `new Header('Title')` renders with bold label, `--ts-ui-header-font-size`, and the same bar height before and after the change. `Header('T',{ fontWeight:'normal' })` suppresses bold.

**Button (offline + manual):**
- Offline: `new Button({ text:'x' })._options.flat` undefined; `getFlat()`/flat-gate resolve via `_defaultOptions` fallback.
- **Manual:** resting/hover/pressed chrome unchanged; `{ flat:true }` and `{ chromeless:true }` variants render flat/chromeless.

**AbstractWindow (offline + manual):**
- Offline: `new <Window>()` → geometry getters report `x=50,y=50,width=400,height=300`; `_options.x` undefined (seeded via setter); `closeable`/etc. resolve `true` via fallback with `_options` clean.
- **Manual:** close/minimize/maximize buttons present; drag, snap (ctrl, 12px), maximize-to-viewport, restore all work.

**Regression (offline, every batch):** full suite stays at 1196 passing; no `_options` key for any defaulted subclass field appears after a default-only construction.

---

## Verification

- `npm test` after every batch — 1196 green throughout.
- `npx tsc --noEmit` — clean (watch for the `?? this._defaultOptions.X!` non-null assertions in (iii) sites; they are sound because the default bag sets those keys).
- Final grep invariant: `grep -rn "this._defaultOptions, \.\.\.options" src/typescript/lib --include=*.ts` → zero matches (the two JSDoc comments in Component.ts and FieldSet.ts are reworded in the relevant batches).
- New/extended unit tests in `tests/component/default-options-fallback.test.ts` covering the offline Expected Behaviour entries.
- `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).
- Manual smoke screens: the List demo (bulleted/numbered), the icon-row demos (IconLabel/IconText), the ToolBar demo, the Window/Drawer/Popover/Rail overlay demos, a Header, a Button gallery, and a theme toggle.

---

## Potential Challenges

- **`declare`d-field seeding (classification iii):** dropping a setter dispatch leaves the `declare`d backing field `undefined` and breaks the constructor body that reads it (Panel/ToolBar/SplitGutter pattern). Mitigation: always-dispatch with the default folded inline — never gate (iii) fields on `!== undefined`.
- **Cross-class defaults that ride a constructor parameter (`itemStyle`):** easy to miss because the default isn't a literal in `_default*Options`. Mitigation: the inventory hunts the constructor `super(..., { itemStyle: style })` seed explicitly; the render re-apply covers it.
- **Header's suspected behaviour change:** the brief flags it; the audit shows the guards are already honest, but font/size/height are pixel-sensitive. Mitigation: screenshot diff as a gating check, escalate if pixels move.
- **Text's font-var clobber dance:** the dropped `setFontSize(14)` changes which code path leaves `_fontSizeCSSVar` set. Mitigation: confirm `applyStyle` writes `_fontSizeCSSRule` and that theme swap re-flows; manual-verify.
- **AbstractWindow stash-vs-setter split:** mixing always-dispatch geometry with clean-bag reads for chrome flags is the trickiest single file. Mitigation: audit each read site before editing; isolate in its own batch.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — the established pure-fallback pattern: `applyOptions` (L423), `applyChromeOptions` (L511), `applyStyle` (L3849), `getCursor`/getters, `getLayoutManager` (L4391), the `_options`/`_defaultOptions` doc (L319–345).
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — the canonical classification-(iii) "always-dispatch the default" precedent (`setAutoScroll(opts.autoScroll ?? "none")`).
- [`src/typescript/lib/component/input/Text.ts`](../src/typescript/lib/component/input/Text.ts) — the canonical classification-(ii) precedent (`applyStyle` re-reads font getters; getters fall back to `_defaultOptions`).
- [`src/typescript/lib/component/list/AbstractListComponent.ts`](../src/typescript/lib/component/list/AbstractListComponent.ts) + [`BulletedList.ts`](../src/typescript/lib/component/list/BulletedList.ts)/[`NumberedList.ts`](../src/typescript/lib/component/list/NumberedList.ts) — the cross-class `itemStyle` case.
- [`tests/component/default-options-fallback.test.ts`](../tests/component/default-options-fallback.test.ts) — harness style to extend.

---

## Non-Goals

- **No chrome-group change.** `border`/`borderRadius`/`shadow`/`backgroundImage` stay on the `applyChromeOptions` dispatch path with their `?? _defaultOptions` fold, per the preserved base decision.
- **No new public API.** This is an internal construction-path refactor; no new options, setters, or theme tokens.
- **No behaviour change for explicit callers.** A caller value equal to a default remains explicit (stored in `_options`); only the *default-only* path moves to lazy fallback.
- **No refactor of unrelated `applyOptions` logic** (event wiring, derived state, layout managers) beyond removing the `opts` merge.
