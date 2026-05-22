# ToolBarSeparator

[`ToolBarSeparator`](/api/component/menubar/classes/ToolBarSeparator) is a thin divider rule used inside a [`ToolBar`](/components/ToolBar) to visually group related controls.

Defaults to a vertical rule for the default horizontal [`ToolBar`](/components/ToolBar); pass `orientation: "horizontal"` for a vertical toolbar. The rule colour is theme-driven via `--ts-ui-toolbar-separator-color`.

## Usage

```typescript
import { ToolBar, ToolBarSeparator } from '@jimka/typescript-ui/component/menubar';

const bar = new ToolBar();
bar.addComponent(boldButton);
bar.addComponent(italicButton);
bar.addComponent(new ToolBarSeparator());
bar.addComponent(cutButton);
bar.addComponent(copyButton);
```

For a vertical toolbar:

```typescript
const bar = new ToolBar({ orientation: 'vertical' });
bar.addComponent(buttonA);
bar.addComponent(new ToolBarSeparator({ orientation: 'horizontal' }));
bar.addComponent(buttonB);
```

## Notes

- Fixed pixel thickness: 9 px (see `ToolBarSeparator.THICKNESS`).
- Reports `role="separator"` with a matching `aria-orientation`.
- Stays out of the keyboard tab order (`tabindex="-1"`).
- `ToolBar.setOrientation` does **not** auto-flip child separators. Recreate them with the matching orientation if you flip the parent.

## Theming

`ToolBarSeparator` reads `--ts-ui-toolbar-separator-color` for its rule colour. The token is set in the [`Theme`](/api/core/interfaces/Theme) `toolBar.separatorColor` field.

## See also

- [API: ToolBarSeparator](/api/component/menubar/classes/ToolBarSeparator)
- [`ToolBar`](/components/ToolBar) — primary consumer
- [`MenuSeparator`](/components/MenuSeparator) — sibling for menu panels
