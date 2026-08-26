# TabWindow

[`TabWindow`](/api/overlay/classes/TabWindow) is a floating, draggable, resizable window whose interior **is** a [`Tab`](/api/layout/classes/Tab) layout — there is no separate title-bar header. The tab bar does double duty as the window chrome: the active tab's label is the window title, the blank area of the bar is the move handle (double-click it to maximize or restore), and minimize / maximize / close are trailing controls in the bar rather than buttons on a header.

It is the window a strip-mode tab **tear-off** produces (see [`Tab` › Tear-off & re-dock](/layouts/Tab#tear-off-re-dock)). Tearing a tab out of a reorderable strip opens a `TabWindow` hosting the tab's live content, so the float shows a single bar — the tab plus its controls — instead of a window header stacked above an inner strip.

`TabWindow` extends [`AbstractWindow`](/components/AbstractWindow), which owns the header-agnostic window machinery (resize borders, the move flow, the three-state lifecycle, z-order, show/hide). The two concrete windows — `Window` and `TabWindow` — differ only in their chrome.

## Usage

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { TabWindow } from '@jimka/typescript-ui/overlay';

import { Panel } from '@jimka/typescript-ui/core';

const win = TabWindow({ x: 240, y: 120, width: 360, height: 240 });
win.createTab(Panel({ name: 'Console' }));   // tab label + window title
Body.init({ components: [win] });
win.show();
```

Most code does not construct a `TabWindow` directly — it is produced automatically when a tab is torn off a strip in the default `"strip"` detach mode.

## Construction

`TabWindow(options?)` — there is **no** title positional argument (unlike [`Window`](/components/Window)); the title is derived from the active tab, not set. `options` is a [`WindowOptions`](/api/overlay/interfaces/WindowOptions) bag and accepts the same geometry / state / snap-resize fields as `Window` (minus the header-only `headerText`, which has no slot on a headerless window).

| Option | Type | Purpose |
| --- | --- | --- |
| `x` / `y` | `number` | Initial top-left corner in viewport coordinates. |
| `width` / `height` | `number` | Initial size in pixels. |
| `glyph` | `string` | Leading window icon pinned to the start of the bar (a title icon, like [`Window`](/components/Window)'s). Defaults to `window-maximize`; change it at runtime with `setGlyph`. |
| `closeable` | `boolean` | Enables the trailing close control. Driven thereafter by the strip — the close control greys while any hosted tab is non-closeable. |
| `minimizable` | `boolean` | Show the trailing minimize control. |
| `maximizable` | `boolean` | Show the trailing maximize control. |
| `resizable` | `boolean` | Enable the drag-to-resize border strips. Default `true`. |
| `windowState` | `"normal" \| "minimized" \| "maximized"` | Initial lifecycle state. |
| `snapResizeEnabled` / `snapThreshold` / `snapModifier` | — | Same Ctrl-snap-resize behaviour as [`Window`](/components/Window#snap-resize-modifier). |
| `constrainToViewport` | `boolean` | Keep the window inside the viewport while dragging. |

Inherits all [`PanelOptions`](/api/core/interfaces/PanelOptions) / [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields. See [`Window` › Construction](/components/Window#construction) for the shared option semantics.

## Anatomy

```
┌─ TabWindow (layout manager = Tab) ─────────────────────────┐
│  Tab BAR:  [ Console ][ Logs ]            [▁][□][✕]         │ ← drag blank area = move
│  Tab CONTENT: the active tab's component fills the rest      │
│  8× resize-border overlays (from AbstractWindow)            │
└─────────────────────────────────────────────────────────────┘
```

There is no inner `Panel` and no second `Tab` — the `TabWindow`'s own `Tab` *is* the strip. The bar is the title bar; the controls are trailing tools; the empty bar area moves the window, and double-clicking it maximizes or restores.

## Common methods

| Method | Purpose |
| --- | --- |
| `createTab(content)` | Add a content component as a new tab (and as a window child, for layout and serialization). The first tab added supplies the window's title. |
| `show()` | Display the window and bring it to the front. |
| `setSize(w, h)` / `setPosition(x, y)` | Initial geometry. |
| `toggleMinimize()` / `toggleMaximize()` | Drive the matching lifecycle transition — the same actions the trailing controls invoke. |
| `requestClose()` | Begin the close teardown — the action the trailing close control invokes. |
| `setGlyph(name)` | Swap the leading window icon at runtime — parity with [`Window.setGlyph`](/components/Window). |

The window has no `setHeaderText` / `getHeader` — there is no header. The title is read live from the active tab via the `Tab`'s [`getActiveTabLabel()`](/api/layout/classes/Tab#getactivetablabel); it is never set on the window directly.

## Title, move & controls

- **Title** — derived, not set. [`AbstractWindow`](/components/AbstractWindow) exposes a read-only title concept used by serialization; `TabWindow` resolves it from the active tab's label. Switching the active tab changes the title.
- **Window glyph** — a decorative leading icon pinned to the start of the bar (before the first tab), mirroring [`Window`](/components/Window)'s title icon. Defaults to `window-maximize`, overridable via the `glyph` option or `setGlyph` at runtime. It is `pointer-events: none`, so a press on it falls through to the move gesture.
- **Move** — a press on the bar's blank area (not on a tab, a tool, or the scrollable tab clip) starts a window move. This is wired through the [`Tab`](/api/layout/classes/Tab) strip's empty-area move trigger, so a press on a tab still selects it and a press on a control still fires that control.
- **Minimize / maximize / close** — three chromeless controls pinned to the trailing end of the bar, wired to `toggleMinimize()` / `toggleMaximize()` / `requestClose()`. `minimizable` / `maximizable` toggle their visibility; `closeable` toggles the close control's enabled state.
- **Focus state** — on blur the whole bar flattens to the unfocused gutter fill (`--ts-ui-gutter-bg`) reaching the window edges, and the three controls flatten with it; refocus restores the themed toolbar fill and the opaque control backgrounds. This mirrors how [`Window`](/components/Window) flattens its header on blur.

## Non-closeable contract

A non-closeable tab keeps its contract in window form. The strip pushes the every-tab-closeable state into the window, so the trailing close control greys — and window close is disabled — while any hosted tab is non-closeable. The content can then only be re-docked, never destroyed by the close control. Removing the non-closeable tab re-enables close.

## Gotchas

- A `TabWindow` is floating chrome, not part of its parent's layout flow — same as [`Window`](/components/Window#gotchas).
- Serialization round-trips a torn-off `TabWindow` back to a header [`Window`](/components/Window) on restore — restoring it as a `TabWindow` is out of scope.

## See also

- [API: TabWindow](/api/overlay/classes/TabWindow)
- [`AbstractWindow`](/components/AbstractWindow) — the shared window base class
- [`Window`](/components/Window) — the header window sibling
- [`Tab` › Tear-off & re-dock](/layouts/Tab#tear-off-re-dock) — what produces a `TabWindow`
