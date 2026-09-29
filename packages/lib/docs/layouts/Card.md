# Card

[`Card`](/api/layout/classes/Card) shows exactly one child component at a time, sized to fill the container's inner bounds. The visible child is selected by component ID, or by a caller-supplied key; every other child is removed from the render tree with `display: none`, so it costs nothing to lay out while another child is showing, and its scroll positions are preserved and restored when it is shown again.

```
+--------------------------+
|                          |
|     [active child]       |
|                          |
+--------------------------+
   one of N children visible at a time
```

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Card } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const stack = Component();
stack.setLayoutManager(Card({ visibleComponentId: contentPanel.getId() }));

stack.addComponent(loadingPanel);
stack.addComponent(contentPanel);
stack.addComponent(errorPanel);
```

[`CardOptions`](/api/layout/interfaces/CardOptions) accepts `visibleComponentId` declaratively. The `setVisibleComponentId` setter still works for runtime switching:

```typescript
card.setVisibleComponentId(errorPanel.getId());
```

## Per-child constraints

| Field | Purpose |
| --- | --- |
| `key` | Names this child's slot so `card.setVisibleKey(key)` can select it. Unlike a component ID, a key can name a child that has not been built yet — see [Lazy page construction](#lazy-page-construction). |

A card with no keys behaves exactly as before: the active child is selected by ID via `card.setVisibleComponentId(id)`.

## Lazy page construction

For pages that are expensive to build, pass a **factory** instead of a component and give it a `key`. The factory only runs when that key is first selected:

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Card, LayoutConstraints } from '@jimka/typescript-ui/layout';

const container = Component();
const layout = Card();
container.setLayoutManager(layout);

container.addComponent(() => new GeneralPanel(),  Object.assign(new LayoutConstraints(), { key: 'general'  }));
container.addComponent(() => new NetworkPanel(),  Object.assign(new LayoutConstraints(), { key: 'network'  }));
container.addComponent(() => new AdvancedPanel(), Object.assign(new LayoutConstraints(), { key: 'advanced' }));

layout.setVisibleKey('network');   // builds NetworkPanel and shows it
```

The registration idiom is the same one [`Tab`](/layouts/Tab#lazy-panel-construction) uses, so a consumer who knows one writes the other. Two things differ. The `key` — not a generated id — is what names the slot, because a card has no tab strip to hold a handle for you and a page you cannot name is a page you cannot select. And deferral is opt-**in** rather than the default: a card defers a factory because its constraints carry a key, so `lazy: false` is only an opt-out, declining the deferral so the child is built at registration and stays selectable by key or by id. A factory with no key at all is built immediately, since nothing could select it afterwards; combining `lazy: true` with no key is reported and built immediately for the same reason.

A page is built at most once. Re-selecting a key that has already been built is instant, and its scroll position and form state are preserved, exactly as for an eagerly-added child.

[`CardOptions`](/api/layout/interfaces/CardOptions) accepts `visibleKey` declaratively, alongside `visibleComponentId`. The key is held whether or not a slot answers to it yet, so selecting one before its factory is registered still works — the first layout pass of a rendered container that can see the registration builds the page and shows it. Register before selecting even so: a selection that lands while *no* slot carries the key is reported, so the warning stays a real signal rather than startup noise. A key whose slot is registered but not yet built is not reported, because "not built yet" is not "not found". The two spellings share one selection, so `setVisibleKey` clears any configured `visibleComponentId` and `setVisibleComponentId` clears any configured key.

Three rules are specific to `Card`:

- **The build is synchronous.** The factory runs on the caller's stack inside `setVisibleKey`, with no spinner and no yield. A factory returning a promise throws — an asynchronous factory needs a [`Tab`](/layouts/Tab#async-factories)-managed container, which has somewhere to mount a spinner and an `"exception"` event to report a rejection on.
- **A key names at most one slot.** Registering a second factory under a key that already names a slot — pending or already built — is reported and discarded, and the first registration keeps the key. The same applies in reverse: a live child that carries a key a pending factory was registered under wins, and the factory is dropped unbuilt.
- **Selecting an unknown key falls back to the first child**, the same way an unknown component ID does, and reports it. Use [`hasKey(key)`](/api/layout/classes/Card#haskey) as the pre-flight when the key may not be one this card has — a router matching a URL segment, say:

```typescript
if (layout.hasKey(slug)) {
    layout.setVisibleKey(slug);
}
```

Sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`) never run a factory: an unbuilt card reports no size rather than constructing every page to answer a measurement.

## When to use it

- Wizard / step-by-step flows where one screen is visible at a time.
- Loading / content / error state machines.
- Any "show one of N panels" pattern that doesn't need tab buttons (otherwise use [`Tab`](/layouts/Tab)).

## Notes

- Hidden children remain in the component tree and keep their state. Use this property to preserve form inputs across step transitions.
- Removing the visible child promotes the first of the remaining children — or leaves the card showing nothing, if it was the last one. The promotion lands on the next layout pass, so composing a removal with an insertion (`moveComponent`, `replaceComponent`) settles on one visible child rather than two. The removed child keeps whatever displayed state it had, so a child removed while it was *inactive* is still `display: none` and the caller re-displays it with `setDisplayed(true)`.
- For a tabbed UI with toolbar buttons, use [`Tab`](/layouts/Tab).

## See also

- [API: Card](/api/layout/classes/Card)
- [`Tab`](/layouts/Tab) — same one-at-a-time semantics, plus a button toolbar
- [`Fit`](/layouts/Fit) — single fixed child
