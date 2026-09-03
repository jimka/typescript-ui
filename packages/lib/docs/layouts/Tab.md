# Tab

[`Tab`](/api/layout/classes/Tab) renders a row of tab buttons above the container content area and shows exactly one child component at a time based on the selected tab. Tab labels come from `LayoutConstraints.name` when supplied; otherwise they use the component's ID.

```
+------+------+------+--------+
| Tab1 | Tab2 | Tab3 |        |   ← toolbar
+------+------+------+--------+
|                              |
|     [active tab content]     |
|                              |
+------------------------------+
```

::: tip Composed from a `TabBar`
The strip chrome — the toolbar, tab buttons, selection indicator, reorder bar,
tool group, overflow scrolling, and all tab drag-and-drop — is a standalone,
window-agnostic [`TabBar`](/components/TabBar) component that `Tab` owns and
drives. `Tab` itself is the *content* manager (selected panel, lazy-load,
tear-off, docking) and reacts to the bar's semantic events. This is an internal
composition: there is no consumer-facing behaviour change, and the `Tab` /
`TabPanel` surface is unchanged.
:::

<!-- demo: tab-strip -->
> **Live demo** — three tabs over labelled panels, selected by clicking the
> strip.
> [Open the Tab page](https://jimka.github.io/typescript-ui/layouts/Tab)
<!-- /demo -->

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Tab } from '@jimka/typescript-ui/layout';
const tabbed = Component();
tabbed.setLayoutManager(Tab({
    listeners: { tabclose: removed => console.log('closed', removed.getId()) },
}));

tabbed.addComponent(generalPanel,   { name: 'General'  });
tabbed.addComponent(networkPanel,   { name: 'Network'  });
tabbed.addComponent(advancedPanel,  { name: 'Advanced' });
```

[`TabOptions`](/api/layout/interfaces/TabOptions) accepts a `listeners` bag declaratively; call `on(event, fn)` for runtime wiring.

## Events

| Event | Payload | Fires when |
| --- | --- | --- |
| `tabclose` | the removed content component | A tab is **closed** (close button or context-menu Close). |
| `beforetabclose` | the content about to close, and a [`TabCloseController`](/api/layout/interfaces/TabCloseController) | A **user** close is about to run — the ✕, the context menu's *Close*, or a bulk-close row — before the tab is torn down. |
| `empty` | none | The strip loses its **last** tab by any path — close, [tear-off, or re-dock](#tear-off-re-dock). |
| `detach` | the torn-off [`Window`](/components/Window) | A tab is **torn off** into a new floating window — fires for *every* tear-off, even one that leaves siblings behind. |

`empty` is a passive announcement: the `Tab` fires it but does nothing itself, so a strip you place deliberately stays on screen when emptied. A dock layer can subscribe to it to clean up — [`DockRegion`](/layouts/DockRegion) listens on the stacks it creates to remove an emptied stack and collapse a leftover single-pane [`Split`](/layouts/Split). It is orthogonal to `tabclose`: a close-button close fires `tabclose` (with the content) and then, if that was the last tab, `empty` (with none); a tear-off fires `detach` (with the new window) and, only when it drained the strip, `empty` too. `detach` is what lets a dock fold *every* tear-off into its model — [`Dock`](/api/overlay/classes/Dock) schedules an adoption sweep on it — since `empty` alone misses a tear-off that keeps siblings.

`beforetabclose` fires only on the **user** close path — the ✕, the context menu's *Close* row, and every bulk-close row all converge on the same strip-level close and share this one guard. The programmatic [`closeTab`](/api/layout/classes/Tab#closetab) is **not** guarded by it, so a listener that vetoes a user close can later finish that close itself by calling `closeTab` without re-triggering its own veto. Calling the controller's `preventDefault()` aborts the close; the tab stays open and no `tabclose` fires for it.

A close **destroys** the content: once every `tabclose` listener has run, `Tab` disposes the removed component, releasing its element, handles, and per-instance stylesheet rules. A listener that re-parents the content during `tabclose` (`otherContainer.moveComponent(content)`) keeps it alive with no flag needed — it has an owner again by the time the destroy check runs. `disposeOnClose: false` opts out unconditionally, for a component the caller holds and intends to re-use.

## Per-child constraints

| Field | Purpose |
| --- | --- |
| `name` | Per-placement tab button label override (see resolution below). |
| `closeable` | When `true`, render a [`TabCloseButton`](/components/TabCloseButton) inside the tab button. |
| `glyph` | Optional registry glyph name shown leading the tab button's label (dispatched to the button's `setGlyph`). Also the value `setTabGlyph` updates, so a runtime icon change survives a tear-off, a re-dock and a saved layout. |
| `disposeOnClose` | Whether closing this tab destroys its content. Defaults to `true`; pass `false` for a component you hold and intend to re-use after the tab closes. |

A tab button's label resolves in priority order: the per-placement `name` constraint above, then the component's intrinsic [`name`](/api/core/classes/Component#getname) (which travels with it across moves and tear-offs), then its `id` as a last resort. So a component constructed with `{ name: "Console" }` labels its tab automatically — and its torn-off window title too — without any constraint, while the constraint stays available to override the label for a specific placement.

## Renaming and re-iconing a tab

The label resolved at creation is otherwise frozen — `setTabName(content, name)` relabels a live tab's button and re-lays out the strip:

```typescript
layout.setTabName(consolePanel, 'Console •');
```

Returns `true` when `content` has a tab, `false` otherwise.

A tab's leading icon is likewise frozen at creation. `setTabGlyph(content, glyph)` swaps it for a live tab, and `clearTabGlyph(content)` removes it; both write back to the tab's `glyph` constraint, so the change survives a tear-off, a re-dock, or a saved-and-restored layout:

```typescript
layout.setTabGlyph(consolePanel, 'triangle-exclamation');
// ...
layout.clearTabGlyph(consolePanel);
```

Both return `true` when `content` has a tab, `false` otherwise — including for a lazy tab whose factory has not run yet, since it has no content component to key on. [`TabBar`](/components/TabBar)'s own `setEntryGlyph(id, glyph)` / `clearEntryGlyph(id)` reach such a cell directly, by its owner-minted id, but change only the live button — they don't write the `glyph` constraint, so the change does not survive a tear-off, a re-dock, or a saved layout the way `setTabGlyph` does.

## Selecting a tab

Tabs are selected by clicking their button. To set programmatically, look up the underlying [`ToggleButton`](/components/ToggleButton) via the layout's API and call `setSelected(true)`. The full surface is at the [API page](/api/layout/classes/Tab).

## Lazy panel construction

For tabs whose content is expensive to build (large forms, virtualised tables, charts), pass a **factory** instead of a component. The factory only runs when the user first activates that tab:

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Tab, LayoutConstraints } from '@jimka/typescript-ui/layout';

const container = Component();
const layout = Tab();
container.setLayoutManager(layout);

container.addComponent(() => new GeneralPanel(),  Object.assign(new LayoutConstraints(), { name: 'General'  }));
container.addComponent(() => new NetworkPanel(),  Object.assign(new LayoutConstraints(), { name: 'Network'  }));
container.addComponent(() => new AdvancedPanel(), Object.assign(new LayoutConstraints(), { name: 'Advanced' }));
```

Deferral is the default. Pass `lazy: false` in the constraints to build a factory immediately instead, and note that `lazy` is ignored when you pass an already-constructed component — construction has already happened, so there is nothing left to defer.

A deferred tab has no component to take a label from, so its label comes from the `name` constraint, falling back to the tab's own generated id when no name is given.

[`Tab.addLazyTab(factory, name, constraints?)`](/api/layout/classes/Tab#addlazytab) remains as an alias of this path, for callers holding the layout manager rather than its container.

The tab buttons render on first paint; the panels are constructed on first activation and cached thereafter. Re-clicking a previously-built tab is instant — scroll position and form state are preserved.

Materialization is asynchronous: clicking a lazy tab selects the button immediately, mounts a centred [`ProgressSpinner`](/components/ProgressSpinner) in the content area, and runs the factory after a two-rAF yield via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize). The newly-built panel fades in over the spinner, so the spinner is briefly visible during construction and the UI stays responsive throughout. Layout-sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`) observe the spinner placeholder until the build completes — they no longer trigger factory invocations.

The tab itself is marked busy in the strip for the whole build — from the moment the entry starts building until the panel is ready — so a loading tab stays visible in the [`TabButton`](/components/TabButton#busy-state) even while another tab is selected. The marking clears the instant the build resolves; a rejection removes the tab outright instead (see [Async factories](#async-factories) below).

A deferred registration accepts the same per-child constraints as any other `addComponent` call (including `closeable` and `glyph`). The constraints are stored on the entry and applied when the panel materializes.

Eager and deferred registrations mix freely on the same `Tab`, and tab order always follows call order.

### Async factories

A factory may return a promise, for content that cannot be built until a fetch completes:

```typescript
container.addComponent(
    async () => {
        const columns = await fetchColumns(table);

        return TablePanel(buildStore(table, columns));
    },
    Object.assign(new LayoutConstraints(), { name: table.name, closeable: true }),
);
```

The tab appears immediately and the spinner stays up for the whole wait, not just for construction. If the promise rejects, the tab closes itself and the layout emits `"exception"` — no error UI is shown, because presenting the failure is the consumer's job:

```typescript
layout.on('exception', (error, label) => {
    console.warn(`${label} failed to load`, error);
});
```

A tab closed while its factory is still in flight is forgotten: when the promise later settles, nothing is attached and nothing is reported.

An async factory is only meaningful where something can host the wait. Passing one to a container whose manager does not defer it — or declining deferral with `lazy: false` — throws, because there is no spinner and no owner for the pending state. See [which loading affordance applies](/components/ProgressSpinner#which-loading-affordance) for choosing between this and overlaying a component that already exists.

### Busy tabs

[`setTabBusy(content, busy)`](/api/layout/classes/Tab#settabbusy) marks the tab hosting an already-built `content` component as busy — the entry point for a consumer's own long operation on a tab the deferred machine no longer owns (a lazy tab is already marked automatically while it builds, above):

```typescript
tab.setTabBusy(ordersPanel, true);   // start the caller's own long operation
// ...
tab.setTabBusy(ordersPanel, false);  // the caller clears it when the operation ends
```

`isTabBusy(content)` reads the current state back. The `"busychange"` event fires whenever a tab's busy state actually changes, whichever side drove it:

```typescript
layout.on('busychange', (busy, label) => {
    console.log(`${label} is now ${busy ? 'loading' : 'loaded'}`);
});
```

There is no automatic clear for a flag `setTabBusy` set: the consumer owns clearing it, the same way [`ProgressSpinner.showOverlay`](/components/ProgressSpinner) is owned by its matching `hideOverlay`. See [`TabButton`'s busy state](/components/TabButton#busy-state) for the strip affordance itself.

## Tab-switch animation

When the selected tab changes, the newly-visible child fades in over 120 ms via [`Animation`](/api/core/namespaces/Animation). The fade fires only on actual selection changes — a pure relayout (window resize, scheduleLayout from elsewhere) doesn't re-trigger it. Honours `prefers-reduced-motion: reduce`.

## Strip placement, alignment & orientation

The tab strip can sit on any edge of the content area via
[`setSide`](/api/layout/classes/Tab#setside) — `"north"` (default),
`"south"`, `"west"`, or `"east"` ([`TabSide`](/api/layout/type-aliases/TabSide)).
Within the strip, [`setAlign`](/api/layout/classes/Tab#setalign) hugs the
tab-button group to the strip's leading (`"start"`, default) or trailing
(`"end"`) edge ([`AxisEnd`](/api/primitive/type-aliases/AxisEnd)); alignment is a
no-op in `"fill"` width mode, where the tabs already span the strip.

On the vertical sides (`"west"` / `"east"`),
[`setOrientation`](/api/layout/classes/Tab#setorientation) selects the tab
text flow ([`TabOrientation`](/api/layout/type-aliases/TabOrientation)):
`"horizontal"` keeps labels upright (the strip widens to the longest label),
while `"vertical-cw"` / `"vertical-ccw"` rotate the text a quarter turn (via CSS
`sideways-rl` / `sideways-lr`) so the strip stays thin — `"vertical-cw"` reads
top-to-bottom with the ✕ at the bottom, `"vertical-ccw"` reads bottom-to-top
with the ✕ at the top. Orientation is ignored on north/south.

```typescript
layout.setSide("west");
layout.setOrientation("vertical-cw");
layout.setAlign("end");
```

## Tab-label justification

[`setTextAlign`](/api/layout/classes/Tab#settextalign) sets the strip-wide
justification of every tab button's label
([`AxisPosition`](/api/primitive/type-aliases/AxisPosition) — `"start"`,
`"center"` (default), or `"end"`). The values are flow-relative — `"start"` /
`"end"` are the left / right edges on a horizontal strip and the top / bottom
edges on a rotated west/east strip — matching the `"start"` / `"end"` of
[`setAlign`](/api/layout/classes/Tab#setalign). It is only visible when a tab
cell is wider than its content: the `"fill"`, `"equal"`, and `"fixed"` width
modes pad the cells out, so the label can shift within them; `"content"` mode
hugs the text, so justification has no visible effect there.

```typescript
layout.setTextAlign("start");
```

## Tab glyphs

Set [`LayoutConstraints.glyph`](/api/layout/classes/LayoutConstraints) to a
registered glyph name to render a leading icon in a tab button. The glyph
dispatches to the button's own [`setGlyph`](/components/Button), so it auto-sizes
to the label's line height and inherits the button's `writing-mode` on rotated
west/east strips.

```typescript
tabbed.addComponent(generalPanel, { name: 'General', glyph: 'gear' });
```

## Right-click context menu

Right-clicking any tab button opens a context menu. A **Switch to** submenu
lists every tab — clicking an entry switches to that tab (the currently-showing
tab is shown inert). Below it sit the close actions for the right-clicked tab:
**Close** (just that tab), **Close others**, the before/after pair, and **Close
all**. The before/after labels follow the strip orientation — **Close all to the
left** / **Close all to the right** on a horizontal (north/south) strip, **Close
all above** / **Close all below** on a vertical (west/east) one. Each close item
only ever affects `closeable` tabs, and a bulk item is disabled when no closeable
tab falls in its scope (e.g. **Close all to the right** is disabled when nothing
closeable sits after the clicked tab). **Close all** closes every closeable tab
including the right-clicked one; **Close others** closes every closeable tab
except it. The menu reuses the strip's own selection and close paths, so
switching materializes a lazy tab exactly as a left-click would and each close
fires `tabclose`.

When one or more tools were registered with a descriptor (see [Tab tools](#tab-tools)),
a trailing **Tools** submenu lists them, so every strip tool's action is also
reachable from the keyboard-friendly menu.

## Tab tools

[`addTool`](/api/layout/classes/Tab#addtool) pins a tool at the far end of
the strip, opposite the tab buttons — a natural home for a "new tab" or
overflow-menu control. Tools always sit at the extreme opposite the tabs, so they
move to the leading edge when the tabs are `"end"`-aligned.
[`removeTool`](/api/layout/classes/Tab#removetool) takes one back out, or
pass an initial set via the `tools` option.

`addTool` has two forms. Passing a [`Component`](/api/core/classes/Component)
adds a bare strip tool with no context-menu entry; a
[`Button`](/api/component/button/classes/Button) tool is forced into `flat` mode
so strip tools read as flat icons regardless of how the caller configured them,
and non-`Button` tools are left untouched. Passing a
[`TabToolDescriptor`](/api/component/container/interfaces/TabToolDescriptor)
(`{ label, glyph?, action }`) instead builds the flat strip button **and** a row
in the context menu's **Tools** submenu from that one descriptor — so glyph,
label, and action are declared exactly once and the button and menu row always
fire the same action. A plain-`Component` tool never appears in the menu.

```typescript
// Bare strip tool — visible on the strip only.
tab.addTool(new Button({ glyph: 'gear' }));

// Menu-backed tool — one "+" button on the strip and a matching
// "New tab" row in the right-click menu's Tools submenu.
tab.addTool({ label: 'New tab', glyph: 'plus', action: () => addTab() });
```

The `tools` option accepts either form per element:
`tools: [new Button({ glyph: 'gear' }), { label: 'New tab', glyph: 'plus', action: … }]`.

## Overflow scrolling

By default a strip with more tabs than fit compresses them to share the space.
[`setScrollable(true)`](/api/layout/classes/Tab#setscrollable) changes
that: the strip keeps the tabs at their preferred size, clips the overflow, and
shows leading/trailing scroll-arrow buttons. The arrows and the tool group stay
fixed while the tabs scroll between them; each arrow is *disabled* (not hidden)
at its scroll limit. The arrows only appear while the tabs overflow. This
strip-local scrolling is independent of the content area's own
[`setAutoScroll`](/api/core/classes/Panel#setautoscroll).

When a change could leave the selected tab clipped off-screen — enabling
scrolling, changing [`setSide`](/api/layout/classes/Tab#setside) (the
scroll axis flips with the side), or toggling
[`setCompact`](/api/layout/classes/Tab#setcompact) (every tab's width changes) —
the strip scrolls the minimum amount needed to bring the selected tab back into
view. The reveal is measured from the laid-out tabs, so it stays accurate across
the width change, and it is one-shot, so it never overrides subsequent manual
scrolling.

## Compact strip

[`setCompact(true)`](/api/layout/classes/Tab#setcompact) reduces each tab
button's breathing-room insets *and* thins the strip on its cross axis (the
button height on north/south, the minimum thickness on west/east) for a denser
strip. The tab tools tighten in lockstep — they share the tabs' breathing pad
and the strip thickness, so a tool button shrinks on both axes with the tabs.
The close-button reservation on closeable tabs is preserved, so the ✕ never
overlaps the label.

## Reorderable tabs

[`setReorderable(true)`](/api/layout/classes/Tab#setreorderable) enables
within-strip drag-reorder of the tab headers. Dragging a header shows an
insertion bar at the slot boundary (a vertical rule for north/south, a
horizontal one for west/east) and, on release, moves the tab and keeps it
selected. A press that begins on a closeable tab's ✕ closes it rather than
starting a drag. Reorder works on all four sides. Dragging a tab *out* of its
strip is the separate [tear-off & re-dock](#tear-off-re-dock) capability,
layered on top of this same reorder wiring.

## Tear-off & re-dock

The same `setReorderable(true)` flag also enables cross-container gestures —
turning a strip reorderable enables reorder, tear-off, and re-dock together:

- **Tear-off** — release a header drag over empty space (not over any strip) and
  the tab detaches into a floating window opened at the cursor, hosting the tab's
  **live** content. In the default `"strip"` mode this is a headerless
  [`TabWindow`](/components/TabWindow) whose tab bar doubles as its title bar; in
  `"bare"` mode it is an ordinary [`Window`](/api/overlay/classes/Window). Either way
  the window title is the tab label (see [Re-docking a floating window](#re-docking-a-floating-window)).
- **Cross-strip dock** — release a header drag over another reorderable strip and
  the live content docks there as a new tab at the insertion slot. Same-strip
  releases stay [reorders](#reorderable-tabs).

All of these *move* the content rather than copying it: the source tab is
removed, the content is re-parented through
[`Component.moveComponent`](/api/core/classes/Component#movecomponent) so its
state survives, and **no `tabclose` event fires** (the tab is relocated, not
closed). Because the content is re-parented, in-flight CSS transitions on it
reset — a torn-off or docked panel snaps into place rather than animating.

### Re-docking a floating window

`setDetachWindowMode(mode)` (option `detachWindowMode`) selects how a tear-off
window hosts its content, and so how it is re-docked:

- **`"strip"`** (default) — the tear-off opens a
  [`TabWindow`](/components/TabWindow): a headerless window whose tab bar **is**
  its title bar (no separate [`WindowHeader`](/api/component/container/classes/WindowHeader)
  stacked above the strip). The window title derives from the active tab's label
  ([`getActiveTabLabel()`](/api/layout/classes/Tab#getactivetablabel)); dragging
  the empty area of the bar moves the window (double-click it to maximize or
  restore); and minimize / maximize / close sit as trailing controls in the bar.
  Drag the tab out onto another strip to re-dock
  it; the emptied window closes itself.
- **`"bare"`** — the content fills the window body directly. **Shift-drag** the
  window title bar onto a strip to re-dock it (a plain drag still moves the
  window; a Shift-drag released over empty space is a no-op). Shift keeps the
  gesture clear of the Ctrl snap-resize affordance. The window closes once the
  dock empties it.

Holding **Shift** while tearing a tab off forces a `"bare"` window regardless of
the mode. The window opens at the release point, clamped to stay inside the
viewport.

A non-closeable tab keeps its contract in window form: the tear-off window's
close button is disabled while any tab it holds is non-closeable, so the content
can only be re-docked, never destroyed by the title-bar close.

On [`TabPanel`](/api/component/container/classes/TabPanel) the option is
`tabOptions: { detachWindowMode }` or `setTabDetachWindowMode(mode)`.

The drag is carried by the
[`TabDragData`](/api/overlay/interfaces/TabDragData) payload — the cross-container
contract `{ tabDrag, sourceTabId, componentId, label }`. `sourceTabId`
distinguishes a within-strip reorder from a dock from elsewhere; `componentId`
resolves the live content. Downstream docking consumers read this same contract.

## Theming

The toolbar strip is themed via the `tab.toolbar.*` and `tab.button.*` token
groups — see [Theming](/concepts/theming#theme-keys). The reorder insertion bar
reuses the `drag.reorderIndicator.color` token.

## See also

- [API: Tab](/api/layout/classes/Tab)
- [`TabBar`](/components/TabBar) — the standalone strip chrome `Tab` composes
- [`TabWindow`](/components/TabWindow) — the headerless window a `"strip"` tear-off produces
- [`TabDragData`](/api/overlay/interfaces/TabDragData) — the tear-off / re-dock drag contract
- [`Card`](/layouts/Card) — same one-at-a-time semantics, no toolbar
- [`TabCloseButton`](/components/TabCloseButton)
- [Layout serialization](/layouts/LayoutSerialization) — capture and restore tab order and active index
