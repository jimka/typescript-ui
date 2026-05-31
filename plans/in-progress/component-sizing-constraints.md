---
touches-shared:
  - src/typescript/lib/component/list/AbstractCustomList.ts
---

# Component Sizing Constraints — Implementation Plan

## Overview

Four sibling components currently let the user resize them or let the layout manager crush them below a usable floor. This plan gives each one a correct, layout-manager-respecting size constraint so the *layout manager* — never the user, never an over-eager shrink pass — owns the final size. All four are the same shape: declare a minimum (and, for `TextArea`, forbid the browser-native resize affordance), mirroring the `this.setMinSize(w, h)`-in-constructor pattern already used by [`ComboBox.ts:420`](../src/typescript/lib/component/input/ComboBox.ts#L420), [`StatusBar.ts:109`](../src/typescript/lib/component/container/StatusBar.ts#L109), and [`MenuBar.ts:64`](../src/typescript/lib/component/menubar/MenuBar.ts#L64).

- **ITEM A** — [`Table.ts`](../src/typescript/lib/component/table/Table.ts): floor at 100×100 (currently crushed on `ComplexUIPanel`'s Panel 6, the empty-store table).
- **ITEM B** — [`TextArea.ts:17`](../src/typescript/lib/component/input/TextArea.ts#L17): floor at 100×100 (it has no min-size today, only `preferredSize: {200,200}`), and the CSS `resize` option must be removed so the textarea can *never* be user-resizable.
- **ITEM C** — [`AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts): `List` and `MultiSelectList` floor at 100×100.
- **ITEM D** — [`FieldSet.ts`](../src/typescript/lib/component/container/FieldSet.ts): floor at 100×100, and clamp the `<legend>` so a long title (`"Hello World fieldset!"`) ellipsises inside the frame instead of spilling out.

All changes are constructor-level constraint declarations plus one CSS `max-width` on the legend. No new public API except removing `TextArea`'s `resize` option (ITEM B). Verified on [`ComplexUIPanel.ts`](../src/typescript/ComplexUIPanel.ts).

---

## Architecture Decisions

### Minimums go through `setMinSize()` in the constructor, not raw CSS `min-width`/`min-height`

The framework's authoritative minimum is the value `Component.getMinSize()` returns, which the layout managers read when distributing space — it is `max(_options.minSize, layoutManager.getMinSize())` ([`Component.ts:1640`](../src/typescript/lib/core/Component.ts#L1640)). `setMinSize()` ([`Component.ts:1685`](../src/typescript/lib/core/Component.ts#L1685)) both records `_options.minSize` (so the layout pass honours it) *and* writes the `min-width`/`min-height` CSS rule (so the DOM box can't collapse under it). Hand-writing CSS alone would fix the visual box but leave `getMinSize()` reporting `{0,0}`, so the layout manager would still allocate sub-100px space and fight the CSS floor. Every existing min-size declaration in the codebase uses `setMinSize()` in the constructor; this plan stays consistent.

### `setMinSize()` is the floor; it is **not** a user-resize affordance

"Must not be user-resizable" and "must not be compressed below a minimum" are two different mechanisms, and `TextArea` (ITEM B) needs *both*. None of these components expose a drag-to-resize handle *except* `TextArea`, whose resizability comes entirely from the CSS `resize` property (the browser's native `<textarea>` corner grip) — so ITEM B removes that CSS property *and* adds the 100×100 min-size floor. All four items get the min-size floor; only `TextArea` additionally drops the resize affordance. There is no framework-level user-resize handle to disable.

### ITEM B removes the `resize` option rather than pinning it to `"none"`

`TextArea` currently defaults `resize: "none"` ([`TextArea.ts:32`](../src/typescript/lib/component/input/TextArea.ts#L32)) but still exposes `resize` in `TextAreaOptions` plus `getResize`/`setResize`/`clearResize` — a caller can re-enable dragging with `new TextArea("", { resize: "both" })`. The requirement is that it must *never* be user-resizable, so the option and its three accessors are removed and `resize: "none"` is hard-written once in `applyStyle`/defaults as an immutable style. This is a public-API removal (see Documentation Impact). Keeping the setter but ignoring non-`"none"` values was rejected: a dead setter that silently no-ops is worse than no setter.

### ITEM D: the legend truncates via a `max-width`, because `Legend extends Text` already has the ellipsis CSS but no width to clip against

`Legend` extends `Text` with `truncate: true` by default, so it already carries `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` ([`Text.ts:864`](../src/typescript/lib/component/input/Text.ts#L864)). The reason the legend still spills is that it is `position: static` ([`Legend.ts:36`](../src/typescript/lib/component/container/Legend.ts#L36)) and is appended *outside* the framework layout tree in `FieldSet.render()` ([`FieldSet.ts:127`](../src/typescript/lib/component/container/FieldSet.ts#L127)), so nothing ever constrains its width — `text-overflow: ellipsis` has no narrower box to clip into. The fix is to give the legend a `max-width` so the ellipsis engages. Anchoring it to `100%` of the fieldset content box (`max-width: calc(100% - <chrome>)`) is brittle because the legend sits in the border notch, not the content box; instead the `FieldSet` sets the legend's `max-width` in pixels from its own current inner width whenever the title changes / the fieldset lays out. Rejected the simpler static `max-width: 100%`: a static-positioned legend's `%` resolves against the fieldset's *content* width minus padding, which on a 100px-min fieldset still over-runs the rounded border corners. A measured pixel clamp tied to the fieldset's laid-out width is exact. (See Potential Challenges for the timing seam.)

### The `getPreferredSize`-ignores-minSize-only-children quirk does not bite these four

`HBox.getPreferredSize()` only sums children that return a non-null `getPreferredSize()` ([`HBox.ts:179`](../src/typescript/lib/layout/HBox.ts#L179)); a child carrying only a `setMinSize` (no `preferredSize`) is skipped, so its width under-reports. This is why this plan keeps each component's existing `preferredSize` default intact and *adds* the min alongside it:

- `TextArea`, `AbstractCustomList`, `FieldSet` all already declare `preferredSize: {200,200}` in their default bags, so they report a preferred size and the quirk never applies.
- `Table` has **no** `preferredSize` default — its `getPreferredSize()` falls through to the Table layout manager, which returns the base `_defaultPreferredSize` (null). On `ComplexUIPanel` the tables are direct children of the **top-level `VBox({stretching})`**, not of an `HBox`, so the horizontal quirk is irrelevant; `VBox(stretching)` stretches them to full width and the new `setMinSize(100,100)` provides the height/width floor. **No `preferredSize` is added to `Table`** — that would be scope creep and risks changing layout elsewhere. The quirk is called out here only to confirm it was checked and does not affect the verification screen.

### No theme tokens, no convention violations

The four minimums (100px, 100×100) are intrinsic usability floors, not themeable design tokens — they match the existing literal `setMinSize` constants (`16`, `18`, `STATUS_BAR_HEIGHT`) that are likewise not tokenised. No CSS custom property is introduced, so no `Theme.ts` entry is required. No typed-setter / `XOptions` field is added (the only new state is `FieldSet`'s private legend-clamp, applied as a direct style write with no public surface). ITEM B *removes* public surface rather than adding it. No convention violation.

---

## Public API (TypeScript Signatures)

### `TextArea` — removed surface (ITEM B)

```typescript
// REMOVED from TextAreaOptions:
//   resize?: string;
// REMOVED methods:
//   getResize(): string | null
//   setResize(value: string): this
//   clearResize(): this
// REMOVED from applyOptions: the `opts.resize` dispatch branch.
```

`resize: "none"` stays in `_defaultTextAreaOptions` is **not** kept — instead the non-resizability is written as a fixed inline style at render so it cannot be overridden. The `<textarea>` ends with `resize: none` permanently and no API to change it.

No other public signatures change. ITEMs A/C/D are internal constructor / render additions.

---

## Ordered Implementation Steps

1. **ITEM A — `Table.ts` constructor.** In [`Table.ts:104`](../src/typescript/lib/component/table/Table.ts#L104), after the existing `this.setOverflow("hidden")` line in the constructor, add `this.setMinSize(100, 100);`. Do not add a `preferredSize`.

2. **ITEM B — `TextArea.ts` min-size + remove resize API.**
   - In the constructor ([`TextArea.ts:44`](../src/typescript/lib/component/input/TextArea.ts#L44)), after `super(...)`, add `this.setMinSize(100, 100);`. Safely below the existing `preferredSize: {200,200}` ([`TextArea.ts:29`](../src/typescript/lib/component/input/TextArea.ts#L29)), so it changes nothing at the default size and never feeds the `getPreferredSize`-ignores-minSize quirk.
   - Remove `resize?: string;` from `TextAreaOptions` ([`TextArea.ts:17`](../src/typescript/lib/component/input/TextArea.ts#L17)).
   - Remove `resize: "none"` from `_defaultTextAreaOptions` ([`TextArea.ts:32`](../src/typescript/lib/component/input/TextArea.ts#L32)).
   - Remove the `if (opts.resize !== undefined) { this.setResize(opts.resize); }` branch from `applyOptions`.
   - Remove `getResize`, `setResize`, `clearResize`.
   - Add a fixed style so the textarea is permanently non-resizable. Write `resize: none` once, immutably — set it in the constructor via `this.setElementStyle("resize", "none")` (cached and replayed by `applyStyle` like other inline styles), or, if the inline style is not replayed for this component, in `init()`/`render()` alongside the existing `rows`/`cols`/`wrap` attribute writes. Confirm against the framework's style-replay seam (`applyStyle` replays cached private fields) before choosing the seam — see Potential Challenges.

3. **ITEM C — `AbstractCustomList.ts` constructor.** In [`AbstractCustomList.ts:446`](../src/typescript/lib/component/list/AbstractCustomList.ts#L446), after the inner-panel wiring (after `this.addComponent(this._innerPanel);`), add `this.setMinSize(100, 100);`. The 100px width floor matches `Table` and `FieldSet`: a list narrower than 100px is as unusable as one shorter than 100px. It is safely below the existing `preferredSize.width: 200` ([`AbstractCustomList.ts:80`](../src/typescript/lib/component/list/AbstractCustomList.ts#L80)), so it changes nothing at the default size and never feeds the `getPreferredSize`-ignores-minSize quirk (the List declares a `preferredSize`, so it is immune regardless). This does **not** collide with the sibling `split-layout-selection-shift` plan: that plan fixes border/box-sizing *measurement correctness* (a scrollbar-gutter / `_borderWidths`-cache seam), not a width floor — a `setMinSize` floor is an orthogonal layout concern. Still **do not** touch the list's border/box-sizing/width box-model here; that remains the sibling plan's territory. Placing the floor on the abstract base covers both `List` and `MultiSelectList` in one edit.

4. **ITEM D — `FieldSet.ts` min-size + legend clamp.**
   - In the constructor ([`FieldSet.ts:44`](../src/typescript/lib/component/container/FieldSet.ts#L44)), after `super(...)`, add `this.setMinSize(100, 100);`. Note: `getMinSize()` is already overridden ([`FieldSet.ts:96`](../src/typescript/lib/component/container/FieldSet.ts#L96)) to widen for the legend; the `setMinSize` floor flows through its `super.getMinSize()` call, so the override's `Math.max(baseMin.width, fieldsetW)` keeps the larger of the 100px floor and the legend-fit width. Verify the override still returns ≥100 height (it currently returns `baseMin.height`, which becomes 100). Confirm the legend-augmented width path does not *reduce* below 100.
   - Clamp the legend so its text ellipsises. Add a private method (e.g. `clampLegendWidth()`) that writes the legend's `max-width` from the fieldset's current inner width: `innerWidth = this.getWidth() - chromeW` (reuse the same `perim` + `padding` chrome math already in `getMinSize`). Call it from `setTitle()` and from a layout hook so the clamp tracks fieldset resizes (e.g. override `doLayout()` to call `super.doLayout()` then `clampLegendWidth()`, or hook the existing render/commit seam — pick whichever the framework already uses for post-layout DOM writes; see Potential Challenges). The legend already has `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` from `Text`'s `truncate:true`, so the `max-width` is the only missing piece. Guard against a null/zero width before the first layout (no-op when `getWidth()` returns 0).

5. **Type-check.** `npm run build` (or the project's `tsc` task) — expect zero errors. The removed `TextArea.resize` accessors must have no remaining call sites.

6. **Regression grep.** `grep -rn "\.setResize\|getResize\|resize:" src/typescript` — expect zero matches referencing `TextArea`'s resize option (CSS `resize:` literals elsewhere, e.g. splitters, are unrelated; eyeball the results).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/Table.ts` (ITEM A: `setMinSize(100,100)`) |
| Modify | `src/typescript/lib/component/input/TextArea.ts` (ITEM B: `setMinSize(100,100)`; remove `resize` option + accessors; pin `resize:none`) |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` (ITEM C: `setMinSize(0,100)`) |
| Modify | `src/typescript/lib/component/container/FieldSet.ts` (ITEM D: `setMinSize(100,100)` + legend `max-width` clamp) |

---

## Verification

Run the app and open `ComplexUIPanel` (the demo screen exercising all four). Manual checks:

1. **ITEM A — Table.** Panel 5 and Panel 6 tables (the latter has an empty store) render at ≥100×100 and are not crushed to a thin strip. Inspect the `<table>`'s computed `min-width`/`min-height` = `100px`.
2. **ITEM B — TextArea.** Panel 4's textarea renders at ≥100×100 (computed `min-width`/`min-height` = `100px`) and is not crushed when its parent shrinks. It shows **no** resize grip in its lower-right corner and cannot be drag-resized. Computed style `resize: none`. There is no `getResize`/`setResize` on the instance (TypeScript would already have failed the build if a call site survived).
3. **ITEM C — List / MultiSelectList.** Instantiate a `List` / `MultiSelectList` (not currently on `ComplexUIPanel` — add a throwaway one, or verify on the list demo screen if one exists) and confirm computed `min-width: 100px` and `min-height: 100px`; shrinking the parent never collapses it below 100×100. Confirm the border/box-sizing are untouched (owned by the sibling `split-layout-selection-shift` plan).
4. **ITEM D — FieldSet.** Set Panel 3's `FieldSet("Preferences")` title (or a test fieldset) to `"Hello World fieldset!"` and confirm the legend ellipsises *inside* the border notch instead of overflowing; the fieldset itself is ≥100×100.
5. **Type-check / build:** zero errors.
6. **Docs build (ITEM B is an API removal):** `npm run docs:build` — zero errors and zero link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).
7. **Theme toggle:** flip light/dark — no regression (no tokens added, so purely a smoke check).

---

## Documentation Impact

Only **ITEM B** is consumer-visible (a public-API removal). ITEMs A/C/D are internal constraint additions with no exported-symbol change.

- `TextArea` is re-exported from the input barrel `src/typescript/lib/component/input/index.ts`; the removal of `getResize`/`setResize`/`clearResize` and the `resize` option drops those members from the generated API page. No barrel entry changes (the class itself stays exported).
- Find and update any curated doc page under `docs/component/` that references `TextArea`'s `resize` option or accessors: `grep -rln 'resize' docs/ | xargs grep -l -i textarea`. Update prose and any code sample using `{ resize: ... }`.
- Regenerate API docs (`npm run docs:build`) and confirm no dangling `{@link}` / markdown links point at the removed members: `grep -rn 'setResize\|getResize\|clearResize' docs/` — expect zero.

---

## Potential Challenges

- **TextArea `resize:none` replay seam.** Inline styles set via `setElementStyle` may be wiped and replayed from private backing fields by `applyStyle` (the framework replays cached state). If `resize` is not among the replayed fields, a style-recompute could drop it. Mitigation: write it as a framework CSS-rule (`setElementCSSRule("resize", "none")`) which is part of the component's persistent rule set, or in `render()`/`init()` alongside the existing `rows`/`cols`/`wrap` writes; verify against `Component.applyStyle` before committing.
- **FieldSet legend clamp timing.** `clampLegendWidth()` reads `getWidth()`, which is `0` until the first layout pass — calling it from `setTitle()` during construction is a no-op (guarded). The clamp must therefore also fire post-layout. Mitigation: hook the same post-layout/commit seam the framework already uses for DOM writes (e.g. a `doLayout` override that calls `super.doLayout()` then clamps), and guard the zero-width case. Confirm `getWidth()` returns the committed width inside that seam (per the `commitBounds`-runs-`doLayout`-with-stale-DOM gotcha, a `doLayout` override may need `this.commitElementStyle()` before reading committed geometry).
- **FieldSet `getMinSize` interaction.** The existing override widens the min width for the legend; the new `setMinSize(100,100)` must not be *shadowed* by it. The override calls `super.getMinSize()` (which now returns ≥100) and `Math.max`es width against the legend fit, returning `baseMin.height` for height — so the 100px height floor is preserved. Re-read the override after editing to confirm height stays 100.

---

## Non-Goals

- **List/MultiSelectList border / box-model changes.** Owned by the sibling `split-layout-selection-shift` plan; this plan adds only a `setMinSize(100,100)` layout floor (orthogonal to the sibling's measurement fix). Editing the border/box-sizing/width *box-model* here would collide.
- **Making the minimums themeable.** They are intrinsic usability floors, consistent with the existing untokenised `setMinSize` literals; no `Theme.ts` token is introduced.
- **Adding a `preferredSize` to `Table`.** Out of scope and risks changing layout on other Table-hosting screens; the `setMinSize` floor is sufficient for the stated requirement.
- **A generic "non-resizable" flag on `Component`.** ITEM B is `TextArea`-specific (the only user-resize affordance is the CSS `resize` grip); no cross-component abstraction is warranted.

---

## Critical Files

- [`Component.ts:1640`](../src/typescript/lib/core/Component.ts#L1640) / [`:1685`](../src/typescript/lib/core/Component.ts#L1685) — `getMinSize` / `setMinSize`: the min-size contract every item builds on.
- [`TextArea.ts`](../src/typescript/lib/component/input/TextArea.ts) — ITEM B target; note the `resize` option, three accessors, and `applyOptions` branch all come out.
- [`FieldSet.ts:96`](../src/typescript/lib/component/container/FieldSet.ts#L96) — the existing `getMinSize` override the 100px floor must flow through; reuse its chrome math for the legend clamp.
- [`Legend.ts`](../src/typescript/lib/component/container/Legend.ts) + [`Text.ts:864`](../src/typescript/lib/component/input/Text.ts#L864) — `Legend extends Text` already has the ellipsis CSS (`truncate:true`); only a `max-width` is missing.
- [`AbstractCustomList.ts:446`](../src/typescript/lib/component/list/AbstractCustomList.ts#L446) — ITEM C base-class constructor; covers both `List` and `MultiSelectList`.
- Existing `setMinSize` call sites for the established pattern: [`ComboBox.ts:420`](../src/typescript/lib/component/input/ComboBox.ts#L420), [`StatusBar.ts:109`](../src/typescript/lib/component/container/StatusBar.ts#L109), [`SpinButton.ts:135`](../src/typescript/lib/component/input/SpinButton.ts#L135).
- [`ComplexUIPanel.ts`](../src/typescript/ComplexUIPanel.ts) — the verification screen.
