# Drawer

[`Drawer`](/api/overlay/classes/Drawer) is an edge-anchored panel that rests off-screen against a viewport edge and slides into view when opened, overlaying the rest of the UI. Unlike [`Dialog`](/components/Dialog) (centred, promise-driven, always modal) it is a bare content host driven by a public `open()` / `close()` / `toggle()` API, and it can be modal *or* non-modal.

It reuses the framework's floating-layer infrastructure wholesale: it mounts on `document.documentElement` and registers with [`LayerManager`](/api/core/namespaces/LayerManager) as a [`DismissableLayer`](/api/core/interfaces/DismissableLayer), so Escape, outside-click capture, and z-stacking behave like every other portaled surface.

## Opening a drawer

A drawer is a content host — add your own children and supply any header / dismiss chrome yourself:

```typescript
import { Drawer } from '@jimka/typescript-ui/overlay';

import { Placement } from '@jimka/typescript-ui/primitive';
import { VBox } from '@jimka/typescript-ui/layout';

const drawer = Drawer({ edge: Placement.EAST, modal: true, layoutManager: VBox() });
drawer.addComponent(myFilterForm);
drawer.open();
```

## Edges

The `edge` option reuses the compass primitive [`Placement`](/api/primitive/enumerations/Placement) (minus `CENTER`). The four edges set both the resting geometry and the slide axis:

| `edge` | Rests against | Slides in from |
| --- | --- | --- |
| `Placement.WEST` | Left, full height | the left |
| `Placement.EAST` | Right, full height | the right |
| `Placement.NORTH` | Top, full width | the top |
| `Placement.SOUTH` | Bottom, full width | the bottom |

`size` is the drawer's extent along its slide axis — width for left/right, height for top/bottom. It is set via the `setDrawerSize` / `getDrawerSize` setter pair rather than the inherited two-axis `Component.setSize(size)`.

## Modal vs. non-modal

| | Modal (`modal: true`) | Non-modal (`modal: false`, default) |
| --- | --- | --- |
| Scrim | Draws a blocking `DialogBackdrop` | None |
| Outside click | Captured; clicking the scrim closes the drawer | App stays interactive; outside clicks are ignored |
| Escape | Closes the drawer | Ignored |
| Closing | Scrim-click / Escape / public API | Public API only |

A non-modal drawer is deliberately *sticky* — a persistent side panel (navigation, filters) that vanished on the first click into the app behind it would be hostile. Callers who want outside-click-to-close on a non-modal drawer can wire it against the public API themselves.

## Animation

Opening slides the panel in from off-screen via `transform: translate(...)` over `durationMs` (default 220 ms); the scrim fades in lockstep. Closing reverses the slide and fades the scrim out. `prefers-reduced-motion: reduce` skips the transitions: the drawer appears / disappears instantly, and the `open` / `close` events still fire.

The panel instance and its child subtree are retained across open/close — the element is detached on close but never re-parented — so re-opening is cheap and descendant CSS transitions survive.

## Vetoing a close

The `beforeclose` event is cancelable. Its listener receives a controller whose `preventDefault()` aborts the close — useful for an unsaved-changes guard:

```typescript
drawer.on('beforeclose', (controller) => {
    if (hasUnsavedChanges()) {
        controller.preventDefault();
    }
});
```

## Events

| Event | Fires | Listener |
| --- | --- | --- |
| `open` | After the entrance transition starts | `() => void` |
| `close` | After the exit transition completes | `() => void` |
| `beforeclose` | Before a close begins (cancelable) | `(controller) => void` |

Listeners can also be supplied at construction via the `listeners` option bag.

## See also

- [API: Drawer](/api/overlay/classes/Drawer)
- [API: DrawerOptions](/api/overlay/interfaces/DrawerOptions), [DrawerEdge](/api/overlay/type-aliases/DrawerEdge), [DrawerEvent](/api/overlay/type-aliases/DrawerEvent), [DrawerCloseController](/api/overlay/interfaces/DrawerCloseController)
- [Dialog](/components/Dialog) — centred, promise-driven modal
- [Rail](/components/Rail) — persistent edge strip whose handles toggle drawers
