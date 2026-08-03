# Dock

[`Dock`](/api/overlay/classes/Dock) is a user-configurable, rearrangeable panel layout — the VS Code / GoldenLayout style dock. It hosts a tree of [`Split`](/api/layout/classes/Split) and [`Tab`](/api/layout/classes/Tab) regions whose panels the user can reorder, tear off into floating [`Window`](/components/Window)s, drop on a region edge to split, and save / restore.

`Dock` is **glue, not new drag mechanics**. Tab reorder and tear-off come from [`Tab`](/api/layout/classes/Tab)'s reorderable wiring, edge-split-on-drop from [`DockRegion`](/api/layout/classes/DockRegion), every re-parent from [`Component.moveComponent`](/api/core/classes/Component#movecomponent), and persistence from [`serializeLayout`](/api/layout/functions/serializeLayout) / [`restoreLayout`](/api/layout/functions/restoreLayout). What `Dock` adds is the panel registry, a declarative initial-layout compiler, and a re-wire sweep that keeps **every** region dockable — including the regions a drop creates mid-gesture.

> `Dock` is not [`Drawer`](/components/Drawer)'s sibling rail. A drawer is an edge-anchored overlay panel; a dock is the rearrangeable workspace your panels live in.

## Declaring the initial layout

`DockOptions.layout` is a small declarative spec — a leaf panel, a `split` of regions, or a `tabs` group. Each leaf carries a stable `id`, a `title`, optional `glyph`, and its `content` — a live component or a factory, which `addLazyPanel` may return a promise from:

```typescript
import { Dock } from '@jimka/typescript-ui/overlay';


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

A spec's `disposeOnClose` defaults to `true`: closing the panel's tab destroys its `content`. A spec whose `content` is a **live component** you intend to re-add later needs `disposeOnClose: false` — a spec whose `content` is a **factory** needs nothing, since re-adding a registered id rebuilds the frame through the factory.

## Empty-state placeholder

`DockOptions.emptyContent` is a start-page shown only while the dock holds **no live panel anywhere** — every tab closed, with nothing torn off into a float either. It appears the instant the dock becomes empty and disappears the instant a panel opens:

```typescript
const dock = Dock({
    emptyContent: startPage,   // shown while the dock is empty
    layout:       { tabs: [ /* … */ ] },
});
```

The placeholder is **chrome, not a panel**: it never becomes a tab, is never serialized, and the empty region stays a live drop target underneath it — dragging a tab onto an empty dock still lands. Set or clear it at runtime with `setEmptyContent(component)` / `setEmptyContent(null)`, read it back with `getEmptyContent()`, and ask whether the dock currently holds any panel with `isEmpty()`. Setting it while the dock is already empty swaps the shown placeholder immediately; otherwise the new value simply waits and attaches on the next empty transition. A dock whose only panels are torn off into floats is **not** empty — those floats are still live panels — so the placeholder shows only when nothing is open at all.

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

## Panel lifecycle

The model is **host-centric**: a live panel always occupies one Dock-managed **host** — the **tiled tree** (the main dock) or a **float** [`Window`](/components/Window) — and a destroyed panel is **gone**. `Dock` emits five per-panel events — typed as [`DockEvent`](/api/overlay/type-aliases/DockEvent) with a [`DockPanelEvent`](/api/overlay/interfaces/DockPanelEvent) payload — naming the host transitions and intra-host relocations:

| Event | Fires when | Payload |
| --- | --- | --- |
| `attach` | a panel **enters** a host — a fresh `addPanel`/restore into the tiled tree, or a tear-off into a fresh float | `{ id, content, window }` |
| `detach` | a panel **leaves** a host while staying alive | `{ id, content, window }` |
| `move` | a panel **relocates within** its current host — a different region in the same tiled tree, or repositioned in the same float | `{ id, content, window }` |
| `focus` | the dock-wide active panel changes, across tiled tabs **and** floats | `{ id, content, window }` or `null` |
| `close` | a panel is genuinely destroyed — a tab ✕, `removePanel`, or a float window's chrome ✕ | `{ id, content, window: null }` |

The payload's **`window`** names which host the event concerns: `null` for the tiled tree, otherwise the float [`Window`](/components/Window). A host change is a **pair** of events — a panel leaves one host and enters another — while an intra-host relocation is a single `move`:

| Gesture | Events |
| --- | --- |
| Tear off a tab into a float | `detach`(`window: null`) then `attach`(*float*) |
| Re-dock a float — *whether* dropped on a region body/edge **or** merged onto a tab bar | `detach`(*float*) then `attach`(`window: null`) |
| Move a panel to a **different region** within one host | `move`(*that host*) |
| Reorder tabs within one strip | *(silent)* |

```typescript
dock.on('close', ({ id }) => controller.disposeStore(id));
dock.on('attach', ({ id, window }) =>
    console.log(`${id} now in ${window ? window.getTitle() : 'the main dock'}`));
dock.on('move', () => localStorage.setItem('layout', JSON.stringify(dock.getLayoutState())));
dock.on('focus', panel => statusBar.setText(panel ? panel.id : 'no panel'));
```

The `content` in every payload is the panel's stable Dock-owned identity frame — `content.getId()` is the `id` you registered.

A few rules make the events predictable:

- **A move is `detach` then `attach`.** Leaving one host and entering another is two real transitions, in that order — so a tear-off is `detach`(tiled) + `attach`(float), and a re-dock is `detach`(float) + `attach`(tiled). The `window` field tells the two apart.
- **`close` is never paired with a `detach`.** A destroy (tab ✕, `removePanel`, float ✕) fires `close` alone — the frame is gone, so no phantom host-leave is emitted. A panel torn off and *then* closed produces the tear-off pair first, then `close` when destroyed. Once the event has been delivered to every listener, the panel's content is destroyed — releasing its element, handles, and per-instance stylesheet rules — unless the spec set `disposeOnClose: false`.
- **A relocation within one host fires `move`, not `attach`/`detach`.** Dragging a panel to a *different region* in the same host — between `Split` panes, or onto another `Tab` region's bar — keeps its host, so it fires a single `move` whose `window` names that (unchanged) host. A host change fires `detach`+`attach` and **never** `move`; a first appearance fires `attach` alone. A pure **reorder within one strip** repositions a panel within the same place, not to a different one, so it fires **nothing**. `move` carries no region detail (regions are anonymous) — a listener reacting to a layout change re-reads `getLayoutState()`. A `setLayoutState` restore rebuilds the tree but is not a user relocation, so it stays silent for `move`.
- **`focus` is one nullable event — there is no `blur`.** The previously-focused panel is whatever the last non-null `focus` named; the `null` payload covers "nothing focused now" (e.g. the last panel closed). Re-activating the already-focused panel is silent. A non-null `focus` payload's `window` names the focused panel's current host.
- **Re-dock and layout restore fire `focus` too.** A re-dock and a `setLayoutState` both genuinely change the active panel, so each fires a `focus` for the now-active panel in addition to the host-transition events.
- **`Split` generates no events.** It is structural — it holds regions, never a panel directly.

Alongside the per-panel events, one **dock-wide aggregate** event fires as the dock crosses between holding panels and holding none:

| Event | Fires when | Payload |
| --- | --- | --- |
| `emptychange` | the dock transitions between empty (no live panel anywhere) and populated | `{ empty }` |

`emptychange` carries a [`DockEmptyEvent`](/api/overlay/interfaces/DockEmptyEvent) (`{ empty: boolean }`) and fires **once per real transition**, not once per panel — so a consumer can toggle a start page without re-deriving the aggregate on every panel event. It fires whether or not an `emptyContent` placeholder is supplied.

```typescript
dock.on('emptychange', ({ empty }) => startPage.setVisible(empty));
```

### `exception`

`exception` fires when a lazy panel's content factory rejected. It carries a [`DockExceptionEvent`](/api/overlay/interfaces/DockExceptionEvent) (`{ id, error }`) rather than a `DockPanelEvent`, because a panel that never built has no content to report.

By the time it fires the panel has already been closed, and its own `close` has already been emitted — so a listener must not call `removePanel` for that id. The panel stays *registered*, which is what makes re-adding the same id a retry: its frame is rebuilt and the factory runs again.

```typescript
dock.on('exception', ({ id, error }) => notifyUser(`${id} failed to load`, error));
```

No error UI is shown — presenting the failure is the consumer's job.

## Programmatic control

Two methods drive the lifecycle from code, each returning whether it found the panel:

```typescript
if (dock.focusPanel('search')) {
    return; // already open — activated its tab and surfaced its float
}

dock.removePanel('editor'); // closes through the user-close path -> fires `close`
```

- **`focusPanel(id)`** activates the host tab and raises the host float when the panel is floated, so a buried panel surfaces. A successful activation naturally produces a `focus`. Returns `false` for an unknown id or one registered but never docked.
- **`removePanel(id)`** closes the panel through the same path a tab ✕ takes, firing exactly one `close`. Returns `false` for an unknown id or one in no region. The cached frame is evicted (a later `addPanel` rebuilds it from the registered factory) while the registration is kept.

### Async panel content

`addLazyPanel` accepts a factory that returns a promise, for a panel that cannot be built until a fetch completes:

```typescript
dock.addLazyPanel({
    id:      'orders',
    title:   'Orders',
    content: async () => buildPanel(await fetchMeta('orders')),
});
```

The tab appears at once — with its title, glyph and tooltip already correct — and a spinner holds the panel body for the whole wait. When the promise resolves the content fades in, in the same tab.

`addPanel` does **not** accept an async factory: an eagerly-built panel has no spinner and nothing to own the wait, so passing one throws. If the promise rejects, the whole docked panel closes and the dock emits [`exception`](#exception) after that panel's own `close`. A panel closed while its factory is still in flight is forgotten: when the promise later settles, nothing is added and nothing is reported.

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
