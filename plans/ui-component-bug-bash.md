# UI Component Bug Bash — Implementation Plan

## Overview

Six independent, surgical bug fixes across the component, layout, and table buckets. Each fix targets a single root cause confirmed by reading the code; no concept is extended and no API surface grows. Bug numbering matches the request brief so the implementer can map this plan against the original report.

The plan is structured as one Overview, six numbered Architecture-Decision / Implementation sections, then one combined Verification section listing every demo to exercise.

**Cross-plan touch notes.** Bug 1 edits [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts); the (not-yet-drafted) `layout-system-overhaul.md` is expected to also touch this file, so the two should be sequenced — never landed concurrently. Bug 5 edits [`ToggleButton.ts`](../src/typescript/lib/component/button/ToggleButton.ts); [`input-component-class-hierarchy-audit.md`](input-component-class-hierarchy-audit.md) lists `ToggleButton` in its inventory but its Non-Goals explicitly say "no change to the button family," so the overlap is read-only. Both should still be sequenced rather than co-implemented.

---

## 1. Accordion — single-open enforcement snaps closing sections

### Architecture Decisions

**Root cause.** [`Accordion.setSingleOpen(true)`](../src/typescript/lib/layout/Accordion.ts#L147-L174) iterates `_openState`, flips the second-and-onwards open sections to `false`, and calls `scheduleLayout()`. It does **not** call `this.primeWrapper(i)` first. `primeWrapper` ([Accordion.ts:593-639](../src/typescript/lib/layout/Accordion.ts#L593-L639)) is what installs the `will-change: height` hint and arms the `transitionend` cleanup — without it, the panel wrapper's `setHeight(0)` write still hits a transitioning element (the wrapper has a `height ${duration}ms` transition installed at `createSection` time), but no compositor priming and, more importantly, **no container `height` transition** is installed for the duration of the close. The result is the wrapper height transitions while the container snaps to its new preferred height, clipping the closing wrapper instantly — visually identical to "snap shut."

Compare [`onHeaderClicked`](../src/typescript/lib/layout/Accordion.ts#L547-L570) and [`openSection`](../src/typescript/lib/layout/Accordion.ts#L221-L246), which both call `primeWrapper(i)` before flipping `_openState[i] = false` inside their single-open close-loops. `setSingleOpen` is the lone outlier.

**Fix.** Add `this.primeWrapper(i)` inside the single-open close-loop in `setSingleOpen`, mirroring the call sites in `onHeaderClicked` and `openSection`. No new API, no new state — just the missing prime call. Surgical, traces directly to the bug.

**Reject** moving the close-loop into a shared private helper. Three call sites with identical bodies is a fair refactor candidate, but the bodies differ in detail (the loop in `setSingleOpen` keeps the **first** open section, the loops in `onHeaderClicked` / `openSection` keep the **clicked/target** section) and unifying them would lose that distinction. Per CLAUDE.md §3 — surgical, don't refactor what isn't broken.

### Ordered Implementation Steps

1. In [`Accordion.setSingleOpen`](../src/typescript/lib/layout/Accordion.ts#L147-L174), add `this.primeWrapper(i);` as the **first** statement inside the `if (foundOpen) { ... }` branch ([Accordion.ts:161](../src/typescript/lib/layout/Accordion.ts#L161)). The prime must run before `_openState[i] = false` so the container `height` transition is installed for the duration of the close. → verify: `grep -n 'primeWrapper' src/typescript/lib/layout/Accordion.ts` shows four call sites (was three).
2. Smoke at `http://localhost:8015`, AccordionPanel demo: open three sections in multi-open mode, then flip the demo's single-open toggle. The two sections being auto-closed should animate over `_animationDuration` (default 200 ms) instead of snapping. → verify: open DevTools Performance recorder, confirm two height-transitions of ~200 ms duration fire on the wrappers being closed.

---

## 2. ProgressBar — click toggle race renders a flicker

### Architecture Decisions

**Root cause.** [`MiscPanel.ts:671-675`](../src/typescript/MiscPanel.ts#L671-L675) wires a `Button("Toggle indeterminate progress bar")` action listener that calls `progressBar.setIndeterminate(!progressBar.isIndeterminate())`. [`ProgressBar.setIndeterminate`](../src/typescript/lib/component/display/ProgressBar.ts#L161-L171) short-circuits when the new value equals the current value, then calls `applyIndeterminate(value)` and `scheduleLayout()`. [`applyIndeterminate`](../src/typescript/lib/component/display/ProgressBar.ts#L212-L220) writes the fill's `backgroundColor` and toggles its `animation` property:

```typescript
this._fill.setAnimation("ts-ui-progress-indeterminate 1.4s ease-in-out infinite");
// or
this._fill.clearAnimation();
```

Both writes route through `setElementStyle` and land *immediately* (the fill is already mounted). On a second click within the same animation frame the sequence is:

1. Click 1 → `setIndeterminate(true)` → animation starts → `scheduleLayout()` queues a layout.
2. Click 2 (before rAF) → `setIndeterminate(false)` → animation cleared, background switches back, fill width recomputed inside `doLayout` from `_value` (still 0 at construction) → fill collapses to width 0.
3. rAF flush → `doLayout` runs once (the second `scheduleLayout` was a no-op — the component was already pending) and writes the determinate width.

Between the click 2 inline writes and the rAF flush, the fill briefly sits with `animation: none`, an indeterminate background colour, and the full indeterminate width from the prior frame. That mismatched intermediate state is the flicker. The same race fires symmetrically going `false → true → false`.

**Root cause, precisely:** `applyIndeterminate` writes background-and-animation **inline** while the fill geometry is updated via `scheduleLayout()`. The two updates are not atomic — there's always one frame where the background says "indeterminate" but the width says "determinate," or vice versa.

**Fix.** Make geometry+style atomic: call `this.flushLayout()` (synchronous layout, available on Component — used by other component code) immediately after `applyIndeterminate` inside `setIndeterminate`, replacing the `scheduleLayout()` call. The user-visible cost is a single synchronous `doLayout` on the bar's own subtree; the gain is no interleaved frame. The branch already short-circuits on no-op so a no-op double-click costs nothing extra.

**Reject** debouncing the click on the consumer Button. The bug lives in the ProgressBar's own write ordering — debouncing is a band-aid that leaves the same race for every other call site (e.g. binding-driven updates). Fix it at the layer the order is set.

**Reject** wrapping `applyIndeterminate` writes in a `requestAnimationFrame`. That defers them by one frame, opening a different mismatched window (one frame of stale geometry vs. new style). `flushLayout` collapses the two writes into the same task.

### Ordered Implementation Steps

1. In [`ProgressBar.setIndeterminate`](../src/typescript/lib/component/display/ProgressBar.ts#L161-L171), replace `this.scheduleLayout();` at [ProgressBar.ts:168](../src/typescript/lib/component/display/ProgressBar.ts#L168) with `this.flushLayout();`. Geometry and style now land in the same call. → verify: `grep -n 'scheduleLayout\|flushLayout' src/typescript/lib/component/display/ProgressBar.ts` — `setValue` still uses `scheduleLayout` (no race there — value-only updates don't race against style); `setIndeterminate` is the only line touched.
2. Smoke at `http://localhost:8015`, MiscPanel "Toggle indeterminate progress bar" button. Mash the button 5–10 times in 1 second. No flicker should appear at any point in the sequence. → verify: with DevTools Performance recording active, the recorded frames between clicks show no intermediate mismatched-style frames on `#ProgressBar*-fill`.

---

## 3. ComboBox baseline misalignment in the MiscPanel HBox row

### Architecture Decisions

**Root cause.** The row at [MiscPanel.ts:742-759](../src/typescript/MiscPanel.ts#L742-L759) places `ComboBox`, `DateField`, `TimeField`, `DateTimeField` side-by-side in an `HBox`. HBox stacks by baseline; each field reports `wrapInnerBaseline(...)` of its inner content. The three Field classes delegate to `this._input.getBaseline()` ([DateField.ts:456-458](../src/typescript/lib/component/input/DateField.ts#L456-L458), [TimeField.ts:484-486](../src/typescript/lib/component/input/TimeField.ts#L484-L486), [DateTimeField.ts:468-470](../src/typescript/lib/component/input/DateTimeField.ts#L468-L470)), where `_input` is a real `PickerInput extends TextInput` rendering a native `<input>` element. [`TextInput.getBaseline`](../src/typescript/lib/component/input/TextInput.ts#L185-L187) returns `wrapInnerBaseline(Util.measureInputBaseline())` — `wrapInnerBaseline` adds the **input's own** chrome (`insets.top + border.top + padding.top`), and `Util.measureInputBaseline` ([Util.ts:175-224](../src/typescript/lib/core/Util.ts#L175-L224)) returns the probe `<input>`'s `borderTop + paddingTop + text-baseline`. The probe's chrome matches the real `<input>`'s chrome (same UA defaults under the theme font), so the math is exact — text baseline ends up at the right Y.

[`ComboBox.getBaseline`](../src/typescript/lib/component/input/ComboBox.ts#L519-L521) does the same thing — `wrapInnerBaseline(Util.measureInputBaseline())` — but **ComboBox is not an `<input>`**. It renders a `<div>` with `display: flex` containing a `<span>` ([ComboBoxLabel](../src/typescript/lib/component/input/ComboBox.ts#L250-L282)) for the label and a caret box. The span has none of an `<input>`'s UA border or padding. So `Util.measureInputBaseline()` adds an extra `border-top + padding-top` slice that doesn't exist in the rendered DOM. ComboBox's reported baseline is therefore higher than reality by that probe-chrome delta — visually, the label sits **below** the date/time fields' text by ~3-5 px (the input probe's UA border+padding on a standard chromium build).

The (deleted) `+1` empirical fudge once present at [`baseline-chrome-helper.md` step 148](implemented/baseline-chrome-helper.md) was a partial workaround; the proper fix is to stop calling the input probe at all on the non-input ComboBox.

**Fix.** Compute the ComboBox's inner baseline against the label span it actually renders. The label is a `Text`-shaped component but extends `Component` directly (it's a `<span>` with a `setLabel` setter; see [ComboBox.ts:250-282](../src/typescript/lib/component/input/ComboBox.ts#L250-L282)). The right inner value is `Util.measureTextMetrics(label, { font ... }).baseline` — exactly the text baseline the span renders, no extra chrome.

Two implementation choices:

1. **Have ComboBox call `Util.measureTextMetrics` directly** with the theme's `--ts-ui-font-family` / `--ts-ui-font-size` / `--ts-ui-line-height` (the same constants `ComboBoxLabel` inherits via cascade). Add a small cached helper `Util.measureLabelBaseline()` to mirror `measureInputBaseline()` so the caching shape stays consistent, with a matching `invalidateLabelBaselineCache()` that fires alongside the input cache on theme change.
2. **Promote `ComboBoxLabel` to a `Text` subclass and delegate to its `getBaseline()`** like the Field components do with `_input`.

Choice 1 is surgical and matches the surrounding caching pattern in [Util.ts](../src/typescript/lib/core/Util.ts#L175-L224). Choice 2 is structurally cleaner but pulls `Text`'s full lifecycle into `ComboBoxLabel` and is more change than the bug warrants — defer to the input-component-class-hierarchy-audit plan if a broader rework lands later.

**Going with choice 1.** Add a cached `measureLabelBaseline()` to the `Util` module, wired into the same theme-change invalidation hook as `invalidateInputBaselineCache()`. Update `ComboBox.getBaseline()` to call it.

**Reject** dropping the `wrapInnerBaseline` wrapper on ComboBox. The ComboBox's own `border` (1 px) and `padding-top` (3 px from `_defaultComboBoxOptions` at [ComboBox.ts:62-69](../src/typescript/lib/component/input/ComboBox.ts#L62-L69)) genuinely sit above the label content — they belong in the chrome. The bug is only in the `inner` argument.

### Public API

No public surface change on ComboBox. One new exported function in the `Util` module:

```typescript
// src/typescript/lib/core/Util.ts
export function measureLabelBaseline(): number;
export function invalidateLabelBaselineCache(): void;
```

Mirrors `measureInputBaseline` / `invalidateInputBaselineCache` shape ([Util.ts:175-193](../src/typescript/lib/core/Util.ts#L175-L193)).

### Ordered Implementation Steps

1. Add `measureLabelBaseline()` / `invalidateLabelBaselineCache()` to [Util.ts](../src/typescript/lib/core/Util.ts) after the existing input-baseline pair. Body is identical to `measureInputBaseline` except the probe is a bare `<span>` (no border or padding to read), so the function just returns the cached `measureTextMetrics("X", { fontFamily: "var(--ts-ui-font-family, sans-serif)", fontSize: "var(--ts-ui-font-size, 14px)", lineHeight: "var(--ts-ui-line-height, 1.2)" }).baseline`. No DOM probe needed — the metrics call already handles font measurement off-screen.
2. Wire the new invalidator into whatever calls `invalidateInputBaselineCache` on theme change. Grep for existing call sites: `grep -rn 'invalidateInputBaselineCache' src/typescript/lib`. Add a matching line at every hit. → verify: 0 missed sites by repeating the grep with `measureLabelBaseline`.
3. In [`ComboBox.getBaseline`](../src/typescript/lib/component/input/ComboBox.ts#L519-L521), replace `Util.measureInputBaseline()` with `Util.measureLabelBaseline()`. → verify: `grep -n 'measureInputBaseline\|measureLabelBaseline' src/typescript/lib/component/input/ComboBox.ts` — exactly one match (`measureLabelBaseline`).
4. Smoke at `http://localhost:8015`, MiscPanel "Animated dropdowns" row. The four control's text glyphs should sit on the same horizontal line (use DevTools Eyedropper or a ruler overlay to confirm pixel-equal baselines). → verify: with DevTools Computed-Style on each control, the visual text baseline Y is identical to the date field's text baseline Y ±1 px.
5. Toggle theme (light ↔ dark) and confirm the row remains baseline-aligned. → verify: the new `invalidateLabelBaselineCache` is called on theme change so the cached metric refreshes.

---

## 4. Text — `setText` doesn't trigger parent layout

### Architecture Decisions

**Root cause.** [`Text.setText`](../src/typescript/lib/component/input/Text.ts#L379-L393) sets `_options.text`, marks `_measurementDirty = true`, calls `this.scheduleLayout()`, then writes the new text into the element. The `_measurementDirty` flag is correct — the next `getPreferredSize` call will re-measure via `calculateSize()` ([Text.ts:272-312](../src/typescript/lib/component/input/Text.ts#L272-L312)). But [`Component.scheduleLayout`](../src/typescript/lib/core/Component.ts#L3232-L3244) queues `this` (the Text instance), not the parent. When the rAF flush runs ([Component.ts:115-142](../src/typescript/lib/core/Component.ts#L115-L142)), `Text.doLayout()` runs — but `Text` has no children and no layout work of its own; the new preferred size never propagates upward because the parent never re-runs **its** `doLayout`. The parent's cached position+size for this Text child stays at the pre-`setText` dimensions, so the visible box doesn't grow or shrink even though `getPreferredSize()` now reports the right value.

Compare [`Text.setFontSize`](../src/typescript/lib/component/input/Text.ts#L543-L567), [`setFontWeight`](../src/typescript/lib/component/input/Text.ts#L681-L690), [`setFontFamily`](../src/typescript/lib/component/input/Text.ts#L491-L500), and [`setLineHeight`](../src/typescript/lib/component/input/Text.ts#L712-L729): every other measurement-affecting setter has the same `_measurementDirty = true; scheduleLayout();` pattern. They all share the bug — `setText` is just the most visible one. The bug surfaces wherever a `Text` lives inside a sizing parent (`HBox`, `VBox`, `Row`, `Column`) and the text content changes after first layout.

The right schedule target is the parent component, not the Text itself. [`Component.getParentComponent()`](../src/typescript/lib/core/Component.ts) is the existing accessor; calling `getParentComponent()?.scheduleLayout()` enqueues the parent, which during `doLayout` calls `getPreferredSize()` on its children (including this Text — which then re-measures because `_measurementDirty` is true).

**Fix.** Inside the five measurement-affecting Text setters (`setText`, `setFontSize`, `setFontWeight`, `setFontFamily`, `setLineHeight`), replace `this.scheduleLayout()` with `this.getParentComponent()?.scheduleLayout() ?? this.scheduleLayout()` — schedule the parent if it exists; fall back to self when the Text has no parent yet (so the rAF still fires for first-render cases). The fallback also covers `Text` instances used standalone for measurement.

**Reject** broadcasting upward through every ancestor. The first ancestor's `doLayout` already recurses; the rAF flush prunes descendants of already-scheduled ancestors ([Component.ts:127-140](../src/typescript/lib/core/Component.ts#L127-L140)). Walking the chain is duplicate work.

**Reject** changing `scheduleLayout` itself to schedule the parent. That would alter the contract of every other call site (e.g. `setX`, `setY`, `setWidth`) that genuinely needs `this`'s layout to re-run without parent involvement. Surgical fix at the Text setters.

**Reject** introducing a `setMeasuredDirty()` API on parents that text can call. Adds an abstraction for a single use; CLAUDE.md §2.

### Ordered Implementation Steps

1. In [`Text.ts`](../src/typescript/lib/component/input/Text.ts), replace `this.scheduleLayout();` with `(this.getParentComponent() ?? this).scheduleLayout();` at each of:
   - `setText` ([Text.ts:383](../src/typescript/lib/component/input/Text.ts#L383))
   - `setFontFamily` ([Text.ts:497](../src/typescript/lib/component/input/Text.ts#L497))
   - `setFontSize` ([Text.ts:564](../src/typescript/lib/component/input/Text.ts#L564))
   - `setFontWeight` ([Text.ts:687](../src/typescript/lib/component/input/Text.ts#L687))
   - `setLineHeight` ([Text.ts:726](../src/typescript/lib/component/input/Text.ts#L726))

   The fallback `?? this` covers the unparented (standalone-measurement) case.

   → verify: `grep -n 'scheduleLayout' src/typescript/lib/component/input/Text.ts` — five `(this.getParentComponent() ?? this).scheduleLayout()` and zero bare `this.scheduleLayout()`.
2. Smoke at `http://localhost:8015`. Open a panel where Text is in an `HBox`. Programmatically call `text.setText("a much longer string than before")` via the demo's debug API or an existing button (the MiscPanel "Animate progress bar" sets `progressText.setText(...)` on a tick; observe that the surrounding row grows/shrinks to fit). → verify: the parent row's layout updates within one frame of the `setText` call.
3. Bench check: confirm no infinite re-layout loop. The parent's `doLayout` calls `child.setX/Y/Width/Height` and then `child.doLayout()`. None of those re-fire `_measurementDirty` on Text, so the re-entry is bounded. (Sanity-test by adding a temp `console.log` in `Text.doLayout` and confirming a single call per `setText`.)

---

## 5. ToggleButton — toggled appearance lost on hover

### Architecture Decisions

**Root cause.** [`Button`](../src/typescript/lib/component/button/Button.ts#L102-L110) installs a hover style rule with selector `#id:hover:not(:active)` (CSS specificity `(1,2,0)` — one ID, two pseudo-classes). [`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts#L32-L34) installs its selected-state rule with selector `#id.selected` (specificity `(1,1,0)` — one ID, one class). When the user hovers a selected ToggleButton, both rules match; the higher-specificity hover rule wins on every cascading property (`backgroundColor`, `backgroundImage`, `boxShadow`). The button visually loses its selected chrome on hover.

The [button-hover-theming.md](implemented/button-hover-theming.md) plan claimed at design time that "`ToggleButton`'s `.selected` rule has higher specificity than `:hover:not(:active)`, so hovering a selected toggle leaves the selected chrome intact." That claim is wrong: `:hover:not(:active)` carries two pseudo-class selectors against `.selected`'s one class. The bug is a regression introduced when `:not(:active)` was added in the hover-theming pass.

**Fix.** Promote the selected rule's specificity above `:hover:not(:active)`. The single-class-tag suffix `.selected` is at `(1,1,0)`; adding the host's own class (the auto-added `ToggleButton` class on every element) brings it to `(1,2,0)` — tied with hover and won by source order, which is still fragile. Going to `(1,2,1)` resolves it unambiguously. Two equally simple options:

1. **`createStyleRule(".selected:not(:hover)")`** — exclude `:hover` from the selected rule. Specificity `(1,2,1)`. Reads symmetric to Button's `:hover:not(:active)`. Loses hover feedback **on a selected button** — that's a UX call; the user already sees the pressed/selected chrome, and the framework's existing "pressed wins over hover" reasoning ([button-hover-theming.md "Selector is `:hover:not(:active)`"](implemented/button-hover-theming.md#L17-L21)) applies symmetrically to "selected wins over hover."

2. **`createStyleRule(".selected, .selected:hover")`** — match the selected rule on both states. Specificity `(1,2,0)` on the first half and `(1,2,1)` on the second; the second half wins on hover.

Option 1 is one suffix and one selector — minimal change, mirrors Button's existing precedent. Going with option 1.

**Reject** raising specificity by adding `!important` to the selected rule's declarations. `!important` short-circuits the cascade everywhere, including consumer overrides; specificity-based fixes preserve override-ability.

**Reject** restructuring the Button hover rule to `:hover:not(:active):not(.selected)`. Touches `Button.ts` (which isn't the source of *this* bug) and ripples through every Button subclass. Fix at the layer that introduced the regression — `ToggleButton.ts`.

### Ordered Implementation Steps

1. In [`ToggleButton.ts`](../src/typescript/lib/component/button/ToggleButton.ts#L33), change the lazy rule's selector from `".selected"` to `".selected:not(:hover)"`. The line becomes:

   ```typescript
   return this._selectedStyleRule ??= this.createStyleRule(".selected:not(:hover)");
   ```

   → verify: `grep -n '\.selected' src/typescript/lib/component/button/ToggleButton.ts` shows three hits — the selector at line 33, and the two `classList.toggle("selected", …)` calls (lines 103, 125) that target the runtime class, unchanged.
2. Smoke at `http://localhost:8015`, MiscPanel toggle button row. Click to toggle; hover the now-selected button. The `box-shadow inset`, `background-color`, and `background-image` from `--ts-ui-toggle-selected-*` tokens must persist. → verify: DevTools Computed → `background-color` reads the toggle-selected token value, not the button-hover token value, while hovering.
3. Theme toggle (light ↔ dark): confirm the selected hover still wins. → verify: both themes show the selected chrome on hover.
4. Regression check on un-selected hover: hover a non-selected ToggleButton — the standard hover chrome must still apply (the bug fix narrows the selected rule, doesn't widen anything else).

---

## 6. Table — column-focus indicator gone from header cell

### Architecture Decisions

**Root cause investigation.** [`Body._updateFocusStyle`](../src/typescript/lib/component/table/Body.ts#L728-L766) applies a `2px solid var(--ts-ui-focus-ring, …)` outline + `outline-offset: -2px` to the focused **body** cell only. The corresponding [`Body.onRowClick`](../src/typescript/lib/component/table/Body.ts#L608-L628) updates `_focusedColIndex` and re-runs `_updateFocusStyle` + `_updateActiveDescendant`. Nothing in the current code base notifies the [`Header`](../src/typescript/lib/component/table/Header.ts) or its child [`HeaderCell`](../src/typescript/lib/component/table/cell/Header.ts) instances that the column focus changed. `git log --oneline -- src/typescript/lib/component/table/` returns no commit that *removed* a header-side column-focus indicator; the indicator was never present in the lib/ tree.

So "vanished" here means **never wired up** — the feature was implicit in the table's UX intent (a focused cell should be findable across rows by looking at its column header) but only the body-cell focus ring was implemented. The keyboard-navigation plan ([plans/implemented/keyboard-navigation.md](implemented/keyboard-navigation.md)) adds `_focusedColIndex` and the focused-cell outline; the corresponding header marker is absent.

The right restoration is to apply a matching visual cue on the `HeaderCell` at `_focusedColIndex` whenever the body's focus column changes. The cue must:

- be visually distinct from the existing header `:active` and `:hover` styles ([cell/Header.ts:114-118](../src/typescript/lib/component/table/cell/Header.ts#L114-L118));
- not conflict with the sort arrow / priority badge that already overlay the cell;
- come from a theme token, not a hard-coded color.

The most compact restoration is a **bottom box-shadow** on the focused header cell — visually a 2 px under-line in the same focus-ring colour the body uses, matching shape with the body's outline so the eye reads them as the same affordance. `box-shadow` doesn't disturb the cell's own border or background, doesn't enter the layout, and renders cleanly underneath the resize handle.

**Wiring.** The simplest path is a one-line setter on `HeaderCell`:

```typescript
setColumnFocused(focused: boolean): this {
    this.setBoxShadow(focused
        ? "inset 0 -2px 0 0 var(--ts-ui-focus-ring, rgba(30,100,200,0.6))"
        : null);
    return this;
}
```

Then [`Body._updateFocusStyle`](../src/typescript/lib/component/table/Body.ts#L728-L766) gains a final step that walks the header cells via `this._table?.getHeader().getColumns()` (Header exposes `getColumns()` at [Header.ts:142-144](../src/typescript/lib/component/table/Header.ts#L142-L144)) and calls `headerCell.setColumnFocused(i === this._focusedColIndex)`. The Body needs a reference to its owning Table — today it doesn't carry one. Add a constructor argument or a `setHeader(Header)` injection from [Table.ts](../src/typescript/lib/component/table/Table.ts#L114-L121) where the Body and Header are wired up.

The Body already exposes `getSelectedRecord` / `getSelectedRecords` on Table that delegate ([Table.ts:392-403](../src/typescript/lib/component/table/Table.ts#L388-L403)); adding the inverse direction (Body → Header) is straightforward and parallels how Table holds both children. Going with `body.setHeader(this._header)` from Table's constructor, then `this._header.getColumns()` calls from `_updateFocusStyle`.

**Reject** a CSS-only approach via a `[data-focused-column="N"]` attribute on Header. The Header would need a `setFocusedColumn(n)` setter wired the same way; adding the attribute path adds a string-keyed `setAttribute` violation per ARCHITECTURE.md "data-carrying attributes only." Component-method dispatch is the cleaner seam.

**Reject** moving the indicator to the `Body` cell-focus outline by widening it to the header — the header is a separate `<thead>` element, can't be reached by a body-element outline.

### Public API

Two additions:

```typescript
// src/typescript/lib/component/table/cell/Header.ts
class HeaderCell extends DefaultCell {
    setColumnFocused(focused: boolean): this;
    isColumnFocused(): boolean;
}

// src/typescript/lib/component/table/Body.ts — non-public, package-internal
class Body extends Component {
    setHeader(header: Header): this;
}
```

`setColumnFocused` is a public mutator on `HeaderCell` (categorised `Components`); useful even outside the body-driven wiring for consumers building custom selection logic. `Body.setHeader` is internal plumbing called from `Table`'s constructor and isn't intended for consumer use; documented as such in JSDoc.

### Theme Tokens

Reuses the existing `--ts-ui-focus-ring` token already wired by [Body._updateFocusStyle](../src/typescript/lib/component/table/Body.ts#L762). No new token. The focus ring is a cross-table concept (focused cell, focused header column) and intentionally shares one colour.

### Ordered Implementation Steps

1. Add `_columnFocused: boolean = false` field and `setColumnFocused / isColumnFocused` methods to [`HeaderCell`](../src/typescript/lib/component/table/cell/Header.ts). The setter writes `_columnFocused` and dispatches `setBoxShadow(value ? "inset 0 -2px 0 0 var(--ts-ui-focus-ring, rgba(30,100,200,0.6))" : null)`. The getter returns `_columnFocused`. → verify: `grep -n 'setColumnFocused\|isColumnFocused' src/typescript/lib/component/table/cell/Header.ts` returns three hits (field, setter, getter).
2. Add `setHeader(header: Header)` to [`Body`](../src/typescript/lib/component/table/Body.ts), storing a `_header: Header | null = null` private field. JSDoc the method as "Internal wiring called by [`Table`](/api/component/table/classes/Table) — not for consumer use." → verify: `grep -n '_header\|setHeader' src/typescript/lib/component/table/Body.ts` shows the field declaration, the setter, and (after step 3) the use in `_updateFocusStyle`.
3. In [`Body._updateFocusStyle`](../src/typescript/lib/component/table/Body.ts#L728-L766), after the existing body-cell outline clear+apply loop, walk the header cells (when `_header !== null`) and call `headerCell.setColumnFocused(i === this._focusedColIndex)` for each `i`. Mirror the same clear+apply pattern so the indicator is correct after a column change. → verify: clicking a body cell in a different column moves both the body-outline and the header-shadow to the new column.
4. In [`Table` constructor](../src/typescript/lib/component/table/Table.ts#L114-L121), after `this._header = new Header(...)` and `this._body = new Body(...)` (both already present), add `this._body.setHeader(this._header);`. → verify: `grep -n 'setHeader' src/typescript/lib/component/table/Table.ts` returns the one new call site.
5. Smoke at `http://localhost:8015`, MiscPanel slow-table demo (per memory: `project_perf_benchmark.md`). Click cells in different columns; the corresponding header cell must show the 2 px inset bottom shadow. Use Arrow Left / Right to move column focus via keyboard and confirm the header indicator tracks. Confirm both themes (light + dark) show the indicator using `--ts-ui-focus-ring`.
6. Regression check: scroll horizontally — the header still mirrors body scroll via `setTranslate` at [Table.ts:154](../src/typescript/lib/component/table/Table.ts#L154); the focused-column indicator must stay anchored to the correct column after the scroll mirror runs.

---

## Files to Create / Modify / Delete

| Action | File | Bug |
|---|---|---|
| Modify | `src/typescript/lib/layout/Accordion.ts` | 1 |
| Modify | `src/typescript/lib/component/display/ProgressBar.ts` | 2 |
| Modify | `src/typescript/lib/core/Util.ts` | 3 |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` | 3 |
| Modify | `src/typescript/lib/component/input/Text.ts` | 4 |
| Modify | `src/typescript/lib/component/button/ToggleButton.ts` | 5 |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` | 6 |
| Modify | `src/typescript/lib/component/table/Body.ts` | 6 |
| Modify | `src/typescript/lib/component/table/Table.ts` | 6 |

No new files. No deletions.

---

## Verification

Run as a single pass after all six bug fixes land:

- `npx tsc --noEmit` — 0 new errors.
- `npx vite build` — succeeds.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Confirms the new `Util.measureLabelBaseline` export and `HeaderCell.setColumnFocused` / `Body.setHeader` symbols land in the API docs.
- `graphify update .` to refresh the knowledge graph.

Manual smoke at `http://localhost:8015`:

- **Bug 1 — Accordion (AccordionPanel demo).** Open three sections in multi-open mode, then flip the demo's single-open toggle: the two auto-closing sections animate over ~200 ms instead of snapping. DevTools Performance: two ~200 ms `height` transitions fire.
- **Bug 2 — ProgressBar (MiscPanel "Toggle indeterminate progress bar" button).** Mash the button 5–10 times in 1 second. No flicker, no intermediate mismatched-style frame on `#ProgressBar*-fill`.
- **Bug 3 — Baseline (MiscPanel "Animated dropdowns" row).** ComboBox text label sits on the same horizontal line as `DateField`, `TimeField`, `DateTimeField` text. Pixel-equal text-baseline Y across all four controls in both light and dark themes.
- **Bug 4 — Text (BindingPanel / MiscPanel where `progressText.setText(...)` is called on a tick).** The surrounding HBox row visibly grows/shrinks to fit the new text width within one frame. No infinite re-layout loop (`console.log` sanity check on `Text.doLayout` shows one call per `setText`).
- **Bug 5 — ToggleButton (MiscPanel toggle button row).** Click to toggle, then hover. The selected chrome (`--ts-ui-toggle-selected-shadow`, `--ts-ui-toggle-selected-bg`) stays applied. Non-selected ToggleButton still shows hover chrome on hover (no regression).
- **Bug 6 — Table column indicator (MiscPanel slow-table demo).** Click cells in different columns; the corresponding header cell shows a 2 px inset bottom shadow in `--ts-ui-focus-ring`. Arrow Left / Right tracks the indicator. Horizontal scroll preserves the column-to-header alignment.

Invariants:

- `grep -n 'primeWrapper' src/typescript/lib/layout/Accordion.ts` — 4 call sites (was 3).
- `grep -n 'scheduleLayout\|flushLayout' src/typescript/lib/component/display/ProgressBar.ts` — `setIndeterminate` uses `flushLayout`, `setValue` keeps `scheduleLayout`.
- `grep -n 'measureInputBaseline\|measureLabelBaseline' src/typescript/lib/component/input/ComboBox.ts` — exactly one match (`measureLabelBaseline`).
- `grep -n 'scheduleLayout' src/typescript/lib/component/input/Text.ts` — five `(this.getParentComponent() ?? this).scheduleLayout()` lines, zero bare `this.scheduleLayout()`.
- `grep -n '\.selected' src/typescript/lib/component/button/ToggleButton.ts` — three hits, one of which is the new `.selected:not(:hover)` suffix.
- `grep -n 'setColumnFocused\|setHeader' src/typescript/lib/component/table` — `setColumnFocused` declared in `cell/Header.ts`, used in `Body.ts`; `setHeader` declared in `Body.ts`, called in `Table.ts`.

---

## Documentation Impact

Three public-API additions, all need barrel + JSDoc treatment per [_shared/docs-conventions.md](../.claude/skills/_shared/docs-conventions.md):

| Symbol | Subpath barrel | Curated page | `@category` |
|---|---|---|---|
| `Util.measureLabelBaseline` / `Util.invalidateLabelBaselineCache` | `src/typescript/lib/core/index.ts` | none — utility, lands under `docs/api/core/namespaces/Util/functions/` | `Util` |
| `HeaderCell.setColumnFocused` / `isColumnFocused` | already-exported via `src/typescript/lib/component/table/index.ts` | mention in `docs/component/table/HeaderCell.md` if a curated page exists; otherwise typedoc-generated page is sufficient | `Components` (inherits class category) |
| `Body.setHeader` | already-exported | JSDoc-marked "internal — called by Table" | `Components` |

Run `npm run docs:build` and confirm:
- `docs/api/core/namespaces/Util/functions/measureLabelBaseline.md` lands.
- `docs/api/component/table/classes/HeaderCell.md` shows the new `setColumnFocused` / `isColumnFocused` methods.

No JSDoc cross-bucket links needed — all three symbols are referenced only within their own buckets.

No rename or removal — no `grep -rln` sweep needed across `docs/`.

---

## Critical Files

- [src/typescript/lib/layout/Accordion.ts](../src/typescript/lib/layout/Accordion.ts) — Bug 1's `setSingleOpen` and the `primeWrapper` helper to mirror.
- [src/typescript/lib/component/display/ProgressBar.ts](../src/typescript/lib/component/display/ProgressBar.ts) — Bug 2's `setIndeterminate` / `applyIndeterminate` / `doLayout` flow.
- [src/typescript/lib/core/Util.ts](../src/typescript/lib/core/Util.ts) — Bug 3's `measureInputBaseline` to mirror for `measureLabelBaseline`.
- [src/typescript/lib/component/input/ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts) — Bug 3's `getBaseline` and the `ComboBoxLabel` shape.
- [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — Bug 4's five measurement-affecting setters.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — Bug 4's `scheduleLayout` / `flushPendingLayouts` / `getParentComponent`; Bug 6's `setBoxShadow` and `getBaseline` chrome wrapper.
- [src/typescript/lib/component/button/ToggleButton.ts](../src/typescript/lib/component/button/ToggleButton.ts) — Bug 5's `_selectedStyleRule` selector.
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — Bug 5's `:hover:not(:active)` selector context.
- [src/typescript/lib/component/table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts) — Bug 6's HeaderCell extension point.
- [src/typescript/lib/component/table/Body.ts](../src/typescript/lib/component/table/Body.ts) — Bug 6's `_updateFocusStyle` and `_focusedColIndex` ownership.
- [src/typescript/lib/component/table/Table.ts](../src/typescript/lib/component/table/Table.ts) — Bug 6's Body↔Header wiring site.
- [plans/implemented/accordion-animation-polish.md](implemented/accordion-animation-polish.md), [plans/implemented/extract-accordion-header-indicator.md](implemented/extract-accordion-header-indicator.md) — historical context for Bug 1's `primeWrapper`.
- [plans/implemented/baseline-alignment.md](implemented/baseline-alignment.md), [plans/implemented/baseline-chrome-helper.md](implemented/baseline-chrome-helper.md) — historical context for Bug 3's baseline math.
- [plans/implemented/button-hover-theming.md](implemented/button-hover-theming.md) — design context (and contains the wrong specificity claim) for Bug 5.

---

## Potential Challenges

- **Bug 1 — primeWrapper timing.** `primeWrapper` installs a `transitionend` cleanup on the wrapper element. Calling it for sections that aren't actually animating (height delta of zero) would leak the `will-change` hint; mitigated by the existing `setTimeout(_, duration + 40)` fallback inside `primeWrapper` ([Accordion.ts:629-638](../src/typescript/lib/layout/Accordion.ts#L629-L638)).
- **Bug 2 — `flushLayout` re-entrancy.** `flushLayout` runs `doLayout` synchronously. If a downstream listener (e.g. an `aria-valuenow` change handler) triggers another `scheduleLayout` on the same component, the queue handles it on the next frame; no infinite loop. Confirm by reading [`Component.flushLayout`](../src/typescript/lib/core/Component.ts#L3253-L3258).
- **Bug 3 — invalidate sites.** The new `invalidateLabelBaselineCache` must fire wherever `invalidateInputBaselineCache` fires. Missing one means the cached label baseline goes stale after theme change. Grep audit is the mitigation.
- **Bug 4 — parent-of-parent updates.** If Text's parent is itself sized by its parent, scheduling only the immediate parent is correct: the parent's `doLayout` calls `getPreferredSize()` on its children, and if the result differs from its own preferred size the parent's parent's next layout pass picks it up — bounded by the standard layout cascade.
- **Bug 5 — Toggle Button accessibility.** The selected button still announces `aria-pressed="true"` regardless of hover state (the ARIA write is independent of the CSS rule). Sanity-check via DevTools Accessibility panel.
- **Bug 6 — `_header` lifecycle.** `Body.setHeader` is called from Table's constructor; if a consumer instantiates `Body` directly (without a Table) the `_header` field stays null and `_updateFocusStyle` simply skips the header walk. No new constraint on Body's public usage.

---

## Non-Goals

- **No refactor of `Accordion`'s three close-loops into a shared helper** — the loops differ in *which* section to keep; merging them would lose that distinction.
- **No promotion of `ComboBoxLabel` to a `Text` subclass** — out of scope for the bug; defer to a future input-class-hierarchy pass.
- **No new ARIA role for the focused-column header indicator** — `aria-activedescendant` already lives on Body; the header indicator is a purely visual mirror.
- **No animation on the focused-column header indicator** — instant apply matches the body-cell outline behaviour (also instant).
- **No new theme tokens** — Bug 6 reuses `--ts-ui-focus-ring`; Bug 3 needs no token (font tokens are read inside `measureLabelBaseline`).
- **No keyboard handler for cycling the focused-column indicator independently of the body cell** — the indicator follows `_focusedColIndex`, which the existing body keydown handler already drives.
- **No fix for Text's other unchecked-parent setters** beyond the five that mark `_measurementDirty = true` — non-measurement setters (`setTextAlign`, `setTextShadow`, etc.) don't change the preferred size, so the parent doesn't need to re-layout.
