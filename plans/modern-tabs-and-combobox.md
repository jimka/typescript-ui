---
depends-on: [modern-theme-buttons-and-headers.md]
touches-shared:
  - src/typescript/lib/core/Theme.ts
  - src/typescript/lib/component/container/TabPanel.ts
  - src/typescript/lib/component/input/ComboBox.ts
---

# Modern Tabs & ComboBox Trigger — Implementation Plan

## Overview

This is the **second half** of the modern look-and-feel work. The sibling plan
[`modern-theme-buttons-and-headers.md`](modern-theme-buttons-and-headers.md)
registers the opt-in `"modern"` theme and its token block in
[`Theme.ts`](../src/typescript/lib/core/Theme.ts). This plan **extends** that
same modern block with new tokens — it does **not** re-register the theme.

Three cohesive features:

1. **Flat tab buttons + sliding selection indicator** — a single shared 2px blue
   bar under the active tab that transform-animates from the old tab to the new
   one on selection change. Lives in [`Tab.ts`](../src/typescript/lib/layout/Tab.ts),
   the layout manager that [`TabPanel`](../src/typescript/lib/component/container/TabPanel.ts:61)
   wraps.
2. **Tab max-width + full-width strip + edge-to-edge 1px under-border** — buttons
   capped at a max width while the strip (`_toolbar`) still spans the full
   container width, with a 1px gray rule under the whole strip. Exposed through
   typed options on `TabPanel`.
3. **ComboBox trigger arrow direction + animation** — the trigger glyph is a
   `Glyph("chevron-down")` owned by the inner `ComboBoxCaret` class
   ([`ComboBox.ts:422`](../src/typescript/lib/component/input/ComboBox.ts#L422)),
   positioned by `ComboBox.doLayout`; make it rotate on open/close on the **same
   timeframe as the dropdown fade**, sourced from the dropdown's
   [`getDurationMs()`](../src/typescript/lib/core/AnimatedDropdown.ts#L191)
   (default 120ms; there is no separate fade-in/out duration — `showAnimated` /
   `hideAnimated` both use `getDurationMs()`).

> **Assumption flagged:** at write time the sibling plan file
> `plans/modern-theme-buttons-and-headers.md` was not yet on disk. This plan
> declares the dependency in frontmatter and assumes the sibling registers the
> modern theme + its base token block; the tokens below are **additions** to
> that block. If the sibling has not landed when `/implement` runs this, create
> the modern block per the sibling's spec first.

---

## Architecture Decisions

### Single shared sliding indicator, not per-button borders

A per-button bottom-border cannot slide — each button owns its own box, so a
border swap is an instant jump. The standard pattern (Material tabs, MUI) is one
**shared indicator element** parented to the tab strip whose `left`/`width` are
driven by the active button's geometry and animated via a CSS `transition` on
`transform`/`width`. We add the indicator as a dedicated child `Component` of the
`Tab` manager's `_toolbar`
([`Tab.ts:98`](../src/typescript/lib/layout/Tab.ts#L98)), built in
`buildTabEntry` ([`Tab.ts:341`](../src/typescript/lib/layout/Tab.ts#L341)),
positioned absolutely
in `doLayout` to sit at the bottom edge of the active button. On selection change
the existing `doLayout` pass re-reads the active button's `getLeft()` /
`getWidth()` and writes the new `x`/`width`; the CSS transition does the slide.
**One element per class** is preserved — the indicator is its own `Component`,
not extra DOM grafted onto a button.

### Indicator is a sibling of the buttons, layered above the under-border

The 1px under-border (feature 2) and the 2px indicator (feature 1) must not
fight. The under-border belongs to the **strip** (`_toolbar`'s bottom border);
the indicator is an absolutely-positioned 2px bar whose bottom aligns with the
strip's bottom edge so it visually **overlays** the gray rule on the active tab.
`doLayout` sets the indicator `y = stripHeight - indicatorThickness` and
`z`-order above the border (it is a later child / higher stacking element).

### Max-width buttons + full-width strip via HBox tweak, not a new layout manager

`_toolbar` already uses `new HBox({ mode: "equal", spacing: 0 })`
([`Tab.ts:117`](../src/typescript/lib/layout/Tab.ts#L117)). `mode: "equal"`
stretches every button to an equal share of the strip — that already makes the
strip full-width, but it has **no max width**, so two tabs each take half the
viewport. We cap each button with `setMaxSize(maxWidth, …)` so HBox stops
growing a button past the cap; the leftover strip width past the summed capped
buttons stays empty (still full-width strip, buttons left-aligned). The 1px
under-border is the strip's own bottom border and therefore spans the full strip
width edge-to-edge regardless of how wide the buttons grow. No new layout
manager is needed.

### Customizable: `tabMaxWidth` + `tabUnderBorderFullWidth`, defaults on

Per the request, expose two typed options on `TabPanel` (forwarded to `Tab`):
`setTabMaxWidth(px)` and `setTabUnderBorderFullWidth(boolean)`. Defaults: max
width `null` (no cap — preserves today's equal-stretch behavior so existing
callers are unchanged) and under-border full-width `true`. The modern theme's
demo opts into a finite `tabMaxWidth` (recommend **200px**). Both follow the
typed-setter + cached `_field` + `XOptions`-field convention.

### ComboBox arrow: recommend down→up, document literal left→down

The request asks for **left when closed, down when open**. This is unusual:
the established convention (and what the rest of this library reads as — the
picker fields use a static glyph, this is the only rotating trigger) is **down
when closed, up when open** — the arrow points toward where the panel appears,
then flips to point back. Left-when-closed reads as "expand sideways," which the
dropdown does not do. The base glyph is already `chevron-down`
([`ComboBox.ts:422`](../src/typescript/lib/component/input/ComboBox.ts#L422)).
**Recommendation:** keep `chevron-down` and rotate **180°** on open (down → up),
driven by a CSS `transform: rotate()` on the caret glyph.

**If the user insists on literal left→down:** set the closed rotation to
`rotate(90deg)` (chevron-down pointing left) and the open rotation to
`rotate(0deg)` (back to down). The wiring is identical; only the two rotation
angles differ. Both variants animate over `getDurationMs()` (below).

### Rotation timed to the dropdown fade

`AnimatedDropdown` exposes a single
[`getDurationMs()`](../src/typescript/lib/core/AnimatedDropdown.ts#L191) (default
`DEFAULT_DURATION_MS` = 120) used by both `showAnimated` and `hideAnimated` —
there is no separate fade-in/out duration. The ComboBox owns `_dropdown`
(`ComboBoxDropdown extends AnimatedDropdown`,
[`ComboBox.ts:450`](../src/typescript/lib/component/input/ComboBox.ts#L450)) and
toggles it via `toggleDropdown()`
([`ComboBox.ts:647`](../src/typescript/lib/component/input/ComboBox.ts#L647)) /
`closeDropdown()`
([`#L670`](../src/typescript/lib/component/input/ComboBox.ts#L670)), wired from
the `"click"` listener at
[`#L508`](../src/typescript/lib/component/input/ComboBox.ts#L508). The open/close
state is read from `this._dropdown.isOpen()`
([`AnimatedDropdown.ts:339`](../src/typescript/lib/core/AnimatedDropdown.ts#L339)).
In both toggle paths, after the show/hide call, set the caret glyph's CSS
`transition: transform <getDurationMs()>ms ease` and apply the open/closed
rotation. Since `getDurationMs` is the one duration for both directions, the
arrow and the panel fade stay in lock-step even if the consumer retunes it via
`setDropdownAnimated` / a future duration setter.

---

## Public API (TypeScript Signatures)

### TabPanel ([`TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts))

```typescript
export interface TabPanelOptions extends PanelOptions {
    tabs?:                    TabEntryConfig[];
    onTabClose?:              (component: Component) => void;
    tabMaxWidth?:             number | null;   // NEW — px cap per button; null = no cap
    tabUnderBorderFullWidth?: boolean;          // NEW — strip rule spans full width
}

class TabPanel<TOptions extends TabPanelOptions = TabPanelOptions> extends Panel<TOptions> {
    setTabMaxWidth(px: number | null): this;            // forwards to Tab
    getTabMaxWidth(): number | null;
    setTabUnderBorderFullWidth(full: boolean): this;    // forwards to Tab
    isTabUnderBorderFullWidth(): boolean;
}
```

`TabPanel` forwards both to the wrapped manager via `getTabManager()`
([`TabPanel.ts:166`](../src/typescript/lib/component/container/TabPanel.ts#L166)),
and dispatches the two new options after `setLayoutManager(new Tab())` in the
constructor.

### Tab ([`Tab.ts`](../src/typescript/lib/layout/Tab.ts))

```typescript
export interface TabOptions extends LayoutManagerOptions {
    listeners?:               { tabclose?: (component: Component) => void };
    tabMaxWidth?:             number | null;   // NEW
    tabUnderBorderFullWidth?: boolean;          // NEW
}

class Tab extends LayoutManager {
    // NEW backing fields
    private _tabMaxWidth:             number | null   = null;
    private _underBorderFullWidth:    boolean         = true;
    private _indicator:               Component       = new Component();

    setTabMaxWidth(px: number | null): this;
    getTabMaxWidth(): number | null;
    setTabUnderBorderFullWidth(full: boolean): this;
    isTabUnderBorderFullWidth(): boolean;
}
```

`setTabMaxWidth` re-applies `setMaxSize` to each existing button and re-runs the
layout; `applyOptions` dispatches both after `super.applyOptions`
([`Tab.ts:79`](../src/typescript/lib/layout/Tab.ts#L79)).

### ComboBox ([`ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts))

No new public API. Internal change only: an open/close rotation on the
`ComboBoxCaret`'s glyph, keyed off `this._dropdown.isOpen()` inside
`toggleDropdown` / `closeDropdown`. To reach the caret's glyph from those
methods, add a private `setCaretOpen(open: boolean): void` helper on `ComboBox`
that the caret exposes its `Glyph` to (e.g. a `getGlyph()` accessor on
`ComboBoxCaret`, or store the glyph on a private field). Keep edits confined to
the caret/arrow so they stay distinct from
`binding-combobox-initial-selection.md`'s selection/display fix.

---

## Theme Tokens

Added to the **modern** block defined by the sibling plan (and to any
`themeToVars` mapping that block uses). These are modern-theme overrides of
defaults that already exist as inline fallbacks in `Tab.ts`.

| CSS Custom Property | Modern Value | Purpose |
|---|---|---|
| `--ts-ui-tab-indicator-color` | `#1a73e8` (blue) | Sliding active-tab indicator fill |
| `--ts-ui-tab-indicator-thickness` | `2px` | Indicator bar height |
| `--ts-ui-tab-toolbar-border` | `#d0d0d7` (gray) | Edge-to-edge 1px under-border (already referenced at [`Tab.ts:120`](../src/typescript/lib/layout/Tab.ts#L120)) |
| `--ts-ui-tab-toolbar-bg` | flat/transparent per modern block | Flat tab strip background (already referenced at [`Tab.ts:118`](../src/typescript/lib/layout/Tab.ts#L118)) |
| `--ts-ui-tab-button-bg` | flat/transparent per modern block | Flat (un-selected) tab button fill — defaults to gray `#b8b8c3` at [`Tab.ts:344`](../src/typescript/lib/layout/Tab.ts#L344) |

The thickness token is consumed both by the indicator element's height and by
the `doLayout` `y`-offset math so the two never drift.

---

## Internal Structure

**Indicator element.** Created once in the `Tab` constructor, added to
`_toolbar` after the buttons region is established. Styled via setters/tokens:

```typescript
this._indicator.setBackgroundColor("var(--ts-ui-tab-indicator-color, #1a73e8)");
this._indicator.setElementStyles({
    position:   "absolute",
    bottom:     "0",
    height:     "var(--ts-ui-tab-indicator-thickness, 2px)",
    transition: "transform 200ms ease, width 200ms ease",   // 200ms ~ TAB_FADE_DURATION_MS-scale; reuse a Tab.ts constant
});
```

**doLayout positioning.** After the buttons are laid out, read the active
button (index `_selectedTabIndex`) and write the indicator geometry. Buttons are
positioned by the strip's HBox, so their `getLeft()` / `getWidth()` are valid
post-layout:

```typescript
const active = this._tabs[this._selectedTabIndex]?.button;

if (active) {
    this._indicator.setElementStyles({
        transform: `translateX(${active.getLeft()}px)`,
        width:     `${active.getWidth()}px`,
    });
}
```

Using `transform: translateX` (not `left`) keeps the slide on the compositor.

**Flat buttons.** `buildTabEntry`
([`Tab.ts:341`](../src/typescript/lib/layout/Tab.ts#L341)) builds each tab as a
`ToggleButton` and already `clearBorder()` / `clearBorderRadius()` /
`clearShadow()`, but it sets a **gray fill**
`setBackgroundColor("var(--ts-ui-tab-button-bg, #b8b8c3)")`
([`Tab.ts:344`](../src/typescript/lib/layout/Tab.ts#L344)). "Flat" under the
modern block means overriding `--ts-ui-tab-button-bg` to transparent (and the
`ToggleButton` selected-state background, if any) so the sliding indicator is the
only selection affordance. No source change to `buildTabEntry` is needed for the
flat look — it is purely a token override.

**Max-width cap.** In `buildTabEntry`, after `this._toolbar.addComponent(button)`:

```typescript
if (this._tabMaxWidth != null) {
    button.setMaxSize(this._tabMaxWidth, button.getMaxSize()?.height ?? null);
}
```

**ComboBox rotation.** In `toggleDropdown`
([`ComboBox.ts:647`](../src/typescript/lib/component/input/ComboBox.ts#L647))
after the show branch, and in `closeDropdown`
([`#L670`](../src/typescript/lib/component/input/ComboBox.ts#L670)), call a
private helper that drives the caret glyph transform off the single dropdown
duration:

```typescript
private setCaretOpen(open: boolean): void {
    const glyph = this._caret.getGlyph();   // new accessor on ComboBoxCaret
    const ms    = this._dropdown.getDurationMs();

    glyph.setElementStyles({
        transition: `transform ${ms}ms ease`,
        transform:  open ? "rotate(180deg)" : "rotate(0deg)",   // down→up; closed 90 / open 0 for literal left→down
    });
}
```

The caret glyph is framework-absolute and centered in the 16×16 caret box, so a
`rotate()` about its own center reads correctly without re-layout. Apply
`will-change: transform` is unnecessary for a one-off 120ms rotation.

---

## Ordered Implementation Steps

1. **Theme tokens** — add the four modern-block entries above to the modern
   theme block in [`Theme.ts`](../src/typescript/lib/core/Theme.ts) (and its
   `themeToVars` mapping). → verify: `grep -n 'ts-ui-tab-indicator' src/typescript/lib/core/Theme.ts`.
2. **Tab options + fields** — add `tabMaxWidth` / `tabUnderBorderFullWidth` to
   `TabOptions`, the two backing fields, the four typed setters/getters, and
   `applyOptions` dispatch in [`Tab.ts`](../src/typescript/lib/layout/Tab.ts).
3. **Indicator element** — create `_indicator` in the `Tab` constructor, style
   via tokens, append to `_toolbar`.
4. **doLayout** — position the indicator from the active button's geometry; set
   `_toolbar`'s bottom border to honor `_underBorderFullWidth` (strip-wide rule).
5. **Max-width cap** — apply `setMaxSize` in `buildTabEntry` and re-apply across
   existing buttons in `setTabMaxWidth`.
6. **TabPanel forwarders** — add the two options to `TabPanelOptions`, the four
   forwarders, and constructor dispatch in
   [`TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts). Keep
   edits to styling/layout — distinct from `demo-phantom-tab-button.md`'s
   tab-creation fix.
7. **ComboBox glyph** — keep the base `chevron-down` glyph
   ([`ComboBox.ts:422`](../src/typescript/lib/component/input/ComboBox.ts#L422));
   add a `getGlyph()` accessor on `ComboBoxCaret`, a private `setCaretOpen`
   helper on `ComboBox`, and call it from `toggleDropdown` / `closeDropdown`
   ([`#L647`](../src/typescript/lib/component/input/ComboBox.ts#L647),
   [`#L670`](../src/typescript/lib/component/input/ComboBox.ts#L670)) timed to
   `_dropdown.getDurationMs()`. Keep edits to the caret/arrow — distinct from
   `binding-combobox-initial-selection.md`.
8. **Typecheck + docs** → `npx tsc --noEmit`; `npm run docs:build`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Theme.ts` (add to modern block) |
| Modify | `src/typescript/lib/layout/Tab.ts` (indicator, options, doLayout, max-width) |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` (option forwarders) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (arrow glyph + rotation) |

---

## Verification

- `npx tsc --noEmit` — clean.
- `grep -n 'ts-ui-tab-indicator' src/typescript/lib/core/Theme.ts` — non-empty.
- **Manual (modern theme on):** open the tab demo
  ([`TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts)); switch tabs and
  confirm the blue 2px bar **slides** between tabs and sits flush on the gray
  under-border; confirm buttons stop growing at `tabMaxWidth` while the gray rule
  runs edge-to-edge.
- **Manual:** open a `ComboBox`; confirm the arrow rotates in sync with the panel
  fade-in and reverses on close.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported
  TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

The new `TabPanel` setters are consumer-visible. Update the curated
`docs/component/` page covering `TabPanel` (and its catalog `index.md` if option
tables are listed). `TabPanel` is exported from
`src/typescript/lib/component/container/index.ts`. JSDoc the four new setters and
the two new option fields with `@param`/`@returns`. No cross-bucket `{@link}`
needs new markdown links — `Tab` and `TabPanel` are in the same doc group.

---

## Potential Challenges

- **Indicator geometry before first layout** — guard the `doLayout` write when
  `_tabs` is empty or the active button has zero width (pre-render); skip until a
  real layout pass.
- **Coordinating with `demo-phantom-tab-button.md`** — that plan touches tab
  *creation*; keep all edits here to styling/layout/options to avoid merge
  conflicts in `buildTabEntry`.
- **Dropdown duration availability** — `_dropdown` is constructed eagerly in the
  ComboBox constructor ([`ComboBox.ts:491`](../src/typescript/lib/component/input/ComboBox.ts#L491)),
  so `getDurationMs()` is always callable; no null-guard needed. When
  `dropdownAnimated: false`, the panel shows instantly — set the rotation
  duration to 0 in that case so the arrow snaps too (read `isAnimated()`).

---

## Critical Files

- [`Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `_toolbar` (HBox `equal`),
  `buildTabEntry`, `_selectedTabIndex`, `doLayout`.
- [`TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) —
  option dispatch + `getTabManager()` forwarder.
- [`ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) —
  `ComboBoxCaret` (the `chevron-down` glyph), `_caret`, `_dropdown`,
  `toggleDropdown`, `closeDropdown`, the `"click"` listener.
- [`AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts) —
  `getDurationMs` (single fade duration, default 120), `isOpen`.
- [`Theme.ts`](../src/typescript/lib/core/Theme.ts) — modern block (from sibling
  plan).

---

## Non-Goals

- No reordering, drag, or scrollable-overflow tab strip — out of scope.
- No change to the bare `Panel + Tab` wiring path; `TabPanel` stays the
  convenience entry point.
- No new public API on `ComboBox` — the arrow change is internal.
- Not re-registering the modern theme — that is the sibling plan's job.
