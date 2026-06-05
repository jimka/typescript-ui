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

## Theme keys

The [`Theme`](/api/core/interfaces/Theme) interface uses nested objects grouped by component. All keys are required, but [`defineTheme`](/api/core/functions/defineTheme) deep-merges your overrides onto a base so you only declare the ones you change (see [Custom themes](#custom-themes) below).

| Key path | CSS variable | Affects |
| --- | --- | --- |
| `colorScheme` | *(set directly as `color-scheme`)* | Browser rendering of native controls (checkboxes, scrollbars). Use `'light'` or `'dark'`. |
| `font.family` | `--ts-ui-font-family` | Font family for the entire UI (cascades from `<html>`) |
| `font.size` | `--ts-ui-font-size` | Base font size for the entire UI |
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
| `tab.toolbar.background` | `--ts-ui-tab-toolbar-bg` | Background of the tab button toolbar in the [`Tab`](/api/layout/classes/Tab) layout |
| `tab.toolbar.border` | `--ts-ui-tab-toolbar-border` | Bottom border of the tab button toolbar |
| `tab.underBorderFullWidth` | — | Boolean (read from the theme object, not a CSS variable): whether the [`Tab`](/api/layout/classes/Tab) strip draws the edge-to-edge 1px rule under the toolbar. `false` for Modern, `true` for Classic/Dark. An explicit `tabUnderBorderFullWidth` layout option overrides it |
| `tab.button.background` | `--ts-ui-tab-button-bg` | Background of inactive tab buttons |
| `tab.indicator.color` | `--ts-ui-tab-indicator-color` | Fill of the sliding active-tab selection bar |
| `tab.indicator.thickness` | `--ts-ui-tab-indicator-thickness` | Thickness of the active-tab selection bar |
| `window.shadow` | `--ts-ui-window-shadow` | Drop shadow on floating [`Window`](/api/core/classes/Window) components |
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
