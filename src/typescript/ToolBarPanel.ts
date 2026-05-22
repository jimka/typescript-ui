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
 * Demonstrates: a horizontal toolbar with a Bold/Italic/Underline
 * `ButtonGroup`, a separator, three plain Cut/Copy/Paste buttons, a
 * `Spacer.flex()` that pushes a trailing zoom `ComboBox` to the right edge,
 * and a status text area below that reflects the last action.
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

        bold.addActionListener(() => { status("Toggle Bold"); });
        italic.addActionListener(() => { status("Toggle Italic"); });
        underline.addActionListener(() => { status("Toggle Underline"); });

        const cut   = new Button("Cut");
        const copy  = new Button("Copy");
        const paste = new Button("Paste");

        cut.addActionListener(() => { status("Cut"); });
        copy.addActionListener(() => { status("Copy"); });
        paste.addActionListener(() => { status("Paste"); });

        const zoom = new ComboBox({ items: ["50%", "75%", "100%", "125%", "150%"] });
        zoom.addActionListener((value: string) => { status("Zoom " + value); });

        bar.addComponent(bold);
        bar.addComponent(italic);
        bar.addComponent(underline);
        bar.addComponent(new ToolBarSeparator());
        bar.addComponent(cut);
        bar.addComponent(copy);
        bar.addComponent(paste);
        bar.addComponent(Spacer.flex());
        bar.addComponent(zoom);

        this.addComponent(bar);
        this.addComponent(statusText);
    }
}

const ToolBarPanelCallable = callable(ToolBarPanel);
type ToolBarPanelCallable = ToolBarPanel;
export {
    ToolBarPanel         as _ToolBarPanel,
    ToolBarPanelCallable as ToolBarPanel
};
