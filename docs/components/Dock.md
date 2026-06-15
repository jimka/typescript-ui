# Dock

[`Dock`](/api/core/classes/Dock) is a user-configurable, rearrangeable panel layout — the VS Code / GoldenLayout style dock. It hosts a tree of [`Split`](/api/layout/classes/Split) and [`Tab`](/api/layout/classes/Tab) regions whose panels the user can reorder, tear off into floating [`Window`](/components/Window)s, drop on a region edge to split, and save / restore.

`Dock` is **glue, not new drag mechanics**. Tab reorder and tear-off come from [`Tab`](/api/layout/classes/Tab)'s reorderable wiring, edge-split-on-drop from [`DockRegion`](/api/layout/classes/DockRegion), every re-parent from [`Component.moveComponent`](/api/core/classes/Component#movecomponent), and persistence from [`serializeLayout`](/api/layout/functions/serializeLayout) / [`restoreLayout`](/api/layout/functions/restoreLayout). What `Dock` adds is the panel registry, a declarative initial-layout compiler, and a re-wire sweep that keeps **every** region dockable — including the regions a drop creates mid-gesture.

> `Dock` is not [`Drawer`](/components/Drawer)'s sibling rail. A drawer is an edge-anchored overlay panel; a dock is the rearrangeable workspace your panels live in.

## Declaring the initial layout

`DockOptions.layout` is a small declarative spec — a leaf panel, a `split` of regions, or a `tabs` group. Each leaf carries a stable `id`, a `title`, optional `glyph`, and its `content` (a live component or a lazy factory):

```typescript
import { Dock } from '@jimka/typescript-ui/core';

const dock = Dock({
    layout: {
        split: 'horizontal',
        children: [
            { tabs: [
                { id: 'explorer', title: 'Explorer', content: () => buildExplorer() },
                { id: 'search',   title: 'Search',   content: () => buildSearch() },
            ] },
            { id: 'editor', title: 'Editor', content: () => buildEditor() },
        ],
    },
});
```

A leaf always lands inside a reorderable `Tab` stack — even a single-panel split pane — so its tab header stays a drag handle for tear-off and re-dock. Omit `layout` for an empty dock and add panels at runtime:

```typescript
dock.addPanel({ id: 'console', title: 'Console', content: consolePanel });
```

`addPanel` docks into the active region: the root if it is a `Tab`, otherwise the first `Tab` region found depth-first.

## id vs. title

The two are deliberately separate channels:

| Field | Role | Stamped via |
| --- | --- | --- |
| `id` | Stable serialization key — restored layouts round-trip against it | `Component.setId`, read back as `getId()` |
| `title` | Visible tab label and tear-off window title | `Component.setName` |

Keep `id` stable across sessions; it is what [`getLayoutState`](#saving-and-restoring) keys on. `title` is free to change and survives a restore because it rides on the component, not on a per-container constraint.

## What the user can do

Once a panel is docked, the gestures come from the composed primitives:

| Gesture | Result | Owned by |
| --- | --- | --- |
| Drag a tab within its strip | Reorder | [`Tab`](/api/layout/classes/Tab) |
| Drag a tab off the strip | Tear off into a floating [`Window`](/components/Window) that is itself a **mini-dock** | [`Tab`](/api/layout/classes/Tab) + `Dock` |
| Drop a tab on a region **edge** | Split the region, new pane gets the panel | [`DockRegion`](/api/layout/classes/DockRegion) |
| Drop a tab on a region **centre** | Dock as a tab | [`DockRegion`](/api/layout/classes/DockRegion) |
| Drop a tab into another window | Dock there, and that window is raised and activated | [`DockRegion`](/api/layout/classes/DockRegion) |
| Hold a dragged tab over a backgrounded window | Spring-loads it to the front after a short dwell so you can aim | [`DockRegion`](/api/layout/classes/DockRegion) |
| Drag a window's last tab back out | Re-dock, and the now-empty float closes itself | [`Tab`](/api/layout/classes/Tab) + `Dock` |

`Dock` guarantees the regions these gestures create are themselves dockable: after any structural change it runs an idempotent, animation-frame-coalesced sweep that gives every region a `DockRegion` drop target and makes every `Tab` reorderable. A torn-off tab lands in an ordinary header [`Window`](/components/Window) whose content the sweep **adopts** into a wired region tree — so the float is a *mini-dock* you can edge-split, arrange into multiple panes, and re-dock against the main dock in both directions, not a tab-only strip.

## Saving and restoring

`getLayoutState()` captures the whole arrangement — split ratios, tab order, the active tab, and every torn-off window *including its internal split/tab tree* — as a plain serializable [`LayoutState`](/api/layout/interfaces/LayoutState). Each float is stored as a [`WindowNode`](/api/layout/interfaces/WindowNode) carrying a `content` region tree, so a multi-pane float round-trips with its splits and active tabs intact (a legacy single-panel `panelId` state still restores through a fallback). `setLayoutState(state)` rebuilds it, sourcing each panel from the registry by `id`:

```typescript
const saved = dock.getLayoutState();           // -> plain JSON-able object
localStorage.setItem('layout', JSON.stringify(saved));

// later …
dock.setLayoutState(JSON.parse(localStorage.getItem('layout')!));
```

Transport (localStorage, a server, debounced auto-save) is the application's concern — `Dock` only returns and accepts the state object. A panel whose `id` is no longer registered is skipped on restore, so dropping a feature degrades gracefully.

## See also

- [`Window`](/components/Window) — the floating surface a torn-off tab lands in.
- [`Drawer`](/components/Drawer) — edge-anchored overlay panel (a different concept).
- [`Tab`](/api/layout/classes/Tab) and [`Split`](/api/layout/classes/Split) — the region layout managers `Dock` arranges.
- [`DockRegion`](/api/layout/classes/DockRegion) — the per-region edge-drop coordinator.
