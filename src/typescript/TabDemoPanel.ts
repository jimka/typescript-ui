// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component } from '@jimka/typescript-ui/core';
import { Insets } from '@jimka/typescript-ui/primitive';
import { Fit, HBox, VBox } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { TabPanel } from '@jimka/typescript-ui/component/container';

/**
 * Demonstrates the framework {@link TabPanel} (a Panel subclass that wraps
 * the Tab layout manager) with both normal and closeable tabs, programmatic
 * tab addition, and a close-event log.
 */
class TabDemoPanel extends Component {

    private tabPanel:   TabPanel;
    private logText:    Text;
    private tabCounter: number;

    constructor() {
        super();

        this.setLayoutManager(new VBox({ stretching: true }));
        this.setInsets(new Insets(8, 8, 8, 8));

        this.tabCounter = 3;

        // --- Controls toolbar ---
        const toolbar = new Component();
        toolbar.setLayoutManager(new HBox());

        const addNormalBtn = new Button("Add Tab");
        toolbar.addComponent(addNormalBtn);

        const addCloseableBtn = new Button("Add Closeable Tab");
        toolbar.addComponent(addCloseableBtn);

        this.addComponent(toolbar);

        // --- TabPanel ---
        this.tabPanel = new TabPanel({
            preferredSize: { width: 0, height: 300 },
            tabs: [
                { label: "Alpha", component: this.buildContent("Alpha") },
                { label: "Beta",  component: this.buildContent("Beta"),  closeable: true },
                { label: "Gamma", component: this.buildContent("Gamma"), closeable: true },
            ],
            onTabClose: (component: Component) => {
                this.logText.setText(`Closed: ${component.getId()}`);
                this.doLayout();
            },
        });

        this.addComponent(this.tabPanel);

        // --- Log row ---
        const logRow = new Component({ preferredSize: { width: 0, height: 28 } });
        logRow.setLayoutManager(new HBox());

        logRow.addComponent(new Text("Last closed:", { preferredSize: { width: 90, height: 28 } }));

        this.logText = new Text("—", { preferredSize: { width: 300, height: 28 } });
        logRow.addComponent(this.logText);

        this.addComponent(logRow);

        // --- Wire controls ---
        addNormalBtn.on("click", () => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabPanel.addTab(this.buildContent(label), label);
            this.doLayout();
        });

        addCloseableBtn.on("click", () => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabPanel.addTab(this.buildContent(label), label, { closeable: true });
            this.doLayout();
        });
    }

    /**
     * Builds a simple content panel with centered text.
     *
     * @param title - The text shown inside the tab content area.
     * @returns The content component.
     */
    private buildContent(title: string): Component {
        const panel = new Component({ insets: new Insets(12, 12, 12, 12) });
        panel.setLayoutManager(new Fit());

        panel.addComponent(
            new Text(`Content: ${title}`, { preferredSize: { width: 0, height: 24 } }),
            { anchor: 5 },
        );

        return panel;
    }
}

const TabDemoPanelCallable = callable(TabDemoPanel);
type TabDemoPanelCallable = TabDemoPanel;
export {
    TabDemoPanel         as _TabDemoPanel,
    TabDemoPanelCallable as TabDemoPanel
};
