---
depends-on: [implemented/modern-theme-buttons-and-headers.md]
touches-shared:
  - src/typescript/lib/core/themes/ModernTheme.ts
  - src/typescript/lib/core/Theme.ts
  - src/typescript/lib/component/container/TabPanel.ts
  - src/typescript/lib/component/input/ComboBox.ts
---

# Modern Tabs & ComboBox Trigger — Implementation Plan

## Overview

This is the **second half** of the modern look-and-feel work. The sibling plan
[`implemented/modern-theme-buttons-and-headers.md`](implemented/modern-theme-buttons-and-headers.md)
**has landed**: the `ModernTheme` is registered and preselected, and its token
block now lives as an object literal in
[`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts), re-exported
from [`Theme.ts`](../src/typescript/lib/core/Theme.ts) and mapped to CSS custom
properties by the `themeToVars` function
([`Theme.ts:553`](../src/typescript/lib/core/Theme.ts#L553)). This plan **extends**
that modern block with new tokens — it does **not** re-register the theme.

The **flat tab buttons** half of feature 1 has also already landed (commit
`78816fe0`): `buildTabEntry` now routes the modern tab tokens through per-state
setters (normal / hover / selected) and `ModernTheme.ts` supplies the
`tab.button` block. The only remaining tab-styling work for feature 1 is the
**sliding selection indicator**.

Three cohesive features:

1. **Sliding selection indicator** — a single shared 2px blue bar under the
   active tab that transform-animates from the old tab to the new one on
   selection change. (Flat per-state tab-button theming is done; see above.)
   Lives in [`Tab.ts`](../src/typescript/lib/layout/Tab.ts), the layout manager
   that [`TabPanel`](../src/typescript/lib/component/container/TabPanel.ts:61)
   wraps.
2. **Tab max-width + full-width strip + edge-to-edge 1px under-border** — buttons
   capped at a max width while the strip (`_toolbar`) still spans the full
   container width, with a 1px gray rule under the whole strip. Exposed through
   typed options on `TabPanel`.
3. **ComboBox trigger arrow direction + animation** — the trigger glyph is a
   local `Glyph("chevron-down")` const inside the inner `ComboBoxCaret` class
   ([`ComboBox.ts:422`](../src/typescript/lib/component/input/ComboBox.ts#L422))
   with no `getGlyph()` accessor, positioned by `ComboBox.doLayout`
   ([`ComboBox.ts:598`](../src/typescript/lib/component/input/ComboBox.ts#L598));
   make it rotate on open/close on the **same timeframe as the dropdown fade**,
   sourced from the dropdown's
   [`getDurationMs()`](../src/typescript/lib/core/AnimatedDropdown.ts#L191)
   (default 120ms; there is no separate fade-in/out duration — `showAnimated` /
   `hideAnimated` both use `getDurationMs()`).

> **Note:** the sibling plan has landed. The modern token block now lives in
> [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts) as an
> object literal; the new tokens below are **additions** to that block plus its
> `themeToVars` mapping in `Theme.ts`.

---

## Architecture Decisions

### Single shared sliding indicator, not per-button borders

A per-button bottom-border cannot slide — each button owns its own box, so a
border swap is an instant jump. The standard pattern (Material tabs, MUI) is one
**shared indicator element** parented to the tab strip whose `left`/`width` are
driven by the active tab's geometry and animated via a CSS `transition` on
`transform`/`width`. The indicator is its own small `Component` subclass
(`TabIndicator`, modelled on `ComboBoxCaret` / `TabCloseButton`) so it can style
itself via the protected `setElementStyles` from the tokens — `Tab` is **not** a
`Component` subclass and cannot reach that protected setter on a bare `Component`.
It must **not** be added to `_toolbar` via `addComponent`: `_toolbar`'s
`HBox({ mode: "equal" })` ([`Tab.ts:117`](../src/typescript/lib/layout/Tab.ts#L117))
would lay it out as an extra flex tab cell and shrink the real buttons. Instead it
follows the exact pattern `_toolbar` itself uses — its element is **raw-appended**
into `_toolbar`'s element in `attach()`
([`Tab.ts:168`](../src/typescript/lib/layout/Tab.ts#L168)) and positioned manually
in `doLayout` ([`Tab.ts:620`](../src/typescript/lib/layout/Tab.ts#L620)) so no
layout manager sees it. Each tab is now a **wrapper**
`Component` (an HBox holding the `ToggleButton` plus an optional close button,
[`Tab.ts:377`](../src/typescript/lib/layout/Tab.ts#L377)) and it is the **wrapper**
that gets added to `_toolbar`
([`Tab.ts:421`](../src/typescript/lib/layout/Tab.ts#L421)). The indicator must
therefore read the active **wrapper's** `getX()` / `getWidth()` (exposed as
`entry.wrapper`), not the button's, so it spans the full tab cell including any
close button. On selection change the existing `doLayout` pass re-reads that
geometry and writes the new `x`/`width`; the CSS transition does the slide.
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

`_toolbar` uses `new HBox({ mode: "equal", spacing: 0 })`
([`Tab.ts:117`](../src/typescript/lib/layout/Tab.ts#L117)). `mode: "equal"` with
its default `stretching: true` places every tab at a full equal share via
`FillType.BOTH` and **ignores per-child `maxSize`** (the `maxSize` clamp in
`LayoutManager.resolveBounds` only runs on the non-`BOTH` fill branches) — so
`setMaxSize` alone cannot cap a tab in equal mode. The cap therefore switches the
toolbar to `mode: "preferred"` (keeping `stretching: true` for full-height tabs),
where each wrapper takes its content width **clamped to `maxSize.width`** and the
strip's leftover space stays empty (tabs left-aligned). `setTabMaxWidth` toggles
the mode (`"preferred"` when capped, `"equal"` when `null`) and applies
`wrapper.setMaxSize(cap, Number.MAX_VALUE)` to the **wrappers** (the `_toolbar`
children — [`Tab.ts:421`](../src/typescript/lib/layout/Tab.ts#L421)). The 1px
under-border is the strip's own border and spans the full strip width edge-to-edge
regardless. No new layout manager is needed.

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
    private _indicator:               TabIndicator    = new TabIndicator();   // dedicated subclass, raw-appended to _toolbar's element in attach()

    setTabMaxWidth(px: number | null): this;
    getTabMaxWidth(): number | null;
    setTabUnderBorderFullWidth(full: boolean): this;
    isTabUnderBorderFullWidth(): boolean;
}
```

`setTabMaxWidth` re-applies `setMaxSize` to each existing tab **wrapper** and
re-runs the layout; `applyOptions` dispatches both after `super.applyOptions`
([`Tab.ts:134`](../src/typescript/lib/layout/Tab.ts#L134)).

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

Two **new** tokens for the sliding indicator. The toolbar / button / hover /
selected tab tokens already exist (the flat-button work landed) — do **not**
re-add them. Theme literals are now object literals, not raw `var()` strings:
add an `indicator` sub-block under `tab` in the `Theme` interface
([`Theme.ts:169`](../src/typescript/lib/core/Theme.ts#L169)) and in each theme
literal ([`ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts),
[`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts),
[`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts)), then derive the
two CSS custom properties in `themeToVars`
([`Theme.ts:553`](../src/typescript/lib/core/Theme.ts#L553)). The existing
`tab.button` block in `ModernTheme.ts`
([`ModernTheme.ts:93`](../src/typescript/lib/core/themes/ModernTheme.ts#L93)) shows
the nesting shape, e.g.:

```typescript
tab: {
    toolbar  : { background: '#eee', border: '#e1e1e8' },
    button   : { /* … already present … */ },
    indicator: { color: '#1a73e8', thickness: '2px' },   // NEW sub-block
},
```

with `themeToVars` deriving:

```typescript
'--ts-ui-tab-indicator-color'    : theme.tab.indicator.color,
'--ts-ui-tab-indicator-thickness': theme.tab.indicator.thickness,
```

| CSS Custom Property | Classic / Dark Default | Modern Default | Purpose |
|---|---|---|---|
| `--ts-ui-tab-indicator-color` | per theme literal | `#1a73e8` (blue) | Sliding active-tab indicator fill |
| `--ts-ui-tab-indicator-thickness` | `2px` | `2px` | Indicator bar height |

The thickness token is consumed both by the indicator element's height and by
the `doLayout` `y`-offset math so the two never drift.

---

## Internal Structure

**Indicator element.** A dedicated `class TabIndicator extends Component`
declared in `Tab.ts` (alongside the file's other private classes). It styles
itself from the tokens in its own constructor — because it is a `Component`
subclass, `setElementStyles` (protected) is reachable on `this`:

```typescript
class TabIndicator extends Component {
    constructor() {
        super();
        this.setElementStyles({
            position:      "absolute",
            bottom:        "0",
            left:          "0",
            height:        "var(--ts-ui-tab-indicator-thickness, 2px)",
            background:    "var(--ts-ui-tab-indicator-color, #1a73e8)",
            transition:    "transform 200ms ease, width 200ms ease",
            pointerEvents: "none",
        });
    }

    slideTo(left: number, width: number): this {
        return this.setElementStyles({
            transform: `translateX(${left}px)`,
            width:     `${width}px`,
        });
    }
}
```

The `Tab` field is `private _indicator = new TabIndicator()`. In `attach()`
([`Tab.ts:168`](../src/typescript/lib/layout/Tab.ts#L168)), after `_toolbar`'s
element is appended, raw-append the indicator into it:
`this._toolbar.getElement(true).appendChild(this._indicator.getElement(true))`.
This keeps it out of the HBox's `getComponents()` so it is never laid out as a
tab cell — the same overlay pattern `_toolbar` itself uses.

**doLayout positioning.** After the toolbar lays out
(`this._toolbar.doLayout()`, [`Tab.ts:669`](../src/typescript/lib/layout/Tab.ts#L669)),
read the active tab's **wrapper** (index `_selectedTabIndex`) and drive the
indicator. Wrappers are positioned by the strip's HBox, so their `getX()` /
`getWidth()` are valid post-layout — read the wrapper, not the button, so the bar
spans the full tab cell:

```typescript
const active = this._tabs[this._selectedTabIndex]?.wrapper;

if (active && active.getWidth() > 0) {
    this._indicator.slideTo(active.getX(), active.getWidth());
}
```

Using `transform: translateX` (not `left`) keeps the slide on the compositor.

**Flat buttons — already done.** `buildTabEntry`
([`Tab.ts:341`](../src/typescript/lib/layout/Tab.ts#L341)) already themes each
`ToggleButton` per state from the modern tab tokens: normal
(`--ts-ui-tab-button-bg` / `-border`, routed through **both** `setBackgroundColor`
**and** `setBackgroundImage` to kill the inherited Button gradient bleed,
[`Tab.ts:350`](../src/typescript/lib/layout/Tab.ts#L350)), hover
(`--ts-ui-tab-button-hover-*` via `setHoverBackgroundColor/Image/Shadow/Border`),
and selected (`--ts-ui-tab-button-selected-*` via
`ToggleButton.setSelectedBackgroundColor/Image/Shadow/Border`). `ModernTheme.ts`
supplies the modern `tab.button` block. **No source change to `buildTabEntry` is
needed for the flat look** — it is a landed token concern and not part of this
plan's remaining scope.

**Max-width cap.** In `buildTabEntry`, after `this._toolbar.addComponent(wrapper)`
([`Tab.ts:421`](../src/typescript/lib/layout/Tab.ts#L421)) — cap the **wrapper**,
since the wrapper is the HBox child:

```typescript
if (this._tabMaxWidth != null) {
    wrapper.setMaxSize(this._tabMaxWidth, Number.MAX_VALUE);
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

1. **Indicator theme tokens** — add an `indicator: { color, thickness }`
   sub-block under `tab` in the `Theme` interface
   ([`Theme.ts:169`](../src/typescript/lib/core/Theme.ts#L169)) and in each theme
   literal ([`ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts),
   [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts),
   [`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts)), then derive
   `--ts-ui-tab-indicator-color` / `--ts-ui-tab-indicator-thickness` in
   `themeToVars` ([`Theme.ts:553`](../src/typescript/lib/core/Theme.ts#L553)). The
   flat-button / per-state tab-button tokens are **already done** — do not re-add
   them. → verify: `grep -n 'ts-ui-tab-indicator' src/typescript/lib/core/Theme.ts`.
2. **Tab options + fields** — add `tabMaxWidth` / `tabUnderBorderFullWidth` to
   `TabOptions`, the two backing fields, the four typed setters/getters, and
   `applyOptions` dispatch ([`Tab.ts:134`](../src/typescript/lib/layout/Tab.ts#L134)).
3. **Indicator element** — add a `class TabIndicator extends Component` (styles
   itself from the tokens, exposes `slideTo(left, width)`), give `Tab` a
   `private _indicator = new TabIndicator()` field, and raw-append its element
   into `_toolbar`'s element in `attach()`
   ([`Tab.ts:168`](../src/typescript/lib/layout/Tab.ts#L168)) — **not** via
   `addComponent` (HBox would lay it out as a tab cell).
4. **doLayout** — position the indicator from the active **wrapper's** geometry
   ([`Tab.ts:620`](../src/typescript/lib/layout/Tab.ts#L620), after
   `this._toolbar.doLayout()` at [`#L669`](../src/typescript/lib/layout/Tab.ts#L669));
   set `_toolbar`'s bottom border to honor `_underBorderFullWidth` (strip-wide rule).
5. **Max-width cap** — apply `setMaxSize` to the **wrapper** in `buildTabEntry`
   after `addComponent(wrapper)`
   ([`Tab.ts:421`](../src/typescript/lib/layout/Tab.ts#L421)) and re-apply across
   existing wrappers in `setTabMaxWidth`.
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
| Modify | `src/typescript/lib/core/Theme.ts` (`tab.indicator` interface field + `themeToVars` mapping) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` (indicator sub-block in `tab`) |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` (indicator sub-block in `tab`) |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` (indicator sub-block in `tab`) |
| Modify | `src/typescript/lib/layout/Tab.ts` (indicator, options, doLayout, max-width) |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` (option forwarders) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (caret `getGlyph` accessor + rotation) |

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
  `_tabs` is empty or the active wrapper has zero width (pre-render); skip until a
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

- [`Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `_toolbar` (HBox `equal`,
  [`#L117`](../src/typescript/lib/layout/Tab.ts#L117)), `buildTabEntry` (now wraps
  each button in a wrapper Component, [`#L341`](../src/typescript/lib/layout/Tab.ts#L341)),
  `_selectedTabIndex`, `doLayout` ([`#L620`](../src/typescript/lib/layout/Tab.ts#L620)).
- [`TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) —
  option dispatch after `setLayoutManager(new Tab())`
  ([`#L75`](../src/typescript/lib/component/container/TabPanel.ts#L75)) +
  `getTabManager()` forwarder ([`#L166`](../src/typescript/lib/component/container/TabPanel.ts#L166)).
- [`ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) —
  `ComboBoxCaret` (the local `chevron-down` glyph, [`#L412`](../src/typescript/lib/component/input/ComboBox.ts#L412)),
  `_caret`, `_dropdown` (constructed [`#L491`](../src/typescript/lib/component/input/ComboBox.ts#L491)),
  `toggleDropdown` ([`#L647`](../src/typescript/lib/component/input/ComboBox.ts#L647)),
  `closeDropdown` ([`#L670`](../src/typescript/lib/component/input/ComboBox.ts#L670)),
  the `"click"` listener ([`#L508`](../src/typescript/lib/component/input/ComboBox.ts#L508)).
- [`AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts) —
  `getDurationMs` (single fade duration, default 120, [`#L191`](../src/typescript/lib/core/AnimatedDropdown.ts#L191)),
  `isOpen` ([`#L339`](../src/typescript/lib/core/AnimatedDropdown.ts#L339)),
  `isAnimated` ([`#L171`](../src/typescript/lib/core/AnimatedDropdown.ts#L171)).
- [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts) — the
  `tab.button` block (landed) and where the new `tab.indicator` sub-block goes;
  [`Theme.ts`](../src/typescript/lib/core/Theme.ts) `themeToVars`
  ([`#L553`](../src/typescript/lib/core/Theme.ts#L553)) for the var mapping.

---

## Non-Goals

- No reordering, drag, or scrollable-overflow tab strip — out of scope.
- No change to the bare `Panel + Tab` wiring path; `TabPanel` stays the
  convenience entry point.
- No new public API on `ComboBox` — the arrow change is internal.
- Not re-registering the modern theme — that is the sibling plan's job.
