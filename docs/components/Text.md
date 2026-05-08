# Text

[`Text`](/api/classes/Text) is the underlying text-rendering primitive used by [`Label`](/components/Label), [`Legend`](/components/Legend), and other text components. It uses an off-screen probe element to measure text dimensions and automatically updates the preferred size whenever the text or a font property changes.

In day-to-day code you will usually reach for [`Label`](/components/Label) or [`Header`](/components/Header) instead. Use `Text` directly when you need bespoke text rendering with no semantic wrapper element.

## Usage

```typescript
import { Text } from '@jika/typescript-ui';

const status = new Text('span', 'Connected');
status.setFontWeight('bold');
status.setForegroundColor('rgb(60, 160, 60)');

panel.addComponent(status);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getText()` / `setText(text)` | Text content. |
| `setFontFamily(value)` / `setFontSize(value)` / `setLineHeight(value)` | Font controls. |
| `setFontWeight(value)` / `setFontStyle(value)` / `setFontVariant(value)` | Font style controls. |
| `setTextAlign(value)` / `setTextShadow(value)` | Text appearance. |
| `dispose()` | Detach the theme-change listener — call this before removing a `Text` from the page so the listener doesn't leak. |

## Memory leaks

`Text` subscribes to the active theme on construction so it can re-measure itself on every theme change. **Custom components that create `Text` instances dynamically** and remove them must call `text.dispose()` to detach the listener. The framework does this automatically for built-in components.

## See also

- [API: Text](/api/classes/Text)
- [`Label`](/components/Label), [`Header`](/components/Header), [`Legend`](/components/Legend) — the typical wrappers
