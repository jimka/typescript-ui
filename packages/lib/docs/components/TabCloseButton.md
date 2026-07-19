# TabCloseButton

[`TabCloseButton`](/api/component/button/classes/TabCloseButton) is a compact [`Button`](/components/Button) displaying a "×" glyph, sized to sit flush inside a tab header. The [`Tab`](/api/layout/classes/Tab) layout uses it internally for closeable tabs; you'd reach for it directly only when assembling your own tab-strip variant.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { TabCloseButton } from '@jimka/typescript-ui/component/button';
const closeBtn = TabCloseButton();
Event.addListener(closeBtn, 'click', () => closeTab());

tabHeader.addComponent(closeBtn);
```

## Notes

- Inherits all `Button` styling — themed via `button.*` tokens.
- Pre-sized to the standard tab-header glyph footprint; setting an explicit `setPreferredSize` is rarely needed.

## See also

- [API: TabCloseButton](/api/component/button/classes/TabCloseButton)
- [`Tab`](/api/layout/classes/Tab) layout — primary consumer
- [`Button`](/components/Button)
