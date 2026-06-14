// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Border as BorderLayout, Fit, HBox } from '@jimka/typescript-ui/layout';
import { serializeLayout, restoreLayout, LayoutState, LayoutFactory } from '@jimka/typescript-ui/layout';
import { TextArea } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

// The same three content panels are arranged differently by each preset; the
// factory always hands back these instances (the stable-instance contract), so
// text typed into a panel survives a topology switch.
const PANEL_IDS = ["alpha", "beta", "gamma"] as const;

// A horizontal split with a wide centre pane.
const SPLIT_LAYOUT: LayoutState = {
    version: 1,
    root:    {
        kind:      "split",
        direction: "horizontal",
        children:  PANEL_IDS.map(id => ({ kind: "panel", panelId: id })),
        ratios:    [0.25, 0.5, 0.25],
        collapsed: [false, false, false],
    },
    windows: [],
};

// The same three panels stacked as tabs, with the middle one active — a full
// topology change from the split, not just different geometry.
const TAB_LAYOUT: LayoutState = {
    version: 1,
    root:    {
        kind:        "tab",
        children:    PANEL_IDS.map(id => ({ kind: "panel", panelId: id })),
        activeIndex: 1,
    },
    windows: [],
};

// "alpha" and "beta" split in the root, "gamma" floated into a Window — the
// orthogonal window plane captured beside the in-root tree.
const WINDOW_LAYOUT: LayoutState = {
    version: 1,
    root:    {
        kind:      "split",
        direction: "horizontal",
        children:  [{ kind: "panel", panelId: "alpha" }, { kind: "panel", panelId: "beta" }],
        ratios:    [0.5, 0.5],
        collapsed: [false, false],
    },
    windows: [
        {
            kind:        "window",
            panelId:     "gamma",
            header:      "Gamma — floated",
            // Opening rect; wide enough for the title plus the header's
            // min/max/close buttons (~410px floor), with a comfortable height.
            // The window clamps it to the viewport.
            rect:        { x: 220, y: 160, width: 430, height: 260 },
            state:       "normal",
            restoreRect: null,
        },
    ],
};

/**
 * Demonstrates layout serialization and runtime layout-switching. Three named
 * content panels are arranged by two presets — a horizontal `Split` and a
 * `Tab` — that the buttons apply via `restoreLayout`. Because restore parks and
 * re-homes the same panel instances, text typed into a panel persists across a
 * switch; the "Serialize → console" button logs the live arrangement.
 *
 * @category Demo
 */
class LayoutSerializationPanel extends Panel {

    // The container restore rebuilds the arrangement onto.
    private _root: Component = new Component();

    // Stable panel instances, keyed by serialization ID.
    private _panels: Map<string, Component> = new Map<string, Component>();

    // Hands back the same instance per ID — the contract restore relies on to
    // preserve panel state across a switch.
    private _factory: LayoutFactory = (panelId: string): Component | null => this._panels.get(panelId) ?? null;

    constructor() {
        super();

        this.setLayoutManager(new BorderLayout());

        this.buildPanels();

        this._root.setLayoutManager(new Fit());

        this.addComponent(this.buildToolbar(), { placement: Placement.NORTH });
        this.addComponent(this._root,          { placement: Placement.CENTER });

        // Seed the initial arrangement through the same restore path the
        // buttons use.
        restoreLayout(this._root, SPLIT_LAYOUT, this._factory);
    }

    /**
     * Builds the three stable content panels, each a labelled text area so its
     * state is visible and editable for the survives-a-switch demonstration.
     */
    private buildPanels(): void {
        for (const id of PANEL_IDS) {
            // The id is the serialization key (serializeLayout keys on getId()),
            // so stamp it here for the captured layout to round-trip.
            const panel = new Panel({ id });
            panel.setLayoutManager(new Fit());
            panel.addComponent(new TextArea("Panel \"" + id + "\" — type here, then switch layouts."));

            this._panels.set(id, panel);
        }
    }

    /**
     * Builds the button row that applies the presets and logs the serialized
     * arrangement.
     *
     * @returns The toolbar component.
     */
    private buildToolbar(): Component {
        const toolbar = new Component();
        toolbar.setLayoutManager(new HBox({ spacing: 8 }));

        const splitButton = new Button("Split layout");
        splitButton.on("action", () => restoreLayout(this._root, SPLIT_LAYOUT, this._factory));
        toolbar.addComponent(splitButton);

        const tabButton = new Button("Tab layout");
        tabButton.on("action", () => restoreLayout(this._root, TAB_LAYOUT, this._factory));
        toolbar.addComponent(tabButton);

        const windowButton = new Button("Window layout");
        windowButton.on("action", () => restoreLayout(this._root, WINDOW_LAYOUT, this._factory));
        toolbar.addComponent(windowButton);

        const serializeButton = new Button("Serialize → console");
        serializeButton.on("action", () => console.log(JSON.stringify(serializeLayout(this._root), null, 2)));
        toolbar.addComponent(serializeButton);

        return toolbar;
    }
}

const LayoutSerializationPanelCallable = callable(LayoutSerializationPanel);
type LayoutSerializationPanelCallable = LayoutSerializationPanel;
export {
    LayoutSerializationPanel         as _LayoutSerializationPanel,
    LayoutSerializationPanelCallable as LayoutSerializationPanel
};
