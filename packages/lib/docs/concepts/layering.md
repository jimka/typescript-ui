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

The relationship that matters is the **"opened-from" edge** — which layer this
one was opened from. That is a *runtime* fact, distinct from the static
component hierarchy, and it changes every time a surface opens. When a ComboBox
inside a `Popover` opens its dropdown, the dropdown becomes a **child** of the
popover in the layer tree, even though neither element is a DOM ancestor of the
other (both are siblings under `documentElement`).

`LayerManager.register(layer)` resolves that opener and pushes the new layer
under it; `unregister(layer)` pops it. A layer that tracks its own anchor via
`getAnchorElement` — a dropdown, popover, or rebuild-mode menu already does,
for its own outside-click exclusion — links under whichever registered layer's
DOM subtree physically contains that anchor, regardless of registration order
or which band currently paints in front: neither says anything about which
layer a given anchor actually lives inside once more than one root band
exists (see below). A layer with no anchor to resolve falls back to the
last-registered layer — while a modal layer is open, to the last-registered
layer of its [scope](#modal-scope), since the user can open nothing from a
layer that is inert. Because a nested layer always draws a fresh, higher
counter within the band it inherits, it lands above its opener in the z-order
automatically.

## One containment query across portals

[`LayerManager.containsAcrossLayers(layer, node)`](/api/core/namespaces/LayerManager/functions/containsAcrossLayers)
is the single place the framework reasons about cross-portal containment: it is
`true` when `node` is inside `layer`'s own element **or any descendant layer's
element**. This is why clicking a ComboBox row inside a blur-dismiss popover
keeps the popover open — the click lands in a child layer, which counts as
inside.

The same query answers the focus question. A cell editor's `retainsFocus` asks
"did focus leave my dropdown subtree?" by calling `containsAcrossLayers` rather
than walking a private stack. A cell editor also keeps its edit while a
[context menu opened from the keyboard](/components/Menu#keyboard) inside it
holds focus; that menu returns focus to the editor when it closes.

## Z-index bands

The four historical inline z-index bases (Window 9000, Popover ~9998, dropdowns
~10050, Dialog 10101) are reconciled into one ascending allocator with reserved
bands:

| Band | Base |
|---|---|
| Drawer | 8950 |
| Window | 9000 |
| PinnedWindow | 9400 |
| Popover | 9800 |
| Dropdown | 10000 |
| Notification | 10500 |
| Dialog | 11000 |
| Tooltip | 12000 |

`Notification` and `Tooltip` are not allocated from: they are the fixed stamps
two surfaces that portal without registering as layers give themselves.

A surface reports its band from `getBand()`; an unrelated top-level layer uses
its own band, while a nested layer **inherits its opener's band** (see above)
and rises above it via the per-register counter — unless it returns `true` from
`keepsOwnBand()`. A `Dialog` does, so a modal backdrop always stacks above every
non-modal surface whatever the dialog was opened from. It still links under its
opener, so activation and containment are unchanged.
`LayerManager.setBand(layer, band)` moves an already-registered layer (and its
descendants) into a different band — an always-on-top window uses it to move
into `PinnedWindow` without re-registering; a descendant that keeps its own
band stays in it. The manager assigns `z = band + counter` at register time from
a counter kept **per band**, and compacts a band's live stamps back onto its
base whenever the next one would reach the band above — so a band's headroom
bounds how many of its layers may be open at once, not how many a session may
open in total. `bringToFront` re-stamps only when the raised subtree is not
already on top of its band; a raise that would move nothing allocates nothing.
Surfaces mirror each stamp the manager assigns — the register-time one
included — with their own `setZIndex`, via the optional `onZIndexChanged` hook.

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
  interaction); only Escape, routed through the keydown handler, closes it.
  While one is open the manager also makes everything outside it inert and
  wraps `Tab` inside it — see [Modal scope](#modal-scope). Modal surfaces —
  `Dialog` and a modal `Drawer` — stack in the Dialog band.
- `"manual"` — never auto-dismissed; the host drives `hide()`. Used by windows
  and manual popovers.

A *transient layer* is one whose mode is `"click-outside"` or `"blur"`: the
user's next interaction elsewhere closes it.

When the whole browser window loses focus — the user clicks another application
or alt-tabs away — no in-page `pointerdown` or `focusin` fires, so the window
`blur` handler stands in: it dismisses every `"click-outside"` and `"blur"`
layer as if the interaction had landed outside them all, while a `"modal"` still
shields the layers beneath it and `"manual"` layers stay open.

Dismissal is **advisory**: the manager calls `requestClose()` and the surface
runs its own fade / teardown (and unregisters itself), so each surface keeps its
bespoke animation and re-entrancy guard. `requestClose()` may return `false` to
decline, in which case the manager leaves the Escape unhandled so it reaches the
focused content — `Dialog` does this to release an embedded editor.

## Modal scope

`LayerManager` owns modality. No surface keeps its own idea of "am I the modal
on top", and no component implements a focus trap.

A modal layer is modal because everything outside its scope is `inert`. It
carries no `aria-modal`: that attribute would also hide the layers opened from
the modal, which are mounted beside it and not inside it. See
[Why no `aria-modal`](/concepts/accessibility#why-no-aria-modal).

The *topmost modal* is the last-registered layer whose dismiss mode is
`"modal"`, whatever is stacked above it. Its *scope* is that layer plus every
layer opened from it, directly or through another layer — the same
"opened-from" edge the layer tree already keeps. The manager works both out
again on every `register` and `unregister`.

| Open layers, in the order they opened | Topmost modal | Scope | Inert |
|---|---|---|---|
| window `W` | none | — | nothing |
| `W`, dialog `D1` opened from `W` | `D1` | `D1` | the page, `W`, the `Rail`, toast dismiss buttons |
| `W`, `D1`, dropdown `P` opened from `D1` | `D1` | `D1`, `P` | the page, `W`, … |
| `W`, `D1`, dialog `D2` opened from `D1` | `D2` | `D2` | the page, `W`, `D1`, … |
| `W`, `D1`, window `W2` shown while `D1` is open | `D1` | `D1` | the page, `W`, `W2`, … |

A window is always a top-level layer, so `W2` is not in `D1`'s scope. It is
drawn under `D1`'s backdrop.

### What goes inert

Everything outside the scope carries the HTML `inert` attribute, so the browser
itself refuses it focus — by `Tab`, by a click, and by `focus()` from code —
pointer input, and a place in the accessibility tree. The manager decides, and
each surface writes its own element:

- **Every registered layer outside the scope**, through the optional
  [`onInertChanged(inert)`](/api/core/interfaces/DismissableLayer#oninertchanged)
  hook. A layer that registers while a modal is open is told at once.
- **The page**: every component added to [`Body`](/components/Body), and each
  component the body's layout manager mounts beside them — a `Tab` manager's
  tab strip, an `Accordion`'s headers, a gutter. A component added while a
  modal is open comes up inert.
- **The [`Rail`](/components/Rail)**, while it is mounted.
- **The dismiss button of each toast.** The toast itself is a live region and
  stays readable, so a screen reader still announces it.

The last three are *background surfaces*: they are not layers, and register
with `LayerManager.addBackgroundSurface(surface)`, which calls the surface's
`onInertChanged` with the current state at once.
[`FocusHistory`](/recipes/focus-history) registers one too while it is
enabled. It writes no element; the call tells it that a modal layer opened or
closed.

Both hooks are called again on every later register and unregister of any
layer, also when the value has not changed for that surface, so keep them cheap
to repeat; `setInertAttribute` returns early for a value it already has. For
the same reason a value your own code sets with `setInertAttribute` on a layer
or on a component added to `Body` does not last: the manager writes its own
the next time any layer opens or closes.

Nothing is ever written to `<body>` or `<html>`. The library marks its own
containers and leaves the rest of the document alone, so what a browser
extension injects next to them keeps working: the inline menu a password
manager shows beside a login field in a dialog is the case this protects. It
also means an element your own code appends to `<body>` or `<html>` by hand is
not inert while a dialog is open. Build an overlay as a
[`Popover`](/components/Popover) or [`PopupPanel`](/components/PopupPanel), or
register it yourself as a layer or a background surface. A modal's own backdrop
is never inert, so `closeOnBackdrop` keeps working.

`element.focus()` on something behind a modal does nothing until the modal
closes. A modal surface that returns focus to its opener must therefore do so
after it has unregistered, as `Dialog` and `Drawer` do. And a layer disposed
while it is open must unregister in its destructor: left in the tree with its
element gone, it is written to when the next modal opens.

### Tab wraps at the edges

`inert` keeps focus from landing behind the modal, but it does not wrap: `Tab`
from the last control would go on to the browser's own toolbar.
[`LayerManager.containTab(e)`](/api/core/namespaces/LayerManager/functions/containTab)
does the wrap, and the manager's `keydown` listener calls it for every `Tab`.

A *stop* is a visible, enabled, focusable element. Each layer of the scope has
its own list of stops, and the lists are joined — the modal first, then the
layers opened from it — into one ring. Take a dialog with stops `Close`, `Name`
and `Type`, and a dropdown opened from `Type` with one stop, `List`:

| Focus is on | Key | Result | Consumed |
|---|---|---|---|
| `Name` | `Tab` | the browser moves focus to `Type` | no |
| `Type` (last stop of its layer) | `Tab` | `List` | yes |
| `List` (last stop of the ring) | `Tab` | `Close` | yes |
| `Close` (first stop of its layer) | `Shift+Tab` | `List` | yes |
| `List` | `Shift+Tab` | `Type` | yes |
| a stop inside a Tab-key owner | `Tab` | the editor or table keeps the key | no |
| `<body>`, or an element that is not a stop | `Tab` | the browser moves focus | no |
| anything in the scope or `<body>`, and the scope has no stop | `Tab` | nothing moves | yes |
| anything, and an earlier listener already handled the key | `Tab` | nothing | no |
| anything | `Ctrl+Tab`, `Alt+Tab`, `Meta+Tab` | nothing: not focus traversal | no |

The function acts only at a layer's first or last stop; every other `Tab` stays
with the browser. From `<body>` — where focus rests after a click on a dialog's
text — the browser moves focus by itself, and with the application inert the
only places it can land are inside the scope, in the browser's own toolbar, or
on an element that is not the library's.

A layer that closes itself on `Tab` and hands focus back to its opener calls
`containTab(e)` itself and returns the result, because only then is focus on a
stop. `Menu`'s keyboard session does.

A layer that stays registered while it closes — a dropdown does, for the
length of its fade-out — returns `true` from the optional `isLayerClosing()`
for that time. Its stops are left out of the ring: they are about to leave the
document, and focus moved onto one would be dropped on `<body>`.

A `Tab` pressed on an element outside the scope is never consumed, also when
the scope has no stop. Such an element is live, so it is not the library's.

Four queries read the same state:

- `LayerManager.hasModalLayer()` is `true` while any registered layer is modal,
  wherever it sits in the stack.
- `LayerManager.isBehindModal(node)` is `true` when a modal is open and `node`
  lies outside its scope.
- `LayerManager.isInTransientLayer(node)` is `true` when the layer `node` lives
  in is [transient](#dismiss-modes). Only that layer is asked, not the one it
  was opened from.
- `LayerManager.hasActiveInputLayer()` is `true` while any layer is open that
  is not `"manual"`.

`FocusTraversal` stands down on the first.
[`FocusHistory`](/recipes/focus-history) also uses the first: while a modal is
open it records nothing, its `back()` and `forward()` move nothing, and its
`canGoBack()` and `canGoForward()` are `false`. It records nothing inside a
transient layer either, and its accelerators stand down on
`hasActiveInputLayer()`, as `SpatialNavigation` does.

## Implementing a new layer

```typescript
import { LayerManager, DismissableLayer, LayerDismissMode } from '@jimka/typescript-ui/core';

class MyOverlay extends Component implements DismissableLayer {
    getLayerElement(): HTMLElement | null { return this.getElement(); }
    getDismissMode(): LayerDismissMode    { return "click-outside"; }
    getBand(): number                     { return LayerManager.Band.Dropdown; }
    requestClose(): void                  { this.hide(); }
    onInertChanged(inert: boolean): void  { this.setInertAttribute(inert); }

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

A layer without `onInertChanged` stays focusable and clickable behind a modal
dialog, so implement it: one line, as above.

[`Menu`](/api/overlay/classes/Menu) is on the manager too.
[`Tooltip`](/api/overlay/classes/Tooltip) and `Notification` portal without
registering — neither is dismissable and neither opens anything — and take
their z from `LayerManager.Band.Tooltip` and `LayerManager.Band.Notification`
rather than from the allocator. A toast holds a button, so it registers as a
background surface instead (see [Modal scope](#modal-scope)); a tooltip holds
nothing focusable and is left alone.
