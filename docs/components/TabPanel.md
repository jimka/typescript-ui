# TabPanel

[`TabPanel`](/api/component/container/classes/TabPanel) is a [`Panel`](/api/core/classes/Panel) subclass that owns an internal [`Tab`](/api/layout/classes/Tab) layout manager. It exposes a tab-typed `addTab` / `addLazyTab` / `on("tabclose", fn)` surface, so consumers don't have to wire `new Panel({ layoutManager: new Tab() })` themselves.

The bare `new Panel({ layoutManager: new Tab() })` form still works — `TabPanel` is the convenience entry point.

## Usage

```typescript
import { TabPanel } from '@jimka/typescript-ui/component/container';

const tabs = new TabPanel({
    tabs: [
        { label: 'Alpha', component: alphaPanel },
        { label: 'Beta',  component: betaPanel, closeable: true },
    ],
    onTabClose: component => console.log("Closed", component.getId()),
});
```

`tabs` is the construction-time shortcut. Each entry maps to one [`addTab`](/api/component/container/classes/TabPanel#addtab) call.

## Adding tabs after construction

```typescript
tabs.addTab(extraPanel, "Gamma");
tabs.addTab(closeableExtra, "Delta", { closeable: true });
```

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

## Tab strip styling

The active tab is marked by a single shared indicator bar that **slides** to the
newly-selected tab on each selection change; its colour and thickness come from
the `--ts-ui-tab-indicator-color` / `--ts-ui-tab-indicator-thickness` theme
tokens.

Construction-time options (each with a matching setter) tune the strip:

```typescript
const tabs = new TabPanel({
    tabWidthMode: "equal",         // "fill" | "content" | "equal" | "fixed"
    tabMaxWidth: 160,              // width cap for "content" / "equal"; null = uncapped
    tabFixedWidth: 120,            // per-tab width for "fixed" mode
    tabUnderBorderFullWidth: true, // 1px rule under the whole strip (the default)
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
  [`tabMaxWidth`](/api/component/container/classes/TabPanel#settabmaxwidth).
- `"equal"` — every tab matches the widest tab, capped at `tabMaxWidth`.
- `"fixed"` — every tab takes
  [`tabFixedWidth`](/api/component/container/classes/TabPanel#settabfixedwidth)
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
    tabSide: "west",               // "north" | "south" | "west" | "east"
    tabAlign: "end",               // "start" | "end"
    tabOrientation: "vertical-cw", // "horizontal" | "vertical-cw" | "vertical-ccw"
    tabScrollable: true,           // scroll on overflow instead of compressing
    compact: true,                 // denser tab insets
    reorderable: true,             // within-strip header drag-reorder
    tabTools: [newTabButton],      // buttons pinned opposite the tabs
    tabs: [/* … */],
});

tabs.setTabSide("south");
tabs.setTabAlign("start");
tabs.setTabOrientation("horizontal");
tabs.setTabScrollable(true);
tabs.setCompact(false);
tabs.setReorderable(false);
tabs.addTabTool(menuButton);
```

These map 1:1 to [`setTabSide`](/api/layout/classes/Tab#settabside),
[`setTabAlign`](/api/layout/classes/Tab#settabalign),
[`setTabOrientation`](/api/layout/classes/Tab#settaborientation),
[`setTabScrollable`](/api/layout/classes/Tab#settabscrollable),
[`setCompact`](/api/layout/classes/Tab#setcompact),
[`setReorderable`](/api/layout/classes/Tab#setreorderable), and
[`addTabTool`](/api/layout/classes/Tab#addtabtool) on the manager.

## Accessing the underlying `Tab` manager

For features `TabPanel` doesn't forward (e.g. directly inspecting `Tab`-only state), use [`getTabManager`](/api/component/container/classes/TabPanel#gettabmanager):

```typescript
const manager = tabs.getTabManager();
```

This is the typed accessor for `this.getLayoutManager() as Tab`.

## When to use `TabPanel` vs bare `Panel` + `Tab`

- Reach for `TabPanel` when you want a tab container with the typed `addTab` surface and the standard `closeable` / `onTabClose` shape.
- Reach for bare `new Panel({ layoutManager: new Tab() })` when you need a custom `LayoutConstraints` shape per tab, or your `Tab` is being constructed elsewhere and passed in.
