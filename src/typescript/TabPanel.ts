// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    Button,
    callable,
    Component,
    Fit,
    HBox,
    Insets,
    Tab,
    Text,
    VBox
} from "@jimka/typescript-ui";

/**
 * Demonstrates the Tab layout manager with both normal and closeable tabs,
 * including programmatic tab addition and a close-event log.
 */
class TabPanel extends Component {

    private tabContainer: Component;
    private tabLayout: Tab;
    private logText: Text;
    private tabCounter: number;

    /**
     * Creates the TabPanel demo with a control toolbar, a tabbed area, and a close-event log.
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

const TabPanelCallable = callable(TabPanel);
type TabPanelCallable = TabPanel;
export {
    TabPanel         as _TabPanel,
    TabPanelCallable as TabPanel
};
