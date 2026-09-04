// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component } from '@jimka/typescript-ui/core';
import { Insets, AxisEnd, AxisPosition } from '@jimka/typescript-ui/primitive';
import { Fit, HBox, VBox, DockRegion, TabWidthMode, TabSide, TabOrientation, LayoutConstraints } from '@jimka/typescript-ui/layout';
import { Text, ComboBox, NumberSpinner } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { TabPanel, TabToolDescriptor } from '@jimka/typescript-ui/component/container';
import { Glyph } from '@jimka/typescript-ui/component/display';
// Per-glyph subpath import (not the `glyphs/solid` barrel) so dev mode doesn't
// fetch all ~2,000 glyph modules — see MenuBarPanel for the rationale.
import { star } from '@jimka/typescript-ui/glyphs/solid/star';

Glyph.register(star);

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

        const addLazyBtn = new Button("Add Lazy Tab");
        toolbar.addComponent(addLazyBtn);

        const addFailingBtn = new Button("Add Failing Tab");
        toolbar.addComponent(addFailingBtn);

        const toggleBusyBtn = new Button("Toggle Busy");
        toolbar.addComponent(toggleBusyBtn);

        const toggleItalicBtn = new Button("Toggle Italic");
        toolbar.addComponent(toggleItalicBtn);

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

        // --- Placement / orientation experimentation row ---
        // `side` moves the strip to any edge; `align` hugs the tab group to the
        // leading or trailing edge; `orientation` rotates the text on the
        // vertical sides; `scroll` toggles a long strip between compress and
        // arrow-scrolling. `compact` / `reorder` toggle live.
        const placeRow = new Component();
        placeRow.setLayoutManager(new HBox());

        const sideModes: TabSide[] = ["north", "south", "west", "east"];
        const sideCombo = new ComboBox({ items: sideModes, selectedIndex: 0 });

        const alignModes: AxisEnd[] = ["start", "end"];
        const alignCombo = new ComboBox({ items: alignModes, selectedIndex: 0 });

        const orientationModes: TabOrientation[] = ["horizontal", "vertical-cw", "vertical-ccw"];
        const orientationCombo = new ComboBox({ items: orientationModes, selectedIndex: 0 });

        // Justification only shows when cells are wider than their content —
        // visible in `fill`/`equal`/`fixed` modes, not `content`. `start`/`end`
        // are flow-relative (left/right on a horizontal strip, top/bottom on a
        // rotated west/east strip).
        const alignTextModes: AxisPosition[] = ["start", "center", "end"];
        const alignTextCombo = new ComboBox({ items: alignTextModes, selectedIndex: 1 });

        const scrollBtn = new Button("Toggle Scroll");
        const compactBtn = new Button("Toggle Compact");
        const reorderBtn = new Button("Toggle Reorder");

        // Tool descriptor: the strip builds one flat "+" button pinned opposite the
        // tabs *and* a matching row in the context menu's "Tools" submenu, both
        // firing this one action — glyph/label/action declared once.
        const addTabTool: TabToolDescriptor = {
            label:  "New tab",
            glyph:  "plus",
            action: () => {
                this.tabCounter += 1;
                const label = `Tab ${this.tabCounter}`;
                this.tabPanel.addTab(this.buildContent(label), label);
            },
        };

        placeRow.addComponent(new Text("Side:", { preferredSize: { width: 36, height: 28 } }));
        placeRow.addComponent(sideCombo);
        placeRow.addComponent(new Text("Align:", { preferredSize: { width: 44, height: 28 } }));
        placeRow.addComponent(alignCombo);
        placeRow.addComponent(new Text("Orient:", { preferredSize: { width: 48, height: 28 } }));
        placeRow.addComponent(orientationCombo);
        placeRow.addComponent(new Text("Justify:", { preferredSize: { width: 50, height: 28 } }));
        placeRow.addComponent(alignTextCombo);
        placeRow.addComponent(scrollBtn);
        placeRow.addComponent(compactBtn);
        placeRow.addComponent(reorderBtn);

        this.addComponent(placeRow);

        // Right-click any tab button to open a context menu with a "Switch to"
        // submenu, the single + bulk close actions (others / to the right / to the
        // left / all), and a "Tools" submenu carrying the descriptor tool below.
        this.addComponent(new Text(
            "Tip: right-click a tab for Switch to, the close actions, and Tools.",
            { preferredSize: { width: 0, height: 24 } },
        ));

        // --- TabPanel ---
        // Starts in `content` mode at Max 160 so the sliding selection
        // indicator is easy to see as it travels between capped, left-aligned
        // tabs; the row above switches strategy and values live. Ships with a
        // tool button pinned opposite the tabs and within-strip reorder enabled.
        this.tabPanel = new TabPanel({
            preferredSize: { width: 0, height: 300 },
            tabOptions: {
                widthMode: "equal",
                maxWidth: 160,
                fixedWidth: 120,
                reorderable: true,
                tools: [addTabTool],
            },
            tabs: [
                { label: "Alpha", component: this.buildContent("Alpha"), glyph: "star" },
                { label: "Beta",  component: this.buildContent("Beta"),  closeable: true },
                { label: "Gamma", component: this.buildContent("Gamma"), closeable: true },
                // Factories through the options bag: deferred until first activation.
                { label: "Lazy",  component: () => this.buildSlowContent("Lazy") },
                { label: "Async", component: () => this.buildAsyncContent("Async") },
            ],
            onTabClose: (component: Component) => {
                this.logText.setText(`Closed: ${component.getId()}`);
            },
        });

        this.addComponent(this.tabPanel);

        // Tear-off / re-dock: with reorder enabled, dragging a tab header off the
        // strip into empty space floats it in a Window, and dragging a tab onto
        // the second strip below docks its live content there as a new tab.
        this.addComponent(new Text(
            "Tip: tear a tab off the top strip → a one-tab window (drag its tab back to re-dock); tear one off the bottom strip → a bare window (Shift-drag its title bar onto a strip to re-dock).",
            { preferredSize: { width: 0, height: 24 } },
        ));

        // --- Second strip: a drop target for cross-strip re-dock ---
        // `detachWindowMode: "bare"` here (vs. the default "strip" on the first
        // strip) so both tear-off styles are exercisable: tear a tab off the top
        // strip → a one-tab-strip window; tear one off this strip → a bare window
        // that Shift-drags back onto a strip.
        const dockTarget = new TabPanel({
            preferredSize: { width: 0, height: 180 },
            tabOptions: {
                widthMode: "equal",
                maxWidth: 160,
                reorderable: true,
                detachWindowMode: "bare",
            },
            tabs: [
                { label: "Delta",   component: this.buildContent("Delta"),   closeable: true },
                { label: "Epsilon", component: this.buildContent("Epsilon"), closeable: true },
            ],
        });

        this.addComponent(dockTarget);

        // --- Edge-drop-to-split region ---
        // A plain region wrapped by a DockRegion: dragging a tab from either
        // strip above and dropping on an edge splits the region (wrapping it in a
        // new Split, or extending a same-axis one); dropping on the centre adds
        // the tab. The five-zone overlay highlights the band under the cursor.
        this.addComponent(new Text(
            "Tip: drag a tab from a strip above onto the region below — drop near an edge to split it, or on the centre to add it as a tab.",
            { preferredSize: { width: 0, height: 24 } },
        ));

        this.addComponent(new Text(
            "Tip: emptying a dropped stack (tear its last tab into a window, re-dock it, or close it) removes the empty stack and collapses the leftover single-pane split.",
            { preferredSize: { width: 0, height: 24 } },
        ));

        // Named so a centre-drop, which wraps this region itself as a tab, shows
        // "Workspace" rather than the region's UUID.
        const splitRegion = new Component({ preferredSize: { width: 0, height: 220 }, name: "Workspace" });
        splitRegion.setLayoutManager(new Fit());
        splitRegion.addComponent(this.buildContent("Drop tabs on my edges"));

        this.addComponent(splitRegion);

        // Constructed for its side effect: DockRegion registers splitRegion as a
        // drop target with DragManager, whose registry keeps it alive — so the
        // demo needs no handle (a real consumer would keep one to call destroy()).
        new DockRegion(splitRegion);

        // --- Wire placement controls ---
        sideCombo.on("change", () => {
            this.tabPanel.getTab().setSide(sideModes[sideCombo.getSelectedIndex()]);
        });

        alignCombo.on("change", () => {
            this.tabPanel.getTab().setAlign(alignModes[alignCombo.getSelectedIndex()]);
        });

        orientationCombo.on("change", () => {
            this.tabPanel.getTab().setOrientation(orientationModes[orientationCombo.getSelectedIndex()]);
        });

        alignTextCombo.on("change", () => {
            this.tabPanel.getTab().setTextAlign(alignTextModes[alignTextCombo.getSelectedIndex()]);
        });

        scrollBtn.on("action", () => {
            this.tabPanel.getTab().setScrollable(!this.tabPanel.getTab().isScrollable());
        });

        compactBtn.on("action", () => {
            this.tabPanel.getTab().setCompact(!this.tabPanel.getTab().isCompact());
        });

        reorderBtn.on("action", () => {
            this.tabPanel.getTab().setReorderable(!this.tabPanel.getTab().isReorderable());
        });

        // --- Wire width controls ---
        // The ComboBox keys plain string items by index, so its `getValue()`
        // returns the row index, not the label — map the selected index back to
        // the mode rather than reading the value.
        modeCombo.on("change", () => {
            this.tabPanel.getTab().setWidthMode(widthModes[modeCombo.getSelectedIndex()]);
        });

        maxSpinner.on("change", () => {
            this.tabPanel.getTab().setMaxWidth(maxSpinner.getValue());
        });

        fixedSpinner.on("change", () => {
            this.tabPanel.getTab().setFixedWidth(fixedSpinner.getValue());
        });

        // --- Log row ---
        const logRow = new Component({ preferredSize: { width: 0, height: 28 } });
        logRow.setLayoutManager(new HBox());

        logRow.addComponent(new Text("Last event:", { preferredSize: { width: 90, height: 28 } }));

        this.logText = new Text("—", { preferredSize: { width: 300, height: 28 } });
        logRow.addComponent(this.logText);

        this.addComponent(logRow);

        // --- Wire controls ---
        addNormalBtn.on("action", () => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabPanel.addTab(this.buildContent(label), label);
        });

        addCloseableBtn.on("action", () => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabPanel.addTab(this.buildContent(label), label, { closeable: true });
        });

        // The raw container path — not the addLazyTab helper — so the demo
        // exercises what a consumer now writes.
        addLazyBtn.on("action", () => {
            this.tabCounter += 1;
            const label = `Tab ${this.tabCounter}`;
            this.tabPanel.addComponent(
                () => this.buildSlowContent(label),
                Object.assign(new LayoutConstraints(), { name: label, closeable: true }),
            );
        });

        addFailingBtn.on("action", () => {
            this.tabCounter += 1;
            const label = `Fail ${this.tabCounter}`;
            this.tabPanel.addComponent(
                () => this.buildFailingContent(label),
                Object.assign(new LayoutConstraints(), { name: label, closeable: true }),
            );
        });

        this.tabPanel.getTab().on("exception", (error, label) => {
            this.logText.setText(`Failed: ${label} — ${String(error)}`);
        });

        toggleBusyBtn.on("action", () => {
            const content = this.tabPanel.getTab().getActiveContent();

            if (content) {
                this.tabPanel.getTab().setTabBusy(content, !this.tabPanel.getTab().isTabBusy(content));
            }
        });

        this.tabPanel.getTab().on("busychange", (busy, label) => {
            this.logText.setText(`${busy ? "Loading" : "Loaded"}: ${label}`);
        });

        toggleItalicBtn.on("action", () => {
            const content = this.tabPanel.getTab().getActiveContent();

            if (content) {
                this.tabPanel.getTab().setTabItalic(content, !this.tabPanel.getTab().isTabItalic(content));
            }
        });

        toggleBorderBtn.on("action", () => {
            this.tabPanel.getTab().setUnderBorderFullWidth(!this.tabPanel.getTab().isUnderBorderFullWidth());
        });
    }

    /**
     * Builds content the slow way, blocking long enough that the spinner is
     * visible before the panel appears. Stands in for an expensive synchronous
     * build.
     *
     * @param title - The text shown inside the tab content area.
     * @returns The content component.
     */
    private buildSlowContent(title: string): Component {
        const end = Date.now() + 400;
        while (Date.now() < end) {
            // Deliberate busy-wait: a real panel's cost is main-thread work.
        }

        return this.buildContent(title);
    }

    /**
     * Builds content that is not available until a simulated fetch resolves.
     * The spinner stays up for the whole wait.
     *
     * @param title - The text shown inside the tab content area.
     * @returns A promise resolving to the content component.
     */
    private buildAsyncContent(title: string): Promise<Component> {
        return new Promise<Component>(resolve => {
            setTimeout(() => resolve(this.buildContent(title)), 1200);
        });
    }

    /**
     * Builds content whose simulated fetch fails, so the tab closes itself and
     * the layout emits `"exception"`.
     *
     * @param title - The label the failed tab carried.
     * @returns A promise rejecting after a short wait.
     */
    private buildFailingContent(title: string): Promise<Component> {
        return new Promise<Component>((_resolve, reject) => {
            setTimeout(() => reject(new Error(`${title}: metadata fetch failed`)), 800);
        });
    }

    /**
     * Builds a simple content panel with centered text.
     *
     * @param title - The text shown inside the tab content area.
     * @returns The content component.
     */
    private buildContent(title: string): Component {
        // Intrinsic name travels with the panel: when it is edge/centre-dropped
        // into a stack or torn off, the tab/window title reads `title` instead
        // of the component's UUID — no LayoutConstraints.name needed.
        const panel = new Component({ insets: new Insets(12, 12, 12, 12), name: title });
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
