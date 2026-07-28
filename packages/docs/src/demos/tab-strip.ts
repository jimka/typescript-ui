import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Tab } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is the tab strip plus its content panel and the surrounding frame.
 */
export const height: number = 260;

/**
 * Three tabs over labelled panels; click a tab button to switch the
 * visible panel.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const generalPanel = Header('General');

    const networkPanel = Header('Network');

    const advancedPanel = Header('Advanced');

    const tabs = Panel({ layoutManager: Tab() });

    tabs.addComponent(generalPanel,  { name: 'General' });
    tabs.addComponent(networkPanel,  { name: 'Network' });
    tabs.addComponent(advancedPanel, { name: 'Advanced' });

    return tabs;
}
