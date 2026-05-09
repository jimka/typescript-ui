// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Base/Component.js";
import { Tab } from "./Base/layout/Tab.js";
import { VBox } from "./Base/layout/VBox.js";
import { HBox } from "./Base/layout/HBox.js";
import { Fit } from "./Base/layout/Fit.js";
import { Text } from "./Base/component/Text.js";
import { Button } from "./Base/component/Button.js";
import { Insets } from "./Base/Insets.js";

/**
 * Demonstrates the Tab layout manager with both normal and closeable tabs,
 * including programmatic tab addition and a close-event log.
 */
export class TabPanel extends Component {

    private tabContainer: Component;
    private tabLayout: Tab;
    private logText: Text;
    private tabCounter: number;

    /**
     * Creates the TabPanel demo with a control toolbar, a tabbed area, and a close-event log.
     */
    constructor() {
        super();

        const outerVBox = new VBox();
        outerVBox.setStretching(true);
        this.setLayoutManager(outerVBox);
        this.setInsets(new Insets(8, 8, 8, 8));

        this.tabCounter = 3;

        // --- Controls toolbar ---
        const toolbar = new Component();
        toolbar.setLayoutManager(new HBox());
        toolbar.setPreferredSize(0, 36);

        const addNormalBtn = new Button("Add Tab");
        addNormalBtn.setPreferredSize(90, 28);
        toolbar.addComponent(addNormalBtn);

        const addCloseableBtn = new Button("Add Closeable Tab");
        addCloseableBtn.setPreferredSize(140, 28);
        toolbar.addComponent(addCloseableBtn);

        this.addComponent(toolbar);

        // --- Tab container ---
        this.tabContainer = new Component();
        this.tabLayout = new Tab();
        this.tabContainer.setLayoutManager(this.tabLayout);
        this.tabContainer.setPreferredSize(0, 300);

        this.tabLayout.setOnTabClose((component: Component) => {
            this.logText.setText(`Closed: ${component.getId()}`);
            this.doLayout();
        });

        this.tabContainer.addComponent(this.buildContent("Alpha"), { name: "Alpha" });
        this.tabContainer.addComponent(this.buildContent("Beta"), { name: "Beta", closeable: true });
        this.tabContainer.addComponent(this.buildContent("Gamma"), { name: "Gamma", closeable: true });

        this.addComponent(this.tabContainer);

        // --- Log row ---
        const logRow = new Component();
        logRow.setLayoutManager(new HBox());
        logRow.setPreferredSize(0, 28);

        const logHeadingText = new Text("Last closed:");
        logHeadingText.setPreferredSize(90, 28);
        logRow.addComponent(logHeadingText);

        this.logText = new Text("—");
        this.logText.setPreferredSize(300, 28);
        logRow.addComponent(this.logText);

        this.addComponent(logRow);

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
        const panel = new Component();
        panel.setLayoutManager(new Fit());

        const text = new Text(`Content: ${title}`);
        text.setPreferredSize(0, 24);

        panel.addComponent(text, { anchor: 5 });
        panel.setInsets(new Insets(12, 12, 12, 12));

        return panel;
    }
}
