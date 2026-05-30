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

## Accessing the underlying `Tab` manager

For features `TabPanel` doesn't forward (e.g. directly inspecting `Tab`-only state), use [`getTabManager`](/api/component/container/classes/TabPanel#gettabmanager):

```typescript
const manager = tabs.getTabManager();
```

This is the typed accessor for `this.getLayoutManager() as Tab`.

## When to use `TabPanel` vs bare `Panel` + `Tab`

- Reach for `TabPanel` when you want a tab container with the typed `addTab` surface and the standard `closeable` / `onTabClose` shape.
- Reach for bare `new Panel({ layoutManager: new Tab() })` when you need a custom `LayoutConstraints` shape per tab, or your `Tab` is being constructed elsewhere and passed in.
