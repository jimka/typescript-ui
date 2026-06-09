# TabPanel

[`TabPanel`](/api/component/container/classes/TabPanel) is a [`Panel`](/api/core/classes/Panel) subclass that owns an internal [`Tab`](/api/layout/classes/Tab) layout manager. It exposes a tab-typed `addTab` / `addLazyTab` / `on("tabclose", fn)` surface, so consumers don't have to wire `new Panel({ layoutManager: new Tab() })` themselves.

The bare `new Panel({ layoutManager: new Tab() })` form still works — `TabPanel` is the convenience entry point.

## Usage

```typescript
import { TabPanel } from '@jimka/typescript-ui/component/container';

const tabs = new TabPanel({
    tabs: [
        { label: 'Alpha', component: alphaPanel, glyph: 'star' },
        { label: 'Beta',  component: betaPanel, closeable: true },
    ],
    onTabClose: component => console.log("Closed", component.getId()),
});
```

`tabs` is the construction-time shortcut. Each entry maps to one [`addTab`](/api/component/container/classes/TabPanel#addtab) call. An entry's optional `glyph` is a registered glyph name rendered leading the tab button's label.

## Adding tabs after construction

```typescript
tabs.addTab(extraPanel, "Gamma");
tabs.addTab(closeableExtra, "Delta", { closeable: true });
tabs.addTab(staredPanel, "Epsilon", { glyph: "star" });
```

Both `addTab` and `addLazyTab` accept `{ closeable?, glyph? }`.

## Lazy tabs

Use [`addLazyTab`](/api/component/container/classes/TabPanel#addlazytab) when the tab content is expensive to construct and should defer until the tab is first shown:

```typescript
tabs.addLazyTab(() => buildHeavyPanel(), "Heavy");
```

The factory runs once, the first time the user activates the tab.

## Close hooks

Either the construction-time `onTabClose` option or [`on("tabclose", fn)`](/api/component/container/classes/TabPanel#on) wires a callback for closeable tabs:

```typescript
tabs.on("tabclose", component => store.removeBinding(component));
```

The callback fires after the tab is removed; the closed component is passed in so callers can dispose any external state.

## Right-click context menu

Right-clicking any tab button opens a context menu that switches to another tab or closes the right-clicked one (the Close item is enabled only when that tab is `closeable`). This comes from the wrapped [`Tab`](/layouts/Tab#right-click-context-menu) manager and needs no wiring — closing through the menu fires `tabclose` just like the close button does.

## Tab strip styling

The active tab is marked by a single shared indicator bar that **slides** to the
newly-selected tab on each selection change; its colour and thickness come from
the `--ts-ui-tab-indicator-color` / `--ts-ui-tab-indicator-thickness` theme
tokens.

Construction-time strip settings nest under `tabOptions` (the wrapped manager's
own options bag); each has a matching prefixed runtime forwarder on the panel:

```typescript
const tabs = new TabPanel({
    tabOptions: {
        widthMode: "equal",         // "fill" | "content" | "equal" | "fixed"
        maxWidth: 160,              // width cap for "content" / "equal"; null = uncapped
        fixedWidth: 120,            // per-tab width for "fixed" mode
        underBorderFullWidth: true, // 1px rule under the whole strip (the default)
    },
    tabs: [/* … */],
});

tabs.setTabWidthMode("fixed");
tabs.setTabFixedWidth(140);
tabs.setTabUnderBorderFullWidth(false);
```

[`setTabWidthMode`](/api/component/container/classes/TabPanel#settabwidthmode)
chooses the tab-button width strategy:

- `"fill"` (default) — tabs split the strip equally and stretch to fill it.
- `"content"` — each tab takes its own content width, capped at
  [`maxWidth`](/api/component/container/classes/TabPanel#settabmaxwidth).
- `"equal"` — every tab matches the widest tab, capped at `maxWidth`.
- `"fixed"` — every tab takes
  [`fixedWidth`](/api/component/container/classes/TabPanel#settabfixedwidth)
  along the text's reading direction: the tab width for horizontal text
  (north/south, or upright west/east — where it sets the bar thickness), and the
  tab height for rotated west/east text.

Every mode except `"fill"` leaves the strip full-width with the tabs
left-aligned. [`setTabUnderBorderFullWidth`](/api/component/container/classes/TabPanel#settabunderborderfullwidth)
toggles the edge-to-edge rule drawn under the strip. All forward to the wrapped
[`Tab`](/api/layout/classes/Tab) manager.

## Placement, tools, overflow, compact & reorder

`TabPanel` forwards the strip-placement and behaviour surface of the wrapped
`Tab` manager — see [Tab](/layouts/Tab) for the full description of each:

```typescript
const tabs = new TabPanel({
    tabOptions: {
        side: "west",               // "north" | "south" | "west" | "east"
        align: "end",               // "start" | "end"
        orientation: "vertical-cw", // "horizontal" | "vertical-cw" | "vertical-ccw"
        textAlign: "start",         // "start" | "center" | "end" (flow-relative label justification)
        scrollable: true,           // scroll on overflow instead of compressing
        compact: true,              // denser tab insets
        reorderable: true,          // within-strip header drag-reorder
        tools: [newTabButton],      // buttons pinned opposite the tabs
    },
    tabs: [/* … */],
});

tabs.setTabSide("south");
tabs.setTabAlign("start");
tabs.setTabOrientation("horizontal");
tabs.setTabTextAlign("center");
tabs.setTabScrollable(true);
tabs.setTabCompact(false);
tabs.setTabReorderable(false);
tabs.addTabTool(menuButton);
```

Construction settings nest under `tabOptions` (unprefixed, the manager's own
option names); each has a matching prefixed runtime forwarder on the panel —
[`setTabSide`](/api/component/container/classes/TabPanel#settabside),
[`setTabAlign`](/api/component/container/classes/TabPanel#settabalign),
[`setTabOrientation`](/api/component/container/classes/TabPanel#settaborientation),
[`setTabTextAlign`](/api/component/container/classes/TabPanel#settabtextalign),
[`setTabScrollable`](/api/component/container/classes/TabPanel#settabscrollable),
[`setTabCompact`](/api/component/container/classes/TabPanel#settabcompact),
[`setTabReorderable`](/api/component/container/classes/TabPanel#settabreorderable), and
[`addTabTool`](/api/component/container/classes/TabPanel#addtabtool) — all
forwarding to the wrapped [`Tab`](/layouts/Tab) manager.

## Accessing the underlying `Tab` manager

For features `TabPanel` doesn't forward (e.g. directly inspecting `Tab`-only state), use [`getTabManager`](/api/component/container/classes/TabPanel#gettabmanager):

```typescript
const manager = tabs.getTabManager();
```

This is the typed accessor for `this.getLayoutManager() as Tab`.

## When to use `TabPanel` vs bare `Panel` + `Tab`

- Reach for `TabPanel` when you want a tab container with the typed `addTab` surface and the standard `closeable` / `onTabClose` shape.
- Reach for bare `new Panel({ layoutManager: new Tab() })` when you need a custom `LayoutConstraints` shape per tab, or your `Tab` is being constructed elsewhere and passed in.
