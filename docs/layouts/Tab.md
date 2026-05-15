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

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Tab } from '@jimka/typescript-ui/layout';
const tabbed = new Component();
tabbed.setLayoutManager(new Tab({
    onTabClose: removed => console.log('closed', removed.getId()),
}));

tabbed.addComponent(generalPanel,   { name: 'General'  });
tabbed.addComponent(networkPanel,   { name: 'Network'  });
tabbed.addComponent(advancedPanel,  { name: 'Advanced' });
```

[`TabOptions`](/api/layout/interfaces/TabOptions) currently exposes `onTabClose`; the `setOnTabClose` setter still works.

## Per-child constraints

| Field | Purpose |
| --- | --- |
| `name` | Tab button label. Defaults to the component's ID. |
| `closeable` | When `true`, render a [`TabCloseButton`](/components/TabCloseButton) inside the tab button. |

## Selecting a tab

Tabs are selected by clicking their button. To set programmatically, look up the underlying [`ToggleButton`](/components/ToggleButton) via the layout's API and call `setSelected(true)`. The full surface is at the [API page](/api/layout/classes/Tab).

## Lazy panel construction

For tabs whose content is expensive to build (large forms, virtualised tables, charts), register them with `addLazyTab` so the factory only runs when the user first activates that tab:

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Tab } from '@jimka/typescript-ui/layout';

const container = new Component();
const layout = new Tab();
container.setLayoutManager(layout);

layout.addLazyTab(() => new GeneralPanel(),  'General' );
layout.addLazyTab(() => new NetworkPanel(),  'Network' );
layout.addLazyTab(() => new AdvancedPanel(), 'Advanced');
```

The tab buttons render on first paint; the panels are constructed on first activation and cached thereafter. Re-clicking a previously-built tab is instant — scroll position and form state are preserved.

Materialization is asynchronous: clicking a lazy tab selects the button immediately, mounts a centred [`ProgressSpinner`](/components/ProgressSpinner) in the content area, and runs the factory after a two-rAF yield via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize). The newly-built panel fades in over the spinner, so the spinner is briefly visible during construction and the UI stays responsive throughout. Layout-sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`) observe the spinner placeholder until the build completes — they no longer trigger factory invocations.

`addLazyTab(factory, name, constraints?)` accepts the same per-child constraints as `addComponent` (including `closeable`). The constraints are stored on the lazy entry and applied when the panel materializes.

::: warning Don't mix `addLazyTab` and `addComponent` on the same `Tab`
Once a `Tab` has any lazy entries, subsequent calls to `container.addComponent(c, {...})` may not create a tab button. Pick one registration style per `Tab` instance.
:::

## Tab-switch animation

When the selected tab changes, the newly-visible child fades in over 120 ms via [`Animation`](/api/core/classes/Animation). The fade fires only on actual selection changes — a pure relayout (window resize, scheduleLayout from elsewhere) doesn't re-trigger it. Honours `prefers-reduced-motion: reduce`.

## Theming

The toolbar strip is themed via the `tab.toolbar.*` and `tab.button.*` token groups — see [Theming](/concepts/theming#theme-keys).

## See also

- [API: Tab](/api/layout/classes/Tab)
- [`Card`](/layouts/Card) — same one-at-a-time semantics, no toolbar
- [`TabCloseButton`](/components/TabCloseButton)
