// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    Accordion,
    AccordionConstraints,
    Button,
    callable,
    Checkbox,
    Component,
    Fit,
    HBox,
    Insets,
    List,
    Panel,
    Text,
    TextField,
    VBox
} from "@jimka/typescript-ui";

/**
 * Demonstrates the Accordion layout manager with multiple collapsible sections,
 * programmatic open/close controls, and single-open mode toggling.
 */
class AccordionPanel extends Panel {

    private accordion: Accordion;
    private singleOpenToggle: Button;

    constructor() {
        super();

        // VBox with stretching so children fill the full container width.
        // Without stretching, VBox uses size.width from setPreferredSize, which
        // would give 0 width when only the height is meaningful.
        this.setLayoutManager(new VBox({ stretching: true }));

        // --- Controls toolbar ---
        const toolbar = new Component({ preferredSize: { width: 0, height: 36 } });
        toolbar.setLayoutManager(new HBox());

        const openAllBtn = new Button("Open All", { preferredSize: { width: 90, height: 28 } });
        toolbar.addComponent(openAllBtn);

        const closeAllBtn = new Button("Close All", { preferredSize: { width: 90, height: 28 } });
        toolbar.addComponent(closeAllBtn);

        this.singleOpenToggle = new Button("Single-open: OFF", { preferredSize: { width: 160, height: 28 } });
        toolbar.addComponent(this.singleOpenToggle);

        this.addComponent(toolbar);

        // --- Accordion ---
        const accordionContainer = new Component();

        // Re-layout the outer VBox whenever a section toggles so the accordion
        // container resizes to match the new total preferred height.
        this.accordion = new Accordion({
            onSectionToggle: () => { this.doLayout(); },
        });
        accordionContainer.setLayoutManager(this.accordion);

        // Section 1: open by default
        accordionContainer.addComponent(this.buildInfoSection(), new AccordionConstraints('Personal Info', true));
        accordionContainer.addComponent(this.buildPreferencesSection(), new AccordionConstraints('Preferences'));
        accordionContainer.addComponent(this.buildListSection(), new AccordionConstraints('Recent Items'));
        accordionContainer.addComponent(this.buildAboutSection(), new AccordionConstraints('About'));

        this.addComponent(accordionContainer);

        // --- Wire controls ---
        openAllBtn.addActionListener(() => {
            for (let i = 0; i < 4; i++) {
                this.accordion.openSection(i);
            }
        });

        closeAllBtn.addActionListener(() => {
            for (let i = 0; i < 4; i++) {
                this.accordion.closeSection(i);
            }
        });

        this.singleOpenToggle.addActionListener(() => {
            const next = !this.accordion.isSingleOpen();

            this.accordion.setSingleOpen(next);
            this.singleOpenToggle.getText().setText(`Single-open: ${next ? 'ON' : 'OFF'}`);
        });
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

        for (const item of ['Report Q1.pdf', 'Budget 2026.xlsx', 'Meeting notes.txt',
                             'Design mockup.png', 'Proposal draft.docx', 'Invoice #1042.pdf']) {
            list.addItem(item);
        }

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

        panel.addComponent(new Text('Accordion Layout Manager', {
            fontWeight   : 'bold',
            preferredSize: { width: 0, height: 20 },
        }));

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

const AccordionPanelCallable = callable(AccordionPanel);
type AccordionPanelCallable = AccordionPanel;
export {
    AccordionPanel         as _AccordionPanel,
    AccordionPanelCallable as AccordionPanel
};
