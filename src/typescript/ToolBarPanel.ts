// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ButtonGroup, callable, Panel }            from '@jimka/typescript-ui/core';
import { VBox }                                    from '@jimka/typescript-ui/layout';
import { Spacer }                                  from '@jimka/typescript-ui/component/container';
import { ComboBox, Text }                          from '@jimka/typescript-ui/component/input';
import { Button, ToggleButton }                    from '@jimka/typescript-ui/component/button';
import { ToolBar, ToolBarSeparator }               from '@jimka/typescript-ui/component/menubar';

/**
 * Demo panel showcasing the `ToolBar` component.
 *
 * Demonstrates: a flat (default) horizontal toolbar with a Bold/Italic/Underline
 * `ButtonGroup` whose selected button reads depressed, a separator, glyph-only
 * Cut/Copy/Paste buttons that render as compact squares, a `Spacer.flex()` that
 * pushes a trailing zoom `ComboBox` to the right edge, and a status text area
 * below that reflects the last action. A second `ToolBar({ flat: false })`
 * demonstrates the raised-button escape hatch. A third
 * `ToolBar({ overflow: "menu" })` packs enough buttons that narrowing the panel
 * pushes the trailing ones into a chevron dropdown.
 */
class ToolBarPanel extends Panel {

    /**
     * Constructs the demo panel and wires up a sample toolbar.
     */
    constructor() {
        super();

        const vbox = new VBox();
        vbox.setStretching(true);
        this.setLayoutManager(vbox);

        const bar        = new ToolBar();
        const statusText = new Text("Click a toolbar button to see it here.");

        const status = (msg: string): void => {
            statusText.setText("Last action: " + msg);
        };

        const bold      = new ToggleButton("B");
        const italic    = new ToggleButton("I");
        const underline = new ToggleButton("U");

        const styleGroup = new ButtonGroup();
        styleGroup.addButton(bold);
        styleGroup.addButton(italic);
        styleGroup.addButton(underline);

        bold.on("action", () => { status("Toggle Bold"); });
        italic.on("action", () => { status("Toggle Italic"); });
        underline.on("action", () => { status("Toggle Underline"); });

        const cut   = new Button({ glyph: "scissors" });
        const copy  = new Button({ glyph: "copy" });
        const paste = new Button({ glyph: "paste" });

        cut.on("action", () => { status("Cut"); });
        copy.on("action", () => { status("Copy"); });
        paste.on("action", () => { status("Paste"); });

        const zoom = new ComboBox({ items: ["50%", "75%", "100%", "125%", "150%"] });
        zoom.on("action", (value: string) => { status("Zoom " + value); });

        bar.addComponent(bold);
        bar.addComponent(italic);
        bar.addComponent(underline);
        bar.addComponent(new ToolBarSeparator());
        bar.addComponent(cut);
        bar.addComponent(copy);
        bar.addComponent(paste);
        bar.addComponent(Spacer.flex());
        bar.addComponent(zoom);

        const raisedBar: ToolBar = new ToolBar({ flat: false });

        const save = new Button("Save");
        const open = new Button("Open");

        save.on("action", () => { status("Save"); });
        open.on("action", () => { status("Open"); });

        raisedBar.addComponent(save);
        raisedBar.addComponent(open);

        const overflowBar = new ToolBar({ overflow: "menu" });

        const actions = ["New", "Open", "Save", "Print", "Undo", "Redo", "Find", "Replace"];

        for (const label of actions) {
            const button = new Button(label);

            button.on("action", () => { status(label); });
            overflowBar.addComponent(button);
        }

        this.addComponent(bar);
        this.addComponent(raisedBar);
        this.addComponent(overflowBar);
        this.addComponent(statusText);
    }
}

const ToolBarPanelCallable = callable(ToolBarPanel);
type ToolBarPanelCallable = ToolBarPanel;
export {
    ToolBarPanel         as _ToolBarPanel,
    ToolBarPanelCallable as ToolBarPanel
};
