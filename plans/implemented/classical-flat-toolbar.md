# Classical Flat-Toolbar Appearance — Implementation Plan

## Overview

Make [`ToolBar`](../src/typescript/lib/component/menubar/ToolBar.ts) render like a classical Office/Windows toolbar: its `Button` / `ToggleButton` children lose all frame at rest and only show framing on hover (light frame + subtle fill) and press (sunken inset frame). A toggled-on `ToggleButton` reads as depressed using the same sunken treatment.

The work is one coherent feature delivered in four dependent phases. **Phase 1** adds a new `flat` appearance mode to [`Button`](../src/typescript/lib/component/button/Button.ts) plus the sunken pressed/selected treatment and its theme tokens — this is the foundation. **Phase 2** has `ToolBar` opt its `Button` children into flat mode and adds compact icon-button defaults. **Phase 3** implements the stubbed `overflow: "menu"` mode ([ToolBar.ts:260](../src/typescript/lib/component/menubar/ToolBar.ts#L260)) by reflowing overflowed children into a rebuild-mode [`Menu`](../src/typescript/lib/core/Menu.ts). **Phase 4** adds a split/dropdown toolbar button built on [`Button`](../src/typescript/lib/component/button/Button.ts) + [`Menu`](../src/typescript/lib/core/Menu.ts).

Phases 2-4 each depend on Phase 1; Phase 3 and Phase 4 both depend on Phase 2 (they target flat toolbars) but are independent of each other.

---

## Architecture Decisions

### `flat` is a third appearance mode, distinct from `chromeless`

`chromeless` ([Button.ts:104](../src/typescript/lib/component/button/Button.ts#L104)) strips **all** chrome — border, shadow, gradient, *and* the twelve `pressedX`/`hoverX` treatments — leaving only cursor/color/insets ([applyChromeOptions, Button.ts:442](../src/typescript/lib/component/button/Button.ts#L442)). It is used by `MenuBarButton` and `PickerButton` for a permanently-flat label surface.

`flat` is different: **rest** has no border/shadow/gradient, but **`:hover:not(:active)`** shows a light frame + subtle fill and **`:active`** shows a sunken inset frame. It reuses Button's existing lazy `hoverStyleRule` / `pressedStyleRule` machinery ([Button.ts:280-292](../src/typescript/lib/component/button/Button.ts#L280)) — flat is purely a *different set of values* fed into the same rules, plus suppression of the resting border/shadow/gradient.

**Interaction rule: `flat` and `chromeless` are mutually exclusive, and `chromeless` wins.** Rationale: `chromeless` already means "no hover/pressed treatment at all", which directly contradicts flat's "hover/pressed framing". A button that is both should behave as the more-stripped of the two. `applyChromeOptions` checks `chromeless` first (early-return, unchanged); the new flat branch runs only in the `else` path. `setFlat(true)` no-ops with a dev-time guard when `isChromeless()` is true (and vice-versa), so the modes never co-apply at runtime.

### Flat suppresses resting chrome the same way `chromeless` does, but keeps interaction rules

In the flat branch of `applyChromeOptions`, suppress the resting frame exactly as the chromeless branch does its border/radius/shadow/gradient masking — `clearBorder()`, and write `undefined` into `_options.borderRadius` / `shadow` / `backgroundImage`, plus `backgroundColor: "transparent"` when the caller gave none. Then, **instead of returning**, install the flat hover/pressed treatments via the existing `setHoverBorder` / `setHoverBackgroundColor` / `setPressedBorder` / `setPressedBackgroundColor` / `setPressedShadow` setters, sourced from the new flat theme tokens. This routes through the same lazy `hoverStyleRule` / `pressedStyleRule` getters Button already uses, so the class-field super-cascade and lazy-getter conventions are respected with zero new style-rule plumbing.

The default `pressedX`/`hoverX` values from `_defaultButtonOptions` ([Button.ts:140-146](../src/typescript/lib/component/button/Button.ts#L140)) must **not** also apply in flat mode (they are the raised-button treatments). The flat branch therefore mirrors the chromeless branch's masking of those: write `undefined` over the inherited `pressedX`/`hoverX` defaults in `_options` before installing the flat values, so a re-apply that omits them doesn't leak the raised treatments. The flat values themselves are then set explicitly.

### Sunken pressed/selected is a shared, theme-driven inset shadow

`ToggleButton.selected:not(:hover)` already renders sunken via `boxShadow: "var(--ts-ui-toggle-selected-shadow, 2px 2px 1px inset grey)"` ([ToggleButton.ts:45](../src/typescript/lib/component/button/ToggleButton.ts#L45)). Phase 1 makes Button's flat `:active` treatment consistent with this: a new `--ts-ui-button-flat-pressed-shadow` inset-shadow token + `--ts-ui-button-flat-pressed-bg` fill, applied through `setPressedShadow` / `setPressedBackgroundColor`. For a flat `ToggleButton`, the `.selected:not(:hover)` rule should read the *same* sunken values as the flat `:active` rule so a toggled-on toolbar button looks depressed. We do **not** restructure ToggleButton's existing default selected rule; instead, when a `ToggleButton` is flattened (`setFlat(true)`), it overwrites its `selectedStyleRule` shadow/bg with the flat-pressed tokens via the existing `setSelectedShadow` / `setSelectedBackgroundColor` setters ([ToggleButton.ts:144-178](../src/typescript/lib/component/button/ToggleButton.ts#L144)). No new selected-state machinery.

`ToggleButton` overrides `setFlat` to call `super.setFlat(value)` then re-point its selected rule; this keeps the one-place sunken definition (the flat-pressed tokens) authoritative for both `:active` and `.selected`.

### ToolBar flattens Button children in `addComponent`, type-guarded, default-on

`ToolBar` accepts arbitrary `Component`s, so flattening is type-guarded: in `addComponent` ([ToolBar.ts:287](../src/typescript/lib/component/menubar/ToolBar.ts#L287)), after the existing roving-tabindex registration, `if (this._flat && component instanceof Button) component.setFlat(true)`. `Button` is imported with its callable export; `instanceof` works against the runtime class (the callable wrapper preserves prototype chain — confirmed by `RovingTabIndex.add(component)` already relying on `instanceof`-style duck typing). New option `flat?: boolean` on `ToolBarOptions`, **default `true`** for the classical look, with `setFlat(false)` / `isFlat()` as the escape hatch to keep raised buttons.

**Children added before the flag flips vs. after:** `setFlat(value)` (runtime) iterates existing `Button` children via `getComponents()` and applies/reverts; `addComponent` applies the current flag to each new child. Reverting (`setFlat(false)` after construction) calls `child.setFlat(false)` on each — see next decision for what un-flatten restores.

### Un-flatten restores raised chrome via the existing chromeless round-trip pattern

`setFlat(false)` on a Button must restore the raised border/shadow/gradient + the raised `pressedX`/`hoverX` treatments. Reuse the existing `_restoreChrome()` private ([Button.ts:1188](../src/typescript/lib/component/button/Button.ts#L1188)) which re-applies from `_defaultOptions` — the same loss-tradeoff `setChromeless(false)` documents (consumer-supplied chrome from the caller's bag, not defaults, is not recovered). `setFlat(true)` calls a new sibling private `_applyFlatChrome()` that runs the suppression + flat-token installation described above. This keeps flat and chromeless symmetric and avoids duplicating the restore logic.

### Compact icon defaults ride ToolBar.compact, not a new concept

`ToolBar.compact` already tightens insets to 2px and collapses child spacing ([setCompact, ToolBar.ts:219](../src/typescript/lib/component/menubar/ToolBar.ts#L219)). Tight, roughly-square icon buttons are a property of the *button*, not the bar, but the trigger is the bar's compact state. **Decision: do not add a separate compact-icon option.** When `flat` is on, a Button whose label is empty and that has a glyph (`getGlyph() && !getText()`) is already rendered glyph-only with 0 spacing ([Button.ts:890](../src/typescript/lib/component/button/Button.ts#L890)); flat mode simply tightens such a button's insets to a small symmetric value so it reads as a compact square. This is done inside `Button.setFlat(true)`: when the button is glyph-only, set insets to `(4,4,4,4)` (vs. the default `(5,10,5,10)`). No new public surface; minimal and driven by content, matching the "no over-engineering" guidance. Buttons with text keep their default insets.

### Overflow menu reuses rebuild-mode `Menu`, driven from a `doLayout` override

`Menu` in rebuild mode (`new Menu()` + `show(x, y, configs)` — [Menu.ts:131](../src/typescript/lib/core/Menu.ts#L131)) is exactly a click-anchored dropdown of `MenuItemConfig` rows with viewport clamping and outside-click dismissal already built. The overflow phase adds, in `overflow: "menu"` mode:

1. A trailing chevron affordance — a flat glyph-only `Button` (`glyph: "ellipsis-v"` horizontal / `"ellipsis"` — pick the registry name that exists; default the **overflow** trigger glyph to `"ellipsis-v"` and verify against the glyph registry at implement time) appended as the last child, hidden until something overflows.
2. A `doLayout()` override on `ToolBar` that, after `super.doLayout()`, measures cumulative child extent against the bar's inner width (`getWidth()` minus insets) and hides children that don't fit (`child.setVisible(false)`), then shows + populates the overflow trigger when ≥1 child is hidden, hiding it otherwise.
3. Clicking the trigger opens a rebuild-mode `Menu.show()` anchored under the trigger, with one `MenuItemConfig` per overflowed child. The config's `text`/`glyph` are read from each overflowed `Button` (`getText()` / `getGlyph()`), and `action` re-fires the child's `"action"` (Phase 3 wires `config.action` to call the button's click — see Implementation).

**Decision: overflow only reflows `Button`/`ToggleButton` children into the menu**; non-Button children (ComboBox, Spacer, Separator) that don't fit are clipped as today (`overflow: "clip"` semantics for them). This keeps the menu-config mapping well-defined (a `Menu` row is text+action) without inventing a generic "render any Component in a menu" surface. Documented as a Non-Goal.

### Split/dropdown button is a new `SplitButton extends Button`

Phase 4 adds `SplitButton` to the `button` group: a flat-capable Button with a trailing chevron `Glyph` that, on click of the chevron zone, opens a rebuild-mode `Menu` of `MenuItemConfig`s anchored under the button. The primary action (`"action"`) fires on the main face; the chevron opens the menu. Build the menu with `new Menu()` + `show()`, reusing all of Menu's positioning/dismissal. Minimal new surface: `SplitButtonOptions { menuItems?: MenuItemConfig[] }`, `setMenuItems(items)` / `getMenuItems()`. `PickerButton` ([PickerButton.ts](../src/typescript/lib/component/input/PickerButton.ts)) is *not* extended — it is an internal chromeless trigger for the picker fields with no menu of its own; the relevant reusable infrastructure is `Menu`, which SplitButton consumes directly.

### Convention compliance

No convention violations. New cached fields use `declare` to dodge the class-field super-cascade trap ([memory: class-field super-cascade trap]) — `_flat` on Button is read by `setFlat` which can fire during the super cascade via `applyChromeOptions`, so it is declared, not initialized. Typed setters back every new option (`setFlat`/`isFlat`, `setMenuItems`/`getMenuItems`). Style rules use the existing lazy getters. All new colours/shadows are theme tokens in `Theme.ts`. Listeners use the `Event` class. One DOM element per class is preserved (SplitButton reuses Button's single `<button>`; the chevron is a child `Glyph` inside the content row, same as the existing leading-glyph pattern).

---

## Public API (TypeScript Signatures)

### `Button` (modify) — [Button.ts](../src/typescript/lib/component/button/Button.ts)

```typescript
export interface ButtonOptions extends ComponentOptions {
    // ...existing fields...
    /**
     * Classical "flat" appearance: no resting border/shadow/gradient; a light
     * frame + fill on `:hover:not(:active)` and a sunken inset frame on
     * `:active`. Mutually exclusive with `chromeless` (chromeless wins).
     * Runtime counterpart `setFlat`; read with `isFlat`.
     */
    flat?: boolean;
}

class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {
    // New cached backing field — `declare` to avoid the super-cascade trap
    // (setFlat can fire during applyChromeOptions in the super cascade).
    private declare _flat?: boolean;

    isFlat(): boolean;
    setFlat(value: boolean): this;

    // New privates (mirror _clearChrome / _restoreChrome):
    private _applyFlatChrome(): void;   // suppress resting chrome + install flat hover/pressed tokens + compact icon insets
    // _restoreChrome() (existing) is reused by setFlat(false).
}
```

`applyChromeOptions` ([Button.ts:442](../src/typescript/lib/component/button/Button.ts#L442)) gains a flat branch in its `else` path; `applyOptions` ([Button.ts:401](../src/typescript/lib/component/button/Button.ts#L401)) pure-writes `flat` into `_options` like `chromeless`.

### `ToggleButton` (modify) — [ToggleButton.ts](../src/typescript/lib/component/button/ToggleButton.ts)

```typescript
class ToggleButton extends Button<ToggleButtonOptions> {
    // Re-points the `.selected:not(:hover)` rule to the flat-pressed tokens
    // when flattened, so a toggled-on flat button reads as depressed.
    setFlat(value: boolean): this;   // override: super.setFlat(value) then re-point selectedStyleRule
}
```

### `ToolBar` (modify) — [ToolBar.ts](../src/typescript/lib/component/menubar/ToolBar.ts)

```typescript
export interface ToolBarOptions extends ContainerOptions {
    orientation?: ToolBarOrientation;
    compact?:     boolean;
    overflow?:    ToolBarOverflow;
    /**
     * When `true` (default), `Button`/`ToggleButton` children added to the bar
     * are switched to flat appearance for the classical toolbar look. Set
     * `false` to keep raised buttons. Runtime counterpart `setFlat`.
     */
    flat?:        boolean;
}

class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Container<TOptions> {
    declare private _flat: boolean;
    // Phase 3 only:
    declare private _overflowButton: Button | null;
    declare private _overflowMenu:   Menu | null;

    isFlat(): boolean;
    setFlat(value: boolean): this;            // applies/reverts flat on existing Button children

    override addComponent(component: Component, constraints?: LayoutConstraints): this;  // + flatten Button children
    override doLayout(): this;                 // Phase 3: measure + reflow overflow
}
```

`_defaultToolBarOptions` ([ToolBar.ts:61](../src/typescript/lib/component/menubar/ToolBar.ts#L61)) gains `flat: true`; `applyOptions` ([ToolBar.ts:146](../src/typescript/lib/component/menubar/ToolBar.ts#L146)) dispatches `setFlat`.

### `SplitButton` (new, Phase 4) — `src/typescript/lib/component/button/SplitButton.ts`

```typescript
export interface SplitButtonOptions extends ButtonOptions {
    /** Items shown in the dropdown opened by the trailing chevron. */
    menuItems?: MenuItemConfig[];
}

class SplitButton extends Button<SplitButtonOptions> {
    constructor(text?: string, options?: SplitButtonOptions);
    setMenuItems(items: MenuItemConfig[]): this;
    getMenuItems(): MenuItemConfig[];
}
const SplitButtonCallable = callable(SplitButton);
export { SplitButton as _SplitButton, SplitButtonCallable as SplitButton };
```

---

## Theme Tokens

New tokens for the flat hover-frame and sunken-pressed states. The selected-state sunken treatment reuses the **flat-pressed** tokens (set on the ToggleButton's selected rule when flattened), so no separate flat-selected token is needed. Existing `--ts-ui-button-*` / `--ts-ui-toggle-*` tokens are reused where they already fit; new tokens are added only for the genuinely distinct flat values.

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-button-flat-hover-bg` | `rgba(0, 0, 0, 0.06)` | `rgba(255, 255, 255, 0.08)` | Subtle fill on `:hover:not(:active)` of a flat button |
| `--ts-ui-button-flat-hover-border` | `1px solid rgb(200, 200, 200)` | `1px solid rgb(90, 90, 90)` | Light frame on hover |
| `--ts-ui-button-flat-pressed-bg` | `rgba(0, 0, 0, 0.10)` | `rgba(255, 255, 255, 0.12)` | Fill of the sunken `:active` / `.selected` state |
| `--ts-ui-button-flat-pressed-shadow` | `inset 1px 1px 3px rgba(0, 0, 0, 0.25)` | `inset 1px 1px 3px rgba(0, 0, 0, 0.55)` | Sunken inset frame for `:active` and flat `.selected` |
| `--ts-ui-button-flat-pressed-border` | `1px solid rgb(180, 180, 180)` | `1px solid rgb(70, 70, 70)` | Frame around the sunken state |

`Theme.ts` blocks needing entries:
- **`Theme` interface** ([Theme.ts:89](../src/typescript/lib/core/Theme.ts#L89)): add `button.flat: { hover: { background; border }; pressed: { background; shadow; border } }`.
- **`themeToVars`** ([Theme.ts:799](../src/typescript/lib/core/Theme.ts#L799)): map the five new tokens from `theme.button.flat.*`.
- **Concrete themes** `ClassicTheme`, `ModernTheme`, `DarkTheme` (and any sibling under `themes/`): add the `button.flat` block. `BaseTheme` carries no colour-bearing `button` sub-values today (only `padding`/`font`/`description` — [BaseTheme.ts:25](../src/typescript/lib/core/themes/BaseTheme.ts#L25)), so the `flat` colours live in the concrete themes alongside `button.pressed`/`button.hover` ([ClassicTheme.ts:24](../src/typescript/lib/core/themes/ClassicTheme.ts#L24), [DarkTheme.ts:22](../src/typescript/lib/core/themes/DarkTheme.ts#L22)). Light defaults go in `ClassicTheme` + `ModernTheme`; dark in `DarkTheme`.

---

## Internal Structure

### Flat chrome application (Phase 1, `Button._applyFlatChrome`)

```
// suppress resting frame (same masking as the chromeless branch)
this.clearBorder();
this._options.borderRadius    = undefined;
this._options.shadow          = undefined;
this._options.backgroundImage = undefined;
if (no caller backgroundColor) this._options.backgroundColor = "transparent";

// install flat hover/pressed treatments (routes through lazy rules)
this.setHoverBackgroundColor("var(--ts-ui-button-flat-hover-bg, …)");
this.setHoverBorder("var(--ts-ui-button-flat-hover-border, …)");   // string overload
this.setPressedBackgroundColor("var(--ts-ui-button-flat-pressed-bg, …)");
this.setPressedShadow("var(--ts-ui-button-flat-pressed-shadow, …)");
this.setPressedBorder("var(--ts-ui-button-flat-pressed-border, …)");

// compact square for glyph-only buttons
if (this._glyph && this._text.getText().valueOf() === "") this.setInsets(new Insets(4,4,4,4));
```

`setFlat(value)`: dev-guard against `isChromeless()`; no-op if unchanged; `value ? _applyFlatChrome() : _restoreChrome()`; write `_options.flat`.

### Overflow reflow (Phase 3, `ToolBar.doLayout`)

```
super.doLayout();
if (this._overflowMode !== "menu" || orientation !== "horizontal") return this;   // v1: horizontal only
inner = getWidth() - insets.left - insets.right;
walk children in order, accumulate preferred widths + gaps;
first Button/ToggleButton that crosses `inner` (reserving trigger width) → it and all later Buttons hidden;
overflowed = hidden Buttons;
if overflowed.length: show + position _overflowButton, else hide it.
```

The trigger Button is created lazily on first entry to `"menu"` mode, appended via `super.addComponent` (so it is *not* itself flattened-recursively or counted as overflowable — guard by identity). Clicking it builds configs from `overflowed` and calls `this._overflowMenu.show(rect.left, rect.bottom, configs)`.

---

## Ordered Implementation Steps

**Phase 1 — flat Button + sunken pressed/selected + tokens (foundation)**

1. `Theme.ts`: add `button.flat` to the `Theme` interface; map the five tokens in `themeToVars`.
2. `themes/ClassicTheme.ts`, `themes/ModernTheme.ts`: add the light `button.flat` block. `themes/DarkTheme.ts`: add the dark block. Verify the project typechecks (the `Theme` interface is structural — a missing block fails the build, which is the regression checkpoint).
3. `Button.ts`: add `flat?` to `ButtonOptions`; add `private declare _flat?`; pure-write `flat` in `applyOptions`; add the flat branch to `applyChromeOptions` (else path), `isFlat`, `setFlat`, `_applyFlatChrome`. Reuse `_restoreChrome` for `setFlat(false)`.
4. `ToggleButton.ts`: override `setFlat` to call super then re-point `selectedStyleRule` shadow/bg to the flat-pressed tokens via `setSelectedShadow` / `setSelectedBackgroundColor`.
5. Verify: a standalone `new Button({ flat: true, glyph: "check" })` shows no rest frame, hover frame, sunken `:active`; `new ToggleButton("B", { flat: true })` reads depressed when selected. `grep -rn 'flat' src/typescript/lib/component/button/` to confirm the surface.

**Phase 2 — ToolBar flattens children + compact icons** *(depends on Phase 1)*

6. `ToolBar.ts`: import `Button`; add `flat?` to `ToolBarOptions`; `flat: true` in `_defaultToolBarOptions`; `declare private _flat`; dispatch `setFlat` in `applyOptions`; add `isFlat` / `setFlat`; flatten `Button` children in `addComponent` (after roving-tabindex). `setFlat` iterates `getComponents()` and applies/reverts on `Button` instances.
7. Verify: `ToolBarPanel` ([src/typescript/ToolBarPanel.ts](../src/typescript/ToolBarPanel.ts)) buttons render flat by default; a `new ToolBar({ flat: false })` keeps raised buttons. Glyph-only buttons render as tight squares.

**Phase 3 — overflow menu** *(depends on Phase 2)*

8. `ToolBar.ts`: import `Menu`, `MenuItemConfig`; add `declare _overflowButton`/`_overflowMenu`; lazily create the trigger Button (`flat`, glyph-only) + rebuild-mode `Menu` when `setOverflow("menu")` is called; remove the TODO at [ToolBar.ts:260](../src/typescript/lib/component/menubar/ToolBar.ts#L260).
9. `ToolBar.ts`: add `doLayout()` override implementing the measure-and-reflow described above; wire the trigger's `"action"` to open the menu with configs built from overflowed children.
10. Verify: narrow the bar in `ToolBarPanel`; overflowed buttons hide and appear in the chevron dropdown; clicking a dropdown row fires the original button action; widening restores them.

**Phase 4 — split/dropdown button** *(depends on Phase 2; independent of Phase 3)*

11. Create `src/typescript/lib/component/button/SplitButton.ts` extending `Button` with a trailing chevron `Glyph` and a rebuild-mode `Menu`; add `SplitButtonOptions`, `setMenuItems`/`getMenuItems`. Export from the button barrel.
12. Add a `SplitButton` to `ToolBarPanel` and verify the chevron opens the menu while the main face fires `"action"`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/button/Button.ts` (flat option, setFlat/isFlat, _applyFlatChrome, applyChromeOptions branch) |
| Modify | `src/typescript/lib/component/button/ToggleButton.ts` (setFlat override re-pointing selected rule) |
| Modify | `src/typescript/lib/component/menubar/ToolBar.ts` (flat option + child flattening, overflow menu, doLayout) |
| Modify | `src/typescript/lib/core/Theme.ts` (button.flat in Theme interface + themeToVars) |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` (light button.flat block) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` (light button.flat block) |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` (dark button.flat block) |
| Create | `src/typescript/lib/component/button/SplitButton.ts` (Phase 4) |
| Modify | `src/typescript/lib/component/button/index.ts` (export SplitButton, Phase 4) |
| Modify | `src/typescript/ToolBarPanel.ts` (demo: flat default, overflow, SplitButton) |
| Modify | `docs/components/Button.md`, `docs/components/ToolBar.md` (flat mode, overflow); add `docs/components/SplitButton.md` |
| Modify | `docs/.vitepress/config.mts` (SplitButton sidebar entry) |
| Modify | `docs/concepts/theming.md` (new flat tokens in the token table) |

---

## Verification

- **Typecheck**: project build passes after each phase. The `Theme` interface is structural, so a missing `button.flat` block in any concrete theme fails the build — that is the Phase 1 regression checkpoint.
- **Theme toggle**: flip Classic ↔ Dark in the live app; flat hover/pressed/selected colours track the theme. No hard-coded colour leaks (the `var(--ts-ui-button-flat-*, fallback)` form is themeable).
- **Grep invariants**: `grep -rn 'TODO: menu overflow' src/typescript/lib/component/menubar/ToolBar.ts` — expect zero after Phase 3. `grep -rn '\bflat\b' src/typescript/lib/component/button/Button.ts` — confirm option + setter + branch present.
- **Manual smoke (demo screen `src/typescript/ToolBarPanel.ts`)**: buttons flat at rest; hover shows frame+fill; press shows sunken; toggled ToggleButton (`B`/`I`/`U`) reads depressed; narrowing the bar moves trailing buttons into the chevron menu and clicking a row fires the action; the SplitButton's chevron opens its menu while the main face still fires `"action"`. Verify `new ToolBar({ flat: false })` keeps the old raised look.
- **`npm run docs:build`**: 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

---

## Documentation Impact

- **`flat` / `setFlat` / `isFlat` on Button and ToolBar**: consumer-visible. Update `docs/components/Button.md` (flat appearance section) and `docs/components/ToolBar.md` (flat default + escape hatch, overflow menu). No new exported *type* — `flat` is a field on existing `ButtonOptions` / `ToolBarOptions`, already exported from the button and menubar barrels ([button/index.ts](../src/typescript/lib/component/button/index.ts), [menubar/index.ts](../src/typescript/lib/component/menubar/index.ts)).
- **`SplitButton` (new class, Phase 4)**: export `SplitButton` + `SplitButtonOptions` from `src/typescript/lib/component/button/index.ts` with `@category Components`; add `docs/components/SplitButton.md`; link it in `docs/.vitepress/config.mts` (Buttons group, beside `Button`/`ToggleButton`) and the components catalog `index.md`. Cross-bucket JSDoc references to `Menu` (in `core`) and `MenuItemConfig` (in `component/container`) use markdown links, not `{@link}`, per `_shared/docs-conventions.md`.
- **New theme tokens**: add the five `--ts-ui-button-flat-*` rows to the token table in `docs/concepts/theming.md`.
- **No renames or removals**, so no stale-name sweep needed.

---

## Potential Challenges

- **Overflow measurement timing**: `doLayout` reads children's preferred widths; a Button derives its preferred size live ([Button.ts:1258](../src/typescript/lib/component/button/Button.ts#L1258)), so the measurement is valid after `super.doLayout()`. Mitigation: hide via `setVisible(false)` (which makes a child report no displayed-layout participation), and re-measure on each `doLayout` pass so widening restores hidden children.
- **Re-entrant layout from hiding children**: `setVisible` may `scheduleLayout`; the framework's per-frame queue collapses re-schedules ([Component.ts:145](../src/typescript/lib/core/Component.ts#L145)), so the reflow converges without an infinite loop. Mitigation: guard the reflow so it only mutates visibility when the fit-set actually changed.
- **`instanceof Button` against the callable export**: the callable wrapper preserves the prototype chain (existing `instanceof`-style checks in `Menu` rely on it for `MenuItem`/`MenuSeparator`). Mitigation: import the public `Button` callable and confirm `new Button() instanceof Button` at implement time.
- **Glyph registry name for the overflow chevron**: `"ellipsis-v"` / `"ellipsis"` must exist in the registry. Mitigation: verify against the glyph registry before wiring; fall back to a known-present glyph.
- **Flat ↔ chromeless re-apply leakage**: a button that toggles between modes must not stack hover/pressed values. Mitigation: `setFlat` / `setChromeless` each fully clear the other mode's installed values via `_clearChrome` / `_restoreChrome` and the mutual-exclusion dev-guard.

---

## Critical Files

- [Button.ts](../src/typescript/lib/component/button/Button.ts) — `chromeless` pattern, `applyChromeOptions`, `_clearChrome`/`_restoreChrome`, lazy `hoverStyleRule`/`pressedStyleRule`, `_defaultButtonOptions`, glyph-only content row.
- [ToggleButton.ts](../src/typescript/lib/component/button/ToggleButton.ts) — `.selected:not(:hover)` rule and the `setSelectedShadow`/`setSelectedBackgroundColor` setters.
- [ToolBar.ts](../src/typescript/lib/component/menubar/ToolBar.ts) — `addComponent` + RovingTabIndex, `setCompact`, `setOverflow` stub, `_defaultToolBarOptions`.
- [Menu.ts](../src/typescript/lib/core/Menu.ts) — rebuild-mode `show(x, y, configs)` (overflow + split-button dropdown infrastructure).
- [MenuItem.ts](../src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig` shape (`text`/`glyph`/`action`).
- [MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts) — closest existing flat-ish pattern (chromeless + `:hover` + `setActive`).
- [Theme.ts](../src/typescript/lib/core/Theme.ts) — `Theme` interface `button`/`toggle` blocks + `themeToVars`.
- [themes/ClassicTheme.ts](../src/typescript/lib/core/themes/ClassicTheme.ts), [themes/DarkTheme.ts](../src/typescript/lib/core/themes/DarkTheme.ts) — concrete `button.pressed`/`button.hover`/`toggle.selected` blocks to mirror.

---

## Non-Goals

- **Generic "render any Component in the overflow menu"**: only `Button`/`ToggleButton` children reflow into the dropdown; ComboBox/Spacer/Separator that don't fit are clipped (today's behaviour). A menu row is text+action, so non-Button children have no well-defined menu representation.
- **Vertical-toolbar overflow menu**: Phase 3 implements overflow for horizontal toolbars only (the classical case); vertical overflow stays `"clip"`.
- **Extending `PickerButton` for split buttons**: `PickerButton` is an internal picker-field trigger; `SplitButton` is a separate public class built on `Button` + `Menu`.
- **Recovering consumer-supplied chrome on un-flatten**: `setFlat(false)` restores only `_defaultOptions` chrome, matching the documented `setChromeless(false)` tradeoff.
- **A new `compact-icon` option**: compact square sizing is derived from glyph-only content under flat mode, not a separate flag.
