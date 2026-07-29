import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Accordion, AccordionConstraints } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is three section headers plus the initially-open section's content
 * and the surrounding frame.
 */
export const height: number = 260;

/**
 * Three `Accordion` sections in single-open mode; clicking a header
 * animates the previous section shut and the clicked one open.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const firstSection = Text('Content of section 1');

    const secondSection = Text('Content of section 2');

    const thirdSection = Text('Content of section 3');

    const accordion = Panel({ layoutManager: Accordion({ singleOpen: true, fillHeight: true }) });

    accordion.addComponent(firstSection,  new AccordionConstraints('Section 1', true));
    accordion.addComponent(secondSection, new AccordionConstraints('Section 2'));
    accordion.addComponent(thirdSection,  new AccordionConstraints('Section 3'));

    return accordion;
}
