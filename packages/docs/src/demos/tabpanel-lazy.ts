import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { TabPanel } from '@jimka/typescript-ui/component/container';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is the tab strip, its content panel, and the build log below it.
 */
export const height: number = 260;

/**
 * Three lazily-built tabs; each factory logs a line the first time its tab
 * is selected, and never logs again on a later reselection.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const logText = Text('Build log: (none yet)');

    const tabs = TabPanel();

    tabs.addLazyTab(buildAlpha, 'Alpha');
    tabs.addLazyTab(buildBeta,  'Beta');
    tabs.addLazyTab(buildGamma, 'Gamma');

    function buildAlpha(): Component {
        appendLog('Alpha built');

        return Text('Alpha content');
    }

    function buildBeta(): Component {
        appendLog('Beta built');

        return Text('Beta content');
    }

    function buildGamma(): Component {
        appendLog('Gamma built');

        return Text('Gamma content');
    }

    function appendLog(line: string): void {
        logText.setText(`${logText.getText()}\n${line}`);
    }

    return Panel({
        layoutManager: VBox({ spacing: 8, stretching: true }),
        components:    [tabs, logText],
    });
}
