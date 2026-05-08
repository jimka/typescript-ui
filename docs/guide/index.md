# Getting Started

Welcome to the documentation for `@jika/typescript-ui`.

This site is under construction. The single-page reference in the project [README](https://github.com/jimka/typescript-ui#readme) covers everything until guide pages are migrated here.

## Installation

```bash
npm install @jika/typescript-ui
```

## Bootstrap

```typescript
import { Body, Window, Button, ThemeManager, DefaultTheme } from '@jika/typescript-ui';

ThemeManager.setTheme(DefaultTheme);

const win = new Window();
win.setHeaderText('Hello');
win.show();
```

## Next steps

- [Concepts](/concepts/) — the framework's mental model.
- [Components](/components/) — per-component reference.
- [Layouts](/layouts/) — the layout managers.
- [API Reference](/api/) — generated TypeDoc output.
