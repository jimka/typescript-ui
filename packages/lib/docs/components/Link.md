# Link

[`Link`](/api/component/input/classes/Link) is a text link: link-coloured, underlined, and activated by a click or the Enter key. It is a [`Text`](/components/Text) subclass rendering a real `<a>`, so **its hit area is exactly its text**.

That is the reason to prefer it over a chromeless [`Button`](/components/Button): a button carries padding and a content row, so its click target overshoots its label even when compact. A `Link`'s box is the glyph box.

`Link` has **no `href`** — it navigates nothing by itself. Activation is always `on('action', fn)`, which suits in-app navigation (opening a tab, revealing a panel) rather than following a URL.

## Usage

```typescript
import { Link } from '@jimka/typescript-ui/component/input';

const link = Link('Open the release notes', {
    listeners: { action: () => openReleaseNotes() },
});

panel.addComponent(link);
```

`on('action', fn)` is the imperative equivalent of the `listeners` bag:

```typescript
const link = Link('Open the release notes');
link.on('action', () => openReleaseNotes());
```

Enter activates the link; **Space does not**, because Space is button semantics — the WAI-ARIA link pattern activates on Enter alone.

## Common methods

| Method | Purpose |
| --- | --- |
| `on('action', fn)` / `off('action', fn)` | Register / remove an activation handler. Fires for both click and Enter. |
| `click()` | Action the link programmatically, as if clicked. With no handler registered it does nothing. |
| `isInteractive()` / `setInteractive(value)` | Whether the link is focusable and keyboard-activatable. See below. |
| `dispose()` | Detach the keyboard listener and the inherited theme listener — call before removing a `Link` from the page. |

Everything on [`Text`](/components/Text) — `setText`, the font controls, `centerInHeight` — is inherited.

## Presentational links

`interactive: false` makes a link presentational: it keeps its appearance but claims no `role` and no `tabindex`, and it does not activate on Enter.

```typescript
const cellLink = Link('orders', { interactive: false });
```

This is for a link inside a container that owns its own keyboard navigation and click routing, where a focusable child would fight the host. The shipped example is [`LinkCellRenderer`](/api/component/table/classes/LinkCellRenderer), which composes exactly this so a table cell never takes tab focus and every click stays the `Table`'s to route through `cellclick`.

It is **not** a disabled state: the link looks normal, and a host that routes its own clicks still acts on them.

## Removing the underline

The underline is a class-level rule (`.Link`), not per-instance state — one CSS rule serves every link on the page. A caller's `styleRules` entry is scoped to the component's id, and an id outranks a class, so passing one overrides it:

```typescript
const bare = Link('No underline', {
    styleRules: [{ suffix: '', styles: { textDecoration: 'none' } }],
});
```

There is deliberately no `--ts-ui-link-underline` theme token: an underline is not a colour, and the rule above is the escape hatch. The link colour *is* themeable, via `--ts-ui-link-color`.

## The hit area follows the parent

The hit area equals the text only while the parent sizes the link to its preferred width. A `Fit` parent, or an `HBox`/`VBox` with `stretching: true`, widens the box — and the hit area with it. `HBox` and `VBox` default to `stretching: false`, so an ordinary row is safe:

```typescript
const row = new Component();
row.setLayoutManager(new HBox());
row.addComponent(Text('Docs:'));
row.addComponent(Link('Open the release notes', { listeners: { action: open } }));
```

Note also that `Text`'s inherited `truncate` default ellipsises the text in a narrow parent.

## Memory leaks

`Link` registers a keyboard listener on construction and inherits `Text`'s theme subscription. A link created dynamically and removed from the page must be `dispose()`d to release both.

## See also

- [API: Link](/api/component/input/classes/Link)
- [`Text`](/components/Text) — the base class; use it for text with no affordance
- [`Button`](/components/Button) — when you want a button's chrome and hit area
- [API: LinkCellRenderer](/api/component/table/classes/LinkCellRenderer) — link-styled table cells
