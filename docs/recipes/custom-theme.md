# Custom brand theme

Build a theme that reflects your brand by deriving from [`ClassicTheme`](/api/core/variables/ClassicTheme) with [`defineTheme`](/api/core/functions/defineTheme).

## Goal

A blue-tinted theme with custom button gradients, a softer page background, and a darker pressed state.

## Derive with `defineTheme`

This is a "same structure and palette as Classic, swap a few tints" goal, so derive from `ClassicTheme` itself. `defineTheme` deep-merges, so each nested override replaces only the leaves you name — no `...ClassicTheme.button` / `...ClassicTheme.button.pressed` spreads, and the rest of every bucket is inherited automatically:

```typescript
import { defineTheme, ThemeManager, ClassicTheme } from '@jimka/typescript-ui/core';
const BrandTheme = defineTheme(ClassicTheme, {
    body: { background: 'rgb(245, 248, 252)' },
    text: { color:      'rgb(20, 30, 50)'   },

    button: {
        background: 'linear-gradient(rgb(80, 130, 220), rgb(60, 100, 180))',
        border:     'rgb(50, 90, 160)',
        shadow:     '0 1px 3px rgba(0, 0, 0, 0.15)',
        pressed: {
            background: 'linear-gradient(rgb(40, 80, 160), rgb(30, 60, 130))',
            foreground: 'white',
            shadow:     'inset 0 2px 4px rgba(0, 0, 0, 0.3)',
        },
    },

    border: { color: 'rgb(170, 190, 220)' },
});

ThemeManager.setTheme(BrandTheme);
```

To start from the bare structural scaffold instead of inheriting Classic's palette, pass [`BaseTheme`](/api/core/variables/BaseTheme) as the base and supply the full palette yourself — see [Theming › Custom themes](/concepts/theming#custom-themes).

## Apply at startup

Call `setTheme` **before** mounting any component so the first render reads the correct CSS variables:

```typescript
import { ThemeManager, ClassicTheme, Body } from '@jimka/typescript-ui/core';
ThemeManager.setTheme(BrandTheme);

const root = buildAppLayout();
Body.getInstance().addComponent(root);
```

## Switching themes at runtime

`setTheme` rewrites CSS custom properties on `:root` so every component updates without re-rendering:

```typescript
import { Event, ThemeManager, ClassicTheme, DarkTheme } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';
const toggle = Button('Toggle theme');
let dark = false;

Event.addListener(toggle, 'click', () => {
    dark = !dark;
    ThemeManager.setTheme(dark ? DarkTheme : BrandTheme);
});
```

## React to theme changes

Components that derive layout from text dimensions need to re-measure on theme change. The framework does this automatically for built-in [`Text`](/components/Text)-derived components (Label, Header, table cells), but if you compute custom layout from a font metric, subscribe to `onThemeChange`:

```typescript
const unsubscribe = ThemeManager.onThemeChange(() => {
    recomputeMyLayout();
});

// later, when your component is destroyed:
unsubscribe();
```

::: warning Memory leaks
Custom components that subscribe to `onThemeChange` should always store the unsubscribe function and call it on destruction. The framework's automatic cleanup only covers built-in components.
:::

## See also

- [Theming](/concepts/theming) — full token table and behaviour notes
- [API: Theme](/api/core/interfaces/Theme), [defineTheme](/api/core/functions/defineTheme), [BaseTheme](/api/core/variables/BaseTheme), [ClassicTheme](/api/core/variables/ClassicTheme), [DarkTheme](/api/core/variables/DarkTheme)
