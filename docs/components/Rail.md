# Rail

[`Rail`](/api/overlay/classes/Rail) is a persistent, edge-anchored launcher strip. It floats along one viewport edge holding a column (WEST/EAST) or row (NORTH/SOUTH) of handle buttons. It is the persistent counterpart to the [`Drawer`](/components/Drawer): unlike a drawer it never slides off-screen and is never auto-dismissed — it is always present.

A rail mounts on `document.documentElement` as a `Position.FIXED` overlay and carries a fixed z-index just below the window band, so windows, popovers, and dialogs still stack above it. It is deliberately **not** a [`DismissableLayer`](/api/core/interfaces/DismissableLayer) — there is no outside-click or Escape dismissal to wire.

## Mounting a rail

A rail does not display until `mount()`; `unmount()` detaches it again. Registered drawers and windows survive an unmount, so a later `mount()` restores a working strip.

```typescript
import { Rail, Drawer } from '@jimka/typescript-ui/overlay';

import { Placement } from '@jimka/typescript-ui/primitive';
import { VBox } from '@jimka/typescript-ui/layout';

const rail = Rail({ edge: Placement.WEST }).mount();

const filters = Drawer({ layoutManager: VBox() });
filters.addComponent(myFilterForm);
rail.registerDrawer(filters, { glyph: 'filter', text: 'Filters' });
```

## Edges and thickness

The `edge` option reuses the compass primitive [`Placement`](/api/primitive/enumerations/Placement) (minus `CENTER`), exposed as [`RailEdge`](/api/overlay/type-aliases/RailEdge). WEST/EAST rails lay their handles out vertically (a column); NORTH/SOUTH rails lay them out horizontally (a row). The main axis always spans the full viewport.

| `edge` | Anchors against | Handle axis |
| --- | --- | --- |
| `Placement.WEST` | Left, full height | vertical (column) |
| `Placement.EAST` | Right, full height | vertical (column) |
| `Placement.NORTH` | Top, full width | horizontal (row) |
| `Placement.SOUTH` | Bottom, full width | horizontal (row) |

By default the rail **sizes its cross axis to its handles** — the width of the widest handle for a WEST/EAST rail, the height of the tallest for NORTH/SOUTH — re-derived as handles are added or removed and when the [orientation](#handle-text-orientation) changes (rotated labels need far less width). Set `thickness` to pin an explicit cross-axis size in pixels instead.

## Handle text orientation

On the vertical (WEST/EAST) sides, the `orientation` option controls how handle labels read — mirroring the [`Tab`](/api/layout/classes/Tab) layout's orientation vocabulary. It is ignored on NORTH/SOUTH, where labels are always horizontal.

| `orientation` | Handle text |
| --- | --- |
| `"horizontal"` (default) | Upright, beside the glyph |
| `"vertical-cw"` | Rotated 90° clockwise — reads top-to-bottom (`writing-mode: sideways-rl`) |
| `"vertical-ccw"` | Rotated the other way — reads bottom-to-top (`writing-mode: sideways-lr`) |

It is implemented with CSS `writing-mode` (not `transform: rotate`), so the rotated label still reports an accurate box for handle sizing. Change it at runtime with `setOrientation`.

```typescript
const rail = Rail({ edge: Placement.WEST, orientation: 'vertical-cw' }).mount();
```

## Hosting drawers

`registerDrawer(drawer, options?)` adds a [`RailHandle`](/api/overlay/classes/RailHandle) for the drawer and wires it both ways:

- Clicking the handle calls `drawer.toggle()`.
- The handle's selected wash mirrors the drawer's open/closed state — subscribed through the drawer's public `on("open"|"close")`, so the handle stays correct even when the drawer is toggled from elsewhere.
- By default the drawer's edge is aligned to the rail's edge so it slides out from the rail. Pass `alignEdge: false` to leave the drawer's edge untouched.

`unregisterDrawer(drawer)` removes the handle and detaches every subscription; it does **not** close or destroy the drawer — the caller owns the drawer's lifecycle.

```typescript
rail.registerDrawer(infoDrawer, { glyph: 'circle-info', text: 'Info' });
rail.registerDrawer(sideDrawer, { text: 'Other', alignEdge: false });
```

## Minimizing a window into the rail

A [`Window`](/components/Window) (or any [`AbstractWindow`](/components/AbstractWindow)) can minimize *into* a rail instead of the built-in bottom-of-viewport dock strip. Call `window.setRail(rail)`: while minimized the window is hidden and represented by a rail handle bearing its title and glyph; clicking the handle restores it to its prior position. Closing the window removes the handle.

```typescript
const win = Window('Inspector', { minimizable: true });
win.setRail(rail);
win.show();
```

Passing `null` to `setRail` detaches the rail and falls back to the built-in strip. The opt-in is per window; windows without a rail keep docking along the bottom edge as before.

## Events

| Event | Fires | Listener |
| --- | --- | --- |
| `register` | A drawer or window is added to the rail | `(target) => void` |
| `unregister` | A drawer or window is removed | `(target) => void` |

Listeners can also be supplied at construction via the `listeners` option bag. The matching window-side events (`minimize` / `restore` / `close`, see [`WindowEvent`](/api/overlay/type-aliases/WindowEvent)) are what the rail subscribes to internally.

## Theming

The strip and its handles read these tokens (see [theming](/concepts/theming)):

| Token | Purpose |
| --- | --- |
| `--ts-ui-rail-bg` | Strip background |
| `--ts-ui-rail-border` | Divider on the content-facing edge |
| `--ts-ui-rail-shadow` | Strip drop shadow |
| `--ts-ui-rail-handle-hover-bg` | Handle hover wash |
| `--ts-ui-rail-handle-selected-bg` | Handle selected wash (drawer open / window restorable) |

## See also

- [API: Rail](/api/overlay/classes/Rail)
- [API: RailOptions](/api/overlay/interfaces/RailOptions), [RailEdge](/api/overlay/type-aliases/RailEdge), [RailOrientation](/api/overlay/type-aliases/RailOrientation), [RailEvent](/api/overlay/type-aliases/RailEvent), [RailDrawerRegistration](/api/overlay/interfaces/RailDrawerRegistration)
- [API: RailHandle](/api/overlay/classes/RailHandle), [RailHandleOptions](/api/overlay/interfaces/RailHandleOptions)
- [Drawer](/components/Drawer) — the overlay panel a rail toggles
- [Window](/components/Window) — minimizes into a rail via `setRail`
