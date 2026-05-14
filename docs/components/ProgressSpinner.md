# ProgressSpinner

[`ProgressSpinner`](/api/component/display/classes/ProgressSpinner) is a circular loading indicator
rendered as a rotating arc. Two usage modes:

- **Inline** — instantiate, size, and add to any parent.
- **Overlay** — call `showOverlay(target)` to mount the spinner as an absolute
  overlay on a target component, complete with a semi-transparent backdrop.
  `hideOverlay()` removes it.

## Usage

Inline:

```typescript
import { ProgressSpinner } from '@jimka/typescript-ui/component/display';
// No size argument: matches the theme's --ts-ui-font-size and re-syncs on theme change
const inline = new ProgressSpinner();
panel.addComponent(inline);

// Explicit pixel size: stays fixed regardless of theme
const fixed = new ProgressSpinner(24);
panel.addComponent(fixed);
```

Overlay:

```typescript
const overlay = new ProgressSpinner(48);
overlay.showOverlay(targetPanel);

doAsyncWork().finally(() => overlay.hideOverlay());
```

Calling `setSpinnerSize(n)` later disables theme tracking; the spinner stays at the explicit size.

## Common methods

| Method | Purpose |
| --- | --- |
| `getSpinnerSize()` / `setSpinnerSize(n)` | Read / write the diameter in pixels. |
| `showOverlay(target)` | Mount as an absolute overlay over `target`. |
| `hideOverlay()` | Remove the overlay. |
| `isOverlay()` | Whether the spinner is currently mounted as an overlay. |

## Loading overlays on `TablePanel`

A [`TablePanel`](/components/TablePanel) automatically shows a `ProgressSpinner`
overlay whenever its store fires `'loadingchanged'` with `loading: true`.
This happens during `store.load()` for stores backed by an async
[`Proxy`](/api/data/classes/Proxy):

```typescript
const store = new Store(model, ajaxProxy);
const panel = new TablePanel(store);

store.load(); // spinner appears, hides automatically when load resolves
```

`AbstractStore.isLoading()` returns the current loading flag if you need
to inspect it from elsewhere.

## Theming

| Token | Default | Dark |
| --- | --- | --- |
| `progressSpinner.color`    | `rgb(30, 100, 200)`        | `rgb(60, 130, 220)`        |
| `progressSpinner.backdrop` | `rgba(255, 255, 255, 0.6)` | `rgba(20, 20, 20, 0.6)`    |
| `progressSpinner.size`     | `32px`                     | `32px`                     |

## See also

- [API: ProgressSpinner](/api/component/display/classes/ProgressSpinner)
- [`ProgressBar`](/components/ProgressBar) — a horizontal alternative
- [`TablePanel`](/components/TablePanel) — auto-overlays during `store.load()`
- [`AbstractStore`](/api/data/classes/AbstractStore) — emits `'loadingchanged'`
