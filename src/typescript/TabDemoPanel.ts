// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component } from '@jimka/typescript-ui/core';
import { Insets } from '@jimka/typescript-ui/primitive';
import { Fit, HBox, Tab, VBox } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { TabPanel, TabPanelOptions } from '@jimka/typescript-ui/component/container';
/**
 * Demonstrates the Tab layout manager with both normal and closeable tabs,
 * including programmatic tab addition and a close-event log.
 */
class TabDemoPanel extends Component {

    private tabContainer: Component;
    private tabLayout: Tab;
    private logText: Text;
    private tabCounter: number;

    /**
     * Creates the TabDemoPanel demo with a control toolbar, a tabbed area, and a close-event log.
     */
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

        // --- Tab container ---
        this.tabContainer = new Component({ preferredSize: { width: 0, height: 300 } });
        this.tabLayout = new Tab({
            onTabClose: (component: Component) => {
                this.logText.setText(`Closed: ${component.getId()}`);
                this.doLayout();
            },
        });
        this.tabContainer.setLayoutManager(this.tabLayout);

        this.tabContainer.addComponent(this.buildContent("Alpha"), { name: "Alpha" });
        this.tabContainer.addComponent(this.buildContent("Beta"), { name: "Beta", closeable: true });
        this.tabContainer.addComponent(this.buildContent("Gamma"), { name: "Gamma", closeable: true });

        this.addComponent(this.tabContainer);

        // --- Log row ---
        const logRow = new Component({ preferredSize: { width: 0, height: 28 } });
        logRow.setLayoutManager(new HBox());

        logRow.addComponent(new Text("Last closed:", { preferredSize: { width: 90, height: 28 } }));

        this.logText = new Text("—", { preferredSize: { width: 300, height: 28 } });
        logRow.addComponent(this.logText);

        this.addComponent(logRow);

        // --- Framework TabPanel exemplar ---
        // Same content shape as the bare-Tab-on-Component form above, but
        // built through the convenience `TabPanel` subclass so the two
        // paths render identically side by side. Demonstrates that the
        // framework class is a drop-in replacement.
        const exemplarHeader = new Text("Framework TabPanel:", {
            preferredSize: { width: 0, height: 24 },
        });
        this.addComponent(exemplarHeader);

        const frameworkExemplar = new TabPanel({
            preferredSize: { width: 0, height: 200 },
            tabs: [
                { label: "One",   component: this.buildContent("One")  },
                { label: "Two",   component: this.buildContent("Two"), closeable: true },
                { label: "Three", component: this.buildContent("Three") },
            ],
            onTabClose: (component: Component) => {
                this.logText.setText(`Framework closed: ${component.getId()}`);
            },
        } as TabPanelOptions);
        this.addComponent(frameworkExemplar);

        // --- Wire controls ---
        addNormalBtn.addActionListener(() => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabContainer.addComponent(this.buildContent(label), { name: label });
            this.doLayout();
        });

        addCloseableBtn.addActionListener(() => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabContainer.addComponent(this.buildContent(label), { name: label, closeable: true });
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
