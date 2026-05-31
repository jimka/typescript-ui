// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component } from '@jimka/typescript-ui/core';
import { Insets } from '@jimka/typescript-ui/primitive';
import { Fit, HBox, VBox, TabWidthMode } from '@jimka/typescript-ui/layout';
import { Text, ComboBox, NumberSpinner } from '@jimka/typescript-ui/component/input';
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

        const toggleBorderBtn = new Button("Toggle Under-border");
        toolbar.addComponent(toggleBorderBtn);

        this.addComponent(toolbar);

        // --- Tab-width experimentation row ---
        // `fill` stretches tabs to share the strip; `content` caps each tab's
        // own width at Max; `equal` sizes every tab to the widest (capped at
        // Max); `fixed` pins every tab to Fixed px. Tweak the numbers live.
        const widthRow = new Component();
        widthRow.setLayoutManager(new HBox());

        const widthModes: TabWidthMode[] = ["fill", "content", "equal", "fixed"];
        const modeCombo = new ComboBox({ items: widthModes, selectedIndex: 2 });

        const maxSpinner = new NumberSpinner({ min: 40, max: 400, step: 10, value: 160 });
        const fixedSpinner = new NumberSpinner({ min: 40, max: 400, step: 10, value: 120 });

        widthRow.addComponent(new Text("Width mode:", { preferredSize: { width: 80, height: 28 } }));
        widthRow.addComponent(modeCombo);
        widthRow.addComponent(new Text("Max:", { preferredSize: { width: 36, height: 28 } }));
        widthRow.addComponent(maxSpinner);
        widthRow.addComponent(new Text("Fixed:", { preferredSize: { width: 44, height: 28 } }));
        widthRow.addComponent(fixedSpinner);

        this.addComponent(widthRow);

        // --- TabPanel ---
        // Starts in `content` mode at Max 160 so the sliding selection
        // indicator is easy to see as it travels between capped, left-aligned
        // tabs; the row above switches strategy and values live.
        this.tabPanel = new TabPanel({
            preferredSize: { width: 0, height: 300 },
            tabWidthMode: "equal",
            tabMaxWidth: 160,
            tabFixedWidth: 120,
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

        // --- Wire width controls ---
        // The ComboBox keys plain string items by index, so its `getValue()`
        // returns the row index, not the label — map the selected index back to
        // the mode rather than reading the value.
        modeCombo.on("change", () => {
            this.tabPanel.setTabWidthMode(widthModes[modeCombo.getSelectedIndex()]);
            this.doLayout();
        });

        maxSpinner.on("change", () => {
            this.tabPanel.setTabMaxWidth(maxSpinner.getValue());
            this.doLayout();
        });

        fixedSpinner.on("change", () => {
            this.tabPanel.setTabFixedWidth(fixedSpinner.getValue());
            this.doLayout();
        });

        // --- Log row ---
        const logRow = new Component({ preferredSize: { width: 0, height: 28 } });
        logRow.setLayoutManager(new HBox());

        logRow.addComponent(new Text("Last closed:", { preferredSize: { width: 90, height: 28 } }));

        this.logText = new Text("—", { preferredSize: { width: 300, height: 28 } });
        logRow.addComponent(this.logText);

        this.addComponent(logRow);

        // --- Wire controls ---
        addNormalBtn.on("action", () => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabPanel.addTab(this.buildContent(label), label);
            this.doLayout();
        });

        addCloseableBtn.on("action", () => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabPanel.addTab(this.buildContent(label), label, { closeable: true });
            this.doLayout();
        });

        toggleBorderBtn.on("action", () => {
            this.tabPanel.setTabUnderBorderFullWidth(!this.tabPanel.isTabUnderBorderFullWidth());
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
