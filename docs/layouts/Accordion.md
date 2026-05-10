# Accordion

[`Accordion`](/api/classes/Accordion) stacks vertically collapsible sections, each with a clickable [`AccordionHeader`](/api/classes/AccordionHeader) and a content panel. Sections expand and collapse independently by default; opt into single-open mode for "only one section at a time" behaviour.

```
▾ Section 1
  +----------------------+
  |  expanded content    |
  +----------------------+
▸ Section 2
▸ Section 3
```

## Usage

```typescript
import {
    Component, Accordion, AccordionConstraints,
    Text,
} from '@jimka/typescript-ui';

const sidebar = new Component();
sidebar.setLayoutManager(new Accordion({
    singleOpen       : true,        // only one section open at a time
    headerHeight     : 32,
    animationDuration: 150,
    onSectionToggle  : (idx, open) => console.log(idx, open),
}));

const section1 = new Component();
section1.addComponent(new Text('Content of section 1'));
sidebar.addComponent(section1, new AccordionConstraints('Section 1', true));

const section2 = new Component();
section2.addComponent(new Text('Content of section 2'));
sidebar.addComponent(section2, new AccordionConstraints('Section 2'));
```

[`AccordionOptions`](/api/interfaces/AccordionOptions) accepts `singleOpen`, `headerHeight`, `animationDuration`, and `onSectionToggle` declaratively. The corresponding setters (`setSingleOpen`, `setHeaderHeight`, `setAnimationDuration`, `setOnSectionToggle`) still work for runtime updates.

## Per-child constraints

[`AccordionConstraints`](/api/classes/AccordionConstraints):

| Field | Purpose |
| --- | --- |
| `label` | Header button text (required). |
| `initiallyOpen` | When `true`, the section starts expanded. Default: `false`. |

## Toggle callback

Pass `onSectionToggle` in the constructor (preferred) or call `setOnSectionToggle` later:

```typescript
import { SectionToggleCallback } from '@jimka/typescript-ui';

const onToggle: SectionToggleCallback = (index, open) => {
    console.log(`section ${index} now ${open ? 'open' : 'closed'}`);
};

accordion.setOnSectionToggle(onToggle);
```

## See also

- [API: Accordion](/api/classes/Accordion)
- [API: AccordionConstraints](/api/classes/AccordionConstraints)
- [API: SectionToggleCallback](/api/type-aliases/SectionToggleCallback)
- [`AccordionHeader`](/api/classes/AccordionHeader) — the section header
