# TabPanel

[`TabPanel`](/api/component/container/classes/TabPanel) is a [`Panel`](/api/core/classes/Panel) subclass that owns an internal [`Tab`](/api/layout/classes/Tab) layout manager. It exposes a tab-typed `addTab` / `addLazyTab` surface, so consumers don't have to wire `new Panel({ layoutManager: new Tab() })` themselves.

The bare `new Panel({ layoutManager: new Tab() })` form still works — `TabPanel` is the convenience entry point. Strip-level configuration and events are reached through the wrapped manager via [`getTab`](/api/component/container/classes/TabPanel#gettab) rather than a mirrored forwarder per setter.

<!-- demo: tabpanel-lazy -->
> **Live demo** — three tabs added with `addLazyTab`, each factory logging
> to a build log the first time its tab is selected, and never again.
> [Open the TabPanel page](https://jimka.github.io/typescript-ui/components/TabPanel)
<!-- /demo -->

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

`addTab` accepts `{ closeable?, glyph?, lazy?, disposeOnClose? }`; `addLazyTab` accepts `{ closeable?, glyph?, disposeOnClose? }` — it always defers, so it has no `lazy` to set. `disposeOnClose` defaults to `true`: closing the tab destroys its content. Pass `false` for a component you hold and intend to re-add later.

## Lazy tabs

Pass a **factory** instead of a component when the tab content is expensive to construct and should defer until the tab is first shown:

```typescript
tabs.addTab(() => buildHeavyPanel(), "Heavy");
```

The same works through the options bag:

```typescript
const tabs = TabPanel({
    tabs: [
        { label: "Heavy", component: () => buildHeavyPanel() },
        { label: "Eager", component: () => buildCheapPanel(), lazy: false },
    ],
});
```

The factory runs once, the first time the user activates the tab. Deferral is the default — pass `lazy: false` to build immediately instead. `lazy` is ignored when `component` is an already-constructed component.

A factory may be asynchronous, for content that cannot be built until a fetch completes; the spinner then covers the whole wait. If it rejects, the tab closes itself and the wrapped manager emits `"exception"`, reached through [`getTab()`](/api/component/container/classes/TabPanel#gettab):

```typescript
tabs.getTab().on("exception", (error, label) => console.warn(`${label} failed`, error));
```

[`addLazyTab`](/api/component/container/classes/TabPanel#addlazytab) remains as an alias for `addTab` with a factory.

## Close hooks

Pass the construction-time `onTabClose` option, or wire a listener on the wrapped manager via [`getTab`](/api/component/container/classes/TabPanel#gettab), to react to closeable tabs:

```typescript
tabs.getTab().on("tabclose", component => store.removeBinding(component));
```

The callback fires after the tab is removed and before the content is destroyed; the closed component is passed in so callers can capture anything they need before it goes. Once every `tabclose` listener has run, the content is disposed — releasing its element, handles, and per-instance stylesheet rules — unless the tab was added with `disposeOnClose: false`, or a listener re-parented the component during the callback.

To ask before a user closes a tab — an unsaved-changes guard, say — wire `beforetabclose` on the same wrapped manager. `TabPanel` mirrors no per-setter forwarder for it, so `getTab()` is the documented route:

```typescript
tabs.getTab().on("beforetabclose", (component, controller) => {
    if (isDirty(component)) {
        controller.preventDefault();
    }
});
```

It fires only for the user close path (the ✕, the context menu's *Close*, and bulk-close rows), before the tab is torn down; calling the controller's `preventDefault()` keeps the tab open and suppresses `tabclose` for it.

## Right-click context menu

Right-clicking any tab button opens a context menu that switches to another tab or closes the right-clicked one (the Close item is enabled only when that tab is `closeable`). This comes from the wrapped [`Tab`](/layouts/Tab#right-click-context-menu) manager and needs no wiring — closing through the menu fires `tabclose` just like the close button does.

## Tab strip styling

The active tab is marked by a single shared indicator bar that **slides** to the
newly-selected tab on each selection change; its colour and thickness come from
the `--ts-ui-tab-indicator-color` / `--ts-ui-tab-indicator-thickness` theme
tokens.

Construction-time strip settings nest under `tabOptions` (the wrapped manager's
own options bag); to change them at runtime, reach the manager through
[`getTab`](/api/component/container/classes/TabPanel#gettab) and call its
setters directly:

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

tabs.getTab().setWidthMode("fixed");
tabs.getTab().setFixedWidth(140);
tabs.getTab().setUnderBorderFullWidth(false);
```

[`Tab.setWidthMode`](/api/layout/classes/Tab) chooses the tab-button width
strategy:

- `"fill"` (default) — tabs split the strip equally and stretch to fill it.
- `"content"` — each tab takes its own content width, capped at the manager's `maxWidth`.
- `"equal"` — every tab matches the widest tab, capped at `maxWidth`.
- `"fixed"` — every tab takes `fixedWidth`
  along the text's reading direction: the tab width for horizontal text
  (north/south, or upright west/east — where it sets the bar thickness), and the
  tab height for rotated west/east text.

Every mode except `"fill"` leaves the strip full-width with the tabs
left-aligned. `Tab.setUnderBorderFullWidth`
toggles the edge-to-edge rule drawn under the strip.

## Placement, tools, overflow, compact & reorder

The wrapped `Tab` manager owns the strip-placement and behaviour surface — see
[Tab](/layouts/Tab) for the full description of each. Set them at construction
under `tabOptions`, or at runtime through [`getTab`](/api/component/container/classes/TabPanel#gettab):

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

tabs.getTab().setSide("south");
tabs.getTab().setAlign("start");
tabs.getTab().setOrientation("horizontal");
tabs.getTab().setTextAlign("center");
tabs.getTab().setScrollable(true);
tabs.getTab().setCompact(false);
tabs.getTab().setReorderable(false);
tabs.getTab().addTool(menuButton);
```

## Accessing the underlying `Tab` manager

[`getTab`](/api/component/container/classes/TabPanel#gettab) is the typed
accessor for `this.getLayoutManager() as Tab`. It is the supported path for
everything beyond construction and `addTab` / `addLazyTab` — strip placement,
width strategy, overflow, tools, and `tabclose` / `empty` events:

```typescript
const manager = tabs.getTab();
```

## When to use `TabPanel` vs bare `Panel` + `Tab`

- Reach for `TabPanel` when you want a tab container with the typed `addTab` surface and the standard `closeable` / `onTabClose` shape.
- Reach for bare `new Panel({ layoutManager: new Tab() })` when you need a custom `LayoutConstraints` shape per tab, or your `Tab` is being constructed elsewhere and passed in.
