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
| `minimizable` | `boolean` | Show the trailing minimize control. Hidden whenever `resizable` is `false`, regardless of this flag. |
| `maximizable` | `boolean` | Show the trailing maximize control. Hidden whenever `resizable` is `false`, regardless of this flag. |
| `resizable` | `boolean` | Enable the drag-to-resize border strips. Default `true`. Also the master switch for `minimizable` / `maximizable` — setting it `false` hides and disables both, and setting it back to `true` restores whatever they were set to. |
| `alwaysOnTop` | `boolean` | Keep the window above every unpinned window. Default `false`. Also toggleable from the leading glyph's window menu. |
| `locked` | `boolean` | Freeze the window: no drag-to-move and no drag-to-resize, and the resize-border strips are hidden. Also disables (never hides) the maximize tool, the bar double-click, and the menu's Maximize/Restore row — maximizing is itself a resize — but leaves minimize and close alone. Default `false`. Also toggleable from the leading glyph's window menu. |
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

There is no inner `Panel` and no second `Tab` — the `TabWindow`'s own `Tab` *is* the strip. The bar is the title bar; the controls are trailing tools; the empty bar area moves the window, and double-clicking it toggles maximize (a no-op while `locked` is `true`) or, on a minimized window, restores it to its pre-minimize state regardless of `locked` — the same carve-out `Minimize` gets.

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
- **Window glyph** — the leading icon pinned to the start of the bar (before the first tab), mirroring [`Window`](/components/Window)'s title icon. Defaults to `window-maximize`, overridable via the `glyph` option or `setGlyph` at runtime. Clicking it opens the same title-icon window menu described in [`Window` › Title-icon menu](/components/Window#title-icon-menu) (Minimize, Maximize, Always on top, Lock position, Close).
- **Move** — a press on the bar's blank area (not on a tab, a tool, or the scrollable tab clip) starts a window move. This is wired through the [`Tab`](/api/layout/classes/Tab) strip's empty-area move trigger, so a press on a tab still selects it and a press on a control still fires that control.
- **Minimize / maximize / close** — three chromeless controls pinned to the trailing end of the bar, wired to `toggleMinimize()` / `toggleMaximize()` / `requestClose()`. `minimizable` / `maximizable` toggle their visibility, but `resizable` overrides both: a non-resizable `TabWindow` hides the minimize and maximize controls regardless of those flags. `closeable` toggles the close control's enabled state; `locked` toggles the maximize control's enabled state the same way, without hiding it.
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
