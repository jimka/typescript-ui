# AccordionPanel

[`AccordionPanel`](/api/component/container/classes/AccordionPanel) is a [`Panel`](/api/core/classes/Panel) subclass that owns an internal [`Accordion`](/api/layout/classes/Accordion) layout manager. It exposes a section-typed `addSection` surface, so consumers don't have to wire `new Panel({ layoutManager: new Accordion() })` themselves.

The bare `new Panel({ layoutManager: new Accordion() })` form still works — `AccordionPanel` is the convenience entry point. Section operations and events are reached through the wrapped manager via [`getAccordion`](/api/component/container/classes/AccordionPanel#getaccordion).

## Usage

```typescript
import { AccordionPanel } from '@jimka/typescript-ui/component/container';

const acc = new AccordionPanel({
    singleOpen: true,
    sections: [
        { label: 'Profile',     component: profilePanel, initiallyOpen: true },
        { label: 'Preferences', component: prefsPanel },
    ],
});
```

`sections` is the construction-time shortcut. Each entry maps to one [`addSection`](/api/component/container/classes/AccordionPanel#addsection) call. The optional `initiallyOpen` flag mirrors the `Accordion` constraint of the same name.

## Adding sections after construction

```typescript
acc.addSection(advancedPanel, "Advanced");
acc.addSection(dangerZonePanel, "Danger zone", false);
```

## Programmatic open / close

Section state lives on the wrapped manager; reach it through [`getAccordion`](/api/component/container/classes/AccordionPanel#getaccordion):

```typescript
acc.getAccordion().openSection(0);                 // expand "Profile"
acc.getAccordion().closeSection(1);                // collapse "Preferences"
const open = acc.getAccordion().isSectionOpen(0);  // → true
```

## Single-open mode

`singleOpen: true` enforces that at most one section is expanded at a time — opening one auto-collapses the rest. Toggle at runtime through the manager:

```typescript
acc.getAccordion().setSingleOpen(false);  // allow multiple sections open simultaneously
```

## Toggle callback

Pass `onSectionToggle` at construction, or call [`getAccordion().on("sectiontoggle", ...)`](/api/layout/classes/Accordion#on) to react to expand / collapse events:

```typescript
new AccordionPanel({
    sections: [...],
    onSectionToggle: (index, open) =>
        console.log(`Section ${index} is now ${open ? "open" : "closed"}`),
});
```

## Accessing the underlying `Accordion` manager

[`getAccordion`](/api/component/container/classes/AccordionPanel#getaccordion) is the typed accessor for `this.getLayoutManager() as Accordion`. It is the supported path for everything beyond construction and `addSection` — open/close, single-open mode, constraint inspection, and `sectiontoggle` events:

```typescript
const manager = acc.getAccordion();
```

## When to use `AccordionPanel` vs bare `Panel` + `Accordion`

- Reach for `AccordionPanel` when you want a sectioned panel with the typed `addSection` surface and the standard single-open / toggle-callback wiring.
- Reach for bare `new Panel({ layoutManager: new Accordion() })` when you need custom [`AccordionConstraints`](/api/layout/classes/AccordionConstraints) per section, or the `Accordion` instance is constructed elsewhere and passed in.
