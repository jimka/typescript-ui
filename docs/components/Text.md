# Text

[`Text`](/api/classes/Text) is the standard component for displaying text. It renders a `<span>` by default and uses an off-screen probe element to measure text dimensions, automatically updating its preferred size whenever the text or a font property changes.

Use `Text` for any standalone text — status messages, captions next to fields, headings, body content. Reach for [`Label`](/components/Label) only when the text is associated with a specific form control via the HTML `for` attribute, or [`Header`](/components/Header) for header bars.

## Usage

```typescript
import { Text } from '@jimka/typescript-ui/component/input';
const status = new Text('Connected');
status.setFontWeight('bold');
status.setForegroundColor('rgb(60, 160, 60)');

panel.addComponent(status);
```

The constructor signature is `new Text(text?, tag = "span")` — the second argument lets subclasses (e.g. `Label`) override the underlying tag.

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
- [`Label`](/components/Label) — when the text is tied to a form control
- [`Header`](/components/Header), [`Legend`](/components/Legend) — semantic wrappers
