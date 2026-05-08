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
    Label,
} from '@jika/typescript-ui';

const sidebar = new Component();
const accordion = new Accordion();
sidebar.setLayoutManager(accordion);

const section1 = new Component();
section1.addComponent(new Label('Content of section 1'));
sidebar.addComponent(section1, new AccordionConstraints('Section 1', true));

const section2 = new Component();
section2.addComponent(new Label('Content of section 2'));
sidebar.addComponent(section2, new AccordionConstraints('Section 2'));

accordion.setSingleOpen(true);  // optional: only one section open at a time
```

## Per-child constraints

[`AccordionConstraints`](/api/classes/AccordionConstraints):

| Field | Purpose |
| --- | --- |
| `label` | Header button text (required). |
| `initiallyOpen` | When `true`, the section starts expanded. Default: `false`. |

## Toggle callback

```typescript
import { SectionToggleCallback } from '@jika/typescript-ui';

const onToggle: SectionToggleCallback = (index, open) => {
    console.log(`section ${index} now ${open ? 'open' : 'closed'}`);
};

accordion.setOnToggle(onToggle);
```

## See also

- [API: Accordion](/api/classes/Accordion)
- [API: AccordionConstraints](/api/classes/AccordionConstraints)
- [API: SectionToggleCallback](/api/type-aliases/SectionToggleCallback)
- [`AccordionHeader`](/api/classes/AccordionHeader) — the section header
