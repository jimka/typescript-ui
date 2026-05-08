# Custom brand theme

Build a theme that reflects your brand by overriding tokens in [`DefaultTheme`](/api/variables/DefaultTheme).

## Goal

A blue-tinted theme with custom button gradients, a softer page background, and a darker pressed state.

## Spread + override

```typescript
import { Theme, ThemeManager, DefaultTheme } from '@jika/typescript-ui';

const BrandTheme: Theme = {
    ...DefaultTheme,

    body: { background: 'rgb(245, 248, 252)' },
    text: { color:      'rgb(20, 30, 50)'   },

    button: {
        ...DefaultTheme.button,
        background: 'linear-gradient(rgb(80, 130, 220), rgb(60, 100, 180))',
        border:     'rgb(50, 90, 160)',
        shadow:     '0 1px 3px rgba(0, 0, 0, 0.15)',
        pressed: {
            ...DefaultTheme.button.pressed,
            background: 'linear-gradient(rgb(40, 80, 160), rgb(30, 60, 130))',
            foreground: 'white',
            shadow:     'inset 0 2px 4px rgba(0, 0, 0, 0.3)',
        },
    },

    border: { ...DefaultTheme.border, color: 'rgb(170, 190, 220)' },
};

ThemeManager.setTheme(BrandTheme);
```

## Apply at startup

Call `setTheme` **before** mounting any component so the first render reads the correct CSS variables:

```typescript
import { ThemeManager, DefaultTheme, Body } from '@jika/typescript-ui';

ThemeManager.setTheme(BrandTheme);

const root = buildAppLayout();
Body.getInstance().addComponent(root);
```

## Switching themes at runtime

`setTheme` rewrites CSS custom properties on `:root` so every component updates without re-rendering:

```typescript
import { Button, Event, ThemeManager, DefaultTheme, DarkTheme } from '@jika/typescript-ui';

const toggle = new Button('Toggle theme');
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
- [API: Theme](/api/interfaces/Theme), [DefaultTheme](/api/variables/DefaultTheme), [DarkTheme](/api/variables/DarkTheme)
