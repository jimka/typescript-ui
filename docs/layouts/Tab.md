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

## Theming

The toolbar strip is themed via the `tab.toolbar.*` and `tab.button.*` token groups — see [Theming](/concepts/theming#theme-keys).

## See also

- [API: Tab](/api/layout/classes/Tab)
- [`Card`](/layouts/Card) — same one-at-a-time semantics, no toolbar
- [`TabCloseButton`](/components/TabCloseButton)
