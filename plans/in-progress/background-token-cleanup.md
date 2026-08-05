# Background Color Options & Token Cleanup — Implementation Plan

## Overview

Fourteen components across `packages/lib` set their own default background (and, at two of them, foreground) colour with an imperative `this.setBackgroundColor(...)` / `this.setForegroundColor(...)` / `this.setBackgroundImage(...)` call sitting in the constructor body **after** `super()` already ran. `super()` already applied a caller-supplied `options.backgroundColor` correctly — the class's `getBackgroundColor()` folds `_defaultOptions.backgroundColor` as a fallback and `applyOptions` dispatches `options.backgroundColor` when present ([`Component.ts:2100`](packages/lib/src/typescript/lib/core/Component.ts#L2100), [`Component.ts:606`](packages/lib/src/typescript/lib/core/Component.ts#L606)) — so the later imperative call has nothing left to do except silently discard whatever the caller passed and paint the hardcoded literal over it. `TreeOptions`, `PopoverOptions`, `StatusBarOptions`, and every other options interface here already extend `ComponentOptions` and so already document `backgroundColor` as a caller-settable field; these components simply never honour it.

`Tree` is one of the fourteen sites ([`Tree.ts:115`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L115)), and its clobbering bug was flagged during an earlier investigation into why a `DocsSidebar` wrapper's custom `backgroundColor` had no visible effect once a `Tree` was nested inside it. This plan does not frame itself around that scenario, and does not resolve it: `DocsSidebar.ts` constructs its tree with `new Tree()` — zero options — so fixing `Tree`'s clobbering bug changes nothing there today; `Tree` still defaults to its own opaque fill because nothing ever asked it to be anything else.[^docssidebar-not-fixed] The fix in this plan applies uniformly to every confirmed site regardless of which app happens to exercise it; the `DocsSidebar` scenario itself is being looked at separately.

Separately, and unrelated to the clobbering bug, two CSS custom properties are pure indirection with no real content of their own: `--ts-ui-drawer-bg` and `--ts-ui-rail-bg` both resolve, in every shipped theme, to the literal string `var(--ts-ui-body-bg)` — not just a numerically equal colour, but a textual alias. This plan removes both tokens and re-points their two consumers at `--ts-ui-body-bg` directly.

Every component discussed here keeps its current default *opaque* look. Nothing about "what colour renders when nobody customises anything" changes. What changes is that a caller who *does* pass `backgroundColor` (or `foregroundColor`) now gets what they asked for instead of having it silently discarded.

---

## Architecture Decisions

### The established fix: a class-level colour default belongs in `_default<Class>Options`, never in an imperative post-`super()` setter call

This codebase already has one correct mechanism for a class-level default that a caller can still override: seed the literal into a module-level `_default<Class>Options` bag and forward it to `super()` as the `subclassDefaults` parameter. `Component`'s own constructor doc comment states the contract directly: *"The defaults are a pure fallback: getters and `applyStyle` consult `_defaultOptions` directly when the caller omitted a field, so a default is never dispatched into `_options`"* ([`Component.ts:507-522`](packages/lib/src/typescript/lib/core/Component.ts#L507-L522)). `CODE_CONVENTIONS.md`'s *Constructors forward `subclassDefaults`* rule and the implemented [`plans/implemented/default-options-pure-fallback.md`](plans/implemented/default-options-pure-fallback.md) plan established and shipped exactly this mechanism for the base class; `StatusBar` ([`StatusBar.ts:59-117`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L59-L117)) and `Popover` ([`Popover.ts:99-182`](packages/lib/src/typescript/lib/overlay/Popover.ts#L99-L182)) already use it correctly for every field except the ones this plan fixes — both already carry a `_default<Class>Options` bag and a `subclassDefaults` constructor parameter, so their fix is a one-line addition to an existing bag. Fourteen sites bypass this mechanism entirely and hardcode the literal via an imperative call instead.

The worked example — `MenuSeparator`, the smallest confirmed site — shows the transformation this plan applies everywhere:

```typescript
// Before — MenuSeparator.ts
const _defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {};

constructor(cssVarPrefix = "menu-bar", options?, subclassDefaults?) {
    super(options, { ..._defaultMenuSeparatorOptions, ...(subclassDefaults ?? {}) });
    ...
    this.setBackgroundColor("transparent");   // always wins, even over a caller's value
    ...
}

// After
const _defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {
    backgroundColor: "transparent",
};

constructor(cssVarPrefix = "menu-bar", options?, subclassDefaults?) {
    super(options, { ..._defaultMenuSeparatorOptions, ...(subclassDefaults ?? {}) });
    ...
    // the imperative call is deleted — super() already applied it
    ...
}
```

`getBackgroundColor()`'s fold and `applyStyle`'s read of that getter ([`Component.ts:4671`](packages/lib/src/typescript/lib/core/Component.ts#L4671)) do the rest: the default renders unchanged when the caller passes nothing, and a caller-supplied value now wins.

Some sites don't yet have a `_default<Class>Options` bag or a `subclassDefaults` parameter at all — `MenuBar`, `ScrollStrip`, `TabBar`, `SortPriorityBadge`, `Scrollbar`, `ChartLegend`, `Tree`, and `DiagramGroupNode` fall in this group. Their fix additionally creates the bag and adds the parameter, per `CODE_CONVENTIONS.md`: *"Forward it even when no subclass exists yet; the cost is one parameter and it cannot be added later without touching every subclass."*[^scope-of-fix]

### `TabButton` gets the same bag fix — via a small `ToggleButton` retrofit

`TabButton` follows the standard fix like every other site, but it needs one extra piece of plumbing first: `ToggleButton` — its immediate parent — swallows its own `options` and calls `super(text)` positionally with **no** `subclassDefaults` pass-through at all ([`ToggleButton.ts:38-44`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L38-L44)), even though `Button` (`ToggleButton`'s own parent) already accepts and forwards one on its `(text?, options?, subclassDefaults?)` overload ([`Button.ts:429-451`](packages/lib/src/typescript/lib/component/button/Button.ts#L429-L451)). `ToggleButton` is the missing link, not `Button`. The retrofit is one new parameter forwarded straight through:

```typescript
// Before — ToggleButton.ts
constructor(text: string, options?: ToggleButtonOptions) {
    super(text);
    ...
}

// After
constructor(text: string, options?: ToggleButtonOptions, subclassDefaults?: Partial<ToggleButtonOptions>) {
    super(text, undefined, subclassDefaults);
    ...
}
```

This changes nothing about *how* `options` is applied — `ToggleButton` still defers that to its own late `this.applyOptions(options)` call, for the same "children must exist first" reason its comment already gives. `subclassDefaults` and `options` are independent parameters on `Component`'s constructor (one seeds `_defaultOptions`, the other is dispatched into `_options`), so forwarding only the former leaves that design untouched. `TabButton` is `ToggleButton`'s only subclass today (confirmed by grep), so this is a small, low-risk, purely-additive change — the new parameter is optional and trailing, so `new ToggleButton(text, options)` keeps compiling.

With that in place, `TabButton` gets its own bag, exactly like every other site:

```typescript
const _defaultTabButtonOptions: Partial<TabButtonOptions> = {
    backgroundColor: "var(--ts-ui-tab-button-bg, #b8b8c3)",
    backgroundImage: "var(--ts-ui-tab-button-bg, #b8b8c3)",
};

constructor(text: string, options?: TabButtonOptions, subclassDefaults?: Partial<TabButtonOptions>) {
    super(text, undefined, { ..._defaultTabButtonOptions, ...(subclassDefaults ?? {}) });
    ...
    // applyTabStyling() no longer touches backgroundColor/backgroundImage at all
}
```

This is mechanically guaranteed to work, not just plausible: `Component`'s constructor resolves `_defaultOptions` via `resolveClassDefaults(this.constructor, subclassDefaults)` ([`ComponentDefaults.ts:78-101`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L78-L101)), and each class's `super()` call spreads its own defaults *after* whatever it received from `subclassDefaults` (`{ ..._defaultButtonOptions, ...(subclassDefaults ?? {}) }` in `Button.ts:450`) — so by the time the merged bag reaches `Component`, `TabButton`'s `backgroundColor`/`backgroundImage` values are last-in and win over `Button`'s own gradient default, the same "deepest class wins" layering every other site in this plan already relies on.

`applyTabStyling()`'s two colour lines are deleted outright — no guard needed, since `super()` now applies the effective value (caller's, or the tab default) correctly before the method ever runs.

### Border, `borderRadius`, and `shadow` stay out of scope, even though the same fix would reach them

`applyTabStyling()` also unconditionally overwrites `border`, clears `borderRadius`, and clears `shadow` — the exact same clobbering shape as the two colour fields, and the exact same mechanism (`_defaultTabButtonOptions`) could carry them too, since `border`/`borderRadius`/`shadow` are also dispatched through `applyChromeOptions`'s own default-fold (`options.border ?? this._defaultOptions.border`, [`Component.ts:679-688`](packages/lib/src/typescript/lib/core/Component.ts#L679-L688)) and would layer the same way. It would cost nothing extra in this file to fix them at the same time.

The plan leaves them alone anyway: `## Non-Goals` already scopes this whole plan to `backgroundColor` / `foregroundColor` / `backgroundImage`, and defers every non-colour instance of this same clobbering pattern — border, padding, insets, cursor, overflow, and more, found across the codebase, not just `TabButton` — to a separate follow-up audit. Fixing `TabButton`'s border/radius/shadow here just because the code is already open would single out one component from that deferred class for no reason tied to this plan's actual subject (theme background tokens); the follow-up audit is where every non-colour site gets fixed together, with its own review. `applyTabStyling()` keeps its border/`clearBorderRadius()`/`clearShadow()`/hover/selected lines exactly as they are, still running after `applyOptions()`, still overwriting unconditionally, for the same reason its existing comment already gives.

### Two sites are not bugs and stay untouched

- **`WindowHeader.ts:80`** hardcodes `this._activeBackground` and calls `this.setBackgroundColor(this._activeBackground)` early in the constructor — but `WindowHeader` calls `this.applyOptions(options)` a second time at the very *end* of its constructor ([`WindowHeader.ts:152-154`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L152-L154)), after every other field is built. That late call dispatches a caller-supplied `options.backgroundColor` last, so it already wins over the earlier hardcode — verified by reading the full constructor body, not assumed. No change needed here.[^windowheader-verified]
- **`Dialog.ts` (3 sites: `DialogTitleBar` at line 213, `DialogButtonRow` at line 411, `Dialog` itself at line 589) and `Menu.ts` (2 sites: `applyPersistentChrome`/`applyRebuildChrome`, lines 810 and 826)** hardcode a background with no caller-facing options bag to clobber in the first place — `DialogTitleBar`/`DialogButtonRow` take positional constructor arguments only, `Dialog`'s `DialogConfig` has no `backgroundColor` field, and `Menu`'s constructor takes `(items?, onClose?)` with no options bag at all. There is nothing to fix; exposing a background override on any of these would mean adding new public API surface, which is a separate design decision — see `## Non-Goals`.

### Token redundancy: `drawer.background` and `rail.background` are pure indirection

Unrelated to the clobbering bug: `theme.drawer.background` and `theme.rail.background` are set to the **literal string** `'var(--ts-ui-body-bg)'` in `ModernTheme.ts`, `DarkTheme.ts`, and `ClassicTheme.ts` — not just numerically equal, but a textual alias with no possible per-theme divergence.[^grep-verified] `Drawer` and `Rail` both keep their own explicit opaque background (they are floating overlay chrome, see `## Token Classification`), but the token they read is pure indirection: remove `theme.drawer.background` / `--ts-ui-drawer-bg` and `theme.rail.background` / `--ts-ui-rail-bg` from `Theme.ts` and all three theme objects, and have `Drawer.ts` / `Rail.ts` consume `var(--ts-ui-body-bg)` directly — the same pattern `AbstractWindow.ts:147` and `Dialog.ts:213` (`this.setBackgroundColor("var(--ts-ui-body-bg)")`) already use.

No other `--ts-ui-*-bg` token is textually or numerically identical to `body.background` in **all three** shipped themes — see the correction below.

### Correction: `list.background`, `autoComplete.background`, `popover.background` are NOT redundant

An earlier pass suspected these three tokens equal `body.background` in every theme. Re-verified directly against `ModernTheme.ts` / `DarkTheme.ts` / `ClassicTheme.ts`: all three match `body.background` in Modern and Classic (both `rgb(255, 255, 255)`), but **diverge in Dark** — `list.background` is `rgb(40, 40, 40)`, `autoComplete.background` is `rgb(45, 45, 45)`, `popover.background` is `rgb(50, 50, 55)`, against `body.background`'s `rgb(30, 30, 30)`. Dark theme intentionally lifts these surfaces a few RGB units above the page so a floating dropdown/popover, or a list nested in a dark window, still reads as a distinct plane. None of the three qualifies as "identical in every shipped theme," so none is removed; each stays keep-opaque with its own token untouched.

### `Tree` is not part of `AbstractSelectableList`'s family

An earlier pass in this session assumed `Tree` shares `AbstractSelectableList`'s `--ts-ui-list-bg` default, the same way `List` does. It doesn't: `Tree.ts` (`packages/lib/src/typescript/lib/component/tree/Tree.ts`) extends `VirtualRowView`, a completely separate hierarchy from `AbstractSelectableList` (whose only subclasses are `List` and `MultiSelectList`). `Tree`'s own hardcoded default is `--ts-ui-input-bg`, not `--ts-ui-list-bg` — a pre-existing, unrelated choice of token, and the actual site of the clobbering bug fixed in this plan. `AbstractSelectableList` / `List` are correctly documented in `## Token Classification` on their own; `Tree`'s fix lives in `## Clobbering-Bug Fix Sites` instead.

---

## Public API

`Theme.drawer` and `Theme.rail` each lose their `background` field. Every other field on both is unchanged.

```typescript
// Before
drawer: {
    background: string;
    shadow:     string;
    border:     string;
};

rail: {
    background: string;
    border:     string;
    shadow:     string;
    handle: {
        hoverBackground:    string;
        selectedBackground: string;
    };
};

// After
drawer: {
    shadow: string;
    border: string;
};

rail: {
    border: string;
    shadow: string;
    handle: {
        hoverBackground:    string;
        selectedBackground: string;
    };
};
```

A custom theme built with `defineTheme(base, overrides)` that supplies `drawer: { background: ... }` or `rail: { background: ... }` in its `overrides` object literal now fails to typecheck (excess property) — see the changelog entry in Step 6 for the consumer-facing fix.

No other public signature changes besides trailing `subclassDefaults` parameters, each **new, optional, and trailing** so every existing call site keeps compiling unchanged:

```typescript
// Gain a subclassDefaults parameter for the first time (create a new bag):
MenuBar, ScrollStrip, TabBar, SortPriorityBadge, Scrollbar, ChartLegend, Tree, DiagramGroupNode, TabButton

// ToggleButton — the one non-"new bag" case: gains the parameter purely to
// forward it to Button, so TabButton (its only subclass) can reach Button's
// own subclassDefaults merge. ToggleButton has no _defaultToggleButtonOptions
// bag of its own and doesn't need one for this plan.
ToggleButton(text: string, options?: ToggleButtonOptions, subclassDefaults?: Partial<ToggleButtonOptions>)
```

---

## Token Classification

`body.background` reference values: Modern `rgb(255, 255, 255)`, Dark `rgb(30, 30, 30)`, Classic `rgb(255, 255, 255)`.

| Component(s) | Token / theme field | Modern | Dark | Classic | Identical to `body.background` in all 3? | Decision |
|---|---|---|---|---|---|---|
| `TextField`, `TextArea`, `TextInput`, `UsernameField`, `PasswordField`, `NumberSpinner`, `AbstractPickerField`, `ComboBox` field box | `--ts-ui-input-bg` / `input.background` | `rgb(255,255,255)` | `rgb(40,40,40)` | `rgb(255,255,255)` | No (Dark differs by 10) | Keep-opaque (input) |
| `Checkbox`, `RadioButton` | `--ts-ui-checkbox-bg` / `--ts-ui-radio-bg` | `rgb(255,255,255)` | `rgb(40,40,40)` | `rgb(255,255,255)` | No (Dark differs by 10) | Keep-opaque (input) |
| `Button`, `CollapseButton` (collapsed skin) | `--ts-ui-button-bg` / `button.background` | `rgb(243,244,246)` | `linear-gradient(70,70,70 → 50,50,50)` | `linear-gradient(241,241,241 → 200,200,200)` | No | Keep-opaque (interactive affordance) |
| `ToggleButton` (selected state) | `--ts-ui-toggle-selected-bg` | `rgb(200,200,200)` | `rgb(35,35,35)` | `rgb(200,200,200)` | No | Keep-opaque (interactive affordance) |
| `AutoCompleteDropdown`, `ComboBox` dropdown, `AbstractCalendarDropdown`, `TimePickerDropdown`, `PickerColumn` | `--ts-ui-autocomplete-bg` / `autoComplete.background` | `rgb(255,255,255)` | `rgb(45,45,45)` | `rgb(255,255,255)` | No (Dark differs by 15) | Keep-opaque (overlay) |
| `AbstractSelectableList` (`List`, `MultiSelectList`) | `--ts-ui-list-bg` / `list.background` | `rgb(255,255,255)` | `rgb(40,40,40)` | `rgb(255,255,255)` | No (Dark differs by 10) | Keep-opaque (self-contained content surface) |
| `Tree` | `--ts-ui-input-bg` (own hardcode, not `AbstractSelectableList`'s family) | `rgb(255,255,255)` | `rgb(40,40,40)` | `rgb(255,255,255)` | No (Dark differs by 10) | Keep-opaque; fixed as a clobbering-bug site (see below), not a token change |
| `Table` | — none — | — | — | — | n/a | No default background exists; no action |
| `AbstractWindow`, `TabWindow`, `WindowHeader` (body fill) | `var(--ts-ui-body-bg, ...)` direct | `rgb(255,255,255)` | `rgb(30,30,30)` | `rgb(255,255,255)` | Same value by definition | Keep-opaque (overlay); already the target pattern |
| `Dialog` | `var(--ts-ui-body-bg)` direct | `rgb(255,255,255)` | `rgb(30,30,30)` | `rgb(255,255,255)` | Same value by definition | Keep-opaque (overlay); already the target pattern |
| `Drawer` | `--ts-ui-drawer-bg` / `drawer.background` | `'var(--ts-ui-body-bg)'` (literal alias) | same | same | Textually identical, all 3 | Keep-opaque; **token removed**, consume `--ts-ui-body-bg` directly |
| `Rail` | `--ts-ui-rail-bg` / `rail.background` | `'var(--ts-ui-body-bg)'` (literal alias) | same | same | Textually identical, all 3 | Keep-opaque; **token removed**, consume `--ts-ui-body-bg` directly |
| `Popover` | `--ts-ui-popover-bg` / `popover.background` | `rgb(255,255,255)` | `rgb(50,50,55)` | `rgb(255,255,255)` | No (Dark differs by 20) | Keep-opaque (overlay); also a clobbering-bug site (see below) |
| `Menu` (context menu use) | `--ts-ui-context-menu-bg` / `contextMenu.background` | `rgb(255,255,255)` | `rgb(45,45,45)` | `rgb(255,255,255)` | No (Dark differs by 15) | Keep-opaque (overlay) |
| `Menu` (menu-bar panel use) | `--ts-ui-menu-bar-panel-bg` / `menuBar.panel.background` | `rgb(255,255,255)` | `rgb(45,45,45)` | `rgb(255,255,255)` | No (Dark differs by 15) | Keep-opaque (overlay) |
| `Tooltip` | `--ts-ui-tooltip-bg` / `tooltip.background` | `rgb(255,255,240)` | `rgb(60,60,45)` | `rgb(255,255,240)` | No | Keep-opaque (overlay) |
| `FieldDecorator` validation tooltip | `--ts-ui-validation-error-tooltip-bg` | `rgb(180,30,30)` | `rgb(160,30,30)` | `rgb(180,30,30)` | No | Keep-opaque (overlay) |
| window title-bar controls (`windowControls.ts`) | `--ts-ui-window-control-bg` / `window.control.background` | `rgb(255,255,255)` | `rgb(30,30,30)` | `linear-gradient(241,241,241 → 200,200,200)` | No (Classic differs) | Keep-opaque (overlay chrome / interactive affordance) |
| `MenuBarButton` (resting state) | `--ts-ui-menu-bar-btn-bg` / `menuBar.button.background` | `'transparent'` | `'transparent'` | `'transparent'` | n/a — already transparent | Already transparent; no action |
| `ToolBar` | `--ts-ui-toolbar-bg` / `toolBar.background` | `rgb(245,245,245)` | `rgb(45,45,45)` | `rgb(245,245,245)` | No | Keep-opaque (chrome bar) |
| `MenuBar` (bar strip) | `--ts-ui-menu-bar-bg` / `menuBar.background` | `rgb(245,245,245)` | `rgb(45,45,45)` | `rgb(245,245,245)` | No | Keep-opaque (chrome bar); also a clobbering-bug site (see below) |
| `StatusBar` | `--ts-ui-statusbar-bg` / `statusBar.background` | `rgb(245,245,245)` | `rgb(45,45,45)` | `rgb(245,245,245)` | No | Keep-opaque (chrome bar); also a clobbering-bug site (see below) |
| `Accordion` header | `--ts-ui-accordion-header-bg` | `rgb(243,244,246)` | `linear-gradient(60,60,60 → 45,45,45)` | `linear-gradient(230,230,230 → 210,210,210)` | No | Keep-opaque (chrome bar) |
| `TabBar` / `TabButton` (toolbar + button states) | `--ts-ui-tab-toolbar-bg` / `--ts-ui-tab-button-bg` | `#eee` / `rgb(226,229,233)` | `#2a2a2a` / `#3a3a3a` | `#eee` / gradient | No | Keep-opaque (chrome bar); both also clobbering-bug sites (see below) |
| `WindowHeader`, `TabWindow` (header strip) | `--ts-ui-window-header-bg` / `window.header.background` | `#eee` | `#2a2a2a` | `#eee` | No | Keep-opaque (overlay chrome); `WindowHeader`'s call site checked and confirmed not a clobbering bug (see `## Architecture Decisions`) |
| `SplitGutter`, collapse strip | `--ts-ui-gutter-bg` / `--ts-ui-collapse-strip-bg` | `#AAAAAA` | `#555` | `#AAAAAA` | No | Keep-opaque (structural divider, not a content surface) |

---

## Clobbering-Bug Fix Sites

Every row below is a component whose constructor calls `this.setBackgroundColor(...)` / `this.setForegroundColor(...)` / `this.setBackgroundImage(...)` **after** `super()` already correctly applied any caller-supplied value, silently discarding it. "Existing bag?" says whether the class already has a `_default<Class>Options` const and a `subclassDefaults` constructor parameter to extend, or whether this plan creates both.

| File | Site | Field(s) clobbered | Existing bag? | Fix |
|---|---|---|---|---|
| `component/tree/Tree.ts` | Line 115, constructor | `backgroundColor` | No — create | New bag + `subclassDefaults` param |
| `component/menubar/MenuBar.ts` | Line 75, constructor | `backgroundColor` | No — create | New bag + `subclassDefaults` param |
| `component/diagram/DiagramNode.ts` | Line 93, constructor | `backgroundColor` | Yes (`_defaultDiagramNodeOptions`) | Add field to existing bag |
| `component/diagram/DiagramGroupNode.ts` | Line 60, constructor | `backgroundColor` | Partial — inline literal, not a named bag | Extract to named bag (mirrors `DiagramNode`'s sibling pattern) + `subclassDefaults` param |
| `component/container/ScrollStrip.ts` | Line 157, constructor | `backgroundColor` (`"transparent"`) | No — create | New bag + `subclassDefaults` param |
| `component/button/TabButton.ts` | Lines 123-124, `applyTabStyling()` | `backgroundColor`, `backgroundImage` | No — create | New bag + `subclassDefaults` param, forwarded through a `ToggleButton` retrofit (see `## Architecture Decisions` and Step 12) |
| `component/container/StatusBar.ts` | Lines 123-124, constructor | `backgroundColor`, `foregroundColor` | Yes (`_defaultStatusBarOptions`) | Add fields to existing bag |
| `component/container/TabBar.ts` | Line 583, constructor | `backgroundColor` | No — create | New bag + `subclassDefaults` param |
| `component/container/MenuSeparator.ts` | Line 53, constructor | `backgroundColor` (`"transparent"`) | Yes, empty (`_defaultMenuSeparatorOptions = {}`) | Add field to existing (empty) bag |
| `component/table/cell/SortPriorityBadge.ts` | Lines 85-86, constructor | `backgroundColor`, `foregroundColor` | No — create | New bag + `subclassDefaults` param |
| `component/container/Scrollbar.ts` | Line 370, constructor | `backgroundColor` | No — create | New bag + `subclassDefaults` param |
| `component/menubar/ToolBarSeparator.ts` | Line 84, constructor | `backgroundColor` | Yes, empty (`_defaultToolBarSeparatorOptions = {}`) | Add field to existing (empty) bag |
| `component/chart/ChartLegend.ts` | Line 88, constructor | `backgroundColor` (`"transparent"`) | No — create | New bag + `subclassDefaults` param |
| `overlay/Popover.ts` | Lines 190-191, constructor | `backgroundColor`, `foregroundColor` | Yes (`_defaultPopoverOptions`) | Add fields to existing bag |

**Supporting infrastructure, not a clobbering site of its own:** `component/button/ToggleButton.ts`. It doesn't hardcode a colour or clobber anything — its constructor just never forwarded a `subclassDefaults` parameter to `Button` at all, which is what blocked `TabButton` from using the standard bag fix. Step 12 adds that parameter so `TabButton`'s bag (Step 13) can reach `Button` through it.

**Not fixed, verified not a bug:** `component/container/WindowHeader.ts:80` (late second `applyOptions` call already lets a caller's value win — see `## Architecture Decisions`).

**Not fixed, no options bag to clobber (design decision, see `## Non-Goals`):** `overlay/Dialog.ts` (`DialogTitleBar` line 213, `DialogButtonRow` line 411, `Dialog` line 589), `overlay/Menu.ts` (`applyPersistentChrome` line 810, `applyRebuildChrome` line 826).

**Explicitly out of scope, not part of this sweep:** every child-component call (`Rail.ts` runtime restore already covered under `## Token Classification`'s Rail row; `TabBar._toolGroup`/`_leadGroup`/`_tabClip`, `ScrollStrip._clip`, `Scrollbar._thumb`, `TabButton._closeButton`, `TabBar`'s internal `TabIndicator`/`TabReorderBar`/`TabDropTint` helper classes) — none of these expose a `ComponentOptions`-shaped bag of their own for a caller to supply a colour to, so there is nothing to clobber.

---

## Ordered Implementation Steps

### Token cleanup (independent of the clobbering-bug fixes; can be done in either order)

#### Step 1 — Remove the two redundant fields from `Theme.ts`

[`Theme.ts`](packages/lib/src/typescript/lib/core/Theme.ts):

1. In the `drawer` interface block ([Theme.ts:495-499](packages/lib/src/typescript/lib/core/Theme.ts#L495-L499)), delete the `background: string;` line, leaving `shadow` and `border`.
2. In the `rail` interface block ([Theme.ts:501-509](packages/lib/src/typescript/lib/core/Theme.ts#L501-L509)), delete the `background: string;` line, leaving `border`, `shadow`, and `handle`.
3. In `themeToVars` ([Theme.ts:958](packages/lib/src/typescript/lib/core/Theme.ts#L958)), delete the `'--ts-ui-drawer-bg' : theme.drawer.background,` line ([Theme.ts:1162](packages/lib/src/typescript/lib/core/Theme.ts#L1162)) and the `'--ts-ui-rail-bg' : theme.rail.background,` line ([Theme.ts:1165](packages/lib/src/typescript/lib/core/Theme.ts#L1165)).

**Verification checkpoint:** `grep -n "ts-ui-drawer-bg\|ts-ui-rail-bg" packages/lib/src/typescript/lib/core/Theme.ts` — zero matches.

#### Step 2 — Remove the matching `background` line from all three theme objects

For each of [`ModernTheme.ts`](packages/lib/src/typescript/lib/core/themes/ModernTheme.ts), [`DarkTheme.ts`](packages/lib/src/typescript/lib/core/themes/DarkTheme.ts), [`ClassicTheme.ts`](packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts): delete the `background: 'var(--ts-ui-body-bg)',` line from both the `drawer` block and the `rail` block. Exact lines:

| File | `drawer.background` line | `rail.background` line |
|---|---|---|
| `ModernTheme.ts` | 285 | 290 |
| `DarkTheme.ts` | 274 | 279 |
| `ClassicTheme.ts` | 279 | 284 |

Leave the surrounding `shadow`, `border`, and (for `rail`) `handle` fields untouched.

**Verification checkpoint:** `grep -n "background: 'var(--ts-ui-body-bg)'" packages/lib/src/typescript/lib/core/themes/*.ts` — zero matches (this was the only place in any theme file using that literal).

#### Step 3 — Re-point `Drawer.ts` at `--ts-ui-body-bg`

[`Drawer.ts:124`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L124): in `_defaultDrawerOptions`, change

```ts
backgroundColor: "var(--ts-ui-drawer-bg)",
```

to

```ts
backgroundColor: "var(--ts-ui-body-bg)",
```

**Verification checkpoint:** `grep -n "ts-ui-drawer-bg" packages/lib/src/typescript/lib/overlay/Drawer.ts` — zero matches.

#### Step 4 — Re-point `Rail.ts` at `--ts-ui-body-bg` (two call sites)

`Rail.ts` has two sites, not one — the default option and a runtime restore:

1. [`Rail.ts:211`](packages/lib/src/typescript/lib/overlay/Rail.ts#L211), in `_defaultRailOptions`: change `backgroundColor: "var(--ts-ui-rail-bg)",` to `backgroundColor: "var(--ts-ui-body-bg)",`.
2. [`Rail.ts:533`](packages/lib/src/typescript/lib/overlay/Rail.ts#L533), inside `applyCollapseStyling(false)` (the expanded-state branch): change `this.setBackgroundColor("var(--ts-ui-rail-bg)");` to `this.setBackgroundColor("var(--ts-ui-body-bg)");`.

**Verification checkpoint:** `grep -n "ts-ui-rail-bg" packages/lib/src/typescript/lib/overlay/Rail.ts` — zero matches.

#### Step 5 — Update `Rail.md`'s theming table

[`docs/components/Rail.md`](packages/lib/docs/components/Rail.md), the "Theming" section token table (around line 95): delete the `| \`--ts-ui-rail-bg\` | Strip background |` row — the strip is no longer independently themeable, it always mirrors `--ts-ui-body-bg`. `Drawer.md` has no theming token table to update (confirmed by grep — it documents no `--ts-ui-*` tokens today).

**Verification checkpoint:** `grep -rn "ts-ui-rail-bg\|ts-ui-drawer-bg" packages/lib/docs/` — zero matches.

#### Step 6 — Changelog entry (token removal)

[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) currently has `## Added` and `## Fixed` sections only (see `git log --oneline -- packages/lib/docs/reference/changelog/next.md` for recent entries). Add a new `## Breaking changes` section — per the ordering in released changelogs (e.g. [`0.4.0.md`](packages/lib/docs/reference/changelog/0.4.0.md): Breaking changes, Changed, Added, Fixed), it goes **first**, before `## Added`:

```markdown
## Breaking changes

### Theme

`Theme.drawer.background` and `Theme.rail.background` are removed — both
were set to `'var(--ts-ui-body-bg)'` in every shipped theme, a redundant
alias with no per-theme value of its own. `Drawer` and `Rail` still paint an
opaque background by default; they now read `--ts-ui-body-bg` directly, the
same pattern `AbstractWindow` and `Dialog` already use. The rendered colour
is unchanged in every shipped theme. A custom theme that set
`drawer.background` or `rail.background` to something other than
`--ts-ui-body-bg` loses that override — supply a different value via
`Component.setBackgroundColor` on a `Drawer` / `Rail` instance instead.
```

Leave room to add the `## Fixed` entry from Step 21 under the same `## Breaking changes` heading once that step is done — see Step 21 for its exact text and placement.

**Verification checkpoint:** `grep -n "^## " packages/lib/docs/reference/changelog/next.md` shows `## Breaking changes` before `## Added`.

### Clobbering-bug fixes

Each step edits one file. Every step's shape is the same: add or extend a `_default<Class>Options` bag with the clobbered field(s)' literal value, add a `subclassDefaults` constructor parameter if the class doesn't already have one, forward it to `super()`, then delete the imperative call. Run `npm test` (in `packages/lib`) after every 3-4 steps, not just at the end, to localize any regression.

#### Step 7 — `Tree.ts`

[`Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts):

1. Above the `class Tree` declaration, add:
   ```typescript
   /** User-overridable default fill; a caller-supplied `backgroundColor` wins. */
   const _defaultTreeOptions: Partial<TreeOptions> = {
       backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
   };
   ```
2. Change the constructor signature (line 111) from `constructor(options?: TreeOptions) {` to `constructor(options?: TreeOptions, subclassDefaults?: Partial<TreeOptions>) {`.
3. Change `super(options);` (line 112) to `super(options, { ..._defaultTreeOptions, ...(subclassDefaults ?? {}) });`.
4. Delete line 115, `this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");`. Leave `this.setOverflow("hidden");` (line 114) untouched — out of this plan's colour-only scope.

**Verification checkpoint:** `grep -n "setBackgroundColor" packages/lib/src/typescript/lib/component/tree/Tree.ts` — zero matches (the literal now lives only in `_defaultTreeOptions`).

#### Step 8 — `MenuBar.ts`

[`MenuBar.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts):

1. Above `class MenuBar`, add:
   ```typescript
   // Default to the tool bar's background so menu bars and tool bars read as
   // one surface; the shipped themes set --ts-ui-menu-bar-bg to their
   // toolBar.background, and this untokened fallback matches ToolBar's own.
   const _defaultMenuBarOptions: Partial<MenuBarOptions> = {
       backgroundColor: "var(--ts-ui-menu-bar-bg, rgb(245, 245, 245))",
   };
   ```
   (This is the existing comment currently sitting above line 75 — move it here rather than duplicating it.)
2. Change `constructor(options?: MenuBarOptions) {` (line 64) to `constructor(options?: MenuBarOptions, subclassDefaults?: Partial<MenuBarOptions>) {`.
3. Change `super(options);` (line 65) to `super(options, { ..._defaultMenuBarOptions, ...(subclassDefaults ?? {}) });`.
4. Delete line 75 (`this.setBackgroundColor(...)`) and its now-orphaned comment lines 72-74 (moved to step 1 above).

**Verification checkpoint:** `grep -n "setBackgroundColor" packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` — zero matches.

#### Step 9 — `DiagramNode.ts`

[`DiagramNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts):

1. In `_defaultDiagramNodeOptions` ([DiagramNode.ts:39-43](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L39-L43)), add:
   ```typescript
   backgroundColor: "var(--ts-ui-diagram-node-bg, var(--ts-ui-button-bg, rgb(245, 245, 245)))",
   ```
2. Delete line 93, `this.setBackgroundColor("var(--ts-ui-diagram-node-bg, var(--ts-ui-button-bg, rgb(245, 245, 245)))");`.

**Verification checkpoint:** `grep -n "setBackgroundColor" packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` — zero matches (the `.selected` state rule at line 99 uses `selectedStyleRule.set(...)`, not `setBackgroundColor`, and is untouched).

#### Step 10 — `DiagramGroupNode.ts`

[`DiagramGroupNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts):

1. Above `class DiagramGroupNode`, add (mirroring `DiagramNode`'s sibling pattern):
   ```typescript
   const _defaultDiagramGroupNodeOptions: Partial<DiagramGroupNodeOptions> = {
       backgroundColor: "var(--ts-ui-diagram-group-bg, rgba(120, 120, 120, 0.08))",
   };
   ```
   **Do not** put `layoutManager: new Absolute()` in this module-level constant — `_defaultDiagramGroupNodeOptions` is created once and shared by every instance of the class, but a `LayoutManager` holds per-instance `_container` state, so every instance would stomp on the others' layout (see [`Component.ts:496-502`](packages/lib/src/typescript/lib/core/Component.ts#L496-L502)). `DiagramNode.ts` already gets this right — its `layoutManager: new Fit()` stays inline in the `super()` call, spread alongside (not inside) its module-level defaults constant ([DiagramNode.ts:87-91](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L87-L91)). Follow the same shape here.
2. Change `constructor(options?: DiagramGroupNodeOptions) {` (line 52) to `constructor(options?: DiagramGroupNodeOptions, subclassDefaults?: Partial<DiagramGroupNodeOptions>) {`.
3. Change
   ```typescript
   super(options, { layoutManager: new Absolute() });
   ```
   (line 53) to
   ```typescript
   super(options, {
       layoutManager: new Absolute(),
       ..._defaultDiagramGroupNodeOptions,
       ...(subclassDefaults ?? {}),
   });
   ```
   — `layoutManager: new Absolute()` stays a fresh literal on every call, created before the spread so `subclassDefaults` could still override it if a future subclass needed to (matching `DiagramNode`'s ordering).
4. Delete line 60, `this.setBackgroundColor("var(--ts-ui-diagram-group-bg, rgba(120, 120, 120, 0.08))");`.

**Verification checkpoint:** `grep -n "setBackgroundColor" packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts` — zero matches.

#### Step 11 — `ScrollStrip.ts`

[`ScrollStrip.ts`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts):

1. Above `class ScrollStrip`, add:
   ```typescript
   const _defaultScrollStripOptions: Partial<ScrollStripOptions> = {
       backgroundColor: "transparent",
   };
   ```
2. Change `constructor(options?: ScrollStripOptions) {` (line 138) to `constructor(options?: ScrollStripOptions, subclassDefaults?: Partial<ScrollStripOptions>) {`.
3. Change `super(options);` to `super(options, { ..._defaultScrollStripOptions, ...(subclassDefaults ?? {}) });`.
4. Delete line 157, `this.setBackgroundColor("transparent");`. Leave `this._clip.setBackgroundColor("transparent");` (line 161, a child component with no options of its own) untouched.

**Verification checkpoint:** `grep -n "this.setBackgroundColor" packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — zero matches (the remaining `this._clip.setBackgroundColor` and `this._leadArrow?.setBackgroundColor`/`this._trailArrow?.setBackgroundColor` lines are child-component/runtime calls, not the constructor bug).

#### Step 12 — `ToggleButton.ts` (prerequisite retrofit for Step 13)

[`ToggleButton.ts`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts):

1. Change the constructor signature (line 38) from `constructor(text: string, options?: ToggleButtonOptions) {` to `constructor(text: string, options?: ToggleButtonOptions, subclassDefaults?: Partial<ToggleButtonOptions>) {`.
2. Change `super(text);` (line 44) to `super(text, undefined, subclassDefaults);`.
3. Update the comment above the `super` call (lines 39-43) — it currently ends *"...then dispatch the consumer options through `applyOptions` at the tail so Button's own option-backed setters run after children exist."* Add one clause noting `subclassDefaults` is forwarded even though `options` itself still isn't, e.g. append: *"`subclassDefaults` is forwarded regardless, since it only seeds the `_defaultOptions` fallback bag — a separate, independent parameter from `options` — so a subclass's own defaults (e.g. `TabButton`'s tab fill) still layer in even though `options` waits."*

Do not change anything else in this file — `applyOptions`, `isSelected`/`setSelected`, the `.selected` state rule, `on`/`off`, `setFlat`, and `render` are all untouched.

**Verification checkpoint:** `grep -n "subclassDefaults" packages/lib/src/typescript/lib/component/button/ToggleButton.ts` — two matches (the parameter declaration and the `super()` call). `grep -rn "new ToggleButton(" packages/lib/src/typescript/lib packages/lib/tests` — confirm every existing call site passes at most `(text, options)`, so the new trailing parameter doesn't break any of them (it's additive — this is a read-only sanity check, not an edit).

#### Step 13 — `TabButton.ts`

[`TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts):

1. Above `class TabButton` (after the `TabButtonOptions` interface), add:
   ```typescript
   /**
    * User-overridable default fill for the unselected state; a caller-supplied
    * `backgroundColor`/`backgroundImage` wins. Reaches `Button` through
    * `ToggleButton`'s `subclassDefaults` parameter (see `ToggleButton.ts`).
    */
   const _defaultTabButtonOptions: Partial<TabButtonOptions> = {
       backgroundColor: "var(--ts-ui-tab-button-bg, #b8b8c3)",
       backgroundImage: "var(--ts-ui-tab-button-bg, #b8b8c3)",
   };
   ```
2. Change the constructor signature (line 61) from `constructor(text: string, options?: TabButtonOptions) {` to `constructor(text: string, options?: TabButtonOptions, subclassDefaults?: Partial<TabButtonOptions>) {`.
3. Change `super(text);` (line 65) to `super(text, undefined, { ..._defaultTabButtonOptions, ...(subclassDefaults ?? {}) });`. Leave the comment above it (lines 62-64) — it's still accurate (`options` still isn't forwarded to `super`), but update its literal code reference from `` `super(text)` `` to `` `super(text, ...)` `` since the call itself now carries the defaults bag.
4. Also update the comment at line 96 (*"but `super(text)` above passed none, so it wired nothing"*, inside the listener-wiring comment) the same way — the claim ("no `options` forwarded") is still true, only the literal `super(text)` text it quotes has changed shape.
5. In `applyTabStyling()` ([TabButton.ts:122-155](packages/lib/src/typescript/lib/component/button/TabButton.ts#L122-L155)), delete lines 123-124 (`this.setBackgroundColor(...)` and `this.setBackgroundImage(...)`) outright — no guard needed, `super()` already applies the effective value. Leave every other line (border, `clearBorderRadius()`, `clearShadow()`, hover state, selected state) untouched — see `## Architecture Decisions` for why border/shadow/radius stay out of this plan's scope.
6. Update `applyTabStyling()`'s JSDoc ([TabButton.ts:115-121](packages/lib/src/typescript/lib/component/button/TabButton.ts#L115-L121)) — it currently claims the method paints "the tab's unselected, hover, and selected states" and specifically describes the now-deleted background/image routing. Replace it with:
   ```typescript
   /**
    * Paints the tab's border, hover, and selected states from the
    * `--ts-ui-tab-button-*` theme tokens. Runs after `applyOptions()` so these
    * overrides win over `Button`'s inherited chrome defaults — see the call
    * site's comment. The unselected background fill is handled separately, by
    * `_defaultTabButtonOptions` (top of this file), which layers through
    * `ToggleButton`'s `subclassDefaults` forwarding instead.
    */
   ```

**Verification checkpoint:** `grep -n "^        this.setBackgroundColor\|^        this.setBackgroundImage" packages/lib/src/typescript/lib/component/button/TabButton.ts` — zero matches (the two deleted lines were the only ones on `this` directly; `closeButton.setBackgroundColor("transparent")` / `closeButton.setBackgroundImage("none")` at lines 171-172, inside `buildCloseButton()`, are on a locally-built child component and are untouched by this step). `grep -n "_defaultTabButtonOptions" packages/lib/src/typescript/lib/component/button/TabButton.ts` — three matches (the JSDoc comment mention, the declaration, and the `super()` call).

#### Step 14 — `StatusBar.ts`

[`StatusBar.ts`](packages/lib/src/typescript/lib/component/container/StatusBar.ts):

1. In `_defaultStatusBarOptions` ([StatusBar.ts:59-61](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L59-L61)), add:
   ```typescript
   backgroundColor: "var(--ts-ui-statusbar-bg, rgb(245, 245, 245))",
   foregroundColor: "var(--ts-ui-statusbar-color, rgb(60, 60, 60))",
   ```
2. Delete lines 123-124 (`this.setBackgroundColor(...)` and `this.setForegroundColor(...)`).

**Verification checkpoint:** `grep -n "setBackgroundColor\|setForegroundColor" packages/lib/src/typescript/lib/component/container/StatusBar.ts` — zero matches.

#### Step 15 — `TabBar.ts`

[`TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts):

1. Above `class TabBar` (around line 469), add:
   ```typescript
   const _defaultTabBarOptions: Partial<TabBarOptions> = {
       backgroundColor: "var(--ts-ui-tab-toolbar-bg, #eee)",
   };
   ```
2. Change `constructor(options?: TabBarOptions) {` (line 574) to `constructor(options?: TabBarOptions, subclassDefaults?: Partial<TabBarOptions>) {`.
3. Change `super(options);` (line 575) to `super(options, { ..._defaultTabBarOptions, ...(subclassDefaults ?? {}) });`.
4. Delete line 583, `this.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");`. Leave every `this._toolGroup...`, `this._leadGroup...`, and `this._tabClip...` line (children with no options of their own) untouched, including `this._toolGroup.setBackgroundColor(...)` at line 608 and `this._leadGroup.setBackgroundColor("transparent")` at line 622.

**Verification checkpoint:** `grep -n "^        this.setBackgroundColor" packages/lib/src/typescript/lib/component/container/TabBar.ts` — zero matches (only indented `this._toolGroup.`/`this._leadGroup.` child calls remain).

#### Step 16 — `MenuSeparator.ts`

[`MenuSeparator.ts:21`](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L21): change

```typescript
const _defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {};
```

to

```typescript
const _defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {
    backgroundColor: "transparent",
};
```

Delete line 53, `this.setBackgroundColor("transparent");`. The constructor already forwards `subclassDefaults` — no signature change needed.

**Verification checkpoint:** `grep -n "setBackgroundColor" packages/lib/src/typescript/lib/component/container/MenuSeparator.ts` — zero matches.

#### Step 17 — `SortPriorityBadge.ts`

[`SortPriorityBadge.ts`](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts):

1. Above `class SortPriorityBadge`, add:
   ```typescript
   const _defaultSortPriorityBadgeOptions: Partial<SortPriorityBadgeOptions> = {
       backgroundColor: "var(--ts-ui-sort-badge-bg, rgba(0,0,0,0.15))",
       foregroundColor: "var(--ts-ui-sort-badge-color, inherit)",
   };
   ```
2. Change `constructor(options?: SortPriorityBadgeOptions) {` (line 78) to `constructor(options?: SortPriorityBadgeOptions, subclassDefaults?: Partial<SortPriorityBadgeOptions>) {`.
3. Change `super({ tag: "span", ...(options ?? {}) });` (line 81) to `super({ tag: "span", ...(options ?? {}) }, { ..._defaultSortPriorityBadgeOptions, ...(subclassDefaults ?? {}) });`.
4. Delete lines 85-86 (`this.setBackgroundColor(...)` and `this.setForegroundColor(...)`).

**Verification checkpoint:** `grep -n "setBackgroundColor\|setForegroundColor" packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts` — zero matches.

#### Step 18 — `Scrollbar.ts`

[`Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts):

1. Above `class Scrollbar` (around line 324), add:
   ```typescript
   const _defaultScrollbarOptions: Partial<ScrollbarOptions> = {
       backgroundColor: "var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))",
   };
   ```
2. Change `constructor(orientation: AxisOrientation = "vertical", options?: ScrollbarOptions) {` (line 355) to `constructor(orientation: AxisOrientation = "vertical", options?: ScrollbarOptions, subclassDefaults?: Partial<ScrollbarOptions>) {`.
3. Change `super(options);` (line 356) to `super(options, { ..._defaultScrollbarOptions, ...(subclassDefaults ?? {}) });`.
4. Delete line 370, `this.setBackgroundColor("var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))");`. Leave the comment at lines 360-362 (*"Pull arrow configuration out of options ahead of any DOM work... ComponentOptions fields (visible, backgroundColor, etc.) are already applied by super."*) untouched — it sits above the unrelated `arrowStep`/`arrowsEnabled` reads, several lines before the deleted call, not adjacent to it; the comment's claim about `backgroundColor` was already correct about `super()`'s own behaviour and stays correct (it was line 370, sitting seven lines further down, that contradicted it). Leave `this._thumb.setBackgroundColor(...)` (line 386, a child component) untouched.

**Verification checkpoint:** `grep -n "^        this.setBackgroundColor" packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — zero matches (only `this._thumb.setBackgroundColor` calls remain, all on the child).

#### Step 19 — `ToolBarSeparator.ts`

[`ToolBarSeparator.ts:20`](packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts#L20): change

```typescript
const _defaultToolBarSeparatorOptions: Partial<ToolBarSeparatorOptions> = {};
```

to

```typescript
const _defaultToolBarSeparatorOptions: Partial<ToolBarSeparatorOptions> = {
    backgroundColor: "var(--ts-ui-toolbar-separator-color, rgb(220, 220, 220))",
};
```

Delete line 84, `this.setBackgroundColor("var(--ts-ui-toolbar-separator-color, rgb(220, 220, 220))");`. The constructor already forwards `subclassDefaults` — no signature change needed.

**Verification checkpoint:** `grep -n "setBackgroundColor" packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts` — zero matches.

#### Step 20 — `ChartLegend.ts`

[`ChartLegend.ts`](packages/lib/src/typescript/lib/component/chart/ChartLegend.ts):

1. Above `class ChartLegend`, add:
   ```typescript
   const _defaultChartLegendOptions: Partial<ChartLegendOptions> = {
       backgroundColor: "transparent",
   };
   ```
2. Change `constructor(options?: ChartLegendOptions) {` (line 85) to `constructor(options?: ChartLegendOptions, subclassDefaults?: Partial<ChartLegendOptions>) {`.
3. Change `super(options);` (line 86) to `super(options, { ..._defaultChartLegendOptions, ...(subclassDefaults ?? {}) });`.
4. Delete line 88, `this.setBackgroundColor("transparent");`.

**Verification checkpoint:** `grep -n "setBackgroundColor" packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` — zero matches.

#### Step 21 — `Popover.ts`

[`Popover.ts`](packages/lib/src/typescript/lib/overlay/Popover.ts):

1. In `_defaultPopoverOptions` ([Popover.ts:99-104](packages/lib/src/typescript/lib/overlay/Popover.ts#L99-L104)), add:
   ```typescript
   backgroundColor: "var(--ts-ui-popover-bg, rgb(255, 255, 255))",
   foregroundColor: "var(--ts-ui-popover-color, rgb(0, 0, 0))",
   ```
2. Delete lines 190-191 (`this.setBackgroundColor(...)` and `this.setForegroundColor(...)`).

**Verification checkpoint:** `grep -n "setBackgroundColor\|setForegroundColor" packages/lib/src/typescript/lib/overlay/Popover.ts` — zero matches.

Then add the changelog entry for this half of the plan, appended under the SAME `## Breaking changes` heading Step 6 created (a bug fix that changes observable behaviour — a previously-ignored option now works — belongs in the changelog even though it isn't a removal):

```markdown
### Component defaults

Fourteen components — `Tree`, `MenuBar`, `DiagramNode`, `DiagramGroupNode`,
`ScrollStrip`, `TabButton`, `StatusBar`, `TabBar`, `MenuSeparator`,
`SortPriorityBadge`, `Scrollbar`, `ToolBarSeparator`, `ChartLegend`, and
`Popover` — previously ignored a caller-supplied `backgroundColor` (and, on
`StatusBar`, `SortPriorityBadge`, and `Popover`, `foregroundColor`) and
always painted their own hardcoded default instead. Passing either option
now works as documented. No consumer action is needed unless code relied on
the option being silently ignored.
```

**Verification checkpoint:** `grep -n "^## \|^### " packages/lib/docs/reference/changelog/next.md` shows `### Component defaults` nested under the same `## Breaking changes` heading as `### Theme`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Drawer.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Rail.ts` |
| Modify | `packages/lib/docs/components/Rail.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/StatusBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuSeparator.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Popover.ts` |

No files are created or deleted.

---

## Expected Behaviour

All unit-testable **(U)** via the offline `getElement(true)` + cast-to-`any` harness used in `tests/component/Component.test.ts`; none need manual verification for the *override* behaviour itself (visual re-check of the *unchanged default* case is separate, see `## Verification`).

1. **Default unchanged when the caller passes nothing (U).** For every one of the fourteen sites: `new <Class>()` (or the minimal required positional args) renders the same default colour as before this plan — e.g. `new MenuSeparator().getBackgroundColor() === "transparent"`, `new Tree().getBackgroundColor() === "var(--ts-ui-input-bg, rgb(255, 255, 255))"`.
2. **Caller override now wins (U).** For every one of the fourteen sites: passing `backgroundColor` (and, for `StatusBar`/`SortPriorityBadge`/`Popover`, `foregroundColor`) in the options bag makes `getBackgroundColor()`/`getForegroundColor()` return that value instead of the class default — e.g. `new StatusBar({ backgroundColor: "red" }).getBackgroundColor() === "red"`, `new Popover({ foregroundColor: "blue" }).getForegroundColor() === "blue"`. For `TabButton`: `new TabButton("x", { backgroundColor: "red" }).getBackgroundColor() === "red"` and `new TabButton("x", { backgroundImage: "none" }).getBackgroundImage() === "none"`.
3. **`WindowHeader` already honours an override, no test needed to pin new behaviour** — this plan makes no change there; if a regression test is desired it documents current behaviour (`new WindowHeader("t", { backgroundColor: "red" }).getBackgroundColor() === "red"`) rather than pinning a change.
4. **Subclass-default layering still works (U).** For every site that gained a `subclassDefaults` constructor parameter: passing a `subclassDefaults` bag with `backgroundColor` set overrides the class's own `_default<Class>Options.backgroundColor`, per the existing `resolveClassDefaults` layering (already covered by `Component.test.ts`'s existing coverage of this mechanism — no new test needed, this item just confirms none of the fourteen sites break that layering by introducing a bag literal that isn't a plain object).
5. **`ToggleButton`'s new `subclassDefaults` parameter reaches `Button` correctly (U).** `new ToggleButton("x", undefined, { backgroundColor: "green" }).getBackgroundColor() === "green"` — confirms the plumbing added in Step 12 actually forwards through to `Button`'s own `super()` call, independent of `TabButton`. `new ToggleButton("x")` (the parameter omitted) renders unchanged: `Button`'s own `_defaultButtonOptions` ([Button.ts:220-235](packages/lib/src/typescript/lib/component/button/Button.ts#L220-L235)) has no `backgroundColor` entry at all (only `backgroundImage`, the gradient), so `getBackgroundColor()` returns `null`, exactly as it did before this plan.
6. **`TabButton`'s default reaches through two layers of forwarding, and wins a real conflict (U).** `new TabButton("x").getBackgroundColor() === "var(--ts-ui-tab-button-bg, #b8b8c3)"` confirms `_defaultTabButtonOptions.backgroundColor` reaches `_defaultOptions` at all (`Button` contributes no competing value for this key). The sharper case is `getBackgroundImage()`: `Button`'s own default *is* a competing gradient (`_defaultButtonOptions.backgroundImage`), so `new TabButton("x").getBackgroundImage() === "var(--ts-ui-tab-button-bg, #b8b8c3)"` (not the gradient) is the case that actually proves "deepest class wins" — `TabButton`'s value must be spread *after* `Button`'s in the merge for this to hold (see `## Architecture Decisions`).
7. **Token removal (U/M).** `Drawer`/`Rail` still render the same default background colour in all three shipped themes after `--ts-ui-drawer-bg`/`--ts-ui-rail-bg` are removed — **(M)**, since there's no automated coverage of rendered CSS defaults (see `## Verification`).

---

## Verification

- `npm run typecheck` (in `packages/lib`) — the `Theme` interface narrows (two fields removed) and ten constructor signatures (`Tree`, `MenuBar`, `DiagramGroupNode`, `ScrollStrip`, `TabButton`, `TabBar`, `SortPriorityBadge`, `Scrollbar`, `ChartLegend`, and `ToggleButton`) gain a trailing optional parameter; all are checked here.
- `npm run test` (in `packages/lib`) — full suite green; add the `Expected Behaviour` items 1-2 as new cases in `tests/component/Component.test.ts` or co-located per-class test files, following the harness pattern already used there (construct, cast to `any` for private state, `getElement(true)` to force render, read via the public getter).
- Grep invariants:
  - `grep -rn "ts-ui-drawer-bg\|ts-ui-rail-bg" packages/lib/src packages/lib/docs packages/lib/tests` — zero matches anywhere in the package.
  - `grep -rln "this.setBackgroundColor\|this.setForegroundColor\|this.setBackgroundImage" packages/lib/src/typescript/lib/component/tree/Tree.ts packages/lib/src/typescript/lib/component/menubar/MenuBar.ts packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts packages/lib/src/typescript/lib/component/container/ScrollStrip.ts packages/lib/src/typescript/lib/component/container/StatusBar.ts packages/lib/src/typescript/lib/component/container/TabBar.ts packages/lib/src/typescript/lib/component/container/MenuSeparator.ts packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts packages/lib/src/typescript/lib/component/container/Scrollbar.ts packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts packages/lib/src/typescript/lib/component/chart/ChartLegend.ts packages/lib/src/typescript/lib/overlay/Popover.ts` — zero matches on `this` directly (child-component calls like `this._toolGroup.setBackgroundColor` or `this._thumb.setBackgroundColor` are expected to remain and are not matched by this pattern).
  - `grep -n "subclassDefaults" packages/lib/src/typescript/lib/component/button/ToggleButton.ts` — two matches (Step 12's parameter and its `super()` forward). `grep -n "_defaultTabButtonOptions" packages/lib/src/typescript/lib/component/button/TabButton.ts` — three matches (Step 13's JSDoc mention, declaration, and `super()` call).
- Manual visual smoke, since `ComponentStyleRuleSpec` / `setElementCSSRules` have no automated coverage for rendered CSS defaults today: open the app (`npm run dev`), and under each of Modern, Dark, and Classic theme, confirm every one of the fourteen components still renders its pre-existing default look — a `Tree`, a `MenuBar`, a diagram with nodes and group nodes, a scroll-strip-backed widget (e.g. a tab strip), tab buttons, a `StatusBar`, a `MenuSeparator`/`ToolBarSeparator` rule, a sort-priority badge, a scrollbar track, a `ChartLegend`, and a `Popover`. Also open a `Drawer` and a `Rail` to confirm Step 1-6's token removal renders identically. This is a regression check — nothing should look different from before this plan.
- `npm run docs:api` (in `packages/lib`) — 0 warnings.

---

## Documentation Impact

- **`Theme` interface** loses two fields (`drawer.background`, `rail.background`) — `Theme` is exported from the `core` barrel and documented via TypeDoc, so this is a public API surface change. No `{@link}` in existing JSDoc references either field (verified by grep), so no doc-comment cross-reference breaks.
- **`docs/components/Rail.md`** — Step 5 removes the `--ts-ui-rail-bg` table row.
- **`docs/concepts/theming.md`** — does not list either token today (verified by grep); no change needed.
- **Ten constructors gain a `subclassDefaults` parameter** (`Tree`, `MenuBar`, `DiagramGroupNode`, `ScrollStrip`, `TabButton`, `TabBar`, `SortPriorityBadge`, `Scrollbar`, `ChartLegend`, `ToggleButton`) — each is a `@param` addition to the constructor's existing JSDoc (mirroring the wording `StatusBar`/`DiagramNode`/`Popover` already use: *"Per-subclass default bag layered over this class's defaults; subclasses forward their `_default<Class>Options` constant here."*, or, for `ToggleButton` specifically, the forwarding-only wording given in Step 12). No new export, no page to update.
- **Changelog** — Steps 6 and 21.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Theme.ts`](packages/lib/src/typescript/lib/core/Theme.ts) — the `Theme` interface and `themeToVars` CSS-var map.
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:147`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L147) and [`packages/lib/src/typescript/lib/overlay/Dialog.ts:213`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L213) — the existing "consume `--ts-ui-body-bg` directly" pattern this plan extends to `Drawer` / `Rail`.
- [`packages/lib/src/typescript/lib/core/Component.ts:2100`](packages/lib/src/typescript/lib/core/Component.ts#L2100) (`getBackgroundColor`), [`:593`](packages/lib/src/typescript/lib/core/Component.ts#L593) (`applyOptions`), [`:507`](packages/lib/src/typescript/lib/core/Component.ts#L507) (constructor doc comment) — the base mechanism every clobbering-bug fix relies on.
- [`packages/lib/src/typescript/lib/component/container/StatusBar.ts:59-117`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L59-L117) and [`packages/lib/src/typescript/lib/overlay/Popover.ts:95-182`](packages/lib/src/typescript/lib/overlay/Popover.ts#L95-L182) — the two sites that already had the correct scaffold; every "create a new bag" step (7, 8, 10, 11, 13, 15, 17, 18, 20) mirrors their shape exactly.
- [`packages/lib/src/typescript/lib/component/button/Button.ts:429-451`](packages/lib/src/typescript/lib/component/button/Button.ts#L429-L451) — the existing `(text?, options?, subclassDefaults?)` overload and its `super()` merge (`{ ..._defaultButtonOptions, ...(subclassDefaults ?? {}) }`); the pattern Step 12 extends one level up into `ToggleButton`.
- [`packages/lib/src/typescript/lib/core/ComponentDefaults.ts:78-101`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L78-L101) — `resolveClassDefaults`, which resolves the final, cached `_defaultOptions` bag for a concrete class; this is what makes `TabButton`'s defaults reliably win over `Button`'s once forwarded, not just "probably work."
- [`plans/implemented/default-options-pure-fallback.md`](plans/implemented/default-options-pure-fallback.md) — established and shipped the base-class half of this mechanism; this plan applies it at fourteen subclass call sites the earlier rollout didn't reach (they hardcode, they don't merge `_defaultOptions` into `_options`, so they were a different — and in this earlier plan's terms, out of scope — bug shape).
- [`plans/implemented/theme-tokens-and-thin-gray-borders.md`](plans/implemented/theme-tokens-and-thin-gray-borders.md) — nearest precedent for the token-removal half: same `Theme.ts` interface + `themeToVars` + per-theme-object edit sequence, same changelog/doc-impact framing.
- [`packages/lib/src/typescript/lib/component/container/MenuSeparator.ts`](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts) — the worked example cited in `## Architecture Decisions`.

---

## Non-Goals

- **Not sweeping non-colour setters for the same clobbering pattern.** The user separately identified the same bug shape can exist for any option type — border, padding, insets, cursor, overflow, opacity, size constraints, transform, transition, and so on — not just colours. That is scoped as a **separate follow-up audit**, not part of this plan. This plan's fix touches only `backgroundColor`, `foregroundColor`, and `backgroundImage`, matching its existing subject matter (background theme tokens). The fix pattern documented here (hardcoded post-`super()` setter call for a documented `ComponentOptions` field → move the literal into the class's `_default<Class>Options` bag) generalizes directly to that follow-up without needing to re-derive the diagnosis.
- **Not adding a `backgroundColor` override to `Dialog`, `DialogTitleBar`, `DialogButtonRow`, or `Menu`.** None of the four exposes a `ComponentOptions`-shaped bag with `backgroundColor` today (`DialogConfig` and `Menu`'s constructor use custom, narrower shapes). Adding one is new public API surface — a product decision, not a bug fix — and is left for a separate plan if wanted.
- **Not touching `TabButton`'s border, `borderRadius`, `shadow`, hover, or selected styling.** Only its two colour fields move into `_defaultTabButtonOptions` (Step 13); the chrome fields keep their current unconditional overwrite in `applyTabStyling()`, unchanged. The `ToggleButton` retrofit (Step 12) that unblocks the colour fix could carry border/radius/shadow the same way at no extra structural cost — but doing so here would single `TabButton` out from the broader non-colour clobbering-bug class this plan explicitly defers to a separate audit (see the bullet above and `## Architecture Decisions`). Retrofitting `ToggleButton` itself is no longer a non-goal — it's Step 12 — but using that retrofit to reach fields outside this plan's colour-only scope still is.
- **No component's default *paint* behaviour (opaque vs. transparent) changes.** Every component in `## Token Classification` keeps exactly the look it has today when nobody customises anything; this plan only makes the *override* path work.
- **The `DocsSidebar` / `Tree` masking scenario is not fixed by this plan.** `DocsSidebar.ts` constructs its tree via `new Tree()` with no options at all, so Step 7's fix — which only changes what happens when a caller *does* pass `backgroundColor` — has no effect on it (see the footnote in `## Overview`). The plan's purpose is the general clobbering-bug fix, applied uniformly; `DocsSidebar` would need its own follow-up (e.g. passing `backgroundColor` explicitly to its `Tree`) to benefit, and that follow-up is out of scope here (it lives in `packages/docs`, an app, not `packages/lib`).
- **Not consolidating any other `--ts-ui-*-bg` token.** Every token audited in `## Token Classification` besides `drawer.background` / `rail.background` verified as genuinely distinct per theme, or already transparent, or has no default at all.

---

## Notes

[^scope-of-fix]: `MenuSeparator` and `ToolBarSeparator` are the two sites that already have both a `_default<Class>Options` bag (empty) and a `subclassDefaults` parameter — someone already added the scaffold in anticipation of a field landing there, per the comment on each: *"Empty subclass-default const so the super call follows the framework's `(options, defaults)` shape uniformly."* Their fix is the smallest in this plan: one field added to an existing empty object.

[^windowheader-verified]: Read in full: `WindowHeader`'s constructor calls `super(text)` (no options forwarded to `Header`'s own cascade), hardcodes `_activeBackground` and paints it early, builds every child (title row, control buttons), and only then — at the very end — runs `if (options) { this.applyOptions(options); }`. `Component.applyOptions` dispatches `options.backgroundColor` via `this.setBackgroundColor(options.backgroundColor)` when present ([Component.ts:606](packages/lib/src/typescript/lib/core/Component.ts#L606)), so a caller-supplied value applied at the end of the constructor is the value that survives — the early hardcode is what's *overwritten*, not the other way around, which is the reverse of every other site in `## Clobbering-Bug Fix Sites`.

[^grep-verified]: `grep -n "var(--ts-ui-body-bg)" packages/lib/src/typescript/lib/core/themes/*.ts` returns exactly six lines — the `drawer.background` and `rail.background` fields in each of `ModernTheme.ts`, `DarkTheme.ts`, `ClassicTheme.ts` — confirming no other theme field uses this literal-alias pattern.

[^docssidebar-not-fixed]: `grep -n "backgroundColor\|_tree\b" packages/docs/src/shell/DocsSidebar.ts` shows `this._tree = new Tree();` (no options bag at all) and no `setBackgroundColor` call on `_tree` anywhere in the file, at construction or later. An earlier pass in this session assumed fixing `Tree`'s clobbering bug would incidentally unblock `DocsSidebar`'s scenario; checking `DocsSidebar.ts` directly shows that isn't so — there is no caller-supplied `backgroundColor` for the clobbering bug to have discarded in the first place. Making `DocsSidebar`'s custom background show through its `Tree` would need `DocsSidebar.ts` itself to start passing `backgroundColor` (e.g. `"transparent"`) to `new Tree(...)`, which only then would render correctly once Step 7 lands. That app-side change is not part of this plan.
