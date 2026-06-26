# Default Options as Pure Fallback — Implementation Plan

## Overview

`Component` carries two option bags. `_options` holds *explicit* state — what the caller passed or a setter wrote — and must start empty. `_defaultOptions` holds class-level fallbacks, layered with subclass defaults via the `subclassDefaults` constructor param at [Component.ts:372](../src/typescript/lib/core/Component.ts#L372). The bug: [`applyOptions`](../src/typescript/lib/core/Component.ts#L423) builds `const opts = { ...this._defaultOptions, ...options }` (line 424) and dispatches *that* merged bag to every setter, so class defaults get written **into** `_options` as a side effect. That pollutes the explicit-state bag and makes every `if (this._options.X === undefined)` "caller didn't supply X" guard unreliable. A second drifting copy of the same merge lives in [`applyStyle`](../src/typescript/lib/core/Component.ts#L3849) (`const opts = { ...this._defaultOptions, ...this._options }`), from which render reads fields directly — diverging from the getters (e.g. `getPadding()` returns `null` while the merge yields the `(0,0,0,0)` default).

The fix (design already decided): defaults become a **pure fallback, never dispatched**. Each pass-through getter owns its fallback (`return this._options.X ?? this._defaultOptions.X ?? null`); `applyStyle` reads through the getters; `applyOptions` / `applyChromeOptions` and the ~52 subclass overrides dispatch from **raw `options`**, not merged `opts`; the merged `opts` local in `applyStyle` is deleted once every field it served routes through a getter.

This work touches [`core/Component.ts`](../src/typescript/lib/core/Component.ts) (the base getters, `applyOptions`, `applyChromeOptions`, `applyStyle`, `getLayoutManager`/`setLayoutManager`) plus the 52 subclass files that build `{ ...this._defaultOptions, ...options }`. **`cursor` and `overflow` are already done** in the working tree as the reference prototype (see _Reference Pattern_) and the full 1186-test suite passes with them.

---

## Architecture Decisions

### Reference Pattern — cursor & overflow (DONE)

These two fields are already converted in the working tree and are the template every other field copies:

- **cursor**: [`getCursor()`](../src/typescript/lib/core/Component.ts#L1811) → `return this._options.cursor ?? this._defaultOptions.cursor ?? null`; `applyStyle` reads `this.getCursor()` (line 3872); `applyOptions` dispatches raw `options.cursor` (line 440).
- **overflow**: [`getOverflowX()`](../src/typescript/lib/core/Component.ts#L3147) / [`getOverflowY()`](../src/typescript/lib/core/Component.ts#L3192) fall back to `this._defaultOptions.overflow`; [`getOverflow()`](../src/typescript/lib/core/Component.ts#L3112) composes the two; `applyStyle` (lines 3928–3935), `refreshWheelScrolling` (line 3251), and `onWheelScroll` (line 3324) read via the getters; `applyStyle` now **calls `this.refreshWheelScrolling()`** at render (line 3941) so a default-scrollable component (Drawer's `overflow: "auto"` default) attaches its eased wheel-scroll controller without any setter firing (idempotent — no-ops when the scroller already matches); `applyOptions` dispatches raw `options.overflow` (line 448). Note: `clearOverflowX/Y` now revert to the **default fallback** rather than CSS `visible`; they have no external callers, so this is safe — but every per-field clearer must be re-checked for the same shift as the rollout reaches it.

The contract these prove — clean bag, getter fallback, explicit-equal-to-default still honored (by key presence — no clear-on-default rule, no sentinel), side effects fire at the effective value, default side effect (wheel scroller) materialized at render — is what every remaining field must satisfy.

### Each getter owns the fallback; `applyStyle` reads getters

The single source of truth for "what value reaches the DOM when no setter fired" is the getter. `applyStyle` must not re-derive it. Group-A getters that already short-circuit to `null` (e.g. `getPadding`) gain `?? this._defaultOptions.X`; getters that legitimately have **no** default (`getForegroundColor`, `getBackgroundColor`, `getBackgroundImage`, `isVisible`) keep `?? null` and are merely *read via the getter* in `applyStyle`. `isDisplayed` and `getInsets` already fall back correctly — only their `applyStyle` read sites change.

### Private-field fields need an explicit fallback (border, outline)

`border` and `outline` are stored in private fields (`_border`, `_outline`), not in `_options`, and `applyStyle` reads the field directly. Under raw dispatch the default never reaches the field, so the default is **lost** unless the getter folds in `_defaultOptions` and `applyStyle` reads the getter. This mirrors the overflow private-field pattern (`_overflowX ?? _defaultOptions.overflow`). `outline` additionally has **no `applyStyle` handling at all** today — only `setOutline` materializes it — so a render block must be added.

### layoutManager: lazy attach the default exactly once

[`getLayoutManager()`](../src/typescript/lib/core/Component.ts#L4358) already falls back to `_defaultOptions.layoutManager` (the per-instance `new Absolute()` seeded at construction). The side effect lives in [`setLayoutManager()`](../src/typescript/lib/core/Component.ts#L4367): it calls `layoutManager.attach(this)`, which sets the manager's `_container` ([LayoutManager.ts:64](../src/typescript/lib/layout/LayoutManager.ts#L64)). Subclass `doLayout`/`getMinSize`/`getMaxSize`/`getPreferredSize` read the container back via `getContainer()`. Today the default is attached only because `applyOptions` dispatches the *merged* `opts.layoutManager`. Under raw dispatch (caller omits `layoutManager`), `setLayoutManager` never fires and the default `Absolute` is **never attached** → `getContainer()` is `null` → layout breaks.

**Decision: lazy attach in `getLayoutManager()`** — the first time it resolves the fallback, attach it. This is the cleanest seam: it is the one funnel every consumer already goes through, it fires exactly once (guarded by `getContainer() === null`), and it keeps `setLayoutManager`'s detach/attach swap logic untouched for the explicit path.

```ts
getLayoutManager(): LayoutManager {
    const lm = (this._options.layoutManager ?? this._defaultOptions.layoutManager) as LayoutManager;
    if (lm && lm.getContainer() !== this) {
        lm.attach(this);
    }
    return lm;
}
```

`attach` is idempotent (a plain `_container = this` assignment), so the guard could be dropped, but the `!== this` check avoids redundant calls and documents intent. The explicit `setLayoutManager` still owns the `data-layout` attribute write and the detach of a previously-set manager; the lazy path is only for the never-explicitly-set default, whose `data-layout` is already correct for `Absolute` if needed (verify no test asserts `data-layout` on a default-layout component before relying on this; if one does, also write the attribute in the lazy branch).

### Carve-out: minSize / maxSize / preferredSize stay inline, NOT via getter

[`getMaxSize()`](../src/typescript/lib/core/Component.ts#L2307), [`getMinSize()`](../src/typescript/lib/core/Component.ts#L2234), and [`getPreferredSize()`](../src/typescript/lib/core/Component.ts#L2145) are **computed virtual** accessors: the base folds in `getLayoutManager().getMinSize()/getMaxSize()/getPreferredSize()`, and subclasses (Image, Text, Button) override `getMinSize`/`getPreferredSize` to compute from content. `applyStyle` must write the raw author **constraint** (the stored option), not the computed size. Routing the CSS `min-*`/`max-*` writes through these getters would push computed/layout-derived sizes into CSS `min-width`/`max-width`, where they fight the JS layout engine, add per-render layout cost, and risk re-entrancy (`getPreferredSize` → `Grid.measureContent` → children's `getPreferredSize`).

Therefore `applyStyle` reads these three **inline** as `this._options.X ?? this._defaultOptions.X` — exactly the form already used internally at [Component.ts:2169–2170](../src/typescript/lib/core/Component.ts#L2169), [2235](../src/typescript/lib/core/Component.ts#L2235), [2308](../src/typescript/lib/core/Component.ts#L2308) and in `setSize`/`clamp` at [2739/2744](../src/typescript/lib/core/Component.ts#L2739). `applyOptions` already special-cases `minSize` with raw `options.minSize` ([line 442](../src/typescript/lib/core/Component.ts#L442)) — that is the model; `maxSize` and `preferredSize` switch to the same raw form.

### Guard-∩-default fields become honest (deliberate behavior change)

Four fields combine a `_defaultOptions` default with a `if (this._options.X === undefined)` (or `this._options.X !== undefined`) guard that silently **never fired** before, because the merged-`opts` stash always populated `_options.X`. Switching those stashes to raw `options.X` makes the guard honest. These are intended behavior changes to confirm field-by-field:

- **gap** — IconLabel ([IconLabel.ts:98,116](../src/typescript/lib/component/display/IconLabel.ts#L98)) and IconText ([IconText.ts:81,105](../src/typescript/lib/component/display/IconText.ts#L81)). **Hazard:** both constructors also seed an HBox from `this._options.gap` *after* `super()` ([IconLabel.ts:76](../src/typescript/lib/component/display/IconLabel.ts#L76)); with raw dispatch `_options.gap` is `undefined` when the caller omits it, so the default `2` is lost. The constructor read must become `this._options.gap ?? this._defaultOptions.gap`.
- **orientation** — Slider ([Slider.ts:129,172](../src/typescript/lib/component/input/Slider.ts#L129)) and any other `_options.orientation`-guarded subclass; ToolBar/Rail/SplitGutter use `opts.orientation`-gated dispatch (mechanical) but their guards are on `options?.`/private fields, not `_options.orientation`, so verify each.
- **textAlign** — Glyph ([Glyph.ts:266](../src/typescript/lib/component/display/Glyph.ts#L266)).
- **preferredSize** — Header ([Header.ts:84](../src/typescript/lib/component/display/Header.ts#L84)).

### Subclass override sweep dispatches from raw `options`

The ~52 subclass `applyOptions`/`applyChromeOptions` overrides that build `{ ...this._defaultOptions, ...options }` switch their **dispatch** lines to raw `options`. Caveats found while reading:

- Some build `opts` to **read a derived/forwarded value** or **stash** a field into `_options` (e.g. `AbstractInput` stashes `enabled`/`readOnly` at [AbstractInput.ts:238–239](../src/typescript/lib/component/input/AbstractInput.ts#L238); the IconLabel/IconText constructor HBox seed above). Switching the dispatch is correct, but the **stash** of a default into `_options` must also go away (use raw `options.X`) **and** the field's getter must already fall back to `_defaultOptions.X`, or the default is lost. Inspect each `this._options.X = opts.X` line, not just `setX(opts.X)` lines.
- **ToolBar's `overflow` is NOT Component's CSS overflow** — it is a `"clip" | "menu"` strategy ([ToolBar.ts:35](../src/typescript/lib/component/menubar/ToolBar.ts#L35)) with a fully overridden `setOverflow` writing `_overflowMode`. The audit's "overflow 2 (ToolBar clip / Drawer auto)" conflates them. ToolBar's sweep is a plain `opts.overflow → options.overflow` dispatch change; it does not touch the CSS-overflow getters.
- **AnimatedDropdown's `translatePx`** ([AnimatedDropdown.ts:142,205](../src/typescript/lib/core/AnimatedDropdown.ts#L142)) does **not** rely on Component default-dispatch: its `getTranslatePx()` falls back to `DEFAULT_TRANSLATE_PX` and the animation builders read `options?.translatePx ?? DEFAULT_TRANSLATE_PX`. The dispatch line switches to raw `options.translatePx`; no further change. Verify only.

### No null/undefined sentinel; explicit-equal-to-default preserved for free

An explicit value equal to the default is honored as explicit purely by **key presence** in `_options` — the setter writes the key, the getter returns it before consulting `_defaultOptions`. No clear-on-default rule, no sentinel, no special type.

---

## Internal Structure

`applyStyle` after the rollout (illustrative — the merged `opts` local is gone, every read is a getter or an inline carve-out):

```ts
const cursor = this.getCursor();        if (cursor) this._styleRule.set("cursor", cursor);
const fg = this.getForegroundColor();   if (fg) this._styleRule.set("color", fg);
const bg = this.getBackgroundColor();   if (bg) this._styleRule.set("backgroundColor", bg);
// visible / displayed via isVisible() / isDisplayed()
const border = this.getBorder();
if (border) this._styleRule.setMany(borderToStyle(border)); else this._styleRule.set("border", null);
const outline = this.getOutline();      if (outline) this._styleRule.set("outline", outline);  // NEW block
const padding = this.getPadding();       if (padding) this._styleRule.set("padding", padding.render());
const insets = this.getInsets();        this.setDataAttribute("insets", insets.render());
// CARVE-OUT — inline, never via the virtual getters:
const minSize = this._options.minSize ?? this._defaultOptions.minSize;
const maxSize = this._options.maxSize ?? this._defaultOptions.maxSize;
// (preferredSize is not written to CSS in applyStyle today — confirm and leave as-is)
```

`getOutline()` / `getBorder()` gain the fallback:

```ts
getBorder(): BorderOptions | null { return this._border ?? this._defaultOptions.border ?? null; }
getOutline(): string | null       { return this._outline ?? this._defaultOptions.outline ?? null; }
```

---

## Ordered Implementation Steps

Each numbered step leaves the suite green; run `npm test` at the marked checkpoints.

1. **Group-A simple fields — getter fallback + `applyStyle`-via-getter + raw dispatch.** In [`Component.ts`](../src/typescript/lib/core/Component.ts): for `visible, displayed, foregroundColor, backgroundColor, backgroundImage, borderRadius, shadow, padding, insets, zIndex, pointerEvents, writingMode` —
   - Add `?? this._defaultOptions.X` to the getter where it short-circuits to `null` (`getPadding`, `getBorderRadius`, `getShadow`, `getPointerEvents`, `getWritingMode`); **leave** `getForegroundColor`/`getBackgroundColor`/`getBackgroundImage`/`isVisible` as `?? null` (no default). `isDisplayed` and `getInsets` already fall back.
   - For `zIndex` there is **no getter** today and `applyStyle` reads `opts.zIndex`. Add a `getZIndex(): number` returning `this._options.zIndex ?? this._defaultOptions.zIndex ?? 0`, or read inline `this._options.zIndex ?? this._defaultOptions.zIndex`. (Default is `0`, which `applyStyle`'s `if (opts.zIndex)` already skips — preserve that no-write behavior.)
   - Switch each field's `applyStyle` read from `opts.X` to the getter (or inline fallback for zIndex).
   - Switch each field's `applyOptions`/`applyChromeOptions` dispatch from `opts.X` to raw `options.X`.
   - **Checkpoint:** `npm test` (1186 green).

2. **Private-field fields: border, then outline.**
   - `border`: add `?? this._defaultOptions.border ?? null` to [`getBorder()`](../src/typescript/lib/core/Component.ts#L1763); change `applyStyle`'s `if (this._border)` block (lines 3947–3951) to read `const border = this.getBorder()`; switch `applyChromeOptions`'s `setBorder(opts.border)` (line 504) to raw `options.border`.
   - `outline`: add `?? this._defaultOptions.outline ?? null` to [`getOutline()`](../src/typescript/lib/core/Component.ts#L1974); **add a new `applyStyle` block** writing `outline` from `this.getOutline()` (via `setElementCSSRule`-equivalent on the style rule — match how `setOutline` writes `outline`); switch `applyOptions`'s `setOutline(opts.outline)` (line 439) to raw `options.outline`. Confirm `getBorder`/`getOutline` have **no in-tree null/undefined comparison call sites** (grep below — prototype found none for overflow; this plan's grep found none for border/outline either).
   - **Checkpoint:** `npm test`.

3. **layoutManager lazy attach.** Implement the `getLayoutManager()` lazy-attach guard from _Architecture Decisions_; switch `applyOptions`'s `setLayoutManager(opts.layoutManager)` (line 428) to raw `options.layoutManager`. Verify no test asserts `data-layout` on a default-layout (never-`setLayoutManager`'d) component; if one does, write the attribute in the lazy branch too.
   - **Checkpoint:** `npm test` — pay attention to any "no layout manager / getContainer null" failures.

4. **Carve-out: maxSize, preferredSize (minSize already raw).** In `applyStyle` read `minSize`/`maxSize` inline as `this._options.X ?? this._defaultOptions.X` (lines 3915, 3921); in `applyOptions` switch `setMaxSize(opts.maxSize…)` (line 443) and `setPreferredSize(opts.preferredSize…)` (line 441) to raw `options.maxSize`/`options.preferredSize`. Do **not** route through `getMinSize`/`getMaxSize`/`getPreferredSize`.
   - **Checkpoint:** `npm test`.

5. **Delete the merged `opts` local in `applyStyle`.** Remove `const opts = { ...this._defaultOptions, ...this._options }` (line 3849) once every reader above is converted. Grep to confirm no stragglers reference `opts.` inside `applyStyle`.
   - **Checkpoint:** `grep -n "opts\." src/typescript/lib/core/Component.ts` inside the `applyStyle` body → expect zero; `npm test`.

6. **Sweep the ~52 subclass override dispatch sites, class-by-class.** For each file from the grep below, change `setX(opts.X)` / `this._options.X = opts.X` dispatch lines to raw `options.X`. Per-class cautions:
   - IconLabel/IconText: also fix the constructor HBox seed to `this._options.gap ?? this._defaultOptions.gap`.
   - AbstractInput-style stashes (`this._options.enabled = opts.enabled`): switch to raw and confirm the field's getter falls back to `_defaultOptions`.
   - ToolBar: plain `opts.overflow → options.overflow` (own concept, not CSS overflow).
   - AnimatedDropdown: `opts.translatePx → options.translatePx`, verify-only.
   - Component.ts's own `applyOptions` merge at line 424 is the **last** one removed (or kept harmless if every dispatch already reads `options.X`; prefer deleting it once nothing reads `opts.`).
   - Run `npm test` after each handful of files, not just at the end.
   - **Checkpoint after sweep:** `grep -rn "this._defaultOptions, \.\.\.options" src/typescript/lib` → expect zero (or only documented derived-value readers, if any survive — there should be none).

7. **Verify guard-∩-default behavior changes** (step 6 already touches these files): construct each of IconLabel (gap), Slider (orientation), Glyph (textAlign), Header (preferredSize) with and without the field and confirm the guard now fires only for explicit values and the default still reaches the effect. Capture as tests (see _Expected Behaviour_).

8. **Regression tests** in `tests/component/Component.test.ts` (and per-subclass where guard behavior changed). Harness: `import { Component } from '~/core/Component'`, construct, cast to `any` for privates, `getElement(true)` to force render.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (getters, `applyOptions`, `applyChromeOptions`, `applyStyle`, `getLayoutManager`) |
| Modify | `src/typescript/lib/component/display/IconLabel.ts`, `IconText.ts` (gap dispatch + constructor seed) |
| Modify | `src/typescript/lib/component/input/Slider.ts` (orientation), `display/Glyph.ts` (textAlign), `display/Header.ts` (preferredSize) |
| Modify | The remaining ~47 subclass files from the grep (dispatch lines only) |
| Modify | `tests/component/Component.test.ts` (+ per-subclass guard tests) |

Full subclass list (52 files, 54 occurrences; FieldSet and Component have 2 each):
`button/{Button,SplitButton,ToggleButton}`, `container/{AccordionIndicator,CollapseButton,FieldSet,MenuItem,Spacer,SplitGutter,StatusBar,WindowHeader}`, `display/{Glyph,Header,IconLabel,IconText,PaginationBar,ProgressBar,ProgressSpinner}`, `input/{AbstractCalendarDropdown,AbstractInput,AbstractPickerField,AutoCompleteField,Checkbox,ComboBox,DateField,DateTimeField,DateTimePickerDropdown,FileDropZone,FileField,NumberSpinner,RadioButton,Slider,Text,TextArea,TextInput,TimeField,Toggle}`, `list/{AbstractCustomList,AbstractListComponent,List,ListItem,MultiSelectList}`, `menubar/ToolBar`, `table/cell/SortPriorityBadge`, `core/{AnimatedDropdown,Component,Panel}`, `overlay/{AbstractWindow,Drawer,Popover,Rail,RailHandle}`.

---

## Expected Behaviour

Derived from the contract, not current output. **(U)** = offline-unit-testable via the `getElement(true)` + cast-to-`any` harness; **(M)** = manual smoke needed (events/visual the offline DOM can't exercise).

1. **Clean bag for defaults (U).** A bare `new Component({})` has `(_options as any).cursor === undefined`, `.padding === undefined`, `.insets === undefined`, `.maxSize === undefined`, `.zIndex === undefined`, etc.; private fields `_border`/`_outline` are `null`. No default was dispatched into `_options`.
2. **Getter fallback (U).** On that bare component: `getCursor() === "default"`, `getPadding()` returns the `(0,0,0,0)` default Insets, `getInsets()` returns `(0,0,0,0)`, `getOverflowX()/getOverflowY() === "hidden"`, `getBorder()` and `getOutline()` return `null` (no base default) but a subclass with a border/outline default returns it, `isDisplayed() === true`.
3. **Explicit-equal-to-default honored (U).** `new Component({ cursor: "default" })` has `(_options as any).cursor === "default"` (key present) while `getCursor()` still returns `"default"`; setting a value equal to the default keeps the key in `_options`.
4. **Side effect at the effective value (U/M).** A subclass whose default is `overflow: "auto"` (Drawer) attaches the eased wheel-scroll controller at render with no setter call: after `getElement(true)`, `(component as any)._wheelScroller` is non-null **(U)**; the actual eased wheel scroll is **(M)**.
5. **Border/outline default materialized at render (U).** A subclass defaulting `border`/`outline` (e.g. TextInput `outline:"none"`, PickerInput `border:"none"`/`outline:"none"`) emits the corresponding style on its style rule after `getElement(true)`, even though the caller passed nothing and `_border`/`_outline` are `null`.
6. **layoutManager default attached exactly once (U).** `new Component({}).getLayoutManager().getContainer()` is the component; calling `getLayoutManager()` repeatedly does not re-detach/re-attach (container identity stable); `doLayout()` on a default-layout component does not throw.
7. **min/max/preferred emit the raw constraint, not the computed size (U).** With a layout manager that reports a non-trivial `getMinSize`, `applyStyle` writes CSS `min-width`/`min-height` from the **author** option (default `0` → no write for the falsy default), not from `getMinSize()`'s folded value; `getMinSize()` still folds the layout minimum for layout consumers.
8. **Guard-∩-default now honest (U).** `new IconLabel({})` (default gap 2) seeds its HBox spacing to 2 and `(_options as any).gap === undefined`; `new IconLabel({ gap: 6 })` has `_options.gap === 6` and HBox spacing 6. Slider orientation / Glyph textAlign / Header preferredSize: the guarded branch fires only when the field is explicitly passed; the default still drives the effect via the getter/constructor-seed fallback.
9. **No regression to merged-bag pollution (U).** After construction with several explicit fields, `_options` contains exactly those keys and no default keys.

---

## Verification

- **`npm run typecheck`** — clean except the pre-existing unrelated `@types/node` and `dist/Fit.d.ts` errors, which persist and are not introduced here.
- **`npm test`** — currently 1186 passing; must stay green at every checkpoint and after the full rollout. New tests in `tests/component/` cover Expected Behaviour items 1–3, 5–9 (offline) plus item 4's `_wheelScroller`-attached assertion.
- **Grep invariants:**
  - `grep -rn "this._defaultOptions, \.\.\.options" src/typescript/lib` → **0** after step 6.
  - Inside `applyStyle`, `grep` for `opts\.` → **0** after step 5.
  - `grep -rn "getBorder()\|getOutline()\|getOverflowX()\|getOverflowY()" src/typescript/lib | grep -E "=== ?null|!== ?null|=== ?undefined"` → **0** (no caller conflates "unset" with "default").
- **Manual smoke (M):**
  - Scrolling — a **Drawer** and an `autoScroll` **Panel** must wheel-scroll smoothly with no setter firing (default-attached controller).
  - Chrome — **inputs/buttons** must show their default `border`/`outline` (e.g. TextInput/PickerInput `outline:"none"`, focus ring behavior) and IconLabel/IconText spacing must match pre-change.
  - Toggle theme to confirm border re-measure still works.

---

## Potential Challenges

- **layoutManager lazy attach + `data-layout` attribute.** A default-layout component never ran `setLayoutManager`, so its `data-layout` attribute is unset; mitigate by writing it in the lazy branch only if a test/feature reads it (grep `data-layout` first).
- **Subclass stashes that copy a default into `_options`** (AbstractInput `enabled`/`readOnly`, IconLabel/IconText gap seed). Mitigate per-class: switch to raw `options.X` and ensure the field's getter falls back, or the default is silently dropped — caught by item-8 tests.
- **ToolBar overflow name collision** with CSS overflow. Mitigate: treat as an unrelated field; only the dispatch literal changes.
- **The 54-line sweep is large and mechanical.** Mitigate by running `npm test` after each handful of files (step 6) so a regression is localized to the last batch.
- **`getPreferredSize` is not written to CSS in `applyStyle`** today (only `min`/`max` are). Confirm before adding any preferredSize carve-out write — likely the only change is the `applyOptions` raw dispatch.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `applyOptions` (~423), `applyChromeOptions` (~503), `applyStyle` (~3835), `getLayoutManager`/`setLayoutManager` (~4358), `getCursor`/`getOverflowX/Y` (DONE reference), `getBorder`/`getOutline`/`getPadding`/`getInsets`/`isDisplayed`/`isVisible`, `getMinSize`/`getMaxSize`/`getPreferredSize` (carve-out), the `_defaultOptions` seed (~372).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `attach`/`detach`/`getContainer` (~64) for the lazy-attach seam.
- [`src/typescript/lib/overlay/Drawer.ts`](../src/typescript/lib/overlay/Drawer.ts) — `overflow:"auto"` default (default-scrollable smoke target).
- [`src/typescript/lib/component/input/TextInput.ts`](../src/typescript/lib/component/input/TextInput.ts), [`PickerInput.ts`](../src/typescript/lib/component/input/PickerInput.ts) — `outline`/`border` default materialization.
- [`src/typescript/lib/component/display/IconLabel.ts`](../src/typescript/lib/component/display/IconLabel.ts) / [`IconText.ts`](../src/typescript/lib/component/display/IconText.ts) — gap guard + constructor seed hazard.
- [`tests/component/Component.test.ts`](../tests/component/Component.test.ts) — the offline harness pattern to copy.

---

## Non-Goals

- **No clear-on-default rule, sentinel value, or new option type** — explicit-equal-to-default is preserved by key presence alone.
- **No change to the computed-size semantics** of `getMinSize`/`getMaxSize`/`getPreferredSize` — they keep folding in the layout manager; only their CSS-write sites are bypassed.
- **No refactor of subclass-specific (non-Component) defaults beyond the dispatch line** — except where a stash/seed of a default into `_options` would drop the default (gap, enabled/readOnly), which is in scope only to preserve current behavior.
- **No rework of ToolBar's `overflow` strategy or AnimatedDropdown's `translatePx` animation** — both are verified to not depend on Component default-dispatch.
