# Separator

[`Separator`](/api/component/container/classes/Separator) is a general-purpose divider rule — the framework's `<hr>` — usable in any container, in either direction.

<!-- demo: separator-basic -->
> **Live demo** — two `Text` rows in a `VBox`, divided by a horizontal
> `Separator` that spans the column's width.
> [Open the Separator page](https://jimka.github.io/typescript-ui/components/Separator)
<!-- /demo -->

## Usage

A horizontal rule in a `VBox` column:

```typescript
import { VBox } from '@jimka/typescript-ui/layout';
import { Separator } from '@jimka/typescript-ui/component/container';

const panel = new Panel({ layoutManager: new VBox() });
panel.addComponent(topText);
panel.addComponent(new Separator());
panel.addComponent(bottomText);
```

A vertical rule in an `HBox` row:

```typescript
import { HBox } from '@jimka/typescript-ui/layout';

const panel = new Panel({ layoutManager: new HBox() });
panel.addComponent(leftButton);
panel.addComponent(new Separator({ orientation: 'vertical' }));
panel.addComponent(rightButton);
```

## Notes

- `orientation` names the direction the rule runs and defaults to `"horizontal"`, matching `<hr>`. It must be the *opposite* of the direction the parent container stacks children, because the rule runs across the stack:

  | Container | Children stack | Use | Rule spans |
  |---|---|---|---|
  | `VBox` | top-to-bottom | `Separator()` (horizontal) | the column's width |
  | `HBox` | left-to-right | `Separator({ orientation: "vertical" })` | the row's height |

  `Separator` does not read its parent and does not auto-flip — the wrong orientation renders as nothing, since the rule then takes its own preferred extent of `0` along its own axis.
- Fixed pixel thickness: 1 px (`Separator.THICKNESS`). There is no `thickness` option.
- Reports `role="separator"` with a matching `aria-orientation`.
- Stays out of the keyboard tab order (`tabindex="-1"`).
- The rule spans its container by writing a cross-axis `fill` constraint on the parent's layout manager, which [`HBox`](/api/layout/classes/HBox) and [`VBox`](/api/layout/classes/VBox) read as per-child align-self, overriding the box's `itemAlign`. A caller-supplied `fill` constraint is left untouched. Other layout managers that don't consult `fill` (e.g. `Absolute`) render the separator at its preferred size — zero along its own axis.

## Theming

`Separator` reads `--ts-ui-border-color` for its rule colour, the framework's general dividing-line token. The token is set in the [`Theme`](/api/core/interfaces/Theme) `border.color` field; override per instance with the `backgroundColor` option.

## See also

- [API: Separator](/api/component/container/classes/Separator)
- [`ToolBarSeparator`](/components/ToolBarSeparator) — the host-bound sibling this component generalises
- [`MenuSeparator`](/components/MenuSeparator) — sibling for menu panels
- [`Spacer`](/components/Spacer)
- [`HBox`](/api/layout/classes/HBox)
- [`VBox`](/api/layout/classes/VBox)
