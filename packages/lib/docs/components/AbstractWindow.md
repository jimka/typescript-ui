# AbstractWindow

> **Base class.** [`AbstractWindow`](/api/overlay/classes/AbstractWindow) is the abstract base shared by [`Window`](/components/Window) and [`TabWindow`](/components/TabWindow). It is **not** directly instantiable — construct one of its concrete subclasses instead.

`AbstractWindow` extends [`Panel`](/api/core/classes/Panel) and holds every part of a floating window that does not name a header — the *header-agnostic machinery*. Each subclass supplies the chrome (a [`WindowHeader`](/api/component/container/classes/WindowHeader) for `Window`, a [`Tab`](/api/layout/classes/Tab) bar for `TabWindow`) and implements a small set of hooks; the base owns the rest.

## What the base owns

| Concern | What it covers |
| --- | --- |
| **Resize borders** | The eight border-strip overlays and the resize drag flow, appended and positioned generically. `setResizable` / `isResizable` toggle the whole affordance off — hiding all eight strips and disarming the Ctrl-snap detector. Move is unaffected, but `resizable` is the master switch for minimize/maximize too — see below. |
| **Move** | The drag-to-move flow — origin snapshot, viewport clamping, and the drag listeners. Subclasses only choose *where* the move gesture is installed. |
| **Window state** | `setWindowState` / `getWindowState`, `toggleMinimize` / `toggleMaximize`, `isMaximized` / `isMinimized`, the maximize / minimize geometry, the restore-rect cache, and the minimized-window dock stack. |
| **Closeable / minimizable / maximizable** | `setCloseable` / `isCloseable`, `setMinimizable` / `isMinimizable`, `setMaximizable` / `isMaximizable` — the base stores the state and delegates the UI reflection to a subclass hook. `requestClose` and the exit-action teardown. `isMinimizable` / `isMaximizable` report the *effective* value: `false` whenever `isResizable()` is `false`, whatever `minimizable` / `maximizable` were set to — `resizable` is the master switch. The caller's own setting is remembered underneath and takes effect again once `resizable` is re-enabled. |
| **Active focus** | `onActivate` tracks the active state; the subclass paints it. |
| **Z-order** | Stacking via the auto-managed `z-index` band, `bringToFront`, and the dismissable-layer contract. |
| **Show / hide** | Visibility, the window element + overlay creation, and the body-host discovery used to hide content on minimize. |
| **Title concept** | A read-only title used by serialization — `Window` reads it from the header text, `TabWindow` from the active tab's label. There is no generic title *writer* on the base. |
| **Min-size seed** | The default minimum size is seeded from a subclass-provided content-width value, and `setWidth` / `setHeight` clamp to it. |
| **Open-window registry** | `getOpenWindows()` returns every open window — both `Window`s and `TabWindow`s — as `AbstractWindow[]`. |

## What subclasses provide

Each concrete window implements a handful of protected hooks the base calls — how the move gesture is wired, how closeable / minimizable / maximizable reflect into the UI, how the active state is painted, the title read, the chrome height, and how content is added. `Window` routes these through its header; `TabWindow` routes them through its tab bar and trailing controls. See the [API reference](/api/overlay/classes/AbstractWindow) for the full hook list.

## Why a base class

`Window` and `TabWindow` share a large body of behaviour — resize, move, state, z-order, show/hide — and differ only in their chrome. Hoisting the shared machinery into `AbstractWindow` keeps that behaviour in one place and lets serialization and the open-window registry treat any window uniformly (`instanceof AbstractWindow`), while each subclass stays responsible for exactly one kind of chrome.

## See also

- [API: AbstractWindow](/api/overlay/classes/AbstractWindow)
- [`Window`](/components/Window) — the header window subclass
- [`TabWindow`](/components/TabWindow) — the headerless tab-bar window subclass
