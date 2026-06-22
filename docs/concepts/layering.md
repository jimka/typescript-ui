# Layering

Four portaled-overlay surfaces — [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown)
(and every picker / ComboBox dropdown that extends it),
[`Popover`](/api/overlay/classes/Popover), [`Window`](/api/overlay/classes/Window),
and [`Dialog`](/api/overlay/classes/Dialog) — all render outside their logical
parent, mounted directly on `document.documentElement`. Each one has to answer
the same three questions:

- **Stacking** — is this surface drawn above the one it opened from?
- **Activation** — which surface is currently "active" (e.g. a window's
  highlighted title bar)?
- **Dismissal** — did an interaction land inside my subtree, *including any
  portaled descendant layer*, or outside it?

A single namespace, [`LayerManager`](/api/core/namespaces/LayerManager), owns
all three. Each surface implements the structural
[`DismissableLayer`](/api/core/interfaces/DismissableLayer) interface and
registers itself on show / unregisters on hide; the manager keeps one runtime
layer tree and one set of document-level listeners.

## The runtime layer tree

The relationship that matters is the **"opened-from" edge** — which layer was
topmost when this one opened. That is a *runtime* fact, distinct from the static
component hierarchy, and it changes every time a surface opens. When a ComboBox
inside a `Popover` opens its dropdown, the dropdown becomes a **child** of the
popover in the layer tree, even though neither element is a DOM ancestor of the
other (both are siblings under `documentElement`).

`LayerManager.register(layer)` pushes the new layer under the current topmost
layer; `unregister(layer)` pops it. Because a nested layer always registers
*after* its opener, it lands above its opener in the z-order automatically.

## One containment query across portals

[`LayerManager.containsAcrossLayers(layer, node)`](/api/core/namespaces/LayerManager/functions/containsAcrossLayers)
is the single place the framework reasons about cross-portal containment: it is
`true` when `node` is inside `layer`'s own element **or any descendant layer's
element**. This is why clicking a ComboBox row inside a blur-dismiss popover
keeps the popover open — the click lands in a child layer, which counts as
inside.

The same query answers the focus question. A cell editor's `retainsFocus` asks
"did focus leave my dropdown subtree?" by calling `containsAcrossLayers` rather
than walking a private stack.

## Z-index bands

The four historical inline z-index bases (Window 9000, Popover ~9998, dropdowns
~10050, Dialog 10101) are reconciled into one ascending allocator with reserved
bands:

| Band | Base |
|---|---|
| Window | 9000 |
| Popover | 9800 |
| Dropdown | 10000 |
| Dialog | 11000 |

A surface reports its band from `getBand()`; an unrelated top-level layer uses
its own band, while a nested layer **inherits its opener's band** and rises
above it via the per-register counter. The manager assigns `z = band + counter`
at register time; surfaces mirror it with their own `setZIndex` and re-mirror on
`bringToFront` via the optional `onZIndexChanged` hook.

## Dismiss modes

Each layer reports a [`LayerDismissMode`](/api/core/type-aliases/LayerDismissMode)
from `getDismissMode()`, and the manager's document-level `pointerdown` /
`focusin` / `keydown` / window `blur` handlers walk the tree top-down and act
only on layers whose mode matches:

- `"click-outside"` — closed by a `pointerdown` outside the layer's subtree and
  its anchor. Used by dropdowns.
- `"blur"` — closed by an outside `pointerdown` **or** an outside focus move.
  Used by blur-dismiss popovers.
- `"modal"` — never dismissed by an outside interaction (it captures the
  interaction); only Escape, routed through the keydown handler, closes it. Used
  by dialogs, which keep their own Tab focus-trap.
- `"manual"` — never auto-dismissed; the host drives `hide()`. Used by windows
  and manual popovers.

When the whole browser window loses focus — the user clicks another application
or alt-tabs away — no in-page `pointerdown` or `focusin` fires, so the window
`blur` handler stands in: it dismisses every `"click-outside"` and `"blur"`
layer as if the interaction had landed outside them all, while a `"modal"` still
shields the layers beneath it and `"manual"` layers stay open.

Dismissal is **advisory**: the manager calls `requestClose()` and the surface
runs its own fade / teardown (and unregisters itself), so each surface keeps its
bespoke animation and re-entrancy guard.

## Implementing a new layer

```typescript
import { LayerManager, DismissableLayer, LayerDismissMode } from '@jimka/typescript-ui/core';

class MyOverlay extends Component implements DismissableLayer {
    getLayerElement(): HTMLElement | null { return this.getElement(); }
    getDismissMode(): LayerDismissMode    { return "click-outside"; }
    getBand(): number                     { return LayerManager.Band.Dropdown; }
    requestClose(): void                  { this.hide(); }

    show(): void {
        LayerManager.register(this);
        this.setZIndex(LayerManager.getZIndex(this));
        /* …mount + position… */
    }

    hide(): void {
        LayerManager.unregister(this);
        /* …fade + detach… */
    }
}
```

[`Menu`](/api/overlay/classes/Menu), [`Tooltip`](/api/overlay/classes/Tooltip), and
`Notification` also portal but are not yet on the manager; they keep their own
listeners and can fold in later.
