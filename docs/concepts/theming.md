# Theming

The framework includes a [`ThemeManager`](/api/core/classes/ThemeManager) that applies a set of design tokens to the entire UI at once via CSS custom properties. Theme switches happen in a single function call and take effect immediately — no re-render needed.

## Quick start

```typescript
import { ThemeManager, ClassicTheme, DarkTheme, ModernTheme } from '@jimka/typescript-ui/core';
ThemeManager.setTheme(ModernTheme);  // flat light (the default)
ThemeManager.setTheme(ClassicTheme); // classic gradient light
ThemeManager.setTheme(DarkTheme);    // dark
```

Three built-in themes ship with the package: `ModernTheme` — a flat, gradient-free light theme that is **preselected by default** — alongside `ClassicTheme` (the original gradient light look) and `DarkTheme`. Custom themes are created with [`defineTheme`](/api/core/functions/defineTheme), which deep-merges your tokens onto [`BaseTheme`](/api/core/variables/BaseTheme) or a built-in theme — see [Custom themes](#custom-themes) below.

## How it works

[`setTheme`](/api/core/classes/ThemeManager#settheme) does three things:

1. **Writes each token as a CSS custom property on `:root`** (e.g. `--ts-ui-body-bg`). Because CSS variables cascade, any component that references a variable in its style rule updates automatically — no re-render needed.
2. **Sets `color-scheme` on `:root`** so the browser renders native form elements (checkboxes, scrollbars, `<select>`) in the matching light or dark style.
3. **Sets `color` and `background-color` on both `<html>` and `<body>`.** The `<html>` target is necessary because [`Window`](/api/core/classes/Window) components are appended to `document.documentElement` rather than `document.body`, so text inside floating windows must inherit from `<html>`.
4. **Injects the bundled Manrope `@font-face` on first call.** The library self-hosts the Manrope variable font (Latin + Latin-Ext subsets, weight axis 200–800) and injects its `@font-face` rules into `<head>` the first time `setTheme` runs. So merely rendering a framework theme pulls in the font — no Google Fonts `<link>`, no external request, no extra setup. Because [`Body`](/api/core/classes/Body) calls `setTheme` on construction, any app that mounts the framework gets Manrope automatically. The font registers as `'Manrope Variable'`; text outside the Latin/Latin-Ext ranges falls back to `sans-serif`.

## Theme keys

The [`Theme`](/api/core/interfaces/Theme) interface uses nested objects grouped by component. All keys are required, but [`defineTheme`](/api/core/functions/defineTheme) deep-merges your overrides onto a base so you only declare the ones you change (see [Custom themes](#custom-themes) below).

| Key path | CSS variable | Affects |
| --- | --- | --- |
| `colorScheme` | *(set directly as `color-scheme`)* | Browser rendering of native controls (checkboxes, scrollbars). Use `'light'` or `'dark'`. |
| `font.family` | `--ts-ui-font-family` | Font family for the entire UI (cascades from `<html>`). Defaults to the bundled, self-hosted Manrope — `'Manrope Variable', sans-serif` — injected on first `setTheme` (see [How it works](#how-it-works)) |
| `font.size` | `--ts-ui-font-size` | Base font size for the entire UI |
| `scale.base` | `--ts-ui-base-size` | Framework scale root in px — the global size knob the `scale.*` ratio tokens multiply. Resolved sizes are read in JS via [`ThemeManager.getResolvedScale()`](/api/core/classes/ThemeManager#getresolvedscale). See [Base size & scaling](#base-size-scaling) |
| `font.linePadding` | `--ts-ui-line-padding` | Vertical leading (e.g. `"2px"`) added to a control's own font size to form its line box: the rendered line height is `calc(1em + var(--ts-ui-line-padding))`, so the leading scales per font size (12px and 14px text get proportionate line boxes from one token). Every text control renders **and** measures against this same arithmetic, so inputs, labels, and `Text` share one baseline. Drives the row-height of `Text`/tables and the baseline alignment math in `HBox`/`Column`/`Grid`. Override per control with `Text.setLineHeight(px)` for a fixed line-height |
| `text.color` | `--ts-ui-text-color` | Default text color for all components |
| `body.background` | `--ts-ui-body-bg` | Page background; also the background of [`Window`](/api/core/classes/Window) |
| `border.color` | `--ts-ui-border-color` | Default border color for [`Window`](/api/core/classes/Window) and other bordered components |
| `border.radius` | `--ts-ui-border-radius` | Corner radius applied to [`Button`](/api/component/button/classes/Button) and text-input components |
| `button.background` | `--ts-ui-button-bg` | Background of [`Button`](/api/component/button/classes/Button), window title bars, and table headers |
| `button.border` | `--ts-ui-button-border` | Outline of [`Button`](/api/component/button/classes/Button) and [`ToggleButton`](/api/component/button/classes/ToggleButton) |
| `button.shadow` | `--ts-ui-button-shadow` | Drop shadow on unpressed buttons |
| `button.padding` | `--ts-ui-button-padding` | Padding inside [`Button`](/api/component/button/classes/Button) |
| `button.font.size` | `--ts-ui-button-font-size` | Font size of [`Button`](/api/component/button/classes/Button) labels |
| `button.pressed.background` | `--ts-ui-button-pressed-bg` | Background while a button is held down |
| `button.pressed.foreground` | `--ts-ui-button-pressed-fg` | Text color while a button is held down |
| `button.pressed.shadow` | `--ts-ui-button-pressed-shadow` | Inset shadow on a pressed button |
| `button.hover.background` | `--ts-ui-button-hover-bg` | Background while the pointer is over a button (but not pressed) |
| `button.hover.foreground` | `--ts-ui-button-hover-fg` | Text color while the pointer is over a button (default `inherit`) |
| `button.hover.shadow` | `--ts-ui-button-hover-shadow` | Drop shadow while the pointer is over a button |
| `toggle.selected.background` | `--ts-ui-toggle-selected-bg` | Background of a selected [`ToggleButton`](/api/component/button/classes/ToggleButton) or [`RadioButton`](/api/component/input/classes/RadioButton) |
| `toggle.selected.shadow` | `--ts-ui-toggle-selected-shadow` | Inset shadow on a selected toggle / radio |
| `input.background` | `--ts-ui-input-bg` | Background of text inputs, password fields, text areas, checkboxes, and the table body |
| `input.border` | `--ts-ui-input-border` | Complete CSS border shorthand applied to [`TextInput`](/api/component/input/classes/TextInput), [`ComboBox`](/api/component/input/classes/ComboBox), the three picker fields ([`DateField`](/api/component/input/classes/DateField), [`TimeField`](/api/component/input/classes/TimeField), [`DateTimeField`](/api/component/input/classes/DateTimeField)), their dropdown panels, the autocomplete dropdown, and [`FieldSet`](/api/component/container/classes/FieldSet) |
| `input.borderHover` | `--ts-ui-input-border-hover` | Hover-state border shorthand for the same surfaces — provisioned but not yet wired |
| `indicator.focus` | `--ts-ui-indicator-focus` | Colour for the keyboard-focus indicator. Used through both `border: 2px solid var(...)` on pseudo-element overlays (composites + list) and `box-shadow: inset 0 0 0 2px var(...)` on `<input>` elements (which don't render pseudo-elements). Same visual placement across both code paths |
| `indicator.selection` | `--ts-ui-indicator-selection` | Complete CSS outline shorthand reserved for outline-shaped selection marks distinct from background-tint selection. Provisioned; no current consumers |
| `gutter.background` | `--ts-ui-gutter-bg` | Background of the [`Split`](/api/layout/classes/Split) drag gutter; also used as the scrollbar track color |
| `collapse.strip.background` | `--ts-ui-collapse-strip-bg` | Opaque fill of a collapsed [`Split`](/api/layout/classes/Split) pane / [`Border`](/api/layout/classes/Border) region gutter in its strip state |
| `collapse.strip.size` | `--ts-ui-collapse-strip-size` | Collapsed strip thickness (mirrors the layout constant; thickness is driven in code) |
| `collapse.button.color` | `--ts-ui-collapse-button-color` | Colour of the collapse / restore chevron glyph |
| `tab.toolbar.background` | `--ts-ui-tab-toolbar-bg` | Background of the tab button toolbar in the [`Tab`](/api/layout/classes/Tab) layout |
| `tab.toolbar.border` | `--ts-ui-tab-toolbar-border` | Bottom border of the tab button toolbar |
| `tab.underBorderFullWidth` | — | Boolean (read from the theme object, not a CSS variable): whether the [`Tab`](/api/layout/classes/Tab) strip draws the edge-to-edge 1px rule under the toolbar. `false` for Modern and Dark, `true` for Classic. An explicit `underBorderFullWidth` layout option overrides it |
| `tab.button.background` | `--ts-ui-tab-button-bg` | Background of inactive tab buttons |
| `tab.indicator.color` | `--ts-ui-tab-indicator-color` | Fill of the sliding active-tab selection bar |
| `tab.indicator.thickness` | `--ts-ui-tab-indicator-thickness` | Thickness of the active-tab selection bar |
| `window.shadow` | `--ts-ui-window-shadow` | Drop shadow on floating [`Window`](/api/core/classes/Window) components |
| `window.control.background` | `--ts-ui-window-control-bg` | Resting fill of a [`TabWindow`](/components/TabWindow)'s or [`Window`](/components/Window) header's min/max/close controls; flat themes use the content surface, Classic a raised gradient |
| `window.control.border` | `--ts-ui-window-control-border` | Border of the window controls (`1px solid transparent` when blended; a visible border in Classic) |
| `window.control.shadow` | `--ts-ui-window-control-shadow` | Drop shadow of the window controls (`none` when blended; a raised shadow in Classic) |
| `window.control.hoverBackground` | `--ts-ui-window-control-hover-bg` | Hover fill of the window controls |
| `window.control.activeBackground` | `--ts-ui-window-control-active-bg` | Pressed fill of the window controls |
| `window.header.background` | `--ts-ui-window-header-bg` | Focused fill of an ordinary [`Window`](/components/Window)'s header; valued equal to `tab.toolbar.background` so a header `Window` and a headerless `TabWindow` share one chrome colour (both flatten to `gutter.background` when blurred) |
| `header.font.size` | `--ts-ui-header-font-size` | Font size of window and panel title-bar labels |
| `table.header.background` | `--ts-ui-table-header-bg` | Background fill of the table column header; falls back to `button.background` so headers track the button surface unless given a distinct value |
| `table.header.border` | `--ts-ui-table-header-border` | Bottom border separating the table header from the body |
| `table.header.font.size` | `--ts-ui-table-header-font-size` | Font size of table column header cells |
| `table.row.selected` | `--ts-ui-table-row-selected` | Background tint of the currently selected table row |
| `table.row.new` | `--ts-ui-table-row-new` | Background tint of unsaved new records |
| `table.row.dirty` | `--ts-ui-table-row-dirty` | Background tint of locally modified records |
| `contextMenu.background` | `--ts-ui-context-menu-bg` | Background of the [`Menu`](/api/core/classes/Menu) panel in rebuild mode (right-click) |
| `contextMenu.border` | `--ts-ui-context-menu-border` | Border color of the rebuild-mode `Menu` panel |
| `contextMenu.shadow` | `--ts-ui-context-menu-shadow` | Drop shadow of the rebuild-mode `Menu` panel |
| `contextMenu.item.hoverBackground` | `--ts-ui-context-menu-item-hover-bg` | Background of a rebuild-mode [`MenuItem`](/api/component/container/classes/MenuItem) on hover |
| `contextMenu.item.disabledColor` | `--ts-ui-context-menu-item-disabled-color` | Text color of a disabled rebuild-mode `MenuItem` |
| `contextMenu.separatorColor` | `--ts-ui-context-menu-separator-color` | Color of the rebuild-mode [`MenuSeparator`](/api/component/container/classes/MenuSeparator) line |
| `tooltip.background` | `--ts-ui-tooltip-bg` | Background of the [`Tooltip`](/api/core/classes/Tooltip) panel |
| `tooltip.color` | `--ts-ui-tooltip-color` | Text color inside the `Tooltip` |
| `tooltip.border` | `--ts-ui-tooltip-border` | Border color of the `Tooltip` panel |
| `tooltip.shadow` | `--ts-ui-tooltip-shadow` | Drop shadow of the `Tooltip` panel |
| `notification.shadow` | `--ts-ui-notification-shadow` | Drop shadow applied to all [`Notification`](/api/core/classes/Notification) toasts |
| `notification.info.background` | `--ts-ui-notification-info-bg` | Background of `'info'` notifications |
| `notification.info.border` | `--ts-ui-notification-info-border` | Border color of `'info'` notifications |
| `notification.success.background` | `--ts-ui-notification-success-bg` | Background of `'success'` notifications |
| `notification.success.border` | `--ts-ui-notification-success-border` | Border color of `'success'` notifications |
| `notification.warning.background` | `--ts-ui-notification-warning-bg` | Background of `'warning'` notifications |
| `notification.warning.border` | `--ts-ui-notification-warning-border` | Border color of `'warning'` notifications |
| `notification.error.background` | `--ts-ui-notification-error-bg` | Background of `'error'` notifications |
| `notification.error.border` | `--ts-ui-notification-error-border` | Border color of `'error'` notifications |
| `scroll.shadowColor` | `--ts-ui-scroll-shadow-color` | Start colour of the position-aware edge fade a scrolling [`Panel`](/api/core/classes/Panel) paints on each side that can still be scrolled toward (fades to `transparent`). The fade depth is a framework constant; only the colour is themed. Suppress per panel with `scrollShadows: false` |

::: tip Background tokens accept gradients
`button.background`, `button.pressed.background`, `button.hover.background`, and `toggle.selected.background` accept either a plain colour (`rgb(200, 200, 200)`) or any CSS `background-image` value (`linear-gradient(...)`, `radial-gradient(...)`, etc.). The framework applies the token to both `background-color` and `background-image`; CSS's "invalid at computed-value time" rule routes the value to whichever property it is valid for.
:::

::: info Blue is the single accent colour
One accent blue runs across selection (`table.row.selected`, list/row `selectedBackground`), the keyboard `indicator.focus` ring, and drag-and-drop *position* feedback (the [`ReorderIndicator`](/api/core/classes/ReorderIndicator) bar plus the dock / tab-strip drop-zone wash). The overlap is deliberate — blue means "what you're acting on, or where the action goes." Drag feedback stays distinct from selection by **modality** (it shows only during an active drag, on overlays above the page) and **treatment** (a faint area wash plus a thin moving bar, versus a selection's solid filled state), and the drop-zone wash uses a lighter blue than the accent fill. Don't introduce a second accent hue for drag — rely on treatment and modality. See [Drag-and-drop feedback colours](/recipes/drag-and-drop#drop-feedback-colours).
:::

## Base size & scaling

Most theme sizes are CSS length strings, so they already scale with the font and the cascade. SVG glyphs are the exception: an SVG icon is sized by its px box, not by CSS `font-size`, so a `rem`/`em` length never reaches it. The `scale` block gives the framework one **base size in px** plus a set of ratios, exposed both as a CSS variable and — once resolved — as plain JS numbers, so layout math and SVG glyph boxes can size off `round(base × ratio)`.

- **`--ts-ui-base-size`** is the scale root, emitted from `scale.base` (default `14px`). It is published for CSS `calc()` consumers; the JS side reads the resolved numbers, not this variable.
- **The `scale.*` ratio tokens** are [`ScaleToken`](/api/core/type-aliases/ScaleToken) values. A token is either `{ scale: n }` — a **ratio of the base** that grows with it (`round(base × n)`) — or `{ fixed: px }` — an **absolute px** that opts out of scaling. The built-in tokens (`titleGlyph`, `tabClose`, `tabCloseGlyph`, `tabButtonInset`) are ratios tuned to recover their historic px at the default base, then scale up as you raise it.

Resolution happens **once per `setTheme`**: the whole `scale` block is multiplied out to a numeric [`ResolvedScale`](/api/core/type-aliases/ResolvedScale) snapshot that layout code reads via [`ThemeManager.getResolvedScale()`](/api/core/classes/ThemeManager#getresolvedscale) — no per-layout token math, no `getComputedStyle`.

```typescript
import { ThemeManager } from '@jimka/typescript-ui/core';

const ink = ThemeManager.getResolvedScale().titleGlyph;
// ink === 14 with the default base; set a theme whose scale.base is 28 and it becomes 28.
```

Raise `scale.base` (in a theme passed to `setTheme`) to scale the chrome that follows it — window and tab title glyphs, tab close buttons, and tab insets — or pin an individual token with the `{ fixed }` form to hold it constant while the rest grows. A base change is a theme change, so it goes through `setTheme`, which re-resolves the snapshot and re-runs layout. Text and char-mode glyphs keep sizing off `font.size` / `--ts-ui-font-size`, not the base, so this knob moves the SVG-and-layout chrome without touching the type scale.

::: warning Exactly-one is not type-enforced inside a theme literal
`ScaleToken` is a `{ scale } | { fixed }` union, but a theme literal is a *deep-partial* of [`Theme`](/api/core/interfaces/Theme) (so you can override one token without restating the rest), and that weakens the union to `{ scale? } | { fixed? }` — `{}` or a both-present token is **not** a compile error where you author it. The resolution into the snapshot guards every arm: `scale` wins if both are present, and a token missing both falls back to the base size rather than producing `NaN`.
:::

## Custom themes

Build a theme with [`defineTheme`](/api/core/functions/defineTheme), which deep-merges your overrides onto a base and returns a complete [`Theme`](/api/core/interfaces/Theme) ready for `setTheme`. The recommended base is [`BaseTheme`](/api/core/variables/BaseTheme) — the structural scaffold shared by all three built-ins (sizes, paddings, radii, durations, font sizes). You supply the palette and `colorScheme`; the structure is inherited:

```typescript
import { defineTheme, BaseTheme, ThemeManager } from '@jimka/typescript-ui/core';
const MyTheme = defineTheme(BaseTheme, {
    colorScheme: 'light',
    body: { background: 'rgb(240, 248, 255)' },
    text: { color: 'rgb(10, 30, 60)' },
    button: {
        background: 'linear-gradient(rgb(200, 220, 255), rgb(160, 190, 240))',
    },
    // …the remaining palette tokens…
});

ThemeManager.setTheme(MyTheme);
```

Because the merge recurses into nested objects, overriding a single leaf no longer means spreading its whole bucket: `table: { header: { background: '…' } }` replaces just that one token and leaves every sibling intact. This is the win over the old `...ModernTheme` spread, where forgetting an inner `...ModernTheme.button` spread silently dropped the rest of the bucket.

`BaseTheme` is a scaffold, not a usable theme on its own — it carries no palette, so always wrap it. `defineTheme` does not check completeness at compile time (the overrides are a deep-partial), so a palette token you forget surfaces at runtime as a CSS variable resolving to `undefined`.

### Deriving one theme from another

`defineTheme`'s base may be any full theme, not just `BaseTheme`. Pass a built-in theme to deliberately derive a "same structure, swapped scheme" variant — e.g. a blue-tinted Classic that inherits Classic's whole palette and changes only the button:

```typescript
import { defineTheme, ClassicTheme } from '@jimka/typescript-ui/core';
const BlueClassic = defineTheme(ClassicTheme, {
    button: { background: 'linear-gradient(rgb(80, 130, 220), rgb(60, 100, 180))' },
});
```

Reach for this only when you genuinely want to inherit another theme's *palette* too; the default path for a fresh theme is `defineTheme(BaseTheme, …)`.

Components that need a theme value at construction time (rather than via a CSS variable) can call `ThemeManager.getTheme()` to read the currently active theme.

## Theme change listeners

[`ThemeManager.onThemeChange`](/api/core/classes/ThemeManager#onthemechange) subscribes a callback that fires after every `setTheme` call, once all CSS variables have been written. `Text`-based components ([`Label`](/api/component/input/classes/Label), `Header` labels, table column headers) automatically recalculate their preferred size on each theme change so layout managers see updated dimensions.

```typescript
const unsubscribe = ThemeManager.onThemeChange(() => {
    console.log('theme changed:', ThemeManager.getTheme().colorScheme);
});

// Later, to stop listening:
unsubscribe();
```

::: warning Memory leaks
Custom components that create [`Text`](/api/component/input/classes/Text) instances and are removed from the page should call `text.dispose()` to detach the listener and avoid memory leaks. The framework does this automatically for built-in components, but a `Text` you create yourself is your responsibility.
:::
