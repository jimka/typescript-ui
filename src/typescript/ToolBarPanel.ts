// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ButtonGroup, callable, Panel }            from '@jimka/typescript-ui/core';
import { VBox }                                    from '@jimka/typescript-ui/layout';
import { Spacer }                                  from '@jimka/typescript-ui/component/container';
import { ComboBox, Text }                          from '@jimka/typescript-ui/component/input';
import { Button, ToggleButton, SplitButton }       from '@jimka/typescript-ui/component/button';
import { ToolBar, ToolBarSeparator }               from '@jimka/typescript-ui/component/menubar';
import { Glyph }                                   from '@jimka/typescript-ui/component/display';
import { scissors }                                from '@jimka/typescript-ui/glyphs/solid/scissors';
import { copy as copyGlyph }                       from '@jimka/typescript-ui/glyphs/solid/copy';
import { paste as pasteGlyph }                     from '@jimka/typescript-ui/glyphs/solid/paste';

// The toolbar demo's Cut/Copy/Paste buttons render glyph-only; register their
// glyphs at module load (copy/paste aliased to dodge the local const names).
Glyph.register(scissors, copyGlyph, pasteGlyph);

/**
 * Demo panel showcasing the `ToolBar` component.
 *
 * Demonstrates: a flat (default) horizontal toolbar with a Bold/Italic/Underline
 * `ButtonGroup` whose selected button reads depressed, a separator, glyph-only
 * Cut/Copy/Paste buttons that render as compact squares, a `SplitButton` whose
 * main face fires the primary action while its trailing chevron opens a
 * dropdown, a `Spacer.flex()` that pushes a trailing zoom `ComboBox` to the
 * right edge, and a status text area below that reflects the last action. A
 * second `ToolBar({ flat: false })` demonstrates the raised-button escape
 * hatch, and a third `ToolBar({ overflow: "menu" })` packs enough buttons that
 * narrowing the panel pushes the trailing ones into a chevron dropdown.
 */
class ToolBarPanel extends Panel {

    /**
     * Constructs the demo panel and wires up a sample toolbar.
     */
    constructor() {
        super({layoutManager: VBox({ stretching: true })});

        const bar        = new ToolBar();
        const statusText = new Text("Click a toolbar button to see it here.");

        const status = (msg: string): void => {
            statusText.setText("Last action: " + msg);
        };

        const bold      = new ToggleButton("B");
        const italic    = new ToggleButton("I");
        const underline = new ToggleButton("U");

        const styleGroup = new ButtonGroup({ buttons: [
            bold,
            italic,
            underline
        ]});

        bold.on("action", () => { status("Toggle Bold"); });
        italic.on("action", () => { status("Toggle Italic"); });
        underline.on("action", () => { status("Toggle Underline"); });

        const cut   = new Button({ glyph: "scissors" });
        const copy  = new Button({ glyph: "copy" });
        const paste = new Button({ glyph: "paste" });

        cut.on("action", () => { status("Cut"); });
        copy.on("action", () => { status("Copy"); });
        paste.on("action", () => { status("Paste"); });

        const saveSplit = new SplitButton("Save", {
            menuItems: [
                { text: "Save As…",  action: () => { status("Save As"); }  },
                { text: "Save All",  action: () => { status("Save All"); } },
            ],
        });
        saveSplit.on("action", () => { status("Save"); });

        const zoom = new ComboBox({ items: ["50%", "75%", "100%", "125%", "150%"] });
        zoom.on("action", (value: string) => { status("Zoom " + value); });

        bar.addComponents(
            styleGroup.getButtons(),
            ToolBarSeparator(),
            cut,
            copy,
            paste,
            ToolBarSeparator(),
            saveSplit,
            Spacer.flex(),
            zoom
        );

        const raisedBar: ToolBar = new ToolBar({ flat: false });

        const save = new Button("Save");
        const open = new Button("Open");

        save.on("action", () => { status("Save"); });
        open.on("action", () => { status("Open"); });

        raisedBar.addComponents(
            save,
            open
        );

        const overflowBar = new ToolBar({ overflow: "menu" });

        const actions = ["New", "Open", "Save", "Print", "Undo", "Redo", "Find", "Replace", "AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE", "FFFFFF", "GGGGGG", "HHHHHH", "IIIIII", "JJJJJJ"];

        for (const label of actions) {
            const button = new Button(label);

            button.on("action", () => { status(label); });
            overflowBar.addComponent(button);
        }

        this.addComponents(
            bar,
            raisedBar,
            overflowBar,
            statusText
        );
    }
}

const ToolBarPanelCallable = callable(ToolBarPanel);
type ToolBarPanelCallable = ToolBarPanel;
export {
    ToolBarPanel         as _ToolBarPanel,
    ToolBarPanelCallable as ToolBarPanel
};
