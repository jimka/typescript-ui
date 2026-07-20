# Getting Started

Welcome to the documentation for `@jimka/typescript-ui`.

This site is under construction. The single-page reference in the project [README](https://github.com/jimka/typescript-ui#readme) covers everything until guide pages are migrated here.

## Installation

```bash
npm install @jimka/typescript-ui
```

## Bootstrap

```typescript
import { Body, ThemeManager, ClassicTheme } from '@jimka/typescript-ui/core';
import { Window } from '@jimka/typescript-ui/overlay';

ThemeManager.setTheme(ClassicTheme);

const win = Window('Hello');

Body.init({ components: [win] });
win.show();
```

Components and layout managers are callable — `Window('Hello')` works without `new`. Most configuration that has a matching setter (`setSize`, `setBackgroundColor`, ...) can also be passed via a trailing options bag, e.g. `Panel({ layoutManager: HBox(), backgroundColor: '#222', components: [Text('hi')] })`. See [Mental model — JSX-shaped, without JSX](/guide/mental-model#jsx-shaped-without-jsx) for the design rationale.

## Next steps

- [Concepts](/concepts/) — the framework's mental model.
- [Components](/components/) — per-component reference.
- [Layouts](/layouts/) — the layout managers.
- [API Reference](/api/) — generated TypeDoc output.
