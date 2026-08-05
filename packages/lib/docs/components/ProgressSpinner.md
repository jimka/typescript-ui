# ProgressSpinner

[`ProgressSpinner`](/api/component/display/classes/ProgressSpinner) is a circular loading indicator
rendered as a rotating arc. Two usage modes:

- **Inline** — instantiate, size, and add to any parent.
- **Overlay** — call `showOverlay(target)` to mount the spinner as an absolute
  overlay on a target component, complete with a semi-transparent backdrop.
  `hideOverlay()` removes it.

<!-- demo: progressspinner-basic -->
> **Live demo** — two `ProgressSpinner`s at different sizes, spinning via
> the component's own CSS animation.
> [Open the ProgressSpinner page](https://jimka.github.io/typescript-ui/components/ProgressSpinner)
<!-- /demo -->

## Usage

Inline:

```typescript
import { ProgressSpinner } from '@jimka/typescript-ui/component/display';
// No size argument: matches the theme's --ts-ui-font-size and re-syncs on theme change
const inline = ProgressSpinner();
panel.addComponent(inline);

// Explicit pixel size: stays fixed regardless of theme
const fixed = ProgressSpinner(24);
panel.addComponent(fixed);
```

Overlay:

```typescript
const overlay = ProgressSpinner(48);
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
overlay whenever its store fires `'loadingchange'` with `loading: true`.
This happens during `store.load()` for stores backed by an async
[`Proxy`](/api/data/classes/Proxy):

```typescript
const store = new Store(model, ajaxProxy);
const panel = TablePanel(store);

store.load(); // spinner appears, hides automatically when load resolves
```

`AbstractStore.isLoading()` returns the current loading flag if you need
to inspect it from elsewhere.

## Which loading affordance

The library has two, and one question decides between them: **does the
component already exist?**

| The component… | Use | Who drives it |
| --- | --- | --- |
| exists; its data is pending | `showOverlay(target)` / `hideOverlay()` | automatic for store-backed panels — [`TablePanel`](/components/TablePanel) and [`TreeTablePanel`](/components/TreeTablePanel) wire it off the store's `loadingchange` event |
| does not exist yet | the deferred placeholder, via `addComponent(factory, { lazy })` | [`Tab`](/layouts/Tab) mounts the spinner and swaps it for the built child |

Worked examples, one per case:

```typescript
// Case 1 — the panel exists, its rows are loading. Nothing to write:
// TablePanel overlays its own Table whenever the store reports loading.
const panel = TablePanel(store);
store.load();

// Case 2 — the panel does not exist yet, and building it is expensive but sync.
container.addComponent(() => new AdvancedPanel(), Object.assign(new LayoutConstraints(), { name: 'Advanced' }));

// Case 3 — the panel cannot be built until a fetch completes. Same path as
// case 2; the factory is async, and the spinner covers the whole wait.
container.addComponent(
    async () => {
        const columns = await fetchColumns(table);

        return TablePanel(buildStore(table, columns));
    },
    Object.assign(new LayoutConstraints(), { name: table.name }),
);
```

Case 3 is the one with no overlay answer: the content depends on fetched
metadata, so there is no component to overlay at tab-creation time. Reach it
through [`Tab`](/layouts/Tab), or through
[`Dock.addLazyPanel`](/components/Dock) for a docked panel.

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
- [`AbstractStore`](/api/data/classes/AbstractStore) — emits `'loadingchange'`
