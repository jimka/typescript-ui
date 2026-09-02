// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { Insets } from '@jimka/typescript-ui/primitive';
import { Fit, HBox, VBox, LayoutConstraints } from '@jimka/typescript-ui/layout';
import { Checkbox, Text, TextField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { List } from '@jimka/typescript-ui/component/list';
import { AccordionPanel } from '@jimka/typescript-ui/component/container';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { circle_user } from '@jimka/typescript-ui/glyphs/solid/circle_user';
import { gear } from '@jimka/typescript-ui/glyphs/solid/gear';
import { clock_rotate_left } from '@jimka/typescript-ui/glyphs/solid/clock_rotate_left';
import { circle_info } from '@jimka/typescript-ui/glyphs/solid/circle_info';
import { pen_to_square } from '@jimka/typescript-ui/glyphs/solid/pen_to_square';
import { ellipsis_vertical } from '@jimka/typescript-ui/glyphs/solid/ellipsis_vertical';
import { ToolBar } from '~/component/menubar/ToolBar';

// Register the section-header and tool glyphs once at module load so the demo's
// AccordionPanel can reference them by registry name.
Glyph.register(circle_user, gear, clock_rotate_left, circle_info, pen_to_square, ellipsis_vertical);

/**
 * Demonstrates the framework {@link AccordionPanel} (a Panel subclass that
 * wraps the Accordion layout manager) with multiple collapsible sections,
 * programmatic open/close controls, and single-open mode toggling.
 */
class AccordionDemoPanel extends Panel {

    private accordion:        AccordionPanel;
    private singleOpenToggle: Button;
    private compactToggle:    Button;
    private themedToggle:     Button;
    private spacingToggle:    Button;
    private fillToggle:       Button;
    private resizableToggle:  Button;
    private resizeLogText:    Text;

    constructor() {
        super();

        // VBox with stretching so children fill the full container width.
        this.setLayoutManager(new VBox({
            stretching: true,
            spacing: 0
        }));

        this.setAutoScroll("auto")
            .setInsets(new Insets(0,0,0,0));

        // --- Controls toolbar ---
        // Pin a min height equal to the preferred height so the outer VBox's
        // overflow shrink can't compress this fixed control bar — without it the
        // toolbar collapses when the open accordion overflows the window, sliding
        // the accordion's top upward and breaking vertical alignment.
        const toolbar = new ToolBar({ compact: true });

        const openAllBtn = new Button("Open All");
        toolbar.addComponent(openAllBtn);

        const closeAllBtn = new Button("Close All");
        toolbar.addComponent(closeAllBtn);

        this.singleOpenToggle = new Button("Single-open: ON");
        toolbar.addComponent(this.singleOpenToggle);

        this.compactToggle = new Button("Compact: ON");
        toolbar.addComponent(this.compactToggle);

        this.themedToggle = new Button("Themed: ON");
        toolbar.addComponent(this.themedToggle);

        this.spacingToggle = new Button("Spacing: 0");
        toolbar.addComponent(this.spacingToggle);

        this.fillToggle = new Button("Fill: ON");
        toolbar.addComponent(this.fillToggle);

        this.resizableToggle = new Button("Resizable: OFF");
        toolbar.addComponent(this.resizableToggle);

        this.addComponent(toolbar);

        // --- Resize event log (only meaningful once "Resizable" is toggled on) ---
        const logRow = new Component({ preferredSize: { width: 0, height: 28 } });

        logRow.setLayoutManager(new HBox());
        logRow.addComponent(new Text("Last sectionresize:", { preferredSize: { width: 130, height: 28 } }));
        this.resizeLogText = new Text("—", { preferredSize: { width: 400, height: 28 } });
        logRow.addComponent(this.resizeLogText);
        this.addComponent(logRow);

        // --- AccordionPanel ---
        this.accordion = new AccordionPanel({
            singleOpen: true,
            sections: [
                { label: "Personal Info", component: this.buildInfoSection(),        initiallyOpen: true, glyph: "circle-user"        },
                { label: "Preferences",   component: this.buildPreferencesSection(),                       glyph: "gear",
                  tools: [this.makeToolButton("pen-to-square", "Edit preferences")] },
                { label: "Recent Items",  component: this.buildListSection(),                              glyph: "clock-rotate-left"  },
                { label: "About",         component: this.buildAboutSection(),                             glyph: "circle-info"        },
            ],
            // Re-layout the outer VBox whenever a section toggles so the
            // accordion resizes to match the new total preferred height.
            onSectionToggle: () => { this.doLayout(); },
        });

        this.accordion.getAccordion()
            .setFillHeight(true)
            .setCompact(true)
            .setChevronSide("start");

        // Fires once per completed resizable-gutter drag (only while
        // "Resizable" is on); each entry's unit follows the section's weight,
        // so an unweighted section reports "px" — see the Accordion docs'
        // "Resizable sections" section.
        this.accordion.getAccordion().on("sectionresize", sizes => {
            const summary = sizes.map(size => `${size.unit}:${size.value.toFixed(1)}`).join(", ");

            this.resizeLogText.setText(`[${summary}]`);
        });

        // Weight 1 so the accordion fills the panel's remaining height below the
        // toolbar — giving fill mode the leftover space it expands an open
        // section into (IDE/dock-panel style).
        const accordionConstraints = new LayoutConstraints();

        accordionConstraints.weight = 1;

        this.addComponent(this.accordion, accordionConstraints);

        // --- Wire controls ---
        openAllBtn.on("action", () => {
            this.accordion.getAccordion().expandAll();
        });

        closeAllBtn.on("action", () => {
            this.accordion.getAccordion().collapseAll();
        });

        this.singleOpenToggle.on("action", () => {
            const next = !this.accordion.getAccordion().isSingleOpen();

            this.accordion.getAccordion().setSingleOpen(next);
            this.singleOpenToggle.setText(`Single-open: ${next ? 'ON' : 'OFF'}`);
        });

        this.compactToggle.on("action", () => {
            const next = !this.accordion.getAccordion().isCompact();

            this.accordion.getAccordion().setCompact(next);
            this.compactToggle.setText(`Compact: ${next ? 'ON' : 'OFF'}`);
            this.doLayout();
        });

        this.themedToggle.on("action", () => {
            const next = !this.accordion.getAccordion().isThemed();

            this.accordion.getAccordion().setThemed(next);
            this.themedToggle.setText(`Themed: ${next ? 'ON' : 'OFF'}`);
            this.doLayout();
        });

        this.spacingToggle.on("action", () => {
            const next = this.accordion.getAccordion().getSpacing() === 0 ? 8 : 0;

            this.accordion.getAccordion().setSpacing(next);
            this.spacingToggle.setText(`Spacing: ${next}`);
            this.doLayout();
        });

        this.fillToggle.on("action", () => {
            const next = !this.accordion.getAccordion().isFillHeight();

            this.accordion.getAccordion().setFillHeight(next);
            this.fillToggle.setText(`Fill: ${next ? 'ON' : 'OFF'}`);
            this.doLayout();
        });

        this.resizableToggle.on("action", () => {
            const next = !this.accordion.getAccordion().isResizable();

            this.accordion.getAccordion().setResizable(next);
            this.resizableToggle.setText(`Resizable: ${next ? 'ON' : 'OFF'}`);
            this.doLayout();
        });

        // A global tool follows the hovered header, appearing alongside that
        // header's own (per-section) tools.
        this.accordion.getAccordion().addTool(this.makeToolButton("ellipsis-vertical", "Global menu"));
    }

    /**
     * Builds a small flat icon button for use as an accordion header tool. The
     * action logs so the demo shows that a tool click does not toggle its
     * section.
     *
     * @param glyph - Registry glyph name for the tool icon.
     * @param label - Identifier logged when the tool is clicked.
     * @returns The tool button.
     */
    private makeToolButton(glyph: string, label: string): Button {
        // Compact glyph-only buttons so the tool fits inside the (compact or
        // normal) header height rather than inflating the header row.
        const button = new Button({ glyph, flat: true, compact: true });

        button.on("action", () => { console.log(`Accordion tool clicked: ${label}`); });

        return button;
    }

    /**
     * Builds a form section with labelled text fields.
     *
     * @returns The section content component.
     */
    private buildInfoSection(): Component {
        const panel = new Panel({
            insets       : new Insets(8, 8, 8, 8),
            preferredSize: { width: 0, height: 116 },
        });

        panel.setLayoutManager(new VBox({ stretching: true }));

        panel.addComponent(this.labeledField('Name:', 'Jane Doe'));
        panel.addComponent(this.labeledField('Email:', 'jane@example.com'));
        panel.addComponent(this.labeledField('Phone:', '+1 555 000 0000'));

        return panel;
    }

    /**
     * Builds a section with toggle checkboxes.
     *
     * @returns The section content component.
     */
    private buildPreferencesSection(): Component {
        const panel = new Panel({
            insets       : new Insets(8, 8, 8, 8),
            preferredSize: { width: 0, height: 110 },
        });

        panel.setLayoutManager(new VBox({ stretching: true }));

        for (const text of ['Enable notifications', 'Dark mode', 'Auto-save']) {
            const row = new Component({ preferredSize: { width: 0, height: 28 } });

            row.setLayoutManager(new HBox());

            row.addComponent(new Checkbox());
            row.addComponent(new Text(text));

            panel.addComponent(row);
        }

        return panel;
    }

    /**
     * Builds a section with a scrollable item list.
     *
     * @returns The section content component.
     */
    private buildListSection(): Component {
        const panel = new Panel({ preferredSize: { width: 0, height: 150 } });

        panel.setLayoutManager(new Fit());

        const list = new List();

        // Keyed items: explicit `{ key, label }` entries keep their caller
        // chosen key (so `getValue()` returns e.g. `"q1"`), while the trailing
        // plain string is auto-keyed by its array position.
        list.setItems([
            { key: 'q1',      label: 'Report Q1.pdf' },
            { key: 'budget',  label: 'Budget 2026.xlsx' },
            { key: 'notes',   label: 'Meeting notes.txt' },
            { key: 'mockup',  label: 'Design mockup.png' },
            { key: 'draft',   label: 'Proposal draft.docx' },
            'Invoice #1042.pdf',
        ]);

        panel.addComponent(list);

        return panel;
    }

    /**
     * Builds a short informational section with descriptive labels.
     *
     * @returns The section content component.
     */
    private buildAboutSection(): Component {
        const panel = new Panel({
            insets       : new Insets(8, 8, 8, 8),
            preferredSize: { width: 0, height: 86 },
        });

        panel.setLayoutManager(new VBox({ stretching: true }));

        const title = new Text('Accordion Layout Manager', {
            fontWeight   : 'bold',
            preferredSize: { width: 0, height: 20 },
        });

        panel.addComponent(title);

        panel.addComponent(new Text('Vertically stacked sections with CSS height animation.', {
            preferredSize: { width: 0, height: 20 },
        }));

        panel.addComponent(new Text('Supports single-open mode and programmatic open/close.', {
            preferredSize: { width: 0, height: 20 },
        }));

        return panel;
    }

    /**
     * Creates a horizontal row with a fixed-width caption and a text field.
     *
     * @param caption - The caption string shown to the left of the field.
     * @param value - Initial text for the field.
     * @returns The row component.
     */
    private labeledField(caption: string, value: string): Component {
        const row = new Panel({ preferredSize: { width: 0, height: 30 } });

        row.setLayoutManager(new HBox());

        row.addComponent(new Text(caption, { preferredSize: { width: 70, height: 30 } }));
        row.addComponent(new TextField({
            text         : value,
            preferredSize: { width: 200, height: 28 },
        }));

        return row;
    }
}

const AccordionDemoPanelCallable = callable(AccordionDemoPanel);
type AccordionDemoPanelCallable = AccordionDemoPanel;
export {
    AccordionDemoPanel         as _AccordionDemoPanel,
    AccordionDemoPanelCallable as AccordionDemoPanel
};
